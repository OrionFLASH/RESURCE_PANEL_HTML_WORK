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
- [v] Демо-CSV в `samples/` (в `.gitignore`); генераторы `tools/build_sum_demo_csv.py` / `build_sum_demo_csv_20k.py`
- [v] `IN/` и `JS/IN/` в `.gitignore`
- [v] config.json, README, тесты
- [v] Sticky-график; ползунки ручных границ **под** гистограммой
- [v] Каскадные фильтры ТБ ↔ ГОСБ ↔ кластер (совместимые сверху, остальные серые/disabled; автоснятие конфликтов)
- [v] Переключатель группировки: по интервалам / по значениям разреза
- [v] Легенда сразу под canvas
- [v] Ручной ввод границ в полях (синхрон с ползунками)
- [v] Экспорт: CSV+Группа, CSV ТН×8+Группа, TXT групп JSON-like

## Модули (внутри sum-distribution.html)

- `parseTableText` / `findColumnIndex` — разбор и алиасы
- `normalizeEmpId` / `aggregateByTn` — нормализация ТН и SUM
- `computeAllowedValues` / `pruneIncompatibleSelections` / `rebuildFilterOptions` / `filteredRows` — каскад фильтров
- `buildBins` / multi-thumb `edgeRail` / поля ввода границ — границы (UI под графиком)
- `computeHistogram` / `drawHistogram(hist, groupLayout)` / `renderFrequencyTable`
- `groupNameForAmount` / `exportRawCsvWithGroup` / `exportUniqueTnCsv` / `exportGroupsText` — выгрузки

## Как проверить

1. Открыть `sum-distribution.html` в браузере (`file://`).
2. Сгенерировать и загрузить демо: `python3 tools/build_sum_demo_csv_20k.py` → `samples/…`.
3. Переключить разрез / фильтры; режим «Ручные границы» — ползунки и поля ввода.
4. Проверить легенду под графиком; три кнопки сохранения.
5. `node src/Tests/test_histogram_bins.js`
