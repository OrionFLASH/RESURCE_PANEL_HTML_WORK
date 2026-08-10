# Roadmap: распределение сумм (ТН)

## Цель

Однофайловая HTML-страница для загрузки CSV/таблицы с обязательными столбцами ТН и сумма, агрегацией SUM по ТН и построением гистограммы с фильтрами и разрезами.

## Подзадачи

- [v] Каркас страницы: разметка, стили Liquid Glass, встроенный конфиг
- [v] Загрузка данных: CSV-файл и вставка таблицы
- [v] Обязательные ТН + сумма; опциональные ТБ / ГОСБ / кластер; алиасы без учёта регистра
- [v] Агрегация SUM по нормализованному ТН (pad 20)
- [v] Фильтры и разрезы только для присутствующих колонок
- [v] Интервалы: число / ширина / ручные границы на одной шкале (N ползунков)
- [v] Гистограмма (Canvas) и таблица частот
- [v] Демо-CSV `samples/sum-distribution-demo-1800.csv` (генератор из IN/)
- [v] `IN/` и `JS/IN/` в `.gitignore`
- [v] config.json, README, тесты

## Модули (внутри sum-distribution.html)

- `parseTableText` / `findColumnIndex` — разбор и алиасы
- `normalizeEmpId` / `aggregateByTn` — нормализация ТН и SUM
- `rebuildFilterOptions` / `filteredRows` — фильтры
- `buildBins` / multi-thumb `edgeRail` — границы
- `computeHistogram` / `drawHistogram` / `renderFrequencyTable`

## Как проверить

1. Открыть `sum-distribution.html` в браузере (`file://`).
2. Загрузить `samples/sum-distribution-demo-1800.csv`.
3. Переключить разрез / фильтры; режим «Ручные границы» — подвигать ползунки.
4. `node src/Tests/test_histogram_bins.js`
