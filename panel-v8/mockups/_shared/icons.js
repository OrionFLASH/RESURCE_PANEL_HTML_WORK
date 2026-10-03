/**
 * web-SPOD-Edit — иконки интерфейса v8 (#65, ROADMAP 28.0): SVG-спрайт без сети.
 * Сетка 20×20, контур 1.6, цвет — currentColor.
 *   SpodIcons.svg("home", "ui-i")  → строка <svg><use href="#spod-i-home"/></svg>
 *   SpodIcons.inject(doc)          → добавить спрайт в документ (делается сам при загрузке)
 *   SpodIcons.hydrate(rootEl)      → в каждый <i data-icon="имя"></i> вставить иконку
 *   SpodIcons.names()              → список имён (витрина)
 */
(function (root) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var P = {
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

  function sprite() {
    var s = '<svg xmlns="' + NS + '" id="spod-icons" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">';
    Object.keys(P).forEach(function (k) {
      s += '<symbol id="spod-i-' + k + '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + P[k] + "</symbol>";
    });
    return s + "</svg>";
  }

  function svg(name, cls) {
    return '<svg class="' + (cls || "ui-i") + '" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><use href="#spod-i-' + name + '"/></svg>';
  }

  function inject(doc) {
    doc = doc || root.document;
    if (!doc.body || doc.getElementById("spod-icons")) return;
    var wrap = doc.createElement("div");
    wrap.innerHTML = sprite();
    doc.body.insertBefore(wrap.firstChild, doc.body.firstChild);
  }

  function hydrate(el) {
    el = el || root.document;
    var list = el.querySelectorAll("i[data-icon]:not([data-icon-done])");
    Array.prototype.forEach.call(list, function (i) {
      i.innerHTML = svg(i.getAttribute("data-icon"), i.getAttribute("data-icon-class") || "ui-i");
      i.setAttribute("data-icon-done", "1");
    });
  }

  root.SpodIcons = {
    svg: svg,
    inject: inject,
    hydrate: hydrate,
    names: function () {
      return Object.keys(P);
    },
  };

  function boot() {
    inject(root.document);
    hydrate(root.document);
  }
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
