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

test("parseUrl: хост, порт, путь, параметры с кириллицей", () => {
  const u = core.parseUrl("https://x.ru:3001/a/b?k=1&q=%D0%BF");
  assert.equal(u.host, "x.ru");
  assert.equal(u.port, "3001");
  assert.equal(u.path, "/a/b");
  assert.deepEqual(JSON.parse(JSON.stringify(u.params)), [["k", "1"], ["q", "п"]]);
});

test("parseUrl: некорректный адрес", () => {
  const u = core.parseUrl("не адрес");
  assert.equal(u.host, "");
  assert.equal(u.path, "не адрес");
  assert.equal(u.params.length, 0);
});

test("match: «пси alpha» находит h-psi-a, не находит h-prom-s", () => {
  const d = loadLinks();
  const sec = (l) => d.sections.find((s) => s.id === l.section).name;
  const a = d.links.find((l) => l.id === "h-psi-a");
  const b = d.links.find((l) => l.id === "h-prom-s");
  assert.equal(core.match(a, sec(a), "пси alpha").hit, true);
  assert.equal(core.match(b, sec(b), "пси alpha").hit, false);
  assert.equal(core.match(a, sec(a), "ПСИ Альфа").hit, true);
  assert.equal(core.match(a, sec(a), "ift").hit, false);
});

test("match: ranges для подсветки в title, раздел, хост, пустой запрос", () => {
  const d = loadLinks();
  const l = d.links.find((x) => x.id === "kap-prom");
  const r = core.match(l, "Раздел", "ка");
  assert.equal(r.hit, true);
  assert.deepEqual(JSON.parse(JSON.stringify(r.ranges)), [[0, 2]]);
  assert.equal(core.match(l, "Раздел", "раздел").hit, true);
  assert.equal(core.match(l, "Раздел", "omega").hit, true);
  const e = core.match(l, "Раздел", "  ");
  assert.equal(e.hit, true);
  assert.equal(e.ranges.length, 0);
  assert.equal(core.match(d.links.find((x) => x.tool), "Раздел", "zzzz").hit, false);
});

test("rankFavorites", () => {
  const d = loadLinks();
  // seed без встреч/инструментов (daily — встреча), первые 9
  const byId = Object.fromEntries(d.links.map((l) => [l.id, l]));
  const seed = d.favoriteSeed.filter((id) => !byId[id].meet && !byId[id].tool).slice(0, 9);
  assert.deepEqual(Array.from(core.rankFavorites(d.links, {}, d.favoriteSeed)), seed);
  const r = Array.from(core.rankFavorites(d.links, { "kap-prom": 5, chat: 2 }, d.favoriteSeed));
  assert.deepEqual(r.slice(0, 2), ["kap-prom", "chat"]);
  assert.equal(r.length, 9);
  const tool = d.links.find((l) => l.tool).id;
  const m = Array.from(core.rankFavorites(d.links, { [tool]: 99 }, d.favoriteSeed));
  assert.ok(!m.includes(tool));
});

test("decodePermission", () => {
  assert.deepEqual(Array.from(core.decodePermission("5").bits), [0, 2]);
  assert.deepEqual(Array.from(core.decodePermission("1,0").bits), [0]);
  assert.deepEqual(Array.from(core.decodePermission("0,1").bits), [32]);
  const b = core.decodePermission("5").binary;
  assert.equal(b.split(" ").length, 4);
  assert.ok(b.split(" ").every((g) => g.length === 8));
  assert.throws(() => core.decodePermission("zz"), /Некорректный ввод/);
  assert.throws(() => core.decodePermission("1,,2"), /Некорректный ввод/);
  assert.throws(() => core.decodePermission(""), /Некорректный ввод/);
});

test("balanceColumns", () => {
  const sizes = [7, 9, 5, 9, 10, 8, 12, 11, 8, 7, 2];
  const cols = core.balanceColumns(sizes, 4).map((c) => Array.from(c));
  assert.equal(cols.length, 4);
  assert.deepEqual(Array.from(cols.flat()), sizes.map((_, i) => i));
  const max = Math.max(...cols.map((c) => c.reduce((s, i) => s + sizes[i], 0)));
  assert.equal(max, 27);
});
