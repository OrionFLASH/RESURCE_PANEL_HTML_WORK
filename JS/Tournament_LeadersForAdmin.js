// =============================================================================
// Tournament_LeadersForAdmin.js — выгрузка leadersForAdmin по кодам турниров
// =============================================================================
// DevTools на странице стенда (ALPHA omega / SIGMA salesheroes). GET JSON.
// Источники кодов: текстовое поле, файл .txt, CSV (общие имена колонок + два фильтра статусов / SHEDULE и LIST).
// =============================================================================
// Повторная вставка в консоль: весь код в IIFE — иначе глобальные const (TOURNAMENT_BASE и др.) дают SyntaxError.
(function () {
  "use strict";

const TOURNAMENT_BASE = {
  PROM: {
    ALPHA: "https://efs-our-business-prom.omega.sbrf.ru/bo/rmkib.gamification/api/v1/tournaments/",
    SIGMA: "https://salesheroes.sberbank.ru/bo/rmkib.gamification/api/v1/tournaments/"
  },
  PSI: {
    ALPHA: "https://iam-enigma-psi.omega.sbrf.ru/bo/rmkib.gamification/api/v1/tournaments/",
    SIGMA: "https://salesheroes-psi.sigma.sbrf.ru/bo/rmkib.gamification/api/v1/tournaments/"
  },
  "IFT-SB": {
    ALPHA: "https://iam-enigma-psi.omega.sbrf.ru/bo/rmkib.gamification/api/v1/tournaments/",
    SIGMA: "https://salesheroes-psi.sigma.sbrf.ru/bo/rmkib.gamification/api/v1/tournaments/"
  },
  "IFT-GF": {
    ALPHA: "https://iam-enigma-psi.omega.sbrf.ru/bo/rmkib.gamification/api/v1/tournaments/",
    SIGMA: "https://salesheroes-psi.sigma.sbrf.ru/bo/rmkib.gamification/api/v1/tournaments/"
  }
};
const TOURNAMENT_STAND_KEYS = ["PROM", "PSI", "IFT-SB", "IFT-GF"];
const TOURNAMENT_CONTOUR_KEYS = ["ALPHA", "SIGMA"];
const TOURNAMENT_AUTO_ENV = detectTournamentEnvFromLocation();
const DEFAULT_TOURNAMENT_STAND = (TOURNAMENT_AUTO_ENV && TOURNAMENT_AUTO_ENV.stand) || "PROM";
const DEFAULT_TOURNAMENT_CONTOUR = (TOURNAMENT_AUTO_ENV && TOURNAMENT_AUTO_ENV.contour) || "ALPHA";

function detectTournamentEnvFromLocation() {
  var origin = "";
  try {
    origin = String(window.location.origin || "").toLowerCase();
  } catch (e) {}
  for (var si = 0; si < TOURNAMENT_STAND_KEYS.length; si++) {
    var stand = TOURNAMENT_STAND_KEYS[si];
    var byStand = TOURNAMENT_BASE[stand];
    if (!byStand) continue;
    for (var ci = 0; ci < TOURNAMENT_CONTOUR_KEYS.length; ci++) {
      var contour = TOURNAMENT_CONTOUR_KEYS[ci];
      var baseUrl = String((byStand && byStand[contour]) || "");
      var host = "";
      try {
        host = new URL(baseUrl).origin.toLowerCase();
      } catch (eHost) {}
      if (host && host === origin) {
        return { stand: stand, contour: contour };
      }
    }
  }
  return null;
}

/** Стенд/контур для GET leadersForAdmin; обновляются списками на панели. */
let TOURNAMENT_UI_STAND = DEFAULT_TOURNAMENT_STAND;
let TOURNAMENT_UI_CONTOUR = DEFAULT_TOURNAMENT_CONTOUR;

const LEADERS_SERVICE = "leadersForAdmin";
/** Значение по умолчанию для поля «Пауза между запросами» на панели (мс). */
const DEFAULT_REQUEST_GAP_MS = 5;
/** Плейсхолдер поля префикса имени файла: пустое значение = авто `leadersForAdmin_{стенд}_`. */
const DEFAULT_EXPORT_FILENAME_PREFIX_PLACEHOLDER = "авто: leadersForAdmin + стенд + контур + _";

/** Статусы CSV вариант 1 (колонка TOURNAMENT_STATUS). */
const CSV1_STATUS_LABELS = [
  "АКТИВНЫЙ",
  "ЗАВЕРШЕН",
  "ОТМЕНЕН",
  "ПОДВЕДЕНИЕ ИТОГОВ",
  "УДАЛЕН"
];

/** Статусы CSV вариант 2 (колонка «Бизнес-статус турнира»). */
const CSV2_STATUS_LABELS = [
  "Активный",
  "Завершен",
  "Запланирован",
  "Отменен",
  "Подведение итогов",
  "Удален"
];

/** По умолчанию в фильтре CSV отмечены только «активные» статусы (остальные чекбоксы сняты). */
const CSV1_DEFAULT_CHECKED_STATUSES = ["АКТИВНЫЙ"];
const CSV2_DEFAULT_CHECKED_STATUSES = ["Активный"];

/** Варианты в combobox для колонки кода (можно ввести свой заголовок). */
const CSV_CODE_COLUMN_PRESETS = ["TOURNAMENT_CODE", "Код турнира"];
/** Варианты в combobox для колонки статуса. */
const CSV_STATUS_COLUMN_PRESETS = ["TOURNAMENT_STATUS", "Бизнес-статус турнира"];

/** Коды турнира по умолчанию в общем поле ввода при открытии панели. */
const DEFAULT_TOURNAMENT_CODES_TEXTAREA = [
  "TOURNAMENT_91_01",
  "TOURNAMENT_92_01",
  "TOURNAMENT_93_01",
  "TOURNAMENT_94_01",
  "TOURNAMENT_95_01",
  "TOURNAMENT_96_01"
];

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function getTournamentEnv() {
  var stand = TOURNAMENT_STAND_KEYS.indexOf(TOURNAMENT_UI_STAND) >= 0 ? TOURNAMENT_UI_STAND : DEFAULT_TOURNAMENT_STAND;
  var contour =
    TOURNAMENT_CONTOUR_KEYS.indexOf(TOURNAMENT_UI_CONTOUR) >= 0
      ? TOURNAMENT_UI_CONTOUR
      : DEFAULT_TOURNAMENT_CONTOUR;
  var byStand = TOURNAMENT_BASE[stand] || TOURNAMENT_BASE[DEFAULT_TOURNAMENT_STAND];
  var baseUrl = (byStand && byStand[contour]) || TOURNAMENT_BASE[DEFAULT_TOURNAMENT_STAND][DEFAULT_TOURNAMENT_CONTOUR];
  return { stand: stand, contour: contour, baseUrl: baseUrl };
}

function getTimestamp() {
  const d = new Date();
  const p = function (n) {
    return n.toString().padStart(2, "0");
  };
  return (
    d.getFullYear().toString() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

/**
 * Извлекает коды турнира из текста: токены из букв, цифр, _, -
 * @param {string} text
 * @returns {string[]}
 */
function parseTournamentCodesFromText(text) {
  if (!text || typeof text !== "string") return [];
  const re = /[A-Za-z0-9_-]+/g;
  const m = text.match(re) || [];
  const seen = {};
  const out = [];
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (!seen[c]) {
      seen[c] = true;
      out.push(c);
    }
  }
  return out;
}

/**
 * Простой разбор CSV с кавычками и разделителем , или ;
 * @param {string} text
 * @returns {{ headers: string[], rows: string[][] }}
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(function (l) {
    return l.trim().length > 0;
  });
  if (lines.length === 0) return { headers: [], rows: [] };
  const first = lines[0];
  const sep =
    first.split(";").length > first.split(",").length ? ";" : ",";
  function parseLine(line) {
    const cells = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (!inQ && ch === sep) {
        cells.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }
  const headers = parseLine(lines[0]);
  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    rows.push(parseLine(lines[r]));
  }
  return { headers: headers, rows: rows };
}

function indexOfHeader(headers, name) {
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].trim() === name) return i;
  }
  return -1;
}

/**
 * Коды из CSV по именам колонок (как в первой строке файла, с учётом trim).
 * @param {string} csvText
 * @param {Record<string, boolean>} allowedStatus — какие значения статуса включены
 * @param {string} codeColumnName — заголовок колонки с кодом турнира
 * @param {string} statusColumnName — заголовок колонки со статусом (фильтр чекбоксов)
 * @param {function(string): void} [warnToJournal] — опционально: предупреждения в «Журнал работы» (не в консоль)
 * @returns {string[]}
 */
function codesFromCsvByColumns(csvText, allowedStatus, codeColumnName, statusColumnName, warnToJournal) {
  const { headers, rows } = parseCsv(csvText);
  const ch = (codeColumnName || "").trim();
  const sh = (statusColumnName || "").trim();
  if (!ch || !sh) {
    if (typeof warnToJournal === "function") {
      warnToJournal("CSV: не заданы имена колонок (код и/или статус).");
    }
    return [];
  }
  const ic = indexOfHeader(headers, ch);
  const is = indexOfHeader(headers, sh);
  if (ic < 0 || is < 0) {
    if (typeof warnToJournal === "function") {
      warnToJournal(
        "CSV: колонки не найдены. Ожидались «" +
          ch +
          "» и «" +
          sh +
          "». Заголовки в файле: " +
          headers.join(" | ")
      );
    }
    return [];
  }
  const out = [];
  const seen = {};
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const st = (row[is] || "").trim();
    if (!allowedStatus[st]) continue;
    const code = (row[ic] || "").trim();
    if (code && !seen[code]) {
      seen[code] = true;
      out.push(code);
    }
  }
  return out;
}

/**
 * Сколько лидеров в ответе API; null — ответ считаем пустым/без тела (в JSON не сохраняем).
 * @param {*} data — объект после res.json()
 * @returns {number|null}
 */
function countLeadersInResponseData(data) {
  if (data == null || typeof data !== "object") return null;
  const leadersArr =
    (data.body && data.body.tournament && data.body.tournament.leaders) ||
    (data.body && data.body.badge && data.body.badge.leaders);
  if (!Array.isArray(leadersArr)) return 0;
  return leadersArr.length;
}

/**
 * Сколько раз в дереве JSON встречается непустое поле employeeNumber (участники по данным API).
 * @param {*} obj
 * @returns {number}
 */
function countEmployeeNumberFieldsInTree(obj) {
  let n = 0;
  function walk(o) {
    if (o == null) return;
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) walk(o[i]);
      return;
    }
    if (typeof o !== "object") return;
    const keys = Object.keys(o);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = o[k];
      if (k === "employeeNumber") {
        if (v != null && v !== "") n++;
      } else {
        walk(v);
      }
    }
  }
  walk(obj);
  return n;
}

