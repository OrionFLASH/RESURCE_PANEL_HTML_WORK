// E2E: страница по file:// в системном Chrome.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openPanel, metrics, linksPath } from "./e2e.helpers.mjs";

const LINKS_SRC = fs.readFileSync(linksPath, "utf8");

async function withPanel(opts, fn) {
  const p = await openPanel(opts);
  try { await fn(p); } finally { await p.close(); }
}
// Режим панели групп: при загрузке всегда «узкая» (#16), остальные — как ручное переключение до перезагрузки
const setRail = (page, m) => page.evaluate((m) => RP.ui.setRail(m), m);

test("открытие без ошибок консоли; 86 ссылок + 2 инструмента отрисованы", () =>
  withPanel({ width: 1440, height: 900 }, async ({ page, errors }) => {
    const r = await page.evaluate(() => {
      const ids = new Set([...document.querySelectorAll("[data-link-id]")].map((e) => e.dataset.linkId));
      const wait = new Set([...document.querySelectorAll('[data-link-id][data-st="wait"]')].map((e) => e.dataset.linkId));
      return {
        ids: ids.size, wait: wait.size,
        tools: document.querySelectorAll("#idx [data-link-id][data-tool]").length,
        rows: document.querySelectorAll("#idx [data-link-id]:not([hidden])").length,
        meets: document.querySelectorAll("#meets [data-link-id]").length,
        favs: document.querySelectorAll("#dock [data-link-id]").length,
        sections: document.querySelectorAll("#idx [data-section-id]").length,
        error: !document.querySelector("#rp-error") || document.querySelector("#rp-error").hidden
      };
    });
    assert.deepEqual(errors, []);
    assert.equal(r.ids, 88);
    assert.equal(r.wait, 86);
    assert.equal(r.tools, 2);
    assert.equal(r.rows, 75);   // 84 строк минус 9 закреплённых в «Избранном» (§12)
    assert.equal(r.meets, 4);
    assert.equal(r.favs, 9);
    assert.equal(r.sections, 10);   // «Коммуникации» целиком в избранном и встречах — пустой раздел не показывается (§12)
    assert.equal(r.error, true);
  }));

for (const [w, h] of [[1440, 900], [1920, 1080]]) {
  test(`${w}×${h}: всё на одном экране, без прокрутки`, () =>
    withPanel({ width: w, height: h }, async ({ page, errors }) => {
      const m = await metrics(page);
      assert.deepEqual(errors, []);
      assert.ok(m.sh <= m.ih, `scrollHeight ${m.sh} > ${m.ih} (${m.den})`);
      assert.ok(m.sw <= m.iw, `scrollWidth ${m.sw} > ${m.iw}`);
      // ни одна строка индекса не обрезана снизу
      const cut = await page.evaluate(() => {
        const idx = document.querySelector("#idx").getBoundingClientRect();
        return [...document.querySelectorAll("#idx [data-link-id]")].filter((e) => e.getBoundingClientRect().bottom > idx.bottom + 1).length;
      });
      assert.equal(cut, 0);
    }));
}

// §10: вписывание при любом режиме панели групп и в обеих темах
for (const rail of ["open", "compact", "hidden"]) for (const theme of ["dark", "light"]) {
  test(`1440×900, панель групп ${rail}, тема ${theme}: без прокрутки`, () =>
    withPanel({ width: 1440, height: 900, theme }, async ({ page, errors }) => {
      await setRail(page, rail);
      // режим и тема действительно применены
      assert.equal(await page.evaluate(() => document.querySelector("#gp").classList.contains("m-" + document.querySelector("#gpBtn").dataset.m) && document.querySelector("#gpBtn").dataset.m), rail);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark"), theme);
      const m = await metrics(page);
      assert.deepEqual(errors, []);
      assert.ok(m.sh <= m.ih, `scrollHeight ${m.sh} > ${m.ih} (${m.den})`);
      assert.ok(m.sw <= m.iw, `scrollWidth ${m.sw} > ${m.iw}`);
      const cut = await page.evaluate(() => {
        const idx = document.querySelector("#idx").getBoundingClientRect();
        return [...document.querySelectorAll("#idx [data-link-id]")].filter((e) => e.getBoundingClientRect().bottom > idx.bottom + 1).length;
      });
      assert.equal(cut, 0);
    }));
}

test("светлая тема по rp_theme=light", () =>
  withPanel({ width: 1440, height: 900, theme: "light" }, async ({ page, errors }) => {
    const r = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      bg: getComputedStyle(document.body).backgroundColor
    }));
    assert.deepEqual(errors, []);
    assert.equal(r.theme, "light");
    assert.equal(r.bg, "rgb(220, 227, 223)");
  }));

test("тёмная тема по умолчанию; кнопка темы переключает и запоминает", () =>
  withPanel({ width: 1440, height: 900 }, async ({ page, errors }) => {
    assert.equal(await page.getAttribute("html", "data-theme"), "dark");
    await page.click("#theme");
    assert.equal(await page.getAttribute("html", "data-theme"), "light");
    assert.equal(await page.evaluate(() => window.RP.store.get("rp_theme")), "light");
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === "1");
    assert.equal(await page.getAttribute("html", "data-theme"), "light");
    assert.deepEqual(errors, []);
  }));

test("390×844: нет горизонтальной прокрутки", () =>
  withPanel({ width: 390, height: 844 }, async ({ page, errors }) => {
    const m = await metrics(page);
    assert.deepEqual(errors, []);
    assert.equal(m.sw, 390);
  }));

test("links.js с синтаксической ошибкой → #rp-error про links.js", () =>
  withPanel({ width: 1440, height: 900, links: "window.RP_LINKS = { sections: [ ;\n" }, async ({ page }) => {
    const el = page.locator("#rp-error");
    assert.equal(await el.isVisible(), true);
    const text = await el.innerText();
    assert.match(text, /Ошибка в links\.js: синтаксическая ошибка/);
    assert.doesNotMatch(text, /Script error/); // file:// скрывает текст ошибки — не показываем «Script error.»
    assert.equal(await page.locator("#idx [data-link-id]").count(), 0);
  }));

test("links.js отсутствует → #rp-error «Не найден links.js»", () =>
  withPanel({ width: 1440, height: 900, links: false }, async ({ page }) => {
    const el = page.locator("#rp-error");
    assert.equal(await el.isVisible(), true);
    assert.match(await el.innerText(), /Не найден links\.js рядом с index\.html/);
  }));

test("links.js с ошибкой данных (дубль id) → #rp-error с текстом ошибки", () =>
  withPanel({ width: 1440, height: 900, links: LINKS_SRC.replace('{"id":"mail"', '{"id":"chat"') }, async ({ page }) => {
    const el = page.locator("#rp-error");
    assert.equal(await el.isVisible(), true);
    const text = await el.innerText();
    assert.match(text, /Ошибка в links\.js/);
    assert.match(text, /Дубль id: chat/);
  }));

test("localStorage бросает исключение → страница отрисована, ошибок нет", () =>
  withPanel({ width: 1440, height: 900, storage: "throw" }, async ({ page, errors }) => {
    assert.deepEqual(errors, []);
    assert.equal(await page.locator("#idx [data-link-id]:not([hidden])").count(), 75);
    await page.click("#theme");
    assert.equal(await page.getAttribute("html", "data-theme"), "light");
    assert.deepEqual(errors, []);
  }));

// ---------- Проверка доступности (сетевые запросы подменяются page.route) ----------
const mkLinks = (links) => "window.RP_LINKS = " + JSON.stringify({
  version: 1, sections: [{ id: "s", name: "Раздел", icon: "link" }], favoriteSeed: [], links
}) + ";\n";
const L = (id, host, extra) => Object.assign({ id, section: "s", title: "Ссылка " + id, url: "https://" + host + ".test/" }, extra);
const SET = [
  L("u1", "up1", { env: "PROM" }), L("u2", "up2", { env: "PROM" }), L("u3", "up3"),
  L("d1", "down1", { env: "PROM" }), L("d2", "down2"),
  L("h1", "hang1"),
  { id: "tl", section: "s", title: "Инструмент", tool: "decoder", icon: "cmd" },
  L("sk", "skip1", { check: false })
];

// Подмена сети: хосты down* — обрыв, hang* — без ответа, остальные — 200. gate — удерживает ответы до release().
function netStub({ gate = false, delay = 0 } = {}) {
  const st = { hits: [], active: 0, max: 0, release: null, gate: null, revive: new Set() };   // revive — down-хосты, ставшие доступными
  st.gate = gate ? new Promise((r) => { st.release = r; }) : Promise.resolve();
  st.setup = async ({ page }) => {
    await page.route((u) => /^https?:/.test(u.href), async (route) => {
      const host = new URL(route.request().url()).hostname;
      st.hits.push(host); st.active++; st.max = Math.max(st.max, st.active);
      try {
        if (st.hangAll || host.startsWith("hang")) return;       // никогда не отвечает
        await st.gate;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (host.startsWith("down") && !st.revive.has(host)) await route.abort("connectionrefused");
        else await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
      } catch (e) {} finally { st.active--; }
    });
  };
  return st;
}
const stOf = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#idx [data-link-id]")].map((e) => [e.dataset.linkId, e.dataset.st])));
const realErrors = (errors) => errors.filter((e) => !/Failed to load resource|ERR_/.test(e));

test("проверка: сначала wait, затем up/down по сети; tool=local, check:false=skip не опрашиваются", () => {
  const net = netStub({ gate: true });
  return withPanel({ links: mkLinks(SET), setup: net.setup }, async ({ page, errors }) => {
    assert.deepEqual(await stOf(page), { u1: "wait", u2: "wait", u3: "wait", d1: "wait", d2: "wait", h1: "wait", tl: "local", sk: "skip" });
    // #22: «проверяется» — еле заметная пульсация иконки строки
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#idx [data-link-id="u1"] svg')).animationName), "ipulse");
    net.release();
    await page.waitForFunction(() => document.querySelectorAll('#idx [data-st="wait"]').length === 1); // остался только hang1
    assert.deepEqual(await stOf(page), { u1: "up", u2: "up", u3: "up", d1: "down", d2: "down", h1: "wait", tl: "local", sk: "skip" });
    const t0 = Date.now();
    await page.waitForFunction(() => document.querySelector('[data-link-id="h1"]').dataset.st === "down", null, { timeout: 7000 });
    assert.ok(Date.now() - t0 <= 7000);
    const s = await page.evaluate(() => ({ h: RP.status.get("h1"), u: RP.status.get("u1"), d: RP.status.get("d1") }));
    assert.equal(s.h.st, "down"); assert.equal(s.h.err, "timeout");
    assert.equal(s.d.err, "network"); assert.equal(s.u.st, "up"); assert.equal(typeof s.u.ms, "number"); assert.ok(s.u.at);
    assert.ok(!net.hits.includes("skip1"));
    assert.equal(net.hits.length, 6);
    assert.deepEqual(realErrors(errors), []);
  });
});

