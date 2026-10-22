# ws4 — Visual design, brand, typography, colour, density, motion, charts, iconography

Scope: both themes (phoenix light default, obsidian dark), desktop 1440/1920 and phone 375/390, read against `web/src/styles.css` (604 lines), `web/src/styles/*.css`, `lib/foxchart.ts`, `lib/theme.tsx`, `components/{MetricCard,Icon3D,Logo,Layout,Chart}.tsx`, and PRODUCT.md. Evidence files are in `shots/ws4_*` (`ws4_px_` = phoenix, `ws4_dk_` = obsidian, `ws4_comp_` = competitors). Live checks were done on 22 Oct 2026. Competitor tags: [V] seen on the vendor's public page, [T] from the teardowns in `research/`, [J] judgment.

## 1. Verdict

The visual layer is a 6/10: a serious data product wearing two different costumes, neither of which is the brand PRODUCT.md describes. The phoenix default is a corporate-deck skin (navy hero block, isometric 3-D clip-art on a peach disc, orange pills, 20 px white cards) and the obsidian theme is the "generic AI dashboard" the brief lists as an anti-reference (aurora gradient, pointer spotlight, glass rail, glowing bars, blur-in page transitions). Underneath, the bones are good — tabular numerals, hairline tables, footnoted matrices, a real source sheet — but there is no type scale (16 font sizes on one page), no radius or elevation scale (20 radius values, 45 shadow declarations), eight period vocabularies, a categorical palette that cannot separate 8 insurers, unformatted chart labels ("66.3064%"), and a bidi bug that prints every KPI delta as "YoY 5.5%−". Best competitor on visual craft: Fiscal.ai product UI 8.5 [T] (condense toggle, decimals toggle, one typographic system per the teardown), Koyfin 8 [V landing / T product], Qualtrim 8 [T]; prodata.co.il is a 5 [V] — navy constellation background, yellow "למקצוענים בלבד" slab, unstyled tables — so on style alone fox already beats the Israeli incumbent and loses to the global tier on discipline, not ambition.

Scorecard (today → reachable in Phase 2):

| Area | Today | Best competitor | Note |
|---|---|---|---|
| Typography / type scale | 5 | Fiscal.ai 8 [T] | 16 sizes on one page, 7 weights + a mono face loaded for 3 elements |
| Colour tokens & themes | 6 | Linear 9 [V] | good token idea, but phoenix in hex / others in oklch, dead `light` theme, accent fails AA |
| Density & layout | 6 | Koyfin 8 [T] | 39 px statement rows, 63 px fund rows, statements table below fold at 1920 |
| Charts | 6 | Koyfin 8 [V] | one engine (good); gradient/glow bars, raw labels, no source stamp, palette not identity-stable |
| Motion | 4 | Linear 9 [V] | 19 keyframes, blur page-in, count-ups, aurora, spotlight, rotating buttons |
| Iconography & brand mark | 5 | Stripe 9 [J] | two icon languages (3-D vs line) by theme; phoenix mark is the one strong asset |
| RTL / bidi / numerals | 7 | — | `.num` isolation works; deltas outside `.num` do not |
| Mobile visual | 6 | StockUnlock 8 [V] | 2-up KPI grid works; control walls and 10.5 px rail labels remain |
| Sell-side finish (units, footnotes, source stamps, print) | 6 | Goldman/JPM PDF 9 [J] | matrix footnotes are excellent; no print stylesheet, no stamp on exports |

## 2. Findings, ranked by damage

**W4-1. Every KPI-strip delta prints its sign on the wrong side: "YoY 5.5%−", "YoY 7.7%+".** Evidence: DOM of `/company/phoenix` KPI strip: `<button class="src"><span class="neg">−5.5% YoY</span></button>` — no `.num`, so the RTL paragraph pulls the minus to the end; visible in `shots/ws4_px_ovw_1440.png` (row of four), `shots/ws4_dk_kpi_sign_zoom.png`, and on the phone `shots/ws4_dk_ovw_375.jpg`. `components/Source.tsx:17` renders `Sourced` without `.num` unless a caller passes `className`. The metric cards below (`.mval .d.num`) render the same string correctly, so the page contradicts itself. Why it matters: a professional reads "−5.5%" as the first fact on the page; a trailing sign reads as a typo at best and a sign error at worst. Fix: `Sourced` adds `num` automatically when its text matches `/[\d%]/`; add a dev-time assertion that any text node containing a digit and `[+−%]` sits in a `direction:ltr; unicode-bidi:isolate` box. S.

**W4-2. No type scale.** Evidence: computed `font-size` on `/company/phoenix` yields 16 distinct values (14.5, 13.5, 11.5, 28, 12.5, 10.5, 12, 22, 13, 11, 14, 34, 40, 9.5, 17, 19); `styles.css` + `styles/*.css` contain 30 distinct `font-size` literals from 9 px to 52 px; six heading sizes (40 / 22 / 17 / 16 / 15 / 13). `index.html:19` loads Heebo 300–900 (7 weights) and JetBrains Mono 400/500, while the page uses the mono face on 3 elements (`ui.tsx:40`, `Source.tsx:97,129`). Why: inconsistent sizes are the single strongest "assembled, not designed" tell, and 14 font files cost the first paint. Fix: an 8-step scale (Appendix A), weights 400/500/700 only, drop the mono face in favour of Heebo tabular numerals (or one mono weight for XBRL concept ids inside the source sheet only). S.

