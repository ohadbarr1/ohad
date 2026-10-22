# ws5 — Data quality and data strategy (fox)

Method. Live JSON pulled with curl from `https://fox-research-il.web.app/data/…` into the scratchpad (`ws5_live/`: 13 company workbooks, market, funds, lts, kpi, recon, lines, savings_econ, ifrs/ifrs_2025FY/ifrs_2026Q2, hist/series/sop/lts_prov per company) and scanned with `python3 -I` (`ws5_scripts/scan_wb.py`, `scan2.py`; full scan log `ws5_scan_full.txt`). Rendered DOM of 25 routes in `ws5_dom/`. Source-page checks against `data/work/<co>_<period>/he/pNNN.txt` (read-only). Tags: [V] verified by me, [T] second-hand, [J] judgment.

## 1. Verdict

Provenance architecture is top-tier in intent (every statement cell links to a PDF page, regulator aggregates rebuild from 15,787 track-months with 0 differences, a reconciliation page that admits 49 unexplained gaps) — nobody in the Israeli market does this [J]. Execution is one level below: the statements explorer mixes vintages (as-originally-reported quarters next to H1/9M/FY from later reports) so 13.1% of IFRS-17-era "Q1+Q2 = H1" checks fail [V], 621 derived Q4/H2 cells sit on non-additive rows (share counts, opening cash) [V], a Jan-2026 definition break in ביטוח-נט fees is shown as "fees rose 0.45%→0.75%" [V], and label hygiene (134 English fragments, 24 "unlabeled row" placeholders, duplicate totals) still leaks to the screen. None of the checks that would catch these run at deploy; `npm run deploy` is build + firebase. Data score today: **6.5/10**. Best comparable on integrity: Fiscal.ai / Koyfin ≈ 8.5 [T] (vendor-normalised, restatement-aware, but with no Israeli-insurer depth); prodata.co.il unknown on integrity [T]. The moat to build is not "more extraction" but a fact table with vintage, a label taxonomy, deploy gates and a coverage matrix — then the free-source breadth (solvency reports, liability filings, XBRL for all 17, BoI, CBS) becomes compounding instead of one-off.

## 2. Findings, ranked by damage

**W5-1. Vintage mixing: quarters are as-originally-reported, cumulatives are as-restated, in the same row.** Evidence: `/#/company/harel/financials` P&L "הכנסות משירותי ביטוח" Q1'25 = 3,544.0 while Q2'25 = 3,532 and H1'25 = 7,092 (DOM `ws5_dom/company_harel_financials.html`); Q1'25 report p38 prints 3,544 [V], the Q1'26 report p41 prints the restated comparative *3,560 [V]; `restated[]` in harel.json records old 3,544,000 / new 3,560,000 but the cell keeps the old. Across 13 workbooks the fact value equals the *old* figure in 1,714 restated cells and the *new* in 27 [V]. Result: Q1+Q2 ≠ H1 in 459 of 3,511 IFRS-17-era row-years (13.1%; Clal 24.8%, Harel 15.0%, Hachshara 14.1%, Menora 13.3%, Migdal 11.9%, Phoenix 9.4%); H1+Q3 ≠ 9M in 350/2,624 (13.3%) [V]. The tab is captioned "הדוח המלא, לרבות מספרי השוואה שהוצגו מחדש", which is not true for the quarters. Why it matters: any analyst summing quarters, or computing LTM/YoY from the row, gets a number no report prints. Fix: store both vintages per (line, period) — `orig` and `latest` with the report id of each; default view = latest restated with a dot on changed cells and a toggle "כפי שדווח במקור"; derive Q4/LTM only within one vintage. Effort M (pipeline `build_workbook.py` + `Company.tsx`).

**W5-2. Q4/H2 derived (FY − 9M) on rows that are not flows.** 621 derived cells on non-additive rows across 13 workbooks [V]: Clal P&L "בסיסי" (weighted shares) Q4'25 = 101,000, Q4'24 = 37,000, "מדולל" Q4'23 = −2,000; "יתרת מזומנים ושווי מזומנים לתחילת התקופה" Q4 = 0 in every company; Harel OCI "מסים על הכנסה המתייחסים לפריטי רווח" H2'25 = 3,000 next to Q4'25 = −1,000. Rows render in italics ("נטוי = מחושב מהשנתי") so they look like figures. Fix: derive only for rows whose section is a flow statement and whose label is not a balance/count/ratio (regex + a per-sheet allowlist); print "–" otherwise. S.

