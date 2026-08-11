#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерация демо-CSV по экспорту «Статистика по файлу» (sum-distribution-file-stats/v1).

Идея:
  1) Уникальные ТН и оргсвязи — из links.tb_gosb_cluster (как в проде).
  2) Целевая сумма каждого ТН (после SUM) — знаки и sum_pos/sum_neg по каждому ТБ.
  3) Цель разбивается на несколько сырых строк с разными суммами
     (шум с компенсацией); после агрегации по ТН картина близка к профилю.

Запуск из корня RESURCE_PANEL_HTML_WORK:

  python3 tools/build_sum_demo_from_file_stats.py \\
    --stats "Docs/пром стата/sum_file_stats_20260811_1801.json" \\
    --out samples/sum-distribution-demo-prod-stalo.csv \\
    --seed 20260811

  python3 tools/build_sum_demo_from_file_stats.py \\
    --stats "Docs/пром стата/sum_file_stats_20260811_1801 (было).json" \\
    --out samples/sum-distribution-demo-prod-bylo.csv \\
    --seed 20260812

Число сырых строк: ~25 000 ± jitter (не ровно 25k, разное от файла к файлу).
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent


def quantile_interp(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    p = max(0.0, min(1.0, q))
    pos = (len(sorted_vals) - 1) * p
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(sorted_vals[lo])
    t = pos - lo
    return float(sorted_vals[lo] * (1 - t) + sorted_vals[hi] * t)


def make_tn(index: int) -> str:
    """Синтетический ТН 20 цифр (не из прода)."""
    return f"{index + 1:020d}"


def expand_employees(stats: dict[str, Any]) -> list[dict[str, str]]:
    """Один слот = один уникальный ТН с оргпривязкой из links."""
    employees: list[dict[str, str]] = []
    for link in stats["links"]["tb_gosb_cluster"]:
        n = int(link["tn_count"])
        tb = str(link["tb"])
        gosb = str(link["gosb"])
        cluster = str(link["cluster"])
        for _ in range(n):
            employees.append({"tb": tb, "gosb": gosb, "cluster": cluster})
    return employees


def assign_target_amounts(
    employees: list[dict[str, str]],
    stats: dict[str, Any],
    rng: random.Random,
) -> list[float]:
    """
    Целевые суммы после агрегации по ТН.
    Знаки — ровно по count_pos/neg/zero каждого ТБ.
    Величины — разнос sum_pos / sum_neg ТБ по ТН (gamma-веса).
    """
    by_tb = {x["name"]: x for x in stats["by_tb"]}
    n = len(employees)
    amounts = [0.0] * n

    idx_by_tb: dict[str, list[int]] = defaultdict(list)
    for i, emp in enumerate(employees):
        idx_by_tb[emp["tb"]].append(i)

    for tb_name, indices in idx_by_tb.items():
        st = by_tb.get(tb_name)
        rng.shuffle(indices)
        if not st:
            for i in indices:
                amounts[i] = 0.0
            continue

        n_pos = int(st["count_pos"])
        n_neg = int(st["count_neg"])
        n_zero = int(st["count_zero"])
        while n_pos + n_neg + n_zero > len(indices):
            if n_zero > 0:
                n_zero -= 1
            elif n_neg > 0:
                n_neg -= 1
            else:
                n_pos = max(0, n_pos - 1)
        while n_pos + n_neg + n_zero < len(indices):
            n_pos += 1

        slots = ["zero"] * n_zero + ["neg"] * n_neg + ["pos"] * n_pos
        rng.shuffle(slots)
        if len(slots) < len(indices):
            slots += ["pos"] * (len(indices) - len(slots))
        slots = slots[: len(indices)]

        pos_idx = [i for i, k in zip(indices, slots) if k == "pos"]
        neg_idx = [i for i, k in zip(indices, slots) if k == "neg"]
        zero_idx = [i for i, k in zip(indices, slots) if k == "zero"]

        for i in zero_idx:
            amounts[i] = 0.0

        target_pos = float(st["sum_pos"])
        target_neg = float(st["sum_neg"])

        if pos_idx:
            weights = []
            for _ in pos_idx:
                if rng.random() < 0.12:
                    weights.append(rng.gammavariate(0.45, 1.0) * 8.0)
                else:
                    weights.append(rng.gammavariate(1.4, 1.0))
            s = sum(weights) or 1.0
            raw = [max(0.01, target_pos * (w / s) * rng.uniform(0.92, 1.08)) for w in weights]
            s2 = sum(raw) or 1.0
            scale = (target_pos / s2) if abs(target_pos) > 1e-9 else 0.0
            for i, v in zip(pos_idx, raw):
                amounts[i] = round(v * scale, 2)
            amounts[pos_idx[-1]] = round(target_pos - sum(amounts[j] for j in pos_idx[:-1]), 2)

        if neg_idx:
            weights = []
            for _ in neg_idx:
                if rng.random() < 0.12:
                    weights.append(rng.gammavariate(0.45, 1.0) * 8.0)
                else:
                    weights.append(rng.gammavariate(1.4, 1.0))
            s = sum(weights) or 1.0
            raw = [max(0.01, abs(target_neg) * (w / s) * rng.uniform(0.92, 1.08)) for w in weights]
            s2 = sum(raw) or 1.0
            scale = (abs(target_neg) / s2) if abs(target_neg) > 1e-9 else 0.0
            for i, v in zip(neg_idx, raw):
                amounts[i] = -round(v * scale, 2)
            amounts[neg_idx[-1]] = round(target_neg - sum(amounts[j] for j in neg_idx[:-1]), 2)

    return amounts


def allocate_repeat_counts(
    n_tn: int,
    n_rows: int,
    rng: random.Random,
    min_rep: int = 1,
    max_rep: int = 60,
) -> list[int]:
    """Счётчики сырых строк на каждый ТН; сумма = n_rows."""
    if n_rows < n_tn * min_rep:
        raise SystemExit(f"Слишком мало строк ({n_rows}) для {n_tn} ТН")
    counts = [min_rep] * n_tn
    remaining = n_rows - n_tn * min_rep
    if remaining > n_tn * (max_rep - min_rep):
        max_rep = min_rep + math.ceil(remaining / n_tn) + 5

    n_high = max(1, n_tn // 18)
    for i in rng.sample(range(n_tn), n_high):
        add = min(max_rep - counts[i], remaining, rng.randint(20, max_rep - min_rep))
        counts[i] += add
        remaining -= add

    while remaining > 0:
        i = rng.randrange(n_tn)
        if counts[i] >= max_rep:
            continue
        step = 1 if rng.random() < 0.8 else min(6, max_rep - counts[i], remaining)
        counts[i] += step
        remaining -= step
    return counts


def split_target_to_rows(target: float, k: int, rng: random.Random) -> list[float]:
    """Разбить целевую сумму ТН на k сырых строк (сумма точно = target)."""
    if k <= 1:
        return [round(target, 2)]

    if abs(target) < 1e-9:
        if rng.random() < 0.35 or k == 2:
            return [0.0] * k
        amp = rng.uniform(8e4, 8e6)
        parts = [round(rng.uniform(-amp, amp), 2) for _ in range(k - 1)]
        parts.append(round(-sum(parts), 2))
        return parts

    weights = [rng.gammavariate(1.15, 1.0) for _ in range(k)]
    s = sum(weights) or 1.0
    parts = [target * (w / s) for w in weights]

    noise_rounds = max(1, k // 2)
    base_amp = abs(target) * rng.uniform(0.08, 0.55)
    for _ in range(noise_rounds):
        i, j = rng.sample(range(k), 2)
        noise = rng.uniform(0.15, 1.0) * base_amp * rng.choice([-1.0, 1.0])
        parts[i] += noise
        parts[j] -= noise

    head = [round(p, 2) for p in parts[:-1]]
    head.append(round(target - sum(head), 2))
    return head


def choose_row_count(n_tn: int, rng: random.Random, base: int = 25_000) -> int:
    """Не ровно 25k: jitter ±."""
    jitter = rng.randint(-1800, 3200)
    n_rows = base + jitter
    n_rows = max(n_rows, n_tn * 8, 22_000)
    n_rows = min(n_rows, n_tn * 55)
    return n_rows


def write_csv(
    out: Path,
    employees: list[dict[str, str]],
    targets: list[float],
    repeats: list[int],
    rng: random.Random,
) -> int:
    out.parent.mkdir(parents=True, exist_ok=True)
    n_rows = 0
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";", lineterminator="\n")
        w.writerow(["ТН", "ТБ", "ГОСБ", "кластер", "сумма"])
        for i, emp in enumerate(employees):
            tn = make_tn(i)
            parts = split_target_to_rows(targets[i], repeats[i], rng)
            for amt in parts:
                w.writerow([tn, emp["tb"], emp["gosb"], emp["cluster"], f"{amt:.2f}"])
                n_rows += 1
    return n_rows


def verify(out: Path, stats: dict[str, Any]) -> None:
    from collections import Counter

    with out.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    agg: dict[str, float] = defaultdict(float)
    meta: dict[str, tuple[str, str, str]] = {}
    for r in rows:
        tn = r["ТН"]
        agg[tn] += float(r["сумма"].replace(",", "."))
        meta[tn] = (r["ТБ"], r["ГОСБ"], r["кластер"])

    vals = list(agg.values())
    vals_sorted = sorted(vals)
    n = len(vals)
    eps = 0.05
    pos = sum(1 for v in vals if v > eps)
    neg = sum(1 for v in vals if v < -eps)
    zero = sum(1 for v in vals if abs(v) <= eps)
    sum_all = sum(vals)
    tb_cnt = Counter(m[0] for m in meta.values())

    print(f"  сырых строк: {len(rows)}")
    print(f"  уник. ТН: {n} (прод: {stats['source']['tn_count']})")
    print(
        f"  знаки pos/neg/zero: {pos}/{neg}/{zero} "
        f"(прод {stats['totals']['count_pos']}/{stats['totals']['count_neg']}/{stats['totals']['count_zero']})"
    )
    print(
        f"  median/avg: {quantile_interp(vals_sorted, 0.5):.2f} / {sum_all / n:.2f} "
        f"(прод {stats['totals']['median']} / {stats['totals']['avg']:.2f})"
    )
    denom = abs(float(stats["totals"]["sum_all"])) or 1.0
    print(
        f"  sum_all: {sum_all:.2f} (прод {stats['totals']['sum_all']:.2f}), "
        f"отклонение {(sum_all - stats['totals']['sum_all']) / denom * 100:.3f}%"
    )
    print(f"  ТБ групп: {len(tb_cnt)} (прод {stats['source']['unique_tb']})")


def main() -> None:
    ap = argparse.ArgumentParser(description="Демо-CSV из JSON статистики файла")
    ap.add_argument("--stats", required=True, type=Path, help="Путь к sum_file_stats_*.json")
    ap.add_argument("--out", required=True, type=Path, help="Выходной CSV")
    ap.add_argument("--seed", type=int, default=20260811)
    ap.add_argument("--base-rows", type=int, default=25_000, help="База числа сырых строк (± jitter)")
    args = ap.parse_args()

    stats_path = args.stats if args.stats.is_absolute() else ROOT / args.stats
    out_path = args.out if args.out.is_absolute() else ROOT / args.out
    stats = json.loads(stats_path.read_text(encoding="utf-8"))

    rng = random.Random(args.seed)
    employees = expand_employees(stats)
    if len(employees) != int(stats["source"]["tn_count"]):
        print(
            f"Внимание: слотов ТН {len(employees)} ≠ source.tn_count {stats['source']['tn_count']}"
        )

    targets = assign_target_amounts(employees, stats, rng)
    n_rows = choose_row_count(len(employees), rng, base=args.base_rows)
    repeats = allocate_repeat_counts(len(employees), n_rows, rng)

    written = write_csv(out_path, employees, targets, repeats, rng)
    print(f"Готово: {out_path}")
    print(f"  источник: {stats['source'].get('file_name')} / {stats_path.name}")
    print(f"  seed={args.seed}, целевых сырых строк≈{n_rows}, записано={written}")
    verify(out_path, stats)


if __name__ == "__main__":
    main()
