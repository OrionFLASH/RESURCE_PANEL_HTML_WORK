/**
 * Анализ устойчивости победителей и «Предложи лучше» для contest-criteria.
 * Подключается в HTML и в node-тестах.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ContestInterest = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * @param {number[]} values
   * @returns {number}
   */
  function hhiFromCounts(values) {
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0) return 0;
    let s = 0;
    for (let i = 0; i < values.length; i += 1) {
      const p = values[i] / total;
      s += p * p;
    }
    return s;
  }

  /**
   * Нормированная энтропия Шеннона 0…1.
   * @param {number[]} values
   */
  function shannonNorm(values) {
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0) return 0;
    const n = values.filter((v) => v > 0).length;
    if (n <= 1) return 0;
    let h = 0;
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] <= 0) continue;
      const p = values[i] / total;
      h -= p * Math.log(p);
    }
    return h / Math.log(n);
  }

  /**
   * @param {Map<string, { won: boolean }>|Record<string, { won: boolean }>} map
   * @returns {string[]}
   */
  function winnerIdsFromMap(map) {
    const ids = [];
    if (map && typeof map.forEach === "function") {
      map.forEach((rec, id) => {
        if (rec && rec.won) ids.push(String(id));
      });
    } else if (map && typeof map === "object") {
      Object.keys(map).forEach((id) => {
        if (map[id] && map[id].won) ids.push(String(id));
      });
    }
    return ids;
  }

  /**
   * @param {{ tn: string, tb?: string, gosb?: string, cluster?: string, amount?: number }[]} rows
   * @param {string[]} winnerIds
   */
  function orgCounts(rows, winnerIds, dim) {
    const set = new Set(winnerIds);
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      if (!set.has(String(r.tn))) continue;
      let key = "(пусто)";
      if (dim === "tb") key = (r.tb || "").trim() || "(пусто)";
      else if (dim === "gosb") key = (r.gosb || "").trim() || "(пусто)";
      else if (dim === "cluster") key = (r.cluster || "").trim() || "(пусто)";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  /**
   * @param {Array<{ slotId: string, label: string, winnerIds: string[], rows: object[], totalParticipants: number, totalWinners: number }>} slotsData
   */
  function computeWinnersDiversity(slotsData) {
    const loaded = (slotsData || []).filter((s) => s && Array.isArray(s.winnerIds));
    /** @type {Map<string, number>} */
    const appear = new Map();
    /** @type {Map<string, Set<string>>} */
    const orgSeen = { tb: new Map(), gosb: new Map(), cluster: new Map() };

    const perSlot = [];
    let prevSet = null;
    let churnSum = 0;
    let churnN = 0;

    for (let i = 0; i < loaded.length; i += 1) {
      const s = loaded[i];
      const ids = s.winnerIds.map(String);
      const set = new Set(ids);
      ids.forEach((id) => appear.set(id, (appear.get(id) || 0) + 1));

      let newCount = 0;
      let repeatCount = 0;
      if (!prevSet) {
        newCount = ids.length;
      } else {
        ids.forEach((id) => {
          if (prevSet.has(id)) repeatCount += 1;
          else newCount += 1;
        });
        const union = new Set([...prevSet, ...set]);
        const inter = [...set].filter((id) => prevSet.has(id)).length;
        const jaccard = union.size ? inter / union.size : 0;
        churnSum += 1 - jaccard;
        churnN += 1;
      }
      prevSet = set;

      const heatRow = { tb: {}, gosb: {}, cluster: {} };
      ["tb", "gosb", "cluster"].forEach((dim) => {
        const c = orgCounts(s.rows || [], ids, dim);
        c.forEach((n, key) => {
          heatRow[dim][key] = n;
          if (!orgSeen[dim].has(key)) orgSeen[dim].set(key, new Set());
          // отметим слот
          orgSeen[dim].get(key).add(s.slotId);
        });
      });

      perSlot.push({
        slotId: s.slotId,
        label: s.label || s.slotId,
        winnerCount: ids.length,
        participants: s.totalParticipants || (s.rows ? s.rows.length : 0),
        newCount,
        repeatCount,
        winnerIds: ids,
        orgHeat: heatRow
      });
    }

    const uniqueWinners = appear.size;
    let repeatPeople = 0;
    const personCounts = [];
    appear.forEach((n) => {
      personCounts.push(n);
      if (n >= 2) repeatPeople += 1;
    });
    const repeatShare = uniqueWinners ? repeatPeople / uniqueWinners : 0;
    const personHhi = hhiFromCounts(personCounts.length ? personCounts : [1]);

    // Sticky орг: доля побед в ключах, встречавшихся более чем в одном слоте
    function stickyShare(dim) {
      let stickyWins = 0;
      let allWins = 0;
      perSlot.forEach((ps) => {
        const heat = ps.orgHeat[dim] || {};
        Object.keys(heat).forEach((key) => {
          const n = heat[key] || 0;
          allWins += n;
          const slotsHit = orgSeen[dim].get(key);
          if (slotsHit && slotsHit.size >= 2) stickyWins += n;
        });
      });
      return allWins ? stickyWins / allWins : 0;
    }

    const orgSticky = {
      tb: stickyShare("tb"),
      gosb: stickyShare("gosb"),
      cluster: stickyShare("cluster")
    };

    // Покрытие и энтропия по объединённым победам активного набора
    function coverageAndEntropy(dim) {
      /** @type {Map<string, number>} */
      const totals = new Map();
      /** @type {Set<string>} */
      const allKeys = new Set();
      loaded.forEach((s) => {
        (s.rows || []).forEach((r) => {
          let key = "(пусто)";
          if (dim === "tb") key = (r.tb || "").trim() || "(пусто)";
          else if (dim === "gosb") key = (r.gosb || "").trim() || "(пусто)";
          else key = (r.cluster || "").trim() || "(пусто)";
          allKeys.add(key);
        });
        const c = orgCounts(s.rows || [], s.winnerIds, dim);
        c.forEach((n, key) => totals.set(key, (totals.get(key) || 0) + n));
      });
      const withWin = [...totals.keys()].filter((k) => (totals.get(k) || 0) > 0).length;
      const coverage = allKeys.size ? withWin / allKeys.size : 0;
      const entropyOrg = shannonNorm([...totals.values()]);
      const orgHhi = hhiFromCounts([...totals.values()]);
      return { coverage, entropyOrg, orgHhi, keys: [...allKeys], totals };
    }

    const tbMeta = coverageAndEntropy("tb");
    const gosbMeta = coverageAndEntropy("gosb");
    const clusterMeta = coverageAndEntropy("cluster");

    let winSum = 0;
    let partSum = 0;
    loaded.forEach((s) => {
      winSum += s.totalWinners != null ? s.totalWinners : s.winnerIds.length;
      partSum += s.totalParticipants || (s.rows ? s.rows.length : 0);
    });
    const inclusivity = partSum ? winSum / partSum : 0;
    const churn = churnN ? churnSum / churnN : 0;
    const personDiversity = 1 - repeatShare;

    // Зона шанса: эвристика — доля участников с |amount| в верхних 15% |max| среди непроигравших близко к мин. победителя
    let chanceZone = 0;
    let chanceN = 0;
    loaded.forEach((s) => {
      const rows = s.rows || [];
      if (!rows.length || !s.winnerIds.length) return;
      const wset = new Set(s.winnerIds.map(String));
      const wAmounts = rows.filter((r) => wset.has(String(r.tn))).map((r) => Number(r.amount) || 0);
      if (!wAmounts.length) return;
      const cutoff = Math.min(...wAmounts);
      const near = rows.filter((r) => {
        const a = Number(r.amount) || 0;
        return a < cutoff && a >= cutoff * 0.85;
      }).length;
      chanceZone += near / rows.length;
      chanceN += 1;
    });
    chanceZone = chanceN ? chanceZone / chanceN : 0;

    return {
      uniqueWinners,
      repeatPeople,
      repeatShare,
      personDiversity,
      personHhi,
      orgSticky,
      inclusivity,
      churn,
      chanceZone,
      coverageTb: tbMeta.coverage,
      coverageGosb: gosbMeta.coverage,
      coverageCluster: clusterMeta.coverage,
      entropyOrg: tbMeta.entropyOrg,
      orgHhi: tbMeta.orgHhi,
      perSlot,
      orgHeatMeta: { tb: tbMeta, gosb: gosbMeta, cluster: clusterMeta },
      metrics: {
        personHhi,
        orgHhi: tbMeta.orgHhi,
        entropyOrg: tbMeta.entropyOrg,
        inclusivity,
        chanceZone,
        coverageTb: tbMeta.coverage,
        churn,
        repeatShare
      }
    };
  }

  /**
   * @param {object} metrics
   * @param {object} targets
   * @param {object} weights
   */
  function scoreContestInterest(metrics, targets, weights) {
    const t = targets || {};
    const w = weights || {
      inclusivity: 0.2,
      personHhi: 0.2,
      orgCoverage: 0.2,
      chanceZone: 0.15,
      churn: 0.15,
      entropyOrg: 0.1
    };
    const m = metrics || {};

    function clamp01(x) {
      return Math.max(0, Math.min(1, x));
    }

    // inclusivity: идеал — внутри [min,max], иначе штраф
    const inc = Number(m.inclusivity) || 0;
    const imin = t.inclusivityMin != null ? t.inclusivityMin : 0.01;
    const imax = t.inclusivityMax != null ? t.inclusivityMax : 0.15;
    let incScore = 1;
    if (inc < imin) incScore = clamp01(inc / (imin || 1e-9));
    else if (inc > imax) incScore = clamp01(1 - (inc - imax) / Math.max(imax, 0.01));

    const hhiMax = t.personHhiMax != null ? t.personHhiMax : 0.08;
    const hhi = Number(m.personHhi) || 0;
    const hhiScore = clamp01(1 - hhi / Math.max(hhiMax * 2, 1e-9));

    const covMin = t.orgCoverageMin != null ? t.orgCoverageMin : 0.35;
    const cov = Number(m.coverageTb) || 0;
    const covScore = clamp01(cov / Math.max(covMin, 1e-9));

    const chMin = t.chanceZoneMin != null ? t.chanceZoneMin : 0.08;
    const ch = Number(m.chanceZone) || 0;
    const chScore = clamp01(ch / Math.max(chMin, 1e-9));

    const repMax = t.repeatShareMax != null ? t.repeatShareMax : 0.45;
    const churn = Number(m.churn) || 0;
    // высокий churn = хорошо (ротация); низкий repeat тоже
    const repeatShare = Number(m.repeatShare) || 0;
    const churnScore = clamp01(0.5 * churn + 0.5 * (1 - clamp01(repeatShare / Math.max(repMax, 1e-9))));

    const ent = Number(m.entropyOrg) || 0;
    const entScore = clamp01(ent);

    const score =
      100 *
      (incScore * (w.inclusivity || 0) +
        hhiScore * (w.personHhi || 0) +
        covScore * (w.orgCoverage || 0) +
        chScore * (w.chanceZone || 0) +
        churnScore * (w.churn || 0) +
        entScore * (w.entropyOrg || 0));

    return {
      score: Math.round(score * 10) / 10,
      parts: { incScore, hhiScore, covScore, chScore, churnScore, entScore }
    };
  }

  /**
   * @param {object} winnersConfig
   * @param {{ p70?: number, p80?: number, p90?: number }} quantiles
   */
  function enumerateCriteriaAlternatives(winnersConfig, quantiles) {
    const q = quantiles || {};
    const cfg = winnersConfig || { type: "tournament", tournamentItems: [], awardItems: [] };
    /** @type {object[]} */
    const out = [];

    function push(label, patch, why) {
      out.push({ label, patch, why: why || label });
    }

    if (cfg.type === "tournament") {
      const items = cfg.tournamentItems || [];
      const base = items[0] || {
        id: "alt",
        dignity: 1,
        scope: "tb",
        direction: "more",
        selectMode: "topN",
        topN: 1,
        topPct: 10,
        title: ""
      };

      [
        { scope: "country", selectMode: "topN", topN: 50, label: "Топ-50 по стране" },
        { scope: "country", selectMode: "topN", topN: 100, label: "Топ-100 по стране" },
        { scope: "country", selectMode: "topN", topN: 200, label: "Топ-200 по стране" },
        { scope: "country", selectMode: "topPct", topPct: 1, label: "Топ-1% по стране" },
        { scope: "country", selectMode: "topPct", topPct: 3, label: "Топ-3% по стране" },
        { scope: "country", selectMode: "topPct", topPct: 5, label: "Топ-5% по стране" },
        { scope: "gosb", selectMode: "topN", topN: 3, label: "Топ-3 в каждом ГОСБ" },
        { scope: "cluster", selectMode: "topN", topN: 5, label: "Топ-5 в каждом кластере" },
        { scope: "tb", selectMode: "topN", topN: 3, label: "Топ-3 в каждом ТБ" }
      ].forEach((alt) => {
        const item = Object.assign({}, base, {
          id: "alt-" + alt.scope + "-" + (alt.topN || alt.topPct),
          scope: alt.scope,
          selectMode: alt.selectMode,
          topN: alt.topN || 1,
          topPct: alt.topPct || 10
        });
        push(alt.label, { type: "tournament", tournamentItems: [item], awardItems: [] }, alt.label);
      });

      // Смесь: локальный престиж + широкий пул
      push(
        "Топ-1 в ТБ + топ-3% по стране",
        {
          type: "tournament",
          tournamentItems: [
            Object.assign({}, base, { id: "mix-tb", scope: "tb", selectMode: "topN", topN: 1, dignity: 1 }),
            Object.assign({}, base, {
              id: "mix-country",
              scope: "country",
              selectMode: "topPct",
              topPct: 3,
              dignity: 2
            })
          ],
          awardItems: []
        },
        "Локальный престиж и широкий страновой пул"
      );
    } else {
      const thr = [q.p70, q.p80, q.p90].filter((x) => x != null && Number.isFinite(Number(x)));
      thr.forEach((v, i) => {
        const pct = [70, 80, 90][i];
        push(
          "Награда: порог ≈ P" + pct + " (" + Math.round(Number(v)) + ")",
          {
            type: "award",
            awardItems: [{ id: "alt-p" + pct, criterion: Number(v), title: "P" + pct }],
            tournamentItems: []
          },
          "Порог по квантилю P" + pct
        );
      });
      if (thr.length >= 2) {
        push(
          "Две ступени: P80 и P90",
          {
            type: "award",
            awardItems: [
              { id: "alt-a1", criterion: Number(thr[1]), title: "P80" },
              { id: "alt-a2", criterion: Number(thr[thr.length - 1]), title: "P90" }
            ],
            tournamentItems: []
          },
          "Две ступени наград"
        );
      }
    }

    return out.slice(0, 24);
  }

  /**
   * @param {object} baselineMetrics
   * @param {number} baselineScore
   * @param {object[]} candidates scored
   */
  function rankSuggestions(baselineMetrics, baselineScore, candidates) {
    const base = baselineMetrics || {};
    const scored = (candidates || []).slice();
    scored.sort((a, b) => {
      const ds = (b.score || 0) - (a.score || 0);
      if (Math.abs(ds) > 0.05) return ds;
      // приоритет осям, где baseline слаб
      const needHhi = (base.personHhi || 0) > 0.08;
      if (needHhi) {
        return (a.metrics.personHhi || 0) - (b.metrics.personHhi || 0);
      }
      const needInc = (base.inclusivity || 0) < 0.01;
      if (needInc) {
        return (b.metrics.inclusivity || 0) - (a.metrics.inclusivity || 0);
      }
      return ds;
    });
    return scored
      .filter((c) => (c.score || 0) >= baselineScore - 0.5)
      .slice(0, 3)
      .map((c) => {
        const m = c.metrics || {};
        return Object.assign({}, c, {
          deltas: {
            score: Math.round(((c.score || 0) - baselineScore) * 10) / 10,
            inclusivity: (m.inclusivity || 0) - (base.inclusivity || 0),
            personHhi: (m.personHhi || 0) - (base.personHhi || 0),
            coverageTb: (m.coverageTb || 0) - (base.coverageTb || 0),
            repeatShare: (m.repeatShare || 0) - (base.repeatShare || 0)
          }
        });
      });
  }

  /**
   * Текстовый вывод 2–4 предложений.
   * @param {object} report — результат computeWinnersDiversity + interestScore
   */
  function buildDiversityNarrative(report) {
    if (!report || !report.perSlot || !report.perSlot.length) {
      return "Загрузите несколько файлов и пересчитайте победителей — здесь появится вывод об устойчивости и разнообразии.";
    }
    const parts = [];
    parts.push(
      "Уникальных победителей за все периоды: " +
        report.uniqueWinners +
        ", из них повторно побеждали " +
        report.repeatPeople +
        " (" +
        Math.round((report.repeatShare || 0) * 100) +
        "%)."
    );
    parts.push(
      "Покрытие ТБ победами: " +
        Math.round((report.coverageTb || 0) * 100) +
        "%; «липкость» ГОСБ: " +
        Math.round((report.orgSticky.gosb || 0) * 100) +
        "% (победы из уже сильных ГОСБ)."
    );
    if (report.interestScore != null) {
      parts.push("Индекс интересности критериев: " + report.interestScore + " из 100.");
    }
    if ((report.inclusivity || 0) < 0.01) {
      parts.push("Доля победителей очень мала — конкурс выглядит элитарным; стоит расширить отбор.");
    } else if ((report.inclusivity || 0) > 0.2) {
      parts.push("Победителей относительно много — престиж награды может размываться.");
    }
    return parts.join(" ");
  }

  return {
    hhiFromCounts,
    shannonNorm,
    winnerIdsFromMap,
    computeWinnersDiversity,
    scoreContestInterest,
    enumerateCriteriaAlternatives,
    rankSuggestions,
    buildDiversityNarrative
  };
});
