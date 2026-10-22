# ws1 · Competitive positioning and product strategy (22 Oct 2026)

Scope: prodata.co.il (deep), Koyfin / TIKR / Fiscal.ai / Qualtrim (extending `research/*_teardown.md`, not redoing them), FUNDER, Bizportal, TASE/Maya, EY InsurTool; Israeli professional segments and jobs-to-be-done; the free-data universe; positioning of the live site. Evidence tags: [V] verified by me today (DOM dump, screenshot, fetch, API call), [V-prior] verified by an earlier teardown in `research/`, [T] second-hand, [J] judgment. Screenshots and DOM dumps are in `shots/ws1_*`. Effort: S < half a day, M = 1–3 days, L > 3 days.

---

## 1. Verdict

fox's positioning is 6/10 today: a tier-1 data asset (the only time-series of every IFRS 17 line, CSM bridge, solvency fact and regulator fund month for Israeli insurers and LTS managers, each cell with a page) sold under a tier-3 story ("ביטוח, פנסיה וגמל. מהדוח, עם עמוד המקור" is a description of inputs, not a promise to a user) and navigated by data source rather than by job. The named arch-rival is misidentified: **prodata.co.il is ProData Gemel, a workflow tool for licensed insurance/pension agents built on the same three data.gov.il datasets fox already ingests** [V]; it has no insurer fundamentals, no IFRS 17, no company pages, and its moat is clearing-house import + regulatory "מסמך הנמקה" generation, not data. The real direct competitor on insurer fundamentals is EY InsurTool (free, 19 entities, one quarter at a time, Power BI) [V-prior]; on product mechanics it is Koyfin (search-as-navigation, templates, sharing) [V]; on the funds layer it is prodata (8/10 on analysis depth over identical data [V from its published screenshots]). Best competitor scores: InsurTool 6/10 on insurer analytics [V-prior], prodata 8/10 on fund analytics [V/T], Koyfin 8/10 on mechanics [V]. fox already beats all three on depth and provenance; it loses on finish, on stating its wedge, and on three large free-data assets it has not touched (quarterly asset lists, MAYA ownership data, the regulator-flows-to-P&L join). The unbeatable thesis is not "a free Koyfin for Israel"; it is **"the audited fact base of Israeli long-term savings, free, before anyone else has read the PDF."**

## 2. Findings, ranked by damage

**W1-1. The competitor the owner named is not a competitor for 80 % of the product.** Evidence: `shots/ws1_prodata_home.html` ("כלי עזר מקצועי לסוכני ביטוח ופנסיה … הכלי המקצועי ביותר לבעלי רישיון"); `shots/ws1_prodata_go.html` (features: ייבוא תיק מהמסלקה, הצעה ללקוח, מסמך הנמקה, מחולל תמהיל, מסלול משולב, דירוג כוכבים; data "ממערכות פנסיה נט, גמל נט וביטוח נט של משרד האוצר"; "נבנה לבעלי רישיון. לא לקהל הרחב"); owners: Index (TMX group) + Predicta; no pricing published, demo-only sales [V]. ProData Capital's other two products (Institutional Holdings dashboard on Tableau, Index-flow forecasts) are paid B2B and not reachable [V DOM of prodatacapital.com]. Why it matters: a roadmap aimed at prodata would build agent workflows (proposals, reasoning documents, portfolio import) that the analyst segments do not want and that carry advisory liability. Fix: adopt the benchmark set InsurTool (insurer analytics) · prodata (funds-layer analytics only) · Koyfin/Fiscal (mechanics) and write it into PRODUCT.md. S.

**W1-2. No stated wedge; navigation is by data source, not by job.** Evidence: home hero copy and nav "בית · חברות · השוואה ענפית · שווי · קופות ושוק" (`shots/ws1_fox_dom_.html`); company page has eight tabs named after sources (סקירה, יום הדוח, סקירת דוח, דוחות כספיים, מקורות רווח וענפים, IFRS 17, חיסכון ארוך טווח, מסמכים) [V]. Why: every segment below arrives with a question ("what changed", "versus whom", "what is it worth", "who gained share"), and the first screen answers none. Fix: home = report-day feed ("שונה מאז הביקור האחרון") + three job entry points; company page tabs grouped as תוצאות · ערך · מסמכים. M.

