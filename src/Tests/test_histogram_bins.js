#!/usr/bin/env node
/**
 * Тесты алгоритмов распределения сумм (зеркало логики sum-distribution.html).
 */

"use strict";

/**
 * @param {string|number} raw
 * @returns {number|null}
 */
function normalizeAmount(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\u00a0/g, " ").replace(/\s+/g, "");
  s = s.replace(/₽|руб\.?|RUB|USD|€|\$/gi, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  } else if (s.includes(",") && s.includes(".")) {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {number[]} amounts
 * @param {{ mode: string, count: number, width: number|null, origin: number|null, min: number|null, max: number|null, customEdges: number[] }} opts
 * @returns {number[]}
 */
function buildBins(amounts, opts) {
  if (!amounts.length) throw new Error("Нет сумм для построения интервалов.");
  const dataMin = Math.min(...amounts);
  const dataMax = Math.max(...amounts);

  if (opts.mode === "custom") {
    const edges = [...opts.customEdges].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const unique = edges.filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
    if (unique.length < 2) throw new Error("Для ручных границ укажите минимум 2 числа.");
    return unique;
  }

  let min = opts.min == null || !Number.isFinite(opts.min) ? dataMin : opts.min;
  let max = opts.max == null || !Number.isFinite(opts.max) ? dataMax : opts.max;
  if (max < min) {
    const t = min;
    min = max;
    max = t;
  }
  if (max === min) max = min + (Math.abs(min) || 1);

  if (opts.mode === "width") {
    const width = opts.width;
    if (!(width > 0)) throw new Error("Ширина интервала должна быть больше 0.");
    const origin = opts.origin == null || !Number.isFinite(opts.origin) ? min : opts.origin;
    /** @type {number[]} */
    const edges = [origin];
    let cur = origin;
    while (cur < max && edges.length < 2000) {
      cur = Number((cur + width).toPrecision(12));
      edges.push(cur);
    }
    if (edges[edges.length - 1] < max) edges.push(max);
    if (edges.length < 2) edges.push(origin + width);
    return edges;
  }

  const count = Math.max(1, Math.floor(opts.count || 1));
  const width = (max - min) / count;
  /** @type {number[]} */
  const edges = [];
  for (let i = 0; i <= count; i += 1) {
    edges.push(Number((min + width * i).toPrecision(12)));
  }
  edges[edges.length - 1] = max;
  return edges;
}

/**
 * @param {{ tb: string, gosb: string, amount: number }[]} rows
 * @param {number[]} edges
 * @param {string} sliceMode
 */
function computeHistogram(rows, edges, sliceMode) {
  /** @type {Map<string, number[]>} */
  const seriesMap = new Map();
  let below = 0;
  let above = 0;
  const binCount = edges.length - 1;

  function seriesName(row) {
    if (sliceMode === "tb") return row.tb;
    if (sliceMode === "gosb") return row.gosb;
    if (sliceMode === "tb_gosb") return `${row.tb} / ${row.gosb}`;
    return "Вся выборка";
  }

  for (const row of rows) {
    const name = seriesName(row);
    if (!seriesMap.has(name)) seriesMap.set(name, Array(binCount).fill(0));
    const counts = seriesMap.get(name);
    const x = row.amount;
    if (x < edges[0]) {
      below += 1;
      continue;
    }
    if (x > edges[edges.length - 1]) {
      above += 1;
      continue;
    }
    let placed = false;
    for (let i = 0; i < binCount; i += 1) {
      const left = edges[i];
      const right = edges[i + 1];
      const isLast = i === binCount - 1;
      if ((x >= left && x < right) || (isLast && x >= left && x <= right)) {
        counts[i] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) above += 1;
  }

  return {
    series: [...seriesMap.entries()].map(([name, counts]) => ({ name, counts })),
    below,
    above,
    total: rows.length
  };
}

function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
  const delims = [";", ",", "\t"];
  let best = ";";
  let bestCount = -1;
  for (const d of delims) {
    const count = line.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {boolean} cond
 * @param {string=} detail
 */
function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  [v] ${name}`);
  } else {
    failed += 1;
    console.error(`  [x] ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("normalizeAmount");
assert("пробелы тысяч", normalizeAmount("1 234 567") === 1234567);
assert("запятая как десятичная", normalizeAmount("1234,5") === 1234.5);
assert("пустое", normalizeAmount("") === null);
assert("число как есть", normalizeAmount(42) === 42);

console.log("detectDelimiter");
assert("точка с запятой", detectDelimiter("ТБ;ГОСБ;сумма\nA;B;1") === ";");
assert("таб", detectDelimiter("ТБ\tГОСБ\tсумма\nA\tB\t1") === "\t");

console.log("buildBins");
{
  const edges = buildBins([0, 100], {
    mode: "count",
    count: 4,
    width: null,
    origin: null,
    min: null,
    max: null,
    customEdges: []
  });
  assert("count: 5 границ", edges.length === 5, JSON.stringify(edges));
  assert("count: первая 0", edges[0] === 0);
  assert("count: последняя 100", edges[4] === 100);
}
{
  const edges = buildBins([10, 90], {
    mode: "width",
    count: 10,
    width: 25,
    origin: 0,
    min: null,
    max: null,
    customEdges: []
  });
  assert("width: начинается с 0", edges[0] === 0);
  assert("width: шаг 25", edges[1] === 25);
  assert("width: покрывает max", edges[edges.length - 1] >= 90);
}
{
  const edges = buildBins([1, 2, 3], {
    mode: "custom",
    count: 1,
    width: null,
    origin: null,
    min: null,
    max: null,
    customEdges: [0, 10, 5, 10]
  });
  assert("custom: сортировка и уникальность", JSON.stringify(edges) === JSON.stringify([0, 5, 10]));
}

console.log("computeHistogram");
{
  const rows = [
    { tb: "A", gosb: "G1", amount: 5 },
    { tb: "A", gosb: "G1", amount: 15 },
    { tb: "B", gosb: "G2", amount: 25 },
    { tb: "B", gosb: "G2", amount: 100 }
  ];
  const histAll = computeHistogram(rows, [0, 10, 20, 30], "all");
  assert("all: одна серия", histAll.series.length === 1);
  assert("all: bin0=1", histAll.series[0].counts[0] === 1);
  assert("all: bin1=1", histAll.series[0].counts[1] === 1);
  assert("all: bin2=1", histAll.series[0].counts[2] === 1);
  assert("all: above=1", histAll.above === 1);

  const histTb = computeHistogram(rows.filter((r) => r.amount <= 30), [0, 10, 20, 30], "tb");
  assert("tb: две серии", histTb.series.length === 2);
}

console.log("");
console.log(`Итого: ${passed} ok, ${failed} fail`);
process.exit(failed ? 1 : 0);
