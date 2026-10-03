/* Ресурсная панель v8. Ядро данных (без DOM) + UI-модули (только при наличии document). */
(function () {
  "use strict";
  var RP = (window.RP = window.RP || {});

  var ENVS = ["PROM", "PSI", "IFT"];
  var SEGS = ["ALPHA", "SIGMA"];
  var TOOLS = ["decoder", "role"];
  var KEY_ORDER = ["id", "section", "title", "url", "env", "seg", "copy", "icon", "note", "meet", "tool", "check"];

  var HEADER = [
    "/* Данные ресурсной панели. Редактируется вручную или через админку (панель групп → замок).",
    "   Формат (window.RP_LINKS):",
    "   version        — версия формата (сейчас 1)",
    "   sections       — разделы: { id, name, icon }; порядок = порядок вывода",
    "   favoriteSeed   — id ссылок для стартового «Избранного», пока нет кликов",
    "   links          — ссылки, по одной на строку:",
    "     id       — уникальный идентификатор",
    "     section  — id раздела из sections",
    "     title    — название",
    "     url      — адрес http/https (нужен url или tool)",
    "     env      — стенд: PROM | PSI | IFT (необязательно)",
    "     seg      — сегмент сети: ALPHA | SIGMA (необязательно)",
    "     copy     — код, копируется в буфер при клике (необязательно)",
    "     icon     — имя иконки; иначе иконка раздела (необязательно)",
    "     note     — комментарий в подсказке (необязательно)",
    "     meet     — true: встреча Jazz, попадает в полосу «Встречи» (необязательно)",
    "     tool     — decoder | role: встроенный инструмент вместо URL (необязательно)",
    "     check    — false: не проверять доступность (необязательно)",
    "   adminScripts   — реестр будущих скриптов, сейчас пуст */"
  ].join("\n");

  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }

  // Проверка данных: errors — критичные, warnings — некритичные.
  function validate(data) {
    var errors = [], warnings = [];
    if (!isObj(data)) return { ok: false, errors: ["Данные не объект"], warnings: warnings };
    var sections = Array.isArray(data.sections) ? data.sections : null;
    var links = Array.isArray(data.links) ? data.links : null;
    if (!sections) errors.push("sections: ожидается массив");
    if (!links) errors.push("links: ожидается массив");
    if (!sections || !links) return { ok: false, errors: errors, warnings: warnings };

    var secIds = {};
    sections.forEach(function (s, i) {
      if (!s || !s.id) { errors.push("Раздел №" + (i + 1) + ": нет id"); return; }
      if (secIds[s.id]) errors.push("Дубль id раздела: " + s.id);
      secIds[s.id] = true;
      if (!s.name) errors.push("Раздел " + s.id + ": нет name");
    });

    var ids = {};
    links.forEach(function (l, i) {
      var tag = "Ссылка " + (l && l.id ? l.id : "№" + (i + 1));
      if (!l || !l.id) { errors.push(tag + ": нет id"); return; }
      if (ids[l.id]) errors.push("Дубль id: " + l.id);
      ids[l.id] = true;
      if (!l.title) errors.push(tag + ": нет title");
      if (!secIds[l.section]) errors.push(tag + ": неизвестный раздел «" + l.section + "»");
      if (l.url) {
        if (!/^https?:\/\//i.test(l.url)) errors.push(tag + ": url должен начинаться с http:// или https://");
      } else if (!l.tool) {
        errors.push(tag + ": нужен url или tool");
      }
      if (l.tool && TOOLS.indexOf(l.tool) < 0) errors.push(tag + ": неизвестный tool «" + l.tool + "»");
      if (l.env != null && ENVS.indexOf(l.env) < 0) errors.push(tag + ": недопустимый env «" + l.env + "»");
      if (l.seg != null && SEGS.indexOf(l.seg) < 0) errors.push(tag + ": недопустимый seg «" + l.seg + "»");
    });

    (Array.isArray(data.favoriteSeed) ? data.favoriteSeed : []).forEach(function (id) {
      if (!ids[id]) warnings.push("favoriteSeed: нет ссылки с id «" + id + "»");
    });
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  // Ссылка в одну строку, ключи в каноничном порядке; кириллица не экранируется.
  function linkLine(l) {
    var o = {};
    KEY_ORDER.forEach(function (k) { if (l[k] !== undefined) o[k] = l[k]; });
    Object.keys(l).forEach(function (k) { if (!(k in o)) o[k] = l[k]; });
    return JSON.stringify(o);
  }

  function serializeLinks(data) {
    var out = [HEADER, "window.RP_LINKS = {"];
    out.push("  \"version\": " + JSON.stringify(data.version) + ",");
    out.push("  \"sections\": [");
    out.push((data.sections || []).map(function (s) { return "    " + JSON.stringify(s); }).join(",\n"));
    out.push("  ],");
    out.push("  \"favoriteSeed\": " + JSON.stringify(data.favoriteSeed || []) + ",");
    out.push("  \"links\": [");
    out.push((data.links || []).map(function (l) { return "    " + linkLine(l); }).join(",\n"));
    out.push("  ],");
    out.push("  \"adminScripts\": " + JSON.stringify(data.adminScripts || []));
    out.push("};");
    return out.join("\n") + "\n";
  }

  // ---------- URL ----------
  function dec(s) { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch (e) { return s; } }

  function parseUrl(url) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^\/?#@]*@)?([^\/?#:]+)(?::(\d+))?([^?#]*)(?:\?([^#]*))?/i.exec(String(url || ""));
    if (!m) return { host: "", path: url, params: [] };
    var params = [];
    if (m[4]) m[4].split("&").forEach(function (p) {
      if (!p) return;
      var i = p.indexOf("=");
      params.push(i < 0 ? [dec(p), ""] : [dec(p.slice(0, i)), dec(p.slice(i + 1))]);
    });
    return { host: m[1], port: m[2] || "", path: m[3] ? dec(m[3]) : "/", params: params };
  }

  // ---------- Поиск ----------
  var ENV_ALIAS = { PROM: "PROM ПРОМ", PSI: "PSI ПСИ", IFT: "IFT ИФТ" };
  var SEG_ALIAS = { ALPHA: "ALPHA Альфа", SIGMA: "SIGMA Сигма" };

  function match(link, sectionName, query) {
    var tk = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!tk.length) return { hit: true, ranges: [] };
    var hay = [link.title, link.url ? parseUrl(link.url).host : "", sectionName || "",
      link.env ? ENV_ALIAS[link.env] || link.env : "", link.seg ? SEG_ALIAS[link.seg] || link.seg : "",
      link.note || ""].join(" ").toLowerCase();
    var hit = tk.every(function (t) { return hay.indexOf(t) >= 0; });
    if (!hit) return { hit: false, ranges: [] };
    var low = String(link.title || "").toLowerCase(), marks = [];
    tk.forEach(function (t) {
      var i = low.indexOf(t);
      while (i >= 0) { marks.push([i, i + t.length]); i = low.indexOf(t, i + t.length); }
    });
    marks.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var ranges = [];
    marks.forEach(function (m) {
      var last = ranges[ranges.length - 1];
      if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
      else ranges.push([m[0], m[1]]);
    });
    return { hit: true, ranges: ranges };
  }

  // ---------- Избранное ----------
  function rankFavorites(links, clicks, seed, limit) {
    limit = limit == null ? 9 : limit;
    clicks = clicks || {}; seed = seed || [];
    var items = [];
    links.forEach(function (l, i) {
      if (l.meet || l.tool) return;
      var si = seed.indexOf(l.id);
      items.push({ id: l.id, n: +clicks[l.id] || 0, s: si < 0 ? Infinity : si, i: i });
    });
    items.sort(function (a, b) { return b.n - a.n || (a.s === b.s ? 0 : a.s < b.s ? -1 : 1) || a.i - b.i; });
    return items.slice(0, limit).map(function (x) { return x.id; });
  }

  // ---------- Декодер permission ----------
  function decodePermission(text) {
    var parts = String(text == null ? "" : text).trim().split(",").map(function (p) { return p.trim(); });
    var bin = "";
    parts.reverse().forEach(function (p) {
      if (!/^[0-9a-f]+$/i.test(p)) throw new Error("Некорректный ввод");
      var b = parseInt(p, 16).toString(2);
      while (b.length < 32) b = "0" + b;
      bin += b;
    });
    bin = bin.split("").reverse().join("");
    var bits = [];
    for (var i = 0; i < bin.length; i++) if (bin.charAt(i) === "1") bits.push(i);
    return { binary: bin.replace(/(.{8})(?=.)/g, "$1 "), bits: bits };
  }

  // ---------- Колонки ----------
  // Разбиение на n подряд идущих колонок с минимальной максимальной суммой (динамика).
  function balanceColumns(sizes, n) {
    var m = sizes.length, pre = [0];
    sizes.forEach(function (s, i) { pre.push(pre[i] + s); });
    var INF = Infinity, best = [], cut = [];
    for (var k = 0; k <= n; k++) { best.push([]); cut.push([]); for (var j = 0; j <= m; j++) { best[k].push(INF); cut[k].push(0); } }
    best[0][0] = 0;
    for (k = 1; k <= n; k++) for (j = 0; j <= m; j++) for (var i = 0; i <= j; i++) {
      var v = Math.max(best[k - 1][i], pre[j] - pre[i]);
      if (v < best[k][j]) { best[k][j] = v; cut[k][j] = i; }
    }
    var cols = [], end = m;
    for (k = n; k >= 1; k--) {
      var st = cut[k][end], col = [];
      for (var q = st; q < end; q++) col.push(q);
      cols.unshift(col); end = st;
    }
    return cols;
  }

  RP.core = {
    validate: validate, serializeLinks: serializeLinks, parseUrl: parseUrl, match: match,
    rankFavorites: rankFavorites, decodePermission: decodePermission, balanceColumns: balanceColumns
  };

  // UI-модули подключаются в следующих задачах, только при наличии document.
  if (typeof document !== "undefined") { /* boot */ }
})();
