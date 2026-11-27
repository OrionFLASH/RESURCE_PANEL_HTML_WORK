/* The release owns the catalog, search, filters, availability, actions and editor. */
(() => {
  "use strict";

  const production = document.body.dataset.edition === "production";
  const palettes = [
    { key: "bay", label: "Залив", columns: 4, size: "tall", icon: "globe" },
    { key: "sage", label: "Шалфей", columns: 4, size: "tall", icon: "growth" },
    { key: "stone", label: "Камень", columns: 3, size: "regular", icon: "layers", dark: false },
    { key: "graphite", label: "Графит", columns: 4, size: "compact", icon: "grid" },
    { key: "opal", label: "Опаловое стекло", columns: 4, size: "tall", icon: "gem", glass: true, dark: false },
    { key: "dusk", label: "Сумеречное стекло", columns: 4, size: "tall", icon: "moon", glass: true },
    { key: "mist", label: "Дымка", columns: 3, size: "regular", icon: "info", tip: true },
    { key: "lift", label: "Подъём", columns: 4, size: "tall", icon: "up", motion: "lift" },
    { key: "beam", label: "Скользящий блик", columns: 4, size: "regular", icon: "sparkle", motion: "beam" },
    { key: "plum", label: "Слива", columns: 3, size: "tall", icon: "book" }
  ];
  const preferred = new Set(["bay", "sage", "stone", "opal", "dusk", "lift"]);
  const reliefStyles = [...palettes.filter((style) => preferred.has(style.key)),
    ...palettes.filter((style) => !preferred.has(style.key))].flatMap((style) => {
    const base = { ...style, id: "relief-" + style.key };
    return !production && preferred.has(style.key) ? [
      base, { ...base, id: base.id + "-codes", label: base.label + " · коды", codes: true }
    ] : [base];
  });

  const effects = [
    ["style", "По стилю"],
    ["tilt", "3D-наклон", "Кнопка наклоняется вслед за указателем."],
    ["lift", "Подъём", "Кнопка приподнимается, тень становится глубже."],
    ["beam", "Блик", "Узкий световой блик проходит по поверхности."],
    ["pulse", "Световой импульс", "Кромка и поверхность вспыхивают на мгновение."],
    ["rock", "Качание", "Кнопка слегка качается и возвращается на место."],
    ["wave", "Мягкая волна", "Мягкая полоса света прокатывается по кнопке."],
    ["off", "Без эффекта", "У кнопки нет анимации наведения."]
  ];

  function resolveStyle() {
    const preferredStyle = production ? appearance.get("style", "") : location.hash.slice(1);
    return reliefStyles.find(({ id }) => id === preferredStyle) || reliefStyles[0];
  }

  const stands = [["PROM", "PROM", "P"], ["PSI", "ПСИ", "Ψ"], ["IFT", "ИФТ", "I"]];
  const segments = [["ALPHA", "Alpha", "A"], ["SIGMA", "Sigma", "S"]];
  const standCodes = Object.fromEntries(stands.map(([id, , code]) => [id, code]));
  const segmentCodes = Object.fromEntries(segments.map(([id, , code]) => [id, code]));
  const statusSigns = { up: "✓", down: "×", wait: "◌", local: "◆", skip: "–" };
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
  if (!production) {
    const nativeGet = store.get;
    const nativeSet = store.set;
    store.get = (key, fallback) => nativeGet(ns + key, fallback);
    store.set = (key, value) => nativeSet(ns + key, value);
  }

  // Appearance follows the tab session in the release. The prototype keeps its own saved comparisons.
  const appearanceCache = new Map();
  const appearance = production ? {
    get(key, fallback) {
      try {
        const value = sessionStorage.getItem("rp_relief_" + key);
        if (value !== null) return JSON.parse(value);
      } catch (_) { /* Storage may be unavailable when opened from disk. */ }
      return appearanceCache.has(key) ? appearanceCache.get(key) : fallback;
    },
    set(key, value) {
      appearanceCache.set(key, value);
      try { sessionStorage.setItem("rp_relief_" + key, JSON.stringify(value)); }
      catch (_) { /* The current page still uses the selected value. */ }
    }
  } : store;
  const live = production || store.get("live", false);
  const state = {
    style: resolveStyle(),
    effect: appearance.get("relief_effect", production ? "off" : "style"),
    edges: appearance.get("relief_edges", production),
    view: "layout",
    choice: "",
    section: "",
    railOpen: store.get("rail_relief", true),
    page: 0,
    menu: "",
    settingsChild: false,
    menuPage: 0,
    sort: store.get("sort", "source"),
    showDown: store.get("show_down", true),
    keyboardIndex: -1
  };
  let scope = null;
  let frame = 0;
  let resetPage = true;
  let filterSignature = "";
  const byTitle = (a, b) => a.title.localeCompare(b.title, "ru");
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

  function paintTheme() {
    const preset = state.style.dark === false ? "light" : "dark";
    const theme = production ? appearance.get("theme", null) ||
      (appearance.get("style", null) ? preset : store.get("rp_theme", preset)) : store.get("rp_theme", preset);
    document.documentElement.dataset.theme = theme;
  }
  paintTheme();

  if (production) {
    window.RP.theme.set = (theme) => {
      appearance.set("theme", theme);
      paintTheme();
      window.RP.theme.paint();
    };
  }

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

  function linkItem(link, quick = false) {
    const status = statusOf(link);
    const pinned = ui.data.favorites.includes(link.id) || link.fav;
    const opens = ui.uses[link.id];
    const text = ui.ariaOf(link) + " · " + statusNames[status];
    const badges = (pinned ? '<span class="pin" title="Закреплена">★</span>' : "") +
      (opens ? '<span class="uses" title="Открытий">' + opens + "</span>" : "") +
      '<span class="state-sign" aria-hidden="true">' + statusSigns[status] + "</span>";
    const context = [ui.ENV[link.env], ui.SEG[link.seg]].filter(Boolean).join(" · ");
    const quickContext = quick && context ? '<span class="quick-context">' + esc(context) + "</span>" : "";
    const title = '<span class="item-name">' + (quick ? esc(link.title) : highlight(link)) + "</span>" + quickContext;
    const segment = segmentCodes[link.seg];
    const stand = standCodes[link.env];
    const badge = (code, side) => code ? '<span class="contour-code ' + side + '" aria-hidden="true">' + code + "</span>" : "";
    const body = badge(segment, "segment-code") + '<span class="item-icon">' + picture(ui.iconOf(link)) +
      '</span><span class="item-content">' + title + '</span><span class="item-badges" aria-hidden="true">' +
      badges + '</span>' + badge(stand, "stand-code");
    const attrs = ' class="resource' + (link.title.length >= 24 ? " long-title" : "") + '" data-st="' + status + '" data-env="' + (link.env || "") + '" data-seg="' +
      (link.seg || "") + '" data-section="' + esc(link.section) + '" data-catalog-link="' + esc(link.id) + '" aria-label="' + esc(text) + '"';
    if (status === "down") return '<div' + attrs + ' title="' + esc(text) + '" role="link" aria-disabled="true">' + body + "</div>";
    const action = attrs + ' data-effect-target data-link-id="' + esc(link.id) + '"';
    if (link.tool) return '<button type="button"' + action + ">" + body + "</button>";
    return '<a' + action + ' href="' + esc(link.url) + '" target="_blank" rel="noopener">' + body + "</a>";
  }

  function visibleLinks() {
    const { q, env, seg } = ui.filter;
    const full = state.view === "all";
    const links = ui.data.links.filter((link) => {
      return (!state.section || state.section === link.section) && (full || !ui.off.includes(link.section)) && (state.showDown || statusOf(link) !== "down") &&
        core.passFilter(link, env, seg) && core.match(link, ui.secById[link.section]?.name || "", q).hit;
    });
    if (state.sort === "alpha") links.sort(byTitle);
    if (state.sort === "usage") links.sort((a, b) => (ui.uses[b.id] || 0) - (ui.uses[a.id] || 0));
    return links;
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

  function clusters(groups) {
    return groups.flatMap((group) => group.links.length ? [
      { kind: "group", id: group.id, label: group.label, icon: group.icon, size: group.links.length }, ...group.links
    ] : []);
  }

  function selection(choices, label) {
    const picked = choices.find(({ id }) => id === state.choice);
    return { entries: picked?.links || [], scope: { label, choices, picked }, style: picked ? "regular" : undefined };
  }

  function routes(links) {
    const chosen = new Set(workflows.flatMap(([, , ids]) => ids));
    const choices = workflows.map(([label, icon, ids], index) => ({
      id: String(index), label, icon, links: links.filter((link) => ids.includes(link.id))
    }));
    choices.push({ id: "other", label: "Остальные ссылки", icon: "link", links: links.filter((link) => !chosen.has(link.id)) });
    const model = selection(choices.filter((choice) => choice.links.length), "Сценарии");
    if (!model.scope.picked) {
      model.style = "routes";
      model.entries = model.scope.choices.map((item) => ({ ...item, kind: "panel" }));
    }
    return model;
  }

  function availability(links) {
    const choices = [
      { id: "up", label: "Доступны", icon: "check", links: links.filter((link) => statusOf(link) === "up") },
      { id: "down", label: "Недоступны", icon: "alert", links: links.filter((link) => statusOf(link) === "down") },
      { id: "other", label: "Остальные", icon: "cmd", links: links.filter((link) => !["up", "down"].includes(statusOf(link))) }
    ].filter(({ links: items }) => items.length);
    const model = selection(choices, "Статусы");
    if (!model.scope.picked) { model.entries = clusters(choices); model.plain = choices.flatMap(({ links: items }) => items); }
    return model;
  }

  function depiction(links) {
    if (state.view === "favorite") return { entries: favoriteLinks(links), fallback: "По этим условиям в избранном ничего нет." };
    if (state.view === "meetings") return { entries: links.filter((link) => link.meet) };
    if (state.view === "health") return availability(links);
    if (state.section) return { entries: links, style: "regular" };
    const { q, env, seg } = ui.filter;
    if (state.view === "all" || q.trim() || env.length || seg.length) return { entries: links };
    return routes(links);
  }

  const compact = [
    { width: 205, height: 42 }, { width: 178, height: 35 }, { width: 157, height: 29 }
  ];
  const spacious = [{ width: 212, height: 48 }, { width: 149, height: 44 }];
  const gap = 4;

  function fit(total, width, height, presets, maxHeight, preferredColumns = Infinity) {
    const options = presets.map((preset) => {
      const columns = Math.max(1, Math.min(preferredColumns, Math.floor((width + gap) / (preset.width + gap))));
      const rows = Math.max(1, Math.floor((height + gap) / (preset.height + gap)));
      return { ...preset, columns, rows, capacity: columns * rows };
    });
    const best = options.find((option) => option.capacity >= total) ||
      options.reduce((a, b) => a.capacity >= b.capacity ? a : b);
    const length = Math.min(total, best.capacity);
    const rows = Math.max(1, Math.ceil(length / best.columns));
    const rowHeight = Math.max(1, Math.min(maxHeight, Math.floor((height + gap) / rows) - gap));
    return { ...best, rowHeight };
  }

  function boardConfig(model) {
    const profile = state.style;
    if (model.style === "routes") {
      const height = profile.size === "tall" ? 174 : profile.size === "compact" ? 160 : 168;
      return {
        presets: [{ width: profile.columns === 4 ? 215 : 255, height }, { width: 149, height }],
        max: 560,
        columns: profile.columns, flow: "row"
      };
    }
    if (model.style === "route-choices") return {
      presets: [{ width: 220, height: 66 }, { width: 146, height: 58 }],
      max: 105, columns: profile.columns, flow: "row"
    };
    const useTiles = model.style === "regular";
    const presets = window.innerWidth >= 740 && (!useTiles || model.entries.length > 30) ? compact : spacious;
    return { presets, max: useTiles ? 92 : 58, columns: Infinity, flow: useTiles ? "row" : "column" };
  }

  function drawGrid(grid, config, shape, rows) {
    grid.style.setProperty("--columns", shape.columns);
    grid.style.setProperty("--rows", Math.max(1, rows));
    grid.style.setProperty("--row-height", shape.rowHeight + "px");
    grid.dataset.flow = config.flow;
  }

  function choiceItem(item, asMenu = false, sample = false) {
    const attr = ' data-action="' + (item.action || "choose") + '" data-id="' + esc(item.id) + '"';
    const stateAttr = item.pressed === undefined ? "" : ' aria-pressed="' + item.pressed + '"';
    const icon = item.icon ? '<span class="choice-icon">' + picture(item.icon) + "</span>" : "";
    const count = item.range || item.links?.length;
    const size = count ? '<span class="count">' + esc(count) + "</span>" : "";
    const disabled = item.links && !item.links.length ? " disabled" : "";
    const animate = item.kind === "panel" || sample ? " data-effect-target" : "";
    const examples = sample && item.links?.slice(0, 2).map((link) => link.title).join(" · ");
    const label = '<span class="choice-name">' + esc(item.label) + "</span>";
    return '<button class="' + (asMenu ? "menu-option" : "choice") + '" type="button"' + attr + stateAttr +
      disabled + animate + ">" + icon + (examples ? '<span class="route-copy">' + label +
        '<span class="route-sample">' + esc(examples) + "</span></span>" : label) + size + "</button>";
  }

  function gridItem(item, previewLimit) {
    if (item.kind === "panel") {
      const preview = item.links.slice(0, previewLimit);
      return '<section class="link-panel" data-panel="' + esc(item.id) + '">' +
        choiceItem(item) + '<div class="pane-links">' +
        preview.map((link) => linkItem(link)).join("") + "</div></section>";
    }
    if (item.kind === "choice") return choiceItem(item, false, true);
    if (item.kind === "group") return '<h2 class="group-label" data-section="' + esc(item.id || "") + '">' +
      (item.icon ? picture(item.icon) : "") + "<span>" + esc(item.label) + "</span>" +
      (item.size ? '<small class="count">' + item.size + "</small>" : "") + "</h2>";
    return linkItem(item);
  }

  function setContent(element, html) {
    if (element._lastContent === html) return;
    const active = document.activeElement;
    const kind = element.contains(active) && (active.dataset.action || active.dataset.linkId) || "";
    const id = kind ? active.dataset.id : "";
    element.innerHTML = html;
    element._lastContent = html;
    if (kind) {
      const next = [...element.querySelectorAll("[data-action], [data-link-id]")].find((node) =>
        id ? node.dataset.action === kind && node.dataset.id === id : node.dataset.action === kind || node.dataset.linkId === kind);
      next?.focus({ preventScroll: true });
    }
  }

  function paintViews() {
    const views = [
      ["layout", "Обзор", "grid"], ["all", "Все ссылки", "link"], ["favorite", "Избранное", "star"], ["meetings", "Встречи", "video"]
    ];
    const useShelf = shelfFits();
    const visibleViews = views.filter(([id]) => !(useShelf && ["favorite", "meetings"].includes(id)));
    setContent($("#views"), visibleViews.map(([id, name, icon]) => '<button class="control" type="button" data-action="view" data-id="' +
      id + '" aria-label="' + name + '" title="' + name + '" aria-pressed="' +
      (state.view === id) + '">' + picture(icon) + '<span class="wide-label">' + name + "</span></button>").join(""));
  }

  function shelfFits() {
    return window.innerWidth >= 740 && document.documentElement.clientHeight >= 570;
  }

  function railChoices() {
    return [{ id: "", label: "Все разделы", icon: "layers" }, ...ui.data.sections
      .filter((section) => !ui.off.includes(section.id) || state.view === "all")
      .map((section) => ({ ...section, label: section.name }))];
  }

  function railFits() {
    return $("#catalog").clientWidth >= 1070 &&
      railChoices().length * 31 + 28 <= $("#catalog").clientHeight;
  }

  function paintQuickAccess() {
    const shelf = $("#quick-shelf");
    shelf.hidden = !shelfFits();
    $("#health-view").setAttribute("aria-pressed", String(state.view === "health"));
    paintViews();
    if (shelf.hidden) return;

    const links = ui.data.links;
    const favorites = favoriteLinks(links);
    const meetings = links.filter((link) => link.meet && (state.showDown || statusOf(link) !== "down"));
    for (const [id, label, icon, collection, limit] of [
      ["favorite", "Избранное", "star", favorites, 12],
      ["meetings", "Встречи", "video", meetings, 3]
    ]) {
      const title = '<button type="button" class="control quick-view" data-action="view" data-id="' + id +
        '" aria-label="' + label + '" aria-pressed="' + (state.view === id) + '">' + picture(icon) +
        "<span>" + label + '</span><small>' + collection.length + '</small></button>';
      setContent($("#quick-" + id), title + collection.slice(0, limit).map((link) => linkItem(link, true)).join(""));
    }
  }

  function paintScope(model) {
    scope = model.scope || null;
    const rail = $("#section-rail");
    const canToggle = railFits();
    const showRail = canToggle && state.railOpen;
    rail.hidden = !showRail;
    const railToggle = $("#sections-button");
    railToggle.setAttribute("aria-haspopup", canToggle ? "false" : "dialog");
    if (canToggle) railToggle.setAttribute("aria-expanded", String(!!showRail));
    else railToggle.removeAttribute("aria-expanded");
    $("#scope").hidden = !scope || (state.view === "health" && !scope.picked);
    if (showRail) {
      setContent(rail, railChoices().map((choice) =>
        choiceItem({ ...choice, action: "section", pressed: choice.id === state.section })).join(""));
    }
    if (scope) {
      $("#scope-label").textContent = scope.picked?.label || scope.label;
      $("#scope").setAttribute("aria-label", scope.label + (scope.picked ? " · " + scope.picked.label : ""));
    }
  }

  function paintSections() {
    const section = ui.secById[state.section];
    $("#section-label").textContent = section?.name || "Разделы";
    $("#sections-button").title = section?.name || "Разделы";
    $("#sections-button").setAttribute("aria-pressed", String(!!section));
  }

  function paintMast(model, links) {
    const target = $("#board-mast");
    const label = ui.secById[state.section]?.name || model.scope?.picked?.label ||
      (state.view === "favorite" ? "Избранное" : state.view === "meetings" ? "Встречи" : "");
    const status = state.view === "health" && model.scope && !model.scope.picked;
    target.hidden = !label && !status;
    if (status) {
      setContent(target, model.scope.choices.map((choice) => choiceItem(choice)).join(""));
    } else if (label) {
      setContent(target, '<h2>' + esc(label) + '</h2><span>' +
        (model.entries.some((entry) => entry.kind) ? links.length : model.entries.length) + "</span>");
    }
  }

  function resetSelection() {
    state.keyboardIndex = -1;
    $("#q").removeAttribute("aria-activedescendant");
  }

  function routePreviews(entries, shape, grid) {
    const css = getComputedStyle(grid);
    const pixels = (name) => parseFloat(css.getPropertyValue(name));
    const linkGap = pixels("--overview-link-gap");
    const reserved = pixels("--route-key-height") + 2 * pixels("--overview-panel-padding") +
      pixels("--overview-panel-gap") + 2; // Includes both borders.
    const previewLimit = Math.max(1, Math.min(10,
      Math.floor((shape.rowHeight - reserved + linkGap) / (pixels("--overview-link-height") + linkGap))));

    const other = entries.find((entry) => entry.id === "other");
    if (!other || entries.length > shape.capacity) return { entries, previewLimit };
    const slots = Math.ceil(entries.length / shape.columns) * shape.columns;
    const parts = Math.min(slots - entries.length + 1, Math.ceil(other.links.length / previewLimit));
    if (parts < 2) return { entries, previewLimit };

    const continued = Array.from({ length: parts }, (_, part) => {
      const start = part * previewLimit;
      const end = Math.min(start + previewLimit, other.links.length);
      return { ...other, links: other.links.slice(start, end), range: (start + 1) + "–" + end + " / " + other.links.length };
    });
    return { entries: entries.flatMap((entry) => entry === other ? continued : [entry]), previewLimit };
  }

  function render() {
    frame = 0;
    if (!ui.data) return;
    const { q, env, seg } = ui.filter;
    const signature = JSON.stringify([q, env, seg]);
    if (resetPage || signature !== filterSignature) state.page = 0;
    resetPage = false;
    filterSignature = signature;
    const activeFilters = env.length + seg.length;
    $("#filter-count").textContent = activeFilters || "";
    $("#filter-button").setAttribute("aria-pressed", String(!!activeFilters));
    const links = visibleLinks();
    const model = depiction(links);
    const board = $("#board-body");
    paintQuickAccess();
    paintSections();
    paintScope(model);
    paintMast(model, links);

    const grid = $("#board-grid");
    let { entries } = model;
    let config = boardConfig(model);
    let shape = fit(entries.length, board.clientWidth, board.clientHeight, config.presets, config.max, config.columns);
    if (model.plain && entries.length > shape.capacity) {
      entries = model.plain;
      shape = fit(entries.length, board.clientWidth, board.clientHeight, config.presets, config.max, config.columns);
    }
    if (entries.some((entry) => entry.kind === "panel") && board.clientHeight < 191) {
      entries = entries.map((entry) => ({ ...entry, kind: "choice" }));
      config = boardConfig({ style: "route-choices" });
      shape = fit(entries.length, board.clientWidth, board.clientHeight, config.presets, config.max, config.columns);
    }
    let previewLimit = 0;
    if (entries.some((entry) => entry.kind === "panel")) {
      ({ entries, previewLimit } = routePreviews(entries, shape, grid));
    }
    const pages = Math.max(1, Math.ceil(entries.length / shape.capacity));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * shape.capacity;
    const shown = entries.slice(start, start + shape.capacity);
    const rows = Math.ceil(shown.length / shape.columns);
    drawGrid(grid, config, shape, rows);
    grid.dataset.style = model.style || "catalog";
    grid.dataset.dense = String(shape.rowHeight < 49);
    const html = shown.map((item) => gridItem(item, previewLimit)).join("");
    const empty = model.fallback || (ui.off.length === ui.data.sections.length && state.view !== "all" ?
      "Все разделы скрыты. Откройте «Настройки» или «Все ссылки»." : "По выбранным условиям ссылок нет.");
    const contents = html || '<p class="board-empty">' + empty + "</p>";
    if (grid._lastContent !== contents) resetSelection();
    setContent(grid, contents);
    $("#previous-page").disabled = state.page === 0;
    $("#next-page").disabled = state.page >= pages - 1;
    $("#catalog").dataset.pages = pages;
    $(".catalog-pages").classList.toggle("single-page", pages === 1);
    const count = shown.reduce((total, entry) =>
      total + (entry.kind === "panel" ? Math.min(previewLimit, entry.links.length) : Number(!entry.kind)), 0);
    $("#range").textContent = pages > 1 ? (state.page + 1) + " / " + pages :
      (count ? count + " / " + ui.data.links.length : entries.length || "0");
    $("#range").setAttribute("aria-label", pages > 1 ? "Страница " + (state.page + 1) + " из " + pages : "Показано ссылок: " + count);
    $("#cnt").textContent = links.length === ui.data.links.length ? links.length + " ссылок" : links.length + " / " + ui.data.links.length;
  }

  function scheduleRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function repaint() {
    if (frame) cancelAnimationFrame(frame);
    render();
  }

  function restart() {
    resetPage = true;
    repaint();
  }

  const pointerMotion = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let hoveredButton = null;
  let hoverBounds = null;

  function paintEffect() {
    const motion = state.effect === "style" ? (state.style.motion || "tilt") : state.effect;
    document.body.dataset.reliefMotion = motion;
    const [, label, description] = effects.find(([id]) => id === motion) || [];
    $("#effects-button").title = label ? "Эффекты · " + label : "Эффекты";
    if (state.menu !== "effects") return;

    setContent($("#effect-options"), effects.map(([id, title]) =>
      '<button type="button" class="control" data-action="effect" data-id="' + id + '" aria-pressed="' +
      (state.effect === id) + '">' + title + "</button>").join(""));
    $("#effect-hint").textContent = reducedMotion.matches ? "В системе включено уменьшение движения." :
      description || "Наведите указатель или нажмите, чтобы увидеть эффект.";
  }

  function playEffect() {
    const demo = $("#effect-demo");
    demo.classList.remove("effect-playing");
    if (reducedMotion.matches || document.body.dataset.reliefMotion === "off") return;
    // Restart the same animation when the user presses the preview button again.
    void demo.offsetWidth;
    demo.classList.add("effect-playing");
  }

  function resetTilt() {
    if (!hoveredButton) return;
    hoveredButton.style.removeProperty("--tilt-x");
    hoveredButton.style.removeProperty("--tilt-y");
    hoveredButton = null;
    hoverBounds = null;
  }

  function tiltAtPointer(event) {
    const button = event.target.closest("[data-effect-target]");
    if (!pointerMotion.matches || event.pointerType !== "mouse" || document.body.dataset.reliefMotion !== "tilt" || !button) {
      resetTilt();
      return;
    }
    if (hoveredButton !== button) {
      resetTilt();
      hoveredButton = button;
      hoverBounds = button.getBoundingClientRect();
    }
    const x = Math.max(-.5, Math.min(.5, (event.clientX - hoverBounds.left) / hoverBounds.width - .5));
    const y = Math.max(-.5, Math.min(.5, (event.clientY - hoverBounds.top) / hoverBounds.height - .5));
    button.style.setProperty("--tilt-x", (-y * 22).toFixed(1) + "deg");
    button.style.setProperty("--tilt-y", (x * 27).toFixed(1) + "deg");
  }

  function updateStyle() {
    const style = state.style = resolveStyle();
    paintMarkings();
    resetTilt();
    document.body.dataset.relief = style.key;
    document.body.dataset.reliefSize = style.size;
    paintEffect();
    document.body.toggleAttribute("data-relief-glass", !!style.glass);
    document.body.toggleAttribute("data-relief-tip", !!style.tip);
    ui.hideTip();
    $("#relief-name").textContent = style.label;
    $("#relief-switch").title = style.label;
    $("#current-palette").textContent = style.label;
    document.title = (production ? "Ресурсная панель" : "Маршруты · Рельеф") + " · " + style.label;
    paintTheme();
    window.RP.theme.paint();
    repaint();
  }

  function codeSetting() {
    return production ? "relief_codes" : "relief_codes_" + state.style.id;
  }

  function paintMarkings() {
    const codes = appearance.get(codeSetting(), production || !!state.style.codes);
    document.body.toggleAttribute("data-relief-codes", codes);
    document.body.toggleAttribute("data-relief-edges", state.edges);
    $("#contour-codes").checked = codes;
    $("#contour-edges").checked = state.edges;
  }

  function contourLegend() {
    return [["seg", segments], ["env", stands]].map(([axis, options]) => {
      const label = axis === "seg" ? "Сегмент" : "Стенд";
      const chips = options.map(([id, text, code]) => '<span class="contour-key" data-' + axis + '="' + id +
        '"><i></i><b>' + code + '</b><span>' + text + '</span></span>').join("");
      return '<span class="contour-axis"><span class="contour-axis-label">' + label + '</span>' + chips + '</span>';
    }).join("");
  }

  function menuContents() {
    switch (state.menu) {
      case "relief":
        return reliefStyles.map(({ id, label, icon }) => choiceItem({
          id, label, icon, action: "style", pressed: state.style.id === id
        }, true));
      case "sections":
        return [{ id: "", name: "Все разделы", icon: "layers" }, ...ui.data.sections]
          .filter((item) => !ui.off.includes(item.id) || state.view === "all")
          .map((item) => choiceItem({ ...item, label: item.name, action: "section",
            pressed: state.section === item.id }, true));
      case "scope":
        if (!scope) return [];
        return [{ id: "", label: "К обзору", icon: "left" }]
          .concat(scope.choices).map((item) => choiceItem({ ...item, pressed: scope.picked?.id === item.id }, true));
      case "groups":
        return ui.data.sections.map((section) => choiceItem({
          ...section, label: section.name, action: "group", pressed: !ui.off.includes(section.id)
        }, true)).concat(choiceItem({ id: "", label: "Показать все разделы", icon: "eye", action: "show-groups" }, true));
      default: return [];
    }
  }

  function paintMenu() {
    if (!state.menu) return;
    const labels = {
      relief: production ? "Оформление" : "Вариации Рельефа", effects: "Эффекты кнопок", sections: "Разделы", scope: scope?.label || "Разделы", filters: "Фильтры",
      settings: "Настройки", groups: "Видимые разделы", legend: "Условные обозначения"
    };
    const menu = $("#menu");
    menu.dataset.panel = state.menu;
    $("#menu-title").textContent = labels[state.menu];
    $("#settings-back").hidden = !state.settingsChild || state.menu === "settings";
    const hint = $("#legend-hint");
    hint.hidden = state.menu !== "legend";
    hint.textContent = "Слева указан сегмент, справа стенд. Цвет, коды и кромки используют одну легенду.";
    const grid = $("#menu-grid");
    const mode = ["effects", "filters", "settings", "legend"];
    mode.forEach((name) => { $("#" + (name === "filters" ? "filter" : name) + "-panel").hidden = state.menu !== name; });
    grid.hidden = mode.includes(state.menu);
    const pager = $(".menu-pages");
    pager.hidden = true;
    if (state.menu === "effects") paintEffect();
    if (state.menu === "legend") paintMarkings();
    if (grid.hidden) return;
    const entries = menuContents();
    const width = $("#menu-main").clientWidth;
    const height = $("#menu-main").clientHeight;
    const config = { flow: "row", width: width < 370 ? 140 : 173, height: 40 };
    let shape = fit(entries.length, width, height, [config], 52, 3);
    if (entries.length > shape.capacity) {
      pager.hidden = false;
      shape = fit(entries.length, width, $("#menu-main").clientHeight, [config], 52, 3);
    }
    const pages = Math.max(1, Math.ceil(entries.length / shape.capacity));
    state.menuPage = Math.min(state.menuPage, pages - 1);
    const start = state.menuPage * shape.capacity;
    const shown = entries.slice(start, start + shape.capacity);
    drawGrid(grid, config, shape, Math.ceil(shown.length / shape.columns));
    setContent(grid, shown.join(""));
    $("#menu-previous").disabled = state.menuPage === 0;
    $("#menu-next").disabled = state.menuPage >= pages - 1;
    $("#menu-range").textContent = (state.menuPage + 1) + " / " + pages;
  }

  function openMenu(name) {
    state.menu = name;
    state.menuPage = 0;
    const menu = $("#menu");
    ui.openLayer(menu, { focus: $("#menu-close"), onClose: () => {
      state.menu = "";
      state.settingsChild = false;
      $("#effect-demo").classList.remove("effect-playing");
      resetTilt();
      $(".workspace").inert = false;
    } });
    $(".workspace").inert = true;
    paintMenu();
    if (name === "effects") playEffect();
  }

  function choose(id) {
    state.choice = id ?? "";
    if (state.menu) ui.closeLayer();
    restart();
  }

  function changeView(id) {
    state.view = id;
    state.choice = "";
    state.section = "";
    if (["all", "favorite", "meetings", "health"].includes(id)) {
      const trigger = document.activeElement;
      ui.resetAll();
      trigger?.focus({ preventScroll: true });
    }
    paintViews();
    restart();
  }

  function handleAction(event) {
    const button = event.target.closest("button[data-action], button[data-menu]");
    if (!button) return;
    const { action, id, menu } = button.dataset;
    if (menu === "sections" && railFits()) {
      state.railOpen = !state.railOpen;
      store.set("rail_relief", state.railOpen);
      restart();
      return;
    }
    if (menu) {
      if (state.menu === "settings" && ["relief", "effects", "legend", "groups"].includes(menu)) state.settingsChild = true;
      openMenu(menu);
      return;
    }
    switch (action) {
      case "effect":
        state.effect = id;
        appearance.set("relief_effect", id);
        resetTilt();
        paintEffect();
        playEffect();
        break;
      case "replay-effect": playEffect(); break;
      case "style":
        if (production) {
          appearance.set("style", id);
          appearance.set("theme", null);
          updateStyle();
          openMenu("settings");
        } else {
          ui.closeLayer();
          if (location.hash !== "#" + id) location.hash = id;
        }
        break;
      case "close-menu": ui.closeLayer(); break;
      case "view": changeView(id); break;
      case "choose": choose(id); break;
      case "section":
        if (state.menu) ui.closeLayer();
        state.section = id;
        state.choice = id;
        if (["favorite", "meetings", "health"].includes(state.view)) {
          state.view = "layout";
          paintViews();
        }
        restart();
        break;
      case "page":
        state.page += Number(id);
        resetSelection();
        repaint();
        if (button.disabled) {
          const alternate = Number(id) > 0 ? $("#previous-page") : $("#next-page");
          alternate.focus({ preventScroll: true });
        }
        break;
      case "menu-page":
        state.menuPage += Number(id);
        paintMenu();
        if (button.disabled) $("#menu-close").focus({ preventScroll: true });
        break;
      case "group":
        ui.setOff(ui.off.includes(id) ? ui.off.filter((value) => value !== id) : [...ui.off, id]);
        restart();
        paintMenu();
        break;
      case "show-groups":
        ui.setOff([]);
        restart();
        paintMenu();
        break;
      case "reset":
        ui.closeLayer();
        ui.resetAll();
        restart();
        break;
    }
  }

  function handleKeys(event) {
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    const q = $("#q");
    if (event.key === "Enter" && !q.value.trim() && state.keyboardIndex < 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (ui.filter.q !== q.value) {
      ui.filter.q = q.value;
      ui.apply();
      repaint();
    }
    const items = [...$("#board-grid").querySelectorAll("a[data-link-id], button[data-link-id]")];
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
    q.setAttribute("aria-activedescendant", items[state.keyboardIndex].id);
  }

  function setViewport() {
    const visual = window.visualViewport;
    const height = visual && visual.scale === 1 ? Math.min(window.innerHeight, visual.height) : window.innerHeight;
    document.documentElement.style.setProperty("--measured-height", Math.floor(height) + "px");
    scheduleRender();
    if (state.menu) paintMenu();
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!ui.data) return;
    for (const node of document.querySelectorAll("span[data-icon]")) node.innerHTML = picture(node.dataset.icon);
    setContent($("#inline-contours"), contourLegend());
    setContent($("#legend-colors"), contourLegend());
    $("#contour-codes").addEventListener("change", (event) => {
      appearance.set(codeSetting(), event.target.checked);
      paintMarkings();
    });
    $("#contour-edges").addEventListener("change", (event) => {
      state.edges = event.target.checked;
      appearance.set("relief_edges", state.edges);
      paintMarkings();
    });
    $("#sort").value = state.sort;
    $("#show-down").checked = state.showDown;
    $("#live").checked = live;
    $("#data-mode").textContent = live ? "Реальные статусы" : "Демо-статусы";
    $("#check-mode").textContent = live ? "Сеть" : "Демо";
    $("#health-view").title = live ? "Доступность в сети" : "Демонстрационные статусы";
    $("#refresh").title = live ? "Проверить рабочие адреса" : "Обновить демонстрационные статусы";
    window.addEventListener("hashchange", updateStyle);
    $(".skip-link").addEventListener("click", (event) => {
      event.preventDefault();
      $("#catalog").focus({ preventScroll: true });
    });
    $("#sort").addEventListener("change", () => {
      state.sort = $("#sort").value;
      store.set("sort", state.sort);
      restart();
    });
    $("#show-down").addEventListener("change", () => {
      state.showDown = $("#show-down").checked;
      store.set("show_down", state.showDown);
      restart();
    });
    $("#live").addEventListener("change", () => {
      store.set("live", $("#live").checked);
      location.reload();
    });
    $("#lock").addEventListener("click", () => ui.closeLayer(), true);
    document.addEventListener("click", handleAction);
    document.addEventListener("pointermove", tiltAtPointer, { passive: true });
    document.addEventListener("pointerout", (event) => {
      if (hoveredButton?.contains(event.target) && !hoveredButton.contains(event.relatedTarget)) resetTilt();
    }, { passive: true });
    window.addEventListener("blur", resetTilt);
    reducedMotion.addEventListener("change", paintEffect);
    $("#effect-demo").addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse" && pointerMotion.matches &&
          ["beam", "pulse", "rock", "wave"].includes(document.body.dataset.reliefMotion)) playEffect();
    });
    $("#effect-demo").addEventListener("animationend", (event) => {
      if (event.target.id === "effect-demo" && !event.pseudoElement) event.target.classList.remove("effect-playing");
    });
    $("#q").addEventListener("keydown", handleKeys, true);
    const observer = new MutationObserver(scheduleRender);
    for (const target of [$("#idx"), $("#dock"), $("#sum")]) {
      observer.observe(target, { subtree: true, childList: true, attributes: true });
    }
    new ResizeObserver(scheduleRender).observe($("#catalog"));
    window.addEventListener("resize", setViewport);
    window.visualViewport?.addEventListener("resize", setViewport);
    setViewport();
    updateStyle();
    if (!production && new URLSearchParams(location.search).has("effects")) {
      $("#effects-button").focus({ preventScroll: true });
      openMenu("effects");
    }
  });
})();
