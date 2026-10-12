# fox: top-tier audit, round three (12 Oct 2026)

Live site only (fox-research-il.web.app), operated at 375 px and 1280 px, both themes. Phoenix as the deep case, Harel as the second statements case, Altshuler as the fund house. Figures were traced to `data/extracted_fs/<company>/<period>.json` and to `data/work/<company>_<period>/he/pNNN.txt`; the live workbooks were downloaded (`/data/companies/<id>.json`) and scanned by script. Competitor claims: [V] read on the vendor's page, [T] second-hand (fiscal.ai, Qualtrim, StockUnlock and TIKR's help centre block fetches; Koyfin and TIKR pricing were readable). Paths are under `web/src/` unless stated. Effort: S < half a day, M = 1–3 days, L > 3 days.

## 1. Verdict

1. Not top tier. Tier 2 with a tier-1 data asset: the only product anywhere with seven Israeli insurers' full IFRS 17 statements, CSM bridges, solvency and regulator fund data, every cell linked to a page. Scorecard average 6.5 → 7.0; the surface moved, the correctness did not.
2. What keeps it from the top: (a) the statements page, the product's face, prints wrong per-share numbers, double-counted renamed lines, duplicate rows and blank "total" rows; (b) raw extractor prose (English, snake_case, "p37-39") leaks into three Hebrew pages; (c) the phone, the owner's first device, clips the minus sign off every negative YoY on the review tab and still opens funds/headline/profit on a wall of controls.
3. Most embarrassing in front of a professional: `/company/harel/financials` shows "רווח בסיסי למניה 5,200.00" (should be 5.20) and `/company/phoenix/financials` shows diluted EPS "0.0" for every quarter since 2020 (should be 3.55). Any sell-side reader stops trusting the page there.
4. The analyst jobs that matter (read a quarter, compare seven on one line over five years, find where CSM grows) are now possible, but each needs 6–10 taps, and "compare any statement line across companies" still does not exist: the peer matrix covers 12 KPIs, not the 5,077 lines.
5. Competitors have moved too: Koyfin ships graph sharing with permissions and templates [V], fiscal.ai ships a modeling tab and fiscal-calendar alignment [V*]. None has restated-vs-original, per-cell source links at base tiers, or any insurance layer. fox's lead is in data; its gap is finish.

## 2. Scorecard (R2 → R3)

| Area | R2 | R3 | Best competitor | What moved / what is left |
|---|---|---|---|---|
| Statements page | 7 | 6 | fiscal.ai 8 [T] | +all seven insurers, +LTM, +restatements panel, +saved views; regressed on correctness: EPS ×1000 / ÷1000, renamed-line double count, dup rows, 150 blank total rows, sign flip between reports |
| Charting | 7 | 7 | Koyfin 8 [V] | engine on 18/24; value labels collide at 375 px; no multi-company statement lines; no templates; share link not permissioned |
| Industry comparison | 7 | 8 | Koyfin screener 7 [V] | +peers-over-time, +notes; capital tab shows stale solvency (179 % Q3'25 vs 177 % Q1'26 on the company page); matrix ROE blank for 3/7 |
| Company overview / review | 6 | 7 | Qualtrim 8 [T] | IFRS 17 cards now consistent; review sparkline on phone; but negative YoY sign clipped on phone, Yahoo dividend yield survives the no-price decision, 2026-03-31 on the solvency card |
| Profit (SOP) tab | 4 | 4 | — | unchanged: 57 rows, one value column, English extractor notes rendered as content |
| Funds / market | 7 | 7 | Koyfin fund screener 6 [V] | unchanged: no sort, 661 px of controls on phone, 105-option month `<select>` |
| Valuation | 4 | 4 | fiscal.ai 7 [V*] | price quarantined, but default DDM prints "−53 % vs price" and SOTP part 3 is a 0 placeholder |
| Navigation / search | 6 | 7 | Koyfin 8 [V] | row search now covers all companies; results ungrouped, Ayalon-first, near-duplicate variants; `fin.std` preference leaks across companies silently |
| Mobile | 5 | 6 | StockUnlock 8 [V] | labels, tab-in-view, sparkline fixed; sign clipping, 7.4 k px overview, control walls, colliding chart labels remain |
| Visual polish / consistency | 6 | 7 | Qualtrim 8 [T] | both themes hold; period vocabulary still mixed ("H1 2026", "1 ינו׳ '24", "2026-03-31", "אוג׳ 2026", "Q2'26") |
| Performance | 5 | 7 | Koyfin 8 | company page ≈ 900 KB transfer (was ≈ 5 MB); market.json 415 KB on every route incl. statements; hachshara.price.json 404 on valuation |

