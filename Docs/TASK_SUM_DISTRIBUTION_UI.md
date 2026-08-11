# Задача агенту: распределение сумм (UI + демо)

**Репозиторий:** `RESURCE_PANEL_HTML_WORK`  
**Не трогать:** SPOD_PROM / SPOD_PARCE_LOAD.

## Статус (2.4.23, 2026-08-11)

- Оптимизация drag: без O(n²) якоря в `binIndexForAmount`; кэш фильтров на кадр; light-rebuild без шкалы/сегментов/backdrop; custom `buildBins` без полного min/max.
- Метрики ТЗ: `Docs/tz_metrics_charts.md` → реализация описана в `Docs/ANALYSIS_METRICS.md`.
- Графики 1–12 и таблицы A–L на вкладке «Статистика и анализ»; контролы: разрез / метрика / Top-N|%|шишки.
- Ленивая аналитика только на своей вкладке (2.4.22).
- Автоинтервалы positive / все значения — как в 2.4.20.
- Демо: `tools/build_sum_demo_csv_20k.py`, `tools/build_sum_demo_csv_21k.py`.
- Настройки: `#app-config` (+ `analysisScoreWeights`, `analysisBillion`).

## Документация аналитики

| Файл | Назначение |
|------|------------|
| `Docs/ANALYSIS_METRICS.md` | Справочник: метрики, режимы, графики, таблицы (как в UI) |
| `Docs/tz_metrics_charts.md` | Исходное ТЗ формул и визуализаций |
| `README.md` § 2.4.23 | Краткое саммари релиза |

## Commit/push

- Коммитить: `sum-distribution.html`, `README.md`, `ROADMAP.md`, `Docs/*` по задаче.
- Не коммитить: `index.html`, `POST/`, «Новая папка/».
