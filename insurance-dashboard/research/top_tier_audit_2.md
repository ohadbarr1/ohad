# fox: top-tier audit, round two (10 Oct 2026, evening build)

Live site only (fox-research-il.web.app), 375 px and 1280 px, every feature operated rather than read from the change list. Phoenix as the deep case, Hachshara as the thin case, Altshuler as the fund-house case. Competitor claims: [V] = read on the vendor's own page this round (stockunlock.com, stockunlock.com/mobile-app.html, koyfin.com/help, koyfin.com/help/charts-and-graphs, koyfin.com/help/mobile-app-feautres); [T] = third-party only (fiscal.ai returns 403/429 and qualtrim.com is a JS shell, so both remain [T]). Paths are under `web/src/`. Effort: S < half a day, M = 1–3 days, L > 3 days.

## 1. Verdict

1. Round one's day-one list was mostly done and done correctly: growth math, clamp, stacking guard, LTM, exports, chronological chips, phone scroll trap, control drawer. The product moved from "mid-tier surface" to "top-tier data with a surface that is right on desktop and still wrong on the phone".
2. The phone, the owner's first device, is still the weak side: labels are now *truncated* to 129 px instead of wrapped (worse than before for reading), the industry subnav still hides the active tab, the review sparkline is still desktop-only, the overview is 7,500 px long, and funds/headline open on 300 px of controls.
3. Three new correctness defects in the statements chart and page: the IFRS 17 break line lands on the first *missing* quarter instead of the first IFRS 17 quarter; bidi mangles every signed percentage in the chart legend; a deep link pasted while on the page is silently overwritten by the page's own URL writer.
4. The themes are consistent enough to keep; the real inconsistency is period language: `H1 2026`, `30 יוני '26`, `2025-12-31`, `אוג׳ 2026` and `Q2'26` all appear for the same kind of thing on one company.
5. Scorecard average moved 5.5 → 6.5. Ahead of all four benchmarks on source-linked IFRS 17 and savings data; still behind StockUnlock and Koyfin on phone, and behind Koyfin on chart composition (multi-company lines, axis grouping, templates [V]).

### Scorecard (round one → round two)

| Area | R1 | R2 | Best competitor | What moved / what is left |
|---|---|---|---|---|
| Financial statements page | 6 | 7 | fiscal.ai 8 [T] | +LTM, +break band, +export, +chronological; left: phone labels, totals not bold, split rows, balance-sheet columns as long dates |
| Charting | 5 | 7 | Koyfin 8 [V] | +correct growth, +units, +PNG/CSV; left: break-line bug, bidi legend, link does not carry growth/flip state, no multi-company statement lines |
| Industry comparison | 6 | 7 | Koyfin screener 7 [V] | +sort, +column picker, +YoY, +median, +footnotes; left: default order is English id order, no chart from a column, capital tab dates |
| Company overview / review | 6 | 6 | Qualtrim 8 [T] | IFRS 17 cards now 3 bars mixing H and FY; two CSM figures with no bridge; sparkline still hidden on phone; 7.5k px on phone |
| Funds | 7 | 7 | Koyfin fund screener 6 [V] | unchanged: no sortable headers, 12 columns, 300 px of controls on phone |
| Valuation | 4 | 4 | fiscal.ai 7 [T] | unchanged, price-based; owner decision pending |
| Navigation / search | 6 | 6 | Koyfin 8 [V] | meta duplicate fixed; row search still Phoenix-only ("פרמיות" → nothing); deep-link overwrite bug |
| Mobile | 4 | 5 | StockUnlock 8 [V] | scroll trap and control wall fixed; labels, subnav, sparkline, page length not |
| Visual polish / consistency | 6 | 6 | Qualtrim 8 [T] | period labels inconsistent, ISO dates still in three places, totals not styled |
| Performance | 5 | 5 | Koyfin 8 | unchanged: 949 KB JS, 6 × ifrs_*.json and 13 price files on home, hachshara.price.json 404 |

## 2. Round-one defects: status

