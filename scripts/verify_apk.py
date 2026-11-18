#!/usr/bin/env python3
"""Проверяет, что собранный APK действительно содержит приложение. При любой проблеме завершается с ошибкой."""
import glob
import os
import subprocess
import sys
import zipfile

HERMES_MAGIC = bytes.fromhex("c61fbc03c103191f")
PACKAGE = "app.kamerton.player"


def tool(name):
    home = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    found = sorted(glob.glob(f"{home}/build-tools/*/{name}")) if home else []
    return found[-1] if found else None


def check_contents(path, abis):
    if not os.path.isfile(path):
        raise SystemExit(f"APK не найден: {path}")
    size = os.path.getsize(path)
    if size < 10_000_000:
        raise SystemExit(f"APK подозрительно мал: {size} байт")
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f"Повреждён файл внутри APK: {bad}")
        names = set(z.namelist())
        if "assets/index.android.bundle" not in names:
            raise SystemExit("В APK нет кода приложения (assets/index.android.bundle)")
        with z.open("assets/index.android.bundle") as f:
            if f.read(8) != HERMES_MAGIC:
                raise SystemExit("Код приложения не скомпилирован в байткод Hermes")
        for abi in abis:
            libs = {n.rsplit("/", 1)[1] for n in names if n.startswith(f"lib/{abi}/") and n.endswith(".so")}
            if "libreactnative.so" not in libs or not any("hermes" in l for l in libs):
                raise SystemExit(f"Нет библиотек React Native или Hermes для {abi}")
    return size


def main():
    path, abis = sys.argv[1], [a for a in sys.argv[2].split(",") if a]
    size = check_contents(path, abis)
    lines = ["## APK собран", "", f"- Файл: `{os.path.basename(path)}`", f"- Размер: {size / 1_048_576:.1f} МБ", f"- Процессоры: {', '.join(abis)}"]
    aapt = tool("aapt2")
    if aapt:
        badging = subprocess.run([aapt, "dump", "badging", path], check=True, capture_output=True, text=True).stdout
        if f"package: name='{PACKAGE}'" not in badging:
            raise SystemExit("В APK другой идентификатор приложения")
        lines.append(f"- Приложение: `{PACKAGE}`")
    signer = tool("apksigner")
    if signer:
        subprocess.run([signer, "verify", path], check=True)
        lines.append("- Подпись: действительна (отладочный ключ)")
    print("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
