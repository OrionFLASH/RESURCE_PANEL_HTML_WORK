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