| # | Defect | Status | What is left |
|---|---|---|---|
| 1 | Total change / CAGR on negative base | Fixed | Suppressed when either end ≤ 0 (pre-tax profit no longer prints a %). Still computed between two *quarters* a year apart, which is fine, but the legend text is bidi-mangled (new defect A2). |
| 2 | Growth line explodes | Fixed | Clamped ±300 %, base < 10 % of median skipped, tooltip says "מעל". |
| 3 | Stacking subtotal on component | Fixed | `stack: stack && !s.m.total`; no warning in the legend when a mix is attempted, acceptable. |
| 4 | No standard break on chart | Partly | Dashed "IFRS 17" line and 50 % opacity exist, but the line is placed at the first column where *no series has an old value*, which is the first *null* column: on the default P&L row it draws at Q2'20 instead of Q1'24 (new defect A1). Correct only when the row has no gaps. |
| 5 | Tooltip formatting | Partly | One decimal and % on rate series now; still no unit in the tooltip body (unit lives only in the axis name). |
| 6 | Period chips sort as strings | Fixed | Review, IFRS 17, profit, matrix, capital, search all read Q2'26 · Q1'26 · FY'25 · Q3'25 … |
| 7 | Hook after early return | Fixed (per RESUME; no console error reproduced) | |
| 8 | Phone scroll trap | Fixed | `.scroll` max-height none at 375 px; page scrolls. |
| 9 | Sticky corner hides captions | Not fixed | `tr.sec td` sticky z 1 under the corner th z 2; same CSS as before. |
| 10 | Default P&L is not the P&L | Owner's choice | Opens on 9 continuous rows. Mitigation possible without changing the default: see B6. |
| 11 | Label column on phone | Made worse | `max-width: 56vw` plus 2-line clamp was added, but the column still lays out at its `min-width: 128px` because the table is 2,235 px wide and the browser gives the first column the minimum. Result: "חלק ברווחי…", "רווח לפני מסים ע…", "בעלי המניות ש…" at 129 px. Before, the label wrapped and was at least readable. |
| 12 | Overflowing tab bars | Not fixed | Industry subnav 835 px in 345 px; on `/industry/headline` the active tab sits at x = −354. Statement "דוח" seg still 13 items. |
| 13 | ISO dates beside Q labels | Not fixed | 299 ISO dates on the company IFRS 17 tab, 54 on capital, solvency card on overview "2026-03-31". |
| 14 | Duplicate solvency rows | Not fixed | 175 % and 178 % at 2025-12-31 still side by side with no sub-label. |
| 15 | 404 on home | Not fixed | `hachshara.price.json` still 404 on every home load. |
| 16 | Search meta duplicates code | Fixed | Row reads "הראל · IFRS 17 · CSM" with "CSM" as a separate meta span. |
| 17 | Decorative motion on phone | Fixed on touch, by CSS | `(hover: none)` disables reveal, aurora, smooth scroll. On desktop the view() reveal still produces a blank frame on a fast scroll (seen once on the overview at 1280 px); keep an eye on it. |
| 18 | Control wall | Fixed on statements | 160 px before the first number at 375 px, options behind one button. Not applied to industry headline (323 px), funds (301 px), review (two chip rows). |
| 19 | Two-point "charts" | Partly | Now 3 bars: H1'25, FY'25, H1'26, i.e. a half-year, a full year and a half-year on one category axis, labelled "30 יוני '25 / 31 דצמ׳ '25 / 30 יוני '26". Still reads `F.D2_` instead of the `X.` series. |
| 20 | Sparkline hidden on phone | Not fixed | `th.wide-only` display none at 375 px. |
| 21 | SOP tab is a dump | Not fixed | 57 rows, one value column, 24 "מתמונה" chips, two period controls. |
| 22 | IFRS 17 tab ends in 281 rows | Not fixed | |
| 23 | Headline compare spaghetti | Partly | "מיקוד" select with `c=` exists; default is still "כל החברות שוות" = 13 lines. |
| 24 | Matrix not a screener | Fixed | Sort, picker (persisted), YoY, median, bars, numbered notes, CSV. |
| 25 | No unit on y-axis | Fixed on foxOption charts | Statement chart prints "ש"ח · מיליונים" above the axis; other charts carry the unit in the panel aside only until migrated (in progress, not reported). |
| 26 | No export | Fixed | PNG / CSV / copy-link on every chart ≥ 200 px. Copy-link does not carry growth, flip or bar/line state (new defect A3). |
| 27 | Price in a no-price product | Pending owner | DCF still "מחיר 171.10 · שווי שוק 43.1"; headline still offers P/B, P/E, market cap; overview "דיבידנד למניה · תשואה 3.2% · Yahoo Finance". |
| 28 | Payload | Not fixed | 949 KB JS; home pulls market.json 1.7 MB, phoenix.json 1.9 MB, six ifrs_*.json, 13 price files, 12 docs files. |
| 29 | Row search knows Phoenix only | Not fixed | |
| 30 | Three themes | Owner's choice | Checked dark and light on the savings page: tables, bars, chips, positive/negative colours all hold. No new defect found. |

