"""Сквозная проверка интерфейса в браузере на веб-сборке.

Все ответы музыкальных сервисов здесь ПОДМЕНЕНЫ тестовыми данными: в приложение они не входят.
Проверяется настоящий код адаптеров, базы, плеера и экранов.
Запуск: python3 scripts/e2e_web.py <папка веб-сборки> <папка скриншотов>
"""
import functools, hashlib, http.server, io, json, os, re, subprocess, sys, tempfile, threading
from urllib.parse import urlparse, parse_qs
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

DIST, SHOTS = sys.argv[1], sys.argv[2]
os.makedirs(SHOTS, exist_ok=True)

ARTISTS = [("Северный Вокзал", "shoegaze", "Melancholy"), ("Тихая Вода", "ambient", "Peaceful"), ("Кассета 86", "post-rock", "Brooding"), ("Lumen Field", "shoegaze", "Dreamy"), ("Ночной Трамвай", "indie", "Yearning"), ("Pale Harbor", "ambient", "Peaceful"), ("Дом Культуры", "post-rock", "Fiery"), ("Vera Static", "electronic", "Energizing")]
TITLES = ["Последняя электричка", "Снег над заводом", "Medium Wave", "Окна напротив", "Slow Signal", "Пустой перрон", "Afterglow", "Гудок в тумане", "Northern Line", "Комната с видом"]

def track(i):
    a, g, mood = ARTISTS[i % len(ARTISTS)]
    t = TITLES[i % len(TITLES)]
    title = t if i < 20 else f"{t} II"
    if i == 3: title += " (Clean)"
    return {"id": f"t{i}", "title": title, "duration": 150 + i * 7, "genre": g, "mood": mood, "tags": "tape,night", "isrc": f"RUTEST{i:06d}" if i % 3 == 0 else None, "bpm": 80 + i * 4,
            "parental_warning_type": "Explicit" if i % 5 == 0 else None, "is_streamable": True, "is_stream_gated": False, "is_available": True, "is_delete": False, "access": {"stream": True},
            "preview": None, "permalink": f"/a/t{i}", "remix_of": {"tracks": []}, "cover_original_song_title": None, "release_date": "2026-10-02T10:00:00Z" if i % 4 == 0 else "2019-03-01T10:00:00Z", "play_count": 9000 - i * 250,
            "user": {"id": f"u{i % 8}", "name": a, "handle": f"h{i % 8}"}, "artwork": {"150x150": f"https://cdn.test/c{i % 10}.png", "480x480": f"https://cdn.test/c{i % 10}.png"}}
TRACKS = [track(i) for i in range(32)]

ARCHIVE = {"metadata": {"identifier": "show1", "title": "Концерт в ДК, 1994", "creator": "Кассета 86", "date": "1994-05-01", "subject": "post-rock; live", "licenseurl": "https://creativecommons.org/licenses/by-nc/3.0/"},
           "files": [{"name": "t01.flac", "format": "Flac", "source": "original", "title": "Вступление", "track": "1", "length": "180"}, {"name": "t01.mp3", "format": "VBR MP3", "source": "derivative"}, {"name": "t02.flac", "format": "Flac", "source": "original", "title": "Снег над заводом", "track": "2", "length": "204"}, {"name": "t02.mp3", "format": "VBR MP3", "source": "derivative"}]}
STATIONS = [{"stationuuid": f"s{i}", "name": n, "url_resolved": "https://stream.test/radio.wav", "favicon": "", "tags": "rock,indie", "country": "Россия", "codec": "MP3", "bitrate": 128, "lastcheckok": 1, "clickcount": 10 - i} for i, n in enumerate(["Радио Ноль", "Волна 101", "Ночной эфир"])]

def wav():
    p = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-ar", "8000", "-ac", "1", p], check=True)
    return open(p, "rb").read()
WAV = wav()

def cover(key):
    h = hashlib.md5(key.encode()).digest()
    palette = [(214, 92, 74), (55, 92, 140), (222, 189, 104), (120, 72, 110), (70, 140, 120), (30, 40, 60), (200, 200, 190)]
    bg, fg, ac = palette[h[0] % 7], palette[h[1] % 7], palette[h[2] % 7]
    im = Image.new("RGB", (480, 480), bg); d = ImageDraw.Draw(im)
    for i in range(3 + h[3] % 4):
        x, y, r = h[(4 + i) % 16] * 2, h[(8 + i) % 16] * 2, 50 + h[(12 + i) % 16]
        d.ellipse([x - r, y - r, x + r, y + r], fill=fg if i % 2 else ac)
    d.rectangle([0, 340 + h[5] % 60, 480, 480], fill=fg)
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()

