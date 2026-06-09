#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Синхронизация POST/*.txt из исходников (index.html, JS/*.js)."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POST = ROOT / "POST"
JS_DIR = ROOT / "JS"
INDEX = ROOT / "index.html"


def main() -> None:
    if not INDEX.is_file():
        raise SystemExit(f"Нет файла: {INDEX}")
    POST.mkdir(exist_ok=True)
    (POST / "JS").mkdir(exist_ok=True)

    dst_index = POST / "index.html.txt"
    shutil.copy2(INDEX, dst_index)
    print(f"✓ {dst_index.relative_to(ROOT)}")

    count = 0
    for src in sorted(JS_DIR.glob("*.js")):
        dst = POST / "JS" / f"{src.name}.txt"
        shutil.copy2(src, dst)
        print(f"✓ {dst.relative_to(ROOT)}")
        count += 1

    print(f"✅ POST обновлён: index.html.txt + {count} файлов JS/")


if __name__ == "__main__":
    main()
