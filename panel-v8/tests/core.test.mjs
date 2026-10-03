import test from "node:test";
import assert from "node:assert/strict";
import { loadCore, loadLinks } from "./helpers.mjs";

const core = loadCore();
const clone = (o) => JSON.parse(JSON.stringify(o));

test("валидация реальных данных", () => {
  const data = loadLinks();
  const r = core.validate(data);
  assert.equal(r.ok, true, r.errors.join("\n"));
  assert.equal(r.errors.length, 0);
  assert.equal(data.links.filter((l) => l.url).length, 86);
  assert.equal(data.links.filter((l) => l.tool).length, 2);
  assert.equal(data.sections.length, 11);
  assert.equal(data.version, 1);
  assert.deepEqual(data.adminScripts, []);
});

test("дубль id", () => {
  const d = clone(loadLinks());
  d.links.push({ ...d.links[0] });
  const r = core.validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes(d.links[0].id)));
});

test("неизвестный раздел", () => {
  const d = clone(loadLinks());
  d.links[0].section = "nope";
  const r = core.validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("nope")));
});

test("нет url и tool", () => {
  const d = clone(loadLinks());
  delete d.links[0].url;
  delete d.links[0].tool;
  assert.equal(core.validate(d).ok, false);
});

test("url не http/https", () => {
  const d = clone(loadLinks());
  d.links[0].url = "ftp://x";
  assert.equal(core.validate(d).ok, false);
});

test("недопустимые env и seg", () => {
  const d = clone(loadLinks());
  d.links[0].env = "DEV";
  assert.equal(core.validate(d).ok, false);
  const d2 = clone(loadLinks());
  d2.links[0].seg = "BETA";
  assert.equal(core.validate(d2).ok, false);
});

test("favoriteSeed с несуществующим id — предупреждение", () => {
  const d = clone(loadLinks());
  d.favoriteSeed.push("ghost");
  const r = core.validate(d);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("ghost")));
});

test("serializeLinks: круговой обмен", () => {
  const d = loadLinks();
  const text = core.serializeLinks(d);
  assert.ok(text.startsWith("/*"));
  assert.ok(text.includes("window.RP_LINKS = "));
  assert.deepEqual(loadLinks(text), d);
});

test("serializeLinks: обратный слэш и кириллица", () => {
  const d = clone(loadLinks());
  d.links[0].copy = "omega\\01803187";
  const text = core.serializeLinks(d);
  assert.equal(loadLinks(text).links[0].copy, "omega\\01803187");
  assert.ok(!/\\u04/i.test(text));
  assert.ok(text.includes("Коммуникации"));
});

test("serializeLinks: одна ссылка на строку", () => {
  const d = loadLinks();
  const lines = core.serializeLinks(d).split("\n").filter((l) => /^\s*\{"id":.*"section":/.test(l));
  assert.equal(lines.length, d.links.length);
});
