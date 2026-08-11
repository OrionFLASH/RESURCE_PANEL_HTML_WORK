# Экспорт «Статистика по файлу»

Кнопка в блоке **Скачать результаты** → `Статистика по файлу`  
(схема **`sum-distribution-file-stats/v1.1`**).

Считается по **текущему файлу** (`allRows`, агрегация SUM по ТН), **без фильтров**.

## Файл на выходе

| Файл | Назначение |
|------|------------|
| `sum_file_stats_YYYYMMDD_HHMM.json` | Полный профиль (CSV групп больше не выгружается) |

## Структура JSON

```text
schema, purpose, generated_at
source           — имя файла, tn_count, unique_tb/gosb/cluster, has_*
totals           — общие N, Σ, avg, median, min/max, знаки и доли
                 + count_le_p10 / count_ge_p90 (= count_worst_10pct / count_best_10pct)
amount_quantiles — p10…p99 по amount
tail_thresholds  — правило «больше сумма → лучше»; глобальные p10 / p90
by_tb[] / by_gosb[] / by_cluster[]
links            — связи оргструктуры (тройки и пары)
generator_hints  — как семплировать ближе к проду
```

### Правило лучших / худших

Ранжирование **только по полю `amount` (сумма ТН после агрегации)**: **чем больше сумма, тем лучше**.

| Хвост | Условие | Смысл |
|-------|---------|--------|
| Худшие ~10% | `amount ≤` глобальный **P10** | нижний хвост распределения суммы |
| Лучшие ~10% | `amount ≥` глобальный **P90** | верхний хвост распределения суммы |

Пороги P10/P90 считаются **по всему файлу** (не внутри группы), затем для каждой группы считается, сколько её табельных попало в эти хвосты.

### Поля группы (`by_tb` / `by_gosb` / `by_cluster`)

| Поле | Смысл |
|------|--------|
| `name` | Значение разреза (`(пусто)` если нет колонки) |
| `tn_count` / `tn_share` | Число ТН и доля от файла |
| `min` / `max` / `median` / `avg` | По `amount` |
| `sum_all` / `sum_pos` / `sum_neg` | Суммы |
| `count_pos` / `count_neg` / `count_zero` | Число ТН по знаку |
| `share_pos` / `share_neg` / `share_zero` | Доли знака внутри группы |
| `count_le_p10` / `share_le_p10` / `count_worst_10pct` | ТН группы в **худших ~10%** (`amount ≤` P10) |
| `count_ge_p90` / `share_ge_p90` / `count_best_10pct` | ТН группы в **лучших ~10%** (`amount ≥` P90) |

## Генерация демо-CSV

Только JSON (файл `*_groups.csv` генератор **не** читает).

```bash
python3 tools/build_sum_demo_from_file_stats.py \
  --stats "Docs/пром стата/sum_file_stats_….json" \
  --out samples/sum-distribution-demo-prod-stalo.csv \
  --seed 20260811
```

Что учитывается:

1. `links.tb_gosb_cluster` — число ТН и оргсвязь.
2. `by_tb` — знаки и `sum_pos` / `sum_neg` (сумма файла после агрегации ≈ прод).
3. `tail_thresholds` / `amount_quantiles` — глобальные P10/P90 по `amount` (больше сумма → лучше).
4. `count_le_p10`/`count_worst_10pct` и `count_ge_p90`/`count_best_10pct` по ТБ  
   (для старого JSON v1 без этих полей — оценка ≈10% группы).

На выходе — сырой CSV (`ТН;ТБ;ГОСБ;кластер;сумма`), ~25k± строк; после SUM по ТН профиль близок к статистике.
