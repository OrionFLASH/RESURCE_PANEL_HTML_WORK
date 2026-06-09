#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Синхронизация JS/ → встроенные блоки в index.html (file://, без HTTP-сервера).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
JS_DIR = ROOT / "JS"

SCRIPT_FILES = [
    "AddressBook_export_OE.js",
    "File_DB_Load_GP_v2.js",
    "News_Community_Export.js",
    "Parameters_Actual_Export.js",
    "Profile_GP_LOAD_file.js",
    "Tournament_LeadersForAdmin.js",
    "UI_AutoTest.js",
    "UI_AutoTest_LinksCrawler.js",
]

MARKER_START = "<!-- EMBEDDED_SCRIPTS_START -->"
MARKER_END = "<!-- EMBEDDED_SCRIPTS_END -->"

# Старый формат (один JSON-тег) — удаляем при миграции
LEGACY_JSON_PATTERN = re.compile(
    r'<script type="application/json" id="embedded-scripts-json">.*?</script>\s*',
    re.DOTALL,
)

BLOCK_PATTERN = re.compile(
    re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END),
    re.DOTALL,
)


def escape_script_body(text: str) -> str:
    """Экранирование </script>, чтобы HTML-парсер не обрезал блок."""
    return re.sub(r"</script>", r"<\\/script>", text, flags=re.IGNORECASE)


def build_embed_block(scripts: dict[str, str]) -> str:
    parts = [MARKER_START]
    for name in SCRIPT_FILES:
        if name not in scripts:
            continue
        body = escape_script_body(scripts[name])
        parts.append(
            f'<script type="text/plain" class="embedded-script" '
            f'data-script-file="{name}">\n{body}\n</script>'
        )
    parts.append(MARKER_END)
    return "\n".join(parts)


def load_scripts() -> dict[str, str]:
    data: dict[str, str] = {}
    for name in SCRIPT_FILES:
        path = JS_DIR / name
        if not path.is_file():
            print(f"⚠️  Пропуск (нет файла): {path}", file=sys.stderr)
            continue
        data[name] = path.read_text(encoding="utf-8")
        print(f"✓ {name} ({path.stat().st_size} байт)")
    return data


def ensure_markers(html: str) -> str:
    if MARKER_START in html and MARKER_END in html:
        return html
    header = (
        "<!-- Резервные копии скриптов для file:// "
        "(синхронизация: python3 tools/embed_scripts.py) -->\n"
        f"{MARKER_START}\n{MARKER_END}\n\n"
    )
    html = LEGACY_JSON_PATTERN.sub("", html)
    html = re.sub(
        r"<!-- Резервные копии скриптов.*?\n",
        header,
        html,
        count=1,
    )
    if MARKER_START not in html:
        raise SystemExit("Не найдены маркеры EMBEDDED_SCRIPTS в index.html")
    return html


def embed_into_html(payload: dict[str, str]) -> None:
    html = INDEX.read_text(encoding="utf-8")
    html = ensure_markers(html)
    html = LEGACY_JSON_PATTERN.sub("", html)
    block = build_embed_block(payload)
    match = BLOCK_PATTERN.search(html)
    if not match:
        raise SystemExit("Не найден блок EMBEDDED_SCRIPTS в index.html")
    html = html[: match.start()] + block + html[match.end() :]
    INDEX.write_text(html, encoding="utf-8")
    total = sum(len(v) for v in payload.values())
    print(f"✅ Встроено {len(payload)} скриптов в {INDEX} ({total} символов исходного кода)")


def main() -> None:
    if not INDEX.is_file():
        raise SystemExit(f"Нет файла: {INDEX}")
    payload = load_scripts()
    if not payload:
        raise SystemExit("Нет скриптов для встраивания")
    embed_into_html(payload)


if __name__ == "__main__":
    main()
