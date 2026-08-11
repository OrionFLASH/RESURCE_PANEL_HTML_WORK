#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерация демо-CSV по экспорту «Статистика по файлу»
(схема sum-distribution-file-stats/v1.1; совместимо с v1).

Источник — только JSON (плоский *_groups.csv не используется).

Идея:
  1) Уникальные ТН и оргсвязи — из links.tb_gosb_cluster.
  2) Целевая сумма каждого ТН (после SUM):
     - знаки и sum_pos/sum_neg по каждому ТБ;
     - хвосты по сумме (больше amount → лучше): ≤P10 худшие, ≥P90 лучшие
       (count_le_p10 / count_ge_p90; пороги — tail_thresholds / amount_quantiles);
     - величины mid-слотов — из amount_quantiles (кусочно).
  3) Цель разбивается на несколько сырых строк (шум с компенсацией).

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
from collections import Counter, defaultdict
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


def resolve_tail_thresholds(stats: dict[str, Any]) -> tuple[float, float]:
    """
    Глобальные P10/P90 файла по amount.
    Правило: чем больше сумма, тем лучше → P10=худшие, P90=лучшие.
    """
    thr = stats.get("tail_thresholds") or {}
    q = stats.get("amount_quantiles") or {}
    p10 = thr.get("p10", q.get("p10"))
    p90 = thr.get("p90", q.get("p90"))
    if p10 is None or p90 is None:
        raise SystemExit("В JSON нет amount_quantiles.p10/p90 (и нет tail_thresholds)")
    return float(p10), float(p90)


def resolve_group_tail_counts(
    st: dict[str, Any],
    n: int,
    *,
    n_neg: int,
    n_pos: int,
) -> tuple[int, int]:
    """
    Сколько ТН группы в хвостах файла по сумме (больше = лучше).
    v1.1: count_le_p10 / count_worst_10pct и count_ge_p90 / count_best_10pct.
    v1: оценка ~10% группы, с ограничением по числу neg/pos.
    """
    if "count_le_p10" in st or "count_worst_10pct" in st:
        n_low = int(st.get("count_le_p10", st.get("count_worst_10pct", 0)))
        n_high = int(st.get("count_ge_p90", st.get("count_best_10pct", 0)))
    else:
        # Совместимость со старым JSON без хвостов по группам
        n_low = max(0, round(n * float(st.get("share_le_p10", 0.1))))
        n_high = max(0, round(n * float(st.get("share_ge_p90", 0.1))))
        if "share_le_p10" not in st and "share_ge_p90" not in st:
            n_low = max(0, round(n * 0.1))
            n_high = max(0, round(n * 0.1))

    n_low = max(0, min(n_low, n, n_neg))
    n_high = max(0, min(n_high, n, n_pos))
    # Один ТН не может быть одновременно в обоих хвостах, если p10 < p90
    if n_low + n_high > n:
        overflow = n_low + n_high - n
        if n_low >= n_high:
            n_low = max(0, n_low - overflow)
        else:
            n_high = max(0, n_high - overflow)
    return n_low, n_high


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


def _steal_to_floor(
    amounts: list[float],
    donors: list[int],
    receivers: list[int],
    floor: float,
    *,
    donor_floor: float,
) -> None:
    """Подтянуть receivers до ≥ floor, забирая массу у donors (сумма класса не меняется)."""
    for i in receivers:
        if amounts[i] >= floor - 1e-9:
            continue
        need = floor - amounts[i]
        for j in sorted(donors, key=lambda x: amounts[x], reverse=True):
            spare = amounts[j] - donor_floor
            if spare <= 1e-9:
                continue
            take = min(spare, need)
            amounts[j] = round(amounts[j] - take, 2)
            amounts[i] = round(amounts[i] + take, 2)
            need -= take
            if need <= 1e-9:
                break


def _steal_to_ceiling(
    amounts: list[float],
    donors: list[int],
    receivers: list[int],
    ceiling: float,
    *,
    donor_ceiling: float,
) -> None:
    """Подтянуть receivers до ≤ ceiling, отдавая массу donors (сумма класса не меняется)."""
    for i in receivers:
        if amounts[i] <= ceiling + 1e-9:
            continue
        need = amounts[i] - ceiling  # сколько убрать у i
        for j in sorted(donors, key=lambda x: amounts[x]):  # самые «лёгкие» donors
            spare = donor_ceiling - amounts[j]
            if spare <= 1e-9:
                continue
            take = min(spare, need)
            amounts[j] = round(amounts[j] + take, 2)
            amounts[i] = round(amounts[i] - take, 2)
            need -= take
            if need <= 1e-9:
                break