## 3. New defects, ranked by damage

### A. Correctness

**A1. IFRS 17 break line drawn at the wrong column.** `/company/phoenix/financials`, chart, any row with a gap in the IFRS 4 years (the default row "חלק ברווחי חברות מוחזקות" has no Q2'20–Q3'20). The dashed "IFRS 17" marker is drawn between Q1'20 and Q4'20, three years before the real break, while the bars change colour at Q1'24. A reader trusts the line, not the tint. Cause: `first17 = cols.findIndex((_, i) => !series.some((x) => x.olds[i]))`; a null cell has `olds[i] === false`. Fix: `cols.findIndex((_, i) => series.some((x) => x.vals[i] != null) && !series.some((x) => x.olds[i]))`, and skip the line when the series has no old values at all. `pages/Company.tsx` L302. S.

**A2. Bidi mangles every signed number in the chart legend.** Same page, legend under the chart: "(שינוי כולל: +420.8% · CAGR: +30.2%)" renders as "420.8%+ … (+30.2% :CAGR ·" (zoomed at 375 px, same at 1280 px). The `.num` spans sit inside an RTL sentence with no isolation. Fix: wrap each figure in `<bdi>` or give `.num` `unicode-bidi: isolate; direction: ltr`, and put the parenthesised clause in its own `<bdi>`. `pages/Company.tsx` L311; `styles.css` `.num`. S.

**A3. Deep link pasted while on the statements page is overwritten.** Navigate to `#/company/phoenix/financials?sheet=X.מאזן…`, then paste a P&L link with `s=17&g=1` into the address bar: the URL immediately reverts to the balance-sheet state, and a reload then loads the balance sheet. The component initialises state from `useSearchParams` once and the sync effect (L192–205) writes state → URL on every change, so an external URL change loses. Same for browser back/forward within the page. "העתקת קישור" therefore only works from a fresh tab. Fix: either key `FinancialsInner` on `location.search` when the change did not originate from the effect (compare the last written query), or read `sp` in an effect and set state when it differs. `pages/Company.tsx` L79–101, L192–205. M.

**A4. IFRS 17 cards on the overview mix period types.** `/company/phoenix/` → "IFRS 17" strip: "רווח משירותי ביטוח 855 −24.0%" is H1'26 vs H1'25 while the KPI header two rows above says "Q2'26 · 433 −36.9%" for the same line, and the 3-bar chart is H1'25 / FY'25 / H1'26 on one axis. The two CSM cards (2,292 life, 7,328 health, both gross) sit under a KPI card "יתרת CSM נטו 8,325 ללא פוליסות חיסכון" with no bridge. Fix: read the `X.` series with `type === 'Q'` (or LTM) and label the card "H1'26 · YTD" if it must stay half-year; add "ברוטו · כולל פוליסות חיסכון" to the two CSM cards. `pages/CompanyOverview.tsx` L60–85. S.

**A5. Totals are not totals.** IFRS 17 P&L: "רווח משירותי ביטוח", "רווח לפני מסים על הכנסה", "רווח לתקופה" are weight 400; only rows whose label starts with "סך הכל" get `tr.tot`. Every benchmark bolds subtotals. Fix: tag `total` in `build_workbook.py` by a label list (רווח משירותי ביטוח, רווח מהשקעות ומימון, רווח לפני מסים, רווח לתקופה, סך הכל…) or by position before a caption. `pipeline/build_workbook.py`, `styles.css` `tr.tot`. S.

