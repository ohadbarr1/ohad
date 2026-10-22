# fox · Enterprise Upgrade Program (22 Oct 2026)

Synthesis of a seven-workstream consulting review of https://fox-research-il.web.app/ (strategy, desktop UX, mobile UX, visual design, data integrity, engineering, analyst workflows). Workstream reports: `ws1-strategy.md` … `ws7-features.md` in this folder (182 findings, 39 radical moves, 84 quick wins). Brief: `00_brief.md`. Prior QA audits: `../top_tier_audit_3.md` (12 Oct 2026). Tags: [V] verified live/in source by a workstream, [T] second-hand, [J] judgment. All effort and token figures below are **estimates**.

## 1. Bottom line

1. **fox is a Tier-1 data asset under a Tier-2 product.** Composite score today **5.8/10** (strategy 6, desktop 6.5, mobile 5, design 6, data 6.5, engineering 5, workflows 5.5). Best-in-class references: Koyfin 8.5 (mechanics), Fiscal.ai 8–8.5 (craft, statements screen), StockUnlock 8 (mobile). On *this* niche no competitor scores above 3: nobody else has IFRS 17 statements, CSM bridges, solvency and regulator fund data for Israel, cell-linked to the filing page.
2. **The named rival is the wrong rival.** prodata.co.il is ProData Gemel: a login-walled workflow tool for licensed agents (clearing-house import, proposals, מסמך הנמקה) built on the same three data.gov.il datasets fox already ingests; no statements, no IFRS 17, no mobile story [V]. Benchmark set from now on: EY InsurTool (insurer analytics), prodata (funds analytics only), Koyfin/Fiscal.ai (mechanics and craft), StockUnlock (mobile).
3. **What keeps fox from the top is finish and trust, not data.** Five systemic causes (§3): trust leaks on the face of the product; navigation by data source instead of by job; a phone that is a shrunk desktop with a live regression; a prototype delivery layer; a fact base without workflows.
4. **The wedge sentence:** *the audited fact base of Israeli long-term savings, free, before anyone else has read the PDF.* Every roadmap item is ranked by whether it makes that sentence truer.
5. **Program:** Phase 0 (1 week) stops the bleeding; Phase 1 (3 weeks) lays the foundation (tokens, routing, PWA, gates, export v1); Phase 2 (2 months) ships eight signature builds; Phase 3 (a quarter) builds the platform and the data moat (fact table with vintage, report-day autopilot, ownership graph, copilot/MCP). Nine owner decisions are listed in §7.

## 2. Scorecard

| Area | Today | Target after Phase 2 | Best competitor | What moves it |
|---|---|---|---|---|
| Strategy / positioning | 6.0 | 8.5 | prodata 8 (funds) [V], Koyfin 8 (mechanics) [V] | wedge stated, nav by job, Savings Lens, ownership graph |
| Desktop UX / IA | 6.5 | 8.5 | Koyfin 8.5 [T] | Report Day as company home, one toolbar row, Series engine, terminal mode |
| Mobile UX | 5.0 | 8.0 | StockUnlock 8 [V] | overflow fix, Sheet/ContextBar, company card, PWA, feed |
| Visual design | 6.0 | 8.5 | Fiscal.ai 8.5 [T] | one token system, ledger + ChartFrame, identity palette, motion budget |
| Data integrity | 6.5 | 8.5 | Fiscal.ai/Koyfin 8.5 [T] | vintage model, deploy gates, taxonomy, coverage matrix |
| Engineering | 5.0 | 8.0 | Koyfin 8 [T] | clean URLs, splitting, CI, schemas, sync, offline |
| Workflows / features | 5.5 | 8.5 | Koyfin 8.5 [V] | peer table builder, alerts, export engine, search platform |

## 3. Five root causes (with the evidence that matters)

**RC1 · Trust leaks on the product's face.** Quarters are as-originally-reported while H1/9M/FY are restated, in the same row: 459 of 3,511 IFRS-17-era Q1+Q2=H1 checks fail (13.1%; Clal 24.8%) [V W5-1]. 621 Q4/H2 cells derived on non-additive rows (share counts, opening cash) [V W5-2]; Clal share count stored ×1,000 and typed as NIS [V W5-3]. ביטוח-נט fee series jumps 0.706%→1.468% in Jan '26 for every insurer at once (regulator definition change) and is shown as "דמי ניהול 0.75% vs 0.45%" [V W5-4]. Every KPI-strip delta prints "YoY 5.5%−" (bidi) [V W4-1]; sector share labels print "66.3064%" [V W4-6]; 134 English extractor labels and eight period vocabularies remain [V W5-7, W4-5]. No check runs at deploy: `npm run deploy` = build + firebase [V W5-15, W6-4].

