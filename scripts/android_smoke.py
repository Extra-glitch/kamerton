#!/usr/bin/env python3
"""Проверка собранного APK на настоящем эмуляторе Android.

Обязательно: запуск, настройка, поиск и воспроизведение файла на устройстве, работа в фоне,
медиакнопки, отсутствие падений. Проверка сети (волна из интернета) идёт отдельно: сбой
внешнего сервиса отмечается предупреждением и не считается ошибкой приложения.
"""
import base64
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import xml.etree.ElementTree as ET

PACKAGE = "app.kamerton.player"
ADB = os.environ.get("ADB", "adb").split()
FIRST, SECOND = "Сигнал Камертона", "Второй сигнал"
apk, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
results = []
seen_texts = []


def adb(*args, check=True, timeout=120):
    r = subprocess.run([*ADB, *args], capture_output=True, text=True, errors="replace", timeout=timeout)
    if check and r.returncode:
        raise RuntimeError(f"adb {' '.join(args)}: {r.stdout}{r.stderr}")
    return r.stdout


def shell(cmd, check=True, timeout=120):
    return adb("shell", cmd, check=check, timeout=timeout)


def record(name, ok, detail="", required=True):
    results.append({"name": name, "ok": bool(ok), "detail": detail, "required": required})
    print(("ГОТОВО " if ok else "ОШИБКА " if required else "ВНИМАНИЕ ") + name + (f": {detail}" if detail else ""), flush=True)
    if required and not ok:
        raise AssertionError(name)


def screenshot(name):
    with open(f"{out}/{name}.png", "wb") as f:
        subprocess.run([*ADB, "exec-out", "screencap", "-p"], stdout=f, check=False, timeout=60)


