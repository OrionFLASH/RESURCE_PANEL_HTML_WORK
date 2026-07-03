// =============================================================================
// File_DB_Load_GP.js — скачивание файлов через API gamification (консоль DevTools)
// =============================================================================
// POST к эндпоинтам .../file-download — ответ: бинарный файл (скачивание в браузере).
// Куки берутся из текущей сессии (credentials: "include"), на странице нужного стенда.
// Панель: основные выгрузки, группы «Рейтинг» и «Заказы», чекбоксы и «Скачать выделенное» с паузой; подробный журнал — только в окне «Журнал работы», в консоли — кратко.
// Табельные номера не используются.
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
  var devTrace = createDevToolsTrace({ scriptId: "File_DB_Load_GP" });
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

/** id задач, снятых по умолчанию при открытии панели (остальные отмечены). */
const FILE_DL_DEFAULT_UNCHECKED_JOB_IDS = ["orders_KMKKSB_ALLSEASONS", "orders_MNS_NONSEASON"];

/**
 * @param {{ id?: string }} job
 * @returns {boolean}
 */
function isFileDlJobCheckedByDefault(job) {
  var id = job && job.id ? String(job.id) : "";
  return FILE_DL_DEFAULT_UNCHECKED_JOB_IDS.indexOf(id) < 0;
}

// Эндпоинт выгрузки рейтинга (группа кнопок «Рейтинг»).
const RATINGLIST_FILE_DOWNLOAD_PATH = "/bo/rmkib.gamification/proxy/v1/ratinglist/file-download";

// Эндпоинт выгрузки заказов (группа кнопок «Заказы»): body — businessBlock + listType (не timePeriod).
const ORDERS_FILE_DOWNLOAD_PATH = "/bo/rmkib.gamification/proxy/v1/orders/file-download";

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
    apiPath: DEFAULT_FILE_DOWNLOAD_PATH,
    body: {},
    refererPath: "/tournaments/list",
    fileName: null
  },
  {
    id: "employeeRewardsSummary",
    label: "Награды: (LIST REWARD)",
    apiPath: "/bo/rmkib.gamification/proxy/v1/employee-rewards/file-download",
    // dateFrom подставляется в downloadOneJob из панели (`fileDlEmployeeRewardsDateFrom`).
    body: {},
    refererPath: "/awards/list",
    fileName: null
  },
  {
    id: "administrationStatisticCsv",
    label: "Посещения",
    apiPath: "/bo/rmkib.gamification/proxy/v1/administration/statistic/file-download",
    body: {},
    refererPath: "/admin/statistic",
    fileName: null
  }
];

/**
 * Группа «Рейтинг»: один URL, разные payload (businessBlock + timePeriod).
 * У каждой задачи задано уникальное fileName — иначе браузер перезапишет одинаковые gamification-ratingList.csv.
 * Лучше открыть вкладку на …/rating перед запуском.
 */
const RATING_GROUP_JOBS = [
  {
    id: "rating_KMKKSB_ACTIVESEASON",
    label: "Рейтинг · KMKKSB · ACTIVESEASON",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", timePeriod: "ACTIVESEASON" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_KMKKSB_ACTIVESEASON.csv"
  },
  {
    id: "rating_KMKKSB_SEASON_2025_2",
    label: "Рейтинг · KMKKSB · SEASON_2025_2",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", timePeriod: "SEASON_2025_2" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_KMKKSB_SEASON_2025_2.csv"
  },
  {
    id: "rating_KMKKSB_SEASON_2025_1",
    label: "Рейтинг · KMKKSB · SEASON_2025_1",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", timePeriod: "SEASON_2025_1" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_KMKKSB_SEASON_2025_1.csv"
  },
  {
    id: "rating_KMKKSB_SEASON_2024",
    label: "Рейтинг · KMKKSB · SEASON_2024",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", timePeriod: "SEASON_2024" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_KMKKSB_SEASON_2024.csv"
  },
  {
    id: "rating_KMKKSB_ALLTHETIME",
    label: "Рейтинг · KMKKSB · ALLTHETIME",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", timePeriod: "ALLTHETIME" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_KMKKSB_ALLTHETIME.csv"
  },
  {
    id: "rating_MNS_ACTIVESEASON",
    label: "Рейтинг · MNS · ACTIVESEASON",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", timePeriod: "ACTIVESEASON" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_MNS_ACTIVESEASON.csv"
  },
  {
    id: "rating_MNS_SEASON_m_2025_2",
    label: "Рейтинг · MNS · SEASON_m_2025_2",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", timePeriod: "SEASON_m_2025_2" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_MNS_SEASON_m_2025_2.csv"
  },
  {
    id: "rating_MNS_SEASON_m_2025_1",
    label: "Рейтинг · MNS · SEASON_m_2025_1",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", timePeriod: "SEASON_m_2025_1" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_MNS_SEASON_m_2025_1.csv"
  },
  {
    id: "rating_MNS_SEASON_m_2024",
    label: "Рейтинг · MNS · SEASON_m_2024",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", timePeriod: "SEASON_m_2024" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_MNS_SEASON_m_2024.csv"
  },
  {
    id: "rating_MNS_ALLTHETIME",
    label: "Рейтинг · MNS · ALLTHETIME",
    apiPath: RATINGLIST_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", timePeriod: "ALLTHETIME" },
    refererPath: "/rating",
    fileName: "gamification-ratingList_MNS_ALLTHETIME.csv"
  }
];