**A6. Split rows in the merged statement.** Same table: "הכנסות (הוצאות) נטו מחוזי ביטוח משנה מוחזקים" and "הוצאות נטו מחוזי ביטוח משנה מוחזקים"; "קיטון (גידול) בהתחייבויות…" and "גידול בהתחייבויות…"; "הכנסות (הוצאות) אחרות, נטו" and "הוצאות אחרות, נטו"; "רווח לתקופה" twice. Known in RESUME, but it is on the default IFRS 17 view, so the reader sees two half-series. Fix: alias table in `statements()` that strips "(הוצאות)" / "(גידול)" / "(ביטול הפסדים)" before matching. `pipeline/build_workbook.py`. S.

**A7. Row search finds nothing for common words.** Top search "פרמיות" → "לא נמצאו תוצאות" on a site with seven insurers. "הראל פרמיות" also nothing. The index maps Phoenix statement lines only (round-one 29) and does not include the standard taxonomy labels at all. S for a stop-gap (index `labels.ts` metric names → `/industry/ifrs?m=`), M for per-company rows.

### B. Phone reading surface

**B1. Labels truncated to 129 px (round-one 11, made worse).** Fix in CSS: at ≤ 760 px `td.lbl { width: 56vw; min-width: 56vw; }` (an explicit width, not max-width, is what the table algorithm honours), keep the 2-line clamp, and set `title` to the full label. `styles.css` L317, L513. S.

**B2. Two period columns per screen.** With the label at 56 vw, 78 px numeric columns give two periods; acceptable for Q, poor for FY. Add a "compact" phone mode on the statements page: label, latest, YoY %, QoQ % (three numbers) with horizontal scroll for the full run behind a toggle. `pages/Company.tsx` render loop L344–362. M.

**B3. Active tab off-screen (round-one 12).** `pages/Industry.tsx` L15 and `pages/Company.tsx` L48: on mount and on route change `el.querySelector('a.active')?.scrollIntoView({ inline: 'center', block: 'nearest' })`. S.

**B4. Overview is 7,531 px at 375 px.** 25 cards in one column, 266 px each. Fix: 2-up grid at phone width for the XBRL and savings cards (sparkline cards survive 165 px), and collapse "דיווחים אחרונים" and "הערות" to headers. `styles.css` `.grid`/`.mcard` at ≤ 760 px. S.

**B5. Review sparkline (round-one 20).** Move `<Trend>` under the label cell at ≤ 760 px instead of `wide-only`. `pages/CompanyReview.tsx` L119, L129. S.

**B6. Continuous default hides the statement (owner kept the default).** Without changing the default, show a one-line strip above the 9 rows: "9 שורות רציפות · הדוח המלא (42 שורות) בלשונית IFRS 17" with the tab as a link; today the tab bar sits *below* the chart and the first tab is not obviously the thinnest. `pages/Company.tsx` L332–338. S.

**B7. Controls before numbers on funds (301 px), headline (323 px), review (two chip rows).** Apply the statements pattern: one row of primary chips, the rest behind "אפשרויות". `pages/Funds.tsx`, `pages/Compare.tsx`, `pages/CompanyReview.tsx`. M.

**B8. Period-range slider on phone.** Two overlapped `<input type=range>` with `pointer-events: none` on the input and `auto` on the thumb. Synthetic drag and keyboard did not move it in this harness (not conclusive on a real thumb); but a 26 px thumb at 34 px track height is a small target. Replace with two selects ("מ" / "עד") at ≤ 760 px. `pages/Company.tsx` L275–279, `styles.css` `.range2`. S.

### C. Consistency

