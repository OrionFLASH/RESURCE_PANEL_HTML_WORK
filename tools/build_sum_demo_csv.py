#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерация samples/sum-distribution-demo-1800.csv из IN/ (не коммитится).
Фильтр: Текущая роль=true, Код роли=KM_KKSB; ТБ/ГОСБ/кластер из ORG_UNIT.
"""
from __future__ import annotations

import csv
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATS = ROOT / "IN" / "PROM_ALPHA_gamification-statistics.csv"
ORG = ROOT / "IN" / "ORG_UNIT_V20 04-06 v2.csv"
OUT = ROOT / "samples" / "sum-distribution-demo-1800.csv"

N_ROWS = 1800
SEED = 20260810
NEG_SHARE = 0.15
ZERO_SHARE = 0.05
NEG_MIN, NEG_MAX = -10_000_000, -1
POS_MIN, POS_MAX = 1, 30_000_000_000


def code_key(v: str) -> str:
    s = str(v or "").strip()
    if s.isdigit():
        return str(int(s))
    return s


def load_org() -> dict[tuple[str, str], dict[str, str]]:
    with ORG.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    out: dict[tuple[str, str], dict[str, str]] = {}
    for r in rows:
        key = (code_key(r["TB_CODE"]), code_key(r["GOSB_CODE"]))
        out[key] = r
    return out


def load_km_rows() -> list[dict[str, str]]:
    with STATS.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    return [
        r
        for r in rows
        if (r.get("Текущая роль") or "").strip().lower() == "true"
        and (r.get("Код роли") or "").strip() == "KM_KKSB"
    ]


def make_amount(rng: random.Random, kind: str) -> int:
    if kind == "neg":
        return rng.randint(NEG_MIN, NEG_MAX)
    if kind == "zero":
        return 0
    return rng.randint(POS_MIN, POS_MAX)


def main() -> None:
    if not STATS.is_file() or not ORG.is_file():
        raise SystemExit(f"Нужны файлы:\n  {STATS}\n  {ORG}")

    org = load_org()
    km = load_km_rows()
    if len(km) < N_ROWS:
        raise SystemExit(f"Недостаточно КМ: {len(km)} < {N_ROWS}")

    rng = random.Random(SEED)
    sample = rng.sample(km, N_ROWS)

    n_neg = int(round(N_ROWS * NEG_SHARE))
    n_zero = int(round(N_ROWS * ZERO_SHARE))
    kinds = ["neg"] * n_neg + ["zero"] * n_zero + ["pos"] * (N_ROWS - n_neg - n_zero)
    rng.shuffle(kinds)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";", lineterminator="\n")
        w.writerow(["ТН", "ТБ", "ГОСБ", "кластер", "сумма"])
        miss = 0
        for row, kind in zip(sample, kinds):
            tb_c = code_key(row["ТБ"])
            gosb_c = code_key(row["ГОСБ"])
            ou = org.get((tb_c, gosb_c))
            if not ou:
                miss += 1
                tb_name = tb_c
                gosb_name = gosb_c
                cluster = ""
            else:
                tb_name = ou["TB_FULL_NAME"]
                gosb_name = ou["GOSB_NAME"]
                cluster = ou["CLUSTER_CODE"]
            tn = "".join(ch for ch in row["Табельный номер"] if ch.isdigit())
            if len(tn) < 20:
                tn = tn.zfill(20)
            elif len(tn) > 20:
                tn = tn[-20:]
            w.writerow([tn, tb_name, gosb_name, cluster, make_amount(rng, kind)])

    print(f"✅ {OUT} ({N_ROWS} строк, miss join={miss})")


if __name__ == "__main__":
    main()
