# Экспорт «Статистика по файлу»

Кнопка в блоке **Скачать результаты** → `Статистика по файлу`  
(версия **2.4.24**, схема `sum-distribution-file-stats/v1`).

Считается по **текущему файлу** (`allRows`, агрегация SUM по ТН), **без фильтров**.

## Файлы на выходе

| Файл | Назначение |
|------|------------|
| `sum_file_stats_YYYYMMDD_HHMM.json` | Полный профиль для генераторов тестовых данных |
| `sum_file_stats_YYYYMMDD_HHMM_groups.csv` | Плоская таблица групп ТБ/ГОСБ/кластер (Excel) |

## Структура JSON

```text
schema, purpose, generated_at
source          — имя файла, tn_count, unique_tb/gosb/cluster, has_*
totals          — общие N, Σ, avg, median, min/max, знаки и доли
amount_quantiles — p10…p99 по amount (для модели сумм)
by_tb[]         — профиль каждого ТБ
by_gosb[]       — профиль каждого ГОСБ
by_cluster[]    — профиль каждого кластера
links           — связи оргструктуры
  tb_gosb_cluster[]  — тройки (tb, gosb, cluster) + tn_count + sum_all
  tb_gosb[] / tb_cluster[] / gosb_cluster[]
generator_hints — как семплировать ближе к проду
```

### Поля группы (`by_tb` / `by_gosb` / `by_cluster`)

| Поле | Смысл |
|------|--------|
| `name` | Значение разреза (`(пусто)` если нет колонки) |
| `tn_count` / `tn_share` | Число ТН и доля от файла |
| `min` / `max` / `median` / `avg` | По `amount` |
| `sum_all` / `sum_pos` / `sum_neg` | Суммы |
| `count_pos` / `count_neg` / `count_zero` | Число ТН по знаку |
| `share_pos` / `share_neg` / `share_zero` | Доли знака внутри группы |

## Использование для генерации демо

1. Взять веса категорий из `tn_share` / `tn_count`.
2. Сэмплировать тройки `(tb, gosb, cluster)` из `links.tb_gosb_cluster` (вес = `tn_count`).
3. Знак суммы — по `share_pos` / `share_neg` / `share_zero` группы или из `totals`.
4. Величину — из `amount_quantiles` или `min`/`median`/`max` выбранной группы.

Пустые значения в исходных колонках кодируются как `"(пусто)"`.