**W4-3. Radius and elevation sprawl.** Evidence: 20 distinct `border-radius` values in CSS (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 28, 50 %, 999 px, `18px 18px 0 0`); 9–10 distinct radii in one rendered page; 45 `box-shadow` declarations; the phoenix theme alone adds 49 override rules (`styles.css:392–474`) that re-round pills to 999 px and cards to 20 px. Why: the eye reads mixed radii as three products stacked. Fix: tokens `--r-1: 4px` (chips, inputs), `--r-2: 8px` (buttons, menus), `--r-3: 12px` (panels), `--r-pill: 999px`; three elevations (Appendix A). S.

**W4-4. The home page opens with the anti-reference hero.** Evidence: `shots/ws4_px_home_1440.png` — a 420 px navy block with a decorative isometric scene on a peach disc, a diagonal orange line, a 120 px wordmark and a *second* search box 40 px under the first; the first number appears at y ≈ 560. Dark: `shots/ws4_dk_home_1440.jpg` — aurora, a 170 px animated phoenix, the same giant wordmark. `styles.css:200–209, 439–445`, `Home.tsx:52–59`, `Icon3D.tsx:74–80`. Why: PRODUCT.md anti-reference #2 ("hero metrics with gradient accents… glass cards") and principle 1 ("a number, a chart, a source"); the owner lands here every evening and gets nothing. Fix: kill the mast. First screen = search (one), a "since your last visit" filings strip, the four sector numbers, the company ledger. Keep the phoenix mark at 28 px in the rail and one 96 px brand moment on the empty search state. M.

**W4-5. Period vocabulary is now eight forms (A3-C1 still open, with new variants).** Evidence from rendered DOM counts: ISO `2026-08-27` ×31 on `/company/phoenix/filings`, ×10 on `/`, ×8 on `/company/phoenix` (`Home.tsx:83`, `CompanyOverview.tsx:120`, solvency card `2026-03-31`); `30.6.2026` in the overview IFRS 17 band (`shots/ws4_px_ovw_full.png`); `09.10.26` on `/valuation/phoenix/dcf` (`Valuation.tsx:35`); `12.2023 / 6.2026` as chart legend on `/industry/sectors` (`lib/lts.ts:46`); `אוג׳ 2026` on `/market/overview` and the overview header; `08/26` on `/funds`; `H1'26`, `FY'25`, `Q2'26`. Why: period language is the grammar of the product; eight dialects say nobody owns it. Fix: one `plabel()` in `lib/format.ts` with four outputs only — `Q2'26`, `FY'25`, `H1'26`, `08/26` for a regulator month — and `27.08.26` for an event date (filing). Delete `lts.periodLabel`, `Valuation.dmy`, the raw `f.date` renders. S.

**W4-6. Chart labels printed raw to four decimals.** Evidence: `/industry/sectors` stacked share bars read "66.3064%", "26.6999%", "6.9936%", "14.5553%" (`shots/ws4_px_sectors_labels_1440.jpg`); `pages/IndustrySectors.tsx:230` formats `${x.data.pc}%` without `nf()`. Why: a sell-side reader stops trusting the page at the fifth significant digit. Fix: route every label through `fmtNum` with `dec` 0 for shares ≥ 10 %, 1 otherwise; add a unit test on the formatter. S.

**W4-7. The categorical palette cannot separate eight insurers or nine fund houses.** Evidence: phoenix `--s1…--s11` = navy, orange, light blue, peach, blue, indigo, pale blue, grey, light orange, navy-2, pale (`styles.css:398`) — five blues and three oranges; the sectors chart draws four periods as navy / grey / grey / teal, with 12.2024 and 12.2025 in two greys (`shots/ws4_px_sectors_1440.png`), teal `--sx-hi: #2FBFA6` living outside the token set (`styles/sectors.css:3`). Colour is assigned by series order, so Harel is a different colour on every chart. Why: peer comparison is the core job; a reader must be able to say "the orange one is Harel" across the site. Fix: an identity palette — one fixed hue per company (Appendix A), used by every multi-company chart and by the company's avatar chip; period series use a sequential ramp of one hue, never two greys. M.

**W4-8. Metric cards are sixteen copies of one gradient-and-glow bar chart.** Evidence: `shots/ws4_px_ovw_full.png` (overview ≈ 3,400 px at 1440; 16 cards of identical form), `MetricCard.tsx:56–61` (linear fade 0.62→0.14 on every bar, `shadowBlur: 14` on the latest). In phoenix the fade renders as washed pink (`shots/ws4_px_ovw_1440.png`); in dark it glows (`shots/ws4_dk_ovw_1440.jpg`). Why: PRODUCT.md anti-reference #2 ("hero metrics with gradient accents"); monotony hides the one card that changed. Fix: flat single-colour bars at 0.9 opacity, accent only on the latest period, no blur; replace the lower two bands with a "KPI ledger" (Appendix C-2) — one row per metric, 5-period figures, sparkline, YoY — so the overview fits ~1,400 px. M.

**W4-9. The statements page is a control wall with two "selected" styles.** Evidence: at 1440 the table starts at y = 699 of 900 (`shots/ws4_px_fin_1440.png`); at 1920×1080 at y ≈ 690 with 8 rows visible (`shots/ws4_px_fin_1920.png`); on the phone `controls` height 200 px, table top 699 of 812 (`shots/ws4_dk_fin_375.jpg`); four rows of pills plus three "standard" cards. The subnav marks the active tab navy-filled, the segmented controls orange-filled, the chips peach-tinted — three selected states on one screen. A3-B2 / B7 still open. Fix: one toolbar row (statement · period type · units · view) with everything else behind "אפשרויות"; one selected style (navy fill, white text) everywhere; chart as a right-hand pane at ≥ 1280 px. M.