**C1. Five period vocabularies on one company.** Header chip "נתונים: H1 2026"; balance-sheet columns "30 יוני '26"; IFRS 17 fact dates "2025-12-31"; overview IFRS 17 cards "31 דצמ׳ '25"; everything else "Q2'26". Rule: an instant that ends a quarter is labelled by the quarter (Q2'26); FY end = FY'25 or Q4'25 by context; only true non-quarter dates print as dates. One `plabel` for instants in `lib/format.ts`; use it in `Company.tsx` (balance sheet), `CompanyIfrs.tsx`, `IndustryCapital.tsx`, `CompanyOverview.tsx` (solvency, FIN cards), `Company.tsx` L41 header chip. S.

**C2. Matrix default row order is English id order** (איילון, כלל, הכשרה, הראל, מנורה, מגדל, הפניקס). Default to equity descending (or the picker's first column) with the rank column shown. `pages/IndustryMatrix.tsx` L114–118. S.

**C3. Fund houses get insurer tabs.** `/company/altshuler/ifrs17` and `/profit` render "הדוחות של החברה טרם חולצו". Hide `IFRS 17` and `מקורות רווח וענפים` when `entry.kind === 'fund_house'`; show "חיסכון ארוך טווח" first. `pages/Company.tsx` L48–56. S.

**C4. "Yahoo Finance" as a source on a page whose rule is "every figure to a source page".** Overview dividend card foot "דיבידנד מהדוחות · Yahoo Finance"; yield depends on price. Until the owner decides on 27, label the card "דיבידנד למניה, מהדוחות" and drop the yield. `pages/CompanyOverview.tsx` L16–30. S.

**C5. Capital tab default is FY'25 while every other industry tab opens on Q2'26.** Either open on Q2'26 with "ratio as of latest disclosed" or print "FY'25 (יחס כושר פירעון מתפרסם שנתית)" in the aside. `pages/IndustryCapital.tsx`. S.

**C6. EPS rows in a "מיליונים" table.** "רווח מפעילויות נמשכות למניה רגילה … 3.58" sits under a ש"ח · מיליונים header with no per-share unit mark. Print "ש"ח" in the label column for `unit === 'nis'`. `pages/Company.tsx` L355. S.

**C7. Empty panel renders.** Company IFRS 17 tab: "שחרור CSM צפוי לרווח" panel with 0 rows for Phoenix. Hide when empty. `pages/CompanyIfrs.tsx`. S.

**C8. Order seg reads "חדש ← ישן".** Arrow direction is ambiguous in RTL; use "חדש תחילה / ישן תחילה". `pages/Company.tsx` L274. S.

## 4. The "finished" feeling: the short list

Done together these remove the 85 % feeling; all S except A3 and B2.

1. A1 break line, A2 bidi legend, A3 deep-link overwrite: the chart is the product's face and all three are visible within a minute of use.
2. B1 + B3 + B5 + B4: phone labels, active tab in view, sparkline on phone, 2-up overview. Four CSS/one-line fixes that make the phone read like the desktop.
3. C1 one period vocabulary, plus round-one 13 and 14 (ISO dates, unlabelled duplicate solvency rows).
4. A5 + A6 in the pipeline: bold subtotals, no split rows. The IFRS 17 statement then reads like a statement.
5. Round-one 15 (404), C3 (fund-house tabs), C7 (empty panel), C8: the "nobody looked at this" signals.
6. B6 strip on the continuous tab, so the owner's default no longer hides the real statement.

## 5. Next level-jump features (beyond round one's seven)

1. **Statement row → peers in one tap.** Every row label on `/financials` gets a "מול עמיתים" action that opens the industry IFRS chart (`/industry/ifrs?m=…`) or, for a line in the standard taxonomy, a multi-company chart of that line (Q, FY, LTM) with the same break band. Koyfin does multi-ticker lines [V]; nobody does it for IFRS 17 lines. Needs the taxonomy map in `lib/labels.ts` and a `FoxChart` with company series. M.
2. **Report-day diff with "what changed since the last report"**: the review tab already has YoY/QoQ; add a column "מול הדוח הקודם, כפי שדווח אז" (restated comparatives vs original), flag rows where the restatement exceeds 2 %. Unique to fox: the extraction keeps both. M.
3. **Chart templates and a chart book**: save the current statements-chart URL as a named template per company (localStorage, later synced), with "החל על חברה אחרת" that remaps by taxonomy label, and a "ספר גרפים" page that renders the saved set for a deck (PNG batch). Koyfin templates [V], StockUnlock overlay [V]; fox adds source links in the exported CSV. M.

## 6. Order of work

**Day 1 (S):** A1, A2, A4 labels, A5, A6, B1, B3, B4, B5, B6, C1, C3, C4, C7, C8, round-one 9, 13, 14, 15.
**Week 1:** A3 (URL ↔ state), A7 stop-gap, B2 compact phone table, B7 control pattern on funds/headline/review, B8 selects, C2, C5, C6, round-one 19 (overview on `X.` series), 22 (collapse 281 rows), 23 (focus default).
**Later:** chart-engine migration finishes (in progress), round-one 21 (SOP rebuild), 28 (payload), 29 (row search), 27 (price decision), then jumps 1–3 above and round one's jumps 3–5.
