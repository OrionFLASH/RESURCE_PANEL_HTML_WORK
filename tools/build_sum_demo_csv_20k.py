#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Синтетический демо-CSV для sum-distribution.html:
  20_000 строк, 2_000 уникальных ТН, повторы ТН от 1 до 50, разные суммы.

Файл пишется в samples/ (каталог в .gitignore — не коммитить).

Запуск из корня RESURCE_PANEL_HTML_WORK:
  python3 tools/build_sum_demo_csv_20k.py
"""
from __future__ import annotations

import csv
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "samples" / "sum-distribution-demo-20000.csv"

N_ROWS = 20_000
N_UNIQUE_TN = 2_000
MIN_REPEATS = 1
MAX_REPEATS = 50
SEED = 20260810

# Синтетический справочник ТБ / ГОСБ / кластер (без зависимости от IN/)
TB_POOL: list[tuple[str, list[tuple[str, str]]]] = [
    ("Московский банк", [
        ("Управление МБ по работе с предприятиями торговли", "1"),
        ("Управление МБ по работе с предприятиями транспорта", "1"),
        ("Управление МБ по работе с предприятиями сферы недвижимости", "2"),
    ]),
    ("Северо-Западный банк", [
        ("ГО по Санкт-Петербургу", "1"),
        ("Калининградское ГОСБ", "3"),
        ("Мурманское ГОСБ", "2"),
        ("Новгородское ГОСБ", "4"),
    ]),
    ("Юго-Западный банк", [
        ("Краснодарское ГОСБ", "1"),
        ("Ростовское ГОСБ", "1"),
        ("Ставропольское ГОСБ", "1"),
        ("ГО по Республике Крым", "5"),
    ]),
    ("Сибирский банк", [
        ("Новосибирское ГОСБ", "1"),
        ("Алтайское ГОСБ", "2"),
    ]),
    ("Поволжский банк", [
        ("Самарское ГОСБ", "1"),
        ("Аппарат Поволжского банка", "1"),
    ]),
    ("Среднерусский банк", [
        ("Рязанское ГОСБ", "3"),
        ("Брянское ГОСБ", "3"),
        ("Южное ГОСБ", "1"),
    ]),
    ("Волго-Вятский банк", [
        ("Банк Татарстан ГОСБ", "1"),
        ("Владимирское ГОСБ", "3"),
        ("ГО по Нижегородской области", "1"),
    ]),
    ("Уральский банк", [
        ("Башкирское ГОСБ", "1"),
        ("Свердловское ГОСБ", "2"),
    ]),
]


def allocate_repeat_counts(rng: random.Random) -> list[int]:
    """
    Ровно N_UNIQUE_TN счётчиков в [MIN_REPEATS, MAX_REPEATS], сумма = N_ROWS.
    Сначала задаём целевое разнообразие (часть у минимума/максимума), затем добиваем сумму.
    """
    counts = [MIN_REPEATS] * N_UNIQUE_TN
    remaining = N_ROWS - N_UNIQUE_TN * MIN_REPEATS
    capacity = N_UNIQUE_TN * (MAX_REPEATS - MIN_REPEATS)
    if remaining < 0 or remaining > capacity:
        raise SystemExit(
            f"Нельзя распределить {N_ROWS} строк на {N_UNIQUE_TN} ТН "
            f"с повторами [{MIN_REPEATS}; {MAX_REPEATS}] (нужно ещё {remaining}, ёмкость {capacity})"
        )

    # Явно растянуть хвосты: ~5% около max, ~10% остаются с 1 (после старта)
    n_high = max(1, N_UNIQUE_TN // 20)
    high_idx = rng.sample(range(N_UNIQUE_TN), n_high)
    for i in high_idx:
        add = min(MAX_REPEATS - counts[i], remaining, rng.randint(30, MAX_REPEATS - MIN_REPEATS))
        counts[i] += add
        remaining -= add

    # Остальное — взвешенно (чаще средние значения)
    while remaining > 0:
        i = rng.randrange(N_UNIQUE_TN)
        if counts[i] >= MAX_REPEATS:
            continue
        # чаще +1, иногда скачок до 5
        step = 1 if rng.random() < 0.85 else min(5, MAX_REPEATS - counts[i], remaining)
        counts[i] += step
        remaining -= step
    return counts


def make_tn(index: int) -> str:
    """Уникальный ТН 20 цифр (синтетический, не из прод)."""
    return f"{index + 1:020d}"


def pick_org(rng: random.Random) -> tuple[str, str, str]:
    tb_name, gosbs = rng.choice(TB_POOL)
    gosb_name, cluster = rng.choice(gosbs)
    return tb_name, gosb_name, cluster


def make_amount(rng: random.Random) -> int:
    """Разные суммы: отрицательные / ноль / положительные."""
    roll = rng.random()
    if roll < 0.08:
        return rng.randint(-5_000_000, -1)
    if roll < 0.12:
        return 0
    # чаще умеренные суммы, иногда крупные
    if roll < 0.85:
        return rng.randint(1, 5_000_000)
    return rng.randint(5_000_001, 80_000_000)


def main() -> None:
    rng = random.Random(SEED)
    counts = allocate_repeat_counts(rng)
    assert sum(counts) == N_ROWS
    assert len(counts) == N_UNIQUE_TN
    assert MIN_REPEATS <= min(counts) <= max(counts) <= MAX_REPEATS

    # Профиль ТБ/ГОСБ/кластер фиксируется на ТН (как после агрегации в UI)
    profiles: list[tuple[str, str, str]] = [pick_org(rng) for _ in range(N_UNIQUE_TN)]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";", lineterminator="\n")
        w.writerow(["ТН", "ТБ", "ГОСБ", "кластер", "сумма"])
        for i, n_rep in enumerate(counts):
            tn = make_tn(i)
            tb, gosb, cluster = profiles[i]
            for _ in range(n_rep):
                w.writerow([tn, tb, gosb, cluster, make_amount(rng)])

    # Контроль
    from collections import Counter

    with OUT.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    tns = [r["ТН"] for r in rows]
    c = Counter(tns)
    print(f"Готово: {OUT}")
    print(f"  строк: {len(rows)} (ожид. {N_ROWS})")
    print(f"  уник. ТН: {len(c)} (ожид. {N_UNIQUE_TN})")
    print(f"  повторы: min={min(c.values())}, max={max(c.values())}, avg={sum(c.values())/len(c):.2f}")


if __name__ == "__main__":
    main()
