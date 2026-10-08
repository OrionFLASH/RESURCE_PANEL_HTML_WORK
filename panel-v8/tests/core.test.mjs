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

test("favoriteSeed с несуществующим id — предупреждение (старый формат)", () => {
  const d = clone(loadLinks());
  d.favoriteSeed = ["h-prom-a", "ghost"];
  const r = core.validate(d);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("ghost")));
});

test("favoriteSeed не массив — ошибка", () => {
  const d = clone(loadLinks());
  d.favoriteSeed = "h-prom-a";
  const r = core.validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("favoriteSeed")));
});

test("serializeLinks: круговой обмен", () => {
  const d = clone(core.normalize(loadLinks()));
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

test("validate: id разделов и ссылок — только латиница, цифры, - и _", () => {
  const d = clone(loadLinks());
  d.sections.push({ id: 'x"><img src=x>', name: "Плохой", icon: "link" });
  d.links.push({ id: "a b", section: "repo", title: "Т", url: "https://x.test/" });
  const r = core.validate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('x"><img src=x>') && /латиница/.test(e)), r.errors.join("\n"));
  assert.ok(r.errors.some((e) => e.includes("a b") && /латиница/.test(e)), r.errors.join("\n"));
  assert.ok(loadLinks().links.every((l) => /^[a-z0-9_-]+$/i.test(l.id)));
});

test("slug: транслитерация, уникальность, допустимые символы", () => {
  assert.equal(core.slug("КАП боевой", []), "kap-boevoy");
  assert.equal(core.slug("Герои продаж · ПСИ", []), "geroi-prodazh-psi");
  assert.equal(core.slug("kap-prom", ["kap-prom"]), "kap-prom-2");
  assert.equal(core.slug("kap-prom", ["kap-prom", "kap-prom-2"]), "kap-prom-3");
  assert.equal(core.slug("!!!", []), "link");
  assert.equal(core.slug("", ["link"]), "link-2");
  const long = core.slug("Очень длинное название ссылки, которое не должно превращаться в бесконечный идентификатор", []);
  assert.ok(long.length <= 40 && /^[a-z0-9_-]+$/.test(long) && !/-$/.test(long), long);
});

test("fieldErrors: сообщения по полям формы ссылки", () => {
  const d = loadLinks();
  const ok = { id: "n1", section: "repo", title: "Новая", url: "https://x.test/a" };
  assert.deepEqual({ ...core.fieldErrors(ok, d) }, {});
  const e = core.fieldErrors({ id: "n1", section: "nope", title: " ", url: "ftp://x" }, d);
  assert.match(e.title, /название/i);
  assert.match(e.url, /http/);
  assert.match(e.section, /раздел/i);
  assert.match(core.fieldErrors({ ...ok, url: "" }, d).url, /адрес/i);
  assert.match(core.fieldErrors({ ...ok, url: "https://" }, d).url, /хост|адрес/i);
  assert.match(core.fieldErrors({ ...ok, url: "https://a b.ru" }, d).url, /пробел/i);
  assert.equal(core.fieldErrors({ id: "t", section: "tools", title: "Инструмент", tool: "decoder" }, d).url, undefined);
});

// ---------- Доработка 1 (§12): избранное и встречи из админки ----------
const OLD = () => ({
  version: 1,
  sections: [{ id: "s", name: "Раздел", icon: "link" }],
  favoriteSeed: ["h-prom-a", "daily"],
  links: [
    { id: "h-prom-a", section: "s", title: "Герои", url: "https://a.test/" },
    { id: "daily", section: "s", title: "Дейли", url: "https://j.test/", meet: true },
    { id: "x", section: "s", title: "X", url: "https://x.test/" }
  ],
  adminScripts: []
});

test("реальные данные: новый формат — favorites, fav у закреплённых, settings.favAuto, без favoriteSeed", () => {
  const d = loadLinks();
  assert.ok(Array.isArray(d.favorites) && d.favorites.length > 0);
  assert.equal(d.favoriteSeed, undefined);
  assert.deepEqual(d.settings, { favAuto: true });
  const byId = Object.fromEntries(d.links.map((l) => [l.id, l]));
  d.favorites.forEach((id) => { assert.equal(byId[id].fav, true, id); assert.ok(!byId[id].meet, id); });
  assert.equal(d.links.filter((l) => l.fav).length, d.favorites.length);
  assert.equal(d.links.filter((l) => l.meet).length, 4);
});