test("проверка: сводка в шапке совпадает с числом up/down; у недоступной гаснет только название", () => {
  const net = netStub();
  return withPanel({ links: mkLinks(SET), setup: net.setup }, async ({ page }) => {
    await page.waitForFunction(() => document.querySelector('[data-link-id="h1"]').dataset.st === "down", null, { timeout: 8000 });
    const r = await page.evaluate(() => {
      const nums = [...document.querySelectorAll("#sum > span")].map((s) => ({ t: s.title, n: parseInt(s.textContent, 10) }));
      const q = (id, sel) => getComputedStyle(document.querySelector('#idx [data-link-id="' + id + '"] ' + sel));
      return {
        nums,
        upN: document.querySelectorAll('#idx [data-st="up"]').length, downN: document.querySelectorAll('#idx [data-st="down"]').length,
        ttUp: q("u1", ".tt").color, ttDown: q("d1", ".tt").color,
        tagUp: q("u1", ".tag").color, tagDown: q("d1", ".tag").color,
        icUp: q("u1", "svg").color, icDown: q("d1", "svg").color, icWait: q("h1", "svg").color,
        dots: document.querySelectorAll("#idx .ln:not([data-tool]) .dot").length, toolDot: document.querySelectorAll("#idx .ln[data-tool] .dot").length,
        frameUp: getComputedStyle(document.querySelector('#idx [data-link-id="u1"]'), "::after").borderTopStyle,
        frameDown: getComputedStyle(document.querySelector('#idx [data-link-id="d1"]'), "::after").content
      };
    });
    assert.equal(r.nums.find((x) => x.t === "Доступны").n, r.upN);
    assert.equal(r.nums.find((x) => x.t === "Недоступны").n, r.downN);
    assert.equal(r.upN, 3); assert.equal(r.downN, 3);
    assert.ok(!r.nums.some((x) => x.t === "Проверяются"));
    assert.notEqual(r.ttDown, r.ttUp);          // название погашено
    assert.equal(r.tagDown, r.tagUp);           // тег стенда в цвете
    // #15: в разделах кружка нет (у инструмента остаётся), статус — цветом иконки, у доступной — пунктирная рамка
    assert.equal(r.dots, 0); assert.equal(r.toolDot, 1);
    assert.notEqual(r.icDown, r.icUp);
    assert.equal(r.frameUp, "dashed"); assert.equal(r.frameDown, "none");
  });
});

test("проверка: ≤6 запросов одновременно; «Проверить» во время проверки игнорируется", () => {
  const links = Array.from({ length: 24 }, (_, i) => L("x" + i, "up" + i));
  const net = netStub({ gate: true });
  return withPanel({ links: mkLinks(links), setup: net.setup }, async ({ page }) => {
    await page.waitForFunction(() => document.querySelector("#refresh").classList.contains("busy"));
    await page.waitForTimeout(300);
    for (let i = 0; i < 3; i++) await page.click("#refresh");
    await page.waitForTimeout(200);
    assert.equal(net.hits.length, 6);           // пока ответы удерживаются, идут ровно 6 запросов
    net.release();
    await page.waitForFunction(() => document.querySelectorAll('#idx [data-st="up"]').length === 24);
    assert.equal(net.hits.length, 24);          // новых запросов от кликов нет
    assert.ok(net.max <= 6, "одновременно " + net.max);
    await page.waitForFunction(() => !document.querySelector("#refresh").classList.contains("busy"));
  });
});

test("проверка: прогресс на кнопке; повторная проверка по кнопке после завершения", () => {
  const links = Array.from({ length: 8 }, (_, i) => L("x" + i, "up" + i));
  const net = netStub({ delay: 150 });
  return withPanel({ links: mkLinks(links), setup: net.setup }, async ({ page }) => {
    await page.waitForFunction(() => document.querySelector("#refresh").classList.contains("busy"));
    const p = await page.evaluate(() => parseFloat(document.querySelector("#refresh").style.getPropertyValue("--p")));
    assert.ok(p >= 0 && p <= 1);
    await page.waitForFunction(() => !document.querySelector("#refresh").classList.contains("busy"));
    assert.equal(net.hits.length, 8);
    await page.click("#refresh");
    await page.waitForFunction(() => !document.querySelector("#refresh").classList.contains("busy") && true);
    await page.waitForFunction(() => document.querySelector("#refresh").getAttribute("aria-busy") !== "true");
    assert.equal(net.hits.length, 16);
  });
});

test("проверка: фоновая проверка не сбрасывает известные статусы в wait", () => {
  const net = netStub();
  return withPanel({ links: mkLinks(SET.slice(0, 5)), setup: net.setup }, async ({ page }) => {
    await page.waitForFunction(() => document.querySelectorAll('#idx [data-st="up"]').length === 3 && document.querySelectorAll('#idx [data-st="down"]').length === 2);
    // следующая проверка зависает: пока она идёт, статусы должны остаться прежними
    net.hangAll = true;
    await page.evaluate(() => { RP.ui.check({ background: true }); });   // без await: проверка идёт 6 с
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#idx [data-st="wait"]').count(), 0);
    assert.equal(await page.locator('#idx [data-st="up"]').count(), 3);
    assert.equal(await page.locator('#idx [data-st="down"]').count(), 2);
    assert.equal(await page.locator("#refresh.busy").count(), 0); // фон не рисует прогресс
  });
});

test("проверка: статус отражается на избранном и встречах", () => {
  const links = [L("m1", "up1", { meet: true }), L("m2", "down1", { meet: true }), L("f1", "up2"), L("f2", "down2")];
  const data = JSON.stringify({ version: 1, sections: [{ id: "s", name: "Раздел", icon: "link" }], favoriteSeed: ["f1", "f2"], links });
  const net = netStub();
  return withPanel({ links: "window.RP_LINKS = " + data + ";\n", setup: net.setup }, async ({ page }) => {
    await page.waitForFunction(() => document.querySelectorAll('[data-link-id][data-st="wait"]').length === 0);
    await page.waitForFunction(() => !document.querySelector('#dock [data-link-id="f2"]'));
    const r = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#dock [data-link-id], #meets [data-link-id]")].map((e) => [e.dataset.linkId, e.dataset.st])));
    // #20: недоступная f2 ушла из избранного в свой раздел
    assert.deepEqual(r, { f1: "up", m1: "up", m2: "down" });
    assert.equal(await page.isVisible('#idx [data-link-id="f2"]'), true);
  });
});

test("1440×900, раздел с 30 добавленными ссылками: нет горизонтальной прокрутки, строки не обрезаны", () => {
  const extra = Array.from({ length: 30 }, (_, i) => `{"id":"zz${i}","section":"docs","title":"Добавленная ссылка ${i}","url":"https://up-zz${i}.test/"}`).join(",\n    ");
  const src = LINKS_SRC.replace('"links": [', '"links": [\n    ' + extra + ",");
  const net = netStub();
  return withPanel({ width: 1440, height: 900, links: src, setup: net.setup }, async ({ page, errors }) => {
    await page.waitForFunction(() => document.querySelectorAll('#idx [data-st="wait"]').length === 0, null, { timeout: 10000 });
    const m = await metrics(page);
    assert.ok(m.sw <= m.iw, `scrollWidth ${m.sw} > ${m.iw}`);
    assert.ok(m.sh > m.ih, "ожидалась прокрутка страницы");
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#idx .ln:not([hidden])")];
      const idx = document.querySelector("#idx");
      const ov = getComputedStyle(idx).overflowY;
      window.scrollTo(0, document.documentElement.scrollHeight);
      const last = rows.map((e) => e.getBoundingClientRect().bottom + window.scrollY).reduce((a, b) => Math.max(a, b), 0);
      return { ov, idxClip: idx.scrollHeight - idx.clientHeight, small: rows.filter((e) => e.getBoundingClientRect().height < 20).length, last, doc: document.documentElement.scrollHeight, n: rows.length };
    });
    assert.equal(r.n, 75 + 30);
    assert.equal(r.small, 0);
    assert.ok(!(r.ov === "hidden" && r.idxClip > 1), "указатель обрезает строки");
    assert.ok(r.last <= r.doc + 1, "последняя строка вне документа");
    assert.deepEqual(realErrors(errors), []);
  });
});

// ---------- Взаимодействие: клик, копирование, подсказка, поиск, фильтры, избранное, встречи ----------
// Сеть — заглушка 200; window.open записывает адреса в window.__opened; буфер — через разрешения контекста.
function interact({ noClipboard = false, execOk = true } = {}) {
  return {
    context: { permissions: ["clipboard-read", "clipboard-write"] },
    setup: async ({ page }) => {
      await page.route((u) => /^https?:/.test(u.href), (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }).catch(() => {}));
      await page.addInitScript(({ noClipboard, execOk }) => {
        window.__opened = []; window.__seq = []; window.__exec = []; window.__wt = [];
        window.open = function (u) { window.__opened.push(String(u)); window.__seq.push("open:" + u); return null; };
        const orig = document.execCommand.bind(document);
        document.execCommand = function (cmd) {
          const a = document.activeElement, v = a && "value" in a ? a.value : "";
          window.__exec.push([cmd, v]); window.__seq.push("exec:" + v);
          return execOk ? orig.apply(document, arguments) : false;
        };
        const wt = Clipboard.prototype.writeText;
        Clipboard.prototype.writeText = function (t) { window.__wt.push(String(t)); window.__seq.push("write:" + t); return wt.call(this, t); };
        if (noClipboard) Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, get() { return undefined; } });
      }, { noClipboard, execOk });
    }
  };
}
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const toasts = (page) => page.$$eval("#toasts .toast", (a) => a.map((t) => t.textContent.trim()));
const opened = (page) => page.evaluate(() => window.__opened);
const URL_OF = (id) => (LINKS_SRC.match(new RegExp('"id":"' + id + '"[^\\n]*?"url":"([^"]+)"')) || [])[1];

test("клик по ссылке с кодом: код в буфер, тост, открыт URL, rp_clicks +1", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await page.click('#dock [data-link-id="h-psi-a"]');
    await page.waitForFunction(() => document.querySelectorAll("#toasts .toast").length > 0);
    assert.equal(await clip(page), "92863949");
    assert.ok((await toasts(page)).includes("Скопировано: 92863949"));
    assert.deepEqual(await opened(page), [URL_OF("h-psi-a")]);
    assert.deepEqual(await page.evaluate(() => RP.store.get("rp_clicks")), { "h-psi-a": 1 });
    // R7: синхронное копирование — до открытия вкладки; clipboard API не нужен
    assert.deepEqual(await page.evaluate(() => window.__seq), ["exec:92863949", "open:" + URL_OF("h-psi-a")]);
    assert.deepEqual(await page.evaluate(() => window.__wt), []);
    await page.click("#ln-varm");
    await page.waitForFunction(() => document.querySelectorAll("#toasts .toast").length > 1);
    assert.equal(await clip(page), "omega\\01803187");
    assert.equal((await opened(page)).length, 2);
    assert.deepEqual(realErrors(errors), []);
  }));

test("клик без кода: открывает URL без копирования и тоста", () =>
  withPanel(interact(), async ({ page }) => {
    await page.click("#ln-qlik");
    assert.deepEqual(await opened(page), [URL_OF("qlik")]);
    await page.waitForTimeout(100);
    assert.deepEqual(await toasts(page), []);
  }));