**RC2 · Navigation by data source, not by job.** Company page opens on a 19-card, ≈3,400 px wall while Report Day (the page that answers "what changed") is tab 2 [V W2-1]. Statements: 42 controls before the first figure at 1440 (43 at 743 px on the phone, below the fold) [V W2-2, W3-2]. Three sub-navs and three h1s for one regulator dataset; nine industry tabs with two "CSM" and two "peer series" tabs [V W2-6/7]. `<title>` = "fox" on all 36 routes; unknown routes silently land on home [V W2-5]. Every figure is a focusable `<button>` (2,843 on `/market/funds`) [V W2-4].

**RC3 · The phone is a shrunk desktop with a live regression.** One unscoped rule (`styles/review.css` L3, `.panel .scroll{overflow:visible}` at ≤760 px) makes 24 of 35 routes scroll sideways (document 453–1,657 px wide at 390) and clips digits and minus signs [V W3-1]. No manifest, no service worker, no push, no system dark, SVG touch icon; 0.74–0.96 MB compressed per cold route, 2.5–3.0 s to first figure on slow 4G [V W3-5/6]. Compact cells glue change to base ("−5.5%957") [V W3-4].

**RC4 · Prototype delivery layer.** HashRouter: plain paths 404, no share previews [V W6-3]. `market.json` (426 KB br / 1.83 MB raw) on every route because `Search.tsx:22` calls `useMarketData()` unconditionally in the layout: 43–55% of every page load [V W6-1]. One 499 KB chunk for 27 pages; charts chunk preloaded on chart-less routes [V W6-2]. No tests, no CI, no error boundary, no observability; all personal state in `localStorage` with two incompatible `useStored`s; repo on Google Drive so builds need a shell workaround [V W6-4/5/6/10/21].

**RC5 · A fact base without workflows.** Nothing tells the analyst a filing landed; the pipeline is hand-run [V W7-1]. "Screener" = 19-column matrix + 29-line page out of 5,077 lines; no conditions, formulas, templates or peer-set object [V W7-2/3/4/16]. Export = bare-canvas PNG + flat CSV; no xlsx with page links, no PPT, no print view [V W7-12/13/14/22]. Full-text search covers 40 of 2,761 documents [V W7-9]. 70 solvency reports, 356 liabilities schedules, 391 presentations in the registry, unread [V W5-19/20, ws5 App. B]. Two large free datasets untouched: MAYA ownership/institutional holdings and the uniform quarterly asset-list Excels on every manager site [V W1-7/8].

## 4. The program

### Phase 0 · Stop the bleeding (week 1; ≈2–3 build sessions)
1. Scope the overflow rule; add a 390-px `scrollWidth === innerWidth` check for all routes to the deploy script [W3-1].
2. `Sourced` auto-adds `.num` when its text has digits (fixes "5.5%−" everywhere) [W4-1, W4-25].
3. Payload: `search/entities.json` instead of `market.json` in the layout; lazy ECharts; `filings_latest.json` instead of 13 requests [W6-1/2/11, W3-6].
4. One `plabel()`; zero ISO dates; eight vocabularies → `Q2'26 · FY'25 · H1'26 · 08/26` + `27.08.26` for publication dates [W2-3, W4-5, W5-8, W3-11].
5. `shares` unit (never rescaled); derivation allowlist (no Q4/H2 on balances, counts, ratios) [W5-2/3].
6. Vintage interim: default every cell to the latest restated value, dot on changed cells, count in the sheet header; full model in Phase 3 [W5-1/18].
7. Regulator level-shift detector; "שינוי הגדרה 01/26" chip; fee YoY suppressed across the break; fees per family [W5-4].
8. `nf()` on all chart labels; remove count-ups and above-the-fold entry animation [W4-6, W1-15, W2-1].
9. `document.title` per route; real 404 route [W2-5].
10. Coverage: IDI and Meitav XBRL; Yahoo DPS card removed; Hebrew map for the ~40 IFRS 17 reconciliation labels; Menora placeholder rows recovered from page text [W5-12/7/6, W2-15].
11. Deploy gate v1: `check_workbook.py` + `verify_prov.py` + value-on-page for `ifrs_*.json` as `predeploy`; build fails on any Latin label ≥3 words [W5-15/11/7].
12. Repo cloned to local SSD (Drive keeps PDFs); GitHub Actions: typecheck → pipeline checks → build → preview channel [W6-4/5].

