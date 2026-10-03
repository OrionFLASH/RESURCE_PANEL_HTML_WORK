// Открытие панели в системном Chrome по file:// из временной копии папки (Ruling R1).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "..");
const { chromium } = require(path.join(repo, "node_modules/playwright"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FILES = ["index.html", "panel.css", "panel.js", "links.js"];

// Копия панели во временный каталог; links: строка — подменить links.js, false — удалить его.
export function makeCopy({ links, files } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-v8-"));
  FILES.forEach((f) => fs.copyFileSync(path.join(root, f), path.join(dir, f)));
  if (fs.existsSync(path.join(root, "admin"))) fs.cpSync(path.join(root, "admin"), path.join(dir, "admin"), { recursive: true });
  if (typeof links === "string") fs.writeFileSync(path.join(dir, "links.js"), links);
  if (links === false) fs.rmSync(path.join(dir, "links.js"));
  Object.entries(files || {}).forEach(([rel, text]) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  });
  return dir;
}

/**
 * openPanel({ width, height, theme?, storage?: "ok"|"throw", seed?: {key: rawString}, links?: string|false, files?, context?, setup?({context,page}) — до перехода на страницу (page.route) })
 *   -> { page, browser, context, errors, dir, close() }
 * errors — ошибки консоли и необработанные исключения страницы.
 */
export async function openPanel(opts = {}) {
  const { width = 1440, height = 900, theme, storage = "ok" } = opts;
  const dir = makeCopy(opts);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  // Любая ошибка после запуска: закрыть браузер и убрать временный каталог, затем пробросить дальше (R6)
  const cleanup = async () => { try { await browser.close(); } catch (e) {} fs.rmSync(dir, { recursive: true, force: true }); };
  try {
    const context = await browser.newContext({ viewport: { width, height }, ...(opts.context || {}) });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
    if (storage === "throw") {
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("localStorage denied"); } });
      });
    } else {
      // Новый контекст — пустое хранилище; начальные значения кладём один раз (перезагрузка их не затирает)
      const seed = Object.assign({}, opts.seed || {}, theme ? { rp_theme: theme } : {});
      await page.addInitScript((s) => {
        try {
          if (sessionStorage.getItem("__rp_seeded")) return;
          sessionStorage.setItem("__rp_seeded", "1");
          Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
        } catch (e) {}
      }, seed);
    }
    if (opts.setup) await opts.setup({ context, page });
    await page.goto(pathToFileURL(path.join(dir, "index.html")).href);
    await page.waitForFunction(() => document.body && (document.body.dataset.ready === "1" || !!document.querySelector("#rp-error:not([hidden])")));
    const close = cleanup;
    return { page, browser, context, errors, dir, close };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

// Размеры документа и окна
export function metrics(page) {
  return page.evaluate(() => ({
    sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth,
    ih: window.innerHeight, iw: window.innerWidth, den: document.body.dataset.den || ""
  }));
}

export const linksPath = path.join(root, "links.js");