test("⌘/Ctrl+клик: URL в буфер, тост «Ссылка скопирована», не открывается и не считается", () =>
  withPanel(interact(), async ({ page }) => {
    await page.click("#ln-sprint", { modifiers: ["Meta"] });
    await page.waitForFunction(() => document.querySelectorAll("#toasts .toast").length > 0);
    assert.equal(await clip(page), URL_OF("sprint"));
    assert.ok((await toasts(page)).includes("Ссылка скопирована"));
    // Ctrl+клик — синтетическое событие (R2)
    await page.evaluate(() => navigator.clipboard.writeText(""));
    const r = await page.evaluate(() => {
      const ev = new MouseEvent("click", { ctrlKey: true, bubbles: true, cancelable: true });
      document.querySelector("#ln-q2").dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(r, true);
    await page.waitForFunction(() => document.querySelectorAll("#toasts .toast").length > 1);
    assert.equal(await clip(page), URL_OF("q2"));
    // macOS: Ctrl+клик приходит как contextmenu с ctrlKey и левой кнопкой
    const cm = await page.evaluate(() => {
      const ev = new MouseEvent("contextmenu", { ctrlKey: true, button: 0, bubbles: true, cancelable: true });
      document.querySelector("#ln-esr").dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(cm, true);
    await page.waitForFunction(() => document.querySelectorAll("#toasts .toast").length > 2);
    assert.equal(await clip(page), URL_OF("esr"));
    assert.deepEqual(await opened(page), []);
    assert.equal(await page.evaluate(() => RP.store.get("rp_clicks", null)), null);
  }));

test("без navigator.clipboard: execCommand('copy') через скрытый textarea", () =>
  withPanel(interact({ noClipboard: true }), async ({ page }) => {
    await page.click("#ln-ctl");
    const ex = await page.evaluate(() => window.__exec);
    assert.deepEqual(ex, [["copy", "lakomkin-oo"]]);
    assert.ok((await toasts(page)).includes("Скопировано: lakomkin-oo"));
    assert.deepEqual(await opened(page), [URL_OF("ctl")]);
    assert.equal(await page.locator("textarea").count(), 0);
  }));

test("execCommand не сработал → navigator.clipboard.writeText; ссылка открывается", () =>
  withPanel(interact({ execOk: false }), async ({ page }) => {
    await page.click("#ln-ctl");
    await page.waitForFunction(() => document.querySelectorAll("#toasts .toast").length > 0);
    assert.deepEqual(await page.evaluate(() => window.__seq), ["exec:lakomkin-oo", "write:lakomkin-oo", "open:" + URL_OF("ctl")]);
    assert.equal(await clip(page), "lakomkin-oo");
    assert.ok((await toasts(page)).includes("Скопировано: lakomkin-oo"));
  }));

test("копирование не удалось: тост «Не удалось скопировать», ссылка всё равно открывается", () =>
  withPanel(interact({ noClipboard: true, execOk: false }), async ({ page }) => {
    await page.click("#ln-ctl");
    assert.ok((await toasts(page)).includes("Не удалось скопировать"));
    assert.deepEqual(await opened(page), [URL_OF("ctl")]);
  }));

test("наведение: подсказка с хостом, контуром, статусом и подсказкой по клику", () =>
  withPanel(interact(), async ({ page }) => {
    await page.hover('#dock [data-link-id="h-psi-a"]');
    await page.waitForSelector("#tip.on", { timeout: 2000 });
    const t = await page.innerText("#tip");
    assert.match(t, /iam-enigma-psi\.omega\.sbrf\.ru/);
    assert.match(t, /ПСИ · Alpha/);
    assert.match(t, /Клик — открыть/);
    assert.match(t, /92863949/);
    assert.match(t, /\/salesheroes/);
    assert.equal(await page.getAttribute("#tip", "aria-hidden"), "false");
    await page.mouse.move(2, 2);
    await page.waitForSelector("#tip:not(.on)");
  }));

test("поиск «пси alpha»: остаются только совпадения, подсветка, счётчик; Esc очищает", () =>
  withPanel(interact(), async ({ page }) => {
    await page.fill("#q", "пси alpha");
    await page.waitForFunction(() => document.querySelector("#cnt").textContent.includes(" из "));
    const r = await page.evaluate(() => {
      const D = RP.ui.data, sec = (l) => RP.ui.secById[l.section].name;
      const want = D.links.filter((l) => !l.meet && RP.core.match(l, sec(l), "пси alpha").hit).map((l) => l.id).sort();
      const vis = [...document.querySelectorAll("#idx .ln")].filter((e) => !e.hidden && !e.closest(".sec").hidden).map((e) => e.dataset.linkId).sort();
      return { want, vis, exp: document.querySelector("#q").getAttribute("aria-expanded"), marks: document.querySelectorAll("#idx .ln:not([hidden]) mark").length };
    });
    assert.ok(r.vis.length > 0 && r.vis.length < 84);
    assert.deepEqual(r.vis, r.want);
    assert.ok(r.vis.includes("h-psi-a") && !r.vis.includes("h-prom-a"));
    assert.equal(r.exp, "true");
    await page.focus("#q");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll("#idx .ln[hidden]:not(.away)").length === 0);
    assert.equal(await page.inputValue("#q"), "");
    assert.equal(await page.getAttribute("#q", "aria-expanded"), "false");
  }));

test("Ctrl/⌘+K фокусирует поиск; Enter открывает первую найденную", () =>
  withPanel(interact(), async ({ page }) => {
    await page.click("#theme");                          // увести фокус из поиска
    assert.notEqual(await page.evaluate(() => document.activeElement.id), "q");
    await page.keyboard.press("Control+k");
    assert.equal(await page.evaluate(() => document.activeElement.id), "q");
    await page.click("#theme");
    await page.keyboard.press("Meta+k");
    assert.equal(await page.evaluate(() => document.activeElement.id), "q");
    await page.keyboard.type("герои");
    await page.waitForFunction(() => document.querySelector("#cnt").textContent.includes(" из "));
    const first = await page.evaluate(() => {
      const ls = [...document.querySelectorAll("#idx .ln:not([hidden])")];
      return { n: ls.length, url: ls[0].getAttribute("href") };
    });
    assert.ok(first.n > 1);
    await page.keyboard.press("Enter");
    assert.deepEqual(await opened(page), [first.url]);
    // ↓ выбирает следующую строку, Enter открывает её
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
    const sel = await page.evaluate(() => { const e = document.querySelector("#idx .ln.kb"); return { url: e.getAttribute("href"), ad: document.querySelector("#q").getAttribute("aria-activedescendant"), id: e.id }; });
    assert.equal(sel.ad, sel.id);
    await page.keyboard.press("Enter");
    assert.equal((await opened(page))[1], sel.url);
  }));

test("фильтр «ИФТ» оставляет только ИФТ и инструменты; фильтры не запоминаются", () =>
  withPanel(interact(), async ({ page }) => {
    await page.click('#fEnv .chip[data-val="IFT"]');
    const r = await page.evaluate(() => [...document.querySelectorAll("#idx .ln:not([hidden])")].map((e) => RP.ui.byId[e.dataset.linkId]));
    assert.ok(r.length > 0);
    assert.ok(r.every((l) => l.env === "IFT" || l.tool), JSON.stringify(r.filter((l) => l.env !== "IFT" && !l.tool).map((l) => l.id)));
    assert.ok(r.some((l) => l.tool));
    assert.equal(await page.getAttribute('#fEnv .chip[data-val="IFT"]', "aria-pressed"), "true");
    assert.equal(await page.getAttribute('#fEnv .chip[data-val=""]', "aria-pressed"), "false");
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === "1");
    assert.equal(await page.locator("#idx .ln[hidden]:not(.away)").count(), 0);
    assert.equal(await page.getAttribute('#fEnv .chip[data-val=""]', "aria-pressed"), "true");
  }));

test("избранное: пустой rp_clicks → 9 закреплённых; 3 клика по qlik → после перезагрузки добирается после закреплённых", () =>
  withPanel(interact(), async ({ page }) => {
    const dock = () => page.$$eval("#dock [data-link-id]", (a) => a.map((e) => e.dataset.linkId));
    const seed = ["h-prom-a", "h-prom-s", "h-psi-a", "kap-prom", "kap-psi", "sand", "chat", "jazz", "mail"];
    assert.deepEqual(await dock(), seed);
    for (let i = 0; i < 3; i++) await page.click("#ln-qlik");
    assert.deepEqual(await dock(), seed);              // без перескоков до следующего открытия
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === "1");
    const d = await dock();
    assert.deepEqual(d.slice(0, 9), seed);             // сначала закреплённые
    assert.equal(d[9], "qlik");                        // затем автодобор по кликам
    assert.equal(d.length, 10);
  }));

test("встречи: полоса из 4 чипов, в разделе «Коммуникации» их нет; клик открывает встречу", () =>
  withPanel(interact(), async ({ page }) => {
    const r = await page.evaluate(() => ({
      meets: [...document.querySelectorAll("#meets [data-link-id]")].map((e) => e.dataset.linkId),
      comms: [...document.querySelectorAll('#idx [data-section-id="comms"] [data-link-id]')].filter((e) => e.offsetParent).map((e) => e.dataset.linkId)
    }));
    assert.equal(r.meets.length, 4);
    assert.ok(r.meets.every((id) => !r.comms.includes(id)));
    await page.click('#meets [data-link-id="daily"]');
    assert.deepEqual(await opened(page), [URL_OF("daily")]);
  }));

test("ничего не найдено: «zz<b>zz» (экранирование) → блок .empty; «Сбросить поиск и фильтры» возвращает все строки и чипы «Все»", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await page.click('#fSeg .chip[data-val="SIGMA"]');
    await page.fill("#q", "zz<b>zz");
    await page.waitForSelector("#idx .empty");
    const t = await page.innerText("#idx .empty");
    assert.match(t, /Ничего не нашлось/);
    assert.match(t, /по запросу «zz<b>zz» с выбранными фильтрами/);
    assert.equal(await page.locator("#idx .ln").count(), 0);
    await page.click("#idx .empty #reset");
    await page.waitForFunction(() => !document.querySelector("#idx .empty"));
    assert.equal(await page.locator("#idx .ln:not([hidden])").count(), 75);
    assert.equal(await page.inputValue("#q"), "");
    assert.equal(await page.getAttribute('#fSeg .chip[data-val=""]', "aria-pressed"), "true");
    assert.equal(await page.getAttribute('#fSeg .chip[data-val="SIGMA"]', "aria-pressed"), "false");
    assert.equal(await page.evaluate(() => document.activeElement.id), "q");
    assert.equal(await page.textContent("#cnt"), "88 ссылок");
    assert.deepEqual(realErrors(errors), []);
  }));

// ---------- Панель групп: состояния, поиск групп, «глаз», Alt+клик, шторка ----------
const SEC_IDS = ["comms", "heroes", "kap", "sup", "access", "itsm", "data", "docs", "jira", "repo", "tools"];
// Разделов в указателе по умолчанию: «Коммуникации» целиком в избранном и встречах и не показываются (§12)
const SHOWN = SEC_IDS.length - 1;
const idxSecs = (page) => page.$$eval("#idx [data-section-id]", (a) => a.map((e) => e.dataset.sectionId));

test("панель групп: при загрузке узкая; кнопка циклит open → compact → hidden до перезагрузки (#16)", () =>
  withPanel(interact(), async ({ page, errors }) => {
    const mode = () => page.evaluate(() => {
      const gp = document.querySelector("#gp");
      return { m: ["open", "compact", "hidden"].find((m) => gp.classList.contains("m-" + m)), w: Math.round(gp.getBoundingClientRect().width), rail: RP.store.get("rp_rail", null) };
    });
    assert.deepEqual(await mode(), { m: "compact", w: 60, rail: null });   // #16: при загрузке — узкая
    await setRail(page, "open");
    assert.deepEqual(await mode(), { m: "open", w: 248, rail: null });
    await page.click("#gpBtn");
    assert.deepEqual(await mode(), { m: "compact", w: 60, rail: null });
    assert.match(await page.getAttribute("#gpBtn", "aria-label"), /узкая.*скрытой/);
    // узкая: раскрытие поверх по задержке наведения
    await page.hover('#gpList .gr[data-sec="data"] .gr-go');
    await page.waitForFunction(() => document.querySelector("#gp").classList.contains("peek"), null, { timeout: 2000 });
    await page.mouse.move(900, 500);
    await page.click("#gpBtn");
    assert.deepEqual(await mode(), { m: "hidden", w: 0, rail: null });
    // F5 — снова узкая, даже если до этого была скрыта (и даже со старым rp_rail в хранилище)
    await page.evaluate(() => localStorage.setItem("rp_rail", JSON.stringify("open")));
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === "1");
    assert.deepEqual(await mode(), { m: "compact", w: 60, rail: "open" });
    await page.click("#gpBtn");
    assert.deepEqual(await mode(), { m: "hidden", w: 0, rail: "open" });
    assert.deepEqual(realErrors(errors), []);
  }));