def parse_nodes(xml_text):
    """Узлы экрана: текст, подпись и координаты центра."""
    nodes = []
    for n in ET.fromstring(xml_text).iter("node"):
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            nodes.append({"text": n.get("text", ""), "desc": n.get("content-desc", ""), "x": (x1 + x2) // 2, "y": (y1 + y2) // 2, "h": y2 - y1})
    return nodes


def screen():
    for _ in range(6):
        shell("rm -f /sdcard/ui.xml", check=False)
        shell("uiautomator dump /sdcard/ui.xml", check=False, timeout=45)
        raw = shell("cat /sdcard/ui.xml", check=False)
        if raw.lstrip().startswith("<?xml"):
            nodes = parse_nodes(raw[raw.index("<?xml"):raw.rindex(">") + 1])
            for n in nodes:  # всплывающие сообщения исчезают быстро, поэтому запоминаем всё увиденное
                for value in (n["text"], n["desc"]):
                    if value and value not in seen_texts:
                        seen_texts.append(value)
            return nodes
        time.sleep(1.5)
    return []


def find(nodes, label, exact=True):
    for n in nodes:
        for value in (n["text"], n["desc"]):
            if value == label or (not exact and label in value):
                return n
    return None


def wait(label, seconds=45, exact=True):
    end = time.time() + seconds
    while time.time() < end:
        n = find(screen(), label, exact)
        if n:
            return n
        time.sleep(1.5)
    return None


def tap(n, label="элемент"):
    if not n:
        raise AssertionError(f"На экране не найден {label}")
    shell(f"input tap {n['x']} {n['y']}")
    time.sleep(0.8)


def size():
    m = re.search(r"(\d+)x(\d+)", shell("wm size"))
    return int(m.group(1)), int(m.group(2))


def scroll_to(label, attempts=6):
    w, h = size()
    for _ in range(attempts):
        n = find(screen(), label)
        if n:
            return n
        shell(f"input swipe {w // 2} {int(h * .75)} {w // 2} {int(h * .3)} 350")
        time.sleep(.8)
    return None


def scroll_to_part(label, attempts=5):
    """Как scroll_to, но ищет часть подписи. Строка должна быть выше нижней панели, иначе нажатие попадёт в панель."""
    w, h = size()
    for _ in range(attempts):
        n = next((x for x in screen() if label in (x["text"] + "|" + x["desc"]) and h * .15 < x["y"] < h * .62), None)
        if n:
            return n
        shell(f"input swipe {w // 2} {int(h * .6)} {w // 2} {int(h * .35)} 400")
        time.sleep(.8)
    return None


def side_scroll_to(label, anchor, attempts=6):
    """Прокручивает горизонтальный ряд, высота которого определяется один раз."""
    w, _ = size()
    row = find(screen(), anchor)
    if not row:
        return None
    for _ in range(attempts):
        n = find(screen(), label)
        if n and w * .08 < n["x"] < w * .82:  # элемент у края экрана виден лишь частично
            return n
        shell(f"input swipe {int(w * .8)} {row['y']} {int(w * .35)} {row['y']} 400")
        time.sleep(1)
    return None


def parse_sessions(text):
    """Состояние медиасессий приложения из dumpsys media_session."""
    out_list = []
    for part in text.split("package=")[1:]:
        if not part.startswith(PACKAGE):
            continue
        state = re.search(r"state=PlaybackState \{state=(\w+)", part)
        meta = re.search(r"description=([^\n]*)", part)
        out_list.append({"state": state.group(1) if state else "", "title": meta.group(1).strip() if meta else ""})
    return out_list


def is_playing(s):
    return s["state"] in ("3", "PLAYING")


def sessions():
    return parse_sessions(shell("dumpsys media_session", check=False))


def wait_session(test, seconds=40):
    end = time.time() + seconds
    last = []
    while time.time() < end:
        last = sessions()
        if any(test(s) for s in last):
            return True, last
        time.sleep(1)
    return False, last


def alive():
    return shell(f"pidof {PACKAGE}", check=False).strip()


def wait_storage(seconds=120):
    """Общая память эмулятора становится доступной не сразу после загрузки."""
    end = time.time() + seconds
    while time.time() < end:
        if "ok" in shell("mkdir -p /sdcard/Music && touch /sdcard/Music/kamerton-test.tmp && rm /sdcard/Music/kamerton-test.tmp && echo ok", check=False):
            return True
        time.sleep(3)
    return False


def push_file(path, name):
    """Копирование через временную папку надёжнее прямой записи в общую память."""
    adb("push", path, f"/data/local/tmp/{name}")
    for _ in range(10):
        if "ok" in shell(f"cp /data/local/tmp/{name} /sdcard/Music/{name} && echo ok", check=False):
            return
        time.sleep(3)
    raise RuntimeError(f"Не удалось записать {name} в память эмулятора")


def make_audio():
    record("Память эмулятора готова", wait_storage())
    tmp = tempfile.mkdtemp()
    for name, title, freq in (("kamerton-1.mp3", FIRST, 330), ("kamerton-2.mp3", SECOND, 440)):
        path = f"{tmp}/{name}"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration=150", "-c:a", "libmp3lame", "-b:a", "96k",
                        "-metadata", f"title={title}", "-metadata", "artist=Тест устройства", "-metadata", "album=Проверка", "-id3v2_version", "3", path], check=True)
        push_file(path, name)
    shell("content call --method scan_volume --uri content://media --arg external_primary", check=False)
    time.sleep(3)


