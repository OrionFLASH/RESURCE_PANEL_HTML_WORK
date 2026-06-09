// =============================================================================
// AddressBook_export_OE.js — выгрузки из адресной книги + Search → empInfoFull → OE (departments)
// =============================================================================
// Расширение AddressBook_export.js (v1 без изменений): GET /api/home/departments/{id} по deptTree.
// Имена файлов OE-сценария: PROM_ALPHA_AB_*_YYYYMMDD_HHMM.*
// =============================================================================
// Вся логика в IIFE: повторная вставка скрипта в консоль не падает на «уже объявлено» (const/let на верхнем уровне).
(function () {
  "use strict";

const ADDRESSBOOK_STAND_KEY = "ALPHA";

// Отдельный URL стенда адресной книги.
const ADDRESSBOOK_ORIGINS = {
  ALPHA: "https://addressbook.omega.sbrf.ru"
};

const ADDRESSBOOK_API_HOME = "/api/home";

// Табельные для подсказки в поле (empInfoFull / search по числу); тот же разбор, что из файла .txt.
const EMP_IDS = ["00673892"];

/** Значение по умолчанию для пауз на панели (мс). */
const REQUEST_PAUSE_MS = 50;

/** Верхняя граница паузы с панели (мс), защита от опечаток. */
const REQUEST_PAUSE_MAX_MS = 300000;

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Нормализация табельного: цифры, при необходимости ведущие нули до 8 знаков.
 * @param {string} s
 * @returns {string|null}
 */
function normalizeEmpId(s) {
  if (!s || typeof s !== "string") return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 0) return null;
  let t = digits;
  if (t.length < 8) t = t.padStart(8, "0");
  if (t.length > 20) t = t.slice(-20);
  return t;
}

/**
 * Разбор списка ТН из текста или содержимого .txt: группы цифр, любые нецифры — разделители (как в Profile_GP / _from_file).
 * @param {string} text
 * @returns {string[]}
 */
function parseEmpIdsFromText(text) {
  if (!text || typeof text !== "string") return [];
  const seq = text.match(/\d+/g) || [];
  const out = [];
  const seen = {};
  for (let i = 0; i < seq.length; i++) {
    const n = normalizeEmpId(seq[i]);
    if (n && !seen[n]) {
      seen[n] = true;
      out.push(n);
    }
  }
  return out;
}

/**
 * Разбор поисковых значений без нормализации:
 * разделители только перенос строки, ";" и ",".
 * Пробел внутри значения (например ФИО) сохраняется.
 * @param {string} text
 * @returns {string[]}
 */
function parseSearchValuesRaw(text) {
  if (!text || typeof text !== "string") return [];
  var parts = text
    .split(/[\r\n;,]+/)
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
  var out = [];
  var seen = {};
  for (var i = 0; i < parts.length; i++) {
    var v = parts[i];
    if (seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out;
}

/**
 * Число для тела POST search по табельному (как в UI адресной книги): ведущие нули снимаются.
 * @param {string} normalizedEightDigits
 * @returns {number}
 */
function tabNumToSearchNumber(normalizedEightDigits) {
  return Number(String(normalizedEightDigits).replace(/^0+/, "") || "0");
}

/**
 * Собирает все employeeId (UUID) из ответа POST employees/search (массив hits).
 * Порядок как в ответе; повторяющиеся UUID пропускаются.
 * @param {*} data — распарсенный JSON
 * @returns {string[]}
 */
function pickEmployeeIdsFromSearchData(data) {
  if (!data || typeof data !== "object") return [];
  var hits = data.hits;
  if (!Array.isArray(hits) || hits.length === 0) return [];
  var seen = {};
  var out = [];
  for (var hi = 0; hi < hits.length; hi++) {
    var h = hits[hi];
    if (!h || typeof h.employeeId !== "string") continue;
    var id = h.employeeId.trim();
    if (id.length === 0 || seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}

/**
 * Все employeeId в порядке следования в hits (включая повторы в разных строках hits).
 * Пагинация: страница за страницей, внутри страницы — порядок элементов массива hits.
 * @param {Array<{data: *}>} pages
 * @returns {string[]}
 */
function collectEmployeeIdsFromSearchPagesInHitOrder(pages) {
  if (!Array.isArray(pages)) return [];
  var out = [];
  for (var pi = 0; pi < pages.length; pi++) {
    var pg = pages[pi];
    var data = pg && pg.data;
    if (!data || typeof data !== "object") continue;
    var hits = Array.isArray(data.hits)
      ? data.hits
      : data.body && Array.isArray(data.body.hits)
        ? data.body.hits
        : [];
    for (var hi = 0; hi < hits.length; hi++) {
      var h = hits[hi];
      if (!h || typeof h.employeeId !== "string") continue;
      var id = h.employeeId.trim();
      if (id.length === 0) continue;
      out.push(id);
    }
  }
  return out;
}

/**
 * Уникальные UUID в порядке первого появления в плоском списке.
 * @param {string[]} flatOrdered
 * @returns {string[]}
 */
function uniqueEmployeeIdsFirstOccurrence(flatOrdered) {
  var seen = {};
  var out = [];
  if (!Array.isArray(flatOrdered)) return out;
  for (var i = 0; i < flatOrdered.length; i++) {
    var id = flatOrdered[i];
    if (!id || typeof id !== "string") continue;
    id = id.trim();
    if (id.length === 0 || seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}

/** Разделитель колонок в CSV OE-сценария. */
const AB_OE_CSV_DELIMITER = ";";

/** Значение для полей, не найденных в Search. */
const AB_OE_NOT_FOUND = "не найдено";

/**
 * Экранирование поля для CSV (разделитель «;»).
 * @param {string|number|null|undefined} s
 * @returns {string}
 */
function escapeCsvField(s) {
  var t = String(s == null ? "" : s);
  if (/[\r\n";]/.test(t)) {
    return '"' + t.replace(/"/g, '""') + '"';
  }
  return t;
}

/**
 * TN_8: tabNum до 8 знаков с ведущими нулями; если >8 — без изменений.
 * @param {string|number|null|undefined} tabNum
 * @returns {string}
 */
function formatTabNumTn8(tabNum) {
  if (tabNum == null || tabNum === "") return "";
  var digits = String(tabNum).replace(/\D/g, "");
  if (!digits) return String(tabNum);
  if (digits.length <= 8) return digits.padStart(8, "0");
  return digits;
}

/**
 * TN_8 из искомого значения (для строк «не найдено»).
 * @param {string} searchedInput
 * @returns {string}
 */
function tn8FromSearchedInput(searchedInput) {
  var digits = String(searchedInput || "").replace(/\D/g, "");
  if (!digits) return AB_OE_NOT_FOUND;
  if (digits.length <= 8) return digits.padStart(8, "0");
  return digits;
}

/**
 * Заглушка hit Search при отсутствии результатов.
 * @param {string} searchedInput
 * @returns {object}
 */
function buildNotFoundSearchHitFormatted(searchedInput) {
  return {
    employeeId: AB_OE_NOT_FOUND,
    fullName: AB_OE_NOT_FOUND,
    departmentName: AB_OE_NOT_FOUND,
    positionName: AB_OE_NOT_FOUND,
    phoneNumber: AB_OE_NOT_FOUND,
    contactPhone: { id: AB_OE_NOT_FOUND, phoneNumber: AB_OE_NOT_FOUND },
    email: AB_OE_NOT_FOUND,
    photo: AB_OE_NOT_FOUND,
    isAbsent: AB_OE_NOT_FOUND,
    absenceInfo: { typeName: AB_OE_NOT_FOUND },
    birthDate: AB_OE_NOT_FOUND,
    roleName: AB_OE_NOT_FOUND,
    searchedInput: searchedInput
  };
}

/**
 * Заглушка empInfoFull при отсутствии карточки.
 * @returns {object}
 */
function buildNotFoundEmpInfoFormatted() {
  return {
    birthday: AB_OE_NOT_FOUND,
    deptTree: [],
    dir: AB_OE_NOT_FOUND,
    emails: [],
    empName: AB_OE_NOT_FOUND,
    empFamilyName: AB_OE_NOT_FOUND,
    empPatronymic: AB_OE_NOT_FOUND,
    oldFamilyName: AB_OE_NOT_FOUND,
    phones: [],
    jobTitle: AB_OE_NOT_FOUND,
    logins: [],
    tabNum: AB_OE_NOT_FOUND,
    empTBname: AB_OE_NOT_FOUND,
    absences: {
      isLong: AB_OE_NOT_FOUND,
      info: {
        isAbsent: AB_OE_NOT_FOUND,
        isLong: AB_OE_NOT_FOUND,
        startDate: AB_OE_NOT_FOUND,
        endDate: AB_OE_NOT_FOUND,
        typeId: AB_OE_NOT_FOUND,
        typeName: AB_OE_NOT_FOUND,
        daysRemains: AB_OE_NOT_FOUND
      }
    }
  };
}

/**
 * Ключ стенда ALPHA и origin для URL запросов без завершающего слэша.
 * Приоритет — origin текущей вкладки (куки сессии совпадают с документом); иначе ADDRESSBOOK_ORIGINS.ALPHA.
 * @returns {{ standKey: string, origin: string }}
 */
function getAddressBookStandAndOrigin() {
  var tabOrigin = "";
  try {
    tabOrigin = String(window.location.origin || "").replace(/\/$/, "");
  } catch (e) {
    tabOrigin = "";
  }
  if (tabOrigin && tabOrigin !== "null") {
    return { standKey: ADDRESSBOOK_STAND_KEY, origin: tabOrigin };
  }
  var fallback = (ADDRESSBOOK_ORIGINS.ALPHA || "").replace(/\/$/, "");
  return { standKey: ADDRESSBOOK_STAND_KEY, origin: fallback };
}

function getAddressBookEnvKey() {
  var o = getAddressBookStandAndOrigin();
  return o.standKey;
}

/**
 * GET …/api/home/empInfoFull?empId=  (empId — UUID employeeId с бэкенда, не 8-значный ТН)
 * @param {string} empId
 */
async function fetchEmpInfoFull(empId) {
  var o = getAddressBookStandAndOrigin();
  const url =
    o.origin +
    ADDRESSBOOK_API_HOME +
    "/empInfoFull?empId=" +
    encodeURIComponent(empId);
  const res = await fetch(url, {
    method: "GET",
    mode: "cors",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json, text/plain, */*" }
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return {
    empId: empId,
    stand: o.standKey,
    ok: res.ok,
    status: res.status,
    data: data
  };
}

/**
 * POST …/api/home/employees/search
 * @param {string|number} searchText — число ТН или строка ФИО
 * @param {boolean} asNumber — true: в теле число без кавычек в JSON
 * @param {string|null} pageToken — токен страницы (null для первой страницы)
 */
async function fetchEmployeesSearch(searchText, asNumber, pageToken) {
  var o = getAddressBookStandAndOrigin();
  var safeToken = pageToken == null ? null : String(pageToken);
  const body = asNumber
    ? { searchText: Number(searchText), pageToken: safeToken }
    : { searchText: String(searchText), pageToken: safeToken };
  const res = await fetch(o.origin + ADDRESSBOOK_API_HOME + "/employees/search", {
    method: "POST",
    mode: "cors",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return {
    stand: o.standKey,
    ok: res.ok,
    status: res.status,
    body: body,
    data: data
  };
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () {
    URL.revokeObjectURL(a.href);
  }, 0);
}

/**
 * Сохранение текстового файла (CSV и т.п.).
 * @param {string} filename
 * @param {string} text
 * @param {string} [mimeType]
 */
function downloadText(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType || "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () {
    URL.revokeObjectURL(a.href);
  }, 0);
}

/** Префикс имён файлов OE-сценария (PROM_ALPHA по согласованию). */
const AB_OE_FILE_ENV_PREFIX = "PROM_ALPHA_";

/**
 * @param {number} n
 * @returns {string}
 */
function pad2Export(n) {
  return n < 10 ? "0" + n : String(n);
}

/**
 * Колонки с суффиксами (01)(02): сначала все поля (01), затем (02)…
 * @param {string[]} allKeys
 * @param {string} prefix
 * @param {string[]} fields
 * @returns {string[]}
 */
function orderIndexedColumns(allKeys, prefix, fields) {
  var prefixNeedle = prefix + " - ";
  var matched = allKeys.filter(function (k) {
    return k.indexOf(prefixNeedle) === 0;
  });
  if (matched.length === 0) return [];
  var maxIdx = 0;
  for (var mi = 0; mi < matched.length; mi++) {
    var m = matched[mi].match(/\((\d+)\)\s*$/);
    if (m) maxIdx = Math.max(maxIdx, parseInt(m[1], 10));
  }
  var ordered = [];
  for (var idx = 1; idx <= maxIdx; idx++) {
    var idxStr = pad2Export(idx);
    for (var fi = 0; fi < fields.length; fi++) {
      var col = prefixNeedle + fields[fi] + " (" + idxStr + ")";
      if (matched.indexOf(col) >= 0) ordered.push(col);
    }
  }
  return ordered;
}

/**
 * Локальный timestamp для имён файлов: YYYYMMDD_HHMM.
 * @param {Date} [date]
 * @returns {string}
 */
function formatExportTimestampLocal(date) {
  var d = date || new Date();
  return (
    d.getFullYear() +
    pad2Export(d.getMonth() + 1) +
    pad2Export(d.getDate()) +
    "_" +
    pad2Export(d.getHours()) +
    pad2Export(d.getMinutes())
  );
}

/**
 * @param {string} block — AB_Search, AB_empInfoFull, …
 * @param {string} tsStamp
 * @param {string} [ext]
 * @returns {string}
 */
function buildOeExportFileName(block, tsStamp, ext) {
  return AB_OE_FILE_ENV_PREFIX + block + "_" + tsStamp + (ext || ".json");
}

/**
 * GET …/api/home/departments/{deptId}
 * @param {string} deptId
 */
async function fetchDepartmentById(deptId) {
  var o = getAddressBookStandAndOrigin();
  const url =
    o.origin + ADDRESSBOOK_API_HOME + "/departments/" + encodeURIComponent(deptId);
  const res = await fetch(url, {
    method: "GET",
    mode: "cors",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json, text/plain, */*" }
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return {
    deptId: deptId,
    stand: o.standKey,
    ok: res.ok,
    status: res.status,
    data: data
  };
}

/**
 * Узлы deptTree из тела empInfoFull.
 * @param {*} empBody
 * @returns {Array<{id: string, name?: string}>}
 */
function extractDeptTreeNodes(empBody) {
  if (!empBody || typeof empBody !== "object") return [];
  var tree = empBody.deptTree;
  if (!Array.isArray(tree)) return [];
  var out = [];
  for (var i = 0; i < tree.length; i++) {
    var n = tree[i];
    if (!n || typeof n.id !== "string") continue;
    var id = n.id.trim();
    if (!id) continue;
    out.push({ id: id, name: n.name != null ? String(n.name) : "" });
  }
  return out;
}

/**
 * Все hits из страниц Search (порядок сохраняется).
 * @param {Array<{data: *}>} pages
 * @returns {object[]}
 */
function collectSearchHitsFromPages(pages) {
  if (!Array.isArray(pages)) return [];
  var out = [];
  for (var pi = 0; pi < pages.length; pi++) {
    var pg = pages[pi];
    var data = pg && pg.data;
    if (!data || typeof data !== "object") continue;
    var hits = Array.isArray(data.hits)
      ? data.hits
      : data.body && Array.isArray(data.body.hits)
        ? data.body.hits
        : [];
    for (var hi = 0; hi < hits.length; hi++) {
      if (hits[hi] && typeof hits[hi] === "object") out.push(hits[hi]);
    }
  }
  return out;
}

/**
 * @param {*} hit
 * @returns {object}
 */
function pickSearchHitFormatted(hit) {
  if (!hit || typeof hit !== "object") return {};
  var cp = hit.contactPhone;
  var contactPhone =
    cp && typeof cp === "object"
      ? { id: cp.id != null ? cp.id : null, phoneNumber: cp.phoneNumber != null ? cp.phoneNumber : null }
      : null;
  var ai = hit.absenceInfo;
  return {
    employeeId: hit.employeeId != null ? String(hit.employeeId) : "",
    fullName: hit.fullName != null ? hit.fullName : null,
    departmentName: hit.departmentName != null ? hit.departmentName : null,
    positionName: hit.positionName != null ? hit.positionName : null,
    phoneNumber: hit.phoneNumber != null ? hit.phoneNumber : null,
    contactPhone: contactPhone,
    email: hit.email != null ? hit.email : null,
    photo: hit.photo != null ? hit.photo : null,
    isAbsent: hit.isAbsent != null ? hit.isAbsent : null,
    absenceInfo: ai && typeof ai === "object" ? { typeName: ai.typeName != null ? ai.typeName : null } : null,
    birthDate: hit.birthDate != null ? hit.birthDate : null,
    roleName: hit.roleName != null ? hit.roleName : null
  };
}

/**
 * @param {*} body
 * @returns {object}
 */
function pickEmpInfoFormatted(body) {
  if (!body || typeof body !== "object") return {};
  var deptTree = [];
  if (Array.isArray(body.deptTree)) {
    for (var i = 0; i < body.deptTree.length; i++) {
      var n = body.deptTree[i];
      if (!n) continue;
      deptTree.push({
        id: n.id != null ? String(n.id) : "",
        name: n.name != null ? n.name : null
      });
    }
  }
  var emails = [];
  if (Array.isArray(body.emails)) {
    for (var e = 0; e < body.emails.length; e++) {
      var em = body.emails[e];
      if (!em) continue;
      emails.push({ address: em.address != null ? em.address : null, domain: em.domain != null ? em.domain : null });
    }
  }
  var phones = [];
  if (Array.isArray(body.phones)) {
    for (var p = 0; p < body.phones.length; p++) {
      var ph = body.phones[p];
      if (!ph) continue;
      phones.push({ type: ph.type != null ? ph.type : null, phoneNumber: ph.phoneNumber != null ? ph.phoneNumber : null });
    }
  }
  var logins = [];
  if (Array.isArray(body.logins)) {
    for (var l = 0; l < body.logins.length; l++) {
      var lg = body.logins[l];
      if (!lg) continue;
      logins.push({
        domain: lg.domain != null ? lg.domain : null,
        accountName: lg.accountName != null ? lg.accountName : null
      });
    }
  }
  var abs = body.absences;
  var absences = null;
  if (abs && typeof abs === "object") {
    absences = { isLong: abs.isLong != null ? abs.isLong : null, info: null };
    if (abs.info && typeof abs.info === "object") {
      absences.info = {
        isAbsent: abs.info.isAbsent != null ? abs.info.isAbsent : null,
        isLong: abs.info.isLong != null ? abs.info.isLong : null,
        startDate: abs.info.startDate != null ? abs.info.startDate : null,
        endDate: abs.info.endDate != null ? abs.info.endDate : null,
        typeId: abs.info.typeId != null ? abs.info.typeId : null,
        typeName: abs.info.typeName != null ? abs.info.typeName : null,
        daysRemains: abs.info.daysRemains != null ? abs.info.daysRemains : null
      };
    }
  }
  return {
    birthday: body.birthday != null ? body.birthday : null,
    deptTree: deptTree,
    dir: body.dir != null ? body.dir : null,
    emails: emails,
    empName: body.empName != null ? body.empName : null,
    empFamilyName: body.empFamilyName != null ? body.empFamilyName : null,
    empPatronymic: body.empPatronymic != null ? body.empPatronymic : null,
    oldFamilyName: body.oldFamilyName != null ? body.oldFamilyName : null,
    phones: phones,
    jobTitle: body.jobTitle != null ? body.jobTitle : null,
    logins: logins,
    tabNum: body.tabNum != null ? body.tabNum : null,
    empTBname: body.empTBname != null ? body.empTBname : null,
    absences: absences
  };
}

/**
 * orgUnit из ответа departments или null.
 * @param {*} deptFetch
 * @returns {string|null}
 */
function pickDeptOrgUnit(deptFetch) {
  if (!deptFetch || !deptFetch.ok || !deptFetch.data || typeof deptFetch.data !== "object") return null;
  return deptFetch.data.orgUnit != null ? String(deptFetch.data.orgUnit) : null;
}

/**
 * Разворачивает массивы в плоские колонки CSV с суффиксами (01), (02).
 * @param {string} prefix
 * @param {object[]} items
 * @param {string[]} fields
 * @returns {Record<string, string>}
 */
function flattenArrayColumnsForCsv(prefix, items, fields) {
  var out = {};
  if (!Array.isArray(items)) items = [];
  for (var i = 0; i < items.length; i++) {
    var idx = pad2Export(i + 1);
    var row = items[i] || {};
    for (var fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      var key = prefix + " - " + f + " (" + idx + ")";
      var val = row[f];
      out[key] = val == null ? "" : String(val);
    }
  }
  return out;
}

/**
 * @param {Record<string, string>} row
 * @param {string[]} orderedKeys
 * @returns {string}
 */
function csvRowFromOrderedKeys(row, orderedKeys) {
  var cells = [];
  for (var i = 0; i < orderedKeys.length; i++) {
    cells.push(escapeCsvField(row[orderedKeys[i]] != null ? row[orderedKeys[i]] : ""));
  }
  return cells.join(AB_OE_CSV_DELIMITER);
}

/**
 * Панель выгрузок: визуально в одном стиле с Profile_GP_LOAD_file (отступы, скругления, стенд в «карточке», кнопки-градиенты).
 * Повторная вставка скрипта удаляет предыдущий корень `addressBookExportOePanelRoot`.
 */
function startAddressBookPanel() {
  var prev = document.getElementById("addressBookExportOePanelRoot");
  if (prev) prev.remove();

  /** Пока идёт цепочка запросов — не запускать второй сценарий с панели. */
  var requestBusy = false;

  const box = document.createElement("div");
  box.id = "addressBookExportOePanelRoot";
  // Стиль как у панели профилей: читаемость на тёмных страницах (color + color-scheme).
  box.style.cssText =
    "position:fixed;top:12px;right:12px;width:min(700px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;" +
    "z-index:999999;box-sizing:border-box;padding:20px 20px 18px;" +
    "background:#ffffff;border:1px solid #cbd5e1;border-radius:12px;" +
    "box-shadow:0 10px 40px rgba(15,23,42,.12);font-family:system-ui,-apple-system,sans-serif;" +
    "font-size:12px;color:#0f172a;color-scheme:light;";

  const head = document.createElement("div");
  head.style.cssText =
    "font-size:17px;font-weight:700;color:#0f172a;margin:0 0 4px 0;letter-spacing:-0.02em;";
  head.textContent = "Адресная книга — выгрузки (OE)";
  box.appendChild(head);

  const sub = document.createElement("div");
  sub.style.cssText = "font-size:12px;color:#64748b;margin:0 0 14px 0;line-height:1.45;";
  sub.textContent =
    "Стенд ALPHA + сценарий Search → empInfoFull → OE (departments). Запросы на origin вкладки. " +
    "Файлы OE: PROM_ALPHA_AB_*_YYYYMMDD_HHMM.";
  box.appendChild(sub);

  const rowStand = document.createElement("div");
  rowStand.style.cssText =
    "display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap;padding:12px 14px;" +
    "background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;";
  const labSt = document.createElement("div");
  labSt.textContent = "Стенд";
  labSt.style.cssText = "font-weight:600;font-size:13px;color:#334155;min-width:52px;flex-shrink:0;padding-top:2px;";
  const standInfo = document.createElement("div");
  standInfo.style.cssText =
    "flex:1;min-width:200px;font-size:12px;color:#0f172a;line-height:1.45;word-break:break-all;";
  var oPanel = "";
  try {
    oPanel = String(window.location.origin || "").replace(/\/$/, "");
  } catch (e) {
    oPanel = "";
  }
  if (oPanel && oPanel !== "null") {
    standInfo.textContent =
      "ALPHA. База запросов (origin вкладки): " + oPanel + ADDRESSBOOK_API_HOME + "/…";
  } else {
    standInfo.textContent =
      "ALPHA. Нет origin вкладки — fallback: " + ADDRESSBOOK_ORIGINS.ALPHA + ADDRESSBOOK_API_HOME + "/…";
  }
  rowStand.appendChild(labSt);
  rowStand.appendChild(standInfo);
  box.appendChild(rowStand);

  const secParams = document.createElement("div");
  secParams.style.cssText =
    "font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;margin:0 0 6px 0;";
  secParams.textContent = "Параметры";
  box.appendChild(secParams);

  const rowParams = document.createElement("div");
  rowParams.style.cssText =
    "display:grid;grid-template-columns:minmax(0,1fr);gap:6px 14px;margin-bottom:14px;padding:8px 12px;" +
    "background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;box-sizing:border-box;align-items:center;";
  function mkPauseField(labelText, defaultMs, idSuffix) {
    const wrap = document.createElement("label");
    wrap.style.cssText =
      "display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:8px;" +
      "font-size:11px;color:#334155;cursor:pointer;min-width:0;";
    wrap.setAttribute("for", "addrBookPause" + idSuffix);
    const sp = document.createElement("span");
    sp.textContent = labelText;
    sp.style.cssText = "line-height:1.25;flex:1 1 auto;min-width:0;";
    const inp = document.createElement("input");
    inp.type = "number";
    inp.id = "addrBookPause" + idSuffix;
    inp.min = "0";
    inp.max = String(REQUEST_PAUSE_MAX_MS);
    inp.step = "1";
    inp.value = String(defaultMs);
    inp.title = "0 — без паузы; максимум " + REQUEST_PAUSE_MAX_MS + " мс.";
    inp.style.cssText =
      "flex:0 0 auto;width:64px;box-sizing:border-box;padding:4px 6px;font-size:12px;color:#0f172a;" +
      "border:1px solid #94a3b8;border-radius:6px;color-scheme:light;";
    wrap.appendChild(sp);
    wrap.appendChild(inp);
    return { wrap: wrap, inp: inp };
  }
  var fieldBetween = mkPauseField("Пауза между запросами (Search, empInfoFull, departments), мс", REQUEST_PAUSE_MS, "Between");
  var fieldAfterSearch = mkPauseField("Пауза после всех Search перед empInfoFull, мс", REQUEST_PAUSE_MS, "AfterSearch");
  var fieldAfterEmp = mkPauseField("Пауза после empInfoFull перед departments, мс", REQUEST_PAUSE_MS, "AfterEmp");
  rowParams.appendChild(fieldBetween.wrap);
  rowParams.appendChild(fieldAfterSearch.wrap);
  rowParams.appendChild(fieldAfterEmp.wrap);
  box.appendChild(rowParams);

  // Выбор .txt: parseEmpIdsFromText; без записи в textarea — сразу цепочка карточек.
  const inputFileTn = document.createElement("input");
  inputFileTn.type = "file";
  inputFileTn.accept = ".txt,text/plain";
  inputFileTn.style.cssText = "display:none;";

  /**
   * Какой сценарий запускать после выбора файла.
   * @type {"search_then_emp"|"search_only"|"emp_only"|"search_then_emp_oe"}
   */
  var pendingFileAction = "search_then_emp";

  const fileBtnCss =
    "min-width:0;min-height:42px;padding:8px 6px;font-size:10px;font-weight:600;cursor:pointer;border-radius:8px;border:none;color:#fff;" +
    "text-align:center;line-height:1.25;box-sizing:border-box;display:flex;align-items:center;justify-content:center;";
  const bLoadTnFlow = document.createElement("button");
  bLoadTnFlow.type = "button";
  bLoadTnFlow.textContent = "Файл: Search → empInfoFull";
  bLoadTnFlow.title =
    "После выбора файла: сначала все Search, сохранение ответов и CSV, затем empInfoFull по уникальным employeeId. Режим разбора — как выбран ниже.";
  bLoadTnFlow.style.cssText =
    fileBtnCss + "background:linear-gradient(180deg,#0284c7,#0369a1);box-shadow:0 2px 6px rgba(3,105,161,.3);";
  const bLoadTnSearch = document.createElement("button");
  bLoadTnSearch.type = "button";
  bLoadTnSearch.textContent = "Файл: Только Search";
  bLoadTnSearch.title =
    "После выбора файла запустить только POST search. Режим разбора — как выбран ниже.";
  bLoadTnSearch.style.cssText =
    fileBtnCss + "background:linear-gradient(180deg,#14b8a6,#0d9488);box-shadow:0 2px 6px rgba(13,148,136,.3);";
  const bLoadTnEmp = document.createElement("button");
  bLoadTnEmp.type = "button";
  bLoadTnEmp.textContent = "Файл: Только empInfoFull";
  bLoadTnEmp.title =
    "После выбора файла запустить только GET empInfoFull. Используются значения из файла как employeeId.";
  bLoadTnEmp.style.cssText =
    fileBtnCss + "background:linear-gradient(180deg,#7c3aed,#6d28d9);box-shadow:0 2px 6px rgba(124,58,237,.35);";
  const bLoadTnOe = document.createElement("button");
  bLoadTnOe.type = "button";
  bLoadTnOe.textContent = "Файл: Search → empInfoFull → OE";
  bLoadTnOe.title =
    "Search, empInfoFull, затем GET departments по deptTree. Имена PROM_ALPHA_AB_*; какие файлы сохранять — чекбоксы ниже.";
  bLoadTnOe.style.cssText =
    fileBtnCss + "background:linear-gradient(180deg,#ea580c,#c2410c);box-shadow:0 2px 6px rgba(194,65,12,.35);";

  const rowFileTxt = document.createElement("div");
  rowFileTxt.style.cssText =
    "width:100%;box-sizing:border-box;margin:0 0 10px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;";
  rowFileTxt.appendChild(inputFileTn);
  rowFileTxt.appendChild(bLoadTnFlow);
  rowFileTxt.appendChild(bLoadTnSearch);
  rowFileTxt.appendChild(bLoadTnEmp);
  rowFileTxt.appendChild(bLoadTnOe);
  box.appendChild(rowFileTxt);

  const rowOeToggle = document.createElement("div");
  rowOeToggle.style.cssText =
    "margin:0 0 14px 0;padding:8px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;";
  const rowOeToggleTitle = document.createElement("div");
  rowOeToggleTitle.style.cssText = "font-size:11px;font-weight:700;color:#9a3412;margin:0 0 8px 0;";
  rowOeToggleTitle.textContent = "Сохранять файлы OE (снять — файл не выгружается):";
  rowOeToggle.appendChild(rowOeToggleTitle);
  const rowOeToggleGrid = document.createElement("div");
  rowOeToggleGrid.style.cssText =
    "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px;";
  /** @type {Record<string, HTMLInputElement>} */
  var oeSaveChk = {};
  var oeSaveFileDefs = [
    { key: "AB_Search", label: "AB_Search.json" },
    { key: "AB_empInfoFull", label: "AB_empInfoFull.json" },
    { key: "AB_deptTree_id", label: "AB_deptTree_id.json" },
    { key: "AB_full", label: "AB_full.json" },
    { key: "AB_profile_json", label: "AB_profile.json" },
    { key: "AB_profile_csv", label: "AB_profile.csv" }
  ];
  for (var oi = 0; oi < oeSaveFileDefs.length; oi++) {
    var def = oeSaveFileDefs[oi];
    var chkId = "addrBookOeSave_" + def.key;
    var lab = document.createElement("label");
    lab.setAttribute("for", chkId);
    lab.style.cssText =
      "display:flex;align-items:center;gap:6px;font-size:10px;color:#9a3412;cursor:pointer;font-weight:600;";
    var chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = chkId;
    chk.checked = true;
    chk.style.cssText = "margin:0;cursor:pointer;accent-color:#ea580c;flex:0 0 auto;";
    var sp = document.createElement("span");
    sp.textContent = def.label;
    lab.appendChild(chk);
    lab.appendChild(sp);
    rowOeToggleGrid.appendChild(lab);
    oeSaveChk[def.key] = chk;
  }
  rowOeToggle.appendChild(rowOeToggleGrid);
  box.appendChild(rowOeToggle);

  /**
   * Какие файлы OE сохранять при прогоне.
   * @returns {{AB_Search: boolean, AB_empInfoFull: boolean, AB_deptTree_id: boolean, AB_full: boolean, AB_profile_json: boolean, AB_profile_csv: boolean}}
   */
  function getOeSaveFilesFromPanel() {
    return {
      AB_Search: oeSaveChk.AB_Search.checked,
      AB_empInfoFull: oeSaveChk.AB_empInfoFull.checked,
      AB_deptTree_id: oeSaveChk.AB_deptTree_id.checked,
      AB_full: oeSaveChk.AB_full.checked,
      AB_profile_json: oeSaveChk.AB_profile_json.checked,
      AB_profile_csv: oeSaveChk.AB_profile_csv.checked
    };
  }

  const inpPauseBetween = fieldBetween.inp;
  const inpPauseAfterSearch = fieldAfterSearch.inp;
  const inpPauseAfterEmp = fieldAfterEmp.inp;

  /**
   * Читает паузу из поля: неотрицательное целое, с ограничением сверху.
   * @param {HTMLInputElement} inp
   * @param {number} fallback
   * @returns {number}
   */
  function readPauseMsFromInput(inp, fallback) {
    var n = parseInt(String(inp.value).trim(), 10);
    if (isNaN(n) || n < 0) return fallback;
    if (n > REQUEST_PAUSE_MAX_MS) return REQUEST_PAUSE_MAX_MS;
    return n;
  }

  const secHdr =
    "font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;margin:0;line-height:1.2;";

  const secInput = document.createElement("div");
  secInput.style.cssText = secHdr + "margin:0 0 6px 0;";
  secInput.textContent = "Данные для запросов";
  box.appendChild(secInput);

  const labInputHint = document.createElement("div");
  labInputHint.style.cssText =
    "font-size:11px;color:#475569;margin:0 0 8px 0;line-height:1.45;box-sizing:border-box;";
  labInputHint.textContent =
    "Один ввод для всех кнопок. Режим «Табельный номер»: берутся только группы цифр с нормализацией. " +
    "Режим «Значения для поиска»: разделители — перенос строки, ';' или ',' (пробел внутри строки сохраняется). " +
    "Кнопка «Только empInfoFull» работает по employeeId из поля.";
  box.appendChild(labInputHint);

  const taInput = document.createElement("textarea");
  taInput.rows = 5;
  taInput.spellcheck = false;
  taInput.style.cssText =
    "width:100%;box-sizing:border-box;margin:0 0 10px 0;padding:8px 10px;font-size:12px;" +
    "color:#0f172a;background:#fff;border:1px solid #94a3b8;border-radius:8px;resize:vertical;" +
    "min-height:106px;height:106px;max-height:240px;color-scheme:light;";
  taInput.placeholder =
    "Примеры:\n" +
    "00673892; 2209710\n" +
    "Лакомкин Олег Олегович\n" +
    "или employeeId для «Только empInfoFull»";
  taInput.value = EMP_IDS.join("\n");
  box.appendChild(taInput);

  const modeWrap = document.createElement("div");
  modeWrap.style.cssText =
    "display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 10px 0;padding:8px 10px;" +
    "background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;";
  const modeLabel = document.createElement("div");
  modeLabel.style.cssText = "font-size:11px;font-weight:600;color:#334155;";
  modeLabel.textContent = "Режим разбора:";
  modeWrap.appendChild(modeLabel);
  function makeModeRadio(id, value, text, checked) {
    const l = document.createElement("label");
    l.setAttribute("for", id);
    l.style.cssText = "display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#334155;cursor:pointer;";
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "addrBookInputMode";
    r.id = id;
    r.value = value;
    r.checked = !!checked;
    r.style.cssText = "margin:0;cursor:pointer;";
    const t = document.createElement("span");
    t.textContent = text;
    l.appendChild(r);
    l.appendChild(t);
    modeWrap.appendChild(l);
    return r;
  }
  const modeTabNum = makeModeRadio(
    "addrBookModeTabNum",
    "tabnum",
    "Табельный номер (нормализация)",
    true
  );
  const modeSearchValues = makeModeRadio(
    "addrBookModeSearch",
    "search",
    "Значения для поиска (без нормализации)",
    false
  );
  box.appendChild(modeWrap);

  const btnRow = document.createElement("div");
  btnRow.style.cssText =
    "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;width:100%;box-sizing:border-box;margin-bottom:12px;";
  const btnCss =
    "min-width:0;min-height:44px;padding:8px 6px;font-size:10px;font-weight:600;cursor:pointer;border-radius:8px;border:none;color:#fff;" +
    "text-align:center;line-height:1.25;box-sizing:border-box;display:flex;align-items:center;justify-content:center;";
  const b1 = document.createElement("button");
  b1.type = "button";
  b1.textContent = "Search → empInfoFull (все Search, затем карточки)";
  b1.style.cssText = btnCss + "background:linear-gradient(180deg,#0284c7,#0369a1);box-shadow:0 2px 6px rgba(3,105,161,.3);";
  const b2 = document.createElement("button");
  b2.type = "button";
  b2.textContent = "Только Search";
  b2.style.cssText = btnCss + "background:linear-gradient(180deg,#14b8a6,#0d9488);box-shadow:0 2px 6px rgba(13,148,136,.3);";
  const b3 = document.createElement("button");
  b3.type = "button";
  b3.textContent = "Только empInfoFull";
  b3.style.cssText = btnCss + "background:linear-gradient(180deg,#7c3aed,#6d28d9);box-shadow:0 2px 6px rgba(124,58,237,.35);";
  btnRow.appendChild(b1);
  btnRow.appendChild(b2);
  btnRow.appendChild(b3);
  box.appendChild(btnRow);

  const secOe = document.createElement("div");
  secOe.style.cssText = secHdr + "margin:0 0 6px 0;color:#9a3412;";
  secOe.textContent = "Сценарий OE (departments)";
  box.appendChild(secOe);

  const btnRowOe = document.createElement("div");
  btnRowOe.style.cssText =
    "display:grid;grid-template-columns:minmax(0,1fr);gap:8px;width:100%;box-sizing:border-box;margin-bottom:12px;";
  const b4 = document.createElement("button");
  b4.type = "button";
  b4.textContent = "Search → empInfoFull → OE";
  b4.style.cssText =
    btnCss + "background:linear-gradient(180deg,#ea580c,#c2410c);box-shadow:0 2px 6px rgba(194,65,12,.35);";
  btnRowOe.appendChild(b4);
  box.appendChild(btnRowOe);

  const logEl = document.createElement("div");
  logEl.style.cssText =
    "margin-top:0;font-size:11px;color:#0f172a;background:#f8fafc;min-height:168px;max-height:300px;overflow:auto;" +
    "border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-family:ui-monospace,monospace;" +
    "white-space:pre-wrap;word-break:break-word;line-height:1.45;box-sizing:border-box;width:100%;";
  logEl.textContent = "—";

  /**
   * Добавляет строку только в «Журнал работы» на панели (подробные сообщения не дублируются в консоль).
   * @param {string} line
   */
  function appendLog(line) {
    const s = typeof line === "string" ? line : String(line);
    if (logEl.textContent === "—") logEl.textContent = s;
    else logEl.textContent = logEl.textContent + "\n" + s;
    logEl.scrollTop = logEl.scrollHeight;
  }

  /** Блокировка кнопок и полей паузы на время сценария. */
  function setBusy(busy) {
    requestBusy = busy;
    b1.disabled = busy;
    b2.disabled = busy;
    b3.disabled = busy;
    b4.disabled = busy;
    bLoadTnFlow.disabled = busy;
    bLoadTnSearch.disabled = busy;
    bLoadTnEmp.disabled = busy;
    bLoadTnOe.disabled = busy;
    inpPauseBetween.disabled = busy;
    inpPauseAfterSearch.disabled = busy;
    inpPauseAfterEmp.disabled = busy;
    for (var sk = 0; sk < oeSaveFileDefs.length; sk++) {
      oeSaveChk[oeSaveFileDefs[sk].key].disabled = busy;
    }
    modeTabNum.disabled = busy;
    modeSearchValues.disabled = busy;
  }

  /**
   * Режим разбора текущего ввода.
   * @returns {"tabnum"|"search"}
   */
  function getCurrentInputMode() {
    return modeTabNum.checked ? "tabnum" : "search";
  }

  /**
   * Разбирает ввод для сценариев с search.
   * @param {string} text
   * @param {"tabnum"|"search"} mode
   * @returns {{input: string, searchText: string|number, asNumber: boolean}[]}
   */
  function parseSearchInputs(text, mode) {
    if (mode === "tabnum") {
      return parseEmpIdsFromText(text).map(function (id) {
        return {
          input: id,
          searchText: tabNumToSearchNumber(id),
          asNumber: true
        };
      });
    }
    return parseSearchValuesRaw(text).map(function (v) {
      return {
        input: v,
        searchText: v,
        asNumber: false
      };
    });
  }

  /**
   * Разбирает ввод для сценария «только empInfoFull».
   * Здесь ожидаются employeeId (UUID или иной ID, который понимает empInfoFull).
   * @param {string} text
   * @param {"tabnum"|"search"} mode
   * @returns {string[]}
   */
  function parseEmpInfoOnlyInputs(text, mode) {
    return mode === "tabnum" ? parseEmpIdsFromText(text) : parseSearchValuesRaw(text);
  }

  /**
   * Извлекает nextPageToken из ответа search (поддержка нескольких форматов ответа).
   * @param {*} data
   * @returns {string}
   */
  function getSearchNextPageToken(data) {
    if (!data || typeof data !== "object") return "";
    var raw = "";
    if (data.nextPageToken != null) raw = data.nextPageToken;
    else if (data.body && data.body.nextPageToken != null) raw = data.body.nextPageToken;
    return String(raw == null ? "" : raw).trim();
  }

  /**
   * Количество hits в одном ответе search.
   * @param {*} data
   * @returns {number}
   */
  function getSearchHitsCount(data) {
    if (!data || typeof data !== "object") return 0;
    if (Array.isArray(data.hits)) return data.hits.length;
    if (data.body && Array.isArray(data.body.hits)) return data.body.hits.length;
    return 0;
  }

  /**
   * Считывает все страницы search до пустого nextPageToken.
   * @param {{input: string, searchText: string|number, asNumber: boolean}} item
   * @returns {Promise<{pages: Array, totalPages: number, totalHits: number, employeeIds: string[], stopReason: string}>}
   */
  async function fetchAllSearchPages(item) {
    var pages = [];
    var totalHits = 0;
    var pageToken = null;
    var pageNo = 1;
    var seenTokens = {};
    var stopReason = "completed";
    while (true) {
      var r = await fetchEmployeesSearch(item.searchText, item.asNumber, pageToken);
      pages.push(r);
      var hitsCount = getSearchHitsCount(r.data);
      totalHits += hitsCount;
      var nextToken = getSearchNextPageToken(r.data);
      appendLog(
        "    → Search стр. " +
          pageNo +
          ": HTTP " +
          r.status +
          (r.ok ? " OK" : " ошибка") +
          ", hits: " +
          hitsCount +
          ", nextPageToken: " +
          (nextToken ? "есть" : "пусто")
      );
      if (!r.ok) {
        stopReason = "http_error";
        break;
      }
      if (!nextToken) {
        stopReason = "no_next_token";
        break;
      }
      if (seenTokens[nextToken]) {
        stopReason = "repeated_next_token";
        appendLog("    → предупреждение: повтор nextPageToken, остановка пагинации.");
        break;
      }
      seenTokens[nextToken] = true;
      pageToken = nextToken;
      pageNo++;
      if (pageNo > 200) {
        stopReason = "page_limit_reached";
        appendLog("    → предупреждение: достигнут лимит 200 страниц, остановка пагинации.");
        break;
      }
    }

    var employeeIds = [];
    var seenEmployeeIds = {};
    for (var i = 0; i < pages.length; i++) {
      var ids = pickEmployeeIdsFromSearchData(pages[i].data);
      for (var j = 0; j < ids.length; j++) {
        var id = ids[j];
        if (seenEmployeeIds[id]) continue;
        seenEmployeeIds[id] = true;
        employeeIds.push(id);
      }
    }

    return {
      pages: pages,
      totalPages: pages.length,
      totalHits: totalHits,
      employeeIds: employeeIds,
      stopReason: stopReason
    };
  }

  /**
   * Search → empInfoFull → departments (OE): полный пайплайн и выгрузки PROM_ALPHA_AB_*.
   * @param {{input: string, searchText: string|number, asNumber: boolean}[]} items
   * @param {number} pauseBetweenMs
   * @param {number} pauseAfterSearchMs
   * @param {number} pauseAfterEmpMs
   * @param {{AB_Search: boolean, AB_empInfoFull: boolean, AB_deptTree_id: boolean, AB_full: boolean, AB_profile_json: boolean, AB_profile_csv: boolean}} saveFiles
   * @param {string} [sourceTag]
   */
  async function runSearchEmpInfoFullOeExport(
    items,
    pauseBetweenMs,
    pauseAfterSearchMs,
    pauseAfterEmpMs,
    saveFiles,
    sourceTag
  ) {
    var prefix = sourceTag ? sourceTag + " — " : "";
    var envKey = getAddressBookEnvKey();
    var tsStamp = formatExportTimestampLocal(new Date());
    var standOrigin = getAddressBookStandAndOrigin();
    var saveList = [];
    if (saveFiles.AB_Search) saveList.push("AB_Search");
    if (saveFiles.AB_empInfoFull) saveList.push("AB_empInfoFull");
    if (saveFiles.AB_deptTree_id) saveList.push("AB_deptTree_id");
    if (saveFiles.AB_full) saveList.push("AB_full");
    if (saveFiles.AB_profile_json) saveList.push("AB_profile.json");
    if (saveFiles.AB_profile_csv) saveList.push("AB_profile.csv");

    console.log(
      "[Адресная книга OE] Search → empInfoFull → OE. Значений: " +
        items.length +
        ". Файлы: " +
        (saveList.length ? saveList.join(", ") : "—")
    );
    appendLog(
      prefix +
        "Search → empInfoFull → OE, значений: " +
        items.length +
        ", стенд: " +
        envKey +
        ", ts: " +
        tsStamp +
        ", сохранение: " +
        (saveList.length ? saveList.join(", ") : "ничего не выбрано")
    );

    var searchPhaseItems = [];
    var flatHitEmpOrder = [];
    var firstHitByEmpId = new Map();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      appendLog(
        "[Search " +
          (i + 1) +
          "/" +
          items.length +
          "] «" +
          String(item.input).slice(0, 60) +
          "» …"
      );
      try {
        const searchBundle = await fetchAllSearchPages(item);
        const hits = collectSearchHitsFromPages(searchBundle.pages);
        for (var hi = 0; hi < hits.length; hi++) {
          var h = hits[hi];
          if (!h || typeof h.employeeId !== "string") continue;
          var eid = h.employeeId.trim();
          if (!eid) continue;
          flatHitEmpOrder.push(eid);
          if (!firstHitByEmpId.has(eid)) firstHitByEmpId.set(eid, h);
        }
        var notFound = hits.length === 0;
        searchPhaseItems.push({
          input: item.input,
          searchText: item.searchText,
          asNumber: item.asNumber,
          searchPages: searchBundle.pages,
          hits: hits,
          notFound: notFound,
          searchStats: {
            totalPages: searchBundle.totalPages,
            totalHits: searchBundle.totalHits,
            uniqueEmployeeIds: searchBundle.employeeIds.length,
            stopReason: searchBundle.stopReason
          }
        });
        appendLog(
          (notFound ? "    → Search: не найдено" : "    → Search: hits=" +
            searchBundle.totalHits +
            ", уникальных employeeId=" +
            searchBundle.employeeIds.length)
        );
      } catch (e) {
        searchPhaseItems.push({
          input: item.input,
          searchText: item.searchText,
          asNumber: item.asNumber,
          error: String(e)
        });
        appendLog("    → исключение Search: " + e);
      }
      if (i < items.length - 1 && pauseBetweenMs > 0) await delay(pauseBetweenMs);
    }

    var allUniqueEmpIds = uniqueEmployeeIdsFirstOccurrence(flatHitEmpOrder);

    var fnameSearch = buildOeExportFileName("AB_Search", tsStamp);
    if (saveFiles.AB_Search) {
      downloadJson(fnameSearch, {
        exportedAt: new Date().toISOString(),
        scenario: "search_empInfoFull_oe_search",
        sourceTag: sourceTag || null,
        stand: envKey,
        origin: standOrigin.origin,
        timestamp: tsStamp,
        items: searchPhaseItems
      });
      appendLog("Файл: " + fnameSearch);
    }

    if (pauseAfterSearchMs > 0 && allUniqueEmpIds.length > 0) await delay(pauseAfterSearchMs);

    var empInfoById = new Map();
    appendLog("Фаза empInfoFull: " + allUniqueEmpIds.length);
    for (let k = 0; k < allUniqueEmpIds.length; k++) {
      var empUuid = allUniqueEmpIds[k];
      appendLog("[" + (k + 1) + "/" + allUniqueEmpIds.length + "] empInfoFull " + empUuid + " …");
      if (k > 0 && pauseBetweenMs > 0) await delay(pauseBetweenMs);
      try {
        var full = await fetchEmpInfoFull(empUuid);
        empInfoById.set(empUuid, full);
        appendLog("    → HTTP " + full.status + (full.ok ? " OK" : " ошибка"));
      } catch (e) {
        empInfoById.set(empUuid, { empId: empUuid, ok: false, status: 0, data: null, error: String(e) });
        appendLog("    → исключение: " + e);
      }
    }

    var fnameEmp = buildOeExportFileName("AB_empInfoFull", tsStamp);
    if (saveFiles.AB_empInfoFull) {
      var empList = [];
      empInfoById.forEach(function (val, key) {
        empList.push({ employeeId: key, empInfoFull: val });
      });
      downloadJson(fnameEmp, {
        exportedAt: new Date().toISOString(),
        scenario: "search_empInfoFull_oe_empInfoFull",
        timestamp: tsStamp,
        stand: envKey,
        results: empList
      });
      appendLog("Файл: " + fnameEmp);
    }

    if (pauseAfterEmpMs > 0 && allUniqueEmpIds.length > 0) await delay(pauseAfterEmpMs);

    var deptCache = new Map();
    var deptLinks = [];
    var uniqueDeptIdsOrdered = [];
    var deptIdSeenCollect = {};
    for (let k2a = 0; k2a < allUniqueEmpIds.length; k2a++) {
      var empWrapA = empInfoById.get(allUniqueEmpIds[k2a]);
      var empBodyA = empWrapA && empWrapA.data ? empWrapA.data : null;
      var nodesA = extractDeptTreeNodes(empBodyA);
      for (var dna = 0; dna < nodesA.length; dna++) {
        var deptIdA = nodesA[dna].id;
        if (!deptIdSeenCollect[deptIdA]) {
          deptIdSeenCollect[deptIdA] = true;
          uniqueDeptIdsOrdered.push(deptIdA);
        }
      }
    }
    appendLog(
      "Фаза departments (OE): уникальных dept id=" +
        uniqueDeptIdsOrdered.length +
        " (1 GET на id)"
    );
    for (let di = 0; di < uniqueDeptIdsOrdered.length; di++) {
      var deptIdFetch = uniqueDeptIdsOrdered[di];
      appendLog("  GET departments/" + deptIdFetch + " …");
      try {
        var deptRes = await fetchDepartmentById(deptIdFetch);
        deptCache.set(deptIdFetch, deptRes);
        appendLog("    → HTTP " + deptRes.status + (deptRes.ok ? " OK" : " ошибка"));
      } catch (e2) {
        deptCache.set(deptIdFetch, {
          deptId: deptIdFetch,
          ok: false,
          status: 0,
          data: null,
          error: String(e2)
        });
        appendLog("    → исключение: " + e2);
      }
      if (di < uniqueDeptIdsOrdered.length - 1 && pauseBetweenMs > 0) await delay(pauseBetweenMs);
    }
    for (let k2 = 0; k2 < allUniqueEmpIds.length; k2++) {
      var empId2 = allUniqueEmpIds[k2];
      var empWrap = empInfoById.get(empId2);
      var empBody = empWrap && empWrap.data ? empWrap.data : null;
      var nodes = extractDeptTreeNodes(empBody);
      for (var dn = 0; dn < nodes.length; dn++) {
        var deptId = nodes[dn].id;
        deptLinks.push({
          deptId: deptId,
          employeeId: empId2,
          department: deptCache.get(deptId) || null
        });
      }
    }

    var deptByIdObj = {};
    deptCache.forEach(function (val, key) {
      deptByIdObj[key] = val;
    });
    var fnameDept = buildOeExportFileName("AB_deptTree_id", tsStamp);
    if (saveFiles.AB_deptTree_id) {
      downloadJson(fnameDept, {
        exportedAt: new Date().toISOString(),
        scenario: "search_empInfoFull_oe_departments",
        timestamp: tsStamp,
        byId: deptByIdObj,
        byEmployeeLinks: deptLinks
      });
      appendLog("Файл: " + fnameDept);
    }

    var fullTreeSearches = [];
    for (var si = 0; si < searchPhaseItems.length; si++) {
      var sp = searchPhaseItems[si];
      if (sp.error) {
        fullTreeSearches.push(sp);
        continue;
      }
      var empNodes = [];
      var hitsArr = sp.hits || [];
      if (sp.notFound) {
        empNodes.push({
          notFound: true,
          searchedInput: sp.input,
          employeeId: AB_OE_NOT_FOUND,
          searchHit: buildNotFoundSearchHitFormatted(sp.input),
          empInfoFull: null,
          departments: []
        });
        fullTreeSearches.push({
          input: sp.input,
          searchText: sp.searchText,
          asNumber: sp.asNumber,
          searchPages: sp.searchPages,
          searchStats: sp.searchStats,
          notFound: true,
          employees: empNodes
        });
        continue;
      }
      for (var hj = 0; hj < hitsArr.length; hj++) {
        var hit = hitsArr[hj];
        var eidHit = hit && hit.employeeId ? String(hit.employeeId).trim() : "";
        if (!eidHit) continue;
        var empFull = empInfoById.get(eidHit) || null;
        var deptNodesOut = [];
        var bodyHit = empFull && empFull.data ? empFull.data : null;
        var dtNodes = extractDeptTreeNodes(bodyHit);
        for (var dt = 0; dt < dtNodes.length; dt++) {
          var did = dtNodes[dt].id;
          deptNodesOut.push({
            deptTreeNode: dtNodes[dt],
            department: deptCache.get(did) || null
          });
        }
        empNodes.push({
          employeeId: eidHit,
          searchHit: hit,
          empInfoFull: empFull,
          departments: deptNodesOut
        });
      }
      fullTreeSearches.push({
        input: sp.input,
        searchText: sp.searchText,
        asNumber: sp.asNumber,
        searchPages: sp.searchPages,
        searchStats: sp.searchStats,
        employees: empNodes
      });
    }

    var fnameFull = buildOeExportFileName("AB_full", tsStamp);
    if (saveFiles.AB_full) {
      downloadJson(fnameFull, {
        exportedAt: new Date().toISOString(),
        scenario: "search_empInfoFull_oe_full_tree",
        timestamp: tsStamp,
        stand: envKey,
        searches: fullTreeSearches
      });
      appendLog("Файл: " + fnameFull);
    }

    if (saveFiles.AB_profile_json || saveFiles.AB_profile_csv) {
      var profileEmployees = [];
      for (var ui = 0; ui < allUniqueEmpIds.length; ui++) {
        var uid = allUniqueEmpIds[ui];
        var hit0 = firstHitByEmpId.get(uid) || {};
        var empW = empInfoById.get(uid);
        var empB = empW && empW.data ? empW.data : null;
        var fmtSearch = pickSearchHitFormatted(hit0);
        var fmtEmp = pickEmpInfoFormatted(empB);
        var deptProfile = [];
        var dtList = fmtEmp.deptTree || [];
        for (var dp = 0; dp < dtList.length; dp++) {
          var dnode = dtList[dp];
          var dfetch = deptCache.get(dnode.id);
          deptProfile.push({
            id: dnode.id,
            name: dnode.name,
            orgUnit: pickDeptOrgUnit(dfetch)
          });
        }
        profileEmployees.push({
          employeeId: uid,
          search: fmtSearch,
          empInfoFull: fmtEmp,
          deptTreeWithOrgUnit: deptProfile
        });
      }
      for (var nfi = 0; nfi < searchPhaseItems.length; nfi++) {
        var spNf = searchPhaseItems[nfi];
        if (!spNf || !spNf.notFound) continue;
        profileEmployees.push({
          employeeId: AB_OE_NOT_FOUND,
          notFound: true,
          searchedInput: spNf.input,
          search: buildNotFoundSearchHitFormatted(spNf.input),
          empInfoFull: buildNotFoundEmpInfoFormatted(),
          deptTreeWithOrgUnit: []
        });
      }

      var fnameProfile = buildOeExportFileName("AB_profile", tsStamp);
      if (saveFiles.AB_profile_json) {
        downloadJson(fnameProfile, {
          exportedAt: new Date().toISOString(),
          scenario: "search_empInfoFull_oe_profile",
          timestamp: tsStamp,
          employees: profileEmployees
        });
        appendLog("Файл: " + fnameProfile);
      }

      var csvRows = [];
      var allColKeys = [];
      var colSeen = {};

      function addCols(obj) {
        var keys = Object.keys(obj);
        for (var ck = 0; ck < keys.length; ck++) {
          if (!colSeen[keys[ck]]) {
            colSeen[keys[ck]] = true;
            allColKeys.push(keys[ck]);
          }
        }
      }

      var fixedFirst = [
        "employeeId",
        "tabNum",
        "fullName",
        "TN_8",
        "empFamilyName",
        "empName",
        "empPatronymic",
        "jobTitle",
        "empTBname"
      ];

      for (var pr = 0; pr < profileEmployees.length; pr++) {
        var pe = profileEmployees[pr];
        var row = {};
        row.employeeId = pe.employeeId || "";
        row.tabNum = pe.empInfoFull && pe.empInfoFull.tabNum != null ? String(pe.empInfoFull.tabNum) : "";
        row.fullName = pe.search && pe.search.fullName != null ? String(pe.search.fullName) : "";
        if (pe.notFound) {
          row.TN_8 = tn8FromSearchedInput(pe.searchedInput || "");
        } else {
          row.TN_8 = formatTabNumTn8(pe.empInfoFull ? pe.empInfoFull.tabNum : "");
        }
        row.empFamilyName =
          pe.empInfoFull && pe.empInfoFull.empFamilyName != null ? String(pe.empInfoFull.empFamilyName) : "";
        row.empName = pe.empInfoFull && pe.empInfoFull.empName != null ? String(pe.empInfoFull.empName) : "";
        row.empPatronymic =
          pe.empInfoFull && pe.empInfoFull.empPatronymic != null ? String(pe.empInfoFull.empPatronymic) : "";
        row.jobTitle = pe.empInfoFull && pe.empInfoFull.jobTitle != null ? String(pe.empInfoFull.jobTitle) : "";
        row.empTBname = pe.empInfoFull && pe.empInfoFull.empTBname != null ? String(pe.empInfoFull.empTBname) : "";

        var emFlat = flattenArrayColumnsForCsv("emails", pe.empInfoFull ? pe.empInfoFull.emails : [], [
          "address",
          "domain"
        ]);
        Object.assign(row, emFlat);

        var dtArr = pe.deptTreeWithOrgUnit || [];
        for (var dti = 0; dti < dtArr.length; dti++) {
          var idx = pad2Export(dti + 1);
          var drow = dtArr[dti];
          row["deptTree - id (" + idx + ")"] = drow.id != null ? String(drow.id) : "";
          row["deptTree - name (" + idx + ")"] = drow.name != null ? String(drow.name) : "";
          row["deptTree - id - orgUnit (" + idx + ")"] = drow.orgUnit != null ? String(drow.orgUnit) : "";
        }

        var phFlat = flattenArrayColumnsForCsv("phones", pe.empInfoFull ? pe.empInfoFull.phones : [], [
          "type",
          "phoneNumber"
        ]);
        Object.assign(row, phFlat);

        var lgFlat = flattenArrayColumnsForCsv("logins", pe.empInfoFull ? pe.empInfoFull.logins : [], [
          "domain",
          "accountName"
        ]);
        Object.assign(row, lgFlat);

        if (pe.search) {
          row.departmentName = pe.search.departmentName != null ? String(pe.search.departmentName) : "";
          row.positionName = pe.search.positionName != null ? String(pe.search.positionName) : "";
          row.phoneNumber = pe.search.phoneNumber != null ? String(pe.search.phoneNumber) : "";
          row.email = pe.search.email != null ? String(pe.search.email) : "";
          row.photo = pe.search.photo != null ? String(pe.search.photo) : "";
          row.isAbsent = pe.search.isAbsent != null ? String(pe.search.isAbsent) : "";
          row.birthDate =
            pe.search.birthDate != null
              ? String(pe.search.birthDate)
              : pe.empInfoFull && pe.empInfoFull.birthday != null
                ? String(pe.empInfoFull.birthday)
                : "";
          row.roleName = pe.search.roleName != null ? String(pe.search.roleName) : "";
          if (pe.search.contactPhone && typeof pe.search.contactPhone === "object") {
            row["contactPhone - id"] =
              pe.search.contactPhone.id != null ? String(pe.search.contactPhone.id) : "";
            row["contactPhone - phoneNumber"] =
              pe.search.contactPhone.phoneNumber != null ? String(pe.search.contactPhone.phoneNumber) : "";
          }
          if (pe.search.absenceInfo && pe.search.absenceInfo.typeName != null) {
            row["absenceInfo - typeName"] = String(pe.search.absenceInfo.typeName);
          }
        }
        if (pe.empInfoFull) {
          row.dir = pe.empInfoFull.dir != null ? String(pe.empInfoFull.dir) : "";
          row.oldFamilyName =
            pe.empInfoFull.oldFamilyName != null ? String(pe.empInfoFull.oldFamilyName) : "";
          if (pe.empInfoFull.absences && pe.empInfoFull.absences.info) {
            var inf = pe.empInfoFull.absences.info;
            row["absences - isLong"] =
              pe.empInfoFull.absences.isLong != null ? String(pe.empInfoFull.absences.isLong) : "";
            row["absences - startDate"] = inf.startDate != null ? String(inf.startDate) : "";
            row["absences - endDate"] = inf.endDate != null ? String(inf.endDate) : "";
            row["absences - typeName"] = inf.typeName != null ? String(inf.typeName) : "";
          }
        }

        csvRows.push(row);
        addCols(row);
      }

      var orderedCols = fixedFirst.slice();
      var emailCols = orderIndexedColumns(allColKeys, "emails", ["address", "domain"]);
      var deptCols = orderIndexedColumns(allColKeys, "deptTree", ["id", "name", "id - orgUnit"]);
      var phoneCols = orderIndexedColumns(allColKeys, "phones", ["type", "phoneNumber"]);
      var loginCols = orderIndexedColumns(allColKeys, "logins", ["domain", "accountName"]);
      var restCols = allColKeys
        .filter(function (k) {
          return (
            fixedFirst.indexOf(k) < 0 &&
            k.indexOf("emails -") !== 0 &&
            k.indexOf("deptTree -") !== 0 &&
            k.indexOf("phones -") !== 0 &&
            k.indexOf("logins -") !== 0
          );
        })
        .sort();
      orderedCols = orderedCols.concat(emailCols).concat(deptCols).concat(restCols).concat(phoneCols).concat(loginCols);

      if (saveFiles.AB_profile_csv) {
        var csvHeader = orderedCols
          .map(function (c) {
            return escapeCsvField(c);
          })
          .join(AB_OE_CSV_DELIMITER);
        var csvBody = csvRows
          .map(function (r) {
            return csvRowFromOrderedKeys(r, orderedCols);
          })
          .join("\r\n");
        var fnameCsvProfile = buildOeExportFileName("AB_profile", tsStamp, ".csv");
        downloadText(fnameCsvProfile, "\uFEFF" + csvHeader + "\r\n" + csvBody, "text/csv;charset=utf-8");
        appendLog("Файл: " + fnameCsvProfile);
      }
    }

    appendLog("OE готово. ts=" + tsStamp + (saveList.length ? ": " + saveList.join(", ") : " (файлы не сохранялись)"));
    console.log("[Адресная книга OE] Готово, ts=" + tsStamp);
  }

  /**
   * Search → empInfoFull: фаза 1 — все POST search; сохранение ответов Search и CSV
   * («что искали», employeeId по каждой строке hit); фаза 2 — GET empInfoFull по каждому
   * уникальному employeeId (порядок первого появления по всем поискам подряд).
   * @param {{input: string, searchText: string|number, asNumber: boolean}[]} items
   * @param {number} pauseBetweenMs — между запросами в фазе Search и между GET в фазе empInfoFull
   * @param {number} pauseAfterSearchMs — после завершения всех Search, перед первым empInfoFull
   * @param {string} [sourceTag]
   */
  async function runSearchThenEmpInfoFullExport(items, pauseBetweenMs, pauseAfterSearchMs, sourceTag) {
    var prefix = sourceTag ? sourceTag + " — " : "";
    var envKey = getAddressBookEnvKey();
    var ts = Date.now();
    console.log(
      "[Адресная книга] Запущен сценарий search → empInfoFull. Значений: " +
        items.length +
        ". Сначала все Search, затем empInfoFull. Подробности — в «Журнал работы»."
    );
    appendLog(
      prefix +
        "Search → empInfoFull, значений: " +
        items.length +
        ", стенд: " +
        envKey +
        " (фаза 1: все Search; фаза 2: empInfoFull)"
    );

    /** @type {string[][]} */
    var perItemHitOrderedIds = [];
    const searchPhasePayload = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      appendLog(
        "[Search " +
          (i + 1) +
          "/" +
          items.length +
          "] «" +
          String(item.input).slice(0, 60) +
          (String(item.input).length > 60 ? "…" : "") +
          "» → search(" +
          String(item.searchText) +
          ") …"
      );
      try {
        const searchBundle = await fetchAllSearchPages(item);
        const idsPerHit = collectEmployeeIdsFromSearchPagesInHitOrder(searchBundle.pages);
        perItemHitOrderedIds.push(idsPerHit);
        searchPhasePayload.push({
          input: item.input,
          searchText: item.searchText,
          asNumber: item.asNumber,
          searchPages: searchBundle.pages,
          searchStats: {
            totalPages: searchBundle.totalPages,
            totalHits: searchBundle.totalHits,
            uniqueEmployeeIds: searchBundle.employeeIds.length,
            rowsInCsv: idsPerHit.length,
            stopReason: searchBundle.stopReason
          }
        });
        appendLog(
          "    → итог Search: страниц=" +
            searchBundle.totalPages +
            ", hits=" +
            searchBundle.totalHits +
            ", уникальных employeeId=" +
            searchBundle.employeeIds.length +
            ", строк для CSV (по hits)=" +
            idsPerHit.length
        );
      } catch (e) {
        perItemHitOrderedIds.push([]);
        searchPhasePayload.push({
          input: item.input,
          searchText: item.searchText,
          asNumber: item.asNumber,
          error: String(e)
        });
        appendLog("    → исключение: " + e);
      }
      if (i < items.length - 1 && pauseBetweenMs > 0) await delay(pauseBetweenMs);
    }

    var flatHitOrder = [];
    for (var fi = 0; fi < perItemHitOrderedIds.length; fi++) {
      flatHitOrder = flatHitOrder.concat(perItemHitOrderedIds[fi]);
    }
    const allUniqueEmpIds = uniqueEmployeeIdsFirstOccurrence(flatHitOrder);

    const fnameSearch = "addressbook_search_" + envKey + "_" + ts + ".json";
    const fnameCsv = "addressbook_search_employeeId_map_" + envKey + "_" + ts + ".csv";
    const fnameEmp = "addressbook_empInfoFull_" + envKey + "_" + ts + ".json";

    appendLog(
      "Сохранение ответов Search и CSV (до empInfoFull). Уникальных employeeId для GET: " +
        allUniqueEmpIds.length
    );
    downloadJson(fnameSearch, {
      exportedAt: new Date().toISOString(),
      scenario: "search_then_empInfoFull_search_phase",
      sourceTag: sourceTag || null,
      stand: envKey,
      items: searchPhasePayload
    });

    var csvLines = ["\uFEFFчто искали,employeeId"];
    for (let ci = 0; ci < items.length; ci++) {
      var searched = items[ci].input;
      var rowIds = perItemHitOrderedIds[ci] || [];
      for (var cj = 0; cj < rowIds.length; cj++) {
        csvLines.push(escapeCsvField(searched) + "," + escapeCsvField(rowIds[cj]));
      }
    }
    downloadText(fnameCsv, csvLines.join("\r\n"), "text/csv;charset=utf-8");

    appendLog("Файлы фазы Search: " + fnameSearch + ", " + fnameCsv);

    if (pauseAfterSearchMs > 0 && allUniqueEmpIds.length > 0) {
      await delay(pauseAfterSearchMs);
    }

    appendLog("Фаза empInfoFull: запросов: " + allUniqueEmpIds.length);
    const empResults = [];
    var totalEmpInfoFullCalls = 0;
    for (let k = 0; k < allUniqueEmpIds.length; k++) {
      var empUuid = allUniqueEmpIds[k];
      appendLog(
        "[" +
          (k + 1) +
          "/" +
          allUniqueEmpIds.length +
          "] employeeId " +
          empUuid +
          " → GET empInfoFull …"
      );
      if (k > 0 && pauseBetweenMs > 0) await delay(pauseBetweenMs);
      try {
        const full = await fetchEmpInfoFull(empUuid);
        totalEmpInfoFullCalls++;
        empResults.push({ employeeId: empUuid, empInfoFull: full });
        appendLog("    → empInfoFull HTTP " + full.status + (full.ok ? " OK" : " ошибка"));
      } catch (e) {
        empResults.push({ employeeId: empUuid, error: String(e) });
        appendLog("    → исключение: " + e);
      }
    }

    downloadJson(fnameEmp, {
      exportedAt: new Date().toISOString(),
      scenario: "search_then_empInfoFull_empInfoFull_phase",
      sourceTag: sourceTag || null,
      stand: envKey,
      searchFiles: { searchJson: fnameSearch, searchEmployeeIdCsv: fnameCsv },
      totalUniqueEmployeeIds: allUniqueEmpIds.length,
      results: empResults
    });

    appendLog(
      "Готово. Файлы: " +
        fnameSearch +
        ", " +
        fnameCsv +
        ", " +
        fnameEmp +
        " (GET empInfoFull: " +
        totalEmpInfoFullCalls +
        ")"
    );
    console.log(
      "[Адресная книга] Готово. Search: " +
        fnameSearch +
        " | CSV: " +
        fnameCsv +
        " | empInfoFull: " +
        fnameEmp +
        " | запросов empInfoFull: " +
        totalEmpInfoFullCalls
    );
  }

  /**
   * Только POST search по входным значениям.
   * @param {{input: string, searchText: string|number, asNumber: boolean}[]} items
   * @param {number} pauseBetweenMs
   */
  async function runSearchOnlyExport(items, pauseBetweenMs) {
    console.log(
      "[Адресная книга] Запущен сценарий только search, значений: " +
        items.length +
        ". Подробности — в «Журнал работы»."
    );
    appendLog("— Только search, значений: " + items.length + ", стенд: " + getAddressBookEnvKey());
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      appendLog("[" + (i + 1) + "/" + items.length + "] search(" + String(item.searchText) + ") …");
      try {
        const bundle = await fetchAllSearchPages(item);
        const r = bundle.pages.length > 0 ? bundle.pages[0] : null;
        results.push({
          input: item.input,
          searchText: item.searchText,
          asNumber: item.asNumber,
          search: r,
          searchPages: bundle.pages,
          searchStats: {
            totalPages: bundle.totalPages,
            totalHits: bundle.totalHits,
            uniqueEmployeeIds: bundle.employeeIds.length,
            stopReason: bundle.stopReason
          }
        });
        appendLog(
          "    → итог Search: страниц=" +
            bundle.totalPages +
            ", hits=" +
            bundle.totalHits +
            ", уникальных employeeId=" +
            bundle.employeeIds.length
        );
      } catch (e) {
        results.push({
          input: item.input,
          searchText: item.searchText,
          asNumber: item.asNumber,
          error: String(e)
        });
        appendLog("    → исключение: " + e);
      }
      if (i < items.length - 1 && pauseBetweenMs > 0) await delay(pauseBetweenMs);
    }
    const fname = "addressbook_search_only_" + getAddressBookEnvKey() + "_" + Date.now() + ".json";
    downloadJson(fname, results);
    appendLog("Готово. Файл: " + fname);
    console.log("[Адресная книга] Только search завершён. Файл: " + fname + " | значений: " + items.length);
  }

  /**
   * Только GET empInfoFull по списку employeeId из поля.
   * @param {string[]} empIds
   * @param {number} pauseBetweenMs
   */
  async function runEmpInfoFullOnlyExport(empIds, pauseBetweenMs) {
    console.log(
      "[Адресная книга] Запущен сценарий только empInfoFull, employeeId: " +
        empIds.length +
        ". Подробности — в «Журнал работы»."
    );
    appendLog("— Только empInfoFull, employeeId: " + empIds.length + ", стенд: " + getAddressBookEnvKey());
    const results = [];
    for (let i = 0; i < empIds.length; i++) {
      const empId = empIds[i];
      appendLog(
        "[" +
          (i + 1) +
          "/" +
          empIds.length +
          "] employeeId «" +
          String(empId).slice(0, 80) +
          (String(empId).length > 80 ? "…" : "") +
          "» → GET empInfoFull …"
      );
      try {
        const full = await fetchEmpInfoFull(empId);
        results.push({ employeeId: empId, empInfoFull: full });
        appendLog("    → HTTP " + full.status + (full.ok ? " OK" : " — ошибка"));
      } catch (e) {
        results.push({ employeeId: empId, error: String(e) });
        appendLog("    → исключение: " + e);
      }
      if (i < empIds.length - 1 && pauseBetweenMs > 0) await delay(pauseBetweenMs);
    }
    const fname = "addressbook_empInfoFull_only_" + getAddressBookEnvKey() + "_" + Date.now() + ".json";
    downloadJson(fname, results);
    appendLog("Готово. Файл: " + fname);
    console.log("[Адресная книга] Только empInfoFull завершён. Файл: " + fname + " | employeeId: " + empIds.length);
  }

  // Файл .txt: статистика в журнал, без записи в поле — запуск выбранного сценария по текущему режиму.
  inputFileTn.addEventListener("change", function () {
    var file = inputFileTn.files && inputFileTn.files[0];
    inputFileTn.value = "";
    if (!file) return;
    if (requestBusy) {
      appendLog("Уже выполняется запрос — дождитесь окончания.");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var text = typeof reader.result === "string" ? reader.result : "";
      var mode = getCurrentInputMode();
      var items = parseSearchInputs(text, mode);
      var empIds = parseEmpInfoOnlyInputs(text, mode);
      if (pendingFileAction === "emp_only" ? empIds.length === 0 : items.length === 0) {
        appendLog(
          "Файл «" +
            file.name +
            "»: нет корректных значений для режима «" +
            (mode === "tabnum" ? "Табельный номер" : "Значения для поиска") +
            "»."
        );
        return;
      }
      appendLog(
        "Файл «" +
          file.name +
          "»: извлечено значений: " +
          (pendingFileAction === "emp_only" ? empIds.length : items.length) +
          "."
      );
      var pb = readPauseMsFromInput(inpPauseBetween, REQUEST_PAUSE_MS);
      var pa = readPauseMsFromInput(inpPauseAfterSearch, REQUEST_PAUSE_MS);
      setBusy(true);
      void (async function () {
        try {
          if (pendingFileAction === "search_only") {
            appendLog("Запуск сценария из файла: только Search.");
            await runSearchOnlyExport(items, pb);
          } else if (pendingFileAction === "emp_only") {
            appendLog("Запуск сценария из файла: только empInfoFull.");
            await runEmpInfoFullOnlyExport(empIds, pb);
          } else if (pendingFileAction === "search_then_emp_oe") {
            appendLog("Запуск сценария из файла: Search → empInfoFull → OE.");
            var pe = readPauseMsFromInput(inpPauseAfterEmp, REQUEST_PAUSE_MS);
            await runSearchEmpInfoFullOeExport(
              items,
              pb,
              pa,
              pe,
              getOeSaveFilesFromPanel(),
              "Из файла"
            );
          } else {
            appendLog("Запуск сценария из файла: Search → empInfoFull.");
            await runSearchThenEmpInfoFullExport(items, pb, pa, "Из файла");
          }
        } catch (err) {
          appendLog("Сбой сценария: " + err);
        } finally {
          setBusy(false);
        }
      })();
    };
    reader.onerror = function () {
      appendLog("Ошибка чтения файла «" + file.name + "».");
    };
    reader.readAsText(file, "UTF-8");
  });

  function openTxtForAction(action) {
    if (requestBusy) {
      appendLog("Уже выполняется запрос — дождитесь окончания.");
      return;
    }
    pendingFileAction = action;
    inputFileTn.click();
  }
  bLoadTnFlow.addEventListener("click", function () {
    openTxtForAction("search_then_emp");
  });
  bLoadTnSearch.addEventListener("click", function () {
    openTxtForAction("search_only");
  });
  bLoadTnEmp.addEventListener("click", function () {
    openTxtForAction("emp_only");
  });
  bLoadTnOe.addEventListener("click", function () {
    openTxtForAction("search_then_emp_oe");
  });

  b4.addEventListener("click", async function () {
    if (requestBusy) {
      appendLog("Уже выполняется запрос — дождитесь окончания.");
      return;
    }
    const mode = getCurrentInputMode();
    const items = parseSearchInputs(taInput.value, mode);
    if (items.length === 0) {
      appendLog("Нет корректных значений в поле для сценария Search → empInfoFull → OE.");
      return;
    }
    var pb = readPauseMsFromInput(inpPauseBetween, REQUEST_PAUSE_MS);
    var pa = readPauseMsFromInput(inpPauseAfterSearch, REQUEST_PAUSE_MS);
    var pe = readPauseMsFromInput(inpPauseAfterEmp, REQUEST_PAUSE_MS);
    setBusy(true);
    try {
      await runSearchEmpInfoFullOeExport(items, pb, pa, pe, getOeSaveFilesFromPanel(), "Из поля");
    } catch (err) {
      appendLog("Сбой сценария OE: " + err);
    } finally {
      setBusy(false);
    }
  });

  b1.addEventListener("click", async function () {
    if (requestBusy) {
      appendLog("Уже выполняется запрос — дождитесь окончания.");
      return;
    }
    const mode = getCurrentInputMode();
    const items = parseSearchInputs(taInput.value, mode);
    if (items.length === 0) {
      appendLog("Нет корректных значений в поле для сценария search → empInfoFull.");
      return;
    }
    var pb = readPauseMsFromInput(inpPauseBetween, REQUEST_PAUSE_MS);
    var pa = readPauseMsFromInput(inpPauseAfterSearch, REQUEST_PAUSE_MS);
    setBusy(true);
    try {
      await runSearchThenEmpInfoFullExport(items, pb, pa, "Из поля");
    } catch (err) {
      appendLog("Сбой сценария: " + err);
    } finally {
      setBusy(false);
    }
  });

  b2.addEventListener("click", async function () {
    if (requestBusy) {
      appendLog("Уже выполняется запрос — дождитесь окончания.");
      return;
    }
    const mode = getCurrentInputMode();
    const items = parseSearchInputs(taInput.value, mode);
    if (items.length === 0) {
      appendLog("Нет корректных значений в поле для сценария только search.");
      return;
    }
    var pb = readPauseMsFromInput(inpPauseBetween, REQUEST_PAUSE_MS);
    setBusy(true);
    try {
      await runSearchOnlyExport(items, pb);
    } finally {
      setBusy(false);
    }
  });

  b3.addEventListener("click", async function () {
    if (requestBusy) {
      appendLog("Уже выполняется запрос — дождитесь окончания.");
      return;
    }
    const mode = getCurrentInputMode();
    const empIds = parseEmpInfoOnlyInputs(taInput.value, mode);
    if (empIds.length === 0) {
      appendLog("Нет значений employeeId для сценария только empInfoFull.");
      return;
    }
    var pb = readPauseMsFromInput(inpPauseBetween, REQUEST_PAUSE_MS);
    setBusy(true);
    try {
      await runEmpInfoFullOnlyExport(empIds, pb);
    } finally {
      setBusy(false);
    }
  });

  const logLab = document.createElement("div");
  logLab.style.cssText =
    "font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;margin:16px 0 8px 0;";
  logLab.textContent = "Журнал работы";
  box.appendChild(logLab);
  box.appendChild(logEl);

  const bClose = document.createElement("button");
  bClose.type = "button";
  bClose.textContent = "Закрыть панель";
  bClose.title =
    "Удаляет панель с DOM: поля, паузы и обработчики снимаются; скрипт можно снова вставить в консоль (обёртка IIFE не даёт ошибки повторного const).";
  bClose.style.cssText =
    "margin-top:14px;width:100%;box-sizing:border-box;min-height:44px;padding:10px 14px;font-size:12px;cursor:pointer;" +
    "background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;border-radius:8px;font-weight:500;";
  bClose.addEventListener("click", function () {
    // Удаление корня панели: замыкание сценария (requestBusy, ссылки на поля) перестаёт быть связанным с документом;
    // незавершённые fetch могут ещё завершиться в фоне, но UI и «память» панели очищены.
    box.remove();
  });
  box.appendChild(bClose);

  document.body.appendChild(box);
}

startAddressBookPanel();
console.log(
  "[Адресная книга OE] Панель открыта. Сценарий OE: Search → empInfoFull → departments. Журнал — на панели."
);
})();