test("панель групп: поиск «дан» оставляет «Данные и аналитика» (и другие названия с «дан»); клик — подсветка раздела", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await page.fill("#gq", "дан");
    const vis = await page.$$eval("#gpList .gr:not([hidden])", (a) => a.map((e) => e.dataset.sec));
    assert.ok(vis.includes("data"));
    assert.deepEqual(vis, ["kap", "data"]);   // «КАП и загрузка данных» тоже содержит «дан»
    assert.equal(await page.innerText('#gpList .gr[data-sec="data"] .nm mark'), "Дан");
    assert.equal(await page.isHidden("#gpNone"), true);
    await page.fill("#gq", "яяя");
    assert.equal(await page.isVisible("#gpNone"), true);
    await page.fill("#gq", "");
    assert.equal(await page.locator("#gpList .gr:not([hidden])").count(), 11);
    await page.click('#gpList .gr[data-sec="data"] .gr-go');
    await page.waitForFunction(() => document.querySelector("#sec-data").classList.contains("flash"));
    assert.deepEqual(realErrors(errors), []);
  }));

test("панель групп: «глаз» скрывает раздел (rp_groups), колонки перестроены; «Показать все · скрыто 1» возвращает", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await setRail(page, "open");
    assert.equal(await page.isHidden("#gpAll"), true);
    await page.hover('#gpList .gr[data-sec="data"]');
    await page.click('#gpList .gr[data-sec="data"] .gr-eye');
    assert.equal((await idxSecs(page)).includes("data"), false);
    assert.equal((await idxSecs(page)).length, SHOWN - 1);
    assert.deepEqual(await page.evaluate(() => RP.store.get("rp_groups")), ["data"]);
    assert.equal(await page.getAttribute('#gpList .gr[data-sec="data"] .gr-eye', "aria-pressed"), "false");
    assert.equal(await page.evaluate(() => document.querySelector('#gpList .gr[data-sec="data"]').classList.contains("off")), true);
    assert.equal(await page.isVisible("#gpAll"), true);
    assert.match(await page.innerText("#gpAll"), /Показать все\s*скрыто 1/);
    // перезагрузка сохраняет скрытие
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === "1");
    assert.equal((await idxSecs(page)).includes("data"), false);
    await page.click("#gpAll");
    assert.equal((await idxSecs(page)).length, SHOWN);
    assert.deepEqual(await page.evaluate(() => RP.store.get("rp_groups")), []);
    assert.equal(await page.isHidden("#gpAll"), true);
    assert.deepEqual(realErrors(errors), []);
  }));

test("панель групп: Alt+клик оставляет одну группу, повторный Alt+клик возвращает все", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await setRail(page, "open");
    await page.click('#gpList .gr[data-sec="heroes"] .gr-go', { modifiers: ["Alt"] });
    assert.deepEqual(await idxSecs(page), ["heroes"]);
    assert.equal((await page.evaluate(() => RP.store.get("rp_groups"))).length, 10);
    assert.match(await page.innerText("#gpAll"), /скрыто 10/);
    await page.click('#gpList .gr[data-sec="heroes"] .gr-go', { modifiers: ["Alt"] });
    assert.equal((await idxSecs(page)).length, SHOWN);
    assert.deepEqual(realErrors(errors), []);
  }));

test("все группы скрыты: короткое сообщение и «Показать все группы»", () =>
  withPanel({ ...interact(), seed: { rp_groups: JSON.stringify(SEC_IDS) } }, async ({ page, errors }) => {
    await setRail(page, "open");
    const t = await page.innerText("#idx .empty");
    assert.match(t, /Все группы скрыты/);
    assert.match(await page.innerText("#gpAll"), /скрыто 11/);
    await page.click("#idx .empty #reset");
    assert.equal((await idxSecs(page)).length, SHOWN);
    assert.deepEqual(await page.evaluate(() => RP.store.get("rp_groups")), []);
    assert.deepEqual(realErrors(errors), []);
  }));

test("390×844: шторка групп открывается кнопкой, Esc и клик мимо закрывают", () =>
  withPanel({ ...interact(), width: 390, height: 844 }, async ({ page, errors }) => {
    const on = () => page.evaluate(() => ({
      gp: document.querySelector("#gp").classList.contains("on"),
      scrim: document.querySelector("#scrim").classList.contains("on"),
      exp: document.querySelector("#gpBtn").getAttribute("aria-expanded"),
      left: Math.round(document.querySelector("#gp").getBoundingClientRect().left)
    }));
    assert.equal((await on()).gp, false);
    await page.click("#gpBtn");
    await page.waitForTimeout(300);
    assert.deepEqual(await on(), { gp: true, scrim: true, exp: "true", left: 0 });
    assert.equal(await page.evaluate(() => !!document.activeElement.closest("#gp")), true);
    await page.keyboard.press("Escape");
    const c = await on();
    assert.equal(c.gp, false); assert.equal(c.scrim, false); assert.equal(c.exp, "false");
    assert.equal(await page.evaluate(() => document.activeElement.id), "gpBtn");
    await page.click("#gpBtn");
    await page.waitForTimeout(300);
    await page.mouse.click(380, 400);   // по подложке справа от шторки
    assert.equal((await on()).gp, false);
    // клик по группе в шторке — закрывает её
    await page.click("#gpBtn");
    await page.waitForTimeout(300);
    await page.click('#gpList .gr[data-sec="docs"] .gr-go');
    assert.equal((await on()).gp, false);
    const m = await metrics(page);
    assert.equal(m.sw, 390);
    assert.deepEqual(realErrors(errors), []);
  }));

// ---------- Инструменты: модальные окна ----------
const modalOn = (page) => page.evaluate(() => document.querySelector("#modal").classList.contains("on"));

test("Декодер permission: 5 → биты 0, 2; zz → ошибка; Очистить; Esc закрывает и возвращает фокус", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await page.click('#idx [data-link-id="decoder"]');
    assert.equal(await modalOn(page), true);
    assert.equal(await page.innerText("#mTitle"), "Декодер permission");
    assert.equal(await page.evaluate(() => document.activeElement.id), "tIn");
    await page.fill("#tIn", "5");
    await page.click("text=Расшифровать");
    assert.equal(await page.textContent("#tOut"), "Бинарное представление:\n10100000 00000000 00000000 00000000\n\nВключённые биты:\n0, 2");
    assert.match(await page.innerText("#tOut"), /Включённые биты:\s*0, 2/);
    await page.fill("#tIn", "zz");
    await page.click("text=Расшифровать");
    assert.equal(await page.textContent("#tOut"), "Ошибка! Некорректный ввод.");
    await page.click("text=Очистить");
    assert.equal(await page.inputValue("#tIn"), "");
    assert.equal(await page.isHidden("#tOut"), true);
    // фокус удерживается внутри окна
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => !!document.activeElement.closest("#modal")), true);
    }
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest("#modal")), true);
    await page.keyboard.press("Escape");
    assert.equal(await modalOn(page), false);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.linkId), "decoder");
    // «Закрыть» и клик мимо окна
    await page.click('#idx [data-link-id="decoder"]');
    await page.click("#modal >> text=Закрыть");
    assert.equal(await modalOn(page), false);
    await page.click('#idx [data-link-id="decoder"]');
    await page.mouse.click(20, 880);
    assert.equal(await modalOn(page), false);
    assert.deepEqual(await opened(page), []);
    assert.deepEqual(realErrors(errors), []);
  }));

test("Проверка роли (ПСИ): «Открыть» неактивна при пустом поле; открывает URL из §7; «По умолчанию»", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await page.click('#idx [data-link-id="role"]');
    assert.equal(await modalOn(page), true);
    assert.equal(await page.inputValue("#tEmp"), "673892");
    assert.equal(await page.inputValue("#tRole"), "EFS_NB_SUP_BUSINESS_ADMIN_GAMIFICATION");
    assert.equal(await page.isEnabled("#tOpen"), true);
    await page.fill("#tEmp", "");
    assert.equal(await page.isDisabled("#tOpen"), true);
    await page.fill("#tEmp", "673892");
    assert.equal(await page.isEnabled("#tOpen"), true);
    await page.fill("#tRole", "  ");
    assert.equal(await page.isDisabled("#tOpen"), true);
    await page.click("text=По умолчанию");
    assert.equal(await page.inputValue("#tRole"), "EFS_NB_SUP_BUSINESS_ADMIN_GAMIFICATION");
    assert.equal(await page.isEnabled("#tOpen"), true);
    await page.evaluate(() => { const o = window.open; window.__openArgs = []; window.open = function (u, t, f) { window.__openArgs.push([t, f]); return o.apply(this, arguments); }; });
    await page.click("#tOpen");
    assert.deepEqual(await opened(page), ["https://iam-enigma-psi.omega.sbrf.ru/rmkib.support/api/v1/service/auth/explain/html?employee-number=673892&role=EFS_NB_SUP_BUSINESS_ADMIN_GAMIFICATION"]);
    assert.deepEqual(await page.evaluate(() => window.__openArgs), [["_blank", "noopener"]]);
    // кодирование значений
    await page.fill("#tRole", "A&B ?");
    await page.click("#tOpen");
    assert.match((await opened(page))[1], /role=A%26B%20%3F$/);
    assert.deepEqual(realErrors(errors), []);
  }));

test("RP.modal.open/close: произвольное содержимое, Esc закрывает", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = '<h2 id="mTitle">Тест</h2><input id="mx1"><button type="button" id="mx2">ok</button>';
      RP.modal.open(d);
    });
    assert.equal(await modalOn(page), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), "mx1");
    assert.equal(await page.evaluate(() => RP.modal.isOpen()), true);
    await page.evaluate(() => RP.modal.close());
    assert.equal(await modalOn(page), false);
    assert.equal(await page.evaluate(() => document.querySelector("#scrim").classList.contains("on")), false);
    assert.deepEqual(realErrors(errors), []);
  }));

test("скрыта одна группа + несуществующий запрос → «Ничего не нашлось», а не «Все группы скрыты»", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await page.hover('#gpList .gr[data-sec="data"]');
    await page.click('#gpList .gr[data-sec="data"] .gr-eye');
    await page.fill("#q", "zzz");
    await page.waitForSelector("#idx .empty");
    const t = await page.innerText("#idx .empty");
    assert.match(t, /Ничего не нашлось/);
    assert.doesNotMatch(t, /Все группы скрыты/);
    await page.click("#idx .empty #reset");
    assert.equal(await page.inputValue("#q"), "");
    assert.deepEqual(await page.evaluate(() => RP.store.get("rp_groups")), ["data"]);
    assert.equal((await idxSecs(page)).length, SHOWN - 1);
    assert.deepEqual(realErrors(errors), []);
  }));