test("normalize: старый favoriteSeed → favorites + fav:true, встречи исключены, settings по умолчанию", () => {
  const src = OLD();
  const n = core.normalize(src);
  assert.deepEqual(Array.from(n.favorites), ["h-prom-a"]);
  assert.equal(n.favoriteSeed, undefined);
  const byId = Object.fromEntries(n.links.map((l) => [l.id, l]));
  assert.equal(byId["h-prom-a"].fav, true);
  assert.equal(byId.daily.fav, undefined);
  assert.equal(byId.daily.meet, true);
  assert.equal(byId.x.fav, undefined);
  assert.equal(n.settings.favAuto, true);
  assert.deepEqual(src.favoriteSeed, ["h-prom-a", "daily"], "исходный объект не меняется");
  assert.equal(core.validate(n).ok, true, core.validate(n).errors.join("\n"));
});

test("normalize: идемпотентна; favorites и fav согласуются; favAuto:false сохраняется", () => {
  const n1 = core.normalize(OLD());
  assert.deepEqual(clone(core.normalize(n1)), clone(n1));
  const d = clone(n1);
  d.links[2].fav = true;                 // fav без записи в favorites — дописывается в конец
  d.settings = { favAuto: false };
  const n2 = core.normalize(d);
  assert.deepEqual(Array.from(n2.favorites), ["h-prom-a", "x"]);
  assert.equal(n2.settings.favAuto, false);
  const d3 = clone(n1);
  d3.favorites = ["x", "h-prom-a"];     // id в favorites без fav — получает fav:true
  delete d3.links[0].fav;
  const n3 = core.normalize(d3);
  assert.deepEqual(Array.from(n3.favorites), ["x", "h-prom-a"]);
  assert.equal(n3.links[0].fav, true);
  assert.equal(n3.links[2].fav, true);
  const real = loadLinks();
  assert.deepEqual(clone(core.normalize(real)), real);
});

test("validate: favorites не массив, нестроковые флаги fav/favHide/meetHide/favAuto — ошибки; неизвестный id — предупреждение", () => {
  const base = core.normalize(OLD());
  const bad = (mut, key) => {
    const d = clone(base); mut(d);
    const r = core.validate(d);
    assert.equal(r.ok, false, key);
    assert.ok(r.errors.some((e) => e.includes(key)), key + ": " + r.errors.join("; "));
  };
  bad((d) => { d.favorites = "h-prom-a"; }, "favorites");
  bad((d) => { d.links[0].fav = "yes"; }, "fav");
  bad((d) => { d.links[0].favHide = 0; }, "favHide");
  bad((d) => { d.links[1].meetHide = "no"; }, "meetHide");
  bad((d) => { d.settings.favAuto = "true"; }, "favAuto");
  bad((d) => { d.settings = []; }, "settings");
  const d = clone(base); d.favorites.push("ghost");
  const r = core.validate(d);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("ghost")));
  const ok = clone(base); ok.links[0].favHide = false; ok.links[1].meetHide = false; ok.settings.favAuto = false;
  assert.equal(core.validate(ok).ok, true);
});

const PL = () => [
  { id: "a", fav: true }, { id: "b" }, { id: "c", fav: true }, { id: "d" }, { id: "m", meet: true },
  { id: "t", tool: "decoder" }, { id: "e", fav: true }, { id: "f" }
];
const pick = (...a) => clone(core.pickFavorites(...a));

test("pickFavorites: закреплённые по порядку favorites, затем fav вне списка; переполнение", () => {
  const r = pick(PL(), ["c", "a"], {}, 6, true);
  assert.deepEqual(r.shown, ["c", "a", "e"]);
  assert.deepEqual(r.pinnedShown, ["c", "a", "e"]);
  assert.deepEqual(r.overflow, []);
  const o = pick(PL(), ["c", "a", "e"], {}, 2, true);
  assert.deepEqual(o.shown, ["c", "a"]);
  assert.deepEqual(o.pinnedShown, ["c", "a"]);
  assert.deepEqual(o.overflow, ["e"]);
});

test("pickFavorites: показанные идут по убыванию числа открытий, закреплённые и добранные вместе", () => {
  const r = pick(PL(), ["c", "a"], { a: 2, e: 7, d: 4 }, 6, true);
  assert.deepEqual(r.shown.slice(0, 3), ["e", "d", "a"]);
  assert.deepEqual(r.pinnedShown, ["c", "a", "e"]);   // состав закреплённых не меняется
});

