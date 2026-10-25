# fox · round 2 review (25 Oct 2026)

Nine lanes (7 cylinder re-grades, a horizons lane, a free-data scout), ≈2.1M tokens. Reports beside this file; evidence under `shots/`.

## 1. Bottom line
fox went from **5.8 to 7.3** in three days: the fact base, provenance, exports and phone basics are now best in class for this niche (no competitor scores above 4 on Israeli insurance/LTS depth). What separates it from 9.0 is no longer data or features. Five things hold it back: **nobody can find or quote it**, **it has news four times a year while analysts work daily**, **it looks like a well-kept admin panel**, **its operations are not yet trustworthy at speed** (CI red and bypassed, a WebKit crash on company pages), and **coverage holes in the newest layers**. The evolution answer: fox should become **the reference of record for Israeli insurance and long-term savings: an analyst that reads every filing first, tells you what changed, lets you test what-if, and travels into other people's models and articles**. It should not try to become a broad platform.

## 2. Scorecard
| Cylinder | R1 | R2 | Best competitor | What still caps it |
|---|---|---|---|---|
| Strategy / positioning | 6.0 | **7.0** | Quartr ≈8 (reach) | `noindex` on every path, one shell for every URL, embeds blocked, no analytics, PRODUCT.md says one user |
| Desktop UX / IA | 6.5 | **7.8** | Koyfin ≈8.5 | 9 orphan pages, search finds data not places, 1440 layout at 1920, peers 49 controls before data |
| Mobile UX | 5.0 | **6.8** | StockUnlock ≈8 | WebKit crash on company pages (P0), paginated chart legends, long pages, 188 small taps |
| Visual design | 6.0 | **6.8** | Fiscal.ai ≈8.5 | same card everywhere, 66 controls before the first table, colour on levels, unframed charts |
| Data integrity | 6.5 | **7.8** | Fiscal.ai/Koyfin ≈8.5 | gate skips new layers, solvency stale for 5/7, freshness falsely green, Phoenix links break |
| Engineering | 5.0 | **7.2** | Koyfin ≈8 | CI red 7 pushes and bypassed, live ≠ git, cache bug after deploy, no telemetry |
| Workflows / features | 5.5 | **7.4** | Koyfin 8.5 | autopilot off, no alerts, sync off, nothing new between seasons |

64 figures spot-checked against their source page (row, column, period): **0 value errors**.

## 3. Root causes (round 2)
1. **Hidden.** `X-Robots-Tag: noindex` on every path, `/robots.txt` serves HTML, every URL returns the same 1.8 KB shell titled "fox", `X-Frame-Options: DENY` — Google sends "Harel financials" to stockanalysis and TipRanks [ws1].
2. **A quarterly product for a daily job.** Autopilot built but off; data.gov.il already has 09/26 while fox shows 08/26 (and calls it fresh); no alerts, sync off, "since last visit" is one global date [ws1, ws5, ws7].
3. **Admin-panel look.** Lead-first screens missing; 17 font sizes against an 8-step scale; 100 green cells vs 1 red on /funds; charts without a frame or stamped source [ws4, ws2].
4. **Trust at speed not yet earned.** CI fails on every push since 23.10 (an autopilot test needs duckdb) and `deploy.sh` ignores it; four live data files are uncommitted; a missing hashed chunk returns HTML with a 1-year cache; company pages crash in WebKit from a destructuring loop in `lib/company.ts` [ws6, ws3].
5. **Coverage holes in the new layers.** Solvency current only for Harel and Migdal; ownership 1/14; holdings 5/≈20; 6,501 Phoenix cells cite fnx.co.il links that now redirect to an error; no vintage tracking in IFRS 17 notes [ws5].

## 4. Fix this week (P0, before anything new)
1. WebKit crash: indexed loops in `CompanyStore` (+ `exportCompany.ts`, `lts.ts`); WebKit phone project in Playwright CI; confirm on the owner's iPhone.
2. CI as the only door to live: fix the autopilot fixture, one Python, deploy from green CI only (needs a Firebase service-account secret from the owner); commit generated data before deploy.
3. Cache contract: rewrite only extensionless paths, `no-cache` on HTML, real 404 for missing assets/data, reload on `vite:preloadError`.
4. Gate every published layer (solvency, adjusted KPIs, targets, decks via `verify_onpage`; debt into `qa.json`); upstream-aware freshness; honest coverage matrix.
5. Re-source the Phoenix cells to MAYA; weekly link check.

## 5. Path to 9.0 per cylinder (condensed)
- **Strategy:** go public (sitemap, prerendered HTML per route, one OG card per URL), `/embed` routes, RSS/Telegram/email rails, cookieless analytics, rewrite PRODUCT.md around four segments (analysts, industry insiders, journalists, allocators).
- **Desktop:** every route in a section; search returns destinations and actions; terminal width ≥1600; peer-table control diet; in-page index on the company home; one export pattern.
- **Mobile:** crash fix + WebKit CI; phone chart mode (lead series, grey peers, chips); one share button per chart; one-line company header; stale-while-revalidate data cache; page-length caps; install prompt + push.
- **Design:** lead-first screens with one toolbar row; table grammar v2 (28/34-px rows, sparklines); colour only on deltas; one control grammar, no native selects; type-scale gate; ChartFrame with stamped source; deeper dark plates; skeleton/empty/404 states.
- **Data:** gate all layers; solvency from IR sites (≈0.3–0.4M tokens); vintage for IFRS 17/solvency/decks; Phoenix re-source; autopilot T+0 with "לא מאומת"; public errata log.
- **Engineering:** CI-only deploys; Linux baselines + perf budgets; kill layout shift (one overview file per company); cache contract; free telemetry; then content-addressed data, data off Drive, Dependabot, Vitest on the shared engines.
- **Workflows:** autopilot on a season schedule; Web Push; sync on; per-company "since you last looked"; living chart book; remote MCP with full tool parity.