// ---------- Администрирование (§8): редактор ссылок и площадка скриптов ----------
const drawerOn = (page) => page.evaluate(() => document.querySelector("#drawer").classList.contains("on"));
const dirtyText = (page) => page.innerText("#aDirty");
async function openAdmin(page) {
  await page.click("#lock");
  await page.waitForSelector("#drawer.on #aList");
}
async function editLink(page, id) {
  await page.fill("#aQ", "");
  await page.click(`#aList [data-lid="${id}"] .a-open`);
  await page.waitForSelector("#drawer #eTitle");
}

test("админка: замок открывает панель с вкладками «Ссылки» / «Скрипты»; правка названия сразу на странице; счётчик; beforeunload; отмена", () =>
  withPanel(interact(), async ({ page, errors }) => {
    assert.equal(await drawerOn(page), false);
    await openAdmin(page);
    assert.equal(await drawerOn(page), true);
    const tabs = await page.$$eval('#drawer [role="tab"]', (a) => a.map((t) => t.textContent.trim()));
    assert.deepEqual(tabs, ["Ссылки", "Скрипты"]);
    assert.match(await dirtyText(page), /несохранённых изменений: 0/i);
    // ссылки в списке админки не являются ссылками страницы (нет data-link-id)
    assert.equal(await page.locator("#drawer [data-link-id]").count(), 0);
    await editLink(page, "kap-prom");
    assert.equal(await page.inputValue("#eTitle"), "КАП");
    await page.fill("#eTitle", "КАП боевой");
    await page.click("#eSave");
    assert.equal((await page.innerText('#dock [data-link-id="kap-prom"] .lb')).trim(), "КАП боевой");
    assert.match(await dirtyText(page), /несохранённых изменений: 1/i);
    assert.equal(await page.evaluate(() => typeof window.onbeforeunload), "function");
    // список админки обновлён
    assert.match(await page.innerText('#aList [data-lid="kap-prom"]'), /КАП боевой/);
    // «Отменить изменения» — исходные данные, счётчик 0, предупреждения нет
    await page.click("#aRevert");
    assert.equal((await page.innerText('#dock [data-link-id="kap-prom"] .lb')).trim(), "КАП");
    assert.match(await dirtyText(page), /несохранённых изменений: 0/i);
    assert.equal(await page.evaluate(() => window.onbeforeunload), null);
    // Esc закрывает панель и возвращает фокус на замок
    await page.keyboard.press("Escape");
    assert.equal(await drawerOn(page), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "lock");
    assert.deepEqual(realErrors(errors), []);
  }));

test("админка: добавить ссылку с кодом omega\\x, невалидный URL, удалить, «Скачать links.js» → подмена файла даёт те же изменения", async () => {
  let text = "";
  await withPanel(interact(), async ({ page, errors }) => {
    await openAdmin(page);
    // переименование
    await editLink(page, "kap-prom");
    await page.fill("#eTitle", "КАП боевой");
    await page.click("#eSave");
    // новая ссылка в «Репозитории»
    await page.click("#aAdd");
    await page.waitForSelector("#drawer #eTitle");
    await page.fill("#eTitle", "Новый репозиторий");
    await page.selectOption("#eSec", "repo");
    await page.fill("#eUrl", "ftp://bad");
    assert.match(await page.innerText("#eUrlErr"), /http/);
    assert.equal(await page.isDisabled("#eSave"), true);
    await page.fill("#eUrl", "https://stash.test/new");
    assert.equal((await page.innerText("#eUrlErr")).trim(), "");
    assert.equal(await page.isDisabled("#eSave"), false);
    await page.fill("#eCopy", "omega\\x");
    await page.selectOption("#eSeg", "SIGMA");
    // #25: тематические блоки свёрнуты, раскрыт только «Часто используемые»
    assert.deepEqual(await page.$$eval("#eIcon details", (a) => a.map((d) => d.open)).then((o) => [o[0], o.slice(1).some(Boolean)]), [true, false]);
    assert.equal(await page.isVisible('#eIcon [data-icon="search"]'), false);
    await page.click('#eIcon details:has([data-icon="star"]) > summary');
    await page.click('#eIcon details[open] [data-icon="star"]');
    await page.click("#eSave");
    const nid = await page.evaluate(() => RP.ui.data.links.find((l) => l.title === "Новый репозиторий").id);
    assert.match(nid, /^[a-z0-9_-]+$/);
    assert.equal(await page.locator(`#sec-repo #ln-${nid}`).count(), 1);
    assert.equal(await page.evaluate((id) => RP.ui.byId[id].copy, nid), "omega\\x");
    assert.equal(await page.evaluate((id) => RP.ui.byId[id].icon, nid), "star");
    assert.match(await dirtyText(page), /несохранённых изменений: 2/i);
    // удаление
    await page.fill("#aQ", "");
    await page.click('#aList [data-lid="r-sowa"] .a-del');
    assert.equal(await page.locator("#ln-r-sowa").count(), 0);
    assert.match(await dirtyText(page), /несохранённых изменений: 3/i);
    // выгрузка
    assert.match(await page.innerText("#drawer"), /замените файл рядом с index\.html/);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#aDown")]);
    assert.equal(dl.suggestedFilename(), "links.js");
    text = fs.readFileSync(await dl.path(), "utf8");
    assert.ok(text.includes('"title":"КАП боевой"'));
    assert.ok(text.includes('"copy":"omega\\\\x"'));
    assert.ok(!text.includes('"id":"r-sowa"'));
    assert.deepEqual(realErrors(errors), []);
  });
  await withPanel({ ...interact(), links: text }, async ({ page, errors }) => {
    assert.equal((await page.innerText('#dock [data-link-id="kap-prom"] .lb')).trim(), "КАП боевой");
    assert.equal(await page.locator("#ln-r-sowa").count(), 0);
    const l = await page.evaluate(() => RP.ui.data.links.find((x) => x.title === "Новый репозиторий"));
    assert.equal(l.copy, "omega\\x");
    assert.equal(l.section, "repo");
    assert.equal(await page.locator(`#sec-repo #ln-${l.id}`).count(), 1);
    await page.click(`#ln-${l.id}`);
    await page.waitForFunction(() => document.querySelectorAll("#toasts .toast").length > 0);
    assert.equal(await clip(page), "omega\\x");
    assert.deepEqual(realErrors(errors), []);
  });
});

test("админка: смена URL перепроверяет доступность ссылки; перемещение вверх/вниз меняет порядок", () =>
  withPanel({
    ...interact(),
    setup: async ({ page }) => {
      await interact().setup({ page });
      await page.route((u) => /down-host/.test(u.href), (route) => route.abort("connectionrefused").catch(() => {}));
    }
  }, async ({ page, errors }) => {
    await page.waitForFunction(() => document.querySelector("#ln-qlik").dataset.st === "up");
    await openAdmin(page);
    await editLink(page, "qlik");
    await page.fill("#eUrl", "https://down-host.test/");
    await page.click("#eSave");
    await page.waitForFunction(() => document.querySelector("#ln-qlik").dataset.st === "down", null, { timeout: 8000 });
    // порядок в разделе
    const order = () => page.$$eval("#sec-repo .ln", (a) => a.map((e) => e.dataset.linkId));
    const before = await order();
    await page.click(`#aList [data-lid="${before[1]}"] .a-up`);
    const after = await order();
    assert.deepEqual(after.slice(0, 2), [before[1], before[0]]);
    await page.click(`#aList [data-lid="${before[1]}"] .a-dn`);
    assert.deepEqual(await order(), before);
    assert.deepEqual(realErrors(errors), []);
  }));

test("админка: разделы — переименовать, сменить иконку, добавить, порядок; стартовое избранное", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await setRail(page, "open");
    await openAdmin(page);
    await page.click("#aSecs > summary");
    const name = page.locator('#aSecs [data-sid="repo"] .s-name');
    await name.fill("Код <b>и</b> репо");
    await name.press("Enter");
    assert.equal((await page.innerText("#sec-repo .sh span")).trim(), "Код <b>и</b> репо");
    assert.equal(await page.locator("#sec-repo .sh b").count(), 0);
    assert.equal((await page.innerText('#gpList .gr[data-sec="repo"] .nm')).trim(), "Код <b>и</b> репо");
    // иконка раздела
    await page.click('#aSecs [data-sid="repo"] .s-ic');
    // #26: «Часто используемые» сверху и раскрыт; порядок — по числу применений
    const top = await page.$$eval('#aSecs [data-sid="repo"] .ipg-top[open] [data-icon]', (a) => a.map((b) => b.dataset.icon));
    assert.deepEqual(top, await page.evaluate(() => RP.icons.usage(RP.ui.data).map((u) => u[0])));
    await page.click('#aSecs [data-sid="repo"] .ipick details:has([data-icon="galaxy"]):not(.ipg-top) > summary');
    await page.click('#aSecs [data-sid="repo"] .ipick details[open]:not(.ipg-top) [data-icon="galaxy"]');
    assert.equal(await page.getAttribute("#sec-repo .sh use", "href"), "#rp-i-galaxy");
    // новый раздел
    await page.fill("#sNew", "Новый раздел");
    await page.click("#sAdd");
    const sid = await page.evaluate(() => RP.ui.data.sections.find((s) => s.name === "Новый раздел").id);
    assert.match(sid, /^[a-z0-9_-]+$/);
    assert.equal(await page.locator(`#gpList .gr[data-sec="${sid}"]`).count(), 1);
    // порядок разделов: «Новый раздел» выше «Инструменты»
    await page.click(`#aSecs [data-sid="${sid}"] .s-up`);
    const secs = await page.evaluate(() => RP.ui.data.sections.map((s) => s.id));
    assert.deepEqual(secs.slice(-2), [sid, "tools"]);
    // избранное: убрать h-prom-a — док начинается со следующей; добавить qlik — она в доке
    const dock = () => page.$$eval("#dock [data-link-id]", (a) => a.map((e) => e.dataset.linkId));
    assert.equal((await dock())[0], "h-prom-a");
    await page.click("#aFav > summary");
    await page.click('#aFav [data-fid="h-prom-a"] .f-del');
    assert.equal((await dock())[0], "h-prom-s");
    assert.equal(await page.locator('#dock [data-link-id="qlik"]').count(), 0);
    await page.selectOption("#fsAdd", "qlik");
    await page.click("#fsAddBtn");
    assert.deepEqual((await dock()).slice(0, 9), ["h-prom-s", "h-psi-a", "kap-prom", "kap-psi", "sand", "chat", "jazz", "mail", "qlik"]);
    assert.equal(await page.evaluate(() => RP.ui.data.favorites.at(-1)), "qlik");
    assert.match(await dirtyText(page), /несохранённых изменений: 6/i);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#aDown")]);
    const text = fs.readFileSync(await dl.path(), "utf8");
    assert.ok(text.includes('{"id":"repo","name":"Код <b>и</b> репо","icon":"galaxy"}'));
    assert.match(await dirtyText(page), /несохранённых изменений: 0/i);
    assert.deepEqual(realErrors(errors), []);
  }));

test("скрипты: пустой adminScripts → пустое состояние с пояснением", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await openAdmin(page);
    await page.click("#atScripts");
    const t = await page.innerText("#apScripts");
    assert.match(t, /Скриптов пока нет/);
    assert.match(t, /adminScripts/);
    assert.match(t, /admin\/README\.md/);
    assert.deepEqual(realErrors(errors), []);
  }));

const withScripts = (extra) => {
  const d = Function("window", LINKS_SRC + "; return window.RP_LINKS;")({});
  d.adminScripts = [{ id: "demo", title: "Демо", desc: "Проверочный скрипт", file: "admin/demo.js" }];
  return { ...interact(), links: "window.RP_LINKS = " + JSON.stringify(d) + ";\n", ...extra };
};
const DEMO_CODE = 'console.log("demo \\\\ ok");';

