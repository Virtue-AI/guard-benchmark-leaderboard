"use strict";

/**
 * Guard Benchmark Leaderboard -- main application module.
 *
 * Loads leaderboard.json and models_meta.json, merges them, then renders
 * the hero stats, leaderboard table, detail panel, charts, and comparison.
 */

const state = {
  dataset: null,
  modelsMeta: {},
  datasetComposition: {},
  filteredRuns: [],
  selectedRunId: null,
  sourceLabel: "Loading",
  search: "",
  sortKey: "f1",
  provider: "all",
  pack: "all",
  modelType: "all",
  latestOnly: false,
  modality: "text",
};

const el = {
  sourceBadge: document.getElementById("source-badge"),
  generatedAt: document.getElementById("generated-at"),
  summaryModels: null,
  summaryDatasets: null,
  summaryF1: null,
  summaryLatency: null,
  visibleCount: document.getElementById("visible-count"),
  leaderboardBody: document.getElementById("leaderboard-body"),
  detailTitle: document.getElementById("detail-title"),
  detailStatus: document.getElementById("detail-status"),
  detailContent: document.getElementById("detail-content"),
  searchInput: document.getElementById("search-input"),
  sortSelect: document.getElementById("sort-select"),
  providerSelect: document.getElementById("provider-select"),
  typeSelect: document.getElementById("type-select"),
  packSelect: null,
  latestOnly: null,
  uploadJson: null,
  resetSource: null,
  compareSelects: [
    document.getElementById("compare-model-a"),
    document.getElementById("compare-model-b"),
    document.getElementById("compare-model-c"),
    document.getElementById("compare-model-d"),
  ],
  compareContainer: document.getElementById("compare-container"),
  compareEmpty: document.getElementById("compare-empty"),
  compareMetrics: document.getElementById("compare-metrics"),
  compareDatasetBody: document.getElementById("compare-dataset-body"),
  compareThead: document.getElementById("compare-thead"),
  datasetRankingSelect: document.getElementById("dataset-ranking-select"),
  datasetRankingCard: document.getElementById("dataset-ranking-card"),
  datasetRankingEmpty: document.getElementById("dataset-ranking-empty"),
  datasetRankingContent: document.getElementById("dataset-ranking-content"),
};

/* ─── HELPERS ─── */

function fmt(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value)
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function fmtPct(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "-";
  }
  return (Number(value) * 100).toFixed(1) + "%";
}