**W4-10. Every number is dotted-underlined, and every positive level is green.** Evidence: `/funds` has 216 source links and 100 green cells against 1 red (JS count); `/company/phoenix` has 67 source links; `shots/ws4_px_funds_1440.png`. Why: when everything is an affordance nothing is; when every return is green the colour stops encoding anything. Fix: underline appears on row hover / keyboard focus only (the whole cell stays clickable); colour only for deltas, never for levels; a quiet `↗` glyph on the row label indicates "has source". S.

**W4-11. Motion is everywhere and announces nothing.** Evidence: 19 `@keyframes` across the stylesheets; every route plays `page-in` (640 ms, `blur(6px)` → 0, `styles.css:77–78`); KPIs `rise` with staggered 50 ms delays plus `Count` count-ups (`Home.tsx`, `Valuation.tsx`); the first headless frame 10 s after load still shows a faded KPI strip (`shots/ws4_px_market_1440.png`, `shots/ws4_px_home_1920.png`); a 22 s aurora loop, a pointer-tracking spotlight on every panel (`Layout.tsx:24–33`), icon buttons rotate 20° on hover, cards lift 3 px (`shots/ws4_px_ovw_hover_1440.jpg`). PRODUCT.md principle 4: "motion marks a change of state or arrival of data". A3-D4 only half-fixed (touch only). Fix: a motion budget of three moments (Appendix A §Motion); delete aurora, spotlight, blur, rotate, flap-on-hover. S.

**W4-12. The ember fails contrast wherever it carries text.** Evidence: `#FF4E31` on white = 3.29:1 (computed); used as white-on-orange for pressed pills (`.seg [aria-pressed]`, `styles.css:428`), footnote superscripts, hovered sort headers, `.sx-table .on`, the `.mcard .tag`. Dark-theme ember (`oklch(0.76 0.17 50)`) is fine. Why: the brand colour becomes unreadable exactly where it is meant to point. Fix: split the token — `--ember` (`#FF4E31`) for fills, rules and marks; `--ember-ink` (`oklch(0.52 0.19 38)` ≈ `#C8391C`, 4.9:1 on white) for any text or icon stroke. S.

**W4-13. Micro type below 11 px on a product read on a 27-inch monitor.** Evidence: `.mcard .tag` 9.5 px, `.mcard footer` 10.5 px, rail labels 10.5 px, `abbr.orig` 9.5 px, chart labels 10–10.5 px; 20 text elements under 11 px on the overview (JS count). Fix: 11 px floor (`--t-1`); rail labels 11.5 px; chart labels 11 px. S.

**W4-14. Two visual systems for footnotes and page references.** Evidence: `/industry/matrix` and `/industry/csm` use superscript numerals with a footer (excellent, `shots/ws4_px_matrix_1440.png`); `/company/phoenix/ifrs17` prints "עמ׳ 29" under all 15 cells and repeats the "ללא פוליסות חיסכון" chip 5 times (`shots/ws4_px_ifrs_1440.png`); the overview capital block uses a third style (inline chips plus "נגזר" italics). Fix: one convention — superscript footnotes with a footer line, the page reference lives in the source sheet and in a single "עמ׳" column; a qualifier that applies to a whole column goes in the column header once. S.

**W4-15. Headings mix Hebrew and Latin at different weights and sizes.** Evidence: `הפניקס · Phoenix` sets the Latin name at 40 px weight 300 beside Hebrew 700 (`shots/ws4_px_ovw_1440.png`); the wordmark `fox.` at 800 and `-0.03em`; `Q2'26` tags at 11.5 px in chips vs 22 px in `h2.band`. Fix: Latin secondary names at 0.5 em / 500 / `--muted`; period tags always the chip style; one wordmark lockup (Appendix D). S.

**W4-16. Density is a per-page accident.** Evidence: statement rows 39 px (`th,td padding: 9px 12px`, 13.5 px), fund rows 62.75 px (two-line names), rank rows 11 px padding, matrix header 78 px; only the statements page has the "צפוף" toggle (A3-C5 partly done). At 1920×1080 the page is capped at `max-width: 1440px`, leaving 240 px gutters while the table shows 8 rows. Fix: a global density token (`--row: 34px | 26px`) remembered per device, applied to every table and the KPI ledger; `max-width: 1680px` at ≥ 1920. S.

**W4-17. The two themes are two products.** Evidence: phoenix = white cards, navy top bar, 3-D icons, pills; dark = glass rail (`backdrop-filter: blur(18px)`), aurora, line icons, glow shadows, gradient pressed pills. The theme toggle appears twice (rail foot and top bar, `Layout.tsx:43,51`) as an icon with no label (A3-C8 still open); a third `light` theme exists in CSS (`styles.css:17–27`) but is unreachable (`theme.tsx:3` allows only phoenix | dark); phoenix tokens are hex, the others oklch, so `color-mix(in oklch …)` behaves differently per theme; no `prefers-color-scheme` support. Fix: one design with inverted tokens (Appendix A has both sets in oklch), one toggle with system/light/dark, delete the dead theme. M.

