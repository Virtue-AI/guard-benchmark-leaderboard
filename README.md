# Virtue AI Guard Benchmark Leaderboard

Public GitHub Pages site for the Virtue AI guard benchmark results.

This repository is:

- a `public` GitHub Pages project site
- static deployment with GitHub Actions
- data supplied by committed leaderboard JSON files
- optional manual JSON upload in the browser for preview and review

The repository name is:

- `guard-benchmark-leaderboard`

## Purpose

This site presents a benchmark leaderboard for guard and moderation models
without exposing the full harness repository or raw run artifacts to every
viewer.

The site consumes a sanitized leaderboard payload and renders:

- overall ranking
- filters by model, provider, and benchmark pack
- run provenance
- per-dataset metrics

## Data Inputs

### Default Data Path

The site loads:

- `data/leaderboard.json`

This is the path intended for automated updates from the benchmark harness.

### Manual Data Path

The UI also allows a user to:

- upload a local `leaderboard.json` file in the browser
- preview that data without committing it
- reset back to the committed site data

This supports manual review and hand-carried updates before CI wiring exists.

## Expected JSON Shape

The site expects a top-level object with:

- `generated_at`
- `schema_version`
- `runs`

Each item in `runs` should include:

- `run_id`
- `run_name`
- `model_name`
- `provider`
- `adapter`
- `benchmark_pack`
- `status`
- `run_timestamp`
- `tool_version`
- `git_ref`
- `aggregate`
- `datasets`
- optional `report_path`

See [`data/leaderboard.json`](data/leaderboard.json) for a working sample.

## Local Preview

Run a static file server from the repository root:

```bash
python3 -m http.server 8000
```

Then open:

- `http://127.0.0.1:8000`

## Deployment

This repository includes a GitHub Pages deployment workflow in:

- `.github/workflows/deploy-pages.yml`

It publishes the repository root as a static Pages artifact.

## Notes

- Only sanitized, publishable leaderboard data is committed here.
- Do not commit raw configs, secrets, or full benchmark run directories.
