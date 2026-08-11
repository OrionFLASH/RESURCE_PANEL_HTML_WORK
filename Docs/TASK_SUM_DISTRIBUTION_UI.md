# Задача агенту: распределение сумм (UI + демо)

**Репозиторий:** `RESURCE_PANEL_HTML_WORK`  
**Не трогать:** SPOD_PROM / SPOD_PARCE_LOAD.

## Статус (2.4.24, 2026-08-11)

- Экспорт **«Статистика по файлу»**: JSON `sum-distribution-file-stats/v1` + CSV групп; схема в `Docs/FILE_STATS_EXPORT.md`.
- Оптимизация drag + метрики ТЗ (2.4.23): см. `Docs/ANALYSIS_METRICS.md`.
- Ленивая аналитика только на своей вкладке (2.4.22).
- Демо: `tools/build_sum_demo_csv_20k.py`, `tools/build_sum_demo_csv_21k.py`.
- Настройки: `#app-config`.

## Документация

| Файл | Назначение |
|------|------------|
| `Docs/FILE_STATS_EXPORT.md` | Экспорт профиля файла для генераторов |
| `Docs/ANALYSIS_METRICS.md` | Метрики, графики, таблицы аналитики |
| `Docs/tz_metrics_charts.md` | Исходное ТЗ формул |

## Commit/push

- Коммитить: `sum-distribution.html`, `README.md`, `ROADMAP.md`, `Docs/*` по задаче.
- Не коммитить: `index.html`, `POST/`, «Новая папка/».