**W4-18. Two icon languages, selected by theme.** Evidence: `Icon3D.tsx` five hand-built isometric objects (house, towers, three bars, coin stack, grid) shown only in phoenix at 36 px, plus a 150 px / 96 px masthead scene; `Icon.tsx` nine 1.6-px line icons shown in dark. The 3-D house for "בית" and coin stack for "שווי" are literal clip-art; there is no icon for IFRS 17, CSM, solvency, filings — the sections the product is actually about. Fix: retire the 3-D set from navigation; one 24-px 1.5-px line set (Lucide base, 4 custom glyphs: statement, CSM bridge, solvency shield, filing); keep one isometric composition as the empty-state illustration if the owner is attached to it (see §Keep/retire). S.

**W4-19. KPI strip grid is hard-coded to four columns.** Evidence: `/market/overview` has five KPIs → the fifth becomes a full-width orphan (`shots/ws4_px_market_1440.png`); `styles.css:124`. Fix: `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))` with a max of 6; on the phone 2-up. S.

**W4-20. Charts have no frame: no title block, no unit rule, no source stamp, no export footer.** Evidence: `foxchart.ts:99–110` prints the unit as the y-axis name only; `Chart.tsx:42` exports PNG with the plotted area and nothing else; tooltips put the unit at 11 px / 0.65 opacity under bold values; legends are 12×8 round-rects; monthly x-axes rotate Hebrew month names (`דצמ׳ 2012`, `shots/ws4_px_market_1440.png`). A Goldman chart carries title · unit · period · source in a fixed frame. Fix: a `ChartFrame` primitive (title, subtitle with unit and period tag, source line, export adds the same footer and the fox mark); x-axes use `08/26`-style labels or years only. M.

