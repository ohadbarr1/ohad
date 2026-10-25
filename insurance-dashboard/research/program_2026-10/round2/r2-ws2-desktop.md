# r2 · ws2 · Desktop UX / IA (25 Oct 2026)

Method: 41 routes measured live at 1440 and 1920 (light) plus 18 in dark, by CDP script (first-figure time and y, controls before it, tab stops, container width, `<title>`; `shots/ws2/m1440.jsonl`, `m1920.jsonl`). The seven jobs were driven by script with real clicks and keys. [V] = verified live or in code, [T] = second-hand or inferred.

## 1. Grade today: **7.8 / 10** (round 1: 6.5). Koyfin ≈ 8.5 [T]

Round 2 paid down the round-1 IA debt. What holds it at 7.8 is the shell, not the pages. Nine routes sit outside any section. Search finds data but not places. 1920 px screens get the 1440 layout. The company home has become a 7,300 px scroll.

Evidence that sets the grade:
1. **Report Day is now the company home, in four places** (דוח · דוחות · חיסכון · מסמכים). First figure at y = 405, 13 controls above it, and the period travels between tabs (`keepPeriod`) [V `company_phoenix.png`]. Round 1 had a 19-card wall (W2-1, W2-12 closed).
2. **Statements: 25 controls before the first figure (was 42), first number at y = 463 (was 746).** There is one picker row with "אפשרויות" folded away [V `company_phoenix_financials.png`].
3. **Shell hygiene shipped.** Every route has its own `<title>` (41/41). There is a real 404 page with search. There is a skip link and one tab stop per table with arrow keys (`Keyboard.tsx`). The search is an ARIA combobox and opens empty on recent pages [V]. Round-1 W2-4/5/18 are closed.
4. **Jobs are short.** Six of seven take ≤ 3 actions from home, and system time per step is 0.1–0.8 s (table below) [V].
5. **Width is broken at 1920.** `main` caps at 1,440 px on 35 of 41 routes, but home, valuation and /data run at 1,840. On statements that leaves ≈ 230 px dead each side, with 10 quarters visible and no docked chart [V `dark_1920_company_phoenix_financials.png`]. At 1440 the Savings Lens table is cut on the left edge ("דוח ÷ רשות") [V `industry_savings.png` vs `1920_industry_savings.png`].
6. **Nine routes have no home.** /restatements, /presentations and /debt are tabs of "השוואה ענפית", but opening them drops the subnav and un-highlights the rail. /holdings does the same from "קופות ושוק". /ownership, /ownership/:id, /facts/:id, /calendar and /book are linked from almost nowhere (subnavs = 0 on all nine) [V `debt.png`, `restatements.png`, `ownership.png`; grep shows `/ownership` linked only from its own pages].
7. **Peer Table: 49 controls before the first figure; Series view: 40.** It takes two picker rows plus a template-chip row, and the first number lands at y = 467 [V].
8. **The company home is 7,325 px with no in-page navigation.** The KPI ledger repeats rows of the headline table (net profit, pre-tax, equity, total assets twice on one page). Altshuler's fund-house strip (AUM, flows, fees, operating profit) sits at y ≈ 1,860, two screens down [V `full_1440_company_*.png`].

