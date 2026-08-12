#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сборка POST/RESURCE_PANEL_HTML_WORK — рабочий набор без тестов и утилит.

Расширения файлов не меняются. Перед копированием каталог POST очищается.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POST = ROOT / "POST"
PROJECT_NAME = "RESURCE_PANEL_HTML_WORK"
DEST = POST / PROJECT_NAME

# Корневые файлы программы
ROOT_FILES = (
    "index.html",
    "sum-distribution.html",
    "contest-criteria.html",
    "README.md",
    "ROADMAP.md",
    "ROADMAP_CONTEST.md",
    ".env.example",
    ".gitignore",
)

# Основная документация в Docs/ (без рекомендаций и локальных выгрузок)
DOC_FILES = (
    "CONTEST_CRITERIA.md",
    "FILE_STATS_EXPORT.md",
    "ANALYSIS_METRICS.md",
    "TASK_SUM_DISTRIBUTION_UI.md",
    "tz_metrics_charts.md",
)

# Рабочий JS страниц (без src/Tests)
SRC_FILES = (
    "contest_interest.js",
    "csv_encoding.js",
)

SRC_CONTEST_FILES = (
    "config.js",
    "app.js",
)


def copy_file(src: Path, dst: Path) -> None:
    if not src.is_file():
        raise SystemExit(f"Нет файла: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"✓ {dst.relative_to(ROOT)}")


def main() -> None:
    if POST.exists():
        shutil.rmtree(POST)
    DEST.mkdir(parents=True)

    for name in ROOT_FILES:
        copy_file(ROOT / name, DEST / name)

    for name in DOC_FILES:
        copy_file(ROOT / "Docs" / name, DEST / "Docs" / name)

    copy_file(ROOT / "css" / "contest-criteria.css", DEST / "css" / "contest-criteria.css")

    for name in SRC_FILES:
        copy_file(ROOT / "src" / name, DEST / "src" / name)

    for name in SRC_CONTEST_FILES:
        copy_file(
            ROOT / "src" / "contest_criteria" / name,
            DEST / "src" / "contest_criteria" / name,
        )

    js_dir = ROOT / "JS"
    if not js_dir.is_dir():
        raise SystemExit(f"Нет каталога: {js_dir}")
    for src in sorted(js_dir.glob("*.js")):
        copy_file(src, DEST / "JS" / src.name)

    print(f"✅ POST собран: {DEST.relative_to(ROOT)}")
    print("   (без tests/, tools/, samples/, превью и утилит)")


if __name__ == "__main__":
    main()