function fmtDate(value) {
  if (!value) {
    return "-";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isVirtue(name) {
  const lower = name.toLowerCase();
  return lower.includes("virtue") || lower.includes("virtueguard");
}

/* ─── DATA ─── */

function computeFpr(ds, comp) {
  if (comp === "unsafe_only") return null;
  if (ds.accuracy == null) return null;
  if (comp === "safe_only") return 1 - ds.accuracy;
  // mixed: derive from precision, recall, accuracy
  const { precision, recall, accuracy } = ds;
  if (precision == null || recall == null) return null;
  if (accuracy >= 1) return 0;
  if (precision === 0) return 0; // no predicted positives → no FP
  // Normalize with TP = 1
  const FP = (1 - precision) / precision;
  const FN = (1 - recall) / recall;
  const total = (FP + FN) / (1 - accuracy);
  const TN = accuracy * total - 1;
  const denom = FP + TN;
  if (denom <= 0) return 0;
  return FP / denom;
}

function attachFpr(runs, composition) {
  for (const run of runs) {
    const fprValues = [];
    for (const ds of run.datasets) {
      const comp = composition[ds.name] || "mixed";
      ds.fpr = computeFpr(ds, comp);
      if (ds.fpr != null) fprValues.push(ds.fpr);
    }
    run.aggregate.fpr = fprValues.length
      ? fprValues.reduce((a, b) => a + b, 0) / fprValues.length
      : null;
  }
}

function parseLeaderboard(payload) {
  if (!payload || !Array.isArray(payload.runs)) {
    throw new Error("leaderboard payload must include a runs array");
  }

  const runs = payload.runs.map((run, idx) => {
    const agg = run.aggregate || {};
    return {
      runId: run.run_id || `run-${idx + 1}`,
      runName: run.run_name || `Run ${idx + 1}`,
      modelName: run.model_name || "Unknown model",
      provider: run.provider || "Unknown",
      adapter: run.adapter || "unknown",
      benchmarkPack: run.benchmark_pack || "unscoped",
      status: run.status || "unknown",
      runTimestamp: run.run_timestamp || "",
      toolVersion: run.tool_version || "-",
      gitRef: run.git_ref || "-",
      reportPath: run.report_path || "",
      datasets: Array.isArray(run.datasets) ? run.datasets : [],
      aggregate: {
        guardScore: agg.guard_score ?? run.guard_score ?? null,
        f1: agg.f1 ?? run.f1 ?? null,
        recall: agg.recall ?? run.recall ?? null,
        precision: agg.precision ?? run.precision ?? null,
        accuracy: agg.accuracy ?? run.accuracy ?? null,
      },
      parameters: null,
      isOpenSource: null,
      source: null,
      avgLatencyMs: null,
      costPer1mTokens: null,
      huggingfaceId: null,
      avgCompletionTokens: null,
      outputTokensPerSec: null,
    };
  });

  return { generatedAt: payload.generated_at || "", runs };
}

function mergeMetadata(runs, meta) {
  for (const run of runs) {
    const m = meta[run.modelName];
    if (!m) {
      continue;
    }
    run.parameters = m.parameters ?? null;
    run.isOpenSource = m.is_open_source ?? null;
    run.source = m.source ?? null;
    run.avgLatencyMs = m.avg_latency_ms ?? null;
    run.costPer1mTokens = m.cost_per_1m_tokens ?? null;
    run.huggingfaceId = m.huggingface_id ?? null;
    run.avgCompletionTokens = m.avg_completion_tokens ?? null;
    run.outputTokensPerSec = m.output_tokens_per_sec ?? null;
  }
}

function leaderboardJsonPath(modality) {
  if (modality === "code") return "data/leaderboard-code.json";
  return "data/leaderboard.json";
}

async function loadCommittedData() {
  const res = await fetch(leaderboardJsonPath(state.modality), { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to load leaderboard data: " + res.status);
  }
  return res.json();
}

async function loadModelsMeta() {
  try {
    const res = await fetch("data/models_meta.json", { cache: "no-store" });
    if (!res.ok) {
      return { models: {}, dataset_composition: {} };
    }
    const data = await res.json();
    return {
      models: data.models || {},
      dataset_composition: data.dataset_composition || {},
    };
  } catch {
    return { models: {}, dataset_composition: {} };
  }
}

function setDataset(payload, sourceLabel, meta) {
  state.dataset = parseLeaderboard(payload);
  if (meta) {
    state.modelsMeta = meta.models || meta;
    state.datasetComposition = meta.dataset_composition || {};
  }
  mergeMetadata(state.dataset.runs, state.modelsMeta);
  attachFpr(state.dataset.runs, state.datasetComposition);
  state.sourceLabel = sourceLabel;
  syncControls();
  updateFilters();
  try {
    renderCharts();
  } catch (err) {
    console.error("Chart rendering failed:", err);
  }
  setupCompareSelectors();
  setupDatasetRankingSelector();
}

/* ─── FILTER / SORT ─── */

function dedupeLatest(runs) {
  const map = new Map();
  for (const r of runs) {
    const cur = map.get(r.modelName);
    if (
      !cur ||
      new Date(r.runTimestamp).getTime() > new Date(cur.runTimestamp).getTime()
    ) {
      map.set(r.modelName, r);
    }
  }
  return Array.from(map.values());
}

function compareRuns(a, b) {
  if (state.sortKey === "newest") {
    return (
      (new Date(b.runTimestamp).getTime() || 0) -
      (new Date(a.runTimestamp).getTime() || 0)
    );
  }
  if (state.sortKey === "latency") {
    const la = a.avgLatencyMs ?? Infinity;
    const lb = b.avgLatencyMs ?? Infinity;
    return la - lb;
  }
  if (state.sortKey === "fpr") {
    const fa = a.aggregate.fpr ?? Infinity;
    const fb = b.aggregate.fpr ?? Infinity;
    return fa - fb;
  }
  const ma = Number(a.aggregate[state.sortKey] ?? -1);
  const mb = Number(b.aggregate[state.sortKey] ?? -1);
  if (mb !== ma) {
    return mb - ma;
  }
  return a.modelName.localeCompare(b.modelName);
}

function updateFilters() {
  if (!state.dataset) {
    return;
  }
  let runs = [...state.dataset.runs];

  if (state.latestOnly) {
    runs = dedupeLatest(runs);
  }
  if (state.provider !== "all") {
    runs = runs.filter((r) => r.provider === state.provider);
  }
  if (state.pack !== "all") {
    runs = runs.filter((r) => r.benchmarkPack === state.pack);
  }
  if (state.modelType === "oss") {
    runs = runs.filter((r) => r.isOpenSource === true);
  } else if (state.modelType === "api") {
    runs = runs.filter((r) => r.source === "api");
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    runs = runs.filter((r) =>
      [r.runName, r.modelName, r.provider, r.benchmarkPack, r.adapter]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  runs.sort(compareRuns);
  state.filteredRuns = runs;

  if (!runs.some((r) => r.runId === state.selectedRunId)) {
    state.selectedRunId = runs[0]?.runId || null;
  }

  render();
}

function syncControls() {
  const providers = new Set();
  const packs = new Set();
  for (const r of state.dataset.runs) {
    providers.add(r.provider);
    packs.add(r.benchmarkPack);
  }
  rebuildSelect(el.providerSelect, "All providers", providers);
  if (el.packSelect) {
    rebuildSelect(el.packSelect, "All packs", packs);
  }
}

function rebuildSelect(selectEl, firstLabel, valuesSet) {
  const prev = selectEl.value;
  selectEl.innerHTML = "";
  const first = document.createElement("option");
  first.value = "all";
  first.textContent = firstLabel;
  selectEl.appendChild(first);
  for (const v of Array.from(valuesSet).sort()) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
  selectEl.value = valuesSet.has(prev) ? prev : "all";
}

/* ─── RENDER ─── */

function render() {
  renderHeader();
  renderSummary();
  renderTable();
  renderDetail();
}

function renderHeader() {
  el.sourceBadge.textContent = state.sourceLabel;
  el.generatedAt.textContent = state.dataset?.generatedAt
    ? "Generated " + fmtDate(state.dataset.generatedAt)
    : "--";
}

function renderSummary() {
  const runs = state.filteredRuns;
  const models = new Set(runs.map((r) => r.modelName));
  const datasets = new Set();
  for (const r of runs) {
    for (const d of r.datasets) {
      datasets.add(d.name);
    }
  }
  const topF1 = runs[0]?.aggregate?.f1;
  const latencies = runs
    .map((r) => r.avgLatencyMs)
    .filter((v) => v != null);
  const avgLat =
    latencies.length > 0
      ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
      : null;

  if (el.summaryModels) {
    el.summaryModels.textContent = String(models.size);
  }
  if (el.summaryDatasets) {
    el.summaryDatasets.textContent = String(datasets.size);
  }
  if (el.summaryF1) {
    el.summaryF1.textContent = topF1 != null ? fmtPct(topF1) : "--";
  }
  if (el.summaryLatency) {
    el.summaryLatency.textContent =
      avgLat != null ? avgLat + " ms" : "--";
  }
  el.visibleCount.textContent = `${runs.length} ${runs.length === 1 ? "row" : "rows"}`;
}

function renderTable() {
  const runs = state.filteredRuns;

  if (!runs.length) {
    el.leaderboardBody.innerHTML =
      '<tr><td colspan="13" class="empty-cell">No runs match the current filters.</td></tr>';
    return;
  }

  el.leaderboardBody.innerHTML = runs
    .map((r, i) => {
      const sel = r.runId === state.selectedRunId ? " is-selected" : "";
      const virt = isVirtue(r.modelName) ? " is-virtue" : "";
      const rankCls =
        i < 3 ? ` rank-${i + 1}` : "";

      const typeBadge =
        r.source === "api"
          ? '<span class="type-badge api">API</span>'
          : r.isOpenSource === true
            ? '<span class="type-badge oss">OSS</span>'
            : r.isOpenSource === false
              ? '<span class="type-badge api">Prop</span>'
              : '<span class="metric-muted">--</span>';

      return `
        <tr class="leaderboard-row${sel}${virt}" data-run-id="${esc(r.runId)}">
          <td><span class="rank-pill${rankCls}">#${i + 1}</span></td>
          <td>
            <div class="model-name">${esc(r.modelName)}</div>
          </td>
          <td>${typeBadge}</td>
          <td class="metric">${r.parameters ? esc(r.parameters) : '<span class="metric-muted">--</span>'}</td>
          <td class="metric">${fmtPct(r.aggregate.guardScore)}</td>
          <td class="metric">${fmtPct(r.aggregate.f1)}</td>
          <td class="metric">${fmtPct(r.aggregate.recall)}</td>
          <td class="metric">${fmtPct(r.aggregate.precision)}</td>
          <td class="metric">${fmtPct(r.aggregate.accuracy)}</td>
          <td class="metric">${fmtPct(r.aggregate.fpr)}</td>
          <td class="metric">${r.avgLatencyMs != null ? r.avgLatencyMs + " ms" : '<span class="metric-muted">--</span>'}</td>
          <td class="metric">${r.costPer1mTokens != null ? "$" + r.costPer1mTokens : '<span class="metric-muted">--</span>'}</td>
          <td class="metric-muted">${esc(fmtDate(r.runTimestamp))}</td>
        </tr>`;
    })
    .join("");

  el.leaderboardBody.querySelectorAll(".leaderboard-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedRunId = row.dataset.runId;
      renderTable();
      renderDetail();
    });
  });
}

function renderDetail() {
  const run = state.filteredRuns.find((r) => r.runId === state.selectedRunId);

  if (!run) {
    el.detailTitle.textContent = "Select a run";
    el.detailStatus.textContent = "No run selected";
    el.detailContent.innerHTML =
      '<p class="detail-empty">Choose a row from the leaderboard to inspect per-dataset metrics and run provenance.</p>';
    return;
  }

  el.detailTitle.textContent = run.modelName;
  el.detailStatus.textContent = run.status || "";

  const reportLink = run.reportPath
    ? `<a class="report-link" href="${esc(run.reportPath)}">Open report</a>`
    : "";

  const sortedDatasets = run.datasets.length
    ? [...run.datasets].sort((a, b) => {
        const comp_a = state.datasetComposition[a.name] || "mixed";
        const comp_b = state.datasetComposition[b.name] || "mixed";
        const valFor = (ds, comp) => {
          if (detailDsSortKey === "guardMetric") return (comp === "unsafe_only" ? ds.recall : ds.f1) ?? -1;
          if (detailDsSortKey === "fpr") return ds.fpr ?? Infinity;
          return ds[detailDsSortKey] ?? -1;
        };
        if (detailDsSortKey === "fpr") return valFor(a, comp_a) - valFor(b, comp_b);
        return valFor(b, comp_b) - valFor(a, comp_a);
      })
    : [];

  const sortOptions = [
    { key: "accuracy", label: "Accuracy" },
    { key: "guardMetric", label: "Guard Metric" },
    { key: "recall", label: "Recall" },
    { key: "f1", label: "F1" },
    { key: "precision", label: "Precision" },
    { key: "fpr", label: "FPR" },
  ];
  const sortOptHtml = sortOptions
    .map((o) => `<option value="${o.key}"${detailDsSortKey === o.key ? " selected" : ""}>${o.label}</option>`)
    .join("");

  const dsCards = sortedDatasets.length
    ? sortedDatasets
        .map((ds) => {
          const comp = state.datasetComposition[ds.name] || "mixed";
          const precisionVal = comp === "unsafe_only" ? "NA" : ds.precision;
          const recallVal = comp === "safe_only" ? "NA" : ds.recall;
          const f1Val =
            precisionVal === "NA" || recallVal === "NA" ? "NA" : ds.f1;
          const fprVal = comp === "unsafe_only" ? "NA" : ds.fpr;

          return `
          <article class="dataset-card">
            <h3>${esc(ds.name || "Unnamed")}${comp !== "mixed" ? ' <span class="ds-comp-tag">' + esc(comp === "unsafe_only" ? "unsafe only" : "safe only") + "</span>" : ""}</h3>
            <div class="dataset-metrics">
              ${dsMet("F1", f1Val)}
              ${dsMet("Recall", recallVal)}
              ${dsMet("Precision", precisionVal)}
              ${dsMet("Accuracy", ds.accuracy)}
              ${dsMet("FPR", fprVal)}
            </div>
          </article>`;
        })
        .join("")
    : '<p class="detail-empty">No per-dataset metrics available.</p>';

  el.detailContent.innerHTML = `
    <div class="detail-meta">
      ${metaRow("Run", run.runName)}
      ${metaRow("Provider", run.provider)}
      ${metaRow("Adapter", run.adapter)}
      ${metaRow("Parameters", run.parameters || "-")}
      ${metaRow("Latency", run.avgLatencyMs != null ? run.avgLatencyMs + " ms" : "-")}
      ${metaRow("Throughput", run.outputTokensPerSec != null ? run.outputTokensPerSec + " tok/s" : "-")}
      ${metaRow("Avg Output Tokens", run.avgCompletionTokens != null ? run.avgCompletionTokens : "-")}
      ${metaRow("Cost / 1M tok", run.costPer1mTokens != null ? "$" + run.costPer1mTokens : "-")}
      ${metaRow("Git Ref", run.gitRef)}
      ${metaRow("Tool Version", run.toolVersion)}
      ${metaRow("Updated", fmtDate(run.runTimestamp))}
      ${metaRow("Guard Score", fmtPct(run.aggregate.guardScore))}
      ${metaRow("Agg F1", fmtPct(run.aggregate.f1))}
      ${metaRow("Agg Recall", fmtPct(run.aggregate.recall))}
      ${metaRow("Agg Precision", fmtPct(run.aggregate.precision))}
      ${metaRow("Agg Accuracy", fmtPct(run.aggregate.accuracy))}
      ${metaRow("Agg FPR", fmtPct(run.aggregate.fpr))}
    </div>
    ${reportLink}
    ${sortedDatasets.length ? `<div class="detail-ds-sort-row">
      <label class="ranking-sort-label">Sort datasets by</label>
      <select class="ranking-sort-select" id="detail-ds-sort">${sortOptHtml}</select>
    </div>` : ""}
    <div class="dataset-grid">${dsCards}</div>`;

  attachDetailDsSortHandler();
}

let detailDsSortKey = "accuracy";

function attachDetailDsSortHandler() {
  const sel = document.getElementById("detail-ds-sort");
  if (!sel) return;
  sel.addEventListener("change", () => {
    detailDsSortKey = sel.value;
    renderDetail();
  });
}

function metaRow(label, value) {
  return `<div class="meta-row"><span class="meta-row-label">${esc(label)}</span><span class="meta-row-value">${esc(value)}</span></div>`;
}

function dsMet(label, value) {
  const display = value === "NA" ? "NA" : fmtPct(value);
  const cls = value === "NA" ? "dataset-metric-value metric-na" : "dataset-metric-value";
  return `<div class="dataset-metric"><span class="dataset-metric-label">${esc(label)}</span><span class="${cls}">${display}</span></div>`;
}

/* ─── CHARTS ─── */

function renderCharts() {
  if (!state.dataset) {
    return;
  }
  LeaderboardCharts.createScatter("scatter-chart", state.dataset.runs);
  if (state.modality === "code") {
    LeaderboardCharts.createThroughputScatter("throughput-scatter-chart", state.dataset.runs);
  }
  LeaderboardCharts.createBarCharts(state.dataset.runs);
}

/* ─── MODEL COMPARISON ─── */

const COMPARE_COLORS = ["#64b5f6", "#ce93d8", "#4ade80", "#fbbf24"];
const COMPARE_BG = [
  "rgba(100,181,246,0.15)",
  "rgba(206,147,216,0.15)",
  "rgba(74,222,128,0.15)",
  "rgba(251,191,36,0.15)",
];
const COMPARE_DEFAULTS_BY_MODALITY = {
  text: ["VirtueGuard Text 1B", "GPT-5.4-mini"],
  code: ["VirtueCode", "GPT-5.4"],
};

function setupCompareSelectors() {
  if (!state.dataset) {
    return;
  }

  const uniqueModels = new Map();
  for (const r of state.dataset.runs) {
    const existing = uniqueModels.get(r.modelName);
    if (
      !existing ||
      new Date(r.runTimestamp) > new Date(existing.runTimestamp)
    ) {
      uniqueModels.set(r.modelName, r);
    }
  }

  const sorted = Array.from(uniqueModels.keys()).sort();

  el.compareSelects.forEach((sel, idx) => {
    const prev = sel.value;
    const isOptional = idx >= 2;
    sel.innerHTML = isOptional
      ? '<option value="">-- optional --</option>'
      : '<option value="">Select a model</option>';
    for (const name of sorted) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    const defaults = COMPARE_DEFAULTS_BY_MODALITY[state.modality] || [];
    if (sorted.includes(prev)) {
      sel.value = prev;
    } else if (idx < defaults.length) {
      const def = defaults[idx];
      if (sorted.includes(def)) {
        sel.value = def;
      }
    }
  });

  onCompareChange();
}

function onCompareChange() {
  const names = el.compareSelects.map((s) => s.value).filter(Boolean);
  const unique = [...new Set(names)];

  if (unique.length < 2) {
    el.compareContainer.style.display = "none";
    el.compareEmpty.style.display = "";
    LeaderboardCharts.destroyRadar();
    return;
  }

  const runs = unique.map((n) => latestRunForModel(n)).filter(Boolean);
  if (runs.length < 2) {
    return;
  }

  el.compareContainer.style.display = "";
  el.compareEmpty.style.display = "none";

  LeaderboardCharts.createRadarMulti("radar-chart", runs);
  renderCompareMetrics(runs);
  renderCompareDatasets(runs);
}

function latestRunForModel(modelName) {
  let best = null;
  for (const r of state.dataset.runs) {
    if (r.modelName !== modelName) {
      continue;
    }
    if (!best || new Date(r.runTimestamp) > new Date(best.runTimestamp)) {
      best = r;
    }
  }
  return best;
}

function renderCompareMetrics(runs) {
  const metricDefs = [
    { label: "Guard Score", key: "guardScore", fmt: fmtPct },
    { label: "F1", key: "f1", fmt: fmtPct },
    { label: "Recall", key: "recall", fmt: fmtPct },
    { label: "Precision", key: "precision", fmt: fmtPct },
    { label: "Accuracy", key: "accuracy", fmt: fmtPct },
    { label: "FPR", key: "fpr", fmt: fmtPct },
    { label: "Latency", key: "latency", fmt: (v) => (v != null ? v + " ms" : "--") },
    { label: "Throughput", key: "throughput", fmt: (v) => (v != null ? v + " tok/s" : "--") },
    { label: "Avg Output Tokens", key: "avgCompletionTokens", fmt: (v) => (v != null ? v : "--") },
  ];

  el.compareMetrics.innerHTML = metricDefs
    .map((m) => {
      const values = runs.map((r) =>
        m.key === "latency" ? r.avgLatencyMs :
        m.key === "throughput" ? r.outputTokensPerSec :
        m.key === "avgCompletionTokens" ? r.avgCompletionTokens :
        r.aggregate[m.key]
      );

      const cells = values
        .map(
          (v, i) =>
            `<span class="compare-metric-value" style="color:${COMPARE_COLORS[i]}">${m.fmt(v)}</span>`
        )
        .join("");

      return `
        <div class="compare-metric-row compare-metric-row-multi">
          <span class="compare-metric-label">${esc(m.label)}</span>
          ${cells}
        </div>`;
    })
    .join("");
}

function renderCompareDatasets(runs) {
  const allDs = new Set();
  for (const r of runs) {
    for (const d of r.datasets) {
      allDs.add(d.name);
    }
  }
  const sorted = Array.from(allDs).sort();

  el.compareThead.innerHTML = `<tr><th>Dataset</th>${runs.map((r, i) => `<th style="color:${COMPARE_COLORS[i]}">${esc(r.modelName)}</th>`).join("")}</tr>`;

  el.compareDatasetBody.innerHTML = sorted
    .map((name) => {
      const f1Values = runs.map((r) => {
        const ds = r.datasets.find((d) => d.name === name);
        return ds?.f1 ?? null;
      });

      const bestVal = Math.max(
        ...f1Values.filter((v) => v != null).map(Number)
      );

      const cells = f1Values
        .map((v, i) => {
          const isBest =
            v != null && f1Values.filter((x) => x != null).length > 1 && Math.abs(Number(v) - bestVal) < 0.0001;
          const cls = isBest ? "compare-metric-value compare-best" : "compare-metric-value";
          return `<td class="${cls}" style="color:${COMPARE_COLORS[i]}">${fmtPct(v)}</td>`;
        })
        .join("");

      return `<tr><td>${esc(name)}</td>${cells}</tr>`;
    })
    .join("");
}

/* ─── DATASET RANKING ─── */

function setupDatasetRankingSelector() {
  if (!state.dataset || !el.datasetRankingSelect) return;

  const allDatasets = new Set();
  for (const r of state.dataset.runs) {
    for (const d of r.datasets) {
      allDatasets.add(d.name);
    }
  }

  const sorted = Array.from(allDatasets).sort();
  el.datasetRankingSelect.innerHTML = '<option value="">Select a dataset</option>';
  for (const name of sorted) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    el.datasetRankingSelect.appendChild(opt);
  }
}

let dsRankSortKey = "accuracy";
let dsRankSortAsc = false;

function renderDatasetRanking() {
  const dsName = el.datasetRankingSelect.value;
  if (!dsName || !state.dataset) {
    el.datasetRankingCard.style.display = "none";
    el.datasetRankingEmpty.style.display = "";
    return;
  }

  el.datasetRankingCard.style.display = "";
  el.datasetRankingEmpty.style.display = "none";

  const comp = state.datasetComposition[dsName] || "mixed";
  const guardMetricKey = comp === "unsafe_only" ? "recall" : "f1";
  const guardMetricLabel = comp === "unsafe_only" ? "Recall" : "F1";

  // Gather all models' scores for this dataset
  const entries = [];
  for (const run of state.dataset.runs) {
    const ds = run.datasets.find((d) => d.name === dsName);
    if (!ds) continue;
    entries.push({
      modelName: run.modelName,
      guardMetric: ds[guardMetricKey],
      accuracy: ds.accuracy,
      precision: ds.precision,
      recall: ds.recall,
      f1: ds.f1,
      fpr: ds.fpr,
    });
  }

  if (dsRankSortKey === "fpr") {
    const dir = dsRankSortAsc ? -1 : 1;
    entries.sort((a, b) => {
      const va = a.fpr ?? Infinity;
      const vb = b.fpr ?? Infinity;
      return (va - vb) * dir;
    });
  } else {
    const dir = dsRankSortAsc ? -1 : 1;
    entries.sort((a, b) => {
      const va = a[dsRankSortKey] ?? -1;
      const vb = b[dsRankSortKey] ?? -1;
      return (vb - va) * dir;
    });
  }

  const tag = comp !== "mixed"
    ? ` <span class="ds-comp-tag">${comp === "unsafe_only" ? "unsafe only" : "safe only"}</span>`
    : "";

  const columns = [
    { key: "accuracy", label: "Accuracy" },
    { key: "guardMetric", label: guardMetricLabel },
    { key: "recall", label: "Recall" },
    { key: "precision", label: "Precision" },
    ...(comp !== "unsafe_only" ? [{ key: "fpr", label: "FPR" }] : []),
  ];

  const thCells = columns
    .map((c) => {
      const active = dsRankSortKey === c.key;
      const arrow = active ? (dsRankSortAsc ? " \u25B2" : " \u25BC") : "";
      return `<th class="ds-rank-sortable${active ? " ds-rank-sort-active" : ""}" data-sort-key="${c.key}">${esc(c.label)}${arrow}</th>`;
    })
    .join("");

  const rows = entries
    .map((e, i) => {
      const accPct = e.accuracy != null ? (e.accuracy * 100).toFixed(1) : "NA";
      const gmPct = e.guardMetric != null ? (e.guardMetric * 100).toFixed(1) : "NA";
      const recPct = e.recall != null ? (e.recall * 100).toFixed(1) : "NA";
      const precPct = e.precision != null ? (e.precision * 100).toFixed(1) : "NA";
      const fprPct = e.fpr != null ? (e.fpr * 100).toFixed(1) : "NA";
      const barW = e.accuracy != null ? (e.accuracy * 100).toFixed(1) : 0;
      const isTop = i < 3;

      return `
        <tr class="ds-rank-row${isTop ? " ds-rank-top" : ""}">
          <td class="ds-rank-pos">#${i + 1}</td>
          <td class="ds-rank-model">${esc(e.modelName)}</td>
          <td class="ds-rank-val">${accPct}%</td>
          <td class="ds-rank-val">${gmPct}%</td>
          <td class="ds-rank-val">${recPct}%</td>
          <td class="ds-rank-val">${precPct}%</td>
          ${comp !== "unsafe_only" ? `<td class="ds-rank-val">${fprPct}%</td>` : ""}
          <td class="ds-rank-bar-cell"><div class="ds-rank-bar-bg"><div class="ds-rank-bar-fill" style="width:${barW}%"></div></div></td>
        </tr>`;
    })
    .join("");

  el.datasetRankingContent.innerHTML = `
    <h3 class="chart-title">${esc(dsName)}${tag}</h3>
    <div class="ds-rank-table-wrap">
      <table class="ds-rank-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Model</th>
            ${thCells}
            <th class="ds-rank-sortable${dsRankSortKey === "accuracy" ? " ds-rank-sort-active" : ""}" data-sort-key="accuracy">Overall</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // Attach sort click handlers
  el.datasetRankingContent.querySelectorAll(".ds-rank-sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortKey;
      if (dsRankSortKey === key) {
        dsRankSortAsc = !dsRankSortAsc;
      } else {
        dsRankSortKey = key;
        dsRankSortAsc = false;
      }
      renderDatasetRanking();
    });
  });
}

/* ─── SCROLL REVEAL ─── */

function initReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.08 }
  );

  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
}

/* ─── EVENTS ─── */

function bindControls() {
  // Export PDF
  document.getElementById("export-pdf-btn")?.addEventListener("click", () => {
    PdfExport.showExportDialog(state);
  });

  // Modality tabs
  document.querySelectorAll(".modality-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const modality = tab.dataset.modality;
      if (modality === state.modality) return;
      state.modality = modality;
      document.querySelectorAll(".modality-tab").forEach((t) =>
        t.classList.toggle("is-active", t.dataset.modality === modality)
      );
      switchModality();
    });
  });

  // Scatter toggle: Latency <-> Throughput
  document.getElementById("scatter-toggle")?.addEventListener("change", (e) => {
    const showThroughput = e.target.checked;
    const latCanvas = document.getElementById("scatter-chart");
    const tpCanvas = document.getElementById("throughput-scatter-chart");
    const titleMetric = document.getElementById("scatter-title-metric");
    const subtitle = document.getElementById("scatter-subtitle");
    const labelLat = document.getElementById("switch-label-latency");
    const labelTp = document.getElementById("switch-label-throughput");

    latCanvas.style.display = showThroughput ? "none" : "";
    tpCanvas.style.display = showThroughput ? "" : "none";
    titleMetric.textContent = showThroughput ? "Throughput" : "Latency";
    subtitle.textContent = showThroughput
      ? "Top-right is best: high Guard Score, high output tok/s."
      : "Top-left is best: high Guard Score, low latency.";
    labelLat.classList.toggle("switch-label--active", !showThroughput);
    labelTp.classList.toggle("switch-label--active", showThroughput);
  });

  el.searchInput.addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    updateFilters();
  });
  el.sortSelect.addEventListener("change", (e) => {
    state.sortKey = e.target.value;
    updateFilters();
  });
  el.providerSelect.addEventListener("change", (e) => {
    state.provider = e.target.value;
    updateFilters();
  });
  el.typeSelect.addEventListener("change", (e) => {
    state.modelType = e.target.value;
    updateFilters();
  });
  if (el.packSelect) {
    el.packSelect.addEventListener("change", (e) => {
      state.pack = e.target.value;
      updateFilters();
    });
  }
  if (el.latestOnly) {
    el.latestOnly.addEventListener("change", (e) => {
      state.latestOnly = e.target.checked;
      updateFilters();
    });
  }
  if (el.uploadJson) {
    el.uploadJson.addEventListener("change", handleUpload);
  }
  if (el.resetSource) {
    el.resetSource.addEventListener("click", resetToCommitted);
  }
  el.compareSelects.forEach((s) =>
    s.addEventListener("change", onCompareChange)
  );
  if (el.datasetRankingSelect) {
    el.datasetRankingSelect.addEventListener("change", renderDatasetRanking);
  }
}

async function handleUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    setDataset(payload, "Upload: " + file.name, state.modelsMeta);
  } catch (err) {
    window.alert("Could not load the selected JSON file.");
    console.error(err);
  } finally {
    event.target.value = "";
  }
}

async function resetToCommitted() {
  try {
    const [payload, meta] = await Promise.all([
      loadCommittedData(),
      loadModelsMeta(),
    ]);
    setDataset(payload, "Committed data", meta);
  } catch (err) {
    window.alert("Could not reload committed data.");
    console.error(err);
  }
}

/* ─── MODALITY SWITCH ─── */

async function switchModality() {
  try {
    // Reset scatter toggle to latency view
    const latCanvas = document.getElementById("scatter-chart");
    const tpCanvas = document.getElementById("throughput-scatter-chart");
    const toggleWrap = document.getElementById("scatter-toggle-wrap");
    const toggleInput = document.getElementById("scatter-toggle");
    const titleMetric = document.getElementById("scatter-title-metric");
    const subtitle = document.getElementById("scatter-subtitle");
    const labelLat = document.getElementById("switch-label-latency");
    const labelTp = document.getElementById("switch-label-throughput");
    if (latCanvas) latCanvas.style.display = "";
    if (tpCanvas) tpCanvas.style.display = "none";
    if (toggleWrap) toggleWrap.style.display = "none";
    if (toggleInput) toggleInput.checked = false;
    if (titleMetric) titleMetric.textContent = "Latency";
    if (subtitle) subtitle.textContent = "Top-left is best: high Guard Score, low latency.";
    if (labelLat) labelLat.classList.add("switch-label--active");
    if (labelTp) labelTp.classList.remove("switch-label--active");

    const [payload, meta] = await Promise.all([
      loadCommittedData(),
      loadModelsMeta(),
    ]);
    state.selectedRunId = null;
    state.sortKey = state.modality === "code" ? "guardScore" : "f1";
    if (el.sortSelect) el.sortSelect.value = state.sortKey;
    el.compareSelects.forEach((s) => { s.value = ""; });
    setDataset(payload, "Committed data", meta);
  } catch (err) {
    console.error(err);
    el.sourceBadge.textContent = "Data unavailable";
    el.leaderboardBody.innerHTML =
      '<tr><td colspan="13" class="empty-cell">Could not load leaderboard data for this modality.</td></tr>';
  }
}

/* ─── INIT ─── */

async function init() {
  bindControls();
  initReveal();
  if (el.sortSelect) el.sortSelect.value = state.sortKey;

  try {
    const [payload, meta] = await Promise.all([
      loadCommittedData(),
      loadModelsMeta(),
    ]);
    setDataset(payload, "Committed data", meta);
  } catch (err) {
    console.error(err);
    el.sourceBadge.textContent = "Data unavailable";
    el.generatedAt.textContent = "Check data/leaderboard.json";
    el.leaderboardBody.innerHTML =
      '<tr><td colspan="13" class="empty-cell">Could not load leaderboard data. Upload a local JSON file to preview.</td></tr>';
  }
}

init();