test("pickFavorites: автодобор по кликам (без встреч, инструментов, уже показанных); favAuto=false — без добора", () => {
  const clicks = { m: 50, t: 40, a: 30, f: 5, b: 5, d: 9 };
  const r = pick(PL(), ["a"], clicks, 6, true);
  assert.deepEqual(r.shown, ["a", "d", "b", "f", "c", "e"]);   // по числу открытий; равные — прежний порядок
  assert.deepEqual(r.pinnedShown, ["a", "c", "e"]);
  const s = pick(PL(), ["a"], clicks, 4, true);
  assert.deepEqual(s.shown, ["a", "d", "c", "e"]);
  const n = pick(PL(), ["a"], clicks, 6, false);
  assert.deepEqual(n.shown, ["a", "c", "e"]);
  // нет кликов и нет закреплённых — пусто
  const z = pick([{ id: "x" }, { id: "y" }], [], {}, 6, true);
  assert.deepEqual(z.shown, []);
  // встреча с fav не попадает в избранное
  const mf = pick([{ id: "m", meet: true, fav: true }, { id: "x", fav: true }], ["m", "x"], {}, 6, true);
  assert.deepEqual(mf.shown, ["x"]);
});

test("hiddenInIndex: показанные закреплённые (кроме favHide:false) и встречи (кроме meetHide:false)", () => {
  const data = { links: [
    { id: "a", fav: true }, { id: "b", fav: true, favHide: false }, { id: "c", fav: true },
    { id: "m1", meet: true }, { id: "m2", meet: true, meetHide: false }, { id: "x" }
  ] };
  const h = core.hiddenInIndex(data, ["a", "b"]);
  assert.deepEqual([...h].sort(), ["a", "m1"]);
});

test("serializeLinks: новый формат — favorites и settings, без favoriteSeed; круговой обмен для старого входа", () => {
  const text = core.serializeLinks(OLD());
  assert.ok(text.includes('"favorites": ["h-prom-a"]'));
  assert.ok(text.includes('"settings": {"favAuto":true}'));
  assert.ok(!text.includes('"favoriteSeed"'));
  assert.ok(/"id":"h-prom-a"[^\n]*"fav":true/.test(text));
  const back = loadLinks(text);
  assert.deepEqual(back, clone(core.normalize(OLD())));
  assert.equal(core.serializeLinks(back), text);
  const d = core.normalize(OLD()); d.links[0].favHide = false; d.links[1].meetHide = false; d.settings.favAuto = false;
  assert.deepEqual(loadLinks(core.serializeLinks(d)), clone(d));
});

// ---------- Доработка 2 ----------
test("toggleFilter (#13): «Все» или несколько значений; все значения → «Все»; снятие последнего → «Все»", () => {
  const ALL = ["PROM", "PSI", "IFT"], t = (sel, v) => clone(core.toggleFilter(sel, v, ALL));
  assert.deepEqual(t([], "PSI"), ["PSI"]);                  // «Все» снимается, значение отмечено
  assert.deepEqual(t(["PSI"], "PROM"), ["PROM", "PSI"]);    // несколько, порядок — как у чипов
  assert.deepEqual(t(["PROM", "PSI"], "IFT"), []);          // отмечены все → «Все»
  assert.deepEqual(t(["PSI"], "PSI"), []);                   // снята последняя → «Все»
  assert.deepEqual(t(["PROM", "PSI"], "PSI"), ["PROM"]);
  assert.deepEqual(t(["PROM", "PSI"], ""), []);              // «Все» — только «Все»
  assert.deepEqual(clone(core.toggleFilter([], "SIGMA", ["ALPHA", "SIGMA"])), ["SIGMA"]);
  assert.deepEqual(clone(core.toggleFilter(["SIGMA"], "ALPHA", ["ALPHA", "SIGMA"])), []);
});

test("passFilter (#13): множества стендов и сегментов; инструменты проходят всегда", () => {
  const l = (env, seg, tool) => ({ env, seg, tool });
  assert.equal(core.passFilter(l("PROM", "ALPHA"), [], []), true);
  assert.equal(core.passFilter(l("PROM", "ALPHA"), ["PSI", "PROM"], []), true);
  assert.equal(core.passFilter(l("IFT", "ALPHA"), ["PSI", "PROM"], []), false);
  assert.equal(core.passFilter(l("PROM", "SIGMA"), ["PROM"], ["ALPHA"]), false);
  assert.equal(core.passFilter(l(undefined, undefined), ["PROM"], []), false);
  assert.equal(core.passFilter(l(undefined, undefined, "decoder"), ["PROM"], ["ALPHA"]), true);
  // «Без отметки» (NONE): у ссылки значение не указано
  assert.equal(core.passFilter(l(undefined, "ALPHA"), ["NONE"], []), true);
  assert.equal(core.passFilter(l("PROM", "ALPHA"), ["NONE"], []), false);
  assert.equal(core.passFilter(l("PROM", undefined), ["NONE", "PROM"], ["NONE"]), true);
  assert.deepEqual(clone(core.toggleFilter(["PROM", "PSI", "IFT"], "NONE", ["PROM", "PSI", "IFT", "NONE"])), []);
});

