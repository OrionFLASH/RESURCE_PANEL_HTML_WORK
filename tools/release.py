#!/usr/bin/env python3
"""Выпуск релиза: обновляет версию/дату в panel-v8/version.js и пересобирает папку release/.

В release/ попадает только то, что нужно для работы панели (без тестов, docs, mockups, admin-README и т.п.).
Использование:  python3 tools/release.py [--version X.Y.Z] [--date YYYY-MM-DD]
Без --version версия берётся из panel-v8/version.js (дата по умолчанию — сегодня).
Только стандартная библиотека Python.
"""
import argparse
import datetime
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "panel-v8"
DST = ROOT / "release"
FILES = ["index.html", "panel.css", "panel.js", "links.js", "version.js"]
VERSION_RE = re.compile(r'version:\s*"([^"]+)",\s*date:\s*"([^"]+)"')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--version")
    ap.add_argument("--date")
    a = ap.parse_args()
    vf = SRC / "version.js"
    text = vf.read_text(encoding="utf-8")
    m = VERSION_RE.search(text)
    if not m:
        sys.exit("version.js: не найдены version/date")
    version = a.version or m.group(1)
    date = a.date or datetime.date.today().isoformat()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        sys.exit("версия должна быть вида X.Y.Z")
    vf.write_text(text[:m.start()] + 'version: "%s", date: "%s"' % (version, date) + text[m.end():], encoding="utf-8")

    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir()
    for f in FILES:
        shutil.copy2(SRC / f, DST / f)
    (DST / "README.txt").write_text(
        "Ресурсная панель v%s (%s)\nОткройте index.html в браузере. Ссылки правятся в links.js.\n" % (version, date),
        encoding="utf-8")
    print("release/ собран: v%s, %s (%d файлов)" % (version, date, len(FILES) + 1))


if __name__ == "__main__":
    main()
