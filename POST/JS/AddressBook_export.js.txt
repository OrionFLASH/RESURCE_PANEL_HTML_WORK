// =============================================================================
// AddressBook_export.js — выгрузки из адресной книги (DevTools, консоль)
// =============================================================================
// Для AddressBook используется отдельный стенд ALPHA.
// Для фактических запросов приоритет у window.location.origin (чтобы credentials: 'include' использовал куки текущей вкладки).
// Если origin вкладки недоступен (редко: file://), берётся fallback ADDRESSBOOK_ORIGINS.ALPHA.
// Карточка empInfoFull: empId = UUID (employeeId из search), не 8-значный ТН. Сценарий Search → empInfoFull: сначала все POST search, сохранение ответов и CSV «что искали» → employeeId, затем GET empInfoFull по каждому уникальному employeeId (порядок первого появления по всем поискам).
// =============================================================================
// Вся логика в IIFE: повторная вставка скрипта в консоль не падает на «уже объявлено» (const/let на верхнем уровне).
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
  var devTrace = createDevToolsTrace({ scriptId: "AddressBook_export" });
  var httpFetch = devTrace.wrapFetch(__nativeFetch);


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

/**
 * Экранирование поля для CSV.
 * @param {string|number|null|undefined} s
 * @returns {string}
 */
function escapeCsvField(s) {
  var t = String(s == null ? "" : s);
  if (/[\r\n",]/.test(t)) {
    return '"' + t.replace(/"/g, '""') + '"';
  }
  return t;
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
  const res = await httpFetch(url, {
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
  const res = await httpFetch(o.origin + ADDRESSBOOK_API_HOME + "/employees/search", {
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

/**
 * Панель выгрузок: визуально в одном стиле с Profile_GP_LOAD_file (отступы, скругления, стенд в «карточке», кнопки-градиенты).
 * Повторная вставка скрипта удаляет предыдущий корень `addressBookExportPanelRoot`.
 */
function startAddressBookPanel() {
  var prev = document.getElementById("addressBookExportPanelRoot");
  if (prev) prev.remove();

  /** Пока идёт цепочка запросов — не запускать второй сценарий с панели. */
  var requestBusy = false;

  const box = document.createElement("div");
  box.id = "addressBookExportPanelRoot";
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
  head.textContent = "Адресная книга — выгрузки";
  box.appendChild(head);

  const sub = document.createElement("div");
  sub.style.cssText = "font-size:12px;color:#64748b;margin:0 0 14px 0;line-height:1.45;";
  sub.textContent =
    "Стенд ALPHA. Запросы идут на origin этой вкладки (если он есть), иначе на отдельный fallback адресной книги. Ход работы — в «Журнал работы»; в консоли — кратко о запуске и итоге.";
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
    "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px 14px;margin-bottom:14px;padding:8px 12px;" +
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
  var fieldBetween = mkPauseField("Пауза между запросами (Search и empInfoFull), мс", REQUEST_PAUSE_MS, "Between");
  var fieldAfterSearch = mkPauseField("Пауза после всех Search перед empInfoFull, мс", REQUEST_PAUSE_MS, "AfterSearch");
  rowParams.appendChild(fieldBetween.wrap);
  rowParams.appendChild(fieldAfterSearch.wrap);
  box.appendChild(rowParams);

  // Выбор .txt: parseEmpIdsFromText; без записи в textarea — сразу цепочка карточек.
  const inputFileTn = document.createElement("input");
  inputFileTn.type = "file";
  inputFileTn.accept = ".txt,text/plain";
  inputFileTn.style.cssText = "display:none;";

  /**
   * Какой сценарий запускать после выбора файла.
   * @type {"search_then_emp"|"search_only"|"emp_only"}
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

  const rowFileTxt = document.createElement("div");
  rowFileTxt.style.cssText =
    "width:100%;box-sizing:border-box;margin:0 0 14px 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;";
  rowFileTxt.appendChild(inputFileTn);
  rowFileTxt.appendChild(bLoadTnFlow);
  rowFileTxt.appendChild(bLoadTnSearch);
  rowFileTxt.appendChild(bLoadTnEmp);
  box.appendChild(rowFileTxt);

  const inpPauseBetween = fieldBetween.inp;
  const inpPauseAfterSearch = fieldAfterSearch.inp;

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
    devTrace.log(typeof line === "string" ? line : String(line));
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
    bLoadTnFlow.disabled = busy;
    bLoadTnSearch.disabled = busy;
    bLoadTnEmp.disabled = busy;
    inpPauseBetween.disabled = busy;
    inpPauseAfterSearch.disabled = busy;
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
  devTrace.mountToggleRow(box, logLab);
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
  devTrace.attachPanel(box);
}

startAddressBookPanel();
console.log(
  "[Адресная книга] Панель открыта. Подробный журнал — в окне «Журнал работы» на панели выгрузок."
);
})();