def scenario():
    make_audio()
    adb("install", "-r", "-t", "-g", apk, timeout=300)
    record("APK установился", True)
    shell("logcat -c", check=False)
    shell(f"monkey -p {PACKAGE} -c android.intent.category.LAUNCHER 1", check=False)
    start = wait("Начать слушать", 120) or scroll_to("Начать слушать")
    screenshot("01-start")
    record("Приложение запустилось без сервера разработки", start and alive())
    for g in ("Эмбиент", "Рок"):
        n = find(screen(), g)
        if n:
            tap(n)
    tap(scroll_to("Начать слушать"), "кнопка Начать слушать")
    home = wait("Включить волну", 60)
    screenshot("02-home")
    record("Открылась главная", home)

    tap(wait("Коллекция", 20), "раздел Коллекция")
    wait("Плейлисты", 20)
    button = None
    for _ in range(3):
        tap(side_scroll_to("На телефоне", "Плейлисты"), "фильтр На телефоне")
        button = wait("Найти файлы", 8)
        if button:
            break
    tap(button, "кнопка поиска файлов")
    found = wait(FIRST, 60, exact=False)
    screenshot("03-local")
    record("Найден файл на устройстве, теги прочитаны", found)
    wait(SECOND, 20, exact=False)
    nodes = screen()
    places = {FIRST: find(nodes, FIRST), SECOND: find(nodes, SECOND)}
    rows = [n for n in places.values() if n]
    tap(min(rows, key=lambda n: n["y"]), "первый файл в списке")  # после него в очереди есть следующий трек
    ok, st = wait_session(is_playing)
    screenshot("04-playing")
    record("Локальный файл играет", ok, json.dumps(st, ensure_ascii=False))

    shell("input keyevent KEYCODE_HOME")
    time.sleep(25)
    ok, st = wait_session(is_playing, 5)
    service = "AudioControlsService" in shell(f"dumpsys activity services {PACKAGE}", check=False)
    record("Воспроизведение продолжается в фоне", ok and alive() and service, f"сервис: {service}")
    before = next((s["title"] for s in st if is_playing(s)), "")
    other = SECOND if FIRST in before else FIRST
    shell("input keyevent KEYCODE_MEDIA_NEXT")
    ok, st = wait_session(lambda s: other in s["title"], 15)
    record("Кнопка «следующий» работает из фона", ok, json.dumps(st, ensure_ascii=False))
    shell("input keyevent KEYCODE_MEDIA_PAUSE")
    ok, _ = wait_session(lambda s: s["state"] in ("2", "PAUSED"), 10)
    record("Кнопка паузы работает", ok)
    shell("input keyevent KEYCODE_MEDIA_PLAY")
    ok, _ = wait_session(is_playing, 10)
    record("Кнопка воспроизведения работает", ok)

    # Запуск нового трека, пока играет другой: старая очередь обязана замолчать.
    shell(f"monkey -p {PACKAGE} -c android.intent.category.LAUNCHER 1", check=False)
    time.sleep(2)
    playing_now = next((s["title"] for s in sessions() if is_playing(s)), "")
    target = FIRST if SECOND in playing_now else SECOND
    # Во время игры экран постоянно обновляется и снимок интерфейса недоступен, поэтому берём прежние координаты.
    tap(places[target], "другой трек в списке")
    ok, st = wait_session(lambda s: is_playing(s) and target in s["title"], 20)
    time.sleep(2)
    now_playing = [s for s in sessions() if is_playing(s)]
    record("Новая очередь заменяет старую, звучит один трек", ok and len(now_playing) == 1, json.dumps(now_playing, ensure_ascii=False))
    shell("input keyevent KEYCODE_MEDIA_PAUSE")
    time.sleep(1)

    tab = wait("Волна", 20)
    if tab:
        tap(tab)
    wave = wait("Включить волну", 20)
    if wave:
        tap(wave)
        ok, st = wait_session(lambda s: is_playing(s) and FIRST not in s["title"] and SECOND not in s["title"], 75)
    else:
        ok, st = False, []
    screenshot("05-wave")
    why = [t for t in seen_texts[-40:] if "олн" in t and len(t) > 30]
    record("Волна играет из интернета, а не файлы с телефона", ok, json.dumps(st, ensure_ascii=False) + (f" | {why[-1]}" if why and not ok else ""), required=False)
    mini = find(screen(), "Открыть плеер", exact=False)
    if mini:
        tap(mini)
        time.sleep(3)
        screenshot("06-player")
        shell("input keyevent KEYCODE_BACK")
        time.sleep(1)
    shell("input keyevent KEYCODE_MEDIA_PAUSE")
    share_check()
    telegram_checks()
    catalog_checks()
    switch_checks()


def share_check():
    """Отправляет аудиофайл в Камертон так же, как Telegram через «Поделиться», и ждёт, что он заиграет."""
    out = adb("shell", "content", "query", "--uri", "content://media/external/audio/media", "--projection", "_id:_display_name", check=False)
    m = re.search(r"_id=(\d+), _display_name=kamerton-2\.mp3", out)
    if not m:
        record("Файл через «Поделиться» добавляется и играет", False, "файл не найден в медиатеке: " + out[-300:], required=False)
        return
    shell(f"am start -a android.intent.action.SEND -t audio/mpeg --eu android.intent.extra.STREAM content://media/external/audio/media/{m.group(1)} --grant-read-uri-permission -n app.kamerton.player/.MainActivity")
    ok, st = wait_session(lambda s: is_playing(s) and SECOND in s.get("title", ""), 40)
    screenshot("06b-shared")
    record("Файл через «Поделиться» добавляется и играет", ok, json.dumps(st, ensure_ascii=False), required=False)
    shell("input keyevent KEYCODE_MEDIA_PAUSE")
    time.sleep(1)


