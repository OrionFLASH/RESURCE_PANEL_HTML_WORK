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

  RP.core = { validate: validate, serializeLinks: serializeLinks };

  // UI-модули подключаются в следующих задачах, только при наличии document.
  if (typeof document !== "undefined") { /* boot */ }
})();
