/* The release owns the catalog, search, filters, availability, actions and editor. */
(() => {
  "use strict";

  const concepts = [
    { id: "pearl", name: "Атлас · Перламутр", icon: "layers", mode: "glaze", full: true, variation: true },
    { id: "relief", name: "Маршруты · Рельеф", icon: "flag", mode: "glaze", variation: true, rail: true, dark: true },
    { id: "prism", name: "Витрина · Призма", icon: "bundle", mode: "glaze", variation: true, rail: true },
    { id: "folio", name: "Атлас ресурсов", icon: "layers", mode: "edges", full: true },
    { id: "cabinet", name: "Кабинет", icon: "folder" },
    { id: "chroma", name: "Спектр контуров", icon: "flask", mode: "split" },
    { id: "bench", name: "Рабочая станция", icon: "monitor", dark: true },
    { id: "relay", name: "Инспектор", icon: "target", mode: "symbols", dark: true },
    { id: "command", name: "Командная строка", icon: "cmd", mode: "codes", dark: true },
    { id: "index", name: "Указатель", icon: "book" },
    { id: "routes", name: "Маршруты", icon: "flag", mode: "edges" },
    { id: "signal", name: "Монитор доступности", icon: "gauge", mode: "symbols", dark: true },
    { id: "services", name: "Витрина сервисов", icon: "bundle", mode: "split" }
  ];
  const sectionShort = {
    comms: "Связь", heroes: "Герои продаж", kap: "КАП", sup: "СУП", access: "Доступы",
    itsm: "Сервис", data: "Данные", docs: "Документы", jira: "Задачи", repo: "Репозитории", tools: "Инструменты"
  };
  const quickIds = ["h-prom-a", "kap-prom", "qlik", "dpm"];
  const stands = [["PROM", "PROM", "●", "P"], ["PSI", "ПСИ", "▲", "Ψ"], ["IFT", "ИФТ", "■", "I"], ["", "Без стенда", "–", "–"]];
  const segments = [["ALPHA", "Alpha", "║", "α"], ["SIGMA", "Sigma", "○", "σ"], ["", "Без сегмента", "–", "–"]];
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
  const nativeGet = store.get;
  const nativeSet = store.set;
  store.get = (key, fallback) => nativeGet(ns + key, fallback);
  store.set = (key, value) => nativeSet(ns + key, value);
  const live = store.get("live", false);
  const state = {
    concept: concepts.find(({ id }) => "#" + id === location.hash) || concepts[0],
    view: "layout",
    choice: "",
    section: "",
    railOpen: false,
    focusLink: "",
    page: 0,
    menu: "",
    menuPage: 0,
    sort: store.get("sort", "source"),
    showDown: store.get("show_down", true),
    recent: store.get("recent", []),
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
    document.documentElement.dataset.theme = store.get("rp_theme", state.concept.dark ? "dark" : "light");
  }
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

  function contourValue(values, value) {
    return values.find(([key]) => key === value) || values.at(-1);
  }

  function contourMarks(link) {
    const mode = state.concept.mode || "text";
    if (mode === "text") return ui.tagsHtml(link);
    if (["split", "edges", "glaze"].includes(mode) || (!link.env && !link.seg)) return "";
    return '<span class="contour-marks" aria-hidden="true">' + [
      ["env", stands, link.env], ["seg", segments, link.seg]
    ].map(([axis, values, value]) => {
      const [key, , symbol, code] = contourValue(values, value);
      return '<span data-' + axis + '="' + key + '">' + (mode === "codes" ? code : symbol) + "</span>";
    }).join("") + "</span>";
  }

  function linkItem(link, inspect = false, quick = false) {
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
    const body = '<span class="item-icon">' + picture(ui.iconOf(link)) + '</span><span class="item-content">' +
      title + contourMarks(link) + '</span><span class="item-badges" aria-hidden="true">' + badges + "</span>";
    const attrs = ' class="resource' + (link.title.length >= 24 ? " long-title" : "") + '" data-st="' + status + '" data-env="' + (link.env || "") + '" data-seg="' +
      (link.seg || "") + '" data-section="' + esc(link.section) + '" data-catalog-link="' + esc(link.id) + '" aria-label="' + esc(text) + '" title="' + esc(text) + '"';
    if (inspect) {
      return '<button type="button"' + attrs + ' data-action="inspect" data-id="' + esc(link.id) +
        '" aria-pressed="' + (state.focusLink === link.id) + '">' + body + "</button>";
    }
    if (status === "down") return '<div' + attrs + ' role="link" aria-disabled="true">' + body + "</div>";
    const action = attrs + ' data-link-id="' + esc(link.id) + '"';
    if (link.tool) return '<button type="button"' + action + ">" + body + "</button>";
    return '<a' + action + ' href="' + esc(link.url) + '" target="_blank" rel="noopener">' + body + "</a>";
  }

  function visibleLinks() {
    const { q, env, seg } = ui.filter;
    const full = state.view === "all" || state.concept.full;
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

  function sections(links) {
    return ui.data.sections.map((section) => ({
      id: section.id, label: section.name, icon: section.icon,
      links: links.filter((link) => link.section === section.id)
    })).filter((section) => section.links.length);
  }

  function groupsOf(links, keyOf) {
    const groups = new Map();
    links.forEach((link) => {
      const key = keyOf(link);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(link);
    });
    return groups;
  }

  function choiceItems(choices) {
    return choices.map((choice) => ({ ...choice, kind: "choice" }));
  }

  function clusters(groups) {
    return groups.flatMap((group) => group.links.length ? [
      { kind: "group", id: group.id, label: group.label, icon: group.icon, size: group.links.length }, ...group.links
    ] : []);
  }

  function selection(choices, label, options = {}) {
    const picked = choices.find(({ id }) => id === state.choice) || (options.first ? choices[0] : null);
    return {
      entries: picked ? picked.links : choiceItems(choices),
      scope: { label, choices, picked, back: !options.first },
      rail: options.rail,
      inspect: options.inspect && !!picked,
      style: picked ? "regular" : options.style
    };
  }

  function panel(id, label, icon, links, action = "choose", env = "") {
    return { kind: "panel", id, label, icon, links, action, env };
  }

  function recentLinks(links) {
    const recent = state.recent.map((id) => links.find((link) => link.id === id)).filter(Boolean);
    return recent.length ? recent : links.filter((link) => quickIds.includes(link.id));
  }

  function workstation(links) {
    return { style: "workstation", entries: [
      panel("favorite", "Избранное", "star", favoriteLinks(links), "view"),
      panel("meetings", "Встречи", "video", links.filter((link) => link.meet), "view"),
      panel("recent", state.recent.length ? "Последние открытия" : "Рабочие системы", "clock", recentLinks(links), "desk-list"),
      panel("tools", "Инструменты", "cmd", links.filter((link) => link.tool), "section")
    ].filter(({ links: items }) => items.length) };
  }

  function spectrum(links) {
    const choices = stands.map(([env, label]) => ({
      id: env || "none", label, env,
      links: links.filter((link) => (link.env || "") === env)
    })).filter(({ links: items }) => items.length);
    const model = selection(choices, "Стенды");
    if (!model.scope.picked) {
      model.style = "spectrum";
      model.entries = choices.map((item) =>
        panel(item.id, item.label, item.env ? "flask" : "link", item.links, "choose", item.env));
    } else {
      model.entries = clusters(segments.map(([seg, label]) => ({
        label, links: model.entries.filter((link) => (link.seg || "") === seg)
      })));
    }
    return model;
  }

  function alphabet(links) {
    const grouped = groupsOf(links, (link) => /^[\p{L}]/u.test(link.title) ? link.title[0].toUpperCase() : "#");
    const choices = [...grouped].sort(([a], [b]) => a.localeCompare(b, "ru")).map(([letter, items]) => ({
      id: letter, label: letter, links: state.sort === "usage" ? items : [...items].sort(byTitle)
    }));
    const model = selection(choices, "Буквы");
    if (!model.scope.picked) {
      model.entries = clusters(choices);
      model.plain = choices.flatMap(({ links: items }) => items);
    }
    return model;
  }

  function command(links) {
    const favorites = favoriteLinks(links);
    const hints = [...new Set(links.filter((link) => quickIds.includes(link.id)).map((link) => link.title))];
    const shortcuts = hints.map((label) => ({ id: label, label, icon: "search", action: "query" }));
    return { style: "command", shortcuts, entries: clusters([
      { label: "Избранное", icon: "star", links: favorites },
      { label: "Последние открытия", icon: "clock", links: state.recent.length ?
        recentLinks(links).filter((link) => !favorites.includes(link)) : [] }
    ]).concat([{ kind: "group", label: "Разделы", icon: "layers" }],
      choiceItems(sections(links).map((section) => ({ ...section, action: "section" })))) };
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
      model.entries = model.scope.choices.map((item) => panel(item.id, item.label, item.icon, item.links));
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

  function services(links) {
    const grouped = groupsOf(links, (link) => link.section + "/" + link.title);
    const choices = [...grouped].map(([id, items]) => ({
      id, label: items[0].title, icon: ui.iconOf(items[0]), links: items
    }));
    const model = selection(choices.filter(({ links: items }) => items.length > 1), "Сервисы");
    if (!model.scope.picked) model.entries = choices.map((choice) =>
      choice.links.length > 1 ? { ...choice, kind: "choice" } : choice.links[0]);
    if (!model.scope.picked) model.style = "services";
    return model;
  }

  function atlas(links) {
    return { entries: clusters(sections(links)), plain: links, style: "folio" };
  }

  const layouts = {
    pearl: atlas,
    relief: routes,
    prism: services,
    folio: atlas,
    cabinet: (links) => selection(sections(links), "Разделы", { first: true, rail: true }),
    chroma: spectrum,
    bench: workstation,
    relay: (links) => selection(sections(links), "Разделы", { first: true, rail: true, inspect: true }),
    command,
    index: alphabet,
    routes,
    signal: availability,
    services
  };

  function depiction(links) {
    if (state.view === "favorite") return { entries: favoriteLinks(links), fallback: "По этим условиям в избранном ничего нет." };
    if (state.view === "meetings") return { entries: links.filter((link) => link.meet) };
    if (state.view === "recent") return { entries: recentLinks(links) };
    if (state.view === "health") return availability(links);
    if (state.section) return {
      entries: links, style: "regular", inspect: state.concept.id === "relay",
      scope: { label: "Разделы", choices: sections(ui.data.links.filter((link) => !ui.off.includes(link.section))),
        picked: { id: state.section, label: ui.secById[state.section]?.name } },
      rail: ["cabinet", "relay"].includes(state.concept.id)
    };
    const { q, env, seg } = ui.filter;
    if (q.trim() || env.length || seg.length) return { entries: links };
    if (state.view === "all") return state.concept.full ? layouts[state.concept.id](links) : { entries: links };
    return layouts[state.concept.id](links);
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
    if (model.style === "regular" && model.entries.length <= 22 && state.concept.id === "cabinet") {
      return { presets: [{ width: 222, height: 83 }, ...spacious], max: 130, columns: 3, flow: "row" };
    }
    if (model.inspect) return { presets: spacious, max: 66, columns: 1, flow: "row" };
    if (model.style === "workstation") return {
      presets: [{ width: 340, height: 205 }, { width: 150, height: 191 }], max: 400, columns: 2, flow: "row"
    };
    if (model.style === "spectrum") return {
      presets: [{ width: 250, height: 205 }, { width: 150, height: 191 }], max: 560, columns: 4, flow: "row"
    };
    if (model.style === "routes") return {
      presets: [{ width: 260, height: 205 }, { width: 146, height: 191 }], max: 280, columns: 3, flow: "row"
    };
    if (model.style === "route-choices") return {
      presets: [{ width: 220, height: 66 }, { width: 146, height: 58 }], max: 105, columns: 3, flow: "row"
    };
    if (model.style === "command") return { presets: spacious, max: 67, columns: 6, flow: "row" };
    const useTiles = model.style === "regular" || model.style === "services";
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
    const environment = item.env === undefined ? "" : ' data-env="' + item.env + '"';
    const icon = item.icon ? '<span class="choice-icon">' + picture(item.icon) + "</span>" : "";
    const size = item.links ? '<span class="count">' + item.links.length + "</span>" : "";
    const disabled = item.links && !item.links.length ? " disabled" : "";
    const examples = sample && item.links?.slice(0, 2).map((link) => link.title).join(" · ");
    const label = '<span class="choice-name">' + esc(item.label) + "</span>";
    return '<button class="' + (asMenu ? "menu-option" : "choice") + '" type="button"' + attr + stateAttr +
      environment + disabled + ">" + icon + (examples ? '<span class="route-copy">' + label +
        '<span class="route-sample">' + esc(examples) + "</span></span>" : label) + size + "</button>";
  }

  function gridItem(item, inspect, previewLimit) {
    if (item.kind === "panel") {
      const preview = item.links.slice(0, previewLimit);
      return '<section class="link-panel" data-env="' + item.env + '" data-panel="' + esc(item.id) + '">' +
        choiceItem(item) + '<div class="pane-links" style="--pane-limit:' + (preview.length * 44) + 'px">' +
        preview.map((link) => linkItem(link)).join("") + "</div></section>";
    }
    if (item.kind === "choice") return choiceItem(item, false, state.concept.id === "routes");
    if (item.kind === "group") return '<h2 class="group-label" data-section="' + esc(item.id || "") + '">' +
      (item.icon ? picture(item.icon) : "") + "<span>" + esc(item.label) + "</span>" +
      (item.size ? '<small class="count">' + item.size + "</small>" : "") + "</h2>";
    return linkItem(item, inspect);
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

  function previewContent(link) {
    const context = [ui.ENV[link.env], ui.SEG[link.seg]].filter(Boolean).join(" / ");
    const host = link.url ? core.parseUrl(link.url).host : "";
    const status = statusOf(link);
    const details = '<div class="preview-icon">' + picture(ui.iconOf(link)) + '</div><h2>' + esc(link.title) +
      '</h2><p>' + esc(ui.secById[link.section]?.name || "") + '</p><p>' + esc(context || "Без отметок контура") +
      ' · ' + statusNames[status] + "</p>" + (host ? '<p class="host">' + esc(host) + "</p>" : "") +
      (link.copy ? '<p>Код скопируется при открытии</p>' : "");
    if (status === "down") return details;
    const attrs = ' class="control preview-open" data-link-id="' + esc(link.id) + '" data-st="' + status + '"';
    if (link.tool) return details + '<button type="button"' + attrs + ">Запустить</button>";
    return details + '<a href="' + esc(link.url) + '" target="_blank" rel="noopener"' + attrs + ">Открыть ссылку ↗</a>";
  }

  function paintViews() {
    const views = [
      ["layout", "Обзор", "grid"], ["all", "Все ссылки", "link"], ["favorite", "Избранное", "star"], ["meetings", "Встречи", "video"]
    ];
    const useShelf = shelfFits();
    const visibleViews = views.filter(([id]) => !(state.concept.full && id === "layout") &&
      !(useShelf && ["favorite", "meetings"].includes(id)));
    setContent($("#views"), visibleViews.map(([id, name, icon]) => '<button class="control" type="button" data-action="view" data-id="' +
      id + '" aria-label="' + name + '" title="' + name + '" aria-pressed="' +
      (state.view === id) + '">' + picture(icon) + '<span class="wide-label">' + name + "</span></button>").join(""));
  }

  function shelfFits() {
    return !!state.concept.variation && window.innerWidth >= 740 && document.documentElement.clientHeight >= 665;
  }

  function railChoices() {
    return [{ id: "", label: "Все разделы", icon: "layers" }, ...ui.data.sections
      .filter((section) => !ui.off.includes(section.id) || state.view === "all")
      .map((section) => ({ ...section, label: section.name }))];
  }

  function railFits() {
    return !!state.concept.variation && $("#catalog").clientWidth >= 1070 &&
      railChoices().length * 31 + 28 <= $("#catalog").clientHeight;
  }

  function paintQuickAccess() {
    const variation = !!state.concept.variation;
    const shelf = $("#quick-shelf");
    shelf.hidden = !shelfFits();
    const refresh = $("#refresh");
    const sum = $("#sum");
    const refreshHost = $(variation ? "#check-slot" : "#check-home");
    const sumHost = $(variation ? "#health-readout" : "#status-home");
    if (refresh.parentNode !== refreshHost) refreshHost.append(refresh);
    if (sum.parentNode !== sumHost) sumHost.append(sum);
    $("#check-slot").hidden = !variation;
    $("#health-view").hidden = !variation;
    $("#health-view").setAttribute("aria-pressed", String(state.view === "health"));
    paintViews();
    if (shelf.hidden) return;

    const links = ui.data.links;
    const favorites = favoriteLinks(links);
    const meetings = links.filter((link) => link.meet && (state.showDown || statusOf(link) !== "down"));
    const shelfSize = window.innerWidth >= 1400 ? 2 : window.innerWidth >= 1090 ? 1 : 0;
    for (const [id, label, icon, collection, limit] of [
      ["favorite", "Избранное", "star", favorites, [2, 4, 5][shelfSize]],
      ["meetings", "Встречи", "video", meetings, 1 + shelfSize]
    ]) {
      const title = '<button type="button" class="control quick-view" data-action="view" data-id="' + id +
        '" aria-label="' + label + '" aria-pressed="' + (state.view === id) + '">' + picture(icon) +
        "<span>" + label + '</span><small>' + collection.length + '</small></button>';
      setContent($("#quick-" + id), title + collection.slice(0, limit).map((link) => linkItem(link, false, true)).join(""));
    }
  }

  function paintScope(model) {
    scope = model.scope || null;
    const catalog = $("#catalog");
    const rail = $("#section-rail");
    const canToggle = railFits();
    const showRail = state.concept.variation ? canToggle && state.railOpen :
      scope && model.rail && catalog.clientWidth >= 950 &&
      (scope.choices.length + Number(scope.back)) * 43 - gap <= catalog.clientHeight;
    rail.hidden = !showRail;
    const railToggle = $("#sections-button");
    railToggle.setAttribute("aria-haspopup", canToggle ? "false" : "dialog");
    if (canToggle) railToggle.setAttribute("aria-expanded", String(!!showRail));
    else railToggle.removeAttribute("aria-expanded");
    $("#scope").hidden = !scope || scope.label === "Разделы" ||
      ((state.concept.id === "signal" || state.view === "health") && !scope.picked);
    if (scope?.label === "Разделы" && !showRail && scope.picked && !state.section) {
      $("#section-label").textContent = scope.picked.label;
    }
    if (showRail) {
      const choices = state.concept.variation ? railChoices() : scope.choices;
      const picked = state.concept.variation ? state.section : scope.picked?.id || "";
      setContent(rail, choices.map((choice) =>
        choiceItem({ ...choice, action: "section", pressed: choice.id === picked })).join(""));
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
    const items = ui.data.sections.filter((item) => !ui.off.includes(item.id) || state.view === "all");
    const buttons = items.map((item) => '<button type="button" data-section="' + esc(item.id) +
      '" data-action="section" data-id="' + esc(item.id) + '" aria-pressed="' + (item.id === state.section) +
      '" title="' + esc(item.name) + '" aria-label="' + esc(item.name) + '">' + picture(item.icon) +
      '<span>' + esc(sectionShort[item.id] || item.name) + "</span></button>");
    setContent($("#section-strip"), buttons.join(""));
  }

  function paintMast(model, links) {
    const target = $("#board-mast");
    const label = ui.secById[state.section]?.name || model.scope?.picked?.label ||
      (state.view === "favorite" ? "Избранное" : state.view === "meetings" ? "Встречи" : "");
    const status = model.scope && !model.scope.picked &&
      (state.view === "health" || (state.concept.id === "signal" && state.view === "layout"));
    target.hidden = !label && !status && !model.shortcuts?.length;
    if (status) {
      setContent(target, model.scope.choices.map((choice) => choiceItem(choice)).join(""));
    } else if (model.shortcuts?.length) {
      setContent(target, model.shortcuts.map((choice) => choiceItem(choice)).join(""));
    } else if (label) {
      setContent(target, '<h2>' + esc(label) + '</h2><span>' +
        (model.entries.some((entry) => entry.kind) ? links.length : model.entries.length) + "</span>");
    }
  }

  function resetSelection() {
    state.keyboardIndex = -1;
    $("#q").removeAttribute("aria-activedescendant");
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
    const catalog = $("#catalog");
    const board = $("#board-body");
    const preview = $("#preview");
    const inspected = model.inspect && (model.entries.find((link) => link.id === state.focusLink) || model.entries[0]);
    if (inspected) state.focusLink = inspected.id;
    preview.hidden = !(inspected && catalog.clientWidth >= 790 && catalog.clientHeight >= 282);
    if (!preview.hidden) setContent(preview, previewContent(inspected));
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
    const pages = Math.max(1, Math.ceil(entries.length / shape.capacity));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * shape.capacity;
    const shown = entries.slice(start, start + shape.capacity);
    const rows = Math.ceil(shown.length / shape.columns);
    drawGrid(grid, config, shape, rows);
    grid.dataset.style = model.style || "catalog";
    grid.dataset.dense = String(shape.rowHeight < 49);
    const previewLimit = Math.max(2, Math.min(12, Math.floor((shape.rowHeight - 64) / 34)));
    const html = shown.map((item) => gridItem(item, model.inspect, previewLimit)).join("");
    const empty = model.fallback || (ui.off.length === ui.data.sections.length && state.view !== "all" && !state.concept.full ?
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

  function updateConcept() {
    state.concept = concepts.find(({ id }) => "#" + id === location.hash) || concepts[0];
    state.view = state.concept.full ? "all" : "layout";
    state.railOpen = store.get("rail_" + state.concept.id, !!state.concept.rail);
    document.body.toggleAttribute("data-variation", !!state.concept.variation);
    state.choice = "";
    state.section = "";
    state.focusLink = "";
    const { q, env, seg } = ui.filter;
    if (state.concept.full && (q.trim() || env.length || seg.length)) {
      const former = document.activeElement;
      ui.resetAll();
      former?.focus({ preventScroll: true });
    }
    document.body.dataset.concept = state.concept.id;
    document.body.dataset.marks = state.concept.mode || "text";
    $("#concept-name").textContent = state.concept.name;
    $("#concept-emblem").innerHTML = picture(state.concept.icon);
    $("#concept").title = state.concept.name;
    document.title = state.concept.name + " · Ресурсная панель";
    paintTheme();
    window.RP.theme.paint();
    paintViews();
    restart();
  }

  function legendItems() {
    const rows = [
      ...stands.slice(0, -1).map(([id, label, symbol, code]) => ({ axis: "env", id, label, symbol, code })),
      ...segments.slice(0, -1).map(([id, label, symbol, code]) => ({ axis: "seg", id, label, symbol, code }))
    ];
    return rows.map(({ axis, id, label, symbol, code }) => '<div class="legend-item" data-' + axis + '="' + id +
      '"><span class="legend-swatch"></span><span>' + label + '</span><span class="legend-symbol">' +
      symbol + ' / ' + code + '</span></div>').concat([
      '<div class="legend-item legend-up"><span>✓</span><span>Доступна</span></div>',
      '<div class="legend-item legend-down"><span>×</span><span>Недоступна</span></div>',
      '<div class="legend-item"><span>◆</span><span>Инструмент</span></div>',
      '<div class="legend-item"><span>–</span><span>Без проверки</span></div>',
      '<div class="legend-item"><span>★</span><span>Закреплена</span></div>'
    ]);
  }

  function menuContents() {
    switch (state.menu) {
      case "concepts":
        return concepts.map((item) => choiceItem({
          ...item, label: item.name, action: "concept", pressed: state.concept.id === item.id
        }, true));
      case "sections":
        return [{ id: "", name: "Все разделы", icon: "layers" }, ...ui.data.sections]
          .filter((item) => !ui.off.includes(item.id) || state.view === "all")
          .map((item) => choiceItem({ ...item, label: item.name, action: "section",
            pressed: (state.section || scope?.picked?.id || "") === item.id }, true));
      case "scope":
        if (!scope) return [];
        return (scope.back ? [{ id: "", label: "К обзору", icon: "left" }] : [])
          .concat(scope.choices).map((item) => choiceItem({ ...item, pressed: scope.picked?.id === item.id }, true));
      case "groups":
        return ui.data.sections.map((section) => choiceItem({
          ...section, label: section.name, action: "group", pressed: !ui.off.includes(section.id)
        }, true)).concat(choiceItem({ id: "", label: "Показать все разделы", icon: "eye", action: "show-groups" }, true));
      case "legend": return legendItems();
      default: return [];
    }
  }

  function paintMenu() {
    if (!state.menu) return;
    const labels = {
      concepts: "Концепты", sections: "Разделы", scope: scope?.label || "Разделы", filters: "Фильтры",
      settings: "Настройки", groups: "Видимые разделы", legend: "Условные обозначения", inspect: "Ссылка"
    };
    const menu = $("#menu");
    menu.dataset.panel = state.menu;
    $("#menu-title").textContent = labels[state.menu];
    const hint = $("#legend-hint");
    const legend = {
      glaze: "Оттенок у значка показывает сегмент и плавно переходит в цвет стенда. Подписи доступны в фильтрах и при наведении.",
      split: "Левая половина — сегмент, правая — стенд. Серый цвет обозначает отсутствие отметки.",
      edges: "Левая обводка — сегмент, правая — стенд.",
      symbols: "Первая фигура — стенд, вторая — сегмент.",
      codes: "Первая буква — стенд, вторая — сегмент.",
      text: "Стенд и сегмент подписаны рядом с названием. В плотной сетке слева цвет сегмента, справа цвет стенда."
    };
    hint.hidden = state.menu !== "legend";
    hint.textContent = legend[state.concept.mode || "text"];
    const grid = $("#menu-grid");
    const mode = ["filters", "settings", "inspect"];
    mode.forEach((name) => { $("#" + (name === "filters" ? "filter" : name) + "-panel").hidden = state.menu !== name; });
    grid.hidden = mode.includes(state.menu);
    const pager = $(".menu-pages");
    pager.hidden = true;
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
      $(".workspace").inert = false;
    } });
    $(".workspace").inert = true;
    paintMenu();
  }

  function choose(id) {
    state.choice = id ?? "";
    state.focusLink = "";
    if (state.menu) ui.closeLayer();
    restart();
  }

  function changeView(id) {
    state.view = id;
    state.choice = "";
    state.section = "";
    state.focusLink = "";
    if (id === "all" || (state.concept.variation && ["favorite", "meetings", "health"].includes(id))) {
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
      store.set("rail_" + state.concept.id, state.railOpen);
      restart();
      return;
    }
    if (menu) { openMenu(menu); return; }
    switch (action) {
      case "concept":
        ui.closeLayer();
        if (location.hash !== "#" + id) location.hash = id;
        break;
      case "close-menu": ui.closeLayer(); break;
      case "view": changeView(id); break;
      case "choose": choose(id); break;
      case "section":
        if (state.menu) ui.closeLayer();
        state.section = id;
        state.choice = id;
        state.focusLink = "";
        if (["favorite", "meetings", "recent", "health"].includes(state.view)) {
          state.view = state.concept.full ? "all" : "layout";
          paintViews();
        }
        restart();
        break;
      case "desk-list": changeView("recent"); break;
      case "query": {
        const input = $("#q");
        input.value = id;
        ui.filter.q = id;
        ui.apply();
        input.focus();
        restart();
        break;
      }
      case "inspect":
        state.focusLink = id;
        if ($("#preview").hidden) {
          setContent($("#inspect-panel"), previewContent(ui.byId[id]));
          openMenu("inspect");
        }
        repaint();
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
    const items = [...$("#board-grid").querySelectorAll("a[data-link-id], button[data-link-id], button[data-action='inspect']")];
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

  function trackRecent(event) {
    const item = event.target.closest(".workspace [data-link-id], #inspect-panel [data-link-id]");
    if (!item || event.ctrlKey || event.metaKey || ![0, 1].includes(event.button)) return;
    const id = item.dataset.linkId;
    state.recent = [id, ...state.recent.filter((value) => value !== id)].slice(0, 8);
    store.set("recent", state.recent);
    scheduleRender();
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
    $("#sort").value = state.sort;
    $("#show-down").checked = state.showDown;
    $("#live").checked = live;
    $("#data-mode").textContent = live ? "Реальные статусы" : "Демо-статусы";
    $("#check-mode").textContent = live ? "Сеть" : "Демо";
    $("#health-view").title = live ? "Доступность в сети" : "Демонстрационные статусы";
    $("#refresh").title = live ? "Проверить рабочие адреса" : "Обновить демонстрационные статусы";
    window.addEventListener("hashchange", updateConcept);
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
    $("#q").addEventListener("keydown", handleKeys, true);
    document.addEventListener("click", trackRecent);
    document.addEventListener("auxclick", trackRecent);
    const observer = new MutationObserver(scheduleRender);
    for (const target of [$("#idx"), $("#dock"), $("#sum")]) {
      observer.observe(target, { subtree: true, childList: true, attributes: true });
    }
    new ResizeObserver(scheduleRender).observe($("#catalog"));
    window.addEventListener("resize", setViewport);
    window.visualViewport?.addEventListener("resize", setViewport);
    setViewport();
    updateConcept();
  });
})();
