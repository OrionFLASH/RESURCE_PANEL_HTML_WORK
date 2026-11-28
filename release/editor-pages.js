/* Paginate the release's live controls in place so its handlers and draft state stay attached. */
(() => {
  "use strict";
  const drawer = document.querySelector("#drawer");
  const modal = document.querySelector("#modal");
  const preferences = document.body.dataset.edition === "production" ? document.querySelector("#admin-settings") : null;
  const hiddenClass = "editor-page-hidden";
  const topics = [
    ["links", "Ссылки", "link"], ["sections", "Разделы", "layers"], ["favorites", "Избранное", "star"],
    ["meetings", "Встречи", "video"], ["scripts", "Скрипты", "terminal"]
  ];
  if (preferences) topics.unshift(["settings", "Настройки панели", "gear"]);
  const lists = { sections: "#aSecs", favorites: "#aFav", meetings: "#aMeets" };
  const observer = new MutationObserver(layout);
  let frame = 0;
  let topic = "links";
  let settingsActive = false;
  let preference = "appearance";
  let iconForm = false;
  let pickedSelect = null;
  let revealError = false;

  function schedule() {
    if (!frame) frame = requestAnimationFrame(layout);
  }

  function getPager(layer) {
    let pager = layer.querySelector(":scope > .editor-pager");
    if (pager) return pager;
    layer.dataset.editorPage = "0";
    layer.dataset.editorKey = "";
    pager = document.createElement("nav");
    pager.className = "editor-pager";
    pager.setAttribute("aria-label", "Страницы диалога");
    pager.innerHTML = '<button type="button" class="btn" data-step="-1" aria-label="Предыдущая страница диалога">‹</button>' +
      '<output aria-live="polite"></output><button type="button" class="btn" data-step="1" aria-label="Следующая страница диалога">›</button>';
    layer.append(pager);
    return pager;
  }

  function startPage(layer, key) {
    if (layer.dataset.editorKey !== key) {
      layer.dataset.editorKey = key;
      layer.dataset.editorPage = "0";
    }
  }

  function available(layer, from) {
    const bottom = layer.getBoundingClientRect().bottom;
    return Math.max(1, Math.floor(bottom - from.getBoundingClientRect().top - 52));
  }

  function pageItems(layer, items, capacity, match = null) {
    const total = Math.max(1, Math.ceil(items.length / capacity));
    const target = match ? items.findIndex((item) => item === match || item.contains(match)) : -1;
    const page = target >= 0 ? Math.floor(target / capacity) : Math.min(Number(layer.dataset.editorPage), total - 1);
    layer.dataset.editorPage = String(page);
    items.forEach((item, i) => item.classList.toggle(hiddenClass, Math.floor(i / capacity) !== page));
    paintPager(layer, page, total);
  }

  function paintPager(layer, page, total) {
    const pager = getPager(layer);
    pager.hidden = total < 2;
    pager.querySelector("output").textContent = (page + 1) + " / " + total;
    pager.querySelector("[data-step='-1']").disabled = page === 0;
    pager.querySelector("[data-step='1']").disabled = page >= total - 1;
  }

  function pageBlocks(layer, items, anchor = items[0], match = null) {
    const limit = anchor ? available(layer, anchor) : 1;
    const groups = [[]];
    let used = 0;
    const blocks = items.filter((item) => !item.hidden && item.getClientRects().length);
    function blockHeight(item) {
      const style = getComputedStyle(item);
      return item.getBoundingClientRect().height + Math.max(0, parseFloat(style.marginTop)) +
        Math.max(0, parseFloat(style.marginBottom));
    }
    blocks.forEach((item, index) => {
      const height = blockHeight(item);
      const paired = item.classList.contains("ahd") && blocks[index + 1];
      const needed = paired ? height + blockHeight(paired) : height;
      if (used && used + needed > limit) { groups.push([]); used = 0; }
      groups.at(-1).push(item);
      used += height;
    });
    const target = match ? groups.findIndex((group) => group.some((item) => item.contains(match))) : -1;
    const page = target < 0 ? Math.min(Number(layer.dataset.editorPage), groups.length - 1) : target;
    layer.dataset.editorPage = String(page);
    groups.forEach((group, index) => group.forEach((element) => element.classList.toggle(hiddenClass, index !== page)));
    paintPager(layer, page, groups.length);
  }

  function configureAdmin(body, scripts) {
    let bar = drawer.querySelector(".editor-topics");
    const opening = !bar;
    if (!bar) {
      const title = drawer.querySelector("#dTitle");
      const header = document.createElement("header");
      header.className = "editor-header";
      header.innerHTML = '<span class="editor-emblem">' + RP.icons.svg("lock") + "</span>";
      title.before(header);
      header.append(title);
      bar = document.createElement("nav");
      bar.className = "editor-topics";
      bar.setAttribute("aria-label", "Разделы администрирования");
      bar.innerHTML = topics.map(([id, label, icon]) => '<button class="btn" type="button" data-topic="' + id + '">' +
        RP.icons.svg(icon) + "<span>" + label + "</span></button>").join("");
      drawer.querySelector("#apLinks").before(bar);
      if (preferences) {
        settingsActive = true;
        bar.after(preferences);
      }
    }
    const selected = settingsActive ? "settings" : scripts ? "scripts" : topic;
    drawer.dataset.adminTopic = selected;
    bar.classList.toggle(hiddenClass, !settingsActive && !scripts && !body.querySelector("#aList"));
    bar.querySelectorAll("button").forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.topic === selected))
    );
    return opening;
  }

  function layoutPreferences() {
    const pane = preferences.querySelector('[data-preference-pane="' + preference + '"]');
    preferences.querySelectorAll("[data-preference-pane]").forEach((panel) => { panel.hidden = panel !== pane; });
    preferences.querySelectorAll("[data-preference]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.preference === preference));
    });
    startPage(drawer, "preferences:" + preference);
    const grid = pane.querySelector(".preference-grid");
    if (!grid) {
      paintPager(drawer, 0, 1);
      return;
    }
    const style = getComputedStyle(grid);
    const columns = style.gridTemplateColumns.split(" ").length;
    const gap = parseFloat(style.rowGap);
    const demo = pane.querySelector(".effect-stage");
    const stacked = demo && getComputedStyle(demo.parentElement).gridTemplateColumns.split(" ").length === 1;
    const reserve = stacked ? demo.offsetHeight + parseFloat(getComputedStyle(demo.parentElement).rowGap) : 0;
    const rows = Math.max(1, Math.floor((available(drawer, grid) - reserve + gap) / (parseFloat(style.gridAutoRows) + gap)));
    pageItems(drawer, [...grid.children], columns * rows, document.activeElement);
  }

  function replaceLargeSelects() {
    drawer.querySelectorAll("select").forEach((field) => {
      if (field.options.length < 8) return;
      let button = field.nextElementSibling;
      if (!button?.matches("button[data-editor-select]")) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "btn editor-select";
        button.dataset.editorSelect = field.id;
        field.after(button);
      }
      button.textContent = field.selectedOptions[0]?.label || "Выбрать";
      field.classList.add(hiddenClass);
    });
  }

  function selectPages(body) {
    const panel = document.createElement("section");
    panel.className = "editor-select-panel";
    panel.innerHTML = '<button type="button" class="btn" data-select-back>← К редактору</button><div class="editor-options"></div>';
    const options = panel.lastElementChild;
    [...pickedSelect.options].forEach((option) => {
      const button = document.createElement("button");
      button.className = "btn";
      button.type = "button";
      button.dataset.editorValue = option.value;
      button.textContent = option.label;
      button.title = option.label;
      button.setAttribute("aria-pressed", option.selected ? "true" : "false");
      options.append(button);
    });
    body.before(panel);
    body.classList.add(hiddenClass);
    drawer.querySelector(".editor-topics")?.classList.add(hiddenClass);
    startPage(drawer, "select:" + pickedSelect.id);
    const columns = Math.max(1, Math.floor((options.clientWidth + 4) / 174));
    options.style.setProperty("--editor-columns", columns);
    const rows = Math.max(1, Math.floor(available(drawer, options) / 38));
    pageItems(drawer, [...options.children], rows * columns);
  }

  function buildIconLibrary(pick) {
    const buttons = new Map();
    pick.querySelectorAll("button[data-icon]").forEach((button) => {
      if (!buttons.has(button.dataset.icon)) buttons.set(button.dataset.icon, button);
    });

    const search = document.createElement("input");
    search.className = "editor-icon-search";
    search.type = "search";
    search.placeholder = "Найти иконку или тему";
    search.setAttribute("aria-label", "Поиск иконок");
    search.addEventListener("input", () => {
      drawer.dataset.editorPage = "0";
      schedule();
    });

    const toolbar = document.createElement("div");
    toolbar.className = "editor-icon-tools";
    toolbar.append(search);
    const defaultIcon = buttons.get("");
    if (defaultIcon) {
      defaultIcon.textContent = "Как у раздела";
      defaultIcon.setAttribute("aria-label", "Как у раздела");
      toolbar.append(defaultIcon);
    }
    buttons.delete("");

    const library = document.createElement("div");
    library.className = "editor-icon-library";
    function addGroup(title, entries) {
      if (!entries.length) return;
      const group = document.createElement("section");
      group.className = "editor-icon-group";
      group.setAttribute("aria-label", title);
      const heading = document.createElement("h3");
      heading.textContent = title;
      const grid = document.createElement("div");
      grid.className = "editor-icons-grid";
      grid.append(...entries);
      group.append(heading, grid);
      library.append(group);
    }
    RP.icons.groups().forEach(([title, names]) => {
      const entries = [];
      const groupNames = names.includes("shield-lock") ? [...names, "lock", "unlock"] : names;
      groupNames.forEach((name) => {
        if (buttons.has(name)) entries.push(buttons.get(name));
        buttons.delete(name);
      });
      addGroup(title, entries);
    });
    addGroup("Служебные иконки в каталоге", [...buttons.values()]);

    const empty = document.createElement("p");
    empty.className = "editor-icons-empty";
    empty.setAttribute("role", "status");
    empty.textContent = "Иконки не найдены";
    pick.replaceChildren(toolbar, library, empty);
    pick.classList.add("editor-icons");
    return library;
  }

  function paintIconContext(pick, toolbar) {
    let context = toolbar.querySelector(".editor-icon-context");
    if (!context) {
      context = document.createElement("div");
      context.className = "editor-icon-context";
      context.setAttribute("role", "group");
      context.setAttribute("aria-label", "Редактируемая ссылка");
      context.innerHTML = '<span class="icon-context-preview"></span><div class="icon-context-info">' +
        '<div class="icon-context-line"><strong></strong><span class="icon-context-section"></span>' +
        '<span class="icon-context-tag" data-env></span><span class="icon-context-tag" data-seg></span></div>' +
        '<div class="icon-context-line"><span class="icon-context-address"></span>' +
        '<span class="icon-context-choice" aria-live="polite"></span></div></div>';
      toolbar.prepend(context);
    }
    const form = pick.closest("#eForm");
    const field = (id) => form.querySelector("#" + id);
    const section = field("eSec");
    const env = field("eEnv");
    const seg = field("eSeg");
    const url = field("eUrl");
    const current = pick.querySelector('[data-icon][aria-pressed="true"]')?.dataset.icon;
    const name = field("eTitle").value.trim() || "Новая ссылка";
    const address = url ? url.value.trim() || "Адрес не указан" : "Встроенный инструмент";
    const icon = RP.ui.iconOf({ icon: current, section: section.value });
    const preview = context.querySelector(".icon-context-preview");
    if (preview.dataset.iconName !== icon) {
      preview.innerHTML = RP.icons.svg(icon);
      preview.dataset.iconName = icon;
    }
    const title = context.querySelector("strong");
    title.textContent = name;
    title.title = name;
    const sectionName = context.querySelector(".icon-context-section");
    sectionName.textContent = section.selectedOptions[0]?.label || "Без раздела";
    sectionName.title = sectionName.textContent;
    const standTag = context.querySelector("[data-env]");
    standTag.dataset.env = env.value;
    standTag.textContent = env.value ? "Стенд " + env.selectedOptions[0].label : "Без стенда";
    const segmentTag = context.querySelector("[data-seg]");
    segmentTag.dataset.seg = seg.value;
    segmentTag.textContent = seg.value ? "Сегмент " + seg.selectedOptions[0].label : "Без сегмента";
    const addressLabel = context.querySelector(".icon-context-address");
    addressLabel.textContent = address;
    addressLabel.title = address;
    const selected = context.querySelector(".icon-context-choice");
    const choice = current ? RP.icons.label(current) : "Как у раздела";
    if (selected.textContent !== choice) selected.textContent = choice;
    selected.title = choice;
  }

  function pageIconGroups(library, groups) {
    const bottom = drawer.getBoundingClientRect().bottom - parseFloat(getComputedStyle(drawer).paddingBottom) - 2;
    if (library.getBoundingClientRect().bottom <= bottom) {
      paintPager(drawer, 0, 1);
      return;
    }
    const style = getComputedStyle(library);
    const columns = style.gridTemplateColumns.split(" ").length;
    const gap = parseFloat(style.rowGap);
    const limit = available(drawer, library);
    const pages = [[]];
    let space = 0;
    for (let i = 0; i < groups.length; i += columns) {
      const row = groups.slice(i, i + columns);
      const height = Math.max(...row.map((group) => group.offsetHeight));
      if (space && space + gap + height > limit) {
        pages.push([]);
        space = 0;
      }
      space += (space ? gap : 0) + height;
      pages.at(-1).push(...row);
    }
    const page = Math.min(Number(drawer.dataset.editorPage), pages.length - 1);
    drawer.dataset.editorPage = String(page);
    groups.forEach((group) => group.classList.toggle(hiddenClass, !pages[page].includes(group)));
    paintPager(drawer, page, pages.length);
  }

  function iconsInPages(pick, back) {
    const library = pick.querySelector(".editor-icon-library") || buildIconLibrary(pick);
    const toolbar = pick.querySelector(".editor-icon-tools");
    if (back) {
      if (back.parentElement !== toolbar) toolbar.prepend(back);
      paintIconContext(pick, toolbar);
    }
    const normalize = (text) => text.toLowerCase().replaceAll("ё", "е");
    const terms = normalize(pick.querySelector(".editor-icon-search").value.trim()).split(/\s+/);
    const visible = [...library.children].filter((group) => {
      const category = normalize(group.getAttribute("aria-label"));
      let found = false;
      for (const button of group.querySelectorAll("[data-icon]")) {
        const label = normalize(button.title + " " + button.dataset.icon) + " " + category;
        const hit = terms.every((term) => label.includes(term));
        button.classList.toggle(hiddenClass, !hit);
        found ||= hit;
      }
      group.classList.toggle(hiddenClass, !found);
      return found;
    });
    pick.querySelector(".editor-icons-empty").hidden = visible.length > 0;
    pageIconGroups(library, visible);
  }

  function editorList(body) {
    const controls = body.querySelector(".atools");
    const list = body.querySelector("#aList");
    controls.classList.toggle(hiddenClass, topic !== "links");
    list.classList.toggle(hiddenClass, topic !== "links");
    Object.entries(lists).forEach(([key, selector]) => {
      const details = body.querySelector(selector);
      details.classList.toggle(hiddenClass, key !== topic);
      if (key === topic) details.open = true;
    });
    if (topic === "links") {
      startPage(drawer, "links:" + body.querySelector("#aQ").value + ":" + body.querySelector("#aSec").value);
      pageBlocks(drawer, [...list.children], list, document.activeElement);
      return;
    }
    const section = body.querySelector(lists[topic]);
    const collection = section.querySelector(".flist");
    if (collection && collection.previousElementSibling?.matches(".ahint, .awarn")) {
      collection.after(...section.querySelectorAll(":scope > p:is(.ahint, .awarn)"));
    }
    const pick = section.querySelector(".ipick");
    startPage(drawer, pick ? "section-icon" : topic);
    if (pick) {
      const selectedRow = pick.closest(".srow");
      [...section.querySelectorAll(".srow, .sadd")].forEach((item) => item.classList.toggle(hiddenClass, item !== selectedRow));
      iconsInPages(pick);
      return;
    }
    const items = [...section.querySelectorAll(":scope > :not(summary, ul, ol), :scope > :is(ul, ol) > li")];
    pageBlocks(drawer, items, section, document.activeElement);
  }

  function editorForm(body) {
    const form = body.querySelector("#eForm");
    const field = form.querySelector("#eIconL");
    const pick = form.querySelector("#eIcon");
    let toggle = field.querySelector("button[data-icon-form]");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.className = "btn";
      toggle.type = "button";
      toggle.dataset.iconForm = "";
      pick.before(toggle);
    }
    toggle.textContent = iconForm ? "← К полям" : "Выбрать иконку";
    if (!iconForm && toggle.parentElement !== field) pick.before(toggle);
    pick.classList.toggle(hiddenClass, !iconForm);
    startPage(drawer, iconForm ? "form-icon" : "form:" + (body.querySelector(".aid")?.textContent || ""));
    const fields = [...form.children];
    if (iconForm) {
      fields.forEach((item) => item.classList.toggle(hiddenClass, item !== field));
      iconsInPages(pick, toggle);
    } else {
      const invalid = revealError ? form.querySelector('[aria-invalid="true"]') : null;
      pageBlocks(drawer, fields, form, invalid || document.activeElement);
      invalid?.focus({ preventScroll: true });
    }
    revealError = false;
  }

  function layoutDrawer() {
    if (!drawer.classList.contains("on")) {
      drawer.classList.remove("editor-icon-mode");
      pickedSelect = null;
      iconForm = false;
      if (preferences?.parentElement === drawer) {
        preferences.hidden = true;
        drawer.after(preferences);
      }
      return;
    }
    getPager(drawer);
    const body = drawer.querySelector("#aBody");
    drawer.querySelector(".editor-select-panel")?.remove();
    if (!body) return;
    const links = drawer.querySelector("#apLinks");
    const scripts = drawer.querySelector("#apScripts");
    const opening = configureAdmin(body, !scripts.hidden);
    const choosingIcon = !settingsActive && scripts.hidden &&
      (body.querySelector("#eForm") ? iconForm : topic === "sections" && !!body.querySelector("#aSecs .ipick"));
    drawer.classList.toggle("editor-icon-mode", choosingIcon);
    if (choosingIcon) drawer.querySelector(".editor-topics").classList.add(hiddenClass);
    if (preferences) preferences.hidden = !settingsActive;
    if (settingsActive) {
      links.classList.add(hiddenClass);
      scripts.classList.add(hiddenClass);
      layoutPreferences();
      if (opening) preferences.querySelector('[data-preference][aria-pressed="true"]').focus({ preventScroll: true });
      return;
    }
    if (!scripts.hidden) {
      startPage(drawer, "scripts");
      pageBlocks(drawer, [...scripts.children], scripts, document.activeElement);
      return;
    }
    replaceLargeSelects();
    if (pickedSelect && drawer.contains(pickedSelect)) selectPages(body);
    else if (body.querySelector("#eForm")) editorForm(body);
    else editorList(body);
  }

  function layoutModal() {
    if (!modal.classList.contains("on")) return;
    getPager(modal);
    const content = modal.querySelector(":scope > div");
    if (!content) return;
    const output = content.querySelector(".out:not([hidden])");
    content.querySelectorAll(".editor-output").forEach((item) => item.remove());
    if (output && output.getBoundingClientRect().height > available(modal, content.children[1])) {
      output.classList.add(hiddenClass);
      const width = Math.max(12, Math.floor((content.clientWidth - 24) / 7.8));
      const lines = output.textContent.split("\n").flatMap((line) => line.match(new RegExp(".{1," + width + "}", "gu")) || [""]);
      const rows = Math.max(1, Math.floor((available(modal, content.children[1]) - 20) / 18));
      for (let i = 0; i < lines.length; i += rows) {
        const part = document.createElement("pre");
        part.className = "out editor-output";
        part.textContent = lines.slice(i, i + rows).join("\n");
        output.before(part);
      }
    }
    const fields = [...content.children].slice(1);
    startPage(modal, content.querySelector("h2")?.textContent || "tool");
    const target = output && output.classList.contains(hiddenClass) ? content.querySelector(".editor-output") : null;
    const pagerClicked = modal.querySelector(".editor-pager")?.contains(document.activeElement);
    pageBlocks(modal, fields, fields[0], pagerClicked ? null : target || document.activeElement);
  }

  function layout() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    observer.disconnect();
    [drawer, modal].forEach((layer) => {
      layer.style.removeProperty("height");
      layer.querySelectorAll("." + hiddenClass).forEach((node) => node.classList.remove(hiddenClass));
    });
    layoutDrawer();
    layoutModal();
    [drawer, modal].forEach(fitDialog);
    [drawer, modal].forEach((layer) => observer.observe(layer, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"]
    }));
  }

  function fitDialog(layer) {
    if (!layer.classList.contains("on")) return;
    const box = layer.getBoundingClientRect();
    const style = getComputedStyle(layer);
    const pager = layer.querySelector(":scope > .editor-pager");
    const content = [...layer.children].filter((node) => node !== pager && node.getClientRects().length);
    const bottom = Math.max(box.top, ...content.map((node) => node.getBoundingClientRect().bottom));
    const footer = pager && !pager.hidden ? pager.offsetHeight + parseFloat(getComputedStyle(pager).bottom) + 8 : 0;
    const height = bottom - box.top + Math.max(footer, parseFloat(style.paddingBottom)) + parseFloat(style.borderBottomWidth);
    layer.style.height = Math.min(box.height, Math.ceil(height)) + "px";
  }

  function action(event) {
    const layer = event.currentTarget;
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.step) {
      layer.dataset.editorPage = String(Math.max(0, Number(layer.dataset.editorPage) + Number(button.dataset.step)));
      button.focus({ preventScroll: true });
      layout();
      if (button.disabled) button.parentElement.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    } else if (button.dataset.topic) {
      settingsActive = button.dataset.topic === "settings";
      if (button.dataset.topic === "scripts") {
        if (drawer.querySelector("#apScripts").hidden) drawer.querySelector("#atScripts").click();
      } else if (!settingsActive) {
        topic = button.dataset.topic;
        if (drawer.querySelector("#apLinks").hidden) drawer.querySelector("#atLinks").click();
      }
      schedule();
    } else if (button.dataset.preference) {
      preference = button.dataset.preference;
      schedule();
    } else if (button.hasAttribute("data-icon-form")) {
      iconForm = !iconForm;
      schedule();
    } else if (button.matches("#eIcon [data-icon]")) {
      schedule();
    } else if (button.hasAttribute("data-editor-select")) {
      pickedSelect = document.getElementById(button.dataset.editorSelect);
      schedule();
    } else if (button.hasAttribute("data-select-back") || button.hasAttribute("data-editor-value")) {
      if (pickedSelect && button.hasAttribute("data-editor-value")) {
        pickedSelect.value = button.dataset.editorValue;
        pickedSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      pickedSelect = null;
      schedule();
    }
  }

  drawer.addEventListener("click", action);
  modal.addEventListener("click", action);
  drawer.addEventListener("submit", () => { revealError = true; schedule(); }, true);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  layout();
})();
