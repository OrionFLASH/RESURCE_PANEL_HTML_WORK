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

  // ---------- Набор иконок v8 (из mockups/_shared/icons.js) ----------
  var ICONS = {
    home: '<path d="M3 10h3l2-4 4 8 2-4h3"/>',
    contests: '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M6 8h5M6 12h8"/>',
    timeline: '<path d="M3 5h8M6 10h10M4 15h7"/>',
    grid: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.5"/>',
    params: '<circle cx="5" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="10" cy="15" r="2"/><path d="M6.6 7.3 9 13.3M13.4 7.3 11 13.3M7 6h6"/>',
    report: '<rect x="2.5" y="7" width="4" height="6" rx="1"/><rect x="8" y="7" width="4" height="6" rx="1"/><rect x="13.5" y="7" width="4" height="6" rx="1"/><path d="M2 16h16"/>',
    dicts: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5z"/><path d="M4 16.5A1.5 1.5 0 0 0 5.5 18H16"/>',
    checks: '<path d="M10 2.5 16 5v5c0 3.6-2.6 6.4-6 7.5-3.4-1.1-6-3.9-6-7.5V5z"/><path d="m7.3 10 2 2 3.6-4"/>',
    bundle: '<path d="M3 6.5 10 3l7 3.5v7L10 17l-7-3.5z"/><path d="M3 6.5 10 10l7-3.5M10 10v7"/>',
    "export": '<path d="M10 3v10M6 9l4 4 4-4M4 16h12"/>',
    upload: '<path d="M10 14V4M6 8l4-4 4 4M4 16h12"/>',
    search: '<circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2 17 17"/>',
    log: '<path d="M4 5h12M4 10h12M4 15h8"/>',
    moon: '<path d="M10 3a7 7 0 1 0 7 7 5.5 5.5 0 0 1-7-7Z"/>',
    sun: '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3"/>',
    lock: '<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/>',
    unlock: '<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V7a3 3 0 0 1 5.8-1.2"/>',
    logout: '<path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 6.5 15.5 10 12 13.5M15.5 10H8"/>',
    close: '<path d="M5 5l10 10M15 5 5 15"/>',
    left: '<path d="m12 5-5 5 5 5"/>',
    right: '<path d="m8 5 5 5-5 5"/>',
    down: '<path d="m5 8 5 5 5-5"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    minus: '<path d="M4 10h12"/>',
    check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
    alert: '<path d="M10 3 18 17H2z"/><path d="M10 8.5v4M10 14.8v.1"/>',
    info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.3v.1"/>',
    save: '<path d="M4 4h9.5L16 6.5V16H4z"/><path d="M7 4v4h6V4M7 16v-5h6v5"/>',
    trash: '<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10h7.4l.8-10"/>',
    file: '<path d="M6 3h5.5L15 6.5V17H6z"/><path d="M11 3v4h4"/>',
    field: '<rect x="3" y="6" width="14" height="8" rx="2"/><path d="M6 10h4"/>',
    tour: '<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/>',
    flag: '<path d="M5 17V3.5M5 4h9l-2 3 2 3H5"/>',
    cmd: '<path d="M7 7h6v6H7z"/><path d="M7 7a2 2 0 1 1-2-2 2 2 0 0 1 2 2zM13 7a2 2 0 1 0 2-2M7 13a2 2 0 1 0-2 2M13 13a2 2 0 1 1 2 2"/>',
    fit: '<path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/>',
    edit: '<path d="M12.5 4.5 15.5 7.5 7 16H4v-3z"/>',
    dot: '<circle cx="10" cy="10" r="3" fill="currentColor"/>',
    chat: '<path d="M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/>',
    video: '<rect x="2.5" y="5" width="10.5" height="10" rx="2"/><path d="m13 9 4.5-2.5v7L13 11"/>',
    mail: '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="m3 5.5 7 5.5 7-5.5"/>',
    trophy: '<path d="M6 3h8v5a4 4 0 0 1-8 0zM6 5H3.5a2.5 2.5 0 0 0 2.6 3M14 5h2.5a2.5 2.5 0 0 1-2.6 3M10 12v3M7 17h6"/>',
    ticket: '<path d="M3 6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4z"/><path d="M12 5v10" stroke-dasharray="1.5 1.8"/>',
    code: '<path d="m7 6-4 4 4 4M13 6l4 4-4 4M11 4 9 16"/>',
    star: '<path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
    copy: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7"/>',
    link: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2L10 5.8M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1.1-1.1"/>',
    refresh: '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2"/>',
    galaxy: '<circle cx="10" cy="10" r="2.2"/><ellipse cx="10" cy="10" rx="7.5" ry="3.2" transform="rotate(-20 10 10)"/><circle cx="16.2" cy="6.6" r="1" fill="currentColor"/><circle cx="4.4" cy="13" r=".8" fill="currentColor"/>'
  };

  // Иконки, которых нет в наборе v8: панель групп и «глаз» видимости
  ICONS.panel = '<rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M8 3.5v13M4.8 7h1M4.8 9.6h1M4.8 12.2h1"/>';
  ICONS.eye = '<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z"/><circle cx="10" cy="10" r="2.3"/>';
  ICONS.eyeoff = '<path d="M8.2 4.7A8 8 0 0 1 10 4.5c5 0 8 5.5 8 5.5a14 14 0 0 1-2.1 2.8M12.7 13.9A7 7 0 0 1 10 15.5c-5 0-8-5.5-8-5.5a14.5 14.5 0 0 1 3.5-4M3.5 3.5l13 13"/>';

  // ---------- Иконки: SVG-спрайт (сетка 20×20, контур 1.6, currentColor) ----------
  RP.icons = {
    names: function () { return Object.keys(ICONS); },
    has: function (n) { return Object.prototype.hasOwnProperty.call(ICONS, n); },
    svg: function (name, cls) {
      return '<svg class="' + (cls || "ui-i") + '" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><use href="#rp-i-' + name + '"/></svg>';
    },
    sprite: function () {
      return '<svg xmlns="http://www.w3.org/2000/svg" id="rp-icons" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">' +
        Object.keys(ICONS).map(function (k) {
          return '<symbol id="rp-i-' + k + '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + ICONS[k] + "</symbol>";
        }).join("") + "</svg>";
    },
    inject: function () {
      if (document.getElementById("rp-icons")) return;
      document.body.insertAdjacentHTML("afterbegin", RP.icons.sprite());
    }
  };

  // ---------- Хранилище: localStorage может быть недоступен — каждое обращение в try/catch ----------
  RP.store = {
    get: function (key, def) {
      var v;
      try { v = window.localStorage.getItem(key); } catch (e) { return def; }
      if (v == null) return def;
      try { return JSON.parse(v); } catch (e) { return v; }
    },
    set: function (key, val) {
      try { window.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
    }
  };

  // ---------- Проверка доступности (из mockups/_shared/probe.js) ----------
  // fetch(url, {mode:"no-cors"}): любой ответ = хост доступен; сетевая ошибка / таймаут = недоступен. Работает из file://.
  //   RP.probe.run(links, { onStart(id), onResult(id, res), onProgress(done, total), onDone(summary) })
  //     res = { st: "up" | "down", ms, at: Date, err?: "timeout" | "network" }
  //   RP.probe.every(ms, fn) — повтор по интервалу (по умолчанию 2 мин), возвращает функцию остановки.
  (function () {
    var TIMEOUT = 6000;   // мс на один хост
    var PARALLEL = 6;     // не больше N запросов одновременно
    var running = null;

    function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

    function probeOne(url) {
      var t0 = now();
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer;
      var timeout = new Promise(function (resolve) {
        timer = setTimeout(function () { if (ctrl) ctrl.abort(); resolve({ st: "down", err: "timeout" }); }, TIMEOUT);
      });
      // кэш-бастер, чтобы браузер не отвечал из кэша
      var u = url + (url.indexOf("?") < 0 ? "?" : "&") + "_rp=" + Date.now();
      var req = fetch(u, { mode: "no-cors", cache: "no-store", credentials: "omit", redirect: "follow", signal: ctrl ? ctrl.signal : undefined })
        .then(function () { return { st: "up" }; }, function () { return { st: "down", err: "network" }; });
      return Promise.race([req, timeout]).then(function (r) {
        clearTimeout(timer);
        r.ms = Math.round(now() - t0);
        r.at = new Date();
        return r;
      });
    }

    function run(links, h) {
      h = h || {};
      var list = (links || []).filter(function (l) { return l && l.url && /^https?:/i.test(l.url); });
      var token = {};
      running = token;
      var i = 0, done = 0, up = 0, total = list.length;
      list.forEach(function (l) { if (h.onStart) h.onStart(l.id); });
      if (h.onProgress) h.onProgress(0, total);
      return new Promise(function (resolve) {
        if (!total) { finish(); return; }
        function next() {
          if (running !== token) return;           // запущена новая проверка — эта больше не пишет
          if (i >= total) return;
          var l = list[i++];
          probeOne(l.url).then(function (res) {
            if (running !== token) return;
            done++; if (res.st === "up") up++;
            if (h.onResult) h.onResult(l.id, res);
            if (h.onProgress) h.onProgress(done, total);
            if (done === total) finish(); else next();
          });
        }
        function finish() {
          var sum = { total: total, up: up, down: total - up, at: new Date() };
          if (h.onDone) h.onDone(sum);
          resolve(sum);
        }
        for (var k = 0; k < Math.min(PARALLEL, total); k++) next();
      });
    }

    function every(ms, fn) {
      var id = setInterval(fn, ms || 120000);
      return function () { clearInterval(id); };
    }

    RP.probe = { run: run, every: every, probeOne: probeOne, TIMEOUT: TIMEOUT, PARALLEL: PARALLEL, INTERVAL: 120000 };
  })();

  // ---------- Статусы ссылок: id → { st: "wait"|"up"|"down", ms?, at?, err? } ----------
  var STATUS = {};
  RP.status = {
    get: function (id) {
      if (STATUS[id]) return STATUS[id];
      var ui = RP.ui && RP.ui.st && RP.ui.st[id];   // local / skip — не проверяются
      return { st: ui || "wait" };
    },
    set: function (id, res) { STATUS[id] = res; return res; }
  };

  if (typeof document === "undefined") return;

  // ---------- UI ----------
  var I = RP.icons.svg;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var ENV_LBL = { PROM: "PROM", PSI: "ПСИ", IFT: "ИФТ" }, SEG_LBL = { ALPHA: "Alpha", SIGMA: "Sigma" };
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Состояние страницы; later-задачи читают и дополняют его
  var S = RP.ui = {
    data: null, byId: {}, secById: {},
    st: {},                // id → wait | up | down | local | skip
    lineEl: {}, secEl: {}, meetEl: {}, secN: {},
    cols: 4, laidOut: false,
    ENV: ENV_LBL, SEG: SEG_LBL, esc: esc, $: $, $$: $$
  };

  function iconOf(l) { return RP.icons.has(l.icon) ? l.icon : (S.secById[l.section] && RP.icons.has(S.secById[l.section].icon) ? S.secById[l.section].icon : "link"); }
  function tagsHtml(l) {
    return '<span class="tags">' + (l.env ? '<span class="tag e-' + l.env + '">' + ENV_LBL[l.env] + "</span>" : "") +
      (l.seg ? '<span class="tag s-' + l.seg + '">' + l.seg + "</span>" : "") + "</span>";
  }
  function ariaOf(l) {
    return l.title + (l.env ? ", стенд " + ENV_LBL[l.env] : "") + (l.seg ? ", сегмент " + SEG_LBL[l.seg] : "") +
      (l.copy ? ", при открытии копируется код" : "") + (l.tool ? ", инструмент" : "");
  }
  // Начальный статус: url-ссылки ждут проверки; инструменты локальные; check:false не проверяются
  function initialSt(l) { return l.tool ? "local" : l.check === false ? "skip" : "wait"; }
  S.iconOf = iconOf; S.tagsHtml = tagsHtml; S.ariaOf = ariaOf;

  // Элемент-ссылка: настоящий <a> для url, кнопка для инструмента
  function linkEl(l, cls) {
    var el = document.createElement(l.tool ? "button" : "a");
    if (l.tool) { el.type = "button"; el.dataset.tool = l.tool; } else { el.href = l.url; el.target = "_blank"; el.rel = "noopener"; }
    el.className = cls; el.dataset.linkId = l.id; el.dataset.st = S.st[l.id];
    return el;
  }

  // ---------- Отрисовка ----------
  function buildIndex() {
    S.lineEl = {}; S.secEl = {}; S.secN = {};
    S.data.sections.forEach(function (s) {
      var sec = document.createElement("section");
      sec.className = "sec"; sec.id = "sec-" + s.id; sec.dataset.sectionId = s.id; sec.setAttribute("aria-labelledby", "h-" + s.id);
      sec.innerHTML = '<h2 class="sh" id="h-' + s.id + '">' + I(RP.icons.has(s.icon) ? s.icon : "link") + "<span>" + esc(s.name) + "</span><em></em></h2>";
      var n = 0;
      S.data.links.forEach(function (l) {
        if (l.section !== s.id || l.meet) return;
        var el = linkEl(l, "ln");
        el.id = "ln-" + l.id; el.setAttribute("aria-label", ariaOf(l));
        el.innerHTML = I(iconOf(l)) + '<span class="tt">' + esc(l.title) + "</span>" + (l.copy ? I("copy", "ui-i cp") : "") +
          '<span class="ld"></span>' + tagsHtml(l) + '<span class="dot"></span>';
        S.lineEl[l.id] = el; sec.appendChild(el); n++;
      });
      $("em", sec).textContent = n;
      S.secN[s.id] = n; S.secEl[s.id] = sec;
    });
  }
  // Встречи Jazz (meet:true) — полосой под избранным, в указателе их нет
  function buildMeets() {
    var box = $("#meets"); box.innerHTML = ""; S.meetEl = {};
    S.data.links.forEach(function (l) {
      if (!l.meet) return;
      var a = linkEl(l, "mt");
      a.setAttribute("aria-label", "Встреча: " + ariaOf(l));
      a.innerHTML = I("video") + '<span class="tt">' + esc(l.title) + '</span><span class="dot"></span>';
      S.meetEl[l.id] = a; box.appendChild(a);
    });
    box.parentNode.hidden = !box.children.length;
  }
  // Избранное: порядок считается один раз при открытии (иконки не прыгают)
  function buildDock() {
    var dock = $("#dock"); dock.innerHTML = "";
    RP.core.rankFavorites(S.data.links, RP.store.get("rp_clicks", {}), S.data.favoriteSeed, 9).forEach(function (id) {
      var l = S.byId[id], a = linkEl(l, "app");
      a.setAttribute("aria-label", ariaOf(l));
      a.innerHTML = '<span class="sq">' + I(iconOf(l)) + '<span class="dot"></span>' + (l.copy ? '<span class="cp">' + I("copy") + "</span>" : "") +
        '</span><span class="lb">' + esc(l.title) + "</span>" + tagsHtml(l);
      dock.appendChild(a);
    });
    $(".favs").hidden = !dock.children.length;
  }
  function buildGroups() {
    $("#gpList").innerHTML = S.data.sections.map(function (s) {
      var n = S.secN[s.id] || 0;
      return '<li class="gr' + (n ? "" : " zero") + '" data-sec="' + esc(s.id) + '"><button class="gr-go" type="button" data-name="' + esc(s.name) + '" aria-label="' + esc(s.name) + ", ссылок: " + n + '">' +
        '<span class="ic">' + I(RP.icons.has(s.icon) ? s.icon : "link") + "<b>" + n + '</b></span><span class="nm">' + esc(s.name) + '</span><span class="c">' + n + "</span></button>" +
        '<button class="gr-eye" type="button" aria-pressed="true" aria-label="Скрыть группу «' + esc(s.name) + '» в списке" title="Скрыть из списка">' + I("eye") + "</button></li>";
    }).join("") + '<li class="gp-none" id="gpNone" hidden>Нет групп с таким названием</li>';
  }
  function buildChips(box, opts) {
    $$(".chip", box).forEach(function (c) { c.remove(); });
    opts.forEach(function (o, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.dataset.val = o[0]; b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      b.innerHTML = (o[2] ? '<i style="--c:var(' + o[2] + ')"></i>' : "") + o[1];
      box.appendChild(b);
    });
  }
  // Сводка доступности в шапке
  function renderSum() {
    var c = { up: 0, down: 0, wait: 0 };
    S.data.links.forEach(function (l) { if (c[S.st[l.id]] != null) c[S.st[l.id]]++; });
    $("#sum").innerHTML =
      '<span title="Доступны"><i class="dot ok"></i>' + c.up + '<span class="lbl">&nbsp;доступны</span></span>' +
      '<span title="Недоступны"><i class="dot down"></i>' + c.down + '<span class="lbl">&nbsp;недоступны</span></span>' +
      (c.wait ? '<span title="Проверяются"><i class="dot wait"></i>' + c.wait + "</span>" : "");
  }
  S.renderSum = renderSum;

  // Полная перерисовка из данных (повторно — после правок в админке)
  function render(data) {
    var D = S.data = data || S.data;
    S.byId = {}; S.secById = {};
    D.sections.forEach(function (s) { S.secById[s.id] = s; });
    D.links.forEach(function (l) { S.byId[l.id] = l; if (!S.st[l.id] || S.st[l.id] === "local" || S.st[l.id] === "skip") S.st[l.id] = initialSt(l); });
    $("#subt").textContent = D.links.length + " рабочих ссылок · " + D.sections.length + " разделов";
    $("#cnt").textContent = D.links.length + " ссылок";
    buildIndex(); buildMeets(); buildDock(); buildGroups(); renderSum();
    layout();
    if (S.apply) S.apply();
  }
  S.render = render;

  // ---------- Панель групп: развёрнута / узкая / скрыта; <767px — шторка ----------
  var RAILS = ["open", "compact", "hidden"];
  var RAIL_NAME = { open: "развёрнута", compact: "узкая", hidden: "скрыта" }, RAIL_NEXT = { open: "compact", compact: "hidden", hidden: "open" };
  var RAIL_TO = { open: "развёрнутой", compact: "узкой", hidden: "скрытой" };
  function railMode() {
    var r = RP.store.get("rp_rail", null);
    if (window.innerWidth < 767) return "drawer";
    return RAILS.indexOf(r) >= 0 ? r : window.innerWidth >= 1280 ? "open" : "compact";
  }
  function applyRail() {
    var m = railMode(), gp = $("#gp"), btn = $("#gpBtn");
    gp.classList.remove("m-open", "m-compact", "m-hidden", "m-drawer", "peek"); gp.classList.add("m-" + m);
    document.body.style.setProperty("--pw", m === "open" ? "248px" : m === "compact" ? "60px" : "0px");
    btn.dataset.m = m;
    if (m === "drawer") {
      btn.setAttribute("aria-label", "Группы ссылок"); btn.title = "Группы ссылок";
      btn.setAttribute("aria-expanded", gp.classList.contains("on") ? "true" : "false");
      gp.setAttribute("role", "dialog"); gp.setAttribute("aria-modal", "true"); gp.setAttribute("aria-labelledby", "gpTtl");
    } else {
      var lbl = "Панель групп: " + RAIL_NAME[m] + ". Нажмите — сделать " + RAIL_TO[RAIL_NEXT[m]];
      btn.setAttribute("aria-label", lbl); btn.title = lbl; btn.removeAttribute("aria-expanded");
      gp.removeAttribute("role"); gp.removeAttribute("aria-modal"); gp.removeAttribute("aria-labelledby");
    }
  }
  S.railMode = railMode; S.applyRail = applyRail;

  // ---------- Раскладка «в один экран»: колонки по числу строк, плотность ступенями ----------
  // Разбиение разделов по колонкам: подряд (RP.core.balanceColumns) или «жадно» по весу — где самая длинная колонка короче
  function groupsFor(w, k) {
    k = Math.min(k, w.length);
    var seq = RP.core.balanceColumns(w, k).filter(function (g) { return g.length; });
    var load = [], bins = [];
    for (var j = 0; j < k; j++) { load.push(0); bins.push([]); }
    w.map(function (x, i) { return i; }).sort(function (a, b) { return w[b] - w[a] || a - b; }).forEach(function (i) {
      var m = load.indexOf(Math.min.apply(null, load)); load[m] += w[i]; bins[m].push(i);
    });
    bins.forEach(function (b) { b.sort(function (a, c) { return a - c; }); });
    bins.sort(function (a, b) { return a[0] - b[0]; });
    function max(gs) { return Math.max.apply(null, gs.map(function (g) { return g.reduce(function (t, i) { return t + w[i]; }, 0); })); }
    return max(bins) < max(seq) - 0.5 ? bins : seq;
  }
  function placeColumns(cols) {
    var idx = $("#idx"), secs = S.data.sections.map(function (s) { return S.secEl[s.id]; })
      .filter(function (e) { return e && !e.hidden && !e.classList.contains("off"); });
    idx.innerHTML = ""; idx.style.setProperty("--cols", cols);
    var F = S.filter;
    if (!secs.length && F && (F.q.trim() || F.env || F.seg)) {
      // Поиск/фильтры ничего не оставили
      var e = document.createElement("div"), q = F.q.trim(), fl = F.env || F.seg;
      e.className = "empty"; e.setAttribute("role", "status");
      e.innerHTML = "<b>Ничего не нашлось</b>Нет ссылок" + (q ? " по запросу «" + esc(q) + "»" : "") + (fl ? " с выбранными фильтрами" : "") +
        '.<br><button class="btn" type="button" id="reset">Сбросить поиск и фильтры</button>';
      idx.appendChild(e); $("#reset").addEventListener("click", function () { S.resetAll(); }); return;
    }
    if (!secs.length) return;
    var w = secs.map(function (s) { return $$(".ln:not([hidden])", s).length + 1.6; });
    groupsFor(w, cols).forEach(function (g) {
      var c = document.createElement("div"); c.className = "col";
      g.forEach(function (i) { c.appendChild(secs[i]); });
      idx.appendChild(c);
    });
  }
  // Избранное: столько «иконок», сколько помещается в ширину (без горизонтальной прокрутки)
  function fitDock() {
    var favs = $(".favs"), apps = $$(".app", $("#dock"));
    apps.forEach(function (a) { a.classList.remove("over"); });
    if (window.innerWidth < 767 || !apps.length) return;
    var cs = getComputedStyle(favs);
    var avail = favs.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - $("#favCap").offsetWidth - 14;
    var n = Math.max(1, Math.floor((avail + 6) / (apps[0].offsetWidth + 6)));
    apps.forEach(function (a, i) { a.classList.toggle("over", i >= n); });
  }
  // Ступени плотности: кегль строки → допустимые высоты строки; сначала кегль ≥ 14px, затем запасные
  var STEPS = [[15, [30, 29, 28]], [14.5, [28, 27]], [14, [27, 26, 25, 24]], [13.5, [24, 23]], [13, [23, 22, 21]]];
  function setDen(s) { document.body.style.setProperty("--fs-row", s[0] + "px"); document.body.style.setProperty("--rh", s[1] + "px"); }
  function fit() {
    var b = document.body, idx = $("#idx");
    if (window.innerWidth < 1024 || window.innerHeight < 560) {
      b.classList.remove("fit", "compact"); b.style.removeProperty("--rh"); b.style.removeProperty("--fs-row"); fitDock();
      placeColumns(S.cols = idx.clientWidth >= 700 ? 2 : 1); b.dataset.den = "scroll"; return;
    }
    b.classList.add("fit");
    var gap = parseFloat(getComputedStyle(idx).columnGap) || 36;
    var inner = idx.clientWidth - 2 * parseFloat(getComputedStyle(idx).paddingLeft);
    var maxCols = Math.max(2, Math.min(6, Math.floor((inner + gap) / (250 + gap))));
    var minCols = Math.min(3, maxCols);
    var tiers = [STEPS.filter(function (s) { return s[0] >= 14; }), STEPS.filter(function (s) { return s[0] < 14; })];
    // Порядок: крупный кегль → меньше колонок (шире названия) → выше строка; плотная шапка — только если иначе не влезает
    for (var t = 0; t < tiers.length; t++) for (var h = 0; h < 2; h++) {
      b.classList.toggle("compact", h === 1); fitDock();
      for (var f = 0; f < tiers[t].length; f++) for (var c = minCols; c <= maxCols; c++) for (var r = 0; r < tiers[t][f][1].length; r++) {
        var s = [tiers[t][f][0], tiers[t][f][1][r]];
        setDen(s); placeColumns(S.cols = c);
        if (idx.scrollHeight <= idx.clientHeight + 1) { b.dataset.den = s.join("/") + " · " + c + " кол." + (h ? " · плотная шапка" : ""); return; }
      }
    }
    // Не влезло даже в самой плотной ступени — обычная прокрутка
    b.classList.remove("fit", "compact"); setDen([14, 26]); fitDock(); placeColumns(S.cols = maxCols); b.dataset.den = "scroll";
  }
  // Плотность подбирается по полному списку: поиск и фильтры не меняют шаг строк
  function layout() {
    if (!S.data) return;
    applyRail();
    var hid = $$(".ln[hidden], .sec[hidden]");
    hid.forEach(function (e) { e.hidden = false; });
    fit();
    hid.forEach(function (e) { e.hidden = true; });
    S.laidOut = true; placeColumns(S.cols);
  }
  S.layout = layout; S.placeColumns = placeColumns; S.fitDock = fitDock;

  // ---------- Проверка доступности: запуск, прогресс, отражение статусов ----------
  var checking = false;
  function paintSt(id, st) {
    $$('[data-link-id="' + id + '"]').forEach(function (e) { e.dataset.st = st; });
  }
  function checkable(l) { return !l.tool && l.check !== false && !!l.url; }
  // opts.background — фоновая (по таймеру): без прогресса на кнопке; во время проверки повторный запуск игнорируется
  function check(opts) {
    if (checking || !S.data) return null;
    var bg = !!(opts && opts.background), btn = $("#refresh");
    checking = true;
    if (!bg) { btn.classList.add("busy"); btn.setAttribute("aria-busy", "true"); btn.style.setProperty("--p", 0); }
    // Известные статусы не сбрасываем в «проверяется»: ссылки без результата и так в wait
    return RP.probe.run(S.data.links.filter(checkable), {
      onResult: function (id, res) { RP.status.set(id, res); S.st[id] = res.st; paintSt(id, res.st); renderSum(); },
      onProgress: function (done, total) { if (!bg) btn.style.setProperty("--p", total ? done / total : 1); }
    }).then(function () {
      checking = false; btn.classList.remove("busy"); btn.removeAttribute("aria-busy"); btn.style.removeProperty("--p"); renderSum();
    });
  }
  S.check = check;

  // ---------- Тосты ----------
  RP.toast = function (text, icon) {
    var box = $("#toasts"), t = document.createElement("div");
    t.className = "toast"; t.innerHTML = I(icon || "copy") + "<span></span>";
    $("span", t).textContent = text;
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(function () { t.remove(); }, 2600);
    return t;
  };

  // ---------- Буфер обмена ----------
  // Синхронный запасной путь: скрытый textarea + execCommand('copy') (работает в обработчике клика, в т.ч. с file://)
  function copyLegacy(text) {
    var ta = document.createElement("textarea"), back = document.activeElement, ok = false;
    ta.value = text; ta.setAttribute("readonly", ""); ta.setAttribute("aria-hidden", "true");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { ok = !!document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    if (back && back.focus && back !== document.body) try { back.focus({ preventScroll: true }); } catch (e) {}
    return ok;
  }
  // RP.copy(text, done?) -> boolean: false — копирование точно не удалось.
  // Сначала синхронно (execCommand в обработчике клика — до того, как window.open заберёт фокус),
  // при неудаче — navigator.clipboard.writeText (асинхронно). done(ok) сообщает итог.
  RP.copy = function (text, done) {
    text = String(text);
    done = done || function () {};
    if (copyLegacy(text)) { done(true); return true; }
    var cb = null;
    try { cb = navigator.clipboard && typeof navigator.clipboard.writeText === "function" ? navigator.clipboard : null; } catch (e) { cb = null; }
    if (cb) {
      try {
        cb.writeText(text).then(function () { done(true); }, function () { done(false); });
        return true;
      } catch (e) {}
    }
    done(false);
    return false;
  };

  // ---------- Клики по ссылкам ----------
  function bump(id) {
    var c = RP.store.get("rp_clicks", {});
    if (!c || typeof c !== "object" || Array.isArray(c)) c = {};
    c[id] = (+c[id] || 0) + 1;
    RP.store.set("rp_clicks", c);   // избранное пересчитается при следующем открытии
  }
  function copyUrl(l) {
    RP.copy(l.url, function (ok) { RP.toast(ok ? "Ссылка скопирована" : "Не удалось скопировать", ok ? "link" : "alert"); });
  }
  // Действие по ссылке: ev — событие клика/клавиши (Ctrl/⌘ — копировать URL вместо открытия)
  function activate(l, ev) {
    hideTip();
    if (l.tool) { if (RP.tools && RP.tools.open) RP.tools.open(l); return; }
    if (ev && (ev.ctrlKey || ev.metaKey)) { copyUrl(l); return; }
    if (l.copy) RP.copy(l.copy, function (ok) { RP.toast(ok ? "Скопировано: " + l.copy : "Не удалось скопировать", ok ? "copy" : "alert"); });
    window.open(l.url, "_blank", "noopener");
    bump(l.id);
  }
  S.activate = activate;
  function linkOf(ev) {
    var el = ev.target && ev.target.closest && ev.target.closest("[data-link-id]");
    return el && S.byId[el.dataset.linkId] ? el : null;
  }
  var ctxAt = 0;
  function bindLinks() {
    document.addEventListener("click", function (ev) {
      var el = linkOf(ev);
      if (!el || ev.button !== 0) return;
      ev.preventDefault();
      // macOS: после contextmenu с Ctrl браузер может прислать и click — не дублируем
      if (ev.ctrlKey && Date.now() - ctxAt < 600) return;
      activate(S.byId[el.dataset.linkId], ev);
    });
    // macOS: Ctrl+клик левой кнопкой приходит как contextmenu
    document.addEventListener("contextmenu", function (ev) {
      var el = linkOf(ev);
      if (!el || !ev.ctrlKey || ev.button !== 0) return;
      ev.preventDefault(); ctxAt = Date.now();
      var l = S.byId[el.dataset.linkId];
      if (!l.tool) { hideTip(); copyUrl(l); }
    });
    // Средняя кнопка — поведение браузера по умолчанию; клик всё равно учитываем
    document.addEventListener("auxclick", function (ev) {
      var el = linkOf(ev);
      if (el && ev.button === 1 && !S.byId[el.dataset.linkId].tool) bump(el.dataset.linkId);
    });
  }

  // ---------- Подсказка при наведении ----------
  var tip = null, tipTimer = 0, tipFor = null, mx = 0, my = 0;
  function hhmm(d) { d = new Date(d); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function ctxOf(l) { return [l.env ? ENV_LBL[l.env] : "", l.seg ? SEG_LBL[l.seg] : ""].filter(Boolean).join(" · "); }
  function stText(s) {
    if (s.st === "up") return "Доступен" + (s.ms != null ? " · " + s.ms + " мс" : "") + (s.at ? " · " + hhmm(s.at) : "");
    if (s.st === "down") return "Недоступен" + (s.err === "timeout" ? " · таймаут" : s.err === "network" ? " · ошибка сети" : "") + (s.at ? " · " + hhmm(s.at) : "");
    if (s.st === "skip") return "Не проверяется";
    return "Проверяется…";
  }
  function tipHtml(l) {
    var ctx = ctxOf(l), sec = S.secById[l.section];
    var h = "<h3>" + esc(l.title) + "</h3>";
    if (l.tool) {
      h += '<div class="u">Встроенный инструмент панели</div><dl><dt>Раздел</dt><dd>' + esc(sec ? sec.name : "") + "</dd>" +
        (ctx ? "<dt>Контур</dt><dd>" + ctx + "</dd>" : "") + (l.note ? "<dt>Комментарий</dt><dd>" + esc(l.note) + "</dd>" : "") + "</dl>";
      return h + '<div class="hint">Клик — открыть форму</div>';
    }
    var u = RP.core.parseUrl(l.url), hash = l.url.indexOf("#") >= 0 ? l.url.slice(l.url.indexOf("#")) : "";
    h += '<div class="u">' + esc(l.url) + "</div><dl>";
    if (l.note) h += "<dt>Комментарий</dt><dd>" + esc(l.note) + "</dd>";
    if (u.host) {
      h += "<dt>Хост</dt><dd><code>" + esc(u.host + (u.port ? ":" + u.port : "")) + "</code></dd><dt>Путь</dt><dd><code>" + esc((u.path || "/") + hash) + "</code></dd>";
      if (u.params.length) h += "<dt>Параметры</dt><dd>" + u.params.map(function (p) { return "<code>" + esc(p[0]) + "=" + esc(p[1]) + "</code>"; }).join("<br>") + "</dd>";
    }
    if (ctx) h += "<dt>Контур</dt><dd>" + ctx + "</dd>";
    var s = RP.status.get(l.id);
    h += '<dt>Статус</dt><dd><span class="st" data-st="' + esc(s.st) + '"><i class="dot"></i>' + stText(s) + "</span></dd>";
    if (l.copy) h += "<dt>Код</dt><dd><code>" + esc(l.copy) + "</code> — копируется при открытии</dd>";
    return h + '</dl><div class="hint">Клик — открыть · ' + (isMac ? "⌘" : "Ctrl") + "+клик — копировать ссылку</div>";
  }
  function placeTip(x, y) {
    var r = tip.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    var left = x + 16, top = y + 18;
    if (left + r.width > W - 8) left = Math.max(8, x - r.width - 12);
    if (top + r.height > H - 8) top = Math.max(8, y - r.height - 12);
    tip.style.transform = "translate(" + Math.round(left) + "px," + Math.round(top) + "px)";
  }
  function showTip(el, x, y) {
    tipFor = el; tip.innerHTML = tipHtml(S.byId[el.dataset.linkId]);
    tip.classList.add("on"); tip.setAttribute("aria-hidden", "false"); placeTip(x, y);
  }
  function hideTip() {
    clearTimeout(tipTimer); tipFor = null;
    if (tip) { tip.classList.remove("on"); tip.setAttribute("aria-hidden", "true"); }
  }
  S.hideTip = hideTip;
  function bindTip() {
    tip = $("#tip");
    document.addEventListener("pointerover", function (ev) {
      var el = linkOf(ev);
      if (el === tipFor) return;
      hideTip(); if (!el || ev.pointerType === "touch") return;
      tipTimer = setTimeout(function () { if (el.isConnected) showTip(el, mx, my); }, 180);
    });
    document.addEventListener("pointermove", function (ev) { mx = ev.clientX; my = ev.clientY; if (tipFor) placeTip(mx, my); });
    document.addEventListener("focusin", function (ev) {
      var el = linkOf(ev);
      if (!el) { if (tipFor) hideTip(); return; }
      var r = el.getBoundingClientRect(); showTip(el, r.left + 24, r.bottom - 10);
    });
    window.addEventListener("scroll", hideTip, true);
  }

  // ---------- Поиск и фильтры (фильтры не запоминаются) ----------
  var F = S.filter = { env: "", seg: "", q: "" };
  function passes(l) {
    // Инструменты остаются при любом стенде/сегменте — их отбирает только поиск
    if (!l.tool && F.env && l.env !== F.env) return { hit: false, ranges: [] };
    if (!l.tool && F.seg && l.seg !== F.seg) return { hit: false, ranges: [] };
    var s = S.secById[l.section];
    return RP.core.match(l, s ? s.name : "", F.q);
  }
  function hl(text, ranges) {
    var out = "", pos = 0;
    ranges.forEach(function (r) { out += esc(text.slice(pos, r[0])) + "<mark>" + esc(text.slice(r[0], r[1])) + "</mark>"; pos = r[1]; });
    return out + esc(text.slice(pos));
  }
  function apply() {
    if (!S.data) return;
    var n = 0, total = S.data.links.length, on = !!(F.q.trim() || F.env || F.seg);
    S.data.links.forEach(function (l) {
      var m = passes(l), el = S.lineEl[l.id] || S.meetEl[l.id];
      if (m.hit) n++;
      if (!el) return;
      if (S.lineEl[l.id]) el.hidden = !m.hit; else el.classList.toggle("mute", !m.hit);
      $(".tt", el).innerHTML = hl(l.title, m.hit ? m.ranges : []);
    });
    S.data.sections.forEach(function (s) {
      var sec = S.secEl[s.id]; if (!sec) return;
      var v = $$(".ln:not([hidden])", sec).length;
      sec.hidden = !v; $("em", sec).textContent = v; S.secN[s.id] = v;
    });
    $$(".app", $("#dock")).forEach(function (a) { a.classList.toggle("mute", !passes(S.byId[a.dataset.linkId]).hit); });
    $("#cnt").textContent = on ? n + " из " + total : total + " ссылок";
    $("#omni").classList.toggle("has", !!F.q);
    $("#q").setAttribute("aria-expanded", on ? "true" : "false");
    if (S.paintGroups) S.paintGroups();
    setActive(-1);
    if (S.laidOut) placeColumns(S.cols); else layout();
  }
  S.apply = apply;
  // Сброс поиска и фильтров: чипы «Все», пустое поле, фокус в поиск
  S.resetAll = function () {
    var q = $("#q");
    q.value = ""; F.q = ""; F.env = ""; F.seg = "";
    $$(".filters .fg").forEach(function (g) { $$(".chip", g).forEach(function (c, i) { c.setAttribute("aria-pressed", i === 0 ? "true" : "false"); }); });
    apply(); q.focus();
  };

  // Клавиатура в поиске: ↑↓ — выбор строки, Enter — открыть, Esc — очистить
  var active = -1;
  function visLines() { return $$("#idx .ln:not([hidden])"); }
  function setActive(i) {
    var ls = visLines(), q = $("#q");
    $$(".ln.kb").forEach(function (e) { e.classList.remove("kb"); });
    active = ls.length ? Math.max(-1, Math.min(i, ls.length - 1)) : -1;
    if (active >= 0) {
      ls[active].classList.add("kb");
      ls[active].scrollIntoView({ block: "nearest" }); q.setAttribute("aria-activedescendant", ls[active].id);
    } else q.removeAttribute("aria-activedescendant");
  }
  function bindSearch() {
    var q = $("#q"), qT = 0;
    q.setAttribute("aria-expanded", "false");
    q.addEventListener("input", function () { F.q = q.value; clearTimeout(qT); qT = setTimeout(apply, 60); });
    q.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter") {
        if (F.q !== q.value) { F.q = q.value; clearTimeout(qT); apply(); }   // Enter сразу после ввода — без ожидания
        var ls = visLines(), el = ls[active >= 0 ? active : 0];
        if (el && (F.q.trim() || active >= 0)) { e.preventDefault(); activate(S.byId[el.dataset.linkId], e); }
      } else if (e.key === "Escape") {
        if (q.value) { e.preventDefault(); q.value = ""; F.q = ""; clearTimeout(qT); apply(); } else q.blur();
      }
    });
    $("#clr").addEventListener("click", function () { q.value = ""; F.q = ""; apply(); q.focus(); });
    $(".filters").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".chip");
      if (!b) return;
      var g = b.parentNode, key = g.id === "fEnv" ? "env" : "seg";
      F[key] = b.dataset.val;
      $$(".chip", g).forEach(function (c) { c.setAttribute("aria-pressed", c === b ? "true" : "false"); });
      apply();
    });
    // Ctrl/⌘+K, а также «/» вне поля ввода — фокус в поиск
    document.addEventListener("keydown", function (e) {
      var tag = document.activeElement && document.activeElement.tagName;
      var typing = /INPUT|TEXTAREA|SELECT/.test(tag || "");
      if (((e.ctrlKey || e.metaKey) && !e.altKey && (e.key || "").toLowerCase() === "k") || (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey)) {
        if (document.querySelector(".modal.on, .drawer.on")) return;
        e.preventDefault(); q.focus(); q.select();
      }
    });
  }

  // ---------- Тема: тёмная по умолчанию, светлая «Туман»; rp_theme ----------
  RP.theme = {
    get: function () { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; },
    paint: function () {
      var light = RP.theme.get() === "light", b = $("#theme");
      b.innerHTML = I(light ? "moon" : "sun"); b.setAttribute("aria-label", light ? "Включить тёмную тему" : "Включить светлую тему");
      b.title = b.getAttribute("aria-label");
    },
    set: function (t) {
      document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
      RP.store.set("rp_theme", t === "light" ? "light" : "dark"); RP.theme.paint();
    },
    toggle: function () { RP.theme.set(RP.theme.get() === "light" ? "dark" : "light"); }
  };

  // ---------- Экран ошибки загрузки links.js ----------
  function fail(title, text, items) {
    var box = $("#rp-error");
    box.innerHTML = '<div class="rp-err-box">' + I("alert") + "<h1>" + esc(title) + "</h1>" + (text ? "<p>" + esc(text) + "</p>" : "") +
      (items && items.length ? "<ul>" + items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      "<p>Исправьте файл <code>links.js</code> рядом с <code>index.html</code> и обновите страницу.</p></div>";
    box.hidden = false; document.body.classList.add("rp-failed");
  }

  // ---------- Старт ----------
  function boot() {
    RP.icons.inject();
    var D = window.RP_LINKS, err = window.RP_LOAD_ERROR;
    if (!D) {
      if (window.RP_LINKS_MISSING) return fail("Не найден links.js рядом с index.html", "Страница берёт ссылки из файла links.js в той же папке.");
      if (err) {
        // С диска (file://) браузер обычно скрывает текст и строку ошибки чужого файла — «Script error.»
        var known = err.line && err.message && !/^Script error\.?$/i.test(err.message);
        return fail("Ошибка в links.js: синтаксическая ошибка" + (known ? ", строка " + err.line : ""),
          known ? err.message : "Браузер не сообщает строку для файлов, открытых с диска: откройте консоль разработчика (F12) — там указаны строка и причина.");
      }
      return fail("Ошибка в links.js: не задан window.RP_LINKS", "Файл должен начинаться с «window.RP_LINKS = {».");
    }
    var v = RP.core.validate(D);
    v.warnings.forEach(function (w) { console.warn("links.js: " + w); });
    if (!v.ok) {
      v.errors.forEach(function (e) { console.error("links.js: " + e); });
      return fail("Ошибка в links.js: " + v.errors[0], v.errors.length > 1 ? "Всего ошибок: " + v.errors.length : "", v.errors);
    }
    $("#refIc").innerHTML = I("refresh"); $("#sIc").outerHTML = I("search"); $("#clr").innerHTML = I("close"); $("#lock").innerHTML = I("lock");
    $("#gpBtn").innerHTML = I("panel"); $("#gpX").innerHTML = I("close"); $("#gsIc").outerHTML = I("search"); $("#gaIc").outerHTML = I("eye");
    $("#kbdK").textContent = isMac ? "⌘ K" : "Ctrl K";
    buildChips($("#fEnv"), [["", "Все"], ["PROM", "PROM", "--env-prom"], ["PSI", "ПСИ", "--env-psi"], ["IFT", "ИФТ", "--env-ift"]]);
    buildChips($("#fSeg"), [["", "Все"], ["ALPHA", "Alpha", "--seg-alpha"], ["SIGMA", "Sigma", "--seg-sigma"]]);
    RP.theme.paint();
    $("#theme").addEventListener("click", RP.theme.toggle);
    render(D);
    bindLinks(); bindTip(); bindSearch();
    $("#refresh").addEventListener("click", function () { check(); });
    var rT = 0; window.addEventListener("resize", function () { clearTimeout(rT); rT = setTimeout(layout, 120); });
    if (window.innerWidth >= 767) $("#q").focus(); else $("#q").placeholder = "Поиск ссылок";
    document.body.dataset.ready = "1";
    check(); RP.probe.every(RP.probe.INTERVAL, function () { check({ background: true }); });   // только в браузере, не в Node vm
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
