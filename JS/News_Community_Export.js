// =============================================================================
// News_Community_Export.js — выгрузка списка новостей community (POST /proxy/v1/news)
// =============================================================================
// DevTools на странице стенда gamification. POST JSON с пагинацией pageNum.
// Сохранение объединённого JSON; отдельная кнопка — CSV по leaders и authors.
// =============================================================================
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
  var devTrace = createDevToolsTrace({ scriptId: "News_Community_Export" });
  var httpFetch = devTrace.wrapFetch(__nativeFetch);


  const NEWS_ORIGINS = {
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
  const NEWS_STAND_KEYS = ["PROM", "PSI", "IFT-SB", "IFT-GF"];
  const NEWS_CONTOUR_KEYS = ["ALPHA", "SIGMA"];
  const NEWS_PATH = "/bo/rmkib.gamification/proxy/v1/news";
  const NEWS_AUTO_ENV = detectNewsEnvFromLocation();
  const DEFAULT_NEWS_STAND = (NEWS_AUTO_ENV && NEWS_AUTO_ENV.stand) || "PROM";
  const DEFAULT_NEWS_CONTOUR = (NEWS_AUTO_ENV && NEWS_AUTO_ENV.contour) || "SIGMA";

  const DEFAULT_REQUEST_GAP_MS = 5;

  /**
   * Допустимые newsStatus — чекбоксы на панели (редактируйте список в скрипте).
   * @type {{ value: string, label: string, defaultChecked?: boolean }[]}
   */
  const NEWS_STATUS_OPTIONS = [
    { value: "published", label: "published", defaultChecked: true }
  ];

  /**
   * Пары tagType + tagCode для newsTagList — каждый пункт = одна отмеченная пара в payload.
   * @type {{ tagType: string, tagCode: string, label: string, defaultChecked?: boolean }[]}
   */
  const NEWS_TAG_OPTIONS = [
    {
      tagType: "NEWS_TYPE",
      tagCode: "bestPractice",
      label: "bestPractice · NEWS_TYPE",
      defaultChecked: true
    },
    {
      tagType: "NEWS_TYPE",
      tagCode: "achievement",
      label: "achievement · NEWS_TYPE",
      defaultChecked: false
    },
    {
      tagType: "NEWS_TYPE",
      tagCode: "publication",
      label: "publication · NEWS_TYPE",
      defaultChecked: false
    }
  ];
  const DEFAULT_EXPORT_FILENAME_PREFIX_PLACEHOLDER = "авто: news_community_{стенд}_{контур}_";

  /** Поля person (leaders / authors) в CSV — без colorCode и tags. */
  const PERSON_CSV_KEYS = [
    "employeeNumber",
    "lastName",
    "firstName",
    "terDivisionName",
    "gosbCode",
    "tbCode"
  ];

  /** Поля новости в каждой строке CSV. */
  const NEWS_CSV_KEYS = [
    "newsId",
    "createDate",
    "updateDate",
    "plannedDate",
    "plannedDateTime",
    "date",
    "newsStatus",
    "newsType",
    "summary"
  ];

  let NEWS_UI_STAND = DEFAULT_NEWS_STAND;
  let NEWS_UI_CONTOUR = DEFAULT_NEWS_CONTOUR;

  function detectNewsEnvFromLocation() {
    var origin = "";
    try {
      origin = String(window.location.origin || "").toLowerCase();
    } catch (e) {}
    for (var si = 0; si < NEWS_STAND_KEYS.length; si++) {
      var stand = NEWS_STAND_KEYS[si];
      var byStand = NEWS_ORIGINS[stand];
      if (!byStand) continue;
      for (var ci = 0; ci < NEWS_CONTOUR_KEYS.length; ci++) {
        var contour = NEWS_CONTOUR_KEYS[ci];
        var host = String((byStand && byStand[contour]) || "").toLowerCase();
        if (host && host === origin) {
          return { stand: stand, contour: contour };
        }
      }
    }
    return null;
  }

  function getNewsEnv() {
    var stand =
      NEWS_STAND_KEYS.indexOf(NEWS_UI_STAND) >= 0 ? NEWS_UI_STAND : DEFAULT_NEWS_STAND;
    var contour =
      NEWS_CONTOUR_KEYS.indexOf(NEWS_UI_CONTOUR) >= 0
        ? NEWS_UI_CONTOUR
        : DEFAULT_NEWS_CONTOUR;
    var byStand = NEWS_ORIGINS[stand] || NEWS_ORIGINS[DEFAULT_NEWS_STAND];
    var origin =
      (byStand && byStand[contour]) || NEWS_ORIGINS[DEFAULT_NEWS_STAND][DEFAULT_NEWS_CONTOUR];
    return { stand: stand, contour: contour, origin: origin };
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
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

  function sanitizeExportFilenamePrefix(raw) {
    var t = String(raw || "").trim();
    if (!t) return "";
    t = t.replace(/[/\\:*?"<>|\x00-\x1f]+/g, "_").replace(/\s+/g, "_");
    if (t.length > 100) t = t.slice(0, 100);
    while (t.length && (t.endsWith("_") || t.endsWith("."))) t = t.slice(0, -1);
    return t;
  }

  /**
   * Тело POST для страницы списка новостей.
   * @param {number} pageNum
   * @param {{ newsStatuses: string[], newsTagList: { tagType: string, tagCode: string }[] }} opts
   */
  function buildNewsPayload(pageNum, opts) {
    var o = opts || {};
    var statuses = Array.isArray(o.newsStatuses) ? o.newsStatuses.slice() : [];
    var tags = Array.isArray(o.newsTagList) ? o.newsTagList.slice() : [];

    if (statuses.length === 0 && NEWS_STATUS_OPTIONS.length > 0) {
      statuses.push(String(NEWS_STATUS_OPTIONS[0].value));
    }
    if (tags.length === 0 && NEWS_TAG_OPTIONS.length > 0) {
      tags.push({
        tagType: String(NEWS_TAG_OPTIONS[0].tagType),
        tagCode: String(NEWS_TAG_OPTIONS[0].tagCode)
      });
    }

    var payload = {
      newsTagList: tags.map(function (t) {
        return {
          tagType: String(t.tagType || "").trim(),
          tagCode: String(t.tagCode || "").trim()
        };
      }),
      pageNum: Math.max(1, Math.floor(Number(pageNum) || 1))
    };

    if (statuses.length === 1) {
      payload.newsStatus = statuses[0];
    } else if (statuses.length > 1) {
      payload.newsStatus = statuses;
    } else {
      payload.newsStatus = "published";
    }

    return payload;
  }

  /**
   * Краткая подпись выбранных параметров для журнала.
   * @param {{ newsStatuses: string[], newsTagList: { tagType: string, tagCode: string }[] }} opts
   */
  function formatPayloadOptsForLog(opts) {
    var st = opts.newsStatuses || [];
    var tags = opts.newsTagList || [];
    var stTxt =
      st.length === 0
        ? "—"
        : st.length === 1
          ? st[0]
          : "[" + st.join(", ") + "]";
    var tagTxt =
      tags.length === 0
        ? "—"
        : tags
            .map(function (t) {
              return t.tagCode + "/" + t.tagType;
            })
            .join(", ");
    return "newsStatus=" + stTxt + " | newsTagList: " + tags.length + " (" + tagTxt + ")";
  }

  /**
   * Referer для SIGMA — как в UI community (первая выбранная пара тега).
   * @param {string} origin
   * @param {{ tagType: string, tagCode: string }[]} tagList
   */
  function buildCommunityReferer(origin, tagList) {
    var base = String(origin || "").replace(/\/$/, "");
    var first =
      tagList && tagList.length > 0
        ? tagList[0]
        : NEWS_TAG_OPTIONS.length > 0
          ? NEWS_TAG_OPTIONS[0]
          : { tagCode: "bestPractice", tagType: "NEWS_TYPE" };
    var q =
      "newsTagList=" +
      encodeURIComponent(String(first.tagCode)) +
      "%7C" +
      encodeURIComponent(String(first.tagType));
    return base + "/community?" + q;
  }

  /**
   * @param {string} origin
   * @param {string} contourKey
   * @param {Record<string, unknown>} payload
   */
  async function fetchNewsPage(origin, contourKey, payload) {
    var url = String(origin || "").replace(/\/$/, "") + NEWS_PATH;
    var headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Language": "ru"
    };
    if (contourKey === "SIGMA") {
      headers.Origin = origin;
      headers.Referer = buildCommunityReferer(origin, payload.newsTagList);
    }
    var res = await httpFetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
      credentials: "include"
    });
    var data = await res.json().catch(function () {
      return null;
    });
    return { ok: res.ok, status: res.status, data: data, payload: payload };
  }

  /**
   * Объединяет timePeriod[].news с нескольких страниц в один ответ.
   * @param {*} acc — накопленный merged (первый ответ или null)
   * @param {*} pageData — ответ одной страницы
   */
  function mergeNewsPageInto(acc, pageData) {
    if (!pageData || typeof pageData !== "object") return acc;
    if (!acc) {
      try {
        return JSON.parse(JSON.stringify(pageData));
      } catch (e) {
        return pageData;
      }
    }
    if (!acc.body) acc.body = {};
    if (!pageData.body) return acc;

    var dstPeriods = Array.isArray(acc.body.timePeriod) ? acc.body.timePeriod : [];
    var srcPeriods = Array.isArray(pageData.body.timePeriod) ? pageData.body.timePeriod : [];
    var nameToIdx = {};
    for (var i = 0; i < dstPeriods.length; i++) {
      var nm = dstPeriods[i] && dstPeriods[i].name;
      if (nm != null) nameToIdx[String(nm)] = i;
    }
    for (var j = 0; j < srcPeriods.length; j++) {
      var sp = srcPeriods[j];
      if (!sp) continue;
      var key = sp.name != null ? String(sp.name) : "period_" + j;
      if (nameToIdx[key] !== undefined) {
        var dstItem = dstPeriods[nameToIdx[key]];
        var dstNews = Array.isArray(dstItem.news) ? dstItem.news : [];
        var srcNews = Array.isArray(sp.news) ? sp.news : [];
        dstItem.news = dstNews.concat(srcNews);
      } else {
        try {
          dstPeriods.push(JSON.parse(JSON.stringify(sp)));
        } catch (e2) {
          dstPeriods.push(sp);
        }
        nameToIdx[key] = dstPeriods.length - 1;
      }
    }
    acc.body.timePeriod = dstPeriods;
    acc.body.page = pageData.body.page;
    if (pageData.body.newsCount != null) {
      acc.body.newsCount = pageData.body.newsCount;
    }
    return acc;
  }

  /**
   * Считает число объектов news во всех timePeriod.
   * @param {*} body
   */
  function countNewsInBody(body) {
    if (!body || !Array.isArray(body.timePeriod)) return 0;
    var n = 0;
    for (var i = 0; i < body.timePeriod.length; i++) {
      var news = body.timePeriod[i] && body.timePeriod[i].news;
      if (Array.isArray(news)) n += news.length;
    }
    return n;
  }

  function escapeCsvField(s) {
    var t = String(s == null ? "" : s);
    if (/[\r\n",]/.test(t)) {
      return '"' + t.replace(/"/g, '""') + '"';
    }
    return t;
  }

  /**
   * Значение поля новости для CSV.
   * @param {*} news
   * @param {string} key
   */
  function formatNewsFieldForCsv(news, key) {
    if (!news || typeof news !== "object") return "";
    var v = news[key];
    if (v == null) return "";
    return String(v);
  }

  /**
   * Плоские поля person без colorCode и tags.
   * @param {*} person
   */
  function pickPersonFields(person) {
    var row = {};
    if (!person || typeof person !== "object") {
      PERSON_CSV_KEYS.forEach(function (k) {
        row[k] = "";
      });
      return row;
    }
    PERSON_CSV_KEYS.forEach(function (k) {
      var v = person[k];
      row[k] = v == null ? "" : String(v);
    });
    return row;
  }

  /**
   * Мета новости для строк CSV.
   * @param {*} news
   * @param {string} timePeriodName
   */
  function pickNewsMeta(news, timePeriodName) {
    var meta = { timePeriodName: timePeriodName || "" };
    NEWS_CSV_KEYS.forEach(function (k) {
      meta[k] = formatNewsFieldForCsv(news, k);
    });
    return meta;
  }

  /**
   * Строит строки CSV: по одной на каждого leader и author с полями новости.
   * @param {*} mergedResponse — объект ответа API (success + body)
   * @returns {{ headers: string[], rows: string[][] }}
   */
  function buildNewsLeadersAuthorsCsv(mergedResponse) {
    var headers = ["personRole", "timePeriodName"].concat(PERSON_CSV_KEYS, NEWS_CSV_KEYS);
    var rows = [];
    var body = mergedResponse && mergedResponse.body;
    if (!body || !Array.isArray(body.timePeriod)) {
      return { headers: headers, rows: rows };
    }

    for (var pi = 0; pi < body.timePeriod.length; pi++) {
      var period = body.timePeriod[pi];
      var periodName = period && period.name != null ? String(period.name) : "";
      var newsList = period && Array.isArray(period.news) ? period.news : [];
      for (var ni = 0; ni < newsList.length; ni++) {
        var news = newsList[ni];
        if (!news || typeof news !== "object") continue;
        var newsMeta = pickNewsMeta(news, periodName);

        var leaders = Array.isArray(news.leaders) ? news.leaders : [];
        for (var li = 0; li < leaders.length; li++) {
          var personL = pickPersonFields(leaders[li]);
          var rowL = ["leaders", periodName];
          PERSON_CSV_KEYS.forEach(function (k) {
            rowL.push(personL[k]);
          });
          NEWS_CSV_KEYS.forEach(function (k) {
            rowL.push(newsMeta[k]);
          });
          rows.push(rowL);
        }

        var authors = Array.isArray(news.authors) ? news.authors : [];
        for (var ai = 0; ai < authors.length; ai++) {
          var personA = pickPersonFields(authors[ai]);
          var rowA = ["authors", periodName];
          PERSON_CSV_KEYS.forEach(function (k) {
            rowA.push(personA[k]);
          });
          NEWS_CSV_KEYS.forEach(function (k) {
            rowA.push(newsMeta[k]);
          });
          rows.push(rowA);
        }
      }
    }
    return { headers: headers, rows: rows };
  }

  /**
   * @param {{ headers: string[], rows: string[][] }} table
   */
  function csvTableToText(table) {
    var lines = [table.headers.map(escapeCsvField).join(",")];
    for (var i = 0; i < table.rows.length; i++) {
      lines.push(
        table.rows[i]
          .map(function (c) {
            return escapeCsvField(c);
          })
          .join(",")
      );
    }
    return lines.join("\r\n") + "\r\n";
  }

  function downloadJson(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], {
      type: "application/json"
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 0);
  }

  function downloadText(filename, text, mimeType) {
    var blob = new Blob([text], { type: mimeType || "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 0);
  }

  function startNewsPanel() {
    var prevRoot = document.getElementById("newsCommunityExportRoot");
    if (prevRoot) prevRoot.remove();

    /** Последняя успешная выгрузка — для кнопки CSV. */
    var lastExportBundle = null;

    const root = document.createElement("div");
    root.id = "newsCommunityExportRoot";
    root.style.cssText =
      "position:fixed;left:10px;top:10px;width:min(920px,calc(100vw - 16px));max-height:92vh;height:92vh;" +
      "display:flex;flex-direction:column;overflow:hidden;z-index:999999;" +
      "background:#ffffff;border:1px solid #cbd5e1;padding:14px 16px;box-shadow:0 12px 40px rgba(15,23,42,.12);border-radius:12px;" +
      "font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#111827;color-scheme:light;box-sizing:border-box;";

    const title = document.createElement("div");
    title.style.cssText =
      "font-weight:700;font-size:16px;margin-bottom:2px;color:#0f172a;letter-spacing:-0.02em;";
    title.textContent = "Новости community — POST /news";
    root.appendChild(title);

    const titleSub = document.createElement("div");
    titleSub.style.cssText = "font-size:11px;color:#64748b;margin-bottom:10px;line-height:1.4;";
    titleSub.textContent =
      "POST с pageNum и пагинацией. newsStatus и newsTagList (пары tagType+tagCode) — чекбоксы; списки вариантов задаются константами NEWS_STATUS_OPTIONS и NEWS_TAG_OPTIONS в скрипте.";
    root.appendChild(titleSub);

    const stRow = document.createElement("div");
    stRow.style.cssText =
      "display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;font-size:12px;color:#111827;width:100%;box-sizing:border-box;";

    const labSt = document.createElement("label");
    labSt.textContent = "Стенд:";
    labSt.style.cssText = "font-weight:bold;color:#111827;";
    const selStand = document.createElement("select");
    selStand.style.cssText =
      "padding:4px 8px;font-size:12px;min-width:160px;cursor:pointer;color:#111827;background:#fff;border:1px solid #64748b;border-radius:4px;color-scheme:light;";
    NEWS_STAND_KEYS.forEach(function (key) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = key;
      if (key === NEWS_UI_STAND) opt.selected = true;
      selStand.appendChild(opt);
    });
    selStand.addEventListener("change", function () {
      NEWS_UI_STAND = selStand.value;
    });
    stRow.appendChild(labSt);
    stRow.appendChild(selStand);

    const labContour = document.createElement("label");
    labContour.textContent = "Контур:";
    labContour.style.cssText = "font-weight:bold;color:#111827;";
    const selContour = document.createElement("select");
    selContour.style.cssText =
      "padding:4px 8px;font-size:12px;min-width:140px;cursor:pointer;color:#111827;background:#fff;border:1px solid #64748b;border-radius:4px;color-scheme:light;";
    function refreshContourOptions() {
      var prev = NEWS_UI_CONTOUR;
      selContour.innerHTML = "";
      NEWS_CONTOUR_KEYS.forEach(function (key) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = key;
        if (key === prev) opt.selected = true;
        selContour.appendChild(opt);
      });
    }
    refreshContourOptions();
    selStand.addEventListener("change", refreshContourOptions);
    selContour.addEventListener("change", function () {
      NEWS_UI_CONTOUR = selContour.value;
    });
    stRow.appendChild(labContour);
    stRow.appendChild(selContour);

    const envInfo = document.createElement("div");
    envInfo.style.cssText =
      "margin-left:auto;font-size:11px;color:#334155;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;";
    function refreshEnvInfo() {
      try {
        envInfo.textContent = "POST " + getNewsEnv().origin;
      } catch (e) {
        envInfo.textContent = "";
      }
    }
    selStand.addEventListener("change", refreshEnvInfo);
    selContour.addEventListener("change", refreshEnvInfo);
    refreshEnvInfo();
    stRow.appendChild(envInfo);
    root.appendChild(stRow);

    const panelScroll = document.createElement("div");
    panelScroll.style.cssText =
      "flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;-webkit-overflow-scrolling:touch;";
    root.appendChild(panelScroll);

    const payloadBox = document.createElement("div");
    payloadBox.style.cssText =
      "margin-bottom:10px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;";
    const payloadTitle = document.createElement("div");
    payloadTitle.style.cssText = "font-weight:600;font-size:11px;color:#475569;margin-bottom:8px;";
    payloadTitle.textContent = "Параметры POST — отметьте чекбоксами (списки в NEWS_STATUS_OPTIONS / NEWS_TAG_OPTIONS)";
    payloadBox.appendChild(payloadTitle);

    /**
     * Сетка чекбоксов; возвращает функции чтения выбранных значений.
     * @param {HTMLElement} parent
     * @param {string} blockTitle
     * @param {{ key: string, label: string, defaultChecked?: boolean }[]} items
     * @returns {{ getSelectedKeys: function(): string[] }}
     */
    function appendCheckboxBlock(parent, blockTitle, items) {
      const block = document.createElement("div");
      block.style.cssText = "margin-bottom:10px;";
      const lab = document.createElement("div");
      lab.style.cssText = "font-weight:600;font-size:11px;color:#334155;margin-bottom:6px;";
      lab.textContent = blockTitle;
      block.appendChild(lab);

      const grid = document.createElement("div");
      grid.style.cssText =
        "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 12px;align-items:center;";
      const checks = {};
      items.forEach(function (item) {
        const row = document.createElement("label");
        row.style.cssText =
          "margin:0;color:#111827;line-height:1.35;display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer;font-size:11px;";
        const c = document.createElement("input");
        c.type = "checkbox";
        c.checked = !!item.defaultChecked;
        checks[item.key] = c;
        row.appendChild(c);
        const sp = document.createElement("span");
        sp.style.cssText = "color:#334155;word-break:break-word;";
        sp.textContent = item.label;
        row.appendChild(sp);
        grid.appendChild(row);
      });
      block.appendChild(grid);
      parent.appendChild(block);

      return {
        getSelectedKeys: function () {
          const out = [];
          Object.keys(checks).forEach(function (k) {
            if (checks[k].checked) out.push(k);
          });
          return out;
        }
      };
    }

    const statusCtl = appendCheckboxBlock(
      payloadBox,
      "newsStatus (можно несколько)",
      NEWS_STATUS_OPTIONS.map(function (opt) {
        return {
          key: opt.value,
          label: opt.label || opt.value,
          defaultChecked: !!opt.defaultChecked
        };
      })
    );

    const tagCtl = appendCheckboxBlock(
      payloadBox,
      "newsTagList — пары tagType + tagCode (можно несколько)",
      NEWS_TAG_OPTIONS.map(function (opt, idx) {
        return {
          key: String(idx),
          label: opt.label || opt.tagCode + " · " + opt.tagType,
          defaultChecked: !!opt.defaultChecked
        };
      })
    );

    const stRowRight = document.createElement("div");
    stRowRight.style.cssText =
      "display:flex;align-items:center;flex-wrap:wrap;gap:10px 14px;margin-top:6px;";

    const labPrefix = document.createElement("label");
    labPrefix.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;color:#111827;white-space:nowrap;font-size:11px;";
    labPrefix.appendChild(document.createTextNode("Префикс файла:"));
    const inpFnamePrefix = document.createElement("input");
    inpFnamePrefix.type = "text";
    inpFnamePrefix.placeholder = DEFAULT_EXPORT_FILENAME_PREFIX_PLACEHOLDER;
    inpFnamePrefix.style.cssText =
      "width:min(220px,40vw);padding:4px 8px;font-size:11px;border:1px solid #64748b;border-radius:4px;color-scheme:light;";
    labPrefix.appendChild(inpFnamePrefix);
    stRowRight.appendChild(labPrefix);

    const labGap = document.createElement("label");
    labGap.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;color:#111827;white-space:nowrap;font-size:11px;";
    labGap.appendChild(document.createTextNode("Пауза между страницами, мс:"));
    const inpGapMs = document.createElement("input");
    inpGapMs.type = "number";
    inpGapMs.min = "0";
    inpGapMs.max = "60000";
    inpGapMs.value = String(DEFAULT_REQUEST_GAP_MS);
    inpGapMs.style.cssText =
      "width:72px;padding:4px 6px;font-size:11px;border:1px solid #64748b;border-radius:4px;color-scheme:light;";
    labGap.appendChild(inpGapMs);
    stRowRight.appendChild(labGap);
    payloadBox.appendChild(stRowRight);
    panelScroll.appendChild(payloadBox);

    const LOG_MAX_LINES = 1200;
    const logWrap = document.createElement("div");
    logWrap.style.cssText =
      "margin-top:8px;flex-shrink:0;display:flex;flex-direction:column;height:min(168px,22vh);min-height:88px;max-height:24vh;box-sizing:border-box;";
    const logLab = document.createElement("div");
    logLab.style.cssText = "font-weight:600;font-size:11px;color:#475569;margin-bottom:4px;flex-shrink:0;";
    logLab.textContent = "Журнал работы:";
    devTrace.mountToggleRow(logWrap, logLab);
    logWrap.appendChild(logLab);
    const logEl = document.createElement("div");
    logEl.style.cssText =
      "flex:1 1 auto;min-height:0;overflow-y:auto;font-size:11px;color:#0f172a;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:8px;";
    logWrap.appendChild(logEl);

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

    function log(msg) {
      devTrace.log(String(msg));
      const line = document.createElement("div");
      line.style.cssText =
        "margin:0 0 3px 0;line-height:1.35;word-break:break-word;font-family:ui-monospace,Menlo,monospace;font-size:10px;";
      line.textContent = formatLogTime() + "  " + msg;
      logEl.appendChild(line);
      while (logEl.childElementCount > LOG_MAX_LINES) {
        logEl.removeChild(logEl.firstElementChild);
      }
      logEl.scrollTop = logEl.scrollHeight;
    }

    log("Панель открыта. «CSV» сразу запускает выгрузку и сохраняет JSON + CSV; «JSON» — только JSON.");

    function readPayloadOpts() {
      var statuses = statusCtl.getSelectedKeys();
      var tagKeys = tagCtl.getSelectedKeys();
      var tags = [];
      tagKeys.forEach(function (key) {
        var idx = parseInt(key, 10);
        var opt = NEWS_TAG_OPTIONS[idx];
        if (opt) {
          tags.push({ tagType: String(opt.tagType), tagCode: String(opt.tagCode) });
        }
      });
      return { newsStatuses: statuses, newsTagList: tags };
    }

    function validatePayloadOpts(opts) {
      if (!opts.newsStatuses || opts.newsStatuses.length === 0) {
        log("Остановка: не выбран ни один newsStatus.");
        return false;
      }
      if (!opts.newsTagList || opts.newsTagList.length === 0) {
        log("Остановка: не выбрана ни одна пара newsTagList (tagType + tagCode).");
        return false;
      }
      return true;
    }

    function readRequestGapMs() {
      const n = parseInt(String(inpGapMs.value || "").trim(), 10);
      if (!Number.isFinite(n) || n < 0) return DEFAULT_REQUEST_GAP_MS;
      if (n > 60000) return 60000;
      return n;
    }

    function buildExportFilenamePrefix(standKey, contourKey) {
      var custom = sanitizeExportFilenamePrefix(inpFnamePrefix.value);
      if (custom) return custom.endsWith("_") ? custom : custom + "_";
      return "news_community_" + standKey + "_" + contourKey + "_";
    }

    var fetchBusy = false;

    function setExportButtonsBusy(busy) {
      btnJson.disabled = busy;
      btnCsv.disabled = busy;
      var op = busy ? "0.55" : "1";
      var cur = busy ? "wait" : "pointer";
      btnJson.style.opacity = op;
      btnCsv.style.opacity = op;
      btnJson.style.cursor = cur;
      btnCsv.style.cursor = cur;
    }

    /**
     * Последовательные POST всех страниц; результат в lastExportBundle.
     * @param {string} sourceTag — подпись для лога
     * @returns {Promise<{ bundle: object, prefix: string, ts: string, pagesCount: number, newsTotal: number, errors: number }|null>}
     */
    async function runNewsFetch(sourceTag) {
      var env = getNewsEnv();
      var gapMs = readRequestGapMs();
      var payloadOpts = readPayloadOpts();
      if (!validatePayloadOpts(payloadOpts)) {
        return null;
      }
      var prefix = buildExportFilenamePrefix(env.stand, env.contour);

      log(
        "Старт (" +
          (sourceTag || "") +
          ") | " +
          env.stand +
          "/" +
          env.contour +
          " | " +
          formatPayloadOptsForLog(payloadOpts) +
          " | пауза " +
          gapMs +
          " мс"
      );

      var pageNum = 1;
      var totalPages = null;
      var rawPages = [];
      var merged = null;
      var errors = 0;

      while (true) {
        var payload = buildNewsPayload(pageNum, payloadOpts);
        log(
          "Страница " +
            pageNum +
            " — POST pageNum=" +
            pageNum +
            " | " +
            JSON.stringify({
              newsStatus: payload.newsStatus,
              newsTagList: payload.newsTagList,
              pageNum: payload.pageNum
            })
        );
        var fr;
        try {
          fr = await fetchNewsPage(env.origin, env.contour, payload);
        } catch (ex) {
          log("[исключение] страница " + pageNum + ": " + (ex && ex.message ? ex.message : ex));
          errors++;
          break;
        }

        if (!fr.ok) {
          log("[HTTP " + fr.status + "] страница " + pageNum + " — остановка.");
          errors++;
          break;
        }

        if (!fr.data || typeof fr.data !== "object") {
          log("Страница " + pageNum + ": нет JSON-тела — остановка.");
          errors++;
          break;
        }

        if (fr.data.success === false) {
          var errTxt =
            fr.data.error && fr.data.error.text
              ? String(fr.data.error.text)
              : "success=false";
          log("Страница " + pageNum + ": API ERROR — " + errTxt);
          errors++;
          break;
        }

        rawPages.push(fr.data);
        merged = mergeNewsPageInto(merged, fr.data);

        var pageInfo = fr.data.body && fr.data.body.page;
        var isLast = pageInfo && pageInfo.isLast === true;
        var total = pageInfo && pageInfo.total != null ? Number(pageInfo.total) : null;
        if (Number.isFinite(total) && total > 0) totalPages = total;
        var num = pageInfo && pageInfo.num != null ? pageInfo.num : pageNum;
        var newsOnPage = fr.data.body ? countNewsInBody(fr.data.body) : 0;
        log(
          "  → OK | page.num=" +
            num +
            (totalPages != null ? " | total=" + totalPages : "") +
            " | isLast=" +
            (isLast ? "true" : "false") +
            " | новостей на странице: " +
            newsOnPage
        );

        if (isLast) break;
        if (totalPages != null && pageNum >= totalPages) break;

        pageNum++;
        if (gapMs > 0) await delay(gapMs);
      }

      if (!merged || rawPages.length === 0) {
        log("Выгрузка не завершена: нет успешных страниц. Ошибок/сбоев: " + errors + ".");
        console.log("[News community] Файлы не созданы.");
        return null;
      }

      var newsTotal = countNewsInBody(merged.body);
      var bundle = {
        exportMeta: {
          stand: env.stand,
          contour: env.contour,
          origin: env.origin,
          fetchedAt: new Date().toISOString(),
          pagesFetched: rawPages.length,
            payloadDefaults: payloadOpts,
          newsItemsMerged: newsTotal
        },
        pages: rawPages,
        merged: merged
      };
      lastExportBundle = bundle;

      return {
        bundle: bundle,
        prefix: prefix,
        ts: getTimestamp(),
        pagesCount: rawPages.length,
        newsTotal: newsTotal,
        errors: errors
      };
    }

    /**
     * @param {object} bundle
     * @param {string} prefix
     * @param {string} ts
     * @returns {{ saved: boolean, fname: string, leadersN: number, authorsN: number, rowCount: number }}
     */
    function saveCsvFromBundle(bundle, prefix, ts) {
      var table = buildNewsLeadersAuthorsCsv(bundle.merged);
      var fname = prefix + ts + "_leaders_authors.csv";
      if (!table.rows.length) {
        return { saved: false, fname: fname, leadersN: 0, authorsN: 0, rowCount: 0 };
      }
      var text = "\uFEFF" + csvTableToText(table);
      downloadText(fname, text, "text/csv;charset=utf-8");
      var leadersN = 0;
      var authorsN = 0;
      for (var i = 0; i < table.rows.length; i++) {
        if (table.rows[i][0] === "leaders") leadersN++;
        else if (table.rows[i][0] === "authors") authorsN++;
      }
      return {
        saved: true,
        fname: fname,
        leadersN: leadersN,
        authorsN: authorsN,
        rowCount: table.rows.length
      };
    }

    async function runNewsJsonExport() {
      if (fetchBusy) {
        log("Выгрузка уже выполняется.");
        return;
      }
      fetchBusy = true;
      setExportButtonsBusy(true);
      lastExportBundle = null;
      try {
        var result = await runNewsFetch("JSON");
        if (!result) return;

        var fname = result.prefix + result.ts + ".json";
        downloadJson(fname, result.bundle);
        log(
          "JSON готов. Страниц: " +
            result.pagesCount +
            " | новостей: " +
            result.newsTotal +
            " | файл: " +
            fname
        );
        console.log(
          "[News community] JSON: " +
            fname +
            " | страниц: " +
            result.pagesCount +
            " | новостей: " +
            result.newsTotal
        );
      } finally {
        fetchBusy = false;
        setExportButtonsBusy(false);
      }
    }

    async function runNewsCsvExport() {
      if (fetchBusy) {
        log("Выгрузка уже выполняется.");
        return;
      }
      fetchBusy = true;
      setExportButtonsBusy(true);
      lastExportBundle = null;
      try {
        log("CSV: запуск выгрузки (POST всех страниц)…");
        var result = await runNewsFetch("JSON+CSV");
        if (!result) return;

        var fnameJson = result.prefix + result.ts + ".json";
        downloadJson(fnameJson, result.bundle);

        var csvInfo = saveCsvFromBundle(result.bundle, result.prefix, result.ts);
        log(
          "Готово (JSON+CSV). Страниц: " +
            result.pagesCount +
            " | новостей: " +
            result.newsTotal +
            " | JSON: " +
            fnameJson
        );
        if (csvInfo.saved) {
          log(
            "  CSV: " +
              csvInfo.fname +
              " | строк: " +
              csvInfo.rowCount +
              " (leaders: " +
              csvInfo.leadersN +
              ", authors: " +
              csvInfo.authorsN +
              ")"
          );
        } else {
          log("  CSV не создан: нет строк leaders/authors.");
        }
        console.log(
          "[News community] JSON+CSV | JSON: " +
            fnameJson +
            " | CSV: " +
            (csvInfo.saved ? csvInfo.fname + " (" + csvInfo.rowCount + " строк)" : "нет строк")
        );
      } finally {
        fetchBusy = false;
        setExportButtonsBusy(false);
      }
    }

    const btnBase =
      "padding:10px 12px;font-size:11px;cursor:pointer;border:none;border-radius:8px;font-weight:600;" +
      "color:#fff;text-align:center;line-height:1.35;box-sizing:border-box;width:100%;";

    const actionGrid = document.createElement("div");
    actionGrid.style.cssText =
      "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0 10px;";

    const btnJson = document.createElement("button");
    btnJson.type = "button";
    btnJson.textContent = "Загрузить новости → JSON";
    btnJson.style.cssText = btnBase + "background:#2563eb;";
    btnJson.addEventListener("click", function () {
      void runNewsJsonExport();
    });
    actionGrid.appendChild(btnJson);

    const btnCsv = document.createElement("button");
    btnCsv.type = "button";
    btnCsv.textContent = "Выгрузить JSON + CSV (leaders + authors)";
    btnCsv.style.cssText = btnBase + "background:#059669;";
    btnCsv.addEventListener("click", function () {
      void runNewsCsvExport();
    });
    actionGrid.appendChild(btnCsv);
    panelScroll.appendChild(actionGrid);

    root.appendChild(logWrap);

    const btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.textContent = "Закрыть панель";
    btnClose.style.cssText =
      "margin-top:8px;width:100%;padding:8px;cursor:pointer;background:#f1f5f9;color:rgb(15,23,42);border:1px solid #94a3b8;border-radius:4px;font-size:12px;flex-shrink:0;";
    btnClose.addEventListener("click", function () {
      root.remove();
    });
    root.appendChild(btnClose);

    document.body.appendChild(root);
    devTrace.attachPanel(root);
    console.log("[News community] Панель открыта. Журнал — на панели.");
  }

  startNewsPanel();
})();