**W4-21. Up/down colour is applied to levels and to costs.** Evidence: `/funds` 100 green cells (returns are levels, not changes); expense lines in statements turn red when negative (`a.num.neg`) although a negative expense is a credit. Israeli context: TASE, Bizportal and Globes use green-up / red-down (Western convention) [V on Bizportal's public tables], so the hue choice is right; the application is wrong. Fix: `pos/neg` only on deltas and on signed P&L lines flagged `signed` in the taxonomy; levels stay in `--fg`. S.

**W4-22. No print or PDF stylesheet.** Evidence: `grep '@media print'` across all stylesheets returns 0; the dark theme prints dark; the rail and sticky header print. For a product that competes with sell-side PDFs, "print this page" should produce an A4 page with a source footer. Fix: `@media print` — force light tokens, hide rail/top/controls, repeat table headers, footer "fox · source · Q2'26 · page n". S.

**W4-23. The brand's "ember-to-magenta" gradient leaks past the mark.** Evidence: dark `.bar i` and `.gauge .fill` use `linear-gradient(90deg, var(--accent-2), var(--accent))` with `box-shadow: 0 0 12px` (`styles.css:196,256`); pressed segments use a two-tone gradient (`:140`); the home `h1 span` has a 34 px text-shadow glow. PRODUCT.md: "the ember-to-magenta gradient lives only in the brand mark". Fix: flat ember fills; gradient reserved for `Logo.tsx`. S.

**W4-24. English leaks inside Hebrew tables.** Evidence: overview filings list shows "Phoenix Financial Ltd. 2026 Q2 Financial Report – translated version" and "[The Hebrew 2026 Q1 report was published on 26 May 2026]" (`shots/ws4_px_ovw_full.png`); the KPI title attribute is the English extractor label ("Income for the period attributable to Company's shareholders"). Fix: Hebrew document-type labels (`דוח רבעוני Q2'26 · EN`) with a language chip; English titles only in the source sheet. S. (Overlaps ws5; raised here because it is a typographic break.)

**W4-25. Numbers outside `.num`.** Evidence: 7 table cells with digits and no `.num` on the overview (dates, "116 מסמכים" chip, "עמ׳ 29"); `Sourced` without `className="num"` in `Home.tsx:82` style call sites. Fix: covered by W4-1's automatic `num`. S.

**W4-26. The phone rail uses 3-D icons at 30 px with 10.5 px labels; the active state is a peach fill plus an orange underline plus bold — three cues for one state.** Evidence: `shots/ws4_px_funds_375.jpg`, `styles.css:422–423, 471`. Fix: one cue (ember glyph + 700 label), 24 px line icon, 11.5 px label. S.

## 3. Radical moves

**R1. One design, two token sets: retire "phoenix skin vs obsidian product" and ship a single system (Appendix A).** What: oklch tokens for ink, paper, line, ember, up/down, 17 identity hues; light is default by day, dark by `prefers-color-scheme` or choice; everything else (radius, type, spacing, motion) is theme-independent. Why it beats the named competitor: Linear [V] and Fiscal.ai [T] win on consistency, not on effects; prodata [V] has no dark theme and no system at all. Cost: 3–4 days of CSS surgery (delete ~200 lines: aurora, spotlight, phoenix overrides, dead light theme) + a visual regression pass with `shot.sh`. Risk: the owner likes the phoenix deck look; mitigate by keeping navy as the ink colour and the ember as the only accent, which is exactly the deck's palette minus the clip-art.

**R2. Replace the metric-card grid with the KPI ledger and a chart pane (Appendix C-2).** What: the overview becomes a 24-row ledger (metric · Q2'26 · Q1'26 · Q2'25 · YoY · QoQ · 20-period sparkline · source) with the chart of the selected row in a sticky right pane; the same primitive serves review, industry/headline and the fund house page. Why: Koyfin's "snapshot + chart on click" [T] and Qualtrim's metric cards [T] are the two patterns in the market; the ledger beats both because it shows five periods per metric on one screen and is printable. Cost: M (one component, one data adapter already present in `lib/kpi.ts`). Risk: the owner likes small multiples — keep a "כרטיסים" toggle for the top 8 only.

**R3. A chart frame with a source stamp, and PNG/CSV/PPTX export that carries it.** What: every chart renders inside `ChartFrame` (title, unit·period tag, footnote line "מקור: דוח Q2'26 עמ׳ 75 · fox"); export writes the frame too; a "ספר גרפים" batch export produces a 16:9 PPTX-ready set in the house palette. Why: no competitor at any tier stamps the filing page on the chart [T across Koyfin/Fiscal/Qualtrim teardowns]; this is the visible form of fox's only unique asset (provenance). Cost: M. Risk: ECharts text layout for RTL titles — render the frame in HTML around the canvas, not inside it.

**R4. Identity colours and avatars for the 17 companies.** What: each company gets a fixed hue (Appendix A §Identity) and a 20 px monogram chip used in tables, legends, search results, the rail's recent list and every multi-company chart; the "company in focus" is the ember outline, never a colour swap. Why: it makes peer charts readable at a glance and gives the product a recognisable texture without illustration; none of the Israeli tools do it [V prodata, funder landing]. Cost: S–M. Risk: 17 distinguishable hues is the practical ceiling — group fund houses into a cooler family and insurers into a warmer one so the two sets never collide on one chart.

**R5. Motion budget and brand moments.** What: three motions only — data arrival (120 ms opacity), state change (160 ms transform on the pressed control and the ledger's selected row), and the phoenix mark (wing flap on the empty search state and on first load of the day). Delete 15 keyframes. Why: Linear's product feels fast because almost nothing moves [V]; fox currently feels like a template because everything does. Cost: S. Risk: none; honours `prefers-reduced-motion` for free.

**R6. Density modes and a 1680 px canvas for the 27-inch monitor.** What: `comfortable` (34 px rows, 13.5 px) and `compact` (26 px rows, 12.5 px) as a global toggle in the toolbar, remembered per device; page max-width 1680 px at ≥ 1920; statements show 20 periods on one screen in compact. Why: Bloomberg/FactSet run 22–26 px rows; Fiscal.ai ships "Condense" [T]; fox's 39–63 px rows read as consumer. Cost: S. Risk: Hebrew descenders need ≥ 1.3 line-height; 26 px with 12.5 px type is the floor.

## 4. Quick wins (≤ 1 day each)

- `Sourced` auto-adds `num` when the child text contains a digit (W4-1, W4-25).
- `nf()` on the sectors share labels and a formatter unit test (W4-6).
- One `plabel()`; delete `lts.periodLabel`, `Valuation.dmy`, raw `f.date` (W4-5).
- Split `--accent` into `--ember` (fills) and `--ember-ink` (text, 4.9:1) (W4-12).
- 11 px floor: `.mcard .tag`, footers, rail labels, chart labels (W4-13).
- Remove `MetricCard` gradient fade and `shadowBlur`; flat bars, accent on the latest only (W4-8 first half).
- Delete aurora, grid, spotlight, `page-in` blur, icon rotate, card lift (W4-11, W4-23).
- `.kpis` → `auto-fit` grid (W4-19).
- Source underline on row hover only; colour only on deltas (W4-10, W4-21).
- `@media print` stylesheet with a source footer (W4-22).
- One theme toggle with a label and a system option; delete the dead `light` theme (W4-17 part).
- Load Heebo 400/500/700 only; drop JetBrains Mono (W4-2 part).

## 5. What top tier does that we don't / what we do that nobody does

They do, we don't:
- A single typographic scale and a density toggle in the statements toolbar (Fiscal.ai "Condense", decimals `.0/.00`) [T].
- Identity colours per ticker carried across legends, tables and search (Koyfin) [T].
- Chart frames with title, unit and share/export in one place (Koyfin graph sharing v3.89) [V on release notes, T on UI].
- Near-zero motion in the product shell (Linear) [V].
- Print/PDF-ready pages (sell-side PDFs) [J].
- One icon language at one stroke weight (Stripe, Linear) [V].

We do, nobody does:
- Every figure opens a source sheet with the filing page, the formula and the inputs (`styles/prov.css`) — no competitor at a free tier [T across teardowns, V prodata landing shows none].
- Restated-vs-original and derived figures distinguished typographically (italic `.der`, muted `.old`, standard-break rule in `table.series`) [V on `/company/phoenix/financials`].
- Footnoted peer matrices with numbered notes and a footer, sell-side style (`/industry/matrix`, `/industry/csm`) [V].
- A warm-ink dark theme (hue 55) instead of blue-black — the right instinct, under the wrong effects [V].

## 6. Inputs to the roadmap

Phase 1 (2 weeks, fix + polish): all 12 quick wins; W4-2 type scale and weights; W4-3 radius/elevation tokens; W4-9 one toolbar row and one selected style on statements (with ws2's control-drawer work); W4-14 one footnote convention; W4-26 phone rail. Dependency: ws3 (mobile) and ws2 (desktop) touch the same `styles.css` — land the token file first, then page work on top.

Phase 2 (1–2 months, level-jump): R1 single system with both token sets (incl. W4-17); R2 KPI ledger + chart pane (depends on ws1's page-architecture decision for the company overview and on ws5's KPI taxonomy for row order); R3 ChartFrame + stamped export (depends on ws5 provenance strings per chart); R4 identity palette and avatars; R6 density modes and 1680 px canvas; W4-20 axis vocabulary.

Phase 3 (quarter, platform): design tokens exported as a JSON contract consumed by the PNG/PPTX export pipeline and by any future mobile shell; a Storybook-style `/_design` route listing tokens, components and the chart frame for regression screenshots; print/PDF "research note" renderer built on the same tokens (a one-page company tear sheet with the fox stamp — the artefact that beats a sell-side PDF on sourcing).

---

## Appendix A — Design-system proposal

**Type (Heebo only; tabular lining numerals everywhere digits appear).**

| Token | px / lh | Weight | Use |
|---|---|---|---|
| `--t-1` | 11 / 14 | 500 | footnotes, chart labels, chips |
| `--t-2` | 12.5 / 16 | 400 | table body compact, captions, units |
| `--t-3` | 13.5 / 18 | 400 | table body comfortable, body text |
| `--t-4` | 15 / 20 | 500 | row labels in focus, panel headings |
| `--t-5` | 18 / 24 | 700 | section headings (`h2.band`) |
| `--t-6` | 22 / 28 | 700 | page title on phone, KPI value compact |
| `--t-7` | 28 / 32 | 700 | KPI value, page title desktop |
| `--t-8` | 40 / 44 | 700 | one hero figure per page max (valuation verdict) |

Digits: `font-variant-numeric: tabular-nums lining-nums` on `html`, not per `.num`; `.num` keeps only direction/isolation. Latin secondary text (English names, acronyms) at the same size, weight 500, `--muted`. Letter-spacing: 0 below 18 px, −0.01em at 22–28, −0.02em at 40. No weight 300/800/900 anywhere.

**Spacing.** 4-px base: `--s-1: 4`, `--s-2: 8`, `--s-3: 12`, `--s-4: 16`, `--s-5: 24`, `--s-6: 32`, `--s-7: 48`. Panel padding `--s-4 --s-5`; page gap `--s-5`; table cell `--s-2 --s-3` comfortable, `4px --s-3` compact.

**Radii.** `--r-1: 4px` chips, inputs, table highlights · `--r-2: 8px` buttons, menus, cards on phone · `--r-3: 12px` panels · `--r-pill: 999px` segmented controls only. Nothing else.

**Elevation.** `--e-0` none (tables, ledger rows) · `--e-1` `0 0 0 1px var(--line)` (panels at rest — a hairline, not a shadow) · `--e-2` `0 1px 2px oklch(0 0 0/.06), 0 8px 24px oklch(0 0 0/.08)` (menus, source sheet, sticky toolbar when scrolled). No hover lift, no glow.

**Colour tokens (oklch, both themes).**

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | 0.985 0.004 80 | 0.14 0.008 55 | page |
| `--panel` | 1 0 0 | 0.175 0.009 55 | surfaces |
| `--panel-2` | 0.96 0.006 80 | 0.215 0.011 55 | table head, pressed |
| `--line` | 0.88 0.01 70 | 0.30 0.012 55 | hairlines |
| `--ink` | 0.22 0.03 265 (navy ink) | 0.96 0.004 75 | text, figures |
| `--muted` | 0.46 0.02 260 | 0.74 0.012 65 | labels |
| `--faint` | 0.58 0.015 260 | 0.58 0.012 60 | footnotes (≥ 4.5:1 on panel) |
| `--ember` | 0.68 0.21 38 (#FF4E31) | 0.76 0.17 50 | fills, marks, focus ring, latest period |
| `--ember-ink` | 0.52 0.19 38 | 0.80 0.15 55 | ember as text / stroke |
| `--ember-soft` | ember / 0.10 | ember / 0.14 | highlighted row, pressed chip bg |
| `--up` | 0.50 0.14 160 | 0.78 0.14 160 | positive delta text |
| `--down` | 0.52 0.20 20 | 0.70 0.19 18 | negative delta text |
| `--warn` | 0.56 0.13 75 | 0.85 0.14 88 | estimate / derived |
| `--derived` | italic + `--muted` | same | derived figures (no colour) |

Semantic up/down in the Israeli context: TASE, Bizportal and the Hebrew press use green-up / red-down; keep it. Rules: colour applies to *changes* (YoY, QoQ, delta vs peer) and to *signed* P&L lines; never to levels, returns, shares or ratios; red-green pairs always carry the sign glyph (`+`/`−`) so colour-blind readers lose nothing. Estimates/derived use italics + `--warn` chip, never a colour fill.

**Identity palette (fixed per company, both themes; light values shown, dark raises L by ~0.15).** Insurers (warm-to-neutral family): Phoenix `0.60 0.20 38` (ember), Harel `0.55 0.16 25` (brick), Migdal `0.52 0.14 300` (violet), Clal `0.55 0.14 250` (blue), Menora `0.60 0.12 85` (ochre), Hachshara `0.55 0.10 190` (teal), Ayalon `0.50 0.14 340` (plum), IDI `0.62 0.08 60` (sand). Fund houses (cool family): Meitav `0.50 0.15 265`, Altshuler `0.58 0.15 150`, More `0.55 0.13 215`, Analyst `0.52 0.12 320`, Yelin `0.60 0.13 110`, Infinity `0.55 0.10 230`, Globalnet `0.60 0.06 60`, IBI `0.48 0.12 285`, More Gemel = More at 60 % opacity. "Company in focus" = ember 2 px outline + 700 label, colour unchanged. Sequential ramp (one metric over time, share-of-market heat): 5 steps of the ink hue from `--panel-2` to `--ink`, latest period in ember. Diverging (vs peer median, up/down heat): `--down` → `--panel` → `--up`, 7 steps, zero at `--panel`, never through yellow. Period series on one chart (e.g. four year-ends): sequential ramp, never two greys.

**Chart rules (`foxchart.ts`).** Flat fills at 0.92; bars 2 px radius on top only; lines 2 px, focus 3 px; no gradients, no shadows, no smoothing; legend as text with a 10×10 square swatch, placed above the plot start-aligned (RTL: right); every number through `fmtNum`; axis labels `--t-1`; y-axis unit printed once in the frame subtitle, not on the axis; x-axis periods `Q2'26` or `'26` (years) or `08/26` (months, thinned to Jan/Jul); break-of-standard as a dashed ink rule with a label chip; tooltip = period title, swatch + series + value, unit footer, all `--t-2`. ChartFrame: title (`--t-4` 500), subtitle (unit · period · basis, `--muted`), source line (`--faint`, "מקור: דוח Q2'26 · עמ׳ 75"), tools (PNG · CSV · קישור) in a single quiet row; export renders the frame.

**Density modes.** `comfortable`: row 34 px, `--t-3`, cell padding 8/12. `compact`: row 26 px, `--t-2`, cell padding 4/10, KPI value `--t-6`, panel padding 12/16. Stored in `localStorage.density`; toolbar toggle; auto-compact at ≥ 1920 unless overridden.

**Motion.** `--fast: 120ms`, `--mid: 160ms`, ease-out only. (1) Data arrival: opacity 0→1 on the data region, no translate. (2) State change: background/transform on the pressed control, selected row, opened sheet (translateX 12 px). (3) Brand: phoenix wing flap on the empty-search state and once on first paint of the day; count-up allowed only for the valuation verdict. Nothing loops. `prefers-reduced-motion` disables (3) and shortens (1–2) to 0.

## Appendix B — AI-slop / template tells found (for the regression checklist)

Gradient hero block with illustration (home phoenix) · aurora + grid + spotlight (dark) · glass rail and top bar (`backdrop-filter`) · gradient-filled bars with glow · two-tone gradient pressed buttons · blur page-in · count-up numbers · hover lift + glow on cards · 20 radii · 16 font sizes · 7 weights · duplicated search · decorative 3-D icons that change by theme · `999px` pills next to 20 px cards next to 3 px cells · eight period formats · four-decimal percentages · green for every positive level · dotted underline on every number · ISO dates · English extractor strings as labels.

## Appendix C — Page-level redesign directions

Conventions: RTL; `▣` = KPI/figure, `~` = sparkline, `[ ]` = control, `⋯` = more.

**C-1. Home (desktop 1440 / 1680).**
```
┌ rail ┬──────────────────────────────────────────────────────────────────────┐
│ fox  │ [ חיפוש: חברה, קופה, שורה ]                     [density] [theme]   │
│ ▪בית │────────────────────────────────────────────────────────────────────── │
│ ▪חבר │ מאז הביקור האחרון (27.08.26)                                        │
│ ▪ענף │ הפניקס · דוח Q2'26 · עמ׳ 221 ▸   הראל · מצגת Q2'26 ▸   ⋯ 8 נוספים   │
│ ▪שווי│────────────────────────────────────────────────────────────────────── │
│ ▪קופ │ ▣ נכסים 2,996  ▣ פנסיה 1,291  ▣ גמל 1,112  ▣ ביטוח 594   08/26 · YoY │
│      │────────────────────────────────────────────────────────────────────── │
│      │ חברה (avatar) │ דוח │ רווח נקי │ YoY │ LTM │ הון │ ROE │ CSM │ ~12q │
│      │ ● הפניקס      │Q2'26│   904    │−5.5%│3,324│13,126│26.3│8,325│ ~~~  │
│      │ ● הראל        │ …                                                   │
│      │ (17 rows, compact 26 px; click row → company; click cell → source)  │
└──────┴──────────────────────────────────────────────────────────────────────┘
```
No mast, no illustration, one search. The wordmark is the rail brand only. First number at y ≈ 110.

**C-2. Company overview = KPI ledger + chart pane.**
```
┌ הפניקס  Phoenix · קבוצת ביטוח · נתונים Q2'26 · 116 מסמכים     [שווי] [⋯]    │
│ [סקירה] יום הדוח  סקירת דוח  דוחות  מקורות רווח  IFRS 17  חיסכון  מסמכים    │
│ ▣ רווח נקי 904 −5.5%  ▣ הון 13,126 +7.7%  ▣ CSM 8,325  ▣ Solvency 177% Q1'26│
│───────────────────────────────────────┬──────────────────────────────────────│
│ מדד            Q2'26  Q1'26  Q2'25 YoY ~20q │ ChartFrame (sticky)            │
│ ▸ רווח נקי       904    617    957 −5.5 ~~~ │ רווח נקי · מיליוני ש"ח · Q     │
│   רווח כולל    1,344    …               ~~~ │ ▂▃▅▆▅▇▆█ (flat bars, ember last)│
│   הכנסות ביטוח 2,470  2,445  2,449 +0.9 ~~~ │ מקור: דוח Q2'26 עמ׳ 75          │
│   CSM נטו      8,325  8,524        −2.3 ~~~ │ [PNG] [CSV] [מול עמיתים]        │
│   … 24 rows grouped: רווחיות / מאזן / IFRS 17 / חיסכון ארוך טווח / הון       │
└───────────────────────────────────────┴──────────────────────────────────────┘
```
Selecting a row swaps the chart (160 ms); the pane holds a peer toggle that overlays the 7 insurers in identity colours. Page height ≈ 1,400 px. Phone: ledger only, chart opens as a bottom sheet.

**C-3. Statements page.**
```
│ [רווח והפסד ▾] [Q|H|FY|LTM] [מיליונים ▾] [ערך|YoY] [רגיל|צפוף] [אפשרויות ⋯] │
│ IFRS 17 · Q1'24–Q2'26  ‖  שורות רציפות  ‖  IFRS 4        (one row of tabs)   │
│───────────────────────────────────────────────┬──────────────────────────────│
│ שורה                 Q2'26 Q1'26 Q4'25* Q3'25 … │ ChartFrame of the checked  │
│ הכנסות משירותי ביטוח 2,470 2,445 2,502  2,490   │ rows (≤ 4), peers toggle   │
│ ▸ רווח משירותי ביטוח   433   422   370   467    │                            │
│ (tot rows 700; derived italic; break = dashed rule; sticky first col & head) │
│ * נגזר: FY − 9M   ·   מקור: עמודת "עמ׳" ← pages in the source sheet          │
```
Table top at ≤ 240 px on desktop, ≤ 330 px on phone. 20 periods visible in compact at 1680 px. Row checkbox + "השווה" on hover only.

**C-4. Industry comparison (matrix).**
```
│ השוואה ענפית  [מטריצה] שורות דוח  CSM  הון  …           [Q2'26 ▾] [QTD|YTD] │
│ חברה ●   רווח נקי  YoY   הון   ROE   CSM   שחרור/CSM  חדש/שחרור  Solvency    │
│ ● הפניקס   904 ▂▃▅  −5.5  13,126 17.5  8,325⁷  0.63×  74.8%  177%           │
│ ● הראל   1,068 ▃▅▆  +28.1 12,635 15.8 17,717  1.40×  114.1% 190%            │
│ … 7 rows + חציון row (ink rule above); cell bar = quiet ink at 3 px, not peach │
│ ¹ … ⁷ footnotes in one footer line; click column → sort; click cell → source  │
│ below: one ChartFrame "המדד שנבחר · 7 חברות · 12 רבעונים" in identity colours │
```
Keep the superscript footnotes exactly as they are — they are the best thing on the site; extend them to every page.

**C-5. Funds.**
```
│ קופות ומסלולים · 1,251 מסלולים · 08/26 · גמל-נט/פנסיה-נט         [צפוף]      │
│ [מוצר ▾] [מסלול ▾] [חברה ▾] [LTM|YTD|1M|3Y|5Y]  [חיפוש]            [⋯]       │
│ #  מסלול (avatar של הבית)   נכסים   דמי ניהול  1M   YTD   LTM   3Y   5Y  שארפ │
│ —  ממוצע המסלול             245,376          +1.3  +6.8 +12.4 +11.8 +7.2       │
│ 1  ● כלל השתלמות כללי        24,187   0.54%  +1.5  +8.4 +15.3 +13.1 +8.0  1.12 │
│ (one-line rows 26 px, fund house as avatar chip, no dotted underline,         │
│  returns in ink; only the column being sorted gets a quiet ink bar;           │
│  vs-average delta column is the only coloured one)                           │
```

**C-6. Mobile company card (375).**
```
┌ הפניקס · Q2'26 · 116 מסמכים                 ⋯ ┐
│ [סקירה] יום הדוח  סקירת דוח  דוחות  …  (scroll) │
│ ▣ רווח נקי      904   ▣ הון      13,126         │
│   −5.5% YoY            +7.7% YoY                │
│ ▣ CSM נטו     8,325   ▣ Solvency  177% Q1'26    │
│─────────────────────────────────────────────────│
│ רווח נקי         904  −5.5%  ~~~~~▂▅ ▸          │
│ רווח כולל      1,344 −12.6%  ~~~~~▃▆ ▸          │
│ הכנסות ביטוח   2,470  +0.9%  ~~~~~▅▇ ▸          │
│ (ledger rows 44 px; tap → bottom-sheet chart;   │
│  long-press → source sheet)                     │
│ rail: 24 px line icons, 11.5 px labels, ember   │
│ glyph = active                                  │
└─────────────────────────────────────────────────┘
```

## Appendix D — Keep / retire

Keep: the phoenix mark (`Logo.tsx`) — the only piece of brand with craft; keep its ember-to-magenta gradient there and nowhere else; use it at 28 px in the rail and 96 px on empty states. Keep the ember as the single accent (split into fill and ink tokens). Keep navy as the light-theme ink (it is the deck's colour and reads as serious). Keep the warm-ink dark surfaces (hue 55). Keep tabular numerals, hairline tables, the superscript footnote system, the italic "derived" convention, the standard-break rule, the source sheet drawer, the `foxOption` single engine, the `Q2'26` grammar.

Retire: the home mast (both themes); the isometric 3-D icon set and masthead scene (optionally keep one composition as the empty-state illustration, at most); aurora, grid, spotlight, glass blur, glow shadows, gradient bars and pressed-pill gradients; count-ups outside valuation; blur page transitions; hover lift; the duplicated search and duplicated theme toggle; JetBrains Mono; Heebo 300/800/900; the dead `light` theme; the peach active fill; `999px` pills except segmented controls; dotted underline on every number; green on levels; ISO dates and every period formatter but one; "עמ׳ NN" under cells; English extractor strings as labels.