**W1-3. Provenance is the moat and is invisible as a feature.** Evidence: cells are underlined links to a page (`/company/harel` DOM: "דוח כספי, עמ׳ 52"), but there is no audit-trail surface, no "N numbers, N pages" count, no export carrying the page column; Fiscal.ai sells "Data Auditability To Filing" and "Export & Download" only in its Max tier [V-prior `fiscal_teardown.md`]; Koyfin's page does not mention source links at any tier [V `koyfin.com/pricing`]. Fix: a provenance badge on every table header ("כל תא מקושר לעמוד"), an XLSX/CSV export whose last column is the MAYA URL + page, and a side panel that opens the page image. M.

**W1-4. The funds layer sits on identical data to prodata and shows a third of the analysis.** Evidence: `/funds` columns are 1M/YTD/LTM/3Y/5Y, fee, assets, Sharpe, equity %, "רבע עליון" [V DOM]; prodata's published screens show a 71-month custom window with cumulative chart vs category, a crises/recovery table (Corona, 2022 rates, Oct-2023, 2008 with months-to-recover), a monthly return heatmap, four table views (returns, asset mix, illiquid, Israeli equities), star rating within risk group, "add synthetic track" [V `shots/ws1_prodata_shot_*.png`]. fox already loads 176 months of per-track data (`market.json` periods 201201…202608) [V]. Fix: a track card (cumulative chart vs category average, calendar-year table with rank, drawdown table for the four named events, monthly heatmap, exposures over time) built from data already shipped. M.

