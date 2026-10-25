# r2-ws5 · Data integrity & coverage (25 Oct 2026)

Method: live JSON is byte-identical to the repo for every file used (qa, coverage, facts, solvency, targets, adjusted, restatements, debt, lts). Figures were checked against the in-app reader text (903 docs, 108,042 pages). Three checks are independent of fox's own pipeline: PNG renders of image-only PDF pages, MAYA `.htm` fetched from mayafiles, and the data.gov.il CKAN API. Scripts and renders are in `scratchpad/r2ws5/`; shots are in `round2/shots/r2-ws5/`. [V] = verified by me, [T] = inferred.

## 1. Grade: **7.8 / 10** (round 1: 6.5) · best comparable Fiscal.ai/Koyfin ≈ 8.5 [T]

The figures that are published are correct. The grade is capped by incomplete coverage, a freshness signal that can mislead, and new layers that sit outside the gate.

1. **Spot-check: 64 figures, 0 value errors [V].** For each figure I matched row, column and period from the page header, not just the number's presence on the page. The sample:
   - statements: 18, all 13 companies, 5 restated cells;
   - IFRS 17: 6;
   - solvency: 13, of which 8 image-page values checked on a render of Hachshara solvency p17;
   - decks and targets: 8, including an image-read CSM waterfall (Hachshara Q2'26 p12);
   - debt: 8 cells of Harel's ת126 against MAYA `H1766122.htm`;
   - regulator: 3 values for fund 103, 08/26, against the API;
   - restatements: 8 prints (4 pairs, both prints on their pages).

   Only 2 defects turned up, both labels (gap #9).
2. **The vintage model is real [V].** The grid has a "מעודכן / כפי שדווח לראשונה" toggle (`phoenix_1440_company_clal_financials.png`). The fact table keeps every print, and `restatements.json` holds 1,302 pairs. Example: Yelin FY'25 pre-tax profit 306,276 → 371,277 (FY'25 report p103 → Q2'26 report p34).
3. **The gate blocks deploys [V].** `deploy.sh:18` runs `gate.py`: 21 checks, 17 pass, 4 warn.
   - IFRS 17 value-on-page: 16,340 of 16,366.
   - Balance identity (A = L+E): 240 dates.
   - Cross-page consistency: 26,154 pairs, 0 contradictions.
   - Latin labels, placeholder labels, Q4/H2 derived on balance lines, share-count units: all 0.
   - Round 1's W5-1/2/3/6/7/15/22 are closed.
4. **The gate is blind to the Phase-3 layers [V].** It has no check on solvency (1,796 cells), adjusted KPIs (138 points), targets (207), ownership, macro or fund ratios.
   - `verify_onpage.py` exists but is not called by the gate.
   - The debt self-check (809/809 tables) never reaches `qa.json`.
   - The `assets` check reports "pass" even when its rebuild step was skipped.
   - The image flag is set per value, not per page: on the image-only Hachshara p17, 2 values carry it and 6 do not.
5. **Solvency layer stale for 5 of 7 insurers [V].** Latest Solvency II report extracted:

   | Insurer | Latest date | Note |
   |---|---|---|
   | Harel, Migdal | Dec-25 | current |
   | Hachshara | Dec-23 | |
   | Phoenix, Clal, Ayalon | Jun-22 | |
   | Menora | Jun-19 | no SCR modules |

   Since 2022 these insurers publish solvency reports on their IR sites, not MAYA. As a result, the `/industry/capital` sensitivity table puts Q4'21, Q4'23 and Q4'25 side by side as one "industry" view (`cap_dom.html`).
6. **Freshness reads green while fox is a month behind [V].** data.gov.il serves 202609 today for all three CMA datasets; fox shows 08/26, last read 09.10.26. fox's SLA measures days since its last read (16 ≤ 35, green), not whether newer data exists upstream. CBS has no data at all ("–") and still shows "בתוך היעד". MAYA is correctly red: Hachshara and Ayalon Q2'26 full text are still missing.
7. **25% of Phoenix cells cite a non-MAYA source [V].** 6,501 of 26,336 current cells cite the insurance company's report on `fnx.co.il`.
   - From here that URL redirects to `error.fnx.co.il`, even with a browser user agent.
   - The source has no publication date, so as-of views cannot place these cells.
   - It is not in the reader, so these cells are never page-checked.
8. **The coverage matrix overstates coverage [V].** `/data` shows "95% · 115/121" over 10 layers (`phoenix_1440_data.png`).
   - It omits solvency, decks, debt, ownership (Harel only), holdings (5 managers) and macro.
   - It drops n/a cells from the denominator.
   - Holes it does not surface: Hachshara (no SOP), More Gemel (no statements), Meitav (no docs or full text), IBI (no LTS or regulator data), Infinity and Globalnet (regulator data only), Ayalon (debt stops at Q1'23).
9. **Vintage gaps remain [V].**
   - Additivity across reports still fails on 166 insurer cells and 124 fund-house cells.
   - The IFRS 17 layer has no vintage. CSM continuity (opening = prior closing) passes 172 of 177 joins; 5 break.
   - Example: Harel net CSM at 31.12.24 is 16,548 in every 2025 report but 16,358 in the Q1'26 bridge (p16). There is no restated flag.
   - 551 files have no schema contract.

## 2. Gap to 9.0+ (ranked)

| # | Change | Effort | Dep. | Test |
|---|---|---|---|---|
| 1 | Gate every published number: `verify_onpage` for solvency, adjusted, targets and decks; debt check into `qa.json`; image values need a recorded second read, with the flag set per page; a skipped check is a warning, never a pass | S–M | – | 100% of numeric files page-checked, rebuild-checked or under contract; 551 → 0 |
| 2 | Solvency reports from IR sites (Phoenix, Clal, Menora, Ayalon, Hachshara; FY'22–FY'25 and H1s), spec v8 | M; ≈25 reports, ≈0.3–0.4M tokens (estimate; owner approval) | per-site fetcher | every insurer has SCR modules, tiers and sensitivities at 2025-12-31; one date per comparison |
| 3 | Upstream-aware freshness: poll data.gov.il max `REPORT_PERIOD`, MAYA filings and IR pages; the SLA clock starts at upstream availability; no data = red | S | – | 202609 upstream vs 08/26 in fox for more than 5 days turns red; CBS "–" is red |
| 4 | Vintage for IFRS 17, solvency and decks; CSM continuity gate; derive Q4/H2 within one vintage | M | facts model | 177/177 joins pass or are flagged; additivity warnings 166/124 → 0 under "latest" |
| 5 | Re-source the 6,501 Phoenix cells to the MAYA filing (the insurance company files there as a bond issuer); weekly link-check of all sources | S–M | – | 0 current cells without report id + publication date; 0 dead source URLs |
| 6 | Honest matrix: 16 layers, n/a explicit, applicable layers kept in the denominator | S | 1 | % recomputed (expect ≈ 70%), then driven up |
| 7 | Close the holes in finding 8; holdings for all ≈20 institutional bodies; ownership snapshot quarterly (manual where MAYA blocks automation) | M–L | 2, 6 | all applicable Q2'26 cells green before the Q3'26 season |
| 8 | Report-day autopilot ON: XBRL T+0 skeleton, PDF detail within 72 h | M | 3 | median report-to-site ≤ 24 h (KPIs) and ≤ 72 h (statements) across Q3'26, timed from MAYA timestamps |
| 9 | Label hygiene: show the latest print's caption; read "מכירות (רכישות) נטו"-type captions as signed. Sample defects: IBI "משרותי בורסה ודמי ניהול" (page: "מפעילות"); Clal "רכישות נטו" holding +1,302 net *sales* | S | taxonomy | 0 captions differ from the latest print without an alias chip |
| 10 | QA history: `qa.json` kept per build plus a public errata log | S | 1 | `/data` shows 90-day gate history; every fix has an errata row |

Items 1, 3, 5 and 6 (about a week) get this cylinder to ≈ 8.5; items 2, 4 and 8 get it past 9.

## 3. Bold options: the layers that make fox *the* reference fact base

**A. Management-credibility ledger.**
- *For:* PMs, credit analysts, press.
- *Why it is open:* 207 targets are already extracted with page cites, but 25 of the 29 whose horizon has passed are still marked "open". Example: More's 2019 EBITDA guidance of 46–56 was never scored [V].
- *Build:* score each target against the printed actual; hit rate per company and per management team, slippage in quarters, revision count.
- *Data:* existing targets, statements and solvency.
- *Risk:* score numeric targets only.
- *Cost:* S–M.

**B. Capital-generation engine (complete Solvency II).**
- *For:* buy-side analysts covering the listed insurers.
- *Why it is open:* brokers keep this inside paid notes [T].
- *Build (after gap #2):* organic own-funds generation, SCR drift by risk module, transitional run-off to 2032, dividend capacity above the board target, and rate shocks applied to the BoI zero curve.
- *Data:* IR solvency reports (phoenixfinancial.co.il, clalbit.co.il, menoramivt.co.il, ayalon-ins.co.il, hachshara.co.il), plus BoI SDMX (`edge.boi.org.il`).
- *Risk:* bases differ across insurers, so footnote each one.
- *Cost:* M.

**C. Point-in-time fact service.**
- *For:* quants, academics, auditors, journalists.
- *Why it is open:* no free source offers per-cell, as-reported vintages of Israeli insurers' filings with a page [J].
- *Build:* "what was known on date X" from the existing fact table: as-of snapshots, stable fact ids, a citation generator, quarterly CSV/Parquet bulk files, and as-of answers in Ask-fox.
- *Risk:* check TASE/MAYA redistribution terms before bulk files [T]. Facts with links are low risk; mirroring PDFs is not.
- *Cost:* S–M.

**D. Institutional look-through ("who owns what").**
- *Build:* `/holdings` for every institutional body, from the uniform quarterly asset lists (CMA circular 2015-9-14); reverse lookup by issuer, concentration, illiquid share, quarter-on-quarter changes.
- *Fit:* fundamental, not market data.
- *Risk:* many per-site fetchers; polite crawling.
- *Cost:* L.

**E. Rates nowcast (labelled אומדן).**
- *Build:* combine the BoI curve move since quarter end with the 75 solvency and 256 IFRS 17 sensitivities already extracted. Estimate the band of the insurance-finance result and the CSM interest effect before report day, then publish the estimate against the actual.
- *Risk:* it must stay visually separate from facts.
- *Cost:* M.

**F. CMA market-statistics layer.**
- *Build:* premiums and claims ratios by line, market shares back to 2005, from the CMA annual reviews. This gives the 8-insurer view a whole-market denominator, EY InsurTool's core asset [T].
- *Cost:* M (≈50k tokens per year, estimate).
