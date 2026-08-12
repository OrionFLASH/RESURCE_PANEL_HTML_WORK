/** Конфиг из #app-config в начале HTML (JSON). */
    const APP_CONFIG = (function loadAppConfig() {
      if (window.CONTEST_CRITERIA_CONFIG && typeof window.CONTEST_CRITERIA_CONFIG === "object") {
        return window.CONTEST_CRITERIA_CONFIG;
      }
      const node = document.getElementById("app-config");
      if (!node) throw new Error("Не найден CONTEST_CRITERIA_CONFIG / #app-config.");
      try {
        return JSON.parse(node.textContent);
      } catch (err) {
        throw new Error("Ошибка конфига: " + ((err && err.message) || err));
      }
    })();

    /** @typedef {{ tn: string, amount: number, tb: string, gosb: string, cluster: string, extras?: Record<string, number> }} DataRow */

    /**
     * Подписи периодов сравнения.
     * Внутри кода A = текущий, B = прошлый.
     */
    const PERIOD_CUR = {
      code: "A",
      label: "Текущий период",
      short: "Тек",
      prefix: "Текущий · "
    };
    const PERIOD_PREV = {
      code: "B",
      label: "Прошлый период",
      short: "Прош",
      prefix: "Прошлый · "
    };

    /** @type {DataRow[]} сырые строки текущего периода */
    let rawRows = [];
    /** @type {DataRow[]} агрегаты по ТН текущего периода */
    let allRows = [];
    /** @type {{ hasTb: boolean, hasGosb: boolean, hasCluster: boolean }} флаги колонок текущего периода */
    let presenceA = { hasTb: false, hasGosb: false, hasCluster: false };
    /** @type {{ hasTb: boolean, hasGosb: boolean, hasCluster: boolean }} */
    let columnPresence = { hasTb: false, hasGosb: false, hasCluster: false };

    /** Прошлый период (режим сравнения) */
    let rawRowsB = [];
    let allRowsB = [];
    let presenceB = { hasTb: false, hasGosb: false, hasCluster: false };
    let columnPresenceB = { hasTb: false, hasGosb: false, hasCluster: false };
    let fileNameA = "";
    let fileNameB = "";

    /** @type {"single"} страница только одного периода */
    let viewMode = "single";
    /** Пока вкладка анализа закрыта — не считаем тяжёлую статистику; при открытии пересчитаем. */
    let analysisDirty = true;
    let analysisRenderTimer = 0;

    /** Сырой файл для перепарсинга при смене показателя */
    /** @type {{ text: string, headers: string[], delimiter: string, rawLines: string[], fileName: string } | null} */
    let lastParsed = null;

    /** Мультислоты данных (до 12) */
    /** @type {"months"|"quarters"|"pair"|"custom"} */
    let slotMode = String(APP_CONFIG.defaultSlotMode || "pair");
    let customSlotCount = 3;
    /** @type {{ id: string, label: string, fileName: string, text: string, rawRows: DataRow[], allRows: DataRow[], presence: object }[]} */
    let dataSlots = [];
    let activeSlotId = "";
    /** @type {object|null} */
    let diversityReport = null;
    /** @type {"tb"|"gosb"|"cluster"} */
    let diversityOrgDim = "tb";
    /** Снимок фильтров/границ для «применить ко всем» */
    let sharedSettings = null;

    const CI = (typeof ContestInterest !== "undefined") ? ContestInterest : null;

    function maxDataSlots() {
      const n = Number(APP_CONFIG.maxDataSlots);
      return Number.isFinite(n) && n > 0 ? Math.min(12, Math.round(n)) : 12;
    }

    function defaultLabelsForMode(mode, count) {
      if (mode === "months") return (APP_CONFIG.monthLabels || []).slice(0, 12);
      if (mode === "quarters") return (APP_CONFIG.quarterLabels || ["Q1", "Q2", "Q3", "Q4"]).slice(0, 4);
      if (mode === "pair") return (APP_CONFIG.pairLabels || ["Прошлый", "Текущий"]).slice(0, 2);
      const n = Math.max(1, Math.min(maxDataSlots(), count || 1));
      const labels = [];
      for (let i = 0; i < n; i += 1) labels.push("Файл " + (i + 1));
      return labels;
    }

    function slotCountForMode(mode) {
      if (mode === "months") return 12;
      if (mode === "quarters") return 4;
      if (mode === "pair") return 2;
      return Math.max(1, Math.min(maxDataSlots(), customSlotCount || 1));
    }

    function rebuildDataSlots(preserveData) {
      const labels = defaultLabelsForMode(slotMode, slotCountForMode(slotMode));
      const prev = preserveData ? dataSlots.slice() : [];
      const next = labels.map((label, i) => {
        const id = "slot-" + i;
        const old = prev[i];
        if (old && preserveData) {
          // Месяцы/кварталы/пара — подписи режима; в custom оставляем ручное имя слота
          const keepCustomLabel = slotMode === "custom" && old.label;
          return {
            id,
            label: keepCustomLabel ? old.label : label,
            fileName: old.fileName || "",
            text: old.text || "",
            rawRows: old.rawRows || [],
            allRows: old.allRows || [],
            presence: old.presence || { hasTb: false, hasGosb: false, hasCluster: false }
          };
        }
        return {
          id,
          label,
          fileName: "",
          text: "",
          rawRows: [],
          allRows: [],
          presence: { hasTb: false, hasGosb: false, hasCluster: false }
        };
      });
      dataSlots = next;
      if (!dataSlots.some((s) => s.id === activeSlotId)) {
        activeSlotId = dataSlots[0] ? dataSlots[0].id : "";
      }
      renderSlotsRail();
      syncActiveSlotToGlobals(false);
    }

    function getActiveSlot() {
      return dataSlots.find((s) => s.id === activeSlotId) || dataSlots[0] || null;
    }

    function loadedSlots() {
      return dataSlots.filter((s) => s.allRows && s.allRows.length);
    }

    function syncActiveSlotToGlobals(doRebuild) {
      const slot = getActiveSlot();
      if (!slot) {
        rawRows = [];
        allRows = [];
        presenceA = { hasTb: false, hasGosb: false, hasCluster: false };
        fileNameA = "";
        lastParsed = null;
        return;
      }
      rawRows = slot.rawRows || [];
      allRows = slot.allRows || [];
      presenceA = slot.presence || { hasTb: false, hasGosb: false, hasCluster: false };
      fileNameA = slot.fileName || "";
      if (slot.text) {
        lastParsed = {
          text: slot.text,
          headers: [],
          delimiter: ";",
          rawLines: [],
          fileName: slot.fileName || ""
        };
      } else {
        lastParsed = null;
      }
      if (doRebuild) {
        refreshPresenceAndFilters(true);
        initEdgeStateFromData(true);
        rebuild();
      }
    }

    function setActiveSlot(id) {
      if (!dataSlots.some((s) => s.id === id)) return;
      activeSlotId = id;
      renderSlotsRail();
      syncActiveSlotToGlobals(true);
      renderFileOverview(el.fileOverviewA, {
        fileName: fileNameA,
        rawCount: rawRows.length,
        tnCount: allRows.length,
        rows: allRows,
        presence: presenceA,
        skipped: 0
      });
    }

    function renderSlotsRail() {
      const rail = document.getElementById("slotsRail");
      if (!rail) return;
      rail.innerHTML = dataSlots.map((slot) => {
        const loaded = slot.allRows && slot.allRows.length;
        const status = loaded
          ? (escapeHtml(slot.fileName || "файл") + "<br>" + slot.allRows.length + " уч.")
          : "Пусто — загрузите CSV";
        return (
          '<div class="slot-card' + (slot.id === activeSlotId ? " is-active" : "") +
          (loaded ? " is-loaded" : "") + '" data-slot-id="' + escapeHtml(slot.id) + '">' +
            '<div class="slot-card__label" contenteditable="true" spellcheck="false" data-slot-label="' +
              escapeHtml(slot.id) + '">' + escapeHtml(slot.label) + '</div>' +
            '<div class="slot-card__status">' + status + '</div>' +
            '<div class="slot-card__actions">' +
              '<label class="btn secondary slot-card__file-btn">Файл' +
                '<input type="file" accept=".csv,text/csv,text/plain,.tsv,.txt" data-slot-file="' +
                  escapeHtml(slot.id) + '">' +
              '</label>' +
              '<button type="button" class="btn ghost" data-slot-clear="' + escapeHtml(slot.id) + '">✕</button>' +
            '</div>' +
          '</div>'
        );
      }).join("");
    }

    /** Алиасы для скоринга кодировки при чтении файла. */
    function encodingDetectOpts() {
      const indAliases = getIndicatorAliases();
      const amount = APP_CONFIG.amountColumnAliases || [];
      const hints = []
        .concat(APP_CONFIG.tbColumnAliases || [])
        .concat(APP_CONFIG.gosbColumnAliases || [])
        .concat(APP_CONFIG.clusterColumnAliases || []);
      return {
        requiredAliases: [indAliases, amount],
        hintAliases: hints
      };
    }

    async function loadFileIntoSlot(slotId, file) {
      const slot = dataSlots.find((s) => s.id === slotId);
      if (!slot || !file) return;
      const sizeKb = Math.max(1, Math.round((file.size || 0) / 1024));
      setLoadStatus(
        "Читаю «" + (file.name || "файл") + "» (" + sizeKb + " КБ)…\nОпределяю кодировку и заголовки…",
        "ok"
      );
      try {
        const decoded = await readFileAsText(file);
        const fileText = decoded.text;
        const encoding = decoded.encoding || "utf-8";
        setLoadStatus(
          "Файл прочитан («" + encoding + "»). Разбираю таблицу…",
          "ok"
        );
        const parsed = parseTableText(fileText);
        slot.text = fileText;
        slot.fileName = file.name || "";
        slot.encoding = encoding;
        slot.rawRows = parsed.rows;
        slot.presence = {
          hasTb: !!parsed.meta.hasTb,
          hasGosb: !!parsed.meta.hasGosb,
          hasCluster: !!parsed.meta.hasCluster
        };
        slot.allRows = aggregateByTn(slot.rawRows);
        activeSlotId = slotId;
        renderSlotsRail();
        syncActiveSlotToGlobals(false);
        renderFileOverview(el.fileOverviewA, {
          fileName: fileNameA,
          rawCount: rawRows.length,
          tnCount: allRows.length,
          rows: allRows,
          presence: presenceA,
          skipped: parsed.meta.skipped || 0
        });
        refreshPresenceAndFilters(true);
        initEdgeStateFromData(true);
        rebuild();
        const headers = (parsed.meta.headers || []).join(", ");
        const skipped = parsed.meta.skipped || 0;
        syncParticipationUiFromConfig();
        setLoadStatus(
          "✓ Загружено в «" + slot.label + "»\n" +
            "Файл: " + (slot.fileName || "—") + "\n" +
            "Кодировка: " + encoding + "\n" +
            "Заголовки: " + headers + "\n" +
            "Строк данных: " + (parsed.meta.totalLines || slot.rawRows.length) +
            "; валидных: " + slot.rawRows.length +
            "; уникальных уч.: " + slot.allRows.length +
            (skipped ? "; пропущено: " + skipped : ""),
          "ok"
        );
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        setLoadStatus(
          "✗ Не удалось загрузить в «" + slot.label + "»\n" +
            "Файл: " + (file.name || "—") + "\n" +
            msg + "\n" +
            "Подсказка: проверьте, что есть колонки показателя (ТН/КПК/ИНН) и «сумма»; " +
            "если файл из Excel/Windows — кодировка должна определиться сама (UTF-8 / windows-1251).",
          "err"
        );
        throw err;
      }
    }

    function clearSlot(slotId) {
      const slot = dataSlots.find((s) => s.id === slotId);
      if (!slot) return;
      slot.fileName = "";
      slot.text = "";
      slot.rawRows = [];
      slot.allRows = [];
      slot.presence = { hasTb: false, hasGosb: false, hasCluster: false };
      renderSlotsRail();
      if (slotId === activeSlotId) {
        syncActiveSlotToGlobals(false);
        resetUiAfterDataClear();
      }
    }

    function clearAllSlots() {
      dataSlots.forEach((s) => {
        s.fileName = "";
        s.text = "";
        s.rawRows = [];
        s.allRows = [];
        s.presence = { hasTb: false, hasGosb: false, hasCluster: false };
      });
      renderSlotsRail();
      syncActiveSlotToGlobals(false);
      clearPeriodA();
      clearPeriodB();
      resetUiAfterDataClear();
      diversityReport = null;
      renderDiversityPanel();
    }

    function reparseAllSlotsFromText() {
      let errors = 0;
      dataSlots.forEach((slot) => {
        if (!slot.text) return;
        try {
          const parsed = parseTableText(slot.text);
          slot.rawRows = parsed.rows;
          slot.presence = {
            hasTb: !!parsed.meta.hasTb,
            hasGosb: !!parsed.meta.hasGosb,
            hasCluster: !!parsed.meta.hasCluster
          };
          slot.allRows = aggregateByTn(slot.rawRows);
        } catch (e) {
          errors += 1;
        }
      });
      renderSlotsRail();
      syncActiveSlotToGlobals(true);
      if (errors) setLoadStatus("Не удалось перепарсить слотов: " + errors, "err");
    }

    function captureSharedSettingsFromUi() {
      sharedSettings = {
        filterSelections: {
          tb: new Set(filterSelections.tb),
          gosb: new Set(filterSelections.gosb),
          cluster: new Set(filterSelections.cluster)
        },
        edges: (edgeState.edges || []).slice(),
        min: edgeState.min,
        max: edgeState.max
      };
      return sharedSettings;
    }

    function applySharedSettingsToUi() {
      if (!sharedSettings) return;
      filterSelections = {
        tb: new Set(sharedSettings.filterSelections.tb),
        gosb: new Set(sharedSettings.filterSelections.gosb),
        cluster: new Set(sharedSettings.filterSelections.cluster)
      };
      if (sharedSettings.edges && sharedSettings.edges.length >= 2) {
        edgeState.edges = sharedSettings.edges.slice();
        edgeState.min = sharedSettings.min;
        edgeState.max = sharedSettings.max;
        renderEdgeRail();
      }
      rebuildFilterOptions(false);
      rebuild();
    }

    function filteredRowsForSlot(slot) {
      const rows = slot.allRows || [];
      if (!rows.length) return [];
      return filteredRowsFrom(rows);
    }

    function computeWinnersForAllSlots() {
      const edges = (lastChartState && lastChartState.edges) || edgeState.edges || [];
      const labels = (lastChartState && lastChartState.hist && lastChartState.hist.labels) || [];
      /** @type {Map<string, object>} */
      const bySlot = new Map();
      loadedSlots().forEach((slot) => {
        const rows = filteredRowsForSlot(slot);
        const result = computeWinnersResult(rows, edges, labels);
        bySlot.set(slot.id, result);
      });
      return bySlot;
    }

    function buildDiversityFromSlots(winnersBySlot) {
      if (!CI) return null;
      const slotsData = loadedSlots().map((slot) => {
        const res = winnersBySlot.get(slot.id);
        const map = res && res.map;
        const winnerIds = CI.winnerIdsFromMap(map || new Map());
        return {
          slotId: slot.id,
          label: slot.label,
          winnerIds,
          rows: filteredRowsForSlot(slot),
          totalParticipants: res ? res.totalParticipants : 0,
          totalWinners: res ? res.totalWinners : 0
        };
      });
      if (slotsData.length < 1) return null;
      const report = CI.computeWinnersDiversity(slotsData);
      const scored = CI.scoreContestInterest(
        report.metrics,
        APP_CONFIG.interestTargets,
        APP_CONFIG.interestWeights
      );
      report.interestScore = scored.score;
      report.scoreParts = scored.parts;
      report.narrative = CI.buildDiversityNarrative(report);
      return report;
    }

    function renderDiversityPanel() {
      const hero = document.getElementById("diversityHero");
      const narrative = document.getElementById("diversityNarrative");
      if (narrative) {
        narrative.textContent = (diversityReport && diversityReport.narrative) ||
          "Загрузите 2+ файла, задайте критерии и пересчитайте — здесь будет вывод.";
      }
      if (!hero) return;
      if (!diversityReport) {
        hero.innerHTML = "";
        drawDiversityCharts(null);
        return;
      }
      const r = diversityReport;
      const card = (n, l) =>
        '<div class="diversity-stat"><div class="diversity-stat__n">' + n +
        '</div><div class="diversity-stat__l">' + l + "</div></div>";
      hero.innerHTML =
        card(r.interestScore != null ? r.interestScore : "—", "Interest Score") +
        card(r.uniqueWinners, "уникальных победителей") +
        card(Math.round((r.repeatShare || 0) * 100) + "%", "повторники") +
        card(Math.round((r.personDiversity || 0) * 100) + "%", "разнообразие людей") +
        card(Math.round((r.orgSticky.gosb || 0) * 100) + "%", "липкость ГОСБ") +
        card(Math.round((r.coverageTb || 0) * 100) + "%", "покрытие ТБ");
      drawDiversityCharts(r);
    }

    function drawDiversityCharts(report) {
      const churnCanvas = document.getElementById("diversityChurnChart");
      const heatCanvas = document.getElementById("diversityHeatChart");
      if (churnCanvas) {
        const ctx = churnCanvas.getContext("2d");
        const w = churnCanvas.width;
        const h = churnCanvas.height;
        ctx.clearRect(0, 0, w, h);
        if (report && report.perSlot && report.perSlot.length) {
          const items = report.perSlot;
          const maxV = Math.max(1, ...items.map((x) => x.newCount + x.repeatCount));
          const gap = 8;
          const barW = Math.max(12, (w - 40 - gap * items.length) / items.length);
          items.forEach((it, i) => {
            const x = 28 + i * (barW + gap);
            const total = it.newCount + it.repeatCount;
            const bh = (total / maxV) * (h - 36);
            const y = h - 24 - bh;
            const repH = total ? (it.repeatCount / total) * bh : 0;
            ctx.fillStyle = "rgba(0,122,255,0.85)";
            ctx.fillRect(x, y, barW, bh - repH);
            ctx.fillStyle = "rgba(88,86,214,0.85)";
            ctx.fillRect(x, y + (bh - repH), barW, repH);
            ctx.fillStyle = "#6e6e73";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(String(it.label).slice(0, 8), x + barW / 2, h - 8);
          });
          ctx.fillStyle = "#1d1d1f";
          ctx.font = "11px sans-serif";
          ctx.textAlign = "left";
          ctx.fillText("новые", 8, 14);
          ctx.fillStyle = "#5856D6";
          ctx.fillText("повторные", 60, 14);
        }
      }
      if (heatCanvas) {
        const ctx = heatCanvas.getContext("2d");
        const w = heatCanvas.width;
        const h = heatCanvas.height;
        ctx.clearRect(0, 0, w, h);
        if (report && report.perSlot && report.perSlot.length) {
          const dim = diversityOrgDim;
          /** @type {Map<string, number>} */
          const keyTotals = new Map();
          report.perSlot.forEach((ps) => {
            const heat = (ps.orgHeat && ps.orgHeat[dim]) || {};
            Object.keys(heat).forEach((k) => keyTotals.set(k, (keyTotals.get(k) || 0) + heat[k]));
          });
          const keys = [...keyTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]);
          const cols = report.perSlot;
          const maxCell = Math.max(1, ...cols.flatMap((ps) => keys.map((k) => ((ps.orgHeat[dim] || {})[k] || 0))));
          const left = 90;
          const top = 8;
          const cw = (w - left - 8) / Math.max(1, cols.length);
          const rh = (h - top - 20) / Math.max(1, keys.length);
          keys.forEach((key, ri) => {
            ctx.fillStyle = "#6e6e73";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(String(key).slice(0, 14), left - 6, top + ri * rh + rh * 0.65);
            cols.forEach((ps, ci) => {
              const v = ((ps.orgHeat[dim] || {})[key] || 0);
              const a = 0.12 + 0.78 * (v / maxCell);
              ctx.fillStyle = "rgba(0,122,255," + a.toFixed(3) + ")";
              ctx.fillRect(left + ci * cw + 1, top + ri * rh + 1, cw - 2, rh - 2);
              if (v > 0) {
                ctx.fillStyle = "#1d1d1f";
                ctx.font = "10px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(String(v), left + ci * cw + cw / 2, top + ri * rh + rh * 0.65);
              }
            });
          });
          cols.forEach((ps, ci) => {
            ctx.fillStyle = "#6e6e73";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(String(ps.label).slice(0, 8), left + ci * cw + cw / 2, h - 4);
          });
        }
      }
    }

    function amountQuantilesFromActive() {
      const rows = allRows.length ? allRows : (getActiveSlot() && getActiveSlot().allRows) || [];
      const vals = rows.map((r) => Number(r.amount) || 0).sort((a, b) => a - b);
      if (!vals.length) return {};
      const q = (p) => {
        const pos = (vals.length - 1) * p;
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        if (lo === hi) return vals[lo];
        return vals[lo] * (1 - (pos - lo)) + vals[hi] * (pos - lo);
      };
      return { p70: q(0.7), p80: q(0.8), p90: q(0.9) };
    }

    function runSuggestBetter() {
      const box = document.getElementById("suggestCards");
      if (!box) return;
      if (!CI) {
        box.innerHTML = '<p class="winners-level-empty">Модуль ContestInterest не загружен.</p>';
        return;
      }
      if (!loadedSlots().length) {
        box.innerHTML = '<p class="winners-level-empty">Сначала загрузите хотя бы один файл.</p>';
        return;
      }
      winnersConfigFromDom();
      const winnersBySlot = computeWinnersForAllSlots();
      const baselineDiv = buildDiversityFromSlots(winnersBySlot);
      if (!baselineDiv) {
        box.innerHTML = '<p class="winners-level-empty">Недостаточно данных для оценки.</p>';
        return;
      }
      diversityReport = baselineDiv;
      renderDiversityPanel();

      const alts = CI.enumerateCriteriaAlternatives(winnersConfig, amountQuantilesFromActive());
      const prevCfg = JSON.parse(JSON.stringify(winnersConfig));
      const candidates = [];
      alts.forEach((alt) => {
        winnersConfig = sanitizeWinnersConfig(alt.patch);
        const wb = computeWinnersForAllSlots();
        const div = buildDiversityFromSlots(wb);
        if (!div) return;
        candidates.push({
          label: alt.label,
          why: alt.why,
          patch: alt.patch,
          metrics: div.metrics,
          score: div.interestScore,
          totalWinnersAvg: loadedSlots().reduce((a, s) => {
            const r = wb.get(s.id);
            return a + (r ? r.totalWinners : 0);
          }, 0) / Math.max(1, loadedSlots().length)
        });
      });
      winnersConfig = sanitizeWinnersConfig(prevCfg);
      renderWinnersList();

      const ranked = CI.rankSuggestions(baselineDiv.metrics, baselineDiv.interestScore, candidates);
      if (!ranked.length) {
        box.innerHTML = '<p class="winners-level-empty">Не удалось найти вариант лучше текущего. Критерии уже сбалансированы.</p>';
        return;
      }
      box.innerHTML = ranked.map((c, idx) => {
        const d = c.deltas || {};
        return (
          '<div class="suggest-card" data-suggest-idx="' + idx + '">' +
            '<p class="suggest-card__title">' + escapeHtml(c.label) + "</p>" +
            '<p class="suggest-card__meta">' + escapeHtml(c.why || "") +
            " · score " + baselineDiv.interestScore + " → " + c.score +
            " (" + (d.score >= 0 ? "+" : "") + d.score + ")" +
            " · inclusivity " + ((d.inclusivity || 0) >= 0 ? "+" : "") + Math.round((d.inclusivity || 0) * 1000) / 10 + " п.п." +
            " · покрытие ТБ " + ((d.coverageTb || 0) >= 0 ? "+" : "") + Math.round((d.coverageTb || 0) * 1000) / 10 + " п.п.</p>" +
            '<div class="suggest-card__actions">' +
              '<button type="button" class="btn secondary small" data-suggest-apply="' + idx + '">Применить</button>' +
              '<button type="button" class="btn ghost small" data-suggest-preview="' + idx + '">Как на активном</button>' +
            "</div></div>"
        );
      }).join("");
      box._suggestRanked = ranked;
    }

    function applySuggestPatch(patch, persist) {
      if (!patch) return;
      winnersConfig = sanitizeWinnersConfig(patch);
      if (persist !== false) persistWinnersConfig();
      renderWinnersList();
      if (allRows.length) rebuild({ light: false });
      else refreshWinnersPreview();
    }

    function getIndicatorVariants() {
      const list = APP_CONFIG.indicatorVariants;
      if (Array.isArray(list) && list.length) return list;
      return [{
        id: "tn",
        label: "ТН",
        aliases: APP_CONFIG.tnColumnAliases || ["тн", "tn"]
      }];
    }

    function getSelectedIndicatorId() {
      const sel = document.getElementById("indicatorSelect");
      const raw = (sel && sel.value) || APP_CONFIG.defaultIndicatorId || "tn";
      const variants = getIndicatorVariants();
      if (variants.some((v) => v.id === raw)) return raw;
      return (variants[0] && variants[0].id) || "tn";
    }

    function getSelectedIndicator() {
      const id = getSelectedIndicatorId();
      const variants = getIndicatorVariants();
      return variants.find((v) => v.id === id) || variants[0] || {
        id: "tn",
        label: "Показатель",
        aliases: APP_CONFIG.tnColumnAliases || ["тн"]
      };
    }

    function getIndicatorAliases(optionalAliases) {
      if (Array.isArray(optionalAliases) && optionalAliases.length) return optionalAliases;
      const ind = getSelectedIndicator();
      if (ind && Array.isArray(ind.aliases) && ind.aliases.length) return ind.aliases;
      return APP_CONFIG.tnColumnAliases || ["тн", "tn"];
    }

    function indicatorLabel() {
      const ind = getSelectedIndicator();
      return (ind && ind.label) || "Показатель";
    }

    /** Состояние ручных границ */
    const edgeState = {
      min: 0,
      max: 1,
      /** @type {number[]} полные рёбра включая min/max */
      edges: [],
      dragIndex: -1,
      /** Индекс активной подвижной границы для увеличенной тонкой настройки */
      fineIndex: -1
    };
    let edgeRebuildRaf = 0;
    let edgeRebuildFullPending = false;

    /** Перерисовка после движения бегунка: light во время drag, полный — по окончании. */
    function requestRebuildEdge(full) {
      if (full) edgeRebuildFullPending = true;
      if (edgeRebuildRaf) return;
      edgeRebuildRaf = requestAnimationFrame(() => {
        edgeRebuildRaf = 0;
        // Light только пока тянем основной или fine-бегунок
        const interacting = edgeState.dragIndex >= 0;
        const doFull = edgeRebuildFullPending || !interacting;
        edgeRebuildFullPending = false;
        rebuild({ light: !doFull });
      });
    }

    /** Последний расчёт для экспорта */
    let lastChartState = null;

    /* —— Параметры победителей (память + расчёт) —— */
    const WINNERS_STORAGE_KEY = "contestCriteria.winners.v2";
    const COMPARE_OPS = {
      gt: { label: ">", fn: (a, b) => a > b },
      gte: { label: "≥", fn: (a, b) => a >= b },
      lt: { label: "<", fn: (a, b) => a < b },
      lte: { label: "≤", fn: (a, b) => a <= b },
      eq: { label: "=", fn: (a, b) => a === b }
    };
    const DIGNITY_META = {
      1: { label: "Золото", cls: "gold" },
      2: { label: "Серебро", cls: "silver" },
      3: { label: "Бронза", cls: "bronze" }
    };
    const SCOPE_LABELS = {
      country: "Вся страна",
      tb: "Среди ТБ",
      gosb: "Среди ГОСБ",
      cluster: "Среди кластера",
      group: "Среди группы (интервал)"
    };

    function winnersUid() {
      return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /** @returns {{ type: string, awardItems: object[], tournamentItems: object[], participation: object }} */
    function defaultWinnersConfig() {
      return {
        type: "award",
        participation: {
          primary: { enabled: false, op: "gt", value: 0 },
          secondary: { enabled: false, column: "", op: "gte", value: 85 }
        },
        awardItems: [
          { id: winnersUid(), criterion: 1 },
          { id: winnersUid(), criterion: 2 },
          { id: winnersUid(), criterion: 3 }
        ],
        tournamentItems: [
          {
            id: winnersUid(),
            dignity: 1,
            scope: "country",
            direction: "more",
            selectMode: "topN",
            topN: 1,
            topPct: 10
          },
          {
            id: winnersUid(),
            dignity: 2,
            scope: "country",
            direction: "more",
            selectMode: "topN",
            topN: 2,
            topPct: 10
          },
          {
            id: winnersUid(),
            dignity: 3,
            scope: "tb",
            direction: "more",
            selectMode: "topPct",
            topN: 1,
            topPct: 10
          }
        ]
      };
    }

    /** @type {{ type: string, awardItems: object[], tournamentItems: object[], participation: object }} */
    let winnersConfig = loadWinnersConfig();

    function sanitizeCompareOp(op) {
      return (op && COMPARE_OPS[op]) ? op : "gte";
    }

    function sanitizeParticipation(raw) {
      const base = defaultWinnersConfig().participation;
      const src = (raw && typeof raw === "object") ? raw : {};
      const primary = (src.primary && typeof src.primary === "object") ? src.primary : {};
      const secondary = (src.secondary && typeof src.secondary === "object") ? src.secondary : {};
      return {
        primary: {
          enabled: !!(primary.enabled),
          op: sanitizeCompareOp(primary.op || base.primary.op),
          value: Number.isFinite(Number(primary.value)) ? Number(primary.value) : base.primary.value
        },
        secondary: {
          enabled: !!(secondary.enabled),
          column: secondary.column != null ? String(secondary.column).trim() : "",
          op: sanitizeCompareOp(secondary.op || base.secondary.op),
          value: Number.isFinite(Number(secondary.value)) ? Number(secondary.value) : base.secondary.value
        }
      };
    }

    function sanitizeWinnersConfig(raw) {
      const base = defaultWinnersConfig();
      if (!raw || typeof raw !== "object") return base;
      const type = raw.type === "tournament" ? "tournament" : "award";
      const awardItems = Array.isArray(raw.awardItems) ? raw.awardItems : base.awardItems;
      const tournamentItems = Array.isArray(raw.tournamentItems) ? raw.tournamentItems : base.tournamentItems;
      return {
        type,
        participation: sanitizeParticipation(raw.participation),
        awardItems: awardItems.map((it) => ({
          id: String((it && it.id) || winnersUid()),
          criterion: Number.isFinite(Number(it && it.criterion)) ? Number(it.criterion) : 0,
          title: it && it.title ? String(it.title) : ""
        })).filter(Boolean),
        tournamentItems: tournamentItems.map((it) => {
          const dig = Number(it && it.dignity);
          const scope = (it && SCOPE_LABELS[it.scope]) ? it.scope : "country";
          const direction = (it && it.direction === "less") ? "less" : "more";
          const selectMode = (it && it.selectMode === "topPct") ? "topPct" : "topN";
          return {
            id: String((it && it.id) || winnersUid()),
            dignity: (dig === 2 || dig === 3) ? dig : 1,
            scope,
            direction,
            selectMode,
            topN: Math.max(1, Math.round(Number(it && it.topN) || 1)),
            topPct: Math.max(0.01, Math.min(100, Number(it && it.topPct) || 10)),
            title: it && it.title ? String(it.title) : ""
          };
        }).filter(Boolean)
      };
    }

    function loadWinnersConfig() {
      try {
        let raw = localStorage.getItem(WINNERS_STORAGE_KEY);
        if (!raw) raw = localStorage.getItem("contestCriteria.winners.v1");
        if (!raw) return defaultWinnersConfig();
        return sanitizeWinnersConfig(JSON.parse(raw));
      } catch (_err) {
        return defaultWinnersConfig();
      }
    }

    function saveWinnersConfig() {
      try {
        localStorage.setItem(WINNERS_STORAGE_KEY, JSON.stringify(winnersConfig));
      } catch (_err) {
        /* quota / private mode — память сессии всё равно есть */
      }
    }

    function awardPrizeLabel(item) {
      const title = (item.title || "").trim();
      if (title) return title;
      const c = Number(item.criterion);
      return "Награда ≥ " + (Number.isFinite(c) ? formatAmount(c) : String(item.criterion));
    }

    function tournamentPrizeLabel(item) {
      const title = (item.title || "").trim();
      if (title) return title;
      const dig = DIGNITY_META[item.dignity] || DIGNITY_META[1];
      const scope = SCOPE_LABELS[item.scope] || item.scope;
      const dir = item.direction === "less" ? "меньше = лучше" : "больше = лучше";
      const sel = item.selectMode === "topPct"
        ? ("топ " + item.topPct + "%")
        : ("топ " + item.topN);
      return dig.label + " · " + scope + " · " + sel + " (" + dir + ")";
    }

    /**
     * Значение второстепенной колонки у строки (по имени заголовка).
     * @param {DataRow} row
     * @param {string} column
     * @returns {number|null}
     */
    function extraValueForColumn(row, column) {
      const want = normalizeHeader(column);
      if (!want || !row || !row.extras) return null;
      const keys = Object.keys(row.extras);
      for (let i = 0; i < keys.length; i += 1) {
        if (normalizeHeader(keys[i]) === want) {
          const v = Number(row.extras[keys[i]]);
          return Number.isFinite(v) ? v : null;
        }
      }
      return null;
    }

    /**
     * Есть ли колонка среди extras хотя бы у одной строки.
     * @param {DataRow[]} rows
     * @param {string} column
     */
    function rowsHaveExtraColumn(rows, column) {
      const want = normalizeHeader(column);
      if (!want || !rows || !rows.length) return false;
      for (let i = 0; i < rows.length; i += 1) {
        if (extraValueForColumn(rows[i], column) != null) return true;
        const extras = rows[i] && rows[i].extras;
        if (!extras) continue;
        const keys = Object.keys(extras);
        for (let k = 0; k < keys.length; k += 1) {
          if (normalizeHeader(keys[k]) === want) return true;
        }
      }
      return false;
    }

    /**
     * Фильтр участников по критериям участия.
     * Второстепенный: если колонки нет в данных — не применяется (участвуют все по этому пункту).
     * @param {DataRow[]} rows
     * @returns {{ rows: DataRow[], meta: object }}
     */
    function filterParticipationRows(rows) {
      const safe = Array.isArray(rows) ? rows : [];
      const part = (winnersConfig && winnersConfig.participation)
        ? winnersConfig.participation
        : defaultWinnersConfig().participation;
      const primary = part.primary || {};
      const secondary = part.secondary || {};
      const primaryOp = COMPARE_OPS[sanitizeCompareOp(primary.op)] || COMPARE_OPS.gt;
      const secondaryOp = COMPARE_OPS[sanitizeCompareOp(secondary.op)] || COMPARE_OPS.gte;
      const primaryEnabled = !!primary.enabled;
      const secondaryWanted = !!secondary.enabled && !!(secondary.column && String(secondary.column).trim());
      const secondaryPresent = secondaryWanted && rowsHaveExtraColumn(safe, secondary.column);
      const secondaryApplied = secondaryWanted && secondaryPresent;
      const secondarySkippedMissing = secondaryWanted && !secondaryPresent;

      /** @type {DataRow[]} */
      const out = [];
      for (let i = 0; i < safe.length; i += 1) {
        const row = safe[i];
        if (primaryEnabled) {
          const amt = Number(row.amount) || 0;
          if (!primaryOp.fn(amt, Number(primary.value))) continue;
        }
        if (secondaryApplied) {
          const v = extraValueForColumn(row, secondary.column);
          if (v == null || !secondaryOp.fn(v, Number(secondary.value))) continue;
        }
        out.push(row);
      }
      return {
        rows: out,
        meta: {
          before: safe.length,
          after: out.length,
          primaryApplied: primaryEnabled,
          secondaryApplied,
          secondarySkippedMissing,
          secondaryColumn: secondary.column ? String(secondary.column).trim() : ""
        }
      };
    }

    /**
     * Карта победителей + отчёт по уровням.
     * @param {DataRow[]} rows
     * @param {number[]} edges
     * @param {string[]} labels
     * @returns {{
     *   map: Map<string, { won: boolean, prizes: string[] }>,
     *   totalParticipants: number,
     *   totalWinners: number,
     *   type: string,
     *   rules: object[],
     *   participation: object
     * }}
     */
    function computeWinnersResult(rows, edges, labels) {
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

      /** @type {object[]} */
      const rules = [];
      const filtered = filterParticipationRows(rows);
      const safeRows = filtered.rows;
      const participationMeta = filtered.meta;

      /**
       * @param {DataRow} row
       * @param {string} scope
       */
      function scopeKey(row, scope) {
        if (scope === "tb") return (row.tb || "").trim() || "(пусто)";
        if (scope === "gosb") return (row.gosb || "").trim() || "(пусто)";
        if (scope === "cluster") return (row.cluster || "").trim() || "(пусто)";
        if (scope === "group") {
          return groupNameForAmount(row.amount, edges, labels || []) || "(без группы)";
        }
        return "Вся страна";
      }

      /**
       * @param {string} scope
       * @param {DataRow[]} winners
       * @param {DataRow[]} allInScope
       */
      function buildLevels(scope, winners, allInScope) {
        /** @type {Map<string, { key: string, participants: number, winners: DataRow[] }>} */
        const buckets = new Map();
        const bump = (key, field, row) => {
          if (!buckets.has(key)) buckets.set(key, { key, participants: 0, winners: [] });
          const b = buckets.get(key);
          if (field === "p") b.participants += 1;
          else b.winners.push(row);
        };
        for (let i = 0; i < allInScope.length; i += 1) {
          bump(scopeKey(allInScope[i], scope), "p", allInScope[i]);
        }
        for (let i = 0; i < winners.length; i += 1) {
          bump(scopeKey(winners[i], scope), "w", winners[i]);
        }
        const levels = [...buckets.values()].map((b) => ({
          key: b.key,
          label: b.key,
          participants: b.participants,
          winnerCount: b.winners.length,
          winners: b.winners
            .slice()
            .sort((a, c) => (Number(c.amount) || 0) - (Number(a.amount) || 0))
            .map((r) => ({
              tn: r.tn,
              amount: Number(r.amount) || 0,
              tb: r.tb || "",
              gosb: r.gosb || "",
              cluster: r.cluster || ""
            }))
        }));
        levels.sort((a, b) => b.winnerCount - a.winnerCount || a.label.localeCompare(b.label, "ru"));
        return levels;
      }

      if (winnersConfig.type === "award") {
        const items = winnersConfig.awardItems || [];
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          const thr = Number(item.criterion);
          if (!Number.isFinite(thr)) continue;
          const prize = awardPrizeLabel(item);
          /** @type {DataRow[]} */
          const winners = [];
          for (let r = 0; r < safeRows.length; r += 1) {
            const row = safeRows[r];
            if ((Number(row.amount) || 0) >= thr) {
              addPrize(row.tn, prize);
              winners.push(row);
            }
          }
          rules.push({
            id: item.id,
            kind: "award",
            label: prize,
            scope: "country",
            winnerCount: winners.length,
            // для награды показываем разбивку и по ТБ / ГОСБ / кластеру
            breakdowns: {
              country: buildLevels("country", winners, safeRows),
              tb: buildLevels("tb", winners, safeRows),
              gosb: buildLevels("gosb", winners, safeRows),
              cluster: buildLevels("cluster", winners, safeRows),
              group: buildLevels("group", winners, safeRows)
            }
          });
        }
      } else {
        // Турнир: награды с одним и тем же кругом (scope) идут каскадом по достоинству
        // (золото → серебро → …): топ‑N берётся из ещё не награждённых на этом круге.
        // Пример: страна топ‑2 золото + страна топ‑5 серебро → 2 золота, следующие 5 серебро.
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

        /** Уже получившие награду на данном круге (tn) — для каскада. */
        /** @type {Map<string, Set<string>>} */
        const awardedByScope = new Map();

        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          const prize = tournamentPrizeLabel(item);
          const scope = item.scope || "country";
          if (!awardedByScope.has(scope)) awardedByScope.set(scope, new Set());
          const awarded = awardedByScope.get(scope);

          /** @type {Map<string, DataRow[]>} */
          const buckets = new Map();
          for (let r = 0; r < safeRows.length; r += 1) {
            const row = safeRows[r];
            const key = scopeKey(row, scope);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(row);
          }
          /** @type {DataRow[]} */
          const winners = [];
          /** @type {object[]} */
          const levels = [];
          for (const [key, groupRows] of buckets.entries()) {
            const sorted = groupRows.slice().sort((a, b) => {
              const da = Number(a.amount) || 0;
              const db = Number(b.amount) || 0;
              if (item.direction === "less") return da - db;
              return db - da;
            });
            const nAll = sorted.length;
            if (!nAll) continue;
            // Кандидаты: ещё не взяли награду этого же круга (каскад)
            const eligible = sorted.filter((row) => !awarded.has(row.tn));
            const n = eligible.length;
            if (!n) {
              levels.push({
                key,
                label: key,
                participants: nAll,
                winnerCount: 0,
                winners: []
              });
              continue;
            }
            let take = 1;
            if (item.selectMode === "topPct") {
              // % от полного состава уровня; берём столько из ещё не награждённых
              take = Math.max(1, Math.ceil((nAll * Number(item.topPct)) / 100));
            } else {
              take = Math.max(1, Math.round(Number(item.topN) || 1));
            }
            take = Math.min(take, n);
            const cutoff = Number(eligible[take - 1].amount) || 0;
            /** @type {DataRow[]} */
            const levelWinners = [];
            for (let k = 0; k < n; k += 1) {
              if (k < take) {
                levelWinners.push(eligible[k]);
                continue;
              }
              const amt = Number(eligible[k].amount) || 0;
              if (amt === cutoff) levelWinners.push(eligible[k]);
              else break;
            }
            for (let w = 0; w < levelWinners.length; w += 1) {
              const row = levelWinners[w];
              addPrize(row.tn, prize);
              awarded.add(row.tn);
              winners.push(row);
            }
            levels.push({
              key,
              label: key,
              participants: nAll,
              winnerCount: levelWinners.length,
              winners: levelWinners.map((r) => ({
                tn: r.tn,
                amount: Number(r.amount) || 0,
                tb: r.tb || "",
                gosb: r.gosb || "",
                cluster: r.cluster || ""
              }))
            });
          }
          levels.sort((a, b) => b.winnerCount - a.winnerCount || a.label.localeCompare(b.label, "ru"));
          rules.push({
            id: item.id,
            kind: "tournament",
            label: prize,
            scope,
            scopeLabel: SCOPE_LABELS[scope] || scope,
            winnerCount: winners.length,
            levels
          });
        }
      }

      let totalWinners = 0;
      for (const rec of map.values()) {
        if (rec.won) totalWinners += 1;
      }
      return {
        map,
        totalParticipants: safeRows.length,
        totalCandidates: participationMeta.before,
        totalWinners,
        type: winnersConfig.type,
        rules,
        participation: participationMeta
      };
    }

    /** Обратная совместимость: только карта tn → награды. */
    function computeWinnersMap(rows, edges, labels) {
      return computeWinnersResult(rows, edges, labels).map;
    }

    function winnersLookup(map, tn) {
      const rec = map && map.get(tn);
      if (!rec || !rec.won) return { won: false, prize: "" };
      return { won: true, prize: (rec.prizes || []).join("; ") };
    }

    /** @type {string} активный разрез в сводке для режима «награда» */
    let winnersAwardBreakdown = "tb";
    let winnersRecalcTimer = 0;

    function formatWinnerChip(w) {
      return (
        '<span class="winners-chip">' +
          '<span>' + escapeHtml(formatTn8(w.tn)) + '</span>' +
          '<span class="winners-chip__amt">' + escapeHtml(formatAmount(w.amount)) + '</span>' +
        '</span>'
      );
    }

    function renderWinnerChips(list, limit) {
      const lim = limit || 8;
      if (!list || !list.length) return '<span class="winners-level-empty">нет</span>';
      const shown = list.slice(0, lim);
      const rest = list.length - shown.length;
      return (
        '<div class="winners-chips">' +
          shown.map(formatWinnerChip).join("") +
          (rest > 0 ? '<span class="winners-chip is-more">+' + rest + '</span>' : "") +
        '</div>'
      );
    }

    /**
     * @param {object[]} levels
     * @param {string} levelTitle
     */
    function renderLevelsTable(levels, levelTitle) {
      if (!levels || !levels.length) {
        return '<p class="winners-level-empty">Нет уровней для отображения.</p>';
      }
      const withWinners = levels.filter((l) => l.winnerCount > 0);
      if (!withWinners.length) {
        return '<p class="winners-level-empty">По этому правилу никто не проходит.</p>';
      }
      const hiddenEmpty = levels.length - withWinners.length;
      const rowsHtml = withWinners.map((lv) => (
        '<tr>' +
          '<td>' + escapeHtml(lv.label) + '</td>' +
          '<td class="num">' + lv.participants + '</td>' +
          '<td class="num">' + lv.winnerCount + '</td>' +
          '<td>' + renderWinnerChips(lv.winners, 6) + '</td>' +
        '</tr>'
      )).join("");
      return (
        '<table class="winners-level-table">' +
          '<thead><tr>' +
            '<th>' + escapeHtml(levelTitle) + '</th>' +
            '<th class="num">Участников</th>' +
            '<th class="num">Победителей</th>' +
            '<th>Кто</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
        (hiddenEmpty > 0
          ? '<p class="winners-level-empty">Без победителей скрыто уровней: ' + hiddenEmpty + '</p>'
          : '')
      );
    }

    function refreshWinnersPreview() {
      const reportEl = document.getElementById("winnersReport");
      const body = document.getElementById("winnersReportBody");
      const meta = document.getElementById("winnersReportMeta");
      const multiMeta = document.getElementById("winnersMultiMeta");
      if (!reportEl || !body || !meta) return;

      if (!lastChartState || !lastChartState.rows || !lastChartState.rows.length) {
        reportEl.className = "winners-report is-empty";
        meta.textContent = "Загрузите данные — здесь будет разбивка по уровням (страна / ТБ / ГОСБ / кластер / группа).";
        body.innerHTML = "";
        if (multiMeta) multiMeta.textContent = "Победители пересчитываются по каждому загруженному слоту отдельно.";
        diversityReport = null;
        renderDiversityPanel();
        return;
      }

      const edges = lastChartState.edges || [];
      const labels = (lastChartState.hist && lastChartState.hist.labels) || [];
      const result = computeWinnersResult(lastChartState.rows, edges, labels);
      reportEl.className = "winners-report";

      const winnersBySlot = computeWinnersForAllSlots();
      const loadedN = loadedSlots().length;
      const doneN = winnersBySlot.size;
      if (multiMeta) {
        multiMeta.textContent =
          "Победители пересчитаны для " + doneN + " из " + Math.max(loadedN, 1) +
          " загруженных слотов (критерии общие, результат по каждому файлу свой).";
      }

      if (loadedN >= 1 && CI) {
        diversityReport = buildDiversityFromSlots(winnersBySlot);
        renderDiversityPanel();
      }

      const part = result.participation || {};
      const partBits = [];
      if (part.primaryApplied) partBits.push("основной");
      if (part.secondaryApplied) partBits.push("второстеп.«" + (part.secondaryColumn || "") + "»");
      if (part.secondarySkippedMissing) {
        partBits.push("второстеп. пропущен (нет колонки «" + (part.secondaryColumn || "") + "»)");
      }
      const cand = (result.totalCandidates != null) ? result.totalCandidates : result.totalParticipants;
      meta.textContent =
        "Активный слот · кандидатов: " + cand +
        " → участников: " + result.totalParticipants +
        (partBits.length ? (" [" + partBits.join("; ") + "]") : "") +
        " · уникальных победителей: " + result.totalWinners +
        " · правил/наград: " + result.rules.length +
        " · пересчёт при любом изменении критериев.";

      const statsHtml =
        '<div class="winners-report__stats">' +
          '<div class="winners-stat"><span class="winners-stat__n">' + cand + '</span><span class="winners-stat__l">кандидатов</span></div>' +
          '<div class="winners-stat"><span class="winners-stat__n">' + result.totalParticipants + '</span><span class="winners-stat__l">участников</span></div>' +
          '<div class="winners-stat"><span class="winners-stat__n">' + result.totalWinners + '</span><span class="winners-stat__l">победителей</span></div>' +
          '<div class="winners-stat"><span class="winners-stat__n">' + result.rules.length + '</span><span class="winners-stat__l">наград</span></div>' +
        '</div>';

      if (!result.rules.length) {
        body.innerHTML = statsHtml + '<p class="winners-level-empty">Добавьте хотя бы одну награду.</p>';
        return;
      }

      /** @type {Set<string>} */
      const openIds = new Set();
      body.querySelectorAll("details.winners-rule[open]").forEach((d) => {
        const id = d.getAttribute("data-rule-id");
        if (id) openIds.add(id);
      });
      const keepOpen = openIds.size > 0;

      const breakdownKeys = [
        { id: "country", label: "Страна" },
        { id: "tb", label: "ТБ" },
        { id: "gosb", label: "ГОСБ" },
        { id: "cluster", label: "Кластер" },
        { id: "group", label: "Группа" }
      ];
      if (!breakdownKeys.some((k) => k.id === winnersAwardBreakdown)) winnersAwardBreakdown = "tb";

      const rulesHtml = result.rules.map((rule, idx) => {
        let inner = "";
        if (rule.kind === "award") {
          const tabs = breakdownKeys.map((k) =>
            '<button type="button" class="seg__btn' + (winnersAwardBreakdown === k.id ? " is-on" : "") +
            '" data-breakdown="' + k.id + '">' + k.label + "</button>"
          ).join("");
          const levels = (rule.breakdowns && rule.breakdowns[winnersAwardBreakdown]) || [];
          const title = (breakdownKeys.find((k) => k.id === winnersAwardBreakdown) || {}).label || "Уровень";
          inner =
            '<div class="winners-breakdown-tabs" role="group" aria-label="Разбивка по уровню">' + tabs + "</div>" +
            renderLevelsTable(levels, title);
        } else {
          inner =
            '<p class="winners-report__meta" style="margin:0">Круг: ' + escapeHtml(rule.scopeLabel || rule.scope) +
            " · уровней: " + (rule.levels ? rule.levels.length : 0) + "</p>" +
            renderLevelsTable(rule.levels || [], rule.scopeLabel || "Уровень");
        }
        const isOpen = keepOpen ? openIds.has(rule.id) : idx === 0;
        return (
          '<details class="winners-rule" data-rule-id="' + escapeHtml(rule.id) + '"' + (isOpen ? " open" : "") + '>' +
            '<summary>' +
              '<span>' + escapeHtml(rule.label) + '</span>' +
              '<span class="winners-rule__count">' + rule.winnerCount + ' побед.</span>' +
            '</summary>' +
            '<div class="winners-rule__body">' + inner + '</div>' +
          '</details>'
        );
      }).join("");

      body.innerHTML = statsHtml + rulesHtml;
    }

    function scheduleWinnersRecalc() {
      if (winnersRecalcTimer) clearTimeout(winnersRecalcTimer);
      winnersRecalcTimer = setTimeout(() => {
        winnersRecalcTimer = 0;
        persistWinnersFromUi();
      }, 120);
    }

    function renderWinnersList() {
      syncParticipationUiFromConfig();
      const list = document.getElementById("winnersList");
      const panel = document.getElementById("winnersPanel");
      if (!list || !panel) return;
      panel.setAttribute("data-type", winnersConfig.type);
      const typeSel = document.getElementById("winnersType");
      if (typeSel) typeSel.value = winnersConfig.type;
      syncSegFromSelect(document.getElementById("winnersTypeSeg"), typeSel);

      if (winnersConfig.type === "award") {
        const items = winnersConfig.awardItems;
        if (!items.length) {
          list.innerHTML = '<div class="empty">Нет наград — нажмите «+ Награда».</div>';
          return;
        }
        list.innerHTML = items.map((item, idx) => `
          <div class="winners-card" data-id="${escapeHtml(item.id)}">
            <div class="winners-card__top">
              <span class="winners-card__badge"><span class="dot award"></span>Награда ${idx + 1}</span>
              <button type="button" class="btn ghost small winners-card__remove" data-act="remove" data-tip="Удалить награду">✕</button>
            </div>
            <div class="winners-card__grid">
              <label class="field">
                <span>Критерий (достиг ≥)</span>
                <input type="number" step="any" data-field="criterion" value="${escapeHtml(String(item.criterion))}">
              </label>
              <label class="field">
                <span>Подпись в экспорте (необяз.)</span>
                <input type="text" data-field="title" placeholder="например «Приз 10»" value="${escapeHtml(item.title || "")}">
              </label>
            </div>
          </div>
        `).join("");
        return;
      }

      const items = winnersConfig.tournamentItems;
      if (!items.length) {
        list.innerHTML = '<div class="empty">Нет наград — нажмите «+ Награда».</div>';
        return;
      }
      list.innerHTML = items.map((item, idx) => {
        const dig = DIGNITY_META[item.dignity] || DIGNITY_META[1];
        const scopeOpts = Object.keys(SCOPE_LABELS).map((k) =>
          `<option value="${k}"${item.scope === k ? " selected" : ""}>${SCOPE_LABELS[k]}</option>`
        ).join("");
        return `
          <div class="winners-card" data-id="${escapeHtml(item.id)}">
            <div class="winners-card__top">
              <span class="winners-card__badge"><span class="dot ${dig.cls}"></span>Награда ${idx + 1} · ${dig.label}</span>
              <button type="button" class="btn ghost small winners-card__remove" data-act="remove" data-tip="Удалить награду">✕</button>
            </div>
            <div class="winners-card__grid">
              <label class="field">
                <span>Достоинство</span>
                <select data-field="dignity">
                  <option value="1"${item.dignity === 1 ? " selected" : ""}>1 — Золото</option>
                  <option value="2"${item.dignity === 2 ? " selected" : ""}>2 — Серебро</option>
                  <option value="3"${item.dignity === 3 ? " selected" : ""}>3 — Бронза</option>
                </select>
              </label>
              <label class="field">
                <span>Круг отбора</span>
                <select data-field="scope">${scopeOpts}</select>
              </label>
              <label class="field">
                <span>Лучший — кто</span>
                <select data-field="direction">
                  <option value="more"${item.direction === "more" ? " selected" : ""}>Сделал больше</option>
                  <option value="less"${item.direction === "less" ? " selected" : ""}>Сделал меньше</option>
                </select>
              </label>
              <label class="field">
                <span>Отбор</span>
                <select data-field="selectMode">
                  <option value="topN"${item.selectMode === "topN" ? " selected" : ""}>Лучшие N</option>
                  <option value="topPct"${item.selectMode === "topPct" ? " selected" : ""}>Лучшие %</option>
                </select>
              </label>
              <label class="field">
                <span>Число лучших (N)</span>
                <input type="number" min="1" step="1" data-field="topN" value="${escapeHtml(String(item.topN))}">
              </label>
              <label class="field">
                <span>Процент лучших (%)</span>
                <input type="number" min="0.01" max="100" step="0.01" data-field="topPct" value="${escapeHtml(String(item.topPct))}">
              </label>
              <label class="field">
                <span>Подпись в экспорте (необяз.)</span>
                <input type="text" data-field="title" placeholder="например «Золото страны»" value="${escapeHtml(item.title || "")}">
              </label>
            </div>
          </div>
        `;
      }).join("");
    }

    function collectExtraColumnNames() {
      /** @type {Set<string>} */
      const set = new Set();
      loadedSlots().forEach((slot) => {
        const rows = slot.allRows || [];
        for (let i = 0; i < rows.length; i += 1) {
          const extras = rows[i] && rows[i].extras;
          if (!extras) continue;
          Object.keys(extras).forEach((k) => {
            if (k) set.add(k);
          });
        }
      });
      if (lastParsed && Array.isArray(lastParsed.headers)) {
        // подсказки из заголовков активного файла (кроме известных служебных)
        const skip = new Set(
          []
            .concat(getIndicatorAliases())
            .concat(APP_CONFIG.amountColumnAliases || [])
            .concat(APP_CONFIG.tbColumnAliases || [])
            .concat(APP_CONFIG.gosbColumnAliases || [])
            .concat(APP_CONFIG.clusterColumnAliases || [])
            .map(normalizeHeader)
        );
        lastParsed.headers.forEach((h) => {
          const name = String(h || "").trim();
          if (!name) return;
          if (skip.has(normalizeHeader(name))) return;
          set.add(name);
        });
      }
      return [...set].sort((a, b) => a.localeCompare(b, "ru"));
    }

    function syncParticipationUiFromConfig() {
      const part = winnersConfig.participation || defaultWinnersConfig().participation;
      const pEn = document.getElementById("partPrimaryEnabled");
      const pOp = document.getElementById("partPrimaryOp");
      const pVal = document.getElementById("partPrimaryValue");
      const sEn = document.getElementById("partSecondaryEnabled");
      const sCol = document.getElementById("partSecondaryColumn");
      const sOp = document.getElementById("partSecondaryOp");
      const sVal = document.getElementById("partSecondaryValue");
      const pSw = document.getElementById("partPrimarySwitch");
      const sSw = document.getElementById("partSecondarySwitch");
      if (pEn) {
        pEn.checked = !!(part.primary && part.primary.enabled);
        pEn.setAttribute("aria-checked", pEn.checked ? "true" : "false");
      }
      if (pSw) pSw.classList.toggle("is-on", !!(part.primary && part.primary.enabled));
      if (pOp) pOp.value = sanitizeCompareOp(part.primary && part.primary.op);
      if (pVal) pVal.value = String((part.primary && part.primary.value) != null ? part.primary.value : 0);
      if (sEn) {
        sEn.checked = !!(part.secondary && part.secondary.enabled);
        sEn.setAttribute("aria-checked", sEn.checked ? "true" : "false");
      }
      if (sSw) sSw.classList.toggle("is-on", !!(part.secondary && part.secondary.enabled));
      if (sCol) sCol.value = (part.secondary && part.secondary.column) ? String(part.secondary.column) : "";
      if (sOp) sOp.value = sanitizeCompareOp(part.secondary && part.secondary.op);
      if (sVal) sVal.value = String((part.secondary && part.secondary.value) != null ? part.secondary.value : 85);

      const list = document.getElementById("partSecondaryColumnsList");
      if (list) {
        const cols = collectExtraColumnNames();
        list.innerHTML = cols.map((c) => '<option value="' + escapeHtml(c) + '"></option>').join("");
      }
    }

    function participationFromDom() {
      const pEn = document.getElementById("partPrimaryEnabled");
      const pOp = document.getElementById("partPrimaryOp");
      const pVal = document.getElementById("partPrimaryValue");
      const sEn = document.getElementById("partSecondaryEnabled");
      const sCol = document.getElementById("partSecondaryColumn");
      const sOp = document.getElementById("partSecondaryOp");
      const sVal = document.getElementById("partSecondaryValue");
      winnersConfig.participation = sanitizeParticipation({
        primary: {
          enabled: !!(pEn && pEn.checked),
          op: pOp ? pOp.value : "gt",
          value: pVal ? Number(pVal.value) : 0
        },
        secondary: {
          enabled: !!(sEn && sEn.checked),
          column: sCol ? String(sCol.value || "") : "",
          op: sOp ? sOp.value : "gte",
          value: sVal ? Number(sVal.value) : 85
        }
      });
    }

    function winnersConfigFromDom() {
      participationFromDom();
      const typeSel = document.getElementById("winnersType");
      const type = (typeSel && typeSel.value === "tournament") ? "tournament" : "award";
      const list = document.getElementById("winnersList");
      if (!list) return;
      if (type === "award") {
        const next = [];
        list.querySelectorAll(".winners-card").forEach((card) => {
          const id = card.getAttribute("data-id") || winnersUid();
          const criterionEl = card.querySelector('[data-field="criterion"]');
          const titleEl = card.querySelector('[data-field="title"]');
          next.push({
            id,
            criterion: Number(criterionEl && criterionEl.value),
            title: titleEl ? String(titleEl.value || "") : ""
          });
        });
        winnersConfig.type = "award";
        winnersConfig.awardItems = next;
      } else {
        const next = [];
        list.querySelectorAll(".winners-card").forEach((card) => {
          const id = card.getAttribute("data-id") || winnersUid();
          const dig = Number((card.querySelector('[data-field="dignity"]') || {}).value);
          const scope = (card.querySelector('[data-field="scope"]') || {}).value || "country";
          const direction = (card.querySelector('[data-field="direction"]') || {}).value || "more";
          const selectMode = (card.querySelector('[data-field="selectMode"]') || {}).value || "topN";
          const topN = Number((card.querySelector('[data-field="topN"]') || {}).value);
          const topPct = Number((card.querySelector('[data-field="topPct"]') || {}).value);
          const titleEl = card.querySelector('[data-field="title"]');
          next.push({
            id,
            dignity: (dig === 2 || dig === 3) ? dig : 1,
            scope: SCOPE_LABELS[scope] ? scope : "country",
            direction: direction === "less" ? "less" : "more",
            selectMode: selectMode === "topPct" ? "topPct" : "topN",
            topN: Math.max(1, Math.round(topN || 1)),
            topPct: Math.max(0.01, Math.min(100, topPct || 10)),
            title: titleEl ? String(titleEl.value || "") : ""
          });
        });
        winnersConfig.type = "tournament";
        winnersConfig.tournamentItems = next;
      }
    }

    function persistWinnersFromUi() {
      winnersConfigFromDom();
      winnersConfig = sanitizeWinnersConfig(winnersConfig);
      saveWinnersConfig();
      refreshWinnersPreview();
    }

    function initWinnersUi() {
      const typeSel = document.getElementById("winnersType");
      const typeSeg = document.getElementById("winnersTypeSeg");
      const list = document.getElementById("winnersList");
      const btnAdd = document.getElementById("btnWinnersAdd");
      const btnReset = document.getElementById("btnWinnersReset");
      const btnRecalc = document.getElementById("btnWinnersRecalc");
      const reportBody = document.getElementById("winnersReportBody");
      renderWinnersList();
      refreshWinnersPreview();

      const partBox = document.getElementById("participationBox");
      if (partBox) {
        const syncSwitch = (inputId, wrapId) => {
          const input = document.getElementById(inputId);
          const wrap = document.getElementById(wrapId);
          if (!input || !wrap) return;
          wrap.classList.toggle("is-on", !!input.checked);
          input.setAttribute("aria-checked", input.checked ? "true" : "false");
        };
        partBox.addEventListener("change", (ev) => {
          const t = ev.target;
          if (t && t.id === "partPrimaryEnabled") syncSwitch("partPrimaryEnabled", "partPrimarySwitch");
          if (t && t.id === "partSecondaryEnabled") syncSwitch("partSecondaryEnabled", "partSecondarySwitch");
          persistWinnersFromUi();
        });
        partBox.addEventListener("input", (ev) => {
          const t = ev.target;
          if (t && (t.tagName === "SELECT" || t.type === "checkbox")) {
            persistWinnersFromUi();
            return;
          }
          scheduleWinnersRecalc();
        });
      }

      bindSegmentedControl(typeSeg, typeSel, () => {
        winnersConfig.type = (typeSel && typeSel.value === "tournament") ? "tournament" : "award";
        saveWinnersConfig();
        renderWinnersList();
        refreshWinnersPreview();
      });

      if (btnRecalc) {
        btnRecalc.addEventListener("click", () => {
          persistWinnersFromUi();
          // если график уже есть — убедимся, что фильтры актуальны
          if (allRows.length) rebuild({ light: false });
          else refreshWinnersPreview();
        });
      }

      if (reportBody) {
        reportBody.addEventListener("click", (ev) => {
          const btn = ev.target && ev.target.closest ? ev.target.closest("[data-breakdown]") : null;
          if (!btn) return;
          const id = btn.getAttribute("data-breakdown");
          if (!id || id === winnersAwardBreakdown) return;
          winnersAwardBreakdown = id;
          refreshWinnersPreview();
        });
      }

      if (btnAdd) {
        btnAdd.addEventListener("click", () => {
          winnersConfigFromDom();
          if (winnersConfig.type === "award") {
            winnersConfig.awardItems.push({ id: winnersUid(), criterion: 10, title: "" });
          } else {
            winnersConfig.tournamentItems.push({
              id: winnersUid(),
              dignity: 1,
              scope: "country",
              direction: "more",
              selectMode: "topN",
              topN: 1,
              topPct: 10,
              title: ""
            });
          }
          saveWinnersConfig();
          renderWinnersList();
          refreshWinnersPreview();
        });
      }
      if (btnReset) {
        btnReset.addEventListener("click", () => {
          winnersConfig = defaultWinnersConfig();
          saveWinnersConfig();
          renderWinnersList();
          refreshWinnersPreview();
        });
      }
      if (list) {
        list.addEventListener("click", (ev) => {
          const btn = ev.target && ev.target.closest ? ev.target.closest("[data-act=remove]") : null;
          if (!btn) return;
          const card = btn.closest(".winners-card");
          if (!card) return;
          const id = card.getAttribute("data-id");
          winnersConfigFromDom();
          if (winnersConfig.type === "award") {
            winnersConfig.awardItems = winnersConfig.awardItems.filter((x) => x.id !== id);
          } else {
            winnersConfig.tournamentItems = winnersConfig.tournamentItems.filter((x) => x.id !== id);
          }
          saveWinnersConfig();
          renderWinnersList();
          refreshWinnersPreview();
        });
        // select/change — сразу; ввод чисел — с лёгкой задержкой
        list.addEventListener("change", () => persistWinnersFromUi());
        list.addEventListener("input", (ev) => {
          const t = ev.target;
          if (t && t.tagName === "SELECT") {
            persistWinnersFromUi();
            return;
          }
          scheduleWinnersRecalc();
        });
      }
    }

    /** Области столбиков для hover-подсказки (координаты CSS-пикселей canvas). */
    /** @type {{ x: number, y: number, w: number, h: number, tip: string, canvas?: HTMLCanvasElement }[]} */
    let chartHitBars = [];
    let chartHitBarsA = [];
    let chartHitBarsB = [];

    const el = {
      tabSingle: document.getElementById("tabSingle"),
      tabCompare: document.getElementById("tabCompare"),
      tabAnalysis: document.getElementById("tabAnalysis"),
      fileInput: document.getElementById("fileInput"),
      indicatorSelect: document.getElementById("indicatorSelect"),
      indicatorSeg: document.getElementById("indicatorSeg"),
      fileInputB: document.getElementById("fileInputB"),
      fileOverviewA: document.getElementById("fileOverviewA"),
      fileOverviewB: document.getElementById("fileOverviewB"),
      periodTitleA: document.getElementById("periodTitleA"),
      periodTitleB: document.getElementById("periodTitleB"),
      btnClear: document.getElementById("btnClear"),
      btnClearB: document.getElementById("btnClearB"),
      btnRebuild: document.getElementById("btnRebuild"),
      loadStatus: document.getElementById("loadStatus"),
      sliceMode: document.getElementById("sliceMode"),
      groupLayout: document.getElementById("groupLayout"),
      groupLayoutSeg: document.getElementById("groupLayoutSeg"),
      chartType: document.getElementById("chartType"),
      chartTypeSeg: document.getElementById("chartTypeSeg"),
      showChartLabels: document.getElementById("showChartLabels"),
      compareLayout: document.getElementById("compareLayout"),
      chartHeading: document.getElementById("chartHeading"),
      chartsDual: document.getElementById("chartsDual"),
      chartA: document.getElementById("chartA"),
      chartB: document.getElementById("chartB"),
      chartTitleA: document.getElementById("chartTitleA"),
      chartTitleB: document.getElementById("chartTitleB"),
      filterHint: document.getElementById("filterHint"),
      orgTree: document.getElementById("orgTree"),
      orgTreeFilterBlock: document.getElementById("orgTreeFilterBlock"),
      clusterChecks: document.getElementById("clusterChecks"),
      clusterFilterBlock: document.getElementById("clusterFilterBlock"),
      btnFilterSelectAll: document.getElementById("btnFilterSelectAll"),
      btnFilterClearAll: document.getElementById("btnFilterClearAll"),
      movableEdgeCount: document.getElementById("movableEdgeCount"),
      edgeCalcMode: document.getElementById("edgeCalcMode"),
      edgeCalcModeSeg: document.getElementById("edgeCalcModeSeg"),
      btnEqualCountEdges: document.getElementById("btnEqualCountEdges"),
      btnLadderCountEdges: document.getElementById("btnLadderCountEdges"),
      btnEvenWidthEdges: document.getElementById("btnEvenWidthEdges"),
      binCustomRow: document.getElementById("binCustomRow"),
      edgeRail: document.getElementById("edgeRail"),
      edgeFineTune: document.getElementById("edgeFineTune"),
      edgeValues: document.getElementById("edgeValues"),
      chart: document.getElementById("chart"),
      legend: document.getElementById("legend"),
      stats: document.getElementById("stats"),
      freqDetail: document.getElementById("freqDetail"),
      analysisPanel: document.getElementById("analysisPanel"),
      analysisDim: document.getElementById("analysisDim"),
      analysisMetric: document.getElementById("analysisMetric"),
      analysisRankMode: document.getElementById("analysisRankMode"),
      analysisOutlierType: document.getElementById("analysisOutlierType"),
      analysisRankHint: document.getElementById("analysisRankHint"),
      analysisTopN: document.getElementById("analysisTopN"),
      analysisTopNSeg: document.getElementById("analysisTopNSeg"),
      anChartBins: document.getElementById("anChartBins"),
      anChartCdf: document.getElementById("anChartCdf"),
      anChartTb: document.getElementById("anChartTb"),
      anChartGosb: document.getElementById("anChartGosb"),
      anChartCluster: document.getElementById("anChartCluster"),
      anChartDeciles: document.getElementById("anChartDeciles"),
      anChartTop: document.getElementById("anChartTop"),
      anChartBottom: document.getElementById("anChartBottom"),
      anChartPie: document.getElementById("anChartPie"),
      anChartBand: document.getElementById("anChartBand"),
      anChartAvgBar: document.getElementById("anChartAvgBar"),
      anChartHeat: document.getElementById("anChartHeat"),
      analysisTableIntervals: document.getElementById("analysisTableIntervals"),
      analysisTableCategories: document.getElementById("analysisTableCategories"),
      analysisTablePercentiles: document.getElementById("analysisTablePercentiles"),
      analysisTableTopBottomAllDims: document.getElementById("analysisTableTopBottomAllDims"),
      analysisTableTbClusterMatrix: document.getElementById("analysisTableTbClusterMatrix"),
      analysisTableStability: document.getElementById("analysisTableStability"),
      analysisTableBinByDim: document.getElementById("analysisTableBinByDim"),
      analysisTableTbGosbMatrix: document.getElementById("analysisTableTbGosbMatrix"),
      analysisTableGosbClusterMatrix: document.getElementById("analysisTableGosbClusterMatrix"),
      analysisTableSignByDim: document.getElementById("analysisTableSignByDim"),
      analysisTableTailOwners: document.getElementById("analysisTableTailOwners"),
      analysisTableFullDim: document.getElementById("analysisTableFullDim"),
      chartStatus: null,
      glassTip: document.getElementById("glassTip"),
      btnExportRaw: document.getElementById("btnExportRaw"),
      btnExportTn: document.getElementById("btnExportTn"),
      btnExportGroups: document.getElementById("btnExportGroups"),
      btnExportFileStats: document.getElementById("btnExportFileStats"),
      exportPanelSub: document.getElementById("exportPanelSub")
    };

    const FILTER_DIMS = ["tb", "gosb", "cluster"];
    /** @type {{ tb: string[], gosb: string[], cluster: string[] }} */
    let filterUniverse = { tb: [], gosb: [], cluster: [] };

    const SERIES_COLORS = (APP_CONFIG.seriesColors && APP_CONFIG.seriesColors.length)
      ? APP_CONFIG.seriesColors
      : [
        "#007AFF", "#34C759", "#FF9500", "#5856D6", "#FF3B30",
        "#5AC8FA", "#AF52DE", "#FF2D55", "#64D2FF", "#30D158"
      ];

    const COMPARE_COLORS = (APP_CONFIG.compareColors && APP_CONFIG.compareColors.length)
      ? APP_CONFIG.compareColors
      : ["#007AFF", "#FF9500"];

    function seriesPaletteColor(index) {
      return SERIES_COLORS[index % SERIES_COLORS.length];
    }

    function comparePaletteColor(index) {
      return COMPARE_COLORS[index % COMPARE_COLORS.length];
    }

    /** Код периода из имени серии: A = текущий, B = прошлый. */
    function periodCodeFromSeriesName(name) {
      const s = String(name || "");
      if (/^(Текущий|A)\s*·/.test(s)) return "A";
      if (/^(Прошлый|B)\s*·/.test(s)) return "B";
      return null;
    }

    /** Серии вида «Текущий · …» / «Прошлый · …» в наложении сравнения. */
    function isPeriodCompareHist(hist) {
      const name = hist && hist.series && hist.series[0] && hist.series[0].name;
      return periodCodeFromSeriesName(name) === "A" || periodCodeFromSeriesName(name) === "B";
    }

    function isPeriodSeriesName(name) {
      return periodCodeFromSeriesName(name) != null;
    }

    /**
     * Единый цвет для графика и легенды.
     * bin: цвет серии (в сравнении — compareColors).
     * slice + bars: цвет интервала (binIndex).
     * slice + line: цвет серии (одна линия на значение разреза).
     */
    function chartColor(opts) {
      const layout = opts.layout === "slice" ? "slice" : "bin";
      const chartType = opts.chartType || "bars";
      const si = opts.seriesIndex || 0;
      const bi = opts.binIndex || 0;
      if (typeof opts.forcedColorIndex === "number") {
        return comparePaletteColor(opts.forcedColorIndex);
      }
      if (opts.compareMode || (opts.hist && isPeriodCompareHist(opts.hist))) {
        // В наложении: цвет по периоду (A/B), а не по порядковому индексу пары
        const name = opts.seriesName || (opts.hist && opts.hist.series && opts.hist.series[si] && opts.hist.series[si].name);
        const code = periodCodeFromSeriesName(name);
        if (code === "A") return comparePaletteColor(0);
        if (code === "B") return comparePaletteColor(1);
        return comparePaletteColor(si);
      }
      if (layout === "bin") return seriesPaletteColor(si);
      if (chartType === "line" || isCandleChartType(chartType)) return seriesPaletteColor(si);
      return seriesPaletteColor(bi);
    }

    /** Нормализация вида графика (площадь снята). */
    function resolveChartType() {
      let t = (el.chartType && el.chartType.value) || "bars";
      if (t === "area") {
        t = "line";
        if (el.chartType) el.chartType.value = "line";
      }
      if (t === "line") return "line";
      if (t === "candles") return "candles";
      if (t === "candles_tn") return "candles_tn";
      return "bars";
    }

    /** Свечной режим (ось Y = суммы, X = интервалы). */
    function isCandleChartType(chartType) {
      return chartType === "candles" || chartType === "candles_tn";
    }

    /** Включены ли подписи данных на графике. */
    function chartLabelsEnabled() {
      if (!el.showChartLabels) return true;
      return !!el.showChartLabels.checked;
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

    /** Нормализация табельного: только цифры, pad до 20. */
    function normalizeEmpId(raw) {
      if (raw == null) return null;
      const digits = String(raw).replace(/\D/g, "");
      if (!digits) return null;
      const len = APP_CONFIG.tnPadLength || 20;
      if (digits.length >= len) return digits.slice(-len);
      return digits.padStart(len, "0");
    }

    function detectDelimiter(text) {
      const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
      let best = ";";
      let bestCount = -1;
      for (const d of APP_CONFIG.csvDelimiters) {
        const count = line.split(d).length - 1;
        if (count > bestCount) {
          bestCount = count;
          best = d;
        }
      }
      return best;
    }

    function splitCsvLine(line, delimiter) {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === delimiter && !inQuotes) {
          out.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur.trim());
      return out;
    }

    function normalizeHeader(name) {
      return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/["']/g, "")
        .replace(/\s+/g, " ");
    }

    /**
     * Индекс колонки: приоритет по порядку алиасов, затем точное совпадение, иначе includes.
     * @param {string[]} headers
     * @param {string[]} aliases
     * @returns {number}
     */
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

    /**
     * Агрегация по ТН: SUM(сумма), атрибуты — первое непустое.
     * @param {DataRow[]} rows
     * @returns {DataRow[]}
     */
    function aggregateByTn(rows) {
      /** @type {Map<string, DataRow>} */
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
            cluster: row.cluster || "",
            extras: row.extras ? Object.assign({}, row.extras) : {}
          });
          continue;
        }
        prev.amount += row.amount;
        if (!prev.tb && row.tb) prev.tb = row.tb;
        if (!prev.gosb && row.gosb) prev.gosb = row.gosb;
        if (!prev.cluster && row.cluster) prev.cluster = row.cluster;
        // Второстепенные: первое конечное значение по каждому ключу (как у ТБ/ГОСБ)
        if (row.extras) {
          if (!prev.extras) prev.extras = {};
          const keys = Object.keys(row.extras);
          for (let i = 0; i < keys.length; i += 1) {
            const k = keys[i];
            if (prev.extras[k] == null || !Number.isFinite(Number(prev.extras[k]))) {
              const v = Number(row.extras[k]);
              if (Number.isFinite(v)) prev.extras[k] = v;
            }
          }
        }
      }
      return [...map.values()];
    }

    /**
     * @param {string} text
     * @param {string[]=} indicatorAliases необязательные алиасы показателя (иначе — из UI/config)
     */
    function parseTableText(text, indicatorAliases) {
      const cleaned = String(text || "").replace(/^\uFEFF/, "").trim();
      if (!cleaned) throw new Error("Пустой ввод: вставьте таблицу или выберите CSV-файл.");

      const delimiter = detectDelimiter(cleaned);
      const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) throw new Error("Нужна строка заголовков и хотя бы одна строка данных.");

      const headers = splitCsvLine(lines[0], delimiter);
      const ind = getSelectedIndicator();
      const indAliases = getIndicatorAliases(indicatorAliases);
      const indLabel = (ind && ind.label) || "Показатель";
      const tnIdx = findColumnIndex(headers, indAliases);
      const amountIdx = findColumnIndex(headers, APP_CONFIG.amountColumnAliases);
      const tbIdx = findColumnIndex(headers, APP_CONFIG.tbColumnAliases);
      const gosbIdx = findColumnIndex(headers, APP_CONFIG.gosbColumnAliases);
      const clusterIdx = findColumnIndex(headers, APP_CONFIG.clusterColumnAliases);

      if (tnIdx < 0 || amountIdx < 0) {
        const missing = [];
        if (tnIdx < 0) {
          missing.push(indLabel + " (алиасы: " + indAliases.slice(0, 6).join(", ") + (indAliases.length > 6 ? ", …" : "") + ")");
        }
        if (amountIdx < 0) {
          const aa = APP_CONFIG.amountColumnAliases || [];
          missing.push("сумма (алиасы: " + aa.slice(0, 6).join(", ") + (aa.length > 6 ? ", …" : "") + ")");
        }
        const seen = headers.map((h) => String(h || "").trim()).filter(Boolean);
        throw new Error(
          "Не найдены обязательные столбцы: " + missing.join("; ")
          + ". Прочитанные заголовки: [" + seen.join(" | ") + "]"
          + ". Разделитель: «" + delimiter + "»."
        );
      }

      /** @type {DataRow[]} */
      const rows = [];
      let skipped = 0;
      const reservedIdx = new Set(
        [tnIdx, amountIdx, tbIdx, gosbIdx, clusterIdx].filter((x) => x >= 0)
      );
      /** Индексы прочих колонок → имя заголовка (для критериев участия). */
      /** @type {{ idx: number, name: string }[]} */
      const extraCols = [];
      for (let h = 0; h < headers.length; h += 1) {
        if (reservedIdx.has(h)) continue;
        const name = String(headers[h] || "").trim();
        if (!name) continue;
        extraCols.push({ idx: h, name });
      }

      for (let i = 1; i < lines.length; i += 1) {
        const cells = splitCsvLine(lines[i], delimiter);
        const amount = normalizeAmount(cells[amountIdx]);
        const tn = normalizeEmpId(cells[tnIdx]);
        if (amount == null || !tn) {
          skipped += 1;
          continue;
        }
        /** @type {Record<string, number>} */
        const extras = {};
        for (let e = 0; e < extraCols.length; e += 1) {
          const col = extraCols[e];
          const v = normalizeAmount(cells[col.idx]);
          if (v != null) extras[col.name] = v;
        }
        rows.push({
          tn,
          amount,
          tb: tbIdx >= 0 ? String(cells[tbIdx] || "").trim() : "",
          gosb: gosbIdx >= 0 ? String(cells[gosbIdx] || "").trim() : "",
          cluster: clusterIdx >= 0 ? String(cells[clusterIdx] || "").trim() : "",
          extras
        });
      }

      if (!rows.length) {
        throw new Error("Не удалось прочитать ни одной валидной строки (нужны " + indLabel + " и сумма).");
      }

      return {
        rows,
        meta: {
          delimiter,
          headers: headers.slice(),
          extraColumns: extraCols.map((c) => c.name),
          rawLines: lines.slice(),
          totalLines: lines.length - 1,
          skipped,
          hasTb: tbIdx >= 0,
          hasGosb: gosbIdx >= 0,
          hasCluster: clusterIdx >= 0,
          indicatorId: getSelectedIndicatorId(),
          indicatorLabel: indLabel
        }
      };
    }

    /** Целая шкала границ: низ вниз, верх вверх. */
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

    /** Целое для полей границ: разделитель разрядов, без дробной части. */
    function formatEdgeInt(n) {
      const v = toIntegerEdge(n);
      if (!Number.isFinite(v)) return "—";
      return new Intl.NumberFormat("ru-RU", {
        useGrouping: true,
        maximumFractionDigits: 0,
        minimumFractionDigits: 0
      }).format(v);
    }

    /** Разбор значения из поля границы (пробелы/неразрывные пробелы допускаются). */
    function parseEdgeInt(raw) {
      const s = String(raw == null ? "" : raw)
        .replace(/[\s\u00a0\u202f]/g, "")
        .replace(",", ".");
      if (!s) return NaN;
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    }

    function buildBins(amounts, opts) {
      // Custom-границы: не трогаем amounts (критично для drag — без O(n) min/max)
      if (opts.mode === "custom") {
        const edges = [...opts.customEdges]
          .filter((n) => Number.isFinite(n))
          .map(toIntegerEdge);
        if (edges.length < 2) throw new Error("Задайте хотя бы одну подвижную границу (итого ≥ 3 точек с min/max).");
        return edges;
      }
      if (!amounts.length) throw new Error("Нет сумм для построения интервалов.");
      let dataMin = Infinity;
      let dataMax = -Infinity;
      for (let i = 0; i < amounts.length; i += 1) {
        const v = amounts[i];
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
      }
      const scale = integerBounds(dataMin, dataMax);

      let min = opts.min == null || !Number.isFinite(opts.min) ? scale.min : Math.floor(opts.min);
      let max = opts.max == null || !Number.isFinite(opts.max) ? scale.max : Math.ceil(opts.max);
      if (max < min) {
        const t = min; min = max; max = t;
      }
      ({ min, max } = integerBounds(min, max));

      if (opts.mode === "width") {
        const width = Math.max(1, Math.round(Number(opts.width) || 0));
        if (!(width > 0)) throw new Error("Ширина интервала должна быть больше 0.");
        const originRaw = opts.origin == null || !Number.isFinite(opts.origin) ? min : opts.origin;
        const origin = Math.floor(originRaw);
        const edges = [origin];
        let cur = origin;
        const edgeCap = Math.max(10, Number(APP_CONFIG.maxBinEdges) || 2000);
        while (cur < max && edges.length < edgeCap) {
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

    function formatTnExport(tn) {
      const pad = Math.max(1, Number(APP_CONFIG.exportTnLength) || 8);
      const digits = String(tn == null ? "" : tn).replace(/\D/g, "");
      if (!digits) return "".padStart(pad, "0");
      if (digits.length >= pad) return digits.slice(-pad);
      return digits.padStart(pad, "0");
    }

    function formatTn8(tn) {
      return formatTnExport(tn);
    }

    /**
     * @param {number} amount
     * @param {number[]} edges
     * @param {string[]} labels
     * @returns {string}
     */
    function groupNameForAmount(amount, edges, labels) {
      if (!edges || edges.length < 2) return "";
      if (!Number.isFinite(amount)) return "";
      if (amount < edges[0]) return "ниже минимума";
      if (amount > edges[edges.length - 1]) return "выше максимума";
      const bi = binIndexForAmount(amount, edges);
      if (bi < 0) return "выше максимума";
      // При якоре 0: колонка ≤0 отдельно; положительные нумеруем с 1
      if (hasNonPositiveAnchorBin(edges)) {
        if (bi === 0) return "≤ 0";
        return "Группа " + bi;
      }
      return "Группа " + (bi + 1);
    }

    /** @returns {Map<string, string>} tn → group */
    function buildTnGroupMapFromRows(rows, edges, labels) {
      const map = new Map();
      for (const row of rows) {
        map.set(row.tn, groupNameForAmount(row.amount, edges, labels || []));
      }
      return map;
    }

    /** @returns {Map<string, string>} tn → group (текущий период / одиночный режим) */
    function buildTnGroupMap() {
      if (!lastChartState) throw new Error("Сначала постройте график (загрузите данные).");
      const { rows, edges, hist } = lastChartState;
      return buildTnGroupMapFromRows(rows, edges, hist.labels);
    }

    function requireChartState() {
      if (!lastChartState || !lastChartState.edges || lastChartState.edges.length < 2) {
        throw new Error("Сначала постройте график (загрузите данные).");
      }
      return lastChartState;
    }

    /** В сравнении выгружаем оба периода, если прошлый загружен. */
    function exportIncludesBothPeriods() {
      return !!(viewMode === "compare" && lastChartState && lastChartState.compare &&
        Array.isArray(lastChartState.rowsB) && rawRowsB.length);
    }

    function pushRawCsvRows(lines, periodLabel, sourceRows, tnGroup, edges, labels, winnersMap) {
      for (const row of sourceRows) {
        const group = tnGroup.get(row.tn) || groupNameForAmount(row.amount, edges, labels);
        const w = winnersLookup(winnersMap, row.tn);
        const cells = periodLabel
          ? [periodLabel, row.tn, row.tb, row.gosb, row.cluster, row.amount, group, w.won ? "да" : "нет", w.prize]
          : [row.tn, row.tb, row.gosb, row.cluster, row.amount, group, w.won ? "да" : "нет", w.prize];
        lines.push(cells.map(csvEscape).join(";"));
      }
    }

    function formatGroupsTextFromMap(tnGroup) {
      /** @type {Map<string, string[]>} */
      const byGroup = new Map();
      const order = [];
      for (const [tn, group] of tnGroup.entries()) {
        if (!byGroup.has(group)) {
          byGroup.set(group, []);
          order.push(group);
        }
        byGroup.get(group).push(formatTn8(tn));
      }
      order.sort((a, b) => {
        const na = /^Группа (\d+)$/.exec(a);
        const nb = /^Группа (\d+)$/.exec(b);
        if (na && nb) return Number(na[1]) - Number(nb[1]);
        return a.localeCompare(b, "ru");
      });
      const parts = [];
      order.forEach((name, gi) => {
        const tns = byGroup.get(name).slice().sort();
        const body = tns.map((t) => '"' + t + '"').join(",\n");
        let block = '"' + String(name).replace(/"/g, '\\"') + '":\n{' + body + "}";
        if (gi < order.length - 1) block += ",";
        parts.push(block);
      });
      return parts.join("\n");
    }

    function csvEscape(cell) {
      const s = String(cell == null ? "" : cell);
      if (/[;"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }

    function downloadTextFile(filename, text, mime) {
      const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function stamp() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
    }

    function exportRawCsvWithGroup() {
      try {
        const st = requireChartState();
        const edges = st.edges;
        const labels = (st.hist && st.hist.labels) || [];
        const both = exportIncludesBothPeriods();
        const ind = indicatorLabel();
        const winA = computeWinnersMap(st.rows, edges, labels);
        const lines = [];
        if (both) {
          const winB = computeWinnersMap(st.rowsB || [], edges, labels);
          lines.push(["Период", ind, "ТБ", "ГОСБ", "кластер", "сумма", "Группа", "Победитель", "Награда"].join(";"));
          const mapA = buildTnGroupMapFromRows(st.rows, edges, labels);
          const mapB = buildTnGroupMapFromRows(st.rowsB, edges, labels);
          pushRawCsvRows(lines, PERIOD_CUR.label, rawRows, mapA, edges, labels, winA);
          pushRawCsvRows(lines, PERIOD_PREV.label, rawRowsB, mapB, edges, labels, winB);
          downloadTextFile("sum_source_with_group_compare_" + stamp() + ".csv", lines.join("\n"), "text/csv;charset=utf-8");
        } else {
          lines.push([ind, "ТБ", "ГОСБ", "кластер", "сумма", "Группа", "Победитель", "Награда"].join(";"));
          const mapA = buildTnGroupMapFromRows(st.rows, edges, labels);
          pushRawCsvRows(lines, null, rawRows, mapA, edges, labels, winA);
          downloadTextFile("sum_source_with_group_" + stamp() + ".csv", lines.join("\n"), "text/csv;charset=utf-8");
        }
      } catch (err) {
        setChartStatus((err && err.message) ? err.message : String(err), "err");
      }
    }

    function exportUniqueTnCsv() {
      try {
        const st = requireChartState();
        const edges = st.edges;
        const labels = (st.hist && st.hist.labels) || [];
        const both = exportIncludesBothPeriods();
        const ind = indicatorLabel();
        const lines = [];
        if (both) {
          const winA = computeWinnersMap(st.rows, edges, labels);
          const winB = computeWinnersMap(st.rowsB || [], edges, labels);
          lines.push(["Период", ind, "Группа", "Победитель", "Награда"].join(";"));
          const mapA = buildTnGroupMapFromRows(st.rows, edges, labels);
          const mapB = buildTnGroupMapFromRows(st.rowsB, edges, labels);
          const sortedA = [...mapA.entries()].sort((a, b) => a[0].localeCompare(b[0]));
          const sortedB = [...mapB.entries()].sort((a, b) => a[0].localeCompare(b[0]));
          for (const [tn, group] of sortedA) {
            const w = winnersLookup(winA, tn);
            lines.push([
              csvEscape(PERIOD_CUR.label),
              csvEscape(formatTn8(tn)),
              csvEscape(group),
              csvEscape(w.won ? "да" : "нет"),
              csvEscape(w.prize)
            ].join(";"));
          }
          for (const [tn, group] of sortedB) {
            const w = winnersLookup(winB, tn);
            lines.push([
              csvEscape(PERIOD_PREV.label),
              csvEscape(formatTn8(tn)),
              csvEscape(group),
              csvEscape(w.won ? "да" : "нет"),
              csvEscape(w.prize)
            ].join(";"));
          }
          downloadTextFile("sum_tn8_groups_compare_" + stamp() + ".csv", lines.join("\n"), "text/csv;charset=utf-8");
        } else {
          const winA = computeWinnersMap(st.rows, edges, labels);
          const tnGroup = buildTnGroupMapFromRows(st.rows, edges, labels);
          lines.push([ind, "Группа", "Победитель", "Награда"].join(";"));
          const sorted = [...tnGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]));
          for (const [tn, group] of sorted) {
            const w = winnersLookup(winA, tn);
            lines.push([
              csvEscape(formatTn8(tn)),
              csvEscape(group),
              csvEscape(w.won ? "да" : "нет"),
              csvEscape(w.prize)
            ].join(";"));
          }
          downloadTextFile("sum_tn8_groups_" + stamp() + ".csv", lines.join("\n"), "text/csv;charset=utf-8");
        }
      } catch (err) {
        setChartStatus((err && err.message) ? err.message : String(err), "err");
      }
    }

    /**
     * Формат по ТЗ:
     * "Группа":
     * {"00123456",
     * "00123457"},
     */
    function exportGroupsText() {
      try {
        const st = requireChartState();
        const edges = st.edges;
        const labels = (st.hist && st.hist.labels) || [];
        const both = exportIncludesBothPeriods();
        if (both) {
          const mapA = buildTnGroupMapFromRows(st.rows, edges, labels);
          const mapB = buildTnGroupMapFromRows(st.rowsB, edges, labels);
          const text =
            "=== " + PERIOD_CUR.label + " ===\n" +
            formatGroupsTextFromMap(mapA) + "\n\n" +
            "=== " + PERIOD_PREV.label + " ===\n" +
            formatGroupsTextFromMap(mapB) + "\n";
          downloadTextFile("sum_groups_compare_" + stamp() + ".txt", text, "text/plain;charset=utf-8");
        } else {
          const tnGroup = buildTnGroupMapFromRows(st.rows, edges, labels);
          downloadTextFile(
            "sum_groups_" + stamp() + ".txt",
            formatGroupsTextFromMap(tnGroup) + "\n",
            "text/plain;charset=utf-8"
          );
        }
      } catch (err) {
        setChartStatus((err && err.message) ? err.message : String(err), "err");
      }
    }

    /**
     * Профиль одного разреза (ТБ / ГОСБ / кластер) по списку ТН.
     * p10/p90 — глобальные пороги файла по полю сумма (amount):
     * чем больше сумма, тем лучше → ≤p10 худшие ~10%, ≥p90 лучшие ~10%.
     */
    function buildFileDimStats(rows, field, p10, p90) {
      const buckets = new Map();
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const key = ((r[field] || "(пусто)") + "").trim() || "(пусто)";
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(Number(r.amount) || 0);
      }
      const totalTn = Math.max(1, rows.length);
      const thrLo = Number.isFinite(p10) ? p10 : -Infinity;
      const thrHi = Number.isFinite(p90) ? p90 : Infinity;
      const out = [];
      for (const [name, vals] of buckets.entries()) {
        const n = vals.length;
        let sumAll = 0;
        let sumPos = 0;
        let sumNeg = 0;
        let countPos = 0;
        let countNeg = 0;
        let countZero = 0;
        let countLeP10 = 0;
        let countGeP90 = 0;
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < n; i += 1) {
          const v = vals[i];
          sumAll += v;
          if (v > 0) { countPos += 1; sumPos += v; }
          else if (v < 0) { countNeg += 1; sumNeg += v; }
          else countZero += 1;
          if (v <= thrLo) countLeP10 += 1;
          if (v >= thrHi) countGeP90 += 1;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        if (!Number.isFinite(min)) { min = 0; max = 0; }
        const sorted = vals.slice().sort((a, b) => a - b);
        out.push({
          name,
          tn_count: n,
          tn_share: n / totalTn,
          min,
          max,
          median: quantile(sorted, 0.5),
          avg: n ? sumAll / n : 0,
          sum_all: sumAll,
          sum_pos: sumPos,
          sum_neg: sumNeg,
          count_pos: countPos,
          count_neg: countNeg,
          count_zero: countZero,
          share_pos: n ? countPos / n : 0,
          share_neg: n ? countNeg / n : 0,
          share_zero: n ? countZero / n : 0,
          // Хвосты по сумме: ≤P10 = худшие, ≥P90 = лучшие (больше amount → лучше)
          count_le_p10: countLeP10,
          share_le_p10: n ? countLeP10 / n : 0,
          count_worst_10pct: countLeP10,
          count_ge_p90: countGeP90,
          share_ge_p90: n ? countGeP90 / n : 0,
          count_best_10pct: countGeP90
        });
      }
      out.sort((a, b) => b.tn_count - a.tn_count || String(a.name).localeCompare(String(b.name), "ru"));
      return out;
    }

    /** Связи оргструктуры, встречающиеся в файле (для генерации связной демо-выборки). */
    function buildFileOrgLinks(rows) {
      const triple = new Map();
      const tbGosb = new Map();
      const tbCluster = new Map();
      const gosbCluster = new Map();

      function bump(map, key, amount) {
        let rec = map.get(key);
        if (!rec) {
          rec = { tn_count: 0, sum_all: 0 };
          map.set(key, rec);
        }
        rec.tn_count += 1;
        rec.sum_all += amount;
      }

      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const tb = ((r.tb || "(пусто)") + "").trim() || "(пусто)";
        const gosb = ((r.gosb || "(пусто)") + "").trim() || "(пусто)";
        const cluster = ((r.cluster || "(пусто)") + "").trim() || "(пусто)";
        const amt = Number(r.amount) || 0;
        bump(triple, tb + "\0" + gosb + "\0" + cluster, amt);
        bump(tbGosb, tb + "\0" + gosb, amt);
        bump(tbCluster, tb + "\0" + cluster, amt);
        bump(gosbCluster, gosb + "\0" + cluster, amt);
      }

      function toList(map, parts) {
        return Array.from(map.entries()).map(([key, rec]) => {
          const bits = key.split("\0");
          const row = { tn_count: rec.tn_count, sum_all: rec.sum_all };
          for (let i = 0; i < parts.length; i += 1) row[parts[i]] = bits[i];
          return row;
        }).sort((a, b) => b.tn_count - a.tn_count);
      }

      return {
        tb_gosb_cluster: toList(triple, ["tb", "gosb", "cluster"]),
        tb_gosb: toList(tbGosb, ["tb", "gosb"]),
        tb_cluster: toList(tbCluster, ["tb", "cluster"]),
        gosb_cluster: toList(gosbCluster, ["gosb", "cluster"])
      };
    }

    /** Полный JSON-профиль текущего файла (без фильтров). */
    function buildFileStatsPayload(rows, meta) {
      const n = rows.length;
      let sumAll = 0;
      let sumPos = 0;
      let sumNeg = 0;
      let countPos = 0;
      let countNeg = 0;
      let countZero = 0;
      const amounts = new Array(n);
      for (let i = 0; i < n; i += 1) {
        const v = Number(rows[i].amount) || 0;
        amounts[i] = v;
        sumAll += v;
        if (v > 0) { countPos += 1; sumPos += v; }
        else if (v < 0) { countNeg += 1; sumNeg += v; }
        else countZero += 1;
      }
      const sorted = amounts.slice().sort((a, b) => a - b);
      const p10 = quantile(sorted, 0.1);
      const p90 = quantile(sorted, 0.9);
      let countLeP10 = 0;
      let countGeP90 = 0;
      for (let i = 0; i < n; i += 1) {
        if (amounts[i] <= p10) countLeP10 += 1;
        if (amounts[i] >= p90) countGeP90 += 1;
      }
      const byTb = buildFileDimStats(rows, "tb", p10, p90);
      const byGosb = buildFileDimStats(rows, "gosb", p10, p90);
      const byCluster = buildFileDimStats(rows, "cluster", p10, p90);
      return {
        schema: "sum-distribution-file-stats/v1.1",
        purpose: "Профиль текущего файла для анализа и генерации тестовых CSV, близких к проду",
        generated_at: new Date().toISOString(),
        source: {
          file_name: (meta && meta.fileName) || "",
          period: "current",
          filters_applied: false,
          tn_count: n,
          unique_tb: byTb.length,
          unique_gosb: byGosb.length,
          unique_cluster: byCluster.length,
          has_tb: byTb.some((x) => x.name !== "(пусто)"),
          has_gosb: byGosb.some((x) => x.name !== "(пусто)"),
          has_cluster: byCluster.some((x) => x.name !== "(пусто)")
        },
        totals: {
          tn_count: n,
          sum_all: sumAll,
          sum_pos: sumPos,
          sum_neg: sumNeg,
          avg: n ? sumAll / n : 0,
          median: quantile(sorted, 0.5),
          min: sorted.length ? sorted[0] : 0,
          max: sorted.length ? sorted[sorted.length - 1] : 0,
          count_pos: countPos,
          count_neg: countNeg,
          count_zero: countZero,
          share_pos: n ? countPos / n : 0,
          share_neg: n ? countNeg / n : 0,
          share_zero: n ? countZero / n : 0,
          count_le_p10: countLeP10,
          share_le_p10: n ? countLeP10 / n : 0,
          count_worst_10pct: countLeP10,
          count_ge_p90: countGeP90,
          share_ge_p90: n ? countGeP90 / n : 0,
          count_best_10pct: countGeP90
        },
        amount_quantiles: {
          p10,
          p25: quantile(sorted, 0.25),
          p50: quantile(sorted, 0.5),
          p75: quantile(sorted, 0.75),
          p90,
          p95: quantile(sorted, 0.95),
          p99: quantile(sorted, 0.99)
        },
        tail_thresholds: {
          field: "amount",
          rule: "Чем больше сумма (amount), тем лучше",
          description: "Глобальные пороги файла по сумме ТН: ≤ p10 = худшие ~10%, ≥ p90 = лучшие ~10%",
          worst: { percentile: 10, op: "<=", key: "p10" },
          best: { percentile: 90, op: ">=", key: "p90" },
          p10,
          p90
        },
        by_tb: byTb,
        by_gosb: byGosb,
        by_cluster: byCluster,
        links: buildFileOrgLinks(rows),
        generator_hints: {
          sample_by: "tn_share within by_tb / by_gosb / by_cluster",
          keep_links: "sample (tb,gosb,cluster) from links.tb_gosb_cluster weighted by tn_count",
          amount_model: "mix sign shares + draw magnitude from amount_quantiles / per-group min-max-median",
          tails: "по amount: count_le_p10/count_worst_10pct (худшие), count_ge_p90/count_best_10pct (лучшие); больше сумма → лучше",
          empty_label: "(пусто)"
        }
      };
    }

    function exportFileStats() {
      try {
        if (!allRows.length) throw new Error("Сначала загрузите текущий файл.");
        const payload = buildFileStatsPayload(allRows, { fileName: fileNameA || "" });
        const base = "sum_file_stats_" + stamp();
        downloadTextFile(
          base + ".json",
          JSON.stringify(payload, null, 2),
          "application/json;charset=utf-8"
        );
        setChartStatus(
          "Статистика по файлу: JSON (ТН=" + allRows.length
            + ", ТБ=" + payload.source.unique_tb
            + ", ГОСБ=" + payload.source.unique_gosb
            + ", кластеров=" + payload.source.unique_cluster + ").",
          "ok"
        );
      } catch (err) {
        setChartStatus((err && err.message) ? err.message : String(err), "err");
      }
    }

    /** Суммы для UI: разделитель разрядов, не более N знаков после запятой. */
    function formatAmount(n) {
      if (!Number.isFinite(n)) return "—";
      const digits = Math.max(0, Number(APP_CONFIG.amountFractionDigits));
      const maxDigits = Number.isFinite(digits) ? digits : 2;
      return new Intl.NumberFormat("ru-RU", {
        useGrouping: true,
        maximumFractionDigits: maxDigits
      }).format(n);
    }

    /** Мин/макс из данных для UI (с тем же лимитом дробной части, что и у остальных сумм). */
    function formatAmountExact(n) {
      if (!Number.isFinite(n)) return "—";
      const digits = Math.max(0, Number(APP_CONFIG.amountFractionDigits));
      const maxDigits = Number.isFinite(digits) ? digits : 2;
      return new Intl.NumberFormat("ru-RU", {
        useGrouping: true,
        maximumFractionDigits: maxDigits
      }).format(n);
    }

    function formatNumber(n) {
      return formatAmount(n);
    }

    /**
     * Колонка «≤ 0» только при якоре positive-режима (геометрия границ).
     * Без повторного filteredRows — иначе O(n²) в computeHistogram/binIndex.
     */
    function hasNonPositiveAnchorBin(edges) {
      if (!includePositiveOnlyForAutoEdges()) return false;
      return Array.isArray(edges) && edges.length > 2 && edges[0] < 0 && edges[1] === 0;
    }

    function formatBinLabel(a, b, last, nonPositiveAnchor) {
      if (nonPositiveAnchor) return "≤ 0";
      return last ? `[${formatAmount(a)} … ${formatAmount(b)}]` : `[${formatAmount(a)} … ${formatAmount(b)})`;
    }

    function computeHistogram(rows, edges, sliceMode) {
      const seriesMap = new Map();
      let below = 0;
      let above = 0;
      const binCount = edges.length - 1;
      const anchorNP = hasNonPositiveAnchorBin(edges);

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
        if (x < edges[0]) { below += 1; continue; }
        if (x > edges[edges.length - 1]) { above += 1; continue; }
        const bi = binIndexForAmount(x, edges);
        if (bi < 0) above += 1;
        else counts[bi] += 1;
      }

      const series = [...seriesMap.entries()]
        .map(([name, counts]) => ({ name, counts }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));

      const labels = [];
      for (let i = 0; i < binCount; i += 1) {
        labels.push(formatBinLabel(
          edges[i],
          edges[i + 1],
          i === binCount - 1,
          anchorNP && i === 0
        ));
      }

      return { edges, labels, series, total: rows.length, below, above };
    }

    function setLoadStatus(msg, kind) {
      if (!el.loadStatus) return;
      const text = msg == null ? "" : String(msg);
      el.loadStatus.textContent = text;
      el.loadStatus.className = "status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
      if (text) el.loadStatus.removeAttribute("hidden");
      else el.loadStatus.setAttribute("hidden", "");
    }
    function setChartStatus(msg, kind) {
      // Ошибки графика — в статус; успех графика не затирает подробный итог загрузки файла
      if (kind === "err" && msg) setLoadStatus(msg, "err");
      else if (kind === "ok" && msg) {
        const cur = el.loadStatus && el.loadStatus.textContent ? String(el.loadStatus.textContent) : "";
        if (
          cur.indexOf("✓ Загружено") === 0 ||
          cur.indexOf("Читаю «") === 0 ||
          cur.indexOf("Файл прочитан") === 0
        ) {
          return;
        }
        setLoadStatus(msg, "ok");
      }
    }

    function applyParsed(parsed, sourceLabel) {
      applyParsedToPeriod("a", parsed, sourceLabel);
    }

    function applyParsedToPeriod(which, parsed, sourceLabel) {
      const skipped = parsed.meta.skipped || 0;
      if (which === "b") {
        rawRowsB = parsed.rows;
        presenceB = {
          hasTb: !!parsed.meta.hasTb,
          hasGosb: !!parsed.meta.hasGosb,
          hasCluster: !!parsed.meta.hasCluster
        };
        columnPresenceB = presenceB;
        allRowsB = aggregateByTn(rawRowsB);
        fileNameB = sourceLabel || "";
        renderFileOverview(el.fileOverviewB, {
          fileName: fileNameB,
          rawCount: rawRowsB.length,
          tnCount: allRowsB.length,
          rows: allRowsB,
          presence: presenceB,
          skipped
        });
      } else {
        rawRows = parsed.rows;
        presenceA = {
          hasTb: !!parsed.meta.hasTb,
          hasGosb: !!parsed.meta.hasGosb,
          hasCluster: !!parsed.meta.hasCluster
        };
        allRows = aggregateByTn(rawRows);
        fileNameA = sourceLabel || "";
        const slot = getActiveSlot();
        if (slot) {
          slot.rawRows = rawRows;
          slot.allRows = allRows;
          slot.presence = presenceA;
          slot.fileName = fileNameA;
          if (lastParsed && lastParsed.text) slot.text = lastParsed.text;
        }
        renderSlotsRail();
        renderFileOverview(el.fileOverviewA, {
          fileName: fileNameA,
          rawCount: rawRows.length,
          tnCount: allRows.length,
          rows: allRows,
          presence: presenceA,
          skipped
        });
      }
      // В сравнении при уже загруженном другом периоде — расширяем universe без сброса выбора
      const otherHasData = which === "b" ? allRows.length > 0 : allRowsB.length > 0;
      const resetFilters = !(viewMode === "compare" && otherHasData);
      refreshPresenceAndFilters(resetFilters);
      setLoadStatus("", "");
      initEdgeStateFromData(true);
      rebuild();
    }

    function refreshPresenceAndFilters(initial) {
      columnPresence = mergedColumnPresence();
      rebuildFilterOptions(initial);
      syncSliceOptions();
    }

    function mergedColumnPresence() {
      // Сравнение — union колонок обоих файлов; один период / анализ — только текущий файл
      if (viewMode === "compare") {
        return {
          hasTb: !!(presenceA.hasTb || presenceB.hasTb),
          hasGosb: !!(presenceA.hasGosb || presenceB.hasGosb),
          hasCluster: !!(presenceA.hasCluster || presenceB.hasCluster)
        };
      }
      return {
        hasTb: !!presenceA.hasTb,
        hasGosb: !!presenceA.hasGosb,
        hasCluster: !!presenceA.hasCluster
      };
    }

    /**
     * Источник для фильтров ТБ/ГОСБ/кластер.
     * Сравнение — объединение обоих периодов; один период и анализ — только текущий файл.
     */
    function activeRowsPool() {
      if (viewMode === "compare") {
        if (allRows.length && allRowsB.length) return allRows.concat(allRowsB);
        if (allRowsB.length) return allRowsB.slice();
        return allRows.slice();
      }
      return allRows.slice();
    }

    /** Уникальные значения поля из набора строк. */
    function uniqueSortedField(rows, field) {
      return [...new Set(rows.map((r) => r[field]).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "ru"));
    }

    /**
     * Собрать universe фильтров из пула строк.
     * В сравнении pool уже содержит оба файла → в списке будут ГОСБ/ТБ/кластеры,
     * которые есть хотя бы в одном периоде.
     */
    function buildFilterUniverse(pool, presence) {
      return {
        tb: presence.hasTb ? uniqueSortedField(pool, "tb") : [],
        gosb: presence.hasGosb ? uniqueSortedField(pool, "gosb") : [],
        cluster: presence.hasCluster ? uniqueSortedField(pool, "cluster") : []
      };
    }

    /**
     * После расширения universe (подгрузили второй период) — добавить новые значения
     * в выбор, если измерение не в режиме «снято всё»; исчезнувшие ключи убрать.
     */
    function mergeUniverseIntoSelections(prevUniverse, nextUniverse) {
      for (const dim of FILTER_DIMS) {
        const prevList = prevUniverse[dim] || [];
        const nextList = nextUniverse[dim] || [];
        const sel = filterSelections[dim] || new Set();
        const prevSet = new Set(prevList);
        const wasEmpty = sel.size === 0;

        for (const v of [...sel]) {
          if (!nextList.includes(v)) sel.delete(v);
        }
        if (!wasEmpty) {
          for (const v of nextList) {
            if (!prevSet.has(v)) sel.add(v);
          }
        } else if (prevList.length === 0 && nextList.length) {
          // Первое появление значений по измерению
          for (const v of nextList) sel.add(v);
        }
        filterSelections[dim] = sel;
      }
    }

    function svgIcon(name) {
      const icons = {
        file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        rows: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
        bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>',
        building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/></svg>',
        grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
        sum: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16M4 20h16M6 8l6 4-6 4"/></svg>',
        checkAll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 12l3.2 3.2L17 8.5"/></svg>',
        clearAll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8l8 8M16 8l-8 8"/></svg>',
        barsEqual: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M5 19V9M10 19V9M15 19V9M20 19V9"/></svg>',
        barsLadder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M5 19V5M10 19V9M15 19V13M20 19v-2"/></svg>',
        barsEven: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M4 19h16M6 19V8h3v11M11 19V8h3v11M16 19V8h3v11"/></svg>',
        download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>',
        downloadCsv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>',
        downloadList: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/><path d="M17 14v5"/><path d="M14.5 16.5L17 19l2.5-2.5"/></svg>',
        downloadStats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M4 19V9M9 19V5M14 19v-7M19 19V11"/><path d="M3 19h18"/></svg>'
      };
      return icons[name] || icons.file;
    }

    function fillBtnIcon(btn, iconName) {
      if (!btn) return;
      const ico = btn.querySelector(".btn-ico");
      if (ico) ico.innerHTML = svgIcon(iconName);
    }

    function topCounts(rows, field, limit) {
      const map = new Map();
      for (const r of rows) {
        const k = r[field];
        if (!k) continue;
        map.set(k, (map.get(k) || 0) + 1);
      }
      return [...map.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
        .slice(0, limit);
    }

    function renderFileOverview(target, info) {
      if (!target) return;
      if (!info || !info.tnCount) {
        target.innerHTML = "";
        return;
      }
      const rows = info.rows || [];
      const amounts = rows.map((r) => r.amount);
      const min = amounts.length ? Math.min(...amounts) : 0;
      const max = amounts.length ? Math.max(...amounts) : 0;
      const sum = amounts.reduce((a, b) => a + b, 0);
      const avg = amounts.length ? sum / amounts.length : 0;
      const tbTop = info.presence.hasTb ? topCounts(rows, "tb", 5) : [];
      const gosbTop = info.presence.hasGosb ? topCounts(rows, "gosb", 6) : [];
      const clTop = info.presence.hasCluster ? topCounts(rows, "cluster", 6) : [];
      const chips = (items) => items.map(([k, n]) =>
        `<span class="ov-chip" title="${k}">${k}: ${n}</span>`
      ).join("");

      target.innerHTML =
        `<div class="ov-card"><div class="ov-card__icon">${svgIcon("file")}</div>` +
          `<div><div class="ov-card__label">Файл</div><div class="ov-card__value">${escapeHtml(info.fileName || "—")}</div></div></div>` +
        `<div class="ov-card"><div class="ov-card__icon is-green">${svgIcon("rows")}</div>` +
          `<div><div class="ov-card__label">Строк</div><div class="ov-card__value">${formatInt(info.rawCount)}</div>` +
          (info.skipped ? `<div class="ov-card__sub">проп. ${info.skipped}</div>` : "") +
          `</div></div>` +
        `<div class="ov-card"><div class="ov-card__icon is-teal">${svgIcon("users")}</div>` +
          `<div><div class="ov-card__label">${escapeHtml(indicatorLabel())}</div><div class="ov-card__value">${formatInt(info.tnCount)}</div></div></div>` +
        `<div class="ov-card"><div class="ov-card__icon is-orange">${svgIcon("sum")}</div>` +
          `<div><div class="ov-card__label">Суммы</div><div class="ov-card__value">${formatAmount(avg)} ср.</div>` +
          `<div class="ov-card__sub">${formatAmountExact(min)}…${formatAmountExact(max)} · Σ ${formatAmount(sum)}</div></div></div>` +
        (tbTop.length
          ? `<div class="ov-card is-wide"><div class="ov-card__icon is-purple">${svgIcon("bank")}</div>` +
            `<div><div class="ov-card__label">ТБ · ${new Set(rows.map((r) => r.tb).filter(Boolean)).size}</div>` +
            `<div class="ov-card__sub"><div class="ov-chips">${chips(tbTop)}</div></div></div></div>`
          : "") +
        (gosbTop.length
          ? `<div class="ov-card is-wide"><div class="ov-card__icon">${svgIcon("building")}</div>` +
            `<div><div class="ov-card__label">ГОСБ · ${new Set(rows.map((r) => r.gosb).filter(Boolean)).size}</div>` +
            `<div class="ov-card__sub"><div class="ov-chips">${chips(gosbTop)}</div></div></div></div>`
          : "") +
        (clTop.length
          ? `<div class="ov-card is-wide"><div class="ov-card__icon is-green">${svgIcon("grid")}</div>` +
            `<div><div class="ov-card__label">Кластер · ${new Set(rows.map((r) => r.cluster).filter(Boolean)).size}</div>` +
            `<div class="ov-card__sub"><div class="ov-chips">${chips(clTop)}</div></div></div></div>`
          : "");
    }

    function escapeHtml(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function formatInt(n) {
      return Number(n).toLocaleString("ru-RU");
    }

    function syncSliceOptions() {
      const opts = el.sliceMode.options;
      for (let i = 0; i < opts.length; i += 1) {
        const v = opts[i].value;
        let ok = true;
        if (v === "tb") ok = columnPresence.hasTb;
        else if (v === "cluster") ok = columnPresence.hasCluster;
        else if (v === "gosb" || v === "tb_gosb") ok = false;
        opts[i].disabled = !ok;
      }
      const cur = el.sliceMode.value;
      if (cur === "gosb" || cur === "tb_gosb" || (el.sliceMode.selectedOptions[0] && el.sliceMode.selectedOptions[0].disabled)) {
        el.sliceMode.value = "all";
      }
      syncGroupLayoutUi();
    }

    /** Предыдущий разрез — чтобы при переходе с «все» включить «Значения» по умолчанию. */
    let prevSliceForLayout = null;

    function syncSegFromSelect(segEl, selectEl) {
      if (!segEl || !selectEl) return;
      const cur = selectEl.value;
      segEl.querySelectorAll(".seg__btn").forEach((btn) => {
        btn.classList.toggle("is-on", btn.getAttribute("data-value") === cur);
        btn.setAttribute("aria-pressed", btn.getAttribute("data-value") === cur ? "true" : "false");
      });
    }

    function setSegBtnLocked(segEl, value, locked, tipWhenLocked) {
      if (!segEl) return;
      const btn = segEl.querySelector('.seg__btn[data-value="' + value + '"]');
      if (!btn) return;
      btn.classList.toggle("is-locked", !!locked);
      btn.disabled = !!locked;
      if (locked && tipWhenLocked) btn.setAttribute("data-tip", tipWhenLocked);
      else btn.removeAttribute("data-tip");
    }

    /**
     * Взаимные ограничения: линия ↔ наложение с перекрытием;
     * «Значения» групп — только при разрезе ≠ all.
     */
    function syncChartModeConstraints() {
      const chartType = (el.chartType && el.chartType.value) || "bars";
      const compareLayout = (el.compareLayout && el.compareLayout.value) || "overlay";
      const slice = (el.sliceMode && el.sliceMode.value) || "all";
      const overlapOpt = el.compareLayout && el.compareLayout.querySelector('option[value="overlap"]');

      if (viewMode === "compare" && overlapOpt) {
        const nonBarsBlockOverlap = chartType !== "bars";
        overlapOpt.disabled = nonBarsBlockOverlap;
        if (nonBarsBlockOverlap && compareLayout === "overlap") {
          el.compareLayout.value = "overlay";
        }
      } else if (overlapOpt) {
        overlapOpt.disabled = false;
      }

      const overlapBlocksLine = viewMode === "compare" &&
        ((el.compareLayout && el.compareLayout.value) || "overlay") === "overlap";
      if (overlapBlocksLine && chartType !== "bars" && el.chartType) {
        el.chartType.value = "bars";
      }
      setSegBtnLocked(
        el.chartTypeSeg,
        "line",
        overlapBlocksLine,
        "Недоступно при «Наложении с перекрытием» — сначала смените компоновку"
      );
      setSegBtnLocked(
        el.chartTypeSeg,
        "candles",
        overlapBlocksLine,
        "Недоступно при «Наложении с перекрытием» — сначала смените компоновку"
      );
      setSegBtnLocked(
        el.chartTypeSeg,
        "candles_tn",
        overlapBlocksLine,
        "Недоступно при «Наложении с перекрытием» — сначала смените компоновку"
      );

      // Свечи всегда строим по интервалам (ось X = интервалы)
      const candlesLockSlice = isCandleChartType(chartType);
      if (candlesLockSlice && el.groupLayout && el.groupLayout.value === "slice") {
        el.groupLayout.value = "bin";
      }

      const sliceLocked = slice === "all";
      if ((sliceLocked || candlesLockSlice) && el.groupLayout && el.groupLayout.value === "slice") {
        el.groupLayout.value = "bin";
      }
      setSegBtnLocked(
        el.groupLayoutSeg,
        "slice",
        sliceLocked || candlesLockSlice,
        candlesLockSlice
          ? "Для свечей ось X фиксирована: только интервалы"
          : "Сначала выберите разрез ТБ или кластер"
      );

      syncSegFromSelect(el.chartTypeSeg, el.chartType);
      syncSegFromSelect(el.groupLayoutSeg, el.groupLayout);
    }

    function syncGroupLayoutUi() {
      const slice = el.sliceMode.value;
      const preferSlice = (APP_CONFIG.defaultGroupLayout || "slice") === "slice";
      if (slice === "all") {
        if (el.groupLayout.value === "slice") el.groupLayout.value = "bin";
      } else if (preferSlice && (prevSliceForLayout === "all" || prevSliceForLayout == null)) {
        el.groupLayout.value = "slice";
      }
      prevSliceForLayout = slice;
      syncChartModeConstraints();
    }

    function bindSegmentedControl(segEl, selectEl, afterChange) {
      if (!segEl || !selectEl) return;
      segEl.querySelectorAll(".seg__btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.disabled || btn.classList.contains("is-locked")) return;
          const v = btn.getAttribute("data-value");
          if (!v || selectEl.value === v) return;
          selectEl.value = v;
          syncSegFromSelect(segEl, selectEl);
          syncChartModeConstraints();
          if (typeof afterChange === "function") afterChange();
        });
      });
      syncSegFromSelect(segEl, selectEl);
    }

    /** Состояние фильтров (источник правды; DOM только отображает). */
    let filterSelections = { tb: new Set(), gosb: new Set(), cluster: new Set() };

    /** Индекс ТБ ↔ ГОСБ ↔ кластер по данным. */
    let orgIndex = {
      tbToGosb: new Map(),
      gosbToTb: new Map(),
      tbToCluster: new Map(),
      gosbToCluster: new Map(),
      clusterToTb: new Map(),
      clusterToGosb: new Map()
    };

    function addToMapSet(map, key, value) {
      if (!key || !value) return;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(value);
    }

    function buildOrgIndex(rows) {
      const idx = {
        tbToGosb: new Map(),
        gosbToTb: new Map(),
        tbToCluster: new Map(),
        gosbToCluster: new Map(),
        clusterToTb: new Map(),
        clusterToGosb: new Map()
      };
      for (const r of rows) {
        addToMapSet(idx.tbToGosb, r.tb, r.gosb);
        addToMapSet(idx.gosbToTb, r.gosb, r.tb);
        addToMapSet(idx.tbToCluster, r.tb, r.cluster);
        addToMapSet(idx.gosbToCluster, r.gosb, r.cluster);
        addToMapSet(idx.clusterToTb, r.cluster, r.tb);
        addToMapSet(idx.clusterToGosb, r.cluster, r.gosb);
      }
      return idx;
    }

    function cloneSelections(sel) {
      return {
        tb: new Set(sel.tb || []),
        gosb: new Set(sel.gosb || []),
        cluster: new Set(sel.cluster || [])
      };
    }

    function readSelections() {
      return cloneSelections(filterSelections);
    }

    /** Допустимые значения dim; пустой выбор по другому измерению = нет ограничения. */
    function computeAllowedValues(dim, selections, rows) {
      let filtered = rows;
      for (const d of FILTER_DIMS) {
        if (d === dim) continue;
        const sel = selections[d];
        if (!sel || sel.size === 0) continue;
        filtered = filtered.filter((r) => !r[d] || sel.has(r[d]));
      }
      return new Set(filtered.map((r) => r[dim]).filter(Boolean));
    }

    function computeAllAllowed(selections, rows) {
      return {
        tb: computeAllowedValues("tb", selections, rows),
        gosb: computeAllowedValues("gosb", selections, rows),
        cluster: computeAllowedValues("cluster", selections, rows)
      };
    }

    /**
     * При выборе «серого» / любого пункта — подтянуть родителей и зависимых.
     * Возвращает список добавленных меток для подсказки.
     */
    function expandSelectionOnCheck(dim, value, sel) {
      const added = [];
      const markAdd = (d, v) => {
        if (!v || sel[d].has(v)) return;
        sel[d].add(v);
        added.push(d + ":" + v);
      };

      if (dim === "tb") {
        // Выбор ТБ (в т.ч. «серого») — сразу все его ГОСБ и кластеры
        const gosbs = orgIndex.tbToGosb.get(value) || new Set();
        for (const g of gosbs) markAdd("gosb", g);
        const clusters = orgIndex.tbToCluster.get(value) || new Set();
        for (const c of clusters) markAdd("cluster", c);
      } else if (dim === "gosb") {
        // Выбор ГОСБ — только родительский ТБ (и кластеры этого ГОСБ); остальные ГОСБ ТБ не трогаем
        const tbs = orgIndex.gosbToTb.get(value) || new Set();
        for (const t of tbs) markAdd("tb", t);
        const clusters = orgIndex.gosbToCluster.get(value) || new Set();
        for (const c of clusters) markAdd("cluster", c);
      } else if (dim === "cluster") {
        const tbs = orgIndex.clusterToTb.get(value) || new Set();
        for (const t of tbs) markAdd("tb", t);
        const gosbs = orgIndex.clusterToGosb.get(value) || new Set();
        for (const g of gosbs) markAdd("gosb", g);
      }
      return added;
    }

    /** При снятии — убрать осиротевшие зависимые (в обе стороны: орг ↔ кластер). */
    function pruneOrphansAfterUncheck(dim, value, sel) {
      const pool = activeRowsPool();
      if (dim === "tb") {
        for (const g of [...sel.gosb]) {
          const parents = orgIndex.gosbToTb.get(g) || new Set();
          const still = [...parents].some((t) => sel.tb.has(t));
          if (!still) sel.gosb.delete(g);
        }
        for (const c of [...sel.cluster]) {
          const still = pool.some(
            (r) => r.cluster === c &&
              ((r.tb && sel.tb.has(r.tb)) || (r.gosb && sel.gosb.has(r.gosb)))
          );
          if (!still) sel.cluster.delete(c);
        }
      } else if (dim === "gosb") {
        for (const c of [...sel.cluster]) {
          const still = pool.some(
            (r) => r.cluster === c &&
              ((r.gosb && sel.gosb.has(r.gosb)) || (r.tb && sel.tb.has(r.tb) && !r.gosb))
          );
          if (!still) sel.cluster.delete(c);
        }
      } else if (dim === "cluster") {
        pruneOrgBySelectedClusters(sel);
      }
    }

    /** ТБ/ГОСБ оставляем только если связаны с выбранными кластерами. */
    function pruneOrgBySelectedClusters(sel) {
      if (!sel.cluster.size) {
        sel.tb.clear();
        sel.gosb.clear();
        return;
      }
      for (const t of [...sel.tb]) {
        const linked = orgIndex.tbToCluster.get(t) || new Set();
        if (![...linked].some((c) => sel.cluster.has(c))) sel.tb.delete(t);
      }
      for (const g of [...sel.gosb]) {
        const linked = orgIndex.gosbToCluster.get(g) || new Set();
        if (![...linked].some((c) => sel.cluster.has(c))) sel.gosb.delete(g);
      }
    }

    /**
     * Массовый выбор / снятие сразу по ТБ, ГОСБ и кластерам.
     * @param {boolean} selectAll
     */
    function applyBulkFilterSelection(selectAll) {
      if (selectAll) {
        filterSelections = {
          tb: new Set(filterUniverse.tb),
          gosb: new Set(filterUniverse.gosb),
          cluster: new Set(filterUniverse.cluster)
        };
      } else {
        filterSelections = {
          tb: new Set(),
          gosb: new Set(),
          cluster: new Set()
        };
      }
    }

    function applySelectionChange(dim, value, checked) {
      const sel = cloneSelections(filterSelections);
      let hint = "";
      if (checked) {
        sel[dim].add(value);
        const added = expandSelectionOnCheck(dim, value, sel);
        if (added.length) {
          hint = "Добавлены связанные: " + added.slice(0, 10).join(", ") + (added.length > 10 ? "…" : "");
        }
      } else {
        sel[dim].delete(value);
        pruneOrphansAfterUncheck(dim, value, sel);
      }
      filterSelections = sel;
      return hint;
    }

    /** Стабильный порядок списка (без перестановки при выборе). */
    function orderFilterValues(allValues, allowed, checked) {
      return allValues.map((value) => ({
        value,
        enabled: allowed.has(value),
        checked: checked.has(value)
      }));
    }

    function stableSorted(list) {
      return [...list].sort((a, b) => a.localeCompare(b, "ru"));
    }

    /** all | partial | none по выбранным из universe. */
    function selectionFillState(selectedSet, universeList) {
      const total = universeList.length;
      if (!total) return "none";
      let n = 0;
      for (const v of universeList) {
        if (selectedSet.has(v)) n += 1;
      }
      if (n <= 0) return "none";
      if (n >= total) return "all";
      return "partial";
    }

    function setFilterBlockSelClass(node, state) {
      if (!node) return;
      node.classList.remove("is-sel-all", "is-sel-partial", "is-sel-none");
      node.classList.add("is-sel-" + state);
    }

    function syncFilterBlockSelectionStyles() {
      const orgItems = filterUniverse.tb.concat(filterUniverse.gosb);
      const orgSelected = new Set([...(filterSelections.tb || []), ...(filterSelections.gosb || [])]);
      setFilterBlockSelClass(el.orgTreeFilterBlock, selectionFillState(orgSelected, orgItems));
      setFilterBlockSelClass(
        el.clusterFilterBlock,
        selectionFillState(filterSelections.cluster || new Set(), filterUniverse.cluster)
      );
    }

    function rebuildFilterOptions(initial, hintText) {
      const pool = activeRowsPool();
      const showTb = columnPresence.hasTb && pool.some((r) => r.tb);
      const showGosb = columnPresence.hasGosb && pool.some((r) => r.gosb);
      const showCluster = columnPresence.hasCluster && pool.some((r) => r.cluster);
      const showOrg = showTb || showGosb;

      if (el.orgTreeFilterBlock) el.orgTreeFilterBlock.classList.toggle("hidden", !showOrg);
      el.clusterFilterBlock.classList.toggle("hidden", !showCluster);

      orgIndex = buildOrgIndex(pool);

      const prevUniverse = {
        tb: (filterUniverse.tb || []).slice(),
        gosb: (filterUniverse.gosb || []).slice(),
        cluster: (filterUniverse.cluster || []).slice()
      };
      filterUniverse = buildFilterUniverse(pool, {
        hasTb: showTb,
        hasGosb: showGosb,
        hasCluster: showCluster
      });

      if (initial) {
        filterSelections = {
          tb: new Set(filterUniverse.tb),
          gosb: new Set(filterUniverse.gosb),
          cluster: new Set(filterUniverse.cluster)
        };
      } else {
        mergeUniverseIntoSelections(prevUniverse, filterUniverse);
      }

      const selections = readSelections();
      const allowed = computeAllAllowed(selections, pool);

      if (el.filterHint) {
        const base = hintText || "";
        const compareNote = (viewMode === "compare" && allRows.length && allRowsB.length)
          ? (base ? base + " · " : "") + "Фильтры: уникальные ТБ/ГОСБ/кластер из обоих периодов"
          : base;
        el.filterHint.textContent = compareNote;
      }

      if (showOrg) renderOrgTree(allowed, selections);
      else if (el.orgTree) el.orgTree.innerHTML = "";

      if (showCluster) {
        renderChecks(
          el.clusterChecks,
          orderFilterValues(filterUniverse.cluster, allowed.cluster, selections.cluster),
          "cluster"
        );
      } else {
        el.clusterChecks.innerHTML = "";
      }
      syncFilterBlockSelectionStyles();
    }

    function renderOrgTree(allowed, selections) {
      const root = el.orgTree;
      if (!root) return;
      root.innerHTML = "";
      if (!filterUniverse.tb.length && !filterUniverse.gosb.length) {
        root.innerHTML = '<div class="empty">Нет значений</div>';
        return;
      }

      const tbOrder = filterUniverse.tb.slice();
      const orphanGosb = filterUniverse.gosb.filter((g) => {
        const tbs = orgIndex.gosbToTb.get(g);
        return !tbs || tbs.size === 0;
      });

      for (const tb of tbOrder) {
        const tbChecked = selections.tb.has(tb);
        const childG = stableSorted([...(orgIndex.tbToGosb.get(tb) || [])]);
        let gosbCheckedN = 0;
        for (const g of childG) {
          if (selections.gosb.has(g)) gosbCheckedN += 1;
        }
        let blockState = "none";
        if (childG.length) {
          if (tbChecked && gosbCheckedN === childG.length) blockState = "all";
          else if (tbChecked || gosbCheckedN > 0) blockState = "partial";
        } else {
          blockState = tbChecked ? "all" : "none";
        }

        const block = document.createElement("div");
        block.className = "filter-tree__tb is-sel-" + blockState;

        const tbLab = document.createElement("label");
        tbLab.className = "filter-tree__row filter-tree__row--tb" + (tbChecked ? "" : " is-muted");
        const tbInp = document.createElement("input");
        tbInp.type = "checkbox";
        tbInp.checked = tbChecked;
        tbInp.dataset.group = "tb";
        tbInp.value = tb;
        tbInp.addEventListener("change", onFilterCheckboxChange);
        const tbSpan = document.createElement("span");
        tbSpan.textContent = tb;
        const badge = document.createElement("span");
        badge.className = "filter-tree__badge";
        badge.textContent = childG.length ? childG.length + " ГОСБ" : "";
        tbLab.appendChild(tbInp);
        tbLab.appendChild(tbSpan);
        if (childG.length) tbLab.appendChild(badge);
        block.appendChild(tbLab);

        for (const g of childG) {
          const gChecked = selections.gosb.has(g);
          const gLab = document.createElement("label");
          gLab.className = "filter-tree__row filter-tree__row--gosb" + (gChecked ? "" : " is-muted");
          const gInp = document.createElement("input");
          gInp.type = "checkbox";
          gInp.checked = gChecked;
          gInp.dataset.group = "gosb";
          gInp.value = g;
          gInp.addEventListener("change", onFilterCheckboxChange);
          const gSpan = document.createElement("span");
          gSpan.textContent = g;
          gLab.appendChild(gInp);
          gLab.appendChild(gSpan);
          block.appendChild(gLab);
        }
        root.appendChild(block);
      }

      if (orphanGosb.length) {
        const orphans = stableSorted(orphanGosb);
        let oChecked = 0;
        for (const g of orphans) {
          if (selections.gosb.has(g)) oChecked += 1;
        }
        let oState = "none";
        if (oChecked >= orphans.length) oState = "all";
        else if (oChecked > 0) oState = "partial";

        const block = document.createElement("div");
        block.className = "filter-tree__tb is-sel-" + oState;
        const title = document.createElement("div");
        title.className = "filter-tree__row filter-tree__row--tb is-muted";
        title.textContent = "ГОСБ без ТБ";
        block.appendChild(title);
        for (const g of orphans) {
          const gChecked = selections.gosb.has(g);
          const gLab = document.createElement("label");
          gLab.className = "filter-tree__row filter-tree__row--gosb" + (gChecked ? "" : " is-muted");
          const gInp = document.createElement("input");
          gInp.type = "checkbox";
          gInp.checked = gChecked;
          gInp.dataset.group = "gosb";
          gInp.value = g;
          gInp.addEventListener("change", onFilterCheckboxChange);
          const gSpan = document.createElement("span");
          gSpan.textContent = g;
          gLab.appendChild(gInp);
          gLab.appendChild(gSpan);
          block.appendChild(gLab);
        }
        root.appendChild(block);
      }
    }

    function renderChecks(container, items, group) {
      container.innerHTML = "";
      if (!items.length) {
        container.innerHTML = '<div class="empty">Нет значений</div>';
        return;
      }
      for (const item of items) {
        const label = document.createElement("label");
        if (!item.checked) label.classList.add("is-muted");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!item.checked;
        input.disabled = false;
        input.dataset.group = group;
        input.value = item.value;
        const span = document.createElement("span");
        span.textContent = item.value;
        input.addEventListener("change", onFilterCheckboxChange);
        label.appendChild(input);
        label.appendChild(span);
        container.appendChild(label);
      }
    }

    function onFilterCheckboxChange(ev) {
      const inp = ev.currentTarget;
      const dim = inp.dataset.group;
      const value = inp.value;
      const hint = applySelectionChange(dim, value, inp.checked);
      rebuildFilterOptions(false, hint);
      initEdgeStateFromData(false);
      rebuild();
    }

    function filteredRowsFrom(sourceRows) {
      let rows = sourceRows;
      const showOrg = el.orgTreeFilterBlock && !el.orgTreeFilterBlock.classList.contains("hidden");
      const showCluster = !el.clusterFilterBlock.classList.contains("hidden");
      const selTb = (showOrg && columnPresence.hasTb && filterSelections.tb.size > 0)
        ? filterSelections.tb : null;
      const selGosb = (showOrg && columnPresence.hasGosb && filterSelections.gosb.size > 0)
        ? filterSelections.gosb : null;
      const selCluster = (showCluster && columnPresence.hasCluster && filterSelections.cluster.size > 0)
        ? filterSelections.cluster : null;
      if (!selTb && !selGosb && !selCluster) return rows;
      const out = [];
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        if (selTb && r.tb && !selTb.has(r.tb)) continue;
        if (selGosb && r.gosb && !selGosb.has(r.gosb)) continue;
        if (selCluster && r.cluster && !selCluster.has(r.cluster)) continue;
        out.push(r);
      }
      return out;
    }

    /** Кэш фильтров на один кадр rebuild/drag — без повторных проходов. */
    let frameFilterSnap = null;

    function clearFrameFilterSnap() {
      frameFilterSnap = null;
    }

    function getFrameFilterSnap() {
      if (frameFilterSnap) return frameFilterSnap;
      const rowsA = filteredRowsFrom(allRows);
      const rowsB = filteredRowsFrom(allRowsB);
      const edgeRows = (viewMode === "compare" && allRowsB.length)
        ? rowsA.concat(rowsB)
        : rowsA;
      const checkRows = edgeRows.length ? edgeRows : allRows;
      let scale = { min: 0, max: 1 };
      if (checkRows.length) {
        let mn = Infinity;
        let mx = -Infinity;
        for (let i = 0; i < checkRows.length; i += 1) {
          const v = Number(checkRows[i].amount) || 0;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        scale = integerBounds(mn, mx);
      }
      const zeroAnchor = includePositiveOnlyForAutoEdges()
        && checkRows.length > 0
        && scale.min < 0
        && scale.max > 0;
      frameFilterSnap = { rowsA, rowsB, edgeRows, checkRows, scale, zeroAnchor };
      return frameFilterSnap;
    }

    function filteredRows() {
      return getFrameFilterSnap().rowsA;
    }

    function filteredRowsB() {
      return getFrameFilterSnap().rowsB;
    }

    function edgeSourceRows() {
      return getFrameFilterSnap().edgeRows;
    }

    function currentEdgeCalcMode() {
      return (el.edgeCalcMode && el.edgeCalcMode.value === "all") ? "all" : "positive";
    }

    function includePositiveOnlyForAutoEdges() {
      return currentEdgeCalcMode() === "positive";
    }

    function rowsForAutoEdgeCalc(rows) {
      if (!includePositiveOnlyForAutoEdges()) return rows.slice();
      // Для авторасчёта берём строго >0: нули попадут в первый положительный интервал [0..).
      const pos = rows.filter((r) => Number(r.amount) > 0);
      return pos.length ? pos : rows.filter((r) => Number(r.amount) >= 0);
    }

    /** Точные мин/макс по суммам ТН (без floor/ceil). */
    function dataMinMax(rows) {
      if (!rows.length) return { min: 0, max: 1 };
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < rows.length; i += 1) {
        const v = rows[i].amount;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return { min, max };
    }

    /** Мин/макс шкалы границ — целые (низ вниз, верх вверх). */
    function edgeScaleMinMax(rows) {
      const raw = dataMinMax(rows);
      return integerBounds(raw.min, raw.max);
    }

    /** Нужен ли фиксированный якорь 0 (отрицательная зона отдельным интервалом). */
    function shouldAnchorZeroEdge(rows) {
      if (!includePositiveOnlyForAutoEdges()) return false;
      if (!rows || !rows.length) return false;
      const scale = edgeScaleMinMax(rows);
      return scale.min < 0 && scale.max > 0;
    }

    function rowsForZeroAnchorCheck() {
      const snap = getFrameFilterSnap();
      return snap.checkRows;
    }

    /** Быстрый флаг якоря 0 из кадра (без повторного скана). */
    function isZeroAnchoredNow() {
      return getFrameFilterSnap().zeroAnchor;
    }

    /** Индекс 1 — фиксированная граница 0 в positive-режиме. */
    function isZeroAnchorIndex(idx) {
      return idx === 1 && isZeroAnchoredNow();
    }

    /**
     * Нормализация рёбер без зависимости от stale edgeState.min/max.
     * Гарантирует монотонность и фиксированные концы.
     */
    function normalizeEdges(edges, min, max) {
      const out = edges.map(toIntegerEdge);
      if (!out.length) return out;
      const lo = toIntegerEdge(min);
      const hi = toIntegerEdge(max);
      out[0] = lo;
      out[out.length - 1] = hi;
      for (let i = 1; i < out.length; i += 1) {
        if (out[i] < out[i - 1]) out[i] = out[i - 1];
      }
      for (let i = out.length - 2; i >= 0; i -= 1) {
        if (out[i] > out[i + 1]) out[i] = out[i + 1];
      }
      out[0] = lo;
      out[out.length - 1] = hi;
      return out;
    }

    /**
     * Устраняет нулевые/пустые интервалы: consecutive edges поднимаем
     * до следующего уникального значения из sorted (или +1), пока позволяет max.
     */
    function ensureStrictlyIncreasingEdges(edges, sortedAmounts, min, max) {
      const out = normalizeEdges(edges, min, max);
      if (out.length < 3) return out;
      const sorted = (sortedAmounts || [])
        .filter((x) => Number.isFinite(x))
        .map((x) => toIntegerEdge(x))
        .sort((a, b) => a - b);
      const uniq = [];
      for (const v of sorted) {
        if (!uniq.length || uniq[uniq.length - 1] !== v) uniq.push(v);
      }
      const hi = toIntegerEdge(max);
      for (let i = 1; i < out.length - 1; i += 1) {
        if (out[i] > out[i - 1]) continue;
        let next = out[i - 1] + 1;
        // Ищем следующее значение из данных, строго больше предыдущей границы
        for (const v of uniq) {
          if (v > out[i - 1]) {
            next = v;
            break;
          }
        }
        // Оставляем запас для оставшихся границ
        const remain = out.length - 1 - i;
        const maxAllowed = hi - remain;
        if (next > maxAllowed) next = Math.max(out[i - 1], maxAllowed);
        out[i] = next;
      }
      return normalizeEdges(out, min, max);
    }

    function cascadeEdges(edges, changedIndex) {
      const out = edges.map(toIntegerEdge);
      for (let i = changedIndex + 1; i < out.length; i += 1) {
        if (out[i] < out[i - 1]) out[i] = out[i - 1];
      }
      for (let i = changedIndex - 1; i >= 0; i -= 1) {
        if (out[i] > out[i + 1]) out[i] = out[i + 1];
      }
      // В positive-режиме граница 0 (индекс 1) всегда зафиксирована.
      if (isZeroAnchoredNow() && out.length > 2) {
        out[1] = 0;
        for (let i = 2; i < out.length; i += 1) {
          if (out[i] < out[i - 1]) out[i] = out[i - 1];
        }
      }
      out[0] = edgeState.min;
      out[out.length - 1] = edgeState.max;
      return out;
    }

    function evenlySpacedEdges(min, max, movableCount) {
      const n = Math.max(0, Math.floor(movableCount));
      const lo = toIntegerEdge(min);
      const hi = toIntegerEdge(max);
      if (n <= 0 || hi <= lo) return normalizeEdges([lo, hi], lo, hi);
      const totalIntervals = n + 1;
      const edges = [lo];
      for (let i = 1; i <= n; i += 1) {
        edges.push(toIntegerEdge(lo + ((hi - lo) * i) / totalIntervals));
      }
      edges.push(hi);
      return ensureStrictlyIncreasingEdges(edges, null, lo, hi);
    }

    /**
     * Следующее различное значение в sorted строго больше minExclusive.
     * Нужно, чтобы не плодить пустые интервалы 0,1,2… внутри плато одинаковых сумм.
     */
    function nextDistinctAbove(sorted, fromIdx, minExclusive) {
      const start = Math.max(0, fromIdx | 0);
      for (let j = start; j < sorted.length; j += 1) {
        const sj = toIntegerEdge(sorted[j]);
        if (sj > minExclusive) return sj;
      }
      return null;
    }

    /**
     * Границы по весам числа ТН (равно / лесенка).
     * Режет весь [min..max] слева направо: каждый интервал получает долю по числу ТН.
     * При плато одинаковых значений (много нулей и т.п.) граница ставится на следующее
     * различное значение — иначе появятся пустые столбики prev+1, prev+2 без данных.
     * Точные доли на плато невозможны (одно значение нельзя разрезать порогом).
     * @param {number} movableCount — число внутренних границ (= intervals - 1)
     */
    function weightedCountEdges(amounts, movableCount, min, max, weights) {
      const n = Math.max(0, Math.floor(movableCount));
      const lo = toIntegerEdge(min);
      const hi = toIntegerEdge(max);
      if (n <= 0 || hi <= lo) return normalizeEdges([lo, hi], lo, hi);
      const binCount = n + 1;
      const sorted = amounts.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
      if (!sorted.length) return evenlySpacedEdges(lo, hi, n);

      const w = (weights && weights.length === binCount)
        ? weights.map((x) => Math.max(0, Number(x) || 0))
        : Array(binCount).fill(1);
      const totalW = w.reduce((a, b) => a + b, 0) || binCount;

      const targets = w.map((wi) => (wi / totalW) * sorted.length);
      const edges = [lo];
      let cumItems = 0;
      for (let i = 0; i < n; i += 1) {
        cumItems += targets[i];
        let end = Math.round(cumItems);
        const remainBins = binCount - (i + 1);
        const minEnd = i + 1;
        const maxEnd = Math.max(minEnd, sorted.length - remainBins);
        if (end < minEnd) end = minEnd;
        if (end > maxEnd) end = maxEnd;
        if (end > sorted.length - 1) end = sorted.length - 1;
        if (end < 1) end = 1;

        const prev = edges[edges.length - 1];
        const maxAllowed = hi - remainBins;
        // Префикс ~end элементов должен оказаться слева от границы:
        // lastIncl = sorted[end-1], граница = первое значение > lastIncl (и > prev).
        const lastIncl = toIntegerEdge(sorted[end - 1]);
        let v = nextDistinctAbove(sorted, end - 1, Math.max(prev, lastIncl));
        if (v == null) {
          // Данных с новыми значениями больше нет — равномерно добиваем до hi
          const gap = Math.max(1, maxAllowed - prev);
          v = prev + Math.max(1, Math.floor(gap / (remainBins + 1)));
        }
        if (v <= prev) v = prev + 1;
        if (lo === 0 && v <= 0) v = Math.max(1, prev + 1);
        if (v > maxAllowed) v = Math.max(prev + 1, maxAllowed);
        if (v < lo) v = lo;
        if (v > hi) v = hi;
        edges.push(v);
      }
      edges.push(hi);
      return ensureStrictlyIncreasingEdges(edges, sorted, lo, hi);
    }

    function equalCountEdges(amounts, movableCount, min, max) {
      const n = Math.max(0, Math.floor(movableCount));
      const binCount = n + 1;
      return weightedCountEdges(amounts, n, min, max, Array(binCount).fill(1));
    }

    function ladderCountEdges(amounts, movableCount, min, max) {
      const n = Math.max(0, Math.floor(movableCount));
      const binCount = n + 1;
      const weights = Array.from({ length: binCount }, (_, i) => binCount - i);
      return weightedCountEdges(amounts, n, min, max, weights);
    }

    /** Текущее число интервалов из поля (это столбики, не бегунки). */
    function readIntervalCount() {
      const maxI = Math.max(1, Number(APP_CONFIG.movableEdgesMax) || 40);
      const def = Math.max(1, Number(APP_CONFIG.defaultMovableEdges) || 3);
      const raw = Number(el.movableEdgeCount && el.movableEdgeCount.value);
      const n = Math.max(1, Math.min(maxI, Number.isFinite(raw) ? raw : def));
      if (el.movableEdgeCount) el.movableEdgeCount.value = String(n);
      return n;
    }

    /** Ожидаемое число точек edges при заданном числе интервалов. */
    function expectedEdgePointCount(intervalCount, rowsForAnchor) {
      const k = Math.max(1, Math.floor(intervalCount));
      return shouldAnchorZeroEdge(rowsForAnchor) ? (k + 2) : (k + 1);
    }

    /**
     * Построить рёбра для ровно intervalCount интервалов на [min..max].
     */
    function buildEdgesForIntervalCount(amounts, intervalCount, min, max, kind) {
      const k = Math.max(1, Math.floor(intervalCount));
      const movable = Math.max(0, k - 1);
      if (kind === "even") return evenlySpacedEdges(min, max, movable);
      if (kind === "ladder") return ladderCountEdges(amounts, movable, min, max);
      return equalCountEdges(amounts, movable, min, max);
    }

    /** Число уникальных целых значений суммы в наборе. */
    function uniqueAmountCount(rows) {
      const set = new Set();
      for (const r of rows || []) {
        const v = Number(r && r.amount);
        if (!Number.isFinite(v)) continue;
        set.add(toIntegerEdge(v));
      }
      return set.size;
    }

    /** Фактические счётчики ТН по интервалам для уже рассчитанных границ. */
    function countsByEdges(rows, edges) {
      const n = Math.max(0, (edges && edges.length ? edges.length : 0) - 1);
      const out = Array(n).fill(0);
      for (const r of rows || []) {
        const bi = binIndexForAmount(Number(r && r.amount), edges);
        if (bi >= 0 && bi < n) out[bi] += 1;
      }
      return out;
    }

    /** Краткая диагностика отклонений по интервалам от целевого профиля. */
    function edgeBalanceHint(counts, mode) {
      const n = counts.length;
      if (!n) return "";
      const total = counts.reduce((a, b) => a + b, 0);
      if (!total) return "";
      if (mode === "ladder") {
        const w = Array.from({ length: n }, (_, i) => n - i);
        const ws = w.reduce((a, b) => a + b, 0);
        let maxAbs = 0;
        for (let i = 0; i < n; i += 1) {
          const target = (w[i] / ws) * total;
          const d = Math.abs(counts[i] - target);
          if (d > maxAbs) maxAbs = d;
        }
        return `Лесенка: всего ${total} ТН, max |Δ| по интервалу ≈ ${maxAbs.toFixed(1)} ТН.`;
      }
      const target = total / n;
      let maxAbs = 0;
      for (let i = 0; i < n; i += 1) {
        const d = Math.abs(counts[i] - target);
        if (d > maxAbs) maxAbs = d;
      }
      return `Равно по показателю: всего ${total}, цель ≈ ${target.toFixed(1)} /интервал, max |Δ| ≈ ${maxAbs.toFixed(1)}.`;
    }

    /**
     * Авторасчёт границ.
     * intervalCount — число интервалов (столбиков):
     * - режим «все»: intervalCount интервалов на всём [min..max];
     * - режим «только положительные»: intervalCount положительных интервалов на [0..max],
     *   плюс отдельная колонка отрицательных [min..0] (если min < 0); граница 0 фиксирована.
     */
    function buildAutoEdges(rowsFull, intervalCount, kind) {
      let k = Math.max(1, Math.floor(intervalCount));
      const scaleRows = (viewMode === "compare" && allRowsB.length)
        ? edgeSourceRows()
        : rowsFull;
      const fullScale = edgeScaleMinMax(scaleRows.length ? scaleRows : rowsFull);
      const lo = fullScale.min;
      const hi = fullScale.max;

      // --- Режим "все значения": k интервалов по ВСЕМ суммам (отриц. + нули + полож.) ---
      if (!includePositiveOnlyForAutoEdges()) {
        const amounts = rowsFull
          .map((r) => Number(r.amount))
          .filter((v) => Number.isFinite(v));
        const uniq = uniqueAmountCount(rowsFull);
        if (uniq > 0) k = Math.min(k, uniq);
        return buildEdgesForIntervalCount(amounts, k, lo, hi, kind);
      }

      // --- Режим "только положительные" ---
      const anchorRows = scaleRows.length ? scaleRows : rowsFull;
      const anchored = shouldAnchorZeroEdge(anchorRows);
      const posAmounts = rowsFull
        .map((r) => Number(r.amount))
        .filter((v) => Number.isFinite(v) && v > 0);
      const nonNegAmounts = rowsFull
        .map((r) => Number(r.amount))
        .filter((v) => Number.isFinite(v) && v >= 0);
      const calcAmounts = posAmounts.length ? posAmounts : nonNegAmounts;

      // Нет отрицательных — k интервалов на всём диапазоне
      if (!anchored) {
        return buildEdgesForIntervalCount(calcAmounts, k, lo, hi, kind);
      }

      // Есть отрицательные: [min..0] + ровно k положительных интервалов на [0..max]
      // Все k положительных (начиная с первого после 0) участвуют в равно/лесенке/ширине.
      const posMax = Math.max(hi, 1);
      if (k === 1) {
        return normalizeEdges([lo, 0, posMax], lo, hi);
      }

      // Ровно k положительных интервалов на [0..max] — ВСЕ с первого после 0 участвуют в kind.
      // Колонка [min..0] / «≤ 0» в авто-выравнивание не входит.
      let posPart = buildEdgesForIntervalCount(calcAmounts, k, 0, posMax, kind);
      posPart = ensureStrictlyIncreasingEdges(posPart, calcAmounts, 0, posMax);
      for (let i = 1; i < posPart.length - 1; i += 1) {
        if (posPart[i] <= 0) posPart[i] = 1;
      }
      posPart = ensureStrictlyIncreasingEdges(posPart, calcAmounts, 0, posMax);

      // Если первый положительный [0..b1) пуст по >0 — сдвигаем b1 вверх до первого квантиля с данными
      if (posPart.length >= 3 && calcAmounts.length) {
        const sortedPos = calcAmounts.slice().sort((a, b) => a - b);
        const b1 = posPart[1];
        const inFirst = sortedPos.filter((v) => v > 0 && v < b1).length;
        if (inFirst === 0) {
          const want = Math.max(1, Math.round(sortedPos.length / k));
          const idx = Math.min(sortedPos.length - 1, want);
          let nb = toIntegerEdge(sortedPos[idx]);
          if (nb <= 0) nb = 1;
          if (posPart.length > 3 && nb >= posPart[2]) nb = Math.max(1, posPart[2] - 1);
          posPart[1] = Math.max(1, nb);
          posPart = ensureStrictlyIncreasingEdges(posPart, calcAmounts, 0, posMax);
        }
      }

      const edges = [lo];
      for (let i = 0; i < posPart.length; i += 1) edges.push(posPart[i]);
      return normalizeEdges(edges, lo, hi);
    }

    /**
     * Общий обработчик кнопок распределения по числу ТН.
     * В режиме «Все значения» в сравнении участвуют оба периода.
     */
    function applyWeightedCountEdges(kind) {
      if (!allRows.length) {
        setChartStatus("Сначала загрузите данные.", "err");
        return;
      }
      const rowsAFull = filteredRows();
      const rowsAll = edgeSourceRows();
      const sourceForCalc = (!includePositiveOnlyForAutoEdges() && viewMode === "compare" && allRowsB.length)
        ? rowsAll
        : rowsAFull;
      if (!sourceForCalc.length) {
        setChartStatus("После фильтров ТН не осталось — нечего распределять.", "err");
        return;
      }
      const k = readIntervalCount();
      const edges = buildAutoEdges(sourceForCalc, k, kind);
      edgeState.min = edges[0];
      edgeState.max = edges[edges.length - 1];
      edgeState.edges = edges;
      if (isZeroAnchorIndex(edgeState.fineIndex)) {
        const movable = getMovableEdgeIndices();
        edgeState.fineIndex = movable.length ? movable[0] : -1;
      }
      renderEdgeRail();
      rebuild();
      const counts = countsByEdges(sourceForCalc, edges);
      const msg = edgeBalanceHint(counts, kind);
      if (msg) setChartStatus(msg, "");
    }

    function applyEqualCountEdges() {
      applyWeightedCountEdges("equal");
    }

    function applyLadderCountEdges() {
      applyWeightedCountEdges("ladder");
    }

    /** Равная ширина интервалов по шкале сумм (не по числу ТН). */
    function applyEvenWidthEdges() {
      if (!allRows.length) {
        setChartStatus("Сначала загрузите данные.", "err");
        return;
      }
      const rowsFull = edgeSourceRows();
      if (!rowsFull.length) {
        setChartStatus("После фильтров ТН не осталось — нечего распределять.", "err");
        return;
      }
      const sourceForCalc = (viewMode === "compare" && allRowsB.length)
        ? rowsFull
        : filteredRows();
      if (!sourceForCalc.length) {
        setChartStatus("После фильтров ТН не осталось — нечего распределять.", "err");
        return;
      }
      const k = readIntervalCount();
      const edges = buildAutoEdges(sourceForCalc, k, "even");
      edgeState.min = edges[0];
      edgeState.max = edges[edges.length - 1];
      edgeState.edges = edges;
      if (isZeroAnchorIndex(edgeState.fineIndex)) {
        const movable = getMovableEdgeIndices();
        edgeState.fineIndex = movable.length ? movable[0] : -1;
      }
      renderEdgeRail();
      rebuild();
    }

    function initEdgeStateFromData(forceReset) {
      const rows = edgeSourceRows();
      if (!rows.length && !allRows.length) {
        edgeState.edges = [];
        renderEdgeRail();
        return;
      }
      const baseRows = rows.length ? rows : allRows;
      const scaleFull = edgeScaleMinMax(baseRows);
      const maxI = Math.max(1, Number(APP_CONFIG.movableEdgesMax) || 40);
      const k = readIntervalCount();
      if (el.movableEdgeCount) el.movableEdgeCount.max = String(maxI);
      const expectPts = expectedEdgePointCount(k, baseRows);
      const sameRange = edgeState.min === scaleFull.min && edgeState.max === scaleFull.max;
      if (forceReset || !edgeState.edges.length || !sameRange || edgeState.edges.length !== expectPts) {
        const initRows = (!includePositiveOnlyForAutoEdges() && viewMode === "compare" && allRowsB.length)
          ? (rows.length ? rows : baseRows)
          : (filteredRows().length ? filteredRows() : baseRows);
        const edges = buildAutoEdges(initRows, k, "even");
        edgeState.min = edges[0];
        edgeState.max = edges[edges.length - 1];
        edgeState.edges = edges;
      } else {
        edgeState.min = scaleFull.min;
        edgeState.max = scaleFull.max;
        edgeState.edges[0] = scaleFull.min;
        edgeState.edges[edgeState.edges.length - 1] = scaleFull.max;
        if (shouldAnchorZeroEdge(baseRows) && edgeState.edges.length > 2) {
          edgeState.edges[1] = 0;
        }
        edgeState.edges = cascadeEdges(edgeState.edges, 0);
      }
      if (isZeroAnchorIndex(edgeState.fineIndex)) {
        const movable = getMovableEdgeIndices();
        edgeState.fineIndex = movable.length ? movable[0] : -1;
      }
      renderEdgeRail();
    }

    function valueToPct(v) {
      const span = edgeState.max - edgeState.min || 1;
      return ((v - edgeState.min) / span) * 100;
    }

    function edgePxAtIndex(idx) {
      if (!el.edgeRail || !edgeState.edges.length) return 0;
      const w = el.edgeRail.clientWidth || 1;
      return (valueToPct(edgeState.edges[idx]) / 100) * w;
    }

    /** Считать границу «близкой» по пикселям на текущей шкале. */
    function isEdgeCrowded(idx) {
      if (idx <= 0 || idx >= edgeState.edges.length - 1) return false;
      const leftGap = Math.abs(edgePxAtIndex(idx) - edgePxAtIndex(idx - 1));
      const rightGap = Math.abs(edgePxAtIndex(idx + 1) - edgePxAtIndex(idx));
      return leftGap < 26 || rightGap < 26;
    }

    function setFineIndex(idx) {
      if (!Number.isFinite(idx)) {
        edgeState.fineIndex = -1;
        return;
      }
      if (idx <= 0 || idx >= edgeState.edges.length - 1 || isZeroAnchorIndex(idx)) {
        edgeState.fineIndex = -1;
        return;
      }
      edgeState.fineIndex = idx;
    }

    function getMovableEdgeIndices() {
      const out = [];
      for (let i = 1; i < edgeState.edges.length - 1; i += 1) {
        // В positive-режиме граница 0 (индекс 1) зафиксирована и не двигается.
        if (isZeroAnchorIndex(i)) continue;
        out.push(i);
      }
      return out;
    }

    function ensureFineIndex() {
      const movable = getMovableEdgeIndices();
      if (movable.includes(edgeState.fineIndex)) return;
      edgeState.fineIndex = movable.length ? movable[0] : -1;
    }

    function finePctForValue(v, left, right) {
      const span = right - left || 1;
      return ((v - left) / span) * 100;
    }

    function applyEdgeValueLive(idx, rawVal) {
      if (idx <= 0 || idx >= edgeState.edges.length - 1) return;
      if (isZeroAnchorIndex(idx)) return; // границу 0 в positive-режиме менять нельзя
      let val = typeof rawVal === "number" ? rawVal : parseEdgeInt(rawVal);
      if (!Number.isFinite(val)) return;
      val = toIntegerEdge(val);
      const left = edgeState.edges[idx - 1];
      const right = edgeState.edges[idx + 1];
      // Нельзя зайти левее зафиксированного нуля
      const minAllowed = (isZeroAnchoredNow() && idx > 1)
        ? Math.max(left, 0)
        : left;
      if (val < minAllowed) val = minAllowed;
      if (val > right) val = right;
      edgeState.edges[idx] = val;
      edgeState.edges = cascadeEdges(edgeState.edges, idx);
      setFineIndex(idx);
      syncEdgeUiFromState({ light: true });
      requestRebuildEdge();
    }

    function onFineThumbPointerDown(ev) {
      ev.preventDefault();
      const idx = Number(ev.currentTarget.dataset.fineSelectedIndex);
      if (!Number.isFinite(idx)) return;
      setFineIndex(idx);
      edgeState.dragIndex = idx; // light-rebuild на время перетаскивания
      document.body.classList.add("is-edge-dragging");
      clearFrameFilterSnap();
      getFrameFilterSnap();
      ev.currentTarget.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const track = el.edgeFineTune.querySelector(".edge-fine__track");
        if (!track) return;
        const rect = track.getBoundingClientRect();
        let pct = ((e.clientX - rect.left) / rect.width) * 100;
        pct = Math.max(0, Math.min(100, pct));
        const left = edgeState.edges[idx - 1];
        const right = edgeState.edges[idx + 1];
        const span = right - left || 1;
        const val = toIntegerEdge(left + (pct / 100) * span);
        applyEdgeValueLive(idx, val);
      };
      const up = (e) => {
        edgeState.dragIndex = -1;
        document.body.classList.remove("is-edge-dragging");
        clearFrameFilterSnap();
        try { ev.currentTarget.releasePointerCapture(e.pointerId); } catch (_e) { /* ignore */ }
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        renderFineTuneRail();
        requestRebuildEdge(true);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }

    function updateFineTuneUiFromState() {
      if (!el.edgeFineTune || el.edgeFineTune.classList.contains("hidden")) return;
      const idx = edgeState.fineIndex;
      if (idx <= 0 || idx >= edgeState.edges.length - 1) return;
      const left = edgeState.edges[idx - 1];
      const right = edgeState.edges[idx + 1];
      const cur = edgeState.edges[idx];
      const sel = el.edgeFineTune.querySelector(".edge-fine__thumb.is-selected");
      if (sel) sel.style.left = finePctForValue(cur, left, right) + "%";
      const selVal = el.edgeFineTune.querySelector('[data-fine-thumb-current="1"]');
      if (selVal) selVal.textContent = formatEdgeInt(cur);
      const rangeNode = el.edgeFineTune.querySelector('[data-fine-range="1"]');
      if (rangeNode) rangeNode.textContent = `${formatEdgeInt(left)}…${formatEdgeInt(right)}`;
      const allChips = el.edgeFineTune.querySelectorAll(".edge-fine__chip");
      allChips.forEach((chip) => {
        const ci = Number(chip.dataset.fineIndex);
        chip.classList.toggle("is-active", ci === idx);
      });
    }

    function renderFineTuneRail() {
      if (!el.edgeFineTune) return;
      ensureFineIndex();
      const idx = edgeState.fineIndex;
      if (!edgeState.edges.length || idx <= 0 || idx >= edgeState.edges.length - 1) {
        el.edgeFineTune.classList.add("hidden");
        el.edgeFineTune.innerHTML = "";
        return;
      }
      const left = edgeState.edges[idx - 1];
      const cur = edgeState.edges[idx];
      const right = edgeState.edges[idx + 1];
      const leftIdx = idx - 1;
      const rightIdx = idx + 1;
      const leftLabel = leftIdx === 0 ? "мин" : ("гр. " + leftIdx);
      const rightLabel = rightIdx === edgeState.edges.length - 1 ? "макс" : ("гр. " + rightIdx);
      const leftOuter = leftIdx > 0 ? ` · мин ${formatEdgeInt(edgeState.edges[0])}` : "";
      const rightOuter = rightIdx < edgeState.edges.length - 1 ? ` · макс ${formatEdgeInt(edgeState.edges[edgeState.edges.length - 1])}` : "";
      const chips = getMovableEdgeIndices().map((i) => {
        const cls = [
          "edge-fine__chip",
          i === idx ? "is-active" : "",
          isEdgeCrowded(i) ? "is-crowded" : ""
        ].filter(Boolean).join(" ");
        return `<button type="button" class="${cls}" data-fine-index="${i}">Граница ${i}</button>`;
      }).join("");
      const selectedPct = finePctForValue(cur, left, right);
      const html =
        `<div class="edge-fine__head">` +
          `<div class="edge-fine__left">` +
            `<span class="edge-fine__title">Точная настройка · Граница группы ${idx}</span>` +
            `<span class="edge-fine__hint">диапазон <span data-fine-range="1">${formatEdgeInt(left)}…${formatEdgeInt(right)}</span></span>` +
          `</div>` +
          `<div class="edge-fine__switch">${chips}</div>` +
        `</div>` +
        `<div class="edge-fine__rail">` +
          `<div class="edge-fine__track">` +
            `<div class="edge-fine__fill" style="left:0%;width:100%;"></div>` +
          `</div>` +
          `<div class="edge-fine__thumb" style="left:0%;" title="${leftLabel}: ${formatEdgeInt(left)}"></div>` +
          `<div class="edge-fine__thumb is-selected" style="left:${selectedPct}%;" data-fine-selected-index="${idx}" title="Граница ${idx}: ${formatEdgeInt(cur)}">` +
            `<span class="edge-fine__current" data-fine-thumb-current="1">${formatEdgeInt(cur)}</span>` +
          `</div>` +
          `<div class="edge-fine__thumb" style="left:100%;" title="${rightLabel}: ${formatEdgeInt(right)}"></div>` +
        `</div>` +
        `<div class="edge-fine__meta"><span>${leftLabel}: ${formatEdgeInt(left)}${leftOuter}</span><span>${rightLabel}: ${formatEdgeInt(right)}${rightOuter}</span></div>`;
      el.edgeFineTune.innerHTML = html;
      el.edgeFineTune.classList.remove("hidden");
      const selectedThumb = el.edgeFineTune.querySelector(".edge-fine__thumb.is-selected");
      if (selectedThumb) selectedThumb.addEventListener("pointerdown", onFineThumbPointerDown);
      const track = el.edgeFineTune.querySelector(".edge-fine__track");
      if (track) {
        track.addEventListener("pointerdown", (ev) => {
          const rect = track.getBoundingClientRect();
          let pct = ((ev.clientX - rect.left) / rect.width) * 100;
          pct = Math.max(0, Math.min(100, pct));
          const span = right - left || 1;
          const val = toIntegerEdge(left + (pct / 100) * span);
          applyEdgeValueLive(idx, val);
          renderFineTuneRail();
        });
      }
      el.edgeFineTune.querySelectorAll(".edge-fine__chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const next = Number(btn.dataset.fineIndex);
          if (!Number.isFinite(next)) return;
          setFineIndex(next);
          renderEdgeRail();
        });
      });
    }

    function pctToValue(pct) {
      const span = edgeState.max - edgeState.min || 1;
      return edgeState.min + (pct / 100) * span;
    }

    function countTnPerBin(rows, edges) {
      const binCount = Math.max(0, edges.length - 1);
      const counts = Array(binCount).fill(0);
      for (const row of rows) {
        const bi = binIndexForAmount(row.amount, edges);
        if (bi >= 0) counts[bi] += 1;
      }
      return counts;
    }

    function formatSegPct(count, total) {
      if (!total) return "0%";
      const p = (100 * count) / total;
      return (p >= 10 || p === 0 ? p.toFixed(0) : p.toFixed(1)) + "%";
    }

    function makeEdgeSegLabel(count, total, side, periodClass) {
      const seg = document.createElement("div");
      seg.className = "edge-rail__seg edge-rail__seg--" + side + (periodClass ? (" " + periodClass) : "");
      const c = document.createElement("span");
      c.className = "edge-rail__seg-count";
      c.textContent = String(count);
      const p = document.createElement("span");
      p.className = "edge-rail__seg-pct";
      p.textContent = formatSegPct(count, total);
      seg.appendChild(c);
      seg.appendChild(p);
      const pctVal = total ? (100 * count) / total : 0;
      seg.title = count + " ТН · " + pctVal.toFixed(1) + "% от " + total;
      return seg;
    }

    /** Подписи ТН/% между бегунками (сверху текущий; в сравнении прошлый снизу). */
    function updateEdgeSegmentLabels() {
      if (!el.edgeRail) return;
      el.edgeRail.querySelectorAll(".edge-rail__seg").forEach((n) => n.remove());
      const edges = edgeState.edges;
      if (!edges || edges.length < 2) return;

      const compare = viewMode === "compare" && allRowsB.length > 0;
      el.edgeRail.classList.toggle("is-compare", compare);

      const rowsA = allRows.length ? filteredRows() : [];
      const countsA = countTnPerBin(rowsA, edges);
      const totalA = rowsA.length;
      let countsB = null;
      let totalB = 0;
      if (compare) {
        const rowsB = filteredRowsB();
        countsB = countTnPerBin(rowsB, edges);
        totalB = rowsB.length;
      }

      const binCount = edges.length - 1;
      for (let i = 0; i < binCount; i += 1) {
        const leftPct = valueToPct(edges[i]);
        const rightPct = valueToPct(edges[i + 1]);
        const mid = (leftPct + rightPct) / 2;
        const spanPct = Math.abs(rightPct - leftPct);
        const narrow = spanPct < 12;

        const top = makeEdgeSegLabel(countsA[i] || 0, totalA, "top", compare ? "is-a" : "");
        top.style.left = mid + "%";
        if (narrow) top.classList.add("is-narrow");
        el.edgeRail.appendChild(top);

        if (compare && countsB) {
          const bot = makeEdgeSegLabel(countsB[i] || 0, totalB, "bottom", "is-b");
          bot.style.left = mid + "%";
          if (narrow) bot.classList.add("is-narrow");
          el.edgeRail.appendChild(bot);
        }
      }
    }

    function renderEdgeRail() {
      const edges = edgeState.edges;
      if (!edges.length) {
        el.edgeRail.innerHTML = "";
        if (el.edgeFineTune) {
          el.edgeFineTune.innerHTML = "";
          el.edgeFineTune.classList.add("hidden");
        }
        el.edgeValues.innerHTML = "";
        el.edgeValues.style.removeProperty("--edge-count");
        return;
      }

      const active = document.activeElement;
      const activeIdx = active && active.dataset && active.dataset.edgeIndex != null
        ? Number(active.dataset.edgeIndex)
        : -1;
      const activeSelStart = active && active.selectionStart;
      const activeSelEnd = active && active.selectionEnd;

      el.edgeRail.innerHTML = "";
      el.edgeRail.classList.toggle("is-compare", viewMode === "compare" && allRowsB.length > 0);
      const track = document.createElement("div");
      track.className = "edge-rail__track";
      const fill = document.createElement("div");
      fill.className = "edge-rail__fill";
      fill.style.left = "0%";
      fill.style.width = "100%";
      track.appendChild(fill);
      el.edgeRail.appendChild(track);

      edges.forEach((val, idx) => {
        const isZeroLock = isZeroAnchorIndex(idx);
        const isFixed = idx === 0 || idx === edges.length - 1 || isZeroLock;
        const thumb = document.createElement("div");
        thumb.className = "edge-rail__thumb" + (isFixed ? " is-fixed" : "") +
          ((!isFixed && idx === edgeState.fineIndex) ? " is-selected-main" : "");
        thumb.style.left = valueToPct(val) + "%";
        thumb.dataset.index = String(idx);
        // Номер группы только на подвижных бегунках (не на мин и не на макс)
        const isMax = idx === edges.length - 1;
        const groupNum = (!isFixed && idx > 0) ? idx : (isZeroLock ? idx : 0);
        if (groupNum > 0 || isZeroLock) {
          const badge = document.createElement("span");
          badge.className = "edge-rail__badge";
          // Якорь 0 — колонка «≤ 0» (не положительная группа 1)
          badge.textContent = isZeroLock ? "≤0" : String(idx);
          badge.setAttribute("aria-hidden", "true");
          thumb.appendChild(badge);
        }
        if (idx === edgeState.fineIndex && !isFixed) {
          const current = document.createElement("span");
          current.className = "edge-rail__current";
          current.dataset.currentIndex = String(idx);
          current.textContent = formatEdgeInt(val);
          thumb.appendChild(current);
        }
        thumb.title = isZeroLock
          ? ("Фикс. граница 0 (отрицательные слева): " + formatAmount(val))
          : ((groupNum > 0 ? ("Группа " + groupNum + ": ") : "") + formatAmount(val));
        thumb.setAttribute("aria-label", isZeroLock
          ? ("Фиксированная граница 0, " + formatAmount(val))
          : (groupNum > 0
            ? ("Граница группы " + groupNum + ", " + formatAmount(val))
            : (isMax ? ("Максимум " + formatAmount(val)) : ("Минимум " + formatAmount(val)))));
        if (!isFixed) {
          thumb.addEventListener("pointerdown", (ev) => {
            setFineIndex(idx);
            onThumbPointerDown(ev);
          });
        }
        el.edgeRail.appendChild(thumb);
      });

      updateEdgeSegmentLabels();

      el.edgeValues.innerHTML = "";
      el.edgeValues.style.setProperty("--edge-count", String(edges.length));
      edges.forEach((v, i) => {
        const isZeroLock = isZeroAnchorIndex(i);
        const isFixed = i === 0 || i === edges.length - 1 || isZeroLock;
        const tag = i === 0
          ? "мин"
          : (i === edges.length - 1
            ? "макс"
            : (isZeroLock ? "0 (фикс.)" : ("группа " + i)));
        const lab = document.createElement("label");
        const span = document.createElement("span");
        span.textContent = tag;
        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "numeric";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.value = formatEdgeInt(v);
        input.dataset.edgeIndex = String(i);
        input.disabled = isFixed;
        input.setAttribute("aria-label", tag);
        if (!isFixed) {
          input.addEventListener("focus", () => {
            setFineIndex(i);
            renderFineTuneRail();
          });
          input.addEventListener("change", onEdgeInputChange);
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              onEdgeInputChange(ev);
            }
          });
        }
        lab.appendChild(span);
        lab.appendChild(input);
        el.edgeValues.appendChild(lab);
      });

      if (activeIdx >= 0) {
        const restore = el.edgeValues.querySelector('input[data-edge-index="' + activeIdx + '"]');
        if (restore && !restore.disabled) {
          restore.focus();
          try {
            if (typeof activeSelStart === "number") {
              restore.setSelectionRange(activeSelStart, activeSelEnd);
            }
          } catch (_e) { /* ignore */ }
        }
      }
      renderFineTuneRail();
    }

    function syncEdgeUiFromState(opts) {
      const skipHeavy = !!(opts && opts.light);
      const thumbs = el.edgeRail.querySelectorAll(".edge-rail__thumb");
      thumbs.forEach((thumb) => {
        const idx = Number(thumb.dataset.index);
        if (!Number.isFinite(idx) || !edgeState.edges[idx] && edgeState.edges[idx] !== 0) return;
        thumb.style.left = valueToPct(edgeState.edges[idx]) + "%";
        const groupNum = (idx > 0 && idx < edgeState.edges.length - 1) ? idx : 0;
        thumb.title = (groupNum > 0 ? ("Группа " + groupNum + ": ") : "") + formatAmount(edgeState.edges[idx]);
        const current = thumb.querySelector(".edge-rail__current");
        if (current) current.textContent = formatEdgeInt(edgeState.edges[idx]);
      });
      if (!skipHeavy) {
        el.edgeValues.querySelectorAll("input[data-edge-index]").forEach((input) => {
          const idx = Number(input.dataset.edgeIndex);
          if (!Number.isFinite(idx)) return;
          if (document.activeElement === input) return;
          input.value = formatEdgeInt(edgeState.edges[idx]);
        });
        updateEdgeSegmentLabels();
      }
      updateFineTuneUiFromState();
    }

    function applyEdgeValue(idx, rawVal) {
      if (idx <= 0 || idx >= edgeState.edges.length - 1) return;
      if (isZeroAnchorIndex(idx)) {
        renderEdgeRail();
        return;
      }
      let val = typeof rawVal === "number" ? rawVal : parseEdgeInt(rawVal);
      if (!Number.isFinite(val)) {
        renderEdgeRail();
        return;
      }
      val = toIntegerEdge(val);
      const left = edgeState.edges[idx - 1];
      const right = edgeState.edges[idx + 1];
      const minAllowed = (isZeroAnchoredNow() && idx > 1)
        ? Math.max(left, 0)
        : left;
      if (val < minAllowed) val = minAllowed;
      if (val > right) val = right;
      edgeState.edges[idx] = val;
      edgeState.edges = cascadeEdges(edgeState.edges, idx);
      setFineIndex(idx);
      renderEdgeRail();
      rebuild();
    }

    function onEdgeInputChange(ev) {
      const idx = Number(ev.currentTarget.dataset.edgeIndex);
      applyEdgeValue(idx, ev.currentTarget.value);
    }

    function onThumbPointerDown(ev) {
      ev.preventDefault();
      const idx = Number(ev.currentTarget.dataset.index);
      if (isZeroAnchorIndex(idx)) return;
      edgeState.dragIndex = idx;
      setFineIndex(idx);
      document.body.classList.add("is-edge-dragging");
      clearFrameFilterSnap();
      getFrameFilterSnap();
      ev.currentTarget.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const rect = el.edgeRail.getBoundingClientRect();
        let pct = ((e.clientX - rect.left) / rect.width) * 100;
        pct = Math.max(0, Math.min(100, pct));
        let val = toIntegerEdge(pctToValue(pct));
        const left = edgeState.edges[idx - 1];
        const right = edgeState.edges[idx + 1];
        const minAllowed = (isZeroAnchoredNow() && idx > 1)
          ? Math.max(left, 0)
          : left;
        if (val < minAllowed) val = minAllowed;
        if (val > right) val = right;
        edgeState.edges[idx] = val;
        edgeState.edges = cascadeEdges(edgeState.edges, idx);
        setFineIndex(idx);
        syncEdgeUiFromState({ light: true });
        requestRebuildEdge();
      };
      const up = (e) => {
        edgeState.dragIndex = -1;
        document.body.classList.remove("is-edge-dragging");
        clearFrameFilterSnap();
        try { ev.currentTarget.releasePointerCapture(e.pointerId); } catch (_e) { /* ignore */ }
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        renderEdgeRail();
        requestRebuildEdge(true);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }

    function readBinOptions() {
      return {
        mode: "custom",
        customEdges: edgeState.edges.slice()
      };
    }

    function rebuild(opts) {
      const light = !!(opts && opts.light);
      try {
        clearFrameFilterSnap();
        if (!light) syncViewModeUi();
        if (!allRows.length) {
          setChartStatus("Нет данных для графика.", "err");
          return;
        }
        // Требование второго периода — только для вкладки «Сравнение»
        if (viewMode === "compare" && !allRowsB.length) {
          setChartStatus("В сравнении загрузите оба периода (текущий и прошлый).", "err");
          return;
        }
        const snap = getFrameFilterSnap();
        const rowsA = snap.rowsA;
        const rowsB = viewMode === "compare" ? snap.rowsB : [];
        const edgeRows = (viewMode === "compare") ? snap.edgeRows : rowsA;
        if (!edgeRows.length) {
          setChartStatus("После фильтров ТН не осталось.", "err");
          return;
        }

        // Light-drag: не трогаем шкалу/DOM рельсы — только гистограмма по текущим edges
        if (light && edgeState.edges.length >= 2) {
          if (viewMode === "analysis") return;
          const edges = edgeState.edges.slice();
          const slice = el.sliceMode.value;
          const chartType = resolveChartType();
          const compareLayout = (el.compareLayout && el.compareLayout.value) || "overlay";
          if (viewMode === "compare") {
            const histA = computeHistogram(rowsA, edges, slice);
            const histB = computeHistogram(rowsB, edges, slice);
            const split = compareLayout === "side" || compareLayout === "stack";
            const useOverlapBars = compareLayout === "overlap" && chartType === "bars";
            if (split) {
              const layoutCmp = el.groupLayout.value === "slice" && slice !== "all" ? "slice" : "bin";
              let sharedMaxY = 1;
              for (const h of [histA, histB]) {
                for (const s of h.series || []) {
                  for (const c of s.counts || []) if (c > sharedMaxY) sharedMaxY = c;
                }
              }
              drawHistogram(histA, layoutCmp, rowsA, slice, {
                canvas: el.chartA, chartType, hitTarget: "a", clearPrimaryHits: true,
                forcedMaxY: sharedMaxY, light: true
              });
              drawHistogram(histB, layoutCmp, rowsB, slice, {
                canvas: el.chartB, chartType, hitTarget: "b", clearPrimaryHits: false,
                forcedMaxY: sharedMaxY, light: true
              });
            } else {
              const overlayHist = buildPeriodOverlayHist(histA, histB, fileNameA || "A", fileNameB || "B", slice);
              const layoutCmp = el.groupLayout.value === "slice" && slice !== "all" ? "slice" : "bin";
              const overlapNow = useOverlapBars && layoutCmp === "bin";
              drawHistogram(overlayHist, layoutCmp, rowsA, slice, {
                canvas: el.chart, chartType, hitTarget: "primary", clearPrimaryHits: true,
                barOverlap: overlapNow,
                compareOverlay: { histA, histB, rowsA, rowsB, sliceMode: slice },
                light: true
              });
            }
            return;
          }
          const hist = computeHistogram(rowsA, edges, slice);
          const layout = el.groupLayout.value === "slice" && slice !== "all" ? "slice" : "bin";
          drawHistogram(hist, layout, rowsA, slice, {
            canvas: el.chart, chartType, hitTarget: "primary", clearPrimaryHits: true, light: true
          });
          return;
        }

        const scale = snap.scale;
        edgeState.min = scale.min;
        edgeState.max = scale.max;
        if (edgeState.edges.length) {
          edgeState.edges[0] = edgeState.min;
          edgeState.edges[edgeState.edges.length - 1] = edgeState.max;
          edgeState.edges = cascadeEdges(edgeState.edges, 0);
          if (edgeState.dragIndex >= 0) syncEdgeUiFromState({ light: true });
          else renderEdgeRail();
        } else {
          initEdgeStateFromData(true);
        }
        const edges = buildBins([], readBinOptions());
        const slice = el.sliceMode.value;
        syncGroupLayoutUi();
        const chartType = resolveChartType();
        const compareLayout = (el.compareLayout && el.compareLayout.value) || "overlay";

        if (viewMode === "compare") {
          analysisDirty = true;
          if (analysisRenderTimer) {
            clearTimeout(analysisRenderTimer);
            analysisRenderTimer = 0;
          }
          const histA = computeHistogram(rowsA, edges, slice);
          const histB = computeHistogram(rowsB, edges, slice);
          lastChartState = {
            rows: rowsA,
            rowsB,
            edges,
            hist: histA,
            histB,
            layout: "bin",
            slice,
            compare: true,
            compareLayout,
            chartType
          };
          const split = compareLayout === "side" || compareLayout === "stack";
          const useOverlapBars = compareLayout === "overlap" && chartType === "bars";
          document.body.classList.toggle("is-compare-split", split);
          if (el.chartsDual) {
            el.chartsDual.classList.toggle("is-side", compareLayout === "side");
            el.chartsDual.classList.toggle("is-stack", compareLayout === "stack");
          }
          if (el.chartTitleA) {
            el.chartTitleA.textContent = PERIOD_CUR.label + (fileNameA ? " · " + fileNameA : "");
          }
          if (el.chartTitleB) {
            el.chartTitleB.textContent = PERIOD_PREV.label + (fileNameB ? " · " + fileNameB : "");
          }

          if (split) {
            const layoutCmp = el.groupLayout.value === "slice" && slice !== "all" ? "slice" : "bin";
            // Общая шкала Y для честного сравнения «рядом» / «друг под другом»
            let sharedMaxY = 1;
            for (const h of [histA, histB]) {
              for (const s of h.series || []) {
                for (const c of s.counts || []) if (c > sharedMaxY) sharedMaxY = c;
              }
            }
            const drawSplitCharts = () => {
              if (el.chartsDual) void el.chartsDual.offsetWidth;
              drawHistogram(histA, layoutCmp, rowsA, slice, {
                canvas: el.chartA,
                chartType,
                hitTarget: "a",
                clearPrimaryHits: true,
                forcedColorIndex: 0,
                forcedMaxY: sharedMaxY,
                light: light
              });
              drawHistogram(histB, layoutCmp, rowsB, slice, {
                canvas: el.chartB,
                chartType,
                hitTarget: "b",
                clearPrimaryHits: false,
                forcedColorIndex: 1,
                forcedMaxY: sharedMaxY,
                light: light
              });
            };
            drawSplitCharts();
            if (el.chartA && el.chartA.clientWidth < 40) {
              requestAnimationFrame(drawSplitCharts);
            }
            if (chartType === "line" || layoutCmp === "bin") {
              el.legend.innerHTML =
                `<span><i style="background:${comparePaletteColor(0)}"></i>${escapeHtml(PERIOD_CUR.label)}</span>` +
                `<span><i style="background:${comparePaletteColor(1)}"></i>${escapeHtml(PERIOD_PREV.label)}</span>`;
            } else {
              renderLegend(histA, layoutCmp, chartType);
            }
            if (!light) {
              renderCompareStats(rowsA, rowsB, histA, histB, edges);
              renderFrequencyTableCompare(histA, histB, rowsA, rowsB, slice);
            }
            lastChartState.layout = layoutCmp;
          } else {
            // Наложение / рядом с перекрытием: уважаем «Группы на графике»
            const layoutCmp = el.groupLayout.value === "slice" && slice !== "all" ? "slice" : "bin";
            const overlayHist = buildPeriodOverlayHist(histA, histB, fileNameA, fileNameB, slice);
            // Перекрытие столбиков — только при группировке по интервалам
            const overlapNow = useOverlapBars && layoutCmp === "bin";
            drawHistogram(overlayHist, layoutCmp, rowsA, slice, {
              canvas: el.chart,
              chartType,
              hitTarget: "primary",
              clearPrimaryHits: true,
              barOverlap: overlapNow,
              compareOverlay: { histA, histB, rowsA, rowsB, sliceMode: slice },
              light: light
            });
            if (!light) {
              renderLegend(overlayHist, layoutCmp, chartType);
              renderCompareStats(rowsA, rowsB, histA, histB, edges);
              renderFrequencyTableCompare(histA, histB, rowsA, rowsB, slice);
            }
            lastChartState.layout = layoutCmp;
          }
          const layoutLabel = ({
            overlay: "наложение",
            overlap: "наложение с перекрытием",
            side: "рядом",
            stack: "друг под другом"
          })[compareLayout] || compareLayout;
          setChartStatus(
            `Сравнение: ${histA.labels.length} интерв.; ` +
              `${PERIOD_CUR.short} ${rowsA.length} ТН / ${PERIOD_PREV.short} ${rowsB.length} ТН · ${layoutLabel} · ${chartType}.`,
            "ok"
          );
          return;
        }

        if (viewMode === "analysis") {
          document.body.classList.remove("is-compare-split");
          if (!rowsA.length) {
            setChartStatus("После фильтров ТН не осталось.", "err");
            return;
          }
          const hist = computeHistogram(rowsA, edges, "all");
          lastChartState = { rows: rowsA, edges, hist, layout: "bin", slice: "all", chartType: "bars", compare: false };
          // График/легенда/freq на вкладке анализа скрыты — не тратим на них CPU.
          // Тяжёлый renderAnalysis — только вне light (не во время drag) и только на этой вкладке.
          if (!light) {
            scheduleAnalysisRender(rowsA, edges);
          }
          return;
        }

        // На других вкладках аналитику не считаем — пометим к пересчёту при открытии
        analysisDirty = true;
        if (analysisRenderTimer) {
          clearTimeout(analysisRenderTimer);
          analysisRenderTimer = 0;
        }

        document.body.classList.remove("is-compare-split");
        if (!rowsA.length) {
          setChartStatus("После фильтров ТН не осталось.", "err");
          return;
        }
        const hist = computeHistogram(rowsA, edges, slice);
        const layout = el.groupLayout.value === "slice" && slice !== "all" ? "slice" : "bin";
        lastChartState = { rows: rowsA, edges, hist, layout, slice, chartType, compare: false };
        drawHistogram(hist, layout, rowsA, slice, {
          canvas: el.chart,
          chartType,
          hitTarget: "primary",
          clearPrimaryHits: true,
          light: light
        });
        if (!light) {
          renderLegend(hist, layout, chartType);
          renderStats(rowsA, hist);
          renderFrequencyTable(hist, rowsA, slice);
          refreshWinnersPreview();
        }
        setChartStatus(
          `Интервалов: ${hist.labels.length}; ${indicatorLabel()} на графике: ${hist.total}` +
            (hist.below || hist.above ? ` (вне границ: ниже ${hist.below}, выше ${hist.above})` : "") +
            ` · ${chartType}.`,
          "ok"
        );
      } catch (err) {
        setChartStatus((err && err.message) ? err.message : String(err), "err");
      }
    }

    /**
     * Наложение текущего/прошлого на общие интервалы.
     * Порядок серий: сначала прошлый (слева), затем текущий (справа).
     * slice=all → две серии «Прошлый · файл» / «Текущий · файл».
     * slice=tb|cluster → пары «Прошлый · значение» / «Текущий · значение».
     */
    function buildPeriodOverlayHist(histA, histB, nameA, nameB, sliceMode) {
      const labels = histA.labels.slice();
      const binN = labels.length;
      const zeros = () => Array(binN).fill(0);
      const countsOf = (hist, seriesName) => {
        const s = (hist.series || []).find((x) => x.name === seriesName);
        return s ? s.counts.slice() : zeros();
      };
      const sumAll = (hist) => (hist.series || []).reduce((acc, s) => {
        s.counts.forEach((c, i) => { acc[i] = (acc[i] || 0) + c; });
        return acc;
      }, zeros());

      let series;
      if (!sliceMode || sliceMode === "all") {
        series = [
          { name: PERIOD_PREV.prefix + (nameB || PERIOD_PREV.label), counts: sumAll(histB) },
          { name: PERIOD_CUR.prefix + (nameA || PERIOD_CUR.label), counts: sumAll(histA) }
        ];
      } else {
        const nameSet = new Set();
        for (const s of histA.series || []) nameSet.add(s.name);
        for (const s of histB.series || []) nameSet.add(s.name);
        const names = [...nameSet].sort((a, b) => a.localeCompare(b, "ru"));
        series = [];
        for (const nm of names) {
          series.push({ name: PERIOD_PREV.prefix + nm, counts: countsOf(histB, nm) });
          series.push({ name: PERIOD_CUR.prefix + nm, counts: countsOf(histA, nm) });
        }
        if (!series.length) {
          series = [
            { name: PERIOD_PREV.prefix + (nameB || PERIOD_PREV.label), counts: zeros() },
            { name: PERIOD_CUR.prefix + (nameA || PERIOD_CUR.label), counts: zeros() }
          ];
        }
      }

      return {
        labels,
        edges: histA.edges,
        series,
        total: (histA.total || 0) + (histB.total || 0),
        below: (histA.below || 0) + (histB.below || 0),
        above: (histA.above || 0) + (histB.above || 0)
      };
    }

    function syncViewModeUi() {
      viewMode = "single";
      document.body.classList.remove("is-compare", "is-analysis", "is-compare-split");
      if (el.periodTitleA) el.periodTitleA.textContent = "Файл данных";
      if (el.chartHeading) el.chartHeading.textContent = "Гистограмма";
      if (el.exportPanelSub) {
        el.exportPanelSub.textContent =
          "По текущим интервалам и фильтрам (группа = интервал суммы после агрегации по показателю)";
      }
    }

    function drawHistogram(hist, groupLayout, rows, sliceMode, opts) {
      opts = opts || {};
      const canvas = opts.canvas || el.chart;
      if (!canvas) return;
      const chartTypeRaw = opts.chartType || (el.chartType && el.chartType.value) || "bars";
      const chartType = (chartTypeRaw === "line" || isCandleChartType(chartTypeRaw))
        ? chartTypeRaw
        : "bars";
      const showLabels = chartLabelsEnabled();
      const hitTarget = opts.hitTarget || "primary";
      const dpr = window.devicePixelRatio || 1;
      const parentW = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
      const cssW = Math.max(1, canvas.clientWidth || parentW || 640);
      const cssH = Math.max(1, canvas.clientHeight || 400);
      const lightDraw = !!opts.light;
      const needW = Math.floor(cssW * dpr);
      const needH = Math.floor(cssH * dpr);
      // Во время drag не сбрасываем буфер canvas (дорого)
      if (!lightDraw || canvas.width !== needW || canvas.height !== needH) {
        canvas.width = needW;
        canvas.height = needH;
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const pad = { t: 36, r: 16, b: 88, l: 48 };
      let plotW = cssW - pad.l - pad.r;
      let plotH = cssH - pad.t - pad.b;
      const layout = groupLayout === "slice" ? "slice" : "bin";
      const series = hist.series.slice(0, APP_CONFIG.chart.maxLegendItems);
      const binN = hist.labels.length;
      const seriesN = Math.max(1, series.length);
      let maxY = 1;
      for (const s of series) for (const c of s.counts) if (c > maxY) maxY = c;
      if (Number.isFinite(opts.forcedMaxY) && opts.forcedMaxY > 0) {
        maxY = Math.max(maxY, opts.forcedMaxY);
      }

      const edgesRef = hist.edges && hist.edges.length ? hist.edges : [];
      const compareOverlay = opts.compareOverlay || null;
      const compareMode = !!(opts.compareOverlay || isPeriodCompareHist(hist));
      const binRowsForAxis = compareOverlay
        ? [].concat(compareOverlay.rowsA || [], compareOverlay.rowsB || [])
        : (rows || []);
      // collectBinUniques дорогой на больших выборках — при drag пропускаем
      const binUniques = lightDraw
        ? []
        : collectBinUniques(binRowsForAxis, edgesRef);
      const cellCache = new Map();

      /** Пары Текущий/Прошлый по значению разреза — для линии в наложении. */
      function buildLineCompareSliceGroups(seriesArr) {
        const groups = [];
        const seen = new Map();
        for (let si = 0; si < seriesArr.length; si += 1) {
          const name = seriesArr[si].name;
          const code = periodCodeFromSeriesName(name);
          const rest = code
            ? String(name).replace(/^(Текущий|Прошлый|A|B)\s*·\s*/, "").trim()
            : name;
          const key = rest || name;
          if (!seen.has(key)) {
            seen.set(key, groups.length);
            groups.push({ key, items: [] });
          }
          groups[seen.get(key)].items.push({
            si,
            name,
            code,
            counts: seriesArr[si].counts
          });
        }
        return groups;
      }

      const lineCompareSliceGroups = (chartType === "line" && compareMode && layout === "slice")
        ? buildLineCompareSliceGroups(series)
        : null;

      function rowsForSeriesName(seriesName) {
        const name = String(seriesName || "");
        if (compareOverlay) {
          const m = /^(Текущий|Прошлый|A|B)\s*·\s*(.*)$/.exec(name);
          if (m) {
            const code = (m[1] === "Текущий" || m[1] === "A") ? "A" : "B";
            const src = code === "A" ? (compareOverlay.rowsA || []) : (compareOverlay.rowsB || []);
            const rest = String(m[2] || "").trim();
            const sm = compareOverlay.sliceMode || "all";
            if (sm !== "all" && rest) {
              return src.filter((r) => sliceSeriesKey(r, sm) === rest);
            }
            return src;
          }
        }
        return rows || [];
      }

      /**
       * Свечные метрики по серии:
       * low/high — whiskers, q1/q3 — тело, p50 — медиана,
       * below/inside/above — число ТН относительно тела свечи.
       */
      function computeCandleStats(seriesName, binIndex) {
        const periodSeries = isPeriodSeriesName(seriesName);
        const sourceRows = periodSeries ? rowsForSeriesName(seriesName) : (rows || []);
        const sliced = (sliceMode && sliceMode !== "all" && !periodSeries)
          ? sourceRows.filter((r) => sliceSeriesKey(r, sliceMode) === seriesName)
          : sourceRows;
        const src = Number.isInteger(binIndex)
          ? sliced.filter((r) => binIndexForAmount(r.amount, edgesRef) === binIndex)
          : sliced;
        const amounts = src.map((r) => Number(r.amount) || 0).sort((a, b) => a - b);
        if (!amounts.length) return null;
        const q1 = quantile(amounts, 0.25);
        const p50 = quantile(amounts, 0.5);
        const q3 = quantile(amounts, 0.75);
        const iqr = q3 - q1;
        const low = Math.max(amounts[0], q1 - 1.5 * iqr);
        const high = Math.min(amounts[amounts.length - 1], q3 + 1.5 * iqr);
        let below = 0;
        let inside = 0;
        let above = 0;
        for (const v of amounts) {
          if (v < q1) below += 1;
          else if (v > q3) above += 1;
          else inside += 1;
        }
        return { low, q1, p50, q3, high, below, inside, above, total: amounts.length };
      }

      function cellUniques(seriesName, binIndex) {
        if (lightDraw) {
          return { tn: new Set(), tb: new Set(), gosb: new Set(), cluster: new Set() };
        }
        const key = seriesName + "\0" + binIndex;
        if (cellCache.has(key)) return cellCache.get(key);
        const src = rowsForSeriesName(seriesName);
        const period = isPeriodSeriesName(seriesName);
        const subset = src.filter((r) => {
          if (binIndexForAmount(r.amount, edgesRef) !== binIndex) return false;
          if (period) return true; // уже отфильтровано в rowsForSeriesName
          return sliceSeriesKey(r, sliceMode || "all") === seriesName;
        });
        const u = {
          tn: subset.length,
          tb: uniqueFieldValues(subset, "tb").size,
          gosb: uniqueFieldValues(subset, "gosb").size,
          cluster: uniqueFieldValues(subset, "cluster").size
        };
        cellCache.set(key, u);
        return u;
      }

      function barNameText(u) {
        const bits = [];
        if (columnPresence.hasTb) bits.push("ТБ: " + u.tb);
        if (columnPresence.hasGosb) bits.push("ГОСБ: " + u.gosb);
        if (!bits.length && columnPresence.hasCluster) bits.push("Кл: " + u.cluster);
        if (bits.length) return String(u.tn) + " (" + bits.join(" / ") + ")";
        return String(u.tn);
      }

      /** Компактный вид интервала: «0–12345» вместо длинной скобки. */
      function compactIntervalLabel(label) {
        const m = String(label).match(/([\d\s\u00a0.,]+)\s*[…\-]{1,3}\s*([\d\s\u00a0.,]+)/);
        if (!m) return String(label);
        const a = m[1].replace(/[\s\u00a0]/g, "");
        const b = m[2].replace(/[\s\u00a0]/g, "");
        return a + "–" + b;
      }

      function metaBitsFromUniques(u, exclude) {
        const bits = [];
        if (!u) return bits;
        if (columnPresence.hasTb && exclude !== "tb") bits.push("ТБ:" + u.tb.size);
        if (columnPresence.hasGosb && exclude !== "gosb") bits.push("ГОСБ:" + u.gosb.size);
        return bits;
      }

      function axisPartsForBin(bi) {
        const base = hist.labels[bi];
        if (compareOverlay && series.length >= 2) {
          let tnCur = 0;
          let tnPrev = 0;
          for (const s of series) {
            const code = periodCodeFromSeriesName(s.name);
            const c = s.counts[bi] || 0;
            if (code === "A") tnCur += c;
            else if (code === "B") tnPrev += c;
          }
          return {
            full: base + " · " + PERIOD_CUR.short + ":" + tnCur + " / " + PERIOD_PREV.short + ":" + tnPrev,
            primary: base,
            compact: compactIntervalLabel(base),
            secondary: PERIOD_CUR.short + ":" + tnCur + " · " + PERIOD_PREV.short + ":" + tnPrev
          };
        }
        const u = binUniques[bi];
        if (!u) {
          let tn = 0;
          for (const s of series) tn += s.counts[bi] || 0;
          return {
            full: base + " · " + tn,
            primary: base,
            compact: compactIntervalLabel(base),
            secondary: String(tn)
          };
        }
        const bits = metaBitsFromUniques(u, null);
        const tn = u.tn.size;
        return {
          full: bits.length ? (base + " · " + tn + " (" + bits.join(" / ") + ")") : (base + " · " + tn),
          primary: base,
          compact: compactIntervalLabel(base),
          secondary: bits.length ? (tn + " (" + bits.join("/") + ")") : String(tn)
        };
      }

      function axisPartsForSeries(si) {
        const name = series[si].name;
        let tnSum = 0;
        for (let bi = 0; bi < binN; bi += 1) tnSum += series[si].counts[bi] || 0;
        const subset = isPeriodSeriesName(name)
          ? rowsForSeriesName(name)
          : (rows || []).filter((r) => sliceSeriesKey(r, sliceMode || "all") === name);
        const bits = [];
        if (columnPresence.hasTb && sliceMode !== "tb") {
          bits.push("ТБ:" + uniqueFieldValues(subset, "tb").size);
        }
        if (columnPresence.hasGosb && sliceMode !== "gosb" && sliceMode !== "tb_gosb") {
          bits.push("ГОСБ:" + uniqueFieldValues(subset, "gosb").size);
        }
        if (columnPresence.hasCluster && sliceMode !== "cluster") {
          bits.push("Кл:" + uniqueFieldValues(subset, "cluster").size);
        }
        const secondary = bits.length
          ? ("ТН:" + tnSum + " · " + bits.join(" · "))
          : ("ТН:" + tnSum);
        return {
          full: name + " · " + secondary,
          primary: name,
          compact: name,
          secondary: secondary
        };
      }

      const candlesMode = isCandleChartType(chartType);
      const groupCount = candlesMode
        ? binN
        : (layout === "slice"
          ? (lineCompareSliceGroups ? lineCompareSliceGroups.length : seriesN)
          : binN);
      const barsPerGroup = layout === "slice" ? binN : seriesN;
      let groupW = plotW / Math.max(1, groupCount);

      // Предварительно оцениваем высоту зоны подписей под осью X
      const axisPartsList = [];
      if (candlesMode) {
        for (let bi = 0; bi < binN; bi += 1) axisPartsList.push(axisPartsForBin(bi));
      } else if (layout === "bin") {
        for (let bi = 0; bi < binN; bi += 1) axisPartsList.push(axisPartsForBin(bi));
      } else if (lineCompareSliceGroups) {
        for (const g of lineCompareSliceGroups) {
          axisPartsList.push({
            full: g.key,
            primary: g.key,
            compact: g.key,
            secondary: ""
          });
        }
      } else {
        for (let si = 0; si < seriesN; si += 1) axisPartsList.push(axisPartsForSeries(si));
      }

      function pickAxisMode(slotW) {
        if (layout === "slice") {
          // Имена ТБ/ГОСБ/кластеров: приоритет вертикали, чтобы длинные названия умещались
          if (slotW >= 100) return "stack";
          if (slotW >= 36) return "vert2";
          return "vert";
        }
        if (slotW >= 108) return "stack";
        if (slotW >= 64) return "tilt";
        return "vert";
      }

      function fitTextWidth(text, maxW, fontPx) {
        let fs = fontPx;
        let t = String(text || "");
        ctx.font = fs + "px sans-serif";
        while (fs > 7 && ctx.measureText(t).width > maxW) {
          fs -= 1;
          ctx.font = fs + "px sans-serif";
        }
        while (t.length > 3 && ctx.measureText(t).width > maxW) {
          t = t.slice(0, -2) + "…";
        }
        return { text: t, fontPx: fs };
      }

      ctx.font = "10px sans-serif";
      let needBottom = 56;
      const modeProbe = pickAxisMode(groupW);
      for (const p of axisPartsList) {
        if (modeProbe === "stack") {
          needBottom = Math.max(needBottom, 52);
        } else if (modeProbe === "tilt") {
          const w = Math.max(ctx.measureText(p.primary).width, ctx.measureText(p.secondary).width);
          needBottom = Math.max(needBottom, Math.ceil(w * 0.55) + 28);
        } else {
          // vert / vert2: место под полное имя ТБ + строку статистики
          const w = Math.max(
            ctx.measureText(p.primary).width,
            ctx.measureText(p.secondary).width
          );
          needBottom = Math.max(needBottom, Math.min(210, Math.ceil(w) + 22));
        }
      }
      pad.b = Math.max(56, Math.min(layout === "slice" ? 210 : 180, needBottom));
      plotW = cssW - pad.l - pad.r;
      plotH = Math.max(80, cssH - pad.t - pad.b);
      groupW = plotW / Math.max(1, groupCount);

      /**
       * Цвет подписи столбика: внутри — контраст к заливке; снаружи — оттенок столбика.
       */
      function parseHexColor(hex) {
        const s = String(hex || "").replace("#", "").trim();
        if (s.length === 3) {
          return {
            r: parseInt(s[0] + s[0], 16),
            g: parseInt(s[1] + s[1], 16),
            b: parseInt(s[2] + s[2], 16)
          };
        }
        if (s.length >= 6) {
          return {
            r: parseInt(s.slice(0, 2), 16),
            g: parseInt(s.slice(2, 4), 16),
            b: parseInt(s.slice(4, 6), 16)
          };
        }
        return { r: 0, g: 122, b: 255 };
      }

      function relativeLuminance(rgb) {
        const lin = (c) => {
          const x = c / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
      }

      function labelColorsForBar(barColor) {
        const rgb = parseHexColor(barColor);
        const lum = relativeLuminance(rgb);
        const onBar = lum > 0.55 ? "rgba(29,29,31,0.92)" : "rgba(255,255,255,0.96)";
        const darken = (c) => Math.max(0, Math.round(c * 0.72));
        const above = "rgb(" + darken(rgb.r) + "," + darken(rgb.g) + "," + darken(rgb.b) + ")";
        return { onBar, above };
      }

      /**
       * Число ТН на столбике: −90° против часовой; если не влезает — над столбиком.
       */
      function drawBarTnLabel(fullText, shortText, x, barTop, barW, barH, barColor) {
        if (!fullText || fullText === "0") return;
        const candidates = [fullText];
        if (shortText && shortText !== fullText) candidates.push(shortText);
        const colors = labelColorsForBar(barColor);

        let chosen = shortText || fullText;
        let fontSize = 10;
        let metrics = null;
        let mode = "above";

        for (let fs = 11; fs >= 8; fs -= 1) {
          ctx.font = "600 " + fs + "px sans-serif";
          for (const text of candidates) {
            const m = ctx.measureText(text);
            const rotH = m.width + 4;
            if (barH >= rotH + 4 && barW >= fs + 3) {
              chosen = text;
              fontSize = fs;
              metrics = m;
              mode = "inside";
              break;
            }
          }
          if (mode === "inside") break;
        }

        if (mode !== "inside") {
          for (let fs = 11; fs >= 8; fs -= 1) {
            ctx.font = "600 " + fs + "px sans-serif";
            const mFull = ctx.measureText(fullText);
            if (mFull.width <= barW + 8) {
              chosen = fullText;
              fontSize = fs;
              metrics = mFull;
              mode = "above";
              break;
            }
            const mShort = ctx.measureText(shortText || fullText);
            if (mShort.width <= barW + 4) {
              chosen = shortText || fullText;
              fontSize = fs;
              metrics = mShort;
              mode = "above";
              break;
            }
            if (barW >= fs + 2) {
              chosen = shortText || String(shortText || fullText).split(" ")[0];
              fontSize = fs;
              metrics = ctx.measureText(chosen);
              mode = "above-rot";
              break;
            }
          }
        }

        if (!metrics) {
          ctx.font = "600 9px sans-serif";
          chosen = shortText || fullText;
          metrics = ctx.measureText(chosen);
          mode = "above";
          fontSize = 9;
        }

        ctx.save();
        ctx.font = "600 " + fontSize + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (mode === "inside") {
          ctx.fillStyle = colors.onBar;
          ctx.translate(x + barW / 2, barTop + barH / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(chosen, 0, 0);
        } else if (mode === "above-rot") {
          ctx.fillStyle = colors.above;
          const cy = Math.max(pad.t + 6, barTop - 10);
          ctx.translate(x + barW / 2, cy);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(chosen, 0, 0);
        } else {
          ctx.fillStyle = colors.above;
          const cy = Math.max(pad.t + 8, barTop - 9);
          ctx.fillText(chosen, x + barW / 2, cy);
        }
        ctx.restore();
      }

      ctx.strokeStyle = "rgba(29,29,31,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t);
      ctx.lineTo(pad.l, pad.t + plotH);
      ctx.lineTo(pad.l + plotW, pad.t + plotH);
      ctx.stroke();

      const ticks = 5;
      ctx.fillStyle = "#6e6e73";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "right";
      if (isCandleChartType(chartType)) {
        if (chartType === "candles_tn") {
          let axisMax = 1;
          for (const s of series) {
            for (const c of s.counts) {
              if ((c || 0) > axisMax) axisMax = c || 0;
            }
          }
          for (let i = 0; i <= ticks; i += 1) {
            const y = pad.t + plotH - (plotH * i) / ticks;
            const val = Math.round((axisMax * i) / ticks);
            ctx.beginPath();
            ctx.strokeStyle = "rgba(29,29,31,0.06)";
            ctx.moveTo(pad.l, y);
            ctx.lineTo(pad.l + plotW, y);
            ctx.stroke();
            ctx.fillText(String(val), pad.l - 6, y + 3);
          }
        } else {
          const allAmounts = (rows || []).map((r) => Number(r.amount) || 0);
          const axisMin = allAmounts.length ? Math.min(...allAmounts) : 0;
          const axisMaxRaw = allAmounts.length ? Math.max(...allAmounts) : 1;
          const axisMax = axisMaxRaw === axisMin ? axisMin + 1 : axisMaxRaw;
          for (let i = 0; i <= ticks; i += 1) {
            const y = pad.t + plotH - (plotH * i) / ticks;
            const val = axisMin + ((axisMax - axisMin) * i) / ticks;
            ctx.beginPath();
            ctx.strokeStyle = "rgba(29,29,31,0.06)";
            ctx.moveTo(pad.l, y);
            ctx.lineTo(pad.l + plotW, y);
            ctx.stroke();
            ctx.fillText(formatAmount(val), pad.l - 6, y + 3);
          }
        }
      } else {
        for (let i = 0; i <= ticks; i += 1) {
          const y = pad.t + plotH - (plotH * i) / ticks;
          const val = Math.round((maxY * i) / ticks);
          ctx.beginPath();
          ctx.strokeStyle = "rgba(29,29,31,0.06)";
          ctx.moveTo(pad.l, y);
          ctx.lineTo(pad.l + plotW, y);
          ctx.stroke();
          ctx.fillText(String(val), pad.l - 6, y + 3);
        }
      }

      const gap = groupW * APP_CONFIG.chart.barGapRatio;
      const innerW = groupW - gap;
      const seriesGap = innerW * APP_CONFIG.chart.seriesGapRatio;
      const barW = (innerW - seriesGap * Math.max(0, barsPerGroup - 1)) / Math.max(1, barsPerGroup);

      function fillBar(x, y, w, h, color, alpha) {
        if (h <= 0 && w > 0) return;
        const a = alpha == null ? 1 : alpha;
        const rgb = parseHexColor(color);
        ctx.save();
        ctx.beginPath();
        const r = Math.min(4, w / 2, Math.max(0, h / 2));
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, 0);
        ctx.arcTo(x, y + h, x, y, 0);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fillStyle = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + a + ")";
        ctx.fill();
        if (a < 0.98) {
          // Контур, чтобы перекрытие читалось на стекле
          ctx.strokeStyle = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + Math.min(1, a + 0.22) + ")";
          ctx.lineWidth = 1.35;
          ctx.stroke();
        }
        ctx.restore();
      }

      /**
       * Подпись под группой столбиков: режим зависит от ширины слота.
       * stack — 2 строки; tilt — наклон; vert2/vert — −90°, имя + стата умещаются в pad.b.
       */
      function drawXLabel(parts, cx, slotW) {
        const mode = pickAxisMode(slotW);
        const baseY = pad.t + plotH + 8;
        ctx.save();
        ctx.fillStyle = "#6e6e73";

        if (mode === "stack") {
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const f1 = fitTextWidth(parts.primary, slotW - 4, 10);
          ctx.font = f1.fontPx + "px sans-serif";
          ctx.fillText(f1.text, cx, baseY);
          const f2 = fitTextWidth(parts.secondary, slotW - 4, 9);
          ctx.font = f2.fontPx + "px sans-serif";
          ctx.fillText(f2.text, cx, baseY + 13);
        } else if (mode === "tilt") {
          const angle = -Math.PI / 4;
          ctx.translate(cx, baseY + 2);
          ctx.rotate(angle);
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          const maxLen = Math.max(24, pad.b - 18);
          const f1 = fitTextWidth(parts.primary, maxLen, 10);
          ctx.font = f1.fontPx + "px sans-serif";
          ctx.fillText(f1.text, 0, -6);
          const f2 = fitTextWidth(parts.secondary, maxLen, 9);
          ctx.font = f2.fontPx + "px sans-serif";
          ctx.fillText(f2.text, 0, 6);
        } else {
          // vert2 / vert: две параллельные вертикальные строки — имя ТБ и статистика
          ctx.translate(cx, Math.min(cssH - 4, pad.t + plotH + pad.b - 4));
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          const maxLen = Math.max(40, pad.b - 10);
          const f1 = fitTextWidth(parts.primary, maxLen, 10);
          ctx.font = "600 " + f1.fontPx + "px sans-serif";
          const f2 = fitTextWidth(parts.secondary, maxLen, Math.max(7, f1.fontPx - 1));
          if (mode === "vert2" || (parts.secondary && slotW >= 28)) {
            ctx.fillText(f1.text, 0, -5);
            ctx.font = f2.fontPx + "px sans-serif";
            ctx.fillText(f2.text, 0, 6);
          } else {
            // Очень узко: одна строка «имя · стата», сначала уменьшаем шрифт
            const one = fitTextWidth(f1.text + " · " + f2.text, maxLen, 9);
            ctx.font = one.fontPx + "px sans-serif";
            ctx.fillText(one.text, 0, 0);
          }
        }
        ctx.restore();
      }

      function formatBarHoverTip(binLabel, seriesName, u) {
        const lines = [];
        lines.push(binLabel || "Интервал");
        if (seriesName && seriesName !== "Вся выборка") {
          lines.push("Серия: " + seriesName);
        }
        lines.push("ТН: " + (u ? u.tn : 0));
        if (columnPresence.hasTb) lines.push("ТБ: " + (u ? u.tb : 0));
        if (columnPresence.hasGosb) lines.push("ГОСБ: " + (u ? u.gosb : 0));
        if (columnPresence.hasCluster) lines.push("Кластер: " + (u ? u.cluster : 0));
        return lines.join("\n");
      }

      function registerHitBar(x, barTop, barW, barH, tip) {
        const hitH = Math.max(barH, 8);
        const hitY = Math.max(pad.t, Math.min(Number(barTop) || pad.t, pad.t + plotH - hitH));
        const hit = {
          x: x,
          y: hitY,
          w: Math.max(barW, 2),
          h: hitH,
          tip: tip,
          canvas: canvas
        };
        if (hitTarget === "a") chartHitBarsA.push(hit);
        else if (hitTarget === "b") chartHitBarsB.push(hit);
        else chartHitBars.push(hit);
      }

      if (opts.clearPrimaryHits !== false && hitTarget === "primary") chartHitBars = [];
      if (hitTarget === "a") chartHitBarsA = [];
      if (hitTarget === "b") chartHitBarsB = [];

      const lineW = Number(APP_CONFIG.chart.lineWidth) || 2.5;
      const pointR = Number(APP_CONFIG.chart.pointRadius) || 3.5;
      const barOverlap = !!opts.barOverlap && chartType === "bars" && layout === "bin";
      const overlapRatio = Math.max(0.15, Math.min(0.7, Number(APP_CONFIG.chart.barOverlapRatio) || 0.28));
      const overlapAlpha = Math.max(0.45, Math.min(0.9, Number(APP_CONFIG.chart.barOverlapAlpha) || 0.7));

      function seriesColor(si, bi, seriesName) {
        return chartColor({
          layout,
          chartType,
          seriesIndex: si,
          binIndex: bi,
          seriesName: seriesName || (series[si] && series[si].name),
          hist,
          compareMode,
          forcedColorIndex: opts.forcedColorIndex
        });
      }

      function drawLineChart() {
        /**
         * Точки в центрах интервалов/групп.
         * В сравнении на одном canvas: линии текущего и прошлого на общей оси X.
         * Для «Значения» + сравнение — пары периодов в одной колонке значения разреза.
         */
        const drawOne = (counts, color, seriesName, x0, spanW, dash) => {
          const pts = [];
          const nPts = counts.length;
          for (let i = 0; i < nPts; i += 1) {
            const count = counts[i] || 0;
            const cx = x0 + (i + 0.5) * (spanW / Math.max(1, nPts));
            const cy = pad.t + plotH - (count / maxY) * plotH;
            pts.push({ cx, cy, count, bi: i });
            const u = cellUniques(seriesName, layout === "bin" ? i : i);
            const tipLabel = layout === "bin" ? hist.labels[i] : hist.labels[i];
            registerHitBar(cx - 8, cy, 16, Math.max(pad.t + plotH - cy, 8), formatBarHoverTip(tipLabel, seriesName, u));
          }
          ctx.beginPath();
          pts.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.cx, p.cy);
            else ctx.lineTo(p.cx, p.cy);
          });
          ctx.strokeStyle = color;
          ctx.lineWidth = lineW;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.setLineDash(dash && dash.length ? dash : []);
          ctx.stroke();
          ctx.setLineDash([]);
          for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p.cx, p.cy, pointR, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1.2;
            ctx.stroke();
            if (showLabels && p.count > 0) {
              drawBarTnLabel(String(p.count), String(p.count), p.cx - 10, p.cy - 4, 20, 12, color);
            }
          }
        };

        if (layout === "bin") {
          // Ось X = интервалы; все серии (в т.ч. Текущий/Прошлый) на одних X
          for (let si = 0; si < seriesN; si += 1) {
            const name = series[si].name;
            const code = periodCodeFromSeriesName(name);
            const dash = code === "B" ? [6, 4] : [];
            drawOne(series[si].counts, seriesColor(si, 0, name), name, pad.l, plotW, dash);
          }
          for (let bi = 0; bi < binN; bi += 1) {
            drawXLabel(axisPartsList[bi], pad.l + bi * groupW + groupW / 2, groupW);
          }
          return;
        }

        // layout === slice
        if (lineCompareSliceGroups) {
          const gN = Math.max(1, lineCompareSliceGroups.length);
          const gW = plotW / gN;
          lineCompareSliceGroups.forEach((g, gi) => {
            const x0 = pad.l + gi * gW + gap / 2;
            const span = Math.max(8, gW - gap);
            for (const it of g.items) {
              const dash = it.code === "B" ? [6, 4] : [];
              drawOne(it.counts, seriesColor(it.si, 0, it.name), it.name, x0, span, dash);
            }
            drawXLabel(axisPartsList[gi], pad.l + gi * gW + gW / 2, gW);
          });
          return;
        }

        // Один период, разрез: мини-линия по интервалам внутри колонки значения
        for (let si = 0; si < seriesN; si += 1) {
          const color = seriesColor(si, 0, series[si].name);
          const gx = pad.l + si * groupW + gap / 2;
          drawOne(series[si].counts, color, series[si].name, gx, Math.max(8, innerW), []);
          drawXLabel(axisPartsList[si], pad.l + si * groupW + groupW / 2, groupW);
        }
      }

      /**
       * Столбики прошлого (слева) и текущего (справа) слегка наезжают друг на друга;
       * полупрозрачная заливка — зона перекрытия читается как смесь цветов.
       */
      function drawOverlappingBars() {
        const pairCount = Math.ceil(seriesN / 2);
        const pairGap = pairCount > 1 ? innerW * 0.05 : 0;
        const pairSlot = (innerW - pairGap * Math.max(0, pairCount - 1)) / Math.max(1, pairCount);
        const ovBarW = Math.max(6, (pairSlot * 0.98) / (2 - overlapRatio));
        const step = ovBarW * (1 - overlapRatio);

        for (let bi = 0; bi < binN; bi += 1) {
          const gx = pad.l + bi * groupW + gap / 2;
          for (let pi = 0; pi < pairCount; pi += 1) {
            const pairBase = gx + pi * (pairSlot + pairGap) + Math.max(0, (pairSlot - (ovBarW + step)) / 2);
            // Порядок серий в overlayHist: прошлый, текущий
            const siPrev = 2 * pi;
            const siCur = 2 * pi + 1;
            // Сначала прошлый (слева / сзади), затем текущий справа сверху
            const drawOrder = [siPrev, siCur].filter((si) => si < seriesN);
            for (const si of drawOrder) {
              const code = periodCodeFromSeriesName(series[si].name);
              const isPrev = code === "B" || (code == null && (si % 2) === 0);
              const count = series[si].counts[bi] || 0;
              const h = (count / maxY) * plotH;
              const x = pairBase + (isPrev ? 0 : step);
              const y = pad.t + plotH - h;
              const color = seriesColor(si, bi, series[si].name);
              fillBar(x, y, ovBarW, Math.max(h, 0), color, overlapAlpha);
              const u = cellUniques(series[si].name, bi);
              registerHitBar(
                x, y, ovBarW, Math.max(h, 0),
                formatBarHoverTip(hist.labels[bi], series[si].name, u)
              );
              if (showLabels && count > 0) {
                drawBarTnLabel(barNameText(u), String(u.tn), x, y, ovBarW, Math.max(h, 0), color);
              }
            }
          }
          drawXLabel(axisPartsList[bi], gx + innerW / 2, groupW);
        }
      }

      function drawCandleBadge(cx, bodyW, y, text, side, color) {
        if (!text) return;
        ctx.save();
        ctx.font = "700 11px Segoe UI";
        const padBadge = { x: 7, y: 4 };
        const tw = ctx.measureText(text).width;
        const bw = Math.ceil(tw + padBadge.x * 2);
        const bh = 20;
        const bx = side === "left"
          ? cx - bodyW / 2 - bw - 6
          : cx + bodyW / 2 + 6;
        let by = y - bh / 2;
        by = Math.max(pad.t + 1, Math.min(pad.t + plotH - bh - 1, by));
        ctx.fillStyle = "rgba(255,255,255,0.98)";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        ctx.fillStyle = color;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(text, bx + padBadge.x, by + bh / 2);
        ctx.restore();
      }

      function shortenAmountLabel(v) {
        const s = formatAmount(v);
        return s.length > 14 ? shortenLabel(s, 13) : s;
      }

      /** Подписи у границ свечи: зоны (↓/↔/↑) или суммы + число ТН. */
      function drawCandleLabels(cx, bodyW, st, color, labelMode, yPos) {
        const yLow = yPos.yLow;
        const yHigh = yPos.yHigh;
        const yQ1 = yPos.yQ1;
        const yQ3 = yPos.yQ3;
        const yMidLow = (yLow + yQ1) / 2;
        const yMidBody = (yQ1 + yQ3) / 2;
        const yMidHigh = (yQ3 + yHigh) / 2;

        if (labelMode === "tn_bounds") {
          drawCandleBadge(cx, bodyW, yHigh, shortenAmountLabel(st.high), "right", color);
          if (st.above > 0) {
            drawCandleBadge(
              cx, bodyW, yQ3,
              shortenAmountLabel(st.q3) + " · ↑" + st.above + " ТН",
              "left",
              color
            );
          }
          if (st.inside > 0) {
            drawCandleBadge(
              cx, bodyW, yMidBody,
              shortenAmountLabel(st.q1) + "–" + shortenAmountLabel(st.q3) + " · " + st.inside + " ТН",
              "right",
              color
            );
          }
          if (st.below > 0) {
            drawCandleBadge(
              cx, bodyW, yQ1,
              shortenAmountLabel(st.q1) + " · ↓" + st.below + " ТН",
              "left",
              color
            );
          }
          drawCandleBadge(cx, bodyW, yLow, shortenAmountLabel(st.low), "right", color);
          return;
        }

        if (st.below > 0) drawCandleBadge(cx, bodyW, yMidLow, "↓ " + st.below + " ТН", "left", color);
        if (st.inside > 0) drawCandleBadge(cx, bodyW, yMidBody, "↔ " + st.inside + " ТН", "right", color);
        if (st.above > 0) drawCandleBadge(cx, bodyW, yMidHigh, "↑ " + st.above + " ТН", "left", color);
      }

      function drawCandlesChart(candleLabelMode) {
        const labelMode = candleLabelMode === "tn_bounds" ? "tn_bounds" : "zones";
        const tnAxisMode = labelMode === "tn_bounds";
        const candleData = [];
        for (let bi = 0; bi < binN; bi += 1) {
          for (let si = 0; si < seriesN; si += 1) {
            const s = series[si];
            const st = computeCandleStats(s.name, bi);
            if (!st) continue;
            candleData.push({
              bi,
              si,
              name: s.name,
              interval: hist.labels[bi] || ("#" + (bi + 1)),
              color: seriesColor(si, bi, s.name),
              stats: st
            });
          }
        }
        if (!candleData.length) return;
        const levelByStats = (st) => {
          if (tnAxisMode) {
            const low = 0;
            const q1 = st.below;
            const q3 = st.below + st.inside;
            const p50 = st.below + st.inside / 2;
            const high = st.total;
            return { low, q1, p50, q3, high };
          }
          return { low: st.low, q1: st.q1, p50: st.p50, q3: st.q3, high: st.high };
        };
        let yMinVal = Math.min(...candleData.map((x) => levelByStats(x.stats).low));
        let yMaxVal = Math.max(...candleData.map((x) => levelByStats(x.stats).high));
        if (!Number.isFinite(yMinVal)) yMinVal = 0;
        if (!Number.isFinite(yMaxVal)) yMaxVal = yMinVal + 1;
        if (yMaxVal === yMinVal) yMaxVal = yMinVal + 1;
        const groupWLocal = plotW / Math.max(1, binN);
        const gapLocal = groupWLocal * APP_CONFIG.chart.barGapRatio;
        const innerWLocal = groupWLocal - gapLocal;
        const seriesGapLocal = innerWLocal * APP_CONFIG.chart.seriesGapRatio;
        const bodyW = Math.max(6, (innerWLocal - seriesGapLocal * Math.max(0, seriesN - 1)) / Math.max(1, seriesN));
        const yAt = (v) => pad.t + plotH - ((v - yMinVal) / (yMaxVal - yMinVal)) * plotH;

        for (const c of candleData) {
          const st = c.stats;
          const lv = levelByStats(st);
          const gx = pad.l + c.bi * groupWLocal + gapLocal / 2;
          const cx = gx + c.si * (bodyW + seriesGapLocal) + bodyW / 2;
          const yLow = yAt(lv.low);
          const yHigh = yAt(lv.high);
          const yQ1 = yAt(lv.q1);
          const yQ3 = yAt(lv.q3);
          const yP50 = yAt(lv.p50);
          const boxTop = Math.min(yQ1, yQ3);
          const boxH = Math.max(1, Math.abs(yQ3 - yQ1));

          ctx.strokeStyle = c.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, yHigh);
          ctx.lineTo(cx, yLow);
          ctx.stroke();

          const rgb = parseHexColor(c.color);
          ctx.fillStyle = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0.22)";
          ctx.fillRect(cx - bodyW / 2, boxTop, bodyW, boxH);
          ctx.strokeStyle = c.color;
          ctx.strokeRect(cx - bodyW / 2, boxTop, bodyW, boxH);

          ctx.strokeStyle = "#FF3B30";
          ctx.beginPath();
          ctx.moveTo(cx - bodyW / 2, yP50);
          ctx.lineTo(cx + bodyW / 2, yP50);
          ctx.stroke();

          const tipLines = tnAxisMode
            ? [
              "Интервал: " + c.interval,
              "Серия: " + c.name,
              "Ось Y: количество ТН",
              "Всего ТН в интервале: " + st.total,
              "Ниже " + formatAmount(st.q1) + ": " + st.below + " ТН",
              "От " + formatAmount(st.q1) + " до " + formatAmount(st.q3) + ": " + st.inside + " ТН",
              "Выше " + formatAmount(st.q3) + ": " + st.above + " ТН"
            ]
            : [
              "Интервал: " + c.interval,
              "Серия: " + c.name,
              "Всего ТН в интервале: " + st.total,
              "Сумма ниже " + formatAmount(st.q1) + ": " + st.below + " ТН",
              "Сумма от " + formatAmount(st.q1) + " до " + formatAmount(st.q3) + ": " + st.inside + " ТН",
              "Сумма выше " + formatAmount(st.q3) + ": " + st.above + " ТН",
              "Границы по сумме: "
                + formatAmount(st.low) + " … " + formatAmount(st.high)
                + " (тело " + formatAmount(st.q1) + " … " + formatAmount(st.q3) + ")"
            ];
          registerHitBar(
            cx - bodyW / 2 - 6,
            yHigh,
            bodyW + 12,
            Math.max(8, yLow - yHigh),
            tipLines.join("\n")
          );
          if (showLabels) {
            drawCandleLabels(cx, bodyW, st, c.color, labelMode, { yLow, yHigh, yQ1, yQ3 });
          }
        }
        for (let bi = 0; bi < binN; bi += 1) {
          drawXLabel(axisPartsList[bi], pad.l + bi * groupWLocal + groupWLocal / 2, groupWLocal);
        }
      }

      if (chartType === "line") {
        drawLineChart();
      } else if (isCandleChartType(chartType)) {
        drawCandlesChart(chartType === "candles_tn" ? "tn_bounds" : "zones");
      } else if (barOverlap) {
        drawOverlappingBars();
      } else if (layout === "bin") {
        for (let bi = 0; bi < binN; bi += 1) {
          const gx = pad.l + bi * groupW + gap / 2;
          for (let si = 0; si < seriesN; si += 1) {
            const count = series[si].counts[bi] || 0;
            const h = (count / maxY) * plotH;
            const x = gx + si * (barW + seriesGap);
            const y = pad.t + plotH - h;
            const color = seriesColor(si, bi, series[si].name);
            fillBar(x, y, barW, Math.max(h, 0), color);
            const u = cellUniques(series[si].name, bi);
            registerHitBar(
              x, y, barW, Math.max(h, 0),
              formatBarHoverTip(hist.labels[bi], series[si].name, u)
            );
            if (showLabels && count > 0) {
              drawBarTnLabel(barNameText(u), String(u.tn), x, y, barW, Math.max(h, 0), color);
            }
          }
          drawXLabel(axisPartsList[bi], gx + innerW / 2, groupW);
        }
      } else {
        for (let si = 0; si < seriesN; si += 1) {
          const gx = pad.l + si * groupW + gap / 2;
          for (let bi = 0; bi < binN; bi += 1) {
            const count = series[si].counts[bi] || 0;
            const h = (count / maxY) * plotH;
            const x = gx + bi * (barW + seriesGap);
            const y = pad.t + plotH - h;
            const color = seriesColor(si, bi, series[si].name);
            fillBar(x, y, barW, Math.max(h, 0), color);
            const u = cellUniques(series[si].name, bi);
            registerHitBar(
              x, y, barW, Math.max(h, 0),
              formatBarHoverTip(hist.labels[bi], series[si].name, u)
            );
            if (showLabels && count > 0) {
              drawBarTnLabel(barNameText(u), String(u.tn), x, y, barW, Math.max(h, 0), color);
            }
          }
          drawXLabel(axisPartsList[si], gx + innerW / 2, groupW);
        }
      }
    }

    function shortenLabel(s, max) {
      if (s.length <= max) return s;
      return s.slice(0, max - 1) + "…";
    }

    function renderLegend(hist, groupLayout, chartType) {
      const layout = groupLayout === "slice" ? "slice" : "bin";
      const type = chartType || (el.chartType && el.chartType.value) || "bars";
      const compareMode = isPeriodCompareHist(hist);
      // Для slice+bars легенда = интервалы; для line/candles = серии.
      const legendBySeries = layout === "bin" || type === "line" || isCandleChartType(type);

      if (legendBySeries) {
        const series = hist.series.slice(0, APP_CONFIG.chart.maxLegendItems);
        el.legend.innerHTML = series.map((s, i) => {
          const color = chartColor({
            layout,
            chartType: type,
            seriesIndex: i,
            binIndex: 0,
            seriesName: s.name,
            hist,
            compareMode
          });
          return `<span><i style="background:${color}"></i>${escapeHtml(s.name)}</span>`;
        }).join("");
        if (hist.series.length > series.length) {
          el.legend.innerHTML += `<span style="color:#6e6e73">… ещё ${hist.series.length - series.length}</span>`;
        }
      } else {
        const labels = hist.labels.slice(0, APP_CONFIG.chart.maxLegendItems);
        el.legend.innerHTML = labels.map((lab, i) => {
          const color = chartColor({
            layout: "slice",
            chartType: "bars",
            seriesIndex: 0,
            binIndex: i,
            hist,
            compareMode: false
          });
          return `<span><i style="background:${color}"></i>${escapeHtml(lab)}</span>`;
        }).join("");
        if (hist.labels.length > labels.length) {
          el.legend.innerHTML += `<span style="color:#6e6e73">… ещё ${hist.labels.length - labels.length}</span>`;
        }
      }
    }

    function renderStats(rows, hist) {
      const amounts = rows.map((r) => r.amount);
      const min = Math.min(...amounts);
      const max = Math.max(...amounts);
      const sum = amounts.reduce((a, b) => a + b, 0);
      const avg = sum / amounts.length;
      const items = [
        ["Сырых строк", String(rawRows.length)],
        ["Уник. ТН", String(allRows.length)],
        [indicatorLabel() + " на графике", String(hist.total)],
        ["Мин. сумма", formatAmountExact(min)],
        ["Макс. сумма", formatAmountExact(max)],
        ["Среднее", formatAmount(avg)],
        ["Сумма всех", formatAmount(sum)]
      ];
      el.stats.innerHTML = items.map(([k, v]) =>
        `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`
      ).join("");
    }

    /**
     * Индекс интервала для суммы.
     * Спец-правило «все ≤ 0 → колонка 0» — только в positive-режиме с якорем 0.
     * В режиме «Все значения» — обычные полуинтервалы [left, right) по всем границам.
     */
    function binIndexForAmount(amount, edges) {
      if (!edges || edges.length < 2 || !Number.isFinite(amount)) return -1;
      if (amount < edges[0] || amount > edges[edges.length - 1]) return -1;
      const anchorNP = hasNonPositiveAnchorBin(edges);
      if (anchorNP && amount <= 0) return 0;
      const binCount = edges.length - 1;
      // Двоичный поиск полуинтервала [left, right)
      let lo = anchorNP ? 1 : 0;
      let hi = binCount - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const left = edges[mid];
        const right = edges[mid + 1];
        const isLast = mid === binCount - 1;
        if (amount < left) {
          hi = mid - 1;
          continue;
        }
        if (amount > right || (amount === right && !isLast)) {
          lo = mid + 1;
          continue;
        }
        // amount ∈ [left, right) или последний [left, right]
        if (amount < right || isLast) return mid;
        lo = mid + 1;
      }
      return -1;
    }

    function uniqueFieldValues(rows, field) {
      const set = new Set();
      for (const row of rows) {
        const v = row[field];
        if (v) set.add(v);
      }
      return set;
    }

    /**
     * Уникальные ТН/ТБ/ГОСБ/кластер по каждому интервалу.
     * @returns {{ tn: Set, tb: Set, gosb: Set, cluster: Set }[]}
     */
    function collectBinUniques(rows, edges) {
      const binCount = Math.max(0, edges.length - 1);
      const bins = Array.from({ length: binCount }, () => ({
        tn: new Set(),
        tb: new Set(),
        gosb: new Set(),
        cluster: new Set()
      }));
      for (const row of rows) {
        const bi = binIndexForAmount(row.amount, edges);
        if (bi < 0) continue;
        bins[bi].tn.add(row.tn);
        if (row.tb) bins[bi].tb.add(row.tb);
        if (row.gosb) bins[bi].gosb.add(row.gosb);
        if (row.cluster) bins[bi].cluster.add(row.cluster);
      }
      return bins;
    }

    function sliceSeriesKey(row, sliceMode) {
      if (sliceMode === "tb") return row.tb || "(без ТБ)";
      if (sliceMode === "gosb") return row.gosb || "(без ГОСБ)";
      if (sliceMode === "tb_gosb") return `${row.tb || "—"} / ${row.gosb || "—"}`;
      if (sliceMode === "cluster") return row.cluster || "(без кластера)";
      return "Вся выборка";
    }

    /** Колонки детализации: исключаем измерение текущего разреза. */
    function intervalStatColumns(sliceMode) {
      /** @type {{ key: string, label: string, tip: string }[]} */
      const cols = [];
      const add = (key, label, tip) => {
        if (key === "tb" && !columnPresence.hasTb) return;
        if (key === "gosb" && !columnPresence.hasGosb) return;
        if (key === "cluster" && !columnPresence.hasCluster) return;
        cols.push({ key, label, tip });
      };
      if (sliceMode === "tb") {
        add("gosb", "ГОСБ", "Уник. ГОСБ в интервале");
        add("cluster", "Кластер", "Уник. кластеры в интервале");
      } else if (sliceMode === "gosb") {
        add("tb", "ТБ", "Уник. ТБ в интервале");
        add("cluster", "Кластер", "Уник. кластеры в интервале");
      } else if (sliceMode === "cluster") {
        add("tb", "ТБ", "Уник. ТБ в интервале");
        add("gosb", "ГОСБ", "Уник. ГОСБ в интервале");
      } else if (sliceMode === "tb_gosb") {
        add("cluster", "Кластер", "Уник. кластеры в интервале");
      } else {
        add("tb", "ТБ", "Уник. ТБ в интервале");
        add("gosb", "ГОСБ", "Уник. ГОСБ в интервале");
        add("cluster", "Кластер", "Уник. кластеры в интервале");
      }
      cols.push({
        key: "tn",
        label: "ТН",
        tip: "Уник. ТН в интервале"
      });
      return cols;
    }

    function formatPctShare(part, whole) {
      if (!whole || !Number.isFinite(part)) return "—";
      const p = (100 * part) / whole;
      return new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 1,
        minimumFractionDigits: 0
      }).format(p) + "%";
    }

    /** Подпись колонки «% внутри разреза» в зависимости от режима. */
    function blockPctColumnMeta(sliceMode) {
      if (sliceMode === "tb") {
        return { label: "% в ТБ", tip: "Доля ТН интервала от всех ТН этого ТБ" };
      }
      if (sliceMode === "gosb") {
        return { label: "% в ГОСБ", tip: "Доля ТН интервала от всех ТН этого ГОСБ" };
      }
      if (sliceMode === "cluster") {
        return { label: "% в кластере", tip: "Доля ТН интервала от всех ТН этого кластера" };
      }
      if (sliceMode === "tb_gosb") {
        return { label: "% в ТБ+ГОСБ", tip: "Доля ТН интервала от всех ТН этой пары ТБ/ГОСБ" };
      }
      return null;
    }

    function buildIntervalStatsBlock(title, subsetRows, edges, labels, cols, opts) {
      const bins = collectBinUniques(subsetRows, edges);
      const uni = {
        tn: subsetRows.length,
        tb: uniqueFieldValues(subsetRows, "tb").size,
        gosb: uniqueFieldValues(subsetRows, "gosb").size,
        cluster: uniqueFieldValues(subsetRows, "cluster").size
      };
      const totalAllTn = Math.max(0, Number(opts && opts.totalAllTn) || subsetRows.length);
      const totalBlockTn = subsetRows.length;
      const blockPct = opts && opts.blockPctMeta ? opts.blockPctMeta : null;
      const showBlockPct = !!(blockPct && totalBlockTn > 0);

      let html = '<section class="freq-block">';
      if (title) html += `<h3 class="freq-block__title">${escapeHtml(title)}</h3>`;
      html += '<div class="table-wrap"><table><thead><tr><th>Интервал</th>';
      for (const c of cols) {
        html += `<th title="${escapeHtml(c.tip)}">${escapeHtml(c.label)}</th>`;
      }
      html += '<th title="Доля ТН интервала от всех ТН на графике">% всех</th>';
      if (showBlockPct) {
        html += `<th title="${escapeHtml(blockPct.tip)}">${escapeHtml(blockPct.label)}</th>`;
      }
      html += "</tr></thead><tbody>";

      for (let i = 0; i < labels.length; i += 1) {
        const tnBin = bins[i] ? bins[i].tn.size : 0;
        html += `<tr><td>${escapeHtml(labels[i])}</td>`;
        for (const c of cols) {
          const n = bins[i] ? bins[i][c.key].size : 0;
          html += `<td title="${escapeHtml(c.tip + ": " + n)}">${n}</td>`;
        }
        const pctAll = formatPctShare(tnBin, totalAllTn);
        html += `<td title="ТН в интервале / все ТН на графике: ${tnBin} / ${totalAllTn}">${pctAll}</td>`;
        if (showBlockPct) {
          const pctB = formatPctShare(tnBin, totalBlockTn);
          html += `<td title="${escapeHtml(blockPct.tip + ": " + tnBin + " / " + totalBlockTn)}">${pctB}</td>`;
        }
        html += "</tr>";
      }

      html += '<tr class="freq-total"><td>Итого</td>';
      for (const c of cols) {
        html += `<td title="Всего уник. ${escapeHtml(c.label)} в блоке">${uni[c.key] || 0}</td>`;
      }
      html += `<td title="Сумма долей по интервалам ≈ 100% от ${totalAllTn}">${formatPctShare(totalBlockTn, totalAllTn)}</td>`;
      if (showBlockPct) {
        html += `<td title="100% блока (${totalBlockTn} ТН)">100%</td>`;
      }
      html += "</tr>";

      html += "</tbody></table></div></section>";
      return html;
    }

    function blockTitleForSlice(sliceMode, seriesName) {
      if (sliceMode === "tb") return "ТБ: " + seriesName;
      if (sliceMode === "gosb") return "ГОСБ: " + seriesName;
      if (sliceMode === "cluster") return "Кластер: " + seriesName;
      if (sliceMode === "tb_gosb") return "ТБ / ГОСБ: " + seriesName;
      return "По интервалам (вся выборка на графике)";
    }

    function renderFrequencyTable(hist, rows, sliceMode) {
      if (!el.freqDetail) return;
      if (!rows || !rows.length || !hist || !hist.edges) {
        el.freqDetail.innerHTML = "";
        return;
      }
      const cols = intervalStatColumns(sliceMode);
      const edges = hist.edges;
      const labels = hist.labels;
      const totalAllTn = rows.length;
      const blockPctMeta = blockPctColumnMeta(sliceMode);
      const optsBase = {
        totalAllTn: totalAllTn,
        sliceMode: sliceMode,
        blockPctMeta: blockPctMeta
      };
      let html = "";

      if (sliceMode === "all") {
        html = buildIntervalStatsBlock(
          blockTitleForSlice(sliceMode, ""),
          rows,
          edges,
          labels,
          cols,
          optsBase
        );
      } else {
        const order = hist.series.map((s) => s.name);
        for (const name of order) {
          const subset = rows.filter((r) => sliceSeriesKey(r, sliceMode) === name);
          if (!subset.length) continue;
          html += buildIntervalStatsBlock(
            blockTitleForSlice(sliceMode, name),
            subset,
            edges,
            labels,
            cols,
            optsBase
          );
        }
      }
      el.freqDetail.innerHTML = html || '<p class="hint">Нет данных для таблицы интервалов.</p>';
    }

    function totalsByBin(hist) {
      const n = hist.labels.length;
      const out = Array(n).fill(0);
      for (const s of hist.series) {
        for (let i = 0; i < n; i += 1) out[i] += s.counts[i] || 0;
      }
      return out;
    }

    function renderCompareStats(rowsA, rowsB, histA, histB, edges) {
      const sumAmt = (rows) => rows.reduce((a, r) => a + r.amount, 0);
      const avgAmt = (rows) => rows.length ? sumAmt(rows) / rows.length : 0;
      const ta = totalsByBin(histA);
      const tb = totalsByBin(histB);
      let maxShift = 0;
      let maxShiftLabel = "—";
      for (let i = 0; i < ta.length; i += 1) {
        const d = Math.abs((ta[i] || 0) - (tb[i] || 0));
        if (d > maxShift) {
          maxShift = d;
          maxShiftLabel = histA.labels[i] || ("#" + (i + 1));
        }
      }
      const items = [
        [PERIOD_CUR.short + " · ТН", String(rowsA.length)],
        [PERIOD_PREV.short + " · ТН", String(rowsB.length)],
        ["Δ ТН (прошл. − тек.)", String(rowsB.length - rowsA.length)],
        [PERIOD_CUR.short + " · среднее", formatAmount(avgAmt(rowsA))],
        [PERIOD_PREV.short + " · среднее", formatAmount(avgAmt(rowsB))],
        ["Интервалов", String(edges.length - 1)],
        ["Макс. сдвиг |Δ|", maxShift + " · " + maxShiftLabel]
      ];
      el.stats.innerHTML = items.map(([k, v]) =>
        `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`
      ).join("");
    }

    function renderFrequencyTableCompare(histA, histB, rowsA, rowsB, sliceMode) {
      const ta = totalsByBin(histA);
      const tb = totalsByBin(histB);
      const totalA = rowsA.length || 1;
      const totalB = rowsB.length || 1;
      let html = '<div class="freq-block"><h3>Сравнение по интервалам (текущий vs прошлый)</h3>';
      html += "<table><thead><tr><th>Интервал</th>" +
        "<th>ТН тек.</th><th>% тек.</th><th>ТН прош.</th><th>% прош.</th><th>Δ (прош.−тек.)</th></tr></thead><tbody>";
      for (let i = 0; i < histA.labels.length; i += 1) {
        const a = ta[i] || 0;
        const b = tb[i] || 0;
        html += `<tr><td>${escapeHtml(histA.labels[i])}</td><td>${a}</td><td>${((100 * a) / totalA).toFixed(1)}%</td>` +
          `<td>${b}</td><td>${((100 * b) / totalB).toFixed(1)}%</td><td>${b - a}</td></tr>`;
      }
      html += `<tr><td><strong>Итого</strong></td><td><strong>${rowsA.length}</strong></td><td>100%</td>` +
        `<td><strong>${rowsB.length}</strong></td><td>100%</td><td><strong>${rowsB.length - rowsA.length}</strong></td></tr>`;
      html += "</tbody></table></div>";
      html += '<p class="hint">Таблица — итоги текущего и прошлого по общим границам. Разрез ТБ/кластер виден на графике.</p>';
      el.freqDetail.innerHTML = html;
    }

    function canvasContext2d(canvas) {
      if (!canvas) return null;
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(1, canvas.clientWidth || 640);
      const cssH = Math.max(1, canvas.clientHeight || 180);
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      return { ctx, w: cssW, h: cssH };
    }

    function drawSimpleBars(canvas, labels, values, color) {
      const pack = canvasContext2d(canvas);
      if (!pack) return;
      const { ctx, w, h } = pack;
      const pad = { l: 36, r: 10, t: 12, b: 58 };
      const pw = w - pad.l - pad.r;
      const ph = h - pad.t - pad.b;
      const maxV = Math.max(1, ...values.map((v) => Number(v) || 0));
      const n = Math.max(1, values.length);
      const gap = n > 12 ? 3 : 6;
      const bw = Math.max(8, (pw - gap * (n - 1)) / n);
      const labelStep = n > 18 ? 4 : (n > 12 ? 3 : (n > 8 ? 2 : 1));
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + ph);
      ctx.lineTo(pad.l + pw, pad.t + ph);
      ctx.stroke();
      for (let i = 0; i < n; i += 1) {
        const v = Number(values[i]) || 0;
        const bh = (v / maxV) * ph;
        const x = pad.l + i * (bw + gap);
        const y = pad.t + ph - bh;
        ctx.fillStyle = color || "#007AFF";
        ctx.fillRect(x, y, bw, bh);
        if (i % labelStep === 0 || i === n - 1) {
          const lbl = shortenLabel(String(labels[i] || "—"), 9);
          ctx.save();
          ctx.translate(x + bw / 2, pad.t + ph + 12);
          ctx.rotate(-0.45);
          ctx.fillStyle = "#6e6e73";
          ctx.font = "10px Segoe UI";
          ctx.textAlign = "center";
          ctx.fillText(lbl, 0, 0);
          ctx.restore();
        }
      }
    }

    function drawSimpleLine(canvas, labels, values, color) {
      const pack = canvasContext2d(canvas);
      if (!pack) return;
      const { ctx, w, h } = pack;
      const pad = { l: 34, r: 8, t: 10, b: 30 };
      const pw = w - pad.l - pad.r;
      const ph = h - pad.t - pad.b;
      const maxV = Math.max(1, ...values.map((v) => Number(v) || 0));
      const n = Math.max(2, values.length);
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + ph);
      ctx.lineTo(pad.l + pw, pad.t + ph);
      ctx.stroke();
      ctx.strokeStyle = color || "#5856D6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < values.length; i += 1) {
        const x = pad.l + (i * pw) / (n - 1);
        const y = pad.t + ph - ((Number(values[i]) || 0) / maxV) * ph;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    function quantile(sorted, q) {
      if (!sorted.length) return 0;
      const p = Math.max(0, Math.min(1, q));
      const pos = (sorted.length - 1) * p;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      if (lo === hi) return sorted[lo];
      const t = pos - lo;
      return sorted[lo] * (1 - t) + sorted[hi] * t;
    }

    function topNCounts(rows, field, n) {
      const map = new Map();
      for (const r of rows) {
        const key = (r[field] || "(пусто)").trim() || "(пусто)";
        map.set(key, (map.get(key) || 0) + 1);
      }
      return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
    }

    function drawSimplePie(canvas, labels, values) {
      const pack = canvasContext2d(canvas);
      if (!pack) return;
      const { ctx, w, h } = pack;
      const total = values.reduce((a, b) => a + Math.max(0, Number(b) || 0), 0);
      if (!total) return;
      const cx = Math.round(w * 0.28);
      const cy = Math.round(h * 0.52);
      const r = Math.min(w, h) * 0.28;
      let start = -Math.PI / 2;
      const colors = ["#007AFF", "#34C759", "#FF9500", "#AF52DE", "#5856D6", "#FF3B30", "#5AC8FA", "#30D158"];
      for (let i = 0; i < values.length; i += 1) {
        const v = Math.max(0, Number(values[i]) || 0);
        const a = (v / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, start + a);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        start += a;
      }
      ctx.fillStyle = "#1d1d1f";
      ctx.font = "12px Segoe UI";
      ctx.textAlign = "left";
      for (let i = 0; i < labels.length; i += 1) {
        const y = 18 + i * 16;
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(Math.round(w * 0.56), y - 8, 10, 10);
        ctx.fillStyle = "#1d1d1f";
        const pct = total ? ((100 * (values[i] || 0)) / total).toFixed(1) : "0.0";
        ctx.fillText(shortenLabel(String(labels[i]), 16) + " · " + pct + "%", Math.round(w * 0.56) + 14, y);
      }
    }

    function drawBandChart(canvas, labels, p10, p50, p90) {
      const pack = canvasContext2d(canvas);
      if (!pack) return;
      const { ctx, w, h } = pack;
      const pad = { l: 34, r: 8, t: 10, b: 34 };
      const pw = w - pad.l - pad.r;
      const ph = h - pad.t - pad.b;
      const all = p10.concat(p50).concat(p90).map((v) => Number(v) || 0);
      const maxV = Math.max(1, ...all);
      const n = Math.max(2, labels.length);
      const xAt = (i) => pad.l + (i * pw) / (n - 1);
      const yAt = (v) => pad.t + ph - ((Number(v) || 0) / maxV) * ph;
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + ph);
      ctx.lineTo(pad.l + pw, pad.t + ph);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < labels.length; i += 1) {
        const x = xAt(i);
        if (i === 0) ctx.moveTo(x, yAt(p10[i]));
        else ctx.lineTo(x, yAt(p10[i]));
      }
      for (let i = labels.length - 1; i >= 0; i -= 1) {
        ctx.lineTo(xAt(i), yAt(p90[i]));
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(0,122,255,0.16)";
      ctx.fill();
      ctx.strokeStyle = "#5856D6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < labels.length; i += 1) {
        const x = xAt(i);
        const y = yAt(p50[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    function sampleStd(vals, mean) {
      const n = vals.length;
      if (n < 2) return 0;
      let acc = 0;
      for (let i = 0; i < n; i += 1) {
        const d = vals[i] - mean;
        acc += d * d;
      }
      return Math.sqrt(acc / (n - 1));
    }

    function meanOf(nums) {
      if (!nums.length) return 0;
      let s = 0;
      for (let i = 0; i < nums.length; i += 1) s += nums[i];
      return s / nums.length;
    }

    /** Полные метрики ТЗ по группе (growth_sum → amount). */
    function groupStats(rows, field) {
      const m = new Map();
      for (const r of rows) {
        const k = rowDimKey(r, field);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(Number(r.amount) || 0);
      }
      return Array.from(m.entries()).map(([name, vals]) => {
        const count = vals.length;
        let sum = 0;
        let countPos = 0;
        let countNeg = 0;
        let countZero = 0;
        for (let i = 0; i < count; i += 1) {
          const v = vals[i];
          sum += v;
          if (v > 0) countPos += 1;
          else if (v < 0) countNeg += 1;
          else countZero += 1;
        }
        const avg = count ? sum / count : 0;
        const sorted = vals.slice().sort((a, b) => a - b);
        const q1 = quantile(sorted, 0.25);
        const q3 = quantile(sorted, 0.75);
        const p50 = quantile(sorted, 0.5);
        return {
          name,
          count,
          sum,
          avg,
          median: p50,
          p10: quantile(sorted, 0.1),
          p50,
          p90: quantile(sorted, 0.9),
          min: sorted[0] || 0,
          max: sorted[sorted.length - 1] || 0,
          std: sampleStd(vals, avg),
          q1,
          q3,
          iqr: q3 - q1,
          countPos,
          countNeg,
          countZero,
          sharePos: count ? countPos / count : 0,
          shareNeg: count ? countNeg / count : 0,
          shareZero: count ? countZero / count : 0,
          score: 0
        };
      });
    }

    function attachCompositeScores(groups) {
      const w = (APP_CONFIG.analysisScoreWeights) || { avg: 0.5, median: 0.3, sharePos: 0.2 };
      const avgs = groups.map((g) => g.avg);
      const meds = groups.map((g) => g.median);
      const shares = groups.map((g) => g.sharePos);
      const muA = meanOf(avgs);
      const muM = meanOf(meds);
      const muS = meanOf(shares);
      const sgA = sampleStd(avgs, muA);
      const sgM = sampleStd(meds, muM);
      const sgS = sampleStd(shares, muS);
      for (const g of groups) {
        const zA = sgA ? (g.avg - muA) / sgA : 0;
        const zM = sgM ? (g.median - muM) / sgM : 0;
        const zS = sgS ? (g.sharePos - muS) / sgS : 0;
        g.score = (Number(w.avg) || 0.5) * zA
          + (Number(w.median) || 0.3) * zM
          + (Number(w.sharePos) || 0.2) * zS;
        g.zAvg = zA;
        g.zMed = zM;
        g.zShare = zS;
      }
      return groups;
    }

    function valueByMetric(x, metric) {
      if (metric === "sum") return x.sum;
      if (metric === "avg") return x.avg;
      if (metric === "median") return x.median;
      if (metric === "share_pos") return x.sharePos;
      if (metric === "score") return x.score;
      return x.count;
    }

    function metricTitle(metric) {
      return ({
        count: "N (ТН)",
        sum: "Σ сумма",
        avg: "Средняя",
        median: "Медиана",
        share_pos: "Доля >0",
        score: "Score"
      })[metric] || metric;
    }

    /**
     * Отбор лучших по ТЗ: Top-N / Top-X% / шишки.
     * topParam: N или percent или threshold в зависимости от mode.
     */
    function selectRankedGroups(groups, metric, mode, topParam, outlierType) {
      const M = groups.length;
      const sorted = groups.slice().sort((a, b) => valueByMetric(b, metric) - valueByMetric(a, metric));
      let picked = [];
      let hint = "";
      if (mode === "top_pct") {
        const percent = Math.max(1, Math.min(100, Number(topParam) || 10));
        const N = Math.max(1, Math.ceil(M * percent / 100));
        picked = sorted.slice(0, Math.min(N, M));
        const realPct = M ? (100 * picked.length / M) : 0;
        hint = `Показаны лучшие ${percent}% объектов: ${picked.length} из ${M} (${realPct.toFixed(1)}%). Ранжирование по «${metricTitle(metric)}».`;
      } else if (mode === "outliers") {
        const threshold = Number(topParam) || 90;
        const type = outlierType || "percentile";
        const outlierMetric = metric === "count" ? "avg" : metric;
        const vals = groups.map((g) => valueByMetric(g, outlierMetric));
        if (type === "zscore") {
          const mu = meanOf(vals);
          const sg = sampleStd(vals, mu);
          picked = groups.filter((g) => {
            const z = sg ? (valueByMetric(g, outlierMetric) - mu) / sg : 0;
            return z >= threshold;
          });
          hint = `Найдено ${picked.length} «шишек» (Z ≥ ${threshold}) из ${M}. Ранжирование по «${metricTitle(metric)}».`;
        } else if (type === "abs") {
          const billion = Number(APP_CONFIG.analysisBillion) || 1e9;
          const absThr = threshold * billion;
          picked = groups.filter((g) => g.avg >= absThr);
          hint = `Найдено ${picked.length} «шишек» (avg ≥ ${threshold} млрд) из ${M}. Ранжирование по «${metricTitle(metric)}».`;
        } else {
          const sortedVals = vals.slice().sort((a, b) => a - b);
          const T = quantile(sortedVals, Math.max(0, Math.min(1, threshold / 100)));
          picked = groups.filter((g) => valueByMetric(g, outlierMetric) >= T);
          hint = `Найдено ${picked.length} «шишек» (≥ ${threshold}-й процентиль) из ${M}. Ранжирование по «${metricTitle(metric)}».`;
        }
        picked = picked.slice().sort((a, b) => valueByMetric(b, metric) - valueByMetric(a, metric));
      } else {
        const N = Math.max(1, Math.floor(Number(topParam) || 5));
        picked = sorted.slice(0, Math.min(N, M));
        const realPct = M ? (100 * picked.length / M) : 0;
        hint = `Показаны лучшие ${picked.length} объектов из ${M} (${realPct.toFixed(1)}%). Ранжирование по «${metricTitle(metric)}».`;
      }
      picked.forEach((g, i) => { g.rank = i + 1; });
      return { picked, hint, M };
    }

    function drawBoxplot(canvas, groups) {
      const pack = canvasContext2d(canvas);
      if (!pack || !groups.length) return;
      const { ctx, w, h } = pack;
      const pad = { l: 36, r: 10, t: 12, b: 36 };
      const pw = w - pad.l - pad.r;
      const ph = h - pad.t - pad.b;
      let lo = Infinity;
      let hi = -Infinity;
      for (const g of groups) {
        const whiskerLo = Math.max(g.min, g.q1 - 1.5 * g.iqr);
        const whiskerHi = Math.min(g.max, g.q3 + 1.5 * g.iqr);
        if (whiskerLo < lo) lo = whiskerLo;
        if (whiskerHi > hi) hi = whiskerHi;
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
        lo = 0;
        hi = 1;
      }
      const yAt = (v) => pad.t + ph - ((v - lo) / (hi - lo)) * ph;
      const n = groups.length;
      const slot = pw / n;
      const boxW = Math.max(8, Math.min(28, slot * 0.55));
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + ph);
      ctx.lineTo(pad.l + pw, pad.t + ph);
      ctx.stroke();
      for (let i = 0; i < n; i += 1) {
        const g = groups[i];
        const cx = pad.l + slot * i + slot / 2;
        const wLo = Math.max(g.min, g.q1 - 1.5 * g.iqr);
        const wHi = Math.min(g.max, g.q3 + 1.5 * g.iqr);
        ctx.strokeStyle = "#5856D6";
        ctx.beginPath();
        ctx.moveTo(cx, yAt(wLo));
        ctx.lineTo(cx, yAt(wHi));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - boxW / 3, yAt(wLo));
        ctx.lineTo(cx + boxW / 3, yAt(wLo));
        ctx.moveTo(cx - boxW / 3, yAt(wHi));
        ctx.lineTo(cx + boxW / 3, yAt(wHi));
        ctx.stroke();
        const y1 = yAt(g.q3);
        const y0 = yAt(g.q1);
        ctx.fillStyle = "rgba(88,86,214,0.18)";
        ctx.fillRect(cx - boxW / 2, Math.min(y0, y1), boxW, Math.abs(y1 - y0) || 1);
        ctx.strokeStyle = "#5856D6";
        ctx.strokeRect(cx - boxW / 2, Math.min(y0, y1), boxW, Math.abs(y1 - y0) || 1);
        ctx.strokeStyle = "#FF3B30";
        ctx.beginPath();
        ctx.moveTo(cx - boxW / 2, yAt(g.p50));
        ctx.lineTo(cx + boxW / 2, yAt(g.p50));
        ctx.stroke();
        ctx.fillStyle = "#6e6e73";
        ctx.font = "10px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText(shortenLabel(g.name, 8), cx, pad.t + ph + 14);
      }
    }

    function drawHeatmapAvg(canvas, rows, rowField, colField, side) {
      const pack = canvasContext2d(canvas);
      if (!pack) return;
      const { ctx, w, h } = pack;
      const rKeys = topNCounts(rows, rowField, side).map((x) => x[0]);
      const cKeys = topNCounts(rows, colField, side).map((x) => x[0]);
      if (!rKeys.length || !cKeys.length) return;
      const sums = new Map();
      const cnts = new Map();
      for (const r of rows) {
        const rk = rowDimKey(r, rowField);
        const ck = rowDimKey(r, colField);
        if (!rKeys.includes(rk) || !cKeys.includes(ck)) continue;
        const id = rk + "\0" + ck;
        sums.set(id, (sums.get(id) || 0) + (Number(r.amount) || 0));
        cnts.set(id, (cnts.get(id) || 0) + 1);
      }
      let minAvg = Infinity;
      let maxAvg = -Infinity;
      const avgs = new Map();
      for (const rk of rKeys) {
        for (const ck of cKeys) {
          const id = rk + "\0" + ck;
          const c = cnts.get(id) || 0;
          const a = c ? (sums.get(id) || 0) / c : 0;
          avgs.set(id, a);
          if (c) {
            if (a < minAvg) minAvg = a;
            if (a > maxAvg) maxAvg = a;
          }
        }
      }
      if (!Number.isFinite(minAvg)) { minAvg = 0; maxAvg = 1; }
      if (maxAvg === minAvg) maxAvg = minAvg + 1;
      const pad = { l: 72, r: 8, t: 28, b: 8 };
      const cw = (w - pad.l - pad.r) / cKeys.length;
      const rh = (h - pad.t - pad.b) / rKeys.length;
      ctx.font = "10px Segoe UI";
      ctx.textAlign = "center";
      ctx.fillStyle = "#6e6e73";
      for (let j = 0; j < cKeys.length; j += 1) {
        ctx.fillText(shortenLabel(cKeys[j], 8), pad.l + j * cw + cw / 2, 16);
      }
      ctx.textAlign = "right";
      for (let i = 0; i < rKeys.length; i += 1) {
        for (let j = 0; j < cKeys.length; j += 1) {
          const id = rKeys[i] + "\0" + cKeys[j];
          const a = avgs.get(id) || 0;
          const t = (a - minAvg) / (maxAvg - minAvg);
          const rC = Math.round(255 * (1 - t));
          const gC = Math.round(200 * (1 - Math.abs(t - 0.5) * 2));
          const bC = Math.round(255 * t);
          ctx.fillStyle = `rgb(${rC},${gC},${bC})`;
          ctx.fillRect(pad.l + j * cw, pad.t + i * rh, cw - 1, rh - 1);
        }
        ctx.fillStyle = "#1d1d1f";
        ctx.fillText(shortenLabel(rKeys[i], 10), pad.l - 4, pad.t + i * rh + rh * 0.65);
      }
    }

    function dimFieldTitle(dim) {
      if (dim === "gosb") return "ГОСБ";
      if (dim === "cluster") return "Кластер";
      if (dim === "tn") return "ТН";
      return "ТБ";
    }

    function rowDimKey(row, field) {
      return (row[field] || "(пусто)").trim() || "(пусто)";
    }

    /** Матрица счётчиков по двум полям только для заданных ключей (один проход). */
    function buildCrossCounts(rows, rowField, colField, rowKeys, colKeys) {
      const rowSet = new Set(rowKeys);
      const colSet = new Set(colKeys);
      const map = new Map();
      for (const r of rows) {
        const rk = rowDimKey(r, rowField);
        const ck = rowDimKey(r, colField);
        if (!rowSet.has(rk) || !colSet.has(ck)) continue;
        const id = rk + "\0" + ck;
        map.set(id, (map.get(id) || 0) + 1);
      }
      return map;
    }

    function renderCrossMatrixHtml(cornerLabel, rowKeys, colKeys, counts) {
      let html = "<table><thead><tr><th>" + escapeHtml(cornerLabel) + "</th>"
        + colKeys.map((k) => `<th>${escapeHtml(shortenLabel(k, 14))}</th>`).join("")
        + "</tr></thead><tbody>";
      for (const rk of rowKeys) {
        html += `<tr><td>${escapeHtml(rk)}</td>`;
        for (const ck of colKeys) {
          html += `<td>${counts.get(rk + "\0" + ck) || 0}</td>`;
        }
        html += "</tr>";
      }
      html += "</tbody></table>";
      return html;
    }

    function clearAnalysisTables() {
      const nodes = [
        el.analysisTableIntervals,
        el.analysisTableCategories,
        el.analysisTablePercentiles,
        el.analysisTableTopBottomAllDims,
        el.analysisTableTbClusterMatrix,
        el.analysisTableStability,
        el.analysisTableBinByDim,
        el.analysisTableTbGosbMatrix,
        el.analysisTableGosbClusterMatrix,
        el.analysisTableSignByDim,
        el.analysisTableTailOwners,
        el.analysisTableFullDim
      ];
      for (const node of nodes) {
        if (node) node.innerHTML = "";
      }
    }

    function scheduleAnalysisRender(rows, edges) {
      if (viewMode !== "analysis") {
        analysisDirty = true;
        return;
      }
      // Откладываем после paint — вкладка открывается сразу, таблицы догоняют
      if (analysisRenderTimer) clearTimeout(analysisRenderTimer);
      analysisRenderTimer = setTimeout(() => {
        analysisRenderTimer = 0;
        if (viewMode !== "analysis") {
          analysisDirty = true;
          return;
        }
        setChartStatus("Считаю аналитику…", "");
        renderAnalysis(rows, edges);
        analysisDirty = false;
        const nBins = edges && edges.length > 1 ? edges.length - 1 : 0;
        setChartStatus(
          `Аналитика: ${nBins} интервалов; ТН в анализе: ${rows.length}.`,
          "ok"
        );
      }, 0);
    }

    function renderAnalysis(rows, edges) {
      if (!el.analysisPanel) return;
      // Жёсткий стоп: вне вкладки анализа тяжёлый расчёт не выполняем
      if (viewMode !== "analysis") {
        analysisDirty = true;
        return;
      }
      if (!rows.length || !edges || edges.length < 2) {
        clearAnalysisTables();
        return;
      }
      const dim = (el.analysisDim && el.analysisDim.value) || "tb";
      const dimTitle = dimFieldTitle(dim);
      const metric = (el.analysisMetric && el.analysisMetric.value) || "sum";
      const rankMode = (el.analysisRankMode && el.analysisRankMode.value) || "top_n";
      const outlierType = (el.analysisOutlierType && el.analysisOutlierType.value) || "percentile";
      const topN = Math.max(1, Number(el.analysisTopN && el.analysisTopN.value) || 5);
      const hist = computeHistogram(rows, edges, "all");
      const totals = totalsByBin(hist);
      const total = Math.max(1, rows.length);
      const nBins = hist.labels.length;
      const binIdx = new Int32Array(rows.length);
      const binSums = new Float64Array(nBins);
      const binCounts = new Int32Array(nBins);
      for (let i = 0; i < rows.length; i += 1) {
        const bi = binIndexForAmount(rows[i].amount, edges);
        binIdx[i] = bi;
        if (bi >= 0 && bi < nBins) {
          binCounts[bi] += 1;
          binSums[bi] += Number(rows[i].amount) || 0;
        }
      }
      const cdf = [];
      let acc = 0;
      for (const v of totals) {
        acc += v;
        cdf.push((100 * acc) / total);
      }
      drawSimpleBars(el.anChartBins, hist.labels, totals, "#007AFF");
      drawSimpleLine(el.anChartCdf, hist.labels, cdf, "#5856D6");

      const groups = attachCompositeScores(groupStats(rows, dim));
      const ranked = selectRankedGroups(groups, metric, rankMode, topN, outlierType);
      const top = ranked.picked;
      const sortedByMetric = groups.slice().sort((a, b) => valueByMetric(b, metric) - valueByMetric(a, metric));
      const bottom = sortedByMetric.slice(-Math.min(topN, sortedByMetric.length)).reverse();
      if (el.analysisRankHint) el.analysisRankHint.textContent = ranked.hint || "";

      // Топы по оргразрезам — по выбранной метрике (не только count)
      {
        const gTb = attachCompositeScores(groupStats(rows, "tb"));
        const pTb = selectRankedGroups(gTb, metric, "top_n", Math.min(8, topN), outlierType).picked;
        drawSimpleBars(el.anChartTb, pTb.map((x) => x.name), pTb.map((x) => valueByMetric(x, metric)), "#34C759");
        const gGo = attachCompositeScores(groupStats(rows, "gosb"));
        const pGo = selectRankedGroups(gGo, metric, "top_n", Math.min(8, topN), outlierType).picked;
        drawSimpleBars(el.anChartGosb, pGo.map((x) => x.name), pGo.map((x) => valueByMetric(x, metric)), "#FF9500");
        const gCl = attachCompositeScores(groupStats(rows, "cluster"));
        const pCl = selectRankedGroups(gCl, metric, "top_n", Math.min(8, topN), outlierType).picked;
        drawSimpleBars(el.anChartCluster, pCl.map((x) => x.name), pCl.map((x) => valueByMetric(x, metric)), "#AF52DE");
      }

      const sortedAmounts = rows.map((r) => r.amount).sort((a, b) => a - b);
      const decVals = [];
      const decLabels = [];
      for (let i = 1; i <= 10; i += 1) {
        decLabels.push("D" + i);
        decVals.push(quantile(sortedAmounts, i / 10));
      }
      drawSimpleLine(el.anChartDeciles, decLabels, decVals, "#FF3B30");

      drawSimpleBars(el.anChartTop, top.map((x) => x.name), top.map((x) => valueByMetric(x, metric)), "#007AFF");
      drawSimpleBars(el.anChartBottom, bottom.map((x) => x.name), bottom.map((x) => valueByMetric(x, metric)), "#FF3B30");
      drawSimplePie(el.anChartPie, top.map((x) => x.name), top.map((x) => Math.max(0, x.sum)));
      drawBoxplot(el.anChartBand, top.slice(0, Math.min(12, top.length)));
      const avgMetric = (metric === "median") ? "median" : "avg";
      drawSimpleBars(
        el.anChartAvgBar,
        top.map((x) => x.name),
        top.map((x) => valueByMetric(x, avgMetric)),
        "#0b6bcb"
      );
      if (el.anChartHeat) drawHeatmapAvg(el.anChartHeat, rows, "gosb", "tb", Math.min(8, Math.max(5, topN)));

      if (el.analysisTableIntervals) {
        let html = "<table><thead><tr><th>Интервал</th><th>N</th><th>%</th><th>Средняя</th><th>Σ</th></tr></thead><tbody>";
        for (let i = 0; i < nBins; i += 1) {
          const cnt = binCounts[i];
          const avg = cnt ? binSums[i] / cnt : 0;
          html += `<tr><td>${escapeHtml(hist.labels[i])}</td><td>${cnt}</td><td>${formatPctShare(cnt, total)}</td><td>${escapeHtml(formatAmount(avg))}</td><td>${escapeHtml(formatAmount(binSums[i]))}</td></tr>`;
        }
        html += "</tbody></table>";
        el.analysisTableIntervals.innerHTML = html;
      }

      if (el.analysisTableCategories) {
        const rowsShow = (rankMode === "top_n" ? top : sortedByMetric.slice(0, Math.min(40, sortedByMetric.length)));
        let html = "<table><thead><tr>"
          + "<th>Rank</th><th>" + escapeHtml(dimTitle) + "</th><th>N</th><th>Σ</th><th>Avg</th><th>Median</th>"
          + "<th>Std</th><th>Q1</th><th>Q3</th><th>IQR</th>"
          + "<th>%&gt;0</th><th>%&lt;0</th><th>%0</th><th>Score</th>"
          + "</tr></thead><tbody>";
        for (const x of rowsShow) {
          html += `<tr>`
            + `<td>${x.rank || ""}</td>`
            + `<td>${escapeHtml(x.name)}</td>`
            + `<td>${x.count}</td>`
            + `<td>${escapeHtml(formatAmount(x.sum))}</td>`
            + `<td>${escapeHtml(formatAmount(x.avg))}</td>`
            + `<td>${escapeHtml(formatAmount(x.median))}</td>`
            + `<td>${escapeHtml(formatAmount(x.std))}</td>`
            + `<td>${escapeHtml(formatAmount(x.q1))}</td>`
            + `<td>${escapeHtml(formatAmount(x.q3))}</td>`
            + `<td>${escapeHtml(formatAmount(x.iqr))}</td>`
            + `<td>${(100 * x.sharePos).toFixed(1)}%</td>`
            + `<td>${(100 * x.shareNeg).toFixed(1)}%</td>`
            + `<td>${(100 * x.shareZero).toFixed(1)}%</td>`
            + `<td>${x.score.toFixed(3)}</td>`
            + `</tr>`;
        }
        html += "</tbody></table>";
        el.analysisTableCategories.innerHTML = html;
      }

      if (el.analysisTablePercentiles) {
        const p1 = quantile(sortedAmounts, 0.01);
        const p5 = quantile(sortedAmounts, 0.05);
        const p25 = quantile(sortedAmounts, 0.25);
        const p50 = quantile(sortedAmounts, 0.5);
        const p75 = quantile(sortedAmounts, 0.75);
        const p95 = quantile(sortedAmounts, 0.95);
        const p99 = quantile(sortedAmounts, 0.99);
        const iqr = p75 - p25;
        const concentrationTop10 = top.slice(0, Math.min(10, top.length)).reduce((a, x) => a + x.count, 0);
        const concentrationShare = formatPctShare(concentrationTop10, rows.length);
        const html = "<table><thead><tr><th>Показатель</th><th>Значение</th></tr></thead><tbody>"
          + `<tr><td>P1 / P5</td><td>${escapeHtml(formatAmount(p1))} / ${escapeHtml(formatAmount(p5))}</td></tr>`
          + `<tr><td>P25 / P50 / P75</td><td>${escapeHtml(formatAmount(p25))} / ${escapeHtml(formatAmount(p50))} / ${escapeHtml(formatAmount(p75))}</td></tr>`
          + `<tr><td>P95 / P99</td><td>${escapeHtml(formatAmount(p95))} / ${escapeHtml(formatAmount(p99))}</td></tr>`
          + `<tr><td>IQR (P75-P25)</td><td>${escapeHtml(formatAmount(iqr))}</td></tr>`
          + `<tr><td>Размах (max-min)</td><td>${escapeHtml(formatAmount((sortedAmounts[sortedAmounts.length - 1] || 0) - (sortedAmounts[0] || 0)))}</td></tr>`
          + `<tr><td>Концентрация top-${Math.min(10, top.length)} категорий</td><td>${concentrationShare}</td></tr>`
          + "</tbody></table>";
        el.analysisTablePercentiles.innerHTML = html;
      }

      if (el.analysisTableTopBottomAllDims) {
        const dims = [
          { key: "tb", title: "ТБ" },
          { key: "gosb", title: "ГОСБ" },
          { key: "cluster", title: "Кластер" }
        ];
        let html = "<table><thead><tr><th>Разрез</th><th>Сегмент</th><th>Категория</th><th>ТН</th><th>Σ сумма</th><th>Средняя</th></tr></thead><tbody>";
        for (const d of dims) {
          const s = attachCompositeScores(groupStats(rows, d.key))
            .sort((a, b) => valueByMetric(b, metric) - valueByMetric(a, metric));
          const t = s.slice(0, Math.min(topN, s.length));
          const b = s.slice(-Math.min(topN, s.length)).reverse();
          for (const x of t) html += `<tr><td>${d.title}</td><td>Top</td><td>${escapeHtml(x.name)}</td><td>${x.count}</td><td>${escapeHtml(formatAmount(x.sum))}</td><td>${escapeHtml(formatAmount(x.avg))}</td></tr>`;
          for (const x of b) html += `<tr><td>${d.title}</td><td>Bottom</td><td>${escapeHtml(x.name)}</td><td>${x.count}</td><td>${escapeHtml(formatAmount(x.sum))}</td><td>${escapeHtml(formatAmount(x.avg))}</td></tr>`;
        }
        html += "</tbody></table>";
        el.analysisTableTopBottomAllDims.innerHTML = html;
      }

      const matrixSide = Math.min(8, Math.max(topN, 5));
      if (el.analysisTableTbClusterMatrix) {
        const topTbKeys = topNCounts(rows, "tb", matrixSide).map((x) => x[0]);
        const topClusterKeys = topNCounts(rows, "cluster", matrixSide).map((x) => x[0]);
        const counts = buildCrossCounts(rows, "tb", "cluster", topTbKeys, topClusterKeys);
        el.analysisTableTbClusterMatrix.innerHTML = renderCrossMatrixHtml("ТБ \\ Кластер", topTbKeys, topClusterKeys, counts);
      }

      if (el.analysisTableStability) {
        const s = top.slice(0, Math.min(top.length, Math.max(topN, 10)));
        let html = "<table><thead><tr><th>Категория</th><th>Min</th><th>Q1</th><th>Median</th><th>Q3</th><th>Max</th><th>IQR</th><th>CV</th><th>Score</th></tr></thead><tbody>";
        for (const x of s) {
          const cv = x.avg ? (x.iqr / Math.abs(x.avg)) : 0;
          html += `<tr><td>${escapeHtml(x.name)}</td>`
            + `<td>${escapeHtml(formatAmount(x.min))}</td>`
            + `<td>${escapeHtml(formatAmount(x.q1))}</td>`
            + `<td>${escapeHtml(formatAmount(x.median))}</td>`
            + `<td>${escapeHtml(formatAmount(x.q3))}</td>`
            + `<td>${escapeHtml(formatAmount(x.max))}</td>`
            + `<td>${escapeHtml(formatAmount(x.iqr))}</td>`
            + `<td>${escapeHtml((cv * 100).toFixed(1) + "%")}</td>`
            + `<td>${x.score.toFixed(3)}</td></tr>`;
        }
        html += "</tbody></table>";
        el.analysisTableStability.innerHTML = html;
      }

      /* G: состав каждого интервала по выбранному разрезу */
      if (el.analysisTableBinByDim) {
        const binDimMaps = Array.from({ length: nBins }, () => new Map());
        for (let i = 0; i < rows.length; i += 1) {
          const bi = binIdx[i];
          if (bi < 0 || bi >= nBins) continue;
          const k = rowDimKey(rows[i], dim);
          binDimMaps[bi].set(k, (binDimMaps[bi].get(k) || 0) + 1);
        }
        const perBinTop = Math.min(5, topN);
        let html = "<table><thead><tr><th>Интервал</th><th>ТН</th><th>Топ " + dimTitle + "</th><th>ТН в топе</th><th>% интервала</th></tr></thead><tbody>";
        for (let i = 0; i < nBins; i += 1) {
          const entries = Array.from(binDimMaps[i].entries()).sort((a, b) => b[1] - a[1]).slice(0, perBinTop);
          if (!entries.length) {
            html += `<tr><td>${escapeHtml(hist.labels[i])}</td><td>0</td><td colspan="3">—</td></tr>`;
            continue;
          }
          for (let j = 0; j < entries.length; j += 1) {
            const [name, cnt] = entries[j];
            const intervalCell = j === 0
              ? `<td rowspan="${entries.length}">${escapeHtml(hist.labels[i])}</td><td rowspan="${entries.length}">${binCounts[i]}</td>`
              : "";
            html += `<tr>${intervalCell}<td>${escapeHtml(name)}</td><td>${cnt}</td><td>${formatPctShare(cnt, Math.max(1, binCounts[i]))}</td></tr>`;
          }
        }
        html += "</tbody></table>";
        el.analysisTableBinByDim.innerHTML = html;
      }

      /* H: ТБ × ГОСБ */
      if (el.analysisTableTbGosbMatrix) {
        const rKeys = topNCounts(rows, "tb", matrixSide).map((x) => x[0]);
        const cKeys = topNCounts(rows, "gosb", matrixSide).map((x) => x[0]);
        const counts = buildCrossCounts(rows, "tb", "gosb", rKeys, cKeys);
        el.analysisTableTbGosbMatrix.innerHTML = renderCrossMatrixHtml("ТБ \\ ГОСБ", rKeys, cKeys, counts);
      }

      /* I: ГОСБ × кластер */
      if (el.analysisTableGosbClusterMatrix) {
        const rKeys = topNCounts(rows, "gosb", matrixSide).map((x) => x[0]);
        const cKeys = topNCounts(rows, "cluster", matrixSide).map((x) => x[0]);
        const counts = buildCrossCounts(rows, "gosb", "cluster", rKeys, cKeys);
        el.analysisTableGosbClusterMatrix.innerHTML = renderCrossMatrixHtml("ГОСБ \\ Кластер", rKeys, cKeys, counts);
      }

      /* J: профиль знака ≤0 / >0 */
      if (el.analysisTableSignByDim) {
        const signMap = new Map();
        for (const r of rows) {
          const k = rowDimKey(r, dim);
          if (!signMap.has(k)) signMap.set(k, { le0: 0, gt0: 0, sumPos: 0 });
          const s = signMap.get(k);
          const amt = Number(r.amount) || 0;
          if (amt <= 0) s.le0 += 1;
          else {
            s.gt0 += 1;
            s.sumPos += amt;
          }
        }
        const signRows = Array.from(signMap.entries()).map(([name, s]) => {
          const count = s.le0 + s.gt0;
          return {
            name,
            count,
            le0: s.le0,
            gt0: s.gt0,
            le0Share: count ? s.le0 / count : 0,
            avgPos: s.gt0 ? s.sumPos / s.gt0 : 0
          };
        }).sort((a, b) => b.count - a.count).slice(0, Math.max(topN * 2, 20));
        let html = "<table><thead><tr><th>" + escapeHtml(dimTitle) + "</th><th>ТН</th><th>≤0</th><th>>0</th><th>% ≤0</th><th>Средняя >0</th></tr></thead><tbody>";
        for (const x of signRows) {
          html += `<tr><td>${escapeHtml(x.name)}</td><td>${x.count}</td><td>${x.le0}</td><td>${x.gt0}</td><td>${escapeHtml((100 * x.le0Share).toFixed(1) + "%")}</td><td>${escapeHtml(formatAmount(x.avgPos))}</td></tr>`;
        }
        html += "</tbody></table>";
        el.analysisTableSignByDim.innerHTML = html;
      }

      /* K: владельцы верхнего хвоста */
      if (el.analysisTableTailOwners) {
        const lastBin = Math.max(0, nBins - 1);
        const p90 = quantile(sortedAmounts, 0.9);
        const lastRows = [];
        const p90Rows = [];
        for (let i = 0; i < rows.length; i += 1) {
          if (binIdx[i] === lastBin) lastRows.push(rows[i]);
          if ((Number(rows[i].amount) || 0) >= p90) p90Rows.push(rows[i]);
        }
        const dimsK = [
          { key: "tb", title: "ТБ" },
          { key: "gosb", title: "ГОСБ" },
          { key: "cluster", title: "Кластер" }
        ];
        let html = "<table><thead><tr><th>Зона</th><th>Разрез</th><th>Категория</th><th>ТН</th><th>% зоны</th></tr></thead><tbody>";
        const zones = [
          { title: "Последний интервал (" + hist.labels[lastBin] + ")", list: lastRows },
          { title: "≥ P90 (" + formatAmount(p90) + ")", list: p90Rows }
        ];
        for (const zone of zones) {
          const zoneTotal = Math.max(1, zone.list.length);
          for (const d of dimsK) {
            const tops = topNCounts(zone.list, d.key, Math.min(topN, 8));
            for (const [name, cnt] of tops) {
              html += `<tr><td>${escapeHtml(zone.title)}</td><td>${d.title}</td><td>${escapeHtml(name)}</td><td>${cnt}</td><td>${formatPctShare(cnt, zoneTotal)}</td></tr>`;
            }
          }
        }
        html += "</tbody></table>";
        el.analysisTableTailOwners.innerHTML = html;
      }

      /* L: полный список категорий выбранного разреза */
      if (el.analysisTableFullDim) {
        const modeBin = new Map();
        for (let i = 0; i < rows.length; i += 1) {
          const bi = binIdx[i];
          if (bi < 0 || bi >= nBins) continue;
          const k = rowDimKey(rows[i], dim);
          if (!modeBin.has(k)) modeBin.set(k, new Int32Array(nBins));
          modeBin.get(k)[bi] += 1;
        }
        const full = sortedByMetric.slice();
        let html = "<table><thead><tr><th>#</th><th>" + escapeHtml(dimTitle) + "</th><th>ТН</th><th>%</th><th>Σ сумма</th><th>Средняя</th><th>Модальный интервал</th></tr></thead><tbody>";
        for (let i = 0; i < full.length; i += 1) {
          const x = full[i];
          const counts = modeBin.get(x.name);
          let bestBi = 0;
          let bestCnt = 0;
          if (counts) {
            for (let b = 0; b < nBins; b += 1) {
              if (counts[b] > bestCnt) {
                bestCnt = counts[b];
                bestBi = b;
              }
            }
          }
          const modeLabel = bestCnt ? hist.labels[bestBi] : "—";
          html += `<tr><td>${i + 1}</td><td>${escapeHtml(x.name)}</td><td>${x.count}</td><td>${formatPctShare(x.count, total)}</td><td>${escapeHtml(formatAmount(x.sum))}</td><td>${escapeHtml(formatAmount(x.avg))}</td><td>${escapeHtml(modeLabel)}</td></tr>`;
        }
        html += "</tbody></table>";
        el.analysisTableFullDim.innerHTML = html;
      }
    }

    /* Tooltip: data-tip и столбики гистограммы */
    (function initTips() {
      const tip = el.glassTip;
      const OFFSET = Number(APP_CONFIG.tipOffsetPx) || 14;

      function show(text, x, y) {
        tip.textContent = text;
        tip.classList.add("show");
        tip.setAttribute("aria-hidden", "false");
        const rect = tip.getBoundingClientRect();
        let left = x + OFFSET;
        let top = y + OFFSET;
        if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
        if (top + rect.height > window.innerHeight - 8) top = y - rect.height - 8;
        if (left < 8) left = 8;
        if (top < 8) top = 8;
        tip.style.left = left + "px";
        tip.style.top = top + "px";
      }

      function hide() {
        tip.classList.remove("show");
        tip.setAttribute("aria-hidden", "true");
      }

      function hitTestOnCanvas(canvas, hits, clientX, clientY) {
        if (!canvas || !hits || !hits.length) return null;
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
        for (let i = hits.length - 1; i >= 0; i -= 1) {
          const b = hits[i];
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
        }
        return null;
      }

      function hitTestChartBar(clientX, clientY) {
        return hitTestOnCanvas(el.chart, chartHitBars, clientX, clientY)
          || hitTestOnCanvas(el.chartA, chartHitBarsA, clientX, clientY)
          || hitTestOnCanvas(el.chartB, chartHitBarsB, clientX, clientY);
      }

      document.addEventListener("mousemove", (e) => {
        const node = e.target.closest("[data-tip]");
        if (node) {
          if (el.chart) el.chart.style.cursor = "";
          show(node.getAttribute("data-tip") || "", e.clientX, e.clientY);
          return;
        }
        const bar = hitTestChartBar(e.clientX, e.clientY);
        if (bar) {
          if (e.target && e.target.style) e.target.style.cursor = "pointer";
          show(bar.tip, e.clientX, e.clientY);
          return;
        }
        hide();
      }, true);

      [el.chart, el.chartA, el.chartB].forEach((c) => {
        if (!c) return;
        c.addEventListener("mouseleave", () => {
          c.style.cursor = "";
          hide();
        });
      });
    })();

    /**
     * @param {Blob} file
     * @returns {Promise<{ text: string, encoding: string, score: number, byteLength: number }>}
     */
    function readFileAsText(file) {
      const CE = (typeof CsvEncoding !== "undefined") ? CsvEncoding : null;
      if (CE && typeof CE.readFileDecoded === "function") {
        return CE.readFileDecoded(file, encodingDetectOpts());
      }
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          text: String(reader.result || ""),
          encoding: "utf-8 (fallback)",
          score: 0,
          byteLength: file && file.size ? file.size : 0
        });
        reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
        reader.readAsText(file);
      });
    }

    function setViewMode(_mode) {
      viewMode = "single";
      document.body.classList.remove("is-compare", "is-analysis", "is-compare-split");
      syncViewModeUi();
    }

    function storeLastParsed(fileText, parsed, fileName) {
      const meta = parsed && parsed.meta ? parsed.meta : {};
      lastParsed = {
        text: String(fileText || ""),
        headers: (meta.headers || []).slice(),
        delimiter: meta.delimiter || ";",
        rawLines: (meta.rawLines || []).slice(),
        fileName: fileName || ""
      };
      const slot = getActiveSlot();
      if (slot) {
        slot.text = lastParsed.text;
        slot.fileName = lastParsed.fileName;
      }
    }

    function reparseFromLastParsed() {
      reparseAllSlotsFromText();
    }

    el.fileInput.addEventListener("change", async () => {
      const file = el.fileInput.files && el.fileInput.files[0];
      if (!file) return;
      try {
        const slot = getActiveSlot();
        if (!slot) throw new Error("Нет активного слота.");
        await loadFileIntoSlot(slot.id, file);
      } catch (err) {
        setLoadStatus((err && err.message) ? err.message : String(err), "err");
      } finally {
        el.fileInput.value = "";
      }
    });

    el.btnRebuild.addEventListener("click", rebuild);

    if (el.btnEqualCountEdges) el.btnEqualCountEdges.addEventListener("click", applyEqualCountEdges);
    if (el.btnLadderCountEdges) el.btnLadderCountEdges.addEventListener("click", applyLadderCountEdges);
    if (el.btnEvenWidthEdges) el.btnEvenWidthEdges.addEventListener("click", applyEvenWidthEdges);
    if (el.btnExportRaw) el.btnExportRaw.addEventListener("click", exportRawCsvWithGroup);
    if (el.btnExportTn) el.btnExportTn.addEventListener("click", exportUniqueTnCsv);
    if (el.btnExportGroups) el.btnExportGroups.addEventListener("click", exportGroupsText);
    if (el.btnExportFileStats) el.btnExportFileStats.addEventListener("click", exportFileStats);

    function clearPeriodB() {
      rawRowsB = [];
      allRowsB = [];
      presenceB = { hasTb: false, hasGosb: false, hasCluster: false };
      columnPresenceB = presenceB;
      fileNameB = "";
      if (el.fileInputB) el.fileInputB.value = "";
      if (el.fileOverviewB) el.fileOverviewB.innerHTML = "";
      chartHitBarsB = [];
    }

    function clearPeriodA() {
      rawRows = [];
      allRows = [];
      presenceA = { hasTb: false, hasGosb: false, hasCluster: false };
      fileNameA = "";
      lastParsed = null;
      if (el.fileInput) el.fileInput.value = "";
      if (el.fileOverviewA) el.fileOverviewA.innerHTML = "";
      chartHitBars = [];
      chartHitBarsA = [];
    }

    function resetUiAfterDataClear() {
      lastChartState = null;
      columnPresence = mergedColumnPresence();
      if (!allRows.length && !allRowsB.length) {
        el.orgTree.innerHTML = '<div class="empty">Загрузите данные</div>';
        el.clusterChecks.innerHTML = '<div class="empty">Загрузите данные</div>';
        filterSelections = { tb: new Set(), gosb: new Set(), cluster: new Set() };
        el.legend.innerHTML = "";
        el.stats.innerHTML = "";
        if (el.freqDetail) el.freqDetail.innerHTML = "";
        clearAnalysisTables();
        edgeState.edges = [];
        renderEdgeRail();
        setChartStatus("", "");
        document.body.classList.remove("is-compare-split");
        refreshWinnersPreview();
        [el.chart, el.chartA, el.chartB].forEach((c) => {
          if (!c) return;
          const ctx = c.getContext("2d");
          ctx && ctx.clearRect(0, 0, c.width, c.height);
        });
      } else {
        refreshPresenceAndFilters(true);
        initEdgeStateFromData(true);
        rebuild();
      }
      setLoadStatus("", "");
    }

    el.btnClear.addEventListener("click", () => {
      clearAllSlots();
    });

    el.sliceMode.addEventListener("change", () => {
      syncGroupLayoutUi();
      rebuild();
    });
    el.groupLayout.addEventListener("change", () => {
      syncChartModeConstraints();
      rebuild();
    });
    if (el.chartType) {
      el.chartType.addEventListener("change", () => {
        syncChartModeConstraints();
        rebuild();
      });
    }
    if (el.showChartLabels) {
      el.showChartLabels.addEventListener("change", () => {
        const wrap = document.getElementById("showChartLabelsSwitch");
        if (wrap) {
          wrap.classList.toggle("is-on", !!el.showChartLabels.checked);
          el.showChartLabels.setAttribute("aria-checked", el.showChartLabels.checked ? "true" : "false");
        }
        rebuild();
      });
    }
    if (el.compareLayout) {
      el.compareLayout.addEventListener("change", () => {
        syncChartModeConstraints();
        rebuild();
      });
    }
    bindSegmentedControl(el.chartTypeSeg, el.chartType, rebuild);
    bindSegmentedControl(el.groupLayoutSeg, el.groupLayout, rebuild);
    bindSegmentedControl(el.edgeCalcModeSeg, el.edgeCalcMode, () => {
      initEdgeStateFromData(true);
      rebuild();
    });
    el.movableEdgeCount.addEventListener("change", () => {
      initEdgeStateFromData(true);
      rebuild();
    });

    function runBulkFilterSelection(selectAll) {
      applyBulkFilterSelection(selectAll);
      rebuildFilterOptions(
        false,
        selectAll ? "Выбраны все ТБ, ГОСБ и кластеры" : "Сняты все отметки ТБ, ГОСБ и кластеров"
      );
      initEdgeStateFromData(false);
      rebuild();
    }

    if (el.btnFilterSelectAll) {
      fillBtnIcon(el.btnFilterSelectAll, "checkAll");
      el.btnFilterSelectAll.addEventListener("click", () => runBulkFilterSelection(true));
    }
    if (el.btnFilterClearAll) {
      fillBtnIcon(el.btnFilterClearAll, "clearAll");
      el.btnFilterClearAll.addEventListener("click", () => runBulkFilterSelection(false));
    }
    fillBtnIcon(el.btnEqualCountEdges, "barsEqual");
    fillBtnIcon(el.btnLadderCountEdges, "barsLadder");
    fillBtnIcon(el.btnEvenWidthEdges, "barsEven");
    fillBtnIcon(el.btnExportRaw, "downloadCsv");
    fillBtnIcon(el.btnExportTn, "download");
    fillBtnIcon(el.btnExportGroups, "downloadList");
    fillBtnIcon(el.btnExportFileStats, "downloadStats");

    window.addEventListener("resize", () => {
      if (allRows.length) rebuild();
    });

    document.title = APP_CONFIG.pageTitle;
    {
      const allowedSlice = new Set(["all", "tb", "cluster"]);
      const defSlice = APP_CONFIG.defaultSliceMode || "all";
      el.sliceMode.value = allowedSlice.has(defSlice) ? defSlice : "all";
    }
    el.groupLayout.value = APP_CONFIG.defaultGroupLayout || "slice";
    if (el.chartType) el.chartType.value = APP_CONFIG.defaultChartType || "bars";
    if (el.showChartLabels) el.showChartLabels.checked = APP_CONFIG.defaultShowChartLabels !== false;
    {
      const wrap = document.getElementById("showChartLabelsSwitch");
      if (wrap && el.showChartLabels) {
        wrap.classList.toggle("is-on", !!el.showChartLabels.checked);
        el.showChartLabels.setAttribute("aria-checked", el.showChartLabels.checked ? "true" : "false");
      }
    }
    if (el.edgeCalcMode) el.edgeCalcMode.value = "positive";
    el.movableEdgeCount.value = String(APP_CONFIG.defaultMovableEdges);
    el.movableEdgeCount.max = String(APP_CONFIG.movableEdgesMax || 40);

    // Мультислоты
    (function initSlotsUi() {
      slotMode = String(APP_CONFIG.defaultSlotMode || "pair");
      const modeSel = document.getElementById("slotModeSelect");
      const modeSeg = document.getElementById("slotModeSeg");
      const customRow = document.getElementById("slotCustomNRow");
      const customInput = document.getElementById("slotCustomCount");
      if (modeSel) modeSel.value = slotMode;
      if (modeSeg) {
        modeSeg.querySelectorAll(".seg__btn").forEach((btn) => {
          btn.classList.toggle("is-on", btn.getAttribute("data-value") === slotMode);
        });
      }
      if (customRow) customRow.classList.toggle("is-on", slotMode === "custom");
      if (customInput) {
        customInput.value = String(customSlotCount);
        customInput.addEventListener("change", () => {
          customSlotCount = Math.max(1, Math.min(maxDataSlots(), Number(customInput.value) || 1));
          customInput.value = String(customSlotCount);
          if (slotMode === "custom") rebuildDataSlots(true);
        });
      }
      bindSegmentedControl(modeSeg, modeSel, () => {
        slotMode = (modeSel && modeSel.value) || "pair";
        if (customRow) customRow.classList.toggle("is-on", slotMode === "custom");
        rebuildDataSlots(true);
      });
      const rail = document.getElementById("slotsRail");
      if (rail) {
        rail.addEventListener("click", (ev) => {
          const t = ev.target;
          if (!(t instanceof Element)) return;
          const clearBtn = t.closest("[data-slot-clear]");
          if (clearBtn) {
            clearSlot(clearBtn.getAttribute("data-slot-clear"));
            ev.preventDefault();
            return;
          }
          if (t.closest("[data-slot-label]") || t.closest(".slot-card__file-btn") || t.closest("input[type='file']")) {
            return;
          }
          const card = t.closest(".slot-card");
          if (card) setActiveSlot(card.getAttribute("data-slot-id"));
        });
        rail.addEventListener("change", async (ev) => {
          const t = ev.target;
          if (!(t instanceof HTMLInputElement) || t.type !== "file") return;
          const id = t.getAttribute("data-slot-file");
          const file = t.files && t.files[0];
          if (!id || !file) {
            setLoadStatus("Файл не выбран или слот не найден.", "err");
            return;
          }
          try {
            await loadFileIntoSlot(id, file);
          } catch (_err) {
            /* сообщение уже в setLoadStatus */
          } finally {
            t.value = "";
          }
        });
        rail.addEventListener("blur", (ev) => {
          const t = ev.target;
          if (!(t instanceof HTMLElement)) return;
          const id = t.getAttribute("data-slot-label");
          if (!id) return;
          const slot = dataSlots.find((s) => s.id === id);
          if (slot) slot.label = (t.textContent || "").trim() || slot.label;
        }, true);
      }
      const btnApply = document.getElementById("btnApplySettingsAll");
      if (btnApply) {
        btnApply.addEventListener("click", () => {
          captureSharedSettingsFromUi();
          applySharedSettingsToUi();
          setLoadStatus("Настройки активного слота применены ко всем (фильтры и границы).", "ok");
          refreshWinnersPreview();
        });
      }
      rebuildDataSlots(false);
    })();

    const orgSeg = document.getElementById("diversityOrgSeg");
    if (orgSeg) {
      orgSeg.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".seg__btn");
        if (!btn) return;
        const v = btn.getAttribute("data-value");
        if (!v) return;
        diversityOrgDim = v;
        orgSeg.querySelectorAll(".seg__btn").forEach((b) => {
          b.classList.toggle("is-on", b.getAttribute("data-value") === v);
        });
        drawDiversityCharts(diversityReport);
      });
    }

    function wireSuggestButtons() {
      const run = () => runSuggestBetter();
      const b1 = document.getElementById("btnSuggestBetter");
      const b2 = document.getElementById("btnSuggestBetter2");
      if (b1) b1.addEventListener("click", run);
      if (b2) b2.addEventListener("click", run);
      const box = document.getElementById("suggestCards");
      if (box) {
        box.addEventListener("click", (ev) => {
          const t = ev.target;
          if (!(t instanceof Element)) return;
          const applyBtn = t.closest("[data-suggest-apply]");
          const previewBtn = t.closest("[data-suggest-preview]");
          const ranked = box._suggestRanked || [];
          if (applyBtn) {
            const idx = Number(applyBtn.getAttribute("data-suggest-apply"));
            const item = ranked[idx];
            if (item) applySuggestPatch(item.patch, true);
            return;
          }
          if (previewBtn) {
            const idx = Number(previewBtn.getAttribute("data-suggest-preview"));
            const item = ranked[idx];
            if (!item) return;
            applySuggestPatch(item.patch, false);
            setLoadStatus("Превью на активном слоте (не сохранено). Нажмите «Применить» в карточке, чтобы запомнить.", "ok");
          }
        });
      }
    }
    wireSuggestButtons();

    // Переключатель показателя из #app-config
    (function initIndicatorUi() {
      const variants = getIndicatorVariants();
      const defId = APP_CONFIG.defaultIndicatorId || (variants[0] && variants[0].id) || "tn";
      if (el.indicatorSelect) {
        el.indicatorSelect.innerHTML = variants.map((v) =>
          `<option value="${escapeHtml(v.id)}">${escapeHtml(v.label || v.id)}</option>`
        ).join("");
        el.indicatorSelect.value = variants.some((v) => v.id === defId) ? defId : variants[0].id;
      }
      if (el.indicatorSeg) {
        el.indicatorSeg.innerHTML = variants.map((v) =>
          `<button type="button" class="seg__btn${v.id === (el.indicatorSelect && el.indicatorSelect.value) ? " is-on" : ""}" data-value="${escapeHtml(v.id)}">${escapeHtml(v.label || v.id)}</button>`
        ).join("");
      }
    })();

    if (el.indicatorSelect) {
      el.indicatorSelect.addEventListener("change", () => {
        if (lastParsed && lastParsed.text) reparseFromLastParsed();
        else if (allRows.length) rebuild();
      });
    }
    bindSegmentedControl(el.indicatorSeg, el.indicatorSelect, () => {
      if (lastParsed && lastParsed.text) reparseFromLastParsed();
      else if (allRows.length) rebuild();
    });

    initWinnersUi();

    syncViewModeUi();
    syncGroupLayoutUi();
    syncChartModeConstraints();
    syncSegFromSelect(el.edgeCalcModeSeg, el.edgeCalcMode);
    syncSegFromSelect(el.indicatorSeg, el.indicatorSelect);

    // Экспорт для тестов в Node (если страница открыта как модуль — не используется)
    window.ContestCriteria = window.SumDistribution = {
      normalizeAmount,
      normalizeEmpId,
      findColumnIndex,
      aggregateByTn,
      cascadeEdges,
      evenlySpacedEdges,
      equalCountEdges,
      ladderCountEdges,
      buildBins,
      integerBounds,
      toIntegerEdge,
      formatAmount,
      formatAmountExact,
      computeHistogram,
      binIndexForAmount,
      collectBinUniques,
      parseTableText,
      getSelectedIndicator,
      getIndicatorAliases,
      indicatorLabel,
      computeWinnersMap,
      computeWinnersResult,
      winnersLookup,
      getWinnersConfig: () => winnersConfig,
      ContestInterest: CI,
      getDataSlots: () => dataSlots,
      computeAllowedValues,
      computeAllAllowed,
      expandSelectionOnCheck,
      orderFilterValues,
      FILTER_DIMS
    };
