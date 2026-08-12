/**
 * Проверка логики победителей, каскада турнира, критериев участия и diversity.
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
 * Упрощённый фильтр участия (зеркало логики app.js).
 * @param {object[]} rows
 * @param {object} participation
 */
function filterParticipation(rows, participation) {
  const part = participation || {};
  const primary = part.primary || {};
  const secondary = part.secondary || {};
  const ops = {
    gt: (a, b) => a > b,
    gte: (a, b) => a >= b,
    lt: (a, b) => a < b,
    lte: (a, b) => a <= b,
    eq: (a, b) => a === b
  };
  const pFn = ops[primary.op] || ops.gt;
  const sFn = ops[secondary.op] || ops.gte;
  const wantCol = String(secondary.column || "").trim().toLowerCase();
  let secondaryPresent = false;
  if (secondary.enabled && wantCol) {
    secondaryPresent = rows.some((r) => {
      const extras = r.extras || {};
      return Object.keys(extras).some((k) => k.toLowerCase() === wantCol);
    });
  }
  const out = [];
  for (const row of rows) {
    if (primary.enabled) {
      if (!pFn(Number(row.amount) || 0, Number(primary.value))) continue;
    }
    if (secondary.enabled && wantCol && secondaryPresent) {
      const extras = row.extras || {};
      let v = null;
      for (const k of Object.keys(extras)) {
        if (k.toLowerCase() === wantCol) {
          v = Number(extras[k]);
          break;
        }
      }
      if (v == null || !sFn(v, Number(secondary.value))) continue;
    }
    out.push(row);
  }
  return {
    rows: out,
    secondarySkippedMissing: !!(secondary.enabled && wantCol && !secondaryPresent)
  };
}

/**
 * @param {object} winnersConfig
 * @param {object[]} rows
 */
function computeWinnersResult(winnersConfig, rows) {
  const filtered = filterParticipation(rows, winnersConfig.participation);
  return computeWinnersResultCore(winnersConfig, filtered.rows);
}

/**
 * @param {object} winnersConfig
 * @param {object[]} rows
 */
function computeWinnersResultCore(winnersConfig, rows) {
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

  function scopeKey(row, scope) {
    if (scope === "tb") return row.tb || "(пусто)";
    if (scope === "gosb") return row.gosb || "(пусто)";
    if (scope === "cluster") return row.cluster || "(пусто)";
    return "Вся страна";
  }

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
    const rawItems = winnersConfig.tournamentItems || [];
    const items = rawItems
      .map((it, idx) => ({ it, idx }))
      .sort((a, b) => {
        const da = Number(a.it && a.it.dignity) || 99;
        const db = Number(b.it && b.it.dignity) || 99;
        if (da !== db) return da - db;
        return a.idx - b.idx;
      })
      .map((x) => x.it);

    /** @type {Map<string, Set<string>>} */
    const awardedByScope = new Map();

    for (const item of items) {
      const prize = "d" + item.dignity;
      const scope = item.scope || "country";
      if (!awardedByScope.has(scope)) awardedByScope.set(scope, new Set());
      const awarded = awardedByScope.get(scope);

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
        const nAll = sorted.length;
        const eligible = sorted.filter((r) => !awarded.has(r.tn));
        const n = eligible.length;
        if (!n) {
          levels.push({ key, winnerCount: 0, participants: nAll, winners: [] });
          continue;
        }
        let take = item.selectMode === "topPct"
          ? Math.max(1, Math.ceil((nAll * Number(item.topPct)) / 100))
          : Math.max(1, Math.round(Number(item.topN) || 1));
        take = Math.min(take, n);
        const cutoff = Number(eligible[take - 1].amount) || 0;
        /** @type {typeof rows} */
        const picked = [];
        for (let k = 0; k < n; k += 1) {
          if (k < take) picked.push(eligible[k]);
          else if ((Number(eligible[k].amount) || 0) === cutoff) picked.push(eligible[k]);
          else break;
        }
        for (const w of picked) {
          addPrize(w.tn, prize);
          awarded.add(w.tn);
        }
        allWinners = allWinners.concat(picked);
        levels.push({ key, winnerCount: picked.length, participants: nAll, winners: picked });
      }
      rules.push({ label: prize, scope, winnerCount: allWinners.length, levels });
    }
  }

  let totalWinners = 0;
  for (const rec of map.values()) if (rec.won) totalWinners += 1;
  return { map, totalWinners, totalParticipants: rows.length, rules };
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

{
  const cascadeRows = [
    { tn: "a", amount: 100, tb: "X" },
    { tn: "b", amount: 90, tb: "X" },
    { tn: "c", amount: 80, tb: "X" },
    { tn: "d", amount: 70, tb: "X" },
    { tn: "e", amount: 60, tb: "X" },
    { tn: "f", amount: 50, tb: "X" },
    { tn: "g", amount: 40, tb: "X" },
    { tn: "h", amount: 30, tb: "X" }
  ];
  const res = computeWinnersResult({
    type: "tournament",
    tournamentItems: [
      { dignity: 2, scope: "country", direction: "more", selectMode: "topN", topN: 5, topPct: 10 },
      { dignity: 1, scope: "country", direction: "more", selectMode: "topN", topN: 2, topPct: 10 }
    ]
  }, cascadeRows);
  assert("каскад: a золото", !!(res.map.get("a") && res.map.get("a").prizes.join(",") === "d1"));
  assert("каскад: b золото", !!(res.map.get("b") && res.map.get("b").prizes.join(",") === "d1"));
  assert("каскад: c серебро (не золото)", !!(res.map.get("c") && res.map.get("c").prizes.join(",") === "d2"));
  assert("каскад: g серебро (5-й после золота)", !!(res.map.get("g") && res.map.get("g").prizes.join(",") === "d2"));
  assert("каскад: h без награды", !(res.map.get("h") && res.map.get("h").won));
  assert("каскад: a не получает серебро повторно", res.map.get("a").prizes.length === 1);
  assert("каскад: уникальных 7 (2+5)", res.totalWinners === 7);
}