/**
 * Группа «Заказы»: POST …/orders/file-download, в теле listType (аналог периодов рейтинга).
 * Вместо двух запросов с ACTIVESEASON — два с NONSEASON (KMKKSB и MNS).
 * Сервер часто отдаёт одно имя gamification-orderList.csv — задаём уникальные fileName.
 * Лучше открыть вкладку на …/admin/orders перед запуском.
 */
const ORDERS_GROUP_JOBS = [
  {
    id: "orders_KMKKSB_NONSEASON",
    label: "Заказы · KMKKSB · NONSEASON",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", listType: "NONSEASON" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_KMKKSB_NONSEASON.csv"
  },
  {
    id: "orders_KMKKSB_SEASON_2025_2",
    label: "Заказы · KMKKSB · SEASON_2025_2",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", listType: "SEASON_2025_2" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_KMKKSB_SEASON_2025_2.csv"
  },
  {
    id: "orders_KMKKSB_SEASON_2025_1",
    label: "Заказы · KMKKSB · SEASON_2025_1",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", listType: "SEASON_2025_1" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_KMKKSB_SEASON_2025_1.csv"
  },
  {
    id: "orders_KMKKSB_SEASON_2024",
    label: "Заказы · KMKKSB · SEASON_2024",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", listType: "SEASON_2024" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_KMKKSB_SEASON_2024.csv"
  },
  {
    id: "orders_KMKKSB_ALLSEASONS",
    label: "Заказы · KMKKSB · ALLSEASONS",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "KMKKSB", listType: "ALLSEASONS" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_KMKKSB_ALLSEASONS.csv"
  },
  {
    id: "orders_MNS_NONSEASON",
    label: "Заказы · MNS · NONSEASON",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", listType: "NONSEASON" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_MNS_NONSEASON.csv"
  },
  {
    id: "orders_MNS_SEASON_m_2025_2",
    label: "Заказы · MNS · SEASON_m_2025_2",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", listType: "SEASON_m_2025_2" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_MNS_SEASON_m_2025_2.csv"
  },
  {
    id: "orders_MNS_SEASON_m_2025_1",
    label: "Заказы · MNS · SEASON_m_2025_1",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", listType: "SEASON_m_2025_1" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_MNS_SEASON_m_2025_1.csv"
  },
  {
    id: "orders_MNS_SEASON_m_2024",
    label: "Заказы · MNS · SEASON_m_2024",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", listType: "SEASON_m_2024" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_MNS_SEASON_m_2024.csv"
  },
  {
    id: "orders_MNS_ALLSEASONS",
    label: "Заказы · MNS · ALLSEASONS",
    apiPath: ORDERS_FILE_DOWNLOAD_PATH,
    body: { businessBlock: "MNS", listType: "ALLSEASONS" },
    refererPath: "/admin/orders",
    fileName: "gamification-orderList_MNS_ALLSEASONS.csv"
  }
];

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
    console.log("[File_DB_Load_GP] Одиночная загрузка: OK | " + r.fileName);
  } else {
    var tail = r.status != null ? " | HTTP " + r.status : "";
    var errS = r.error != null ? " | " + String(r.error).slice(0, 160) : "";
    console.log("[File_DB_Load_GP] Одиночная загрузка: ошибка" + tail + errS);
  }
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
  try {
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
    // id задачи уже в предыдущем логе «СТАРТ загрузки» — не дублируем.
    fileDlPanelEcho("error", "ОШИБКА (сеть / исключение)\n" + String(e));
    _dlExit = { ok: false, error: String(e) };
    return _dlExit;
  }

  if (!res.ok) {
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
      fileDlPanelEcho(
        "warn",
        "ОШИБКА: ответ помечен как JSON, разбор не удался\n" + String(parseErr)
      );
      _dlExit = { ok: false, error: "invalid_json_body" };
      return _dlExit;
    }
    if (data && data.success === false && data.error) {
      const err = data.error;
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
      fileDlPanelEcho(
        "warn",
        "Ответ JSON с success:true — не файл выгрузки, скачивание отменено"
      );
      _dlExit = { ok: false, error: "unexpected_json_success" };
      return _dlExit;
    }
    fileDlPanelEcho(
      "warn",
      "Ответ application/json непохож на файл выгрузки — скачивание отменено"
    );
    _dlExit = { ok: false, error: "unexpected_json_shape" };
    return _dlExit;
  }

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

  // При параллельном (скользящем) старте подробности по каждому файлу — в «Журнал работы».
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
    "[File_DB_Load_GP] Пакет «" +
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
    "[File_DB_Load_GP] Пакет «" +
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
    "[File_DB_Load_GP] Пакет «" +
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
    "[File_DB_Load_GP] Пакет «" +
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