def assign_target_amounts(
    employees: list[dict[str, str]],
    stats: dict[str, Any],
    rng: random.Random,
) -> list[float]:
    """
    Целевые суммы после агрегации по ТН.
    Знаки и sum_pos/sum_neg — точно по каждому ТБ.
    Затем хвосты ≤P10 / ≥P90 по count_le_p10 / count_ge_p90 (перенос массы внутри знака).
    """
    by_tb = {x["name"]: x for x in stats["by_tb"]}
    p10, p90 = resolve_tail_thresholds(stats)
    q = stats.get("amount_quantiles") or {}
    p95 = float(q.get("p95", p90))
    p99 = float(q.get("p99", p95))

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
            if amounts[pos_idx[-1]] <= 0 and len(pos_idx) > 1:
                amounts[pos_idx[-1]] = 0.01
                amounts[pos_idx[0]] = round(amounts[pos_idx[0]] - 0.01, 2)

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
            if amounts[neg_idx[-1]] >= 0 and len(neg_idx) > 1:
                amounts[neg_idx[-1]] = -0.01
                amounts[neg_idx[0]] = round(amounts[neg_idx[0]] + 0.01, 2)

        # Хвосты: сколько слотов и достижимость по сумме
        n_low, n_high = resolve_group_tail_counts(
            st, len(indices), n_neg=len(neg_idx), n_pos=len(pos_idx)
        )
        if pos_idx and p90 > 0 and target_pos > 0:
            max_by_sum = int(target_pos // p90)
            n_high = min(n_high, max_by_sum, len(pos_idx))
        if neg_idx and p10 < 0 and target_neg < 0:
            # каждый ≤p10 ⇒ сумма хвоста ≤ n_low*p10; вся sum_neg должна это допускать
            max_by_sum = int(abs(target_neg) // abs(p10)) if abs(p10) > 1e-9 else len(neg_idx)
            n_low = min(n_low, max_by_sum, len(neg_idx))

        if n_high > 0 and pos_idx:
            ranked = sorted(pos_idx, key=lambda i: amounts[i], reverse=True)
            high = ranked[:n_high]
            mid = ranked[n_high:]
            _steal_to_floor(amounts, mid, high, p90, donor_floor=0.01)
            for i in high:
                if amounts[i] >= p90 - 1e-6:
                    continue
                need = p90 - amounts[i]
                for j in list(mid):
                    if need <= 1e-9:
                        break
                    spare = max(0.0, amounts[j] - 0.01)
                    take = min(spare, need)
                    if take <= 0:
                        continue
                    amounts[j] = round(amounts[j] - take, 2)
                    amounts[i] = round(amounts[i] + take, 2)
                    need -= take
            # Mid не должен попадать в ≥p90 — лишнее отдаём в high
            mid_cap = p90 - 0.01
            for j in list(mid):
                if amounts[j] <= mid_cap + 1e-9:
                    continue
                excess = amounts[j] - mid_cap
                amounts[j] = round(mid_cap, 2)
                for i in high:
                    if excess <= 1e-9:
                        break
                    amounts[i] = round(amounts[i] + excess, 2)
                    excess = 0.0
            if mid and high:
                headroom = sum(max(0.0, amounts[j] - 0.01) for j in mid) * 0.12
                if headroom > 0:
                    boosts = [rng.random() for _ in high]
                    bs = sum(boosts) or 1.0
                    moved = 0.0
                    for i, b in zip(high, boosts):
                        add = min(headroom * (b / bs), max(0.0, p99 - amounts[i]))
                        if add <= 0:
                            continue
                        amounts[i] = round(amounts[i] + add, 2)
                        moved += add
                    if moved > 0:
                        for j in sorted(mid, key=lambda x: amounts[x], reverse=True):
                            if moved <= 1e-9:
                                break
                            spare = max(0.0, amounts[j] - 0.01)
                            take = min(spare, moved)
                            amounts[j] = round(amounts[j] - take, 2)
                            moved -= take
        elif pos_idx and p90 > 0:
            # Нет целевого high-хвоста — не раздуваем ≥p90 сверх необходимости
            pass

        if n_low > 0 and neg_idx:
            ranked = sorted(neg_idx, key=lambda i: amounts[i])
            low = ranked[:n_low]
            mid = ranked[n_low:]
            _steal_to_ceiling(amounts, mid, low, p10, donor_ceiling=-0.01)
            for i in low:
                if amounts[i] <= p10 + 1e-6:
                    continue
                need = amounts[i] - p10
                for j in list(mid):
                    if need <= 1e-9:
                        break
                    spare = max(0.0, -0.01 - amounts[j])
                    take = min(spare, need)
                    if take <= 0:
                        continue
                    amounts[j] = round(amounts[j] + take, 2)
                    amounts[i] = round(amounts[i] - take, 2)
                    need -= take
            # Mid не должен попадать в ≤p10 — «лишнюю тяжесть» отдаём в low
            mid_floor = p10 + 0.01
            for j in list(mid):
                if amounts[j] >= mid_floor - 1e-9:
                    continue
                deficit = mid_floor - amounts[j]  # сколько добавить j (сделать менее отриц.)
                amounts[j] = round(mid_floor, 2)
                for i in low:
                    if deficit <= 1e-9:
                        break
                    amounts[i] = round(amounts[i] - deficit, 2)
                    deficit = 0.0

        # Финальная подгонка сумм знака на mid-слотах (хвосты не трогаем)
        if pos_idx:
            ranked = sorted(pos_idx, key=lambda i: amounts[i], reverse=True)
            high = set(ranked[:n_high]) if n_high > 0 else set()
            mid = [i for i in pos_idx if i not in high] or pos_idx[:]
            delta = target_pos - sum(amounts[j] for j in pos_idx)
            if abs(delta) > 1e-9:
                # Размазываваем delta по mid, не давая уйти в ≤0
                order = sorted(mid, key=lambda i: amounts[i], reverse=True)
                left = delta
                for k, i in enumerate(order):
                    if abs(left) < 1e-9:
                        break
                    if k == len(order) - 1:
                        amounts[i] = round(amounts[i] + left, 2)
                        left = 0.0
                    else:
                        step = left / (len(order) - k)
                        amounts[i] = round(amounts[i] + step, 2)
                        left = round(left - step, 2)
                    if amounts[i] < 0.01:
                        left += amounts[i] - 0.01
                        amounts[i] = 0.01
            if n_high > 0 and high:
                mid_cap = p90 - 0.01
                high_list = [i for i in pos_idx if i in high]
                for j in mid:
                    if amounts[j] <= mid_cap + 1e-9:
                        continue
                    excess = amounts[j] - mid_cap
                    amounts[j] = round(mid_cap, 2)
                    amounts[high_list[0]] = round(amounts[high_list[0]] + excess, 2)

        if neg_idx:
            ranked = sorted(neg_idx, key=lambda i: amounts[i])
            low = set(ranked[:n_low]) if n_low > 0 else set()
            mid = [i for i in neg_idx if i not in low] or neg_idx[:]
            delta = target_neg - sum(amounts[j] for j in neg_idx)
            if abs(delta) > 1e-9:
                order = sorted(mid, key=lambda i: amounts[i])  # более отрицательные первыми
                left = delta
                for k, i in enumerate(order):
                    if abs(left) < 1e-9:
                        break
                    if k == len(order) - 1:
                        amounts[i] = round(amounts[i] + left, 2)
                        left = 0.0
                    else:
                        step = left / (len(order) - k)
                        amounts[i] = round(amounts[i] + step, 2)
                        left = round(left - step, 2)
                    if amounts[i] > -0.01:
                        left += amounts[i] + 0.01
                        amounts[i] = -0.01
            if n_low > 0 and low:
                mid_floor = p10 + 0.01
                low_list = [i for i in neg_idx if i in low]
                for j in mid:
                    if amounts[j] >= mid_floor - 1e-9:
                        continue
                    deficit = mid_floor - amounts[j]
                    amounts[j] = round(mid_floor, 2)
                    amounts[low_list[0]] = round(amounts[low_list[0]] - deficit, 2)

        # Жёстко сохранить знаки слотов (после округлений/переносов)
        for i in zero_idx:
            amounts[i] = 0.0
        for i in pos_idx:
            if amounts[i] > 0:
                continue
            donor = max((j for j in pos_idx if j != i), key=lambda j: amounts[j], default=None)
            amounts[i] = 0.01
            if donor is not None and amounts[donor] > 0.02:
                amounts[donor] = round(amounts[donor] - 0.01, 2)
        for i in neg_idx:
            if amounts[i] < 0:
                continue
            donor = min((j for j in neg_idx if j != i), key=lambda j: amounts[j], default=None)
            amounts[i] = -0.01
            if donor is not None and amounts[donor] < -0.02:
                amounts[donor] = round(amounts[donor] + 0.01, 2)

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

    # Нулевые ТН — только нули (иначе шум + float даёт «ложные» знаки после SUM)
    if abs(target) < 1e-9:
        return [0.0] * k

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
    with out.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    agg: dict[str, float] = defaultdict(float)
    meta: dict[str, tuple[str, str, str]] = {}
    for r in rows:
        tn = r["ТН"]
        agg[tn] += float(r["сумма"].replace(",", "."))
        meta[tn] = (r["ТБ"], r["ГОСБ"], r["кластер"])

    # Округление как у денежных сумм (2 знака) — убрать float-пыль после SUM
    for tn in list(agg.keys()):
        agg[tn] = round(agg[tn], 2)

    vals = list(agg.values())
    vals_sorted = sorted(vals)
    n = len(vals)
    # Как в sum-distribution.html: строго >0 / <0 / ==0
    pos = sum(1 for v in vals if v > 0)
    neg = sum(1 for v in vals if v < 0)
    zero = sum(1 for v in vals if v == 0)
    sum_all = sum(vals)
    tb_cnt = Counter(m[0] for m in meta.values())
    p10, p90 = resolve_tail_thresholds(stats)
    n_low = sum(1 for v in vals if v <= p10)
    n_high = sum(1 for v in vals if v >= p90)

    # Сверка хвостов по ТБ
    by_tb = {x["name"]: x for x in stats["by_tb"]}
    tn_to_amt = dict(agg)
    low_by_tb: dict[str, int] = defaultdict(int)
    high_by_tb: dict[str, int] = defaultdict(int)
    for tn, amt in tn_to_amt.items():
        tb = meta[tn][0]
        if amt <= p10:
            low_by_tb[tb] += 1
        if amt >= p90:
            high_by_tb[tb] += 1

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
    print(f"  пороги хвостов: p10={p10:.4f}, p90={p90:.4f}")
    tgt_low = stats["totals"].get("count_le_p10")
    tgt_high = stats["totals"].get("count_ge_p90")
    if tgt_low is None:
        tgt_low = sum(
            resolve_group_tail_counts(
                by_tb[name],
                int(by_tb[name]["tn_count"]),
                n_neg=int(by_tb[name]["count_neg"]),
                n_pos=int(by_tb[name]["count_pos"]),
            )[0]
            for name in by_tb
        )
        tgt_high = sum(
            resolve_group_tail_counts(
                by_tb[name],
                int(by_tb[name]["tn_count"]),
                n_neg=int(by_tb[name]["count_neg"]),
                n_pos=int(by_tb[name]["count_pos"]),
            )[1]
            for name in by_tb
        )
    print(f"  хвост ≤p10: {n_low} (цель≈{tgt_low}), ≥p90: {n_high} (цель≈{tgt_high})")

    # Топ-3 отклонения по ТБ
    diffs: list[tuple[int, str, int, int, int, int]] = []
    for name, st in by_tb.items():
        want_l, want_h = resolve_group_tail_counts(
            st,
            int(st["tn_count"]),
            n_neg=int(st["count_neg"]),
            n_pos=int(st["count_pos"]),
        )
        got_l = low_by_tb.get(name, 0)
        got_h = high_by_tb.get(name, 0)
        diffs.append((abs(got_l - want_l) + abs(got_h - want_h), name, got_l, want_l, got_h, want_h))
    diffs.sort(reverse=True)
    if diffs:
        print("  хвосты по ТБ (факт/цель low|high), наибольшие расхождения:")
        for _, name, gl, wl, gh, wh in diffs[:5]:
            if gl == wl and gh == wh:
                continue
            print(f"    {name}: ≤p10 {gl}/{wl}, ≥p90 {gh}/{wh}")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Демо-CSV из JSON статистики файла (v1.1 / v1; без flat groups CSV)"
    )
    ap.add_argument("--stats", required=True, type=Path, help="Путь к sum_file_stats_*.json")
    ap.add_argument("--out", required=True, type=Path, help="Выходной CSV")
    ap.add_argument("--seed", type=int, default=20260811)
    ap.add_argument("--base-rows", type=int, default=25_000, help="База числа сырых строк (± jitter)")
    args = ap.parse_args()

    stats_path = args.stats if args.stats.is_absolute() else ROOT / args.stats
    out_path = args.out if args.out.is_absolute() else ROOT / args.out
    if stats_path.suffix.lower() != ".json":
        raise SystemExit("Ожидается JSON статистики файла (не CSV групп)")

    stats = json.loads(stats_path.read_text(encoding="utf-8"))
    schema = str(stats.get("schema", ""))
    if "file-stats" not in schema and "sum-distribution-file-stats" not in schema:
        print(f"Внимание: неожиданная schema={schema!r}")

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
    print(f"  schema: {schema or '(нет)'}")
    print(f"  seed={args.seed}, целевых сырых строк≈{n_rows}, записано={written}")
    verify(out_path, stats)


if __name__ == "__main__":
    main()
