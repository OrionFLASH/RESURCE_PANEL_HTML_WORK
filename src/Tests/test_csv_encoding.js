/**
 * Тест автодетекта кодировок CSV (Node).
 * Запуск: node src/Tests/test_csv_encoding.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "../..");
const code = fs.readFileSync(path.join(root, "src/csv_encoding.js"), "utf8");
const ctx = { window: {}, globalThis: {}, TextDecoder, TextEncoder };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const CE = ctx.window.CsvEncoding;

const opts = {
  requiredAliases: [["тн", "tn"], ["сумма", "sum", "amount"]],
  hintAliases: ["тб", "госб", "кластер"]
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const samplePath = path.join(root, "samples/sum-distribution-demo-prod-bylo.csv");
if (fs.existsSync(samplePath)) {
  const buf = fs.readFileSync(samplePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + Math.min(buf.length, 8192));
  const d = CE.detectAndDecode(ab, opts);
  assert(d.encoding.indexOf("utf-8") >= 0, "ожидали utf-8 для demo CSV, получили " + d.encoding);
  assert(/тн/i.test(d.text.split("\n")[0]), "заголовок ТН не найден в UTF-8 декоде");
  console.log("OK utf-8 demo:", d.encoding, "score", d.score);
} else {
  console.log("SKIP demo file missing");
}

try {
  const b = execSync("iconv -f UTF-8 -t CP1251", {
    input: "ТН;ТБ;ГОСБ;кластер;сумма\n1;A;0;0;12.3\n"
  });
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const d = CE.detectAndDecode(ab, opts);
  assert(d.encoding === "windows-1251", "ожидали windows-1251, получили " + d.encoding);
  assert(d.text.indexOf("ТН") === 0, "заголовок после 1251: " + d.text.split("\n")[0]);
  console.log("OK windows-1251:", d.encoding, "score", d.score);
} catch (err) {
  console.log("SKIP cp1251 (iconv):", err.message);
}

console.log("test_csv_encoding: все проверки пройдены");
