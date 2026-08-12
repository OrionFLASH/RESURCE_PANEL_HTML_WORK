// =============================================================================
// File_DB_Load_GP_v2.js — скачивание файлов gamification (v2: только «Скачать выделенное»)
// =============================================================================
// Отличия от File_DB_Load_GP.js:
// - нет одиночных кнопок «Скачать» и «Все N (рейтинг/заказы)»;
// - выбор чекбоксами: основные, рейтинг и заказы (блок → сезоны/listType);
// - конфиги FILE_DL_RATING_BLOCKS_CONFIG / FILE_DL_ORDERS_BLOCKS_CONFIG (defaultChecked на каждый элемент);
// - индикатор статуса и таймер мин:сек:мс у каждой задачи на панели.
// - добавлена выгрузка «Итоги года» (year-result/file-download).
// POST …/file-download, credentials: "include". Журнал — на панели.
// =============================================================================

// Весь исполняемый код ниже — в IIFE: повторная вставка скрипта в консоль без перезагрузки вкладки
// (нет ошибки повторного объявления const/let в глобальной области).
(function () {
  "use strict";


/**
 * DevToolsTrace — трассировка UI, HTTP и журнала для DevTools-скриптов (один файл → вставка в консоль).
 * Использование: createDevToolsTrace({ scriptId: "MyScript" }) → mountToggleRow, attachPanel, wrapFetch, log.
 */
/* DevToolsTrace v1 */
function createDevToolsTrace(opts) {
  "use strict";
  var scriptId = (opts && opts.scriptId) || "devtools_script";
  var maxBodyLen = (opts && opts.maxBodyLen) || 16384;
  var maxLines = (opts && opts.maxLines) || 8000;
  var enabled = false;
  /** @type {string[]} */
  var buffer = [];

  /**
   * @returns {string}
   */
  function isoNow() {
    return new Date().toISOString();
  }

  /**
   * @param {string} ts
   * @returns {string}
   */
  function fileTsFromIso(ts) {
    return ts.replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  }

  /**
   * @param {unknown} v
   * @returns {string}
   */
  function truncBody(v) {
    if (v == null) return "";
    var s = typeof v === "string" ? v : String(v);
    if (s.length <= maxBodyLen) return s;
    return s.slice(0, maxBodyLen) + "\n… [truncated " + (s.length - maxBodyLen) + " chars]";
  }

  /**
   * @param {string} kind
   * @param {string} message
   * @param {Record<string, unknown>|null} [detail]
   */
  function push(kind, message, detail) {
    if (!enabled) return;
    var line = isoNow() + " [" + kind + "] " + message;
    if (detail && typeof detail === "object") {
      try {
        line += " " + JSON.stringify(detail);
      } catch (_e) {
        line += " [detail unserializable]";
      }
    }
    buffer.push(line);
    if (buffer.length > maxLines) buffer = buffer.slice(buffer.length - maxLines);
  }

  /**
   * @param {boolean} on
   */
  function setEnabled(on) {
    var next = !!on;
    if (next === enabled) return;
    if (next) {
      enabled = true;
      push("SYS", "Trace ON script=" + scriptId);
      return;
    }
    push("SYS", "Trace OFF script=" + scriptId);
    enabled = false;
    if (buffer.length > 0) downloadLog();
    buffer = [];
  }

  function isEnabled() {
    return enabled;
  }

  /**
   * @param {string} msg
   */
  function log(msg) {
    push("LOG", String(msg));
  }

  /**
   * @param {string} action
   * @param {Record<string, unknown>|null} [detail]
   */
  function ui(action, detail) {
    push("UI", action, detail);
  }

  /**
   * @param {typeof fetch} nativeFetch
   * @returns {typeof fetch}
   */
  function wrapFetch(nativeFetch) {
    return async function tracedFetch(input, init) {
      if (!enabled) return nativeFetch(input, init);
      var url =
        typeof input === "string"
          ? input
          : input && typeof input === "object" && "url" in input
            ? String(input.url)
            : String(input);
      var method = (init && init.method) || "GET";
      var reqBody = init && init.body != null ? truncBody(init.body) : "";
      push("HTTP", "→ " + method + " " + url, reqBody ? { requestBody: reqBody } : null);
      var t0 = Date.now();
      var res = await nativeFetch(input, init);
      var ms = Date.now() - t0;
      var status = res.status;
      var respText = "";
      try {
        respText = truncBody(await res.clone().text());
      } catch (_e) {
        respText = "[body read error]";
      }
      push("HTTP", "← " + status + " " + method + " " + url + " " + ms + "ms", {
        responseBody: respText
      });
      return res;
    };
  }

  /**
   * @param {HTMLElement} panelRoot
   */
  function attachPanel(panelRoot) {
    if (!panelRoot || panelRoot.__devToolsTraceAttached) return;
    panelRoot.__devToolsTraceAttached = true;
    panelRoot.addEventListener(
      "click",
      function (ev) {
        if (!enabled) return;
        var t = ev.target;
        if (!(t instanceof Element)) return;
        var btn = t.closest("button");
        if (btn) {
          ui("click button", { text: (btn.textContent || "").trim().slice(0, 120) });
          return;
        }
        var cb = t.closest('input[type="checkbox"]');
        if (cb) {
          ui("click checkbox", { checked: cb.checked, label: (cb.parentElement && cb.parentElement.textContent || "").trim().slice(0, 80) });
          return;
        }
        var sel = t.closest("select");
        if (sel) {
          ui("change select", { value: sel.value });
        }
      },
      true
    );
    panelRoot.addEventListener(
      "change",
      function (ev) {
        if (!enabled) return;
        var t = ev.target;
        if (!(t instanceof HTMLInputElement && t.type === "file")) return;
        var names = [];
        if (t.files) {
          for (var i = 0; i < t.files.length; i++) names.push(t.files[i].name);
        }
        ui("file input", { files: names });
      },
      true
    );
  }

  /**
   * @param {HTMLElement} container
   * @param {HTMLElement|null} [beforeNode]
   * @returns {{ row: HTMLElement, checkbox: HTMLInputElement, saveBtn: HTMLButtonElement }}
   */
  function mountToggleRow(container, beforeNode) {
    var row = document.createElement("div");
    row.className = "devtools-trace-row";
    row.style.cssText =
      "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0;padding:6px 10px;" +
      "background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#334155;flex-shrink:0;";

    var label = document.createElement("label");
    label.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;";
    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.title = "Запись всех HTTP-запросов, кликов по панели и строк журнала в файл при выключении";
    var span = document.createElement("span");
    span.textContent = "Trace (диагностика → файл .log)";
    label.appendChild(checkbox);
    label.appendChild(span);

    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Сохранить trace";
    saveBtn.style.cssText =
      "padding:3px 8px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;cursor:pointer;font-size:11px;";
    saveBtn.disabled = true;

    checkbox.addEventListener("change", function () {
      setEnabled(checkbox.checked);
      saveBtn.disabled = !checkbox.checked;
    });

    saveBtn.addEventListener("click", function () {
      if (buffer.length === 0) {
        push("SYS", "manual save (empty buffer)");
      }
      downloadLog();
    });

    row.appendChild(label);
    row.appendChild(saveBtn);

    if (beforeNode && beforeNode.parentNode) {
      beforeNode.parentNode.insertBefore(row, beforeNode);
    } else if (container) {
      container.appendChild(row);
    }
    return { row: row, checkbox: checkbox, saveBtn: saveBtn };
  }

  function downloadLog() {
    if (buffer.length === 0) return;
    var header =
      "# DevToolsTrace script=" +
      scriptId +
      " exported=" +
      isoNow() +
      " lines=" +
      buffer.length +
      "\n";
    var body = header + buffer.join("\n") + "\n";
    var fname = "trace_" + scriptId + "_" + fileTsFromIso(isoNow()) + ".log";
    var blob = new Blob(["\uFEFF" + body], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 500);
  }

  return {
    scriptId: scriptId,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    log: log,
    ui: ui,
    wrapFetch: wrapFetch,
    attachPanel: attachPanel,
    mountToggleRow: mountToggleRow,
    downloadLog: downloadLog
  };
}
  var __nativeFetch = fetch.bind(window);
  var devTrace = createDevToolsTrace({ scriptId: "File_DB_Load_GP_v2" });
  var httpFetch = devTrace.wrapFetch(__nativeFetch);


// =============================================================================
// КОНФИГУРАЦИЯ
// =============================================================================

// Базовые URL по паре стенд/контур (без завершающего слэша).
const STAND_ORIGINS = {
  PROM: {
    ALPHA: "https://efs-our-business-prom.omega.sbrf.ru",
    SIGMA: "https://salesheroes.sberbank.ru"
  },
  PSI: {
    ALPHA: "https://iam-enigma-psi.omega.sbrf.ru",
    SIGMA: "https://salesheroes-psi.sigma.sbrf.ru"
  },
  "IFT-SB": {
    ALPHA: "https://iam-enigma-psi.omega.sbrf.ru",
    SIGMA: "https://salesheroes-psi.sigma.sbrf.ru"
  },
  "IFT-GF": {
    ALPHA: "https://iam-enigma-psi.omega.sbrf.ru",
    SIGMA: "https://salesheroes-psi.sigma.sbrf.ru"
  }
};

const STAND_KEYS = ["PROM", "PSI", "IFT-SB", "IFT-GF"];
const CONTOUR_KEYS = ["ALPHA", "SIGMA"];
const FILE_DL_AUTO_ENV = detectFileDlEnvFromLocation();
const DEFAULT_FILE_DL_STAND = (FILE_DL_AUTO_ENV && FILE_DL_AUTO_ENV.stand) || "PROM";
const DEFAULT_FILE_DL_CONTOUR = (FILE_DL_AUTO_ENV && FILE_DL_AUTO_ENV.contour) || "SIGMA";

function detectFileDlEnvFromLocation() {
  var origin = "";
  try {
    origin = String(window.location.origin || "").toLowerCase();
  } catch (e) {}
  for (var si = 0; si < STAND_KEYS.length; si++) {
    var stand = STAND_KEYS[si];
    var byStand = STAND_ORIGINS[stand];
    if (!byStand) continue;
    for (var ci = 0; ci < CONTOUR_KEYS.length; ci++) {
      var contour = CONTOUR_KEYS[ci];
      var host = String((byStand && byStand[contour]) || "").toLowerCase();
      if (host && host === origin) {
        return { stand: stand, contour: contour };
      }
    }
  }
  return null;
}

// Пара "стенд/контур" по умолчанию до открытия панели (с автоопределением по текущей странице).

/** Текущий выбранный стенд/контур для POST (обновляется из UI панели). */
var FILE_DL_ACTIVE_STAND = DEFAULT_FILE_DL_STAND;
var FILE_DL_ACTIVE_CONTOUR = DEFAULT_FILE_DL_CONTOUR;

function getFileDlOriginByEnv() {
  var stand = STAND_KEYS.indexOf(FILE_DL_ACTIVE_STAND) >= 0 ? FILE_DL_ACTIVE_STAND : DEFAULT_FILE_DL_STAND;
  var contour =
    CONTOUR_KEYS.indexOf(FILE_DL_ACTIVE_CONTOUR) >= 0
      ? FILE_DL_ACTIVE_CONTOUR
      : DEFAULT_FILE_DL_CONTOUR;
  var byStand = STAND_ORIGINS[stand] || STAND_ORIGINS[DEFAULT_FILE_DL_STAND];
  return {
    stand: stand,
    contour: contour,
    origin: (byStand && byStand[contour]) || STAND_ORIGINS[DEFAULT_FILE_DL_STAND][DEFAULT_FILE_DL_CONTOUR]
  };
}

// Путь по умолчанию, если у задачи не указан apiPath.
const DEFAULT_FILE_DOWNLOAD_PATH = "/bo/rmkib.gamification/proxy/v1/tournaments/file-download";

// Дата «с которой» грузить сводку наград — значение по умолчанию до открытия панели и при пустом поле даты.
const DEFAULT_EMPLOYEE_REWARDS_DATE_FROM = "2023-01-01";

/** Текущий dateFrom для выгрузки наград (обновляется с панели, `<input type="date">`). */
var fileDlEmployeeRewardsDateFrom = DEFAULT_EMPLOYEE_REWARDS_DATE_FROM;

/** Поле даты на панели (null после «Закрыть»). */
var fileDlPanelRewardsDateInput = null;

// Пауза между запросами при пакетной загрузке — значение по умолчанию для поля на панели, мс.
const DOWNLOAD_ALL_DELAY_MS = 100;

// Скользящий старт: минимальный интервал между запусками POST — значение по умолчанию на панели, мс.
const DOWNLOAD_STAGGER_MS = 300;

/** Верхняя граница задержек, вводимых на панели (защита от опечаток), мс. */
const FILE_DL_DELAY_INPUT_MAX_MS = 600000;

/** Текущая пауза между файлами в пакете (последовательно и после успеха при скользящем старте), мс. */
var fileDlDelayBetweenMs = DOWNLOAD_ALL_DELAY_MS;

/** Текущий минимальный интервал между стартами в скользящем режиме, мс. */
var fileDlStaggerMinMs = DOWNLOAD_STAGGER_MS;

/** Поля ввода задержек на панели (null, если панель закрыта). */
var fileDlPanelDelayBetweenInput = null;
var fileDlPanelStaggerInput = null;

/** Включён ли на панели чекбокс «скользящий старт» (обновляется из UI). */
var FILE_DL_USE_STAGGER = true;

// Эндпоинт выгрузки рейтинга.
const RATINGLIST_FILE_DOWNLOAD_PATH = "/bo/rmkib.gamification/proxy/v1/ratinglist/file-download";

// Эндпоинт выгрузки заказов: body — businessBlock + listType.
const ORDERS_FILE_DOWNLOAD_PATH = "/bo/rmkib.gamification/proxy/v1/orders/file-download";

const YEAR_RESULT_FILE_DOWNLOAD_PATH = "/bo/rmkib.gamification/proxy/v1/year-result/file-download";

/**
 * Конфиг рейтинга: businessBlock + элементы timePeriod с defaultChecked каждого.
 * @type {Array<{ block: string, timePeriods: Array<string|{ period: string, defaultChecked?: boolean }> }>}
 */
const FILE_DL_RATING_BLOCKS_CONFIG = [
  {
    block: "KMKKSB",
    timePeriods: [
      { period: "ACTIVESEASON", defaultChecked: true },
      { period: "SEASON_2025_2", defaultChecked: true },
      { period: "SEASON_2025_1", defaultChecked: true },
      { period: "SEASON_2024", defaultChecked: true },
      { period: "ALLTHETIME", defaultChecked: true },
    ],
  },
  {
    block: "MNS",
    timePeriods: [
      { period: "ACTIVESEASON", defaultChecked: false },
      { period: "SEASON_m_2025_2", defaultChecked: false },
      { period: "SEASON_m_2025_1", defaultChecked: false },
      { period: "SEASON_m_2024", defaultChecked: false },
      { period: "ALLTHETIME", defaultChecked: false },
    ],
  },
  {
    block: "CSM",
    timePeriods: [
      { period: "ALLTHETIME", defaultChecked: true },
      { period: "ACTIVESEASON", defaultChecked: true },
    ],
  },
  {
    block: "AKMKKSB",
    timePeriods: [
      { period: "ALLTHETIME", defaultChecked: true },
      { period: "ACTIVESEASON", defaultChecked: true },
    ],
  },
  { block: "SERVICEMEN", timePeriods: [{ period: "ALLTHETIME", defaultChecked: false }] },
  { block: "KMFACTORING", timePeriods: [{ period: "ALLTHETIME", defaultChecked: false }] },
  { block: "KMSB1", timePeriods: [{ period: "ALLTHETIME", defaultChecked: false }] },
  { block: "IMUB", timePeriods: [{ period: "ALLTHETIME", defaultChecked: false }] },
  { block: "RNUB", timePeriods: [{ period: "ALLTHETIME", defaultChecked: false }] },
  { block: "RSB1", timePeriods: [{ period: "ALLTHETIME", defaultChecked: false }] },
];

/** Раскладка рейтинга на панели: две строки businessBlock (порядок слева направо). */
const FILE_DL_RATING_UI_ROWS = [
  ["KMKKSB", "AKMKKSB", "CSM", "MNS"],
  ["SERVICEMEN", "KMFACTORING", "KMSB1", "IMUB", "RNUB", "RSB1"],
];

/** id задач рейтинга, снятых по умолчанию (поверх defaultChecked элемента). */
const FILE_DL_RATING_DEFAULT_UNCHECKED_JOB_IDS = [];

/**
 * Конфиг заказов: businessBlock + listType с defaultChecked каждого элемента.
 * @type {Array<{ block: string, listTypes: Array<string|{ listType: string, defaultChecked?: boolean }> }>}
 */
const FILE_DL_ORDERS_BLOCKS_CONFIG = [
  {
    block: "KMKKSB",
    listTypes: [
      { listType: "NONSEASON", defaultChecked: true },
      { listType: "SEASON_2025_2", defaultChecked: true },
      { listType: "SEASON_2025_1", defaultChecked: true },
      { listType: "SEASON_2024", defaultChecked: true },
      { listType: "ALLSEASONS", defaultChecked: true },
    ],
  },
  {
    block: "MNS",
    listTypes: [
      { listType: "NONSEASON", defaultChecked: true },
      { listType: "SEASON_m_2025_2", defaultChecked: true },
      { listType: "SEASON_m_2025_1", defaultChecked: true },
      { listType: "SEASON_m_2024", defaultChecked: true },
      { listType: "ALLSEASONS", defaultChecked: true },
    ],
  },
];

/** id задач заказов, снятых по умолчанию (пусто — все listType отмечены). */
const FILE_DL_ORDERS_DEFAULT_UNCHECKED_JOB_IDS = [];

/** id основных выгрузок, снятых по умолчанию (поверх defaultChecked задачи). */
const FILE_DL_MAIN_DEFAULT_UNCHECKED_JOB_IDS = [];

/**
 * Разбор элемента конфига (строка или объект с defaultChecked).
 * @param {string|{ period?: string, listType?: string, timePeriod?: string, defaultChecked?: boolean }} item
 * @param {boolean} [fallbackChecked]
 * @returns {{ value: string, defaultChecked: boolean }}
 */
function parseFileDlConfigItem(item, fallbackChecked) {
  if (typeof item === "string") {
    return { value: item, defaultChecked: fallbackChecked !== false };
  }
  if (item && typeof item === "object") {
    var v = item.period || item.listType || item.timePeriod || "";
    return { value: String(v), defaultChecked: item.defaultChecked !== false };
  }
  return { value: "", defaultChecked: fallbackChecked !== false };
}

/**
 * @param {Array<{ block: string, timePeriods: Array<string|object> }>} config
 * @returns {object[]}
 */
function buildRatingGroupJobsFromConfig(config) {
  var jobs = [];
  for (var i = 0; i < config.length; i++) {
    var row = config[i];
    var block = row.block;
    var periods = row.timePeriods || [];
    for (var j = 0; j < periods.length; j++) {
      var parsed = parseFileDlConfigItem(periods[j], true);
      if (!parsed.value) continue;
      var period = parsed.value;
      var id = "rating_" + block + "_" + period;
      jobs.push({
        id: id,
        label: "Рейтинг · " + block + " · " + period,
        apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
        body: { businessBlock: block, timePeriod: period },
        refererPath: "/rating",
        fileName: "gamification-ratingList_" + block + "_" + period + ".csv",
        _defaultChecked: parsed.defaultChecked,
      });
    }
  }
  return jobs;
}

/**
 * @param {string[]} blockNames
 * @returns {number}
 */
function getMaxRatingSeasonCountInBlocks(blockNames) {
  var max = 0;
  for (var bi = 0; bi < blockNames.length; bi++) {
    var name = blockNames[bi];
    for (var ci = 0; ci < FILE_DL_RATING_BLOCKS_CONFIG.length; ci++) {
      var cfg = FILE_DL_RATING_BLOCKS_CONFIG[ci];
      if (cfg.block === name) {
        var n = (cfg.timePeriods || []).length;
        if (n > max) max = n;
        break;
      }
    }
  }
  return max;
}

/**
 * Минимальная высота строки рейтинга под столбик сезонов самого высокого блока в ряду.
 * @param {string[]} blockNames
 * @returns {number}
 */
function calcRatingRowMinHeightPx(blockNames) {
  var maxSeasons = getMaxRatingSeasonCountInBlocks(blockNames);
  if (maxSeasons < 1) maxSeasons = 1;
  var headerPx = 20;
  var seasonRowPx = 17;
  var padPx = 12;
  return headerPx + maxSeasons * seasonRowPx + padPx;
}

/**
 * @param {Array<{ block: string, listTypes: Array<string|object> }>} config
 * @returns {object[]}
 */
function buildOrdersGroupJobsFromConfig(config) {
  var jobs = [];
  for (var i = 0; i < config.length; i++) {
    var row = config[i];
    var block = row.block;
    var types = row.listTypes || [];
    for (var j = 0; j < types.length; j++) {
      var parsed = parseFileDlConfigItem(types[j], true);
      if (!parsed.value) continue;
      var listType = parsed.value;
      var id = "orders_" + block + "_" + listType;
      jobs.push({
        id: id,
        label: "Заказы · " + block + " · " + listType,
        apiPath: ORDERS_FILE_DOWNLOAD_PATH,
        body: { businessBlock: block, listType: listType },
        refererPath: "/admin/orders",
        fileName: "gamification-orderList_" + block + "_" + listType + ".csv",
        _defaultChecked: parsed.defaultChecked,
      });
    }
  }
  return jobs;
}

/**
 * @param {{ id?: string, _defaultChecked?: boolean }} job
 * @returns {boolean}
 */
function isFileDlJobCheckedByDefault(job) {
  var id = job && job.id ? String(job.id) : "";
  if (FILE_DL_MAIN_DEFAULT_UNCHECKED_JOB_IDS.indexOf(id) >= 0) return false;
  if (FILE_DL_RATING_DEFAULT_UNCHECKED_JOB_IDS.indexOf(id) >= 0) return false;
  if (FILE_DL_ORDERS_DEFAULT_UNCHECKED_JOB_IDS.indexOf(id) >= 0) return false;
  if (job && job._defaultChecked === false) return false;
  if (job && job.defaultChecked === false) return false;
  return true;
}

/**
 * Список запросов на скачивание.
 * - apiPath — путь POST относительно origin (если не задан — используется DEFAULT_FILE_DOWNLOAD_PATH).
 * - label — текст на кнопке.
 * - body — тело POST (JSON).
 * - refererPath — подсказка: лучше открыть вкладку на … + refererPath (браузер сам выставит Referer).
 * - fileName — необязательно, если сервер не прислал Content-Disposition.
 */
const DOWNLOAD_JOBS = [
  {
    id: "tournamentListCsv",
    label: "Список турниров (CSV)",
    defaultChecked: true,
    apiPath: DEFAULT_FILE_DOWNLOAD_PATH,
    body: {},
    refererPath: "/tournaments/list",
    fileName: null,
  },
  {
    id: "employeeRewardsSummary",
    label: "Награды: (LIST REWARD)",
    defaultChecked: true,
    apiPath: "/bo/rmkib.gamification/proxy/v1/employee-rewards/file-download",
    body: {},
    refererPath: "/awards/list",
    fileName: null,
  },
  {
    id: "administrationStatisticCsv",
    label: "Посещения",
    defaultChecked: true,
    apiPath: "/bo/rmkib.gamification/proxy/v1/administration/statistic/file-download",
    body: {},
    refererPath: "/admin/statistic",
    fileName: null,
  },
  {
    id: "yearResultsCsv",
    label: "Итоги года",
    defaultChecked: true,
    apiPath: YEAR_RESULT_FILE_DOWNLOAD_PATH,
    body: {},
    refererPath: "/salesheroes/profile",
    fileName: "gamification-yearResults.csv",
  },
];

const RATING_GROUP_JOBS = buildRatingGroupJobsFromConfig(FILE_DL_RATING_BLOCKS_CONFIG);
const ORDERS_GROUP_JOBS = buildOrdersGroupJobsFromConfig(FILE_DL_ORDERS_BLOCKS_CONFIG);

/** Все задачи подряд: основные + рейтинг + заказы (для «Скачать всё»). */
function getAllDownloadJobs() {
  return DOWNLOAD_JOBS.concat(RATING_GROUP_JOBS).concat(ORDERS_GROUP_JOBS);
}

/**
 * Определяет название группы для логов (по пути API).
 * @param {object} job
 * @returns {string}
 */
function getGroupNameForJob(job) {
  const p = job.apiPath || "";
  if (p.indexOf("/orders/file-download") !== -1) return "Заказы";
  if (p.indexOf("/ratinglist/file-download") !== -1) return "Рейтинг";
  if (p.indexOf("/employee-rewards/file-download") !== -1) return "Награды (сводка)";
  if (p.indexOf("/administration/statistic/file-download") !== -1) return "Статистика (админ)";
  if (p.indexOf("/year-result/file-download") !== -1) return "Итоги года";
  if (p.indexOf("/tournaments/file-download") !== -1) return "Турниры";
  return "Прочее";
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Читает неотрицательное целое из поля числа с потолком.
 * @param {HTMLInputElement|null} inp
 * @param {number} fallback
 * @param {number} maxMs
 * @returns {number}
 */
function fileDlReadDelayMs(inp, fallback, maxMs) {
  if (!inp) return fallback;
  var n = parseInt(String(inp.value).trim(), 10);
  if (isNaN(n) || n < 0) return fallback;
  if (n > maxMs) return maxMs;
  return n;
}

/** Обновляет рабочие задержки из полей панели (если панель открыта). */
function syncFileDlDelaysFromPanel() {
  fileDlDelayBetweenMs = fileDlReadDelayMs(
    fileDlPanelDelayBetweenInput,
    DOWNLOAD_ALL_DELAY_MS,
    FILE_DL_DELAY_INPUT_MAX_MS
  );
  fileDlStaggerMinMs = fileDlReadDelayMs(
    fileDlPanelStaggerInput,
    DOWNLOAD_STAGGER_MS,
    FILE_DL_DELAY_INPUT_MAX_MS
  );
}

/**
 * Проверка формата даты для API (только календарная дата, без времени).
 * @param {string} s
 * @returns {boolean}
 */
function fileDlIsIsoDateYmd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/**
 * Переносит dateFrom наград с панели в `fileDlEmployeeRewardsDateFrom` (если панель открыта).
 */
function syncFileDlRewardsDateFromPanel() {
  if (!fileDlPanelRewardsDateInput) return;
  var v = String(fileDlPanelRewardsDateInput.value || "").trim();
  if (fileDlIsIsoDateYmd(v)) {
    fileDlEmployeeRewardsDateFrom = v;
  } else {
    fileDlEmployeeRewardsDateFrom = DEFAULT_EMPLOYEE_REWARDS_DATE_FROM;
  }
}

/** Если открыта панель — функция добавления строки в блок лога; иначе `null`. */
var fileDlPanelLogAppend = null;

/**
 * Записывает сообщение в «Журнал работы» на панели; уровень error дополнительно дублируется в console.error.
 * @param {"log"|"warn"|"error"} level
 * @param {string} msg
 */
function fileDlPanelEcho(level, msg) {
  devTrace.log(typeof msg === "string" ? msg : String(msg));
  var s = typeof msg === "string" ? msg : String(msg);
  if (level === "error") console.error(s);
  if (typeof fileDlPanelLogAppend === "function") {
    try {
      fileDlPanelLogAppend(s);
    } catch (e) {
      /* панель могла быть снята с DOM */
    }
  }
}

/**
 * Краткая строка в консоль после одиночной загрузки (не пакет с порядковым номером в пакете).
 * @param {object} ctx
 * @param {{ ok: boolean, fileName?: string, status?: number, error?: string }} result
 */
function fileDlConsoleSingleJobSummary(ctx, result) {
  if (typeof ctx.index === "number" && typeof ctx.total === "number") return;
  var r = result || {};
  if (r.ok && r.fileName) {
    console.log("[File_DB_Load_GP_v2] Одиночная загрузка: OK | " + r.fileName);
  } else {
    var tail = r.status != null ? " | HTTP " + r.status : "";
    var errS = r.error != null ? " | " + String(r.error).slice(0, 160) : "";
    console.log("[File_DB_Load_GP_v2] Одиночная загрузка: ошибка" + tail + errS);
  }
}

/** Цвета индикатора статуса задачи на панели. */
var FILE_DL_JOB_STATUS_COLOR = {
  idle: "#cbd5e1",
  pending: "#94a3b8",
  sent: "#2563eb",
  ok: "#eab308",
  error: "#dc2626",
  saved: "#16a34a",
};

/** Подсказки индикатора статуса. */
var FILE_DL_JOB_STATUS_TITLE = {
  idle: "Не в текущем пакете",
  pending: "Ожидает отправки",
  sent: "Запрос отправлен",
  ok: "Положительный ответ",
  error: "Ошибка или отрицательный ответ",
  saved: "Файл сохранён",
};

/**
 * UI задач на панели: индикатор и таймер по job.id.
 * @type {Map<string, { dot: HTMLElement, timerEl: HTMLElement, timerHandle: number|null, startMs: number|null }>}
 */
var fileDlJobUiById = new Map();

/**
 * Формат длительности для таймера: мин:сек:мс.
 * @param {number} ms
 * @returns {string}
 */
function formatFileDlElapsedMs(ms) {
  var total = Math.max(0, Math.floor(ms));
  var m = Math.floor(total / 60000);
  var s = Math.floor((total % 60000) / 1000);
  var msPart = total % 1000;
  return m + ":" + String(s).padStart(2, "0") + ":" + String(msPart).padStart(3, "0");
}

/**
 * @param {string} jobId
 * @param {HTMLElement} dot
 * @param {HTMLElement} timerEl
 */
function fileDlRegisterJobUi(jobId, dot, timerEl) {
  if (!jobId) return;
  fileDlJobUiById.set(jobId, {
    dot: dot,
    timerEl: timerEl,
    timerHandle: null,
    startMs: null,
  });
}

/**
 * @param {string} jobId
 * @param {"idle"|"pending"|"sent"|"ok"|"error"|"saved"} status
 */
function fileDlSetJobStatus(jobId, status) {
  var ui = fileDlJobUiById.get(jobId);
  if (!ui || !ui.dot) return;
  ui.dot.style.backgroundColor = FILE_DL_JOB_STATUS_COLOR[status] || FILE_DL_JOB_STATUS_COLOR.idle;
  ui.dot.title = FILE_DL_JOB_STATUS_TITLE[status] || status;
}

/**
 * @param {string} jobId
 */
function fileDlStartJobTimer(jobId) {
  var ui = fileDlJobUiById.get(jobId);
  if (!ui || !ui.timerEl) return;
  fileDlStopJobTimer(jobId, false);
  ui.startMs = Date.now();
  ui.timerEl.textContent = formatFileDlElapsedMs(0);
  ui.timerHandle = window.setInterval(function () {
    if (ui.startMs == null) return;
    ui.timerEl.textContent = formatFileDlElapsedMs(Date.now() - ui.startMs);
  }, 50);
}

/**
 * @param {string} jobId
 * @param {boolean} [showFinal]
 */
function fileDlStopJobTimer(jobId, showFinal) {
  var ui = fileDlJobUiById.get(jobId);
  if (!ui) return;
  if (ui.timerHandle != null) {
    clearInterval(ui.timerHandle);
    ui.timerHandle = null;
  }
  if (showFinal !== false && ui.startMs != null && ui.timerEl) {
    ui.timerEl.textContent = formatFileDlElapsedMs(Date.now() - ui.startMs);
  }
  ui.startMs = null;
}

/**
 * Перед пакетом: отмеченные задачи — «ожидает», остальные — idle.
 * @param {string[]} batchJobIds
 */
function fileDlPrepareBatchJobStatuses(batchJobIds) {
  var batchSet = {};
  for (var i = 0; i < batchJobIds.length; i++) batchSet[batchJobIds[i]] = true;
  fileDlJobUiById.forEach(function (ui, jobId) {
    if (batchSet[jobId]) {
      fileDlSetJobStatus(jobId, "pending");
      if (ui.timerEl) ui.timerEl.textContent = "—";
      fileDlStopJobTimer(jobId, false);
    } else {
      fileDlSetJobStatus(jobId, "idle");
      if (ui.timerEl) ui.timerEl.textContent = "—";
      fileDlStopJobTimer(jobId, false);
    }
  });
}

/**
 * Извлекает имя файла из заголовка Content-Disposition (RFC 5987 / простой вариант).
 * @param {string|null} header
 * @returns {string|null}
 */
function parseFilenameFromContentDisposition(header) {
  if (!header || typeof header !== "string") return null;
  const utf8Match = header.match(/filename\*=UTF-8''([^;\s]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/\+/g, " "));
    } catch (e) {
      return utf8Match[1];
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted && quoted[1]) return quoted[1];
  const unquoted = header.match(/filename=([^;\s]+)/i);
  if (unquoted && unquoted[1]) return unquoted[1].replace(/^["']|["']$/g, "");
  return null;
}

/**
 * Проверяет, что Content-Type указывает на JSON.
 * @param {string|null} ct
 * @returns {boolean}
 */
function isJsonContentType(ct) {
  if (!ct || typeof ct !== "string") return false;
  return ct.split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * Компактная строка тела POST для журнала (параметры выгрузки).
 * @param {object} bodyObj
 * @returns {string}
 */
function formatPostBodyForLog(bodyObj) {
  try {
    return JSON.stringify(bodyObj !== undefined && bodyObj !== null ? bodyObj : {});
  } catch (e) {
    return String(bodyObj);
  }
}

/**
 * Выполняет один POST и инициирует скачивание полученного файла.
 * @param {object} job — элемент из списка задач.
 * @param {object} [ctx] — контекст для логов: groupName, batchName, index (0-based), total.
 * @returns {Promise<{ ok: boolean, status?: number, fileName?: string, error?: string }>}
 */
async function downloadOneJob(job, ctx) {
  ctx = ctx || {};
  var _dlExit = null;
  var jobIdStr = job && job.id ? String(job.id) : "";
  try {
  fileDlSetJobStatus(jobIdStr, "sent");
  fileDlStartJobTimer(jobIdStr);

  const env = getFileDlOriginByEnv();
  const standKey = env.stand;
  const contourKey = env.contour;
  const origin = env.origin;
  const path = job.apiPath || DEFAULT_FILE_DOWNLOAD_PATH;
  const url = origin + path;
  // Origin и Referer в fetch из JS задавать нельзя (запрещённые заголовки) — браузер подставит сам с текущей вкладки.
  // Для совпадения с типичным запросом откройте вкладку на странице вида … + job.refererPath.

  const headers = {
    Accept: "*/*",
    "Content-Type": "application/json"
  };

  // Клонируем тело, чтобы для наград подставить актуальный dateFrom с панели, не мутируя константу DOWNLOAD_JOBS.
  var bodyObj;
  try {
    bodyObj =
      job.body !== undefined && job.body !== null
        ? JSON.parse(JSON.stringify(job.body))
        : {};
  } catch (cloneErr) {
    bodyObj = {};
  }
  if (job.id === "employeeRewardsSummary") {
    syncFileDlRewardsDateFromPanel();
    bodyObj.dateFrom = fileDlEmployeeRewardsDateFrom;
  }

  const groupName = ctx.groupName != null ? ctx.groupName : getGroupNameForJob(job);
  const batchName = ctx.batchName != null ? ctx.batchName : "одиночный запрос (кнопка)";
  const idx = ctx.index;
  const total = ctx.total;
  const posStr =
    idx != null && total != null ? "Файл в пакете: " + (idx + 1) + " из " + total : null;

  fileDlPanelEcho(
    "log",
    "СТАРТ загрузки\n" +
      "Группа: " +
      groupName +
      "\nПакет / режим: " +
      batchName +
      (posStr ? "\n" + posStr : "") +
      "\nЗадача id: " +
      (job.id || "—")
  );

  let res;
  try {
    res = await httpFetch(url, {
      method: "POST",
      credentials: "include",
      headers: headers,
      body: JSON.stringify(bodyObj)
    });
  } catch (e) {
    fileDlSetJobStatus(jobIdStr, "error");
    fileDlStopJobTimer(jobIdStr, true);
    fileDlPanelEcho("error", "ОШИБКА (сеть / исключение)\n" + String(e));
    _dlExit = { ok: false, error: String(e) };
    return _dlExit;
  }

  if (!res.ok) {
    fileDlSetJobStatus(jobIdStr, "error");
    fileDlStopJobTimer(jobIdStr, true);
    fileDlPanelEcho(
      "warn",
      "ОШИБКА HTTP\nСтатус: " + res.status + " " + (res.statusText || "")
    );
    _dlExit = { ok: false, status: res.status };
    return _dlExit;
  }

  // Сервер может вернуть HTTP 200 и JSON с success:false (таймаут и т.д.) — не сохранять как файл.
  const contentType = res.headers.get("Content-Type") || "";
  if (isJsonContentType(contentType)) {
    const textBody = await res.text();
    let data;
    try {
      data = JSON.parse(textBody);
    } catch (parseErr) {
      fileDlSetJobStatus(jobIdStr, "error");
      fileDlStopJobTimer(jobIdStr, true);
      fileDlPanelEcho(
        "warn",
        "ОШИБКА: ответ помечен как JSON, разбор не удался\n" + String(parseErr)
      );
      _dlExit = { ok: false, error: "invalid_json_body" };
      return _dlExit;
    }
    if (data && data.success === false && data.error) {
      const err = data.error;
      fileDlSetJobStatus(jobIdStr, "error");
      fileDlStopJobTimer(jobIdStr, true);
      fileDlPanelEcho(
        "warn",
        "ОШИБКА API (HTTP 200, JSON)\nСтенд: " +
          standKey +
          "\nЗадача id: " +
          (job.id || "—") +
          "\nPOST body: " +
          formatPostBodyForLog(bodyObj) +
          "\ncode: " +
          (err.code || "—") +
          "\nsystem: " +
          (err.system || "—") +
          "\ntext: " +
          (err.text || "—") +
          (err.uuid ? "\nuuid: " + err.uuid : "")
      );
      _dlExit = { ok: false, apiError: err };
      return _dlExit;
    }
    if (data && data.success === true) {
      fileDlSetJobStatus(jobIdStr, "error");
      fileDlStopJobTimer(jobIdStr, true);
      fileDlPanelEcho(
        "warn",
        "Ответ JSON с success:true — не файл выгрузки, скачивание отменено"
      );
      _dlExit = { ok: false, error: "unexpected_json_success" };
      return _dlExit;
    }
    fileDlSetJobStatus(jobIdStr, "error");
    fileDlStopJobTimer(jobIdStr, true);
    fileDlPanelEcho(
      "warn",
      "Ответ application/json непохож на файл выгрузки — скачивание отменено"
    );
    _dlExit = { ok: false, error: "unexpected_json_shape" };
    return _dlExit;
  }

  fileDlSetJobStatus(jobIdStr, "ok");

  const blob = await res.blob();
  const sizeBytes = blob.size;
  const cd = res.headers.get("Content-Disposition");
  const fromHeader = parseFilenameFromContentDisposition(cd);
  const safeLabel = (job.label || job.id || "download").replace(/[/\\?%*:|"<>]/g, "_");
  const fileNameRaw =
    (job.fileName && String(job.fileName).trim()) ||
    fromHeader ||
    safeLabel + ".bin";
  const fileName = standKey + "_" + contourKey + "_" + fileNameRaw;

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () {
    URL.revokeObjectURL(objectUrl);
  }, 0);

  fileDlSetJobStatus(jobIdStr, "saved");
  fileDlStopJobTimer(jobIdStr, true);

  fileDlPanelEcho(
    "log",
    "ЗАВЕРШЕНО: файл скачан\n" +
      "Стенд/контур: " +
      standKey +
      "/" +
      contourKey +
      "\nЗадача id: " +
      (job.id || "—") +
      "\nPOST body: " +
      formatPostBodyForLog(bodyObj) +
      "\nПуть API: " +
      path +
      "\nИмя файла: " +
      fileName +
      "\nРазмер ответа: " +
      sizeBytes +
      " байт"
  );

  _dlExit = { ok: true, fileName: fileName };
  return _dlExit;
  } finally {
    if (_dlExit != null) fileDlConsoleSingleJobSummary(ctx, _dlExit);
  }
}

/**
 * Последовательно скачивает задачи из массива с паузой из панели (`fileDlDelayBetweenMs`).
 * @param {object[]} jobs
 * @param {string} logLabel — подпись для консоли (название пакета).
 */
async function downloadJobsSequentially(jobs, logLabel) {
  syncFileDlDelaysFromPanel();
  const pauseMs = fileDlDelayBetweenMs;
  const total = jobs.length;
  console.log(
    "[File_DB_Load_GP_v2] Пакет «" +
      logLabel +
      "» (последовательно), задач: " +
      total +
      ". Подробности — в «Журнал работы»."
  );
  fileDlPanelEcho(
    "log",
    "ПАКЕТ: " +
      logLabel +
      "\nСТАРТ последовательной загрузки\nВсего файлов в пакете: " +
      total +
      "\nПауза между запросами: " +
      pauseMs +
      " мс"
  );

  let okCount = 0;
  let errCount = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const groupName = getGroupNameForJob(job);
    const result = await downloadOneJob(job, {
      groupName: groupName,
      batchName: logLabel,
      index: i,
      total: total
    });
    if (result.ok) okCount++;
    else errCount++;

    if (i < jobs.length - 1 && pauseMs > 0) {
      fileDlPanelEcho(
        "log",
        "Пауза " + pauseMs + " мс перед файлом " + (i + 2) + "/" + total
      );
      await delay(pauseMs);
    }
  }

  fileDlPanelEcho(
    "log",
    "ПАКЕТ: " +
      logLabel +
      "\nФИНИШ: обработано задач: " +
      total +
      "\nУспешно (файл инициирован): " +
      okCount +
      "\nС ошибкой: " +
      errCount
  );
  console.log(
    "[File_DB_Load_GP_v2] Пакет «" +
      logLabel +
      "» завершён (последовательно). Задач: " +
      total +
      ", успешно: " +
      okCount +
      ", ошибок: " +
      errCount
  );
}

/**
 * Пакет с перекрывающимися запросами: интервалы из панели (`fileDlStaggerMinMs`, `fileDlDelayBetweenMs`).
 * @param {object[]} jobs
 * @param {string} logLabel
 */
async function downloadJobsStaggered(jobs, logLabel) {
  syncFileDlDelaysFromPanel();
  const staggerMs = fileDlStaggerMinMs;
  const pauseAfterOkMs = fileDlDelayBetweenMs;
  const total = jobs.length;
  console.log(
    "[File_DB_Load_GP_v2] Пакет «" +
      logLabel +
      "» (скользящий старт), задач: " +
      total +
      ". Подробности — в «Журнал работы»."
  );
  fileDlPanelEcho(
    "log",
    "ПАКЕТ: " +
      logLabel +
      "\nСТАРТ (скользящий старт запросов)\nВсего задач: " +
      total +
      "\nМежду стартами min: " +
      staggerMs +
      " мс | после успеха предыдущего: " +
      pauseAfterOkMs +
      " мс"
  );

  const promises = [];
  for (let i = 0; i < total; i++) {
    const job = jobs[i];
    const groupName = getGroupNameForJob(job);
    const p = downloadOneJob(job, {
      groupName: groupName,
      batchName: logLabel,
      index: i,
      total: total
    });
    promises.push(p);
    if (i < total - 1) {
      await Promise.race([
        delay(staggerMs),
        p.then(function (result) {
          if (result && result.ok) return delay(pauseAfterOkMs);
          return new Promise(function () {});
        })
      ]);
    }
  }

  const results = await Promise.all(promises);
  let okCount = 0;
  let errCount = 0;
  results.forEach(function (r) {
    if (r.ok) okCount++;
    else errCount++;
  });

  fileDlPanelEcho(
    "log",
    "ПАКЕТ: " +
      logLabel +
      "\nФИНИШ: обработано задач: " +
      total +
      "\nУспешно (файл инициирован): " +
      okCount +
      "\nС ошибкой: " +
      errCount
  );
  console.log(
    "[File_DB_Load_GP_v2] Пакет «" +
      logLabel +
      "» завершён (скользящий старт). Задач: " +
      total +
      ", успешно: " +
      okCount +
      ", ошибок: " +
      errCount
  );
}

/**
 * Запуск пакета: последовательно или скользящий старт.
 * @param {object[]} jobs
 * @param {string} logLabel
 * @param {boolean} useStagger
 */
async function downloadJobsBatch(jobs, logLabel, useStagger) {
  if (useStagger) await downloadJobsStaggered(jobs, logLabel);
  else await downloadJobsSequentially(jobs, logLabel);
}

/** Скачивание только отмеченных на панели задач. */
async function downloadCheckedPanelJobs(entries) {
  const jobs = entries
    .filter(function (x) {
      return x.cb.checked;
    })
    .map(function (x) {
      return x.job;
    });
  if (jobs.length === 0) {
    fileDlPanelEcho(
      "warn",
      "Скачать выделенное: нет отмеченных задач. Отметьте чекбоксы или нажмите «Отметить всё»."
    );
    return;
  }
  fileDlPrepareBatchJobStatuses(
    jobs
      .map(function (j) {
        return j.id ? String(j.id) : "";
      })
      .filter(Boolean)
  );
  await downloadJobsBatch(jobs, "«Скачать выделенное»", FILE_DL_USE_STAGGER);
}

/**
 * Обнуляет ссылки на DOM панели и возвращает рабочие переменные к значениям по умолчанию.
 * Вызывается при «Закрыть» и перед повторным открытием панели — чтобы не держать мёртвые узлы и не смешивать состояние.
 */
function fileDlDetachPanelAndResetRuntime() {
  fileDlPanelLogAppend = null;
  fileDlPanelDelayBetweenInput = null;
  fileDlPanelStaggerInput = null;
  fileDlPanelRewardsDateInput = null;
  FILE_DL_ACTIVE_STAND = DEFAULT_FILE_DL_STAND;
  FILE_DL_ACTIVE_CONTOUR = DEFAULT_FILE_DL_CONTOUR;
  fileDlEmployeeRewardsDateFrom = DEFAULT_EMPLOYEE_REWARDS_DATE_FROM;
  fileDlDelayBetweenMs = DOWNLOAD_ALL_DELAY_MS;
  fileDlStaggerMinMs = DOWNLOAD_STAGGER_MS;
  FILE_DL_USE_STAGGER = true;
  fileDlJobUiById.forEach(function (ui) {
    if (ui.timerHandle != null) clearInterval(ui.timerHandle);
  });
  fileDlJobUiById.clear();
}

/**
 * Панель: кнопка на каждую задачу + чекбокс для пакета «Скачать выделенное».
 * Стиль окна и кнопок — в одном ключе с AddressBook_export / Tournament_LeadersForAdmin; внизу «Журнал работы».
 */
function startDownloadPanel() {
  var prevRoot = document.getElementById("fileDlGamificationPanelRootV2");
  if (prevRoot) {
    prevRoot.remove();
    fileDlDetachPanelAndResetRuntime();
  }

  const panelCheckboxJobs = [];

  // Строка-сводка под стендом: пересчёт «отмечено» при смене любого чекбокса.
  const sub = document.createElement("div");
  sub.style.cssText =
    "font-size:9px;color:#64748b;margin:0 0 6px;line-height:1.35;word-break:break-word;";
  function refreshPanelSubSummary() {
    var total = getAllDownloadJobs().length;
    var marked = 0;
    for (var i = 0; i < panelCheckboxJobs.length; i++) {
      if (panelCheckboxJobs[i].cb.checked) marked++;
    }
    sub.textContent =
      "Осн.: " +
      DOWNLOAD_JOBS.length +
      " · Рейт.: " +
      RATING_GROUP_JOBS.length +
      " · Зак.: " +
      ORDERS_GROUP_JOBS.length +
      " · Всего задач с чекбоксом: " +
      total +
      " (отмечено: " +
      marked +
      ")";
  }

  /**
   * Чекбокс + подпись в одну строку (для горизонтальных рядов и сеток).
   * @param {HTMLElement} parent
   * @param {object} job
   * @param {string} [labelOverride]
   * @param {{ compact?: boolean, indented?: boolean, dense?: boolean }} [opts]
   */
  function appendCheckboxOnlyRow(parent, job, labelOverride, opts) {
    opts = opts || {};
    const row = document.createElement("div");
    row.style.cssText = opts.compact
      ? "display:inline-flex;flex-direction:row;align-items:center;gap:4px;margin:0;box-sizing:border-box;white-space:nowrap;"
      : opts.indented === false
        ? "display:flex;flex-direction:row;align-items:center;gap:4px;margin:0;width:100%;box-sizing:border-box;min-width:0;"
        : "display:flex;flex-direction:row;align-items:center;gap:6px;margin:2px 0 2px 12px;width:100%;box-sizing:border-box;";
    const statusDot = document.createElement("span");
    statusDot.style.cssText =
      "width:8px;height:8px;border-radius:50%;background:" +
      FILE_DL_JOB_STATUS_COLOR.idle +
      ";flex-shrink:0;box-sizing:border-box;border:1px solid rgba(15,23,42,.1);";
    statusDot.title = FILE_DL_JOB_STATUS_TITLE.idle;
    const timerEl = document.createElement("span");
    timerEl.textContent = "—";
    timerEl.style.cssText =
      "font-size:" +
      (opts.dense ? "8px" : "9px") +
      ";color:#64748b;font-family:ui-monospace,monospace;min-width:" +
      (opts.compact ? "4.6em" : "5em") +
      ";flex-shrink:0;line-height:1;";
    timerEl.title = "Время выполнения запроса (мин:сек:мс)";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isFileDlJobCheckedByDefault(job);
    cb.title = "Участвует в «Скачать выделенное»";
    cb.style.cssText =
      "margin:0;flex-shrink:0;width:" +
      (opts.dense ? "12px" : "14px") +
      ";height:" +
      (opts.dense ? "12px" : "14px") +
      ";cursor:pointer;accent-color:#0369a1;";
    const lab = document.createElement("span");
    lab.textContent = labelOverride != null ? labelOverride : job.label || job.id || "—";
    lab.style.cssText = opts.compact
      ? "font-size:10px;color:#1e293b;line-height:1.2;"
      : opts.dense
        ? "font-size:9px;color:#1e293b;line-height:1.15;word-break:break-word;"
        : "font-size:10px;color:#1e293b;line-height:1.25;word-break:break-word;";
    row.appendChild(statusDot);
    row.appendChild(timerEl);
    row.appendChild(cb);
    row.appendChild(lab);
    parent.appendChild(row);
    panelCheckboxJobs.push({ cb: cb, job: job, statusDot: statusDot, timerEl: timerEl });
    if (job.id) fileDlRegisterJobUi(String(job.id), statusDot, timerEl);
    cb.addEventListener("change", refreshPanelSubSummary);
    return cb;
  }

  /**
   * Секция businessBlock: заголовок + сезоны/listType (без общего чекбокса блока).
   * @param {HTMLElement} parent
   * @param {string} blockName
   * @param {object[]} jobs
   * @param {function(object): string} [itemLabelFn]
   * @param {{ flexCell?: boolean, cellMinWidth?: string, columns?: number, titleColor?: string, fillRowHeight?: boolean }} [opts]
   */
  function appendBlockGroupSection(parent, blockName, jobs, itemLabelFn, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    var cellCss =
      "box-sizing:border-box;padding:4px 6px;background:rgba(255,255,255,.55);border-radius:8px;border:1px solid rgba(15,23,42,.08);";
    if (opts.flexCell) {
      cellCss += "flex:1 1 0;min-width:" + (opts.cellMinWidth || "0") + ";display:flex;flex-direction:column;";
      if (opts.fillRowHeight) {
        cellCss += "height:100%;align-self:stretch;";
      }
    } else {
      cellCss += "margin:4px 0 6px;";
    }
    wrap.style.cssText = cellCss;

    const blockLab = document.createElement("div");
    blockLab.textContent = blockName;
    blockLab.style.cssText =
      "font-size:10px;font-weight:700;color:" +
      (opts.titleColor || "#1e3a8a") +
      ";text-align:center;margin:0 0 3px;line-height:1.2;letter-spacing:0.02em;";
    wrap.appendChild(blockLab);

    const colCount = opts.columns && opts.columns > 1 ? opts.columns : 1;
    const itemsWrap = document.createElement("div");
    itemsWrap.style.cssText =
      colCount > 1
        ? "display:grid;grid-template-columns:repeat(" +
          colCount +
          ",minmax(0,1fr));gap:1px 6px;width:100%;align-items:start;"
        : "display:flex;flex-direction:column;align-items:stretch;width:100%;gap:1px;";
    wrap.appendChild(itemsWrap);

    for (var ji = 0; ji < jobs.length; ji++) {
      var job = jobs[ji];
      var itemLabel = itemLabelFn ? itemLabelFn(job) : job.label || job.id;
      appendCheckboxOnlyRow(itemsWrap, job, itemLabel, { compact: false, indented: false, dense: colCount > 1 });
    }
    parent.appendChild(wrap);
  }

  /**
   * Группирует задачи по businessBlock из body.
   * @param {object[]} jobs
   * @returns {Map<string, object[]>}
   */
  function groupJobsByBusinessBlock(jobs) {
    var map = new Map();
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      var bb = job.body && job.body.businessBlock ? String(job.body.businessBlock) : "?";
      if (!map.has(bb)) map.set(bb, []);
      map.get(bb).push(job);
    }
    return map;
  }

  const container = document.createElement("div");
  container.id = "fileDlGamificationPanelRootV2";
  container.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:999999;box-sizing:border-box;" +
    "width:min(960px,calc(100vw - 16px));max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow-y:auto;" +
    "padding:10px 12px 8px;background:#ffffff;border:1px solid #cbd5e1;border-radius:12px;" +
    "box-shadow:0 10px 40px rgba(15,23,42,.12);font-family:system-ui,-apple-system,sans-serif;" +
    "font-size:11px;color:#0f172a;color-scheme:light;";

  const title = document.createElement("div");
  title.style.cssText =
    "font-size:15px;font-weight:700;color:#0f172a;margin:0 0 4px 0;letter-spacing:-0.02em;line-height:1.2;";
  function syncFileDlTitle() {
    title.textContent = "Скачивание v2 · " + FILE_DL_ACTIVE_STAND + "/" + FILE_DL_ACTIVE_CONTOUR;
  }
  syncFileDlTitle();
  container.appendChild(title);

  const rowStand = document.createElement("div");
  rowStand.style.cssText =
    "display:flex;align-items:center;gap:8px 12px;margin:0 0 6px;font-size:11px;flex-wrap:wrap;" +
    "width:100%;box-sizing:border-box;";
  const labStand = document.createElement("label");
  labStand.style.cssText = "color:#334155;font-weight:600;flex-shrink:0;";
  labStand.textContent = "Стенд:";
  labStand.setAttribute("for", "fileDlStandSelect");
  const selStand = document.createElement("select");
  selStand.id = "fileDlStandSelect";
  selStand.style.cssText =
    "padding:5px 8px;font-size:11px;min-width:160px;max-width:min(360px,100%);cursor:pointer;flex:1 1 200px;" +
    "color:#111827;background-color:#ffffff;border:1px solid #94a3b8;border-radius:6px;color-scheme:light;";
  STAND_KEYS.forEach(function (key) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    opt.style.cssText = "color:#111827;background-color:#ffffff;";
    if (key === FILE_DL_ACTIVE_STAND) opt.selected = true;
    selStand.appendChild(opt);
  });
  selStand.addEventListener("change", function () {
    FILE_DL_ACTIVE_STAND = selStand.value;
    syncFileDlTitle();
  });
  rowStand.appendChild(labStand);
  rowStand.appendChild(selStand);

  const labContour = document.createElement("label");
  labContour.style.cssText = "color:#334155;font-weight:600;flex-shrink:0;";
  labContour.textContent = "Контур:";
  labContour.setAttribute("for", "fileDlContourSelect");
  const selContour = document.createElement("select");
  selContour.id = "fileDlContourSelect";
  selContour.style.cssText =
    "padding:5px 8px;font-size:11px;min-width:140px;max-width:min(240px,100%);cursor:pointer;flex:0 1 160px;" +
    "color:#111827;background-color:#ffffff;border:1px solid #94a3b8;border-radius:6px;color-scheme:light;";
  CONTOUR_KEYS.forEach(function (key) {
    const opt = document.createElement("option");
    opt.value = key;
    var byStand = STAND_ORIGINS[FILE_DL_ACTIVE_STAND] || STAND_ORIGINS[DEFAULT_FILE_DL_STAND];
    opt.textContent = key;
    opt.style.cssText = "color:#111827;background-color:#ffffff;";
    if (key === FILE_DL_ACTIVE_CONTOUR) opt.selected = true;
    selContour.appendChild(opt);
  });
  function refreshFileDlContourOptions() {
    var prev = FILE_DL_ACTIVE_CONTOUR;
    selContour.innerHTML = "";
    CONTOUR_KEYS.forEach(function (key) {
      const opt = document.createElement("option");
      opt.value = key;
      var byStand = STAND_ORIGINS[FILE_DL_ACTIVE_STAND] || STAND_ORIGINS[DEFAULT_FILE_DL_STAND];
      opt.textContent = key;
      opt.style.cssText = "color:#111827;background-color:#ffffff;";
      if (key === prev) opt.selected = true;
      selContour.appendChild(opt);
    });
  }
  selStand.addEventListener("change", function () {
    refreshFileDlContourOptions();
  });
  selContour.addEventListener("change", function () {
    FILE_DL_ACTIVE_CONTOUR = selContour.value;
    syncFileDlTitle();
  });
  rowStand.appendChild(labContour);
  rowStand.appendChild(selContour);

  // «Отметить всё» / «Снять отметки» / «По умолчанию» — сразу после выбора контура.
  const rowMarkBtns = document.createElement("div");
  rowMarkBtns.style.cssText =
    "display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px;flex-shrink:0;";

  /**
   * Кнопка массовой отметки с иконкой.
   * @param {string} label
   * @param {string} icon
   * @param {string} iconColor
   * @param {string} title
   * @param {function(): void} onClick
   * @returns {HTMLButtonElement}
   */
  function mkMarkActionBtn(label, icon, iconColor, title, onClick) {
    const btnMarkBase =
      "min-height:28px;padding:4px 10px;font-size:10px;font-weight:600;cursor:pointer;border-radius:8px;box-sizing:border-box;" +
      "border:1px solid #cbd5e1;background:#f1f5f9;color:#334155;display:inline-flex;align-items:center;gap:5px;";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = title;
    btn.style.cssText = btnMarkBase;
    const ic = document.createElement("span");
    ic.textContent = icon;
    ic.setAttribute("aria-hidden", "true");
    ic.style.cssText =
      "font-size:14px;line-height:1;font-weight:700;color:" + iconColor + ";flex-shrink:0;";
    const tx = document.createElement("span");
    tx.textContent = label;
    btn.appendChild(ic);
    btn.appendChild(tx);
    btn.addEventListener("click", onClick);
    return btn;
  }

  function resetPanelCheckboxesToDefault() {
    panelCheckboxJobs.forEach(function (x) {
      x.cb.checked = isFileDlJobCheckedByDefault(x.job);
    });
    refreshPanelSubSummary();
  }

  rowMarkBtns.appendChild(
    mkMarkActionBtn(
      "Отметить всё",
      "✓",
      "#16a34a",
      "Отметить все чекбоксы на панели",
      function () {
        panelCheckboxJobs.forEach(function (x) {
          x.cb.checked = true;
        });
        refreshPanelSubSummary();
      }
    )
  );
  rowMarkBtns.appendChild(
    mkMarkActionBtn(
      "Снять отметки",
      "⛔",
      "#dc2626",
      "Снять все отметки",
      function () {
        panelCheckboxJobs.forEach(function (x) {
          x.cb.checked = false;
        });
        refreshPanelSubSummary();
      }
    )
  );
  rowMarkBtns.appendChild(
    mkMarkActionBtn(
      "По умолчанию",
      "↺",
      "#0369a1",
      "Вернуть отметки как при открытии панели (по конфигу скрипта)",
      resetPanelCheckboxesToDefault
    )
  );
  rowStand.appendChild(rowMarkBtns);

  const envInfo = document.createElement("div");
  envInfo.style.cssText =
    "display:flex;align-items:center;margin-left:auto;font-size:11px;color:#334155;white-space:nowrap;max-width:100%;" +
    "overflow:hidden;text-overflow:ellipsis;";
  function refreshFileDlEnvInfo() {
    try {
      envInfo.textContent = "POST " + getFileDlOriginByEnv().origin;
    } catch (e) {
      envInfo.textContent = "";
    }
  }
  selStand.addEventListener("change", refreshFileDlEnvInfo);
  selContour.addEventListener("change", refreshFileDlEnvInfo);
  refreshFileDlEnvInfo();
  rowStand.appendChild(envInfo);

  container.appendChild(rowStand);

  container.appendChild(sub);

  const statusLegend = document.createElement("div");
  statusLegend.style.cssText =
    "font-size:9px;color:#64748b;margin:0 0 8px;line-height:1.35;word-break:break-word;";
  statusLegend.textContent =
    "Индикатор: серый — ожидает · синий — отправлен · жёлтый — ответ OK · красный — ошибка · зелёный — файл сохранён. Таймер — мин:сек:мс.";
  container.appendChild(statusLegend);

  // Паузы пакета + перекрытие запросов + дата наград — одна строка (при нехватке ширины перенос подписей).
  const secDelays = document.createElement("div");
  secDelays.style.cssText =
    "margin:0 0 6px;padding:5px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;box-sizing:border-box;";
  secDelays.title =
    "Паузы для пакетов («Все N», «Скачать выделенное», downloadAllJobs), дата сводки наград справа. Подробности — подсказки на полях. Одиночный клик по кнопке задачи — без пауз.";

  const delayOneRow = document.createElement("div");
  delayOneRow.style.cssText =
    "display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:5px 10px;width:100%;box-sizing:border-box;";

  const labDelaysInline = document.createElement("span");
  labDelaysInline.textContent = "Пакет: паузы";
  labDelaysInline.style.cssText =
    "font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;flex-shrink:0;max-width:14em;line-height:1.2;";
  labDelaysInline.title =
    "Паузы только для пакетов («Все N», «Скачать выделенное», downloadAllJobs). Наведите на поля и чекбокс — расширенная подсказка.";
  delayOneRow.appendChild(labDelaysInline);

  /**
   * Компактное поле мс: подпись и input в одну линию.
   * @param {string} labelShort
   * @param {string} idSuffix
   * @param {number} defaultMs
   * @param {string} hintTitle
   * @returns {{ wrap: HTMLLabelElement, inp: HTMLInputElement }}
   */
  function mkInlineDelayField(labelShort, idSuffix, defaultMs, hintTitle) {
    const wrap = document.createElement("label");
    wrap.style.cssText =
      "display:inline-flex;flex-direction:row;align-items:center;gap:4px;font-size:9px;color:#334155;cursor:pointer;flex-shrink:0;";
    wrap.setAttribute("for", "fileDlDelay" + idSuffix);
    const sp = document.createElement("span");
    sp.textContent = labelShort;
    sp.style.cssText =
      "max-width:13em;line-height:1.25;white-space:normal;flex-shrink:1;min-width:0;color:#334155;";
    const inp = document.createElement("input");
    inp.type = "number";
    inp.id = "fileDlDelay" + idSuffix;
    inp.min = "0";
    inp.step = "100";
    inp.max = String(FILE_DL_DELAY_INPUT_MAX_MS);
    inp.value = String(defaultMs);
    inp.title =
      hintTitle + " Допустимо: целое 0…" + FILE_DL_DELAY_INPUT_MAX_MS + " мс (шаг в поле 100).";
    wrap.title = inp.title;
    inp.style.cssText =
      "width:62px;box-sizing:border-box;padding:2px 5px;font-size:10px;color:#0f172a;" +
      "border:1px solid #94a3b8;border-radius:4px;color-scheme:light;flex-shrink:0;";
    function onDelayInput() {
      syncFileDlDelaysFromPanel();
    }
    inp.addEventListener("input", onDelayInput);
    inp.addEventListener("change", onDelayInput);
    wrap.appendChild(sp);
    wrap.appendChild(inp);
    return { wrap: wrap, inp: inp };
  }

  const fieldDelayBetween = mkInlineDelayField(
    "Пауза между файлами пакета (после ответа), мс",
    "Between",
    DOWNLOAD_ALL_DELAY_MS,
    "После ответа сервера по предыдущей задаче ждём столько миллисекунд и только затем отправляем POST для следующего файла. " +
      "Для кнопок «Все N (рейтинг/заказы)», «Скачать выделенное» и downloadAllJobs(). " +
      "При включённом «Перекрывать запросы» эта же пауза — после успешного завершения предыдущего запроса перед стартом следующего. " +
      "Одиночный клик по кнопке задачи пакетом не считается — пауза не ставится."
  );
  const fieldDelayStagger = mkInlineDelayField(
    "Мин. интервал между стартами POST (при перекрытии), мс",
    "Stagger",
    DOWNLOAD_STAGGER_MS,
    "Имеет смысл только если включено «Перекрывать запросы в пакете»: следующий POST нельзя начать раньше, чем через столько мс после старта предыдущего, пока тот ещё не завершился успехом. " +
      "После успешного завершения предыдущего перед следующим стартом действует поле «Пауза между файлами пакета». " +
      "Если перекрытие выключено — запросы строго по одному, между ними только пауза между файлами."
  );
  delayOneRow.appendChild(fieldDelayBetween.wrap);
  delayOneRow.appendChild(fieldDelayStagger.wrap);

  const staggerCb = document.createElement("input");
  staggerCb.type = "checkbox";
  staggerCb.id = "fileDlStaggerCb";
  staggerCb.checked = true;
  staggerCb.style.cssText = "width:14px;height:14px;cursor:pointer;accent-color:#0369a1;flex-shrink:0;";
  var staggerHint =
    "Вкл.: в пакете несколько POST могут идти с перекрытием — следующий старт не раньше чем через «Мин. интервал между стартами…», пока предыдущий не завершился успехом; " +
    "после успеха перед следующим стартом дополнительно ждём «Пауза между файлами пакета». " +
    "Выкл.: строго один запрос за другим, между завершениями только эта пауза.";
  staggerCb.title = staggerHint;
  staggerCb.addEventListener("change", function () {
    FILE_DL_USE_STAGGER = staggerCb.checked;
  });
  const staggerLab = document.createElement("label");
  staggerLab.htmlFor = "fileDlStaggerCb";
  staggerLab.title = staggerHint;
  staggerLab.style.cssText =
    "display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#475569;cursor:pointer;flex-shrink:1;min-width:0;margin-left:2px;max-width:16em;";
  staggerLab.appendChild(staggerCb);
  const staggerTxt = document.createElement("span");
  staggerTxt.textContent = "Перекрывать запросы в пакете (скользящий старт)";
  staggerTxt.style.cssText = "line-height:1.25;white-space:normal;";
  staggerTxt.title = staggerHint;
  staggerLab.appendChild(staggerTxt);
  delayOneRow.appendChild(staggerLab);

  // Награды: dateFrom справа в той же строке, что и задержки (`margin-left: auto`); нативный календарь (`type="date"`).
  const labRewardsDate = document.createElement("label");
  labRewardsDate.style.cssText =
    "display:inline-flex;align-items:center;gap:6px;color:#334155;font-weight:600;flex-shrink:0;cursor:pointer;" +
    "margin-left:auto;";
  labRewardsDate.setAttribute("for", "fileDlRewardsDateFrom");
  const labRewardsDateTxt = document.createElement("span");
  labRewardsDateTxt.textContent = "Награды с:";
  labRewardsDateTxt.style.cssText = "white-space:nowrap;font-size:10px;";
  const inpRewardsDate = document.createElement("input");
  inpRewardsDate.type = "date";
  inpRewardsDate.id = "fileDlRewardsDateFrom";
  inpRewardsDate.value = DEFAULT_EMPLOYEE_REWARDS_DATE_FROM;
  inpRewardsDate.title =
    "Дата dateFrom для POST employee-rewards/file-download (сводка наград). Клик открывает календарь браузера.";
  inpRewardsDate.style.cssText =
    "padding:4px 10px;font-size:11px;font-weight:600;min-width:9.5em;cursor:pointer;box-sizing:border-box;" +
    "color:#0f172a;background-color:#ffffff;border:1px solid #94a3b8;border-radius:8px;color-scheme:light;";
  function onRewardsDateInput() {
    syncFileDlRewardsDateFromPanel();
  }
  inpRewardsDate.addEventListener("input", onRewardsDateInput);
  inpRewardsDate.addEventListener("change", onRewardsDateInput);
  labRewardsDate.appendChild(labRewardsDateTxt);
  labRewardsDate.appendChild(inpRewardsDate);
  delayOneRow.appendChild(labRewardsDate);

  secDelays.appendChild(delayOneRow);
  container.appendChild(secDelays);

  fileDlPanelDelayBetweenInput = fieldDelayBetween.inp;
  fileDlPanelStaggerInput = fieldDelayStagger.inp;
  fileDlPanelRewardsDateInput = inpRewardsDate;
  syncFileDlDelaysFromPanel();
  syncFileDlRewardsDateFromPanel();

  // Основные выгрузки: один горизонтальный ряд по центру, все отмечены по умолчанию.
  const secMain = document.createElement("div");
  secMain.style.cssText =
    "margin:0 0 6px;padding:8px 10px;background:linear-gradient(180deg,#f0f9ff 0%,#e0f2fe 100%);" +
    "border:1px solid #7dd3fc;border-radius:8px;box-sizing:border-box;width:100%;";
  const labMain = document.createElement("div");
  labMain.style.cssText =
    "font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#0369a1;margin:0 0 6px;text-align:center;";
  labMain.textContent = "Основные выгрузки";
  secMain.appendChild(labMain);

  const mainRow = document.createElement("div");
  mainRow.style.cssText =
    "display:flex;flex-direction:row;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 20px;width:100%;box-sizing:border-box;";
  DOWNLOAD_JOBS.forEach(function (job) {
    appendCheckboxOnlyRow(mainRow, job, job.label || job.id, { compact: true });
  });
  secMain.appendChild(mainRow);
  container.appendChild(secMain);

  // Заказы: компактный блок; listType в 2 колонки; только подпись businessBlock.
  const secOrders = document.createElement("div");
  secOrders.style.cssText =
    "margin:0 0 6px;padding:5px 8px;background:linear-gradient(180deg,#ecfdf5 0%,#d1fae5 100%);" +
    "border:1px solid #6ee7b7;border-radius:8px;box-sizing:border-box;width:100%;";
  const labOrders = document.createElement("div");
  labOrders.style.cssText =
    "font-size:10px;font-weight:700;color:#14532d;margin:0 0 4px;line-height:1.2;text-align:center;letter-spacing:0.04em;text-transform:uppercase;";
  labOrders.textContent = "Заказы";
  secOrders.appendChild(labOrders);

  const ordersRow = document.createElement("div");
  ordersRow.style.cssText =
    "display:flex;flex-direction:row;flex-wrap:nowrap;justify-content:stretch;align-items:stretch;gap:8px;width:100%;box-sizing:border-box;";
  const ordersByBlock = groupJobsByBusinessBlock(ORDERS_GROUP_JOBS);
  FILE_DL_ORDERS_BLOCKS_CONFIG.forEach(function (row) {
    var blockJobs = ordersByBlock.get(row.block);
    if (!blockJobs || blockJobs.length === 0) return;
    appendBlockGroupSection(
      ordersRow,
      row.block,
      blockJobs,
      function (job) {
        return job.body && job.body.listType ? String(job.body.listType) : job.label;
      },
      { flexCell: true, cellMinWidth: "120px", columns: 2, titleColor: "#14532d" }
    );
  });
  secOrders.appendChild(ordersRow);
  container.appendChild(secOrders);

  // Рейтинг: 2 строки businessBlock; высота строки — под столбик сезонов самого «высокого» блока.
  const secRating = document.createElement("div");
  secRating.style.cssText =
    "margin:0 0 6px;padding:5px 8px;background:linear-gradient(180deg,#eff6ff 0%,#dbeafe 100%);" +
    "border:1px solid #93c5fd;border-radius:8px;box-sizing:border-box;width:100%;";
  const labRating = document.createElement("div");
  labRating.style.cssText =
    "font-size:10px;font-weight:700;color:#1e3a8a;margin:0 0 4px;line-height:1.2;text-align:center;letter-spacing:0.04em;text-transform:uppercase;";
  labRating.textContent = "Рейтинг";
  secRating.appendChild(labRating);

  const ratingByBlock = groupJobsByBusinessBlock(RATING_GROUP_JOBS);
  FILE_DL_RATING_UI_ROWS.forEach(function (blockNames, rowIndex) {
    const ratingRow = document.createElement("div");
    var rowMinH = calcRatingRowMinHeightPx(blockNames);
    ratingRow.style.cssText =
      "display:flex;flex-direction:row;flex-wrap:nowrap;justify-content:space-evenly;align-items:stretch;gap:8px;" +
      "width:100%;box-sizing:border-box;min-height:" +
      rowMinH +
      "px;" +
      (rowIndex < FILE_DL_RATING_UI_ROWS.length - 1 ? "margin-bottom:6px;" : "");
    blockNames.forEach(function (blockName) {
      var blockJobs = ratingByBlock.get(blockName);
      if (!blockJobs || blockJobs.length === 0) return;
      appendBlockGroupSection(
        ratingRow,
        blockName,
        blockJobs,
        function (job) {
          return job.body && job.body.timePeriod ? String(job.body.timePeriod) : job.label;
        },
        {
          flexCell: true,
          cellMinWidth: "0",
          columns: 1,
          titleColor: "#1e3a8a",
          fillRowHeight: true,
        }
      );
    });
    secRating.appendChild(ratingRow);
  });
  container.appendChild(secRating);

  const btnSelected = document.createElement("button");
  btnSelected.type = "button";
  btnSelected.textContent = "Скачать выделенное";
  btnSelected.style.cssText =
    "display:block;margin:0 0 6px;width:100%;box-sizing:border-box;min-height:32px;padding:6px 10px;" +
    "font-size:11px;font-weight:600;cursor:pointer;border-radius:8px;border:none;color:#fff;" +
    "background:linear-gradient(180deg,#22c55e,#16a34a);box-shadow:0 2px 8px rgba(22,163,74,.35);";
  btnSelected.addEventListener("click", function () {
    downloadCheckedPanelJobs(panelCheckboxJobs);
  });
  container.appendChild(btnSelected);

  const logLab = document.createElement("div");
  logLab.style.cssText =
    "font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;margin:0 0 5px;";
  logLab.textContent = "Журнал работы";
  devTrace.mountToggleRow(container, logLab);
  container.appendChild(logLab);

  const logEl = document.createElement("div");
  logEl.style.cssText =
    "margin:0 0 6px;font-size:9px;color:#0f172a;background:#f8fafc;min-height:76px;max-height:148px;overflow:auto;" +
    "border:1px solid #e2e8f0;border-radius:8px;padding:6px 8px;font-family:ui-monospace,monospace;" +
    "white-space:pre-wrap;word-break:break-word;line-height:1.35;box-sizing:border-box;width:100%;";
  logEl.textContent = "—";
  container.appendChild(logEl);

  fileDlPanelLogAppend = function (line) {
    const s = typeof line === "string" ? line : String(line);
    if (logEl.textContent === "—") logEl.textContent = s;
    else logEl.textContent = logEl.textContent + "\n" + s;
    logEl.scrollTop = logEl.scrollHeight;
  };

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.textContent = "Закрыть";
  btnClose.style.cssText =
    "display:block;margin:0;width:100%;box-sizing:border-box;min-height:30px;padding:6px 10px;font-size:10px;cursor:pointer;" +
    "background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;border-radius:8px;font-weight:500;";
  btnClose.addEventListener("click", function () {
    fileDlDetachPanelAndResetRuntime();
    container.remove();
  });
  container.appendChild(btnClose);

  refreshPanelSubSummary();
  document.body.appendChild(container);
  devTrace.attachPanel(container);
  console.log(
    "[File_DB_Load_GP_v2] Панель открыта. Подробный журнал — в окне «Журнал работы» на панели."
  );
}

// При вставке скрипта в консоль на странице стенда показывается панель.
startDownloadPanel();
})();
