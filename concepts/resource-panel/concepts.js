/* The release owns the catalog, search, filters, availability, actions and editor. */
(() => {
  "use strict";

  const concepts = [
    { id: "sections", name: "Навигатор по разделам", hint: "Выберите раздел слева, чтобы увидеть только его ссылки." },
    { id: "desk", name: "Рабочий стол", hint: "Избранное и встречи на первом экране. Остальные ссылки собраны в ящики по разделам." },
    { id: "matrix", name: "Матрица контуров", hint: "Стенды идут по строкам, сегменты по столбцам. Так проще различать версии одного сервиса.", dark: true },
    { id: "accordion", name: "Каталог-аккордеон", hint: "Разворачивайте нужные разделы. Остальные занимают по одной строке." },
    { id: "finder", name: "Проводник", hint: "Раздел → список ссылок → карточка с контуром и действием." },
    { id: "search", name: "Пусковая строка", hint: "Начните вводить название или хост. До поиска здесь избранное и недавно открытое.", dark: true },
    { id: "alphabet", name: "Алфавитный указатель", hint: "Перейдите к первой букве, чтобы найти ссылку по знакомому названию." },
    { id: "routes", name: "Сценарии работы", hint: "Начните с задачи. Связанные ссылки собраны вместе, даже если лежат в разных разделах." },
    { id: "status", name: "Пульт доступности", hint: "Доступные, недоступные и непроверяемые ссылки видны в отдельных колонках.", dark: true },
    { id: "services", name: "Варианты сервисов", hint: "Одно название, одна карточка. Внутри — версии по стендам и сегментам." }
  ];
  const workflows = [
    ["Связаться с командой", "chat", ["chat", "mail", "jazz", "efir", "daily", "k2", "open"]],
    ["Открыть Герои продаж", "trophy", ["h-prom-a", "h-prom-s", "h-psi-a", "h-psi-s", "h-ift-sb", "h-ift-gf", "sand"]],
    ["Загрузить данные", "upload", ["kap-prom", "kap-psi-new", "kap-ift", "ctl", "kaplogs"]],
    ["Подготовить релиз", "params", ["dpm", "sup-prom-sk", "sup-prom-mg", "sup-psi-sk", "sup-psi-mg", "sup-doc1"]],
    ["Запросить доступ", "lock", ["acc-a", "acc-s", "addr", "esm", "sm-a", "sm-s", "help"]],
    ["Открыть отчёты", "report", ["qlik", "qs", "giga", "nav", "smd"]]
  ];
  const statusNames = {
    up: "Доступна", down: "Недоступна", wait: "Проверяется", local: "Инструмент", skip: "Без проверки"
  };
  const demoDown = new Set(["h-psi-s", "h-ift-gf", "sup-ift-gf", "kap-ift", "ctl", "friend", "audit-n", "esm", "giga", "hue", "efs", "fab-db", "r-sowa", "r-bps"]);
  const $ = (selector) => document.querySelector(selector);
  const { core, ui, store, icons, probe } = window.RP;
  const { esc } = ui;
  const ns = "rp_concepts_";
  const nativeGet = store.get;
  const nativeSet = store.set;
  store.get = (key, fallback) => nativeGet(ns + key, fallback);
  store.set = (key, value) => nativeSet(ns + key, value);
  const live = store.get("live", false);
  const controls = {
    concept: $("#concept"), catalog: $("#catalog"), query: $("#q"),
    sort: $("#sort"), showDown: $("#show-down"), views: $("#views")
  };
  const state = {
    concept: concepts[0],
    view: "layout",
    section: "",
    focusLink: "",
    initialGroup: "",
    expanded: new Set(),
    sort: store.get("sort", "source"),
    showDown: store.get("show_down", true),
    recent: store.get("recent", []),
    keyboardIndex: -1
  };

  if (!live) {
    probe.run = (links, events) => new Promise((resolve) => {
      setTimeout(() => {
        const at = new Date();
        links.forEach((link, index) => {
          events.onResult(link.id, { st: demoDown.has(link.id) ? "down" : "up", at });
          events.onProgress(index + 1, links.length);
        });
        resolve();
      }, 120);
    });
  }

  function currentConcept() {
    return concepts.find((concept) => "#" + concept.id === location.hash) || concepts[0];
  }

  function paintTheme() {
    const defaultTheme = state.concept.dark ? "dark" : "light";
    document.documentElement.dataset.theme = store.get("rp_theme", defaultTheme);
  }
  state.concept = currentConcept();
  paintTheme();

  function picture(name) {
    return icons.svg(icons.has(name) ? name : "link");
  }

  function statusOf(link) {
    return ui.st[link.id] || "wait";
  }

  function highlight(link) {
    const { ranges } = core.match(link, ui.secById[link.section]?.name || "", ui.filter.q);
    const spans = [];
    let offset = 0;
    for (const [start, end] of ranges) {
      spans.push(esc(link.title.slice(offset, start)), "<mark>", esc(link.title.slice(start, end)), "</mark>");
      offset = end;
    }
    spans.push(esc(link.title.slice(offset)));
    return spans.join("");
  }

  function linkItem(link, className = "", title = highlight(link)) {
    const status = statusOf(link);
    const pinned = ui.data.favorites.includes(link.id) || link.fav;
    const context = ui.tagsHtml(link);
    const details = '<span class="item-meta">' + context +
      '<span class="availability" title="' + statusNames[status] + '">' + statusNames[status] + '</span></span>';
    const badges = (pinned ? '<span class="pin" title="Закреплена" aria-label="Закреплена">★</span>' : "") +
      (link.copy ? '<span class="copy-mark" title="Копирует код при открытии">' + picture("copy") + "</span>" : "") +
      (ui.uses[link.id] ? '<span class="uses" title="Открытий">' + ui.uses[link.id] + "</span>" : "");
    const body = '<span class="item-icon">' + picture(ui.iconOf(link)) + '</span><span class="item-content"><strong>' +
      title + "</strong>" + details + '</span><span class="item-badges">' + badges + "</span>";
    const attrs = ' class="resource ' + className + '" data-st="' + status + '"';
    if (status === "down") {
      return '<div' + attrs + ' data-resource-id="' + esc(link.id) + '" role="link" aria-disabled="true" aria-label="' +
        esc(ui.ariaOf(link) + ", недоступна") + '">' + body + "</div>";
    }
    const action = attrs + ' data-link-id="' + esc(link.id) + '" aria-label="' + esc(ui.ariaOf(link)) + '"';
    if (link.tool) return '<button type="button"' + action + ">" + body + "</button>";
    return '<a' + action + ' href="' + esc(link.url) + '" target="_blank" rel="noopener">' + body + "</a>";
  }

  function cards(links, layout = "rows") {
    return '<div class="resources ' + layout + '">' + links.map((link) => linkItem(link)).join("") + "</div>";
  }

  function visibleLinks() {
    const { q, env, seg } = ui.filter;
    const links = ui.data.links.filter((link) => {
      return !ui.off.includes(link.section) && (state.showDown || statusOf(link) !== "down") &&
        core.passFilter(link, env, seg) && core.match(link, ui.secById[link.section]?.name || "", q).hit;
    });
    if (state.sort === "alpha") links.sort((a, b) => a.title.localeCompare(b.title, "ru"));
    if (state.sort === "usage") links.sort((a, b) => (ui.uses[b.id] || 0) - (ui.uses[a.id] || 0));
    return links;
  }

  function groupSections(links) {
    return ui.data.sections.map((section) => ({
      ...section, links: links.filter((link) => link.section === section.id)
    })).filter((section) => section.links.length);
  }

  function heading(title, count, icon) {
    return '<h2 class="block-title">' + (icon ? picture(icon) : "") + "<span>" + esc(title) +
      '</span><small class="count">' + count + "</small></h2>";
  }

  function selectionButton(action, id, label, count, icon, active) {
    return '<button class="category" type="button" data-action="' + action + '" data-id="' + esc(id) +
      '" aria-pressed="' + active + '">' + (icon ? picture(icon) : "") + "<span>" + esc(label) +
      '</span><small class="count">' + count + "</small></button>";
  }

  function sectionChooser(sections, active) {
    return '<nav class="section-chooser" aria-label="Разделы">' + sections.map((group) =>
      selectionButton("section", group.id, group.name, group.links.length, group.icon, group.id === active)
    ).join("") + "</nav>";
  }

  function selectedSection(sections) {
    return sections.find((section) => section.id === state.section) || sections[0];
  }

  function panel(title, links, layout = "rows", icon = "") {
    return '<section class="block">' + heading(title, links.length, icon) + cards(links, layout) + "</section>";
  }

  function favoriteLinks(links) {
    const allowed = new Set(links.map((link) => link.id));
    const pins = ui.data.links.filter((link) => link.fav && !link.meet).length;
    const pick = core.pickFavorites(ui.data.links, ui.data.favorites, ui.clicks,
      Math.max(ui.slots, pins + 3), ui.data.settings?.favAuto !== false, ui.st);
    const ordered = pick.shown.filter((id) => allowed.has(id)).map((id) => ui.byId[id]);
    if (state.sort === "source") return ordered;
    const shown = new Set(ordered.map((link) => link.id));
    return links.filter((link) => shown.has(link.id));
  }

  function empty(message, reset = false) {
    return '<div class="empty-state">' + picture("search") + "<p>" + esc(message) + "</p>" +
      (reset ? '<button type="button" class="btn" data-action="reset">Сбросить поиск и фильтры</button>' : "") + "</div>";
  }

  function indexSections(links, layout = "rows") {
    return '<div class="section-grid">' + groupSections(links).map((group) =>
      panel(group.name, group.links, layout, group.icon)).join("") + "</div>";
  }

  function navigator(links) {
    const sections = groupSections(links);
    const section = selectedSection(sections);
    return '<div class="navigator">' + sectionChooser(sections, section.id) +
      panel(section.name, section.links, "tiles", section.icon) + "</div>";
  }

  function desk(links) {
    const { q, env, seg } = ui.filter;
    if (q.trim() || env.length || seg.length) return indexSections(links, "tiles");
    const favorites = favoriteLinks(links);
    const meetings = links.filter((link) => link.meet);
    const sections = groupSections(links);
    const hidden = core.hiddenInIndex(ui.data, favorites.map((link) => link.id));
    const selected = sections.find((section) => section.id === state.section);
    const opened = selected?.links.filter((link) => !hidden.has(link.id));
    const launchpad = favorites.length ? cards(favorites, "favorites-grid") : empty("В избранном пока нет доступных ссылок");
    return '<div class="desk-top"><section class="desk-favs">' + heading("Избранное", favorites.length, "star") + launchpad +
      '</section><section class="desk-meets">' + heading("Встречи", meetings.length, "video") + (meetings.length ?
        cards(meetings) : empty("Нет встреч по выбранным условиям")) + '</section></div><section class="desk-drawers">' +
      heading("Все разделы", sections.length) + '<div class="drawer-choices">' + sections.map((group) =>
        selectionButton("section", group.id, group.name, group.links.length, group.icon, group.id === selected?.id)
      ).join("") + "</div>" + (selected ? (opened.length ? panel(selected.name, opened, "tiles", selected.icon) :
        empty("Ссылки этого раздела уже показаны в избранном или встречах")) : "") + "</section>";
  }

  function matrix(links) {
    const stands = [["PROM", "PROM"], ["PSI", "ПСИ"], ["IFT", "ИФТ"], ["", "Без стенда"]];
    const segments = [["ALPHA", "Alpha"], ["SIGMA", "Sigma"], ["", "Без сегмента"]];
    return '<div class="matrix">' + stands.map(([env, label]) => {
      const row = links.filter((link) => (link.env || "") === env);
      if (!row.length) return "";
      return '<section class="matrix-row" data-env="' + env + '">' + heading(label, row.length) +
        '<div class="matrix-cells">' + segments.map(([seg, segment]) => {
          const cell = row.filter((link) => (link.seg || "") === seg);
          return '<section class="matrix-cell"><h3>' + segment + '<small class="count">' + cell.length +
            "</small></h3>" + (cell.length ? cards(cell) : '<p class="no-cell">Нет ссылок</p>') + "</section>";
        }).join("") + "</div></section>";
    }).join("") + "</div>";
  }

  function accordion(links) {
    const sections = groupSections(links);
    if (!state.initialGroup) {
      state.initialGroup = sections[0].id;
      state.expanded.add(state.initialGroup);
    }
    return '<div class="accordion">' + sections.map((group) =>
      '<details data-group="' + esc(group.id) + '"' + (state.expanded.has(group.id) || ui.filter.q.trim() ? " open" : "") +
      '><summary>' + picture(group.icon) + "<span>" + esc(group.name) + '</span><small class="count">' +
      group.links.length + "</small></summary>" + cards(group.links, "tiles") + "</details>").join("") + "</div>";
  }

  function finder(links) {
    const sections = groupSections(links);
    const section = selectedSection(sections);
    const focus = section.links.find((link) => link.id === state.focusLink) || section.links[0];
    const items = section.links.map((link) =>
      '<button class="file-choice" type="button" data-action="inspect" data-id="' + esc(link.id) +
      '" aria-pressed="' + (link === focus) + '" data-st="' + statusOf(link) + '">' + picture(ui.iconOf(link)) +
      "<span>" + highlight(link) + ui.tagsHtml(link) + '</span><span class="file-dot" title="' + statusNames[statusOf(link)] +
      '"><span class="sr">' + statusNames[statusOf(link)] + "</span></span></button>"
    ).join("");
    const host = focus.url ? core.parseUrl(focus.url).host : "";
    return '<div class="finder"><div class="finder-groups">' + heading("Разделы", sections.length) +
      sectionChooser(sections, section.id) + '</div><section class="finder-files">' + heading(section.name, section.links.length) +
      items + '</section><section class="finder-preview"><span class="finder-icon">' + picture(ui.iconOf(focus)) +
      "</span><h2>" + esc(focus.title) + '</h2><p>' + esc(section.name) + "</p>" +
      (host ? '<p class="host">' + esc(host) + "</p>" : "") + linkItem(focus) +
      (focus.note ? '<p class="finder-note">' + esc(focus.note) + "</p>" : "") + "</section></div>";
  }

  function search(links) {
    const { q, env, seg } = ui.filter;
    if (q.trim() || env.length || seg.length) return panel("Результаты", links, "search-results");
    const favorites = favoriteLinks(links);
    const allowed = new Set(links.map((link) => link.id));
    const recent = state.recent.filter((id) => allowed.has(id)).map((id) => ui.byId[id]);
    return '<div class="search-home">' +
      (favorites.length ? panel("Избранное", favorites, "tiles", "star") : "") +
      (recent.length ? panel("Недавно открытые", recent, "tiles", "timeline") : "") +
      '<details class="search-directory" data-disclosure="directory"><summary>Развернуть весь каталог <small class="count">' + links.length +
      '</small></summary>' + indexSections(links, "rows") + "</details></div>";
  }

  function groupBy(links, keyOf) {
    const groups = new Map();
    for (const link of links) {
      const key = keyOf(link);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(link);
    }
    return groups;
  }

  function alphabet(links) {
    const groups = groupBy(links, (link) => /^[\p{L}]/u.test(link.title) ? link.title[0].toUpperCase() : "#");
    const letters = [...groups.keys()].sort((a, b) => a.localeCompare(b, "ru"));
    const list = letters.map((letter, index) => '<section id="letter-' + index + '" tabindex="-1" class="letter-block"><h2>' +
      esc(letter) + "</h2>" + cards(state.sort === "usage" ? groups.get(letter) :
        [...groups.get(letter)].sort((a, b) => a.title.localeCompare(b.title, "ru"))) + "</section>").join("");
    return '<div class="alphabet"><nav class="letters" aria-label="Алфавит">' + letters.map((letter, index) =>
      '<button type="button" data-action="letter" data-id="' + index + '">' + esc(letter) + "</button>"
    ).join("") + '</nav><div class="letter-list">' + list + "</div></div>";
  }

  function routes(links) {
    const chosen = new Set();
    const sections = workflows.map(([title, icon, ids]) => {
      const items = links.filter((link) => ids.includes(link.id));
      items.forEach((link) => chosen.add(link.id));
      return items.length ? panel(title, items, "rows", icon) : "";
    }).join("");
    const remaining = links.filter((link) => !chosen.has(link.id));
    return '<div class="routes"><div class="route-grid">' + sections + "</div>" +
      (remaining.length ? '<details class="other-routes" data-disclosure="other-routes"><summary>Остальные ссылки <small class="count">' +
        remaining.length + "</small></summary>" + indexSections(remaining) + "</details>" : "") + "</div>";
  }

  function status(links) {
    const columns = [
      ["up", "Доступны", "check", (link) => statusOf(link) === "up"],
      ["down", "Недоступны", "alert", (link) => statusOf(link) === "down"],
      ["other", "Остальные", "cmd", (link) => !["up", "down"].includes(statusOf(link))]
    ];
    return '<div class="status-board">' + columns.filter(([id]) => state.showDown || id !== "down").map(([id, name, icon, test]) => {
      const lane = links.filter(test);
      return '<section class="status-lane" data-lane="' + id + '">' + heading(name, lane.length, icon) +
        (lane.length ? cards(lane) : '<p class="no-cell">Нет ссылок</p>') + "</section>";
    }).join("") + "</div>";
  }

  function services(links) {
    const families = groupBy(links, (link) => link.section + "/" + link.title);
    return '<div class="service-grid">' + [...families.values()].map((family) => {
      const first = family[0];
      return '<section class="service-card"><div class="service-top"><span class="service-icon">' +
        picture(ui.iconOf(first)) + "</span><div><h2>" + highlight(first) + "</h2><p>" +
        esc(ui.secById[first.section].name) + '</p></div><small class="count">' + family.length + '</small></div>' +
        '<div class="resources variants">' + family.map((link) => linkItem(link, "variant",
          link.env || link.seg ? "Открыть контур" : link.tool ? "Запустить" : "Открыть")).join("") +
        "</div></section>";
    }).join("") + "</div>";
  }

  const layouts = { sections: navigator, desk, matrix, accordion, finder, search, alphabet, routes, status, services };

  function paintViews() {
    const options = [["layout", "Обзор"], ["all", "Все ссылки"], ["favorite", "Избранное"], ["meetings", "Встречи"]];
    controls.views.innerHTML = options.map(([id, name]) =>
      '<button type="button" data-action="view" data-id="' + id + '" aria-pressed="' + (state.view === id) + '">' + name + "</button>"
    ).join("");
  }

  function paintGroups() {
    const root = $("#group-toggles");
    const html = ui.data.sections.map((section) =>
      '<label><input type="checkbox" data-group-toggle="' + esc(section.id) + '"' +
      (ui.off.includes(section.id) ? "" : " checked") + "> " + esc(section.name) + "</label>"
    ).join("");
    if (root.innerHTML !== html) root.innerHTML = html;
  }

  function currentPool(links) {
    if (state.view === "favorite") return favoriteLinks(links);
    if (state.view === "meetings") return links.filter((link) => link.meet);
    return links;
  }

  function depiction(links) {
    if (state.view === "favorite") return panel("Избранное", links, "tiles", "star");
    if (state.view === "meetings") return panel("Встречи", links, "tiles", "video");
    if (state.view === "all") return indexSections(links);
    return layouts[state.concept.id](links);
  }

  let frame = 0;
  let renderedHtml = "";
  function render() {
    frame = 0;
    if (!ui.data) return;
    const links = currentPool(visibleLinks());
    const allHidden = ui.data.sections.every((section) => ui.off.includes(section.id));
    const html = links.length ? depiction(links) : allHidden ?
      '<div class="empty-state"><p>Все разделы скрыты</p><button class="btn" type="button" data-action="show-groups">Показать все разделы</button></div>' :
      empty(state.view === "favorite" ? "В избранном нет ссылок по этим условиям" : "Нет ссылок по выбранным условиям", true);
    if (html !== renderedHtml) {
      const active = document.activeElement;
      const focusKey = controls.catalog.contains(active) ? active.dataset.action || active.dataset.linkId : "";
      const focusId = focusKey && active.dataset.id;
      const openDisclosures = new Set([...controls.catalog.querySelectorAll("details[data-disclosure][open]")]
        .map((entry) => entry.dataset.disclosure));
      const scrollPositions = [...controls.catalog.querySelectorAll(".status-lane")].map((lane) => lane.scrollTop);
      controls.catalog.innerHTML = html;
      controls.catalog.querySelectorAll("details[data-disclosure]").forEach((entry) => {
        entry.open = openDisclosures.has(entry.dataset.disclosure);
      });
      controls.catalog.querySelectorAll(".status-lane").forEach((lane, index) => { lane.scrollTop = scrollPositions[index] || 0; });
      renderedHtml = html;
      state.keyboardIndex = -1;
      controls.query.removeAttribute("aria-activedescendant");
      if (focusKey) {
        const next = [...controls.catalog.querySelectorAll("[data-action], [data-link-id]")].find((node) =>
          focusId ? node.dataset.action === focusKey && node.dataset.id === focusId : node.dataset.linkId === focusKey);
        next?.focus({ preventScroll: true });
      }
    }
    paintGroups();
    const total = ui.data.links.length;
    const count = links.length === total ? total + " ссылок" : links.length + " из " + total;
    if ($("#cnt").textContent !== count) $("#cnt").textContent = count;
    const label = "Ссылок по выбранным условиям: " + links.length;
    if ($("#results-status").textContent !== label) $("#results-status").textContent = label;
  }

  function scheduleRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function paintConcept() {
    state.concept = currentConcept();
    state.view = "layout";
    state.section = "";
    state.focusLink = "";
    state.initialGroup = "";
    state.expanded.clear();
    const index = concepts.indexOf(state.concept);
    controls.concept.value = state.concept.id;
    document.body.dataset.concept = state.concept.id;
    $("#concept-title").textContent = state.concept.name;
    $("#concept-hint").textContent = state.concept.hint;
    $("#prev").disabled = index === 0;
    $("#next").disabled = index === concepts.length - 1;
    document.title = state.concept.name + " · Ресурсная панель";
    paintTheme();
    window.RP.theme.paint();
    paintViews();
    render();
  }

  function navigate(id) {
    if (location.hash !== "#" + id) location.hash = id;
  }

  function resetFilters() {
    ui.resetAll();
    state.showDown = true;
    controls.showDown.checked = true;
    store.set("show_down", true);
    render();
  }

  function handleAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    switch (action) {
      case "view":
        state.view = id;
        paintViews();
        controls.views.querySelector('[data-id="' + id + '"]').focus({ preventScroll: true });
        break;
      case "section":
        state.section = state.concept.id === "desk" && state.section === id ? "" : id;
        state.focusLink = "";
        break;
      case "inspect": state.focusLink = id; break;
      case "letter": {
        const letter = $("#letter-" + id);
        letter.scrollIntoView({ block: "start" });
        letter.focus({ preventScroll: true });
        return;
      }
      case "show-groups": ui.setOff([]); break;
      case "reset": resetFilters(); return;
    }
    render();
  }

  function handleKeys(event) {
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    const canSearch = controls.query.value.trim() || state.keyboardIndex >= 0;
    if (event.key === "Enter" && !canSearch) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (ui.filter.q !== controls.query.value) {
      ui.filter.q = controls.query.value;
      ui.apply();
      render();
    }
    const items = [...controls.catalog.querySelectorAll(".resource[data-link-id]")].filter((item) => item.offsetParent);
    if (!items.length) return;
    if (event.key === "Enter") {
      (items[state.keyboardIndex] || items[0]).click();
      return;
    }
    const step = event.key === "ArrowDown" ? 1 : -1;
    state.keyboardIndex = Math.min(items.length - 1, Math.max(0, state.keyboardIndex + step));
    items.forEach((item, index) => {
      item.id = "result-" + index;
      item.classList.toggle("is-keyboard-active", index === state.keyboardIndex);
    });
    const item = items[state.keyboardIndex];
    controls.query.setAttribute("aria-activedescendant", item.id);
    item.scrollIntoView({ block: "nearest" });
  }

  function trackRecent(event) {
    const item = event.target.closest("#catalog [data-link-id]");
    if (!item || event.ctrlKey || event.metaKey || ![0, 1].includes(event.button)) return;
    const id = item.dataset.linkId;
    state.recent = [id, ...state.recent.filter((value) => value !== id)].slice(0, 8);
    store.set("recent", state.recent);
    scheduleRender();
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!ui.data) return;
    controls.concept.innerHTML = concepts.map((concept) =>
      '<option value="' + concept.id + '">' + concept.name + "</option>").join("");
    controls.sort.value = state.sort;
    controls.showDown.checked = state.showDown;
    $("#live").checked = live;
    $("#data-mode").textContent = live ? "Проверка реальных адресов" : "Демо-статусы";
    controls.concept.addEventListener("change", () => navigate(controls.concept.value));
    $("#prev").addEventListener("click", () => navigate(concepts[concepts.indexOf(state.concept) - 1].id));
    $("#next").addEventListener("click", () => navigate(concepts[concepts.indexOf(state.concept) + 1].id));
    window.addEventListener("hashchange", () => {
      if (currentConcept() !== state.concept && location.hash !== "#catalog") paintConcept();
    });
    $(".skip-link").addEventListener("click", (event) => {
      event.preventDefault();
      controls.catalog.focus();
    });
    controls.sort.addEventListener("change", () => {
      state.sort = controls.sort.value;
      store.set("sort", state.sort);
      render();
    });
    controls.showDown.addEventListener("change", () => {
      state.showDown = controls.showDown.checked;
      store.set("show_down", state.showDown);
      render();
    });
    $("#live").addEventListener("change", (event) => {
      store.set("live", event.target.checked);
      location.reload();
    });
    $("#group-toggles").addEventListener("change", (event) => {
      const id = event.target.dataset.groupToggle;
      if (!id) return;
      ui.setOff(event.target.checked ? ui.off.filter((value) => value !== id) : [...ui.off, id]);
      render();
    });
    $(".workspace").addEventListener("click", handleAction);
    controls.catalog.addEventListener("toggle", (event) => {
      const id = event.target.dataset.group;
      if (!id || ui.filter.q.trim()) return;
      if (event.target.open) state.expanded.add(id);
      else state.expanded.delete(id);
    }, true);
    controls.query.addEventListener("keydown", handleKeys, true);
    document.addEventListener("click", trackRecent);
    document.addEventListener("auxclick", trackRecent);
    const observer = new MutationObserver(scheduleRender);
    for (const target of [$("#idx"), $("#dock"), $("#sum")]) {
      observer.observe(target, { subtree: true, childList: true, attributes: true });
    }
    paintConcept();
  });
})();