/**
 * Безопасный префикс имени файла (до таймштампа): без путей и запрещённых символов.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeExportFilenamePrefix(raw) {
  var t = String(raw || "").trim();
  if (!t) return "";
  t = t.replace(/[/\\:*?"<>|\x00-\x1f]+/g, "_").replace(/\s+/g, "_");
  if (t.length > 100) t = t.slice(0, 100);
  while (t.length && (t.endsWith("_") || t.endsWith("."))) t = t.slice(0, -1);
  return t;
}

/**
 * Ошибку API/HTTP кладём внутрь `body.tournament.error` при `success:true` и `status:"ERROR"` —
 * одна запись в массиве по ключу турнира, удобно разворачивать в плоскую таблицу (одна строка на турнир).
 * @param {string} tid — код турнира из запроса (ключ в JSON и `tournamentId`).
 * @param {Record<string, unknown>} errObj — объект `error` как от API или синтетический.
 * @returns {{ success: true, body: { tournament: Record<string, unknown> } }}
 */
function buildTournamentWrappedErrorRecord(tid, errObj) {
  const id = tid != null ? String(tid) : "";
  return {
    success: true,
    body: {
      tournament: {
        tournamentId: id,
        tournamentIndicator: "",
        status: "ERROR",
        contestants: "",
        leaders: [],
        error: errObj
      }
    }
  };
}

/**
 * Достаёт объект ошибки из записи экспорта (вложенный вариант или устаревший плоский `success:false`).
 * @param {*} root — первый элемент массива по ключу турнира
 * @returns {Record<string, unknown>|null}
 */
function getExportErrorPayload(root) {
  if (root == null || typeof root !== "object") return null;
  if (root.success === false && root.error && typeof root.error === "object") return root.error;
  const t = root.body && root.body.tournament;
  if (root.success === true && t && typeof t === "object" && t.status === "ERROR" && t.error && typeof t.error === "object") {
    return t.error;
  }
  return null;
}

