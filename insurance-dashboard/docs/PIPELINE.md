# Pipeline DAG

Phase 3 Platform (W6-25). Every builder under `pipeline/` is a **step** of one graph (`pipeline/dag.py`, standard library only) with its
inputs and outputs. The DAG runs what is stale, in dependency order, and explains why.

```
python3 pipeline/dag.py --dry-run                 # the plan: what is stale and why; runs nothing
python3 pipeline/dag.py                           # run every stale automatic step, in order (stops at the first failure)
python3 pipeline/dag.py --only facts              # a step or group, plus its stale automatic upstream steps
python3 pipeline/dag.py --only deploy --no-deps   # exactly the group (what deploy.sh runs before the gate)
python3 pipeline/dag.py --why web/public/data/restatements.json   # writer, fresh/stale and why, stale upstream, readers
python3 pipeline/dag.py --graph | --check         # the graph as text | validate it (CI)
python3 pipeline/dag.py --adopt [--only X]        # record the current files as fresh without running (after a manual run)
/usr/bin/python3 -m unittest discover -s pipeline/tests            # fixture-graph tests
```

## Staleness

A step is stale when it never ran in this checkout, its script or a module it imports (`code`) changed, an input changed, an output is
missing or was changed outside the DAG, a step it depends on will run, or (daily steps) the day changed. "Changed" means content
(SHA-1); a (size, mtime) cache makes a no-op run one `stat` per file. State: `~/.cache/fox/dag-<checkout>.json` (`FOX_CACHE`), per
checkout and machine: a fresh clone runs everything once (or `--adopt`). Paths behind a symlink (`data/raw`, `data/work`,
`data/sources`: the synced drive) are never listed or read; they count by their own `stat`.

**Manual steps** need the network, duckdb, pandas/parquet or files on the synced drive, `pdftotext`, or an LLM extraction wave. The DAG
lists them when stale and never runs them (`--only <step> --manual` runs one on purpose). A manual step whose outputs changed since the
last look was run by hand: that becomes its fresh state, and its automatic readers turn stale.

**Timings** (this Mac, warm file cache, 23.10.26): all 22 automatic steps from scratch 71 s (`build_search` 58 s, `facts` 3.7 s, the
rest < 2.5 s each); a no-op run of the whole graph 1.0 s (one stat per file; the first hash of 280 MB ≈ 3.5 s); `--only deploy` 5.9 s
on a fresh state, 0.2 s when nothing changed.

## The graph

Kind: `auto` runs here with `/usr/bin/python3` (standard library); `manual: …` names what it needs. `daily`: output depends on today's
date (reruns once a day). Groups: `deploy` (deploy.sh), `facts`. Paths without a folder are under `web/public/data/`.