## 3. Status of open items from rounds one and two

| Item | Status | Evidence |
|---|---|---|
| R1-9 sticky corner hides captions | Not fixed | `styles.css` L314–315 unchanged; `tr.sec td` z 1 under corner z 2 |
| R1-12 industry subnav active tab | Fixed | `/industry/matrix` active tab at x 230; subnav still 835 px, 4 tabs off-screen |
| R1-13 ISO dates | Partly | IFRS 17 and capital tabs clean; still `2026-03-31` on the overview solvency card and review tab, `עד 2026-06-30` on the CSM movement header, `2026-08-27` in every filings list |
| R1-14 duplicate solvency rows | Partly | now distinguished, but by a 200-character English extractor sentence as the sub-label (new C3) |
| R1-15 404 on home | Fixed on home, not on valuation | `hachshara.price.json` still 404 (21 KB HTML) when the valuation page loads prices |
| R1-19 two-point charts | Fixed | overview IFRS 17 cards read the Q series; 433 / −36.9 % matches the review tab |
| R1-20 sparkline on phone | Fixed | `<Trend>` under the value at 375 px |
| R1-21 SOP tab | Not fixed | 57 rows, one value column, QTD/YTD select duplicating the chips |
| R1-22 281-row IFRS 17 table | Fixed | collapsed behind "הצגה" |
| R1-27 price | Decided and mostly applied | overview still shows "דיבידנד למניה · תשואה 3.2% · Yahoo Finance" (yield = price) on every company incl. Altshuler |
| R1-28 payload | Fixed | ≈ 900 KB per company page; still `market.json` 415 KB on every route |
| R1-29 row search | Fixed, unranked | "פרמיות" returns 15 Ayalon rows first, "על ידי"/"על-ידי" variants as separate hits |
| R2-A1 break line | Fixed | — |
| R2-A2 bidi legend | Fixed | "שינוי כולל +9.3% · CAGR +4.0%" reads correctly at 375 and 1280 |
| R2-A3 deep-link overwrite | Fixed per RESUME; not re-broken in this round | — |
| R2-A4 overview mixed periods | Fixed | — |
| R2-A5 totals bold | Fixed | `tr.tot` on service result, pre-tax, net; **but** ≈ 150 `tot` rows with an empty label in the cash-flow sheets (new A4) |
| R2-A6 split rows | Partly | "הכנסות (הוצאות) אחרות" merged; "אשראי וסליקה" vs "תשלומים ומימון" not (new A2) |
| R2-A7 search common words | Fixed | — |
| R2-B1 phone labels | Fixed | `td.lbl` 46 vw, no clamp needed at 172 px |
| R2-B2 compact phone table | Not fixed | 2 period columns per screen |
| R2-B3 tab in view | Fixed | — |
| R2-B4 overview length | Not fixed | 7,452 px at 375 px, cards 347 px one-up |
| R2-B6 continuous strip | Moot | default is IFRS 17 now; the stored `fin.std` applies to every company (Harel opened on 7 continuous rows after one tap on Phoenix) |
| R2-B7 control walls | Not fixed | funds 661 px, profit 613 px, headline 629 px to the first figure at 375 px |
| R2-B8 range slider on phone | Not fixed | — |
| R2-C1 period vocabulary | Partly | header chip "נתונים: H1 2026", balance-sheet opening column "1 ינו׳ '24", market pages "אוג׳ 2026" |
| R2-C2 matrix order | Fixed | sortable, default by selected column |
| R2-C3 fund-house tabs | Not fixed | Altshuler shows "מקורות רווח וענפים" and "IFRS 17" (both "טרם חולצו"), and hides "דוחות כספיים" which also says "טרם חולצו" |
| R2-C4 Yahoo yield | Not fixed | — |
| R2-C5 capital tab default | Regressed | opens on Q2'26 but prints Q2'25/Q3'25 facts (new A6) |
| R2-C6 EPS unit mark | Regressed into a value bug | see A1 |
| R2-C7 empty CSM release panel | Fixed | now says "מתפרסם בדוח השנתי" |
| R2-C8 "חדש ← ישן" | Not fixed | — |

