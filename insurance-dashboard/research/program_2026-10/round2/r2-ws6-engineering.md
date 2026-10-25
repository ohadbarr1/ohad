# r2 · ws6 Engineering — 25 Oct 2026

Method: CDP on the live site, cold (SW bypassed) then warm; phone = 390 px, Lighthouse "slow 4G" (150 ms RTT, 1.6 Mbit/s, 4× CPU), 17 routes. Data, script and filmstrip: `round2/shots/ws6/`. Repo at `13045ba3` (= live stamp), `gh run` logs, `curl -I`. [V] verified · [T] inferred.

## 1. Grade today: **7.2 / 10** (round 1: 5.0)

Round 1's backlog mostly shipped, and shipped well. The grade stops at 7 for three reasons. **The safety net isn't connected to the deploy**: CI has been red for 7 pushes and the site went live anyway. There's no field telemetry. And layout shift on the phone is severe on the busiest page.

1. **Payload down about 60 %** [V]. Cold transfer runs 173–702 KB (median 327) against 780–990 KB on every route in round 1. Home is 322 KB (was 800). Blocking time median is 8 ms (max 200). LCP median is 2.09 s; 5 of 17 routes miss 2.5 s: company overview, financials, IFRS 17, `/industry/csm` and fund card.
2. **The repeat visit is excellent** [V]. Through the SW: 0 KB, ready in 0.21–0.48 s.
3. **The company overview is the weak page** [V].
   - `/company/harel` makes 57 requests, 34 of them JS/CSS chunks in a lazy-import waterfall.
   - It pulls the 154 KB br charts chunk and home's `market_home.json` (91 KB br).
   - First figure at **4.07 s**, **CLS 1.51**: "טוען…" panels collapse and push content (filmstrip at 3.2 vs 4.2 s).
   - CLS is also over 0.25 on home (0.65), `/calendar` (0.75), `/data` (0.33) and `/holdings` (0.26).
   - No test measures CLS.
4. **CI is good, but red and not gating** [V].
   - `fox-ci.yml` runs DAG check, gate, tsc and build, route check at 390/1440, and Playwright with axe.
   - Every run from 23 Oct 12:23 to 19:06 (7 runs) fails in about 30 s: `test_autopilot.py` → `CatalogException: Table with name documents does not exist`.
   - Why: CI installs duckdb from the newly pinned `requirements.txt`, while the owner's `/usr/bin/python3` (3.9) lacks it and skips that path. Three Pythons are in play (3.9 / 3.11 venv / 3.12 CI).
   - Result: **tsc, build, Playwright and axe never ran in CI on the design upgrade or the new home**. `deploy.sh` ignores CI, and the live bundle says `commit:"13045ba3"`, a red commit.
5. **Live ≠ HEAD; there's no trunk** [V].
   - Live `schemas/qa/coverage/consistency.json` hash to the *uncommitted* working tree (`deploy.sh` builds the working tree).
   - All 260 commits sit on `claude/festive-ramanujan-7f9ihj`; `master` is a 2024 commit.
   - No PR has ever been opened and no secret is set, so the preview channel has never run.
6. **Visual regression is a no-op in CI** [V]. All 56 baselines live under `__screenshots__/darwin/`, so on Linux they are attached, never compared.
7. **Cache and rewrite bugs** [V].
   - `/` and deep links come back `max-age=3600`: the `no-cache` rule matches only the literal `/index.html`.
   - A missing `/assets/<old-hash>.js` gets **200 text/html with `immutable, max-age=31536000`** (the `**` rewrite), and the SW asset cache stores any 200.
   - Result: for up to an hour after a deploy, a returning visitor's lazy chunk can resolve to HTML and show "העמוד לא נטען" [T on frequency].
   - Missing data files also return 200 HTML (`/data/companies/nope.json` → 1,828 B), so 404s are invisible to any monitor.