/**
 * Одна запись в массиве по ключу турнира в итоговом JSON.
 * — Успех с лидерами: как вернул API `[data]`.
 * — 0 лидеров: `{ success:false, body:{ tournament:{…, contestants:"0 участников", leaders:[] }}}`.
 * — Ошибка API (`success:false` + `error`): одна запись `{ success:true, body:{ tournament:{ tournamentId, …пустые…, status:"ERROR", error:<как в API> }}}`.
 * — HTTP не OK: тело с `error` — то же оборачивание; иначе синтетический `error` внутри турнира.
 * — Нет JSON-тела при OK: `null` (в файл не включаем).
 * @param {string} tid
 * @param {{ ok: boolean, status: number, tournamentId: string, data: * }} fr
 * @returns {unknown[]|null}
 */
function buildLeadersExportRecordArray(tid, fr) {
  if (!fr.ok) {
    const d = fr.data;
    if (d && typeof d === "object" && d.success === false && d.error && typeof d.error === "object") {
      return [buildTournamentWrappedErrorRecord(tid, d.error)];
    }
    return [
      buildTournamentWrappedErrorRecord(tid, {
        code: "HTTP-" + fr.status,
        title: "Ошибка HTTP",
        text:
          "Запрос GET leadersForAdmin для «" +
          tid +
          "» завершился со статусом " +
          fr.status +
          ".",
        type: "error",
        tournamentId: tid
      })
    ];
  }

  const data = fr.data;
  if (data == null || typeof data !== "object") {
    return null;
  }

  if (data.success === false && data.error && typeof data.error === "object") {
    return [buildTournamentWrappedErrorRecord(tid, data.error)];
  }

  const cnt = countLeadersInResponseData(data);
  if (cnt === null) {
    return null;
  }

  if (cnt === 0) {
    const src =
      (data.body && data.body.tournament && typeof data.body.tournament === "object" && data.body.tournament) ||
      (data.body && data.body.badge && typeof data.body.badge === "object" && data.body.badge) ||
      {};
    const leadersArr = Array.isArray(src.leaders) ? src.leaders.slice() : [];
    const tObj = {
      tournamentId:
        src.tournamentId != null && String(src.tournamentId) !== ""
          ? src.tournamentId
          : src.id != null && String(src.id) !== ""
            ? src.id
            : tid,
      tournamentIndicator: src.tournamentIndicator != null ? String(src.tournamentIndicator) : "",
      status: src.status != null ? String(src.status) : "",
      contestants: "0 участников",
      leaders: leadersArr
    };
    return [
      {
        success: false,
        body: {
          tournament: tObj
        }
      }
    ];
  }

  return [data];
}

async function fetchLeadersForAdmin(baseUrl, tournamentId) {
  const url =
    baseUrl +
    encodeURIComponent(tournamentId) +
    "/" +
    LEADERS_SERVICE +
    "?pageNum=1";
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return { ok: res.ok, status: res.status, tournamentId: tournamentId, data: data };
}

function downloadJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () {
    URL.revokeObjectURL(a.href);
  }, 0);
}

