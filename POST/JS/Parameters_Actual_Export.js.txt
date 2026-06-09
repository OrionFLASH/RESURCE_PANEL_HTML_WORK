/**
 * Панель: выгрузка параметров, создание (param-create), редактирование (param-update).
 * Запуск: DevTools → Console → вставить файл → Enter.
 * Общий выбор стенда (PROM/PSI) и контура (ALPHA/SIGMA) над вкладками — для всех операций.
 */
(() => {
  "use strict";

  // ===========================================================================
  // Справочник parameterType (создание и правка): выпадающие списки + проверка JSON из файла.
  // Добавляйте строки { value, label } — value уходит в API, label виден в списке для ориентира.
  // ===========================================================================
  /** @type {{ value: string; label: string }[]} */
const PARAMETER_TYPE_OPTIONS = [
    { value: "NEWS_ACHIEVEMENT", label: "NEWS_ACHIEVEMENT" },
    { value: "SERVICE", label: "SERVICE" },
    { value: "COMMON", label: "COMMON" },
    { value: "GROUPING", label: "GROUPING" },
    { value: "NEWS_ACHIEVEMENT_REWARD", label: "NEWS_ACHIEVEMENT_REWARD" },
    { value: "NEWS_ACHIEVEMENT_GENERAL", label: "NEWS_ACHIEVEMENT_GENERAL" },
    { value: "HELP_MATERIALS", label: "HELP_MATERIALS" },
    { value: "NOTIFICATION_SCHEME", label: "NOTIFICATION_SCHEME" },
    { value: "NOTIFICATION_TEMPLATE", label: "NOTIFICATION_TEMPLATE" },
    { value: "NOTIFICATION_RECEIVER_RULE", label: "NOTIFICATION_RECEIVER_RULE" },
    { value: "YEAR_RESULTS", label: "YEAR_RESULTS" },
  ];

/** Фолбэк-список businessBlock, если API на шаге загрузки не вернул значения. */
  const BUSINESS_BLOCK_OPTIONS = [
    { value: "KMKKSB", label: "KMKKSB" },
    { value: "MNS", label: "MNS" },
    { value: "SERVICEMEN", label: "SERVICEMEN" },
    { value: "KMFACTORING", label: "KMFACTORING" },
    { value: "KMSB1", label: "KMSB1" },
    { value: "IMUB", label: "IMUB" },
    { value: "RNUB", label: "RNUB" },
    { value: "RSB1", label: "RSB1" },
  ];

  /** Пауза между последовательными POST из файла (create/update), мс. */
  const PARAM_BATCH_REQUEST_GAP_MS = 50;

  /** Автоэкранирование внутренних кавычек в parameterName/parameterValue перед POST. */
  let autoEscapeQuotesEnabled = true;

  const PARAMETER_ORIGINS = {
    PROM: {
      SIGMA: "https://salesheroes.sberbank.ru",
      ALPHA: "https://efs-our-business-prom.omega.sbrf.ru",
    },
    PSI: {
      SIGMA: "https://salesheroes-psi.sigma.sbrf.ru",
      ALPHA: "https://iam-enigma-psi.omega.sbrf.ru",
    },
    "IFT-SB": {
      SIGMA: "https://salesheroes-psi.sigma.sbrf.ru",
      ALPHA: "https://iam-enigma-psi.omega.sbrf.ru",
    },
    "IFT-GF": {
      SIGMA: "https://salesheroes-psi.sigma.sbrf.ru",
      ALPHA: "https://iam-enigma-psi.omega.sbrf.ru",
    },
  };
  const STAND_KEYS = ["PROM", "PSI", "IFT-SB", "IFT-GF"];
  const CONTOUR_KEYS = ["SIGMA", "ALPHA"];
  const DEFAULT_STATUS = "ACTUAL";
  const PARAM_AUTO_ENV = detectParameterEnvFromLocation();
  const DEFAULT_STAND = (PARAM_AUTO_ENV && PARAM_AUTO_ENV.stand) || "PROM";
  const DEFAULT_CONTOUR = (PARAM_AUTO_ENV && PARAM_AUTO_ENV.contour) || "ALPHA";

  const PARAMETERS_PATH = "/bo/rmkib.gamification/proxy/v1/parameters";
  const PARAM_CREATE_PATH = "/bo/rmkib.gamification/proxy/v1/parameters/param-create";
  const PARAM_UPDATE_PATH = "/bo/rmkib.gamification/proxy/v1/parameters/param-update";
  /** parameterCode мета-параметра со списком типов в parameterValue.types (JSON). */
  const PARAMETER_TYPES_META_CODE = "parameterTypes";

  const PANEL_ID = "parameters-actual-export-panel";
  const LOG_MAX_LINES = 400;

  /** Базовый размер шрифта панели (компактно, чтобы форма и журнал помещались). */
  const PANEL_FONT_BASE = "11px";
  /** Подписи и подсказки. */
  const PANEL_FONT_SMALL = "10px";
  /**
   * Ширина панели — максимально возможная под текущее окно (с отступами от краёв).
   */
  const PANEL_WIDTH_CSS = "min(1400px, calc(100vw - 24px))";
  /**
   * Высота панели — почти на весь экран (фиксированные bottom/right 12px дают суммарно ~24px).
   */
  const PANEL_HEIGHT_CSS = "calc(100vh - 24px)";
  /** Минимальная высота блока журнала. */
  const PANEL_LOG_MIN_HEIGHT_PX = 56;
  /** Высота журнала: доля экрана, без забирации места у области вкладок сверх необходимого. */
  const PANEL_LOG_HEIGHT_CSS = "min(120px, 14vh)";

  /**
   * После кнопки «загрузить типы» сюда попадает объединённый список допустимых parameterType из API;
   * пока null — для проверок используется только PARAMETER_TYPE_OPTIONS.
   * @type {string[] | null}
   */
  let cachedAllowedParameterTypes = null;
  /** @type {string[] | null} */
  let cachedAllowedBusinessBlocks = null;

  /**
   * Допустимые значения businessBlock: сначала кэш API, иначе фолбэк-список.
   * @returns {string[]}
   */
  function getBusinessBlockAllowedValues() {
    if (cachedAllowedBusinessBlocks !== null && cachedAllowedBusinessBlocks.length > 0) {
      return cachedAllowedBusinessBlocks.slice();
    }
    return BUSINESS_BLOCK_OPTIONS.map((row) => String(row.value).trim()).filter(Boolean);
  }

  /**
   * Коды parameterCode из последнего ответа списка ACTUAL (для проверки: создание vs правка).
   * null — кэш ещё не заполняли (ни кнопкой типов, ни предзагрузкой перед созданием).
   * @type {Set<string> | null}
   */
  let cachedActualParameterCodes = null;

  /**
   * objectId из последнего ответа списка ACTUAL (тот же запрос, что и кэш кодов) — для проверок перед param-update без повторного POST списка.
   * @type {Set<string> | null}
   */
  let cachedActualObjectIds = null;

  /**
   * Соответствие по parameterCode из последнего ACTUAL-списка.
   * Нужны для автоподстановки полей на вкладке «Редактирование».
   * @type {Map<string, { objectId: string; parameterCode: string; parameterType: string; businessBlock: string; status: string; version: number | null }>}
   */
  let cachedActualByCode = new Map();

  /**
   * Соответствие по objectId из последнего ACTUAL-списка.
   * @type {Map<string, { objectId: string; parameterCode: string; parameterType: string; businessBlock: string; status: string; version: number | null }>}
   */
  let cachedActualByObjectId = new Map();

  /**
   * Вкладка «3. Редактирование»: пользователь нажал «загрузить допустимые значения» — можно выбирать parameterCode и parameterType из списков.
   * @type {boolean}
   */
  let editTabAllowedListsLoaded = false;

  /**
   * Допустимые значения parameterType для сравнения с полем в JSON и форме.
   * @returns {string[]}
   */
  function getParameterTypeAllowedValues() {
    if (cachedAllowedParameterTypes !== null && cachedAllowedParameterTypes.length > 0) {
      return cachedAllowedParameterTypes.slice();
    }
    return PARAMETER_TYPE_OPTIONS.map((row) => String(row.value).trim()).filter(Boolean);
  }

  /**
   * Заполняет <select> вариантами из PARAMETER_TYPE_OPTIONS.
   * @param {HTMLSelectElement} selectEl
   */
  function fillParameterTypeSelect(selectEl) {
    selectEl.textContent = "";
    for (const row of PARAMETER_TYPE_OPTIONS) {
      const v = String(row.value).trim();
      if (!v) continue;
      const o = document.createElement("option");
      o.value = v;
      o.textContent = row.label && String(row.label).trim() ? String(row.label).trim() : v;
      selectEl.appendChild(o);
    }
  }

  /**
   * Заполняет select значениями parameterType из API (строка = value и подпись).
   * @param {HTMLSelectElement} selectEl
   * @param {string[]} values
   * @param {boolean} [prependEmpty] — первая опция «— выберите …» (для вкладки «Редактирование»).
   */
  function fillParameterTypeSelectWithApiValues(selectEl, values, prependEmpty) {
    selectEl.textContent = "";
    if (prependEmpty) {
      const o0 = document.createElement("option");
      o0.value = "";
      o0.textContent = "— выберите parameterType —";
      selectEl.appendChild(o0);
    }
    const sorted = values
      .map(function (x) {
        return String(x).trim();
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.localeCompare(b, "ru");
      });
    const seen = new Set();
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      if (seen.has(t)) continue;
      seen.add(t);
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      selectEl.appendChild(o);
    }
    if (prependEmpty) {
      selectEl.value = "";
    }
  }

  /**
   * Для вкладки «Создание»: оставляет все значения по умолчанию и добавляет уникальные типы из API.
   * @param {HTMLSelectElement} selectEl
   * @param {string[]} values
   */
  function fillCreateTypeSelectWithDefaultsAndApi(selectEl, values) {
    const byValue = new Map();
    for (let i = 0; i < PARAMETER_TYPE_OPTIONS.length; i++) {
      const row = PARAMETER_TYPE_OPTIONS[i];
      const v = String(row && row.value != null ? row.value : "").trim();
      if (!v) continue;
      const lbl = String(row && row.label != null ? row.label : v).trim() || v;
      byValue.set(v, lbl);
    }
    const extra = (Array.isArray(values) ? values : [])
      .map(function (x) {
        return String(x).trim();
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.localeCompare(b, "ru");
      });
    for (let i = 0; i < extra.length; i++) {
      const v = extra[i];
      if (!byValue.has(v)) byValue.set(v, v);
    }
    selectEl.textContent = "";
    byValue.forEach(function (label, value) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      selectEl.appendChild(o);
    });
  }

  /**
   * Для вкладки «Создание»: оставляет все businessBlock по умолчанию и добавляет уникальные из API.
   * @param {HTMLSelectElement} selectEl
   * @param {string[]} values
   */
  function fillCreateBusinessBlockSelectWithDefaultsAndApi(selectEl, values) {
    const prev = selectEl.value;
    const byValue = new Map();
    for (let i = 0; i < BUSINESS_BLOCK_OPTIONS.length; i++) {
      const row = BUSINESS_BLOCK_OPTIONS[i];
      const v = String(row && row.value != null ? row.value : "").trim();
      if (!v) continue;
      const lbl = String(row && row.label != null ? row.label : v).trim() || v;
      byValue.set(v, lbl);
    }
    const extra = (Array.isArray(values) ? values : [])
      .map(function (x) {
        return String(x).trim();
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.localeCompare(b, "ru");
      });
    for (let i = 0; i < extra.length; i++) {
      const v = extra[i];
      if (!byValue.has(v)) byValue.set(v, v);
    }
    selectEl.textContent = "";
    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "— businessBlock (необязательно) —";
    selectEl.appendChild(o0);
    byValue.forEach(function (label, value) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      selectEl.appendChild(o);
    });
    if (prev && byValue.has(prev)) selectEl.value = prev;
  }

  /**
   * Заполняет select допустимыми businessBlock.
   * @param {HTMLSelectElement} selectEl
   * @param {string[] | null} values
   */
  function fillBusinessBlockSelect(selectEl, values) {
    const prev = selectEl.value;
    selectEl.textContent = "";
    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "— businessBlock (необязательно) —";
    selectEl.appendChild(o0);
    const arr = Array.isArray(values) && values.length > 0 ? values.slice() : getBusinessBlockAllowedValues();
    for (let i = 0; i < arr.length; i++) {
      const bb = String(arr[i]).trim();
      if (!bb) continue;
      const o = document.createElement("option");
      o.value = bb;
      o.textContent = bb;
      selectEl.appendChild(o);
    }
    if (prev && arr.indexOf(prev) >= 0) selectEl.value = prev;
  }

  /**
   * Поле поиска parameterCode на вкладке «Редактирование»: datalist с кодами из ACTUAL.
   * @param {HTMLInputElement} inputEl
   * @param {HTMLDataListElement} listEl
   * @param {Set<string>} codeSet
   */
  function fillParameterCodeSelectFromActualCodes(inputEl, listEl, codeSet, selectedType, selectedBusinessBlock, pickerEl) {
    const prev = inputEl.value;
    listEl.textContent = "";
    if (pickerEl) pickerEl.textContent = "";
    function normalizeSelectedFilterValue(v) {
      const s = String(v == null ? "" : v).trim();
      if (!s) return "";
      const low = s.toLowerCase();
      if (low.indexOf("—") >= 0 || low.indexOf("выберите") >= 0 || low.indexOf("необязательно") >= 0) return "";
      return s;
    }
    /** @type {Set<string>} */
    const allTypes = new Set();
    /** @type {Set<string>} */
    const allBbs = new Set();
    cachedActualByCode.forEach(function (row) {
      const t = String(row && row.parameterType ? row.parameterType : "").trim();
      const bb = String(row && row.businessBlock ? row.businessBlock : "").trim();
      if (t) allTypes.add(t);
      if (bb) allBbs.add(bb);
    });
    const typeFilter = normalizeSelectedFilterValue(selectedType);
    const bbFilter = normalizeSelectedFilterValue(selectedBusinessBlock);
    const applyTypeFilter = !!typeFilter && allTypes.has(typeFilter);
    const applyBbFilter = !!bbFilter && allBbs.has(bbFilter);
    const arr = Array.from(codeSet).sort(function (a, b) {
      return a.localeCompare(b, "ru");
    });
    for (let i = 0; i < arr.length; i++) {
      const code = arr[i];
      if ((applyTypeFilter || applyBbFilter) && cachedActualByCode.has(code)) {
        const row = cachedActualByCode.get(code);
        const rowType = String(row && row.parameterType ? row.parameterType : "").trim();
        const rowBb = String(row && row.businessBlock ? row.businessBlock : "").trim();
        if (applyTypeFilter && rowType !== typeFilter) continue;
        if (applyBbFilter && rowBb !== bbFilter) continue;
      }
      const o = document.createElement("option");
      o.value = code;
      listEl.appendChild(o);
      if (pickerEl) {
        const p = document.createElement("option");
        p.value = code;
        p.textContent = code;
        pickerEl.appendChild(p);
      }
    }
    if (pickerEl && pickerEl.options.length === 0) {
      const p0 = document.createElement("option");
      p0.value = "";
      p0.textContent = "— нет значений для выбранных фильтров —";
      pickerEl.appendChild(p0);
    }
    inputEl.value = prev;
    inputEl.placeholder = "Введите часть parameterCode для поиска…";
  }

  /**
   * Обнуляет поля вкладки «Редактирование» (до первой загрузки допустимых значений).
   * @param {HTMLInputElement} codeInput
   * @param {HTMLDataListElement} codeList
   * @param {HTMLSelectElement} typeSel
   */
  function clearEditTabParameterSelects(codeInput, codeList, typeSel, codePicker) {
    codeInput.value = "";
    codeInput.placeholder = "— сначала нажмите «загрузить допустимые значения» —";
    codeList.textContent = "";
    if (codePicker) {
      codePicker.textContent = "";
      const op = document.createElement("option");
      op.value = "";
      op.textContent = "— сначала нажмите «загрузить допустимые значения» —";
      codePicker.appendChild(op);
      codePicker.value = "";
    }
    fillParameterTypeSelectWithApiValues(
      typeSel,
      PARAMETER_TYPE_OPTIONS.map(function (x) {
        return String(x.value || "").trim();
      }).filter(Boolean),
      true,
    );
    typeSel.value = "";
  }


  function detectParameterEnvFromLocation() {
    const currentOrigin = String(window.location.origin || "").toLowerCase();
    for (let si = 0; si < STAND_KEYS.length; si++) {
      const stand = STAND_KEYS[si];
      const byStand = PARAMETER_ORIGINS[stand];
      if (!byStand) continue;
      for (let ci = 0; ci < CONTOUR_KEYS.length; ci++) {
        const contour = CONTOUR_KEYS[ci];
        const host = String((byStand && byStand[contour]) || "").toLowerCase();
        if (host && host === currentOrigin) {
          return { stand, contour };
        }
      }
    }
    return null;
  }

  /**
   * Единственный objectId для детализации при кнопке ⬇: только этот ответ разбирается на «parameterTypes».
   * Полный обход всех objectId не выполняется (этап только для списка допустимых parameterType).
   */
  function getParameterTypesDetailObjectId(stand) {
    const s = String(stand).trim();
    return s === "PSI" || s === "IFT-SB" || s === "IFT-GF" ? "737634462490874360" : "745250143248942718";
  }


  /**
   * @param {string} stand
   * @param {string} contour
   * @returns {string}
   */
  function getOrigin(stand, contour) {
    const row = PARAMETER_ORIGINS[stand];
    if (!row) {
      throw new Error("Неизвестный стенд: " + stand);
    }
    const origin = row[contour];
    if (!origin) {
      throw new Error("Неизвестный контур: " + contour);
    }
    return origin;
  }

  /**
   * @param {string} origin
   * @param {string} path
   * @param {unknown} bodyObj
   * @returns {Promise<{ ok: boolean, status: number, data: unknown, text: string }>}
   */
  async function postJson(origin, path, bodyObj) {
    const url = origin + path;
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(bodyObj),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { _parseError: true, raw: text };
    }
    return { ok: res.ok, status: res.status, data, text };
  }

  /**
   * @param {string} origin
   * @param {unknown} bodyObj
   */
  async function postParameters(origin, bodyObj) {
    return postJson(origin, PARAMETERS_PATH, bodyObj);
  }

  /**
   * Извлечение objectId из ответа списка parameters.
   * @param {unknown} listData
   * @returns {string[]}
   */
  function extractObjectIds(listData) {
    const out = [];
    const seen = new Set();
    const body = listData && typeof listData === "object" ? listData.body : null;
    const params = body && Array.isArray(body.parameters) ? body.parameters : [];
    for (const p of params) {
      if (!p || typeof p !== "object") continue;
      const id = p.objectId;
      if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  /**
   * Извлекает из текста последовательность JSON-объектов по внешним `{`…`}` с учётом строк в кавычках.
   * @param {string} t
   * @returns {{ error: string | null, items: unknown[] }}
   */
  function parseJsonObjectsByBraceScan(t) {
    /**
     * Удаляет висячие запятые перед } или ] вне строк JSON.
     * @param {string} src
     * @returns {string}
     */
    function stripTrailingCommas(src) {
      let out = "";
      let inStr = false;
      let esc = false;
      for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inStr) {
          out += ch;
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') {
          inStr = true;
          out += ch;
          continue;
        }
        if (ch === ",") {
          let k = i + 1;
          while (k < src.length && /\s/.test(src[k])) k++;
          if (k < src.length && (src[k] === "}" || src[k] === "]")) continue;
        }
        out += ch;
      }
      return out;
    }

    /**
     * 1-based строка/колонка по позиции в тексте.
     * @param {string} src
     * @param {number} pos
     * @returns {{ line: number; col: number }}
     */
    function lineColByPos(src, pos) {
      let line = 1;
      let col = 1;
      const max = Math.max(0, Math.min(pos, src.length));
      for (let i = 0; i < max; i++) {
        if (src[i] === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
      }
      return { line, col };
    }

    const items = [];
    let pos = 0;
    const len = t.length;
    let blockIndex = 0;
    while (pos < len) {
      while (pos < len && /\s/.test(t[pos])) pos++;
      if (pos >= len) break;
      if (t[pos] !== "{") {
        const next = t.indexOf("{", pos);
        if (next < 0) break;
        pos = next;
      }
      const start = pos;
      blockIndex++;
      let depth = 0;
      let inStr = false;
      let esc = false;
      let j = pos;
      for (; j < len; j++) {
        const c = t[j];
        if (inStr) {
          if (esc) {
            esc = false;
            continue;
          }
          if (c === "\\") {
            esc = true;
            continue;
          }
          if (c === '"') {
            inStr = false;
            continue;
          }
          continue;
        }
        if (c === '"') {
          inStr = true;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            const slice = t.slice(start, j + 1);
            try {
              items.push(JSON.parse(stripTrailingCommas(slice)));
            } catch (e) {
              const msg = e && typeof e === "object" && "message" in /** @type {object} */ (e) ? String(/** @type {{ message: string }} */ (e).message) : String(e);
              const lc = lineColByPos(t, start);
              return {
                error:
                  "Ошибка разбора блока JSON #" +
                  blockIndex +
                  " (позиция " +
                  start +
                  ", строка " +
                  lc.line +
                  ", колонка " +
                  lc.col +
                  "): " +
                  msg +
                  ". Фрагмент: " +
                  slice.slice(0, 240).replace(/\s+/g, " "),
                items: [],
              };
            }
            pos = j + 1;
            break;
          }
        }
      }
      if (j >= len && depth !== 0) {
        return { error: "Незавершённый JSON-объект (фигурные скобки не сбалансированы).", items: [] };
      }
    }
    return { error: null, items };
  }

  /**
   * Разбор файла: один объект, массив, NDJSON (непустая строка = один объект), либо несколько `{...}{...}` / склейка по скобкам.
   * @param {string} text
   * @returns {{ error: string | null, items: unknown[] }}
   */
  function parseJsonObjectsFromFileText(text) {
    const t = text.trim();
    if (!t) return { error: "Пустой файл", items: [] };
    try {
      const root = JSON.parse(t);
      if (Array.isArray(root)) return { error: null, items: root };
      if (root && typeof root === "object") return { error: null, items: [root] };
    } catch {
      // продолжаем другие варианты
    }
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      const parsed = [];
      for (let li = 0; li < lines.length; li++) {
        try {
          parsed.push(JSON.parse(lines[li]));
        } catch {
          parsed.length = 0;
          break;
        }
      }
      if (parsed.length === lines.length && parsed.length > 0) {
        return { error: null, items: parsed };
      }
    }
    const scanned = parseJsonObjectsByBraceScan(t);
    if (scanned.error) return scanned;
    if (scanned.items.length > 0) return { error: null, items: scanned.items };
    return {
      error: "Не удалось распознать JSON (объект, массив, по одному объекту на строку или несколько {...})",
      items: [],
    };
  }

  /**
   * @param {Record<string, unknown>} rec
   * @returns {boolean}
   */
  function isParameterValuePresent(rec) {
    if (!("parameterValue" in rec)) return false;
    const v = rec.parameterValue;
    if (v == null) return false;
    if (typeof v === "object") return true;
    return String(v).trim() !== "";
  }

  /**
   * Экранирует неэкранированные двойные кавычки внутри строки (не трогает уже экранированные).
   * @param {string} s
   * @returns {string}
   */
  function escapeInnerDoubleQuotes(s) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"' && (i === 0 || s[i - 1] !== "\\")) {
        out += '\\"';
      } else {
        out += ch;
      }
    }
    return out;
  }

  /**
   * Приводит parameterValue к строке для API: объект из файла → JSON.stringify; строка-JSON → канонический JSON.
   * @param {unknown} pv
   * @returns {string}
   */
  function normalizeParameterValueForApi(pv) {
    if (pv != null && typeof pv === "object") {
      return JSON.stringify(pv);
    }
    const s = String(pv == null ? "" : pv);
    const trimmed = s.trim();
    if (!trimmed) return "";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      if (autoEscapeQuotesEnabled) {
        return escapeInnerDoubleQuotes(s);
      }
      return s;
    }
  }

  /**
   * Нормализация записи перед validate/POST: object parameterValue, escape имён и текстовых значений.
   * @param {unknown} rec
   * @returns {Record<string, unknown>}
   */
  function normalizeParameterRecordForApi(rec) {
    const out = /** @type {Record<string, unknown>} */ (Object.assign({}, /** @type {object} */ (rec)));
    if (typeof out.parameterName === "string" && autoEscapeQuotesEnabled) {
      out.parameterName = escapeInnerDoubleQuotes(out.parameterName);
    }
    out.parameterValue = normalizeParameterValueForApi(out.parameterValue);
    return out;
  }

  /**
   * @param {unknown} pv
   * @returns {string | null}
   */
  function validateParameterValueJsonString(pv) {
    const s = String(pv == null ? "" : pv).trim();
    if (!s) return "parameterValue пустой";
    try {
      JSON.parse(s);
      return null;
    } catch (e) {
      const msg = e && typeof e === "object" && "message" in /** @type {object} */ (e) ? String(/** @type {{ message: string }} */ (e).message) : String(e);
      return "parameterValue не является валидным JSON: " + msg;
    }
  }

  /**
   * Пытается починить неэкранированные кавычки внутри JSON-строк (loose-файлы).
   * @param {string} text
   * @returns {string}
   */
  function repairUnescapedQuotesInJsonText(text) {
    let out = "";
    let i = 0;
    const len = text.length;
    while (i < len) {
      const ch = text[i];
      if (ch !== '"') {
        out += ch;
        i++;
        continue;
      }
      out += '"';
      i++;
      while (i < len) {
        const c = text[i];
        if (c === "\\") {
          out += c;
          if (i + 1 < len) {
            out += text[i + 1];
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (c === '"') {
          let j = i + 1;
          while (j < len && /\s/.test(text[j])) j++;
          const next = j < len ? text[j] : "";
          if (next === "" || next === "," || next === "}" || next === "]" || next === ":") {
            out += '"';
            i++;
            break;
          }
          out += '\\"';
          i++;
          continue;
        }
        out += c;
        i++;
      }
    }
    return out;
  }

  /**
   * Разбор файла для пакетных create/update с опциональным авто-repair кавычек.
   * @param {string} text
   * @returns {{ error: string | null, items: unknown[] }}
   */
  function parseJsonObjectsFromFileTextForBatch(text) {
    let result = parseJsonObjectsFromFileText(text);
    if (!result.error) return result;
    if (!autoEscapeQuotesEnabled) return result;
    const repaired = repairUnescapedQuotesInJsonText(text);
    if (repaired === text) return result;
    const retry = parseJsonObjectsFromFileText(repaired);
    return retry.error ? result : retry;
  }

  /**
   * @param {unknown} o
   * @returns {string | null} текст ошибки или null
   */
  function validateCreatePayload(o, allowedTypesOverride) {
    if (!o || typeof o !== "object") return "Запись не является объектом JSON";
    const rec = /** @type {Record<string, unknown>} */ (o);
    const fields = ["parameterCode", "parameterType", "parameterName"];
    for (const f of fields) {
      if (!(f in rec) || String(rec[f]).trim() === "") {
        return "Пустое или отсутствует поле: " + f;
      }
    }
    if (!isParameterValuePresent(rec)) {
      return "Пустое или отсутствует поле: parameterValue";
    }
    const pt = String(rec.parameterType).trim();
    const allowed = Array.isArray(allowedTypesOverride) && allowedTypesOverride.length > 0
      ? allowedTypesOverride
      : getParameterTypeAllowedValues();
    if (allowed.indexOf(pt) < 0) {
      return "parameterType «" + pt + "» не из списка допустимых: " + allowed.join(", ");
    }
    if ("businessBlock" in rec) {
      const bb = String(rec.businessBlock == null ? "" : rec.businessBlock).trim();
      if (bb !== "") {
        const allowedBbs = getBusinessBlockAllowedValues();
        if (allowedBbs.indexOf(bb) < 0) {
          return "businessBlock «" + bb + "» не из списка допустимых: " + allowedBbs.join(", ");
        }
      }
    }
    return null;
  }

  /**
   * @param {unknown} o
   * @returns {string | null}
   */
  function validateUpdatePayload(o) {
    const allowedForUpdate = extractParameterTypesFromListData({ body: { parameters: Array.from(cachedActualByObjectId.values()) } });
    const base = validateCreatePayload(o, allowedForUpdate);
    if (base) return base;
    const rec = /** @type {Record<string, unknown>} */ (o);
    if (editTabAllowedListsLoaded && cachedActualParameterCodes !== null) {
      const pc = String(rec.parameterCode).trim();
      if (!cachedActualParameterCodes.has(pc)) {
        return "parameterCode «" + pc + "» не из загруженного списка допустимых (вкладка «Редактирование»).";
      }
    }
    if (!("objectId" in rec) || String(rec.objectId).trim() === "") {
      return "Пустое или отсутствует поле: objectId";
    }
    if (!("version" in rec) || rec.version === null || rec.version === undefined || String(rec.version).trim() === "") {
      return "Пустое или отсутствует поле: version";
    }
    const v = Number(rec.version);
    if (!Number.isFinite(v) || v < 0) return "Некорректное поле version";
    if (!("status" in rec) || String(rec.status).trim() === "") {
      return "Пустое или отсутствует поле: status";
    }
    const st = String(rec.status).trim();
    if (st !== "ACTUAL" && st !== "ARCHIVE") {
      return "Некорректное поле status (допустимо ACTUAL или ARCHIVE)";
    }
    return null;
  }

  /**
   * @param {unknown} data
   * @returns {number | null}
   */
  function readVersionFromDetailResponse(data) {
    const body = data && typeof data === "object" ? data.body : null;
    const params = body && Array.isArray(body.parameters) ? body.parameters : [];
    const first = params[0];
    if (!first || typeof first !== "object") return null;
    const v = /** @type {Record<string, unknown>} */ (first).version;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  /**
   * parameterCode из первой записи body.parameters (ответ детализации по objectId).
   * @param {unknown} data
   * @returns {string | null}
   */
  function readParameterCodeFromDetailResponse(data) {
    const body = data && typeof data === "object" ? data.body : null;
    const params = body && Array.isArray(body.parameters) ? body.parameters : [];
    const first = params[0];
    if (!first || typeof first !== "object") return null;
    const c = /** @type {Record<string, unknown>} */ (first).parameterCode;
    return typeof c === "string" && c.trim() ? c.trim() : null;
  }

  /**
   * Длина массива body.parameters в ответе (для журнала на шаге списка).
   * @param {unknown} data
   * @returns {number}
   */
  function countParametersRowsInResponse(data) {
    const body = data && typeof data === "object" ? data.body : null;
    const params = body && Array.isArray(body.parameters) ? body.parameters : [];
    return params.length;
  }

  /**
   * Поле success верхнего уровня JSON, если есть (строка для журнала).
   * @param {unknown} data
   * @returns {string | null}
   */
  function formatSuccessFieldForLog(data) {
    if (!data || typeof data !== "object") return null;
    if (!("success" in /** @type {Record<string, unknown>} */ (data))) return null;
    return String(/** @type {Record<string, unknown>} */ (data).success);
  }

  /**
   * Все parameterCode из ответа списка parameters (ACTUAL/ARCHIVE).
   * @param {unknown} listData
   * @returns {Set<string>}
   */
  function extractParameterCodesFromListData(listData) {
    const set = new Set();
    const body = listData && typeof listData === "object" ? /** @type {Record<string, unknown>} */ (listData).body : null;
    const params = body && Array.isArray(body.parameters) ? /** @type {unknown[]} */ (body.parameters) : [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (!p || typeof p !== "object") continue;
      const c = /** @type {Record<string, unknown>} */ (p).parameterCode;
      if (typeof c === "string" && c.trim()) set.add(c.trim());
    }
    return set;
  }

  /**
   * Уникальные businessBlock из ответа списка ACTUAL (без пустых).
   * @param {unknown} listData
   * @returns {string[]}
   */
  function extractBusinessBlocksFromListData(listData) {
    const set = new Set();
    const body = listData && typeof listData === "object" ? /** @type {Record<string, unknown>} */ (listData).body : null;
    const params = body && Array.isArray(body.parameters) ? /** @type {unknown[]} */ (body.parameters) : [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (!p || typeof p !== "object") continue;
      const bb = /** @type {Record<string, unknown>} */ (p).businessBlock;
      if (typeof bb === "string" && bb.trim()) set.add(bb.trim());
    }
    return Array.from(set).sort(function (a, b) {
      return a.localeCompare(b, "ru");
    });
  }

  /**
   * Уникальные parameterType из ответа списка ACTUAL.
   * @param {unknown} listData
   * @returns {string[]}
   */
  function extractParameterTypesFromListData(listData) {
    const set = new Set();
    const body = listData && typeof listData === "object" ? /** @type {Record<string, unknown>} */ (listData).body : null;
    const params = body && Array.isArray(body.parameters) ? /** @type {unknown[]} */ (body.parameters) : [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (!p || typeof p !== "object") continue;
      const t = /** @type {Record<string, unknown>} */ (p).parameterType;
      if (typeof t === "string" && t.trim()) set.add(t.trim());
    }
    return Array.from(set).sort(function (a, b) {
      return a.localeCompare(b, "ru");
    });
  }

  /**
   * Карты соответствий из ACTUAL-списка: по parameterCode и по objectId.
   * @param {unknown} listData
   * @returns {{
   *  byCode: Map<string, { objectId: string; parameterCode: string; parameterType: string; businessBlock: string; status: string; version: number | null }>;
   *  byObjectId: Map<string, { objectId: string; parameterCode: string; parameterType: string; businessBlock: string; status: string; version: number | null }>;
   * }}
   */
  function extractActualMappingsFromListData(listData) {
    const byCode = new Map();
    const byObjectId = new Map();
    const body = listData && typeof listData === "object" ? /** @type {Record<string, unknown>} */ (listData).body : null;
    const params = body && Array.isArray(body.parameters) ? /** @type {unknown[]} */ (body.parameters) : [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (!p || typeof p !== "object") continue;
      const rec = /** @type {Record<string, unknown>} */ (p);
      const objectId = typeof rec.objectId === "string" ? rec.objectId.trim() : "";
      const parameterCode = typeof rec.parameterCode === "string" ? rec.parameterCode.trim() : "";
      if (!objectId || !parameterCode) continue;
      const parameterType = typeof rec.parameterType === "string" ? rec.parameterType.trim() : "";
      const businessBlock = typeof rec.businessBlock === "string" ? rec.businessBlock.trim() : "";
      const status = typeof rec.status === "string" ? rec.status.trim() : "";
      let version = null;
      if (typeof rec.version === "number" && Number.isFinite(rec.version)) {
        version = rec.version;
      } else if (typeof rec.version === "string" && rec.version.trim() !== "") {
        const n = Number(rec.version);
        if (Number.isFinite(n)) version = n;
      }
      const row = { objectId, parameterCode, parameterType, businessBlock, status, version };
      if (!byCode.has(parameterCode)) byCode.set(parameterCode, row);
      if (!byObjectId.has(objectId)) byObjectId.set(objectId, row);
    }
    return { byCode, byObjectId };
  }

  /**
   * Разбор parameterValue: ожидается JSON с массивом types (как у parameterTypes).
   * @param {unknown} parameterValue
   * @returns {string[]}
   */
  function parseTypesArrayFromParameterValue(parameterValue) {
    if (parameterValue == null) return [];
    let obj = null;
    if (typeof parameterValue === "string") {
      const s = String(parameterValue).trim();
      if (!s) return [];
      try {
        obj = JSON.parse(s);
      } catch {
        return [];
      }
    } else if (typeof parameterValue === "object") {
      obj = parameterValue;
    }
    if (!obj || typeof obj !== "object") return [];
    const types = /** @type {Record<string, unknown>} */ (obj).types;
    if (!Array.isArray(types)) return [];
    const out = [];
    const seen = new Set();
    for (let ti = 0; ti < types.length; ti++) {
      const v = String(types[ti]).trim();
      if (v && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  }

  /**
   * В ответе детализации ищет запись с parameterCode = parameterTypes, забирает types[] из parameterValue.
   * @param {unknown} detailData
   * @returns {string[]}
   */
  function extractTypesFromParameterTypesDetail(detailData) {
    const body = detailData && typeof detailData === "object" ? /** @type {Record<string, unknown>} */ (detailData).body : null;
    const params = body && Array.isArray(body.parameters) ? /** @type {unknown[]} */ (body.parameters) : [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (!p || typeof p !== "object") continue;
      const rec = /** @type {Record<string, unknown>} */ (p);
      if (String(rec.parameterCode || "").trim() !== PARAMETER_TYPES_META_CODE) continue;
      return parseTypesArrayFromParameterValue(rec.parameterValue);
    }
    return [];
  }

  /**
   * В ответе детализации есть ли строка с parameterCode = parameterTypes.
   * @param {unknown} detailData
   * @returns {boolean}
   */
  function hasParameterTypesMetaInDetail(detailData) {
    const body = detailData && typeof detailData === "object" ? /** @type {Record<string, unknown>} */ (detailData).body : null;
    const params = body && Array.isArray(body.parameters) ? /** @type {unknown[]} */ (body.parameters) : [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (!p || typeof p !== "object") continue;
      if (String(/** @type {Record<string, unknown>} */ (p).parameterCode || "").trim() === PARAMETER_TYPES_META_CODE) {
        return true;
      }
    }
    return false;
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * @param {string} filename
   * @param {unknown} obj
   */
  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * @param {string} filename
   * @param {string} text
   */
  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  const existing = document.getElementById(PANEL_ID);
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  // Колонка flex: область вкладок растягивается (flex:1), журнал — компактная фиксированная полоса внизу.
  panel.style.cssText = [
    "position:fixed",
    "right:12px",
    "bottom:12px",
    "width:" + PANEL_WIDTH_CSS,
    "height:" + PANEL_HEIGHT_CSS,
    "max-height:" + PANEL_HEIGHT_CSS,
    "box-sizing:border-box",
    "display:flex",
    "flex-direction:column",
    "overflow:hidden",
    "min-height:0",
    "z-index:2147483646",
    "background:#111827",
    "color:#e5e7eb",
    "font:" + PANEL_FONT_BASE + "/1.3 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif",
    "border:1px solid #374151",
    "border-radius:10px",
    "box-shadow:0 10px 30px rgba(0,0,0,.45)",
    "padding:8px 10px 8px",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "Параметры: выгрузка / создание / правка";
  title.style.cssText =
    "font-weight:700;font-size:" +
    PANEL_FONT_BASE +
    ";margin-bottom:3px;color:#f9fafb;flex-shrink:0;line-height:1.25;";
  panel.appendChild(title);

  const standRow = document.createElement("div");
  standRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:4px;flex-wrap:wrap;flex-shrink:0;";
  const standLabel = document.createElement("span");
  standLabel.textContent = "Стенд:";
  const standSel = document.createElement("select");
  standSel.style.cssText =
    "font-size:" +
    PANEL_FONT_BASE +
    ";background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:3px 5px;";
  STAND_KEYS.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    standSel.appendChild(o);
  });
  standSel.value = DEFAULT_STAND;

  const contourLabel = document.createElement("span");
  contourLabel.textContent = "Контур:";
  const contourSel = document.createElement("select");
  contourSel.style.cssText = standSel.style.cssText;
  CONTOUR_KEYS.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    contourSel.appendChild(o);
  });
  contourSel.value = DEFAULT_CONTOUR;

  standRow.appendChild(standLabel);
  standRow.appendChild(standSel);
  standRow.appendChild(contourLabel);
  standRow.appendChild(contourSel);

  const envInfo = document.createElement("div");
  envInfo.style.cssText =
    "font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.25;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-left:auto;";

  function refreshEnvInfo() {
    try {
      const origin = getOrigin(standSel.value, contourSel.value);
      envInfo.textContent = "POST " + origin;
    } catch (e) {
      envInfo.textContent = String(e && e.message ? e.message : e);
    }
  }
  standRow.appendChild(envInfo);
  panel.appendChild(standRow);
  const tabsRow = document.createElement("div");
  tabsRow.style.cssText = "display:flex;gap:4px;margin-bottom:4px;flex-wrap:wrap;flex-shrink:0;";
  const topActionsRow = document.createElement("div");
  topActionsRow.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;align-items:center;";
  const tabButtons = [];
  const tabPanels = [];
  let activeTabIndex = 0;

  /**
   * @param {number} idx
   */
  function showTab(idx) {
    activeTabIndex = idx;
    tabButtons.forEach((b, i) => {
      b.style.background = i === idx ? "#2563eb" : "#1f2937";
      b.style.color = "#e5e7eb";
    });
    tabPanels.forEach((p, i) => {
      p.style.display = i === idx ? "flex" : "none";
    });
    syncTopActionButtonsByTab();
  }

  function mkTabButton(label, idx) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText =
      "border:1px solid #374151;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:" +
      PANEL_FONT_BASE +
      ";line-height:1.2;";
    b.addEventListener("click", () => showTab(idx));
    return b;
  }

  const tab1Btn = mkTabButton("1. Выгрузка", 0);
  const tab2Btn = mkTabButton("2. Создание", 1);
  const tab3Btn = mkTabButton("3. Редактирование", 2);
  const sharedLoadBtn = document.createElement("button");
  sharedLoadBtn.type = "button";
  sharedLoadBtn.textContent = "\u2B07 Загрузить параметры";
  sharedLoadBtn.title =
    "Единая загрузка для всех вкладок: POST ACTUAL + детализация parameterTypes. Результаты применяются ко всем вкладкам.";
  sharedLoadBtn.style.cssText =
    "border:1px solid #374151;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.2;background:#1f2937;color:#e5e7eb;";
  tabButtons.push(tab1Btn, tab2Btn, tab3Btn);
  tabsRow.appendChild(tab1Btn);
  tabsRow.appendChild(tab2Btn);
  tabsRow.appendChild(tab3Btn);
  tabsRow.appendChild(topActionsRow);
  panel.appendChild(tabsRow);

  const wrap = document.createElement("div");
  // Область вкладок забирает всю свободную высоту панели; вкладки — колонка flex с растягиваемым textarea.
  wrap.style.cssText = [
    "flex:1 1 0%",
    "min-height:0",
    "position:relative",
    "overflow:hidden",
    "border:1px solid #374151",
    "border-radius:6px",
    "background:#0f172a",
    "box-sizing:border-box",
  ].join(";");
  panel.appendChild(wrap);

  /** Общие стили области вкладки: колонка на весь wrap; при нехватке места — прокрутка вкладки. */
  const tabPanelBaseStyle =
    "position:absolute;left:0;right:0;top:0;bottom:0;display:flex;flex-direction:column;min-height:0;overflow-x:hidden;overflow-y:auto;box-sizing:border-box;padding:4px 6px 6px;";

  // --- Tab 1: выгрузка ---
  const tab1 = document.createElement("div");
  tab1.style.cssText = tabPanelBaseStyle;
  const statusRow = document.createElement("div");
  statusRow.style.cssText =
    "flex-shrink:0;display:flex;gap:6px;align-items:center;margin-bottom:4px;flex-wrap:wrap;";
  const statusLabel = document.createElement("span");
  statusLabel.textContent = "Статус списка:";
  const statusSel = document.createElement("select");
  statusSel.style.cssText = standSel.style.cssText;
  [["ACTUAL", "ACTUAL"], ["ARCHIVE", "ARCHIVE"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    statusSel.appendChild(o);
  });
  statusSel.value = DEFAULT_STATUS;
  const delayLabel = document.createElement("span");
  delayLabel.textContent = "Пауза (мс) между objectId:";
  const delayInput = document.createElement("input");
  delayInput.type = "number";
  delayInput.min = "0";
  delayInput.step = "50";
  delayInput.value = "250";
  delayInput.style.cssText =
    "width:84px;font-size:" +
    PANEL_FONT_BASE +
    ";background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:3px 5px;";
  statusRow.appendChild(statusLabel);
  statusRow.appendChild(statusSel);
  statusRow.appendChild(delayLabel);
  statusRow.appendChild(delayInput);
  tab1.appendChild(statusRow);

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.textContent = "▶ Запустить выгрузку";
  runBtn.style.cssText =
    "flex-shrink:0;border:1px solid #374151;border-radius:6px;padding:5px 10px;cursor:pointer;background:#2563eb;color:#f9fafb;font-weight:600;font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.2;";

  // --- Tab 2: создание ---
  const tab2 = document.createElement("div");
  tab2.style.cssText = tabPanelBaseStyle + "display:none;";
  const createHint = document.createElement("div");
  createHint.style.cssText =
    "flex-shrink:0;font-size:" + PANEL_FONT_SMALL + ";color:#9ca3af;margin-bottom:4px;line-height:1.3;";
  createHint.textContent =
    "Кнопка ⬇ (шаг 6.1): ACTUAL + детализация «parameterTypes» — кэш допустимых типов и кодов; param-create не вызывается. Если ⬇ не нажимали, перед «Создать» и при создании из файла те же запросы выполнятся один раз автоматически. Файл: по строке на JSON или несколько объектов {...} подряд.";
  tab2.appendChild(createHint);

  function mkLabel(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText =
      "flex-shrink:0;font-size:" + PANEL_FONT_BASE + ";color:#d1d5db;margin:4px 0 2px;line-height:1.25;";
    return el;
  }
  function mkInput(type) {
    const el = document.createElement("input");
    el.type = type;
    el.style.cssText =
      "width:100%;flex-shrink:0;box-sizing:border-box;font-size:" +
      PANEL_FONT_BASE +
      ";line-height:1.25;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:4px 6px;";
    return el;
  }
  function mkTextarea(rows) {
    const el = document.createElement("textarea");
    el.rows = rows;
    el.style.cssText =
      "width:100%;box-sizing:border-box;font-size:" +
      PANEL_FONT_BASE +
      ";line-height:1.25;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:4px 6px;resize:vertical;";
    return el;
  }

  const cCode = mkInput("text");
  const cType = document.createElement("select");
  cType.style.cssText = cCode.style.cssText + "flex:1;min-width:0;";
  fillParameterTypeSelect(cType);
  const cBusinessBlock = document.createElement("select");
  cBusinessBlock.style.cssText = cCode.style.cssText;
  fillBusinessBlockSelect(cBusinessBlock, null);
  const cName = mkInput("text");
  const cValue = mkTextarea(2);
  cValue.style.flex = "1 1 auto";
  cValue.style.minHeight = "44px";

  tab2.appendChild(mkLabel("parameterCode *"));
  tab2.appendChild(cCode);
  tab2.appendChild(mkLabel("parameterType *"));
  const cTypeRow = document.createElement("div");
  cTypeRow.style.cssText =
    "flex-shrink:0;display:flex;gap:6px;align-items:stretch;width:100%;box-sizing:border-box;";
  const refreshTypesBtn = document.createElement("button");
  refreshTypesBtn.type = "button";
  refreshTypesBtn.textContent = "\u2B07";
  refreshTypesBtn.title =
    "Загрузить допустимые parameterType: POST ACTUAL + одна детализация objectId " +
    "<PROM:745250143248942718 | PSI:737634462490874360>" +
    " (parameterCode=parameterTypes → types). Без param-create и без обхода всех id.";
  refreshTypesBtn.style.cssText =
    "flex-shrink:0;width:30px;min-width:30px;padding:0;border:1px solid #374151;border-radius:5px;background:#1f2937;color:#e5e7eb;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;";
  cTypeRow.appendChild(cType);
  // Единая загрузка вынесена рядом со вкладками.
  tab2.appendChild(cTypeRow);
  tab2.appendChild(mkLabel("parameterName *"));
  tab2.appendChild(cName);
  tab2.appendChild(mkLabel("businessBlock (необязательно)"));
  tab2.appendChild(cBusinessBlock);
  tab2.appendChild(mkLabel("parameterValue *"));
  tab2.appendChild(cValue);

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.textContent = "➕ Создать параметр";
  createBtn.style.cssText =
    "flex-shrink:0;border:1px solid #374151;border-radius:6px;padding:5px 10px;cursor:pointer;background:#059669;color:#f9fafb;font-weight:600;font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.2;";

  const createFileRow = document.createElement("div");
  createFileRow.style.cssText = "flex-shrink:0;margin-top:8px;padding-top:6px;border-top:1px solid #374151;";
  const createFileHint = document.createElement("div");
  createFileHint.style.cssText = "font-size:" + PANEL_FONT_SMALL + ";color:#9ca3af;margin-bottom:4px;line-height:1.3;";
  createFileHint.textContent =
    "Из файла: JSON-объект(ы) с полями parameterCode, parameterType, parameterName, parameterValue (строка или объект {…}) и необязательным businessBlock. Несколько — по одному объекту на строку, массив, или блоки {...}{...}. Перед отправкой — preflight всего файла.";
  createFileRow.appendChild(createFileHint);
  const createFileInput = document.createElement("input");
  createFileInput.type = "file";
  createFileInput.accept = ".json,.txt,application/json,text/plain";
  createFileInput.style.cssText = "display:none;";
  const createFileBtn = document.createElement("button");
  createFileBtn.type = "button";
  createFileBtn.textContent = "📄 Создать из файла";
  createFileBtn.style.cssText =
    "flex-shrink:0;border:1px solid #374151;border-radius:6px;padding:5px 10px;cursor:pointer;background:#1f2937;color:#e5e7eb;font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.2;";
  panel.appendChild(createFileInput);
  tab2.appendChild(createFileRow);

  // --- Tab 3: редактирование ---
  const tab3 = document.createElement("div");
  tab3.style.cssText = tabPanelBaseStyle + "display:none;";
  const updHint = document.createElement("div");
  updHint.style.cssText =
    "flex-shrink:0;font-size:" + PANEL_FONT_SMALL + ";color:#9ca3af;margin-bottom:4px;line-height:1.3;";
  updHint.textContent =
    "Сначала нажмите «загрузить допустимые значения» (как шаг 6.1: только POST ACTUAL + детализация «parameterTypes», без param-update). В полях parameterCode и parameterType — списки из ответа. До загрузки поля пустые. objectId проверяется по ACTUAL; версия — из API по objectId.";
  tab3.appendChild(updHint);

  const uCode = mkInput("text");
  const uCodeList = document.createElement("datalist");
  uCodeList.id = PANEL_ID + "-edit-parameter-code-list";
  uCode.setAttribute("list", uCodeList.id);
  uCode.autocomplete = "off";
  uCode.style.cssText =
    "width:100%;flex-shrink:0;box-sizing:border-box;font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.25;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:4px 6px;";
  const uType = document.createElement("select");
  uType.style.cssText = uCode.style.cssText + "flex:1;min-width:0;";
  const uCodePicker = document.createElement("select");
  uCodePicker.size = 8;
  uCodePicker.style.cssText =
    "width:100%;flex-shrink:0;box-sizing:border-box;font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.25;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:4px 6px;";
  clearEditTabParameterSelects(uCode, uCodeList, uType, uCodePicker);
  const uBusinessBlock = document.createElement("select");
  uBusinessBlock.style.cssText = uCode.style.cssText;
  fillBusinessBlockSelect(uBusinessBlock, null);
  const uName = mkInput("text");
  const uValue = mkTextarea(2);
  uValue.style.flex = "1 1 auto";
  uValue.style.minHeight = "44px";
  const uObjectId = mkInput("text");
  const uStatus = document.createElement("select");
  uStatus.style.cssText = cCode.style.cssText + "flex:1;min-width:0;";
  [["ACTUAL", "ACTUAL"], ["ARCHIVE", "ARCHIVE"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    uStatus.appendChild(o);
  });
  uStatus.value = "ACTUAL";
  const uVersion = document.createElement("input");
  uVersion.type = "number";
  uVersion.min = "0";
  uVersion.step = "1";
  uVersion.value = "";
  uVersion.placeholder = "version";
  uVersion.style.cssText =
    "width:88px;flex-shrink:0;box-sizing:border-box;font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.25;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:4px 6px;";
  const uVersionInfo = document.createElement("div");
  uVersionInfo.style.cssText =
    "flex-shrink:0;font-size:" + PANEL_FONT_BASE + ";color:#93c5fd;margin:2px 0;line-height:1.25;";

  tab3.appendChild(mkLabel("objectId *"));
  tab3.appendChild(uObjectId);
  tab3.appendChild(uVersionInfo);

  const editLoadHint = document.createElement("div");
  editLoadHint.style.cssText =
    "flex-shrink:0;font-size:" + PANEL_FONT_SMALL + ";color:#9ca3af;margin:4px 0 2px;line-height:1.3;";
  editLoadHint.textContent = "Допустимые parameterCode и parameterType загружаются общей кнопкой «Загрузить параметры» рядом с вкладками.";
  tab3.appendChild(editLoadHint);
  const editLoadRow = document.createElement("div");
  editLoadRow.style.cssText =
    "flex-shrink:0;display:flex;gap:6px;align-items:stretch;width:100%;box-sizing:border-box;margin-bottom:4px;";
  const editLoadBtn = document.createElement("button");
  editLoadBtn.type = "button";
  editLoadBtn.textContent = "\u2B07";
  editLoadBtn.title =
    "Загрузить списки допустимых parameterCode (из ACTUAL) и parameterType (из детализации «parameterTypes»). Запросы те же, что на вкладке «Создание»; param-update не вызывается.";
  editLoadBtn.style.cssText =
    "flex-shrink:0;width:30px;min-width:30px;padding:0;border:1px solid #374151;border-radius:5px;background:#1f2937;color:#e5e7eb;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;";
  const editLoadLabel = document.createElement("div");
  editLoadLabel.style.cssText =
    "flex:1;min-width:0;font-size:" + PANEL_FONT_SMALL + ";color:#9ca3af;display:flex;align-items:center;line-height:1.25;";
  editLoadLabel.textContent = "Загрузить допустимые значения для полей ниже";
  editLoadRow.appendChild(editLoadLabel);

  tab3.appendChild(mkLabel("parameterCode *"));
  tab3.appendChild(uCode);
  tab3.appendChild(uCodeList);
  const uCodePickerHint = document.createElement("div");
  uCodePickerHint.style.cssText =
    "flex-shrink:0;font-size:" + PANEL_FONT_SMALL + ";color:#9ca3af;margin:2px 0 2px;line-height:1.25;";
  uCodePickerHint.textContent = "Список для выбора (после «Загрузить параметры»):";
  tab3.appendChild(uCodePickerHint);
  tab3.appendChild(uCodePicker);
  tab3.appendChild(mkLabel("parameterType *"));
  const uTypeRow = document.createElement("div");
  uTypeRow.style.cssText = "flex-shrink:0;display:flex;gap:6px;align-items:stretch;width:100%;box-sizing:border-box;";
  uTypeRow.appendChild(uType);
  tab3.appendChild(uTypeRow);
  tab3.appendChild(mkLabel("parameterName *"));
  tab3.appendChild(uName);
  tab3.appendChild(mkLabel("businessBlock (необязательно)"));
  tab3.appendChild(uBusinessBlock);
  tab3.appendChild(mkLabel("parameterValue *"));
  tab3.appendChild(uValue);
  tab3.appendChild(mkLabel("status *"));
  const uStatusRow = document.createElement("div");
  uStatusRow.style.cssText =
    "flex-shrink:0;display:flex;gap:6px;align-items:center;width:100%;box-sizing:border-box;";
  uStatusRow.appendChild(uStatus);
  uStatusRow.appendChild(uVersion);
  tab3.appendChild(uStatusRow);

  const updateBtn = document.createElement("button");
  updateBtn.type = "button";
  updateBtn.textContent = "✏ Обновить параметр";
  updateBtn.style.cssText =
    "flex-shrink:0;border:1px solid #374151;border-radius:6px;padding:5px 10px;cursor:pointer;background:#d97706;color:#111827;font-weight:600;font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.2;";

  const updateFileRow = document.createElement("div");
  updateFileRow.style.cssText = "flex-shrink:0;margin-top:8px;padding-top:6px;border-top:1px solid #374151;";
  const updateFileHint = document.createElement("div");
  updateFileHint.style.cssText = "font-size:" + PANEL_FONT_SMALL + ";color:#9ca3af;margin-bottom:4px;line-height:1.3;";
  updateFileHint.textContent =
    "Из файла: те же поля + objectId, status, необязательный businessBlock; parameterValue — строка или объект {…}; version проверяется по API. Preflight всего файла до первого POST.";

  const templateFilterWrap = document.createElement("div");
  templateFilterWrap.style.cssText =
    "flex-shrink:0;margin:6px 0 4px;padding:6px 8px;border:1px solid #374151;border-radius:6px;background:#0f172a;";
  const templateFilterTitle = document.createElement("div");
  templateFilterTitle.style.cssText =
    "font-size:" + PANEL_FONT_SMALL + ";color:#9ca3af;margin:0 0 4px;line-height:1.3;font-weight:600;";
  templateFilterTitle.textContent =
    "Фильтр parameterType для «🧩 Сформировать шаблон» (ничего не отмечено — все типы):";
  templateFilterWrap.appendChild(templateFilterTitle);
  const templateFilterGrid = document.createElement("div");
  templateFilterGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;";
  templateFilterWrap.appendChild(templateFilterGrid);
  /** @type {Record<string, HTMLInputElement>} */
  const templateFilterChecks = {};

  /**
   * Перестраивает чекбоксы фильтра типов для шаблона.
   */
  function rebuildTemplateFilterCheckboxes() {
    templateFilterGrid.innerHTML = "";
    Object.keys(templateFilterChecks).forEach(function (k) {
      delete templateFilterChecks[k];
    });
    const types = getParameterTypeAllowedValues();
    types.forEach(function (t) {
      const lab = document.createElement("label");
      lab.style.cssText =
        "display:inline-flex;align-items:center;gap:3px;font-size:" + PANEL_FONT_SMALL + ";color:#e5e7eb;cursor:pointer;";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = t;
      cb.style.cssText = "width:13px;height:13px;cursor:pointer;accent-color:#0369a1;";
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(t));
      templateFilterGrid.appendChild(lab);
      templateFilterChecks[t] = cb;
    });
  }

  rebuildTemplateFilterCheckboxes();

  /**
   * @returns {string[]}
   */
  function getSelectedTemplateFilterTypes() {
    const out = [];
    Object.keys(templateFilterChecks).forEach(function (k) {
      if (templateFilterChecks[k].checked) out.push(k);
    });
    return out;
  }

  /**
   * @param {string} parameterType
   * @returns {boolean}
   */
  function parameterTypeMatchesTemplateFilter(parameterType) {
    const selected = getSelectedTemplateFilterTypes();
    if (selected.length === 0) return true;
    return selected.indexOf(String(parameterType || "").trim()) >= 0;
  }

  tab3.appendChild(templateFilterWrap);
  updateFileRow.appendChild(updateFileHint);
  const updateFileInput = document.createElement("input");
  updateFileInput.type = "file";
  updateFileInput.accept = ".json,.txt,application/json,text/plain";
  updateFileInput.style.cssText = "display:none;";
  const updateFileBtn = document.createElement("button");
  updateFileBtn.type = "button";
  updateFileBtn.textContent = "🗂 Обновить из файла";
  updateFileBtn.style.cssText = createFileBtn.style.cssText;
  const templateExportBtn = document.createElement("button");
  templateExportBtn.type = "button";
  templateExportBtn.textContent = "🧩 Сформировать шаблон Payload";
  templateExportBtn.title =
    "Сформировать шаблон: ACTUAL (как 7.2), затем ARCHIVE, затем детализация по каждому objectId и выгрузка блоков для редактирования.";
  templateExportBtn.style.cssText =
    "flex-shrink:0;border:1px solid #374151;border-radius:6px;padding:5px 10px;cursor:pointer;background:#334155;color:#e5e7eb;font-size:" +
    PANEL_FONT_BASE +
    ";line-height:1.2;";
  panel.appendChild(updateFileInput);
  tab3.appendChild(updateFileRow);

  sharedLoadBtn.textContent = "⬇ Загрузить параметры";
  sharedLoadBtn.title = "Загрузить параметры для вкладок «Создание» и «Редактирование».";
  sharedLoadBtn.style.background = "#1f2937";
  sharedLoadBtn.style.color = "#e5e7eb";

  topActionsRow.appendChild(runBtn);
  topActionsRow.appendChild(sharedLoadBtn);
  topActionsRow.appendChild(createBtn);
  topActionsRow.appendChild(createFileBtn);
  topActionsRow.appendChild(updateBtn);
  topActionsRow.appendChild(updateFileBtn);
  topActionsRow.appendChild(templateExportBtn);

  const autoEscapeLab = document.createElement("label");
  autoEscapeLab.style.cssText =
    "display:none;align-items:center;gap:4px;font-size:" +
    PANEL_FONT_SMALL +
    ";color:#9ca3af;cursor:pointer;flex-shrink:0;white-space:nowrap;";
  const autoEscapeCb = document.createElement("input");
  autoEscapeCb.type = "checkbox";
  autoEscapeCb.checked = true;
  autoEscapeCb.title =
    "Экранировать неэкранированные кавычки в parameterName/parameterValue; при ошибке разбора файла — попытка repair JSON.";
  autoEscapeCb.style.cssText = "width:13px;height:13px;cursor:pointer;accent-color:#0369a1;";
  autoEscapeCb.addEventListener("change", function () {
    autoEscapeQuotesEnabled = autoEscapeCb.checked;
  });
  autoEscapeLab.appendChild(autoEscapeCb);
  autoEscapeLab.appendChild(document.createTextNode("Автоэкранирование кавычек"));
  topActionsRow.appendChild(autoEscapeLab);

  function syncTopActionButtonsByTab() {
    const isExport = activeTabIndex === 0;
    const isCreate = activeTabIndex === 1;
    const isUpdate = activeTabIndex === 2;
    runBtn.style.display = isExport ? "" : "none";
    sharedLoadBtn.style.display = isCreate || isUpdate ? "" : "none";
    createBtn.style.display = isCreate ? "" : "none";
    createFileBtn.style.display = isCreate ? "" : "none";
    updateBtn.style.display = isUpdate ? "" : "none";
    updateFileBtn.style.display = isUpdate ? "" : "none";
    templateExportBtn.style.display = isUpdate ? "" : "none";
    autoEscapeLab.style.display = isCreate || isUpdate ? "inline-flex" : "none";
  }

  /**
   * Подставляет в форму редактирования связанные поля из кэша 7.2.
   * @param {{ objectId: string; parameterCode: string; parameterType: string; businessBlock: string; status: string; version: number | null }} row
   * @param {"code" | "objectId"} from
   */
  function applyUpdateFormByActualMapping(row, from) {
    if (from === "code") {
      if (uObjectId.value.trim() !== row.objectId) uObjectId.value = row.objectId;
    } else {
      if (uCode.value.trim() !== row.parameterCode) uCode.value = row.parameterCode;
    }
    if (row.parameterType) uType.value = row.parameterType;
    uBusinessBlock.value = row.businessBlock || "";
    if (row.status) uStatus.value = row.status;
    if (row.version !== null && Number.isFinite(row.version)) {
      uVersion.value = String(row.version);
      uVersionInfo.textContent = "Версия из шага 7.2: " + String(row.version) + " (можно изменить вручную).";
    } else {
      uVersionInfo.textContent = "Версия не найдена в шаге 7.2 — будет получена по objectId перед отправкой.";
    }
  }

  /**
   * Очищает связанные автополя, когда введённый objectId/parameterCode не найден в кэше.
   * @param {"code" | "objectId"} source
   */
  function clearUpdateFormDerivedFields(source) {
    if (source === "code") {
      uObjectId.value = "";
    } else {
      uCode.value = "";
    }
    uType.value = "";
    uBusinessBlock.value = "";
    uStatus.value = "ACTUAL";
    uVersion.value = "";
    uName.value = "";
    uValue.value = "";
    uVersionInfo.textContent = "Связанные данные не найдены в ACTUAL для введённого значения.";
  }

  /**
   * Читает первую запись details-ответа по objectId для автоподстановки полей формы.
   * @param {unknown} detailData
   * @returns {{ objectId: string; parameterCode: string; parameterType: string; businessBlock: string; parameterName: string; parameterValue: string; status: string; version: number | null } | null}
   */
  function readFirstParameterRowFromDetail(detailData) {
    const body = detailData && typeof detailData === "object" ? /** @type {Record<string, unknown>} */ (detailData).body : null;
    const params = body && Array.isArray(body.parameters) ? /** @type {unknown[]} */ (body.parameters) : [];
    const first = params[0];
    if (!first || typeof first !== "object") return null;
    const rec = /** @type {Record<string, unknown>} */ (first);
    const objectId = typeof rec.objectId === "string" ? rec.objectId.trim() : "";
    const parameterCode = typeof rec.parameterCode === "string" ? rec.parameterCode.trim() : "";
    const parameterType = typeof rec.parameterType === "string" ? rec.parameterType.trim() : "";
    const businessBlock = typeof rec.businessBlock === "string" ? rec.businessBlock.trim() : "";
    const parameterName = typeof rec.parameterName === "string" ? rec.parameterName : "";
    const status = typeof rec.status === "string" ? rec.status.trim() : "";
    let parameterValue = "";
    if (typeof rec.parameterValue === "string") {
      parameterValue = rec.parameterValue;
    } else if (rec.parameterValue !== undefined && rec.parameterValue !== null) {
      try {
        parameterValue = JSON.stringify(rec.parameterValue, null, 2);
      } catch {
        parameterValue = String(rec.parameterValue);
      }
    }
    const version = readVersionFromDetailResponse(detailData);
    return { objectId, parameterCode, parameterType, businessBlock, parameterName, parameterValue, status, version };
  }

  /**
   * Нормализованный набор полей для сравнения «до/после» перед param-update.
   * @param {{ objectId: string; parameterCode: string; parameterType: string; businessBlock: string; parameterName: string; parameterValue: string; status: string }} row
   * @returns {{ objectId: string; parameterCode: string; parameterType: string; businessBlock: string; parameterName: string; parameterValue: string; status: string }}
   */
  function toComparableUpdateFields(row) {
    return {
      objectId: String(row.objectId || "").trim(),
      parameterCode: String(row.parameterCode || "").trim(),
      parameterType: String(row.parameterType || "").trim(),
      businessBlock: String(row.businessBlock || "").trim(),
      parameterName: String(row.parameterName || "").trim(),
      parameterValue: String(row.parameterValue == null ? "" : row.parameterValue),
      status: String(row.status || "").trim(),
    };
  }

  /**
   * Какие поля реально изменились относительно текущей записи из API.
   * @param {{ objectId: string; parameterCode: string; parameterType: string; businessBlock: string; parameterName: string; parameterValue: string; status: string }} nextRow
   * @param {{ objectId: string; parameterCode: string; parameterType: string; businessBlock: string; parameterName: string; parameterValue: string; status: string }} currentRow
   * @returns {string[]}
   */
  function diffUpdateFields(nextRow, currentRow) {
    const a = toComparableUpdateFields(nextRow);
    const b = toComparableUpdateFields(currentRow);
    /** @type {string[]} */
    const changed = [];
    if (a.objectId !== b.objectId) changed.push("objectId");
    if (a.parameterCode !== b.parameterCode) changed.push("parameterCode");
    if (a.parameterType !== b.parameterType) changed.push("parameterType");
    if (a.businessBlock !== b.businessBlock) changed.push("businessBlock");
    if (a.parameterName !== b.parameterName) changed.push("parameterName");
    if (a.parameterValue !== b.parameterValue) changed.push("parameterValue");
    if (a.status !== b.status) changed.push("status");
    return changed;
  }

  /**
   * Изменения только по редактируемым полям param-update.
   * @param {{ parameterType: string; businessBlock: string; parameterName: string; parameterValue: string; status: string }} nextRow
   * @param {{ parameterType: string; businessBlock: string; parameterName: string; parameterValue: string; status: string }} currentRow
   * @returns {string[]}
   */
  function diffEditableUpdateFields(nextRow, currentRow) {
    /** @type {string[]} */
    const changed = [];
    if (String(nextRow.parameterType || "").trim() !== String(currentRow.parameterType || "").trim()) {
      changed.push("parameterType");
    }
    if (String(nextRow.businessBlock || "").trim() !== String(currentRow.businessBlock || "").trim()) {
      changed.push("businessBlock");
    }
    if (String(nextRow.parameterName || "").trim() !== String(currentRow.parameterName || "").trim()) {
      changed.push("parameterName");
    }
    if (String(nextRow.parameterValue == null ? "" : nextRow.parameterValue) !== String(currentRow.parameterValue == null ? "" : currentRow.parameterValue)) {
      changed.push("parameterValue");
    }
    if (String(nextRow.status || "").trim() !== String(currentRow.status || "").trim()) {
      changed.push("status");
    }
    return changed;
  }

  /**
   * Красивое окно подтверждения param-update: показывает только parameterCode и реально изменённые поля.
   * @param {{ parameterCode: string }} meta
   * @param {{ [k: string]: string }} oldValues
   * @param {{ [k: string]: string }} newValues
   * @param {string[]} changedFields
   * @returns {Promise<boolean>}
   */
  function showUpdateConfirmDialog(meta, oldValues, newValues, changedFields) {
    return new Promise(function (resolve) {
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;";

      const box = document.createElement("div");
      box.style.cssText =
        "width:min(1200px,96vw);max-height:min(88vh,980px);overflow:auto;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:12px;box-shadow:0 20px 45px rgba(0,0,0,.45);";

      const head = document.createElement("div");
      head.style.cssText = "padding:14px 16px;border-bottom:1px solid #374151;";
      const title = document.createElement("div");
      title.style.cssText = "font-size:15px;font-weight:700;color:#f9fafb;";
      title.textContent = "Подтверждение изменений (param-update)";
      const code = document.createElement("div");
      code.style.cssText = "margin-top:6px;font-size:13px;color:#cbd5e1;word-break:break-word;";
      code.textContent = "parameterCode: " + String(meta.parameterCode || "");
      head.appendChild(title);
      head.appendChild(code);

      const body = document.createElement("div");
      body.style.cssText = "padding:12px 16px;";
      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;table-layout:fixed;";
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      ["Поле", "Было", "Стало"].forEach(function (txt) {
        const th = document.createElement("th");
        th.textContent = txt;
        th.style.cssText =
          "text-align:left;padding:8px 10px;border-bottom:1px solid #374151;color:#93c5fd;font-size:12px;font-weight:700;vertical-align:top;";
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (let i = 0; i < changedFields.length; i++) {
        const k = changedFields[i];
        const tr = document.createElement("tr");
        const tdKey = document.createElement("td");
        tdKey.textContent = k;
        tdKey.style.cssText =
          "padding:9px 10px;border-bottom:1px solid #1f2937;color:#e5e7eb;font-size:12px;font-weight:600;vertical-align:top;word-break:break-word;";
        const tdOld = document.createElement("td");
        tdOld.textContent = String(oldValues[k] == null ? "" : oldValues[k]);
        tdOld.style.cssText =
          "padding:9px 10px;border-bottom:1px solid #1f2937;color:#fca5a5;font-size:12px;white-space:pre-wrap;word-break:break-word;vertical-align:top;";
        const tdNew = document.createElement("td");
        tdNew.textContent = String(newValues[k] == null ? "" : newValues[k]);
        tdNew.style.cssText =
          "padding:9px 10px;border-bottom:1px solid #1f2937;color:#86efac;font-size:12px;white-space:pre-wrap;word-break:break-word;vertical-align:top;";
        tr.appendChild(tdKey);
        tr.appendChild(tdOld);
        tr.appendChild(tdNew);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      body.appendChild(table);

      const footer = document.createElement("div");
      footer.style.cssText =
        "display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #374151;position:sticky;bottom:0;background:#111827;";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Отмена";
      cancelBtn.style.cssText =
        "border:1px solid #4b5563;border-radius:8px;padding:8px 12px;cursor:pointer;background:#1f2937;color:#e5e7eb;font-size:12px;font-weight:600;";
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.textContent = "Подтвердить";
      okBtn.style.cssText =
        "border:1px solid #065f46;border-radius:8px;padding:8px 12px;cursor:pointer;background:#059669;color:#ecfeff;font-size:12px;font-weight:700;";
      footer.appendChild(cancelBtn);
      footer.appendChild(okBtn);

      box.appendChild(head);
      box.appendChild(body);
      box.appendChild(footer);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      let done = false;
      function finish(val) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(val);
      }
      function onKey(e) {
        if (e.key === "Escape") finish(false);
      }
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) finish(false);
      });
      cancelBtn.addEventListener("click", function () {
        finish(false);
      });
      okBtn.addEventListener("click", function () {
        finish(true);
      });
      document.addEventListener("keydown", onKey);
      okBtn.focus();
    });
  }

  /**
   * Широкое окно подтверждения создания параметра в общем стиле панели.
   * Показывает все поля будущего param-create.
   * @param {{ parameterCode: string; parameterType: string; parameterName: string; businessBlock: string; parameterValue: string }} payload
   * @returns {Promise<boolean>}
   */
  function showCreateConfirmDialog(payload) {
    return new Promise(function (resolve) {
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;";

      const box = document.createElement("div");
      box.style.cssText =
        "width:min(1200px,96vw);max-height:min(88vh,980px);overflow:auto;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:12px;box-shadow:0 20px 45px rgba(0,0,0,.45);";

      const head = document.createElement("div");
      head.style.cssText = "padding:14px 16px;border-bottom:1px solid #374151;";
      const title = document.createElement("div");
      title.style.cssText = "font-size:15px;font-weight:700;color:#f9fafb;";
      title.textContent = "Подтверждение создания (param-create)";
      head.appendChild(title);

      const body = document.createElement("div");
      body.style.cssText = "padding:12px 16px;display:grid;grid-template-columns:minmax(180px,220px) 1fr;gap:8px 12px;";

      function appendRow(label, value, accent) {
        const k = document.createElement("div");
        k.textContent = label;
        k.style.cssText = "color:#93c5fd;font-size:12px;font-weight:700;align-self:start;";
        const v = document.createElement("div");
        v.textContent = value;
        v.style.cssText =
          "font-size:12px;white-space:pre-wrap;word-break:break-word;padding:8px 10px;border:1px solid #1f2937;border-radius:8px;background:#0b1220;" +
          (accent ? "color:" + accent + ";" : "color:#e5e7eb;");
        body.appendChild(k);
        body.appendChild(v);
      }

      appendRow("parameterCode", String(payload.parameterCode || ""), "#fde68a");
      appendRow("parameterType", String(payload.parameterType || ""), "#86efac");
      appendRow("parameterName", String(payload.parameterName || ""), "");
      appendRow("businessBlock", String(payload.businessBlock || "—"), "#c4b5fd");
      appendRow("parameterValue", String(payload.parameterValue == null ? "" : payload.parameterValue), "");

      const footer = document.createElement("div");
      footer.style.cssText =
        "display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #374151;position:sticky;bottom:0;background:#111827;";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Отмена";
      cancelBtn.style.cssText =
        "border:1px solid #4b5563;border-radius:8px;padding:8px 12px;cursor:pointer;background:#1f2937;color:#e5e7eb;font-size:12px;font-weight:600;";
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.textContent = "Создать";
      okBtn.style.cssText =
        "border:1px solid #065f46;border-radius:8px;padding:8px 12px;cursor:pointer;background:#059669;color:#ecfeff;font-size:12px;font-weight:700;";
      footer.appendChild(cancelBtn);
      footer.appendChild(okBtn);

      box.appendChild(head);
      box.appendChild(body);
      box.appendChild(footer);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      let done = false;
      function finish(val) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(val);
      }
      function onKey(e) {
        if (e.key === "Escape") finish(false);
      }
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) finish(false);
      });
      cancelBtn.addEventListener("click", function () {
        finish(false);
      });
      okBtn.addEventListener("click", function () {
        finish(true);
      });
      document.addEventListener("keydown", onKey);
      okBtn.focus();
    });
  }

  /** @type {number | null} */
  let editAutofillTimer = null;
  let editAutofillRequestSeq = 0;

  /**
   * Запрашивает детализацию по objectId и подставляет parameterName/parameterValue и связанные поля.
   * @param {string} objectId
   * @param {string} reason
   * @returns {Promise<void>}
   */
  async function fetchAndApplyDetailByObjectId(objectId, reason) {
    const id = String(objectId || "").trim();
    if (!id) return;
    const reqSeq = ++editAutofillRequestSeq;
    try {
      const origin = getOrigin(standSel.value, contourSel.value);
      const det = await postParameters(origin, { objectIds: [id] });
      if (reqSeq !== editAutofillRequestSeq) return;
      if (!det.ok) {
        log("[Редактирование] Автозаполнение по objectId=" + id + " (" + reason + "): HTTP " + det.status + ".");
        return;
      }
      const row = readFirstParameterRowFromDetail(det.data);
      if (!row) return;
      if (row.objectId) uObjectId.value = row.objectId;
      if (row.parameterCode) uCode.value = row.parameterCode;
      if (row.parameterType) uType.value = row.parameterType;
      uBusinessBlock.value = row.businessBlock || "";
      if (row.status) uStatus.value = row.status;
      uName.value = row.parameterName;
      uValue.value = row.parameterValue;
      if (row.version !== null && Number.isFinite(row.version)) {
        uVersion.value = String(row.version);
        uVersionInfo.textContent = "Версия из детализации по objectId: " + String(row.version) + " (можно изменить вручную).";
      }
    } catch (e) {
      log("[Редактирование] Ошибка автозаполнения по objectId: " + (e && e.message ? e.message : String(e)));
    }
  }

  /**
   * Дебаунс автозапроса детализации, чтобы не спамить API на каждый символ.
   * @param {string} objectId
   * @param {string} reason
   */
  function scheduleDetailFillByObjectId(objectId, reason) {
    const id = String(objectId || "").trim();
    if (!id) return;
    if (editAutofillTimer !== null) {
      clearTimeout(editAutofillTimer);
    }
    editAutofillTimer = setTimeout(function () {
      editAutofillTimer = null;
      fetchAndApplyDetailByObjectId(id, reason);
    }, 220);
  }

  function tryFillByParameterCodeInput() {
    const code = uCode.value.trim();
    if (!code || cachedActualByCode.size === 0) return;
    const row = cachedActualByCode.get(code);
    if (!row) {
      clearUpdateFormDerivedFields("code");
      return;
    }
    applyUpdateFormByActualMapping(row, "code");
    scheduleDetailFillByObjectId(row.objectId, "выбор parameterCode");
  }

  function tryFillByObjectIdInput() {
    const objectId = uObjectId.value.trim();
    if (!objectId || cachedActualByObjectId.size === 0) return;
    const row = cachedActualByObjectId.get(objectId);
    if (!row) {
      clearUpdateFormDerivedFields("objectId");
      return;
    }
    applyUpdateFormByActualMapping(row, "objectId");
    scheduleDetailFillByObjectId(objectId, "ввод objectId");
  }

  function refreshEditFilterOptions() {
    if (!cachedActualParameterCodes) return;
    function normalizeSelectedFilterValue(v) {
      const s = String(v == null ? "" : v).trim();
      if (!s) return "";
      const low = s.toLowerCase();
      if (low.indexOf("—") >= 0 || low.indexOf("выберите") >= 0 || low.indexOf("необязательно") >= 0) return "";
      return s;
    }
    const selectedType = normalizeSelectedFilterValue(uType.value);
    const selectedBb = normalizeSelectedFilterValue(uBusinessBlock.value);

    /** @type {Set<string>} */
    const allTypes = new Set();
    /** @type {Set<string>} */
    const allBbs = new Set();
    /** @type {Set<string>} */
    const allowedTypes = new Set();
    /** @type {Set<string>} */
    const allowedBbs = new Set();
    cachedActualByCode.forEach(function (row) {
      const t = String(row && row.parameterType ? row.parameterType : "").trim();
      const bb = String(row && row.businessBlock ? row.businessBlock : "").trim();
      if (t) allTypes.add(t);
      if (bb) allBbs.add(bb);
      const typeOk = !selectedType || t === selectedType;
      const bbOk = !selectedBb || bb === selectedBb;
      if (typeOk && bb) allowedBbs.add(bb);
      if (bbOk && t) allowedTypes.add(t);
    });

    const typeValid = !selectedType || allTypes.has(selectedType);
    const bbValid = !selectedBb || allBbs.has(selectedBb);

    if (typeValid && bbValid) {
      fillParameterTypeSelectWithApiValues(uType, Array.from(allowedTypes), true);
      if (selectedType && allowedTypes.has(selectedType)) uType.value = selectedType;
      fillBusinessBlockSelect(uBusinessBlock, Array.from(allowedBbs));
      if (selectedBb && allowedBbs.has(selectedBb)) uBusinessBlock.value = selectedBb;
    } else {
      // Если фильтр введён некорректно/не существует, показываем полные списки и не ограничиваем parameterCode.
      fillParameterTypeSelectWithApiValues(uType, Array.from(allTypes), true);
      fillBusinessBlockSelect(uBusinessBlock, Array.from(allBbs));
      if (selectedType && allTypes.has(selectedType)) uType.value = selectedType;
      if (selectedBb && allBbs.has(selectedBb)) uBusinessBlock.value = selectedBb;
    }

    fillParameterCodeSelectFromActualCodes(
      uCode,
      uCodeList,
      cachedActualParameterCodes,
      typeValid && selectedType ? selectedType : undefined,
      bbValid && selectedBb ? selectedBb : undefined,
      uCodePicker,
    );
  }

  uCode.addEventListener("input", tryFillByParameterCodeInput);
  uCode.addEventListener("change", tryFillByParameterCodeInput);
  uCodePicker.addEventListener("change", function () {
    const code = String(uCodePicker.value || "").trim();
    if (!code) return;
    uCode.value = code;
    tryFillByParameterCodeInput();
  });
  uObjectId.addEventListener("input", tryFillByObjectIdInput);
  uObjectId.addEventListener("change", tryFillByObjectIdInput);
  uType.addEventListener("change", refreshEditFilterOptions);
  uBusinessBlock.addEventListener("change", refreshEditFilterOptions);

  /**
   * Смена стенда/контура — сброс кэшей, селект создания и пустые селекты вкладки «Редактирование».
   */
  function invalidateParameterCachesOnEnvChange() {
    cachedActualParameterCodes = null;
    cachedActualObjectIds = null;
    cachedActualByCode = new Map();
    cachedActualByObjectId = new Map();
    cachedAllowedParameterTypes = null;
    cachedAllowedBusinessBlocks = null;
    editTabAllowedListsLoaded = false;
    fillParameterTypeSelect(cType);
    fillBusinessBlockSelect(cBusinessBlock, null);
    clearEditTabParameterSelects(uCode, uCodeList, uType, uCodePicker);
    fillBusinessBlockSelect(uBusinessBlock, null);
    uVersion.value = "";
    uVersionInfo.textContent = "";
    if (editAutofillTimer !== null) {
      clearTimeout(editAutofillTimer);
      editAutofillTimer = null;
    }
    refreshEnvInfo();
  }

  standSel.addEventListener("change", invalidateParameterCachesOnEnvChange);
  contourSel.addEventListener("change", invalidateParameterCachesOnEnvChange);
  refreshEnvInfo();

  tabPanels.push(tab1, tab2, tab3);
  wrap.appendChild(tab1);
  wrap.appendChild(tab2);
  wrap.appendChild(tab3);
  showTab(0);

  const logTitle = document.createElement("div");
  logTitle.textContent = "Журнал работы";
  logTitle.style.cssText =
    "margin-top:6px;font-weight:600;font-size:" + PANEL_FONT_BASE + ";color:#f9fafb;flex-shrink:0;";
  panel.appendChild(logTitle);

  const logBox = document.createElement("pre");
  // Журнал растягивается на оставшуюся высоту панели (не одна строка).
  logBox.style.cssText = [
    "flex:0 0 auto",
    "height:" + PANEL_LOG_HEIGHT_CSS,
    "min-height:" + PANEL_LOG_MIN_HEIGHT_PX + "px",
    "margin:4px 0 0",
    "padding:6px",
    "background:#0b1220",
    "border:1px solid #374151",
    "border-radius:8px",
    "overflow:auto",
    "white-space:pre-wrap",
    "word-break:break-word",
    "font:" + PANEL_FONT_SMALL + "/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
    "color:#e5e7eb",
  ].join(";");
  panel.appendChild(logBox);

  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;gap:6px;margin-top:6px;flex-shrink:0;";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Закрыть панель";
  closeBtn.style.cssText =
    "flex:1;border:1px solid #374151;border-radius:6px;padding:6px 8px;cursor:pointer;background:#1f2937;color:#e5e7eb;font-size:" +
    PANEL_FONT_BASE +
    ";";
  footer.appendChild(closeBtn);
  panel.appendChild(footer);

  document.body.appendChild(panel);

  /** @type {boolean} */
  let busy = false;

  /**
   * @param {string} msg
   */
  function log(msg) {
    const line = new Date().toISOString() + " — " + msg;
    const lines = (logBox.textContent ? logBox.textContent.split("\n") : []).concat(line);
    while (lines.length > LOG_MAX_LINES) lines.shift();
    logBox.textContent = lines.join("\n");
    logBox.scrollTop = logBox.scrollHeight;
    // Кратко в консоль только ошибки верхнего уровня
    if (msg.indexOf("Ошибка") >= 0 || msg.indexOf("ошибка") >= 0) {
      console.warn("[Parameters panel]", msg);
    }
  }

  /**
   * @param {boolean} v
   */
  function setBusy(v) {
    busy = v;
    runBtn.disabled = v;
    createBtn.disabled = v;
    createFileBtn.disabled = v;
    updateBtn.disabled = v;
    updateFileBtn.disabled = v;
    templateExportBtn.disabled = v;
    standSel.disabled = v;
    contourSel.disabled = v;
    statusSel.disabled = v;
    delayInput.disabled = v;
    tab1Btn.disabled = v;
    tab2Btn.disabled = v;
    tab3Btn.disabled = v;
    sharedLoadBtn.disabled = v;
    cCode.disabled = v;
    cType.disabled = v;
    cBusinessBlock.disabled = v;
    cName.disabled = v;
    cValue.disabled = v;
    uCode.disabled = v;
    uCodePicker.disabled = v;
    uType.disabled = v;
    uBusinessBlock.disabled = v;
    uName.disabled = v;
    uValue.disabled = v;
    uObjectId.disabled = v;
    uStatus.disabled = v;
    uVersion.disabled = v;
    refreshTypesBtn.disabled = v;
    editLoadBtn.disabled = v;
    runBtn.style.opacity = v ? "0.55" : "1";
    createBtn.style.opacity = v ? "0.55" : "1";
    createFileBtn.style.opacity = v ? "0.55" : "1";
    updateBtn.style.opacity = v ? "0.55" : "1";
    updateFileBtn.style.opacity = v ? "0.55" : "1";
    templateExportBtn.style.opacity = v ? "0.55" : "1";
    refreshTypesBtn.style.opacity = v ? "0.55" : "1";
    editLoadBtn.style.opacity = v ? "0.55" : "1";
    sharedLoadBtn.style.opacity = v ? "0.55" : "1";
  }

  closeBtn.addEventListener("click", () => panel.remove());

  /**
   * POST списка ACTUAL — всегда кладёт ответ в кэш (для кнопки ⬇ и принудительного обновления).
   * @param {string} origin
   * @param {boolean} verbose
   * @param {string} [logTag]
   * @returns {Promise<boolean>}
   */
  async function fetchActualListAndCache(origin, verbose, logTag) {
    const tag = logTag != null && String(logTag).trim() !== "" ? String(logTag).trim() : "[Создание]";
    if (verbose) {
      log(tag + ' Шаг 1/2: POST { "status": "ACTUAL" } — кэш parameterCode…');
    }
    const listRes = await postParameters(origin, { status: "ACTUAL" });
    if (!listRes.ok) {
      log(tag + " Ошибка списка ACTUAL: HTTP " + listRes.status + " — " + listRes.text.slice(0, 400));
      return false;
    }
    const listData = listRes.data;
    cachedActualParameterCodes = extractParameterCodesFromListData(listData);
    cachedActualObjectIds = new Set(extractObjectIds(listData));
    cachedAllowedBusinessBlocks = extractBusinessBlocksFromListData(listData);
    fillBusinessBlockSelect(cBusinessBlock, cachedAllowedBusinessBlocks);
    fillBusinessBlockSelect(uBusinessBlock, cachedAllowedBusinessBlocks);
    if (cachedAllowedParameterTypes === null || cachedAllowedParameterTypes.length === 0) {
      cachedAllowedParameterTypes = extractParameterTypesFromListData(listData);
    }
    const mappings = extractActualMappingsFromListData(listData);
    cachedActualByCode = mappings.byCode;
    cachedActualByObjectId = mappings.byObjectId;
    const rows = countParametersRowsInResponse(listData);
    if (verbose) {
      log(
        tag +
          " Шаг 1/2: HTTP " +
          listRes.status +
          ", строк в body.parameters: " +
          rows +
          ", parameterCode в кэше: " +
          cachedActualParameterCodes.size +
          ", objectId в кэше: " +
          cachedActualObjectIds.size +
          ".",
      );
    }
    return true;
  }

  /**
   * Одна детализация по PARAMETER_TYPES_DETAIL_OBJECT_ID — допустимые parameterType в кэш и селект создания (вкладка 2).
   * Селекты вкладки «Редактирование» заполняются только кнопкой загрузки на вкладке 3.
   * @param {string} origin
   * @param {boolean} verbose
   * @param {string} [logTag]
   * @returns {Promise<void>}
   */
  async function fetchParameterTypesDetailAndApply(origin, verbose, logTag) {
    const tag = logTag != null && String(logTag).trim() !== "" ? String(logTag).trim() : "[Создание]";
    const metaObjectId = getParameterTypesDetailObjectId(standSel.value);
    if (verbose) {
      log(
        tag +
          ' Шаг 2/2: POST { "objectIds": ["' +
          metaObjectId +
          '"] } — ожидается parameterCode=«' +
          PARAMETER_TYPES_META_CODE +
          "»…",
      );
    }
    const dr = await postParameters(origin, { objectIds: [metaObjectId] });
    if (!dr.ok) {
      log(tag + " Ошибка детализации: HTTP " + dr.status + " — " + dr.text.slice(0, 400));
      log(tag + " Шаг 2/2 пропущен: используются данные шага 1 (без дополнения типами из детализации).");
      return;
    }
    const typesFromMeta = extractTypesFromParameterTypesDetail(dr.data);
    if (!hasParameterTypesMetaInDetail(dr.data)) {
      const codeIn = readParameterCodeFromDetailResponse(dr.data);
      log(
        tag +
          " В ответе нет записи с parameterCode=«" +
          PARAMETER_TYPES_META_CODE +
          "» (первая строка: «" +
          (codeIn != null && codeIn !== "" ? codeIn : "—") +
          "»). Список типов из API не применён — PARAMETER_TYPE_OPTIONS на вкладке «Создание».",
      );
      log(tag + " Шаг 2/2 без дополнения: продолжаем со списком из шага 1.");
      return;
    }
    const merged = Array.from(new Set(typesFromMeta)).sort(function (a, b) {
      return a.localeCompare(b, "ru");
    });
    if (merged.length === 0) {
      log(
        tag +
          " Запись «" +
          PARAMETER_TYPES_META_CODE +
          "» найдена, но массив types пуст — оставлены PARAMETER_TYPE_OPTIONS на вкладке «Создание».",
      );
      log(tag + " Шаг 2/2 без дополнения: используются значения шага 1.");
    } else {
      cachedAllowedParameterTypes = merged;
      if (verbose) {
        log(tag + " Готово: уникальных parameterType из «" + PARAMETER_TYPES_META_CODE + ".types»: " + merged.length + ".");
      }
    }
    if (cachedAllowedParameterTypes !== null && cachedAllowedParameterTypes.length > 0) {
      fillParameterTypeSelectWithApiValues(cType, cachedAllowedParameterTypes);
    } else {
      fillParameterTypeSelect(cType);
    }
    rebuildTemplateFilterCheckboxes();
  }

  /**
   * Перед созданием (форма или файл): шаг 6.1 — если кэш уже заполнен кнопкой ⬇, повторно ACTUAL не запрашиваем;
   * иначе один раз POST ACTUAL (п.2) и при необходимости детализация типов.
   * @returns {Promise<boolean>} false — нельзя продолжать (ошибка ACTUAL).
   */
  async function ensureCachesForCreateOperation() {
    if (cachedActualParameterCodes !== null && cachedAllowedParameterTypes !== null && cachedAllowedParameterTypes.length > 0) {
      log("[Создание] Общий кэш уже загружен — используется для вкладки создания.");
      return true;
    }
    log("[Создание] Общий кэш не готов — выполняется единая загрузка параметров.");
    return await refreshSharedParameterListsFromApi("[Создание]");
  }

  /**
   * Кнопка ⬇: принудительное обновление — всегда ACTUAL + детализация (param-create не вызывается).
   */
  async function refreshParameterTypesFromApi() {
    if (busy) return;
    setBusy(true);
    try {
      const origin = getOrigin(standSel.value, contourSel.value);
      log("[Создание] Обновление списка допустимых parameterType (без param-create, без обхода всех objectId).");
      const ok = await fetchActualListAndCache(origin, true);
      if (!ok) return;
      await fetchParameterTypesDetailAndApply(origin, true);
    } catch (e) {
      log("[Создание] Ошибка загрузки типов: " + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Единая загрузка справочников для всех вкладок:
   * - ACTUAL (коды, objectId, businessBlock, кэш соответствий)
   * - детализация parameterTypes
   * После загрузки обновляет поля вкладок «Создание» и «Редактирование».
   * @param {string} logTag
   * @returns {Promise<boolean>}
   */
  async function refreshSharedParameterListsFromApi(logTag) {
    if (busy) return false;
    setBusy(true);
    try {
      const origin = getOrigin(standSel.value, contourSel.value);
      log(logTag + " Единая загрузка справочников: ACTUAL + детализация parameterTypes.");
      const ok = await fetchActualListAndCache(origin, true, logTag);
      if (!ok) return false;
      // Шаг 2 (детализация meta-parameterTypes) выполняется только для вкладки «Создание».
      // Для всех сценариев обновления параметров типы/проверки идут только по шагу 1 (ACTUAL).
      if (logTag === "[Создание]") {
        await fetchParameterTypesDetailAndApply(origin, true, logTag);
      } else {
        log(logTag + " Шаг 2/2 (детализация objectId) пропущен: для обновления типы и проверки берутся только из шага 1 ACTUAL.");
      }

      if (cachedActualParameterCodes !== null) {
        fillParameterCodeSelectFromActualCodes(uCode, uCodeList, cachedActualParameterCodes, undefined, undefined, uCodePicker);
      }
      if (cachedAllowedParameterTypes !== null && cachedAllowedParameterTypes.length > 0) {
        fillCreateTypeSelectWithDefaultsAndApi(cType, cachedAllowedParameterTypes);
      } else {
        fillCreateTypeSelectWithDefaultsAndApi(cType, []);
      }
      const editTypesFromStep1 = extractParameterTypesFromListData({ body: { parameters: Array.from(cachedActualByObjectId.values()) } });
      fillParameterTypeSelectWithApiValues(uType, editTypesFromStep1, true);
      const bbs = cachedAllowedBusinessBlocks || [];
      fillCreateBusinessBlockSelectWithDefaultsAndApi(cBusinessBlock, bbs);
      fillBusinessBlockSelect(uBusinessBlock, bbs);
      editTabAllowedListsLoaded = cachedActualParameterCodes !== null;
      refreshEditFilterOptions();
      rebuildTemplateFilterCheckboxes();
      tryFillByParameterCodeInput();
      tryFillByObjectIdInput();
      return true;
    } catch (e) {
      log(logTag + " Ошибка общей загрузки: " + (e && e.message ? e.message : String(e)));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Вкладка «3»: POST ACTUAL + детализация «parameterTypes» — только заполнение селектов parameterCode и parameterType (без param-update).
   * @returns {Promise<boolean>} true — справочники готовы (п. 7.1 / 7.2).
   */
  async function refreshEditTabAllowedListsFromApi() {
    const ok = await refreshSharedParameterListsFromApi("[Редактирование]");
    if (!ok) {
      editTabAllowedListsLoaded = false;
      clearEditTabParameterSelects(uCode, uCodeList, uType, uCodePicker);
    }
    return ok;
  }

  /**
   * Перед param-update: если справочники п. 7.1 не готовы — выполнить п. 7.2 (тот же поток, что кнопка ⬇).
   * @returns {Promise<boolean>}
   */
  async function ensureEditTabListsForUpdate() {
    if (editTabAllowedListsLoaded && cachedActualObjectIds !== null && cachedActualParameterCodes !== null) {
      return true;
    }
    log(
      "[Редактирование] Допустимые значения ещё не готовы — автоматически выполняется единая загрузка.",
    );
    const ok = await refreshSharedParameterListsFromApi("[Редактирование]");
    editTabAllowedListsLoaded = ok;
    return ok;
  }

  refreshTypesBtn.addEventListener("click", function () {
    refreshSharedParameterListsFromApi("[Создание]");
  });

  editLoadBtn.addEventListener("click", function () {
    refreshSharedParameterListsFromApi("[Редактирование]");
  });
  sharedLoadBtn.addEventListener("click", function () {
    refreshSharedParameterListsFromApi("[Общая загрузка]");
  });

  runBtn.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    log("[Выгрузка] Старт. Стенд: " + standSel.value + ", контур: " + contourSel.value + ".");
    try {
      const origin = getOrigin(standSel.value, contourSel.value);
      const status = statusSel.value;
      const delayMs = Math.max(0, Number(delayInput.value) || 0);
      const listPayload = { status };
      log(
        "[Выгрузка] Шаг 1/2: запрос списка параметров. POST " +
          origin +
          PARAMETERS_PATH +
          " | тело: " +
          JSON.stringify(listPayload) +
          " | пауза между детализациями: " +
          delayMs +
          " мс.",
      );

      const listRes = await postParameters(origin, listPayload);
      if (!listRes.ok) {
        log("[Выгрузка] Шаг 1/2: ошибка. HTTP " + listRes.status + " — фрагмент ответа: " + listRes.text.slice(0, 500));
        return;
      }
      const listData = listRes.data;
      const objectIds = extractObjectIds(listData);
      const rowsInList = countParametersRowsInResponse(listData);
      const succList = formatSuccessFieldForLog(listData);
      log(
        "[Выгрузка] Шаг 1/2: получен ответ HTTP " +
          listRes.status +
          ". Строк в body.parameters: " +
          rowsInList +
          ", уникальных objectId: " +
          objectIds.length +
          (succList !== null ? ", success=" + succList : "") +
          ".",
      );
      if (objectIds.length > 0) {
        const preview = objectIds.length <= 5 ? objectIds.join(", ") : objectIds.slice(0, 3).join(", ") + " … (всего " + objectIds.length + ")";
        log("[Выгрузка] objectId для детализации: " + preview + ".");
      } else {
        log("[Выгрузка] Шаг 2/2: детализировать нечего (список objectId пуст). Файл всё равно будет сохранён с пустым набором деталей.");
      }

      const details = [];
      let ok = 0;
      let fail = 0;
      const total = objectIds.length;
      for (let i = 0; i < objectIds.length; i++) {
        const id = objectIds[i];
        const num = i + 1;
        if (i > 0 && delayMs > 0) {
          log("[Выгрузка] Пауза " + delayMs + " мс перед запросом детали " + num + "/" + total + ".");
          await delay(delayMs);
        }
        const detailPayload = { objectIds: [id] };
        log(
          "[Выгрузка] Шаг 2/2: запрос детали " +
            num +
            " из " +
            total +
            ". POST " +
            origin +
            PARAMETERS_PATH +
            " | тело: " +
            JSON.stringify(detailPayload) +
            ".",
        );
        const dr = await postParameters(origin, detailPayload);
        details.push({ objectId: id, requestIndex: num, response: dr });
        if (dr.ok) {
          ok++;
          const code = readParameterCodeFromDetailResponse(dr.data);
          const succD = formatSuccessFieldForLog(dr.data);
          log(
            "[Выгрузка] Шаг 2/2: ответ по детали " +
              num +
              " из " +
              total +
              " — HTTP " +
              dr.status +
              " OK" +
              (code ? ", parameterCode=" + code : "") +
              (succD !== null ? ", success=" + succD : "") +
              ".",
          );
        } else {
          fail++;
          log(
            "[Выгрузка] Шаг 2/2: ошибка детали " +
              num +
              " из " +
              total +
              ", objectId=" +
              id +
              ": HTTP " +
              dr.status +
              " — фрагмент: " +
              dr.text.slice(0, 400),
          );
        }
      }

      const result = {
        meta: {
          exportedAt: new Date().toISOString(),
          stand: standSel.value,
          contour: contourSel.value,
          origin,
          parametersPath: PARAMETERS_PATH,
          listStatus: status,
          delayMsBetweenObjectIds: delayMs,
          objectIdsCount: objectIds.length,
          detailOk: ok,
          detailFail: fail,
        },
        list: listData,
        details,
      };

      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const fname =
        "parameters_" +
        standSel.value +
        "_" +
        contourSel.value +
        "_" +
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        ".json";
      downloadJson(fname, result);
      log(
        "[Выгрузка] Готово. Файл: " +
          fname +
          " | детализаций: всего " +
          total +
          ", успешно " +
          ok +
          ", с ошибкой " +
          fail +
          ".",
      );
    } catch (e) {
      log("Ошибка: " + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  });

  /**
   * @param {unknown} data
   * @returns {boolean}
   */
  function isSuccessTrue(data) {
    return !!(data && typeof data === "object" && /** @type {Record<string, unknown>} */ (data).success === true);
  }

  createBtn.addEventListener("click", async () => {
    if (busy) return;
    const payload = normalizeParameterRecordForApi({
      parameterCode: cCode.value.trim(),
      parameterType: cType.value.trim(),
      parameterName: cName.value.trim(),
      parameterValue: cValue.value,
      businessBlock: cBusinessBlock.value.trim(),
    });
    setBusy(true);
    try {
      const cachesOk = await ensureCachesForCreateOperation();
      if (!cachesOk) {
        log("[Создание] Не удалось подготовить данные для проверки (список ACTUAL). Создание не выполняется.");
        return;
      }
      const err = validateCreatePayload(payload);
      if (err) {
        log("Ошибка проверки полей и типа: " + err);
        return;
      }
      const jvErr = validateParameterValueJsonString(payload.parameterValue);
      if (jvErr) {
        log("Ошибка parameterValue: " + jvErr);
        return;
      }
      if (cachedActualParameterCodes && cachedActualParameterCodes.has(payload.parameterCode)) {
        log(
          "[Создание] Параметр с кодом «" +
            payload.parameterCode +
            "» уже есть в списке ACTUAL. Создание не выполняется — используйте вкладку «3. Редактирование» (param-update).",
        );
        return;
      }
    } catch (e) {
      log("Ошибка: " + (e && e.message ? e.message : String(e)));
      return;
    } finally {
      setBusy(false);
    }
    const approved = await showCreateConfirmDialog({
      parameterCode: payload.parameterCode,
      parameterType: payload.parameterType,
      parameterName: payload.parameterName,
      businessBlock: payload.businessBlock,
      parameterValue: payload.parameterValue,
    });
    if (!approved) {
      log("Создание отменено пользователем — запрос param-create не отправлялся.");
      return;
    }
    setBusy(true);
    try {
      const origin = getOrigin(standSel.value, contourSel.value);
      const res = await postJson(origin, PARAM_CREATE_PATH, payload);
      if (!res.ok) {
        log("Ошибка param-create: HTTP " + res.status + " — " + res.text.slice(0, 800));
        return;
      }
      if (isSuccessTrue(res.data)) {
        log("param-create: success=true, ответ получен.");
      } else {
        log("Ошибка param-create: success не true. Фрагмент ответа: " + JSON.stringify(res.data).slice(0, 1200));
      }
    } catch (e) {
      log("Ошибка: " + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  });

  createFileBtn.addEventListener("click", () => createFileInput.click());
  createFileInput.addEventListener("change", async () => {
    if (busy) return;
    const f = createFileInput.files && createFileInput.files[0];
    createFileInput.value = "";
    if (!f) return;
    setBusy(true);
    try {
      const cachesOk = await ensureCachesForCreateOperation();
      if (!cachesOk) {
        log("[Создание] Не удалось подготовить данные для проверки (список ACTUAL). Пакет из файла не выполняется.");
        return;
      }
      const text = await f.text();
      const parsed = parseJsonObjectsFromFileTextForBatch(text);
      if (parsed.error) {
        log("Ошибка файла: " + parsed.error);
        return;
      }
      const items = parsed.items;
      /** @type {Record<string, unknown>[]} */
      const prepared = [];
      for (let i = 0; i < items.length; i++) {
        const normalized = normalizeParameterRecordForApi(items[i]);
        const ve = validateCreatePayload(normalized);
        if (ve) {
          log("[Preflight] Ошибка записи #" + (i + 1) + ": " + ve);
          return;
        }
        const jvErr = validateParameterValueJsonString(normalized.parameterValue);
        if (jvErr) {
          log("[Preflight] Запись #" + (i + 1) + ": " + jvErr);
          return;
        }
        prepared.push(normalized);
      }
      if (prepared.length === 0) {
        log("В файле нет записей.");
        return;
      }
      const filtered = [];
      for (let fi = 0; fi < prepared.length; fi++) {
        const code = String(prepared[fi].parameterCode).trim();
        if (cachedActualParameterCodes && cachedActualParameterCodes.has(code)) {
          log(
            "[Создание] Файл, запись #" +
              (fi + 1) +
              ": код «" +
              code +
              "» уже есть в ACTUAL — пропуск (нужна вкладка «Редактирование», не создание).",
          );
          continue;
        }
        filtered.push(prepared[fi]);
      }
      if (filtered.length === 0) {
        log("[Создание] После проверки дублей со списком ACTUAL не осталось записей для создания.");
        return;
      }
      log("[Preflight] Файл: проверено записей " + prepared.length + ", к отправке (без дублей ACTUAL): " + filtered.length + ".");
      const first = filtered[0];
      const firstMsg =
        "Внести первый параметр из файла?\n\nparameterCode: " +
        first.parameterCode +
        "\nparameterType: " +
        first.parameterType +
        "\n\nОК — внести, Отмена — не вносить ни один.";
      if (!window.confirm(firstMsg)) {
        log("Пакетное создание отменено на первом шаге.");
        return;
      }
      let applyAll = false;
      if (filtered.length > 1) {
        applyAll = window.confirm(
          "В файле записей (без дублей ACTUAL): " +
            filtered.length +
            ". Внести остальные последовательно без дальнейших подтверждений?\n\nОК — да (все подряд), Отмена — спрашивать для каждой следующей.",
        );
      }
      const origin = getOrigin(standSel.value, contourSel.value);
      for (let i = 0; i < filtered.length; i++) {
        if (i > 0) {
          if (!applyAll) {
            const rec = filtered[i];
            const q =
              "Внести параметр #" +
              (i + 1) +
              "?\nparameterCode: " +
              rec.parameterCode +
              "\nparameterType: " +
              rec.parameterType;
            if (!window.confirm(q)) {
              log("Пропуск записи #" + (i + 1) + " (пользователь отказался).");
              continue;
            }
          }
          await delay(PARAM_BATCH_REQUEST_GAP_MS);
        }
        const payload = {
          parameterCode: String(filtered[i].parameterCode).trim(),
          parameterType: String(filtered[i].parameterType).trim(),
          parameterName: String(filtered[i].parameterName).trim(),
          parameterValue: String(filtered[i].parameterValue),
          businessBlock: String(filtered[i].businessBlock == null ? "" : filtered[i].businessBlock).trim(),
        };
        const res = await postJson(origin, PARAM_CREATE_PATH, payload);
        if (!res.ok) {
          log("Ошибка param-create #" + (i + 1) + ": HTTP " + res.status + " — " + res.text.slice(0, 500));
          continue;
        }
        if (isSuccessTrue(res.data)) {
          log("Запись #" + (i + 1) + " (" + payload.parameterCode + "): success=true.");
        } else {
          log(
            "Ошибка param-create #" +
              (i + 1) +
              ": success не true. Фрагмент ответа: " +
              JSON.stringify(res.data).slice(0, 600),
          );
        }
      }
      log("Пакетное создание из файла завершено.");
    } catch (e) {
      log("Ошибка: " + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  });

  updateBtn.addEventListener("click", async () => {
    if (busy) return;
    if (!(await ensureEditTabListsForUpdate())) {
      log("[Редактирование] Не удалось подготовить справочники для обновления.");
      return;
    }
    const objectId = uObjectId.value.trim();
    const payloadBase = normalizeParameterRecordForApi({
      parameterCode: uCode.value.trim(),
      parameterType: uType.value.trim(),
      parameterName: uName.value.trim(),
      parameterValue: uValue.value,
      businessBlock: uBusinessBlock.value.trim(),
      objectId,
      version: uVersion.value.trim() !== "" ? Number(uVersion.value.trim()) : 0,
      status: uStatus.value.trim(),
    });
    const err = validateUpdatePayload(payloadBase);
    if (err) {
      log("Ошибка проверки формы: " + err);
      return;
    }
    const jvErr = validateParameterValueJsonString(payloadBase.parameterValue);
    if (jvErr) {
      log("Ошибка parameterValue: " + jvErr);
      return;
    }
    if (!cachedActualObjectIds || !cachedActualObjectIds.has(objectId)) {
      log(
        "Ошибка: objectId «" +
          objectId +
          "» отсутствует среди сохранённых по первому запросу ACTUAL (п. 7.1). Проверьте ввод или окружение.",
      );
      return;
    }
    const parameterCode = payloadBase.parameterCode.trim();
    if (!cachedActualParameterCodes || !cachedActualParameterCodes.has(parameterCode)) {
      log(
        "[Редактирование] parameterCode «" +
          parameterCode +
          "» нет среди параметров ACTUAL — сущности для правки нет. Создайте параметр на вкладке «2. Создание» (param-create), а не редактирование.",
      );
      return;
    }
    const rowByObjectId = cachedActualByObjectId.get(objectId);
    if (rowByObjectId && rowByObjectId.parameterCode !== parameterCode) {
      log(
        "[Редактирование] Для objectId «" +
          objectId +
          "» в списке ACTUAL найден другой parameterCode: «" +
          rowByObjectId.parameterCode +
          "». Проверьте связку полей.",
      );
      return;
    }
    const rowByCode = cachedActualByCode.get(parameterCode);
    if (rowByCode && rowByCode.objectId !== objectId) {
      log(
        "[Редактирование] Для parameterCode «" +
          parameterCode +
          "» в списке ACTUAL найден другой objectId: «" +
          rowByCode.objectId +
          "». Проверьте связку полей.",
      );
      return;
    }
    setBusy(true);
    uVersionInfo.textContent = "";
    try {
      const origin = getOrigin(standSel.value, contourSel.value);
      const det = await postParameters(origin, { objectIds: [objectId] });
      if (!det.ok) {
        log("Ошибка детализации по objectId: HTTP " + det.status);
        return;
      }
      const currentRow = readFirstParameterRowFromDetail(det.data);
      if (!currentRow) {
        log("Ошибка: не удалось прочитать текущие данные параметра по objectId.");
        return;
      }
      if (currentRow.objectId !== objectId || currentRow.parameterCode !== payloadBase.parameterCode) {
        log(
          "Ошибка: комбинация objectId + parameterCode не подтверждена текущими данными API (objectId=" +
            objectId +
            ", parameterCode=" +
            payloadBase.parameterCode +
            ").",
        );
        return;
      }
      const verFromApi = currentRow.version;
      if (verFromApi === null || !Number.isFinite(verFromApi)) {
        log("Ошибка: не удалось прочитать version из ответа API по objectId.");
        return;
      }
      const hasManualVersion = uVersion.value.trim() !== "";
      if (hasManualVersion) {
        const vnCheck = Number(uVersion.value.trim());
        if (!Number.isFinite(vnCheck) || vnCheck < 0) {
          log("Ошибка: version в форме заполнен некорректно.");
          return;
        }
        if (vnCheck !== verFromApi) {
          log(
            "Ошибка: комбинация objectId + parameterCode + version не существует. Для objectId «" +
              objectId +
              "» и parameterCode «" +
              payloadBase.parameterCode +
              "» актуальная version из API = " +
              String(verFromApi) +
              ", в форме указано: " +
              String(vnCheck) +
              ".",
          );
          return;
        }
      }
      const changedEditable = diffEditableUpdateFields(payloadBase, currentRow);
      if (changedEditable.length === 0) {
        uVersionInfo.textContent = "Изменений нет: parameterType/businessBlock/parameterName/parameterValue/status совпадают с текущими.";
        log(
          "[Редактирование] Изменений по полям parameterType/businessBlock/parameterName/parameterValue/status для objectId «" +
            objectId +
            "» не найдено — param-update не отправляется.",
        );
        return;
      }
      let ver = verFromApi;
      if (hasManualVersion) {
        const vn = Number(uVersion.value.trim());
        if (Number.isFinite(vn) && vn >= 0) ver = vn;
      } else {
        uVersion.value = String(verFromApi);
      }
      uVersionInfo.textContent =
        "Версия для отправки: " +
        String(ver) +
        " (API=" +
        String(verFromApi) +
        "), изменены поля: " +
        changedEditable.join(", ") +
        ".";
      const approved = await showUpdateConfirmDialog(
        { parameterCode: payloadBase.parameterCode },
        {
          parameterType: currentRow.parameterType,
          businessBlock: currentRow.businessBlock,
          parameterName: currentRow.parameterName,
          parameterValue: currentRow.parameterValue,
          status: currentRow.status,
        },
        {
          parameterType: payloadBase.parameterType,
          businessBlock: payloadBase.businessBlock,
          parameterName: payloadBase.parameterName,
          parameterValue: payloadBase.parameterValue,
          status: payloadBase.status,
        },
        changedEditable,
      );
      if (!approved) {
        log("Обновление отменено пользователем.");
        return;
      }
      let body = {
        parameterCode: payloadBase.parameterCode,
        parameterType: payloadBase.parameterType,
        parameterName: payloadBase.parameterName,
        parameterValue: payloadBase.parameterValue,
        businessBlock: payloadBase.businessBlock,
        objectId: payloadBase.objectId,
        version: ver,
        status: payloadBase.status,
      };
      if (changedEditable.indexOf("status") >= 0) {
        body = { objectId: payloadBase.objectId, status: payloadBase.status, version: ver };
      }
      const res = await postJson(origin, PARAM_UPDATE_PATH, body);
      if (!res.ok) {
        log("Ошибка param-update: HTTP " + res.status + " — " + res.text.slice(0, 800));
        return;
      }
      if (isSuccessTrue(res.data)) {
        log("param-update: success=true, ответ получен.");
      } else {
        log("Ошибка param-update: success не true. Ответ: " + JSON.stringify(res.data).slice(0, 1200));
      }
    } catch (e) {
      log("Ошибка: " + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  });

  updateFileBtn.addEventListener("click", () => updateFileInput.click());
  templateExportBtn.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    try {
      const origin = getOrigin(standSel.value, contourSel.value);
      log("[Редактирование][Шаблон] Старт: список ACTUAL, затем ARCHIVE, далее детализация по каждому objectId.");

      const allIds = new Set();

      const actualOk = await fetchActualListAndCache(origin, true, "[Редактирование][Шаблон]");
      if (!actualOk) {
        log("[Редактирование][Шаблон] Ошибка шага ACTUAL — выгрузка шаблона остановлена.");
        return;
      }
      if (cachedActualObjectIds) {
        cachedActualObjectIds.forEach(function (id) {
          const row = cachedActualByObjectId.get(id);
          if (parameterTypeMatchesTemplateFilter(row ? row.parameterType : "")) {
            allIds.add(id);
          }
        });
      }
      log("[Редактирование][Шаблон] Шаг детализации parameterTypes пропущен: для шаблона достаточно данных шага ACTUAL/ARCHIVE.");

      log('[Редактирование][Шаблон] Шаг ARCHIVE: POST { "status": "ARCHIVE" }.');
      const archiveRes = await postParameters(origin, { status: "ARCHIVE" });
      if (!archiveRes.ok) {
        log("[Редактирование][Шаблон] ARCHIVE: HTTP " + archiveRes.status + " — " + archiveRes.text.slice(0, 400));
      } else {
        const archiveMappings = extractActualMappingsFromListData(archiveRes.data);
        archiveMappings.byObjectId.forEach(function (row, id) {
          if (parameterTypeMatchesTemplateFilter(row.parameterType)) {
            allIds.add(id);
          }
        });
        log(
          "[Редактирование][Шаблон] ARCHIVE objectId (с учётом фильтра type): " +
            archiveMappings.byObjectId.size +
            ".",
        );
      }

      const selectedTypes = getSelectedTemplateFilterTypes();
      if (selectedTypes.length > 0) {
        log("[Редактирование][Шаблон] Фильтр parameterType: " + selectedTypes.join(", ") + ".");
      }

      const ids = Array.from(allIds);
      if (ids.length === 0) {
        log("[Редактирование][Шаблон] objectId не найдены — файл шаблона не сформирован.");
        return;
      }
      log("[Редактирование][Шаблон] objectId для детализации: " + ids.length + ".");

      /** @type {Array<Record<string, unknown>>} */
      const payloadRows = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const det = await postParameters(origin, { objectIds: [id] });
        if (!det.ok) {
          log("[Редактирование][Шаблон] Детализация " + (i + 1) + "/" + ids.length + ": HTTP " + det.status + " (objectId=" + id + ").");
          continue;
        }
        const row = readFirstParameterRowFromDetail(det.data);
        if (!row) {
          log("[Редактирование][Шаблон] Детализация " + (i + 1) + "/" + ids.length + ": нет данных (objectId=" + id + ").");
          continue;
        }
        payloadRows.push({
          parameterCode: row.parameterCode,
          parameterType: row.parameterType,
          parameterName: row.parameterName,
          parameterValue: row.parameterValue,
          businessBlock: row.businessBlock || "",
          objectId: row.objectId,
          version: row.version === null ? 0 : row.version,
          status: row.status,
        });
      }

      if (payloadRows.length === 0) {
        log("[Редактирование][Шаблон] Валидные строки payload не собраны — файл не создан.");
        return;
      }

      const out = payloadRows
        .map(function (x) {
          return JSON.stringify(x, null, 2);
        })
        .join("\n\n");
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const fileName =
        "parameters_update_template_" +
        standSel.value +
        "_" +
        contourSel.value +
        "_" +
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        ".txt";
      downloadTextFile(fileName, out);
      log("[Редактирование][Шаблон] Готово: " + fileName + ", блоков: " + payloadRows.length + ".");
    } catch (e) {
      log("[Редактирование][Шаблон] Ошибка: " + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  });
  updateFileInput.addEventListener("change", async () => {
    if (busy) return;
    const f = updateFileInput.files && updateFileInput.files[0];
    updateFileInput.value = "";
    if (!f) return;
    try {
      if (!(await ensureEditTabListsForUpdate())) {
        log("[Редактирование] Не удалось подготовить справочники для пакетного обновления.");
        return;
      }
      setBusy(true);
      const text = await f.text();
      const parsed = parseJsonObjectsFromFileTextForBatch(text);
      if (parsed.error) {
        log("Ошибка файла: " + parsed.error);
        return;
      }
      const items = parsed.items;
      /** @type {Record<string, unknown>[]} */
      const prepared = [];
      for (let i = 0; i < items.length; i++) {
        const normalized = normalizeParameterRecordForApi(items[i]);
        const ve = validateUpdatePayload(normalized);
        if (ve) {
          log("[Preflight] Ошибка записи #" + (i + 1) + ": " + ve);
          return;
        }
        const jvErr = validateParameterValueJsonString(normalized.parameterValue);
        if (jvErr) {
          log("[Preflight] Запись #" + (i + 1) + ": " + jvErr);
          return;
        }
        prepared.push(normalized);
      }
      if (prepared.length === 0) {
        log("В файле нет записей.");
        return;
      }
      log("[Preflight] Файл: проверено записей " + prepared.length + ", все валидны — можно отправлять.");
      const valid = prepared;
      const first = valid[0];
      const firstMsg =
        "Обновить первый параметр из файла?\n\nobjectId: " +
        String(first.objectId) +
        "\nparameterCode: " +
        String(first.parameterCode) +
        "\n\nОК — выполнить для первого, Отмена — отменить весь пакет.\n(version из файла должен совпасть с API.)";
      if (!window.confirm(firstMsg)) {
        log("Пакетное обновление отменено на первом шаге.");
        return;
      }
      let applyAll = false;
      if (valid.length > 1) {
        applyAll = window.confirm(
          "В файле записей: " +
            valid.length +
            ". Обновлять остальные последовательно без подтверждений?\n\nОК — да, Отмена — спрашивать для каждой.",
        );
      }
      const origin = getOrigin(standSel.value, contourSel.value);
      for (let i = 0; i < valid.length; i++) {
        if (i > 0) {
          if (!applyAll) {
            const rec = valid[i];
            const q =
              "Обновить запись #" +
              (i + 1) +
              "?\nobjectId: " +
              String(rec.objectId) +
              "\nparameterCode: " +
              String(rec.parameterCode);
            if (!window.confirm(q)) {
              log("Пропуск записи #" + (i + 1) + " (пользователь отказался).");
              continue;
            }
          }
          await delay(PARAM_BATCH_REQUEST_GAP_MS);
        }
        const objectId = String(valid[i].objectId).trim();
        if (!cachedActualObjectIds || !cachedActualObjectIds.has(objectId)) {
          log(
            "Ошибка записи #" +
              (i + 1) +
              ": objectId «" +
              objectId +
              "» нет в сохранённом по п. 7.1 списке ACTUAL. Проверьте ID или окружение.",
          );
          continue;
        }
        const pc = String(valid[i].parameterCode).trim();
        if (!cachedActualParameterCodes || !cachedActualParameterCodes.has(pc)) {
          log(
            "[Редактирование] Запись #" +
              (i + 1) +
              ": parameterCode «" +
              pc +
              "» нет в ACTUAL — создайте на вкладке «2. Создание», не редактирование.",
          );
          continue;
        }
        const rowByObjectId = cachedActualByObjectId.get(objectId);
        if (rowByObjectId && rowByObjectId.parameterCode !== pc) {
          log(
            "Ошибка записи #" +
              (i + 1) +
              ": objectId «" +
              objectId +
              "» связан с другим parameterCode («" +
              rowByObjectId.parameterCode +
              "»).",
          );
          continue;
        }
        const rowByCode = cachedActualByCode.get(pc);
        if (rowByCode && rowByCode.objectId !== objectId) {
          log(
            "Ошибка записи #" +
              (i + 1) +
              ": parameterCode «" +
              pc +
              "» связан с другим objectId («" +
              rowByCode.objectId +
              "»).",
          );
          continue;
        }
        const det = await postParameters(origin, { objectIds: [objectId] });
        if (!det.ok) {
          log("Ошибка детализации для записи #" + (i + 1) + ": HTTP " + det.status);
          continue;
        }
        const currentRow = readFirstParameterRowFromDetail(det.data);
        if (!currentRow) {
          log("Ошибка записи #" + (i + 1) + ": не удалось прочитать текущие поля параметра из API.");
          continue;
        }
        const nextRow = {
          objectId,
          parameterCode: String(valid[i].parameterCode).trim(),
          parameterType: String(valid[i].parameterType).trim(),
          businessBlock: String(valid[i].businessBlock == null ? "" : valid[i].businessBlock).trim(),
          parameterName: String(valid[i].parameterName).trim(),
          parameterValue: String(valid[i].parameterValue == null ? "" : valid[i].parameterValue),
          status: String(valid[i].status).trim(),
        };
        if (currentRow.objectId !== objectId || currentRow.parameterCode !== nextRow.parameterCode) {
          log(
            "Ошибка записи #" +
              (i + 1) +
              ": комбинация objectId + parameterCode не подтверждена API (objectId=" +
              objectId +
              ", parameterCode=" +
              nextRow.parameterCode +
              ").",
          );
          continue;
        }
        const changedEditable = diffEditableUpdateFields(nextRow, currentRow);
        if (changedEditable.length === 0) {
          log(
            "[Редактирование] Запись #" +
              (i + 1) +
              " (" +
              nextRow.parameterCode +
              "): изменений по полям parameterType/businessBlock/parameterName/parameterValue/status нет — пропуск.",
          );
          continue;
        }
        const ver = currentRow.version;
        if (ver === null || !Number.isFinite(ver)) {
          log("Ошибка записи #" + (i + 1) + ": не удалось прочитать version из API.");
          continue;
        }
        const fileVersion = Number(valid[i].version);
        if (!Number.isFinite(fileVersion) || fileVersion < 0) {
          log("Ошибка записи #" + (i + 1) + ": version в файле некорректен.");
          continue;
        }
        if (fileVersion !== ver) {
          log(
            "Ошибка записи #" +
              (i + 1) +
              ": комбинация objectId + parameterCode + version не существует (файл=" +
              String(fileVersion) +
              ", API=" +
              String(ver) +
              ").",
          );
          continue;
        }
        let body = {
          parameterCode: nextRow.parameterCode,
          parameterType: nextRow.parameterType,
          parameterName: nextRow.parameterName,
          parameterValue: nextRow.parameterValue,
          businessBlock: nextRow.businessBlock,
          objectId,
          version: ver,
          status: nextRow.status,
        };
        if (changedEditable.indexOf("status") >= 0) {
          body = { objectId, status: nextRow.status, version: ver };
        }
        const res = await postJson(origin, PARAM_UPDATE_PATH, body);
        if (!res.ok) {
          log("Ошибка param-update #" + (i + 1) + ": HTTP " + res.status + " — " + res.text.slice(0, 500));
          continue;
        }
        if (isSuccessTrue(res.data)) {
          log("Запись #" + (i + 1) + " (" + body.parameterCode + ", objectId=" + objectId + "): success=true.");
        } else {
          log("Ошибка param-update #" + (i + 1) + ": success не true. " + JSON.stringify(res.data).slice(0, 600));
        }
      }
      log("Пакетное обновление из файла завершено.");
    } catch (e) {
      log("Ошибка: " + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  });

  console.log("[Parameters_Actual_Export] Панель открыта. Стенд/контур общие для всех вкладок.");
})();