## 4. New findings, ranked by damage

### A. Correctness

**A1. Per-share lines are wrong by ×1000 or ÷1000 on the statements page.** `/company/harel/financials` P&L: "רווח בסיסי למניה 5,200.00 / 2,670.00" (source p52: 5.20 / 2.67, file unit "NIS millions"); Clal FY'23 "2,830" vs FY'22 "1.63" in the same row; Migdal "850"; Phoenix "רווח מדולל · רווח מפעילויות נמשכות 0.0" in every quarter (source 3.55; row label lacks "למניה" so it is tagged `unit: k` and divided by 1,000). Cause: `pipeline/build_workbook.py` L123 multiplies every row by 1,000 when the file unit says millions, and L260 assigns `nis` only when the label contains "למניה". Fix: tag per-share by the preceding header ("רווח למניה", "רווח בסיסי", "רווח מדולל", "בש"ח") and never scale `nis` rows; print "ש"ח" in the label cell; add a check in `pipeline/check_fs.py` that any `nis` value > 500 or < 0.01 fails. S. Files: `pipeline/build_workbook.py`, `pages/Company.tsx` L236 (`fmtCell`).

**A2. Renamed line counted twice.** Phoenix P&L: "הכנסות מפעילות אשראי וסליקה" and "הכנסות מפעילות תשלומים ומימון" are the same line renamed in the Q2'26 report; the merge prints both, with Q2'25 = 119.1 in both and FY'25 = 471.8 in both. Any reader summing the block overstates revenue by 472 for FY'25. Fix: alias table keyed by (section, position) when a label disappears and a new one appears in the same slot with equal comparatives; show the newest label with a "לשעבר: …" tooltip. S. `pipeline/build_workbook.py` `statements()`.

**A3. Duplicate rows split by punctuation.** Phoenix balance sheet: "נדל"ן להשקעה - אחר" (empty) above "נדל"ן להשקעה -אחר" (1,972.7); "רכוש קבוע הנמדד בשווי הוגן" twice (one empty). Script scan: 27 normalised duplicates on the Phoenix balance sheet, 43 on Ayalon, 18–28 elsewhere (part legitimate IFRS 4/17 pairs, part punctuation). Fix: normalise labels by stripping spaces around hyphens, quotes and parentheses before matching; drop a row with no values in the visible window. S. Same file.

**A4. ≈ 150 total rows with no label.** Phoenix cash flow: 48 `tot` rows with an empty label and mostly "–" cells (Menora 51, Migdal 28, Ayalon 15, Hachshara 10; Menora OCI 7). The IFRS 17 cash-flow tab shows ~15 of them, several carrying values (24,699.4, 28,046.5, −33.8, −298.8) with no caption. Fix: the extractor emits unlabeled subtotal rows; in `statements()` inherit the caption of the preceding `sec` row ("יתרת מזומנים לסוף התקופה: סך הכל") or drop rows with empty labels and no values. S.

**A5. Sign convention flips between reports.** Phoenix cash flow "ריבית ששולמה": Q2'26 −160.4, Q1'26 +111.9 (Q1'26 report prints 111,931 positive; Q2'26 report prints the H1 figure −272,345, which proves Q1 should be negative). "מסים שהתקבלו −0.8" next to 47.8. Fix: when a later report's YTD column covers an earlier quarter, normalise the earlier quarter's sign to make YTD = Σ quarters; mark in the restatements panel. M.

**A6. Capital tab shows stale solvency.** `/industry/capital` at "Q2'26": Phoenix "179 % · Q3'25", Harel "178.5 % · Q3'25", everyone else Q2'25; the Phoenix company page shows 177 % at Q1'26 (p22 of the Q2'26 report). The tab picks the first fact matching the metric regex, not the latest date in the selected report. Fix: group by metric, take max date, show the date chip only when it differs from the report period. S. `pages/IndustryCapital.tsx` L11–17.

**A7. Minus sign clipped on the phone review tab.** `/company/phoenix/review` at 375 px: every YoY prints "5.5%" in red instead of "−5.5%"; the `.chg` span's left edge sits at x = −5 (the QoQ column at −84) inside `.scroll`, so the first glyph is cut by the viewport. Red is the only cue. Fix: at ≤ 760 px render review as label / value / YoY / QoQ with `table-layout: fixed`, no horizontal scroll, and `td .chg { text-align: start }`. S. `styles.css` L163, L318; `pages/CompanyReview.tsx`.

**A8. Missing line shown as −100 %.** `/company/phoenix/ifrs17` portfolio-groups table: "פוליסות הכוללות רכיב חיסכון שאינו תלוי תשואה 42.6 → – → – · −100.0 %". The line was not printed in later reports (merged into another group); the delta treats absent as zero. Fix: delta only when both ends exist; print "לא דווח" otherwise. S. `pages/CompanyIfrs.tsx`.

**A9. CSM release sign mixed in one block.** Review tab "CSM: שחרור לרווח": group net −210, segment net −55/−155, but "חיים וחיסכון 64.1" and "בריאות 172" positive in the same block (gross lines from another table). Fix: one sign convention per metric (release positive, labelled "שחרור"), with basis as a chip. S. `lib/labels.ts`, `pages/CompanyReview.tsx`.

**A10. Same number, two values across tabs.** Phoenix Q2'26 general-insurance pre-tax: review "303", profit tab "304*" (image-read); pre-tax YoY "−12.6 %" vs "−12.7 %". Fix: when a text-sourced value exists for the same (metric, segment, period), the image-sourced one is suppressed, not shown beside it. S. `pipeline/build_sop.py`.

**A11. Empty LTM columns.** Phoenix P&L LTM shows "LTM Q3'24 … LTM Q1'24" as all "–" (no IFRS 17 2023 quarters). Fix: drop columns with no values in the window. S. `pages/Company.tsx`.

**A12. Negative zero.** "−0.0" (P&L "הפסדים (ביטול הפסדים)" Q3'25, review "−0.0 %"). Fix in `lib/format.ts`: `Object.is(v, -0) || Math.abs(v) < 0.05 → 0`. S.

**A13. Restatements panel does not open on the phone.** "הוצג מחדש · 2 מספרים" → "הצגה" toggles to "סגירה" but nothing renders below (checked by DOM text at 375 px). Fix: verify `showRe` branch renders inside `Panel` at ≤ 760 px (likely the `.scroll` max-height/overflow rule). S. `pages/Company.tsx` L396–401.

**A14. Companies list duplicates Mor.** `/companies`: "מור" and "מור גמל ופנסיה" both 140.2 bn, +28.9 %, 6.2; the home table ranks them separately too. Fix: one entity (holding) with the subsidiary as a sub-row. S. `pages/Companies.tsx`, `data/companies/index.json`.

**A15. Savings fee YoY jump unexplained.** `/company/phoenix/savings`: "דמי ניהול 0.75 % vs 0.45 % (Aug '25)" because ביטוח-נט policies are in the 2026 weighting and not 2025. Either weight both years the same way or print "כולל ביטוח מ-2026". S. `pipeline/build_market.py`.

### B. Usability

**B1. Raw extractor notes rendered as page content.** `/company/phoenix/profit` → "מה הדוח לא מדפיס": seven English paragraphs with snake_case keys ("pc by line: insurance_revenue, insurance_service_result, gross_written_premiums: the image pages (p37-39) print only…"). `/company/phoenix/ifrs17` solvency rows: 200-character English descriptions as sub-labels ("Economic solvency ratio (in %) after effect of material equity transactions · Phoenix Insurance Company Ltd (insurer subsidiary), Economic Solvency Regime (Solvency II-based). Percent. Audited (ISAE 3400)…"). `/industry/ifrs` "כל השורות" table: same. Fix: a Hebrew variant map (לפני/אחרי פעולות הון; עם/ללא הוראות מעבר; ברוטו/שייר) in `lib/labels.ts`; the English note goes to `title`; the "not printed" list becomes one Hebrew line per metric or is dropped. S. `pages/CompanySop.tsx` L91, `pages/CompanyIfrs.tsx` L38, `pages/IndustryIfrs.tsx`.

**B2. Control walls before the first figure at 375 px.** funds 661 px, headline 629 px, profit 613 px, statements 677 px with the chart closed. The statements drawer exists; apply it: one row of primary chips, the rest behind "אפשרויות". M. `pages/Funds.tsx`, `pages/Compare.tsx`, `pages/CompanySop.tsx`.

**B3. Sticky preference leaks across companies.** Tapping "שורות רציפות" on Phoenix sets `fin.std=c` globally; Harel then opens on 7 rows with no cue. Fix: key the preference by company, or show the active tab's row count in the strip. S. `pages/Company.tsx`.

**B4. Fund-house tab bar.** Altshuler shows "מקורות רווח וענפים", "IFRS 17" (dead) and hides "דוחות כספיים" (also dead). Fix: `entry.kind === 'fund_house'` → tabs סקירה · חיסכון ארוך טווח · מסמכים until statements exist. S. `pages/Company.tsx` L41–56.

**B5. Row search is unranked.** "פרמיות" → 15 Ayalon rows first (id order), "על ידי" and "על-ידי" as separate hits, no company grouping. Fix: group by normalised label, show company chips per group, rank by current company then by number of periods. M. `components/Search.tsx`, `pipeline/build_search.py`.

**B6. Statement chart labels collide at 375 px.** Ten bars with value labels "2,358.32,377.32,361.3" overlapping. Fix: labels only when bar width > 44 px, else last value only. S. `lib/foxchart.ts`.

**B7. Statement table is below the fold on desktop.** At 1280 × 900 with the chart open the table starts at y = 1,279. Fix: chart as a right-hand panel beside the table at ≥ 1100 px (Koyfin layout), or a collapsed 180 px sparkline strip. M. `pages/Company.tsx`, `styles.css`.

**B8. Month picker with 105 options.** `/market/ranking`: a `<select>` from Aug '26 back to Dec '17. Fix: year + month segs, or a slider with the latest 24 months and "עוד". S. `pages/Market.tsx`.

**B9. "i" button in every label cell.** 39 info buttons on the P&L at 375 px eat 24 px of a 172 px label column and load `phoenix.notes.json` (2.1 MB) on first tap. Fix: one "i" per section header, long-press on a row, notes split per sheet. S. `pages/Company.tsx`.

**B10. Valuation defaults produce a verdict.** `/valuation/phoenix/dcf` opens with "80.08 ש"ח מול מחיר 171.10 · −53.2 %" and "מכפיל הון מוצדק 3.17 vs משתמע 1.54"; SOTP part 3 is "רווח × P/E · 0 · 0 %" with a note that segment profits "יוזנו אוטומטית אחרי חילוץ הדוחות" although the SOP extraction exists. Fix: defaults from reported ROE and payout (ke = 10 %, g = 3 %, payout = reported), no headline delta until the user edits an input; SOTP seeds from `data/sop/<id>.json`. M. `pages/Valuation.tsx`.

**B11. Price input has no date.** "מחיר סגירה אחרון במערכת 171.10" with no as-of date on a page whose rule is "price only as a labelled input". Fix: "171.10 · 25.08.26 · MAYA". S.

**B12. Overview at 375 px is 7,452 px long.** 19 cards one-up at 347 px. Fix: 2-up grid for XBRL and savings cards (165 px each), "דיווחים אחרונים" and "הערות" collapsed. S. `styles.css` `.mcard` at ≤ 760 px.

**B13. Review table on phone shows one period.** Comparative values (957, 707) are hidden; the user sees 904 and a clipped "5.5 %". Fix with A7: four narrow columns. S.

**B14. Filings table duplicates and one-page docs.** `/company/phoenix/filings`: "רבעוני 201 / רבעוני 201" (Q2'24), "מצגת 31" three times (Q2'20), "EN 1" one-page documents. Fix: dedupe by (period, kind, pages, language); hide docs < 3 pages. S. `pages/CompanyDocs.tsx`, `data/registry/documents.csv`.

**B15. "Q4'32" and "Q4'26" as periods of targets.** Capital tab "יעד הדירקטוריון 135 % · Q4'32", IFRS 17 tab "יעד שיעור חלוקת דיבידנד 45 % · Q4'26". A target has a horizon, not a period. Fix: "יעד ל-2032". S. `lib/format.ts`.

### C. Design and consistency

**C1. Five period vocabularies remain.** "נתונים: H1 2026" (company header), "1 ינו׳ '24" (balance-sheet opening column), "2026-03-31" (solvency card, review tab, CSM header), "אוג׳ 2026" (market), "Q2'26". Rule: quarter-end instants as Q-labels, FY'25 for year-end, "פתיחה FY'24" for IFRS 17 transition, monthly regulator data as "08/26". One `plabel()` in `lib/format.ts`. S.

**C2. "חדש ← ישן".** Still ambiguous in RTL; "חדש תחילה". S.

**C3. Period "Q2'26" header over a Q1'26 solvency fact.** Review tab prints 177 % (as of 2026-03-31) under the Q2'26 column. Fix: solvency rows carry their own date chip in the label and the column header reads "בדוח Q2'26". S.

**C4. Matrix ROE blank for Menora, Migdal, Phoenix** while the home table shows derived ROE for all. Fix: fall back to derived with the ¹ note. S. `pages/IndustryMatrix.tsx`.

**C5. Desktop density.** Statement rows 39 px, matrix rows 42 px with a 78 px header; Bloomberg/FactSet run 22–26 px. Add a "צפוף" toggle (row 26 px, 12.5 px font) persisted. S. `styles.css`.

**C6. Chart value labels and y-axis from 0 on a 2,260–2,500 series.** Insurance revenue reads flat. Fix: `min: 'dataMin'` rounded down for single-series line, keep 0 for bars with a toggle. S. `lib/foxchart.ts`.

**C7. Touch targets.** 48 controls under 32 px on the home page (period chips, "i" buttons, footnote links). Fix: 36 px min on touch. S. `styles.css`.

**C8. Theme switch has no label text.** A moon icon with aria-label only; the toggle reads "הבאה: אובסידיאן" in the label, fine for screen readers, invisible to everyone else. Fix: tooltip + name in the drawer. S.

### D. Performance

**D1. `market.json` 415 KB on every route**, including statements and filings where it is unused. Fix: load in the savings tab and home only. S. `lib/useData.ts`.

**D2. Valuation loads 13 price files and 404s on Hachshara.** S.

**D3. `phoenix.notes.json` 2.1 MB on the first "i".** Split per sheet. S. `pipeline/build_workbook.py`.

**D4. KPI cards animate in with 0.64 s + 0.05 s × index**: the first screenshot 2 s after load showed an empty review card. Fix: `rise` only on cards below the fold, none on `(hover: none)`. S. `styles.css`.

### E. Data

**E1. Solvency reports stop at FY'21/Q3'22** in the registry; every insurer has published a solvency report each year since. The capital tab therefore depends on the financial-report excerpt. M (registry + extract).

**E2. Fund houses have no statements** (Altshuler, Mor, Meitav, Yelin, Analyst, IBI): the overview is XBRL headline only. L (≈ 30 agents per RESUME).

**E3. Subsidiary statements** ("חברת הביטוח" seg exists on the statements page) are empty for every company except the capital block. L.

**E4. Dividends history** is one card ("דיבידנד שהוכרז / ששולם" in the review); no per-share series, no ex-dates from MAYA. M.

**E5. Segment KPIs over time**: SOP exists for FY'25 and Q2'26 only; combined ratios by line exist per report but no series. M.

**E6. Embedded value / CSM runoff**: expected CSM release schedule is annual only; no EV. M.

**E7. Sensitivities** (216 rows extracted) still not shown anywhere. S.

## 5. The analyst jobs

| Job | Taps (phone) | Where it breaks | Top-tier reference |
|---|---|---|---|
| Read a quarter's results in 60 s | 3 (home → company → review) | negative YoY shows without sign; solvency under the wrong column; comparatives hidden | Qualtrim one-screen card [T]; fiscal.ai "Click-thru to filing" (Max) [T] |
| Compare seven insurers on one measure over five years | 4 (industry → matrix → "לאורך זמן" → measure) | 12 KPIs only; any statement line is impossible; chart and table separated by 1,000 px | Koyfin multi-ticker series + templates [V] |
| Where is CSM growing fastest and why | 6 (industry → IFRS 17 · CSM → metric → company → bridge) | "פער בין הרכיבים −170" with no explanation; English sub-labels; no new-business/release ratio over time | none offers CSM; fox leads |
| Check solvency and dividend capacity | 4 | capital tab stale (Q3'25); surplus × payout policy not computed; targets labelled "Q4'32" | none; Bloomberg FA solvency fields [T] |
| Judge a fund house | 5 (companies → Altshuler → overview → funds/makers → managers) | no statements; dead tabs; four pages for one question | Koyfin fund screener [V] |
| Find a line item by name | 2 | results unranked, Ayalon first, duplicates | Koyfin search [V] |
| Share a chart with a colleague | 3 (chart → העתקת קישור) | link carries state; no title/annotation; PNG without source line | Koyfin sharing with permissions (v3.89) [V] |
| Come back a week later to the same view | 2 | saved views per company in localStorage only; no sync; `fin.std` leaks | Koyfin My Graphs folders [V]; StockUnlock web↔app sync [V] |

## 6. The plan

### 6a. One week, in order (all S unless marked)

1. **A1 per-share units.** Done: Harel shows 5.20 / 5.10, Phoenix diluted 3.55, Clal FY'22–FY'25 on one scale; `check_fs.py` fails on any `nis` value outside [0.01, 500].
2. **A2 + A3 line aliases and punctuation dedupe.** Done: Phoenix P&L has one credit/payments line with FY'25 = 471.8 once; balance sheet has no empty duplicate; script scan of the seven workbooks finds 0 punctuation duplicates.
3. **A4 blank total rows.** Done: no `tot` row without a label in any X sheet (script count = 0).
4. **A7 + B13 phone review layout.** Done: at 375 px every YoY/QoQ prints its sign, four columns fit, no horizontal scroll.
5. **A6 capital tab latest fact.** Done: Phoenix shows 177 % · Q1'26 on both pages.
6. **B1 extractor prose.** Done: no Latin sentence longer than 30 characters in the rendered DOM of profit, ifrs17 and industry/ifrs (assert with a DOM scan).
7. **B4 fund-house tabs; R1-27 Yahoo yield card; D2 404.** Done: Altshuler shows three tabs; no "Yahoo" string in the DOM; no 404 in the network log on valuation.
8. **C1 one period vocabulary.** Done: grep of the rendered DOM for `\d{4}-\d{2}-\d{2}` and "H1 2026" returns 0 on company, industry and review routes.
9. **A8, A11, A12, A13, B15.** Done: no "−100.0%" from a missing line; no empty LTM column; no "−0.0"; restatements panel opens at 375 px; targets read "יעד ל-2032".
10. **B6 + C6 chart labels and axis.** Done: at 375 px labels never overlap (bounding-box test), single-series line uses a data-min axis.
11. **D1 market.json scoped; D4 no entry animation on touch.** Done: statements route transfers < 450 KB; first KPI card painted within 300 ms of data.
12. **B3 preference per company; B9 one "i" per section.** Done: Harel opens on IFRS 17 after a continuous tap on Phoenix; P&L at 375 px has ≤ 6 info buttons.

### 6b. One month: level-jump features

1. **Any statement line, any companies, one chart (M).** Job: compare seven insurers on insurance revenue, service result, management fees, CSM release over five years. Benchmarks: Koyfin multi-ticker series and templates [V]; StockUnlock head-to-head 80+ metrics [V]. fox better: taxonomy map over the 5,077 lines (`lib/labels.ts`), Q/H/FY/LTM, standard-break band per company, every point linked to its page, CSV with page links. Done: "מול עמיתים" on every row label opens the chart with the row pre-selected for all seven.
2. **Report-day diff (M).** Job: the morning a filing lands, what changed and what was restated. Benchmarks: none; FactSet keeps restated and non-restated series [T]. fox better: the `restated` block already exists per company; show "כפי שדווח אז / כפי שהוצג מחדש" side by side with a 2 % flag, plus eight headline deltas. Done: one page per filing, every number to its page, restatement count in the header.
3. **CSM economics layer (M).** Job: judge franchise value. Data exists (612 release rows, 680 movement rows). fox: new-business/release ratio, CSM/equity, runoff schedule, interest vs estimate changes over time by company and across peers; the "פער −170" explained by listing unextracted lines. Done: a CSM page per company and an industry CSM page with the four ratios over time.
4. **Dividend capacity (S–M).** Surplus over board target × payout policy, per insurer, with the policy rows already extracted. Done: a column in the capital tab and a card on the overview, both footnoted with the policy source page.
5. **Phone compact mode (M).** Statements and review: label / latest / YoY / QoQ, full run behind a toggle; bottom-sheet pickers instead of 105-option selects and range sliders. Done: first figure within 240 px of the top on every route at 375 px.
6. **Chart templates and a chart book (M).** Save a chart as a named template, apply to another company by taxonomy, render a set to PNG for a deck with a source line. Benchmarks: Koyfin templates and sharing [V]. Done: "ספר גרפים" page with batch PNG and CSV.
7. **SOP tab rebuild (M).** Columns QTD / YoY / QoQ, image-sourced marked with one footnote, segment and line as a tree, English notes gone. Done: the tab reads like the review tab.

### 6c. One quarter: data and platform

1. **Fund-house statements** (six houses, Q1'22 onward, spec v5): done when `/company/altshuler/financials` renders the same sheet set as an insurer and the matrix has a fund-house column set (fees, AUM, operating margin).
2. **Solvency reports since FY'22** in the registry and extracted (SCR by risk module, own funds tiering): done when the capital tab shows SCR composition per insurer with a page link.
3. **Subsidiary statements** (insurance company, pension/gemel company): done when the "חברת הביטוח" seg on the statements page is populated for all seven.
4. **Dividend and per-share series** from MAYA (declared, paid, ex-date, DPS, shares outstanding, buybacks): done when the overview has a dividend history chart and the matrix a DPS/payout column.
5. **Segment KPI series**: SOP for every period since Q1'25, combined ratios by line as series: done when the review's combined-ratio block has a sparkline per line.
6. **Sync**: saved views, notes, watchlist across devices (Firebase auth + Firestore): done when a view saved on the phone opens on the desktop.
7. **Pipeline guards**: `check_fs.py` extended with the unit, duplicate, blank-label and sign-consistency tests above, run before every deploy: done when the deploy script refuses on any failure.

## 7. Cut or merge

- `/market/*` and `/funds/*`: two subnavs over one dataset; keep `/funds` with tabs מסלולים · יצרן מול השוק · שוק · מנהלים.
- `/industry/headline` into the matrix "לאורך זמן" (XBRL KPIs as additional measures); one chart engine, one page.
- `/companies` into the home table (identical columns, one entity per group; the Mor duplicate goes with it).
- The IFRS 17 tab's "כל הנתונים שחולצו" table and the industry "כל השורות שדווחו" table: replace with a CSV download; nobody reads 281 rows with English sub-labels.
- "מה הדוח לא מדפיס": drop from the UI (keep in the data).
- The DCF as a default-output page: either seeded from reported ROE and payout with no verdict until edited, or removed; the SOTP stays only when seeded from SOP.
- Per-row "i" explain notes: one per section.
