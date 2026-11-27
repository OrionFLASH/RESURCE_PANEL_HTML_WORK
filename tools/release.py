#!/usr/bin/env python3
"""Выпуск релиза: обновляет версию/дату в panel-v8/version.js и пересобирает папку release/.

В release/ попадает только то, что нужно для работы панели (без тестов, docs, mockups, admin-README и т.п.).
Использование:  python3 tools/release.py [--version X.Y.Z] [--date YYYY-MM-DD]
Без --version версия берётся из panel-v8/version.js (дата по умолчанию — сегодня).
Только стандартная библиотека Python.
"""
import argparse
import datetime
import os
import re
import shutil
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "panel-v8"
DST = ROOT / "release"
DESIGN = ROOT / "concepts" / "resource-panel"
ASSETS = {
    "panel.css": SRC / "panel.css",
    "panel.js": SRC / "panel.js",
    "links.js": SRC / "release-links.js",
    **{name: DESIGN / name for name in (
        "concepts.css", "directions.css", "variations.css", "relief.css",
        "concepts.js", "editor-pages.js",
    )},
}
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
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        sys.exit("дата должна быть вида YYYY-MM-DD")
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        sys.exit("указана недопустимая дата")
    version_text = text[:m.start()] + f'version: "{version}", date: "{date}"' + text[m.end():]

    index = (DESIGN / "index.html").read_text(encoding="utf-8")
    if '<body class="prototype' not in index:
        sys.exit("в шаблоне не найдено место для атрибута data-edition")
    index = index.replace('<body class="prototype', '<body data-edition="production" class="prototype', 1)
    index = index.replace("../../release/", "")

    DST.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=DST.parent) as tmp:
        stage = Path(tmp)
        for name, source in ASSETS.items():
            shutil.copyfile(source, stage / name)
        (stage / "index.html").write_text(index, encoding="utf-8")
        (stage / "version.js").write_text(version_text, encoding="utf-8")
        (stage / "README.txt").write_text(
            f"Ресурсная панель v{version} ({date})\n"
            "Откройте index.html в браузере. Для переноса скопируйте всю папку.\n"
            "Ссылки можно редактировать в настройках панели и выгружать в links.js.\n",
            encoding="utf-8",
        )
        for file in stage.iterdir():
            os.replace(file, DST / file.name)
    if text != version_text:
        vf.write_text(version_text, encoding="utf-8")
    print(f"release/ собран: v{version}, {date} ({len(ASSETS) + 3} файлов)")


if __name__ == "__main__":
    main()
