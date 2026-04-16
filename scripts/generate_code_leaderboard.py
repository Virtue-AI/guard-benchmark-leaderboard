#!/usr/bin/env python3
"""
Scrape code vulnerability eval run artifacts and generate data/leaderboard-code.json.

Scans the code-vuln output directory for metrics.json files, extracts
code_vuln-specific metrics (CWE-aware F1), and outputs a leaderboard
JSON matching the text/image leaderboard schema.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

# ── Configuration ──

SCAN_DIR = "/scratch/siavash/guard-eval-harness/examples/code-vuln/16k-run/out/code-vuln"

OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "leaderboard-code.json"
)

# Map model directory names → (model_name, provider, adapter)
MODEL_MAP = {
    "gpt-4o": ("GPT-4o", "OpenAI", "openai_compatible"),
    "gpt-5.4": ("GPT-5.4 (non-thinking)", "OpenAI", "openai_compatible"),
    "gpt-5.4-high": ("GPT-5.4 (high)", "OpenAI", "openai_compatible"),
    "claude-haiku-4.5": ("Claude Haiku 4.5", "Anthropic", "anthropic"),
    "claude-opus-4.6": ("Claude Opus 4.6", "Anthropic", "anthropic"),
    "deepseek-v3": ("DeepSeek-V3", "DeepSeek", "openai_compatible"),
    "deepseek-r1-distill-qwen-7b": (
        "DeepSeek-R1-Distill-Qwen-7B",
        "DeepSeek",
        "vllm",
    ),
    "qwq-32b": ("QwQ-32B", "Alibaba", "vllm"),
    "virtuecode": ("VirtueGuard-Code", "Virtue AI", "vllm"),
}

# Map internal dataset directory name → display name
DATASET_MAP = {
    "vulnllm_r_function_level_c": "VulnLLM-R Function Level (C)",
    "vulnllm_r_function_level_python": "VulnLLM-R Function Level (Python)",
    "vulnllm_r_function_level_java": "VulnLLM-R Function Level (Java)",
    "vulnllm_r_repo_level": "VulnLLM-R Repo Level (C)",
}


def scan_metrics() -> list[dict]:
    """Walk the code-vuln output directory and collect all metrics entries."""
    entries = []

    if not os.path.isdir(SCAN_DIR):
        return entries

    for model_dir_name in os.listdir(SCAN_DIR):
        if model_dir_name not in MODEL_MAP:
            continue

        model_path = Path(SCAN_DIR) / model_dir_name
        for metrics_path in model_path.rglob("datasets/*/metrics.json"):
            parts = metrics_path.relative_to(model_path).parts
            ds_idx = parts.index("datasets")
            internal_ds = parts[ds_idx + 1]
            if internal_ds not in DATASET_MAP:
                continue

            try:
                with open(metrics_path) as f:
                    metrics = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue

            code_vuln = metrics.get("code_vuln", {})
            if not code_vuln:
                continue

            entries.append(
                {
                    "model_dir": model_dir_name,
                    "internal_ds": internal_ds,
                    "count": code_vuln.get("count", 0),
                    "accuracy": code_vuln.get("accuracy"),
                    "precision": code_vuln.get("pos_Precision"),
                    "recall": code_vuln.get("pos_Recall"),
                    "f1": code_vuln.get("overall F1"),
                    "tp": code_vuln.get("tp", 0),
                    "fp": code_vuln.get("fp", 0),
                    "fn": code_vuln.get("fn", 0),
                    "tn": code_vuln.get("tn", 0),
                    "fpr": code_vuln.get("false_positive_rate"),
                    "fnr": code_vuln.get("false_negative_rate"),
                    "metrics_path": str(metrics_path),
                }
            )

    return entries


def build_leaderboard(entries: list[dict]) -> dict:
    """Construct the leaderboard JSON from collected entries."""
    # Group by model
    model_datasets: dict[str, list[dict]] = {}
    for entry in entries:
        model_datasets.setdefault(entry["model_dir"], []).append(entry)

    # Build lookup: (model_dir, internal_ds) → entry
    best = {}
    for entry in entries:
        key = (entry["model_dir"], entry["internal_ds"])
        cur = best.get(key)
        if cur is None or entry["count"] > cur["count"]:
            best[key] = entry

    runs = []
    for model_dir in sorted(model_datasets):
        model_name, provider, adapter = MODEL_MAP[model_dir]

        datasets = []
        f1_scores = []
        all_acc = []
        all_prec = []
        all_rec = []
        all_f1 = []

        for internal_ds, display_name in DATASET_MAP.items():
            key = (model_dir, internal_ds)
            entry = best.get(key)
            if entry:
                datasets.append(
                    {
                        "name": display_name,
                        "accuracy": _r(entry["accuracy"]),
                        "precision": _r(entry["precision"]),
                        "recall": _r(entry["recall"]),
                        "f1": _r(entry["f1"]),
                    }
                )
                if entry["accuracy"] is not None:
                    all_acc.append(entry["accuracy"])
                if entry["precision"] is not None:
                    all_prec.append(entry["precision"])
                if entry["recall"] is not None:
                    all_rec.append(entry["recall"])
                if entry["f1"] is not None:
                    all_f1.append(entry["f1"])
                    f1_scores.append(entry["f1"])
            else:
                datasets.append(
                    {
                        "name": display_name,
                        "accuracy": None,
                        "precision": None,
                        "recall": None,
                        "f1": None,
                    }
                )

        # guard_score = mean F1 across evaluated datasets (F1 is more
        # meaningful than accuracy for code vulnerability detection)
        guard_score = (
            sum(f1_scores) / len(f1_scores) if f1_scores else None
        )
        agg_accuracy = _mean(all_acc)
        agg_precision = _mean(all_prec)
        agg_recall = _mean(all_rec)
        agg_f1 = _mean(all_f1)

        run_id = f"2026-04-03-{model_dir}-code-vuln-16k"
        runs.append(
            {
                "run_id": run_id,
                "run_name": f"{model_name} - Code Vuln Benchmark (16K)",
                "model_name": model_name,
                "provider": provider,
                "adapter": adapter,
                "benchmark_pack": "code_vuln-v1",
                "status": "completed",
                "run_timestamp": "2026-04-03T00:00:00+00:00",
                "tool_version": "0.1.0",
                "git_ref": "main",
                "aggregate": {
                    "guard_score": _r(guard_score),
                    "accuracy": _r(agg_accuracy),
                    "precision": _r(agg_precision),
                    "recall": _r(agg_recall),
                    "f1": _r(agg_f1),
                },
                "datasets": datasets,
            }
        )

    # Sort by guard_score descending
    runs.sort(
        key=lambda r: r["aggregate"]["guard_score"] or 0, reverse=True
    )

    return {
        "generated_at": datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "schema_version": 1,
        "runs": runs,
    }


def _r(v):
    """Round a value to 4 decimal places, or return None."""
    return round(v, 4) if v is not None else None


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def main():
    print("Scanning code-vuln results...")
    entries = scan_metrics()
    print(f"  Found {len(entries)} valid metric entries")

    # Show what we found
    models_found = set()
    for e in sorted(entries, key=lambda x: (x["model_dir"], x["internal_ds"])):
        models_found.add(e["model_dir"])
        ds_name = DATASET_MAP[e["internal_ds"]]
        f1 = e["f1"]
        f1_str = f"{f1:.3f}" if f1 is not None else "N/A"
        print(
            f"  {MODEL_MAP[e['model_dir']][0]:30s} | "
            f"{ds_name:35s} | F1={f1_str}"
        )

    missing = set(MODEL_MAP.keys()) - models_found
    if missing:
        print(
            f"\n  WARNING: No results found for: "
            f"{', '.join(sorted(missing))}"
        )

    leaderboard = build_leaderboard(entries)
    print(f"\nGenerated {len(leaderboard['runs'])} model runs")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(leaderboard, f, indent=2)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
