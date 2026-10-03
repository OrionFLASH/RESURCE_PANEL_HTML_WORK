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
