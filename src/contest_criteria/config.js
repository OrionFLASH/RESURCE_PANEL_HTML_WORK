/** Настройки страницы критериев конкурса. Правьте и обновите страницу. */
window.CONTEST_CRITERIA_CONFIG = {
  "_comment": "Параметры contest-criteria (мультислоты). После правки обновите страницу.",
  "pageTitle": "Критерии конкурса",
  "defaultSliceMode": "all",
  "defaultGroupLayout": "slice",
  "defaultChartType": "bars",
  "defaultShowChartLabels": true,
  "defaultMovableEdges": 3,
  "_intervalsNote": "defaultMovableEdges / movableEdgesMax — это число ИНТЕРВАЛОВ (столбиков), не бегунков",
  "movableEdgesMax": 40,
  "tnPadLength": 20,
  "exportTnLength": 8,
  "amountFractionDigits": 2,
  "freqTableMaxSeries": 12,
  "tipOffsetPx": 14,
  "maxBinEdges": 2000,
  "csvDelimiters": [";", ",", "\t"],
  "amountColumnAliases": ["сумма", "прирост", "прирос", "рост", "итог", "sum", "amount", "сумм"],
  "tnColumnAliases": ["тн", "tn", "табельный", "таб.ном", "табельный номер", "emp_id"],
  "indicatorVariants": [
    { "id": "tn", "label": "ТН", "aliases": ["тн", "tn", "табельный", "таб.ном", "табельный номер", "emp_id"] },
    { "id": "kpk", "label": "КПК", "aliases": ["кпк", "kpk", "клиентский", "клиентский пк", "клиентскийпк"] },
    { "id": "inn", "label": "ИНН", "aliases": ["инн", "inn", "tax_id", "taxpayer", "инн клиента"] }
  ],
  "defaultIndicatorId": "tn",
  "maxDataSlots": 12,
  "defaultSlotMode": "pair",
  "monthLabels": ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  "quarterLabels": ["кв 1", "кв 2", "кв 3", "кв 4"],
  "pairLabels": ["Прошлый", "Текущий"],
  "interestTargets": {
    "inclusivityMin": 0.01,
    "inclusivityMax": 0.15,
    "personHhiMax": 0.08,
    "orgCoverageMin": 0.35,
    "chanceZoneMin": 0.08,
    "repeatShareMax": 0.45
  },
  "interestWeights": {
    "inclusivity": 0.2,
    "personHhi": 0.2,
    "orgCoverage": 0.2,
    "chanceZone": 0.15,
    "churn": 0.15,
    "entropyOrg": 0.1
  },
  "tbColumnAliases": ["тб", "tb", "тербанк", "тер.банк"],
  "gosbColumnAliases": ["госб", "gosb", "гос"],
  "clusterColumnAliases": ["кластер", "cluster", "cluster_code"],
  "chart": {
    "barGapRatio": 0.12,
    "seriesGapRatio": 0.04,
    "maxLegendItems": 24,
    "lineWidth": 2.5,
    "pointRadius": 3.5,
    "barOverlapRatio": 0.28,
    "barOverlapAlpha": 0.7
  },
  "seriesColors": [
    "#007AFF", "#34C759", "#FF9500", "#5856D6", "#FF3B30",
    "#5AC8FA", "#AF52DE", "#FF2D55", "#64D2FF", "#30D158",
    "#0b6bcb", "#0f8a6a", "#c27a00", "#8e3b8f", "#2c7a7b"
  ],
  "demoEnabled": false,
  "demoSamplePath": "samples/sum-distribution-demo-20000.csv",
  "_demoNote": "samples/ не в git. Генерация: python3 tools/build_sum_demo_csv_20k.py"
};
