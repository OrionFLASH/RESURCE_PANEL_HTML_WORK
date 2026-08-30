#!/usr/bin/env node
/**
 * Тесты алгоритмов распределения сумм (зеркало логики sum-distribution.html).
 */
"use strict";

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log("  ✓", name);
  } else {
    failed += 1;
    console.log("  ✗", name, detail || "");
  }
}

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

function normalizeEmpId(raw, padLen) {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  const len = padLen || 20;
  if (digits.length >= len) return digits.slice(-len);
  return digits.padStart(len, "0");
}

function normalizeHeader(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ");
}

function findColumnIndex(headers, aliases) {
  const normalized = headers.map(normalizeHeader);
  for (let ai = 0; ai < aliases.length; ai += 1) {
    const a = normalizeHeader(aliases[ai]);
    for (let i = 0; i < normalized.length; i += 1) {
      if (normalized[i] === a) return i;
    }
  }
  for (let ai = 0; ai < aliases.length; ai += 1) {
    const a = normalizeHeader(aliases[ai]);
    for (let i = 0; i < normalized.length; i += 1) {
      if (normalized[i].includes(a)) return i;
    }
  }
  return -1;
}

function aggregateByTn(rows) {
  const map = new Map();
  for (const row of rows) {
    const tn = row.tn;
    const prev = map.get(tn);
    if (!prev) {
      map.set(tn, {
        tn,
        amount: row.amount,
        tb: row.tb || "",
        gosb: row.gosb || "",
        cluster: row.cluster || ""
      });
      continue;
    }
    prev.amount += row.amount;
    if (!prev.tb && row.tb) prev.tb = row.tb;
    if (!prev.gosb && row.gosb) prev.gosb = row.gosb;
    if (!prev.cluster && row.cluster) prev.cluster = row.cluster;
  }
  return [...map.values()];
}

function integerBounds(min, max) {
  let lo = Math.floor(Number(min));
  let hi = Math.ceil(Number(max));
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = lo + 1;
  if (hi <= lo) hi = lo + 1;
  return { min: lo, max: hi };
}

function toIntegerEdge(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}

function cascadeEdges(edges, changedIndex, min, max) {
  const out = edges.map(toIntegerEdge);
  for (let i = changedIndex + 1; i < out.length; i += 1) {
    if (out[i] < out[i - 1]) out[i] = out[i - 1];
  }
  for (let i = changedIndex - 1; i >= 0; i -= 1) {
    if (out[i] > out[i + 1]) out[i] = out[i + 1];
  }
  out[0] = min;
  out[out.length - 1] = max;
  return out;
}

function evenlySpacedEdges(min, max, movableCount) {
  const n = Math.max(1, Math.floor(movableCount));
  const totalIntervals = n + 1;
  const edges = [min];
  for (let i = 1; i <= n; i += 1) {
    edges.push(toIntegerEdge(min + ((max - min) * i) / totalIntervals));
  }
  edges.push(max);
  for (let i = 1; i < edges.length; i += 1) {
    if (edges[i] < edges[i - 1]) edges[i] = edges[i - 1];
  }
  edges[edges.length - 1] = max;
  return edges;
}

/** Квантили по числу ТН с произвольными весами интервалов. */
function weightedCountEdges(amounts, movableCount, min, max, weights) {
  const n = Math.max(1, Math.floor(movableCount));
  const binCount = n + 1;
  const sorted = amounts.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!sorted.length) return evenlySpacedEdges(min, max, n);

  const w = (weights && weights.length === binCount)
    ? weights.map((x) => Math.max(0, Number(x) || 0))
    : Array(binCount).fill(1);
  const totalW = w.reduce((a, b) => a + b, 0) || binCount;

  const edges = [toIntegerEdge(min)];
  let cumW = 0;
  for (let i = 0; i < n; i += 1) {
    cumW += w[i];
    const idx = Math.min(sorted.length - 1, Math.floor((cumW / totalW) * sorted.length));
    let v = toIntegerEdge(sorted[idx]);
    if (v < min) v = toIntegerEdge(min);
    if (v > max) v = toIntegerEdge(max);
    edges.push(v);
  }
  edges.push(toIntegerEdge(max));
  for (let i = 1; i < edges.length; i += 1) {
    if (edges[i] < edges[i - 1]) edges[i] = edges[i - 1];
  }
  edges[0] = toIntegerEdge(min);
  edges[edges.length - 1] = toIntegerEdge(max);
  return edges;
}