Exit criteria: no horizontal scroll on 35 routes at 390; 0 ISO dates in the rendered DOM; statements route < 450 KB compressed; 0 `nis`/`shares` values out of range; deploy refuses on a failed gate; CI green.

### Phase 1 · Foundation (weeks 2–4; ≈6–8 sessions)
- **Design system** (ws4 App. A): 8-step type scale, weights 400/500/700, Heebo self-hosted; radii 4/8/12/pill; three elevations; `--ember` split into fill and ink (AA); identity palette tokens; motion budget of three moments; delete aurora, spotlight, blur page-in, glass, hover lift, the home mast and 3-D nav icons; one theme toggle with system default; dead light theme removed [W4-2/3/4/11/12/17/18, W6-20, W3-12].
- **Shell**: BrowserRouter + Firebase rewrites + hash-redirect shim; route-level `React.lazy`; error boundary + Sentry + web-vitals; security headers; `version.json` in the footer [W6-3/6/7/21/23].
- **PWA**: manifest, PNG icons, service worker (shell precache, data stale-while-revalidate), dynamic theme-color, safe-area insets [W3-5, W6-8].
- **Phone primitives**: `Sheet` + `ContextBar`; statements one toolbar row (desktop) and a sticky 44-px context bar (phone); sticky first column everywhere; two-line change cells; one-line company header; tap targets ≥36 px; bottom nav בית · חברות · ענף · קופות · מעקב; `/market/*` folded into `/funds` [W3-2/3/4/9/14/17/18, W2-2/6/22].
- **Home**: mast gone; "since your last visit" first; per-company new-filing dot; one search [W2-13, W4-4, W7-6].
- **Export v1 and print**: PNG stamped with title · unit · period · source page; xlsx with numbers, unit row, `Q2'26` headers and per-period page hyperlinks; `@media print` + A4 tear sheet [W7-12/13/22, W4-20/22].
- **Workflow v1**: palette grouped with codes and recents; keyboard shortcuts (`?`, `g c/i/f`, `[`/`]`); peer-set chips (local); calendar v1 from `documents.csv` publish dates + ICS; "מול עמיתים" on every statement row with a role; fund numeric filters [W7-23/21/16/8/3/18].
- **Data hygiene**: label normaliser (הכול/הכל, עליה/עלייה…); cross-layer reconciliation (XBRL = statements = SOP) in `qa.json`; balance identity per vintage; canonical-value rule (printed over XBRL); Sharpe/alpha guards; roster-change flag on YoY [W5-5/22/10/16/13/14].
- **Accessibility**: `tabindex=-1` on figure buttons + skip link; ARIA 1.2 combobox on search; `--faint` to AA; `lineHe` on the CSM waterfall category [W2-4/18/20/17].
- **Fund-house pages**: overview template (AUM, flows, fee yield, cost/income, operating margin, ROE); hidden tabs redirected [W2-10, W3-26].

Exit: first figure ≤ 300 px on phone statements; every route < 450 KB (statements < 200 KB); 0 Latin labels; Playwright 10 routes × 390/1440 × two themes in CI; axe serious = 0.

### Phase 2 · Level jump (months 2–3; ≈15–20 sessions)
Eight signature builds, in dependency order:
- **A. Company page re-architecture.** Report Day becomes the index route; 8 tabs → 4 (דוח · דוחות · חיסכון · מסמכים); period and window lifted to the layout and the URL; KPI ledger (metric · 3 periods · YoY · sparkline · source) with a sticky `ChartFrame` pane replaces the 16-card grid; phone company card with full-screen sheets [W2-RM1, W4-R2, W3-R2, W2-11/12].
- **B. Peer Table Builder / Series engine.** One page replaces `/industry/matrix`, `/lines`, `/headline`, `/compare`: unified metric registry (statement roles, IFRS 17 facts, SOP lines, LTS metrics, regulator metrics) × saved peer sets × Q/H/FY/LTM; formula columns with `calc` provenance; templates with hotkeys; identity colours; standard-break band; stamped export; industry hub 9 tabs → 3 [W7-R2, W2-RM2/RM4, W4-R4, W7-2/3/4].
- **C. Savings Lens.** Regulator monthly flows joined to manager quarterly P&L: fee yield, cost/income, profit per ₪bn, flow-weighted share; Q-to-date nowcast labelled אומדן; track card (cumulative vs category, crises table, heatmap, exposures over time); transparent reproducible rating; manager rank history; manager chip on every fund row [W1-R1/4/5/6/13, W7-R5/18].
- **D. CSM Ledger + Capital engine.** CSM economics series (new-business/release, CSM/equity, interest vs estimate changes), the 256 extracted sensitivities shown, dividend capacity, BoI zero-coupon curve overlay; SCR composition once the solvency wave lands [W7-R4, W1-R5/11, W5-19, W7-27].
- **E. Search platform + document reader.** Hebrew-normalised inverted index (entities → lines → full text of all 2,761 documents, chunked loading); one ranked omnibox; in-app PDF reader with the term highlighted and "what was extracted from this page" beside it [W6-RM3/9, W7-9/10].
- **F. Identity and sync.** Firebase Auth (Google) + Firestore behind `useStored`; "שלי" page (views, watchlist, notes, recents); notes anchored to a fact key [W6-RM4/10, W7-5/11, W2-RM6].
- **G. Export engine.** Chart book (the dashboard), native PPTX charts in house style, full-company xlsx with a sources sheet [W6-RM5, W7-14/24].
- **H. Quality system as a feature.** `DataTable` + one formatter across 27 pages; zod schemas as data contracts; Playwright visual + axe; `/data` page with coverage matrix (17 × 9 layers × last period), `qa.json`, freshness per source, open licence and citation generator [W6-14/15/16, W5-R2, W1-18].
Also: terminal mode ≥ 1600 px with density modes; `/companies` folded into home; valuation opens on justified P/B, adds RI and P/(Equity+CSM), SOTP seeded from SOP; macro panel (BoI/CBS); presentations library + targets tracker; sector restatement log [W2-RM5, W4-R6, W1-12, W7-19/27/10/7].