/** Основные выгрузки + рейтинг + заказы. */
async function downloadAllJobs() {
  syncFileDlDelaysFromPanel();
  await downloadJobsSequentially(getAllDownloadJobs(), "«Скачать всё»");
}

/** Только группа «Рейтинг» (10 файлов). */
async function downloadRatingGroupOnly() {
  await downloadJobsBatch(RATING_GROUP_JOBS, "«Загрузить Рейтинг»", FILE_DL_USE_STAGGER);
}

/** Только группа «Заказы» (10 файлов). */
async function downloadOrdersGroupOnly() {
  await downloadJobsBatch(ORDERS_GROUP_JOBS, "«Загрузить Заказы»", FILE_DL_USE_STAGGER);
}

/**
 * Скачивание только тех задач, у которых на панели отмечен чекбокс.
 * @param {{ cb: HTMLInputElement, job: object }[]} entries — пары чекбокс + задача с панели.
 */
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
}

/**
 * Панель: кнопка на каждую задачу + чекбокс для пакета «Скачать выделенное».
 * Стиль окна и кнопок — в одном ключе с AddressBook_export / Tournament_LeadersForAdmin; внизу «Журнал работы».
 */
function startDownloadPanel() {
  var prevRoot = document.getElementById("fileDlGamificationPanelRoot");
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

  // Кнопки строк: текст по центру, чуть крупнее шрифт; высота умеренная.
  const btnJobRowBase =
    "flex:1;min-width:0;margin:0;min-height:30px;padding:5px 6px;font-size:10px;font-weight:600;cursor:pointer;" +
    "border-radius:8px;border:none;color:#fff;box-sizing:border-box;display:flex;align-items:center;" +
    "justify-content:center;line-height:1.2;text-align:center;white-space:normal;word-break:break-word;";
  const panelBtnGroupRow = btnJobRowBase;

  /**
   * Строка: чекбокс + кнопка скачивания одной задачи (учёт в «Скачать выделенное»).
   * @param {HTMLElement} parent
   * @param {object} job
   * @param {string} buttonCss — стили кнопки (в т.ч. background).
   * @param {function(): void} onButtonClick
   */
  function appendRowWithCheckbox(parent, job, buttonCss, onButtonClick) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;flex-direction:row;align-items:center;gap:4px;margin:2px 0;width:100%;box-sizing:border-box;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isFileDlJobCheckedByDefault(job);
    cb.title = "Участвует в «Скачать выделенное»";
    cb.style.cssText =
      "margin:0;flex-shrink:0;width:14px;height:14px;cursor:pointer;accent-color:#0369a1;";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = job.label || job.id || "Скачать";
    btn.style.cssText = buttonCss;
    btn.addEventListener("click", onButtonClick);
    row.appendChild(cb);
    row.appendChild(btn);
    parent.appendChild(row);
    panelCheckboxJobs.push({ cb: cb, job: job });
    cb.addEventListener("change", refreshPanelSubSummary);
  }

  const container = document.createElement("div");
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
    title.textContent = "Скачивание (gamification) · " + FILE_DL_ACTIVE_STAND + "/" + FILE_DL_ACTIVE_CONTOUR;
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

  // «Отметить всё» / «Снять отметки» — справа в строке стенда (освобождает место по вертикали под лог).
  const rowMarkBtns = document.createElement("div");
  rowMarkBtns.style.cssText =
    "display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px;flex-shrink:0;";
  const btnMarkBase =
    "min-height:28px;padding:4px 10px;font-size:10px;font-weight:600;cursor:pointer;border-radius:8px;box-sizing:border-box;" +
    "border:1px solid #cbd5e1;background:#f1f5f9;color:#334155;";
  const btnMarkAll = document.createElement("button");
  btnMarkAll.type = "button";
  btnMarkAll.textContent = "Отметить всё";
  btnMarkAll.style.cssText = btnMarkBase;
  btnMarkAll.addEventListener("click", function () {
    panelCheckboxJobs.forEach(function (x) {
      x.cb.checked = true;
    });
    refreshPanelSubSummary();
  });
  rowMarkBtns.appendChild(btnMarkAll);
  const btnClearAll = document.createElement("button");
  btnClearAll.type = "button";
  btnClearAll.textContent = "Снять отметки";
  btnClearAll.style.cssText = btnMarkBase;
  btnClearAll.addEventListener("click", function () {
    panelCheckboxJobs.forEach(function (x) {
      x.cb.checked = false;
    });
    refreshPanelSubSummary();
  });
  rowMarkBtns.appendChild(btnClearAll);
  rowStand.appendChild(rowMarkBtns);

  container.appendChild(rowStand);

  container.appendChild(sub);

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

  // Основные выгрузки: одна строка из трёх кнопок + чекбоксы, карточка в стиле колонок ниже.
  const secMain = document.createElement("div");
  secMain.style.cssText =
    "margin:0 0 6px;padding:6px 8px;background:linear-gradient(180deg,#f0f9ff 0%,#e0f2fe 100%);" +
    "border:1px solid #7dd3fc;border-radius:8px;box-sizing:border-box;";
  const labMain = document.createElement("div");
  labMain.style.cssText =
    "font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#0369a1;margin:0 0 4px;";
  labMain.textContent = "Основные выгрузки";
  secMain.appendChild(labMain);

  const mainGrid = document.createElement("div");
  mainGrid.style.cssText =
    "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;width:100%;box-sizing:border-box;align-items:stretch;";

  const mainBtnCss =
    btnJobRowBase +
    "background:linear-gradient(180deg,#0284c7,#0369a1);box-shadow:0 2px 6px rgba(3,105,161,.3);";

  DOWNLOAD_JOBS.forEach(function (job) {
    const cell = document.createElement("div");
    cell.style.cssText =
      "display:flex;flex-direction:row;align-items:center;gap:4px;min-width:0;box-sizing:border-box;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isFileDlJobCheckedByDefault(job);
    cb.title = "Участвует в «Скачать выделенное»";
    cb.style.cssText =
      "margin:0;flex-shrink:0;width:14px;height:14px;cursor:pointer;accent-color:#0369a1;";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = job.label || job.id || "Скачать";
    btn.style.cssText = mainBtnCss;
    btn.addEventListener("click", function () {
      downloadOneJob(job, {
        groupName: getGroupNameForJob(job),
        batchName: "ручной клик (одна задача) | секция «Основные выгрузки»"
      });
    });
    cell.appendChild(cb);
    cell.appendChild(btn);
    mainGrid.appendChild(cell);
    panelCheckboxJobs.push({ cb: cb, job: job });
    cb.addEventListener("change", refreshPanelSubSummary);
  });
  secMain.appendChild(mainGrid);
  container.appendChild(secMain);

  const rowRatingOrders = document.createElement("div");
  rowRatingOrders.style.cssText =
    "display:flex;flex-direction:row;gap:8px;align-items:flex-start;margin:0 0 6px;width:100%;box-sizing:border-box;";

  const secRating = document.createElement("div");
  secRating.style.cssText =
    "flex:1;min-width:0;box-sizing:border-box;margin:0;padding:6px 8px;background:linear-gradient(180deg,#eff6ff 0%,#dbeafe 100%);" +
    "border:1px solid #93c5fd;border-radius:8px;";
  const labRating = document.createElement("div");
  labRating.style.cssText = "font-size:10px;font-weight:700;color:#1e3a8a;margin:0 0 4px;line-height:1.2;";
  labRating.textContent = "Рейтинг (" + RATING_GROUP_JOBS.length + ")";
  secRating.appendChild(labRating);

  RATING_GROUP_JOBS.forEach(function (job) {
    appendRowWithCheckbox(
      secRating,
      job,
      panelBtnGroupRow +
        "background:linear-gradient(180deg,#4f6fc4,#3b5ca8);box-shadow:0 2px 5px rgba(59,92,168,.25);",
      function () {
        downloadOneJob(job, {
          groupName: "Рейтинг",
          batchName: "ручной клик (одна задача) | секция «Рейтинг»"
        });
      }
    );
  });

  const btnRatingAll = document.createElement("button");
  btnRatingAll.type = "button";
  btnRatingAll.textContent = "Все " + RATING_GROUP_JOBS.length + " (рейтинг)";
  btnRatingAll.style.cssText =
    "display:block;margin:4px 0 0;width:100%;box-sizing:border-box;min-height:30px;padding:5px 8px;" +
    "font-size:10px;font-weight:600;cursor:pointer;border-radius:8px;border:none;color:#fff;" +
    "background:linear-gradient(180deg,#7c3aed,#6d28d9);box-shadow:0 2px 6px rgba(124,58,237,.35);";
  btnRatingAll.addEventListener("click", function () {
    downloadRatingGroupOnly();
  });
  secRating.appendChild(btnRatingAll);
  rowRatingOrders.appendChild(secRating);

  const secOrders = document.createElement("div");
  secOrders.style.cssText =
    "flex:1;min-width:0;box-sizing:border-box;margin:0;padding:6px 8px;background:linear-gradient(180deg,#ecfdf5 0%,#d1fae5 100%);" +
    "border:1px solid #6ee7b7;border-radius:8px;";
  const labOrders = document.createElement("div");
  labOrders.style.cssText = "font-size:10px;font-weight:700;color:#14532d;margin:0 0 4px;line-height:1.2;";
  labOrders.textContent = "Заказы (" + ORDERS_GROUP_JOBS.length + ")";
  secOrders.appendChild(labOrders);

  ORDERS_GROUP_JOBS.forEach(function (job) {
    appendRowWithCheckbox(
      secOrders,
      job,
      panelBtnGroupRow +
        "background:linear-gradient(180deg,#199f63,#15803d);box-shadow:0 2px 5px rgba(21,128,61,.25);",
      function () {
        downloadOneJob(job, {
          groupName: "Заказы",
          batchName: "ручной клик (одна задача) | секция «Заказы»"
        });
      }
    );
  });

  const btnOrdersAll = document.createElement("button");
  btnOrdersAll.type = "button";
  btnOrdersAll.textContent = "Все " + ORDERS_GROUP_JOBS.length + " (заказы)";
  btnOrdersAll.style.cssText =
    "display:block;margin:4px 0 0;width:100%;box-sizing:border-box;min-height:30px;padding:5px 8px;" +
    "font-size:10px;font-weight:600;cursor:pointer;border-radius:8px;border:none;color:#fff;" +
    "background:linear-gradient(180deg,#059669,#047857);box-shadow:0 2px 6px rgba(5,150,105,.35);";
  btnOrdersAll.addEventListener("click", function () {
    downloadOrdersGroupOnly();
  });
  secOrders.appendChild(btnOrdersAll);
  rowRatingOrders.appendChild(secOrders);

  container.appendChild(rowRatingOrders);

  const btnSelected = document.createElement("button");
  btnSelected.type = "button";
  btnSelected.textContent = "Скачать выделенное (по чекбоксам)";
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
    "[File_DB_Load_GP] Панель открыта. Подробный журнал — в окне «Журнал работы» на панели."
  );
}

// При вставке скрипта в консоль на странице стенда показывается панель.
startDownloadPanel();
})();