# ---------- Файлы как из Telegram ----------
# Telegram при «Поделиться» отдаёт файл из своего кэша через собственный FileProvider с именем
# «<номер сервера>_<номер документа>.mp3» и без названия из чата. Здесь то же самое делает
# FileProvider самого Камертона: файл кладётся в его кэш и отправляется обычным SEND-интентом.
PROVIDER = f"content://{PACKAGE}.FileSystemFileProvider/cached_expo_files"
TG_NAME = "2_5341234123412341234.mp3"
CP_NAME = "Земфира - Искала #2 (@TgSoundBot).mp3"
CP_TITLE, CP_ARTIST = "Искала (тест)", "Земфира (тест)"
BIG_TITLE = "Big Test File"


def id3v23(frames):
    body = b"".join(fid.encode() + len(data).to_bytes(4, "big") + b"\x00\x00" + data for fid, data in frames)
    n = len(body)
    return b"ID3\x03\x00\x00" + bytes([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]) + body


def bare_mp3(path, seconds, freq, bitrate="96k"):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}", "-c:a", "libmp3lame", "-b:a", bitrate,
                    "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "0", path], check=True)


def to_app_cache(local, name):
    """Кладёт файл в кэш приложения (как Telegram держит файлы у себя) и возвращает content://-адрес."""
    adb("push", local, "/data/local/tmp/share.bin", timeout=300)
    safe = name.replace('"', "")
    shell(f"cat /data/local/tmp/share.bin | run-as {PACKAGE} sh -c 'mkdir -p cache/tg && cat > \"cache/tg/{safe}\"'", timeout=300)
    return f"{PROVIDER}/tg/{urllib.parse.quote(name)}"


def send(uri, mime="audio/mpeg"):
    shell("logcat -c", check=False)
    print("am start:", shell(f"am start -a android.intent.action.SEND -t {mime} --eu android.intent.extra.STREAM '{uri}' -n {PACKAGE}/.MainActivity", check=False).strip()[-200:], flush=True)


def share_log():
    """Что приложение записало о приёме файла: имя, тип, итог, ошибки."""
    lines = adb("logcat", "-d", "-s", "ReactNativeJS:*", "FileDirectory:*", "ExpoShareIntent:*", check=False, timeout=60).splitlines()
    picked = [l for l in lines if "Поделиться" in l or "не добавлен" in l or "File name" in l or "rror" in l]
    return " || ".join(x[-260:] for x in picked[-4:])


def to_tabs():
    """Назад до экрана с нижней панелью: так следующая проверка начинается с понятного места."""
    for _ in range(5):
        if find(screen(), "Поиск"):
            return
        shell("input keyevent KEYCODE_BACK")
        time.sleep(1)