function startTournamentPanel() {
  var prevRoot = document.getElementById("tournamentLeadersForAdminRoot");
  if (prevRoot) prevRoot.remove();

  const root = document.createElement("div");
  root.id = "tournamentLeadersForAdminRoot";
  // color + color-scheme: на тёмной странице иначе наследуется светлый текст — нечитаемо на белом фоне панели.
  // Колонка flex + overflow:hidden: прокрутка только у средней части и внутри лога, панель не раздувает страницу.
  root.style.cssText =
    "position:fixed;left:10px;top:10px;width:min(920px,calc(100vw - 16px));max-height:92vh;height:92vh;" +
    "display:flex;flex-direction:column;overflow:hidden;z-index:999999;" +
    "background:#ffffff;border:1px solid #cbd5e1;padding:14px 16px;box-shadow:0 12px 40px rgba(15,23,42,.12);border-radius:12px;" +
    "font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#111827;color-scheme:light;box-sizing:border-box;";

  const title = document.createElement("div");
  title.style.cssText =
    "font-weight:700;font-size:16px;margin-bottom:2px;color:#0f172a;letter-spacing:-0.02em;";
  title.textContent = "Турниры — leadersForAdmin";
  root.appendChild(title);
  const titleSub = document.createElement("div");
  titleSub.style.cssText = "font-size:11px;color:#64748b;margin-bottom:10px;line-height:1.4;";
  titleSub.textContent =
    "Каждая кнопка сразу запускает выгрузку. Для .txt и CSV сначала откроется выбор файла. Стенд, контур, префикс имени файла и паузу задайте до нажатия. В JSON попадают и ошибки, и «0 участников»; без тела ответа при HTTP OK строка не пишется; файл из одного «{}» не создаётся. Ход выгрузки — в «Журнал работы»; в консоли — кратко о старте и итоге.";
  root.appendChild(titleSub);

  const stRow = document.createElement("div");
  stRow.style.cssText =
    "display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;font-size:12px;color:#111827;" +
    "width:100%;box-sizing:border-box;";
  const labSt = document.createElement("label");
  labSt.textContent = "Стенд:";
  labSt.setAttribute("for", "tournamentStandSel");
  labSt.style.cssText = "font-weight:bold;color:#111827;";
  const selStand = document.createElement("select");
  selStand.id = "tournamentStandSel";
  selStand.style.cssText =
    "padding:4px 8px;font-size:12px;min-width:200px;cursor:pointer;" +
    "color:#111827;background-color:#ffffff;border:1px solid #64748b;border-radius:4px;" +
    "color-scheme:light;";
  TOURNAMENT_STAND_KEYS.forEach(function (key) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    opt.style.cssText = "color:#111827;background-color:#ffffff;";
    if (key === TOURNAMENT_UI_STAND) opt.selected = true;
    selStand.appendChild(opt);
  });
  selStand.addEventListener("change", function () {
    TOURNAMENT_UI_STAND = selStand.value;
  });
  stRow.appendChild(labSt);
  stRow.appendChild(selStand);

  const labContour = document.createElement("label");
  labContour.textContent = "Контур:";
  labContour.setAttribute("for", "tournamentContourSel");
  labContour.style.cssText = "font-weight:bold;color:#111827;";
  const selContour = document.createElement("select");
  selContour.id = "tournamentContourSel";
  selContour.style.cssText =
    "padding:4px 8px;font-size:12px;min-width:200px;cursor:pointer;" +
    "color:#111827;background-color:#ffffff;border:1px solid #64748b;border-radius:4px;" +
    "color-scheme:light;";
  function refreshTournamentContourOptions() {
    var prev = TOURNAMENT_UI_CONTOUR;
    selContour.innerHTML = "";
    TOURNAMENT_CONTOUR_KEYS.forEach(function (key) {
      const opt = document.createElement("option");
      const byStand = TOURNAMENT_BASE[TOURNAMENT_UI_STAND] || TOURNAMENT_BASE[DEFAULT_TOURNAMENT_STAND];
      opt.value = key;
      opt.textContent = key;
      opt.style.cssText = "color:#111827;background-color:#ffffff;";
      if (key === prev) opt.selected = true;
      selContour.appendChild(opt);
    });
  }
  refreshTournamentContourOptions();
  selStand.addEventListener("change", function () {
    refreshTournamentContourOptions();
  });
  selContour.addEventListener("change", function () {
    TOURNAMENT_UI_CONTOUR = selContour.value;
  });
  stRow.appendChild(labContour);
  stRow.appendChild(selContour);

  const envInfo = document.createElement("div");
  envInfo.style.cssText =
    "margin-left:auto;font-size:11px;color:#334155;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;";
  function refreshTournamentEnvInfo() {
    try {
      const env = getTournamentEnv();
      envInfo.textContent = "POST " + new URL(env.baseUrl).origin;
    } catch (e) {
      envInfo.textContent = "";
    }
  }
  selStand.addEventListener("change", refreshTournamentEnvInfo);
  selContour.addEventListener("change", refreshTournamentEnvInfo);
  refreshTournamentEnvInfo();
  stRow.appendChild(envInfo);

  /** Справа: префикс имени файла и пауза между запросами. */
  const stRowRight = document.createElement("div");
  stRowRight.style.cssText =
    "display:flex;align-items:center;flex-wrap:wrap;gap:10px 14px;margin-left:auto;justify-content:flex-end;";

  const labPrefix = document.createElement("label");
  labPrefix.setAttribute("for", "tournamentExportFnamePrefix");
  labPrefix.style.cssText =
    "display:inline-flex;align-items:center;gap:6px;color:#111827;white-space:nowrap;font-size:12px;";
  labPrefix.appendChild(document.createTextNode("Префикс имени файла (до даты):"));
  const inpFnamePrefix = document.createElement("input");
  inpFnamePrefix.id = "tournamentExportFnamePrefix";
  inpFnamePrefix.type = "text";
  inpFnamePrefix.value = "";
  inpFnamePrefix.placeholder = DEFAULT_EXPORT_FILENAME_PREFIX_PLACEHOLDER;
  inpFnamePrefix.title =
    "Часть имени до таймштампа, например leadersForAdmin_PROM_SIGMA_. Пусто — автоматически leadersForAdmin_{стенд}_{контур}_";
  inpFnamePrefix.style.cssText =
    "width:min(240px,36vw);min-width:120px;padding:4px 8px;font-size:12px;box-sizing:border-box;" +
    "color:#111827;background:#fff;border:1px solid #64748b;border-radius:4px;color-scheme:light;";
  labPrefix.appendChild(inpFnamePrefix);
  stRowRight.appendChild(labPrefix);

  const labGap = document.createElement("label");
  labGap.setAttribute("for", "tournamentRequestGapMs");
  labGap.style.cssText =
    "display:inline-flex;align-items:center;gap:6px;color:#111827;white-space:nowrap;font-size:12px;";
  labGap.appendChild(document.createTextNode("Пауза, мс:"));
  const inpGapMs = document.createElement("input");
  inpGapMs.id = "tournamentRequestGapMs";
  inpGapMs.type = "number";
  inpGapMs.min = "0";
  inpGapMs.max = "60000";
  inpGapMs.step = "1";
  inpGapMs.value = String(DEFAULT_REQUEST_GAP_MS);
  inpGapMs.title = "Задержка после каждого турнира перед следующим GET (0–60000 мс).";
  inpGapMs.style.cssText =
    "width:72px;padding:4px 6px;font-size:12px;box-sizing:border-box;" +
    "color:#111827;background:#fff;border:1px solid #64748b;border-radius:4px;color-scheme:light;";
  labGap.appendChild(inpGapMs);
  stRowRight.appendChild(labGap);

  stRow.appendChild(stRowRight);
  root.appendChild(stRow);

  /** Прокручиваемая средняя часть панели (поля, кнопки, CSV); min-height:0 — чтобы flex не раздувал родителя. */
  const panelScroll = document.createElement("div");
  panelScroll.style.cssText =
    "flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;-webkit-overflow-scrolling:touch;";
  root.appendChild(panelScroll);

  /** Читает паузу из поля панели; при ошибке — DEFAULT_REQUEST_GAP_MS, верхняя граница 60000. */
  function readRequestGapMs() {
    const n = parseInt(String(inpGapMs.value || "").trim(), 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_REQUEST_GAP_MS;
    if (n > 60000) return 60000;
    return n;
  }

  /**
   * Префикс имени выгрузки до таймштампа (с завершающим «_», если нужно).
   * @param {string} standKey
   * @param {string} contourKey
   * @returns {string}
   */
  function buildExportFilenamePrefix(standKey, contourKey) {
    var custom = sanitizeExportFilenamePrefix(inpFnamePrefix.value);
    if (custom) return custom.endsWith("_") ? custom : custom + "_";
    return LEADERS_SERVICE + "_" + standKey + "_" + contourKey + "_";
  }

  /** Верхняя граница строк в ленте (старые удаляются сверху). */
  const LOG_MAX_LINES = 1200;

  const logWrap = document.createElement("div");
  // Компактная высота лога — больше места под кнопки CSV; прокрутка только внутри ленты.
  logWrap.style.cssText =
    "margin-top:8px;flex-shrink:0;display:flex;flex-direction:column;" +
    "height:min(168px,22vh);min-height:88px;max-height:24vh;box-sizing:border-box;";
  const logLab = document.createElement("div");
  logLab.style.cssText = "font-weight:600;font-size:11px;color:#475569;margin-bottom:4px;flex-shrink:0;";
  logLab.textContent = "Журнал работы (лента, новые строки снизу):";
  logWrap.appendChild(logLab);

  const logEl = document.createElement("div");
  logEl.setAttribute("role", "log");
  logEl.setAttribute("aria-live", "polite");
  // Явная высота + overflow только здесь — лента не растёт наружу, полоса прокрутки у блока лога.
  logEl.style.cssText =
    "flex:1 1 auto;min-height:0;width:100%;box-sizing:border-box;" +
    "font-size:11px;color:rgb(15,23,42);background:#f8fafc;" +
    "overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;" +
    "border:1px solid #cbd5e1;border-radius:8px;padding:8px;";
  logWrap.appendChild(logEl);

  /** Метка времени для строки ленты (чч:мм:сс.ммм). */
  function formatLogTime() {
    const d = new Date();
    const p = function (n) {
      return n.toString().padStart(2, "0");
    };
    return (
      p(d.getHours()) +
      ":" +
      p(d.getMinutes()) +
      ":" +
      p(d.getSeconds()) +
      "." +
      d.getMilliseconds().toString().padStart(3, "0")
    );
  }

  /**
   * Добавляет строку в ленту лога (не затирает предыдущие сообщения).
   * @param {string} msg
   */
  function log(msg) {
    const line = document.createElement("div");
    line.style.cssText =
      "margin:0 0 3px 0;line-height:1.35;word-break:break-word;" +
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;color:#0f172a;";
    line.textContent = formatLogTime() + "  " + msg;
    logEl.appendChild(line);
    while (logEl.childElementCount > LOG_MAX_LINES) {
      logEl.removeChild(logEl.firstElementChild);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  log("Панель открыта. Сообщения выгрузки добавляются в ленту ниже.");

  const labTa = document.createElement("div");
  labTa.style.cssText = "font-weight:600;font-size:11px;color:#475569;margin:10px 0 4px;";
  labTa.textContent = "Общее поле — простые коды (кнопка «По тексту» или вставка после выбора .txt)";
  panelScroll.appendChild(labTa);

  const ta = document.createElement("textarea");
  // Компактная высота: шесть строк по умолчаню — с небольшой прокруткой при необходимости.
  ta.rows = 5;
  ta.style.cssText =
    "width:100%;box-sizing:border-box;font-size:11px;padding:10px;" +
    "color:#111827;background-color:#ffffff;border:1px solid #94a3b8;border-radius:8px;resize:vertical;color-scheme:light;";
  ta.placeholder =
    "Коды турнира: по строке или через пробел (латиница, цифры, _ и -). Поле можно очистить и вставить свой список.";
  ta.value = DEFAULT_TOURNAMENT_CODES_TEXTAREA.join("\n");
  panelScroll.appendChild(ta);

  /** Защита от повторного запуска, пока идёт цикл fetch. */
  var exportBusy = false;

  /**
   * Общий цикл выгрузки по уже собранному списку кодов турнира.
   * @param {string[]} ids
   * @param {string} sourceTag — подпись для лога (источник кодов)
   */
  async function runExport(ids, sourceTag) {
    if (exportBusy) {
      log("Выгрузка уже выполняется, дождитесь окончания.");
      return;
    }
    if (!ids || ids.length === 0) {
      log("Нет кодов турнира (" + (sourceTag || "") + ").");
      return;
    }
    exportBusy = true;
    try {
      var env = getTournamentEnv();
      var standKey = env.stand;
      var contourKey = env.contour;
      const baseUrl = env.baseUrl;

      const gapMs = readRequestGapMs();
      const prefixForFile = buildExportFilenamePrefix(standKey, contourKey);
      console.log(
        "[Турниры leadersForAdmin] Выгрузка запущена. Кодов: " +
          ids.length +
          " | стенд/контур: " +
          standKey +
          "/" +
          contourKey +
          ". Подробности — в «Журнал работы»."
      );
      log(
        "Старт выгрузки | источник: " +
          (sourceTag || "") +
          " | кодов в очереди: " +
          ids.length +
          " | стенд/контур: " +
          standKey +
          "/" +
          contourKey +
          " | пауза: " +
          gapMs +
          " мс | префикс файла: " +
          prefixForFile.replace(/_$/, "") +
          "_<дата>.json"
      );
      const results = {};
      let savedCount = 0;
      let skipped = 0;
      let errors = 0;
      /** Только ответы без тела при HTTP OK — в файл не пишутся. */
      const skippedNotSaved = [];

      for (let i = 0; i < ids.length; i++) {
        const tid = ids[i];
        log("[" + (i + 1) + "/" + ids.length + "] " + tid);
        try {
          const fr = await fetchLeadersForAdmin(baseUrl, tid);
          if (!fr.ok) {
            log("[HTTP " + fr.status + "] «" + tid + "» — в файл пойдёт запись об ошибке.");
          }
          const pack = buildLeadersExportRecordArray(tid, fr);
          if (pack == null) {
            skipped++;
            skippedNotSaved.push({ tid: tid, reason: "пустой ответ" });
            log("Пропуск «" + tid + "»: нет JSON-тела при успешном HTTP — в файл не попадает.");
            continue;
          }
          results[tid] = pack;
          savedCount++;
          const root = pack[0];
          const empInTree = countEmployeeNumberFieldsInTree(root);
          const errPay = getExportErrorPayload(root);
          if (errPay) {
            log(
              "  → в файл «" +
                tid +
                "»: ERROR (tournament.error" +
                (errPay.code ? ", код " + errPay.code : "") +
                "), employeeNumber в дереве: " +
                empInTree +
                "."
            );
          } else if (root && root.success === false && root.body && root.body.tournament) {
            const lc = Array.isArray(root.body.tournament.leaders)
              ? root.body.tournament.leaders.length
              : 0;
            log(
              "  → в файл «" +
                tid +
                "»: «0 участников», leaders=" +
                lc +
                ", employeeNumber в дереве: " +
                empInTree +
                "."
            );
          } else {
            const cnt = countLeadersInResponseData(root);
            log(
              "  → в файл «" +
                tid +
                "»: записей в leaders — " +
                (cnt == null ? "?" : cnt) +
                ", непустых employeeNumber в дереве: " +
                empInTree +
                "."
            );
          }
        } catch (e) {
          log("[исключение] " + tid + (e && e.message ? ": " + e.message : ""));
          errors++;
        }
        if (i < ids.length - 1) await delay(gapMs);
      }

      if (skippedNotSaved.length > 0) {
        log(
          "Пропуски без записи в JSON (нет тела), шт.: " +
            skippedNotSaved.length +
            ": " +
            skippedNotSaved
              .map(function (x) {
                return x.tid;
              })
              .join(", ")
        );
      }

      if (savedCount === 0 || Object.keys(results).length === 0) {
        log(
          "Файл не создан: нечего записать (все ответы без тела при OK или сбой до записи). Пропусков: " +
            skipped +
            ", исключений: " +
            errors +
            "."
        );
        console.log(
          "[Турниры leadersForAdmin] Файл не создан. Пропусков: " + skipped + " | исключений: " + errors
        );
        return;
      }

      const jsonOut = JSON.stringify(results);
      if (jsonOut === "{}" || jsonOut.trim() === "{}") {
        log("Файл не создан: итоговый объект пустой {}.");
        console.log("[Турниры leadersForAdmin] Файл не создан: пустой объект {}.");
        return;
      }

      const fname = prefixForFile + getTimestamp() + ".json";
      let totalEmp = 0;
      const perTournament = [];
      Object.keys(results).forEach(function (k) {
        const pack = results[k];
        const rootData = pack && pack[0];
        const em = countEmployeeNumberFieldsInTree(rootData);
        totalEmp += em;
        var line = "«" + k + "»:";
        const errP = getExportErrorPayload(rootData);
        if (errP) {
          line +=
            " ERROR, код " +
            (errP.code != null ? String(errP.code) : "?") +
            ", employeeNumber=" +
            em;
        } else if (rootData && rootData.success === false && rootData.body && rootData.body.tournament) {
          var t = rootData.body.tournament;
          line +=
            " " +
            (t.contestants != null ? String(t.contestants) : "0 участников") +
            ", leaders=" +
            (Array.isArray(t.leaders) ? t.leaders.length : 0) +
            ", employeeNumber=" +
            em;
        } else {
          const lc = countLeadersInResponseData(rootData);
          line += " leaders=" + (lc == null ? "?" : lc) + ", employeeNumber=" + em;
        }
        perTournament.push(line);
      });
      downloadJson(fname, results);
      log(
        "Готово («" +
          (sourceTag || "") +
          "»). Записей в файле: " +
          savedCount +
          " | Σ employeeNumber по дереву: " +
          totalEmp +
          " | пропусков (без тела): " +
          skipped +
          ", исключений: " +
          errors +
          "."
      );
      log("  Детально по турнирам в файле: " + perTournament.join(" | "));
      log("  Файл: " + fname);
      console.log(
        "[Турниры leadersForAdmin] Готово. Файл: " +
          fname +
          " | записей в файле: " +
          savedCount +
          " | пропусков (без тела): " +
          skipped +
          " | исключений: " +
          errors +
          " | Σ employeeNumber по дереву: " +
          totalEmp
      );
    } finally {
      exportBusy = false;
    }
  }

  const labActions = document.createElement("div");
  labActions.style.cssText = "font-weight:700;margin:12px 0 8px;color:#0f172a;font-size:12px;";
  labActions.textContent = "Запуск: одна кнопка — сразу выгрузка (для .txt и CSV сначала откроется выбор файла)";
  panelScroll.appendChild(labActions);

  const actionGrid = document.createElement("div");
  actionGrid.style.cssText =
    "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px;";
  if (typeof window.matchMedia === "function" && window.matchMedia("(max-width:560px)").matches) {
    actionGrid.style.gridTemplateColumns = "1fr";
  }

  const btnBase =
    "padding:10px 12px;font-size:11px;cursor:pointer;border:none;border-radius:8px;font-weight:600;" +
    "color:#fff;text-align:center;line-height:1.35;box-sizing:border-box;width:100%;";

  function addGridButton(label, bg, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = btnBase + "background:" + bg + ";";
    b.addEventListener("click", onClick);
    actionGrid.appendChild(b);
    return b;
  }

  // Скрытый input: выбор .txt → чтение → разбор кодов → runExport
  const fileInputTxtRun = document.createElement("input");
  fileInputTxtRun.type = "file";
  fileInputTxtRun.accept = ".txt,.csv,text/plain,text/csv";
  fileInputTxtRun.setAttribute("aria-label", "Файл со списком кодов турнира");
  fileInputTxtRun.style.cssText =
    "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
  panelScroll.appendChild(fileInputTxtRun);
  fileInputTxtRun.addEventListener("change", function () {
    const f = fileInputTxtRun.files && fileInputTxtRun.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      const text = String(reader.result || "");
      try {
        fileInputTxtRun.value = "";
      } catch (eClr) {}
      const ids = parseTournamentCodesFromText(text);
      if (ids.length === 0) {
        log("В файле не найдено кодов турнира (ожидаются латиница, цифры, _ и -).");
        return;
      }
      void runExport(ids, "файл .txt");
    };
    reader.readAsText(f, "UTF-8");
  });

  addGridButton("По тексту в поле выше", "#7c3aed", function () {
    const ids = parseTournamentCodesFromText(ta.value);
    if (ids.length === 0) {
      log("В общем поле нет кодов турнира.");
      return;
    }
    void runExport(ids, "текст в поле");
  });

  const btnTxtFile = document.createElement("button");
  btnTxtFile.type = "button";
  btnTxtFile.textContent = "Файл .txt — выбрать и сразу выгрузить";
  btnTxtFile.style.cssText = btnBase + "background:#2563eb;";
  btnTxtFile.addEventListener("click", function () {
    fileInputTxtRun.click();
  });
  actionGrid.appendChild(btnTxtFile);

  panelScroll.appendChild(actionGrid);

  /**
   * Чекбоксы фильтра статусов CSV.
   * @param {string[]} labels — подписи статусов (как в CSV)
   * @param {HTMLElement} container
   * @param {string[]} defaultChecked — какие из labels отмечены при открытии панели
   */
  function makeStatusChecks(labels, container, defaultChecked) {
    const map = {};
    const onByDefault = {};
    (defaultChecked || []).forEach(function (s) {
      onByDefault[s] = true;
    });
    const grid = document.createElement("div");
    grid.style.cssText =
      "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 12px;align-items:center;";
    labels.forEach(function (lbl) {
      const row = document.createElement("div");
      row.style.cssText =
        "margin:0;color:#111827;line-height:1.35;display:flex;align-items:center;gap:6px;min-width:0;";
      const c = document.createElement("input");
      c.type = "checkbox";
      c.checked = !!onByDefault[lbl];
      map[lbl] = c;
      row.appendChild(c);
      const sp = document.createElement("span");
      sp.style.cssText = "color:#334155;font-size:11px;word-break:break-word;";
      sp.textContent = lbl;
      row.appendChild(sp);
      grid.appendChild(row);
    });
    container.appendChild(grid);
    return map;
  }

  /** Значение option «свой заголовок» в select колонок CSV. */
  const CSV_COLUMN_SELECT_CUSTOM = "__custom__";

  /**
   * Выпадающий список имён колонки (пресеты как раньше в отдельных полях) + при выборе «Другой…» — поле ввода.
   * @param {HTMLElement} container
   * @param {string} labelText
   * @param {string} selectId
   * @param {string[]} presets
   * @param {string} initialValue
   * @returns {{ getHeader: function(): string }}
   */
  function appendLabeledColumnSelect(container, labelText, selectId, presets, initialValue) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "min-width:0;display:flex;flex-direction:column;gap:6px;";
    const lab = document.createElement("label");
    lab.setAttribute("for", selectId);
    lab.style.cssText =
      "display:flex;flex-direction:column;gap:4px;font-size:10px;color:#334155;font-weight:600;margin:0;";
    const span = document.createElement("span");
    span.textContent = labelText;
    const sel = document.createElement("select");
    sel.id = selectId;
    sel.style.cssText =
      "padding:6px 8px;font-size:11px;border:1px solid #94a3b8;border-radius:6px;color:#111827;" +
      "background:#fff;box-sizing:border-box;width:100%;color-scheme:light;cursor:pointer;";
    const init = initialValue || presets[0] || "";
    presets.forEach(function (p) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      if (p === init) opt.selected = true;
      sel.appendChild(opt);
    });
    const optCustom = document.createElement("option");
    optCustom.value = CSV_COLUMN_SELECT_CUSTOM;
    optCustom.textContent = "Другой заголовок…";
    sel.appendChild(optCustom);

    const customInp = document.createElement("input");
    customInp.type = "text";
    customInp.setAttribute("aria-label", labelText + " — свой текст");
    customInp.autocomplete = "off";
    customInp.placeholder = "Имя колонки как в 1-й строке CSV";
    customInp.style.cssText =
      "display:none;padding:6px 8px;font-size:11px;border:1px solid #64748b;border-radius:6px;color:#111827;" +
      "background:#fff;box-sizing:border-box;width:100%;color-scheme:light;";

    function syncCustomVisibility() {
      const show = sel.value === CSV_COLUMN_SELECT_CUSTOM;
      customInp.style.display = show ? "block" : "none";
      if (!show) customInp.value = "";
    }
    sel.addEventListener("change", syncCustomVisibility);
    syncCustomVisibility();

    lab.appendChild(span);
    lab.appendChild(sel);
    wrap.appendChild(lab);
    wrap.appendChild(customInp);
    container.appendChild(wrap);

    return {
      getHeader: function () {
        if (sel.value === CSV_COLUMN_SELECT_CUSTOM) {
          var t = (customInp.value || "").trim();
          return t || presets[0] || "";
        }
        return (sel.value || "").trim() || presets[0] || "";
      }
    };
  }

  /**
   * Нижняя половина CSV: фильтр статусов только этого блока + кнопка выбора файла.
   * Имена колонок кода и статуса всегда берутся из общего верха (csvCodeCtl / csvStatusCtl);
   * набор чекбоксов allow — только из makeStatusChecks(cfg.labels) этого экземпляра.
   * @param {{ border: string, bg: string, labels: string[], defaultCheckedStatusLabels: string[], fileAria: string, runTag: string, filterBlockTitle: string, filterBlockSubtitle: string, buttonLabel: string }} cfg
   * @param {{ getHeader: function(): string }} csvCodeCtl
   * @param {{ getHeader: function(): string }} csvStatusCtl
   * @param {function(string[], string): void} runExportFn
   */
  function createCsvSideBlock(cfg, csvCodeCtl, csvStatusCtl, runExportFn) {
    const col = document.createElement("div");
    col.style.cssText =
      "min-width:0;padding:12px;border-radius:10px;border:1px solid " +
      cfg.border +
      ";background:" +
      cfg.bg +
      ";box-sizing:border-box;display:flex;flex-direction:column;gap:8px;";

    const h = document.createElement("div");
    h.style.cssText = "font-weight:700;font-size:12px;color:#0f172a;";
    h.textContent = cfg.filterBlockTitle;
    col.appendChild(h);

    const sub = document.createElement("div");
    sub.style.cssText = "font-size:10px;color:#64748b;line-height:1.35;";
    sub.textContent = cfg.filterBlockSubtitle;
    col.appendChild(sub);

    const fileInLocal = document.createElement("input");
    fileInLocal.type = "file";
    fileInLocal.accept = ".txt,.csv,text/plain,text/csv";
    fileInLocal.setAttribute("aria-label", cfg.fileAria);
    fileInLocal.style.cssText =
      "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";

    const fileStat = document.createElement("div");
    fileStat.style.cssText = "font-size:10px;color:#64748b;line-height:1.35;word-break:break-all;";
    fileStat.textContent = "Последний CSV-файл: не выбирали.";

    const filtWrap = document.createElement("div");
    filtWrap.style.cssText = "margin-top:4px;padding-top:10px;border-top:1px solid rgba(15,23,42,.08);";
    const filtLab = document.createElement("div");
    filtLab.style.cssText = "font-weight:600;font-size:11px;color:#334155;margin-bottom:6px;";
    filtLab.textContent =
      "Фильтр статусов только для этой кнопки («" + cfg.runTag + "»). Имена колонок — из блока выше.";
    filtWrap.appendChild(filtLab);
    const checks = makeStatusChecks(cfg.labels, filtWrap, cfg.defaultCheckedStatusLabels);

    function buildAllowMapFromThisBlockOnly() {
      const allow = {};
      Object.keys(checks).forEach(function (k) {
        allow[k] = checks[k].checked;
      });
      return allow;
    }

    /** Колонки из общей панели; фильтр статусов — только чекбоксы этого нижнего блока. */
    function codesFromCsvText(csvText) {
      const allow = buildAllowMapFromThisBlockOnly();
      var codeH = csvCodeCtl.getHeader() || CSV_CODE_COLUMN_PRESETS[0];
      var statH = csvStatusCtl.getHeader() || CSV_STATUS_COLUMN_PRESETS[0];
      return codesFromCsvByColumns(csvText, allow, codeH, statH, function (w) {
        log(w);
      });
    }

    fileInLocal.addEventListener("change", function () {
      const f = fileInLocal.files && fileInLocal.files[0];
      if (!f) return;
      const lastCsvName = f.name || "";
      const reader = new FileReader();
      reader.onload = function () {
        const lastCsv = String(reader.result || "");
        fileStat.textContent = "Последний файл: " + lastCsvName + " (" + lastCsv.length + " симв.)";
        log("CSV «" + cfg.runTag + "»: " + lastCsvName + ", символов: " + lastCsv.length);
        try {
          fileInLocal.value = "";
        } catch (eClr) {}
        const ids = codesFromCsvText(lastCsv);
        if (ids.length === 0) {
          log("Нет кодов (" + cfg.runTag + " файл). Проверьте имена колонок вверху и фильтр статусов в этом блоке.");
          return;
        }
        void runExportFn(ids, cfg.runTag + " файл");
      };
      reader.readAsText(f, "UTF-8");
    });

    const btnCsvFile = document.createElement("button");
    btnCsvFile.type = "button";
    btnCsvFile.textContent = cfg.buttonLabel;
    btnCsvFile.style.cssText =
      "padding:8px 10px;font-size:11px;cursor:pointer;background:#0f172a;color:#fff;border:none;border-radius:8px;font-weight:600;width:100%;box-sizing:border-box;line-height:1.35;";
    btnCsvFile.addEventListener("click", function () {
      fileInLocal.click();
    });

    col.appendChild(fileInLocal);
    col.appendChild(filtWrap);
    col.appendChild(btnCsvFile);
    col.appendChild(fileStat);

    return col;
  }

  const csvOuter = document.createElement("div");
  csvOuter.style.cssText =
    "margin-top:14px;padding:12px;border-radius:10px;border:1px solid #cbd5e1;" +
    "background:linear-gradient(180deg,#f8fafc 0%,#eef2ff 55%,#eff6ff 100%);box-sizing:border-box;";

  const csvMainTitle = document.createElement("div");
  csvMainTitle.style.cssText = "font-weight:700;font-size:14px;color:#0f172a;margin-bottom:4px;";
  csvMainTitle.textContent = "Загрузка из TOURNAMENT_SHEDULE / LIST";
  csvOuter.appendChild(csvMainTitle);

  const csvMainSub = document.createElement("div");
  csvMainSub.style.cssText = "font-size:10px;color:#64748b;line-height:1.4;margin-bottom:10px;";
  csvMainSub.textContent =
    "Имена колонок кода и статуса — один раз сверху для обеих кнопок. Ниже у каждой кнопки свой фильтр статусов (SHEDULE и LIST); при выгрузке берутся чекбоксы только из того блока, чью кнопку нажали. Выгрузка — после выбора файла.";
  csvOuter.appendChild(csvMainSub);

  const csvColsRow = document.createElement("div");
  csvColsRow.style.cssText =
    "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;margin-bottom:12px;align-items:end;";
  if (typeof window.matchMedia === "function" && window.matchMedia("(max-width:560px)").matches) {
    csvColsRow.style.gridTemplateColumns = "1fr";
  }

  const csvCodeCtl = appendLabeledColumnSelect(
    csvColsRow,
    "Колонка с кодом турнира (1-я строка CSV)",
    "tournamentCsvColCode",
    CSV_CODE_COLUMN_PRESETS,
    CSV_CODE_COLUMN_PRESETS[0]
  );
  const csvStatusCtl = appendLabeledColumnSelect(
    csvColsRow,
    "Колонка со статусом для фильтра",
    "tournamentCsvColStatus",
    CSV_STATUS_COLUMN_PRESETS,
    CSV_STATUS_COLUMN_PRESETS[0]
  );
  csvOuter.appendChild(csvColsRow);

  const twoCol = document.createElement("div");
  twoCol.style.cssText =
    "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:stretch;";
  if (typeof window.matchMedia === "function" && window.matchMedia("(max-width:700px)").matches) {
    twoCol.style.gridTemplateColumns = "1fr";
  }

  twoCol.appendChild(
    createCsvSideBlock(
      {
        border: "#94a3b8",
        bg: "linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%)",
        labels: CSV1_STATUS_LABELS,
        defaultCheckedStatusLabels: CSV1_DEFAULT_CHECKED_STATUSES,
        fileAria: "CSV файл TOURNAMENT-SHEDULE",
        runTag: "TOURNAMENT-SHEDULE",
        filterBlockTitle: "Статусы как в TOURNAMENT-SHEDULE",
        filterBlockSubtitle:
          "Подписи чекбоксов должны совпадать со значениями в колонке статуса вашего CSV (часто АКТИВНЫЙ, ЗАВЕРШЕН…).",
        buttonLabel: "Выгрузить из TOURNAMENT-SHEDULE — выбрать CSV-файл"
      },
      csvCodeCtl,
      csvStatusCtl,
      runExport
    )
  );
  twoCol.appendChild(
    createCsvSideBlock(
      {
        border: "#3b82f6",
        bg: "linear-gradient(180deg,#eff6ff 0%,#dbeafe 100%)",
        labels: CSV2_STATUS_LABELS,
        defaultCheckedStatusLabels: CSV2_DEFAULT_CHECKED_STATUSES,
        fileAria: "CSV файл TOURNAMENT-LIST",
        runTag: "TOURNAMENT-LIST",
        filterBlockTitle: "Статусы как в TOURNAMENT-LIST",
        filterBlockSubtitle:
          "Подписи — как в колонке «Бизнес-статус турнира» (Активный, Завершен…).",
        buttonLabel: "Выгрузить из TOURNAMENT-LIST — выбрать CSV-файл"
      },
      csvCodeCtl,
      csvStatusCtl,
      runExport
    )
  );
  csvOuter.appendChild(twoCol);
  panelScroll.appendChild(csvOuter);

  root.appendChild(logWrap);

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.textContent = "Закрыть панель";
  // rgb() вместо #hex: при копировании в некоторых средах «#» мог пропасть и ломал color.
  btnClose.style.cssText =
    "margin-top:8px;width:100%;padding:8px;cursor:pointer;background:#f1f5f9;color:rgb(15,23,42);border:1px solid #94a3b8;border-radius:4px;font-size:12px;flex-shrink:0;";
  btnClose.addEventListener("click", function () {
    root.remove();
  });
  root.appendChild(btnClose);

  document.body.appendChild(root);
  console.log(
    "[Турниры leadersForAdmin] Панель открыта. Подробный журнал — в окне «Журнал работы» на панели."
  );
}

startTournamentPanel();
})();