test("скрипты: «Загрузить» → «Копировать» → код в буфере, тост с числом символов; RP.admin.loadScript", () =>
  withPanel(withScripts({
    files: { "admin/demo.js": 'window.RP_ADMIN = window.RP_ADMIN || {}; RP_ADMIN["demo"] = { title: "Демо", code: ' + JSON.stringify(DEMO_CODE) + " };\n" }
  }), async ({ page, errors }) => {
    await openAdmin(page);
    await page.click("#atScripts");
    assert.match(await page.innerText("#apScripts"), /Демо/);
    assert.equal(await page.locator("#apScripts .sc-copy").count(), 0);
    await page.click("#apScripts .sc-load");
    await page.waitForSelector("#apScripts .sc-copy");
    await page.click("#apScripts .sc-copy");
    await page.waitForFunction(() => [...document.querySelectorAll("#toasts .toast")].some((t) => /символ/.test(t.textContent)));
    assert.equal(await clip(page), DEMO_CODE);
    assert.ok((await toasts(page)).some((t) => t.includes(String(DEMO_CODE.length))));
    const r = await page.evaluate(() => RP.admin.loadScript({ id: "demo", file: "admin/demo.js" }));
    assert.deepEqual(r, { title: "Демо", code: DEMO_CODE });
    assert.deepEqual(realErrors(errors), []);
  }));

test("скрипты: отсутствующий файл → сообщение с путём admin/demo.js", () =>
  withPanel(withScripts(), async ({ page, errors }) => {
    await openAdmin(page);
    await page.click("#atScripts");
    await page.click("#apScripts .sc-load");
    await page.waitForSelector("#apScripts .sc-err:not(:empty)");
    assert.match(await page.innerText("#apScripts .sc-err"), /admin\/demo\.js/);
    const msg = await page.evaluate(() => RP.admin.loadScript({ id: "nope", file: "admin/nope.js" }).then(() => "ok", (e) => e instanceof Error && e.message));
    assert.match(msg, /admin\/nope\.js/);
    assert.equal(await page.locator("#apScripts .sc-copy").count(), 0);
    assert.deepEqual(realErrors(errors), []);
  }));

// ---------- Исправления по итоговому ревью ----------
test("подсказка не всплывает снова после клика по ссылке (с кодом, без кода, ⌘+клик)", () =>
  withPanel(interact(), async ({ page }) => {
    const tipOn = () => page.evaluate(() => document.querySelector("#tip").classList.contains("on"));
    await page.hover('#dock [data-link-id="h-psi-a"]');
    await page.waitForSelector("#tip.on", { timeout: 2000 });
    await page.click('#dock [data-link-id="h-psi-a"]');
    await page.waitForTimeout(120);
    assert.equal(await tipOn(), false, "после клика с кодом");
    await page.click("#ln-qlik");
    await page.waitForTimeout(120);
    assert.equal(await tipOn(), false, "после клика без кода");
    await page.click("#ln-sprint", { modifiers: ["Meta"] });
    await page.waitForTimeout(120);
    assert.equal(await tipOn(), false, "после ⌘+клика");
    // фокус с клавиатуры по-прежнему показывает подсказку
    await page.mouse.move(2, 2);
    await page.focus("#q");
    let onLink = false;
    for (let i = 0; i < 40 && !onLink; i++) {
      await page.keyboard.press("Tab");
      onLink = await page.evaluate(() => !!(document.activeElement.closest && document.activeElement.closest("[data-link-id]")));
    }
    assert.ok(onLink, "Tab дошёл до ссылки");
    assert.equal(await tipOn(), true, "фокус с клавиатуры");
  }));

test("Ctrl+K в русской раскладке (key «л», code KeyK) фокусирует поиск", () =>
  withPanel(interact(), async ({ page }) => {
    await page.click("#theme");
    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent("keydown", { key: "л", code: "KeyK", ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(prevented, true);
    assert.equal(await page.evaluate(() => document.activeElement.id), "q");
  }));

test("админка: заполненная форма новой ссылки переживает Esc, клик мимо и смену вкладки", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await openAdmin(page);
    await page.click("#aAdd");
    await page.fill("#eTitle", "Новая");
    await page.fill("#eUrl", "https://x.example/");
    await page.fill("#eCopy", "k1");
    await page.keyboard.press("Escape");
    assert.equal(await drawerOn(page), false);
    await page.click("#lock");
    await page.waitForSelector("#drawer.on #eForm");
    assert.equal(await page.inputValue("#eTitle"), "Новая");
    assert.equal(await page.inputValue("#eUrl"), "https://x.example/");
    assert.equal(await page.inputValue("#eCopy"), "k1");
    // смена вкладки
    await page.click("#atScripts");
    await page.click("#atLinks");
    assert.equal(await page.inputValue("#eTitle"), "Новая");
    // клик мимо
    await page.mouse.click(5, 450);
    assert.equal(await drawerOn(page), false);
    await page.click("#lock");
    await page.waitForSelector("#drawer.on #eForm");
    assert.equal(await page.inputValue("#eUrl"), "https://x.example/");
    // «Отмена» сбрасывает черновик: следующее открытие — пустая форма
    await page.click("#eCancel");
    await page.click("#aAdd");
    assert.equal(await page.inputValue("#eTitle"), "");
    // правка существующей ссылки: черновик тоже сохраняется, страница не меняется до «Сохранить»
    await page.click("#eCancel");
    await editLink(page, "qlik");
    await page.fill("#eTitle", "Qlik черновик");
    await page.keyboard.press("Escape");
    await page.click("#lock");
    await page.waitForSelector("#drawer.on #eForm");
    assert.equal(await page.inputValue("#eTitle"), "Qlik черновик");
    assert.ok(!(await page.innerText("#ln-qlik")).includes("черновик"));
    assert.deepEqual(realErrors(errors), []);
  }));

test("админка: переименование раздела и сразу клик «Раздел ниже» — применяются оба", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await openAdmin(page);
    await page.click("#aSecs > summary");
    const first = await page.$eval("#aSecs .srow", (e) => e.dataset.sid);
    await page.fill(`#aSecs [data-sid="${first}"] .s-name`, "Переименовано");
    await page.click(`#aSecs [data-sid="${first}"] .s-dn`);
    const r = await page.evaluate((sid) => ({ order: RP.ui.data.sections.map((s) => s.id), name: RP.ui.data.sections.find((s) => s.id === sid).name }), first);
    assert.equal(r.name, "Переименовано");
    assert.equal(r.order[1], first);
    // первый раздел («Коммуникации») пуст на странице (§12) — заголовок проверяем в построенном элементе раздела
    assert.equal(await page.evaluate((sid) => RP.ui.secEl[sid].querySelector(".sh span").textContent, first), "Переименовано");
    assert.equal(await page.getAttribute(`#aSecs [data-sid="${first}"] .s-dn`, "aria-label"), "Раздел ниже: «Переименовано»");
    assert.match(await dirtyText(page), /несохранённых изменений: 2/i);
    assert.deepEqual(realErrors(errors), []);
  }));

test("проверка: исключение в обработчике результата не оставляет проверку зависшей", () =>
  withPanel({ links: mkLinks(SET.filter((l) => l.id !== "h1")), setup: netStub().setup }, async ({ page }) => {
    await page.waitForFunction(() => !document.querySelector("#refresh").classList.contains("busy"));
    // RP.probe.run завершается, даже если onResult/onProgress бросают
    const sum = await page.evaluate(() => Promise.race([
      RP.probe.run([{ id: "a", url: "https://up1.test/" }, { id: "b", url: "https://up2.test/" }], {
        onResult() { throw new Error("boom"); }, onProgress() { throw new Error("boom"); }
      }).then((s) => s.total),
      new Promise((r) => setTimeout(() => r("timeout"), 4000))
    ]));
    assert.equal(sum, 2);
    // проверка панели: обработчик статуса бросает → флаг сброшен, следующая проверка запускается
    const r = await page.evaluate(async () => {
      const orig = RP.status.set;
      RP.status.set = () => { throw new Error("boom"); };
      const p = RP.ui.check();
      const res = await Promise.race([Promise.resolve(p).then(() => "done", () => "rejected"), new Promise((r) => setTimeout(() => r("timeout"), 4000))]);
      RP.status.set = orig;
      return { res, busy: document.querySelector("#refresh").classList.contains("busy"), next: RP.ui.check() !== null };
    });
    assert.equal(r.res, "done");
    assert.equal(r.busy, false);
    assert.equal(r.next, true);
  }));

// ---------- Доработка 1 (§12): избранное и встречи из админки, двухстрочные названия ----------
const dockIds = (page) => page.$$eval("#dock [data-link-id]", (a) => a.map((e) => e.dataset.linkId));
const meetIds = (page) => page.$$eval("#meets [data-link-id]", (a) => a.map((e) => e.dataset.linkId));
// Видимые строки раздела в указателе
const secIds = (page, sid) => page.$$eval(`#idx [data-section-id="${sid}"] [data-link-id]`, (a) => a.filter((e) => e.offsetParent !== null).map((e) => e.dataset.linkId));

test("§12 данные по умолчанию: закреплённые в «Избранном» и не в разделах; 4 встречи, в «Коммуникациях» их нет", () =>
  withPanel(interact(), async ({ page, errors }) => {
    const fav = ["h-prom-a", "h-prom-s", "h-psi-a", "kap-prom", "kap-psi", "sand", "chat", "jazz", "mail"];
    assert.deepEqual(await dockIds(page), fav);
    assert.ok(!(await secIds(page, "heroes")).includes("h-prom-a"));
    assert.ok((await secIds(page, "heroes")).includes("h-psi-s"));
    assert.ok(!(await secIds(page, "kap")).includes("kap-prom"));
    assert.deepEqual(await meetIds(page), ["daily", "k2", "pereval", "open"]);
    const comms = await secIds(page, "comms");
    assert.ok(["daily", "k2", "pereval", "open"].every((id) => !comms.includes(id)));
    // «Коммуникации» опустели (все ссылки — в избранном и встречах) — раздел не показывается
    assert.equal(await page.locator('#idx [data-section-id="comms"]:visible').count(), 0);
    // поиск показывает закреплённую ссылку и в её разделе, Enter открывает её
    await page.fill("#q", "герои продаж prom sigma");
    await page.waitForFunction(() => document.querySelector("#cnt").textContent.includes(" из "));
    assert.deepEqual(await secIds(page, "heroes"), ["h-prom-s"]);
    await page.fill("#q", "");
    await page.waitForFunction(() => !document.querySelector("#cnt").textContent.includes(" из "));
    assert.ok(!(await secIds(page, "heroes")).includes("h-prom-s"));
    // закреплённая из опустевшего раздела тоже находится поиском
    await page.fill("#q", "сберчат");
    await page.waitForFunction(() => document.querySelector("#cnt").textContent.includes(" из "));
    assert.deepEqual(await secIds(page, "comms"), ["chat"]);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#cnt").textContent.includes(" из "));
    assert.equal(await page.locator('#idx [data-section-id="comms"]:visible').count(), 0);
    assert.deepEqual(realErrors(errors), []);
  }));