## 6. Where fox can evolve (options, all free-data)
**A. Reference of record (data utility)**
- A1 *FRED for Israeli LTS*: ≈5k prerendered, citable, embeddable series pages (company × metric, every fund) [ws1].
- A2 *Live Link*: versioned `/api/v1` CSV/JSON with doc+page per row, Excel/Sheets recipe, quarterly Zenodo DOI, CC BY [h1, ws6].
- A3 *The whole market*: the CMA statements database `insurancedata.cma.gov.il` — ≈30 insurers since 2002 (incl. unlisted Libra, Wesure, Shirbit, AIG), managing companies since 2011, funds since 2012, line-of-business quarterlies — as a labelled regulator layer [h2].
- A4 International benchmarks: EIOPA Solvency II stats, OECD pensions, BoI institutional series [h2].
**B. The analyst that reads the filing (intelligence)**
- B1 *Report-day wire + note writer*: a numbers-only report card within hours, then a sourced "what changed" note; digit validator against the fact table; first season owner-approved [h1, ws1, ws7].
- B2 *Fundamentals alerts*: filing, restatement, solvency headroom, regulator flows — Telegram channel first, Web Push next [h1].
- B3 *Stress lab*: rates/equity/lapse sliders over the 248 disclosed IFRS 17 sensitivities and 75 solvency sensitivities; headroom vs board target and dividend capacity [h1].
- B4 *Preview engine*: Q-to-date variable management fees from ביטוח-נט monthly returns, with a published backtest and a preview-vs-actual scorecard [h1].
- B5 *Management credibility ledger*: score the 207 extracted targets against printed actuals — hit rate per company and management team [ws5].
- B6 *Capital-generation engine*: own-funds generation, SCR drift by module, transitional run-off, dividend capacity [ws5].
**C. The Wire & regulation**
- C1 Daily feed of MAYA immediate reports (ratings, bond issues, dividends, M&A, officers), CMA circulars and BoI decisions, each linked to the figures it changes [ws7] — *depends on TASE permission, see §8*.
- C2 Regulatory tracker on Knesset OData + CMA circulars, as markers on every affected chart [h1, h2].
- C3 Conduct scorecard from the CMA complaints report and service index [h2].
- C4 M&A precedents (price per ₪bn AUM, implied P/B) from business-combination notes in the 108k-page corpus [h1].
**D. Workspace & reach**
- D1 Desk mode ≥1600 px (statement · chart · source PDF · notes, saved layouts) [ws2, ws4]; search as the navigation spine with actions [ws2].
- D2 Tear sheet per company (A4/16:9), CFO-office peer pack, auto-published seasonal chart book [ws4, h1].
- D3 Journalist kit: embeddable cards with a fixed source footer, "chart of the week" [h1].
- D4 Hosted Ask-fox MCP (claude.ai/phone, zero model cost to fox) [ws6, ws7].
- D5 Moonshots: IFRS 17 academy on real filings; climate/concentration from holdings; verified-professional annotations; a savings transparency tool as a separate sub-brand ("השוואה, לא המלצה") [h1].
**Do not build:** a paid-API chat in the site, fund star ratings (advice line), price alerts.

## 7. Recommended sequence
1. **Season-ready (now → 20.11, Q3'26 season):** §4 P0; autopilot on a schedule with "לא מאומת"; Telegram channel + Web Push (B2); sync on + "since you last looked"; report card per filing (B1 v1); design items 1–4; WebKit CI. Target ≈8.5 on every cylinder.
2. **Reference of record (Dec–Jan):** go public + A1 pages + OG cards + embeds; A2 Live Link; B3 stress lab; B5 credibility ledger; A3 CMA database; solvency from IR sites. Target 9.0+.
3. **Intelligence & reach (Q1'27):** B1 notes, B4 preview, C2 regulatory tracker, D1 desk mode, D2 tear sheets, D4 hosted MCP, A4 benchmarks.
4. **Moonshots (2027):** D5, C3, C4, holdings to all managers.

## 8. Owner decisions
1. **Go public?** (drop noindex; A1, D3, growth loops depend on it).
2. **Who is fox for?** Rewrite PRODUCT.md from "one user" to four segments; consumer tool only as a sub-brand.
3. **Autopilot:** schedule (Mac launchd or GitHub Actions) and a per-season extraction budget.
4. **Firebase:** enable Auth (sync); add a service-account secret (CI deploys); Blaze plan only if the hosted MCP is wanted.
5. **TASE permission:** MAYA and TASE `robots.txt` disallow `/api/` without explicit permission; the filings, XBRL and price fetchers use it, and ownership is blocked. Write to TASE before C1 and the ownership layer scale up.
6. **Extraction:** solvency reports from IR sites (≈0.3–0.4M tokens).

## 9. Effort (estimate)
Season-ready ≈ 8–12 build sessions (≈15–20M tokens incl. agents); reference-of-record ≈ 10–15 sessions; intelligence & reach ≈ 15 sessions; extraction per season ≈ 0.5–1M tokens.
