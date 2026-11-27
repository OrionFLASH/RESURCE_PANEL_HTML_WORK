/* Paginate the release's live controls in place so its handlers and draft state stay attached. */
(() => {
  "use strict";
  const drawer = document.querySelector("#drawer");
  const modal = document.querySelector("#modal");
  const hiddenClass = "editor-page-hidden";
  const topics = [
    ["links", "Ссылки", "link"], ["sections", "Разделы", "layers"], ["favorites", "Избранное", "star"],
    ["meetings", "Встречи", "video"], ["scripts", "Скрипты", "terminal"]
  ];
  const lists = { sections: "#aSecs", favorites: "#aFav", meetings: "#aMeets" };
  const observer = new MutationObserver(layout);
  let frame = 0;
  let topic = "links";
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
    }
    bar.classList.toggle(hiddenClass, !scripts && !body.querySelector("#aList"));
    bar.querySelectorAll("button").forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.topic === (scripts ? "scripts" : topic)))
    );
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

  function iconsInPages(pick) {
    let grid = pick.querySelector(".editor-icons-grid");
    if (!grid) {
      const names = new Set();
      const search = document.createElement("input");
      search.className = "editor-icon-search";
      search.type = "search";
      search.placeholder = "Найти иконку";
      search.setAttribute("aria-label", "Поиск иконок");
      search.addEventListener("input", () => {
        drawer.dataset.editorPage = "0";
        schedule();
      });
      const empty = document.createElement("p");
      empty.className = "editor-icons-empty";
      empty.setAttribute("role", "status");
      empty.textContent = "Иконки не найдены";
      grid = document.createElement("div");
      grid.className = "editor-icons-grid";
      pick.querySelectorAll("button[data-icon]").forEach((button) => {
        if (names.has(button.dataset.icon)) return;
        names.add(button.dataset.icon);
        grid.append(button);
      });
      pick.replaceChildren(search, grid, empty);
    }
    pick.classList.add("editor-icons");
    const cols = Math.max(1, Math.floor((grid.clientWidth + 2) / 38));
    grid.style.setProperty("--editor-columns", cols);
    const rows = Math.max(1, Math.floor((available(drawer, grid) - 5) / 36));
    const normalize = (text) => text.toLowerCase().replaceAll("ё", "е");
    const terms = normalize(pick.querySelector(".editor-icon-search").value.trim()).split(/\s+/);
    const matches = [...grid.children].filter((button) => {
      const label = normalize(button.title + " " + button.dataset.icon);
      const hit = terms.every((term) => label.includes(term));
      button.classList.toggle(hiddenClass, !hit);
      return hit;
    });
    pick.querySelector(".editor-icons-empty").hidden = matches.length > 0;
    pageItems(drawer, matches, rows * cols);
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
    pick.classList.toggle(hiddenClass, !iconForm);
    startPage(drawer, iconForm ? "form-icon" : "form:" + (body.querySelector(".aid")?.textContent || ""));
    const fields = [...form.children];
    if (iconForm) {
      fields.forEach((item) => item.classList.toggle(hiddenClass, item !== field));
      iconsInPages(pick);
    } else {
      const invalid = revealError ? form.querySelector('[aria-invalid="true"]') : null;
      pageBlocks(drawer, fields, form, invalid || document.activeElement);
      invalid?.focus({ preventScroll: true });
    }
    revealError = false;
  }

  function layoutDrawer() {
    if (!drawer.classList.contains("on")) { pickedSelect = null; iconForm = false; return; }
    getPager(drawer);
    const body = drawer.querySelector("#aBody");
    drawer.querySelector(".editor-select-panel")?.remove();
    if (!body) return;
    const scripts = drawer.querySelector("#apScripts");
    configureAdmin(body, !scripts.hidden);
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
    [drawer, modal].forEach((layer) => layer.querySelectorAll("." + hiddenClass).forEach((node) => node.classList.remove(hiddenClass)));
    layoutDrawer();
    layoutModal();
    [drawer, modal].forEach((layer) => observer.observe(layer, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"]
    }));
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
      if (button.dataset.topic === "scripts") {
        if (drawer.querySelector("#apScripts").hidden) drawer.querySelector("#atScripts").click();
      } else {
        topic = button.dataset.topic;
        if (drawer.querySelector("#apLinks").hidden) drawer.querySelector("#atLinks").click();
      }
      schedule();
    } else if (button.hasAttribute("data-icon-form")) {
      iconForm = !iconForm;
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