**W1-5. The one thing prodata cannot have is not linked: track → manager economics.** Evidence: `/industry/econ` is the LTS P&L (דמי ניהול, הוצאות, רווח לפני מס per manager with page refs; 9/12 managers H1'26) [V]; `/funds` rows carry a manager name but no link to it, and "יצרן מול השוק" is a separate tab [V]. Why: allocators and buy-side judge a manager by fee yield and margin on the AUM the regulator reports; prodata/FUNDER/Gemel-Net cannot show it. Fix: manager chip on every fund row linking to `/company/:id/savings`; on the company savings tab a "fee revenue run-rate = AUM × reported fee" line, labelled נגזר. S–M.

**W1-6. Nowcast opportunity unused.** Evidence: regulator data is at 08/26 (`market.json asof 202608`) while the latest statements are Q2'26 (reported 25–27 Aug); Q3'26 reports arrive late November [V]. Why: fox can publish, per manager, "Q3'26 so far: AUM, net flows, implied fee revenue vs Q2'26" six weeks before the filing, labelled אומדן — no competitor does this and no paid vendor can do it better because the input is public. Fix: nowcast card on the company overview and a sector row on home. M.

**W1-7. MAYA ownership data unused.** Evidence: the TASE company page for Harel lists interested parties and institutional holders with dates (הפניקס-ק.גמל 3.29 %, הפניקס-ק.נאמ 2.01 %, הראל-ק.נאמ 1.08 %, 30/09/2026), "החזקות מוסדיים וקרנות גידור 6.62 %", a "קרנות מחזיקות" list, bond series, and the index memberships (ת"א-ביטוח, ת"א 35) (`shots/ws1_tase_harel.html`) [V]. Why: "who owns the insurers" and cross-holdings between the 17 groups is a question journalists and buy-side ask every quarter; nobody shows it over time. Fix: ownership tab per company (holder, %, date, change QoQ) and a cross-holdings matrix; fetch via the same same-origin MAYA API pattern already used for reports [V-prior `sources.md`]. M.

**W1-8. Quarterly asset lists (רשימות נכסים רבעוניות) unused — the largest free dataset in the domain.** Evidence: data.gov.il copies stop at 2017/2023 (`nechasimg`, `nechasimp`, `nechasimb`, `mishtatef` all "updated 2023-03-21") [V API], but every manager publishes the uniform-format Excel on its own site each quarter (Meitav, Infinity, Migdal pages found; format fixed by CMA circular: security id, issuer, venue, % of track) [V search results, T on circular text]. ProData Capital sells exactly this as "Institutional Holdings dashboard … holders in a specific security, asset allocation at fund/manager/corporate level, trends over time" [V DOM]. Why: asset allocation per manager over time, illiquid/private-credit exposure trend, overlap between managers, concentration in TA-35 names — the due-diligence layer for allocators and the risk layer for insurer analysts (nostro vs participating). Fix: Phase 3 scraper over ~17 sites × 8 quarters, normalised to one parquet; expose allocation and overlap first, single-security holders second. L. Risk: format drift per manager; file sizes (100k rows); must attribute per the CMA disclaimer.

**W1-9. Entity coverage is narrower than the only direct competitor.** Evidence: EY InsurTool filters 19 entities (incl. Shomera, Wesure, AIG, Libra, Shlomo, Haklai, David Shield, Securitas, Ankor) [V-prior `insurtool_summary.md`]; fox has 8 insurers, and the home table shows four rows that are entirely "–" (מיטב, אינפיניטי, גלובלנט, ביטוח ישיר) [V DOM]. Why: P&C market-share and new-business-share questions need the long tail; a first-screen row of dashes undercuts the "every insurer" promise. Fix: XBRL headline tier for every listed insurer (Wesure, Libra, IDI already listed on MAYA) is S–M; hide or mark "XBRL בקרוב" rows now. S.

**W1-10. Fund houses are half-covered (A3-E2 still open).** Evidence: `/company/altshuler` shows eight XBRL cards from Q1'22 and the "דוחות כספיים" tab (now visible) still has no statements; RESUME.md lists the extraction as the stalled job (≈30 agents, 5–8 M tokens, needs budget approval) [V]. Why: the 9 fund houses are half of the stated universe and the whole of the "manager economics" thesis. Fix: run the extraction in Phase 3 with the approved budget; until then rename the tab "XBRL בלבד". L.

**W1-11. Sensitivities, SCR composition and ratings are absent from the capital story.** Evidence: `/industry/capital` shows ratios with/without transitional, board target, surplus, dividend, policy [V]; 216 extracted sensitivity rows are shown on no route sampled (A3-E7 still open) [V]; solvency reports exist in the registry for FY'25 (Harel "דוח יחס כושר פירעון כלכלי 31.12.2025" in the docs list) but SCR by risk module is not extracted [V]; Midroog IFS ratings and rating actions are public (IDI upgraded to Aa2.il; Menora Holdings Aa2.il; Migdal hybrids Aa3.il) [T funder.co.il]. Why: dividend capacity and rate sensitivity are the two questions a buy-side insurer analyst asks after earnings. Fix: capital engine = SCR waterfall per insurer + sensitivity grid (rates, equities, mortality, lapses) + BOI zero-coupon curve overlay (free SDMX `ZCM`, verified in `sources.md`) + rating timeline. M.

**W1-12. Valuation page still prints a verdict from defaults (A3-B10 partly open).** Evidence: `/valuation/phoenix/dcf` opens on "83.51 ש"ח" vs input price 171.10 with a yellow "המחשה בהנחות ברירת מחדל" banner; the price input now carries a date (09.10.26) (`shots/ws1_fox_valuation_1440.png`) [V]. Why: for an insurer the credible frame is P/B vs ROE and dividend capacity, not a DCF; a −51 % headline on a default page damages trust with the exact segment (sell-side) fox should court. Fix: default view = justified P/B from reported ROE/ke/g with no per-share verdict; DCF behind "מתקדם"; SOTP seeded from SOP data. M.

**W1-13. The funds "ranking" has no transparent category rating, so prodata's stars win the agent/consultant conversation.** Evidence: fox shows rank, Sharpe, "רבע עליון 3/5" [V]; prodata shows 1–5 stars "within product type and risk group" from multi-period return, Sharpe, negative-month frequency, under-performance vs group, weights undisclosed [V marketing page]. Why: a rating is what gets quoted. Fix: a published, reproducible score (rank by return, by Sharpe, by consistency; components visible, no black box) with a methodology page — fox's version is the auditable one. M.

**W1-14. Period vocabulary and ISO dates remain on the first screens (A3-C1 still open).** Evidence today: home KPIs "אוג׳ 2026"; Harel overview solvency card "2026-03-31"; every filings row "2026-08-27"; valuation "09.10.26" [V DOM]. Fix: one `plabel()`; "08/26" for regulator months, "Q1'26" for solvency instants, DD.MM.YY only inside document lists. S.

**W1-15. KPI count-up animation makes numbers non-deterministic.** Evidence: two renders of `/` seconds apart read 2,933 / 1,264 / 1,088 / 581 (DOM dump mid-animation) vs 2,996 / 1,291 / 1,112 / 594 (screenshot) [V `shots/ws1_fox_dom_.html` vs `ws1_fox_home_1440.png`]. Why: a research tool's numbers must be copyable and screenshot-safe at t = 0; this also breaks automated QA. Fix: no count-up; motion on the chart, not the figure. S.

**W1-16. The search box promises Koyfin's best mechanic and under-delivers on discoverability.** Evidence: placeholder "חברה, קופה, או חברה + פונקציה: הראל csm"; `components/Search.tsx` defines function codes per company [V source]; there is no visible list of codes, no `Tab`-to-subpage, no recent/saved items; Koyfin exposes the function list after a ticker is chosen [V-prior]. Fix: show the function list on company selection, add a "קודים" cheat sheet in the drawer, keep last five. S.

**W1-17. Export is chart-only.** Evidence: charts carry PNG · CSV · העתקת קישור (`/industry/sectors` DOM) [V]; the statements table, matrix and funds table have no XLSX/CSV with source column found in the DOM [V, source grep inconclusive]. Why: sell-side and journalists leave with a file; Koyfin Plus and TIKR Pro gate exports [V/T]. Fix: one `exportTable()` with page URLs. S.

**W1-18. No citeable permalink or open dataset — the distribution engine of a no-paywall product is missing.** Evidence: no "cite this" / permalink-with-source-stamp on cards; `web/public/data/*.json` is fetchable but undocumented and unlicensed [V]. Why: with no paywall, the business model is reach and authority; journalists and students cite what is easiest to cite. Fix: `/data` page listing the fact tables (CSV/parquet + schema + licence + "as of"), a "העתק ציטוט" on every chart producing "fox · הראל · CSM נטו · Q2'26 · דוח רבעוני עמ' 52 · link". S–M. Risk: prodata-type vendors ingest it — their buyers are not fox's users [J].

**W1-19. Regulatory layer absent.** Evidence: no route shows CMA circulars, the commissioner's annual report (chapters with premiums by line and pension share are public PDFs on gov.il) [V search], the annual complaints-by-company report (published today per Walla) [T], or the service index (data.gov.il copy stale 2016; annual publication on gov.il) [V/T]. Why: strategy teams, journalists and regulators read the sector through these; InsurTool does not have them either. Fix: a "רגולציה" timeline per company (circulars affecting it, complaints per 10k policies, service index) and sector pages from the commissioner report tables. M.

**W1-20. Mutual funds are out of reach and should be declared out of scope.** Evidence: no free TASE/ISA dataset with returns; TASE DataHub needs a key and (per docs) has no returns [V-prior `funds_page_spec.md`]; FUNDER covers them [V]. Fix: a one-line "לא כאן: קרנות נאמנות, מחירים" in the about drawer so the funds page is not judged against FUNDER. S.

**W1-21. The English layer is zero while the source is partly English.** Evidence: Harel publishes "Interim Report … translated version" and English presentations (docs list) [V]; Fiscal.ai is the only English venue for TASE insurers and shows a generic template with 6 free quarters and no IFRS 17 [V-prior]. Why: foreign holders of the TA-insurance names and English-speaking analysts in Israeli houses would use fox if labels existed; it is a distribution lever, not a brand change. Fix: label-level EN toggle from the taxonomy (`lib/labels.ts`), Hebrew stays default. M–L, Phase 3. [J]

**W1-22. "Mor" duplication fixed, but the home table still mixes holdings and subsidiaries without a legend.** Evidence: "מור גמל ופנסיה · חברה בת, נכללת בנתוני מור" now a sub-row [V]; Harel vs Harel Insurance (MAYA 585 vs 1175) and Menora Holdings vs Menora Insurance are not distinguished anywhere the user can see [V/J]. Fix: entity chip (קבוצה / חברת ביטוח / חברה מנהלת) on every page header. S.

**W1-23. Nothing tells the professional that "all history, free" is a deliberate stance.** Evidence: Koyfin Free = 2 years of financials, 2 watchlists [V pricing page]; TIKR Free = US only, 5 years [V pricing page]; Fiscal.ai Pro/Max = 15/20+ years, exports Max-only [V-prior]; fox shows Q4'18→Q2'26 XBRL and Q1'20→Q2'26 statements with no statement of policy [V]. Fix: one sentence in the about drawer and the README; the roadmap's "open data" page makes it credible. S.

**W1-24. Mobile first paint of the home page could not be captured.** Evidence: two headless runs at 390×844 produced a 6 KB (blank) PNG while `/company/harel/review` rendered correctly at 390 [V `shots/ws1_fox_home_390.png`, `ws1_fox_harel_review_390.png`]. Likely the hero animation plus virtual-time budget; flagged to the mobile workstream to verify on device rather than claimed as a bug. S to verify.

## 3. Radical moves

**R1. "Savings Lens" — join the regulator's monthly flows to the managers' quarterly P&L, and nowcast.** What: one page per manager and one sector page where AUM, net transfers, organic accumulation, weighted fee (regulator, monthly) sit on the same axis as management-fee revenue, expenses and pre-tax profit (statements, quarterly), producing fee yield, cost/income, profit per ₪bn AUM, flow-weighted share, and a labelled Q-to-date nowcast of fee revenue. Why it wins: prodata has flows and no P&L; EY has P&L (investment contracts only) and no flows; Koyfin has neither [V/V-prior]; the inputs already exist in fox (`market.json`, `savings_econ.json`, `lts.json` 10,196 facts). Cost: M for the join and the nowcast; L once fund-house statements land. Risk: mixing regulator entities (management companies) with reporting entities (groups) — needs the basis chip per cell.

**R2. "Who owns whom" — ownership and asset-list graph.** What: per insurer, institutional and interested-party holders over time from MAYA; per manager, asset allocation, illiquid share, top issuers and overlap with peers from the quarterly asset-list files; a cross-holdings matrix of the 17 groups. Why it wins: ProData Capital charges for this and keeps it in Tableau behind a login [V]; Bank of Israel publishes aggregates only [V-prior]; no free venue shows it. Cost: M for MAYA holders, L for the asset-list pipeline (17 sites, drift). Risk: scraping fragility; must display the CMA disclaimer ("נאספו על ידי גורם שלישי"); size.

**R3. Report day as the product's front door — the diff terminal.** What: the home page opens on the latest filing: eight headline deltas, restated-vs-original with a 2 % flag, CSM bridge movement, targets vs actual, lines that appeared/disappeared, and a text diff of the board report vs the previous quarter; one URL per filing. Why it wins: FactSet keeps restated series but shows no diff [T]; Quartr sells presentation comparison [T]; Koyfin's "Compare Matrix" is beta and generic [V-prior]; fox already has the `restated` block and all PDFs. Cost: M (already 6b-2 in audit 3; this elevates it to the home). Risk: diff noise on reformatted reports — restrict to the taxonomy-mapped lines.

**R4. Function codes + any-line peer series + chart book.** What: `/הראל csm`, `/כלל combined`, `/מור דמי ניהול` open a screen; from any row label, "מול עמיתים" charts the same taxonomy line for all companies over Q/H/FY/LTM with the standard-break band; a chart book renders a saved set to PNG/CSV/XLSX with a source line. Why it wins: Koyfin's mechanic over a taxonomy Koyfin does not have; Fiscal.ai gates templates, as-reported and export behind Max [V-prior]. Cost: M (search exists; `labels.ts` exists). Risk: taxonomy coverage of the 5,077 lines.

**R5. Capital engine + open fact base.** What: SCR waterfall, sensitivity grid, dividend capacity (surplus over board target × policy), BOI real/nominal curve overlay, rating timeline; and a `/data` page publishing the fact tables under an open licence with a citation generator. Why it wins: Bloomberg has solvency fields for EU names only [T]; no one publishes Israeli insurer sensitivities as a series; open data turns journalists and students into distribution. Cost: M + S. Risk: open data invites misquotation — every file carries the as-of and the page column.

Kill or stop: agent workflows (clearing-house import, proposals, reasoning documents) — wrong buyer, advisory liability; mutual funds — no free source; any price/market strip; `/market/*` as a second subnav over the funds data; `/industry/headline` (fold into matrix); the IFRS 17 "all rows" dumps (CSV download instead); DCF as the default valuation view.

## 4. Quick wins (≤ 1 day each)

- Write the wedge sentence and the benchmark set into PRODUCT.md and the about drawer ("כל מספר של כל מבטח ומנהל חיסכון, כסדרה, עם עמוד — חינם").
- Hide or label the four all-dash rows on the home table ("XBRL בקרוב").
- Manager chip on every `/funds` row linking to `/company/:id/savings`.
- Remove count-up on KPI numbers.
- "העתק ציטוט" on every chart card (title · company · period · source doc · page · URL).
- Function-code cheat sheet in the drawer and after company selection in search.
- One-line scope statement: "לא כאן: קרנות נאמנות, מחירים".
- Entity chip (קבוצה / חברת ביטוח / חברה מנהלת) in the company header.
- Period labels on home, solvency card, filings list → `plabel()`.
- Drawdown-for-four-crises table on the fund track (data already loaded; compute client-side).
- A `/data` page listing existing JSON files with as-of and licence (no new pipeline).
- Valuation default view = justified P/B, no per-share headline until an input is edited.

## 5. What top tier does that we don't / what we do that nobody does

**They do, we don't**
- Search as navigation with function codes shown after the ticker, and `Tab` to sub-pages (Koyfin [V-prior], Fiscal.ai [V-prior]); fox has the codes but hides them [V].
- Named, shareable chart templates with permissions and folders (Koyfin [V-prior]).
- Table export to XLSX/CSV on every grid (Koyfin Plus, TIKR Pro, Fiscal Max [V/V-prior]).
- Fund track card with custom window, cumulative-vs-category, heatmap, crisis drawdown, risk-group rating (prodata [V from published screens]).
- Cross-sectional ranking with "whole market" card and comparability footnotes as a field (InsurTool [V-prior]).
- Entity breadth: 19 insurer entities (InsurTool [V-prior]); 100k+ companies (Koyfin [V]).
- Institutional-holdings dashboard with holder lookup (ProData Capital, paid [V DOM]).
- One-metric-per-card overview grid with KPI tags (Qualtrim [T]); fox's overview is close [V].

**We do, nobody does**
- Every IFRS 17 statement line of seven Israeli insurers, quarterly Q1'20→Q2'26, each cell linked to a page [V]; Fiscal.ai shows Harel in a generic template with 6 free quarters and no CSM [V-prior].
- CSM bridges, expected release, new-business/release ratio across peers (`/industry/csm`) [V]; InsurTool shows CSM as a single-quarter bar [V-prior].
- Regulator fund data since 1999 for 1,251 tracks beside manager P&L with page references (`/industry/econ`) [V]; prodata has the tracks and no P&L [V].
- Restated-vs-original panel per statement [V-prior audit 3].
- Solvency with/without transitional, board target, surplus and payout policy on one grid with the source page [V].
- No paywall, no history gate, no data licence cost [V].

## 6. Inputs to the roadmap

**Phase 1 (2 weeks: fix + polish)** — W1-1, W1-2 (copy and nav labels only), W1-9 (dash rows), W1-14, W1-15, W1-16, W1-17, W1-20, W1-22, W1-23, the quick-wins list, and W1-12's default view. Dependency: ws2/ws3 correctness fixes on the statements page (audit-3 A1–A4) must land first; positioning claims about trust are empty while EPS prints ×1000.

**Phase 2 (1–2 months: level-jump)** — R3 report-day front door; R4 function codes + any-line peer series + chart book; R1 Savings Lens (join + nowcast on existing data); W1-4 track card and W1-13 transparent rating; W1-7 MAYA ownership tab; W1-11 capital engine with BOI curves; W1-18 `/data` page and citation; W1-19 regulatory timeline (commissioner report tables first). Dependencies: chart engine work (ws charting) for the peer series and chart book; design system (ws design) for the card/rating primitives; pipeline guard (`check_fs.py`) before any new fact family ships.

**Phase 3 (quarter: platform/data)** — W1-10 fund-house statements (budget approval per RESUME); R2 asset-list pipeline and cross-holdings graph; W1-9 XBRL tier for all listed insurers; SCR-by-module extraction from solvency reports; W1-21 EN labels; sync (watchlist, notes, saved views) so the segments beyond the owner can adopt. Dependencies: extraction budget; a scraper runbook per manager site; legal note on redistributing asset-list files with the CMA disclaimer.

---

### Appendix A · Segments and jobs-to-be-done [J unless noted]

| Segment (Israel, est. size) | Job | fox today | Could win with |
|---|---|---|---|
| Sell-side insurance analysts (≈10–15: Leader, IBI, Psagot, Excellence, bank research) | Update the model within hours of a filing; peer table for the note; source page for compliance | Wins on data; loses on export and on A1-type errors | R3 + XLSX with page column + R4 peer series |
| Buy-side PMs/analysts (hedge funds, nostro desks, mutual-fund managers covering TA-insurance) | Relative value across 7; where CSM grows; dividend capacity; thesis monitoring | Wins on matrix and CSM; loses on watchlist/sync and valuation defaults | R5 capital engine, R3, saved views with sync |
| Institutional LTS allocators and consultants (pension committees, employer consultants, family offices) | Manager due diligence: flows, fees, consistency, asset mix, manager health | Partly (funds + econ exist, unlinked) | R1 Savings Lens, R2 allocation/overlap, W1-13 rating |
| Insurers' and managers' strategy / FP&A teams (17 groups) | Competitor KPIs by segment, new-business share, fee benchmarks | Wins on time series vs InsurTool; loses on 19-entity breadth and Adjusted profit | W1-9 breadth, basis chips, R1 |
| Financial journalists (≈10–20 on the insurance/pension beat: Calcalist, Globes, TheMarker, Funder, Polisa, Adif) | A chart with a source by tonight; "who gained share this month" | Wins if export and citation exist | W1-18 citation, PNG with source line, R1 nowcast |
| Regulators, BOI, Knesset research | Sector aggregates, concentration, comparability | Possible, low priority, high prestige | R2, W1-19 |
| CFA students / juniors | Learn IFRS 17 by example; definitions | The "i" notes exist | Glossary page from `labels.ts`, worked examples |
| Licensed agents (prodata's buyer, ≈15k licences) | Proposal and reasoning document for a client | Do not pursue | — |

### Appendix B · Free-data universe: source → features → status

| Source | What | Enables | Status | Feasibility |
|---|---|---|---|---|
| data.gov.il CMA `gemelnet`, `pensia-net`, `insurance` (monthly since 1999, updated 22 Oct 2026) [V] | Returns, fees, flows, exposures, Sharpe, σ per track | Rankings, flows, track card, crises, heatmap, nowcast | Used (1,251 tracks; 176 months in `market.json`) | Track card and nowcast: M |
| data.gov.il `transfer_bank` (updated 22 Oct 2026) [V] | Fund IDs and transfer details | Entity/track mapping, merger lineage | Not used | S |
| data.gov.il asset lists `nechasimg/p/b`, `mishtatef` [V] | Security-level holdings | — | Stale (2017; last touched 2023) | Use manager sites instead |
| Manager websites: quarterly asset lists (uniform CMA Excel) [V pages found] | Security-level holdings per track, nostro/participating | Allocation over time, overlap, illiquid share, holders of a security | Not used | L (R2) |
| Manager websites: expected investment policy per track (annual) [T] | Target allocation ranges | Policy vs actual drift | Not used | M |
| MAYA report PDFs + same-origin API [V-prior] | Statements, board reports, presentations, solvency reports | Everything extracted today | Used (2,774 docs registry) | — |
| MAYA XBRL [V-prior] | 8 headline KPIs since 2018 | Overview cards | Used | Extend to all listed insurers: S–M |
| MAYA/TASE company page [V] | Interested parties, institutional %, mutual funds holding, index membership, bond series | Ownership tab, cross-holdings, index map | Not used | M (W1-7) |
| MAYA events "מועדים ותשלומים" [V page section] | Ex-dates, payments | Dividend history (A3-E4) | Not used | M |
| Magna (ISA) [V-prior] | Same filings; reCAPTCHA | Backup only | — | — |
| Bank of Israel SDMX `BR`, `ZCM`, `EXR`, `INSINV` [V-prior; site behind Radware today] | Policy rate, zero-coupon nominal/real curves, FX, institutional aggregates | Curve overlay for CSM/solvency sensitivity, FX exposure context | Not seen on any sampled route | S–M |
| CBS `api.cbs.gov.il` [V-prior] | CPI | Real-return context | Not seen | S |
| gov.il CMA: commissioner's annual report chapters [V search] | Premiums by line, pension shares, LTC | Sector pages, long-run share | Not used | M (PDF tables) |
| gov.il CMA: complaints report by company [T], service index [V stale copy] | Complaints/10k, service scores | Regulatory layer | Not used | M |
| gov.il CMA circulars [V] | Regulation timeline | Per-company regulatory events | Not used | M |
| Midroog / S&P Maalot reports [T] | IFS ratings, actions | Rating timeline on capital tab | Not used | S–M |
| Company IR sites [V-prior] | English translations, presentations | EN layer, deck images | Partly (registry) | M |
| TASE DataHub [T] | Fund classification; key required; no returns | Little | Not used | Skip |
| Pension clearing-house files | Client portfolios | prodata's moat; private | N/A | Out of scope |

### Appendix C · Competitor notes (extending prior teardowns)

- **prodata.co.il / go.prodata.co.il** [V]: login by email code, "לבעלי רישיון בלבד"; public preview table of September returns for pension/hishtalmut by track; marketing claims 1,200+ tracks, monthly since 1999, star rating 1–5 within product × risk group (inputs: multi-period return, Sharpe, negative-month frequency, under-performance vs group; weights undisclosed), four market views, heatmap, crises table (Corona, 2022, Oct-2023, 2008), mix generator, synthetic track, portfolio import from clearing-house ZIP/XML/DAT, proposal and AI reasoning document with agent logo, support chat, mobile. No pricing; demo-only. Owners: Index Research (TMX group since 2024) and Predicta. The terms of use forbid automated download of its tables. Not reproducible from free sources: clearing-house import, proposal/reasoning workflow. Reproducible: everything else (same three datasets).
- **ProData Capital** (prodatacapital.com) [V DOM]: three products — LTS analytics (above), Index-flow forecasts (ETF rebalancing calendar), Institutional Holdings dashboard (Tableau Online, login). Target list includes institutions, banks, hedge funds, IR firms. Contact-only pricing.
- **Koyfin** [V pricing page]: Free $0 (2 years financials, 1 year estimates, 2 watchlists/2 screens, 2 dashboards), Plus $39, Premium $79 (custom formulas, templates), Advisor Core $209 (mutual funds), Advisor Pro $299. Mechanics per `koyfin_teardown.md`.
- **TIKR** [V pricing page]: Free (US only, 5 years/8 quarters, 90-day transcripts), Plus $24.95, Pro $54.95 (exports), Ultimate $119.95 (30 years).
- **Fiscal.ai** [V-prior; prices T]: Pro ≈ $49/39 and Max ≈ $99/79 per month (third-party, Oct 2026); Harel generic template, 6 free quarters, no IFRS 17, no segments, no docs.
- **Qualtrim** [V-prior]: $9.99/mo; one-metric-per-card grid; no Israeli depth.
- **FUNDER** [V fetch]: mutual funds, ETFs, gemel/hishtalmut/pension/policies sub-sites, holdings browser, inflow/outflow rankings, personal portfolio; no premium tier visible; consumer/advisor audience.
- **Bizportal** [V fetch]: news portal with calculators, bond search, insider trades, analyst recs, a "Terminal" trial link; no gemel/insurer fundamentals tooling.
- **TASE/Maya** [V]: company page with interested parties, institutional share, fund holders, index memberships, financial summary tab; the only free ownership source.
- **Globes/TheMarker** [T]: TheMarker "Supermarker" gemel comparison on Gemel-Net data; Globes tools not verified.
- **EY InsurTool** [V-prior]: 62 pages, 19 entities, Q2'26 single quarter vs prior year, Adjusted-profit normalisation, comparability footnotes; no series, no provenance.
