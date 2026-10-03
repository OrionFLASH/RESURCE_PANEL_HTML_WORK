# Ресурсная панель v8 «Лаунчер» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Рабочая панель ссылок `panel-v8/` (index.html + panel.css + panel.js + links.js) по утверждённому макету E, открываемая из `file://`.

**Architecture:** Макет `panel-v8/mockups/variant-E-launcher.html` — эталон внешнего вида и поведения; его код переносится и раскладывается по файлам. `panel.js` = IIFE: сначала `window.RP.core` (чистые функции без DOM, тестируются в Node через `vm`), затем `RP.probe`, затем UI-модули, запуск UI только если есть `document`. Данные — только из `window.RP_LINKS` (`links.js`).

**Tech Stack:** ванильный HTML/CSS/JS (ES2017, без сборки и зависимостей в рантайме); тесты — `node --test` (Node 22) + Playwright из корневого `node_modules` с системным Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, headless).

**Spec:** `panel-v8/docs/2026-10-03-links-panel-v8-design.md`

## Global Constraints

- Работа из `file://`: без CDN, веб-шрифтов, `fetch` локальных файлов, ES-модулей (`type=module` не использовать); подключение — обычные `<script src>` с относительными путями.
- Порядок подключения в `index.html`: `panel.css` → `links.js` → `panel.js` (в конце `body`).
- Дизайн 1:1 с макетом E v2 и токенами v8 (`mockups/_shared/tokens.css` + цвета стендов/сегментов); тёмная по умолчанию, светлая «Туман».
- Ключи `localStorage`: `rp_theme`, `rp_clicks`, `rp_rail`, `rp_groups`; каждое обращение — в try/catch.
- Вписывание без прокрутки: 1440×900 и 1920×1080; горизонтальной прокрутки нет ни при какой ширине ≥ 320.
- Проверка доступности: таймаут 6000 мс, параллельно ≤ 6, интервал 120000 мс.
- Тексты интерфейса — русские, как в спецификации; комментарии в коде — краткие, русские.
- Коммиты — на ветке `feature/links-panel-v8`, сообщение на английском (+ русская строка), с трейлером `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Не трогать: `Base version/`, `index-*.html`, `POST/`, `mockups/` (кроме чтения).

## Review Focus

1. Битый или отсутствующий `links.js` (синтаксическая ошибка, лишняя запятая, нет файла) → понятное сообщение на странице, а не пустой экран. — тест в Task 3.
2. Код копирования с обратной косой чертой (`omega\01803187`) → после выгрузки редактором и повторной загрузки код тот же. — тест в Task 1 (`serializeLinks`) и Task 7.
3. `localStorage` бросает исключение (приватный режим Safari, запрет cookies) → страница рендерится, тема/избранное просто не запоминаются. — тест в Task 3.
4. Нет `navigator.clipboard` (file://, СберБраузер) → копирование через `execCommand` срабатывает. — тест в Task 5.
5. Раздел с очень большим числом ссылок (30+) или длинными названиями → нет обрезки по вертикали и горизонтальной прокрутки; при нехватке высоты — обычная прокрутка. — тест в Task 4.

---

### Task 1: Данные `links.js` и ядро данных (validate / serialize)

**Files:**
- Create: `panel-v8/links.js`, `panel-v8/panel.js` (только каркас IIFE + `RP.core.validate`, `RP.core.serializeLinks`)
- Create: `panel-v8/tests/helpers.mjs`, `panel-v8/tests/core.test.mjs`

**Interfaces:**
- Produces: `window.RP_LINKS` (формат — спецификация §3); `RP.core.validate(data) -> { ok: boolean, errors: string[], warnings: string[] }`; `RP.core.serializeLinks(data) -> string` (текст файла `links.js`, начинается с комментария-шапки и `window.RP_LINKS = `, по одной ссылке на строку); `helpers.loadCore() -> RP.core` (загружает `links.js`/`panel.js` в `vm`-контекст без `document`); `helpers.loadLinks(text?) -> RP_LINKS`.

- [ ] **Step 1: Сгенерировать `links.js`** из `mockups/_shared/data.js`: переименовать поля `s→section, t→title, u→url`, сохранить `env, seg, copy, icon, meet, tool`, добавить `version: 1`, `adminScripts: []`; файл с комментарием-шапкой, описывающим поля (по-русски). Одноразовый скрипт генерации — в scratchpad, не в репозиторий.
- [ ] **Step 2: Тесты** `core.test.mjs`:
  - `validate(RP_LINKS)` → `ok === true`, `errors.length === 0`; ссылок с url — 86, инструментов — 2, разделов — 11.
  - дубль id → ошибка, содержащая id; `section: "nope"` → ошибка; нет ни `url`, ни `tool` → ошибка; `env: "DEV"` → ошибка; `favoriteSeed` с несуществующим id → предупреждение (не ошибка).
  - `serializeLinks` → текст, который после `vm`-выполнения даёт `deepEqual` исходному объекту; ссылка с `copy: "omega\\01803187"` сохраняет ровно `omega\01803187`; кириллица не экранируется в `\uXXXX`.
- [ ] **Step 3: Запустить** `node --test panel-v8/tests/` → FAIL (нет функций).
- [ ] **Step 4: Реализовать** `validate` и `serializeLinks` (через `JSON.stringify` по элементам, без внешних библиотек).
- [ ] **Step 5: Запустить** `node --test panel-v8/tests/` → PASS.
- [ ] **Step 6: Commit** `feat(panel-v8): links.js data and core validation/serialization`.

### Task 2: Чистые функции ядра

**Files:** Modify `panel-v8/panel.js`; Test `panel-v8/tests/core.test.mjs`

**Interfaces:**
- Produces:
  - `RP.core.parseUrl(url) -> { host, path, params: [[k, v]], port }` (декодирует `%D0…` в кириллицу; некорректный URL → `{ host: "", path: url, params: [] }`);
  - `RP.core.match(link, sectionName, query) -> { hit: boolean, ranges: [[start, end]] }` — регистронезависимо по `title`, `host`, `sectionName`, `env`/`seg` в обоих написаниях (`PSI`/`ПСИ`, `IFT`/`ИФТ`, `alpha`), `note`; запрос из нескольких слов — все слова должны совпасть; `ranges` — для подсветки в `title`;
  - `RP.core.rankFavorites(links, clicks, seed, limit = 9) -> id[]` — по убыванию счётчика, при равенстве — порядок `seed`, затем порядок в данных; `meet`/`tool` исключены; пустые `clicks` → первые `limit` из `seed`;
  - `RP.core.decodePermission(text) -> { binary: string, bits: number[] }` — алгоритм старой страницы: разбить по запятым, развернуть порядок, каждую часть `parseInt(_,16)` → двоичная строка, дополненная до 32 нулями слева, склеить, развернуть строку; биты = индексы `"1"`; `binary` сгруппирован пробелом по 8; невалидный HEX в любой части → `throw Error("Некорректный ввод")`;
  - `RP.core.balanceColumns(sizes: number[], n) -> number[][]` — разбить индексы разделов (в исходном порядке) на `n` подряд идущих колонок, минимизируя максимальную сумму `sizes`.
- [ ] **Step 1: Тесты:** `parseUrl("https://x.ru:3001/a/b?k=1&q=%D0%BF")` → host `x.ru`, port `3001`, path `/a/b`, params `[["k","1"],["q","п"]]`; `match` по «пси alpha» находит `h-psi-a` и не находит `h-prom-s`; `rankFavorites(links, {}, seed)` = первые 9 seed; `{kap-prom: 5, chat: 2}` → `kap-prom`, `chat` первыми; `decodePermission("5")` → bits `[0, 2]`; `"1,0"` → `[0]`; `"0,1"` → `[32]`; `"zz"` → throw; `balanceColumns([7,9,5,9,10,8,12,11,8,7,2], 4)` → 4 колонки, порядок сохранён, макс. сумма = 27 (оптимум).
- [ ] **Step 2:** `node --test panel-v8/tests/` → FAIL.
- [ ] **Step 3:** Реализовать функции (логику поиска и балансировки можно взять из макета E).
- [ ] **Step 4:** `node --test panel-v8/tests/` → PASS.
- [ ] **Step 5: Commit** `feat(panel-v8): core search, url parsing, favourites, permission decoder`.

### Task 3: Каркас страницы, стили, рендер указателя

**Files:**
- Create: `panel-v8/index.html`, `panel-v8/panel.css`, `panel-v8/tests/e2e.helpers.mjs`, `panel-v8/tests/e2e.test.mjs`
- Modify: `panel-v8/panel.js` (UI-модули: `icons`, `store`, `render`, `layout`, `theme`, `boot`)

**Interfaces:**
- Consumes: Task 1–2 (`RP.core.*`, `RP_LINKS`).
- Produces: `RP.store.get(key, def)` / `RP.store.set(key, val)` (try/catch); `RP.ui.render()`; `RP.ui.layout()` (подбор плотности, вызывается на resize с debounce 120 мс); DOM-атрибуты для тестов: `[data-link-id]` у каждой строки/иконки ссылки, `[data-section-id]` у раздела, `#rp-error` для ошибки загрузки; `e2e.helpers.openPanel({ width, height, theme?, storage?: "ok"|"throw", links?: string }) -> { page, browser, errors }` (подмена `links.js` через `page.route` на `file://`-путь или копию папки во временный каталог).
- [ ] **Step 1: e2e-тесты:** открытие без ошибок консоли; 86 ссылок + 2 инструмента отрисованы; 1440×900 и 1920×1080 → `scrollHeight <= innerHeight`, `scrollWidth <= innerWidth`; светлая тема по `rp_theme=light`; 390×844 → `scrollWidth === 390`; `links.js` с синтаксической ошибкой и отсутствующий `links.js` → виден `#rp-error` с текстом про `links.js`; `localStorage` бросает → страница отрисована, ошибок нет.
- [ ] **Step 2:** `node --test panel-v8/tests/e2e.test.mjs` → FAIL.
- [ ] **Step 3:** Перенести из макета E разметку, CSS (токены v8 + стенды/сегменты + стили макета) и рендер/вписывание; иконки спрайта — в `panel.js`; поиск и фильтры пока только отрисованы.
- [ ] **Step 4:** тесты → PASS; сравнить скриншот 1440×900 с `mockups/shots/E-launcher-v2-dark-1440.png` глазами (Read png) — расхождения устранить.
- [ ] **Step 5: Commit** `feat(panel-v8): page shell, styles and index rendering`.

