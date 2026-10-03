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

test("открытие без ошибок консоли; 86 ссылок + 2 инструмента отрисованы", () =>
  withPanel({ width: 1440, height: 900 }, async ({ page, errors }) => {
    const r = await page.evaluate(() => {
      const ids = new Set([...document.querySelectorAll("[data-link-id]")].map((e) => e.dataset.linkId));
      const wait = new Set([...document.querySelectorAll('[data-link-id][data-st="wait"]')].map((e) => e.dataset.linkId));
      return {
        ids: ids.size, wait: wait.size,
        tools: document.querySelectorAll("#idx [data-link-id][data-tool]").length,
        rows: document.querySelectorAll("#idx [data-link-id]").length,
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
    assert.equal(r.rows, 84);
    assert.equal(r.meets, 4);
    assert.equal(r.favs, 9);
    assert.equal(r.sections, 11);
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
    assert.equal(await page.locator("#idx [data-link-id]").count(), 84);
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
  const st = { hits: [], active: 0, max: 0, release: null, gate: null };
  st.gate = gate ? new Promise((r) => { st.release = r; }) : Promise.resolve();
  st.setup = async ({ page }) => {
    await page.route((u) => /^https?:/.test(u.href), async (route) => {
      const host = new URL(route.request().url()).hostname;
      st.hits.push(host); st.active++; st.max = Math.max(st.max, st.active);
      try {
        if (st.hangAll || host.startsWith("hang")) return;       // никогда не отвечает
        await st.gate;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (host.startsWith("down")) await route.abort("connectionrefused");
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
        icUp: q("u1", "svg").color, icDown: q("d1", "svg").color,
        dotDown: q("d1", ".dot").backgroundColor, dotUp: q("u1", ".dot").backgroundColor
      };
    });
    assert.equal(r.nums.find((x) => x.t === "Доступны").n, r.upN);
    assert.equal(r.nums.find((x) => x.t === "Недоступны").n, r.downN);
    assert.equal(r.upN, 3); assert.equal(r.downN, 3);
    assert.ok(!r.nums.some((x) => x.t === "Проверяются"));
    assert.notEqual(r.ttDown, r.ttUp);          // название погашено
    assert.equal(r.tagDown, r.tagUp);           // тег стенда в цвете
    assert.equal(r.icDown, r.icUp);             // иконка в цвете
    assert.notEqual(r.dotDown, r.dotUp);        // красная точка
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
    const r = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#dock [data-link-id], #meets [data-link-id]")].map((e) => [e.dataset.linkId, e.dataset.st])));
    assert.deepEqual(r, { f1: "up", f2: "down", m1: "up", m2: "down" });
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
      const rows = [...document.querySelectorAll("#idx .ln")];
      const idx = document.querySelector("#idx");
      const ov = getComputedStyle(idx).overflowY;
      window.scrollTo(0, document.documentElement.scrollHeight);
      const last = rows.map((e) => e.getBoundingClientRect().bottom + window.scrollY).reduce((a, b) => Math.max(a, b), 0);
      return { ov, idxClip: idx.scrollHeight - idx.clientHeight, small: rows.filter((e) => e.getBoundingClientRect().height < 20).length, last, doc: document.documentElement.scrollHeight, n: rows.length };
    });
    assert.equal(r.n, 84 + 30);
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
    await page.click("#ln-h-psi-a");
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
    await page.hover("#ln-h-psi-a");
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
    await page.waitForFunction(() => document.querySelectorAll("#idx .ln[hidden]").length === 0);
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
    assert.equal(await page.locator("#idx .ln[hidden]").count(), 0);
    assert.equal(await page.getAttribute('#fEnv .chip[data-val=""]', "aria-pressed"), "true");
  }));

test("избранное: пустой rp_clicks → 9 из favoriteSeed; 3 клика по qlik → после перезагрузки первый", () =>
  withPanel(interact(), async ({ page }) => {
    const dock = () => page.$$eval("#dock [data-link-id]", (a) => a.map((e) => e.dataset.linkId));
    const seed = ["h-prom-a", "h-prom-s", "h-psi-a", "kap-prom", "kap-psi", "sand", "chat", "jazz", "mail"];
    assert.deepEqual(await dock(), seed);
    for (let i = 0; i < 3; i++) await page.click("#ln-qlik");
    assert.deepEqual(await dock(), seed);              // без перескоков до следующего открытия
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === "1");
    const d = await dock();
    assert.equal(d[0], "qlik");
    assert.equal(d.length, 9);
  }));

test("встречи: полоса из 4 чипов, в разделе «Коммуникации» их нет; клик открывает встречу", () =>
  withPanel(interact(), async ({ page }) => {
    const r = await page.evaluate(() => ({
      meets: [...document.querySelectorAll("#meets [data-link-id]")].map((e) => e.dataset.linkId),
      comms: [...document.querySelectorAll('#idx [data-section-id="comms"] [data-link-id]')].map((e) => e.dataset.linkId)
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
    assert.equal(await page.locator("#idx .ln:not([hidden])").count(), 84);
    assert.equal(await page.inputValue("#q"), "");
    assert.equal(await page.getAttribute('#fSeg .chip[data-val=""]', "aria-pressed"), "true");
    assert.equal(await page.getAttribute('#fSeg .chip[data-val="SIGMA"]', "aria-pressed"), "false");
    assert.equal(await page.evaluate(() => document.activeElement.id), "q");
    assert.equal(await page.textContent("#cnt"), "88 ссылок");
    assert.deepEqual(realErrors(errors), []);
  }));

// ---------- Панель групп: состояния, поиск групп, «глаз», Alt+клик, шторка ----------
const SEC_IDS = ["comms", "heroes", "kap", "sup", "access", "itsm", "data", "docs", "jira", "repo", "tools"];
const idxSecs = (page) => page.$$eval("#idx [data-section-id]", (a) => a.map((e) => e.dataset.sectionId));

test("панель групп: кнопка циклит open → compact → hidden, rp_rail переживает перезагрузку", () =>
  withPanel(interact(), async ({ page, errors }) => {
    const mode = () => page.evaluate(() => {
      const gp = document.querySelector("#gp");
      return { m: ["open", "compact", "hidden"].find((m) => gp.classList.contains("m-" + m)), w: Math.round(gp.getBoundingClientRect().width), rail: RP.store.get("rp_rail", null) };
    });
    assert.deepEqual(await mode(), { m: "open", w: 248, rail: null });
    await page.click("#gpBtn");
    assert.deepEqual(await mode(), { m: "compact", w: 60, rail: "compact" });
    assert.match(await page.getAttribute("#gpBtn", "aria-label"), /узкая.*скрытой/);
    // узкая: раскрытие поверх по задержке наведения
    await page.hover('#gpList .gr[data-sec="data"] .gr-go');
    await page.waitForFunction(() => document.querySelector("#gp").classList.contains("peek"), null, { timeout: 2000 });
    await page.mouse.move(900, 500);
    await page.click("#gpBtn");
    assert.deepEqual(await mode(), { m: "hidden", w: 0, rail: "hidden" });
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === "1");
    assert.deepEqual(await mode(), { m: "hidden", w: 0, rail: "hidden" });
    await page.click("#gpBtn");
    assert.deepEqual(await mode(), { m: "open", w: 248, rail: "open" });
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
    assert.equal(await page.isHidden("#gpAll"), true);
    await page.hover('#gpList .gr[data-sec="data"]');
    await page.click('#gpList .gr[data-sec="data"] .gr-eye');
    assert.equal((await idxSecs(page)).includes("data"), false);
    assert.equal((await idxSecs(page)).length, 10);
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
    assert.equal((await idxSecs(page)).length, 11);
    assert.deepEqual(await page.evaluate(() => RP.store.get("rp_groups")), []);
    assert.equal(await page.isHidden("#gpAll"), true);
    assert.deepEqual(realErrors(errors), []);
  }));

test("панель групп: Alt+клик оставляет одну группу, повторный Alt+клик возвращает все", () =>
  withPanel(interact(), async ({ page, errors }) => {
    await page.click('#gpList .gr[data-sec="heroes"] .gr-go', { modifiers: ["Alt"] });
    assert.deepEqual(await idxSecs(page), ["heroes"]);
    assert.equal((await page.evaluate(() => RP.store.get("rp_groups"))).length, 10);
    assert.match(await page.innerText("#gpAll"), /скрыто 10/);
    await page.click('#gpList .gr[data-sec="heroes"] .gr-go', { modifiers: ["Alt"] });
    assert.equal((await idxSecs(page)).length, 11);
    assert.deepEqual(realErrors(errors), []);
  }));

test("все группы скрыты: короткое сообщение и «Показать все группы»", () =>
  withPanel({ ...interact(), seed: { rp_groups: JSON.stringify(SEC_IDS) } }, async ({ page, errors }) => {
    const t = await page.innerText("#idx .empty");
    assert.match(t, /Все группы скрыты/);
    assert.match(await page.innerText("#gpAll"), /скрыто 11/);
    await page.click("#idx .empty #reset");
    assert.equal((await idxSecs(page)).length, 11);
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
    assert.equal((await idxSecs(page)).length, 10);
    assert.deepEqual(realErrors(errors), []);
  }));
