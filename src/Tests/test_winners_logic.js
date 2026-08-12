/**
 * Проверка логики победителей и разбивки по уровням.
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
 * @param {object} winnersConfig
 * @param {{ tn: string, amount: number, tb?: string, gosb?: string, cluster?: string }[]} rows
 */
function computeWinnersResult(winnersConfig, rows) {
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

  /**
   * @param {{ tn: string, amount: number, tb?: string, gosb?: string, cluster?: string }} row
   * @param {string} scope
   */
  function scopeKey(row, scope) {
    if (scope === "tb") return row.tb || "(пусто)";
    if (scope === "gosb") return row.gosb || "(пусто)";
    if (scope === "cluster") return row.cluster || "(пусто)";
    return "Вся страна";
  }

  /**
   * @param {string} scope
   * @param {typeof rows} winners
   * @param {typeof rows} allInScope
   */
  function buildLevels(scope, winners, allInScope) {
    /** @type {Map<string, { key: string, participants: number, winners: object[] }>} */
    const buckets = new Map();
    const bump = (key, field, row) => {
      if (!buckets.has(key)) buckets.set(key, { key, participants: 0, winners: [] });
      const b = buckets.get(key);
      if (field === "p") b.participants += 1;
      else b.winners.push(row);
    };
    for (const row of allInScope) bump(scopeKey(row, scope), "p", row);
    for (const row of winners) bump(scopeKey(row, scope), "w", row);
    return [...buckets.values()].map((b) => ({
      key: b.key,
      winnerCount: b.winners.length,
      participants: b.participants,
      winners: b.winners
    }));
  }

  /** @type {object[]} */
  const rules = [];

  if (winnersConfig.type === "award") {
    for (const item of winnersConfig.awardItems) {
      const thr = Number(item.criterion);
      const prize = "≥" + thr;
      const winners = rows.filter((r) => (Number(r.amount) || 0) >= thr);
      for (const w of winners) addPrize(w.tn, prize);
      rules.push({
        label: prize,
        winnerCount: winners.length,
        breakdowns: {
          tb: buildLevels("tb", winners, rows),
          country: buildLevels("country", winners, rows)
        }
      });
    }
  } else {
    for (const item of winnersConfig.tournamentItems) {
      const prize = "d" + item.dignity;
      const scope = item.scope || "country";
      /** @type {Map<string, typeof rows>} */
      const buckets = new Map();
      for (const row of rows) {
        const key = scopeKey(row, scope);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(row);
      }
      /** @type {object[]} */
      const levels = [];
      /** @type {typeof rows} */
      let allWinners = [];
      for (const [key, groupRows] of buckets.entries()) {
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
        /** @type {typeof rows} */
        const picked = [];
        for (let k = 0; k < n; k += 1) {
          if (k < take) picked.push(sorted[k]);
          else if ((Number(sorted[k].amount) || 0) === cutoff) picked.push(sorted[k]);
          else break;
        }
        for (const w of picked) addPrize(w.tn, prize);
        allWinners = allWinners.concat(picked);
        levels.push({ key, winnerCount: picked.length, participants: n, winners: picked });
      }
      rules.push({ label: prize, scope, winnerCount: allWinners.length, levels });
    }
  }

  let totalWinners = 0;
  for (const rec of map.values()) if (rec.won) totalWinners += 1;
  return { map, totalWinners, rules };
}

const rows = [
  { tn: "1", amount: 10, tb: "A", gosb: "G1" },
  { tn: "2", amount: 5, tb: "A", gosb: "G1" },
  { tn: "3", amount: 3, tb: "B", gosb: "G2" },
  { tn: "4", amount: 10, tb: "B", gosb: "G2" }
];

{
  const res = computeWinnersResult({
    type: "award",
    awardItems: [{ criterion: 5 }, { criterion: 10 }]
  }, rows);
  assert("награда: tn1 ≥5 и ≥10", res.map.get("1").prizes.length === 2);
  assert("награда: tn2 только ≥5", res.map.get("2").prizes.join(",") === "≥5");
  const rule10 = res.rules.find((r) => r.label === "≥10");
  const tbLevels = rule10.breakdowns.tb;
  const a = tbLevels.find((l) => l.key === "A");
  const b = tbLevels.find((l) => l.key === "B");
  assert("награда ≥10: в ТБ A один победитель", !!(a && a.winnerCount === 1));
  assert("награда ≥10: в ТБ B один победитель", !!(b && b.winnerCount === 1));
  assert("награда: уникальных победителей 3", res.totalWinners === 3);
}

{
  const res = computeWinnersResult({
    type: "tournament",
    tournamentItems: [{
      dignity: 1, scope: "country", direction: "more", selectMode: "topN", topN: 1, topPct: 10
    }]
  }, rows);
  assert("турнир страна топ1: оба с 10 (ничья)", !!(res.map.get("1").won && res.map.get("4").won));
  assert("турнир страна топ1: tn2 нет", !(res.map.get("2") && res.map.get("2").won));
}

{
  const res = computeWinnersResult({
    type: "tournament",
    tournamentItems: [{
      dignity: 2, scope: "tb", direction: "more", selectMode: "topN", topN: 1, topPct: 10
    }]
  }, rows);
  assert("турнир по ТБ: в A побеждает 1", !!(res.map.get("1") && res.map.get("1").won));
  assert("турнир по ТБ: в B побеждает 4", !!(res.map.get("4") && res.map.get("4").won));
  assert("турнир по ТБ: два уровня", res.rules[0].levels.length === 2);
  assert("турнир по ТБ: tn2 не в топе A", !(res.map.get("2") && res.map.get("2").won));
}

{
  const res = computeWinnersResult({
    type: "tournament",
    tournamentItems: [{
      dignity: 3, scope: "country", direction: "less", selectMode: "topPct", topN: 1, topPct: 25
    }]
  }, rows);
  assert("турнир % меньше=лучше: победитель tn3", !!(res.map.get("3") && res.map.get("3").won));
}

if (failed) {
  console.error("Провалено:", failed);
  process.exit(1);
}
console.log("Все проверки победителей пройдены.");
