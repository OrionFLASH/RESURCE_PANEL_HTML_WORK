# Задача агенту: распределение сумм (UI + демо)

**Репозиторий (единственный нужный):**  
`/Users/orionflash/Documents/MyProject/RESURCE_PANEL_HTML_WORK`

**Не трогать:** `SPOD_PROM` / `SPOD_PARCE_LOAD` — это другой проект (каталог параметров Excel). График и демо-CSV к нему не относятся.

---

## Контекст

Страница: `sum-distribution.html` — единый HTML (гистограмма сумм по ТН). Настройки — JSON `#app-config` в начале файла (отдельный `config.json` не используется).

## Статус (2.4.4, 2026-08-10)

Сделано:

1. Sticky-график + ползунки ручных границ под графиком; по умолчанию режим `custom`, 2 ползунка; бейдж «Группа N» на бегунке.
2. Целые границы (`floor`/`ceil`), ввод/перетаскивание целыми; суммы с разрядами (≤2 знака); мин/макс в сводке — точные.
3. Каскадные фильтры ТБ ↔ ГОСБ ↔ кластер; переключатель групп на графике `bin` / `slice`.
4. Легенда под canvas; три экспорта (CSV+группа, CSV ТН×`exportTnLength`, TXT групп).
5. Подробная статистика по интервалам: «попало / всего» для ТБ, ГОСБ, кластер, ТН; при разрезе — блоки по каждому значению.
6. Демо: `tools/build_sum_demo_csv_20k.py` → `samples/` (в `.gitignore`).
7. Тесты: `node src/Tests/test_histogram_bins.js`.

## Что сделать агенту сейчас

1. Открыть **RESURCE_PANEL_HTML_WORK**, не SPOD_PROM.
2. Прогнать тесты: `node src/Tests/test_histogram_bins.js`.
3. При необходимости пересобрать демо: `python3 tools/build_sum_demo_csv_20k.py`.
4. **Внимание:** изменение `index.html` — не из задачи гистограммы; не коммитить вместе, пока пользователь не подтвердит.
5. Commit/push только файлов sum-distribution (без `samples/*.csv`, без постороннего `index.html`).

## Файлы к коммиту (ожидаемый набор)

- `sum-distribution.html` (в т.ч. `#app-config`)
- `src/Tests/test_histogram_bins.js`
- `tools/build_sum_demo_csv.py`, `tools/build_sum_demo_csv_20k.py` (если менялись)
- `.gitignore` (`samples/`, `IN/`, `JS/IN/`)
- `README.md`, `ROADMAP.md`, `Docs/TASK_SUM_DISTRIBUTION_UI.md`
- удаление `config.json` (если ещё в дереве)

## Не делать

- Не переносить эти правки в SPOD_PROM.
- Не добавлять CSV из `samples/` в git.