8. **No observability; dependency hygiene lags** [V].
   - No RUM, no error sink (`ErrorBoundary` only calls `console.error`), no analytics.
   - `npm audit --omit=dev`: 10 issues, 9 high (`@remix-run/router` ≤ 1.23.2, `@grpc/grpc-js` via firebase, `image-size` via pptxgenjs), plus a moderate ECharts XSS below 6.1.
   - No Dependabot; the Actions pins are on deprecated Node 20.

Top tier already: the data gate. 16 blocking checks: A = L + E, XBRL = statements, 16,340 of 16,366 IFRS facts on the cited page, fact-table rebuild. Also the 42-step DAG (`--check` 0.16 s), the MCP golden set at 20/20, and a route check over about 80 routes × 2 widths. No free competitor has this [J].

## 2. Gap to 9.0+ (ranked)

| # | Change | Effort | Dep. | Test that proves it |
|---|---|---|---|---|
| G1 | **CI is the only door to live.** Fix the autopilot fixture so it creates the warehouse schema. One Python (3.12, `uv` lock). Protected `main` + PRs. Deploy from green `main` via Actions with `FIREBASE_SERVICE_ACCOUNT`. `deploy.sh` refuses a dirty tree. | S–M | owner secret | 10 green runs in a row; live `commit` = green `main` SHA; live data hashes = HEAD |
| G2 | **Linux baselines + perf budgets in CI.** Generate baselines on the runner. Add a Playwright perf project with CDP throttling. | S | G1 | CI fails on any key route above CLS 0.1, LCP 2.5 s slow-4G, 400 KB cold or 35 requests |
| G3 | **Kill layout shift.** Fixed-height skeletons. One `companies/<id>.overview.json` feeding Report Day instead of about 10 files. No `market_home.json` on company pages. | S–M | ws2/ws3 | CLS < 0.1 on all 17 routes (5 exceed 0.25 today); `/company/harel` first figure ≤ 2.0 s (4.07) and ≤ 25 requests (57) |
| G4 | **Fix the cache contract.** Rewrite extensionless paths only (`!**/*.*`). `no-cache` on all HTML. Real 404s under `/assets` and `/data`. `vite:preloadError` → reload once. SW navigate with `cache:'no-cache'` and a 3 s timeout. | S | – | `curl /assets/x.js` → 404; `curl -I /company/harel` → `no-cache`; a tab open across a deploy shows no error screen |
| G5 | **Field telemetry (free, cookieless).** `web-vitals` + `ErrorBoundary`/`unhandledrejection` → a tiny Cloud Function or Firebase Performance, tagged with the commit. A health strip on `/data`. | S | CSP `connect-src` | p75 LCP/CLS/INP per route on `/data`; a forced error shows within 1 min |
| G6 | **Content-addressed data.** `data/manifest.json` (path → sha). `?v=sha` + `immutable`. SW stale-while-revalidate per manifest version. | M | G4 | Throttled warm visit ≤ 300 ms with no render-blocking data fetch; a deploy shows new figures on the next navigation |
| G7 | **Reproducible from a clean clone.** Move `data/raw` and `data/work` off Drive into a versioned bucket (GCS / R2 / LFS) with a manifest. Today 20 of 42 DAG steps are manual, CI skips page-text checks, and the last commit downgraded the `assets` check because the Drive cache was "unreadable". | M | owner storage | A fresh runner reproduces every auto step; no "skipped" notes in `qa.json` |
| G8 | **Security and dependencies.** Dependabot (npm, pip, actions). `npm audit fix` (router 6.30). ECharts 6.1 behind the visual suite. Patch `image-size`. Remove `'unsafe-inline'` styles (64 inline `style={{}}`). | S–M | G2 | 0 high in audit; securityheaders A+ |
| G9 | **Accessibility beyond axe.** An sr-only table per chart from `FoxSpec`. axe on the full route-check list, not 14 routes. Keyboard-path tests for the omnibox, tabs and source sheet. | S–M | G2 | ~80 routes, 0 serious; every chart has a linked table |
| G10 | **Test the engines.** Vitest on `web/src/lib` (kpi, csm, market, lens, facts, searchOmni), the modules MCP imports. `mcp npm test` and `parity.mjs` in CI. | M | G1 | ≥ 80 % coverage on `lib/`; MCP 20/20 and parity 11/11 run on every push |

