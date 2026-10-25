# r2 · ws4 — Visual design (round 1: 6.0 → today 6.8)

Live audit 25 Oct 2026: 18 routes × 390/1440 × both themes (+3 at 1920), DOM probe on 8 (`shots/design/probe_1440.json`, `probe_390.json`), source read (`styles.css`, `styles/*.css`, `lib/identity.ts`, `lib/foxchart.ts`, `components/Icon.tsx`, `ui.tsx`). Screens: `shots/design/<theme>_<width>_<route>.png`; mockups `shots/design/mock_*.{html,svg,png}`. [V] verified live/code, [T] second-hand, [J] judgment.

## 1. Grade today: 6.8 / 10

The Fable upgrade fixed what round 1 called broken — one token file (8-step scale, 4 radii, two elevations), a validated identity palette, flat charts with square swatches, a motion budget, warm paper, one duotone icon language, print stylesheet, density modes, the KPI ledger with sparklines [V `styles.css:1-50`, `identity.ts`, `foxchart.ts`]. Discipline went from 5 to 8; beauty did not move. Every screen is the same white hairline card on paper, opened by a title and two or three rows of navy pills, over a table whose figures float in 150-px gutters: a well-behaved admin panel, which is what the owner felt. Best references: Fiscal.ai product 8.5 [T], Koyfin 8 [V landing/T product], Linear 9 [V]; prodata 5 [V, round 1].

Sub-grades: typography 7.0 · hierarchy 6.5 · density 6.5 · colour 7.0 · iconography 7.0 · charts 7.5 · motion 7.0 · empty/loading 5.5 · brand 6.0 · RTL 8.0.

Evidence:
1. **Chrome before content.** `/company/phoenix` at 1440: 66 controls before the first table, table top at 1,338 px, page 7,325 px, 14 cards; `/industry/csm` 3 nav rows + 4 segmented groups before the KPI strip (`phoenix_1440_industry_csm.png`); `/company/phoenix/financials` at 390: 4 stacked rows (places · views · context bar · toolbar), table top 493 px [V probe].
2. **Tables are spread, not set.** Home rows 63 px, 7 columns across 1,300 px with ≈150 px voids between figures; funds rows 63–91 px at 1440 and 113–136 px at 390 (three-line fund names + a chip row); statements 39 px [V probe, `phoenix_1440_home.png`, `phoenix_390_funds.png`]. Only the 1920 layout (macro side column with ember sparklines) reads as a desk [V `phoenix_1920_home.png`].
3. **The scale leaks.** Tokens say 8 sizes / weights 400·500·700; the rendered overview has 17 sizes (11.25, 15.4, 10.5, 9.58…), 17 nodes under 11 px, weight 600 on 75 nodes (not loaded, so synthesised); home and `/debt` render 8-px text [V probe; CSS literals 11.5×28, 12.5×29, 12×26, 8–9.5×5].
4. **Colour still encodes the wrong things.** `/funds`: 100 green cells vs 1 red — returns are levels (`Funds.tsx:81`), W4-21 still open; `tr.lead` rows are ember-soft on white and read as validation errors (`/funds`, `/industry/csm`, `/company/phoenix/ifrs17`); `/industry/csm` has 40 ember-text elements and 31 % dash cells [V probe].
5. **Three selected-state grammars on one page.** Navy pill (places), ember underline (statement views), navy segmented + native `<select>` (toolbar) on `/company/phoenix/financials`; 7 routes use native selects [V `phoenix_1440_company_phoenix_financials.png`, probe `selects`].
6. **Charts are good but unframed.** Flat bars, hatched interest, identity colours (`/debt`), ember endpoint on sparklines (`/review`) [V]; but the unit is an axis name top-left, the only title is the panel `h2`, no source line on canvas or PNG, and the phone legend paginates "1/2" (`dark_390_company_phoenix_savings.png`) [V].
7. **States and brand are thin.** 404 is a half-empty card; 38 pages use `Loading` ("טוען…" + flapping mark), 3 a skeleton; the brand is a navy bar, a 2-px hairline and a 40-px mark; in dark every company name is an orange-gold link [V `phoenix_1440_nope-404.png`, `dark_1440_home.png`, `ui.tsx:42-49`].
8. **RTL is nearly clean.** Deltas print "−5.5% YoY" correctly; one regression: phone scroll tables clip mid-digit (".54%") at the edge with no fade mask (`phoenix_390_funds.png`) [V].

