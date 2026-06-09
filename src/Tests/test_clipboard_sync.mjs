#!/usr/bin/env node
/**
 * Тест копирования скриптов с file:// без async-задержки.
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '../../index.html');
const fileUrl = 'file://' + indexPath;

async function runCase(name, scriptFile) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('a.ios-card[data-script-file="' + scriptFile + '"]', { timeout: 60000 });
  const result = await page.evaluate(async (file) => {
    var card = document.querySelector('a.ios-card[data-script-file="' + file + '"]');
    if (!card) return { error: 'no card' };
    var payload = loadScriptTextSyncForCopy(file);
    if (!payload || !payload.text) return { error: 'no payload', payload: payload };
    var ok = copyToClipboardSync(payload.text);
    return {
      ok: ok,
      source: payload.source,
      len: payload.text.length,
      head: payload.text.slice(0, 40)
    };
  }, scriptFile);
  console.log(name + ':', result);
  await browser.close();
  return result.ok && result.len > 100;
}

const a = await runCase('UI_AutoTest', 'UI_AutoTest.js');
const b = await runCase('AddressBook', 'AddressBook_export_OE.js');
if (!a || !b) process.exitCode = 1;
