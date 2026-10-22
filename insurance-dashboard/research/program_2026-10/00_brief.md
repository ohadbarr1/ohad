# fox engagement brief (shared by every workstream)

## The client and the mandate
- Product: **fox**, https://fox-research-il.web.app/ — a fundamental-research terminal for Israeli insurers (8) and long-term-savings managers / fund houses (9). Hebrew-first, RTL. Built by one owner: a CPA / professional investor (alternatives + listed equities), MBA, B.Sc. statistics. Impatient with prose, fluent in IFRS 17.
- The owner's ask, verbatim in spirit: "employ a startup consulting team… McKinsey-analyze the whole site… major flaws, design uplift, major feature additions, radical changes to existing pages… I want to actually compete with the top-tier sites and services (prodata.co.il, app.koyfin.com, etc.) but with **no paywall and no paid data** — only what is publicly available. No one can beat us: not on style, not on features, not on usability, on mobile and on desktop."
- Goal of the engagement: an enterprise-grade, phased upgrade plan. Your workstream feeds a McKinsey-style synthesis (verdict → evidence → options → phased roadmap). Be concrete, ranked, evidence-based. No flattery. No padding.

## Hard constraints (never propose against these)
1. **Fundamentals only.** No stock-price quotes, tapes, tickers-with-prices, or market-data streaming anywhere in the product. Price may appear only as a *labelled input* on valuation pages. (Owner decision.)
2. **Free data only.** data.gov.il (CMA: גמל-נט, פנסיה-נט, ביטוח-נט), company IR PDFs, MAYA/Magna filings (XBRL), Bank of Israel, CBS, public websites. No Bloomberg/FactSet/CapIQ/Refinitiv/paid APIs.
3. **Never fabricate numbers.** Everything on the site carries a source page; keep that bar.
4. Period language: `Q2'26`, `FY'25`, `H1'26`, `LTM`; comparisons YoY / QoQ / YTD. Never ISO dates in UI, never "אשתקד".
5. Vocabulary: "פוליסות חיסכון" = pure investment contracts (IFRS 9) only; anything with a risk component = "ביטוחי מנהלים" (IFRS 17).
6. Brand (from PRODUCT.md): "precise, warm, alive". Investment-bank density with modern-product confidence (Linear, Fiscal.ai). Anti-references: Power BI / EY InsurTool look; generic "AI dashboard" (navy+gold, glass cards, gradient hero metrics); Bloomberg cosplay (neon on black, monospace everywhere). Principle: "a number, a chart, a source; no explanatory prose in the UI."
7. **Read-only engagement.** Do not edit anything under the repo. Write only inside the scratchpad `reports/` and `shots/` folders.

## What exists (so you do not rediscover it)
- Repo: `/Users/ohadbar/Library/CloudStorage/GoogleDrive-thebarrs14@gmail.com/My Drive/Chief of Staff/Fox/ohad/insurance-dashboard/` (Google Drive–synced: file reads can be slow; avoid `find`/`du` over `data/` and `node_modules`).
  - `web/` React 18 + TypeScript + Vite + ECharts, **HashRouter** (URLs are `/#/…`; plain paths 404 on Firebase). ~9.1k lines in `web/src`. Pages in `web/src/pages`, chart engine `web/src/lib/foxchart.ts`, styles `web/src/styles.css` + `web/src/styles/*.css`. Themes: `phoenix` (default, light navy/ember) and `dark` (obsidian) via `localStorage.theme2`.
  - Data: static JSON under `web/public/data/` (≈1,650 files) built by `pipeline/*.py`. Full primary statements for 7 insurers (quarterly Q1'20→Q2'26) and 6 fund houses; IFRS 17 CSM bridges; sources of profit; solvency; regulator fund data monthly since 1999 (1,251 funds); provenance per number (`prov/`); long-term-savings sector comparison (`lts.json`).
  - Docs worth skimming: `PRODUCT.md` (brand/principles), `RESUME.md` (state log, Hebrew), `research/top_tier_audit_3.md` (the last audit, 12 Oct 2026, score 7.0/10 — read it; verify live whether its items are fixed; do NOT just repeat it), `research/koyfin_teardown.md`, `research/fiscal_teardown.md`, `research/qualtrim_teardown.md`, `research/product_review.md`, `research/spec_ai_chat.md` (AI chat spec, not built).