/** Квантили по числу ТН: movableCount ползунков → movableCount+1 интервалов. */
function equalCountEdges(amounts, movableCount, min, max) {
  const n = Math.max(1, Math.floor(movableCount));
  const binCount = n + 1;
  return weightedCountEdges(amounts, n, min, max, Array(binCount).fill(1));
}

/** Лесенка: веса K…1. */
function ladderCountEdges(amounts, movableCount, min, max) {
  const n = Math.max(1, Math.floor(movableCount));
  const binCount = n + 1;
  const weights = Array.from({ length: binCount }, (_, i) => binCount - i);
  return weightedCountEdges(amounts, n, min, max, weights);
}

function countByBin(amounts, edges) {
  const binCount = edges.length - 1;
  const counts = Array(binCount).fill(0);
  for (const a of amounts) {
    const bi = binIndexForAmount(a, edges);
    if (bi >= 0) counts[bi] += 1;
  }
  return counts;
}

function buildBins(amounts, opts) {
  if (!amounts.length) throw new Error("Нет сумм для построения интервалов.");
  const dataMin = Math.min(...amounts);
  const dataMax = Math.max(...amounts);
  const scale = integerBounds(dataMin, dataMax);

  if (opts.mode === "custom") {
    const edges = [...opts.customEdges]
      .filter((n) => Number.isFinite(n))
      .map(toIntegerEdge);
    if (edges.length < 2) throw new Error("custom: мало границ");
    return edges;
  }

  let min = opts.min == null || !Number.isFinite(opts.min) ? scale.min : Math.floor(opts.min);
  let max = opts.max == null || !Number.isFinite(opts.max) ? scale.max : Math.ceil(opts.max);
  if (max < min) {
    const t = min;
    min = max;
    max = t;
  }
  ({ min, max } = integerBounds(min, max));

  if (opts.mode === "width") {
    const width = Math.max(1, Math.round(Number(opts.width) || 0));
    if (!(width > 0)) throw new Error("Ширина интервала должна быть больше 0.");
    const originRaw = opts.origin == null || !Number.isFinite(opts.origin) ? min : opts.origin;
    const origin = Math.floor(originRaw);
    const edges = [origin];
    let cur = origin;
    while (cur < max && edges.length < 2000) {
      cur += width;
      edges.push(cur);
    }
    if (edges[edges.length - 1] < max) edges.push(max);
    if (edges.length < 2) edges.push(origin + width);
    edges[edges.length - 1] = Math.max(edges[edges.length - 1], max);
    return edges;
  }

  const count = Math.max(1, Math.floor(opts.count || 1));
  const edges = [min];
  for (let i = 1; i < count; i += 1) {
    edges.push(toIntegerEdge(min + ((max - min) * i) / count));
  }
  edges.push(max);
  for (let i = 1; i < edges.length; i += 1) {
    if (edges[i] < edges[i - 1]) edges[i] = edges[i - 1];
  }
  edges[edges.length - 1] = max;
  return edges;
}