Generic tells that remain [V]: one white 12-px card for everything · headings = bold text + 3-px tick · native selects beside pills · figures floating in wide columns · two-line cells with chips · pink lead rows · green on levels · ember as link, footnote, page ref, outline button, tick and dot on one screen · "טוען…" · a 404 without the mark · near-black dark (page L 0.135).

## 2. Gap to 9.0+ (ranked)

| # | Change | Effort | Depends on | Test that proves it |
|---|---|---|---|---|
| 1 | **Lead-first screens.** Every route opens with one lead (figure, sentence or chart) and one toolbar row; places/views/period/basis collapse into menu-button + tabs (`mock_table_toolbar.png` A); on phone a 44-px context bar replaces the stacked rows | M | ws2/ws3 | controls before first table ≤ 8 on 18 routes; first table ≤ 300 px at 1440, ≤ 420 px at 390; overview ≤ 2,400 px |
| 2 | **Table grammar v2** (`mock_table_toolbar.png` B, `mock_home_1440.png`): 28/34-px rows, label column ≤ 30 %, figures gathered beside the label, latest period as a tinted lead column, section rules, derived in italics, one `עמ׳` column, manager/sector as an inline dot never a second line, sparkline column on ledgers | M | 1 | home/funds rows ≤ 34 px at 1440, ≤ 56 px at 390; no `td` over 2 lines |
| 3 | **Colour discipline.** `pos/neg` only on deltas and signed P&L (fund returns → ink); `tr.lead` = 6 % ink tint + 3-px ember rule, never ember-soft; ember-as-text ≤ 6 per screen (links in `--fg`, ember on hover); footnote markers `--muted`; dashes → empty cell with tooltip | S | — | `.pos` on level columns = 0; `accentText` ≤ 6 per route; 0 ember-background lead rows |
| 4 | **One control grammar.** Tabs = white tile in a paper track; toggles the same; menus = menu-button with summary (`mock_table_toolbar.png` C); delete the navy pill, the ember underline and the 7 native selects; the sticky `.top` becomes paper in both themes (navy bar is the deck, not the product) | M | 1 | one selected style in the visual baseline across 14 screens × 2 themes; `select` count = 0 |
| 5 | **Enforce the type scale.** A deploy gate computes font sizes on 10 routes: set ⊆ {11, 12.5, 13.5, 15, 18, 22, 28, 40}, 0 nodes < 11 px, weight 600 banned (map to 700); kill the 8-px and 10-px literals (`debt.css`, `csm.css`, home ticks) | S | — | gate green; probe `nSizes` ≤ 8, `small` = 0 on all routes |
| 6 | **ChartFrame + stamped export** (`mock_chartframe.png`): title · unit/period/basis · wrapped legend (never paginated) · latest-only value label · standard-break chip · source line with page and "כפי שדווח" · tools in one quiet row; PNG/PPTX render the frame and the mark | M | provenance strings per chart (exist for statements/CSM/debt) | every `canvas` has a sibling source line with a page ref; export = canvas + frame; no legend pagination at 390 |
| 7 | **Dark theme plates** (`mock_states.png` bottom): page L 0.16, panel 0.215, raised 0.26, 1-px lit top edge; company names in `--fg`; selected tile = panel-3, not near-white | S | — | page/panel luminance ≥ 1.3; link-coloured company names in tables = 0 |
| 8 | **States** (`mock_states.png`): loading = skeleton of the real shape, mark small and still; empty = what, why, one action, "checked n documents · updated dd.mm.yy"; 404 = mark + search + three recents | S | — | 0 bare "טוען" nodes; every `Empty` has a reason and an action; 404 shows the mark |
| 9 | **Phone polish.** Scroll-edge fade mask on `.scroll` tables; top bar 3 icon buttons → 1 menu; 5 export chips → one "ייצוא" menu; fund names one line | S | — | no mid-glyph clip at the edge; top bar ≤ 2 controls; 0 wrapping chip rows |
| 10 | **Brand voice in the figures** [J]. Heebo stays for Hebrew; every figure (KPI values, table numerals, axis labels) in one Latin numeral face with character and true tabular figures (candidates: Geist, Instrument Sans, IBM Plex Sans; check 1/7/0 at 13 px) — a recognisable texture without illustration; one wordmark lockup used in the frame stamp | S | 6 | one `font-family` on all `.num`; owner A/B over two sessions |
| 11 | **Three brand moments**: first paint of the day (mark settles into the rail), data arrival (rows fade 120 ms), source-sheet open (slides 12 px); nothing else moves | S | — | keyframes ≤ 6; reduced-motion stills all |
| 12 | **Design regression as a gate.** `/_design` route (tokens, controls, table, ChartFrame, states) + Playwright shots of it and 10 routes × 2 themes × 2 widths on every deploy; rules 3/5/7 as assertions | S–M | 1–8 | an off-scale token fails CI; baseline diff ≤ 0.5 % |