**W5-3. Share counts stored ×1,000 and typed as NIS thousands.** Clal "מספר המניות ששימשו לחישוב הרווח למניה (באלפים): 80,862" on p61 of the Q2'26 report [V] is stored as 80,862,000 with `unit: k`, so the millions view prints 80,862.0 "מיליוני ש"ח" (reads as 80.9 bn shares); IBI "הממוצע המשוקלל של מספר המניות" 12,660,304 same path [V]. Fix: unit `shares` (never rescaled, no currency), tagged by label regex ("מספר המניות", "ממוצע משוקלל", bare "בסיסי/מדולל" under the EPS header); add to `check_workbook.py`. S.

**W5-4. ביטוח-נט fee definition break (Jan '26) shown as a fee increase — A3-A15 still open, with a different root cause.** Market-wide asset-weighted fee of the insurance family: 0.705–0.706% every month Jan–Dec '25, then 1.468% in Jan '26 and 1.446% in Aug '26; Phoenix policy_2004 0.700%→1.181%, Harel insurance 0.671%→1.149%, Menora 0.718%→1.284%, Ayalon 0.717%→1.146%, all in the same month [V, market.json]. Every insurer doubling fees in one month is a column/definition change at the regulator, not economics. Live impact: `/#/company/phoenix/savings` "דמי ניהול 0.75% vs 0.45% (Aug '25)"; `/#/companies` fee column (Phoenix 0.75%, Migdal 0.75%, Harel 0.45%); `/#/market/overview` "ביטוח מ-2004: 0.94%". Audit 3 blamed 2025 weighting; insurance rows exist for both years (176 months back to 2012). Fix: level-shift detector on every regulator ratio series (month-over-month jump > 3σ across ≥ 80% of groups ⇒ flag the series from that month, suppress YoY, show "שינוי הגדרה ברשות, 01/26" chip); show fee per family, never blended across pension/gemel/insurance. S for the flag, M for the family split.

**W5-5. More (מור) P&L: Q2'26 revenue block is empty and three total rows compete.** `/#/company/more/financials`: revenue lines ("מניהול קופות גמל", "מניהול קרנות נאמנות", …) show "–" for Q2'26 while a new line "הכנסות ורווחים: מפעילות 309.2" carries the quarter; "סה"כ הכנסות" has values only ≤ Q4'22, "סה"כ הכנסות ורווחים" only Q2'24/Q2'25; "סך הכול" and "סך הכל" (spelling variants) are separate rows with disjoint periods; "עליה"/"עלייה (ירידה) בזכאים" likewise in the cash flow [V, DOM + scan `renamed_twice` 6, `dup_near` 5]. A2/A3 fixed for insurers, not for fund houses. Fix: normalise spelling variants (הכול/הכל, עליה/עלייה, סה"כ/סך הכל) in `norm()`; alias a new line to the old one when the comparatives match; the "same figures twice" gate in `check_workbook.py` must include cash-flow sheets. S.

**W5-6. Menora: 24 rows captioned "(שורת ביניים ללא תווית)" / "[ללא תווית מודפסת]" carry values.** OCI and cash-flow sheets of menora.json; e.g. OCI Q2'23 = 732,954, Q2'22 = 115,366 [V]. Source p67 of the Q2'24 report prints the caption: "רווח (הפסד) כולל אחר, נטו 732,954 115,366 268,910" [V]. A3-A4 was closed by replacing blank labels with a placeholder string, not by recovering the caption. Fix: re-read captions for these rows from the page text (the label is on the same line as the numbers); until then drop rows with placeholder captions from the visible table. S.

**W5-7. English note text inside Hebrew labels: 134 rows.** Phoenix 42, Clal 33, Menora 27, Hachshara 13, Harel 9, Migdal 6, Ayalon 4 [V], all in the IFRS-17 summary/segment sheets ("X.תמצית_מאוחדת", "X.מגזר_בריאות"): "CSM: אחר: Note 21E effect of revision of estimates", "רכיב מימון ביטוח: Effects of changes in interest rates and other financial assumptions including inflation", "הכנסות: אחר: Experience adjustments from premiums received in the period relating to current or past service". The extractor stores the English label when the Hebrew map has no key. Fix: Hebrew label map for the ~40 distinct IFRS 17 reconciliation items (one-time, in `lib/labels.ts` / `build_workbook.EXTRA`); gate: any label with ≥ 3 Latin words fails the build. S.

**W5-8. ISO dates on the overview, the flagship page.** `/#/company/phoenix`: "יחס כושר פירעון 177.0% | 2026-03-31"; `/#/company/harel`: "170.5% | 2026-03-31"; "דיווחים אחרונים" lists "2026-09-03", "2026-08-25" [V, DOM]. Violates brief constraint 4 (`dateLabel()` exists in `lib/format.ts` and is simply not applied there). Fix: `dateLabel` → "Q1'26"; publish dates as "3 ספט׳ '26". S.

**W5-9. Same cash-flow line with opposite sign in the two standard blocks (A3-A5 partly open).** Phoenix "ריבית ששולמה": IFRS 17 block Q1'24 = −83,970 (flag 4, sign normalised), IFRS 4 block Q1'24 = +83,970 (as printed) [V]. On the "שורות רציפות" view the row crosses the break with a sign flip. Fix: apply the sign normalisation to the continuous view, or mark the convention per block. S.

**W5-10. Balance sheets that carry two values for one total.** Harel FY'24: "סך כל הנכסים" 156,296 (Q1'25 report p36) and "סך הכל הון והתחייבויות" 156,193 (FY'25 report p210, restated) in the same column [V]; Menora Q3'22 equity 5,933,381 (p63) and 5,905,868 (p60) [V]; Clal FY'23 A − L − E = −1,000 (rounding across millions/thousands). 3 of 347 balance dates [V]. The same vintage problem as W5-1 on the balance sheet. Also: Meitav, Analyst and IBI balance totals are not identifiable by label (0 dates checkable), so no balance gate can run on them. Fix: with W5-1; add "total assets = total L+E per vintage" to the gate. S.

**W5-11. Wrong page on a headline tile.** `/#/company/phoenix` "CSM ברוטו, ביטוח בריאות 7,328 · עמ׳ 120": in the cited PDF (P1765739, 221 pages) the number 7,328,717 is printed on p83, not p120 (no "7,328" on p118–122) [V]; the life tile "2,292 · עמ׳ 111" lands on p111 where the text layer shows "2,292,300" on the RA line [V, ambiguous]. `verify_fs.py` covers `extracted_fs` (100% on page per RESUME); the IFRS-17 layer behind these tiles has no equivalent "value on cited page" gate in the deploy path. Fix: run a page-text check for every `ifrs_*.json` fact (same code as `verify_fs.py`), fail the build on misses. S.

**W5-12. Coverage holes behind the cross-company pages.** IDI (ביטוח ישיר): `/#/company/idi` → "הדוחות טרם חולצו"; registry has 17 IDI documents incl. 4 XBRL, and `fetch_xbrl.py` excludes it (`company<>'idi'`) [V]. Meitav: 32 XBRL instances in `documents.csv` but absent from `kpi.json`, so `/#/company/meitav` shows no profit/equity/EPS tiles at all [V]. `lts.json` lacks IBI, IDI, Infinity, Globalnet; Hachshara has no sources-of-profit ("טרם חולצו"); `/#/companies` shows IBI as a row of dashes. Why it matters: an "8 insurers / 9 fund houses" claim where 2 of 17 have no fundamentals. Fix: XBRL for IDI and Meitav is a one-line change plus a rebuild; a coverage matrix (company × layer × last period) on the site, generated from the data, so holes are declared not discovered. S (XBRL) / M (matrix).

**W5-13. Fund-level ratios computed on empty series.** `funds.json`: 9 "בניהול אישי" (IRA) tracks with sd = 0, y12 = 0, a3 = 0 but Sharpe = −9.24 (Meitav, Globalnet, Phoenix …); 4 tracks with assets = 0 still listed [V]. Fix: Sharpe/alpha only when sd > 0 and ≥ 24 monthly returns; drop zero-asset tracks from rankings. S.

**W5-14. Regulator roster changes shown as growth.** `/#/companies`: Ayalon assets +107.9% YoY — insurance family 6,205 → 11,979 and a gemel family (921) that did not exist in Aug '25 [V]. Part is real sales, part is new fund ids entering the group. Fix: per group, flag months where a fund id first appears/disappears and show "כולל קופות חדשות במאגר" on YoY. S.

**W5-15. No deploy gate; the gates that exist do not cover what breaks.** `web/package.json` `deploy` = `npm run build && firebase deploy`; no `.github/workflows`; `check_workbook.py`, `verify_prov.py`, `check_fs.py` are manual [V]. `check_workbook.py` tests per-share range, blank labels and "same figures twice" on P&L/balance only; nothing tests additivity (W5-1), derivation on stocks (W5-2), share units (W5-3), English/placeholder labels (W5-6/7), balance identity (W5-10), regulator level shifts (W5-4). Fix: `pipeline/gate.py` running all checks and writing `web/public/data/qa.json` (market.json already has a `qa` block — extend the pattern), wired as `predeploy`. M.

**W5-16. Two values for one KPI across tabs (XBRL vs printed).** Clal Q2'26 EPS 7.64 (XBRL tile, "corrected") vs 7.63 printed on the statements tab; Hachshara 0.20 vs 0.21 [V, kpi.json vs workbook]. Small, but the "a number, a source" bar means one canonical value with the other as a footnote. Fix: when the printed statement exists, the tile takes the printed value and shows "XBRL: 7.64" in the source sheet. S.

**W5-17. Duplicate exact captions inside one sheet are frequent and unexplained.** 135 (Phoenix), 171 (Menora), 117 (Clal) exact-duplicate normalised labels per workbook [V]; most are legitimate (the same caption in an attribution block, IFRS 4/17 pairs), some are not (Clal "רכישת נדל"ן להשקעה" twice with 19 periods each). Fix: a `dim`/section key on every row so duplicates are addressable, and a gate that allows a duplicate only under a different section header. S.

**W5-18. Restatement panel is a list, not a signal.** Clal has 761 restated cells, Menora 297, Ayalon 255; the panel shows them only on demand and the main table does not mark which cells differ from the latest report (A3-A13 closed only for opening on the phone) [V, Company.tsx L479–490]. Fix: with W5-1 — dot on changed cells, count in the sheet header, sort panel by magnitude of change. S.

**W5-19. Solvency and capital are read from the financial statements, not from the 70 solvency reports already downloaded.** Registry: 70 solvency PDFs (Harel 34, Hachshara 27, Migdal 24, Phoenix 20, Ayalon 16, Clal 14, Menora 6); extracted facts contain `scr`, `scr_with_transitional`, own funds, ratios — no SCR by risk module (market, life underwriting, health, non-life, counterparty, operational), no own-funds tiering, no loss-absorbing capacity [V, grep over `data/extracted/*/2025FY.json`]. Why: capital is the valuation driver for Phoenix/Harel/Clal and the comparison nobody offers. Fix: spec v8 for the solvency report (≈ 25 facts per report, 70 reports ≈ 0.3–0.5M tokens). M.

**W5-20. "Liabilities schedule" filings (מצבת התחייבויות) — 356 in the registry, unused.** These quarterly filings give every bond series' balance, coupon, linkage and maturity ladder [V, documents.csv `liabilities`]. They are structured (htm), cheap to parse, and unlock a debt-maturity and interest-cost view per group. Fix: parse the htm tables (no LLM), new `debt.json`. S/M.

**W5-21. The 1,250-fund cube ships ratios without their denominators on the fund page.** `funds.json` is a point-in-time snapshot (202608) with precomputed y12/a3/a5/sd/sharpe; per-fund history is in `funds/g<id>.json` (1,251 files) but ratios cannot be re-derived for another window on the client [V]. Fix: store monthly return series + n per fund once (already there), compute ratios client-side for any window; delete the precomputed ones. M.

**W5-22. Cross-source checks are not run between layers.** XBRL profit vs statement profit vs SOP total vs savings_econ pre-tax are all present but never reconciled (I did it ad hoc: all 12 companies agree on Q2'26 attributable profit and equity to the thousand [V] — a free, strong gate that should run on every build). Fix: `gate.py` cross-layer block. S.

**W5-23. Period labels `H2`/`6M` exist in code but the data has no H2 periods; "I" periods masquerade as quarters.** `periodLabel()` prints a balance date as "Q2'26" — correct for the UI, but the fact store keeps `type: I` with `months: 0`; LTM on balance rows is undefined yet selectable in the sheet (Company.tsx L134 keeps "I" after LTM) [V code]. Fix: hide LTM for balance sheets. S.

**W5-24. Registry hygiene.** `data/registry/companies.json` maps `yelin` → `ATRY.TA` [V]; verify that symbol — the dividend-per-share tile on `/#/company/yelin` (8.83 ₪ LTM, Yahoo) depends on it [J: looks like a different issuer]. S.

## 3. Radical moves

**R1. One fact table with vintage, replacing 1,650 JSON views.** What: `facts.parquet`/DuckDB-WASM (or a sharded JSON built from it) keyed by (company, line_id, period, window, vintage_report_id, source_page) with a `label_map` table (line_id → Hebrew caption, section, additive?, unit, IFRS 4/17 bridge). All pages read views of it; the restated/original toggle, LTM, YoY, Q4 derivation and cross-company "lines" become queries, not builders. Why it beats Koyfin/Fiscal.ai: they show "as reported" vs "restated" as a vendor choice; fox can show both with the page of each, per cell — unique [J]. Cost: 3–4 weeks of pipeline + a thin client query layer; risk: a rewrite of `build_workbook.py` (435 lines) and `Company.tsx` store; mitigate by generating today's JSON from the new table first (zero UI change), then moving pages one at a time.

**R2. Checks as deploy gates + a public "Data" page.** What: `pipeline/gate.py` (additivity per vintage, balance identity, derivation allowlist, unit/typing, label hygiene, regulator level-shift, cross-layer reconciliation, value-on-page for every published fact) → `qa.json` → a `/data` route with a coverage matrix (17 companies × 9 layers × last period, with green/amber/red), the gate results, and freshness SLA per source (regulator monthly ~ day 20; MAYA quarterly; XBRL same day). Why: prodata/Koyfin do not publish their QA [T]; a terminal that shows its own test results is a trust moat an owner-operated product can afford. Cost: 1–2 weeks; risk: red cells are visible — that is the point.

**R3. Extract the three document families already in the registry but never read: solvency reports (70), liabilities schedules (356), presentations (391).** What: solvency spec (SCR modules, own-funds tiers, sensitivity of ratio to rates/equity), debt ladder parsed from htm, presentation KPIs (targets, ROE bridges, new business, AUM by channel) with slide-page provenance. Why: capital-by-risk-module across 7 insurers and a bond ladder per group exist nowhere free [J]; Fiscal.ai's "KPI from presentations" is its most-praised feature [T]. Cost: ≈ 1.0–1.5M tokens of Sonnet extraction (owner approval required per memory rule), 2–3 weeks; risk: presentations are non-GAAP and must stay visually separated ("מצגת" chip) — the lts layer already does this (`slide` flag).

**R4. XBRL for all 17 and a quarterly "XBRL-first" refresh.** What: every MAYA periodic report ships an XBRL instance with ~20 IFRS-full concepts; today 13 companies, 8 concepts. Extend to all tagged concepts (≈ 20), add IDI and Meitav, and use XBRL as the T+0 skeleton on report day with the PDF extraction filling the detail within the week. Why: report-day freshness with zero tokens; the "יום הדוח" page becomes live the morning of. Cost: days. Risk: filer tagging errors (the `fix` mechanism already handles them).

**R5. Macro and market-structure layer from BoI + CBS (free APIs, verified reachable).** What: BoI SDMX (yield curves, policy rate, CPI-linked curves, FX) and CBS (CPI, wages) as named series with provenance, feeding: discount-rate sensitivity context for CSM/IFRS 17, real-return decomposition for funds, the econ tab. Why: Koyfin's macro layer is a paid Fed/FRED-style feature [T]; here it is free and directly relevant to insurer P&L (interest-rate moves explain most IFRS 17 finance result swings). Cost: 1 week; risk: none material (public APIs; attribute BoI/CBS).

## 4. Quick wins (≤ 1 day each)

- Apply `dateLabel()` to the overview solvency chip and the documents list (W5-8).
- Add `shares` unit; tag Clal/IBI share-count rows; never rescale (W5-3).
- Derivation allowlist: no Q4/H2 for balance/count/ratio rows (W5-2).
- Replace "(שורת ביניים ללא תווית)" rows with the caption from the page line or hide them (W5-6).
- Hebrew label map for the ~40 IFRS 17 reconciliation items; fail the build on ≥ 3 Latin words in a label (W5-7).
- Remove `company<>'idi'` in `fetch_xbrl.py`; find out why `meitav` drops out of `build_kpi.py` (likely no `Assets` in `Current_AsOf` context) (W5-12).
- Level-shift flag on regulator ratio series; chip "שינוי הגדרה 01/26" on fee tiles; hide fee YoY across the break (W5-4).
- Sharpe/alpha only with sd > 0 and n ≥ 24; drop zero-asset tracks (W5-13).
- `norm()`: הכול/הכל, עליה/עלייה, סה"כ/סך הכל, comma-space variants (W5-5, W5-14).
- Wire `check_workbook.py` + `verify_prov.py` as `predeploy` in `web/package.json` (W5-15, first step).
- Value-on-page check for `ifrs_*.json` facts, reusing `verify_fs.py` (W5-11).
- Cross-layer reconciliation of Q2'26 profit/equity (XBRL = statement = SOP total) written to `qa.json` (W5-22).

## 5. What top tier does that we don't / what we do that nobody does

Top tier does, we don't:
- Restated vs as-reported as an explicit per-table switch (Koyfin, TIKR, Fiscal.ai) [T]; fox mixes them (W5-1).
- Segment and KPI data lifted from presentations with slide citations (Fiscal.ai "KPIs") [T]; fox has 391 presentations downloaded, one deck transcribed.
- Published data-coverage and freshness status per company (Koyfin coverage pages; S&P/FactSet "as-of" stamps) [T]; fox has none.
- Macro series integrated beside company data (Koyfin macro, TradingEconomics-style) [T]; BoI/CBS APIs are free and reachable [V].
- Typed line taxonomy with stable ids across companies ("standardised" statements) [T]; fox's `lines.json` has 29 roles for 13 companies — good start, not a taxonomy.
- Automated QA gates in CI before publish (industry standard) [J]; fox deploys on `npm run build`.

We do that nobody does (verified on fox; competitor absence is [J]/[T]):
- Page-level provenance on every statement cell, regulator aggregate rebuilt from tracks (15,787 cells, 0 diffs), reconciliation page admitting 49 unexplained gaps [V].
- Full IFRS 17 CSM bridges, sensitivities (256 facts) and expected-release schedules (644 facts) for 7 insurers with page cites [V]; no free or paid Israeli product shows this [J].
- Managing-company (not parent) long-term-savings P&L for 10 houses with formula-level provenance (`lts_prov`) [V].
- Monthly fund cube back to 2012 (1,251 funds) with pro-forma merger handling (Psagot→Altshuler) [V].

## 6. Inputs to the roadmap

Phase 1 (2 weeks: fix + polish): all quick wins above; W5-1 interim fix = mark cells that differ from the latest comparative and switch the default to "latest restated" for cumulatives and quarters alike (full vintage model in Phase 3); W5-9 sign convention across blocks; W5-10 balance identity in the gate; W5-16 canonical value rule; W5-24 registry check. Dependencies: ws6 for the predeploy wiring; ws2/ws4 for the chip/dot visual language of "restated/derived/definition break".

Phase 2 (1–2 months: level-jump features): R4 (XBRL all concepts, all 17, report-day skeleton); R3a solvency-report extraction (owner budget approval, ≈ 0.5M tokens) feeding a capital-by-risk-module industry page; R3b liabilities-schedule parser → debt ladder per group; R5 BoI/CBS series behind the econ tab and CSM sensitivity context; coverage matrix page (R2 part 1). Dependencies: ws1 for which views sell (capital, debt, presentation KPIs); ws4 for the data page design.

Phase 3 (quarter: platform/data): R1 fact table with vintage + label taxonomy (stable line ids, additive flag, unit type, IFRS 4/17 bridge) and all pages served from it; R2 full gate suite as the only path to deploy, qa.json published; freshness SLA (regulator ≤ 5 days after data.gov.il update; MAYA PDF ≤ 7 days after filing; XBRL same day) with a visible "last checked" per source; presentation KPI extraction (R3c) once the taxonomy exists so slide numbers land on typed lines. Dependencies: ws6 (storage/format: DuckDB-WASM vs sharded JSON, payload — phoenix.json is 1.98 MB, market.json 1.83 MB, funds.json 0.83 MB today); ws1 for prodata feature parity targets.

### Appendix A — audit-3 correctness items re-tested on live data (22 Oct 2026)

| Item | Status | Evidence |
|---|---|---|
| A1 per-share ×1000 | Fixed | 0 `nis` rows outside [0.01, 500] in 13 workbooks; Harel 5.20/5.10, Phoenix 3.58 [V]. New: share-count rows ×1000 (W5-3). |
| A2 renamed line twice | Fixed for Phoenix P&L; open for fund houses | More: "סך הכול"/"סך הכל", "סה"כ הכנסות"/"…ורווחים" (W5-5). |
| A3 punctuation duplicates | Mostly fixed | 5 near-duplicate pairs remain (Phoenix OCI ",נטו"; Menora CF; Hachshara CF; Meitav; Altshuler) [V]. |
| A4 blank-label totals | Closed by placeholder, not fixed | 0 empty labels; 24 Menora rows read "(שורת ביניים ללא תווית)" and carry values (W5-6). |
| A5 sign flips | Fixed within IFRS 17 block (flag 4 on 31 Phoenix cells); open across blocks | "ריבית ששולמה" Q1'24 ±83,970 (W5-9). |
| A6 stale solvency on capital tab | Fixed | `/#/industry/capital` Phoenix 177% Q1'26, Harel 170.5% Q1'26 [V]. Overview shows the date as ISO (W5-8). |
| A7 clipped minus on phone | Fixed | 390 px review DOM: "−5.5%", "−12.6%", "−63.1%" present [V]. |
| A8 −100% on missing line | Fixed | no "−100.0%" in `/#/company/phoenix/ifrs17` DOM [V]. |
| A9 CSM release sign | Fixed on the IFRS 17 tab | release −210 / −55 / −155 one convention [V]; review tab not re-checked for the gross lines. |
| A10 303 vs 304* | Not re-checked (profit tab DOM shows no table at 1440 without interaction). |
| A11 empty LTM columns | Fixed by code | Company.tsx L186 filters LTM columns without values [V code]. |
| A12 negative zero | Fixed | 0 "-0.0" in JSON; `nf()` strips the sign [V]. |
| A13 restatement panel on phone | Not verifiable headless; code renders inside Panel (L479–490). [T] per RESUME. |
| A14 Mor duplicate | Fixed | "מור גמל ופנסיה — חברה בת, נכללת בנתוני מור" sub-row [V]. |
| A15 fee YoY jump | Open; cause is a regulator definition break, not weighting | W5-4 [V]. |

### Appendix B — free sources not yet used (feature · feasibility · cadence · cost · terms)

| Source | Status | Unlocks | Feasibility | Cadence | Extraction cost | Terms |
|---|---|---|---|---|---|---|
| MAYA XBRL, all periodic reports, all 17 | 13 companies × 8 concepts used; IDI excluded, Meitav dropped [V] | Report-day KPIs for everyone; ~20 concepts (CFO, dividends, OCI parts) | High — `fetch_xbrl.py` exists | Quarterly, same day | None (parser) | TASE site terms: personal/non-commercial use clauses [T]; cite report id |
| MAYA solvency reports (70 downloaded) | Unused [V] | SCR by risk module, own-funds tiers, ratio sensitivities, dividend capacity | High (PDF, stable template) | Semi-annual | ≈ 0.4–0.5M tokens one-off, ~30k/quarter | As above |
| MAYA liabilities schedule (מצבת התחייבויות, 356 htm) | Unused [V] | Debt ladder, coupons, linkage, interest cost per group | High (structured htm, no LLM) | Quarterly | Code only | As above |
| MAYA insider/holdings filings (מצבת החזקות בעלי עניין), dividend notices, shares outstanding | Not fetched | Ownership map, float, ex-dates, buybacks — fundamentals, not prices | Medium (event families in the same JSON API) | Event-driven | Code only | As above |
| Company presentations (391 in registry) | 1 deck transcribed (lts) | Management targets, ROE bridges, new-business, AUM by channel, non-GAAP core profit | Medium (layouts vary) | Quarterly | ≈ 0.6–0.8M tokens one-off, ~60k/quarter | IR materials, public; mark "מצגת" |
| Earnings-call transcripts | None exist on MAYA; Phoenix/Harel post recordings only [T] | Guidance tracking | Low–medium (speech-to-text) | Quarterly | ASR + summarisation | Recordings are public; summarise, never reproduce |
| data.gov.il CMA: גמל-נט / פנסיה-נט / ביטוח-נט | Used; refreshed 22 Oct 2026 [V] | — | — | Monthly | — | Open data licence |
| data.gov.il CMA: asset lists (nechasimg/nechasimp/nechasimb/mishtatef) | Catalogue resources end 2017 [V]; current quarterly asset lists sit on each manager's site per CMA circular [T] | Portfolio look-through (holdings overlap, concentration, illiquid share) | Low–medium (per-site scraping, XLSX schema is standardised) | Quarterly | Code; large volumes | Public disclosure; aggregate, attribute |
| data.gov.il CMA: service index | Resources 2014–2016 only [V]; newer index on CMA site [T] | Service-quality score per insurer | Low value | Annual | Code | Open data |
| data.gov.il CMA: complaints / agents registers | No dataset found in the catalogue search [V] | — | — | — | — | — |
| Bank of Israel SDMX API (edge.boi.org.il) | Reachable, HTTP 200 [V] | Yield curves, policy rate, FX, CPI-linked curves → IFRS 17 finance-result context, real returns | High | Daily/monthly | Code | Public; attribute |
| CBS API (api.cbs.gov.il) | Reachable, HTTP 200 [V] | CPI, wages, demographics (longevity context) | High | Monthly | Code | Public; attribute |
| CMA annual report / industry statistics | Not used | Market-share history before 2012, premium by line, claims ratios industry-wide | Medium (PDF tables) | Annual | ~50k tokens/year | Public |
| TASE daily reports (shares outstanding, dividends ex-dates) | Only Yahoo dividends used (`fetch_prices.py`) | Payout, yield on book, share count for per-share lines | Medium (TASE public pages; DataHub API has paid tiers [T]) | Daily/event | Code | TASE terms: check redistribution clause [T] |
| Insurers' own websites (quarterly asset lists, solvency, embedded value where still published) | Partly (Phoenix xlsx, Harel P&G PDFs) | Fills gaps where MAYA lacks the managing-company report (Yelin bot-wall noted in RESUME) | Medium | Quarterly | Code + small LLM | Public |

### Appendix C — architecture gap vs. `pipeline/`

Today: one builder per layer (`build_workbook`, `build_series`, `build_ifrs`, `build_sop`, `build_savings`, `build_lts`, `build_hist`, `build_kpi`, `build_market`, `build_recon`) each writing its own JSON shape; labels are free text normalised per builder; provenance is a (page, url) pair per fact; verification scripts exist per layer (`verify_fs`, `verify_prov`, `verify_savings`, `verify_kpi_window`) but are not composed and not run on deploy; `check_fs.py` compares shared cells across reports (the right idea — it found the vintage conflicts I report) but its result is a console line, not a published artefact. Missing: (1) a fact table with `vintage_report_id` and `additive` flags; (2) a line taxonomy (ids, Hebrew captions, section, unit type incl. `shares`/`pct`/`nis`, IFRS 4↔17 bridge); (3) `gate.py` + `qa.json` as the deploy condition; (4) a coverage/freshness matrix generated from the data; (5) cross-layer reconciliation (XBRL = statements = SOP = savings) as a standing test; (6) a change-detection pass on regulator series (level shifts, roster changes).
