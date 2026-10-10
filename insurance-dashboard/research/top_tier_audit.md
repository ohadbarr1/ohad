# fox: top-tier audit (10 Oct 2026)

Reviewed live build at 375 px and 1280 px, Phoenix as the data-rich case, every chart builder in `web/src`, and the four benchmarks (fiscal.ai, Qualtrim, Koyfin, StockUnlock). Competitor claims are tagged [V] = read on the vendor's own page, [T] = third-party description (fiscal.ai and Qualtrim block fetches, so most of theirs are [T]). File paths are under `web/src/`.

## 1. Verdict

1. Not top tier today. It is a top-tier **data asset** (every figure to a page, IFRS 17 depth, regulator fund data) wrapped in a mid-tier **reading surface**; the surface is what the user touches, so the product feels unpolished.
2. Already ahead of all four: source page on every number (fiscal.ai gates this to Max [T]); CSM bridge, solvency and sources-of-profit per insurer (none have it); every regulator savings track ranked within its product (none have it); explicit IFRS 4 → 17 break handling.
3. Clearly behind on the phone: nested scroll trap, 7-line row labels, a full screen of controls before the first number. StockUnlock and Koyfin ship native apps [V]; fox on an iPhone is harder to use than Koyfin's mobile web.
4. Behind on charting correctness and tools: growth and "total change" math breaks on negative bases, stacking has no guard, no unit on the axis, no export, no multi-company overlay of statement lines, no LTM/margin/per-share transforms (Koyfin: group/separate axes, log, templates [V]; StockUnlock: auto CAGR, overlay, % view, PNG [V]).
5. Behind on performance and defaults: a company page pulls ~5 MB of JSON and a 924 KB bundle; the statements page opens on a 9-line "continuous" P&L that hides the actual P&L.

## 2. Scorecard

| Area | fox | Best competitor | Gap in one phrase |
|---|---|---|---|
| Financial statements page | 6 | fiscal.ai 8 [T] | opens on the wrong tab; no LTM / margin / per-share; unusable at 375 px |
| Charting | 5 | Koyfin 8 [V] | wrong growth math on negatives, no units, no export, no multi-company line overlay |
| Industry comparison | 6 | Koyfin screener 7 [V] | unique IFRS 17 columns, but no sort, no column picker, chip clutter, 7 tabs |
| Company overview / review | 6 | Qualtrim 8 [V] | 2-bar "charts", period chips out of order, sparkline hidden on phone |
| Funds | 7 | Koyfin fund screener 6 [V] | fox leads on data; table is 12 columns with no sort cue, no per-track chart by default |
| Valuation | 4 | fiscal.ai 7 [T] | DDM with a live price in a no-price product; no SOTP inputs from the extracted segments |
| Navigation / search | 6 | Koyfin 8 [T] | function codes are good; row search indexes Phoenix only; no recents, no result keyboard hints |
| Mobile | 4 | StockUnlock 8 [V] | scroll trap, label wraps, control wall, overflowing tab bars |
| Visual polish / consistency | 6 | Qualtrim 8 [V] | three themes, decorative motion, ISO dates beside Q-labels, chips as footnotes |
| Performance | 5 | Koyfin 8 | 45 requests on home, 6 × ifrs_*.json on a company page, one 924 KB JS chunk |

## 3. Defects, ranked by damage

Effort: S < half a day, M = 1–3 days, L > 3 days.

### Bugs

