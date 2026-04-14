"use strict";

/**
 * Chart.js helper module for the Guard Benchmark Leaderboard.
 *
 * Exposes a global LeaderboardCharts object consumed by app.js.
 * All charts share a dark theme matching the Virtue AI design system.
 */

/* eslint-disable no-unused-vars */
const LeaderboardCharts = (() => {
  const COLORS = {
    blue: "#1621f6",
    violet: "#5300f8",
    lavender: "#9f9eff",
    teal: "#007a95",
    white: "#ffffff",
    textBody: "#dddddd",
    textMuted: "#c0c0c0",
    textSub: "#9b9b9b",
    surface: "#131515",
    border: "#2b2c2c",
    grid: "rgba(255,255,255,0.06)",
    modelA: "#64b5f6",
    modelB: "#ce93d8",
  };

  const MODEL_PALETTE = [
    "#1621f6",
    "#5300f8",
    "#00bcd4",
    "#4caf50",
    "#ff9800",
    "#e91e63",
    "#9c27b0",
    "#03a9f4",
    "#8bc34a",
    "#ff5722",
    "#607d8b",
    "#795548",
    "#cddc39",
    "#f44336",
    "#009688",
    "#673ab7",
    "#ffc107",
    "#2196f3",
  ];

  function isVirtueModel(name) {
    const lower = name.toLowerCase();
    return lower.includes("virtue") || lower.includes("virtueguard");
  }

  function colorForModel(name, index) {
    if (isVirtueModel(name)) {
      return COLORS.blue;
    }
    return MODEL_PALETTE[index % MODEL_PALETTE.length];
  }

  function parseParamsBillions(paramStr) {
    if (!paramStr) {
      return null;
    }
    const str = String(paramStr).toUpperCase().trim();
    const matchB = str.match(/^([\d.]+)\s*B$/);
    if (matchB) {
      return parseFloat(matchB[1]);
    }
    const matchM = str.match(/^([\d.]+)\s*M$/);
    if (matchM) {
      return parseFloat(matchM[1]) / 1000;
    }
    const num = parseFloat(str);
    return Number.isNaN(num) ? null : num;
  }

  const darkTooltip = {
    backgroundColor: "rgba(19,21,21,0.95)",
    titleColor: COLORS.white,
    bodyColor: COLORS.textBody,
    borderColor: COLORS.border,
    borderWidth: 1,
    cornerRadius: 6,
    padding: 10,
    titleFont: { family: "Inter, sans-serif", size: 13, weight: "600" },
    bodyFont: { family: "Inter, sans-serif", size: 12 },
    displayColors: true,
    boxPadding: 4,
  };

  let scatterChart = null;
  let f1BarChart = null;
  let fprBarChart = null;
  let latencyBarChart = null;
  let paramsBarChart = null;
  let throughputScatterChart = null;
  let radarChart = null;

  /* ───────── SCATTER: F1 vs Latency ───────── */

  function createScatter(canvasId, runs) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) {
      return;
    }

    if (scatterChart) {
      scatterChart.destroy();
    }

    const pointData = runs
      .filter((r) => r.avgLatencyMs != null && r.aggregate.guardScore != null)
      .map((r, i) => ({
        x: r.avgLatencyMs,
        y: Number(r.aggregate.guardScore) * 100,
        label: r.modelName,
        isVirtue: isVirtueModel(r.modelName),
        bgColor: colorForModel(r.modelName, i),
      }));

    const sortedByVirtue = pointData.sort(
      (a, b) => Number(a.isVirtue) - Number(b.isVirtue)
    );

    // Dynamic x-axis range based on actual data
    const latencies = pointData.map((p) => p.x).filter((x) => x > 0);
    const minLatency = latencies.length ? Math.min(...latencies) : 2;
    // Round down to nearest "nice" log value for breathing room
    const xMin = Math.max(1, Math.pow(10, Math.floor(Math.log10(minLatency * 0.5))));

    scatterChart = new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [
          {
            data: sortedByVirtue.map((p) => ({ x: p.x, y: p.y })),
            backgroundColor: sortedByVirtue.map((p) =>
              p.isVirtue ? COLORS.blue : p.bgColor + "cc"
            ),
            borderColor: sortedByVirtue.map((p) =>
              p.isVirtue ? COLORS.lavender : "transparent"
            ),
            borderWidth: sortedByVirtue.map((p) => (p.isVirtue ? 2 : 0)),
            pointRadius: sortedByVirtue.map((p) => (p.isVirtue ? 10 : 7)),
            pointHoverRadius: sortedByVirtue.map((p) => (p.isVirtue ? 13 : 10)),
            pointStyle: "circle",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        layout: { padding: { top: 50, right: 30, bottom: 10, left: 10 } },
        scales: {
          x: {
            type: "logarithmic",
            title: {
              display: true,
              text: "Avg Latency (ms) -- log scale",
              color: COLORS.textSub,
              font: { family: "Inter", size: 12, weight: "500" },
            },
            ticks: {
              color: COLORS.textSub,
              font: { size: 11 },
              callback: (v) => {
                const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
                return nice.includes(v) ? (v >= 1000 ? (v / 1000) + "s" : v + " ms") : "";
              },
              maxRotation: 0,
            },
            grid: { color: COLORS.grid },
            border: { color: COLORS.border },
            min: xMin,
          },
          y: {
            title: {
              display: true,
              text: "Guard Score (%)",
              color: COLORS.textSub,
              font: { family: "Inter", size: 12, weight: "500" },
            },
            ticks: {
              color: COLORS.textSub,
              font: { size: 11 },
              callback: (v) => v + "%",
            },
            grid: { color: COLORS.grid },
            border: { color: COLORS.border },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...darkTooltip,
            callbacks: {
              title: (items) => {
                const idx = items[0].dataIndex;
                return sortedByVirtue[idx].label;
              },
              label: (item) => {
                return [
                  `Guard Score: ${item.parsed.y.toFixed(1)}%`,
                  `Latency: ${item.parsed.x.toLocaleString()} ms`,
                ];
              },
            },
          },
        },
      },
      plugins: [
        {
          id: "scatterLabels",
          _cache: null,
          _cacheKey: null,

          afterDatasetsDraw(chart) {
            const { ctx: c } = chart;
            const meta = chart.getDatasetMeta(0);
            const area = chart.chartArea;

            // Build a cache key from point pixel positions
            const key = meta.data
              .map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
              .join("|");

            // Only recompute layout when points actually move (resize)
            if (this._cacheKey !== key) {
              this._cache = this._computeLayout(chart, meta, area);
              this._cacheKey = key;
            }

            // Draw from cache
            c.save();
            c.font = '500 11px "Inter", sans-serif';
            for (const lb of this._cache) {
              c.fillStyle = lb.isVirtue ? COLORS.lavender : COLORS.textSub;
              c.textAlign = "center";
              c.textBaseline = "bottom";

              if (lb.connDist > 30) {
                c.beginPath();
                c.strokeStyle = lb.isVirtue
                  ? "rgba(159,158,255,0.25)"
                  : "rgba(155,155,155,0.2)";
                c.lineWidth = 0.75;
                c.moveTo(lb.px, lb.py);
                c.lineTo(lb.x, lb.y);
                c.stroke();
              }
              c.fillText(lb.label, lb.x, lb.y);
            }
            c.restore();
          },

          _computeLayout(chart, meta, area) {
            const c = chart.ctx;
            c.save();
            c.font = '500 11px "Inter", sans-serif';

            const LINE_H = 13;
            const GAP = 3;

            const items = meta.data.map((point, idx) => {
              const entry = sortedByVirtue[idx];
              const tw = c.measureText(entry.label).width;
              return {
                label: entry.label,
                isVirtue: entry.isVirtue,
                px: point.x,
                py: point.y,
                x: point.x,
                y: point.y - 14,
                w: tw,
                h: LINE_H,
                r: entry.isVirtue ? 10 : 7,
                connDist: 0,
              };
            });

            function rect(lb) {
              return {
                x1: lb.x - lb.w / 2 - GAP,
                x2: lb.x + lb.w / 2 + GAP,
                y1: lb.y - lb.h,
                y2: lb.y + GAP,
              };
            }

            function rectsOverlap(r1, r2) {
              return r1.x1 < r2.x2 && r1.x2 > r2.x1 &&
                     r1.y1 < r2.y2 && r1.y2 > r2.y1;
            }

            function hitsPoint(lb) {
              const r = rect(lb);
              for (const it of items) {
                if (it === lb) continue;
                const pr = it.r + 2;
                if (r.x1 < it.px + pr && r.x2 > it.px - pr &&
                    r.y1 < it.py + pr && r.y2 > it.py - pr) {
                  return true;
                }
              }
              return false;
            }

            function hitsPlaced(lb, placed) {
              const r = rect(lb);
              for (const p of placed) {
                if (rectsOverlap(r, rect(p))) return true;
              }
              return false;
            }

            function inBounds(lb) {
              return lb.x - lb.w / 2 >= area.left - 2 &&
                     lb.x + lb.w / 2 <= area.right + 2 &&
                     lb.y - lb.h >= area.top - 2 &&
                     lb.y <= area.bottom + 2;
            }

            items.sort((a, b) => {
              if (a.isVirtue !== b.isVirtue) return a.isVirtue ? -1 : 1;
              return a.py - b.py;
            });

            function candidates(lb) {
              const hw = lb.w / 2 + 14;
              return [
                { x: lb.px,          y: lb.py - 14 },
                { x: lb.px,          y: lb.py + 20 },
                { x: lb.px + hw,     y: lb.py - 6 },
                { x: lb.px - hw,     y: lb.py - 6 },
                { x: lb.px + hw,     y: lb.py - 18 },
                { x: lb.px - hw,     y: lb.py - 18 },
                { x: lb.px + hw,     y: lb.py + 10 },
                { x: lb.px - hw,     y: lb.py + 10 },
                { x: lb.px,          y: lb.py - 30 },
                { x: lb.px,          y: lb.py + 34 },
                { x: lb.px + hw + 20, y: lb.py - 6 },
                { x: lb.px - hw - 20, y: lb.py - 6 },
              ];
            }

            const placed = [];
            for (const lb of items) {
              let best = null;
              let bestDist = Infinity;

              for (const cand of candidates(lb)) {
                lb.x = cand.x;
                lb.y = cand.y;
                if (lb.x - lb.w / 2 < area.left) lb.x = area.left + lb.w / 2 + 2;
                if (lb.x + lb.w / 2 > area.right) lb.x = area.right - lb.w / 2 - 2;
                if (lb.y - lb.h < area.top) lb.y = area.top + lb.h + 2;
                if (lb.y > area.bottom - 2) lb.y = area.bottom - 2;

                if (!hitsPlaced(lb, placed) && !hitsPoint(lb) && inBounds(lb)) {
                  const dist = Math.hypot(lb.x - lb.px, lb.y - lb.py);
                  if (dist < bestDist) {
                    bestDist = dist;
                    best = { x: lb.x, y: lb.y };
                  }
                }
              }

              if (best) {
                lb.x = best.x;
                lb.y = best.y;
              } else {
                lb.x = lb.px;
                lb.y = lb.py - 14;
                for (let i = 0; i < 30; i++) {
                  if (!hitsPlaced(lb, placed)) break;
                  lb.y -= LINE_H;
                }
                if (lb.y - lb.h < area.top) {
                  lb.y = lb.py + 20;
                  for (let i = 0; i < 30; i++) {
                    if (!hitsPlaced(lb, placed)) break;
                    lb.y += LINE_H;
                  }
                }
              }

              lb.connDist = Math.hypot(lb.x - lb.px, lb.y - lb.py);
              placed.push(lb);
            }

            c.restore();
            return placed;
          },
        },
      ],
    });
  }

  /* ───────── SCATTER: Guard Score vs Throughput ───────── */

  function createThroughputScatter(canvasId, runs) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) {
      return;
    }

    if (throughputScatterChart) {
      throughputScatterChart.destroy();
    }

    const pointData = runs
      .filter((r) => r.outputTokensPerSec != null && r.aggregate.guardScore != null)
      .map((r, i) => ({
        x: Number(r.outputTokensPerSec),
        y: Number(r.aggregate.guardScore) * 100,
        label: r.modelName,
        isVirtue: isVirtueModel(r.modelName),
        bgColor: colorForModel(r.modelName, i),
      }));

    if (!pointData.length) {
      return;
    }

    // Show the toggle button since we have throughput data
    const toggleWrap = document.getElementById("scatter-toggle-wrap");
    if (toggleWrap) {
      toggleWrap.style.display = "";
    }

    const sortedByVirtue = pointData.sort(
      (a, b) => Number(a.isVirtue) - Number(b.isVirtue)
    );

    throughputScatterChart = new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [
          {
            data: sortedByVirtue.map((p) => ({ x: p.x, y: p.y })),
            backgroundColor: sortedByVirtue.map((p) =>
              p.isVirtue ? COLORS.blue : p.bgColor + "cc"
            ),
            borderColor: sortedByVirtue.map((p) =>
              p.isVirtue ? COLORS.lavender : "transparent"
            ),
            borderWidth: sortedByVirtue.map((p) => (p.isVirtue ? 2 : 0)),
            pointRadius: sortedByVirtue.map((p) => (p.isVirtue ? 10 : 7)),
            pointHoverRadius: sortedByVirtue.map((p) => (p.isVirtue ? 13 : 10)),
            pointStyle: "circle",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        layout: { padding: { top: 50, right: 30, bottom: 10, left: 10 } },
        scales: {
          x: {
            type: "logarithmic",
            title: {
              display: true,
              text: "Output Throughput (tok/s) -- log scale",
              color: COLORS.textSub,
              font: { family: "Inter", size: 12, weight: "500" },
            },
            ticks: {
              color: COLORS.textSub,
              font: { size: 11 },
              callback: (v) => {
                const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
                return nice.includes(v) ? v + " tok/s" : "";
              },
              maxRotation: 0,
            },
            grid: { color: COLORS.grid },
            border: { color: COLORS.border },
          },
          y: {
            title: {
              display: true,
              text: "Guard Score (%)",
              color: COLORS.textSub,
              font: { family: "Inter", size: 12, weight: "500" },
            },
            ticks: {
              color: COLORS.textSub,
              font: { size: 11 },
              callback: (v) => v + "%",
            },
            grid: { color: COLORS.grid },
            border: { color: COLORS.border },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...darkTooltip,
            callbacks: {
              title: (items) => {
                const idx = items[0].dataIndex;
                return sortedByVirtue[idx].label;
              },
              label: (item) => {
                return [
                  `Guard Score: ${item.parsed.y.toFixed(1)}%`,
                  `Throughput: ${item.parsed.x.toFixed(1)} tok/s`,
                ];
              },
            },
          },
        },
      },
      plugins: [
        {
          id: "throughputScatterLabels",
          _cache: null,
          _cacheKey: null,

          afterDatasetsDraw(chart) {
            const { ctx: c } = chart;
            const meta = chart.getDatasetMeta(0);
            const area = chart.chartArea;

            const key = meta.data
              .map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
              .join("|");

            if (this._cacheKey !== key) {
              this._cache = this._computeLayout(chart, meta, area);
              this._cacheKey = key;
            }

            c.save();
            c.font = '500 11px "Inter", sans-serif';
            for (const lb of this._cache) {
              c.fillStyle = lb.isVirtue ? COLORS.lavender : COLORS.textSub;
              c.textAlign = "center";
              c.textBaseline = "bottom";

              if (lb.connDist > 30) {
                c.beginPath();
                c.strokeStyle = lb.isVirtue
                  ? "rgba(159,158,255,0.25)"
                  : "rgba(155,155,155,0.2)";
                c.lineWidth = 0.75;
                c.moveTo(lb.px, lb.py);
                c.lineTo(lb.x, lb.y);
                c.stroke();
              }
              c.fillText(lb.label, lb.x, lb.y);
            }
            c.restore();
          },

          _computeLayout(chart, meta, area) {
            const c = chart.ctx;
            c.save();
            c.font = '500 11px "Inter", sans-serif';

            const LINE_H = 13;
            const GAP = 3;

            const items = meta.data.map((point, idx) => {
              const entry = sortedByVirtue[idx];
              const tw = c.measureText(entry.label).width;
              return {
                label: entry.label,
                isVirtue: entry.isVirtue,
                px: point.x,
                py: point.y,
                x: point.x,
                y: point.y - 14,
                w: tw,
                h: LINE_H,
                r: entry.isVirtue ? 10 : 7,
                connDist: 0,
              };
            });

            function rect(lb) {
              return {
                x1: lb.x - lb.w / 2 - GAP,
                x2: lb.x + lb.w / 2 + GAP,
                y1: lb.y - lb.h,
                y2: lb.y + GAP,
              };
            }

            function rectsOverlap(r1, r2) {
              return r1.x1 < r2.x2 && r1.x2 > r2.x1 &&
                     r1.y1 < r2.y2 && r1.y2 > r2.y1;
            }

            function hitsPoint(lb) {
              const r = rect(lb);
              for (const it of items) {
                if (it === lb) continue;
                const pr = it.r + 2;
                if (r.x1 < it.px + pr && r.x2 > it.px - pr &&
                    r.y1 < it.py + pr && r.y2 > it.py - pr) {
                  return true;
                }
              }
              return false;
            }

            function hitsPlaced(lb, placed) {
              const r = rect(lb);
              for (const p of placed) {
                if (rectsOverlap(r, rect(p))) return true;
              }
              return false;
            }

            function inBounds(lb) {
              return lb.x - lb.w / 2 >= area.left - 2 &&
                     lb.x + lb.w / 2 <= area.right + 2 &&
                     lb.y - lb.h >= area.top - 2 &&
                     lb.y <= area.bottom + 2;
            }

            items.sort((a, b) => {
              if (a.isVirtue !== b.isVirtue) return a.isVirtue ? -1 : 1;
              return a.py - b.py;
            });

            function candidates(lb) {
              const hw = lb.w / 2 + 14;
              return [
                { x: lb.px,          y: lb.py - 14 },
                { x: lb.px,          y: lb.py + 20 },
                { x: lb.px + hw,     y: lb.py - 6 },
                { x: lb.px - hw,     y: lb.py - 6 },
                { x: lb.px + hw,     y: lb.py - 18 },
                { x: lb.px - hw,     y: lb.py - 18 },
                { x: lb.px + hw,     y: lb.py + 10 },
                { x: lb.px - hw,     y: lb.py + 10 },
                { x: lb.px,          y: lb.py - 30 },
                { x: lb.px,          y: lb.py + 34 },
                { x: lb.px + hw + 20, y: lb.py - 6 },
                { x: lb.px - hw - 20, y: lb.py - 6 },
              ];
            }

            const placed = [];
            for (const lb of items) {
              let best = null;
              let bestDist = Infinity;

              for (const cand of candidates(lb)) {
                lb.x = cand.x;
                lb.y = cand.y;
                if (lb.x - lb.w / 2 < area.left) lb.x = area.left + lb.w / 2 + 2;
                if (lb.x + lb.w / 2 > area.right) lb.x = area.right - lb.w / 2 - 2;
                if (lb.y - lb.h < area.top) lb.y = area.top + lb.h + 2;
                if (lb.y > area.bottom - 2) lb.y = area.bottom - 2;

                if (!hitsPlaced(lb, placed) && !hitsPoint(lb) && inBounds(lb)) {
                  const dist = Math.hypot(lb.x - lb.px, lb.y - lb.py);
                  if (dist < bestDist) {
                    bestDist = dist;
                    best = { x: lb.x, y: lb.y };
                  }
                }
              }

              if (best) {
                lb.x = best.x;
                lb.y = best.y;
              } else {
                lb.x = lb.px;
                lb.y = lb.py - 14;
                for (let i = 0; i < 30; i++) {
                  if (!hitsPlaced(lb, placed)) break;
                  lb.y -= LINE_H;
                }
                if (lb.y - lb.h < area.top) {
                  lb.y = lb.py + 20;
                  for (let i = 0; i < 30; i++) {
                    if (!hitsPlaced(lb, placed)) break;
                    lb.y += LINE_H;
                  }
                }
              }

              lb.connDist = Math.hypot(lb.x - lb.px, lb.y - lb.py);
              placed.push(lb);
            }

            c.restore();
            return placed;
          },
        },
      ],
    });
  }

  /* ───────── BAR CHARTS ───────── */

  function buildHorizontalBar(canvasId, labels, values, colorFn, formatFn) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) {
      return null;
    }

    return new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: labels.map((l, i) => colorFn(l, i)),
            borderRadius: 4,
            barThickness: 22,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", axis: "y", intersect: false },
        layout: { padding: { right: 8 } },
        scales: {
          x: {
            ticks: {
              color: COLORS.textSub,
              font: { size: 10 },
              callback: formatFn || ((v) => v),
            },
            grid: { color: COLORS.grid },
            border: { color: COLORS.border },
          },
          y: {
            ticks: {
              color: COLORS.textBody,
              font: { family: "Inter", size: 11, weight: "500" },
            },
            grid: { display: false },
            border: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...darkTooltip,
            callbacks: {
              label: (item) => {
                const fmt = formatFn || ((v) => v);
                return ` ${fmt(item.parsed.x)}`;
              },
            },
          },
        },
      },
    });
  }

  function createBarCharts(runs) {
    if (f1BarChart) {
      f1BarChart.destroy();
    }
    if (fprBarChart) {
      fprBarChart.destroy();
    }
    if (latencyBarChart) {
      latencyBarChart.destroy();
    }
    if (paramsBarChart) {
      paramsBarChart.destroy();
    }

    const uniqueRuns = dedupeByModel(runs);

    const f1Sorted = [...uniqueRuns]
      .filter((r) => r.aggregate.f1 != null)
      .sort((a, b) => Number(b.aggregate.f1) - Number(a.aggregate.f1));

    f1BarChart = buildHorizontalBar(
      "f1-bar-chart",
      f1Sorted.map((r) => truncName(r.modelName)),
      f1Sorted.map((r) => +(Number(r.aggregate.f1) * 100).toFixed(1)),
      (label) => barColor(label),
      (v) => v.toFixed(1) + "%"
    );

    const fprSorted = [...uniqueRuns]
      .filter((r) => r.aggregate.fpr != null)
      .sort((a, b) => Number(a.aggregate.fpr) - Number(b.aggregate.fpr));

    fprBarChart = buildHorizontalBar(
      "fpr-bar-chart",
      fprSorted.map((r) => truncName(r.modelName)),
      fprSorted.map((r) => +(Number(r.aggregate.fpr) * 100).toFixed(1)),
      (label) => barColor(label),
      (v) => v.toFixed(1) + "%"
    );

    const latSorted = [...uniqueRuns]
      .filter((r) => r.avgLatencyMs != null)
      .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);

    latencyBarChart = buildHorizontalBar(
      "latency-bar-chart",
      latSorted.map((r) => truncName(r.modelName)),
      latSorted.map((r) => r.avgLatencyMs),
      (label) => barColor(label),
      (v) => v + " ms"
    );

    const paramsSorted = [...uniqueRuns]
      .filter((r) => r.parameters != null)
      .map((r) => ({
        name: truncName(r.modelName),
        val: parseParamsBillions(r.parameters),
        raw: r.parameters,
        fullName: r.modelName,
      }))
      .filter((r) => r.val != null)
      .sort((a, b) => b.val - a.val);

    paramsBarChart = buildHorizontalBar(
      "params-bar-chart",
      paramsSorted.map((r) => r.name),
      paramsSorted.map((r) => r.val),
      (label) => barColor(label),
      (v) => (v >= 1 ? v.toFixed(1) + "B" : (v * 1000).toFixed(0) + "M")
    );
  }

  function barColor(truncatedName) {
    const lower = truncatedName.toLowerCase();
    if (lower.includes("virtue")) {
      return COLORS.blue;
    }
    return COLORS.lavender + "99";
  }

  function dedupeByModel(runs) {
    const map = new Map();
    for (const r of runs) {
      const existing = map.get(r.modelName);
      if (
        !existing ||
        new Date(r.runTimestamp) > new Date(existing.runTimestamp)
      ) {
        map.set(r.modelName, r);
      }
    }
    return Array.from(map.values());
  }

  function truncName(name) {
    return name.length > 24 ? name.slice(0, 22) + "..." : name;
  }

  /* ───────── RADAR: Per-Dataset Comparison ───────── */

  const MULTI_COLORS = ["#64b5f6", "#ce93d8", "#4ade80", "#fbbf24"];
  const MULTI_BG = [
    "rgba(100,181,246,0.15)",
    "rgba(206,147,216,0.15)",
    "rgba(74,222,128,0.15)",
    "rgba(251,191,36,0.15)",
  ];

  function createRadarMulti(canvasId, runs) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) {
      return;
    }

    if (radarChart) {
      radarChart.destroy();
    }

    const allDatasets = new Set();
    for (const r of runs) {
      for (const d of r.datasets) {
        allDatasets.add(d.name);
      }
    }
    // Exclude datasets where any selected model has null f1 (unsafe-only)
    const labels = Array.from(allDatasets)
      .filter((name) =>
        runs.every((r) => {
          const ds = r.datasets.find((d) => d.name === name);
          return ds && ds.f1 != null;
        })
      )
      .sort();

    function getF1(run, datasetName) {
      const ds = run.datasets.find((d) => d.name === datasetName);
      return ds && ds.f1 != null ? +(Number(ds.f1) * 100).toFixed(1) : 0;
    }

    radarChart = new Chart(ctx, {
      type: "radar",
      data: {
        labels: labels.map((l) =>
          l.length > 18 ? l.slice(0, 16) + "..." : l
        ),
        datasets: runs.map((run, i) => ({
          label: run.modelName,
          data: labels.map((l) => getF1(run, l)),
          backgroundColor: MULTI_BG[i % MULTI_BG.length],
          borderColor: MULTI_COLORS[i % MULTI_COLORS.length],
          borderWidth: 2,
          pointBackgroundColor: MULTI_COLORS[i % MULTI_COLORS.length],
          pointBorderColor: MULTI_COLORS[i % MULTI_COLORS.length],
          pointRadius: 4,
          pointHoverRadius: 6,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: {
              stepSize: 20,
              color: COLORS.textSub,
              font: { size: 10 },
              backdropColor: "transparent",
              callback: (v) => v + "%",
            },
            grid: { color: COLORS.grid },
            angleLines: { color: COLORS.grid },
            pointLabels: {
              color: COLORS.textBody,
              font: { family: "Inter", size: 10, weight: "500" },
            },
          },
        },
        plugins: {
          legend: {
            labels: {
              color: COLORS.textBody,
              font: { family: "Inter", size: 12 },
              boxWidth: 12,
              boxHeight: 12,
              borderRadius: 2,
              useBorderRadius: true,
              padding: 16,
            },
          },
          tooltip: {
            ...darkTooltip,
            callbacks: {
              label: (item) =>
                ` ${item.dataset.label}: ${item.parsed.r.toFixed(1)}%`,
            },
          },
        },
      },
    });
  }

  function destroyRadar() {
    if (radarChart) {
      radarChart.destroy();
      radarChart = null;
    }
  }

  /* ───────── PUBLIC API ───────── */

  return {
    createScatter,
    createThroughputScatter,
    createBarCharts,
    createRadarMulti,
    destroyRadar,
    parseParamsBillions,
    isVirtueModel,
    COLORS,
    getChartInstances: () => ({
      scatter: scatterChart,
      f1Bar: f1BarChart,
      fprBar: fprBarChart,
      latencyBar: latencyBarChart,
      paramsBar: paramsBarChart,
      throughputScatter: throughputScatterChart,
      radar: radarChart,
    }),
  };
})();