def telegram_checks():
    tmp = tempfile.mkdtemp()
    # 1. Как из Telegram: служебное имя, тегов нет, приложение закрыто (холодный запуск).
    bare_mp3(f"{tmp}/tg.mp3", 120, 520)
    uri = to_app_cache(f"{tmp}/tg.mp3", TG_NAME)
    shell(f"am force-stop {PACKAGE}")
    time.sleep(2)
    send(uri)
    ok, st = wait_session(is_playing, 60)
    # Пока музыка играет, снимок интерфейса часто недоступен: ставим на паузу и смотрим экран.
    shell("input keyevent KEYCODE_MEDIA_PAUSE")
    ask = wait("Что это за песня?", 30)
    screenshot("06c-telegram-untitled")
    untitled = ok and any("Без названия" in s["title"] for s in st) and not any(re.search(r"\d{6,}", s["title"]) for s in st)
    record("Песня из Telegram без тегов играет как «Без названия» и приложение просит указать песню", untitled and ask,
           json.dumps(st, ensure_ascii=False) + ("" if untitled and ask else f" | экран: {bool(ask)} | {share_log()}"), required=False)
    if ask:
        named = False
        if type_into("Например: Земфира", "Zemfira Iskala"):
            hit = None
            end = time.time() + 40
            while time.time() < end and not hit:
                hit = next((n for n in screen() if ("Zemfira" in n["desc"] or "Земфира" in n["desc"]) and "—" in n["desc"]), None)
                time.sleep(1.5)
            screenshot("06d-identify-results")
            if hit:
                shell("input keyevent 4")  # спрятать клавиатуру
                time.sleep(1)
                hit = next((n for n in screen() if ("Zemfira" in n["desc"] or "Земфира" in n["desc"]) and "—" in n["desc"]), hit)
                tap(hit, "найденная песня")
                named, st = wait_session(lambda s: ("Искала" in s["title"] or "Iskala" in s["title"]), 20)
                record("Название и обложка подставляются из каталога", named, json.dumps(st, ensure_ascii=False), required=False)
        if not named:
            if find(screen(), "Что это за песня?") or wait("Что это за песня?", 5):
                type_into("Название песни", "Manual Title")
                type_into("Кто исполняет", "Manual Artist")
                shell("input keyevent 4")
                save = scroll_to_part("Сохранить название")
                if save:
                    tap(save)
                ok2, st = wait_session(lambda s: "Manual Title" in s["title"], 20)
                record("Название вписывается вручную и сразу видно в уведомлении", ok2, json.dumps(st, ensure_ascii=False), required=False)
        time.sleep(2)
        screenshot("06e-identified")
    shell("input keyevent KEYCODE_MEDIA_PAUSE")

    # 2. Теги в Windows-1251, обложка в файле, имя с пробелами, кириллицей и «#».
    bare_mp3(f"{tmp}/cp.mp3", 120, 600)
    cover = f"{tmp}/cover.jpg"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xE0457B:s=300x300", "-frames:v", "1", cover], check=True)
    tag = id3v23([("TIT2", b"\x00" + CP_TITLE.encode("cp1251")), ("TPE1", b"\x00" + CP_ARTIST.encode("cp1251")),
                  ("APIC", b"\x00image/jpeg\x00\x03\x00" + open(cover, "rb").read())])
    open(f"{tmp}/cp-tagged.mp3", "wb").write(tag + open(f"{tmp}/cp.mp3", "rb").read())
    uri = to_app_cache(f"{tmp}/cp-tagged.mp3", CP_NAME)
    send(uri)
    ok, st = wait_session(lambda s: is_playing(s) and CP_TITLE in s["title"] and CP_ARTIST in s["title"], 45)
    shell("input keyevent KEYCODE_MEDIA_PAUSE")
    time.sleep(1.5)
    screenshot("06f-cp1251-cover")
    record("Теги в Windows-1251, обложка в файле и имя с пробелами, кириллицей и # читаются", ok, json.dumps(st, ensure_ascii=False) + ("" if ok else f" | {share_log()}"), required=False)

    # 3. Та же песня ещё раз: дубликата быть не должно.
    send(to_app_cache(f"{tmp}/cp-tagged.mp3", CP_NAME))
    time.sleep(6)
    shell("input keyevent KEYCODE_MEDIA_PAUSE")
    log = share_log()
    repeat = '"known":true' in log
    record("Повторная отправка той же песни не создаёт дубликат", repeat, "" if repeat else log, required=False)

    # 4. Большой файл: 25 минут в 320 кбит/с, около 60 МБ.
    big = f"{tmp}/big.mp3"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=700:duration=1500", "-c:a", "libmp3lame", "-b:a", "320k",
                    "-metadata", f"title={BIG_TITLE}", "-metadata", "artist=Kamerton QA", "-id3v2_version", "3", big], check=True)
    mb = os.path.getsize(big) / 1048576
    send(to_app_cache(big, "big file.mp3"))
    ok, st = wait_session(lambda s: is_playing(s) and BIG_TITLE in s["title"], 120)
    record(f"Большой файл ({mb:.0f} МБ) добавляется и играет", ok, json.dumps(st, ensure_ascii=False) + ("" if ok else f" | {share_log()}"), required=False)
    shell("input keyevent KEYCODE_MEDIA_PAUSE")
    time.sleep(1)

    # 5. Журнал импорта: видно, откуда название и обложка.
    shell(f"am start -a android.intent.action.VIEW -d 'kamerton://import' -n {PACKAGE}/.MainActivity", check=False)
    log = wait("Последние файлы", 15) or scroll_to("Последние файлы", attempts=8)
    for _ in range(3):
        if log:
            scroll_to_part("Уже был", attempts=2)
    time.sleep(1)
    screenshot("06g-import-log")
    texts = " | ".join(seen_texts[-120:])
    entries = [t for t in seen_texts if "обложка" in t or "Не добавлен" in t]
    record("Журнал импорта показывает, откуда название и обложка", log and "обложка из файла" in texts and "Уже был в коллекции" in texts, " || ".join(entries[-4:]), required=False)
    to_tabs()