G1–G5 ≈ 1.5 engineer-weeks → about 8.5. G6–G10 → 9.0+.

## 3. Bold options (platform capabilities → new product)

**B1 · fox Open Data API.** Make the existing 15,006 static JSON files (216 MB) and the 190k-row fact table with vintages a citable public dataset.
- *What it takes:* CORS on `/data/**` (none today [V]), a frozen `/v1/`, `datapackage.json`, nightly Parquet and CSV snapshots, an OpenAPI page and a thin `foxdata` Python client.
- *Who:* analysts, academics, journalists, Excel Power Query users.
- *Why nobody free has it:* normalised IFRS 17 statements with a page cite per number don't exist publicly. data.gov.il has raw CSVs; prodata is a paid UI [J].
- *Data:* existing outputs; MAYA and data.gov.il CKAN.
- *Risk:* schema stability; snapshot bandwidth (put them in a bucket).
- *Cost:* about 1 week, $0–5 a month.

**B2 · Hosted "Ask fox" MCP connector.** Serve the existing stdio server (9 tools, every figure cited) over Streamable HTTP on Cloud Run with Google OAuth and an allowlist, as designed in `docs/MCP.md`.
- *What it gives:* any Claude user adds fox as a connector and asks on a phone "CSM של הראל מול מגדל Q2'26".
- *Why special:* no Israeli data service has an agent interface, and model cost to fox is zero.
- *Risk:* abuse (rate limits); 1–2 s cold start.
- *Cost:* 3–4 days. Free-tier compute; Blaze plan plus a budget alert.

**B3 · Embeddable cited charts (`/embed/<spec>`).** An iframe or web component that renders any `FoxSpec` with the source footnote and a back-link, plus a static SVG for newsletters.
- *Requirement:* `frame-ancestors *` on embed paths only.
- *Who:* Globes and TheMarker writers, IR teams, Substack analysts.
- *Why special:* distribution without SEO (the site is `noindex`), and every embed is a sourced number in public.
- *Cost:* about 1 week.

**B4 · Autopilot ON + Web Push.** The commented-out cron in `autopilot.yml` polls MAYA at ≤ 1 req/s, lands the XBRL skeleton marked "לא מאומת", runs the gate and opens a **PR with a preview channel**. The owner merges from the phone, which deploys and sends an FCM topic push with the deltas `deltas.py` already computes.
- *Constraint:* MAYA 403s stop a run and are never evaded, so ownership stays manual.
- *Cost:* about 1 week after G1, plus the owner's extraction budget decision.

**B5 · fox Lab: in-browser SQL over the fact table.** DuckDB-WASM, about 3–6 MB, lazy-loaded only on `/lab`, over B1's Parquet.
- *What it gives:* SQL or the Peer Table's Hebrew formula bar, results drawn with `FoxSpec`, and xlsx/pptx export with sources. Works offline through the SW.
- *Why special:* nobody free offers a queryable, sourced, vintage-aware warehouse in the browser [J].
- *Cost:* about 2 weeks.

**B6 · Public quality ledger.** Each deploy publishes `qa.json`, commit, data-manifest hash and field vitals to `/data/ledger`. A "verify this number" button re-runs the page match from the page text the reader already serves.
- *Why special:* it turns "never fabricate" into something any reader can check.
- *Cost:* 3–4 days after G1, G5 and G6.

**Dependencies.**
- G3 needs ws2/ws3 to accept fixed-height skeletons.
- B1, B3 and B5 need ws5's taxonomy ids frozen as the public contract.
- B2 and B4 need the Blaze plan, the owner's Firebase secret and an extraction budget.
- Sync (`SYNC_ENABLED=false`) is a 10-minute console task that unblocks per-user features. Flip it after G1, so its CSP change ships through a green pipeline.