### Task 4: Проверка доступности и статусы

**Files:** Modify `panel-v8/panel.js` (модуль `RP.probe` из `mockups/_shared/probe.js` + `status`), `panel.css`; Test `e2e.test.mjs`

**Interfaces:**
- Produces: `RP.probe.run(links, handlers)` / `RP.probe.every(ms, fn)` (API как в `mockups/_shared/probe.js`); `RP.status.get(id) -> { st: "wait"|"up"|"down", ms?, at?, err? }`; атрибут `data-st` на `[data-link-id]`.
- [ ] **Step 1: e2e-тесты** (сеть подменяется `page.route`: часть хостов отвечает 200, часть `abort()`, один — без ответа): после загрузки все `data-st="wait"`, затем `up`/`down` по подмене; «без ответа» → `down` с `err: "timeout"` ≤ 7 c; одновременно не более 6 запросов (счётчик в route); кнопка «Проверить» во время проверки не создаёт новых запросов; сводка в шапке совпадает с числом `up`/`down`; у `down` гаснет только название (цвет тега стенда не меняется); раздел с 30 добавленными ссылками на 1440×900 → нет горизонтальной прокрутки и ни одна строка не обрезана по вертикали (страница прокручивается).
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать (фоновая проверка не сбрасывает известные статусы). **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(panel-v8): real availability probe with status summary`.

### Task 5: Взаимодействие: клик, копирование, подсказка, поиск, фильтры, избранное, встречи

**Files:** Modify `panel-v8/panel.js` (`clipboard`, `toast`, `tooltip`, `search`, `filters`, `favorites`), `panel.css`; Test `e2e.test.mjs`

**Interfaces:**
- Produces: `RP.copy(text) -> boolean` (сначала `navigator.clipboard.writeText`, при отсутствии/ошибке — синхронный `execCommand('copy')` через скрытый textarea); `RP.toast(text)`.
- [ ] **Step 1: e2e-тесты** (контекст с `permissions: ["clipboard-read","clipboard-write"]`; `window.open` подменён на запись в массив): клик по `h-psi-a` → буфер `92863949`, тост «Скопировано: 92863949», открыт URL ссылки; клик по `varm` → буфер `omega\01803187`; Meta+клик (и Ctrl+клик) по `jira`-ссылке → буфер = URL, `window.open` не вызван, тост «Ссылка скопирована»; при `navigator.clipboard = undefined` клик по `ctl` → `execCommand('copy')` вызван (шпион) с `lakomkin-oo`; наведение → подсказка содержит host, «ПСИ · Alpha», «Клик — открыть»; поиск «пси alpha» оставляет только совпадения; Ctrl/⌘+K фокусирует поиск, Enter открывает первую; фильтр «ИФТ» оставляет только ИФТ (+ инструменты); избранное при пустом `rp_clicks` = 9 из `favoriteSeed`, после 3 кликов по `qlik` и перезагрузки `qlik` первый; встречи — полоса из 4 чипов, в разделе «Коммуникации» их нет.
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать по макету E. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(panel-v8): link interactions, search, filters, favourites, meetings`.