test("§12 админка: ★ у qlik — в избранном и не в разделе; «Скрыть из раздела» снята — и там, и там", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await openAdmin(page);
    const star = page.locator('#aList [data-lid="qlik"] .a-fav');
    assert.equal(await star.getAttribute("aria-pressed"), "false");
    await star.click();
    assert.equal(await page.locator('#aList [data-lid="qlik"] .a-fav').getAttribute("aria-pressed"), "true");
    assert.equal((await dockIds(page)).at(-1), "qlik");
    assert.ok(!(await secIds(page, "data")).includes("qlik"));
    await editLink(page, "qlik");
    assert.equal(await page.isChecked("#eFav"), true);
    assert.equal(await page.isChecked("#eFavHide"), true);
    await page.uncheck("#eFavHide");
    await page.click("#eSave");
    assert.ok((await dockIds(page)).includes("qlik"));
    assert.ok((await secIds(page, "data")).includes("qlik"));
    assert.equal(await page.evaluate(() => RP.ui.byId.qlik.favHide), false);
    // снять ★ — уходит из избранного, остаётся в разделе
    await page.click('#aList [data-lid="qlik"] .a-fav');
    assert.ok(!(await dockIds(page)).includes("qlik"));
    assert.ok((await secIds(page, "data")).includes("qlik"));
    assert.ok(!(await page.evaluate(() => RP.ui.data.favorites)).includes("qlik"));
    assert.deepEqual(realErrors(errors), []);
  }));

test("§12 админка: видео у jazz — во встречах, не в «Коммуникациях»; «Скрыть из раздела» снята — и там, и там", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await openAdmin(page);
    const cam = page.locator('#aList [data-lid="jazz"] .a-meet');
    assert.equal(await cam.getAttribute("aria-pressed"), "false");
    await cam.click();
    assert.equal(await page.locator('#aList [data-lid="jazz"] .a-meet').getAttribute("aria-pressed"), "true");
    assert.deepEqual(await meetIds(page), ["jazz", "daily", "k2", "pereval", "open"]);
    assert.ok(!(await dockIds(page)).includes("jazz"), "встреча не остаётся в избранном");
    assert.ok(!(await secIds(page, "comms")).includes("jazz"));
    await editLink(page, "jazz");
    assert.equal(await page.isChecked("#eMeet"), true);
    assert.equal(await page.isChecked("#eMeetHide"), true);
    await page.uncheck("#eMeetHide");
    await page.click("#eSave");
    assert.ok((await meetIds(page)).includes("jazz"));
    assert.deepEqual(await secIds(page, "comms"), ["jazz"]);
    assert.deepEqual(realErrors(errors), []);
  }));

test("§12 админка: блок «Избранное» — порядок ↑↓, «Добирать по частоте кликов», предупреждение «не поместилось»", () =>
  withPanel({ ...interact(), seed: { rp_clicks: JSON.stringify({ qlik: 3, sprint: 1 }) } }, async ({ page, errors }) => {
    const fav = ["h-prom-a", "h-prom-s", "h-psi-a", "kap-prom", "kap-psi", "sand", "chat", "jazz", "mail"];
    assert.deepEqual(await dockIds(page), fav.concat(["qlik", "sprint"]));
    await openAdmin(page);
    await page.click("#aFav > summary");
    await page.click('#aFav [data-fid="h-prom-s"] .f-up');
    assert.deepEqual((await dockIds(page)).slice(0, 3), ["h-prom-s", "h-prom-a", "h-psi-a"]);
    await page.click('#aFav [data-fid="h-prom-s"] .f-dn');
    assert.deepEqual((await dockIds(page)).slice(0, 3), fav.slice(0, 3));
    // без автодобора — только закреплённые
    assert.equal(await page.isChecked("#aFavAuto"), true);
    await page.uncheck("#aFavAuto");
    assert.deepEqual(await dockIds(page), fav);
    assert.equal(await page.evaluate(() => RP.ui.data.settings.favAuto), false);
    assert.equal(await page.locator("#aFavOver").isVisible(), false);
    // закрепить ещё — пока не перестанут помещаться
    const slots = await page.evaluate(() => RP.ui.slots);
    assert.ok(slots >= 4);
    const extra = await page.evaluate((n) => RP.ui.data.links.filter((l) => !l.fav && !l.meet && !l.tool).slice(0, n).map((l) => l.id), slots - fav.length + 2);
    for (const id of extra) await page.click(`#aList [data-lid="${id}"] .a-fav`);
    assert.equal((await dockIds(page)).length, slots);
    const over = extra.slice(-2);
    assert.match(await page.innerText("#aFavOver"), /не поместил\S* 2/i);
    // не поместившиеся остаются в своих разделах
    for (const id of over) {
      const sid = await page.evaluate((x) => RP.ui.byId[x].section, id);
      assert.ok((await secIds(page, sid)).includes(id), id);
    }
    assert.deepEqual(realErrors(errors), []);
  }));

test("§12 админка: блок «Встречи» — порядок ↑↓ и «убрать»", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await openAdmin(page);
    await page.click("#aMeets > summary");
    await page.click('#aMeets [data-mid="k2"] .m-up');
    assert.deepEqual(await meetIds(page), ["k2", "daily", "pereval", "open"]);
    await page.click('#aMeets [data-mid="open"] .m-del');
    assert.deepEqual(await meetIds(page), ["k2", "daily", "pereval"]);
    assert.ok((await secIds(page, "comms")).includes("open"));
    assert.deepEqual(realErrors(errors), []);
  }));

test("§12 выгрузка после правок избранного и встреч → загрузка того же файла даёт то же состояние", async () => {
  let text = "", state = null;
  const snap = (page) => page.evaluate(() => ({
    dock: [...document.querySelectorAll("#dock [data-link-id]")].map((e) => e.dataset.linkId),
    meets: [...document.querySelectorAll("#meets [data-link-id]")].map((e) => e.dataset.linkId),
    comms: [...document.querySelectorAll('#idx [data-section-id="comms"] [data-link-id]')].filter((e) => e.offsetParent).map((e) => e.dataset.linkId),
    data: [...document.querySelectorAll('#idx [data-section-id="data"] [data-link-id]')].filter((e) => e.offsetParent).map((e) => e.dataset.linkId),
    favAuto: RP.ui.data.settings.favAuto
  }));
  await withPanel(interact(), async ({ page, errors }) => {
    await openAdmin(page);
    await page.click('#aList [data-lid="qlik"] .a-fav');
    await editLink(page, "qlik");
    await page.uncheck("#eFavHide");
    await page.click("#eSave");
    await page.click('#aList [data-lid="jazz"] .a-meet');
    await page.click("#aFav > summary");
    await page.click('#aFav [data-fid="qlik"] .f-up');
    await page.uncheck("#aFavAuto");
    state = await snap(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#aDown")]);
    text = fs.readFileSync(await dl.path(), "utf8");
    assert.ok(!text.includes("favoriteSeed"));
    assert.ok(text.includes('"settings": {"favAuto":false}'));
    assert.deepEqual(realErrors(errors), []);
  });
  assert.ok(state.dock.includes("qlik") && state.data.includes("qlik") && state.meets[0] === "jazz");
  await withPanel({ ...interact(), links: text }, async ({ page, errors }) => {
    assert.deepEqual(await snap(page), state);
    assert.deepEqual(realErrors(errors), []);
  });
});

test("§12 старый links.js (favoriteSeed, без favorites) загружается без ошибок и показывает это избранное", () => {
  const old = LINKS_SRC
    .replace(/  "favorites": .*\n/, '  "favoriteSeed": ["kap-prom","daily","qlik"],\n')
    .replace(/  "settings": .*\n/, "")
    .replace(/,"fav":true/g, "");
  assert.ok(!old.includes('"favorites"') && !old.includes('"fav"'));
  return withPanel({ ...interact(), links: old }, async ({ page, errors }) => {
    assert.deepEqual(errors, []);
    assert.deepEqual(await dockIds(page), ["kap-prom", "qlik"]);
    assert.ok(!(await secIds(page, "data")).includes("qlik"));
    assert.equal((await meetIds(page)).length, 4);
    assert.equal(await page.evaluate(() => RP.ui.data.favoriteSeed), undefined);
  });
});

// Длинное название ≈60 символов
const LONG = (i) => `Очень длинное название ссылки номер ${i} про отчёты и выгрузки данных`;
const longSrc = (ids) => ids.reduce((src, id, i) =>
  src.replace(new RegExp('("id":"' + id + '"[^\\n]*?"title":")[^"]*'), "$1" + LONG(i)), LINKS_SRC);
// Высота блока названия в строках, обрезка
const titleBox = (page, sel) => page.$eval(sel, (t) => {
  const cs = getComputedStyle(t), lh = parseFloat(cs.lineHeight), r = t.getBoundingClientRect(), row = t.closest("[data-link-id]");
  return { lines: r.height / lh, clamp: cs.webkitLineClamp, rowCut: row.scrollHeight - row.clientHeight, inRow: r.bottom <= row.getBoundingClientRect().bottom + 0.5 && r.top >= row.getBoundingClientRect().top - 0.5 };
});

test("§12 двухстрочные названия: строка указателя, плитка избранного и чип встречи — ровно 2 строки, без обрезки", () =>
  withPanel({ ...interact(), links: longSrc(["qlik", "h-prom-a", "daily"]) }, async ({ page, errors }) => {
    for (const sel of ["#ln-qlik .tt", '#dock [data-link-id="h-prom-a"] .lb', '#meets [data-link-id="daily"] .tt']) {
      const b = await titleBox(page, sel);
      assert.ok(Math.abs(b.lines - 2) < 0.15, `${sel}: строк ${b.lines}`);
      assert.equal(String(b.clamp), "2", sel);
      assert.ok(b.rowCut <= 1, `${sel}: строка обрезана на ${b.rowCut}px`);
      assert.ok(b.inRow, `${sel}: название выходит за строку`);
    }
    // короткое название — одна строка
    const s = await titleBox(page, "#ln-hue .tt");
    assert.ok(Math.abs(s.lines - 1) < 0.15, `hue: строк ${s.lines}`);
    // полное название — в подсказке
    await page.hover("#ln-qlik");
    await page.waitForSelector("#tip.on");
    assert.match(await page.innerText("#tip h3"), new RegExp(LONG(0)));
    assert.deepEqual(realErrors(errors), []);
  }));

for (const [w, h] of [[1440, 900], [1920, 1080]]) for (const rail of ["open", "compact"]) {
  test(`§12 ${w}×${h}, панель ${rail}: 10 длинных названий — без прокрутки, строки не обрезаны`, () => {
    const ids = ["qlik", "qs", "giga", "nav", "dtk", "varm", "sprint", "esr", "r-sowa", "kap-ift"];
    const src = longSrc(ids);
    return withPanel({ width: w, height: h, links: src }, async ({ page, errors }) => {
      await setRail(page, rail);
      const found = await page.evaluate((ids) => ids.filter((id) => RP.ui.byId[id] && RP.ui.byId[id].title.startsWith("Очень")).length, ids);
      assert.equal(found, ids.length, "все 10 названий подменены");
      const m = await metrics(page);
      assert.ok(m.sh <= m.ih, `scrollHeight ${m.sh} > ${m.ih} (${m.den})`);
      assert.ok(m.sw <= m.iw, `scrollWidth ${m.sw} > ${m.iw}`);
      const r = await page.evaluate(() => {
        const idx = document.querySelector("#idx").getBoundingClientRect();
        const rows = [...document.querySelectorAll("#idx [data-link-id]")].filter((e) => e.offsetParent);
        return {
          cut: rows.filter((e) => e.getBoundingClientRect().bottom > idx.bottom + 1).length,
          over: rows.filter((e) => { const t = e.querySelector(".tt"); return t.getBoundingClientRect().height > parseFloat(getComputedStyle(t).lineHeight) * 2.2; }).length
        };
      });
      assert.equal(r.cut, 0);
      assert.equal(r.over, 0);
      assert.deepEqual(errors, []);
    });
  });
}

// ---------- Доработка 1, правки по ревью ----------
test("§12 поиск «а» на 1440×900: возвращённые строки доступны — указатель прокручивается, страница нет", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await page.fill("#q", "а");
    await page.waitForFunction(() => document.querySelector("#cnt").textContent.includes(" из "));
    const m = await metrics(page);
    assert.ok(m.sh <= m.ih, `scrollHeight ${m.sh} > ${m.ih}`);
    assert.ok(m.sw <= m.iw, `scrollWidth ${m.sw} > ${m.iw}`);
    const r = await page.evaluate(() => {
      const idx = document.querySelector("#idx"), rows = [...idx.querySelectorAll(".ln")].filter((e) => e.offsetParent);
      const box = () => idx.getBoundingClientRect();
      const res = { n: rows.length, over: idx.scrollHeight > idx.clientHeight + 1, oy: getComputedStyle(idx).overflowY, cut: 0 };
      // каждую строку можно прокрутить в видимую область указателя
      rows.forEach((e) => { e.scrollIntoView({ block: "nearest" }); const b = box(), q = e.getBoundingClientRect(); if (q.top < b.top - 1 || q.bottom > b.bottom + 1) res.cut++; });
      return res;
    });
    assert.ok(r.n > 75, `строк ${r.n}`);
    assert.equal(r.oy, "auto");
    assert.equal(r.cut, 0);
    // запрос очищен — указатель снова без прокрутки
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#cnt").textContent.includes(" из "));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#idx")).overflowY), "hidden");
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.deepEqual(realErrors(errors), []);
  }));