def switch_checks():
    """Выключатель источника: выключенный не ищется, включённый снова находится."""
    def search_local(q):
        shell(f"am start -a android.intent.action.VIEW -d 'kamerton://search?q={urllib.parse.quote(q)}' -n {PACKAGE}/.MainActivity", check=False)
        time.sleep(1)
        # Строка результата подписана «Название, Исполнитель, как играет»; мини-плеер — «Открыть плеер: …».
        return wait(f"{BIG_TITLE}, Kamerton QA", 25, exact=False)

    def toggle(state_from):
        shell(f"am start -a android.intent.action.VIEW -d 'kamerton://diagnostics' -n {PACKAGE}/.MainActivity", check=False)
        sw = wait(f"На телефоне: {state_from}", 25, exact=False)
        if sw:
            tap(sw)
            time.sleep(1.5)
        return sw

    before = search_local("Big Test")
    off = toggle("включён")
    gone = not search_local("Big Test F") if off else False
    screenshot("11-switch-off")
    on = toggle("выключен")
    back = search_local("Big Test File") if on else None
    record("Выключенный источник не участвует в поиске, после включения снова находится", before and off and gone and on and back,
           f"до: {bool(before)}, выключен: {bool(off)}, пропал: {gone}, включён: {bool(on)}, вернулся: {bool(back)}", required=False)


def type_into(field_label, text):
    """Вводит текст в поле: сначала очищает его сочетанием Ctrl+A и удалением."""
    field = find(screen(), field_label, exact=False)
    if not field:
        return False
    tap(field)
    shell("input keycombination 113 29", check=False)
    shell("input keyevent 67", check=False)
    shell(f"input text '{text}'")
    return True


def catalog_checks():
    """Поиск российского исполнителя через каталог, фрагмент и ссылка SoundCloud. Нужен доступ к этим сервисам из сети GitHub."""
    tab = wait("Поиск", 20)
    if not tab:
        record("Каталог находит российских исполнителей", False, "нет раздела Поиск", required=False)
        return
    tap(tab)
    typed = type_into("Песня, исполнитель или ссылка", "Morgenshtern")
    artist = wait("Исполнитель", 60, exact=False) if typed else None
    record("Подсказка «Слушать песни целиком» видна", find(screen(), "Подключить YouTube", exact=False), required=False)
    screenshot("07-search-catalog")
    record("Каталог находит российских исполнителей", artist, "", required=False)
    if not artist:
        soft_diagnostics()
    shell("input keyevent 66")  # кнопка «Найти» на клавиатуре прячет её, иначе строки под ней
    time.sleep(1)
    opened = scroll_to_part("Открыть исполнителя")
    if opened:
        tap(opened)
        page = wait("Популярное", 30)
        time.sleep(2)
        screenshot("08-artist")
        record("Страница исполнителя из каталога", page, required=False)
        shell("input keyevent KEYCODE_BACK")
        time.sleep(1.5)
    row = scroll_to_part(", фрагмент")
    if row:
        tap(row)
        ok, st = wait_session(is_playing, 30)
        record("Фрагмент из каталога играет", ok, json.dumps(st, ensure_ascii=False), required=False)
        shell("input keyevent KEYCODE_MEDIA_PAUSE")
    else:
        record("Фрагмент из каталога играет", False, "строка с фрагментом не найдена", required=False)
    w, h = size()
    for _ in range(3):  # обратно к полю поиска
        shell(f"input swipe {w // 2} {int(h * .3)} {w // 2} {int(h * .8)} 300")
        time.sleep(.6)
    if type_into("Morgenshtern", "https://soundcloud.com/forss/flickermood") or type_into("Песня, исполнитель или ссылка", "https://soundcloud.com/forss/flickermood"):
        row = wait(", SoundCloud", 40, exact=False)  # подпись строки трека: «Название, Автор, SoundCloud»
        record("SoundCloud по ссылке распознаётся", row, required=False)
        if row:
            shell("input keyevent 66")  # спрятать клавиатуру, иначе нажатие попадёт в её подсказки
            time.sleep(1)
            row = scroll_to_part(", SoundCloud") or row
            tap(row)
            embed = wait("плеер SoundCloud", 20, exact=False)
            time.sleep(15)
            screenshot("09-embed")
            record("Открывается встроенный плеер SoundCloud", embed, required=False)
            if not embed:
                soft_diagnostics()
            shell("input keyevent KEYCODE_BACK")
    time.sleep(1.5)
    profile = wait("Профиль", 20)
    if profile:
        tap(profile)
        diag = scroll_to("Диагностика источников")
        if diag:
            tap(diag)
            ok = wait("Источники", 20)
            time.sleep(1)
            screenshot("10-diagnostics")
            record("Открывается диагностика источников", ok, required=False)
            row = scroll_to_part("Openverse")
            time.sleep(1)
            screenshot("10b-diagnostics-open")
            record("В диагностике есть Openverse с выключателем", row, required=False)


