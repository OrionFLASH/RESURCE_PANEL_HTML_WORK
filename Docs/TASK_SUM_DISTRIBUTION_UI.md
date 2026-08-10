# Задача агенту: распределение сумм (UI + демо)

**Репозиторий (единственный нужный):**  
`/Users/orionflash/Documents/MyProject/RESURCE_PANEL_HTML_WORK`

**Не трогать:** `SPOD_PROM` / `SPOD_PARCE_LOAD` — это другой проект (каталог параметров Excel). График и демо-CSV к нему не относятся.

---

## Контекст

Страница: `sum-distribution.html` — гистограмма сумм по ТН с фильтрами ТБ/ГОСБ/кластер.

## Статус (уже сделано в этом репо, 2026-08-10)

Проверь наличие и при необходимости доработай / закоммить:

1. **Sticky-график** + ползунки ручных границ **под** графиком (`chart-sticky`, `#binCustomRow` в `.chart-below`).
2. **Каскадные фильтры** ТБ ↔ ГОСБ ↔ кластер: совместимые сверху и активны; остальные серые/`disabled`; пустой выбор = без фильтра; автоснятие конфликтов.
3. **Переключатель «Группы на графике»:**  
   - `bin` — группы = интервалы сумм (внутри разрез);  
   - `slice` — группы = значения разреза (внутри распределение).  
   При разрезе «Вся выборка» режим `slice` недоступен.
4. **Демо 20k:** `tools/build_sum_demo_csv_20k.py` → `samples/sum-distribution-demo-20000.csv`  
   (20 000 строк, 2 000 уник. ТН, повторы 1…50).  
   Каталог `samples/` в `.gitignore` — демо **не коммитить**.
5. Тесты: `node src/Tests/test_histogram_bins.js` (каскад + groupLayout).
6. Доки: `README.md`, `ROADMAP.md`, `config.json` (`demoSamplePath`).

## Статус (2.4.1)

Готово: легенда под canvas; числовые поля границ; три экспорта (CSV+группа, CSV ТН×8+группа, TXT групп).

## Что сделать агенту сейчас

1. Открыть именно **RESURCE_PANEL_HTML_WORK**, не SPOD_PROM.
2. Прогнать тесты: `node src/Tests/test_histogram_bins.js`.
3. При необходимости пересобрать демо: `python3 tools/build_sum_demo_csv_20k.py`.
4. **Внимание:** изменение `index.html` — не из задачи гистограммы; не коммитить вместе, пока пользователь не подтвердит.
5. Commit/push только файлов sum-distribution (без `samples/*.csv`, без постороннего `index.html`).

## Файлы к коммиту (ожидаемый набор)

- `sum-distribution.html`
- `src/Tests/test_histogram_bins.js`
- `tools/build_sum_demo_csv.py`, `tools/build_sum_demo_csv_20k.py`
- `.gitignore` (`samples/`, `IN/`, `JS/IN/`)
- `README.md`, `ROADMAP.md`, `config.json`, `Docs/TASK_SUM_DISTRIBUTION_UI.md`

## Не делать

- Не переносить эти правки в SPOD_PROM.
- Не добавлять CSV из `samples/` в git.