test("§12 встреча, скрытая из раздела, находится поиском: «дейли» + Enter открывает daily", () =>
  withPanel(interact(), async ({ page, errors }) => {
    assert.ok(!(await secIds(page, "comms")).includes("daily"));
    await page.fill("#q", "дейли");
    await page.waitForFunction(() => document.querySelector("#cnt").textContent.includes(" из "));
    assert.deepEqual(await secIds(page, "comms"), ["daily"]);
    await page.press("#q", "Enter");
    assert.deepEqual(await opened(page), [URL_OF("daily")]);
    assert.deepEqual(realErrors(errors), []);
  }));

test("§12 короткие названия не переносятся раньше времени: «Герои продаж СБ», «КАП · data-load», «Песочница /21» — в одну строку", () =>
  withPanel({ width: 1440, height: 900 }, async ({ page, errors }) => {
    for (const id of ["h-ift-sb", "kap-ift", "sand21"]) {
      const b = await titleBox(page, `#ln-${id} .tt`);
      assert.ok(Math.abs(b.lines - 1) < 0.15, `${id}: строк ${b.lines}`);
    }
    assert.deepEqual(errors, []);
  }));

test("§12 панель групп: раздел, целиком ушедший в избранное и встречи, приглушён с пояснением", () =>
  withPanel(interact(), async ({ page, errors }) => {
    const li = page.locator('#gpList .gr[data-sec="comms"]');
    assert.equal(await li.evaluate((e) => e.classList.contains("void")), true);
    assert.match(await li.getAttribute("title"), /в избранном и встречах/);
    assert.match(await li.locator(".gr-go").getAttribute("aria-label"), /в избранном и встречах/);
    assert.equal(await page.locator('#gpList .gr[data-sec="heroes"]').getAttribute("title"), null);
    assert.deepEqual(realErrors(errors), []);
  }));

// ---------- Доработка 2: фильтры, избранное по доступности, счётчики ----------
test("фильтры (#13): несколько стендов сразу; все значения → «Все»; снятие последнего → «Все»", () =>
  withPanel(interact(), async ({ page }) => {
    const pressed = (g) => page.$$eval(`#${g} .chip`, (a) => a.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.val));
    await page.click('#fEnv .chip[data-val="PROM"]');
    await page.click('#fEnv .chip[data-val="PSI"]');
    assert.deepEqual(await pressed("fEnv"), ["PROM", "PSI"]);
    const r = await page.evaluate(() => [...document.querySelectorAll("#idx .ln:not([hidden])")].map((e) => RP.ui.byId[e.dataset.linkId]));
    assert.ok(r.every((l) => l.env === "PROM" || l.env === "PSI" || l.tool));
    assert.ok(r.some((l) => l.env === "PROM") && r.some((l) => l.env === "PSI"));
    const want = await page.evaluate(() => RP.ui.data.links.filter((l) => l.tool || l.env === "PROM" || l.env === "PSI").length);
    assert.equal(await page.textContent("#cnt"), want + " из 88");
    // сегмент вместе со стендами
    await page.click('#fSeg .chip[data-val="SIGMA"]');
    const r2 = await page.evaluate(() => [...document.querySelectorAll("#idx .ln:not([hidden])")].map((e) => RP.ui.byId[e.dataset.linkId]));
    assert.ok(r2.every((l) => l.tool || ((l.env === "PROM" || l.env === "PSI") && l.seg === "SIGMA")));
    await page.click('#fSeg .chip[data-val="ALPHA"]');
    assert.deepEqual(await pressed("fSeg"), ["ALPHA", "SIGMA"]);   // без «Без отметки» ещё не «все»
    await page.click('#fSeg .chip[data-val="NONE"]');
    assert.deepEqual(await pressed("fSeg"), [""]);          // отмечены все (с «Без отметки») → «Все»
    await page.click('#fEnv .chip[data-val="IFT"]');
    await page.click('#fEnv .chip[data-val="NONE"]');
    assert.deepEqual(await pressed("fEnv"), [""]);
    await page.click('#fEnv .chip[data-val="IFT"]');
    await page.click('#fEnv .chip[data-val="IFT"]');           // сняли последнюю → «Все»
    assert.deepEqual(await pressed("fEnv"), [""]);
    await page.click('#fEnv .chip[data-val="PSI"]');
    await page.click('#fEnv .chip[data-val=""]');               // «Все» — только «Все»
    assert.deepEqual(await pressed("fEnv"), [""]);
    assert.equal(await page.textContent("#cnt"), "88 ссылок");
  }));

const FAVSET = () => "window.RP_LINKS = " + JSON.stringify({
  version: 1, sections: [{ id: "s", name: "Раздел", icon: "link" }], favorites: ["f1", "f2"], settings: { favAuto: true },
  links: [L("f1", "up1", { fav: true }), L("f2", "down1", { fav: true }), L("a1", "up2"), L("a2", "down2"), L("z", "up3"), L("m", "up4", { meet: true })]
}) + ";\n";
const dockOf = (page) => page.$$eval("#dock [data-link-id]", (a) => a.map((e) => e.dataset.linkId));
const inIdx = (page) => page.$$eval("#idx .ln:not([hidden])", (a) => a.map((e) => e.dataset.linkId));

test("избранное (#19, #20): до проверки — все; затем недоступные уходят в раздел, место — доступной по кликам; «Проверить» возвращает", () => {
  const net = netStub({ gate: true });
  return withPanel({ links: FAVSET(), setup: net.setup, seed: { rp_clicks: JSON.stringify({ a2: 5, a1: 3 }) } }, async ({ page, errors }) => {
    assert.deepEqual(await dockOf(page), ["f1", "f2", "a2", "a1"]);       // проверка идёт — ничего не скрыто
    assert.deepEqual(await inIdx(page), ["z"]);                          // #19: автодобранные тоже не в разделе
    net.release();
    await page.waitForFunction(() => !document.querySelector('#dock [data-link-id="f2"]'));
    assert.deepEqual(await dockOf(page), ["f1", "a1"]);                  // z без кликов не добирается
    assert.deepEqual((await inIdx(page)).sort(), ["a2", "f2", "z"]);
    // хосты снова доступны → после «Проверить» возвращаются
    net.revive.add("down1.test"); net.revive.add("down2.test");
    await page.click("#refresh");
    await page.waitForFunction(() => document.querySelectorAll("#dock [data-link-id]").length === 4);
    assert.deepEqual(await dockOf(page), ["f1", "f2", "a2", "a1"]);
    assert.deepEqual(await inIdx(page), ["z"]);
    assert.deepEqual(realErrors(errors), []);
  });
});

test("избранное (#20): все кандидаты недоступны — уведомление вместо карточек", () => {
  const net = netStub();
  const src = "window.RP_LINKS = " + JSON.stringify({
    version: 1, sections: [{ id: "s", name: "Раздел", icon: "link" }], favorites: ["f1"],
    links: [L("f1", "down1", { fav: true }), L("a1", "down2"), L("z", "up1")]
  }) + ";\n";
  return withPanel({ links: src, setup: net.setup, seed: { rp_clicks: JSON.stringify({ a1: 2 }) } }, async ({ page }) => {
    await page.waitForSelector("#dock .fav-none");
    assert.match(await page.innerText("#dock"), /Ни одна карточка не доступна/);
    assert.equal(await page.isVisible(".favs"), true);
    assert.deepEqual((await inIdx(page)).sort(), ["a1", "f1", "z"]);
  });
});

test("счётчик использований (#21): плитка, строка, встреча, инструмент; без кликов — нет; растёт сразу", () =>
  withPanel({ ...interact(), seed: { rp_clicks: JSON.stringify({ qlik: 3, daily: 4 }) } }, async ({ page }) => {
    const uc = (sel) => page.$eval(sel, (e) => { const u = e.querySelector(".uc"); return u ? u.textContent : null; });
    assert.equal(await uc('#dock [data-link-id="qlik"]'), "3");          // автодобрана в избранное
    assert.equal(await uc('#meets [data-link-id="daily"]'), "4");
    assert.equal(await uc('#dock [data-link-id="h-prom-a"]'), null);
    assert.equal(await page.locator("#idx .ln:not([hidden]) .uc").count(), 0);
    await page.click("#ln-varm");
    assert.equal(await uc("#ln-varm"), "1");
    await page.click("#ln-varm");
    assert.equal(await uc("#ln-varm"), "2");
    await page.click('#dock [data-link-id="qlik"]');
    assert.equal(await uc('#dock [data-link-id="qlik"]'), "4");
    // счётчик не перекрывает название
    const ov = await page.$eval("#ln-varm", (e) => {
      const a = e.querySelector(".tt").getBoundingClientRect(), b = e.querySelector(".uc").getBoundingClientRect();
      return a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top;
    });
    assert.equal(ov, false);
    const tool = await page.$eval("#idx .ln[data-tool]", (e) => e.id);
    await page.click("#" + tool);
    await page.keyboard.press("Escape");
    assert.equal(await uc("#" + tool), "1");
  }));

test("фильтры (#29): «Без отметки» — ссылки без стенда/сегмента; вместе с другими значениями", () =>
  withPanel(interact(), async ({ page }) => {
    await page.click('#fEnv .chip[data-val="NONE"]');
    const r = await page.evaluate(() => [...document.querySelectorAll("#idx .ln:not([hidden])")].map((e) => RP.ui.byId[e.dataset.linkId]));
    assert.ok(r.every((l) => l.tool || !l.env));
    await page.click('#fEnv .chip[data-val="PROM"]');
    const r2 = await page.evaluate(() => [...document.querySelectorAll("#idx .ln:not([hidden])")].map((e) => RP.ui.byId[e.dataset.linkId]));
    assert.ok(r2.every((l) => l.tool || !l.env || l.env === "PROM"));
    assert.ok(r2.length >= r.length);
  }));