| step | kind · group | after | writes |
|---|---|---|---|
| `fetch_maya` | manual: duckdb, network | – | data/warehouse.duckdb, data/sources/pdf (the autopilot also appends `data/registry/documents.csv`) |
| `fetch_xbrl` | manual: network | – | data/registry/xbrl_facts.json, data/sources/xbrl |
| `fetch_regulator` | manual: drive, network, pandas | – | data/raw (regulator parquet) |
| `fetch_macro` · `fetch_boi` · `fetch_holders` · `fetch_liabilities` | manual: drive, network | – | data/raw/macro · boi · maya_holders · maya_liabilities |
| `fetch_prices` | manual: drive, network | – | companies/*.price.json (valuation input only) |
| `build_pages` | manual: drive, pdftotext | fetch_maya | search/text, data/registry/pages_manifest.json |
| `extraction` | manual: llm | – | data/extracted, extracted_fs, _hist, _lts, _pres, _savings, _solvency, _sop (EXTRACT_SPEC.md; owner approval per wave) |
| `build_ifrs` | manual: drive, duckdb | fetch_maya, extraction | ifrs.json, ifrs_*.json, ifrs/ |
| `build_kpi` | manual: duckdb | fetch_maya, extraction | kpi.json |
| `build_documents` | manual: duckdb | fetch_maya | companies/*.docs.json |
| `build_market` · `build_funds` | manual: drive, pandas | fetch_regulator | market.json, data/market.json, prov/reg · funds.json, funds/ |
| `build_macro` · `build_boi_curve` · `build_ownership` | manual: drive | their fetcher | macro/macro.json · macro/boi_curve.json · ownership/ |
| `build_search` | auto | build_pages | search/docs.json, search/ft (`--shards 1536`: the published layout) |
| `build_series` | auto | extraction | series/ |
| `facts` | auto · facts | extraction, build_search, build_series | companies/<id>.json, search/rows.json, lines.json, facts/, pipeline/taxonomy/{lines,coverage}.json, registry.json (in place) |
| `build_solvency` | auto | extraction | csm/solvency.json |
| `build_csm` | auto | build_ifrs, build_series, build_solvency | csm/facts/, csm/{facts,summary,sens,rates,capital}.json |
| `build_debt` | manual: drive | fetch_liabilities, facts, build_csm | debt/ |
| `build_savings` | manual: drive | extraction | savings_econ.json |
| `build_hist` · `build_sop` | auto | extraction | hist/ · sop/ |
| `build_company_index` | auto | facts | companies/index.json |
| `build_restatements` | auto · facts | build_ifrs, build_search, facts, build_company_index | restatements.json |
| `build_targets` | auto | extraction, build_ifrs, build_search, build_csm | targets.json, adjusted.json |
| `lts_norm` | auto | extraction | data/lts_norm (11 company normalisers, then `lts_norm_all.py`) |
| `build_lts` | auto | extraction, lts_norm | lts.json, lts_prov/ |
| `build_recon` | auto | build_market, facts | recon.json |
| `build_lens` | auto | build_market, build_lts, build_recon | lens.json |
| `build_roster` | auto | build_market, build_funds | roster.json |
| `build_pagefacts` | auto | build_ifrs, facts, build_savings, build_lts | search/facts/ |
| `build_web_index` | auto · deploy | build_documents, build_market | search/entities.json, filings_latest.json |
| `build_calendar` | auto, daily · deploy | – | calendar.json, calendar.ics |
| `canon_kpi` | auto · deploy | build_kpi, facts, build_company_index | kpi.json (in place) |
| `build_registry` | auto · deploy | build_kpi, canon_kpi, facts, build_series, build_sop, build_lts, build_targets, … | peers/ |
| `build_market_home` | auto · deploy | build_market | market_home.json |
| `build_cards` | auto · deploy | facts, build_kpi, canon_kpi, build_targets, build_ifrs, build_csm, build_registry | cards/ (report card per filing; `check_cards.py` = gate `cards`) |
| `build_since` | auto, daily · deploy | build_documents, build_restatements, build_targets, build_market | since.json (per-company dated events, last 400 days) |
| `build_coverage` | auto, daily · deploy | every step that writes JSON | coverage.json (reads qa.json from the last gate) |

After the build: `python3 pipeline/gate.py` (all checks; writes qa.json, consistency.json). It is not a step: deploy.sh runs it after
`dag.py --only deploy --no-deps`, exactly as before.

`deploy.sh` runs the `deploy` steps (the six it always ran, plus lane S2's `build_cards` and `build_since`), in the same order; a step whose inputs, code and outputs are unchanged since its
last run in that checkout is skipped (identical output: these steps are deterministic, verified byte for byte except the time stamps of
calendar.ics and coverage.json). It does not run upstream builders; the DAG prints the stale ones.

## Adding a step

1. Write the builder (`pipeline/build_x.py`): read inputs, write outputs, exit non-zero on failure, deterministic output (sort what you
   iterate from a set or dict of unordered origin; `build_registry.py` once wrote a different url order on every run).
2. Declare it in `STEPS` (`pipeline/dag.py`): `step("build_x", "pipeline/build_x.py", inputs=[...], outputs=[...])`. Paths are relative
   to `insurance-dashboard/`; a directory means every file under it; globs allowed. Add `code=[...]` for local modules it imports,
   `edits=[...]` for files it rewrites in place, `daily=True` if the output depends on today, `needs={...}` if it is manual
   (`network`, `duckdb`, `pandas`, `openpyxl`, `drive`, `pdftotext`, `llm`), `groups={"deploy"}` to make deploy run it.
3. `python3 pipeline/dag.py --check` (no cycle, every script exists, no file written by two steps) and `--dry-run`; add the step to the
   table above.

## Requirements

`pipeline/requirements.txt` pins exactly what pipeline code imports (duckdb, numpy, openpyxl, pandas, pyarrow + transitive), from the
owner's .venv (Python 3.11). The deploy path, the gate, the DAG and every automatic step are standard library. `/usr/bin/python3` on
the owner's Mac (3.9) has no duckdb: `build_ifrs`, `build_kpi`, `build_documents`, `fetch_maya` (warehouse writes) and
`verify_extraction.py` run in the .venv.

## Known drift (23.10.26)

Rebuilding every automatic step from HEAD's inputs changes outputs that HEAD commits as built: `companies/*.json` (7) + `search/rows.json`
+ `facts/` + taxonomy (one label: labels.ts `combined_ratio` became "יחס משולב" in 8717445d, never rebuilt); `data/lts_norm/*` anchors
(17), `lens.json` rows, `recon.json`, `schemas.json` (coverage copies `web/src/lib/schemas.json`), `search/docs.json`. Not rebuilt in
this commit series; one `python3 pipeline/dag.py` + gate brings them in line (review the diff first).

## Delivery: CI, deploy gate, cache contract (25.10.26)

**CI** (`.github/workflows/fox-ci.yml`, every push/PR under `insurance-dashboard/`): Python from `.python-version` (3.12) with
`pipeline/requirements.txt`; autopilot tests (recorded MAYA responses, temp warehouse: `fetch_maya.connect(db)` creates the
`documents` table for any path); DAG check, tests, dry run; data gate; `tsc`; `vite build`; route check (390/1440); cache contract
(`web/scripts/hosting-check.mjs dist --serve …`); Playwright at the lockfile's chromium + webkit: visual smoke and axe (projects
`phone`, `desktop`), WebKit crash regression and sticky-column lint (`webkit-phone`, iPhone 13, `tests/webkit.spec.ts`).
Reproduce locally: `uv venv -p 3.12 && uv pip install -r pipeline/requirements.txt`, then the same commands; `npx playwright test`.

**Visual baselines** are per platform: `web/tests/__screenshots__/darwin/` (the owner's Mac, installed Chrome) is compared locally;
`…/linux/` is compared in CI once committed. Until then CI attaches each screenshot and uploads the set as the `linux-baselines`
artifact. To turn the Linux comparison on (or refresh it after an intended change: run the workflow by hand with `update_baselines`):
`gh run download <run-id> -n linux-baselines -D insurance-dashboard/web/tests/__screenshots__/linux` → review → commit.

**Deploy gate** (`deploy.sh`): refuses unless, before anything runs, (1) no tracked file under `insurance-dashboard/` has uncommitted
changes and no untracked file sits under `web/src` or `web/public`; (2) HEAD is on origin (`git branch -r --contains`); (3) the
latest `fox-ci` push run for HEAD (`gh run list --commit <sha> --workflow fox-ci --event push`; a hand-run `update_baselines` run
never counts) is completed and succeeded. `--force-unverified`
skips the gate with a loud warning (restore service only). `--check-only` runs every check and deploys nothing (gate skipped).
After the pipeline steps and the data gate, the files they regenerated are committed (`Deploy: commit the data files the deploy
build regenerated`) before the app is built, so the bundle's commit stamp and the deployed data are that commit; the script prints
it — push it afterwards so origin matches live. On any exit without a data commit (`--check-only`, a failed check or deploy) the
regenerated tracked files are restored to HEAD (only when the tree was clean at the start), so the next run still passes the gate. Typical flow: commit → push → wait for green (`gh run watch`) → `./deploy.sh`.

**Optional next step (owner, not implemented): deploy from CI.** Create a Firebase service account with the *Firebase Hosting Admin*
role (Firebase console → Project settings → Service accounts, or `firebase init hosting:github`), store its JSON as the repository
secret `FIREBASE_SERVICE_ACCOUNT`. That alone turns on the PR preview channel already in fox-ci. To deploy live from CI, add a job
that `needs: check`, runs only on pushes to the trunk branch, rebuilds and calls `FirebaseExtended/action-hosting-deploy@v0` with
`channelId: live`; then deploy.sh becomes the fallback. Protect the trunk branch (required check: `fox-ci / check`) first.

**Cache contract** (`web/firebase.json`, `public/sw.js`, `src/lib/reload.ts`; checked by `web/scripts/hosting-check.mjs`):

| Path | Served | Cache-Control |
|---|---|---|
| extensionless (`/`, `/company/harel`, `/data/autopilot`) | `index.html` via rewrite `!**/*.*` | `no-cache` |
| `*.html` | the file | `no-cache` |
| `/assets/*` (content-hashed names only; checked) | the file, else **404** | `public, max-age=31536000, immutable` |
| `/data/**/*.*` | the file, else **404** | `public, max-age=300` |
| `/sw.js` | the file | `no-cache` |

A 404 under `/assets/**` still carries the `immutable` header (Hosting applies headers by path): harmless, since releases are
atomic and a hashed name that is missing never comes back. A tab opened before a deploy that asks for a lazy chunk gone with the old build gets a 404, Vite raises `vite:preloadError`, and the
app reloads once (a second failure within a minute reaches the error boundary). The service worker (v2) revalidates navigations
(`cache: 'no-cache'`, falls back to the cached shell after 3 s or offline), stores HTML only as the shell, and never stores or serves
an HTML body for an `/assets` or `/data` request. `scripts/serve.mjs` applies the same rules (same matcher as Hosting: minimatch,
cross-checked against superstatic), so the route check, Playwright and the hosting check run under the live behaviour.
