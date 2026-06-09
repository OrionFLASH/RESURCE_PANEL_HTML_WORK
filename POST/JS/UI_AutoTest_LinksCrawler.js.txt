// =============================================================================
// UI_AutoTest_LinksCrawler.js — многоэтапный рекурсивный краулер ссылок
// =============================================================================
// Сценарий:
// - Этап 1: скан -> выбор ссылок -> запуск -> результат + найденные дочерние ссылки.
// - Этап 2..N: пользователь отмечает найденные на предыдущем этапе ссылки и запускает этап.
// - Для каждого этапа:
//   * переходы выполняются только кликом по ссылке,
//   * пауза после перехода: не менее заданной для этапа,
//   * перед следующим sibling-переходом возврат в родительскую страницу.
// - В конце (по достижению max depth) выводится дерево и статусы.
// =============================================================================

(function () {
  "use strict";

  const PANEL_ID = "ui-links-crawler-panel";
  const LOG_STORAGE_KEY = "__UI_LINKS_CRAWLER_SESSION_LOG__";
  const LOG_STORAGE_MAX_LINES = 800;
  const LOAD_TIMEOUT_MS = 15000;
  const POLL_INTERVAL_MS = 50;
  const ONLY_SAME_ORIGIN = true;
  const MAX_DEPTH_LIMIT = 8;
  const DEFAULT_MAX_LINKS_PER_STAGE = 600;
  const DEFAULT_MAX_CHILDREN_PER_PARENT = 250;
  const DEFAULT_MAX_RENDER_ROWS_STAGE1 = 400;
  const DEFAULT_MAX_RENDER_ROWS_PER_PARENT_GROUP = 180;
  let maxLinksPerStage = DEFAULT_MAX_LINKS_PER_STAGE;
  let maxChildrenPerParent = DEFAULT_MAX_CHILDREN_PER_PARENT;
  let maxRenderRowsStage1 = DEFAULT_MAX_RENDER_ROWS_STAGE1;
  let maxRenderRowsPerParentGroup = DEFAULT_MAX_RENDER_ROWS_PER_PARENT_GROUP;

  /** @typedef {"OK"|"FAIL"|"SKIPPED"|null} CheckStatus */
  /**
   * @typedef {{
   *  key: string;
   *  href: string;
   *  depth: number;
   *  parentKey: string | null;
   *  parentUrl: string;
   *  contextPath: string[];
   *  selected: boolean;
   *  status: CheckStatus;
   *  reason: string;
   *  fromUrl: string;
   *  toUrl: string;
   *  elapsedMs: number;
   * }} LinkNode
   */

  const prevPanel = document.getElementById(PANEL_ID);
  if (prevPanel) prevPanel.remove();
  /** @type {{ stopped: boolean; running: boolean; stop: () => void } | null} */
  const prevController = window.__UI_LINKS_CRAWLER__ || null;
  if (prevController && typeof prevController.stop === "function") prevController.stop();

  const controller = {
    stopped: false,
    running: false,
    stop: function () {
      if (!this.running) {
        appendLog("Остановка между этапами: вывод текущего итога и сброс к этапу 1.");
        appendTreeSummaryToLog({ onlyProblematic: true });
        resetCrawlerStateToStart();
        return;
      }
      this.stopped = true;
      appendLog("Остановка запрошена пользователем. Текущий этап будет прерван.");
    },
  };
  window.__UI_LINKS_CRAWLER__ = controller;

  const rootUrl = window.location.href;
  /** @type {Map<string, LinkNode>} */
  const nodeByKey = new Map();
  /** @type {Map<number, string[]>} */
  const stageKeys = new Map();
  /** @type {Map<string, string[]>} */
  const childrenByParentKey = new Map();
  /** @type {Map<string, { href: string; isNew: boolean }[]>} */
  const discoveredByParentKey = new Map();
  const discoveredHrefGlobal = new Set();
  const textEncoder = new TextEncoder();
  /** @type {FileSystemFileHandle | null} */
  let logFileHandle = null;
  /** @type {"off"|"file"|"session"} */
  let logTransportMode = "off";
  let fileLogWriteChain = Promise.resolve();
  let inMemoryLogLines = [];

  let currentStage = 1;
  let maxDepth = 3;

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function toAbsoluteUrl(href) {
    try {
      return new URL(href, window.location.href).href;
    } catch {
      return null;
    }
  }

  function getPauseMsForDepth(depth) {
    const inp = pauseByDepthInput.get(depth);
    const n = inp ? Number(inp.value) : 500;
    return Number.isFinite(n) && n >= 500 ? Math.floor(n) : 500;
  }

  function shortLink(href) {
    try {
      const u = new URL(href);
      const out = (u.pathname || "/") + (u.search || "") + (u.hash || "");
      return out || "/";
    } catch {
      return href;
    }
  }

  function shortLinkRelativeToParent(href, parentHref) {
    const childShort = shortLink(href);
    if (!parentHref) return childShort;
    try {
      const childUrl = new URL(href);
      const parentUrl = new URL(parentHref);
      if (childUrl.origin !== parentUrl.origin) return childShort;

      const childPath = childUrl.pathname || "/";
      const parentPath = parentUrl.pathname || "/";
      const normalizedParent = parentPath.endsWith("/") ? parentPath : parentPath + "/";
      if (!childPath.startsWith(normalizedParent)) return childShort;

      const relativePath = childPath.slice(normalizedParent.length);
      const relative = (relativePath ? relativePath : "/") + (childUrl.search || "") + (childUrl.hash || "");
      return relative || "/";
    } catch {
      return childShort;
    }
  }

  function nowIsoLike() {
    const d = new Date();
    const pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes()) +
      ":" +
      pad(d.getSeconds())
    );
  }

  function canWriteLogFile() {
    return typeof window.showSaveFilePicker === "function";
  }

  function loadPersistedLogLines() {
    try {
      const raw = sessionStorage.getItem(LOG_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (x) {
        return typeof x === "string";
      });
    } catch {
      return [];
    }
  }

  function persistLogLines() {
    try {
      sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(inMemoryLogLines));
    } catch {
      // Игнорируем ошибки квоты/доступа, чтобы не ломать выполнение.
    }
  }

  function pushPersistentLogLine(line) {
    inMemoryLogLines.push(line);
    if (inMemoryLogLines.length > LOG_STORAGE_MAX_LINES) {
      inMemoryLogLines = inMemoryLogLines.slice(inMemoryLogLines.length - LOG_STORAGE_MAX_LINES);
    }
    persistLogLines();
  }

  function clearPersistentLogLines() {
    inMemoryLogLines = [];
    try {
      sessionStorage.removeItem(LOG_STORAGE_KEY);
    } catch {
      // no-op
    }
  }

  function appendLogToFile(line) {
    if (logTransportMode !== "file" || !logFileHandle) return;
    fileLogWriteChain = fileLogWriteChain
      .then(async function () {
        const file = await logFileHandle.getFile();
        const writable = await logFileHandle.createWritable({ keepExistingData: true });
        await writable.seek(file.size);
        await writable.write(textEncoder.encode(line + "\n"));
        await writable.close();
      })
      .catch(function (e) {
        logTransportMode = "session";
        logToFileCheckbox.checked = true;
        console.warn("[UI_LinksCrawler][LOG_FILE][ERROR]", e);
        console.info("[UI_LinksCrawler][LOG_MODE] sessionStorage");
      });
  }

  async function pickLogFile() {
    if (!canWriteLogFile()) return false;
    try {
      logFileHandle = await window.showSaveFilePicker({
        suggestedName: "links_crawler_" + nowIsoLike().replace(/[: ]/g, "_") + ".log",
        types: [
          {
            description: "Log files",
            accept: { "text/plain": [".log", ".txt"] },
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  function nodeKey(depth, parentKey, href) {
    return String(depth) + "|" + String(parentKey || "root") + "|" + href;
  }

  function collectLinksOnCurrentPage() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const out = [];
    const seen = new Set();
    for (let i = 0; i < anchors.length; i++) {
      const raw = String(anchors[i].getAttribute("href") || "").trim();
      if (!raw) continue;
      const low = raw.toLowerCase();
      if (low === "#" || low.startsWith("javascript:") || low.startsWith("mailto:") || low.startsWith("tel:")) continue;
      const abs = toAbsoluteUrl(raw);
      if (!abs) continue;
      if (ONLY_SAME_ORIGIN) {
        try {
          if (new URL(abs).origin !== window.location.origin) continue;
        } catch {
          continue;
        }
      }
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
    }
    return out;
  }

  function findAnchorByAbsoluteUrl(absUrl) {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    for (let i = 0; i < anchors.length; i++) {
      const raw = String(anchors[i].getAttribute("href") || "").trim();
      const abs = toAbsoluteUrl(raw);
      if (abs === absUrl) return anchors[i];
    }
    return null;
  }

  async function waitPageReadyWithMinDelay(minDelayMs) {
    const startedAt = Date.now();
    let timedOut = false;
    while (document.readyState !== "complete") {
      if (controller.stopped) {
        return { timedOut: false, elapsedMs: Date.now() - startedAt };
      }
      if (Date.now() - startedAt >= LOAD_TIMEOUT_MS) {
        timedOut = true;
        break;
      }
      await delay(POLL_INTERVAL_MS);
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed < minDelayMs) await delay(minDelayMs - elapsed);
    return { timedOut, elapsedMs: Date.now() - startedAt };
  }

  async function ensureBackToUrl(targetUrl, minDelayMs) {
    if (window.location.href === targetUrl) return true;
    const startedAt = Date.now();
    while (window.location.href !== targetUrl) {
      if (controller.stopped) return false;
      if (Date.now() - startedAt > LOAD_TIMEOUT_MS) return false;
      history.back();
      await waitPageReadyWithMinDelay(minDelayMs);
    }
    return true;
  }

  async function openContextPath(path, minDelayMs) {
    // Для этапа 1 (пустой контекст) не делаем history.back():
    // иначе можно уйти на предыдущую страницу из истории браузера.
    if (!path || path.length === 0) {
      return { ok: true, reason: "" };
    }
    const atRoot = await ensureBackToUrl(rootUrl, minDelayMs);
    if (!atRoot) return { ok: false, reason: "Не удалось вернуться на root перед восстановлением контекста" };
    for (let i = 0; i < path.length; i++) {
      if (controller.stopped) return { ok: false, reason: "Остановлено пользователем" };
      const href = path[i];
      const a = findAnchorByAbsoluteUrl(href);
      if (!a) {
        return { ok: false, reason: "Не найден элемент пути контекста: " + href };
      }
      a.click();
      const wr = await waitPageReadyWithMinDelay(minDelayMs);
      if (wr.timedOut) return { ok: false, reason: "Таймаут загрузки при восстановлении контекста: " + href };
    }
    return { ok: true, reason: "" };
  }

  // --- UI ---
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;gap:8px;padding:12px;background:#111827;color:#e5e7eb;font:14px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;height:100vh;overflow:auto;";
  const expandedPanelCss = panel.style.cssText;
  const compactPanelCss =
    "position:fixed;right:16px;top:16px;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:10px;background:#111827;border:1px solid #374151;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,.4);font:14px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;";
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  const top = document.createElement("div");
  top.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
  panel.appendChild(top);

  const title = document.createElement("div");
  title.textContent = "UI Links Crawler (Рекурсивный)";
  title.style.cssText = "font-weight:700;font-size:16px;color:#f9fafb;";
  top.appendChild(title);

  function mkBtn(text, bg) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.style.cssText = "border:1px solid #374151;border-radius:6px;padding:7px 12px;cursor:pointer;background:" + bg + ";color:#f9fafb;font-size:14px;font-weight:600;";
    return b;
  }

  const cfg = document.createElement("div");
  cfg.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
  panel.appendChild(cfg);

  const depthLabel = document.createElement("span");
  depthLabel.textContent = "Макс. вложенность этапов:";
  const depthInput = document.createElement("input");
  depthInput.type = "number";
  depthInput.min = "1";
  depthInput.max = String(MAX_DEPTH_LIMIT);
  depthInput.step = "1";
  depthInput.value = String(maxDepth);
  depthInput.style.cssText = "width:64px;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:4px;";
  cfg.appendChild(depthLabel);
  cfg.appendChild(depthInput);

  const pauseWrap = document.createElement("div");
  pauseWrap.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;";
  cfg.appendChild(pauseWrap);
  /** @type {Map<number, HTMLInputElement>} */
  const pauseByDepthInput = new Map();

  function renderPauseInputs() {
    pauseWrap.textContent = "";
    pauseByDepthInput.clear();
    for (let d = 1; d <= maxDepth; d++) {
      const lbl = document.createElement("span");
      lbl.textContent = "Пауза этап " + d + " (мс):";
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = "500";
      inp.step = "100";
      inp.value = "500";
      inp.style.cssText = "width:76px;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:4px;";
      pauseWrap.appendChild(lbl);
      pauseWrap.appendChild(inp);
      pauseByDepthInput.set(d, inp);
    }
  }
  renderPauseInputs();

  const limitsWrap = document.createElement("div");
  limitsWrap.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
  cfg.appendChild(limitsWrap);

  function mkLimitInput(labelText, value, min, max, widthPx) {
    const lbl = document.createElement("span");
    lbl.textContent = labelText;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = "1";
    inp.value = String(value);
    inp.style.cssText =
      "width:" + widthPx + "px;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:4px;";
    limitsWrap.appendChild(lbl);
    limitsWrap.appendChild(inp);
    return inp;
  }

  const maxLinksPerStageInput = mkLimitInput("Лимит ссылок/этап:", maxLinksPerStage, 50, 10000, 78);
  const maxChildrenPerParentInput = mkLimitInput("Лимит детей/родитель:", maxChildrenPerParent, 20, 5000, 78);
  const maxRenderRowsStage1Input = mkLimitInput("Рендер этап 1:", maxRenderRowsStage1, 50, 5000, 70);
  const maxRenderRowsPerParentGroupInput = mkLimitInput("Рендер группа:", maxRenderRowsPerParentGroup, 20, 2000, 70);
  const resetLimitsBtn = mkBtn("↺ Сброс лимитов", "#1f2937");
  limitsWrap.appendChild(resetLimitsBtn);

  function rebuildLimitsFromInput() {
    const stageN = Number(maxLinksPerStageInput.value);
    maxLinksPerStage = Number.isFinite(stageN) ? Math.max(50, Math.min(10000, Math.floor(stageN))) : DEFAULT_MAX_LINKS_PER_STAGE;
    maxLinksPerStageInput.value = String(maxLinksPerStage);

    const childN = Number(maxChildrenPerParentInput.value);
    maxChildrenPerParent = Number.isFinite(childN)
      ? Math.max(20, Math.min(5000, Math.floor(childN)))
      : DEFAULT_MAX_CHILDREN_PER_PARENT;
    maxChildrenPerParentInput.value = String(maxChildrenPerParent);

    const renderStage1N = Number(maxRenderRowsStage1Input.value);
    maxRenderRowsStage1 = Number.isFinite(renderStage1N)
      ? Math.max(50, Math.min(5000, Math.floor(renderStage1N)))
      : DEFAULT_MAX_RENDER_ROWS_STAGE1;
    maxRenderRowsStage1Input.value = String(maxRenderRowsStage1);

    const renderGroupN = Number(maxRenderRowsPerParentGroupInput.value);
    maxRenderRowsPerParentGroup = Number.isFinite(renderGroupN)
      ? Math.max(20, Math.min(2000, Math.floor(renderGroupN)))
      : DEFAULT_MAX_RENDER_ROWS_PER_PARENT_GROUP;
    maxRenderRowsPerParentGroupInput.value = String(maxRenderRowsPerParentGroup);
  }

  function resetLimitsToDefault() {
    maxLinksPerStageInput.value = String(DEFAULT_MAX_LINKS_PER_STAGE);
    maxChildrenPerParentInput.value = String(DEFAULT_MAX_CHILDREN_PER_PARENT);
    maxRenderRowsStage1Input.value = String(DEFAULT_MAX_RENDER_ROWS_STAGE1);
    maxRenderRowsPerParentGroupInput.value = String(DEFAULT_MAX_RENDER_ROWS_PER_PARENT_GROUP);
    rebuildLimitsFromInput();
    renderStageLinks();
    appendLog("Лимиты сброшены к значениям по умолчанию.");
  }

  const logFileWrap = document.createElement("div");
  logFileWrap.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
  cfg.appendChild(logFileWrap);
  const logToFileLabel = document.createElement("label");
  logToFileLabel.style.cssText = "display:flex;gap:6px;align-items:center;";
  const logToFileCheckbox = document.createElement("input");
  logToFileCheckbox.type = "checkbox";
  const logToFileText = document.createElement("span");
  logToFileText.textContent = "Лог в файл (онлайн)";
  logToFileLabel.appendChild(logToFileCheckbox);
  logToFileLabel.appendChild(logToFileText);
  const chooseLogFileBtn = mkBtn("📄 Файл лога…", "#1f2937");
  logFileWrap.appendChild(logToFileLabel);
  logFileWrap.appendChild(chooseLogFileBtn);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;";
  panel.appendChild(actions);
  const scanBtn = mkBtn("🔎 Скан этапа", "#1f2937");
  const runBtn = mkBtn("▶ Запуск этапа", "#2563eb");
  const stopBtn = mkBtn("⏹ Остановить этап", "#991b1b");
  const checkAllBtn = mkBtn("☑ Выбрать все", "#1f2937");
  const uncheckAllBtn = mkBtn("☐ Снять все", "#1f2937");
  const closeBtn = mkBtn("✖ Закрыть", "#374151");
  actions.appendChild(scanBtn);
  actions.appendChild(runBtn);
  actions.appendChild(stopBtn);
  actions.appendChild(checkAllBtn);
  actions.appendChild(uncheckAllBtn);
  actions.appendChild(closeBtn);

  const info = document.createElement("div");
  info.style.cssText = "color:#93c5fd;";
  panel.appendChild(info);

  const main = document.createElement("div");
  main.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;min-height:0;flex:1 1 auto;overflow:auto;align-content:start;";
  panel.appendChild(main);

  const linksPane = document.createElement("div");
  linksPane.style.cssText = "display:flex;flex-direction:column;min-height:0;gap:6px;";
  main.appendChild(linksPane);

  const linksTitle = document.createElement("div");
  linksTitle.textContent = "Найдено ссылок (текущий этап)";
  linksTitle.style.cssText = "font-weight:600;";
  linksPane.appendChild(linksTitle);
  const linksBox = document.createElement("div");
  linksBox.style.cssText =
    "border:1px solid #374151;border-radius:8px;background:#0b1220;padding:8px;overflow:auto;min-height:0;flex:1 1 auto;max-height:100%;display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:6px;align-content:start;";
  linksPane.appendChild(linksBox);

  const relPane = document.createElement("div");
  relPane.style.cssText = "display:flex;flex-direction:column;min-height:0;gap:6px;";
  main.appendChild(relPane);
  const relTitle = document.createElement("div");
  relTitle.textContent = "Родительская ссылка -> найденные под ней";
  relTitle.style.cssText = "font-weight:600;";
  relPane.appendChild(relTitle);
  const relBox = document.createElement("div");
  relBox.style.cssText = "border:1px solid #374151;border-radius:8px;background:#0b1220;padding:6px;overflow:auto;min-height:0;flex:1 1 auto;max-height:100%;";
  relPane.appendChild(relBox);

  const emergencyStopBtn = document.createElement("button");
  emergencyStopBtn.type = "button";
  emergencyStopBtn.textContent = "🆘 Аварийный стоп (дубль)";
  emergencyStopBtn.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;border:1px solid #7f1d1d;border-radius:8px;padding:10px 14px;cursor:pointer;background:#b91c1c;color:#fff;font-size:13px;font-weight:700;display:none;";

  /** @type {Map<string, HTMLInputElement>} */
  const stageCheckboxByKey = new Map();

  function appendLog(msg) {
    const line = "[" + new Date().toLocaleTimeString() + "] " + msg;
    pushPersistentLogLine(line);
    console.log("[UI_LinksCrawler]", line);
    appendLogToFile(nowIsoLike() + " " + msg);
  }

  function setPanelCompactMode(enabled) {
    if (enabled) {
      panel.style.cssText = compactPanelCss;
      top.style.display = "none";
      cfg.style.display = "none";
      actions.style.display = "none";
      info.style.display = "none";
      main.style.display = "none";
      stopBtn.style.display = "";
      stopBtn.disabled = false;
      panel.appendChild(stopBtn);
      return;
    }
    panel.style.cssText = expandedPanelCss;
    top.style.display = "";
    cfg.style.display = "";
    actions.style.display = "";
    info.style.display = "";
    main.style.display = "";
    stopBtn.style.display = "";
    actions.insertBefore(stopBtn, checkAllBtn);
  }

  function statusDot(st) {
    return st === "OK" ? "🟢" : st === "FAIL" ? "🔴" : st === "SKIPPED" ? "🟡" : "⚪";
  }

  function updateInfo() {
    const keys = stageKeys.get(currentStage) || [];
    info.textContent =
      "Этап " +
      currentStage +
      " из " +
      maxDepth +
      ". Ссылок этапа: " +
      keys.length +
      ". " +
      "Статусы: ⚪/🟢/🔴/🟡.";
  }

  function renderStageLinks() {
    linksBox.textContent = "";
    stageCheckboxByKey.clear();
    const keys = stageKeys.get(currentStage) || [];
    if (keys.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "Для текущего этапа ссылок нет. Выполните скан/предыдущий этап.";
      empty.style.color = "#9ca3af";
      linksBox.appendChild(empty);
      updateInfo();
      return;
    }
    function renderNodeRow(node, indentPx) {
      const row = document.createElement("label");
      row.style.cssText =
        "display:grid;grid-template-columns:18px 16px minmax(0,1fr);column-gap:8px;align-items:start;padding:4px 6px;border-radius:6px;background:#0f172a;";
      if (indentPx > 0) row.style.marginLeft = indentPx + "px";
      const dot = document.createElement("span");
      dot.textContent = statusDot(node.status);
      dot.style.cssText = "width:18px;display:inline-flex;justify-content:center;";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!node.selected;
      cb.style.marginTop = "2px";
      cb.addEventListener("change", function () {
        node.selected = cb.checked;
      });
      const txt = document.createElement("div");
      txt.style.cssText = "word-break:break-all;font-size:15px;";
      txt.textContent = shortLink(node.href);
      row.appendChild(dot);
      row.appendChild(cb);
      row.appendChild(txt);
      linksBox.appendChild(row);
      stageCheckboxByKey.set(node.key, cb);
    }

    if (currentStage === 1) {
      const renderCount = Math.min(keys.length, maxRenderRowsStage1);
      for (let i = 0; i < renderCount; i++) {
        const node = nodeByKey.get(keys[i]);
        if (!node) continue;
        renderNodeRow(node, 0);
      }
      if (keys.length > renderCount) {
        const note = document.createElement("div");
        note.textContent =
          "Показано " + renderCount + " из " + keys.length + " ссылок этапа (ограничение UI).";
        note.style.cssText = "grid-column:1 / -1;color:#fbbf24;padding:4px 6px;";
        linksBox.appendChild(note);
      }
    } else {
      /** @type {Map<string, string[]>} */
      const groupsByParent = new Map();
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const node = nodeByKey.get(key);
        if (!node) continue;
        const parentKey = node.parentKey || "root";
        if (!groupsByParent.has(parentKey)) groupsByParent.set(parentKey, []);
        groupsByParent.get(parentKey).push(key);
      }
      groupsByParent.forEach(function (childKeys, parentKey) {
        const group = document.createElement("div");
        group.style.cssText = "border:1px solid #1f2937;border-radius:8px;padding:6px;background:#0b1220;";
        const parentNode = parentKey === "root" ? null : nodeByKey.get(parentKey);
        const headRow = document.createElement("label");
        headRow.style.cssText =
          "display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:8px;align-items:start;margin-bottom:6px;font-weight:600;color:#93c5fd;word-break:break-all;";
        const parentCb = document.createElement("input");
        parentCb.type = "checkbox";
        parentCb.style.marginTop = "2px";
        const head = document.createElement("div");
        head.textContent = "Родитель: " + shortLink(parentNode ? parentNode.href : rootUrl);
        headRow.appendChild(parentCb);
        headRow.appendChild(head);
        group.appendChild(headRow);
        linksBox.appendChild(group);

        /** @type {HTMLInputElement[]} */
        const childCbs = [];
        function syncParentCheckbox() {
          if (childCbs.length === 0) {
            parentCb.checked = false;
            parentCb.indeterminate = false;
            return;
          }
          let selectedCount = 0;
          for (let i = 0; i < childKeys.length; i++) {
            const node = nodeByKey.get(childKeys[i]);
            if (node && node.selected) selectedCount++;
          }
          parentCb.checked = selectedCount === childCbs.length;
          parentCb.indeterminate = selectedCount > 0 && selectedCount < childCbs.length;
        }

        parentCb.addEventListener("change", function () {
          const checked = parentCb.checked;
          for (let i = 0; i < childKeys.length; i++) {
            const node = nodeByKey.get(childKeys[i]);
            if (node) node.selected = checked;
          }
          for (let i = 0; i < childCbs.length; i++) childCbs[i].checked = checked;
          parentCb.indeterminate = false;
        });
        const renderChildCount = Math.min(childKeys.length, maxRenderRowsPerParentGroup);
        for (let i = 0; i < renderChildCount; i++) {
          const childNode = nodeByKey.get(childKeys[i]);
          if (!childNode) continue;
          const row = document.createElement("label");
          row.style.cssText =
            "display:grid;grid-template-columns:18px 16px minmax(0,1fr);column-gap:8px;align-items:start;padding:4px 6px;border-radius:6px;background:#0f172a;margin-bottom:4px;";
          const dot = document.createElement("span");
          dot.textContent = statusDot(childNode.status);
          dot.style.cssText = "width:18px;display:inline-flex;justify-content:center;";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !!childNode.selected;
          cb.style.marginTop = "2px";
          cb.addEventListener("change", function () {
            childNode.selected = cb.checked;
            syncParentCheckbox();
          });
          const txt = document.createElement("div");
          txt.style.cssText = "word-break:break-all;font-size:15px;";
          txt.textContent = shortLinkRelativeToParent(childNode.href, parentNode ? parentNode.href : rootUrl);
          row.appendChild(dot);
          row.appendChild(cb);
          row.appendChild(txt);
          group.appendChild(row);
          stageCheckboxByKey.set(childNode.key, cb);
          childCbs.push(cb);
        }
        if (childKeys.length > renderChildCount) {
          const note = document.createElement("div");
          note.textContent =
            "Показано " + renderChildCount + " из " + childKeys.length + " дочерних ссылок (ограничение UI).";
          note.style.cssText = "color:#fbbf24;padding:2px 4px;";
          group.appendChild(note);
        }
        syncParentCheckbox();
      });
    }
    updateInfo();
  }

  function renderRelations() {
    relBox.textContent = "";
    if (discoveredByParentKey.size === 0) {
      const empty = document.createElement("div");
      empty.textContent = "Пока нет данных о дочерних ссылках.";
      empty.style.color = "#9ca3af";
      relBox.appendChild(empty);
      return;
    }
    discoveredByParentKey.forEach(function (children, parentKey) {
      const parentNode = parentKey === "root" ? null : nodeByKey.get(parentKey);
      const group = document.createElement("div");
      group.style.cssText = "padding:6px;border:1px solid #1f2937;border-radius:6px;margin-bottom:6px;";
      const head = document.createElement("div");
      const headStatus = parentNode ? statusDot(parentNode.status) + " " : "⚪ ";
      head.textContent = headStatus + (parentNode ? shortLink(parentNode.href) : "ROOT: " + shortLink(rootUrl));
      head.style.cssText = "font-weight:600;color:#93c5fd;word-break:break-all;";
      group.appendChild(head);
      if (!children || children.length === 0) {
        const no = document.createElement("div");
        no.textContent = "  (дочерние ссылки не найдены)";
        no.style.color = "#9ca3af";
        group.appendChild(no);
      } else {
        for (let i = 0; i < children.length; i++) {
          const c = children[i];
          const childNodeKey = nodeKey((parentNode ? parentNode.depth : 0) + 1, parentKey === "root" ? null : parentKey, c.href);
          const childNode = nodeByKey.get(childNodeKey);
          const dot = childNode ? statusDot(childNode.status) : "⚪";
          const row = document.createElement("div");
          row.textContent =
            "  " +
            dot +
            " " +
            shortLinkRelativeToParent(c.href, parentNode ? parentNode.href : rootUrl) +
            (c.isNew ? "" : " (уже было раньше)");
          row.style.cssText = "word-break:break-all;color:#e5e7eb;";
          group.appendChild(row);
        }
      }
      relBox.appendChild(group);
    });
  }

  function rebuildFromDepthInput() {
    const n = Number(depthInput.value);
    maxDepth = Number.isFinite(n) ? Math.max(1, Math.min(MAX_DEPTH_LIMIT, Math.floor(n))) : 3;
    depthInput.value = String(maxDepth);
    renderPauseInputs();
    if (currentStage > maxDepth) currentStage = maxDepth;
    renderStageLinks();
  }

  function setUiBusy(v) {
    setPanelCompactMode(v);
    scanBtn.disabled = v;
    runBtn.disabled = v;
    checkAllBtn.disabled = v;
    uncheckAllBtn.disabled = v;
    depthInput.disabled = v;
    maxLinksPerStageInput.disabled = v;
    maxChildrenPerParentInput.disabled = v;
    maxRenderRowsStage1Input.disabled = v;
    maxRenderRowsPerParentGroupInput.disabled = v;
    resetLimitsBtn.disabled = v;
    pauseByDepthInput.forEach(function (inp) {
      inp.disabled = v;
    });
    stopBtn.disabled = false;
    for (const cb of stageCheckboxByKey.values()) cb.disabled = v;
    emergencyStopBtn.style.display = v ? "" : "none";
  }

  function addStageNode(depth, parentKey, parentUrl, contextPath, href, selected) {
    if (!stageKeys.has(depth)) stageKeys.set(depth, []);
    const stageList = stageKeys.get(depth);
    if (stageList.length >= maxLinksPerStage) {
      return null;
    }
    const key = nodeKey(depth, parentKey, href);
    if (nodeByKey.has(key)) return key;
    const node = {
      key,
      href,
      depth,
      parentKey,
      parentUrl,
      contextPath: contextPath.slice(),
      selected: !!selected,
      status: null,
      reason: "",
      fromUrl: "",
      toUrl: "",
      elapsedMs: 0,
    };
    nodeByKey.set(key, node);
    stageList.push(key);
    return key;
  }

  function stageScanCurrentPage() {
    if (currentStage !== 1) {
      appendLog("Скан вручную доступен для этапа 1. Для следующих этапов ссылки собираются на предыдущем запуске.");
      renderStageLinks();
      return;
    }
    const links = collectLinksOnCurrentPage();
    stageKeys.set(1, []);
    let skippedByStageLimit = 0;
    for (let i = 0; i < links.length; i++) {
      const href = links[i];
      const addedKey = addStageNode(1, null, rootUrl, [], href, true);
      if (!addedKey) {
        skippedByStageLimit++;
        continue;
      }
      discoveredHrefGlobal.add(href);
    }
    appendLog(
      "Этап 1: сканирование завершено. Найдено ссылок: " +
        links.length +
        ", добавлено в этап: " +
        (stageKeys.get(1) || []).length +
        (skippedByStageLimit > 0 ? ", пропущено по лимиту этапа: " + skippedByStageLimit : "") +
        ".",
    );
    renderStageLinks();
    renderRelations();
  }

  function resetCrawlerStateToStart() {
    controller.running = false;
    controller.stopped = false;
    currentStage = 1;
    nodeByKey.clear();
    stageKeys.clear();
    childrenByParentKey.clear();
    discoveredByParentKey.clear();
    discoveredHrefGlobal.clear();
    setUiBusy(false);
    renderStageLinks();
    renderRelations();
    updateInfo();
    appendLog("Состояние краулера сброшено. Готово к новому запуску с этапа 1.");
  }

  async function runStage() {
    if (controller.running) return;
    const keys = stageKeys.get(currentStage) || [];
    if (keys.length === 0) {
      appendLog("Этап " + currentStage + ": нет ссылок для запуска.");
      return;
    }
    const selectedKeys = keys.filter(function (k) {
      const n = nodeByKey.get(k);
      return n && n.selected;
    });
    if (selectedKeys.length === 0) {
      appendLog("Этап " + currentStage + ": нет отмеченных ссылок.");
      return;
    }
    controller.stopped = false;
    controller.running = true;
    setUiBusy(true);

    const pauseMs = getPauseMsForDepth(currentStage);
    appendLog("Этап " + currentStage + ": запуск. Отмечено " + selectedKeys.length + " ссылок. Пауза=" + pauseMs + " мс.");

    // Группируем выполнение по родителю:
    // внутри группы возвращаемся только на страницу родителя (-1),
    // а полный подъём по контексту делаем только при переходе к другому родителю.
    selectedKeys.sort(function (a, b) {
      const na = nodeByKey.get(a);
      const nb = nodeByKey.get(b);
      const pa = na ? String(na.parentKey || "root") : "root";
      const pb = nb ? String(nb.parentKey || "root") : "root";
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      return 0;
    });

    let activeParentKey = null;

    for (let i = 0; i < selectedKeys.length; i++) {
      if (controller.stopped) break;
      const key = selectedKeys[i];
      const node = nodeByKey.get(key);
      if (!node) continue;
      const startedAt = Date.now();

      if (activeParentKey !== node.parentKey) {
        const ctx = await openContextPath(node.contextPath, pauseMs);
        if (!ctx.ok) {
          node.status = "FAIL";
          node.reason = ctx.reason;
          node.elapsedMs = Date.now() - startedAt;
          appendLog("НЕ OK: " + node.href + " | " + node.reason);
          console.warn("[UI_LinksCrawler][НЕ OK]", node.href, "|", node.reason);
          continue;
        }
        activeParentKey = node.parentKey;
      }
      const parentUrlNow = window.location.href;
      const a = findAnchorByAbsoluteUrl(node.href);
      if (!a) {
        node.status = "FAIL";
        node.reason = "Ссылка отсутствует на родительской странице";
        node.elapsedMs = Date.now() - startedAt;
        appendLog("НЕ OK: " + node.href + " | " + node.reason);
        console.warn("[UI_LinksCrawler][НЕ OK]", node.href, "|", node.reason);
        continue;
      }
      node.fromUrl = window.location.href;
      appendLog("Запуск: переход по " + node.href);
      try {
        a.click();
        const wr = await waitPageReadyWithMinDelay(pauseMs);
        node.toUrl = window.location.href;
        if (wr.timedOut) {
          node.status = "FAIL";
          node.reason = "Таймаут загрузки после клика";
          appendLog("НЕ OK: " + node.href + " | " + node.reason);
          console.warn("[UI_LinksCrawler][НЕ OK]", node.href, "|", node.reason);
        } else {
          node.status = "OK";
          node.reason = "";
          appendLog("OK: " + node.href + " -> " + node.toUrl);
        }
      } catch (e) {
        node.status = "FAIL";
        node.reason = "Исключение при клике: " + (e && e.message ? e.message : String(e));
        appendLog("НЕ OK: " + node.href + " | " + node.reason);
        console.warn("[UI_LinksCrawler][НЕ OK]", node.href, "|", node.reason);
      }
      node.elapsedMs = Date.now() - startedAt;

      // Рекурсивный сбор дочерних ссылок для следующего этапа.
      if (currentStage < maxDepth && node.status === "OK") {
        const childLinks = collectLinksOnCurrentPage();
        const parentNodeKey = node.key;
        const rel = [];
        const maxChildrenToCollect = Math.min(childLinks.length, maxChildrenPerParent);
        for (let c = 0; c < maxChildrenToCollect; c++) {
          const ch = childLinks[c];
          const isNew = !discoveredHrefGlobal.has(ch);
          rel.push({ href: ch, isNew: isNew });
          if (isNew) {
            const childPath = node.contextPath.concat([node.href]);
            const addedChildKey = addStageNode(currentStage + 1, parentNodeKey, node.toUrl || parentUrlNow, childPath, ch, true);
            if (addedChildKey) {
              discoveredHrefGlobal.add(ch);
            }
          }
        }
        if (childLinks.length > maxChildrenToCollect) {
          appendLog(
            "Ограничение дочерних ссылок: у родителя " +
              shortLink(node.href) +
              " обработано " +
              maxChildrenToCollect +
              " из " +
              childLinks.length +
              ".",
          );
        }
        discoveredByParentKey.set(parentNodeKey, rel);
      }

      // Возврат к родительской странице для следующей ссылки в том же контексте.
      const backOk = await ensureBackToUrl(parentUrlNow, pauseMs);
      if (!backOk) {
        appendLog("НЕ OK: не удалось вернуться на родительскую страницу после " + node.href + ".");
      }
    }

    // Все неотмеченные на этапе считаем SKIPPED для визуальной сводки.
    for (let i = 0; i < keys.length; i++) {
      const n = nodeByKey.get(keys[i]);
      if (!n) continue;
      if (!n.selected && n.status === null) n.status = "SKIPPED";
    }

    controller.running = false;
    setUiBusy(false);
    if (controller.stopped) {
      appendLog("Этап " + currentStage + " прерван пользователем. Текущий итог по проблемным ссылкам:");
      renderStageLinks();
      renderRelations();
      appendTreeSummaryToLog({ onlyProblematic: true });
      return;
    }

    // Переход к следующему этапу.
    if (currentStage < maxDepth) {
      const nextKeys = stageKeys.get(currentStage + 1) || [];
      appendLog(
        "Этап " +
          currentStage +
          " завершён. Для этапа " +
          (currentStage + 1) +
          " найдено новых ссылок: " +
          nextKeys.length +
          ".",
      );
      currentStage = currentStage + 1;
    } else {
      appendLog("Достигнута максимальная вложенность этапов: " + maxDepth + ".");
    }

    renderStageLinks();
    renderRelations();
    appendTreeSummaryToLog();
  }

  function appendTreeSummaryToLog(options) {
    const onlyProblematic = !!(options && options.onlyProblematic);
    appendLog(
      onlyProblematic
        ? "Итоговое дерево проблемных ссылок (состояние на текущий момент):"
        : "Итоговое дерево (состояние на текущий момент):",
    );

    function isProblematicNode(node) {
      if (!node) return false;
      return node.status === "FAIL" || node.status === "SKIPPED" || !!node.reason;
    }

    function branchHasProblem(parentKey) {
      const kids = childrenByParentKey.get(parentKey) || [];
      for (let i = 0; i < kids.length; i++) {
        const n = nodeByKey.get(kids[i]);
        if (!n) continue;
        if (isProblematicNode(n)) return true;
        if (branchHasProblem(n.key)) return true;
      }
      return false;
    }

    function walk(parentKey, indent) {
      const kids = childrenByParentKey.get(parentKey) || [];
      for (let i = 0; i < kids.length; i++) {
        const n = nodeByKey.get(kids[i]);
        if (!n) continue;

        if (onlyProblematic) {
          const selfProblem = isProblematicNode(n);
          const childProblem = branchHasProblem(n.key);
          if (!selfProblem && !childProblem) continue;
        }

        appendLog(indent + statusDot(n.status) + " " + n.href + (n.reason ? " | " + n.reason : ""));
        walk(n.key, indent + "  ");
      }
    }
    // rebuild children map
    childrenByParentKey.clear();
    nodeByKey.forEach(function (n) {
      const pk = n.parentKey || "root";
      if (!childrenByParentKey.has(pk)) childrenByParentKey.set(pk, []);
      childrenByParentKey.get(pk).push(n.key);
    });
    if (onlyProblematic && !branchHasProblem("root")) {
      appendLog("ROOT: " + rootUrl);
      appendLog("  ⚪ Проблемные ссылки не обнаружены среди пройденных этапов.");
      return;
    }

    appendLog("ROOT: " + rootUrl);
    walk("root", "  ");
  }

  scanBtn.addEventListener("click", function () {
    if (controller.running) return;
    stageScanCurrentPage();
  });

  runBtn.addEventListener("click", function () {
    runStage().catch(function (e) {
      appendLog("Критическая ошибка выполнения этапа: " + (e && e.message ? e.message : String(e)));
      controller.running = false;
      setUiBusy(false);
    });
  });

  stopBtn.addEventListener("click", function () {
    controller.stop();
  });
  emergencyStopBtn.addEventListener("click", function () {
    controller.stop();
  });

  checkAllBtn.addEventListener("click", function () {
    const keys = stageKeys.get(currentStage) || [];
    for (let i = 0; i < keys.length; i++) {
      const n = nodeByKey.get(keys[i]);
      if (n) n.selected = true;
    }
    renderStageLinks();
  });
  uncheckAllBtn.addEventListener("click", function () {
    const keys = stageKeys.get(currentStage) || [];
    for (let i = 0; i < keys.length; i++) {
      const n = nodeByKey.get(keys[i]);
      if (n) n.selected = false;
    }
    renderStageLinks();
  });
  closeBtn.addEventListener("click", function () {
    controller.stop();
    clearPersistentLogLines();
    emergencyStopBtn.remove();
    panel.remove();
    document.body.style.overflow = prevBodyOverflow;
  });
  chooseLogFileBtn.addEventListener("click", function () {
    pickLogFile().catch(function (e) {
      console.warn("[UI_LinksCrawler][LOG_FILE_PICK][ERROR]", e);
    });
  });
  logToFileCheckbox.addEventListener("change", function () {
    if (!logToFileCheckbox.checked) {
      logTransportMode = "off";
      return;
    }
    if (!canWriteLogFile()) {
      logTransportMode = "session";
      console.info("[UI_LinksCrawler][LOG_MODE] sessionStorage");
      return;
    }
    if (logFileHandle) {
      logTransportMode = "file";
      console.info("[UI_LinksCrawler][LOG_MODE] file");
      return;
    }
    pickLogFile()
      .then(function (ok) {
        if (ok) {
          logTransportMode = "file";
          console.info("[UI_LinksCrawler][LOG_MODE] file");
          return;
        }
        logTransportMode = "session";
        console.info("[UI_LinksCrawler][LOG_MODE] sessionStorage");
      })
      .catch(function () {
        logTransportMode = "session";
        console.info("[UI_LinksCrawler][LOG_MODE] sessionStorage");
      });
  });
  depthInput.addEventListener("change", rebuildFromDepthInput);
  maxLinksPerStageInput.addEventListener("change", rebuildLimitsFromInput);
  maxChildrenPerParentInput.addEventListener("change", rebuildLimitsFromInput);
  maxRenderRowsStage1Input.addEventListener("change", rebuildLimitsFromInput);
  maxRenderRowsPerParentGroupInput.addEventListener("change", rebuildLimitsFromInput);
  resetLimitsBtn.addEventListener("click", resetLimitsToDefault);

  document.body.appendChild(panel);
  document.body.appendChild(emergencyStopBtn);
  inMemoryLogLines = loadPersistedLogLines();
  if (inMemoryLogLines.length > 0) {
    console.groupCollapsed("[UI_LinksCrawler] Восстановленный лог предыдущего запуска (" + inMemoryLogLines.length + " строк)");
    for (let i = 0; i < inMemoryLogLines.length; i++) {
      console.log("[UI_LinksCrawler][RESTORE]", inMemoryLogLines[i]);
    }
    console.groupEnd();
  }
  setUiBusy(false);
  appendLog("Панель готова. Этап 1: нажмите «Скан этапа», отметьте ссылки, затем «Запуск этапа».");
  updateInfo();
})();