1–8 reach ≈8.5; 9–12 make 9.0+ hold.

## 3. Bold options

**A. The fox tear sheet.** One-page company sheet (A4 and 16:9) from the same tokens and ChartFrame: identity-coloured header, 8-row KPI ledger, two framed charts, CSM bridge, solvency, a source line under every figure, fox stamp; PDF/PNG/PPTX from the company header and in bulk on report day. For: IC memos and anyone forwarding a page. No free source has a sourced tear sheet for Israeli insurers; sell-side PDFs carry no page citations [J]. Data: already in `web/public/data`. Risk: ECharts print fidelity (render to SVG). Cost: M, after items 2 and 6.

**B. Document thumbnails as texture.** Render page 1 of all 2,768 filings and presentations to 160-px WebP in the pipeline (`pdftoppm`); show them in the filings list, search results, calendar and the season strip; hovering a page ref previews that page. Visual richness from real artefacts, not illustration. Free data: the indexed PDFs. Risk: ≈60 MB of thumbnails (lazy). Cost: S + S.

**C. Desk mode at ≥ 1600 px.** Three panes: ledger or peer table right, sticky ChartFrame middle, source reader left opened by clicking any figure; resizable, layouts saved under "שלי". The 1920 home already shows this is the layout that looks like fox [V]. Koyfin dashboards are paid [T]; nothing Israeli does it. Risk: a second layout — scope to 4 routes. Cost: L.

**D. Seasonal chart book, auto-published.** On report day the pipeline renders the 24 house charts per filer, both themes, framed and stamped, as a gallery (`/book/Q2'26`) and PPTX with a share link and OG image per chart — the visible proof of craft. No free Israeli source ships a sourced chart book [J]; Koyfin shares single charts [V release notes]. Risk: ≈3 min headless render. Cost: M, after 6.

**E. Identity v2: monograms.** Two-letter Hebrew monogram chips in the identity colour (הפ, הר, מג…) replace dots in tables, legends, search and the phone scoreboard; a 56-px monogram leads the company header. Texture across 17 names without logos or illustration. Cost: S. Risk: collisions (מו/מי) — hand-pick.

**F. Design-token contract.** Publish `tokens.json` (colours, identity palette, type scale, chart rules) under `/data`, consumed by the exporters, the tear sheet and the MCP server so Ask-fox charts match the site. Cost: S; also item 12's foundation.
