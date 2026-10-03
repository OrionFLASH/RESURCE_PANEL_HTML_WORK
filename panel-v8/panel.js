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

  // id разделов и ссылок попадают в разметку и селекторы — только безопасные символы
  var ID_RE = /^[a-z0-9_-]+$/i;
  var ID_HINT = "допустимы латиница, цифры, - и _";

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
      if (!ID_RE.test(s.id)) errors.push("Раздел №" + (i + 1) + ": id «" + s.id + "» — " + ID_HINT);
      if (secIds[s.id]) errors.push("Дубль id раздела: " + s.id);
      secIds[s.id] = true;
      if (!s.name) errors.push("Раздел " + s.id + ": нет name");
    });

    var ids = {};
    links.forEach(function (l, i) {
      var tag = "Ссылка " + (l && l.id ? l.id : "№" + (i + 1));
      if (!l || !l.id) { errors.push(tag + ": нет id"); return; }
      if (!ID_RE.test(l.id)) errors.push(tag + ": id «" + l.id + "» — " + ID_HINT);
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

    if (data.favoriteSeed != null && !Array.isArray(data.favoriteSeed)) errors.push("favoriteSeed: ожидается массив id ссылок");
    (Array.isArray(data.favoriteSeed) ? data.favoriteSeed : []).forEach(function (id) {
      if (!ids[id]) warnings.push("favoriteSeed: нет ссылки с id «" + id + "»");
    });
    if (data.adminScripts != null && !Array.isArray(data.adminScripts)) warnings.push("adminScripts: ожидается массив");
    (Array.isArray(data.adminScripts) ? data.adminScripts : []).forEach(function (a, i) {
      if (!a || !ID_RE.test(a.id || "") || !a.file) warnings.push("adminScripts №" + (i + 1) + ": нужны id (" + ID_HINT + ") и file");
    });
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  // Ошибки полей формы ссылки (редактор): { title?, url?, section? } — тексты для показа у поля
  function fieldErrors(l, data) {
    var e = {}, secs = (data && data.sections) || [];
    if (!String(l.title || "").trim()) e.title = "Укажите название";
    if (!secs.some(function (s) { return s.id === l.section; })) e.section = "Выберите раздел";
    if (!l.tool) {
      var u = String(l.url || "");
      if (!u.trim()) e.url = "Укажите адрес";
      else if (/\s/.test(u)) e.url = "В адресе не должно быть пробелов";
      else if (!/^https?:\/\//i.test(u)) e.url = "Адрес должен начинаться с http:// или https://";
      else if (!/^https?:\/\/[^\/?#:]+/i.test(u)) e.url = "В адресе нет хоста";
    }
    return e;
  }

  // Уникальный id из названия: транслитерация, латиница/цифры/дефис, до 40 символов
  var TR = { "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "",
    "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya" };
  function slug(text, taken) {
    var t = Array.isArray(taken) ? taken : Object.keys(taken || {});
    var s = String(text || "").toLowerCase().replace(/[а-яё]/g, function (c) { return TR[c]; })
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "link";
    if (t.indexOf(s) < 0) return s;
    for (var n = 2; ; n++) if (t.indexOf(s + "-" + n) < 0) return s + "-" + n;
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
    validate: validate, fieldErrors: fieldErrors, slug: slug, ID_RE: ID_RE, serializeLinks: serializeLinks, parseUrl: parseUrl, match: match,
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
  ICONS.up = '<path d="m5 12 5-5 5 5"/>';
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

    // Обработчик не должен обрывать цепочку проверки: исключение — в консоль, проверка идёт дальше
    function safe(f, a, b) {
      if (!f) return;
      try { f(a, b); } catch (e) { try { console.error(e); } catch (x) {} }
    }
    function run(links, h) {
      h = h || {};
      var list = (links || []).filter(function (l) { return l && l.url && /^https?:/i.test(l.url); });
      var token = {};
      running = token;
      var i = 0, done = 0, up = 0, total = list.length;
      list.forEach(function (l) { safe(h.onStart, l.id); });
      safe(h.onProgress, 0, total);
      return new Promise(function (resolve) {
        if (!total) { finish(); return; }
        function next() {
          if (running !== token) return;           // запущена новая проверка — эта больше не пишет
          if (i >= total) return;
          var l = list[i++];
          probeOne(l.url).then(function (res) {
            if (running !== token) return;
            done++; if (res.st === "up") up++;
            safe(h.onResult, l.id, res);
            safe(h.onProgress, done, total);
            if (done === total) finish(); else next();
          });
        }
        function finish() {
          var sum = { total: total, up: up, down: total - up, at: new Date() };
          safe(h.onDone, sum);
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
    off: null,             // id разделов, скрытых в указателе (rp_groups)
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
      if (S.off.indexOf(s.id) >= 0) sec.classList.add("off");
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
    if (!S.off) { S.off = RP.store.get("rp_groups", []); if (!Array.isArray(S.off)) S.off = []; }
    S.off = S.off.filter(function (id, i, a) { return S.secById[id] && a.indexOf(id) === i; });
    D.links.forEach(function (l) { S.byId[l.id] = l; if (!S.st[l.id] || S.st[l.id] === "local" || S.st[l.id] === "skip") S.st[l.id] = initialSt(l); });
    $("#subt").textContent = D.links.length + " рабочих ссылок · " + D.sections.length + " разделов";
    $("#cnt").textContent = D.links.length + " ссылок";
    buildIndex(); buildMeets(); buildDock(); buildGroups(); paintGroups(); renderSum();
    layout();
    if (S.apply) S.apply();
  }
  S.render = render;

  // ---------- Панель групп: развёрнута / узкая / скрыта; <767px — шторка ----------
  var RAILS = ["open", "compact", "hidden"];
  var RAIL_NAME = { open: "развёрнута", compact: "узкая", hidden: "скрыта" }, RAIL_NEXT = { open: "compact", compact: "hidden", hidden: "open" };
  var RAIL_TO = { open: "развёрнутой", compact: "узкой", hidden: "скрытой" };
  var railMem = null;   // запасное значение, если localStorage недоступен
  function railMode() {
    var r = railMem || RP.store.get("rp_rail", null);
    if (window.innerWidth < 767) return "drawer";
    return RAILS.indexOf(r) >= 0 ? r : window.innerWidth >= 1280 ? "open" : "compact";
  }
  function applyRail() {
    var m = railMode(), gp = $("#gp"), btn = $("#gpBtn");
    if (m !== "drawer" && layer === gp) closeLayer();
    gp.classList.remove("m-open", "m-compact", "m-hidden", "m-drawer", "peek"); gp.classList.add("m-" + m);
    document.body.style.setProperty("--pw", m === "open" ? "248px" : m === "compact" ? "60px" : "0px");
    btn.dataset.m = m;
    if (m === "drawer") {
      btn.setAttribute("aria-label", "Группы ссылок"); btn.title = "Группы ссылок";
      btn.setAttribute("aria-expanded", layer === gp ? "true" : "false");
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
    // Только если «глазом» скрыты все группы; иначе пустой результат — ветка «Ничего не нашлось»
    if (!secs.length && S.off.length && S.data.sections.every(function (s) { return S.off.indexOf(s.id) >= 0; })) {
      var z = document.createElement("div");
      z.className = "empty"; z.setAttribute("role", "status");
      z.innerHTML = "<b>Все группы скрыты</b>Включите нужные группы в панели слева или верните все сразу." +
        '<br><button class="btn" type="button" id="reset">Показать все группы</button>';
      idx.appendChild(z); $("#reset").addEventListener("click", function () { setOff([]); }); return;
    }
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
    }).then(fin, fin);
    function fin() {
      checking = false; btn.classList.remove("busy"); btn.removeAttribute("aria-busy"); btn.style.removeProperty("--p");
      try { renderSum(); } catch (e) { try { console.error(e); } catch (x) {} }
    }
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
  // quietFocus — служебный перенос фокуса (textarea и обратно): подсказку по focusin не показываем
  var quietFocus = false;
  function copyLegacy(text) {
    var ta = document.createElement("textarea"), back = document.activeElement, ok = false;
    quietFocus = true;
    ta.value = text; ta.setAttribute("readonly", ""); ta.setAttribute("aria-hidden", "true");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { ok = !!document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    if (back && back.focus && back !== document.body) try { back.focus({ preventScroll: true }); } catch (e) {}
    quietFocus = false;
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
      // Только фокус с клавиатуры: не после клика мышью, возврата во вкладку или служебного переноса фокуса
      var kb = true; try { kb = el.matches(":focus-visible"); } catch (e) {}
      if (quietFocus || !kb) return;
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
      if (((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyK" || (e.key || "").toLowerCase() === "k")) || (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey)) {
        if (layer || document.querySelector(".modal.on, .drawer.on")) return;
        e.preventDefault(); q.focus(); q.select();
      }
    });
  }

  // ---------- Слои: модальное окно, шторка групп (Esc / клик мимо закрывают, фокус удерживается внутри) ----------
  var layer = null, layerBack = null, layerOnClose = null;
  function focusables(el) {
    return $$("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], summary", el)
      .filter(function (x) { return x.offsetParent !== null; });
  }
  // opts: { focus?: элемент, onClose?(), noFocus?: true }
  function openLayer(el, opts) {
    opts = opts || {};
    if (layer && layer !== el) closeLayer(true);
    layerBack = layer === el ? layerBack : document.activeElement; layer = el; layerOnClose = opts.onClose || null; hideTip();
    $("#scrim").classList.add("on"); el.classList.add("on");
    if (opts.noFocus) return;
    var f = opts.focus || $("input, textarea, select", el) || focusables(el).filter(function (b) { return !b.classList.contains("x"); })[0] || focusables(el)[0];
    if (f) f.focus();
  }
  // keepFocus — не возвращать фокус (сразу открывается другой слой)
  function closeLayer(keepFocus) {
    if (!layer) return;
    var el = layer, cb = layerOnClose, back = layerBack;
    layer = null; layerOnClose = null; layerBack = null;
    el.classList.remove("on"); $("#scrim").classList.remove("on");
    if (cb) cb();
    if (keepFocus !== true && back && back.isConnected && back.focus) try { back.focus({ preventScroll: true }); } catch (e) {}
  }
  function trap(e) {
    var f = focusables(layer); if (!f.length) return;
    var a = document.activeElement, i = f.indexOf(a);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i < 0 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }
  function bindLayers() {
    $("#scrim").addEventListener("click", function () { closeLayer(); });
    document.addEventListener("keydown", function (e) {
      if (!layer) return;
      if (e.key === "Escape") { e.preventDefault(); closeLayer(); }
      else if (e.key === "Tab") trap(e);
    });
  }
  S.openLayer = openLayer; S.closeLayer = closeLayer;
  S.layer = function () { return layer; };

  // RP.modal.open(node | html, opts?) — стеклянное окно #modal с кнопкой «Закрыть» (крестик); RP.modal.close()
  RP.modal = {
    open: function (node, opts) {
      var m = $("#modal");
      m.innerHTML = '<button class="btn ic x" type="button" aria-label="Закрыть" title="Закрыть">' + I("close") + "</button>";
      if (typeof node === "string") m.insertAdjacentHTML("beforeend", node); else if (node) m.appendChild(node);
      $(".x", m).addEventListener("click", function () { RP.modal.close(); });
      openLayer(m, opts);
      return m;
    },
    close: function () { if (layer === $("#modal")) closeLayer(); },
    isOpen: function () { return layer === $("#modal"); }
  };

  // ---------- Панель групп: поведение ----------
  function paintGroups() {
    var gp = $("#gp"), off = S.off || [];
    $$(".gr", gp).forEach(function (li) {
      var id = li.dataset.sec, s = S.secById[id], o = off.indexOf(id) >= 0, n = S.secN[id] || 0, eye = $(".gr-eye", li);
      if (!s) return;
      li.classList.toggle("off", o); li.classList.toggle("zero", !o && !n);
      $(".ic b", li).textContent = n; $(".c", li).textContent = n;
      $(".gr-go", li).setAttribute("aria-label", s.name + ", ссылок: " + n + (o ? ", скрыта в списке" : ""));
      eye.innerHTML = I(o ? "eyeoff" : "eye"); eye.setAttribute("aria-pressed", o ? "false" : "true");
      eye.setAttribute("aria-label", (o ? "Показать" : "Скрыть") + " группу «" + s.name + "» в списке");
      eye.title = o ? "Показать в списке" : "Скрыть из списка";
    });
    var all = $("#gpAll"); all.hidden = !off.length;
    $("#gaN").textContent = "скрыто " + off.length;
    all.setAttribute("aria-label", "Показать все группы, скрыто " + off.length);
  }
  S.paintGroups = paintGroups;
  // Новый список скрытых разделов: запомнить, перестроить колонки
  function setOff(list) {
    S.off = list; RP.store.set("rp_groups", list);
    S.data.sections.forEach(function (s) { if (S.secEl[s.id]) S.secEl[s.id].classList.toggle("off", list.indexOf(s.id) >= 0); });
    paintGroups(); layout(); setActive(-1);
  }
  S.setOff = setOff;
  function toggleGroup(id) {
    var next = S.off.slice(), i = next.indexOf(id);
    if (i >= 0) next.splice(i, 1); else next.push(id);
    setOff(next);
  }
  // Alt+клик: оставить только эту группу; повторно — вернуть все
  function isolate(id) {
    var others = S.data.sections.map(function (s) { return s.id; }).filter(function (x) { return x !== id; });
    var only = S.off.length === others.length && S.off.indexOf(id) < 0;
    setOff(only ? [] : others);
    RP.toast(only ? "Показаны все группы" : "Только группа «" + S.secById[id].name + "»", "check");
  }
  function flash(el) {
    var rm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: document.body.classList.contains("fit") ? "nearest" : "start", behavior: rm ? "auto" : "smooth" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    clearTimeout(el._ft); el._ft = setTimeout(function () { el.classList.remove("flash"); }, 1100);
  }
  function gotoGroup(id) {
    if (layer === $("#gp")) closeLayer();
    if (S.off.indexOf(id) >= 0) setOff(S.off.filter(function (x) { return x !== id; }));
    var sec = S.secEl[id];
    if (!sec || sec.hidden) { RP.toast("В группе «" + S.secById[id].name + "» нет ссылок по текущему поиску", "info"); return; }
    requestAnimationFrame(function () { flash(sec); });
  }
  function bindGroups() {
    var gp = $("#gp"), gq = $("#gq"), gtip = $("#gtip"), peekT = 0;
    function hideGtip() { gtip.classList.remove("on"); }
    gp.addEventListener("click", function (e) {
      if (e.target.closest("#gpAll")) { setOff([]); return; }
      if (e.target.closest("#gpX")) { closeLayer(); return; }
      var li = e.target.closest(".gr");
      if (!li) return;
      hideGtip();
      if (e.target.closest(".gr-eye")) { toggleGroup(li.dataset.sec); return; }
      if (e.altKey) { e.preventDefault(); isolate(li.dataset.sec); return; }
      gotoGroup(li.dataset.sec);
    });
    // Поиск группы по названию (подстрока, без учёта регистра)
    gq.addEventListener("input", function () {
      var q = gq.value.trim().toLowerCase(), any = false;
      $$(".gr", gp).forEach(function (li) {
        var s = S.secById[li.dataset.sec], i = q ? s.name.toLowerCase().indexOf(q) : 0, on = i >= 0;
        li.hidden = !on; any = any || on;
        $(".nm", li).innerHTML = q && on ? esc(s.name.slice(0, i)) + "<mark>" + esc(s.name.slice(i, i + q.length)) + "</mark>" + esc(s.name.slice(i + q.length)) : esc(s.name);
      });
      $("#gpNone").hidden = any;
    });
    gq.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && gq.value) { e.preventDefault(); e.stopPropagation(); gq.value = ""; gq.dispatchEvent(new Event("input")); }
      else if (e.key === "Enter") { var f = $$(".gr", gp).filter(function (li) { return !li.hidden; })[0]; if (f) { e.preventDefault(); gotoGroup(f.dataset.sec); } }
    });
    // Кнопка панели: открыть шторку (<767px) или сменить состояние open → compact → hidden
    $("#gpBtn").addEventListener("click", function () {
      var m = railMode(), btn = $("#gpBtn");
      if (m === "drawer") {
        if (layer === gp) { closeLayer(); return; }
        openLayer(gp, { noFocus: true, onClose: function () { btn.setAttribute("aria-expanded", "false"); } });
        btn.setAttribute("aria-expanded", "true");
        setTimeout(function () { var f = $(".gr:not([hidden]) .gr-go", gp); if (layer === gp && f) f.focus(); }, 30);   // после смены visibility
        return;
      }
      railMem = RAIL_NEXT[m]; RP.store.set("rp_rail", railMem); layout();
    });
    // Узкая панель: подсказка с названием сразу, раскрытие поверх указателя — после задержки курсора
    gp.addEventListener("pointerover", function (e) {
      if (!gp.classList.contains("m-compact") || gp.classList.contains("peek") || e.pointerType === "touch") return hideGtip();
      var go = e.target.closest(".gr-go");
      if (!go) return hideGtip();
      var r = go.getBoundingClientRect(), id = go.parentNode.dataset.sec, sm = document.createElement("small");
      gtip.textContent = go.dataset.name; sm.textContent = S.off.indexOf(id) >= 0 ? "скрыта" : (S.secN[id] || 0); gtip.appendChild(sm);
      gtip.style.transform = "translate(" + Math.round(gp.getBoundingClientRect().right + 8) + "px," + Math.round(r.top + r.height / 2 - 15) + "px)";
      gtip.classList.add("on");
    });
    gp.addEventListener("mouseenter", function () {
      if (!gp.classList.contains("m-compact")) return;
      clearTimeout(peekT); peekT = setTimeout(function () { hideGtip(); gp.classList.add("peek"); }, 450);
    });
    gp.addEventListener("mouseleave", function () {
      clearTimeout(peekT); hideGtip();
      if (!gp.contains(document.activeElement)) gp.classList.remove("peek");
    });
    // Узкая панель обрезает строки по ширине: не даём фокусу/прокрутке сдвинуть их вбок
    [$(".gp-in", gp), $("#gpList"), $(".gp-top", gp)].forEach(function (el) { el.addEventListener("scroll", function () { if (el.scrollLeft) el.scrollLeft = 0; }); });
    gp.addEventListener("focusin", function () { if (gp.classList.contains("m-compact")) { hideGtip(); gp.classList.add("peek"); } });
    gp.addEventListener("focusout", function (e) { if (!gp.contains(e.relatedTarget) && !gp.matches(":hover")) gp.classList.remove("peek"); });
  }

  // ---------- Встроенные инструменты (§7) ----------
  var ROLE_EMP = "673892", ROLE_NAME = "EFS_NB_SUP_BUSINESS_ADMIN_GAMIFICATION";
  var ROLE_URL = "https://iam-enigma-psi.omega.sbrf.ru/rmkib.support/api/v1/service/auth/explain/html";
  function decoderForm(l) {
    var box = document.createElement("div");
    box.innerHTML = '<h2 id="mTitle"></h2><p>Ввод HEX через запятую → двоичное представление по 8 бит и список включённых битов.</p>' +
      '<label class="f">Значение permission (HEX)<textarea id="tIn" spellcheck="false" placeholder="Например: 43720e3f, 5228"></textarea></label>' +
      '<div class="out" id="tOut" role="status" hidden></div>' +
      '<div class="row"><button class="btn" type="button" id="tClear">Очистить</button><button class="btn" type="button" id="tClose">Закрыть</button>' +
      '<button class="btn pri" type="button" id="tGo">Расшифровать</button></div>';
    $("#mTitle", box).textContent = l.title;
    var inp = $("#tIn", box), out = $("#tOut", box);
    function run() {
      var text;
      try {
        var r = RP.core.decodePermission(inp.value);
        text = "Бинарное представление:\n" + r.binary + "\n\nВключённые биты:\n" + r.bits.join(", ");
        out.classList.remove("err");
      } catch (e) { text = "Ошибка! Некорректный ввод."; out.classList.add("err"); }
      out.textContent = text; out.hidden = false;
    }
    $("#tGo", box).addEventListener("click", run);
    $("#tClear", box).addEventListener("click", function () { inp.value = ""; out.textContent = ""; out.hidden = true; inp.focus(); });
    $("#tClose", box).addEventListener("click", function () { RP.modal.close(); });
    // Ctrl/⌘+Enter — расшифровать
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
    return box;
  }
  function roleForm(l) {
    var box = document.createElement("div");
    box.innerHTML = '<h2 id="mTitle"></h2><p>Открывает на стенде ПСИ объяснение, есть ли у сотрудника роль.</p>' +
      '<label class="f">Табельный номер<input id="tEmp" inputmode="numeric" autocomplete="off" spellcheck="false"></label>' +
      '<label class="f">Роль<input id="tRole" autocomplete="off" spellcheck="false"></label>' +
      '<div class="row"><button class="btn" type="button" id="tDef">По умолчанию</button><button class="btn" type="button" id="tClose">Закрыть</button>' +
      '<button class="btn pri" type="button" id="tOpen">Открыть</button></div>';
    $("#mTitle", box).textContent = l.title;
    var emp = $("#tEmp", box), role = $("#tRole", box), go = $("#tOpen", box);
    function sync() { go.disabled = !(emp.value.trim() && role.value.trim()); }
    function open() {
      if (go.disabled) return;
      window.open(ROLE_URL + "?employee-number=" + encodeURIComponent(emp.value.trim()) + "&role=" + encodeURIComponent(role.value.trim()), "_blank", "noopener");
    }
    emp.value = ROLE_EMP; role.value = ROLE_NAME; sync();
    emp.addEventListener("input", sync); role.addEventListener("input", sync);
    [emp, role].forEach(function (i) { i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); open(); } }); });
    go.addEventListener("click", open);
    $("#tDef", box).addEventListener("click", function () { emp.value = ROLE_EMP; role.value = ROLE_NAME; sync(); emp.focus(); });
    $("#tClose", box).addEventListener("click", function () { RP.modal.close(); });
    return box;
  }
  RP.tools = {
    open: function (l) {
      var f = l.tool === "decoder" ? decoderForm : l.tool === "role" ? roleForm : null;
      if (f) RP.modal.open(f(l));
    }
  };

  // ---------- Администрирование (§8): шторка за замком — редактор ссылок и площадка скриптов ----------
  // Редактор правит рабочую копию данных в памяти; страница перерисовывается сразу; сохранение — только выгрузкой links.js.
  (function () {
    var A = {
      base: null,     // последняя сохранённая версия (загруженная или скачанная)
      work: null,     // рабочая копия — её показывает страница после первой правки
      shown: null,    // снимок того, что сейчас отрисовано (для сброса статусов изменённых ссылок)
      n: 0, tab: "links", view: "list", edit: null, q: "", sec: "", secPick: null,
      open: { secs: false, seed: false }, scripts: {},
      draft: null     // черновик открытой формы ссылки: переживает Esc, клик мимо и смену вкладки
    };
    var ENV_OPT = [["", "—"], ["PROM", "PROM"], ["PSI", "ПСИ"], ["IFT", "ИФТ"]];
    var SEG_OPT = [["", "—"], ["ALPHA", "Alpha"], ["SIGMA", "Sigma"]];
    var OWN = ["id", "section", "title", "url", "env", "seg", "copy", "icon", "note", "meet", "tool", "check"];
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function W() { return A.work; }
    function idxOf(id) { for (var i = 0; i < W().links.length; i++) if (W().links[i].id === id) return i; return -1; }
    function linkById(id) { return W().links[idxOf(id)]; }
    function secName(id) { for (var i = 0; i < W().sections.length; i++) if (W().sections[i].id === id) return W().sections[i].name; return id; }
    function plural(n, a, b, c) { var m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; }
    function opts(list, val) {
      return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === (val || "") ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
    }
    function ib(cls, icon, label, k, dis) {
      return '<button class="btn ic ' + cls + '" type="button" aria-label="' + esc(label) + '" title="' + esc(label) + '" data-k="' + esc(k) + '"' + (dis ? " disabled" : "") + ">" + I(icon) + "</button>";
    }
    function init() {
      if (A.work) return;
      A.base = clone(S.data); A.work = clone(S.data); A.shown = clone(S.data);
    }

    // ----- Изменения: счётчик, предупреждение при закрытии вкладки, перерисовка страницы -----
    function onUnload(e) { e.preventDefault(); e.returnValue = ""; return ""; }
    function paintDirty() {
      window.onbeforeunload = A.n ? onUnload : null;
      var el = $("#aDirty"); if (!el) return;
      el.textContent = "Несохранённых изменений: " + A.n; el.classList.toggle("on", !!A.n);
      $("#aRevert").disabled = !A.n;
      var v = RP.core.validate(W()), box = $("#aVal");
      $("#aDown").disabled = !v.ok;
      box.innerHTML = v.errors.concat(v.warnings).map(function (x, i) { return '<li class="' + (i < v.errors.length ? "err" : "") + '">' + esc(x) + "</li>"; }).join("");
      box.hidden = !box.children.length;
    }
    var reT = 0;
    function recheck() { clearTimeout(reT); if (!S.check()) reT = setTimeout(recheck, 1000); }   // идёт проверка — повторить после
    // Применить рабочую копию: статусы изменённых/новых ссылок сбрасываются и перепроверяются
    // light — без перерисовки списка админки (переименование раздела: ожидающий клик не теряется)
    function apply(counted, light) {
      var prev = {}, again = false;
      (A.shown.links || []).forEach(function (l) { prev[l.id] = l; });
      W().links.forEach(function (l) {
        var p = prev[l.id];
        if (p && p.url === l.url && p.check === l.check && p.tool === l.tool) return;
        RP.status.set(l.id, undefined); delete S.st[l.id];
        if (checkable(l)) again = true;
      });
      if (counted) A.n = RP.core.serializeLinks(W()) === RP.core.serializeLinks(A.base) ? 0 : A.n + 1;
      render(W()); A.shown = clone(W());
      if (again) recheck();
      paintDirty(); if (!light) paintBody();
    }
    function commit() { apply(true); }

    // ----- Шторка -----
    function build() {
      var d = $("#drawer");
      d.classList.add("adm");
      d.innerHTML = '<button class="btn ic x" type="button" aria-label="Закрыть" title="Закрыть">' + I("close") + "</button>" +
        '<h2 id="dTitle">Администрирование</h2><p>Правки видны на странице сразу и живут до перезагрузки — сохраните их, скачав links.js.</p>' +
        '<div class="atabs" role="tablist" aria-label="Разделы администрирования">' +
        '<button type="button" role="tab" id="atLinks" aria-controls="apLinks">Ссылки</button>' +
        '<button type="button" role="tab" id="atScripts" aria-controls="apScripts">Скрипты</button></div>' +
        '<div role="tabpanel" id="apLinks" aria-labelledby="atLinks">' +
        '<div class="abar"><span class="adirty" id="aDirty" role="status"></span>' +
        '<button class="btn" type="button" id="aRevert">' + I("refresh") + "Отменить изменения</button>" +
        '<button class="btn pri" type="button" id="aDown">' + I("export") + "Скачать links.js</button></div>" +
        '<p class="ahint">Браузер не может записать файл с диска: скачайте links.js и замените файл рядом с index.html.</p>' +
        '<ul class="aval" id="aVal" hidden></ul><div id="aBody"></div></div>' +
        '<div role="tabpanel" id="apScripts" aria-labelledby="atScripts" hidden></div>';
      $(".x", d).addEventListener("click", function () { closeLayer(); });
      $("#aDown").addEventListener("click", download);
      $("#aRevert").addEventListener("click", revert);
      var tabs = [$("#atLinks"), $("#atScripts")];
      tabs.forEach(function (t, i) {
        t.addEventListener("click", function () { setTab(i ? "scripts" : "links"); });
        t.addEventListener("keydown", function (e) {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault(); var o = tabs[1 - i]; o.click(); o.focus();
        });
      });
      $("#aBody").addEventListener("click", onBodyClick);
      setTab(A.tab); paintDirty();
    }
    function setTab(t) {
      A.tab = t;
      var links = t === "links";
      $("#atLinks").setAttribute("aria-selected", links ? "true" : "false"); $("#atLinks").tabIndex = links ? 0 : -1;
      $("#atScripts").setAttribute("aria-selected", links ? "false" : "true"); $("#atScripts").tabIndex = links ? -1 : 0;
      $("#apLinks").hidden = !links; $("#apScripts").hidden = links;
      if (links) paintBody(); else paintScripts();
    }
    function openAdmin() {
      if (!S.data) return;
      init(); A.secPick = null;
      // Незаконченная форма открывается снова с введёнными значениями
      if (A.draft) { A.view = "form"; A.edit = A.draft.edit; } else { A.view = "list"; A.edit = null; }
      build();
      var lock = $("#lock");
      openLayer($("#drawer"), { onClose: function () { lock.innerHTML = I("lock"); lock.setAttribute("aria-expanded", "false"); } });
      lock.innerHTML = I("unlock"); lock.setAttribute("aria-expanded", "true");
    }

    // Перерисовка содержимого вкладки «Ссылки» с сохранением фокуса (data-k)
    function paintBody() {
      var body = $("#aBody");
      if (!body || A.tab !== "links") return;
      var a = document.activeElement, k = a && body.contains(a) && a.dataset ? a.dataset.k : null;
      var sc = $("#drawer").scrollTop;
      // Состояние раскрытия «Разделы» / «Избранное» берём из DOM: событие toggle приходит асинхронно
      if ($("#aSecs", body)) A.open.secs = $("#aSecs", body).open;
      if ($("#aSeed", body)) A.open.seed = $("#aSeed", body).open;
      if (A.view === "form") formView(body); else listView(body);
      $("#drawer").scrollTop = sc;
      if (k) { var f = $('[data-k="' + (window.CSS && CSS.escape ? CSS.escape(k) : k) + '"]', body); if (f) f.focus({ preventScroll: true }); }
    }

    // ----- Список ссылок: поиск, фильтр по разделу, разделы и стартовое избранное -----
    function listView(body) {
      var D = W();
      body.innerHTML =
        '<div class="atools"><label class="as">' + I("search") + '<span class="sr">Найти ссылку в редакторе</span>' +
        '<input id="aQ" type="search" autocomplete="off" spellcheck="false" placeholder="Название, адрес или id" data-k="q"></label>' +
        '<label class="sr" for="aSec">Раздел</label><select id="aSec" data-k="sec">' +
        opts([["", "Все разделы"]].concat(D.sections.map(function (s) { return [s.id, s.name]; })), A.sec) + "</select>" +
        '<button class="btn pri" type="button" id="aAdd" data-k="add">' + I("plus") + "Добавить</button></div>" +
        '<ul class="alist" id="aList" aria-label="Ссылки"></ul>' +
        '<details class="adet" id="aSecs"' + (A.open.secs ? " open" : "") + "><summary>Разделы <em>" + D.sections.length + "</em></summary>" + secsHtml() + "</details>" +
        '<details class="adet" id="aSeed"' + (A.open.seed ? " open" : "") + "><summary>Стартовое избранное <em>" + (D.favoriteSeed || []).length + "</em></summary>" + seedHtml() + "</details>";
      var q = $("#aQ", body); q.value = A.q;
      q.addEventListener("input", function () { A.q = q.value; paintRows(); });
      $("#aSec", body).addEventListener("change", function (e) { A.sec = e.target.value; paintRows(); });
      $("#aAdd", body).addEventListener("click", function () { A.view = "form"; A.edit = null; paintBody(); });
      $$(".s-name", body).forEach(function (inp) {
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); renameSec(inp); } });
        inp.addEventListener("change", function () { renameSec(inp); });
      });
      var sNew = $("#sNew", body);
      sNew.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addSec(); } });
      paintRows();
    }
    function paintRows() {
      var D = W(), q = A.q.trim().toLowerCase(), html = "", any = false;
      D.sections.forEach(function (s) {
        if (A.sec && A.sec !== s.id) return;
        var all = D.links.filter(function (l) { return l.section === s.id; });
        var rows = all.filter(function (l) { return !q || (l.title + " " + (l.url || "") + " " + l.id).toLowerCase().indexOf(q) >= 0; });
        if (!rows.length) return;
        any = true;
        html += '<li class="ahd">' + I(RP.icons.has(s.icon) ? s.icon : "link") + "<span>" + esc(s.name) + "</span></li>";
        rows.forEach(function (l) {
          var i = all.indexOf(l);
          html += '<li class="arow" data-lid="' + esc(l.id) + '">' +
            '<button class="a-open" type="button" data-k="o:' + esc(l.id) + '" aria-label="Изменить «' + esc(l.title) + '»">' + I(S.iconOf(l)) +
            '<span class="at">' + esc(l.title) + "</span>" + (l.meet ? '<span class="ab">встреча</span>' : "") + (l.tool ? '<span class="ab">инструмент</span>' : "") +
            (l.copy ? I("copy", "ui-i cp") : "") + tagsHtml(l) + "</button>" +
            ib("a-up", "up", "Выше: «" + l.title + "»", "u:" + l.id, i === 0) +
            ib("a-dn", "down", "Ниже: «" + l.title + "»", "d:" + l.id, i === all.length - 1) +
            ib("a-del", "trash", "Удалить «" + l.title + "»", "x:" + l.id) + "</li>";
        });
      });
      $("#aList").innerHTML = any ? html : '<li class="anone">Нет ссылок' + (q ? " по запросу «" + esc(A.q.trim()) + "»" : "") + "</li>";
    }
    function secsHtml() {
      var D = W(), cnt = {};
      D.links.forEach(function (l) { cnt[l.section] = (cnt[l.section] || 0) + 1; });
      return '<ul class="slist">' + D.sections.map(function (s, i) {
        var n = cnt[s.id] || 0, open = A.secPick === s.id;
        return '<li class="srow" data-sid="' + esc(s.id) + '">' +
          '<button class="btn ic s-ic" type="button" aria-expanded="' + open + '" aria-label="Иконка раздела «' + esc(s.name) + '»" title="Сменить иконку" data-k="si:' + esc(s.id) + '">' + I(RP.icons.has(s.icon) ? s.icon : "link") + "</button>" +
          '<input class="s-name" value="' + esc(s.name) + '" aria-label="Название раздела «' + esc(s.name) + '»" spellcheck="false" data-k="sn:' + esc(s.id) + '">' +
          '<span class="s-n" title="Ссылок в разделе">' + n + "</span>" +
          ib("s-up", "up", "Раздел выше: «" + s.name + "»", "su:" + s.id, i === 0) +
          ib("s-dn", "down", "Раздел ниже: «" + s.name + "»", "sd:" + s.id, i === D.sections.length - 1) +
          ib("s-del", "trash", n ? "Удалить можно только пустой раздел" : "Удалить раздел «" + s.name + "»", "sx:" + s.id, n > 0) +
          (open ? pickHtml(s.icon, false, "Иконка раздела «" + s.name + "»") : "") + "</li>";
      }).join("") + "</ul>" +
        '<div class="sadd"><label class="sr" for="sNew">Название нового раздела</label><input id="sNew" placeholder="Новый раздел" autocomplete="off" data-k="sNew">' +
        '<button class="btn" type="button" id="sAdd" data-k="sAdd">' + I("plus") + "Добавить раздел</button></div>";
    }
    function seedHtml() {
      var D = W(), seed = D.favoriteSeed || [];
      var free = D.links.filter(function (l) { return !l.meet && !l.tool && seed.indexOf(l.id) < 0; });
      return '<p class="ahint">Показываются в «Избранном», пока нет кликов (до 9). Встречи и инструменты туда не попадают.</p>' +
        '<ol class="flist">' + seed.map(function (id, i) {
          var l = D.links[idxOf(id)];
          return '<li data-fid="' + esc(id) + '"><span class="at">' + (l ? esc(l.title) + tagsHtml(l) : esc(id) + ' <span class="ab err">нет такой ссылки</span>') + "</span>" +
            ib("f-up", "up", "Выше в избранном", "fu:" + id, i === 0) + ib("f-dn", "down", "Ниже в избранном", "fd:" + id, i === seed.length - 1) +
            ib("f-del", "close", "Убрать из избранного", "fx:" + id) + "</li>";
        }).join("") + "</ol>" +
        '<div class="sadd"><label class="sr" for="fsAdd">Ссылка для избранного</label><select id="fsAdd" data-k="fsAdd"><option value="">Выберите ссылку…</option>' +
        D.sections.map(function (s) {
          var ls = free.filter(function (l) { return l.section === s.id; });
          return ls.length ? '<optgroup label="' + esc(s.name) + '">' + ls.map(function (l) {
            return '<option value="' + esc(l.id) + '">' + esc(l.title) + (l.env ? " · " + ENV_LBL[l.env] : "") + (l.seg ? " · " + SEG_LBL[l.seg] : "") + "</option>";
          }).join("") + "</optgroup>" : "";
        }).join("") + '</select><button class="btn" type="button" id="fsAddBtn" data-k="fsAddBtn">' + I("plus") + "Добавить</button></div>";
    }
    function pickHtml(cur, withDefault, label) {
      return '<div class="ipick" role="group" aria-label="' + esc(label) + '">' +
        (withDefault ? '<button type="button" class="ip-def" data-icon="" aria-pressed="' + !cur + '" title="Как у раздела">как у раздела</button>' : "") +
        RP.icons.names().map(function (n) {
          return '<button type="button" data-icon="' + n + '" aria-pressed="' + (cur === n) + '" aria-label="' + n + '" title="' + n + '">' + I(n) + "</button>";
        }).join("") + "</div>";
    }
    function swap(arr, i, j) { if (j < 0 || j >= arr.length) return false; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true; }
    // Сдвиг ссылки внутри её раздела (порядок в массиве = порядок вывода)
    function moveLink(id, dir) {
      var L = W().links, i = idxOf(id), j = i + dir;
      while (j >= 0 && j < L.length && L[j].section !== L[i].section) j += dir;
      if (swap(L, i, j)) commit();
    }
    function onBodyClick(e) {
      var b = e.target.closest("button"); if (!b || b.disabled) return;
      var D = W(), row = b.closest("[data-lid]"), srow = b.closest("[data-sid]"), frow = b.closest("[data-fid]");
      if (row) {
        var id = row.dataset.lid;
        if (b.classList.contains("a-open")) { A.view = "form"; A.edit = id; paintBody(); }
        else if (b.classList.contains("a-up")) moveLink(id, -1);
        else if (b.classList.contains("a-dn")) moveLink(id, 1);
        else if (b.classList.contains("a-del")) {
          var l = linkById(id);
          D.links.splice(idxOf(id), 1);
          D.favoriteSeed = (D.favoriteSeed || []).filter(function (x) { return x !== id; });
          commit(); RP.toast("Удалено: " + l.title, "trash");
        }
        return;
      }
      if (srow) {
        var sid = srow.dataset.sid, si = D.sections.map(function (s) { return s.id; }).indexOf(sid);
        if (b.classList.contains("s-ic")) { A.secPick = A.secPick === sid ? null : sid; paintBody(); }
        else if (b.dataset.icon != null && b.closest(".ipick")) { D.sections[si].icon = b.dataset.icon; A.secPick = null; commit(); var f = $('[data-k="si:' + sid + '"]'); if (f) f.focus(); }
        else if (b.classList.contains("s-up")) { if (swap(D.sections, si, si - 1)) commit(); }
        else if (b.classList.contains("s-dn")) { if (swap(D.sections, si, si + 1)) commit(); }
        else if (b.classList.contains("s-del")) { var nm = D.sections[si].name; D.sections.splice(si, 1); if (A.sec === sid) A.sec = ""; commit(); RP.toast("Раздел удалён: " + nm, "trash"); }
        return;
      }
      if (frow) {
        var seed = D.favoriteSeed, fi = seed.indexOf(frow.dataset.fid);
        if (b.classList.contains("f-up")) { if (swap(seed, fi, fi - 1)) commit(); }
        else if (b.classList.contains("f-dn")) { if (swap(seed, fi, fi + 1)) commit(); }
        else if (b.classList.contains("f-del")) { seed.splice(fi, 1); commit(); }
        return;
      }
      if (b.id === "sAdd") addSec();
      else if (b.id === "fsAddBtn") {
        var v = $("#fsAdd").value; if (!v) { $("#fsAdd").focus(); return; }
        D.favoriteSeed = (D.favoriteSeed || []).concat([v]); commit();
      }
    }
    function renameSec(inp) {
      var sid = inp.closest("[data-sid]").dataset.sid, s = W().sections.filter(function (x) { return x.id === sid; })[0];
      if (!s) return;
      var v = inp.value.trim();
      if (!v) { inp.value = s.name; RP.toast("Название раздела не может быть пустым", "alert"); return; }
      if (v === s.name) return;
      s.name = v; apply(true, true);
      // Подписи с названием раздела обновляем на месте, не пересоздавая строки
      var row = inp.closest("[data-sid]"), lb = function (sel, t) { var b = $(sel, row); if (b) { b.setAttribute("aria-label", t); if (b.title && sel !== ".s-ic") b.title = t; } };
      inp.setAttribute("aria-label", "Название раздела «" + v + "»");
      lb(".s-ic", "Иконка раздела «" + v + "»"); lb(".s-up", "Раздел выше: «" + v + "»"); lb(".s-dn", "Раздел ниже: «" + v + "»");
      if (!$(".s-del", row).disabled) lb(".s-del", "Удалить раздел «" + v + "»");
      var pk = $(".ipick", row); if (pk) pk.setAttribute("aria-label", "Иконка раздела «" + v + "»");
      $$("#aSec option").forEach(function (o) { if (o.value === sid) o.textContent = v; });
      $$("#fsAdd optgroup").forEach(function (g) {
        var first = g.querySelector("option"), l = first && linkById(first.value);
        if (l && l.section === sid) g.label = v;
      });
      paintRows();
    }
    function addSec() {
      var inp = $("#sNew"), v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      var id = RP.core.slug(v, W().sections.map(function (s) { return s.id; }));
      W().sections.push({ id: id, name: v, icon: "link" });
      commit(); RP.toast("Раздел добавлен: " + v, "check");
    }

    // ----- Форма ссылки -----
    function fld(id, label, input, err) {
      return '<label class="f" for="' + id + '">' + label + input + "</label>" + (err ? '<small class="fe" id="' + id + 'Err" aria-live="polite"></small>' : "");
    }
    function formView(body) {
      var D = W(), cur = A.edit ? linkById(A.edit) : null;
      if (A.edit && !cur) { A.view = "list"; A.draft = null; return listView(body); }
      var l = cur ? clone(cur) : { id: "", section: A.sec || (D.sections[D.sections.length - 1] || {}).id, title: "", url: "" };
      if (!cur && !A.sec) { var last = D.sections.filter(function (s) { return s.id !== "tools"; }).pop(); if (last) l.section = last.id; }
      body.innerHTML =
        '<div class="afh"><button class="btn ic" type="button" id="eBack" aria-label="К списку ссылок" title="К списку">' + I("left") + "</button>" +
        "<h3>" + (cur ? "Изменить ссылку" : "Новая ссылка") + "</h3>" + (cur ? '<small class="aid">id: <code>' + esc(cur.id) + "</code></small>" : '<small class="aid">id создаётся из названия</small>') + "</div>" +
        '<form id="eForm" novalidate>' +
        fld("eTitle", "Название", '<input id="eTitle" autocomplete="off" aria-describedby="eTitleErr">', true) +
        (l.tool ? '<p class="ahint">Встроенный инструмент «' + esc(l.tool) + "» — адрес не нужен.</p>"
          : fld("eUrl", "Адрес (http/https)", '<input id="eUrl" autocomplete="off" spellcheck="false" inputmode="url" aria-describedby="eUrlErr">', true)) +
        fld("eSec", "Раздел", '<select id="eSec" aria-describedby="eSecErr">' + opts(D.sections.map(function (s) { return [s.id, s.name]; }), l.section) + "</select>", true) +
        '<div class="f2">' + fld("eEnv", "Стенд", '<select id="eEnv">' + opts(ENV_OPT, l.env) + "</select>") +
        fld("eSeg", "Сегмент", '<select id="eSeg">' + opts(SEG_OPT, l.seg) + "</select>") + "</div>" +
        fld("eCopy", "Код копирования (в буфер при клике)", '<input id="eCopy" autocomplete="off" spellcheck="false">') +
        '<div class="f" id="eIconL">Иконка' + pickHtml(RP.icons.has(l.icon) ? l.icon : "", true, "Иконка ссылки").replace('class="ipick"', 'class="ipick" id="eIcon"') + "</div>" +
        fld("eNote", "Комментарий (в подсказке)", '<textarea id="eNote" rows="2"></textarea>') +
        '<label class="sw"><input type="checkbox" id="eMeet"' + (l.meet ? " checked" : "") + "> Встреча Jazz — показывать в полосе «Встречи»</label>" +
        (l.tool ? "" : '<label class="sw"><input type="checkbox" id="eNoCheck"' + (l.check === false ? " checked" : "") + "> Не проверять доступность</label>") +
        '<p class="fe" id="eErr" aria-live="polite"></p>' +
        '<div class="row"><button class="btn" type="button" id="eCancel">Отмена</button><button class="btn pri" type="submit" id="eSave">' + I("check") + "Сохранить</button></div></form>";
      $("#eTitle").value = l.title || ""; if ($("#eUrl")) $("#eUrl").value = l.url || "";
      $("#eCopy").value = l.copy || ""; $("#eNote").value = l.note || "";
      var form = $("#eForm"), icon = RP.icons.has(l.icon) ? l.icon : "";
      var DF = ["eTitle", "eUrl", "eSec", "eEnv", "eSeg", "eCopy", "eNote"], DC = ["eMeet", "eNoCheck"];
      // Черновик: значения полей формы до «Сохранить» / «Отмена»
      function keep() {
        var d = { edit: A.edit, v: {}, c: {}, t: [], icon: icon };
        DF.forEach(function (id) { var e = $("#" + id); if (e) { d.v[id] = e.value; if (e.dataset.touched) d.t.push(id); } });
        DC.forEach(function (id) { var e = $("#" + id); if (e) d.c[id] = e.checked; });
        A.draft = d;
      }
      if (A.draft && A.draft.edit === A.edit) {
        var d = A.draft;
        DF.forEach(function (id) { var e = $("#" + id); if (e && d.v[id] != null) e.value = d.v[id]; });
        DC.forEach(function (id) { var e = $("#" + id); if (e && d.c[id] != null) e.checked = d.c[id]; });
        d.t.forEach(function (id) { var e = $("#" + id); if (e) e.dataset.touched = "1"; });
        icon = d.icon;
        $$("[data-icon]", $("#eIcon")).forEach(function (x) { x.setAttribute("aria-pressed", x.dataset.icon === icon ? "true" : "false"); });
      } else A.draft = null;
      function read() {
        var o = { id: cur ? cur.id : "" };
        o.section = $("#eSec").value; o.title = $("#eTitle").value.trim();
        if (l.tool) o.tool = l.tool; else o.url = $("#eUrl").value.trim();
        var env = $("#eEnv").value, seg = $("#eSeg").value, cp = $("#eCopy").value.trim(), nt = $("#eNote").value.trim();
        if (env) o.env = env; if (seg) o.seg = seg; if (cp) o.copy = cp; if (icon) o.icon = icon; if (nt) o.note = nt;
        if ($("#eMeet").checked) o.meet = true;
        if ($("#eNoCheck") && $("#eNoCheck").checked) o.check = false;
        // Неизвестные поля ссылки сохраняются как были
        if (cur) Object.keys(cur).forEach(function (k) { if (OWN.indexOf(k) < 0) o[k] = cur[k]; });
        if (!o.id) o.id = RP.core.slug(o.title || "link", D.links.map(function (x) { return x.id; }));
        return o;
      }
      // Сборка данных с этой ссылкой (без изменения рабочей копии)
      function draft(o) {
        var d = clone(D), i = cur ? idxOf(cur.id) : -1;
        if (i >= 0 && d.links[i].section === o.section) { d.links[i] = o; return d; }
        if (i >= 0) d.links.splice(i, 1);
        // новая ссылка или смена раздела — в конец раздела
        var at = -1; d.links.forEach(function (x, j) { if (x.section === o.section) at = j; });
        d.links.splice(at < 0 ? d.links.length : at + 1, 0, o);
        return d;
      }
      function check() {
        var o = read(), fe = RP.core.fieldErrors(o, D), bad = false;
        [["title", "eTitle"], ["url", "eUrl"], ["section", "eSec"]].forEach(function (p) {
          var inp = $("#" + p[1]), msg = $("#" + p[1] + "Err");
          if (!inp || !msg) return;
          var shown = fe[p[0]] && (inp.dataset.touched || p[0] === "section");
          msg.textContent = shown ? fe[p[0]] : "";
          if (fe[p[0]]) inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid");
          bad = bad || !!fe[p[0]];
        });
        var v = bad ? null : RP.core.validate(draft(o));
        $("#eErr").textContent = v && !v.ok ? v.errors[0] : "";
        $("#eSave").disabled = bad || !!(v && !v.ok);
        return !$("#eSave").disabled && o;
      }
      form.addEventListener("input", function (e) { if (e.target.id) e.target.dataset.touched = "1"; check(); keep(); });
      form.addEventListener("change", function (e) { if (e.target.id) e.target.dataset.touched = "1"; check(); keep(); });
      $("#eIcon").addEventListener("click", function (e) {
        var b = e.target.closest("[data-icon]"); if (!b) return;
        icon = b.dataset.icon;
        $$("[data-icon]", this).forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        check(); keep();
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        ["eTitle", "eUrl"].forEach(function (id) { if ($("#" + id)) $("#" + id).dataset.touched = "1"; });
        var o = check(); if (!o) { var bad = $('[aria-invalid="true"]', form); if (bad) bad.focus(); return; }
        A.work = draft(o); A.view = "list"; A.edit = null; A.draft = null;
        commit();
        var f = $('[data-k="o:' + o.id + '"]'); if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: "nearest" }); }
        RP.toast(cur ? "Изменения применены: " + o.title : "Ссылка добавлена: " + o.title, "check");
      });
      function back() { var id = cur && cur.id; A.draft = null; A.view = "list"; A.edit = null; paintBody(); var f = id && $('[data-k="o:' + id + '"]'); if (f) f.focus(); }
      $("#eCancel").addEventListener("click", back); $("#eBack").addEventListener("click", back);
      if (cur) { $("#eTitle").dataset.touched = "1"; if ($("#eUrl")) $("#eUrl").dataset.touched = "1"; }
      check();
      $("#eTitle").focus();
    }

    // ----- Выгрузка и отмена -----
    function download() {
      var v = RP.core.validate(W());
      if (!v.ok) { RP.toast("Сначала исправьте ошибки: " + v.errors[0], "alert"); return; }
      var blob = new Blob([RP.core.serializeLinks(W())], { type: "text/javascript;charset=utf-8" });
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "links.js"; a.hidden = true;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      A.base = clone(W()); A.n = 0; paintDirty();
      RP.toast("links.js скачан — замените файл рядом с index.html", "export");
    }
    function revert() {
      A.work = clone(A.base); A.n = 0; A.view = "list"; A.edit = null; A.secPick = null; A.draft = null;
      apply(false);
      RP.toast("Изменения отменены", "refresh");
    }

    // ----- Вкладка «Скрипты»: реестр adminScripts, загрузка файла, копирование отдельным кликом -----
    function loadScript(entry) {
      return new Promise(function (resolve, reject) {
        var id = entry && entry.id, file = entry && entry.file;
        if (!file) { reject(new Error("У скрипта «" + id + "» не указан файл (file)")); return; }
        if (window.RP_ADMIN && Object.prototype.hasOwnProperty.call(window.RP_ADMIN, id)) delete window.RP_ADMIN[id];   // берём свежую версию файла
        var s = document.createElement("script");
        s.src = file;
        s.onload = function () {
          s.remove();
          var r = window.RP_ADMIN && Object.prototype.hasOwnProperty.call(window.RP_ADMIN, id) ? window.RP_ADMIN[id] : null;
          if (r && typeof r.code === "string") resolve({ title: String(r.title || entry.title || id), code: r.code });
          else reject(new Error("Файл " + file + " загружен, но не задаёт RP_ADMIN[\"" + id + "\"] с полем code"));
        };
        s.onerror = function () { s.remove(); reject(new Error("Не удалось загрузить " + file + " — проверьте, что файл лежит по этому пути рядом с index.html")); };
        document.head.appendChild(s);
      });
    }
    function paintScripts() {
      var box = $("#apScripts"), list = Array.isArray(W().adminScripts) ? W().adminScripts : [];
      if (!list.length) {
        box.innerHTML = '<div class="es">' + I("bundle") + "<b>Скриптов пока нет</b>" +
          "Скрипт — это файл <code>admin/&lt;id&gt;.js</code> рядом с index.html и запись о нём в <code>adminScripts</code> в links.js. " +
          "Формат файла и порядок подключения описаны в <code>admin/README.md</code>.</div>";
        return;
      }
      box.innerHTML = '<p class="ahint">«Загрузить» подключает файл скрипта, «Копировать» — отдельным кликом кладёт его текст в буфер для консоли.</p>' +
        list.map(function (e, i) {
          var st = A.scripts[e.id] || {};
          return '<div class="scr live" data-scr="' + esc(e.id) + '" data-i="' + i + '">' + I("file") +
            '<div class="sct"><b>' + esc(st.title || e.title || e.id) + "</b>" + (e.desc ? "<small>" + esc(e.desc) + "</small>" : "") +
            '<small><code>' + esc(e.file || "") + "</code>" + (st.code != null ? " · " + st.code.length + " " + plural(st.code.length, "символ", "символа", "символов") : "") + "</small>" +
            '<p class="sc-err" role="alert">' + esc(st.err || "") + "</p></div>" +
            (st.code != null
              ? '<button class="btn pri sc-copy" type="button">' + I("copy") + "Копировать</button>"
              : '<button class="btn sc-load" type="button"' + (st.busy ? " disabled" : "") + ">" + I("upload") + (st.busy ? "Загрузка…" : "Загрузить") + "</button>") +
            "</div>";
        }).join("");
      $$(".scr", box).forEach(function (card) {
        var e = list[+card.dataset.i], ld = $(".sc-load", card), cp = $(".sc-copy", card);
        if (ld) ld.addEventListener("click", function () {
          A.scripts[e.id] = { busy: true }; paintScripts();
          loadScript(e).then(function (r) {
            A.scripts[e.id] = { title: r.title, code: r.code }; paintScripts();
            var c = $('.scr[data-i="' + card.dataset.i + '"] .sc-copy'); if (c) c.focus();
          }, function (err) {
            A.scripts[e.id] = { err: err.message }; paintScripts();
            var l2 = $('.scr[data-i="' + card.dataset.i + '"] .sc-load'); if (l2) l2.focus();
          });
        });
        if (cp) cp.addEventListener("click", function () {
          var code = A.scripts[e.id].code, n = code.length;
          RP.copy(code, function (ok) {
            RP.toast(ok ? "Скопировано: " + n + " " + plural(n, "символ", "символа", "символов") : "Не удалось скопировать", ok ? "copy" : "alert");
          });
        });
      });
    }

    RP.admin = { open: openAdmin, loadScript: loadScript, state: A };
  })();

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
    bindLinks(); bindTip(); bindSearch(); bindLayers(); bindGroups();
    $("#refresh").addEventListener("click", function () { check(); });
    $("#lock").setAttribute("aria-controls", "drawer"); $("#lock").setAttribute("aria-expanded", "false");
    $("#lock").addEventListener("click", function () { RP.admin.open(); });
    var rT = 0; window.addEventListener("resize", function () { clearTimeout(rT); rT = setTimeout(layout, 120); });
    if (window.innerWidth >= 767) $("#q").focus(); else $("#q").placeholder = "Поиск ссылок";
    document.body.dataset.ready = "1";
    check(); RP.probe.every(RP.probe.INTERVAL, function () { check({ background: true }); });   // только в браузере, не в Node vm
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