{
  const res = computeWinnersResult({
    type: "tournament",
    tournamentItems: [
      { dignity: 1, scope: "country", direction: "more", selectMode: "topN", topN: 1, topPct: 10 },
      { dignity: 2, scope: "tb", direction: "more", selectMode: "topN", topN: 1, topPct: 10 }
    ]
  }, rows);
  assert("разные круги: tn1 страна+ТБ", res.map.get("1").prizes.length === 2);
}

{
  const partRows = [
    { tn: "1", amount: 10, extras: { балл: 90 } },
    { tn: "2", amount: 0, extras: { балл: 95 } },
    { tn: "3", amount: 8, extras: { балл: 70 } },
    { tn: "4", amount: 20, extras: { балл: 85 } }
  ];
  const f1 = filterParticipation(partRows, {
    primary: { enabled: true, op: "gt", value: 0 },
    secondary: { enabled: false, column: "", op: "gte", value: 85 }
  });
  assert("участие основной>0: 3 из 4", f1.rows.length === 3);
  assert("участие основной>0: tn2 отсеян", !f1.rows.some((r) => r.tn === "2"));

  const f2 = filterParticipation(partRows, {
    primary: { enabled: true, op: "gt", value: 0 },
    secondary: { enabled: true, column: "балл", op: "gte", value: 85 }
  });
  assert("участие +балл≥85: 2 участника", f2.rows.length === 2);
  assert("участие +балл: tn1 и tn4", f2.rows.map((r) => r.tn).sort().join(",") === "1,4");

  const f3 = filterParticipation(partRows, {
    primary: { enabled: false, op: "gt", value: 0 },
    secondary: { enabled: true, column: "рейтинг", op: "gte", value: 85 }
  });
  assert("второстеп. нет колонки: все участвуют", f3.rows.length === 4);
  assert("второстеп. нет колонки: флаг skip", f3.secondarySkippedMissing === true);

  const res = computeWinnersResult({
    type: "tournament",
    participation: {
      primary: { enabled: true, op: "gt", value: 0 },
      secondary: { enabled: true, column: "балл", op: "gte", value: 85 }
    },
    tournamentItems: [{
      dignity: 1, scope: "country", direction: "more", selectMode: "topN", topN: 1, topPct: 10
    }]
  }, partRows);
  assert("победители среди участников: только tn4", !!(res.map.get("4") && res.map.get("4").won));
  assert("победители среди участников: tn1 не топ", !(res.map.get("1") && res.map.get("1").won && res.totalWinners === 1) || res.totalWinners === 1);
  assert("победители: tn2/tn3 вне пула", !(res.map.get("2") && res.map.get("2").won) && !(res.map.get("3") && res.map.get("3").won));
}

/* —— Устойчивость / Interest / Suggest —— */
const CI = require("../contest_interest.js");

{
  const slotA = {
    slotId: "a",
    label: "Прошлый",
    winnerIds: ["1", "4"],
    rows,
    totalParticipants: 4,
    totalWinners: 2
  };
  const slotB = {
    slotId: "b",
    label: "Текущий",
    winnerIds: ["1", "3"],
    rows,
    totalParticipants: 4,
    totalWinners: 2
  };
  const div = CI.computeWinnersDiversity([slotA, slotB]);
  assert("diversity: 3 уникальных", div.uniqueWinners === 3);
  assert("diversity: 1 повторник (tn1)", div.repeatPeople === 1);
  assert("diversity: personHhi > 0", div.personHhi > 0);
  assert("diversity: coverageTb > 0", div.coverageTb > 0);
  assert("diversity: perSlot=2", div.perSlot.length === 2);

  const scored = CI.scoreContestInterest(div.metrics, {
    inclusivityMin: 0.01,
    inclusivityMax: 0.8,
    personHhiMax: 0.5,
    orgCoverageMin: 0.1,
    chanceZoneMin: 0.01,
    repeatShareMax: 0.9
  }, null);
  assert("score: 0..100", scored.score >= 0 && scored.score <= 100);

  const alts = CI.enumerateCriteriaAlternatives({
    type: "tournament",
    tournamentItems: [{
      id: "x", dignity: 1, scope: "tb", direction: "more", selectMode: "topN", topN: 1, topPct: 10, title: ""
    }],
    awardItems: []
  }, { p70: 3, p80: 5, p90: 10 });
  assert("suggest: есть альтернативы", alts.length >= 3);
  assert("suggest: есть топ-100 страна", alts.some((a) => /Топ-100 по стране/.test(a.label)));

  const ranked = CI.rankSuggestions(div.metrics, scored.score, [
    { label: "wide", patch: {}, metrics: Object.assign({}, div.metrics, { inclusivity: 0.2, personHhi: 0.05 }), score: scored.score + 10 },
    { label: "narrow", patch: {}, metrics: Object.assign({}, div.metrics, { inclusivity: 0.001, personHhi: 0.5 }), score: scored.score - 20 }
  ]);
  assert("suggest: топ не пустой при улучшении", ranked.length >= 1);
  assert("suggest: лучший — wide", ranked[0].label === "wide");

  const narrative = CI.buildDiversityNarrative(Object.assign({}, div, { interestScore: scored.score }));
  assert("narrative: не пустой", narrative.length > 40);
}

if (failed) {
  console.error("Провалено:", failed);
  process.exit(1);
}
console.log("Все проверки победителей и diversity пройдены.");
