"use strict";

/**
 * PDF Export module for the Guard Benchmark Leaderboard.
 *
 * Uses jsPDF + jspdf-autotable to generate a multi-page PDF
 * containing the leaderboard table and chart snapshots.
 * Shows an interactive modal for selecting models, datasets, and sections.
 */

/* eslint-disable no-unused-vars */
const PdfExport = (() => {
  const BRAND_BLUE = [22, 33, 246];
  const PAGE_MARGIN = 15;

  /* ═══════════════════════════════════════
     MODAL
     ═══════════════════════════════════════ */

  function openModal(state) {
    const overlay = document.getElementById("pdf-modal");
    const modelList = document.getElementById("pdf-model-list");
    const datasetList = document.getElementById("pdf-dataset-list");
    const modelSearch = document.getElementById("pdf-model-search");

    // Populate model checkboxes
    const models = state.filteredRuns.map((r) => r.modelName);
    modelList.innerHTML = models
      .map(
        (name) =>
          `<label data-name="${name.toLowerCase()}"><input type="checkbox" value="${name}" checked> ${name}</label>`
      )
      .join("");

    // Populate dataset checkboxes
    const dsSet = new Set();
    for (const r of state.filteredRuns) {
      for (const d of r.datasets) dsSet.add(d.name);
    }
    const datasetNames = [...dsSet].sort();
    datasetList.innerHTML = datasetNames
      .map(
        (name) =>
          `<label><input type="checkbox" value="${name}" checked> ${name}</label>`
      )
      .join("");

    // Reset search
    modelSearch.value = "";

    // Reset section checkboxes
    document.getElementById("pdf-inc-table").checked = true;
    document.getElementById("pdf-inc-scatter").checked = true;
    document.getElementById("pdf-inc-bars").checked = true;
    document.getElementById("pdf-inc-radar").checked = true;

    // Show scatter type radios only for code modality
    const scatterTypeWrap = document.getElementById("pdf-scatter-type-wrap");
    if (scatterTypeWrap) {
      scatterTypeWrap.style.display = state.modality === "code" ? "" : "none";
    }
    // Reset to latency
    const latRadio = document.querySelector('input[name="pdf-scatter-type"][value="latency"]');
    if (latRadio) latRadio.checked = true;

    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";

    // Return a promise that resolves with selections or null on cancel
    return new Promise((resolve) => {
      function cleanup() {
        overlay.style.display = "none";
        document.body.style.overflow = "";
        cancelBtn.removeEventListener("click", onCancel);
        closeBtn.removeEventListener("click", onCancel);
        overlay.removeEventListener("click", onOverlayClick);
        exportBtn.removeEventListener("click", onExport);
        modelsAllBtn.removeEventListener("click", onModelsAll);
        modelsNoneBtn.removeEventListener("click", onModelsNone);
        datasetsAllBtn.removeEventListener("click", onDatasetsAll);
        datasetsNoneBtn.removeEventListener("click", onDatasetsNone);
        modelSearch.removeEventListener("input", onModelSearch);
      }

      function onCancel() {
        cleanup();
        resolve(null);
      }

      function onOverlayClick(e) {
        if (e.target === overlay) onCancel();
      }

      function onExport() {
        const selectedModels = new Set(
          [...modelList.querySelectorAll("input:checked")].map((cb) => cb.value)
        );
        const selectedDatasets = new Set(
          [...datasetList.querySelectorAll("input:checked")].map((cb) => cb.value)
        );
        const scatterType = document.querySelector('input[name="pdf-scatter-type"]:checked')?.value || "latency";
        const sections = {
          table: document.getElementById("pdf-inc-table").checked,
          scatter: document.getElementById("pdf-inc-scatter").checked,
          scatterType,
          bars: document.getElementById("pdf-inc-bars").checked,
          radar: document.getElementById("pdf-inc-radar").checked,
        };
        cleanup();
        resolve({ selectedModels, selectedDatasets, sections });
      }

      function toggleAll(container, checked) {
        container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
          cb.checked = checked;
        });
      }

      function onModelsAll(e) { e.preventDefault(); toggleAll(modelList, true); }
      function onModelsNone(e) { e.preventDefault(); toggleAll(modelList, false); }
      function onDatasetsAll(e) { e.preventDefault(); toggleAll(datasetList, true); }
      function onDatasetsNone(e) { e.preventDefault(); toggleAll(datasetList, false); }

      function onModelSearch() {
        const q = modelSearch.value.toLowerCase();
        modelList.querySelectorAll("label").forEach((lbl) => {
          lbl.style.display = lbl.dataset.name.includes(q) ? "" : "none";
        });
      }

      const cancelBtn = document.getElementById("pdf-modal-cancel");
      const closeBtn = document.getElementById("pdf-modal-close");
      const exportBtn = document.getElementById("pdf-modal-export");
      const modelsAllBtn = document.getElementById("pdf-models-all");
      const modelsNoneBtn = document.getElementById("pdf-models-none");
      const datasetsAllBtn = document.getElementById("pdf-datasets-all");
      const datasetsNoneBtn = document.getElementById("pdf-datasets-none");

      cancelBtn.addEventListener("click", onCancel);
      closeBtn.addEventListener("click", onCancel);
      overlay.addEventListener("click", onOverlayClick);
      exportBtn.addEventListener("click", onExport);
      modelsAllBtn.addEventListener("click", onModelsAll);
      modelsNoneBtn.addEventListener("click", onModelsNone);
      datasetsAllBtn.addEventListener("click", onDatasetsAll);
      datasetsNoneBtn.addEventListener("click", onDatasetsNone);
      modelSearch.addEventListener("input", onModelSearch);
    });
  }

  /* ═══════════════════════════════════════
     IMAGE HELPERS
     ═══════════════════════════════════════ */

  function chartToImage(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || canvas.width === 0) return null;

    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const ctx = tmp.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(canvas, 0, 0);
    return {
      data: tmp.toDataURL("image/png", 1.0),
      w: canvas.width,
      h: canvas.height,
    };
  }

  function chartToImageResized(chartInstance, canvasId, targetW, targetH) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !chartInstance) return null;

    const parent = canvas.parentElement;
    const origPW = parent.style.width;
    const origPH = parent.style.height;

    parent.style.width = targetW + "px";
    parent.style.height = targetH + "px";
    chartInstance.resize(targetW, targetH);

    const tmp = document.createElement("canvas");
    tmp.width = targetW;
    tmp.height = targetH;
    const ctx = tmp.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(canvas, 0, 0, targetW, targetH);
    const result = {
      data: tmp.toDataURL("image/png", 1.0),
      w: targetW,
      h: targetH,
    };

    parent.style.width = origPW;
    parent.style.height = origPH;
    chartInstance.resize();

    return result;
  }

  function fitAspect(srcW, srcH, maxW, maxH) {
    const ratio = srcW / srcH;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { w, h };
  }

  function withPrintTheme(chartInstance, fn) {
    if (!chartInstance) return fn();

    const origScales = JSON.parse(JSON.stringify(chartInstance.options.scales || {}));
    const origLegend = JSON.parse(
      JSON.stringify(chartInstance.options.plugins?.legend?.labels || {})
    );

    for (const scale of Object.values(chartInstance.options.scales || {})) {
      if (scale.ticks) scale.ticks.color = "#222222";
      if (scale.title) scale.title.color = "#222222";
      if (scale.grid) scale.grid.color = "rgba(0,0,0,0.15)";
      if (scale.border) scale.border.color = "#999999";
      if (scale.pointLabels) scale.pointLabels.color = "#222222";
    }
    if (chartInstance.options.plugins?.legend?.labels) {
      chartInstance.options.plugins.legend.labels.color = "#222222";
    }

    chartInstance.update("none");
    const result = fn();

    chartInstance.options.scales = origScales;
    if (chartInstance.options.plugins?.legend?.labels) {
      Object.assign(chartInstance.options.plugins.legend.labels, origLegend);
    }
    chartInstance.update("none");

    return result;
  }

  /* ═══════════════════════════════════════
     PDF LAYOUT HELPERS
     ═══════════════════════════════════════ */

  function addHeader(doc, title) {
    doc.setFontSize(18);
    doc.setTextColor(...BRAND_BLUE);
    doc.text("Virtue AI", PAGE_MARGIN, PAGE_MARGIN + 5);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text("Guard Benchmark Leaderboard", PAGE_MARGIN + 42, PAGE_MARGIN + 5);

    if (title) {
      doc.setFontSize(13);
      doc.setTextColor(51, 51, 51);
      doc.text(title, PAGE_MARGIN, PAGE_MARGIN + 14);
    }

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(
      PAGE_MARGIN,
      PAGE_MARGIN + 18,
      doc.internal.pageSize.getWidth() - PAGE_MARGIN,
      PAGE_MARGIN + 18
    );
  }

  function addPageNumbers(doc) {
    const total = doc.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      const w = doc.internal.pageSize.getWidth();
      const h = doc.internal.pageSize.getHeight();
      doc.text(`Page ${i} of ${total}`, w / 2, h - 8, { align: "center" });
    }
  }

  function buildRows(runs) {
    return runs.map((r, i) => {
      const type =
        r.source === "api"
          ? "API"
          : r.isOpenSource === true
            ? "OSS"
            : r.isOpenSource === false
              ? "Prop"
              : "--";

      return [
        `#${i + 1}`,
        r.modelName,
        type,
        r.parameters || "--",
        fmtPct(r.aggregate.guardScore),
        fmtPct(r.aggregate.f1),
        fmtPct(r.aggregate.recall),
        fmtPct(r.aggregate.precision),
        fmtPct(r.aggregate.accuracy),
        fmtPct(r.aggregate.fpr),
        r.avgLatencyMs != null ? r.avgLatencyMs + " ms" : "--",
        r.costPer1mTokens != null ? "$" + r.costPer1mTokens : "--",
        fmtDate(r.runTimestamp),
      ];
    });
  }

  function addChartImage(doc, img, title, startY) {
    addHeader(doc, title);
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const y = startY || PAGE_MARGIN + 25;
    const maxW = pageW - PAGE_MARGIN * 2;
    const maxH = pageH - y - PAGE_MARGIN - 10;

    const fit = fitAspect(img.w, img.h, maxW, maxH);
    const x = PAGE_MARGIN + (maxW - fit.w) / 2;
    doc.addImage(img.data, "PNG", x, y, fit.w, fit.h);
  }

  /* ═══════════════════════════════════════
     GENERATE PDF
     ═══════════════════════════════════════ */

  function generate(state, opts) {
    const { selectedModels, selectedDatasets, sections } = opts;

    // Filter runs by selected models
    const runs = state.filteredRuns.filter((r) => selectedModels.has(r.modelName));
    if (runs.length === 0 && sections.table) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const modality = (state.modality || "text").charAt(0).toUpperCase() + (state.modality || "text").slice(1);
    const dateStr = new Date().toLocaleDateString("en", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let needsFirstPage = true;

    // ── Leaderboard Table ──
    if (sections.table) {
      addHeader(doc, `${modality} Modality \u2014 ${dateStr}`);
      needsFirstPage = false;

      // Selection summary
      const totalModels = state.filteredRuns.length;
      const allDs = new Set();
      for (const r of state.filteredRuns)
        for (const d of r.datasets) allDs.add(d.name);
      const selInfo = [];
      if (selectedModels.size < totalModels)
        selInfo.push(`${selectedModels.size}/${totalModels} models`);
      if (selectedDatasets.size < allDs.size)
        selInfo.push(`${selectedDatasets.size}/${allDs.size} datasets`);
      if (selInfo.length) {
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text("Selection: " + selInfo.join(" | "), PAGE_MARGIN, PAGE_MARGIN + 24);
      }

      const headers = [
        "Rank", "Model", "Type", "Params", "Guard Score",
        "F1", "Recall", "Precision", "Accuracy", "FPR",
        "Latency", "Cost", "Updated",
      ];
      const rows = buildRows(runs);

      doc.autoTable({
        head: [headers],
        body: rows,
        startY: selInfo.length ? PAGE_MARGIN + 28 : PAGE_MARGIN + 25,
        theme: "grid",
        styles: {
          fontSize: 6.5,
          cellPadding: 1.5,
          textColor: [51, 51, 51],
          lineColor: [200, 200, 200],
          lineWidth: 0.15,
          overflow: "ellipsize",
        },
        headStyles: {
          fillColor: BRAND_BLUE,
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 6.5,
        },
        alternateRowStyles: {
          fillColor: [245, 245, 250],
        },
        columnStyles: {
          0: { cellWidth: 12 },
          1: { cellWidth: 42 },
          2: { cellWidth: 12 },
          12: { cellWidth: 20 },
        },
        showHead: "everyPage",
        didDrawPage: (data) => {
          if (data.pageNumber > 1) {
            addHeader(doc, `${modality} Modality \u2014 Leaderboard (cont.)`);
          }
        },
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index === 1) {
            const val = data.cell.raw || "";
            if (typeof val === "string" && LeaderboardCharts.isVirtueModel(val)) {
              data.cell.styles.fontStyle = "bold";
              data.cell.styles.textColor = BRAND_BLUE;
            }
          }
        },
      });
    }

    // ── Chart pages ──
    const instances = LeaderboardCharts.getChartInstances();
    const origTextSub = LeaderboardCharts.COLORS.textSub;
    const origLavender = LeaderboardCharts.COLORS.lavender;

    // Scatter plot
    if (sections.scatter) {
      const useThroughput = sections.scatterType === "throughput" && instances.throughputScatter;
      const chartInst = useThroughput ? instances.throughputScatter : instances.scatter;
      const chartCanvasId = useThroughput ? "throughput-scatter-chart" : "scatter-chart";
      const chartTitle = useThroughput ? "Guard Score vs Throughput" : "Guard Score vs Latency";

      // Temporarily show the canvas if hidden (throughput may be display:none)
      const chartCanvas = document.getElementById(chartCanvasId);
      const wasHidden = chartCanvas && chartCanvas.style.display === "none";
      if (wasHidden) chartCanvas.style.display = "";

      const scatterImg = withPrintTheme(chartInst, () => {
        LeaderboardCharts.COLORS.textSub = "#555555";
        LeaderboardCharts.COLORS.lavender = "#1621f6";
        if (chartInst) chartInst.update("none");
        return chartToImage(chartCanvasId);
      });
      LeaderboardCharts.COLORS.textSub = origTextSub;
      LeaderboardCharts.COLORS.lavender = origLavender;
      if (chartInst) chartInst.update("none");

      // Restore hidden state
      if (wasHidden && chartCanvas) chartCanvas.style.display = "none";

      if (scatterImg && scatterImg.data) {
        if (!needsFirstPage) doc.addPage(); else needsFirstPage = false;
        addChartImage(doc, scatterImg, chartTitle);
      }
    }

    // Bar charts
    if (sections.bars) {
      const barIds = [
        { id: "f1-bar-chart", inst: instances.f1Bar, label: "F1 Score" },
        { id: "fpr-bar-chart", inst: instances.fprBar, label: "False Positive Rate" },
        { id: "latency-bar-chart", inst: instances.latencyBar, label: "Avg Latency" },
        { id: "params-bar-chart", inst: instances.paramsBar, label: "Parameters" },
      ];

      const barW = 1200;
      const barH = 500;
      const barImages = barIds.map((b) =>
        withPrintTheme(b.inst, () => chartToImageResized(b.inst, b.id, barW, barH))
      );

      const validBars = barImages
        .map((img, idx) => (img ? { img, label: barIds[idx].label } : null))
        .filter(Boolean);

      for (let i = 0; i < validBars.length; i += 2) {
        if (!needsFirstPage) doc.addPage(); else needsFirstPage = false;
        const pageTitle = i === 0 ? "Head-to-Head Comparison" : "Head-to-Head Comparison (cont.)";
        addHeader(doc, pageTitle);

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const startY = PAGE_MARGIN + 25;
        const availH = pageH - startY - PAGE_MARGIN - 10;
        const chartMaxH = (availH - 20) / 2;
        const chartMaxW = pageW - PAGE_MARGIN * 2;

        for (let j = 0; j < 2 && i + j < validBars.length; j++) {
          const { img, label } = validBars[i + j];
          const yBase = startY + j * (chartMaxH + 14);
          const fit = fitAspect(img.w, img.h, chartMaxW, chartMaxH);

          doc.setFontSize(11);
          doc.setTextColor(60, 60, 60);
          doc.text(label, PAGE_MARGIN, yBase + 4);
          doc.addImage(img.data, "PNG", PAGE_MARGIN, yBase + 7, fit.w, fit.h);
        }
      }
    }

    // Radar chart
    if (sections.radar) {
      const compareContainer = document.getElementById("compare-container");
      if (compareContainer && compareContainer.style.display !== "none" && instances.radar) {
        const radarImg = withPrintTheme(instances.radar, () =>
          chartToImage("radar-chart")
        );
        if (radarImg && radarImg.data) {
          if (!needsFirstPage) doc.addPage(); else needsFirstPage = false;
          addChartImage(doc, radarImg, "Model Comparison \u2014 Per-Dataset F1");
        }
      }
    }

    // ── Per-dataset breakdown table (if datasets were filtered) ──
    const allDs = new Set();
    for (const r of state.filteredRuns)
      for (const d of r.datasets) allDs.add(d.name);

    if (selectedDatasets.size < allDs.size && sections.table && runs.length > 0) {
      if (!needsFirstPage) doc.addPage(); else needsFirstPage = false;
      addHeader(doc, "Per-Dataset Breakdown");

      const sortedDs = [...selectedDatasets].sort();

      function getF1(ds) {
        if (!ds) return null;
        return ds.f1;
      }

      // Paginate datasets into groups that fit on a page (~15 columns max)
      const DS_PER_PAGE = 14;
      for (let p = 0; p < sortedDs.length; p += DS_PER_PAGE) {
        const pageDsList = sortedDs.slice(p, p + DS_PER_PAGE);
        if (p > 0) {
          doc.addPage();
          addHeader(doc, "Per-Dataset Breakdown (cont.)");
        }

        const dsHeaders = ["Model", ...pageDsList];
        const dsRows = runs.map((r) => {
          const row = [r.modelName];
          for (const dsName of pageDsList) {
            const ds = r.datasets.find((d) => d.name === dsName);
            row.push(fmtPct(getF1(ds)));
          }
          return row;
        });

        doc.autoTable({
          head: [dsHeaders],
          body: dsRows,
          startY: PAGE_MARGIN + 25,
          theme: "grid",
          styles: {
            fontSize: 5.5,
            cellPadding: 1.5,
            textColor: [51, 51, 51],
            lineColor: [200, 200, 200],
            lineWidth: 0.15,
            overflow: "ellipsize",
          },
          headStyles: {
            fillColor: BRAND_BLUE,
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: 5.5,
          },
          alternateRowStyles: { fillColor: [245, 245, 250] },
          columnStyles: { 0: { cellWidth: 35, fontStyle: "bold" } },
          showHead: "everyPage",
        });
      }

    }

    // ── Finalize ──
    addPageNumbers(doc);

    const isoDate = new Date().toISOString().slice(0, 10);
    doc.save(`virtue-guard-benchmark-${state.modality}-${isoDate}.pdf`);
  }

  /* ═══════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════ */

  async function showExportDialog(state) {
    const opts = await openModal(state);
    if (!opts) return; // cancelled

    if (opts.selectedModels.size === 0) {
      alert("Please select at least one model.");
      return;
    }

    const btn = document.getElementById("pdf-modal-export");
    generate(state, opts);
  }

  return { showExportDialog };
})();