### Task 6: Левая панель групп и инструменты

**Files:** Modify `panel-v8/panel.js` (`rail`, `tools`, `modal`), `panel.css`; Test `e2e.test.mjs`

**Interfaces:**
- Consumes: `RP.core.decodePermission`, `RP.store`.
- Produces: `RP.modal.open(node) / close()` (Esc, клик по подложке, удержание фокуса) — используется в Task 7.
- [ ] **Step 1: e2e-тесты:** кнопка панели циклит `open → compact → hidden`, значение в `rp_rail` переживает перезагрузку; поиск «дан» оставляет «Данные и аналитика»; «глаз» скрывает раздел, `rp_groups` сохраняется, колонки перестроены, «Показать все · скрыто 1» возвращает; Alt+клик оставляет одну группу; 390×844 — шторка открывается, Esc закрывает; Декодер: ввод `5` → «Включённые биты» `0, 2`, ввод `zz` → «Ошибка! Некорректный ввод.»; Проверка роли: «Открыть» неактивна при пустом поле, при `673892` и роли по умолчанию открывает URL из спецификации §7 (`window.open` подменён).
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать по макету E и спецификации §7. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(panel-v8): groups rail and built-in tools`.

### Task 7: Администрирование: редактор ссылок и площадка скриптов

**Files:** Modify `panel-v8/panel.js` (`admin`, `editor`, `scripts`), `panel.css`; Create `panel-v8/admin/README.md`; Test `e2e.test.mjs`

**Interfaces:**
- Consumes: `RP.core.validate`, `RP.core.serializeLinks`, `RP.modal`, `RP.ui.render`.
- Produces: `RP.admin.loadScript(entry) -> Promise<{ title, code }>` (вставляет `<script src=entry.file>`, ждёт `RP_ADMIN[entry.id]`, ошибка — `Error` с путём файла).
- [ ] **Step 1: e2e-тесты:** замок открывает панель с вкладками «Ссылки» / «Скрипты»; изменить название `kap-prom` на «КАП боевой» → на странице сразу «КАП боевой», счётчик «несохранённых изменений: 1»; добавить ссылку в «Репозитории» с `copy: "omega\\x"` → появилась; удалить ссылку → исчезла; невалидный URL в форме → сообщение у поля, сохранение запрещено; «Скачать links.js» (перехват `download`) → файл, который при подмене `links.js` даёт страницу с теми же изменениями и кодом `omega\x`; при несохранённых изменениях `beforeunload` установлен; вкладка «Скрипты» при пустом `adminScripts` показывает пустое состояние с пояснением; с тестовым `adminScripts: [{id:"demo", title:"Демо", file:"admin/demo.js"}]` и временным `admin/demo.js` → «Загрузить» → «Копировать» → буфер = код; отсутствующий файл → сообщение с путём `admin/demo.js`.
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать (спецификация §8); `admin/README.md` — формат файла скрипта, запись в `adminScripts`, двухкликовое копирование. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(panel-v8): admin panel with links editor and scripts placeholder`.

### Task 8: Итоговая проверка и документация

**Files:** Create `panel-v8/README.md`; Modify `panel-v8/mockups/open-variants.sh` → `panel-v8/open-panel.sh` (открывает `index.html`: полное окно + узкое окно)

- [ ] **Step 1:** `node --test panel-v8/tests/` → все PASS; вывод приложить к отчёту.
- [ ] **Step 2:** Скриншоты финальной версии (тёмная/светлая 1440, 1920, мобильная, шторка, админка) в `panel-v8/docs/shots/`; сравнить с эталоном E v2.
- [ ] **Step 3:** Ручная проверка в Safari: открытие, стекло, копирование (клик и ⌘+клик), проверка доступности; отметить результат в README. Firefox на машине нет — указать как непроверенный.
- [ ] **Step 4:** `panel-v8/README.md`: как открыть, как править `links.js` (поля), как работает редактор и выгрузка, как подключать админ-скрипты (ссылка на `admin/README.md`), ограничения проверки доступности вне корп. сети.
- [ ] **Step 5: Commit** `docs(panel-v8): README, launch script, final screenshots`.
