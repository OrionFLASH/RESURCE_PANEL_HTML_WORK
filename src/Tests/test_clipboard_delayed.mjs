#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '../../index.html');
const fileUrl = 'file://' + indexPath;

async function runCase(name, options) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(options.context || {});
  const page = await context.newPage();
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('a.ios-card[data-script-file="AddressBook_export_OE.js"]', { timeout: 60000 });
  if (options.delayMs) {
    await page.evaluate((ms) => {
      window.__TEST_COPY_DELAY = ms;
      var orig = tryLoadScriptUrls;
      tryLoadScriptUrls = function (urls, index) {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            orig(urls, index).then(resolve).catch(reject);
          }, window.__TEST_COPY_DELAY);
        });
      };
    }, options.delayMs);
  }
  await page.locator('a.ios-card[data-script-file="AddressBook_export_OE.js"]').first().click();
  await page.waitForTimeout(800);
  let clip = '';
  try {
    clip = await page.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch (e) { return ''; }
    });
  } catch (e) { clip = ''; }
  const ok = clip.length > 1000 && clip.includes('AddressBook');
  console.log(name + ':', ok ? 'OK' : 'FAIL', 'len=', clip.length);
  await browser.close();
  return ok;
}

const r1 = await runCase('file:// без прав clipboard', { context: {} });
const r2 = await runCase('file:// + задержка fetch 2s', { context: {}, delayMs: 2000 });
if (!r1 || !r2) process.exitCode = 1;
