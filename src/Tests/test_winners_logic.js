/**
 * Проверка логики победителей (награда / турнир) без браузера.
 * Запуск: node src/Tests/test_winners_logic.js
 */

"use strict";

/** @type {number} */
let failed = 0;

/**
 * @param {string} name
 * @param {boolean} cond
 */
function assert(name, cond) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", name);
  } else {
    console.log("OK:", name);
  }
}

/**
 * Упрощённая копия computeWinnersMap из contest-criteria.html
 * @param {object} winnersConfig
 * @param {{ tn: string, amount: number, tb?: string, gosb?: string, cluster?: string }[]} rows
 * @returns {Map<string, { won: boolean, prizes: string[] }>}
 */
function computeWinnersMap(winnersConfig, rows) {
  /** @type {Map<string, { won: boolean, prizes: string[] }>} */
  const map = new Map();
  const ensure = (tn) => {
    if (!map.has(tn)) map.set(tn, { won: false, prizes: [] });
    return map.get(tn);
  };
  const addPrize = (tn, prize) => {
    const rec = ensure(tn);
    if (!rec.prizes.includes(prize)) rec.prizes.push(prize);
    rec.won = true;
  };
  if (!rows.length) return map;

  if (winnersConfig.type === "award") {
    for (const item of winnersConfig.awardItems) {
      const thr = Number(item.criterion);
      const prize = "≥" + thr;
      for (const row of rows) {
        if ((Number(row.amount) || 0) >= thr) addPrize(row.tn, prize);
      }
    }
    return map;
  }

  for (const item of winnersConfig.tournamentItems) {
    const prize = "d" + item.dignity;
    /** @type {Map<string, typeof rows>} */
    const buckets = new Map();
    for (const row of rows) {
      let key = "__all__";
      if (item.scope === "tb") key = row.tb || "(пусто)";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    for (const groupRows of buckets.values()) {
      const sorted = groupRows.slice().sort((a, b) => {
        const da = Number(a.amount) || 0;
        const db = Number(b.amount) || 0;
        return item.direction === "less" ? da - db : db - da;
      });
      const n = sorted.length;
      let take = item.selectMode === "topPct"
        ? Math.max(1, Math.ceil((n * Number(item.topPct)) / 100))
        : Math.max(1, Math.min(n, Math.round(Number(item.topN) || 1)));
      take = Math.min(take, n);
      const cutoff = Number(sorted[take - 1].amount) || 0;
      for (let k = 0; k < n; k += 1) {
        if (k < take) {
          addPrize(sorted[k].tn, prize);
          continue;
        }
        const amt = Number(sorted[k].amount) || 0;
        if (amt === cutoff) addPrize(sorted[k].tn, prize);
        else break;
      }
    }
  }
  return map;
}

const rows = [
  { tn: "1", amount: 10, tb: "A" },
  { tn: "2", amount: 5, tb: "A" },
  { tn: "3", amount: 3, tb: "B" },
  { tn: "4", amount: 10, tb: "B" }
];

{
  const map = computeWinnersMap({
    type: "award",
    awardItems: [{ criterion: 5 }, { criterion: 10 }]
  }, rows);
  assert("награда: tn1 ≥5 и ≥10", map.get("1").prizes.length === 2);
  assert("награда: tn2 только ≥5", map.get("2").prizes.join(",") === "≥5");
  assert("награда: tn3 не победитель", !map.has("3") || map.get("3").won === false);
}

{
  const map = computeWinnersMap({
    type: "tournament",
    tournamentItems: [{
      dignity: 1, scope: "country", direction: "more", selectMode: "topN", topN: 1, topPct: 10
    }]
  }, rows);
  assert("турнир страна топ1: оба с 10 (ничья)", map.get("1").won && map.get("4").won);
  assert("турнир страна топ1: tn2 нет", !map.get("2") || !map.get("2").won);
}

{
  const map = computeWinnersMap({
    type: "tournament",
    tournamentItems: [{
      dignity: 2, scope: "tb", direction: "more", selectMode: "topN", topN: 1, topPct: 10
    }]
  }, rows);
  assert("турнир по ТБ: в A побеждает 1", map.get("1").won);
  assert("турнир по ТБ: в B побеждает 4", map.get("4").won);
  assert("турнир по ТБ: tn2 не в топе A", !map.get("2") || !map.get("2").won);
}

{
  const map = computeWinnersMap({
    type: "tournament",
    tournamentItems: [{
      dignity: 3, scope: "country", direction: "less", selectMode: "topPct", topN: 1, topPct: 25
    }]
  }, rows);
  // 25% от 4 = 1
  assert("турнир % меньше=лучше: победитель tn3", map.get("3") && map.get("3").won);
}

if (failed) {
  console.error("Провалено:", failed);
  process.exit(1);
}
console.log("Все проверки победителей пройдены.");