function computeHistogram(rows, edges, sliceMode) {
  const seriesMap = new Map();
  let below = 0;
  let above = 0;
  const binCount = edges.length - 1;

  function seriesName(row) {
    if (sliceMode === "tb") return row.tb || "(без ТБ)";
    if (sliceMode === "gosb") return row.gosb || "(без ГОСБ)";
    if (sliceMode === "tb_gosb") return `${row.tb || "—"} / ${row.gosb || "—"}`;
    if (sliceMode === "cluster") return row.cluster || "(без кластера)";
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

  const series = [...seriesMap.entries()]
    .map(([name, counts]) => ({ name, counts }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return { edges, series, total: rows.length, below, above };
}

console.log("normalizeAmount");
assert("1 234,56", normalizeAmount("1 234,56") === 1234.56);
assert("отрицательное", normalizeAmount("-10") === -10);

console.log("normalizeEmpId");
assert("pad 20", normalizeEmpId("1875872") === "00000000000001875872");
assert("уже длинный", normalizeEmpId("123456789012345678901") === "23456789012345678901");
assert("с буквами", normalizeEmpId("TN-42") === "00000000000000000042");

console.log("findColumnIndex aliases priority");
{
  const headers = ["Итог", "Сумма", "TN", "ТН"];
  const amountAliases = ["сумма", "прирост", "прирос", "рост", "итог", "sum", "amount"];
  const tnAliases = ["тн", "tn", "табельный"];
  assert("сумма раньше итога", findColumnIndex(headers, amountAliases) === 1);
  assert("тн раньше tn", findColumnIndex(headers, tnAliases) === 3);
  assert("регистр", findColumnIndex(["СУММА", "ТН"], ["сумма"]) === 0);
}

console.log("aggregateByTn");
{
  const rows = [
    { tn: "00000000000000000001", amount: 10, tb: "A", gosb: "", cluster: "1" },
    { tn: "00000000000000000001", amount: 15, tb: "", gosb: "G", cluster: "" },
    { tn: "00000000000000000002", amount: 5, tb: "B", gosb: "H", cluster: "2" }
  ];
  const agg = aggregateByTn(rows);
  assert("две группы", agg.length === 2);
  const a = agg.find((r) => r.tn.endsWith("1"));
  assert("sum 25", a.amount === 25);
  assert("tb first", a.tb === "A");
  assert("gosb filled", a.gosb === "G");
  assert("cluster first", a.cluster === "1");
}

console.log("integerBounds / целые границы");
{
  const b = integerBounds(10.2, 99.1);
  assert("floor мин", b.min === 10);
  assert("ceil макс", b.max === 100);
  const b2 = integerBounds(5.0, 5.0);
  assert("равные → span ≥ 1", b2.min === 5 && b2.max === 6);
  const edges = evenlySpacedEdges(0, 100, 2);
  assert("промежуточные целые", edges.every((e) => Number.isInteger(e)), JSON.stringify(edges));
  const frac = buildBins([10.3, 89.7], {
    mode: "count",
    count: 4,
    width: null,
    origin: null,
    min: null,
    max: null,
    customEdges: []
  });
  assert("count по дробным: мин 10", frac[0] === 10);
  assert("count по дробным: макс 90", frac[frac.length - 1] === 90);
  assert("все границы целые", frac.every((e) => Number.isInteger(e)), JSON.stringify(frac));
}

console.log("evenlySpacedEdges / cascade");
{
  const edges = evenlySpacedEdges(0, 100, 2);
  assert("2 ползунка → 4 ребра", edges.length === 4, JSON.stringify(edges));
  assert("min 0", edges[0] === 0);
  assert("max 100", edges[3] === 100);
}
{
  let edges = [0, 100, 500, 900];
  edges[2] = 1100;
  edges = cascadeEdges(edges, 2, 0, 2000);
  assert("сдвиг вправо утягивает max-side", edges[2] === 1100 && edges[3] === 2000);
  edges = [0, 100, 500, 900];
  edges[2] = 50;
  edges = cascadeEdges(edges, 2, 0, 900);
  assert(
    "сдвиг влево утягивает предыдущий",
    edges[1] === 50 && edges[2] === 50,
    JSON.stringify(edges)
  );
}

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
  assert("count: 5 границ", edges.length === 5);
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
    customEdges: [0, 40, 70, 100]
  });
  assert("custom: порядок слайдера", JSON.stringify(edges) === JSON.stringify([0, 40, 70, 100]));
}

console.log("computeHistogram after agg");
{
  const raw = [
    { tn: "1", tb: "A", gosb: "G1", cluster: "1", amount: 5 },
    { tn: "1", tb: "A", gosb: "G1", cluster: "1", amount: 15 },
    { tn: "2", tb: "B", gosb: "G2", cluster: "2", amount: 25 }
  ];
  const rows = aggregateByTn(
    raw.map((r) => ({ ...r, tn: normalizeEmpId(r.tn) }))
  );
  assert("agg 2 TN", rows.length === 2);
  const histAll = computeHistogram(rows, [0, 20, 40], "all");
  // TN1 sum=20 попадает в последний интервал [20, 40]; TN2=25 туда же
  assert("оба ТН во втором бине", histAll.series[0].counts[0] === 0 && histAll.series[0].counts[1] === 2);
  const hist2 = computeHistogram(rows, [0, 15, 30, 50], "all");
  assert("оба в [15,30)", hist2.series[0].counts[1] === 2);

  const histCl = computeHistogram(rows, [0, 20, 40], "cluster");
  assert("cluster: 2 серии", histCl.series.length === 2);
}

