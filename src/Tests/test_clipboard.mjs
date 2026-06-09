#!/usr/bin/env node
/**
 * Тест копирования скриптов с file:// (Playwright + буфер обмена).
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '../../index.html');
const fileUrl = 'file://' + indexPath;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

const initOk = await page.evaluate(() => {
  return {
    hasConfig: typeof CONFIG !== 'undefined',
    embeddedCount: document.querySelectorAll('script.embedded-script[data-script-file]').length,
    storeSize: typeof initEmbeddedScriptsStore === 'function'
      ? Object.keys(initEmbeddedScriptsStore()).length
      : -1,
    sampleLen: typeof getEmbeddedScriptText === 'function'
      ? (getEmbeddedScriptText('UI_AutoTest.js') || '').length
      : -1,
  };
});
console.log('init:', initOk);

await page.waitForSelector('a.ios-card[data-script-file="UI_AutoTest.js"]', { timeout: 60000 });
const card = page.locator('a.ios-card[data-script-file="UI_AutoTest.js"]').first();
await card.click();

await page.waitForTimeout(500);

const clip = await page.evaluate(async () => {
  try {
    return await navigator.clipboard.readText();
  } catch (e) {
    return { error: String(e) };
  }
});

const clipLen = typeof clip === 'string' ? clip.length : 0;
const clipPreview = typeof clip === 'string' ? clip.slice(0, 60) : clip;
console.log('clipboard after click:', { clipLen, clipPreview, pageErrors: errors });

if (typeof clip !== 'string' || clip.length < 100) {
  console.error('FAIL: буфер пуст или слишком короткий');
  process.exitCode = 1;
} else if (!clip.includes('UI_AutoTest') && !clip.includes('function')) {
  console.error('FAIL: содержимое не похоже на скрипт');
  process.exitCode = 1;
} else {
  console.log('OK: скрипт в буфере,', clip.length, 'символов');
}

await browser.close();