Exit: the seven analyst jobs ≤ 3 taps; "7 insurers × any line × 5 years" is one URL; a view saved on the phone opens on the desktop; a chart book exports to PPTX with source footnotes.

### Phase 3 · Platform and data moat (quarter 2; ≈15–20 sessions + extraction waves)
- **Fact table with vintage + line taxonomy** (stable ids, additive flag, unit types incl. `shares`, IFRS 4↔17 bridge); every page a query; original vs restated per cell with both pages [W5-R1].
- **Report-Day Autopilot**: MAYA poll (headless) → PDF → budgeted extraction → gates → deploy → Web Push/FCM with headline deltas; "unverified" badge until checks pass; XBRL all 17 × ~20 concepts as the T+0 skeleton [W7-R1, W3-R1/R4, W5-R4].
- **Extraction waves (owner approval each, per the standing rule):** solvency reports 70 (≈0.4–0.5M tokens) → SCR by module; presentations 391 (≈0.6–0.8M) → targets, adjusted KPIs; SOP all periods (≈2.5M); liabilities schedules 356 (code only) → debt ladder; subsidiary statements (≈7M, lowest priority); Yelin LTS sources.
- **"Who owns whom"**: ownership tab from MAYA (interested parties, institutional %, fund holders over time); quarterly asset-list pipeline over the 17 manager sites → allocation, illiquid share, overlap, cross-holdings matrix [W1-R2/7/8].
- **Ask fox**: tool layer over the fact base exposed first as an MCP endpoint (zero API cost), then a grounded chat MVP (20 golden questions, model writes fact ids never digits, $50/month cap, allowlist) [W7-R6, W6-19].
- **Platform**: monorepo `packages/core` shared by web, functions and tests; content-addressed data + offline; pipeline DAG + pinned requirements [W6-RM1/RM2/25].
- **Regulatory layer and English mirror** (if the audience is confirmed) [W1-19/21, W6-17, W7-20].

Exit: a filing appears on the site with headline deltas within hours and no human in the loop; coverage matrix green on the XBRL tier for 17/17; restated/original toggle on every statement; MCP answers the 20 golden questions with page links.

## 5. Ten signature moves (why nobody can follow)
1. **Report Day as the front door** (home feed on phone, company index on desktop): restated-vs-original, movers, CSM movement, targets vs actual. Nobody renders an IFRS 17 report card; FactSet keeps restated series but shows no diff [T].
2. **Peer Table Builder** over 5,077 lines with formula columns and page links: Koyfin's mechanic over a taxonomy Koyfin lacks.
3. **Savings Lens + nowcast**: flows (regulator) × P&L (filings) on one axis; prodata has flows without P&L, EY has P&L without flows.
4. **CSM Ledger + Capital engine**: franchise value and dividend capacity across seven insurers; EY shows one quarter.
5. **Provenance-native export**: xlsx/PPTX/PNG that carry the filing page; Fiscal.ai sells auditability only on Max [T].
6. **Hebrew-aware search over every filing page** with an in-app reader.
7. **"Who owns whom"**: the ownership and asset-allocation graph of the 17 groups; ProData Capital sells this behind Tableau.
8. **Quality as a product**: public coverage matrix, `qa.json`, freshness SLA, open data with citations.
9. **Report-Day Autopilot** with push: the owner stops being the pipeline.
10. **Ask fox via MCP then chat**: numbers never written by the model, every answer a page link.