- Routes (prefix `https://fox-research-il.web.app/#`):
  - `/` home · `/companies`
  - `/company/:id` tabs: `` (overview), `/review`, `/financials`, `/report` (report day), `/profit` (sources of profit), `/ifrs17`, `/savings`, `/filings`. Insurer ids: phoenix, harel, migdal, clal, menora, hachshara, ayalon, idi. Fund houses: meitav, altshuler, more, more_gemel, analyst, yelin, infinity, globalnet, ibi.
  - `/industry/sectors` (default) · `/industry/savings` · `/industry/ifrs` · `/industry/matrix` · `/industry/lines` · `/industry/csm` · `/industry/econ` · `/industry/capital` · `/industry/headline` · `/industry/search`
  - `/funds` · `/funds/makers` · `/funds/:k` · `/managers` · `/market/overview` · `/market/ranking` · `/market/funds` · `/market/group/:name`
  - `/valuation` · `/valuation/phoenix/dcf` · `/valuation/phoenix/sotp`
- Named competitors/benchmarks: prodata.co.il (Israeli, paid; study it hard — we have NO prior research on it), Koyfin, Fiscal.ai, TIKR, Qualtrim, StockUnlock, Finchat, Simply Wall St, Stratosphere, Bizportal, FUNDER (Israeli funds), TASE website/Maya, Globes/TheMarker tools, EY InsurTool (sector dashboards). Only claim what you actually verified ([V]) vs. second-hand ([T]) vs. judgment ([J]).

## Tooling for looking at the live site (parallel-safe; use these, not the shared browser pane unless your brief says so)
Scratchpad: `/private/tmp/claude-501/-Users-ohadbar-Library-CloudStorage-GoogleDrive-thebarrs14-gmail-com-My-Drive-Chief-of-Staff-Fox/ddbecc2f-d45a-4b6f-afc0-2413e74bec87/scratchpad`
- `./shot.sh <url> <width> <height> <out.png>` — headless Chrome viewport screenshot (fonts + charts render; takes ~10 s). Example: `./shot.sh "https://fox-research-il.web.app/#/company/harel/financials" 1440 900 shots/ws2_harel_fin_1440.png`
- `./shotfull.sh <url> <width> <out.png>` — same with a 4000 px tall window (pseudo full-page; good for measuring page length).
- `./dom.sh <url> [width]` — dumps rendered DOM HTML to stdout (grep text, count controls, find ISO dates, English leaks, etc.).
- View a PNG with the Read tool. Prefix your screenshot filenames with your workstream id. Headless Chrome cannot click; for interaction evidence, read the source in `web/src/pages/*.tsx` or reason from the DOM. Mobile = 390×844; desktop = 1440×900 (also try 1920×1080 for density).
- For competitor sites, `shot.sh`/`dom.sh` work on any public URL; WebFetch/WebSearch for docs, pricing, feature lists. Paid tools' logged-in areas are not reachable; say so rather than guess.

## Output contract (every workstream)
Write `reports/<ws-id>.md` (English, markdown) with exactly these sections:
1. **Verdict** — 3–6 sentences. Score your area 1–10 today, and name the best competitor's score with a [V]/[T]/[J] tag.
2. **Findings, ranked by damage** — numbered `W<ws>-<n>`. Each: one-line claim · evidence (route, screenshot file, DOM quote, source file:line, or competitor URL) · why it matters to the analyst job · fix (concrete) · effort S/M/L. Minimum 15, maximum 40. New findings over repeats of audit 3; if you re-raise an audit-3 item, say "A3-xx still open" with fresh evidence.
3. **Radical moves** — 3–6 bold, page- or product-level changes (merge/kill/re-architect pages, new primitives). For each: what, why it beats the named competitor, what it costs, risks.
4. **Quick wins (≤ 1 day each)** — bullet list, ≤ 12.
5. **What top tier does that we don't / what we do that nobody does** — two short lists, with [V]/[T] tags.
6. **Inputs to the roadmap** — your items grouped into Phase 1 (2 weeks: fix + polish), Phase 2 (1–2 months: level-jump features), Phase 3 (quarter: platform/data), with dependencies you see across workstreams.
Then return to the orchestrator a ≤ 350-word summary: verdict, top 5 findings, top 2 radical moves, and the report path. Do not paste the whole report back.