def print_images():
    """Уменьшенные снимки в журнале сборки: их можно посмотреть без скачивания отчёта."""
    for path in sorted(glob.glob(f"{out}/*.png")):
        small = path[:-4] + ".small.jpg"
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-vf", "scale=300:-2", "-q:v", "7", small], check=False)
        if r.returncode == 0:
            print(f"##IMG {os.path.basename(path)} {base64.b64encode(open(small, 'rb').read()).decode()}", flush=True)
            os.remove(small)


def soft_diagnostics():
    """Сведения для необязательных проверок: что было на экране и что писало приложение."""
    print("--- Тексты на экране:", json.dumps([n["text"] or n["desc"] for n in screen() if n["text"] or n["desc"]][:50], ensure_ascii=False), flush=True)
    for line in adb("logcat", "-d", "-s", "ReactNativeJS:*", check=False, timeout=60).splitlines()[-25:]:
        print("JS>", line[:400], flush=True)


def diagnostics():
    print("--- Тексты на экранах:", json.dumps(seen_texts[-60:], ensure_ascii=False), flush=True)
    print("--- Аудио в медиатеке:", shell("content query --uri content://media/external/audio/media --projection _display_name:title:artist", check=False)[:800], flush=True)
    print("--- Разрешения:", " ".join(re.findall(r"android\.permission\.READ_MEDIA_AUDIO: granted=\w+", shell(f"dumpsys package {PACKAGE}", check=False))), flush=True)
    for line in adb("logcat", "-d", "-s", "ReactNativeJS:*", check=False, timeout=60).splitlines()[-30:]:
        print("JS>", line[:300], flush=True)


def finish(error=None):
    crash = adb("logcat", "-d", "-b", "crash", check=False)
    full = adb("logcat", "-d", "-t", "4000", check=False, timeout=60)
    open(f"{out}/logcat.txt", "w").write(full)
    open(f"{out}/crash.txt", "w").write(crash)
    has_crash = PACKAGE in crash and "FATAL EXCEPTION" in crash
    js = [l for l in full.splitlines() if " E ReactNativeJS" in l]
    results.append({"name": "Падений приложения нет", "ok": not has_crash, "detail": "см. crash.txt" if has_crash else "", "required": True})
    results.append({"name": "Ошибок JavaScript нет", "ok": not js, "detail": js[0][:200] if js else "", "required": True})
    screenshot("99-last")
    if error or any(r["required"] and not r["ok"] for r in results):
        diagnostics()
    print_images()
    failed = [r for r in results if r["required"] and not r["ok"]]
    lines = ["## Проверка на эмуляторе Android", ""]
    for r in results:
        mark = "✅" if r["ok"] else "❌" if r["required"] else "⚠️"
        lines.append(f"- {mark} {r['name']}" + (f" ({r['detail'][:160]})" if r["detail"] and not r["ok"] else ""))
    if error:
        lines += ["", f"Сценарий остановлен: {error}"]
    open(f"{out}/summary.md", "w").write("\n".join(lines) + "\n")
    json.dump(results, open(f"{out}/results.json", "w"), ensure_ascii=False, indent=2)
    return 1 if failed or error else 0


if __name__ == "__main__":
    problem = None
    try:
        scenario()
    except Exception as e:  # отчёт нужен и при сбое
        problem = f"{type(e).__name__}: {e}"
        print(problem, flush=True)
    sys.exit(finish(problem))