| Job (from home, 1440) | Path measured | Actions | System time |
|---|---|---|---|
| J1 read Phoenix Q2'26 | home row → Report Day; or `/` הפניקס ↵ | 1 click / 2 keys | 0.65 s / 0.19 s |
| J2 7 insurers × one line × 5y | rail → סדרה → measure select | 3 | 0.72 s (LTM leaves Q1–Q3'24 empty at the IFRS 17 break) |
| J3 figure → filing page | figure → sheet → "פתיחת הדוח, עמ׳ 343" | 2 | <0.1 s |
| J4 solvency + dividend | rail → CSM · הון → הון ודיבידנד | 3 | 0.66 s |
| J5 judge Altshuler | home row (y = 969, below the fold) → scroll ≈ 1,860 px | 1 + scroll | 0.62 s |
| J6 peer chart → PPTX | rail → סדרה → PPTX | 3 | 0.51 s |
| J7 saved view | save: 4 actions; reopen: rail שלי → link | 4 / 2 | 0.2 s |

## 2. Gap to 9.0+ (ranked)

1. **Every route belongs to a section (L1 · M).** /restatements, /presentations and /debt render inside `IndustryLayout`; /holdings inside the funds layout. The rail lights for every child. Ownership becomes a company place ("בעלות" under מסמכים, or a fifth tab where data exists) and a peer-table column set. Facts open from the source sheet ("כל ההדפסות של הנתון"). *Test:* a DOM check on all routes, `subnav ≥ 1 && rail .active == 1` except home, /mine, /search and /doc; zero routes without an inbound link (link-graph script in CI). Dep: none.
2. **Search finds destinations and actions (L2 · S–M).** "חוב" today returns balance-sheet lines and a PDF page, never /debt. "בעלות הראל" never reaches /ownership/harel [V]. Fix: add a `PAGES` registry (every route + Hebrew aliases) and the codes DEBT · OWN · HOLD · RST · PRES · CAL · BOOK · FACTS to `FUNCS`; `g c` lands on home today and should open a companies list. *Test:* 30 golden queries (page names, codes, "company + code") each return the right route at rank 1.
3. **Terminal width at ≥ 1600 px (L3 · M).** One container rule: `max-width: none`, with the rail fixed. Statements and Report Day go to grid `1fr 440px`, with the chart docked and the source sheet as a side pane, not a modal. *Test:* at 1920, `contentW ≥ 1,760` on all routes; statements show ≥ 16 quarters with the chart visible without scrolling; at 1440 no table is cut (`scrollWidth ≤ clientWidth`, or a sticky first column).
4. **Peer Table control diet (L4 · S).** Collapse to one row: קבוצה · תדירות · עד · תצוגה, then "+ מדד", with the templates as a `1–7` dropdown. *Test:* ≤ 12 controls before the first figure on peers, series and the CSM ledger; first figure y ≤ 360 at 1440.
5. **Company home gets a spine (L5 · S–M).** Add a sticky in-page index (עיקרי הדוח · מה זז · הוצג מחדש · נתוני מפתח · כושר חלוקה · יעדים · חוב · דיווחים) with `#anchors` in the URL. Drop the ledger rows the headline table already shows. Fund houses lead with the fund-house strip. *Test:* every section reachable in 1 click; no metric printed twice per page; on fund houses AUM / flows / fee yield at y ≤ 500.
6. **Every view state survives a reload (L6 · S).** `?src=1` is deleted on reload, so a pasted link with a statement figure's sheet open reopens nothing [V: S_srcreload]. Encode printed-figure provenance (`src=p~sheet~m~pi`, as round 1 asked) and section anchors. *Test:* a Playwright round-trip (open state → copy URL → new context → same DOM) on 12 states.
7. **Power-user keyboard (L7 · S).** Add `[` / `]` for previous / next company in the same place, `1–4` for company places, `j/k` for row focus in any table, `x` to add a row to the chart, `e` to export, `s` to save view, `.` to open the source of the focused figure. *Test:* J1–J7 completable without the mouse; the `?` sheet lists them.
8. **One export pattern (L8 · S).** Export sits in four places today: top-left page buttons (peers, restatements), a "ייצוא" field (CSM), a panel-header button (statements), small chips (ownership). Use the chart footer pattern everywhere ("+ לספר · PNG · PPTX · CSV · העתקת קישור"), placed bottom-start of each panel. *Test:* one `.export` bar per data panel.
9. **One savings map (L9 · M).** Savings data spans two rail items and four places: Lens views (lens · now · rank · market · econ), /funds (tracks), /managers (by company / rank over time / maker vs market) and company/savings. "Ranking" exists both in the Lens and in /managers, and cross-links jump sections ("↗"). Make "קופות ושוק" the only home for regulator data and the Lens its first tab. *Test:* one h1 and one subnav for all regulator screens; no "↗" cross-section links.

1–5 reach ≈ 9.0; 6–9 go past it.

## 3. Bold options (desktop lens)

**A · Linked workspace ("שולחן עבודה").** At ≥ 1600 px the screen splits into 2–4 panes (statement · peer series · source PDF · notes) sharing one company and one period cursor. Click a row and the series pane re-plots it. Click a figure and the PDF pane jumps to its page. Layouts save to /mine and are shareable by URL. *For:* the owner's 27" screen; analysts in season. *Why nobody free has it:* Koyfin dashboards are paid and quote-led [T]; no Israeli free tool links statements to the filing page. *Data:* existing JSON and MAYA PDFs (mayafiles.tase.co.il). *Risk:* state complexity; derive each pane from the URL. *Cost:* L (≈ 2–3 weeks).

**B · Command line as the spine.** One bar that parses `הראל CSM Q1'26`, `DEBT כלל`, `peers ROE FY` or `export pptx`. It completes on entities, codes, periods and actions, shows a live preview pane of the target, and keeps history per user. `searchOmni.parse` already extracts company + period + doc type [V]; what's missing is destinations, actions and preview. *For:* Koyfin and Bloomberg converts. *Why special:* function codes in Hebrew, over IFRS 17 lines, free. *Data:* none new. *Risk:* discoverability; ship the `?` sheet and inline hints. *Cost:* M.

**C · Season war room (desk mode of the home at 1920).** A grid of 17 filers × headline KPIs (QTD, YoY, CSM, solvency, flows) that fills cell by cell as MAYA filings land, with "new since you looked" dots. It uses the report-day autopilot that is built but OFF. *For:* everyone in Aug/Nov/Mar. *Why nobody free has it:* Globes/TheMarker publish prose hours later; prodata has no statements [T]. *Data:* MAYA filings feed (maya.tase.co.il) + the existing pipeline. *Risk:* a wrong auto-extracted number on the big screen; show "אומת / ממתין" per cell. *Cost:* M (UI) once autopilot is switched on.

**D · Notebook with live citations.** Drag any figure, row or chart into a notebook page. Each item keeps its provenance and source link and re-renders when a restatement lands, marked "עודכן". Export to PPTX/DOCX with footnotes. It is the chart book + notes + `Sourced` provenance merged. *For:* analysts writing IC memos. *Why special:* Fiscal.ai's audit trail is paid [T]; nobody offers restatement-aware citations. *Data:* existing prov/ + fact table vintages. *Risk:* sync is still behind a switch; start device-local. *Cost:* M–L.

**E · Shared period cursor across the page.** Hover Q4'24 anywhere and every chart and table on the screen highlights Q4'24. Pin it and the whole page re-bases (columns, deltas, chart window). Small, but it makes a dense terminal read as one instrument. *Cost:* S–M (an event bus in `foxchart` plus a table cell class).

Order: gap items 1, 2, 4, 6 (≈ 1 week), then 3 + A (the terminal), then B; C for the Q3'26 season (Nov '26).
