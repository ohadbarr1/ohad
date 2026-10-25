# r2-ws3 · Mobile UX (round 2, 25 Oct 2026)

Method: live build `13045ba3`; Playwright 1.64, WebKit 26.0 (the owner's Safari engine) and Chrome; 38 routes × 5 setups (WebKit 390 light/dark, WebKit 360, Chrome 390, Chrome 360 dark), phone emulation. Measured: page height, scrollWidth, first-figure position, controls before it, hit-tested tap size; slow-4G + 4× CPU cold/warm/offline timings (Chrome); sheets, back, search and the analyst jobs tapped through. Evidence: `round2/shots/r2-ws3/` (`w390_*` = WebKit 390; `*_metrics.json`, `perf*.json`, `harness/`). [V] verified live, [T] inferred.

## 1. Grade today: **6.8 / 10** (round 1: 5.0)

Six of round 1's biggest defects are gone; one new defect hits the owner's own engine. The grade would be **7.4 if the WebKit crash below turns out not to reproduce on a real iPhone**, or once it is fixed.

1. **Sideways scroll: 0 of 38 routes, in all 5 setups** (round 1: 24 of 35). scrollWidth equals the viewport width everywhere, including 360 px [V `*_metrics.json`].
2. **First figure, cold, slow 4G: 1.4–2.4 s; warm: 0.19–0.54 s** (round 1: 2.5–3.0 s cold). Real cold transfer: home 320 KB, statements 418 KB, IFRS 17 621 KB, company overview **796 KB in 57 requests** (charts chunk 154 KB + `market_home.json` 91 KB + `phoenix.json` 143 KB) [V `perf*.json`, `bytes.mjs`].
3. **PWA works.** Valid manifest with 192/512/maskable PNGs and a 180-px apple-touch icon. The service worker controls the page on the first visit. **All 19 visited routes reload offline.** theme-color follows the theme (`#111C3F` / `rgb(11,7,6)`). System dark is the default. Safe-area insets are on the header, the bottom bar and the search [V].
4. **WebKit crash on company routes (new, P0).** The error boundary shows "העמוד לא נטען · undefined is not a function (near '…[s,n,r,l,i,o]…')". It comes from the `CompanyStore` constructor, `for (const [mi,pi,v,page,u,flag] of d.facts)` (`lib/company.ts:13`).
   - Rates in WebKit: reload of `/company/phoenix` **6/9**; tab taps after it 8/12; financials, savings, review, profit **50–100%** once `companies/phoenix.json` comes from cache.
   - Controls: Chrome **0/27**; WebKit, cache bypassed, **0/12**. The payload is clean (26,336 arrays of length 4–6), so a JSC optimisation/timing bug is likely [V in Playwright WebKit; T on iPhone].
   - Screenshot: `w390_company_phoenix_profit.jpg`.
5. **Phone primitives landed.**
   - ContextBar + Sheet: 29 pickers in one 726-px sheet; Back closes it and keeps the URL.
   - Source sheet: Back closes it.
   - Report Day is the company home: six KPI tiles from 351 px.
   - Two-line change cells ("−5.5% / מול 957").
   - Search ranks lines by company and segment ("רכיב הפסד" → 12 hits).
   - [V `i_ctxsheet.jpg`, `i_srcsheet.jpg`, `w390_company_phoenix.jpg`, `w390_company_phoenix_review.jpg`, `i_search_רכיב.jpg`]
6. **Still heavy above the fold.** First statement figure is at **536 px** (round 1: 743; RESUME claims 421). Review 490, IFRS 17 527, savings 753, `/funds/makers` 501 (31 controls before it), `/holdings` 1,690 (47 controls). The company header (name, three chips, four places, sub-tabs) costs ≈470 px. The sub-tab "דוחות כספיים" is clipped at 390 px [V].
7. **Charts are still desktop charts.** Capital: 8 lines with legend "1/2". Holdings: 11-colour stacked bars with legend "1/6". Peers series: 7-line spaghetti. Savings at 360: legend "1/2" with a cut item. Every chart carries a 5-button export row (לספר · PNG · PPTX · CSV · העתקת קישור) that wraps at 360 [V `w390_industry_csm_view_capital.jpg`, `w390_holdings.jpg`, `j_peers_series.jpg`, `w360_company_phoenix_savings.jpg`].
8. **Page length and tap size.**
   - Length: sectors 22,870 px (with a **205-px sticky filter block**), presentations 21,455, restatements 15,291, company overview 9,994, `/data` 9,133.
   - Tap size: **188 of 1,025 in-view controls hit-test below 40 px; 42 below 24 px**. The small ones are inline list links 22 px tall: calendar, search results, `/book`, `/debt`, `/data` [V].

Best on a phone: StockUnlock 8 and Koyfin mobile 7.5 [V, round 1: native apps, alerts, sync, widgets]; Fiscal.ai shows no app [T]. fox wins on no wall + offline; they win on push, install, share and phone-native charts.

## 2. Gap to 9.0+ (ranked)

| # | Change | Effort | Dependency | Test that proves it |
|---|---|---|---|---|
| 1 | **Kill the WebKit crash.** Indexed loop in `CompanyStore` (and every `for…of` with destructuring over large fact arrays: `exportCompany.ts:40`, `lts.ts:60`). Confirm on the owner's iPhone: reload Phoenix, tap through the tabs. | S | none | 0/50 error-boundary hits in WebKit across 9 company routes, warm cache; owner's iPhone clean |
| 2 | **WebKit in CI.** Add a `webkit` phone project to `playwright.config.ts` (today: Chrome `phone` + `desktop` only). Add a "reload ×5" crash test per signature route. Add a CSS lint: no `position:sticky` inside a horizontal scroller unless the iOS override covers it. Uncovered today: peers `.pin` (2nd column), `.own-corner`, `.ast-corner`, `.pz-co`. | S | #1 | CI fails on any page error in WebKit; lint passes |
| 3 | **Phone chart mode** in `foxchart.ts` at ≤760 px: one lead series + grey peers; legend as tappable chips (peers series already has them); never a paginated legend. Stacked bars become top-5 + "אחר". Bridges as horizontal waterfalls. | M | ws4 tokens | 0 ECharts legend pagers at 390; ≤5 coloured series per chart |
| 4 | **One share button per chart:** `navigator.share` with the link plus a source-stamped PNG file; PPTX/CSV move to an overflow sheet. | S | — | 1 visible export control per chart at ≤760; WhatsApp receives image + link |
| 5 | **Company header on a diet:** one 44-px line (name · Q2'26 · ⋯), four places + sub-tabs as one sticky strip, period seg inside the ContextBar on review/IFRS 17/savings. | S–M | — | first figure ≤ 300 px on financials, review, IFRS 17, savings (now 490–753) |
| 6 | **Data SW stale-while-revalidate with a 2.5 s network timeout**, keyed by build hash. Today it is network-first despite the file comment, so on lie-fi a warm visit waits for the network. Precache visited-company JSON for offline navigation. | S | — | warm first figure ≤ 600 ms at 3,000 ms RTT; offline open of an unvisited-but-followed company works |
| 7 | **Cold weight:** load the charts chunk only when a chart scrolls into view; drop `market_home.json` from the company overview; batch the 57 requests. | M | ws6 | every route ≤ 400 KB cold; first figure ≤ 1.5 s at slow 4G (now 1.4–2.9 s) |
| 8 | **Tap targets:** list rows become the link (calendar, search, book, debt, data, managers); `.thbtn` column headers 18–32 px wide. | S | — | harness probe: 0 in-view controls < 40 px, 0 < 24 px |
| 9 | **Length caps:** collapsed sections with the headline figure in the header. Targets: sectors ≤ 6k px, presentations/restatements as filtered lists (20 + "עוד"), company overview ≤ 5k. The 205-px sticky `.sx-bar` becomes a ContextBar. | M | — | no route > 8,000 px at 390; no sticky block > 60 px besides the header |
| 10 | **Persistence on iOS:** Safari deletes script-written storage after 7 days without a visit for non-installed sites (WebKit ITP) [T]. Watchlist, notes and "שלי" live in `localStorage`, with sync behind an off switch. Turn sync on (Firebase Auth exists) or prompt install. | S–M | owner decision on sync | a note written on the phone survives 8 days idle and opens on desktop |
| 11 | **Install + push:** iOS "Add to Home Screen" hint after the 2nd visit; Android `beforeinstallprompt`; Web Push (iOS 16.4+ installed PWAs) on new filing and on restatement. | M–L | autopilot (built, OFF), FCM | filing → push ≤ 15 min on an installed iPhone PWA |
| 12 | **Small clips at 360:** search placeholder, seg strips without end cue, holdings subtitle; `/holdings`, `/ownership`, `/debt` light no nav section. | S | — | WebKit 360 baseline, both themes |

Analyst jobs on the phone, all ≤ 3 taps now (the README exit criterion is met):

| Job | Taps | Path | Remaining problem |
|---|---|---|---|
| Read a quarter | 1 | home row | — |
| 7 insurers over 5 years | 3 | ענף → סדרה → measure | spaghetti chart (#3) |
| CSM growth | 2 | — | — |
| Solvency and dividend | 3 | — | paginated legend (#3) |
| Judge a fund house | 2 | home → בתי השקעות → company | page is 5.5k px (#9) |
| Find a line | 1 + typing | — | — |
| Share a chart | 1 | — | copy-link only, no share sheet (#4) |
| Come back | 1 | header → שלי | storage not durable on iOS (#10) |

## 3. Bold options (mobile lens)

**A. Report-day push card.** On a filing, a lock-screen notification: "הראל · Q2'26 · רווח נקי 1,068 (+28% YoY) · CSM 17.7bn · 30 הוצגו מחדש". It opens the Report Day tile view.
- Who: anyone following the 17 issuers.
- Why unique: nobody free extracts IFRS 17 on filing day; competitors push prices and dates.
- Data: MAYA filings (`mayafiles.tase.co.il`), the existing extractor and gates; Firebase Cloud Messaging (free tier).
- Risk: an extraction error reaches a lock screen. Mitigation: two pushes — "הוגש" (PDF link) at once, figures only after the gates pass.
- Cost: M once autopilot is switched on.

**B. Calendar as the widget.** Widgets are out of reach for a PWA, but the subscribed ICS already exists (`/data/calendar.ics`).
- What: after a filing, rewrite each event's title and notes with the four headline figures and a deep link. They then appear in the iOS Calendar widget and lock screen, with no app.
- Who: the analyst in reporting season.
- Data: own.
- Risk: iOS refreshes subscribed calendars slowly (hourly at best) [T].
- Cost: S.

**C. Pocket tear sheet → WhatsApp.** A vertical, swipeable 6-card story per company: profit, CSM bridge, solvency + dividend capacity, restatements, savings flows, debt wall.
- Each card shares as a source-stamped 1080×1350 image plus a link (`navigator.share` with files). Israeli buy-side chatter lives in WhatsApp; today a fox chart arrives there as a bare URL.
- Data: existing.
- Cost: M.

**D. Offline briefcase.** "Take Phoenix + Harel offline": the SW prefetches their JSON, provenance and the last report's PDF, and the reader works in a plane or on reserve duty (מילואים).
- Data: own + MAYA PDFs. CSP already allows `mayafiles.tase.co.il`; CORS on MAYA for fetch-to-cache is unverified [T]. Fallback: store the in-app reader's text pages (search corpus).
- Risk: storage quota and ITP. Installing as a home-screen app removes the 7-day wipe, so this doubles as the install hook.
- Cost: S–M.

**E. One-thumb compare.** A "מול עמיתים" tab in the source sheet of any figure: the same metric for all seven as sourced horizontal bars, company highlighted. Answers "is 26.3% ROE good?" without leaving the page; the peer registry exists. Cost M.

Not without owner sign-off: a Capacitor wrapper for real widgets/push needs a paid Apple developer account.