1. **Total change / CAGR on a negative base.** `/company/phoenix/financials` chart legend prints "שינוי כולל: −654.7%" for pre-tax profit (Q1'20 is negative) and "+1,103.9% · CAGR +51.4%" on FY. Meaningless and visible on the default row. Fix: compute from the first value inside the selected range, suppress when first ≤ 0 or signs differ, show "×n" beyond ±300% as `CompanyReview.Delta` already does. `pages/Company.tsx` L216–222. S.
2. **Growth line explodes.** "+ קו צמיחה" on quarterly profit draws a 22,000 % YoY spike (Q1'24 vs a near-zero Q1'23), the second axis runs −5,000 % to 25,000 %, every other point is flattened to 0. Fix: clamp to ±300 %, mark clamped points, or skip when |base| < 10 % of the series median; symmetric axis with units. `Company.tsx` L215, L280, L288. S.
3. **Stacking subtotal on component.** Ticking "רווח לפני מסים" and "רווח לתקופה" then "ערימה" stacks them into a 2,300 total. Fix: stack only rows that are not `m.total` or that share a section; otherwise warn in the legend. `Company.tsx` L278. S.
4. **No standard break on the chart.** In "שורות רציפות" the table greys IFRS 4 cells, the chart draws them in the same colour with no marker at 2024. Fix: `markArea`/`markLine` at the first IFRS 17 column, 55 % opacity for `old` values (`MarkLineComponent` is already registered in `components/Chart.tsx`). S.
5. **Tooltip formatting.** "1,249.291" (3 decimals) next to a table showing one decimal; the growth series prints "10" with no "%", no unit anywhere in the tooltip. Fix: `valueFormatter` per series. `Company.tsx` L284. S.
6. **Period chips sort as strings.** Review, IFRS 17 and profit tabs list `Q2'26, Q1'26, Q3'25, Q2'25, Q1'25, FY'25`; matrix, capital, IFRS, search selects do the same. Fix: sort by `endOf(p)` with FY after Q3. `pages/CompanyReview.tsx` L60, `CompanyIfrs.tsx` L49, `CompanySop.tsx` L21, `IndustryMatrix.tsx` L30, `IndustryIfrs.tsx` L40, `IndustryCapital.tsx` L26, `DocSearch.tsx` L24. S.
7. **Hook after early return.** `CompanyOverview` calls `useKpis()` after `if (storeError) return` (L127–128); React will throw when `storeError` flips. Move the hook up. S.
8. **Phone scroll trap.** `.scroll{maxHeight:640}` makes every statement a nested scroller; a swipe over the table scrolls the box, not the page, and the inner scrollbar paints over the leftmost data column in RTL. Fix: no `max-height` under 760 px; let the page scroll; keep sticky header with `position: sticky` relative to the page. `Company.tsx` L328, `styles.css` L163, L314. S.
9. **Sticky corner hides captions.** On phone the sticky "שורה" header cell (z-index 2) covers section rows (`tr.sec`) as they pass under it ("…ת, נטו:"). Fix: give `tr.sec td` the same sticky treatment or lower the corner cell. `styles.css` L314–315. S.
10. **Default P&L is not the P&L.** The page opens on "שורות רציפות": 9 rows, no insurance revenue, no service result. Fix: default to the IFRS 17 tab (full current statement), offer "continuous" as a filter chip. `Company.tsx` L113. S.
11. **Label column on phone.** `td.lbl{min-width:128px;max-width:44vw}` wraps "חלק ברווחי חברות מוחזקות המטופלות לפי שיטת השווי המאזני" over 7 lines; rows are 150 px tall and two period columns fit. Fix: 58 vw, two-line clamp with full text in `title`, short labels in the data layer. `styles.css` L317. S.
12. **Overflowing tab bars.** Industry subnav is 835 px in a 345 px viewport; the active tab can be off-screen; the "דוח" seg on financials scrolls 13 items with "מגזרי…" clipped and no affordance. Fix: scroll active into view on mount; two-row wrap for ≤ 8 items. `styles.css` L300, L494. S.
13. **ISO dates beside Q-labels.** Capital, company IFRS 17 and the fact tables print `2025-12-31`; the convention is `Q4'25`. `IndustryCapital.tsx` L63, `IndustryIfrs.tsx` L146, `CompanyIfrs.tsx` fact list. S.
14. **Duplicate solvency rows without a reason.** Phoenix IFRS 17 tab: "יחס כושר פירעון, עם הוראות מעבר" 175 % and 178 % both at 2025-12-31, "עודף הון" 7,346 and 7,614, with no label saying before/after dividend or which entity. The capital page admits it in a chip; the company page does not. Fix: show `f.l` as the sub-label when a (m, s, d) key has > 1 value. `CompanyIfrs.tsx`. S (UI), M if the extractor should tag the variant.
15. **404 every home load.** `data/companies/hachshara.price.json` is requested and missing. `lib/useData.ts` / `pages/Home.tsx`. S.
16. **Search meta duplicates the code.** "הראל csm" works and resolves to one hit, but the row reads "IFRS 17 · CSMCSM". `components/Search.tsx` L66, L122. S.
17. **Decorative motion on phone.** `html{scroll-behavior:smooth}`, `animation-timeline: view()` reveals and the 22 s aurora run on touch devices; fast scrolls show blank panels fading in. Disable reveal/aurora under `(hover: none)`. `styles.css` L29, L34, L275. S.

### Unfinished design

18. **Control wall.** The financials controls are 519 px tall on a phone: the first full screen has no number on it. Fix: one compact sticky bar (sheet · period · units) and a bottom sheet for the rest. `Company.tsx` L238–256. M.
19. **Two-point "charts".** The overview's IFRS 17 cards draw H1'25 vs H1'26 as a two-bar chart because `FIN` reads the latest report sheet (`F.D2_…`) instead of the long `X.` series. `CompanyOverview.tsx` L60–85. S.
20. **Sparkline hidden where it matters.** The review table's "6 דוחות" trend column is `wide-only`, so the phone (the primary device) loses the one glance that explains the delta. Show it under the label instead. `CompanyReview.tsx` L129, `styles.css` L334. S.
21. **Profit (SOP) tab is a dump.** Two period controls (chips + a select mixing QTD/YTD/FY), one value column, 57 rows, 25 "מתמונה" chips, no YoY. Fix: report vs YoY vs QoQ columns like the review tab, one footnote marker for image-sourced figures. `CompanySop.tsx`. M.
22. **IFRS 17 tab ends in 281 rows.** The "כל הנתונים" table is ~40 phone screens. Collapse by default, or move to a sub-tab with the family filter as the entry point. `CompanyIfrs.tsx`. S.
23. **Headline compare is spaghetti.** 13 lines, no lead company, legend chips are the only control. Fix: `c=` lead from URL like the savings deck, others at 35 % opacity, tap-to-isolate. `pages/Compare.tsx`. S.
24. **Peer matrix is a table, not a screener.** No sort, no column picker, header chips ("נגזר") inflate widths to 175 px, 3 chips per cell. Fix: sortable headers (`.thbtn` exists), footnote markers ¹²³ with a legend line, column set from `METRICS` taxonomy. `IndustryMatrix.tsx`. M.
25. **No unit on any y-axis.** Units live in the panel aside, which scrolls away on a phone. Put the unit in the axis name or first tick. All chart builders. S.
26. **No chart export or share.** URL state exists but there is no copy-link, PNG or CSV button on charts (every benchmark exports PNG [V/T]). Add `getDataURL` + CSV of the plotted series to `components/Chart.tsx`. S.
27. **Price in a no-price product.** `/valuation/phoenix/dcf` shows "מחיר 171.10 ש"ח · שווי שוק 43.1 מיליארד"; `/industry/headline` offers P/B, P/E, market cap; home fetches 13 `*.price.json`. Either label them "as of report date, from MAYA" in one marked section or remove. `pages/Valuation.tsx` L46, `lib/kpi.ts` L15–17, L73–75. S to remove, M to quarantine.
28. **Payload.** Company page: `phoenix.json` 1.9 MB + six `ifrs_*.json` (≈5.3 MB, needed only for the review sparkline) + `market.json` 1.7 MB; "i" explain loads `phoenix.notes.json` 2.1 MB; single 924 KB JS chunk. Fix: per-company fact slices (`data/ifrs/<id>.json`), per-row notes, route-level code splitting. `lib/useData.ts`, `pipeline/`. M.
29. **Row search only knows Phoenix.** The index maps statement lines from `phoenix.json` only; "הראל פרמיות" finds nothing. Index the standard taxonomy per company. `Search.tsx` L24–38. M.
30. **Three themes.** Phoenix, Obsidian (aurora, spotlight, grid) and light triple the surface to polish and produce the inconsistencies above. Keep Phoenix + a dark variant of it. `styles.css`. M to remove.

## 4. The level jump

1. **Statement page as a reading surface.** Job: read a 6-year statement on a phone in 20 seconds. Benchmarks: fiscal.ai 20+ years with filing links on Max [T]; Koyfin custom line templates [V]. fox better: open on the full IFRS 17 statement, LTM column computed from the quarterly run, YoY / margin-of-revenue / per-share toggles, sections collapsible, phone mode of one card per line (latest, YoY, QoQ, sparkline, page link), every cell still a page link, which no benchmark offers.
2. **One chart engine.** Job: chart any line, any company, any transform, and take it to a deck. Benchmarks: Koyfin group/separate axes, log, saved templates [V]; StockUnlock overlay + auto CAGR + PNG [V]. fox better: a single `FoxChart` with a series model {company, line, period type, transform: value/YoY/QoQ/LTM/margin/index 100, flip}, standard-break band, units on axis, correct growth math, PNG/CSV/link, used by all six current builders (`Company`, `Compare`, `Industry`, `IndustryIfrs`, `Funds`, `MetricCard`).
3. **Peer matrix as a screener on IFRS 17 facts.** Job: rank seven insurers on any extracted fact at any period. Benchmark: Koyfin 5,900 criteria [V] but no CSM. fox better: column picker over the whole fact taxonomy (CSM new business / release, RA, loss component, solvency with/without transitional, combined by line), QTD/YTD/LTM, basis footnotes, sort, CSV, and every cell a page link.
4. **Report-day review.** Job: the morning a filing lands, know what changed. No benchmark does this for Israeli insurers. fox: one page per filing with eight headline numbers, YoY/QoQ deltas, CSM bridge, solvency vs target, "new since last visit" (the `seen` flag exists in `Home.tsx`), each number to its page.
5. **CSM economics layer.** Job: judge franchise value, not just profit. 612 CSM-release rows and 680 CSM-movement rows are extracted and barely shown. fox: runoff schedule, new business / release ratio, CSM/equity, interest vs estimate changes, by company and across peers.
6. **Mobile pass.** Job: everything above with one thumb. Benchmarks ship native apps [V]; fox needs no app, only no nested scroll, a compact control bar, bottom-sheet pickers, two-line labels, sortable headers by tap.
7. **Data architecture for speed.** Job: first number under one second on 4G. Per-company slices, lazy docs, split bundle; target < 1 MB on a company page.

## 5. Missing features and cuts

Missing, ranked:
1. LTM period type on statements and charts: the quarterly run exists, the roll-up does not.
2. Margin (% of insurance revenue) and common-size views: core for an insurer.
3. Multi-company overlay of statement lines (not only the 11 XBRL KPIs).
4. Sort on every table, column picker on matrix and funds.
5. Export: CSV per table, PNG per chart, copy-link on charts.
6. Combined ratio by line over time (facts exist per report; no series view).
7. Sensitivities table (216 rows extracted, zero shown: family "רגישויות" reads 0 on Phoenix).
8. Dividend capacity: surplus over target × payout policy, per insurer.
9. Watchlist page: the star exists; there is nowhere to see the starred set together.
10. Notes with timestamps, per company, exportable.
11. Keyboard: j/k on rows, Enter to chart, `?` cheat sheet (`/` and ⌘K already work).
12. Print / deck view of a chart + table.

Cut or merge:
- Obsidian and light themes, aurora, spotlight, 3D icons, home scene: one house look.
- `/market/*` and `/funds/*`: two subnavs for one dataset; merge into `/funds` with four tabs.
- `/industry/headline` (XBRL KPIs) into the matrix with a "series" toggle.
- Valuation DCF as it stands (price-dependent, dividend-discount with one input): either a reverse-DCF on reported ROE/CSM without price, or out.
- Per-row "i" explain notes (2 MB): fold the short form into the label tooltip.

## 6. Order of work

**Day 1** (all S): defects 1, 2, 3, 5, 6, 7, 8, 9, 10, 13, 15, 16; axis units (25); default sheet.
**Week 1**: chart engine core (growth math, break band, units, tooltip, PNG/CSV) and switch `Company.tsx` to it; phone table mode and compact control bar (18, 11, 12); review sparkline on phone (20); matrix sort + column picker + footnotes (24); per-company IFRS slices and bundle split (28); decide on price (27).
**Later**: statement page LTM/margin/per-share and card mode (jump 1); matrix as screener (3); report-day review (4); CSM economics layer (5); SOP tab rebuild (21); row search across companies (29); theme consolidation (30); watchlist page, sensitivities, dividend capacity.