console.log("equalCountEdges");
{
  const amounts = [1, 2, 3, 4, 5, 6, 7, 8];
  const edges = equalCountEdges(amounts, 3, 1, 8);
  assert("3 ползунка → 5 рёбер", edges.length === 5, JSON.stringify(edges));
  assert("min/max", edges[0] === 1 && edges[4] === 8);
  const counts = countByBin(amounts, edges);
  assert("по 2 в каждом", counts.every((c) => c === 2), JSON.stringify(counts));
  assert("монотонны", edges.every((e, i) => i === 0 || e >= edges[i - 1]));
}
{
  // 3 ползунка → 4 интервала ≈ по 25%
  const amounts = Array.from({ length: 100 }, (_, i) => i + 1);
  const edges = equalCountEdges(amounts, 3, 1, 100);
  const counts = countByBin(amounts, edges);
  assert("4 интервала", counts.length === 4);
  const minC = Math.min(...counts);
  const maxC = Math.max(...counts);
  assert("отклонение ≤1 при уникальных", maxC - minC <= 1, JSON.stringify(counts));
}
{
  const amounts = [10, 10, 10, 10, 50, 50, 50, 50];
  const edges = equalCountEdges(amounts, 1, 10, 50);
  assert("2 интервала при дубликатах", edges.length === 3);
  const counts = countByBin(amounts, edges);
  assert("сумма сохранена", counts.reduce((a, b) => a + b, 0) === 8, JSON.stringify(counts));
}

console.log("ladderCountEdges");
{
  // 3 ползунка → 4 интервала, веса 4:3:2:1, total 10 → при N=10 ровно 4,3,2,1
  const amounts = Array.from({ length: 10 }, (_, i) => i + 1);
  const edges = ladderCountEdges(amounts, 3, 1, 10);
  assert("5 рёбер", edges.length === 5);
  const counts = countByBin(amounts, edges);
  assert("лесенка 4,3,2,1", JSON.stringify(counts) === "[4,3,2,1]", JSON.stringify(counts));
  assert("убывание", counts.every((c, i) => i === 0 || c <= counts[i - 1]));
}
{
  const amounts = Array.from({ length: 100 }, (_, i) => i + 1);
  const edges = ladderCountEdges(amounts, 3, 1, 100);
  const counts = countByBin(amounts, edges);
  assert("4 интервала лесенка", counts.length === 4);
  assert("первый больше последнего", counts[0] > counts[3], JSON.stringify(counts));
  assert("монотонно не возрастает", counts.every((c, i) => i === 0 || c <= counts[i - 1]), JSON.stringify(counts));
}

console.log("interval uniques");
{
  const edges = [0, 20, 40];
  assert("bin 0", binIndexForAmount(10, edges) === 0);
  assert("bin 1 last", binIndexForAmount(40, edges) === 1);
  assert("вне", binIndexForAmount(-1, edges) === -1);
  const rows = [
    { tn: "a", amount: 5, tb: "TB1", gosb: "G1", cluster: "C1" },
    { tn: "b", amount: 8, tb: "TB1", gosb: "G2", cluster: "C1" },
    { tn: "c", amount: 25, tb: "TB2", gosb: "G1", cluster: "C2" }
  ];
  const bins = collectBinUniques(rows, edges);
  assert("интервал0: 2 ТН", bins[0].tn.size === 2);
  assert("интервал0: 1 ТБ", bins[0].tb.size === 1 && bins[0].tb.has("TB1"));
  assert("интервал0: 2 ГОСБ", bins[0].gosb.size === 2);
  assert("интервал1: 1 ТБ TB2", bins[1].tb.has("TB2") && bins[1].tb.size === 1);
}

console.log("");
console.log(`Итого: ${passed} ok, ${failed} fail`);
process.exit(failed ? 1 : 0);
