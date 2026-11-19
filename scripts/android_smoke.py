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
    rows = [n for n in (find(nodes, FIRST), find(nodes, SECOND)) if n]
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
    tap(wait(target, 20, exact=False), "другой трек в списке")
    ok, st = wait_session(lambda s: is_playing(s) and target in s["title"], 20)
    time.sleep(2)
    now_playing = [s for s in sessions() if is_playing(s)]
    record("Новая очередь заменяет старую, звучит один трек", ok and len(now_playing) == 1, json.dumps(now_playing, ensure_ascii=False))

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
    record("Волна играет из интернета", ok, json.dumps(st, ensure_ascii=False), required=False)


def print_images():
    """Уменьшенные снимки в журнале сборки: их можно посмотреть без скачивания отчёта."""
    for path in sorted(glob.glob(f"{out}/*.png")):
        small = path[:-4] + ".small.jpg"
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-vf", "scale=300:-2", "-q:v", "7", small], check=False)
        if r.returncode == 0:
            print(f"##IMG {os.path.basename(path)} {base64.b64encode(open(small, 'rb').read()).decode()}", flush=True)
            os.remove(small)


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