## 6. Kill list
Home mast and the 3-D icon set · aurora, spotlight, glass, blur page-in, hover lift, count-ups · duplicate search box and theme toggle · dead `light` theme · JetBrains Mono and Heebo 300/800/900 · `/market/*` as a second subnav · `/companies` as a separate page · `/industry/headline` · the IFRS 17 and industry "all rows" dumps (CSV instead) · DCF as the default valuation verdict · Yahoo Finance as a source · agent workflows (portfolio import, proposals, מסמך הנמקה) · mutual funds · any price strip.

## 7. Decisions the owner must make
| # | Decision | Recommendation |
|---|---|---|
| 1 | Report Day becomes the company home; 8 tabs → 4 | Yes |
| 2 | Retire the phoenix mast, 3-D icons and dark-theme effects; one design with two token sets (keep the phoenix mark, navy ink, ember accent) | Yes |
| 3 | Move the repo off Google Drive to a local clone + GitHub Actions (Drive keeps PDFs) | Yes, prerequisite for everything |
| 4 | Enable Firebase Auth (Google) in the console for cross-device sync | Yes, in Phase 2 |
| 5 | Extraction budgets: solvency ≈0.5M, presentations ≈0.7M, SOP all periods ≈2.5M, subsidiaries ≈7M, asset lists (code) | Approve solvency + presentations first; SOP next; subsidiaries last |
| 6 | AI: MCP endpoint first (no API cost), then chat with API key, Blaze plan, $50 cap | MCP in Phase 3; chat only after the eval set passes |
| 7 | Public vs private: the open-data/citation thesis needs the site indexable | Owner's call; roadmap holds either way |
| 8 | English mirror | Defer unless a foreign audience is named |
| 9 | Rewrite the benchmark set in PRODUCT.md (prodata → funds layer only) | Yes |

## 8. Budget and sequencing (estimates)
| Phase | Calendar | Build sessions | Build tokens (est.) | Extraction tokens (approval) |
|---|---|---|---|---|
| 0 | week 1 | 2–3 | 2–4M | — |
| 1 | weeks 2–4 | 6–8 | 10–15M | — |
| 2 | months 2–3 | 15–20 | 30–45M | solvency 0.5M, presentations 0.7M |
| 3 | quarter 2 | 15–20 | 30–45M | SOP 2.5M, subsidiaries 7M, asset lists code-only |
Basis: this review (7 agents, ≈2.0M tokens); RESUME precedents (36 agents = 6.5M for seven insurers' statements; 27 agents = 4.0M for six fund houses).

## 9. Risks
- Vintage model is a rewrite of `build_workbook.py` and the company store: generate today's JSON from the new table first, then move pages one at a time.
- Routing change breaks old `#/` links: keep the hash shim and redirects for a year.
- Service worker cache bugs: ship with a kill switch and the version banner.
- Taxonomy alias quality for the Series engine: ship with the 40 lines that already have roles, footnote everything else.
- MAYA polling needs headless Chrome and may rate-limit; never overwrite a verified period with an unverified one.
- Owner attachment to the current look: keep the phoenix mark and the deck palette; the clip-art goes.

## 10. Value-on-page sample
Random sample of 150 facts per live workbook (13 workbooks, 1,950 facts): 1,770 had page text available; 1,767 found on the cited page, 3 misses (99.8%): Harel RA Q3'25 p18, Menora AUM FY'23 p145, Ayalon total assets Q3'22 p52. The data asset holds; the leaks are presentation and vintage, not extraction.

## 11. Audit-3 status as re-verified live (22 Oct 2026)
Fixed: A1 per-share units, A6 stale solvency, A7 phone minus sign, A8 −100%, A11 empty LTM, A12 −0.0, A14 Mor duplicate, B1 extractor prose (profit/IFRS 17/industry), B4 fund-house tabs, B8 month select, B10/B11 valuation verdict + dated price, C5 density toggle, D4 entry animation on touch. Open: C1 period vocabulary (worse: eight forms), D1 market.json on every route, B2 control walls (worse on phone), B7 table below fold, B12 overview length (partly), E2 fund-house statements (Altshuler done), E7 sensitivities unseen, R1-27 Yahoo source, A15 fee jump (root cause is a regulator definition break), A4 blank totals (placeholder only), A2/A3 for fund houses, A5 across standard blocks.