test("pickFavorites (#20): недоступные (down) не попадают; место — следующей закреплённой, затем по кликам > 0; wait/local/skip доступны", () => {
  const clicks = { b: 5, d: 9, f: 1 };
  // c недоступна → e, затем автодобор d, b (f с 1 кликом — последним)
  const r = pick(PL(), ["a"], clicks, 4, true, { c: "down", e: "wait", a: "local" });
  assert.deepEqual(r.shown, ["d", "b", "a", "e"]);   // по числу открытий
  assert.deepEqual(r.pinnedShown, ["a", "e"]);
  assert.deepEqual(r.dropped, ["c"]);
  // переполнение: недоступная закреплённая уступает место следующей из переполнения
  const o = pick(PL(), ["a", "c", "e"], {}, 2, true, { a: "down" });
  assert.deepEqual(o.shown, ["c", "e"]);
  assert.deepEqual(o.overflow, []);
  // автодобранная недоступна → следующая по кликам; ссылки без кликов не добираются
  const q = pick(PL(), [], clicks, 5, true, { a: "down", c: "down", e: "down", d: "down" });
  assert.deepEqual(q.shown, ["b", "f"]);
  assert.deepEqual(q.dropped.sort(), ["a", "c", "d", "e"]);
  // всё недоступно — пусто, dropped не пуст (уведомление «ни одна карточка не доступна»)
  const z = pick(PL(), [], {}, 4, true, { a: "down", c: "down", e: "down" });
  assert.deepEqual(z.shown, []);
  assert.equal(z.dropped.length, 3);
  // без статусов (проверка не завершена) — как раньше
  assert.deepEqual(pick(PL(), ["a"], clicks, 4, true).shown, ["d", "a", "c", "e"]);
});

test("hiddenInIndex (#19): скрыты и автодобранные по кликам", () => {
  const links = [{ id: "a", fav: true }, { id: "b" }, { id: "c", favHide: false }, { id: "x" }];
  const p = core.pickFavorites(links, [], { b: 3, c: 2 }, 4, true);
  assert.deepEqual(clone(p.shown), ["b", "c", "a"]);
  assert.deepEqual([...core.hiddenInIndex({ links }, p.shown)].sort(), ["a", "b"]);
});

test("иконки (#24, #25): служебные вне блоков; каждая смысловая — ровно в одном блоке; смысловых ≥ 30 × 1.5", () => {
  const ctx = loadCore();   // RP.core с реестром иконок
  const groups = clone(ctx.ICON_GROUPS), ui = clone(ctx.ICON_UI);
  const all = groups.flatMap((g) => g[1]);
  assert.equal(new Set(all).size, all.length, "иконка в двух блоках");
  assert.ok(all.every((n) => !ui.includes(n)), "служебная иконка в выборе");
  assert.ok(all.length >= 45, "смысловых " + all.length);
  ["IT", "Разработка", "Тестирование", "Гонка героев", "Призы", "Победа", "Настройка"].forEach((t) =>
    assert.ok(groups.some((g) => g[0].startsWith(t)), "нет блока " + t));
  // реестр: все имена блоков и служебные есть в наборе, а каждая иконка набора — либо служебная, либо в блоке
  const names = clone(ctx.iconUsage({ sections: [], links: all.concat(ui).map((icon) => ({ icon })) })).map((u) => u[0]);
  assert.equal(names.length, all.length + ui.length);
});

test("iconUsage (#26): иконки ссылок и разделов по убыванию применений, неизвестные — мимо, без лимита", () => {
  const d = { sections: [{ icon: "code" }, { icon: "star" }], links: [{ icon: "star" }, { icon: "star" }, { icon: "code" }, { icon: "nope" }, {}, { icon: "search" }] };
  assert.deepEqual(clone(core.iconUsage(d)), [["star", 3], ["code", 2], ["search", 1]]);
  const real = loadLinks(), u = clone(core.iconUsage(real));
  const want = new Set(real.sections.map((s) => s.icon).concat(real.links.map((l) => l.icon)).filter(Boolean));
  assert.equal(u.length, want.size);
  for (let i = 1; i < u.length; i++) assert.ok(u[i - 1][1] >= u[i][1]);
});