class Spa(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if not os.path.exists(self.translate_path(path)) or path == "/": self.path = "/index.html"
        super().do_GET()
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(Spa, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()
requests = []

def respond(route):
    url = route.request.url; u = urlparse(url); q = parse_qs(u.query); requests.append(url)
    cors = {"Access-Control-Allow-Origin": "*"}
    js = lambda o: route.fulfill(status=200, headers={**cors, "Content-Type": "application/json"}, body=json.dumps(o, ensure_ascii=False))
    if "/stream" in u.path or u.netloc in ("stream.test",) or "/download/" in u.path: return route.fulfill(status=200, headers={**cors, "Content-Type": "audio/wav", "Accept-Ranges": "none"}, body=WAV)
    if u.netloc == "cdn.test": return route.fulfill(status=200, headers={**cors, "Content-Type": "image/png"}, body=cover(u.path))
    if "archive.org" in u.netloc:
        if "/services/img" in u.path: return route.fulfill(status=200, headers={**cors, "Content-Type": "image/png"}, body=cover("archive"))
        if "advancedsearch" in u.path: return js({"response": {"docs": [{"identifier": "show1"}]}})
        if "/metadata/" in u.path: return js(ARCHIVE)
    if "radio-browser" in u.netloc:
        if u.path.endswith("/servers"): return js([{"name": "x1.api.radio-browser.info"}])
        if "/json/url/" in u.path: return js({"ok": True})
        return js(STATIONS)
    if "musicbrainz.org" in u.netloc:
        text = q.get("query", [""])[0]
        if "/recording" in u.path and "Снег над заводом" in text: return js({"recordings": [{"id": "mb-1", "title": "Снег над заводом", "score": 100, "length": 157000, "isrcs": ["RUTEST000001"], "artist-credit": [{"name": "Тихая Вода"}], "tags": [{"name": "ambient", "count": 2}]}]})
        return js({"recordings": [], "artists": [], "release-groups": []})
    if "listenbrainz" in u.netloc: return js([])
    if "api.audius.co" in u.netloc:
        s = q.get("query", [""])[0].lower()
        if "users/search" in u.path: return js({"data": [{"id": f"u{i}", "name": a[0]} for i, a in enumerate(ARTISTS) if s and s in a[0].lower()]})
        if "playlists/search" in u.path: return js({"data": []})
        if "/users/" in u.path: return js({"data": [t for t in TRACKS if t["user"]["id"] == u.path.split("/")[3]]})
        if "tracks/search" in u.path:
            words = [w for w in re.split(r"\s+", s) if w]
            hits = [t for t in TRACKS if any(w in f"{t['title']} {t['user']['name']} {t['genre']}".lower() for w in words)] or TRACKS[:0]
            return js({"data": hits[:12]})
        return js({"data": TRACKS})
    return route.fulfill(status=404, headers=cors, body="{}")

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = b.new_context(viewport={"width": 412, "height": 892}, device_scale_factor=2, has_touch=True, color_scheme="dark", locale="ru-RU")
        page = ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "404" not in m.text and "Failed to load resource" not in m.text else None)
        ctx.route(re.compile(r"^https?://(?!127\.0\.0\.1)"), respond)
        shot = lambda n: page.screenshot(path=f"{SHOTS}/{n}.png")
        tid = lambda n: page.locator(f'[data-testid="{n}"]:visible').first
        audio = lambda: page.evaluate("Array.from(document.querySelectorAll('audio')).length")

        def fail_dump():
            shot("zz-fail"); print("URL:", page.url); print("ERRORS:", *[e[:400] for e in errors[:8]], sep="\n  ")
        page.goto("http://127.0.0.1:8765/")
        page.set_default_timeout(12000)
        try: flow(page, shot, tid, errors, requests)
        except Exception: fail_dump(); raise
        b.close()

def flow(page, shot, tid, errors, requests):
    if True:
        tid("onboarding-done").wait_for(timeout=30000); shot("01-onboarding")
        for g in ["shoegaze", "ambient", "post-rock"]: tid(f"genre-{g}").click()
        page.wait_for_timeout(200); shot("02-onboarding-selected"); tid("onboarding-done").click()
        page.get_by_text("Дальше в волне").wait_for(timeout=30000); page.wait_for_timeout(800); shot("03-home")
        expect(page.get_by_text("Открытия дня").first).to_be_visible()

        tid("wave-play").click(); tid("mini-player").wait_for(timeout=15000); page.wait_for_timeout(1500)
        title1 = tid("mini-player").inner_text(); shot("04-home-playing")
        tid("mini-player").click(); tid("player-toggle").wait_for(timeout=8000); page.wait_for_timeout(2600); shot("05-player")
        page.get_by_text(re.compile(r"^0:0[1-9]$")).first.wait_for(timeout=9000); pos = True  # позиция реально идёт
        tid("player-like").click(); page.wait_for_timeout(300)
        tid("more-like").click(); page.wait_for_timeout(300)
        tid("player-queue").click(); page.get_by_text("Умный DJ").wait_for(timeout=5000); tid("dj-smooth").click(); page.wait_for_timeout(600); shot("06-queue-dj")
        page.go_back(); tid("player-next").wait_for(); page.wait_for_timeout(2500); tid("player-next").click(); page.wait_for_timeout(1200)
        shot("07-player-next"); tid("player-lyrics").click(); page.get_by_text("Текста нет").wait_for(timeout=5000); shot("08-no-lyrics"); page.go_back()
        tid("player-close").wait_for(); tid("player-close").click(); tid("tab-search").wait_for()
        title2 = tid("mini-player").inner_text(); assert title1 != title2, "следующий трек не включился"

        tid("tab-search").click(); tid("search-input").fill("снег над"); page.get_by_text("Композиции").wait_for(timeout=8000); page.wait_for_timeout(600); shot("09-search")
        expect(page.get_by_text("Яндекс Музыка", exact=True).first).to_be_visible()
        tid("tab-library").click(); tid("open-import").wait_for(); shot("10-library"); tid("open-import").click()
        tid("import-text").fill("Тихая Вода - Снег над заводом\nСеверный Вокзал - Последняя электричка (Remix)\nНикто - Несуществующая песня"); tid("import-text-go").click()
        tid("import-save").wait_for(timeout=30000); page.wait_for_timeout(300); shot("11-import-review"); tid("import-save").click()
        tid("playlist-play").wait_for(timeout=8000); expect(page.get_by_text("Несуществующая песня", exact=True).last).to_be_visible(); shot("12-playlist"); tid("playlist-play").click(); page.wait_for_timeout(600)
        page.goto("http://127.0.0.1:8765/portrait") if False else None
        page.go_back(); page.wait_for_timeout(300)
        page.go_back(); page.wait_for_timeout(300)
        tid("tab-profile").click(); tid("open-portrait").wait_for(); page.wait_for_timeout(400); shot("13-profile"); tid("open-portrait").click(); page.get_by_text("Ваш звук").wait_for(timeout=8000); page.wait_for_timeout(400); shot("14-portrait"); page.go_back()
        tid("open-sources").click(); tid("source-yandex").wait_for(); shot("15-sources"); tid("source-yandex").click(); page.get_by_text("Официального публичного API нет", exact=False).wait_for(); shot("16-source-yandex"); page.go_back(); page.wait_for_timeout(300); page.go_back()
        tid("open-settings").click(); page.get_by_text("Светлая", exact=True).click(); page.wait_for_timeout(300); shot("17-settings-light"); page.go_back(); tid("tab-index").click(); page.wait_for_timeout(600); shot("18-home-light")
        assert pos is not None
        real = [e for e in errors if "Warning" not in e and "shadow" not in e.lower() and "pointerEvents" not in e]
        print("запросов к API:", len(requests), "| ошибок консоли:", len(real))
        for e in real[:15]: print("  ", e[:300])
        streams = [r for r in requests if "/stream" in r]; print("запрошено потоков:", len(streams))
        assert streams, "поток не запрашивался"; assert not real
main(); print("E2E OK")
