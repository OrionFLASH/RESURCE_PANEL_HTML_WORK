/**
 * SUP_Config_Update.js — обновление параметров СУП (UFS Config Manager).
 * Запуск: DevTools → Console на вкладке ufs-config-manager → вставить файл → Enter.
 */
(() => {
  "use strict";

  const PANEL_ID = "sup-config-update-panel";
  const DEFAULT_PAUSE_MS = 500;
  const PAUSE_MAX_MS = 300000;
  const LOG_MAX_LINES = 400;
  const PANEL_FONT = "11px";
  const PANEL_WIDTH = "min(1200px, calc(100vw - 24px))";
  const PANEL_HEIGHT = "calc(100vh - 24px)";

  /** @type {Map<string, number>} */
  const parameterIdCache = new Map();

  /** @type {{ entries: object[]; source: string } | null} */
  let rollbackSnapshot = null;

  let stopRequested = false;
  let runInProgress = false;

  /** @type {HTMLElement | null} */
  let logEl = null;
  /** @type {HTMLElement | null} */
  let bundleInfoEl = null;

  /**
   * @returns {{ origin: string; apiPrefix: string; referer: string } | null}
   */
  function detectEnvFromLocation() {
    const origin = window.location.origin;
    const path = window.location.pathname || "";
    const marker = "/ufs-config-manager";
    const idx = path.indexOf(marker);
    if (idx < 0) return null;
    const basePath = path.slice(0, idx);
    return {
      origin,
      apiPrefix: basePath + "/ufs-config-manager/pacman/rest/",
      referer: origin + basePath + "/ufs-config-manager/",
    };
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * @param {string} msg
   * @param {"info"|"ok"|"warn"|"err"} [level]
   */
  function panelLog(msg, level) {
    const ts = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    const prefix =
      level === "err" ? "[ERR]" : level === "warn" ? "[WARN]" : level === "ok" ? "[OK]" : "[INFO]";
    const line = ts + " " + prefix + " " + msg;
    if (logEl) {
      logEl.textContent = (logEl.textContent ? logEl.textContent + "\n" : "") + line;
      const lines = logEl.textContent.split("\n");
      if (lines.length > LOG_MAX_LINES) {
        logEl.textContent = lines.slice(-LOG_MAX_LINES).join("\n");
      }
      logEl.scrollTop = logEl.scrollHeight;
    }
    if (level === "err") console.error("[SUP_Config_Update]", msg);
    else console.log("[SUP_Config_Update]", msg);
  }

  /**
   * @param {HTMLInputElement} originInput
   * @param {HTMLInputElement} prefixInput
   * @param {HTMLInputElement} refererInput
   */
  function applyAutoEnv(originInput, prefixInput, refererInput) {
    const env = detectEnvFromLocation();
    if (!env) {
      panelLog("Не удалось определить ufs-config-manager на вкладке — задайте origin вручную", "warn");
      return;
    }
    originInput.value = env.origin;
    prefixInput.value = env.apiPrefix;
    refererInput.value = env.referer;
    panelLog("Origin auto: " + env.origin);
  }

  /**
   * @param {HTMLInputElement} originInput
   * @param {HTMLInputElement} prefixInput
   * @param {HTMLInputElement} refererInput
   * @returns {{ origin: string; apiPrefix: string; referer: string }}
   */
  function getApiEnv(originInput, prefixInput, refererInput) {
    const origin = (originInput.value || "").trim().replace(/\/+$/, "");
    const apiPrefix = (prefixInput.value || "").trim();
    const referer = (refererInput.value || "").trim();
    if (!origin || !apiPrefix) {
      throw new Error("Укажите origin и API prefix (кнопка «Auto origin» на вкладке UFS Config Manager).");
    }
    return { origin, apiPrefix, referer: referer || origin + "/" };
  }

  /**
   * @param {string} tenant
   * @param {{ origin: string; apiPrefix: string; referer: string }} env
   * @returns {Record<string, string>}
   */
  function buildHeaders(tenant, env) {
    return {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json; charset=UTF-8",
      "cfg-rn": tenant,
      "x-cfga-location": "",
    };
  }

  /**
   * @param {string} pathSuffix
   * @param {string} method
   * @param {unknown} body
   * @param {string} tenant
   * @param {{ origin: string; apiPrefix: string; referer: string }} env
   * @returns {Promise<{ ok: boolean; status: number; data: unknown; text: string }>}
   */
  async function apiRequest(pathSuffix, method, body, tenant, env) {
    const url = env.origin + env.apiPrefix + pathSuffix.replace(/^\//, "");
    const init = {
      method,
      credentials: "include",
      headers: buildHeaders(tenant, env),
      referrer: env.referer,
      mode: "cors",
    };
    if (body !== undefined && method !== "GET") {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_e) {
      data = { _raw: text };
    }
    return { ok: res.ok, status: res.status, data, text };
  }

  /**
   * @param {string} tenant
   * @param {{ origin: string; apiPrefix: string; referer: string }} env
   * @returns {Promise<string[]>}
   */
  async function fetchTenantCodes(tenant, env) {
    const res = await apiRequest("tenantCodes", "GET", undefined, tenant, env);
    if (!res.ok) throw new Error("tenantCodes HTTP " + res.status);
    const d = res.data;
    if (d && d.success && Array.isArray(d.body)) return d.body.map(String);
    if (Array.isArray(d)) return d.map(String);
    throw new Error("tenantCodes: неожиданный формат ответа");
  }

  /**
   * @param {string} name
   * @param {string} tenant
   * @param {{ origin: string; apiPrefix: string; referer: string }} env
   * @returns {Promise<number>}
   */
  async function resolveParameterId(name, tenant, env) {
    const key = tenant + "\0" + name;
    if (parameterIdCache.has(key)) return parameterIdCache.get(key);
    const payload = {
      page: { pageNumber: 0, pageSize: 20, sort: [] },
      filter: { name, roles: [], tenantCodes: [tenant], scopes: [] },
    };
    const res = await apiRequest("parameter/list", "POST", payload, tenant, env);
    if (!res.ok) throw new Error("parameter/list HTTP " + res.status);
    const body = res.data && res.data.body;
    const params = body && body.parameters;
    if (!Array.isArray(params) || params.length === 0) {
      throw new Error("parameter/list: параметр не найден: " + name);
    }
    const id = Number(params[0].id);
    if (!Number.isFinite(id)) throw new Error("parameter/list: нет id для " + name);
    parameterIdCache.set(key, id);
    return id;
  }

  /**
   * @param {unknown[]} pathItems
   * @returns {{ code: string; value: string }[]}
   */
  function exportPathToAddPath(pathItems) {
    if (!Array.isArray(pathItems)) return [];
    return pathItems.map((p) => {
      const item = p && typeof p === "object" ? p : {};
      const code = String(item.code || item.name || "").trim();
      return { code, value: String(item.value != null ? item.value : "") };
    });
  }

  /**
   * @param {unknown[]} pathItems
   * @returns {string}
   */
  function formatPathLabel(pathItems) {
    const parts = exportPathToAddPath(pathItems);
    if (parts.length === 0) return "(empty path)";
    return parts.map((p) => p.code + "=" + p.value).join(", ");
  }

  /**
   * @param {string} text
   * @returns {string[]}
   */
  function parseValuesFromText(text) {
    if (!text || typeof text !== "string") return [];
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * @param {unknown} json
   * @returns {{ rows: ImportRow[]; format: string }}
   */
  function parseImportJson(json) {
    /** @typedef {{ key: string; parameterName: string; tenant: string; parameterId: number|null; bundle: { path: object[]; values: string[] }; pathLabel: string; checked: boolean }} ImportRow */
    /** @type {ImportRow[]} */
    const rows = [];

    if (Array.isArray(json)) {
      json.forEach((entry, ei) => {
        const tenant = (entry && entry.key && entry.key.tenant) || "";
        const name = (entry && entry.parameter && entry.parameter.name) || "";
        const bundles = (entry && entry.parameter && entry.parameter.bundles) || [];
        bundles.forEach((b, bi) => {
          rows.push({
            key: "exp-" + ei + "-" + bi,
            parameterName: name,
            tenant: String(tenant),
            parameterId: null,
            bundle: {
              path: exportPathToAddPath(b && b.path),
              values: Array.isArray(b && b.values) ? b.values.slice() : [],
            },
            pathLabel: formatPathLabel(b && b.path),
            checked: true,
          });
        });
      });
      return { rows, format: "EXPORT" };
    }

    if (json && typeof json === "object" && Array.isArray(json.requests)) {
      const meta = json.meta || {};
      const tenant = String(meta.tenant || json.tenant || "");
      json.requests.forEach((req, ri) => {
        const b = req && req.bundle;
        rows.push({
          key: "add-" + ri,
          parameterName: String(meta.parameterName || json.parameterName || ""),
          tenant,
          parameterId: req.parameterId != null ? Number(req.parameterId) : null,
          bundle: {
            path: exportPathToAddPath(b && b.path),
            values: Array.isArray(b && b.values) ? b.values.slice() : [],
          },
          pathLabel: formatPathLabel(b && b.path),
          checked: true,
        });
      });
      return { rows, format: "ADD_READY" };
    }

    if (json && typeof json === "object" && Array.isArray(json.parameters)) {
      const tenant = String(json.tenant || "");
      json.parameters.forEach((p, pi) => {
        (p.bundles || []).forEach((b, bi) => {
          const values = Array.isArray(b.values) ? b.values.slice() : [];
          rows.push({
            key: "job-" + pi + "-" + bi,
            parameterName: String(p.name || ""),
            tenant,
            parameterId: p.parameterId != null ? Number(p.parameterId) : null,
            bundle: {
              path: exportPathToAddPath(b.path),
              values,
            },
            pathLabel: formatPathLabel(b.path) + (b.valuesFile ? " [valuesFile:" + b.valuesFile + "]" : ""),
            checked: true,
            /** @type {string|undefined} */
            valuesFileHint: b.valuesFile ? String(b.valuesFile) : undefined,
          });
        });
      });
      return { rows, format: "JOB" };
    }

    throw new Error("Неизвестный формат JSON (ожидается EXPORT[], ADD_READY или JOB).");
  }

  /**
   * @param {string[]} a
   * @param {string[]} b
   * @returns {{ added: number; removed: number; changed: number }}
   */
  function diffValueArrays(a, b) {
    const setA = new Set(a);
    const setB = new Set(b);
    let added = 0;
    let removed = 0;
    setB.forEach((v) => {
      if (!setA.has(v)) added++;
    });
    setA.forEach((v) => {
      if (!setB.has(v)) removed++;
    });
    let changed = 0;
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      if (a[i] !== b[i] && setA.has(b[i]) === false) changed++;
    }
    return { added, removed, changed };
  }

  /**
   * @param {number} parameterId
   * @param {string} tenant
   * @param {{ origin: string; apiPrefix: string; referer: string }} env
   * @returns {Promise<object|null>}
   */
  async function fetchActiveBundle(parameterId, tenant, env) {
    const payload = {
      filter: { parameterId, withHistory: false, path: [], value: {} },
      page: { pageNumber: 0, pageSize: 5 },
    };
    const res = await apiRequest("parameter/bundle/list", "POST", payload, tenant, env);
    if (!res.ok) throw new Error("bundle/list HTTP " + res.status);
    const bundles = res.data && res.data.body && res.data.body.bundles;
    if (!Array.isArray(bundles) || bundles.length === 0) return null;
    const active = bundles.find((b) => b && b.active) || bundles[0];
    return active;
  }

  /**
   * @param {object|null} bundle
   */
  function renderBundleInfo(bundle) {
    if (!bundleInfoEl) return;
    if (!bundle) {
      bundleInfoEl.textContent = "Bundle info: —";
      return;
    }
    bundleInfoEl.textContent =
      "Bundle: id=" +
      bundle.id +
      "  active=" +
      bundle.active +
      "  createDate=" +
      (bundle.createDate || "—") +
      "  values=" +
      (Array.isArray(bundle.values) ? bundle.values.length : 0);
  }

  /**
   * @param {string} name
   * @param {string} tenant
   * @param {{ origin: string; apiPrefix: string; referer: string }} env
   * @returns {Promise<object[]>}
   */
  async function exportParameterFromServer(name, tenant, env) {
    const payload = { tenantCodes: [tenant], name, scopes: [] };
    const res = await apiRequest("parameter/data/export", "POST", payload, tenant, env);
    if (!res.ok) throw new Error("export HTTP " + res.status);
    if (!res.data || !res.data.success) {
      throw new Error("export success=false: " + JSON.stringify(res.data && res.data.messages));
    }
    const body = res.data.body;
    if (!Array.isArray(body)) throw new Error("export: body не массив");
    return body;
  }

  /**
   * @param {number} parameterId
   * @param {{ path: object[]; values: string[] }} bundle
   * @param {string} tenant
   * @param {{ origin: string; apiPrefix: string; referer: string }} env
   * @param {boolean} dryRun
   * @returns {Promise<unknown>}
   */
  async function postValueAdd(parameterId, bundle, tenant, env, dryRun) {
    const payload = { parameterId, bundle };
    if (dryRun) return { dryRun: true, payload };
    const res = await apiRequest("parameter/value/add", "POST", payload, tenant, env);
    if (!res.ok) throw new Error("value/add HTTP " + res.status + " " + res.text.slice(0, 200));
    if (!res.data || !res.data.success || !(res.data.body && res.data.body.isSuccess)) {
      const msgs = (res.data && res.data.body && res.data.body.messages) || [];
      throw new Error("value/add failed: " + JSON.stringify(msgs));
    }
    return res.data;
  }

  /**
   * @param {string} message
   * @returns {boolean}
   */
  function askContinueOnError(message) {
    return window.confirm(
      "Ошибка при отправке:\n" + message + "\n\nПродолжить очередь с следующего параметра?"
    );
  }

  function mkInput(type, value, width) {
    const el = document.createElement("input");
    el.type = type;
    if (value != null) el.value = value;
    el.style.cssText =
      "font-size:" +
      PANEL_FONT +
      ";background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:3px 6px;" +
      (width ? "width:" + width + ";" : "flex:1;min-width:120px;");
    return el;
  }

  function mkBtn(label, bg) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText =
      "border:1px solid #374151;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:" +
      PANEL_FONT +
      ";background:" +
      (bg || "#1f2937") +
      ";color:#e5e7eb;";
    return b;
  }

  function mkSelect() {
    const s = document.createElement("select");
    s.style.cssText =
      "font-size:" +
      PANEL_FONT +
      ";background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:5px;padding:3px 5px;min-width:180px;";
    return s;
  }

  const existing = document.getElementById(PANEL_ID);
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = [
    "position:fixed",
    "right:12px",
    "bottom:12px",
    "width:" + PANEL_WIDTH,
    "height:" + PANEL_HEIGHT,
    "box-sizing:border-box",
    "display:flex",
    "flex-direction:column",
    "overflow:hidden",
    "z-index:2147483646",
    "background:#111827",
    "color:#e5e7eb",
    "font:" + PANEL_FONT + "/1.35 system-ui,sans-serif",
    "border:1px solid #374151",
    "border-radius:10px",
    "box-shadow:0 10px 30px rgba(0,0,0,.45)",
    "padding:8px 10px",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "СУП — обновление параметров (SUP_Config_Update)";
  title.style.cssText = "font-weight:700;margin-bottom:4px;flex-shrink:0;";
  panel.appendChild(title);

  const envRow = document.createElement("div");
  envRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;flex-shrink:0;";
  const originInput = mkInput("text", detectEnvFromLocation()?.origin || "", "280px");
  originInput.placeholder = "Origin (https://...)";
  const prefixInput = mkInput("text", detectEnvFromLocation()?.apiPrefix || "", "320px");
  prefixInput.placeholder = "API prefix …/pacman/rest/";
  const refererInput = mkInput("text", detectEnvFromLocation()?.referer || "", "280px");
  refererInput.placeholder = "Referer";
  const autoEnvBtn = mkBtn("Auto origin", "#2563eb");
  autoEnvBtn.addEventListener("click", () => applyAutoEnv(originInput, prefixInput, refererInput));
  envRow.appendChild(document.createTextNode("Origin:"));
  envRow.appendChild(originInput);
  envRow.appendChild(autoEnvBtn);
  panel.appendChild(envRow);

  const envRow2 = document.createElement("div");
  envRow2.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;flex-shrink:0;";
  envRow2.appendChild(document.createTextNode("Prefix:"));
  envRow2.appendChild(prefixInput);
  envRow2.appendChild(document.createTextNode("Referer:"));
  envRow2.appendChild(refererInput);
  panel.appendChild(envRow2);

  const tenantRow = document.createElement("div");
  tenantRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:4px;flex-shrink:0;flex-wrap:wrap;";
  const tenantSel = mkSelect();
  const defaultTenant = "EFSNB_GAMIFICATION";
  const tOpt = document.createElement("option");
  tOpt.value = defaultTenant;
  tOpt.textContent = defaultTenant;
  tenantSel.appendChild(tOpt);
  tenantSel.value = defaultTenant;
  const loadTenantsBtn = mkBtn("Загрузить tenantCodes", "#374151");
  tenantRow.appendChild(document.createTextNode("Tenant (cfg-rn):"));
  tenantRow.appendChild(tenantSel);
  tenantRow.appendChild(loadTenantsBtn);
  panel.appendChild(tenantRow);

  const tabsRow = document.createElement("div");
  tabsRow.style.cssText = "display:flex;gap:4px;margin-bottom:4px;flex-shrink:0;flex-wrap:wrap;";
  const tabNames = ["Payload", "Файл export", "Скачать с сервера"];
  const tabBtns = [];
  const tabPanels = [];
  tabNames.forEach((label, i) => {
    const b = mkBtn(label, i === 0 ? "#2563eb" : "#1f2937");
    b.addEventListener("click", () => showTab(i));
    tabBtns.push(b);
    tabsRow.appendChild(b);
  });
  panel.appendChild(tabsRow);

  /**
   * @param {number} idx
   */
  function showTab(idx) {
    tabBtns.forEach((tb, j) => {
      tb.style.background = j === idx ? "#2563eb" : "#1f2937";
    });
    tabPanels.forEach((tp, j) => {
      tp.style.display = j === idx ? "flex" : "none";
    });
  }

  const wrap = document.createElement("div");
  wrap.style.cssText = "flex:1;min-height:0;position:relative;border:1px solid #374151;border-radius:6px;background:#0f172a;";
  panel.appendChild(wrap);

  const tabStyle =
    "position:absolute;inset:0;display:flex;flex-direction:column;gap:4px;padding:6px;overflow:auto;box-sizing:border-box;";

  // --- Tab Payload ---
  const tabPayload = document.createElement("div");
  tabPayload.style.cssText = tabStyle;
  const paramNameInput = mkInput("text", "rmkib.enigma.gamification.badgesimagemapping", "100%");
  paramNameInput.placeholder = "Имя параметра (для lookup id)";
  const paramIdInput = mkInput("number", "", "120px");
  paramIdInput.placeholder = "parameterId";
  const resolveIdBtn = mkBtn("Обновить id", "#374151");
  const payloadTa = document.createElement("textarea");
  payloadTa.placeholder =
    'JSON bundle или полный add: {"parameterId":361251,"bundle":{"path":[{"code":"SUBSYSTEM","value":"KKSB_ENIGMA"}],"values":[]}}';
  payloadTa.style.cssText =
    "flex:1;min-height:120px;font-family:ui-monospace,monospace;font-size:10px;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:6px;resize:vertical;";
  const valuesFileInput = document.createElement("input");
  valuesFileInput.type = "file";
  valuesFileInput.accept = ".txt,text/plain";
  const applyValuesTxtBtn = mkBtn("Values из .txt", "#374151");
  tabPayload.appendChild(paramNameInput);
  const idRow = document.createElement("div");
  idRow.style.cssText = "display:flex;gap:6px;align-items:center;";
  idRow.appendChild(document.createTextNode("parameterId:"));
  idRow.appendChild(paramIdInput);
  idRow.appendChild(resolveIdBtn);
  tabPayload.appendChild(idRow);
  tabPayload.appendChild(payloadTa);
  const vfRow = document.createElement("div");
  vfRow.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;";
  vfRow.appendChild(document.createTextNode("valuesFile:"));
  vfRow.appendChild(valuesFileInput);
  vfRow.appendChild(applyValuesTxtBtn);
  tabPayload.appendChild(vfRow);
  tabPanels.push(tabPayload);
  wrap.appendChild(tabPayload);

  // --- Tab File ---
  const tabFile = document.createElement("div");
  tabFile.style.cssText = tabStyle;
  tabFile.style.display = "none";
  const fileJsonInput = document.createElement("input");
  fileJsonInput.type = "file";
  fileJsonInput.accept = ".json,application/json";
  const fileJsonTa = document.createElement("textarea");
  fileJsonTa.placeholder = "Вставьте JSON export / ADD_READY / JOB…";
  fileJsonTa.style.cssText = payloadTa.style.cssText;
  fileJsonTa.style.minHeight = "80px";
  fileJsonTa.style.flex = "0 0 100px";
  const importListEl = document.createElement("div");
  importListEl.style.cssText = "flex:1;overflow:auto;border:1px solid #374151;border-radius:6px;padding:4px;font-size:10px;";
  /** @type {ReturnType<typeof parseImportJson>["rows"]} */
  let importRows = [];
  const parseFileBtn = mkBtn("Разобрать JSON", "#2563eb");
  tabFile.appendChild(fileJsonInput);
  tabFile.appendChild(fileJsonTa);
  tabFile.appendChild(parseFileBtn);
  tabFile.appendChild(importListEl);
  tabPanels.push(tabFile);
  wrap.appendChild(tabFile);

  // --- Tab Export ---
  const tabExport = document.createElement("div");
  tabExport.style.cssText = tabStyle;
  tabExport.style.display = "none";
  const exportNameInput = mkInput("text", "rmkib.enigma.gamification.badgesimagemapping", "100%");
  const downloadBtn = mkBtn("Скачать с сервера", "#2563eb");
  const downloadJsonBtn = mkBtn("Сохранить JSON", "#374151");
  const exportPreview = document.createElement("textarea");
  exportPreview.style.cssText = payloadTa.style.cssText;
  exportPreview.style.flex = "1";
  exportPreview.readOnly = false;
  tabExport.appendChild(exportNameInput);
  const exBtnRow = document.createElement("div");
  exBtnRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
  exBtnRow.appendChild(downloadBtn);
  exBtnRow.appendChild(downloadJsonBtn);
  tabExport.appendChild(exBtnRow);
  tabExport.appendChild(exportPreview);
  tabPanels.push(tabExport);
  wrap.appendChild(tabExport);

  const controlsRow = document.createElement("div");
  controlsRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px;flex-shrink:0;";
  const pauseInput = mkInput("number", String(DEFAULT_PAUSE_MS), "70px");
  pauseInput.min = "0";
  const dryRunCb = document.createElement("input");
  dryRunCb.type = "checkbox";
  dryRunCb.checked = true;
  const dryRunLbl = document.createElement("label");
  dryRunLbl.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer;";
  dryRunLbl.appendChild(dryRunCb);
  dryRunLbl.appendChild(document.createTextNode("Dry-run (без POST)"));
  const fullReplaceWarn = document.createElement("span");
  fullReplaceWarn.textContent = "⚠ value/add — полная замена всех values";
  fullReplaceWarn.style.cssText = "color:#fbbf24;font-size:10px;";
  controlsRow.appendChild(document.createTextNode("Пауза мс:"));
  controlsRow.appendChild(pauseInput);
  controlsRow.appendChild(dryRunLbl);
  controlsRow.appendChild(fullReplaceWarn);
  panel.appendChild(controlsRow);

  const actionRow = document.createElement("div");
  actionRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;flex-shrink:0;";
  const buildPayloadBtn = mkBtn("Собрать payload", "#374151");
  const compareBtn = mkBtn("Сравнить с сервером", "#374151");
  const sendBtn = mkBtn("Отправить", "#16a34a");
  const rollbackBtn = mkBtn("Откатить из export", "#b45309");
  const stopBtn = mkBtn("Стоп", "#dc2626");
  const copyFetchBtn = mkBtn("Копировать fetch", "#374151");
  const closeBtn = mkBtn("Закрыть", "#374151");
  actionRow.appendChild(buildPayloadBtn);
  actionRow.appendChild(compareBtn);
  actionRow.appendChild(sendBtn);
  actionRow.appendChild(rollbackBtn);
  actionRow.appendChild(stopBtn);
  actionRow.appendChild(copyFetchBtn);
  actionRow.appendChild(closeBtn);
  panel.appendChild(actionRow);

  bundleInfoEl = document.createElement("div");
  bundleInfoEl.style.cssText =
    "margin-top:4px;padding:4px 6px;background:#0b1220;border:1px solid #374151;border-radius:6px;font-size:10px;flex-shrink:0;";
  bundleInfoEl.textContent = "Bundle info: —";
  panel.appendChild(bundleInfoEl);

  logEl = document.createElement("pre");
  logEl.style.cssText =
    "margin-top:4px;flex:0 0 min(140px,18vh);overflow:auto;background:#0b1220;border:1px solid #374151;border-radius:6px;padding:6px;font-size:10px;white-space:pre-wrap;flex-shrink:0;";
  panel.appendChild(logEl);

  document.body.appendChild(panel);
  panelLog("Панель SUP_Config_Update готова. Dry-run включён по умолчанию.");

  loadTenantsBtn.addEventListener("click", async () => {
    try {
      const env = getApiEnv(originInput, prefixInput, refererInput);
      const tenant = tenantSel.value;
      const codes = await fetchTenantCodes(tenant, env);
      const cur = tenantSel.value;
      tenantSel.innerHTML = "";
      codes.forEach((c) => {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = c;
        tenantSel.appendChild(o);
      });
      if (codes.indexOf(cur) >= 0) tenantSel.value = cur;
      panelLog("tenantCodes: " + codes.length + " шт.", "ok");
    } catch (e) {
      panelLog(String(e && e.message ? e.message : e), "err");
    }
  });

  resolveIdBtn.addEventListener("click", async () => {
    try {
      const env = getApiEnv(originInput, prefixInput, refererInput);
      const name = paramNameInput.value.trim();
      if (!name) throw new Error("Укажите имя параметра");
      const id = await resolveParameterId(name, tenantSel.value, env);
      paramIdInput.value = String(id);
      panelLog("parameterId=" + id + " для " + name, "ok");
    } catch (e) {
      panelLog(String(e && e.message ? e.message : e), "err");
    }
  });

  applyValuesTxtBtn.addEventListener("click", () => {
    const f = valuesFileInput.files && valuesFileInput.files[0];
    if (!f) {
      panelLog("Выберите .txt файл values", "warn");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const values = parseValuesFromText(String(reader.result || ""));
      try {
        let obj = JSON.parse(payloadTa.value.trim() || "{}");
        if (obj.bundle) obj.bundle.values = values;
        else obj = { bundle: { path: [{ code: "SUBSYSTEM", value: "KKSB_ENIGMA" }], values } };
        payloadTa.value = JSON.stringify(obj, null, 2);
        panelLog("Подставлено values: " + values.length + " строк", "ok");
      } catch (e) {
        panelLog("Ошибка JSON payload: " + e, "err");
      }
    };
    reader.readAsText(f, "UTF-8");
  });

  function renderImportList() {
    importListEl.innerHTML = "";
    if (importRows.length === 0) {
      importListEl.textContent = "Нет строк — разберите JSON.";
      return;
    }
    importRows.forEach((row) => {
      const line = document.createElement("label");
      line.style.cssText = "display:flex;gap:6px;align-items:flex-start;margin-bottom:3px;cursor:pointer;";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = row.checked;
      cb.addEventListener("change", () => {
        row.checked = cb.checked;
      });
      const txt = document.createElement("span");
      txt.textContent =
        row.parameterName +
        " | " +
        row.tenant +
        " | " +
        row.pathLabel +
        " | values=" +
        row.bundle.values.length;
      line.appendChild(cb);
      line.appendChild(txt);
      importListEl.appendChild(line);
    });
  }

  parseFileBtn.addEventListener("click", () => {
    try {
      const raw = fileJsonTa.value.trim();
      if (!raw) throw new Error("Пустой JSON");
      const json = JSON.parse(raw);
      const parsed = parseImportJson(json);
      importRows = parsed.rows;
      rollbackSnapshot = { entries: Array.isArray(json) ? json : parsed.rows, source: parsed.format };
      renderImportList();
      panelLog("Разобрано " + importRows.length + " bundle (" + parsed.format + ")", "ok");
    } catch (e) {
      panelLog(String(e && e.message ? e.message : e), "err");
    }
  });

  fileJsonInput.addEventListener("change", () => {
    const f = fileJsonInput.files && fileJsonInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      fileJsonTa.value = String(reader.result || "");
      parseFileBtn.click();
    };
    reader.readAsText(f, "UTF-8");
  });

  downloadBtn.addEventListener("click", async () => {
    try {
      const env = getApiEnv(originInput, prefixInput, refererInput);
      const tenant = tenantSel.value;
      const name = exportNameInput.value.trim();
      if (!name) throw new Error("Укажите имя параметра");
      panelLog("export: " + name + "…");
      const body = await exportParameterFromServer(name, tenant, env);
      exportPreview.value = JSON.stringify(body, null, 2);
      rollbackSnapshot = { entries: body, source: "server-export" };
      const parsed = parseImportJson(body);
      importRows = parsed.rows;
      renderImportList();
      paramNameInput.value = name;
      panelLog("export OK, записей: " + body.length, "ok");
    } catch (e) {
      panelLog(String(e && e.message ? e.message : e), "err");
    }
  });

  downloadJsonBtn.addEventListener("click", () => {
    const text = exportPreview.value.trim();
    if (!text) {
      panelLog("Нет данных для сохранения", "warn");
      return;
    }
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "parameters_" + new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  });

  buildPayloadBtn.addEventListener("click", () => {
    try {
      const raw = payloadTa.value.trim();
      if (!raw) throw new Error("Пустой payload");
      const obj = JSON.parse(raw);
      if (obj.bundle && !obj.parameterId) {
        panelLog("Собран bundle, parameterId не задан — используйте «Обновить id»", "warn");
      } else {
        panelLog("Payload JSON валиден", "ok");
      }
    } catch (e) {
      panelLog("JSON ошибка: " + e, "err");
    }
  });

  compareBtn.addEventListener("click", async () => {
    try {
      const env = getApiEnv(originInput, prefixInput, refererInput);
      const tenant = tenantSel.value;
      let parameterId = Number(paramIdInput.value);
      const name = paramNameInput.value.trim();
      if (!Number.isFinite(parameterId) || parameterId <= 0) {
        if (!name) throw new Error("parameterId или имя параметра");
        parameterId = await resolveParameterId(name, tenant, env);
        paramIdInput.value = String(parameterId);
      }
      const obj = JSON.parse(payloadTa.value.trim() || "{}");
      const newValues = (obj.bundle && obj.bundle.values) || obj.values || [];
      if (!Array.isArray(newValues)) throw new Error("Нет массива values в payload");
      const active = await fetchActiveBundle(parameterId, tenant, env);
      renderBundleInfo(active);
      const oldValues = (active && active.values) || [];
      const diff = diffValueArrays(oldValues, newValues);
      panelLog(
        "Diff: было=" +
          oldValues.length +
          " стало=" +
          newValues.length +
          " +=" +
          diff.added +
          " -=" +
          diff.removed +
          " ~=" +
          diff.changed,
        "ok"
      );
    } catch (e) {
      panelLog(String(e && e.message ? e.message : e), "err");
    }
  });

  /**
   * @returns {Promise<{ parameterId: number; parameterName: string; tenant: string; bundle: object }[]>}
   */
  async function collectJobsFromUi() {
    const env = getApiEnv(originInput, prefixInput, refererInput);
    const tenant = tenantSel.value;
    /** @type {{ parameterId: number; parameterName: string; tenant: string; bundle: object }[]} */
    const jobs = [];

    const activeTab = tabPanels.findIndex((p) => p.style.display !== "none");
    if (activeTab === 1 && importRows.length > 0) {
      for (const row of importRows) {
        if (!row.checked) continue;
        const t = row.tenant || tenant;
        let pid = row.parameterId;
        if (!pid || pid <= 0) {
          pid = await resolveParameterId(row.parameterName, t, env);
        }
        jobs.push({
          parameterId: pid,
          parameterName: row.parameterName,
          tenant: t,
          bundle: row.bundle,
        });
      }
      return jobs;
    }

    if (activeTab === 2 && exportPreview.value.trim()) {
      const body = JSON.parse(exportPreview.value.trim());
      const parsed = parseImportJson(body);
      for (const row of parsed.rows) {
        const t = row.tenant || tenant;
        let pid = row.parameterId;
        if (!pid || pid <= 0) {
          pid = await resolveParameterId(row.parameterName, t, env);
        }
        jobs.push({
          parameterId: pid,
          parameterName: row.parameterName,
          tenant: t,
          bundle: row.bundle,
        });
      }
      return jobs;
    }

    const obj = JSON.parse(payloadTa.value.trim() || "{}");
    let bundle = obj.bundle;
    let parameterId = Number(obj.parameterId || paramIdInput.value);
    const parameterName = paramNameInput.value.trim();
    if (!bundle) throw new Error("Нет bundle в payload");
    if (!Number.isFinite(parameterId) || parameterId <= 0) {
      if (!parameterName) throw new Error("parameterId или имя параметра");
      parameterId = await resolveParameterId(parameterName, tenant, env);
      paramIdInput.value = String(parameterId);
    }
    jobs.push({ parameterId, parameterName, tenant, bundle });
    return jobs;
  }

  sendBtn.addEventListener("click", async () => {
    if (runInProgress) {
      panelLog("Уже выполняется", "warn");
      return;
    }
    runInProgress = true;
    stopRequested = false;
    sendBtn.disabled = true;
    const dryRun = dryRunCb.checked;
    let pauseMs = Number(pauseInput.value);
    if (!Number.isFinite(pauseMs) || pauseMs < 0) pauseMs = DEFAULT_PAUSE_MS;
    if (pauseMs > PAUSE_MAX_MS) pauseMs = PAUSE_MAX_MS;

    try {
      const env = getApiEnv(originInput, prefixInput, refererInput);
      const jobs = await collectJobsFromUi();
      if (jobs.length === 0) throw new Error("Нет задач для отправки");

      panelLog((dryRun ? "DRY-RUN " : "") + "Очередь: " + jobs.length + " POST");
      let ok = 0;
      let fail = 0;

      for (let i = 0; i < jobs.length; i++) {
        if (stopRequested) {
          panelLog("Остановлено пользователем", "warn");
          break;
        }
        const job = jobs[i];
        const label = job.parameterName + " id=" + job.parameterId;
        try {
          if (dryRun) {
            const preview = await postValueAdd(job.parameterId, job.bundle, job.tenant, env, true);
            panelLog("DRY " + label + " values=" + job.bundle.values.length + " " + JSON.stringify(preview.payload).slice(0, 120) + "…");
          } else {
            panelLog("POST add " + label + "…");
            await postValueAdd(job.parameterId, job.bundle, job.tenant, env, false);
            const active = await fetchActiveBundle(job.parameterId, job.tenant, env);
            renderBundleInfo(active);
            panelLog("OK " + label, "ok");
          }
          ok++;
        } catch (e) {
          fail++;
          const msg = String(e && e.message ? e.message : e);
          panelLog("FAIL " + label + ": " + msg, "err");
          if (i < jobs.length - 1 && !askContinueOnError(msg)) {
            panelLog("Очередь прервана", "warn");
            break;
          }
        }
        if (i < jobs.length - 1 && !stopRequested) await delay(pauseMs);
      }
      panelLog("Итог: ok=" + ok + " fail=" + fail + (dryRun ? " (dry-run)" : ""), ok > 0 ? "ok" : "warn");
    } catch (e) {
      panelLog(String(e && e.message ? e.message : e), "err");
    } finally {
      runInProgress = false;
      sendBtn.disabled = false;
    }
  });

  rollbackBtn.addEventListener("click", async () => {
    if (!rollbackSnapshot || !rollbackSnapshot.entries) {
      panelLog("Нет сохранённого export для отката (скачайте или загрузите JSON)", "warn");
      return;
    }
    if (!window.confirm("Откат: отправить values из сохранённого export на сервер?\n(полная замена bundle)")) return;
    try {
      const parsed = parseImportJson(rollbackSnapshot.entries);
      importRows = parsed.rows.map((r) => ({ ...r, checked: true }));
      renderImportList();
      showTab(1);
      dryRunCb.checked = false;
      panelLog("Откат: подготовлено " + importRows.length + " bundle — нажмите «Отправить»", "warn");
    } catch (e) {
      panelLog(String(e && e.message ? e.message : e), "err");
    }
  });

  stopBtn.addEventListener("click", () => {
    stopRequested = true;
    panelLog("Запрошена остановка очереди", "warn");
  });

  copyFetchBtn.addEventListener("click", () => {
    try {
      const env = getApiEnv(originInput, prefixInput, refererInput);
      const tenant = tenantSel.value;
      const obj = JSON.parse(payloadTa.value.trim() || "{}");
      const snippet =
        'fetch("' +
        env.origin +
        env.apiPrefix +
        'parameter/value/add", {\n' +
        '  headers: {\n' +
        '    "content-type": "application/json; charset=UTF-8",\n' +
        '    "cfg-rn": "' +
        tenant +
        '",\n' +
        '    "x-cfga-location": ""\n' +
        "  },\n" +
        '  body: ' +
        JSON.stringify(obj) +
        ",\n" +
        '  method: "POST",\n' +
        '  credentials: "include"\n' +
        "});";
      navigator.clipboard.writeText(snippet).then(
        () => panelLog("fetch скопирован в буфер", "ok"),
        () => panelLog(snippet, "info")
      );
    } catch (e) {
      panelLog(String(e && e.message ? e.message : e), "err");
    }
  });

  closeBtn.addEventListener("click", () => {
    panel.remove();
  });
})();
