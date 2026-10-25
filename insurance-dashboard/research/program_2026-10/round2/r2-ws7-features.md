# r2 · ws7 · Workflows & features: from "instrument you open" to "instrument that calls you"

Tested live 25 Oct 2026 with a headless CDP driver (clicks, downloads, DOM). Shots: `round2/shots/ws7/`; exported files: `scratchpad/ws7r2/`. [V] verified today · [T] inferred/second-hand.

## 1. Grade today: **7.4 / 10** (round 1: 5.5)

The **build** layer (table, chart, deck, workbook) went from thin to best in niche. The **return** layer did not move: nothing tells the analyst something happened, nothing follows them between devices, nothing new appears between seasons. Koyfin stays the general-workflow benchmark at **8.5 [V koyfin.com/features]**: alerts by desktop, email or mobile, shared watchlists and graph templates, a screener with 5,900 filters. Quartr Pro **[V quartr.com/products/quartr-pro]** adds keyword-mention alerts, AI-estimated report dates and a slide-history comparison.

Evidence that sets the grade:

1. **Peer Table Builder works end to end [V].** 285 registry metrics (ifrs 69, lts 51, sop 47, econ 30, fs 29, reg 21, solv 15, adj 15, xbrl 8), 7 templates on keys 1–7, saved views, own peer sets, full state in the URL. A custom formula typed into the URL (`ann(rel)/csm0*100`) rendered with a coverage chip "1/7", footnote markers and a like-for-like median (`w7_peers_formula_1440.png`). The flaw is that formulas are only as wide as the data: `csm0` resolves for 1 of 7 insurers and group `nb` for 3 of 7.
2. **Chart book → native PPTX with sources [V].** 6 charts from 7 routes → 11 slides: 6 editable native charts with data tables + 4 hyperlinked source slides; book xlsx carries 43 page links. Two routes offer no "+ לספר" button: the `/industry/peers` table view (only the series view has it) and `/funds/makers`.
3. **The company workbook meets the owner's own Excel standard [V].** `company_fox-phoenix.xlsx`: 20 RTL sheets, frozen panes, 59,482 numbers each hyperlinked to its PDF page (P&L 2,370/2,370), 1,881 derived cells as live formulas, 30,843-row `מקורות` sheet.
4. **Search and reader [V].** "רכיב הפסד" returns 3,013 pages in 342 documents, faceted by company, document type (including presentations and solvency) and year. The in-app reader opens the page with a side panel, "מה חולץ מעמוד זה · 38 נתונים" (`w7_reader_1440.png`). No competitor links a filing page back to its extracted facts.
5. **Breadth shipped [V].** Calendar + ICS (14 events), restatement log (1,272 values by season), 369 presentations + targets tracker, debt, holdings (5 managers), valuation (P/B·RI·P/(E+CSM)·SOTP·DCF), `?` shortcuts, print CSS, fact notes on 5 surfaces.
6. **The return layer is still off [V].**
   - Autopilot: `status.json` = `mode: dry-run`, last poll 23.10.26, `llm.enabled: false`, `push.enabled: false`, `deploy.auto: false`. No scheduler exists in the repo.
   - Push: the push design in `pipeline/autopilot/README.md` is marked "not implemented".
   - Sync: `SYNC_ENABLED = false` (`lib/syncConfig.ts`). `/mine` reads "סנכרון בין מכשירים: יופעל בקרוב" and offers file backup and restore instead.
   - "New since" is still one global `seen` date that only the home page moves (`components/home/SeasonStrip.tsx:29`). A3/W7-6 remain open.
7. **Ask-fox MCP: correct, but only reachable from one laptop [V].** `20/20 golden · 139 checks · 4.3 s` on live data, but 9 tools over stdio only (no debt, holdings, ownership, targets, valuation, vintages); unusable from a phone or claude.ai.
8. **Clock [V].** The Q3'26 season opens **20.11.26** (More Gemel), and insurers are expected 23–30.11 (`calendar.ics`). That is 26 days to make report day automatic.

**Feature-by-feature** (● has · ◐ partial · ○ none):

| | fox | Koyfin | Fiscal.ai | Quartr Pro | prodata |
|---|---|---|---|---|---|
| Peer table + custom formulas | ● 285 metrics, free | ● $79 tier [V r1] | ● paid [T] | ○ | ○ |
| Deck/xlsx export with page links | ● | ◐ no source trail [T] | ◐ Max tier [T] | ◐ "Extract data to Excel" [V] | ● branded PDF/Excel [V] |
| Filing full-text + page → facts | ● | ◐ [T] | ● Query [T] | ● AI chat with sources [V] | ○ |
| Alerts / push | ○ | ● desktop, email, mobile [V] | ◐ [T] | ● keyword mentions [V] | ○ [V] |
| Watchlist with deltas | ◐ star sorts first, no deltas | ● [V] | ● [T] | ◐ [T] | ◐ "המועדפים שלי" [V] |
| Cross-device sync | ○ (built, off) | ● | ● | ● | ● "מכל מחשב" [V] |
| Sharing / collaboration | ◐ URL only; book not shareable | ● watchlists, templates [V] | ◐ links [T] | ○ | ◐ client PDFs [V] |
| Calendar | ● estimate + ICS download | ◐ [T] | ● [T] | ● AI-estimated dates [V] | ○ |
| Grounded AI | ◐ MCP, local only | ○ | ● copilot [T] | ● [V] | ◐ drafting [V] |
| Scenario / thesis tools | ○ (one input set per company) | ○ | ◐ reverse DCF [T] | ○ | ○ |
| Between-season content (immediate reports, monthly flows) | ◐ monthly regulator data, no feed | ● news [V] | ◐ | ● events [V] | ◐ monthly funds [V] |

## 2. Gap to 9.0+ (ranked by daily-use value)

1. **Report day on a schedule (M; L with day-0 extraction).** `pipeline/autopilot/run.py --apply` every 15 min in season windows (`launchd` on the owner's Mac now, GitHub Actions after the repo move); auto-deploy the XBRL skeleton behind the existing "לא מאומת" state; printed-report extraction stays budget-gated. *Dep:* owner OK on auto-deploy; ws6 repo move. *Test:* XBRL headline live **≤ 30 min after the MAYA timestamp** for ≥ 12/14 Q3'26 filers, logged filed_at → live_at in `status.json`.
2. **Push (M).** FCM Web Push sent from the deploy step (no Function, no Blaze, per the README design): one per filing, body = `deltas.push`; bell with per-company toggles. *Dep:* VAPID key in console. *Test:* push on an installed iPhone PWA ≤ 5 min after deploy.
3. **Sync on (S + owner console).** Flip `SYNC_ENABLED` after `docs/ENABLE_SYNC.md`. *Test:* phone note visible on desktop ≤ 10 s; offline watchlist edits merge without loss (live smoke beside `tests/sync.test.ts`).
4. **"Since you last looked" (S–M).** Per-company `lastOpen` dot on star, side-nav count, header; home block for watched companies: new filings, restatements touching a noted figure, peer-rank moves, regulator month. *Test:* a filing lights the dot on 3 surfaces; opening the company clears it.
5. **Living book + valuation scenarios (M).** "Roll all to latest period" (today one "יש נתונים חדשים" visit per chart); book as share URL/JSON import; named bear/base/bull scenarios instead of one `val.ri.<id>` input set. *Test:* day after Q3, one click rolls a 6-chart book and re-exports the PPTX; 3 scenarios side by side on `/valuation/harel`.
6. **Formula coverage (M, ws5).** Backfill/derive `csm_opening` and group `csm_new_business` for 7/7 insurers. *Test:* CSM template formula columns show 7/7 for Q2'26.
7. **Remote MCP + tool parity (M).** Streamable-HTTP endpoint (Cloud Run/Functions, read-only); add debt, holdings, ownership, targets, valuation, vintage tools. *Test:* claude.ai mobile answers G1–G20 via connector; 6 new golden pass.
8. **Fixes (S) [V].** "+ לספר" on the peer table view and `/funds/makers`; PPTX titles "כלכלת CSM phoenix" (English id leak) and "יתרת CSM · CSM" (duplicate); ICS as subscribable `webcal://`, not only `download`; fact notes → xlsx cell comments; reader text-view bidi glitches ("( )CSM", "כ 17.7-מיליארדי").

Items 1–4 ≈ 8.6 [T]; 5–7 carry it past 9.

## 3. Bold options

**B1. The Wire: fundamentals between seasons (the cadence fix).** Filings come 4×/year; analysts work daily. Ingest MAYA immediate reports (דיווחים מיידיים) for the 17 issuers (ratings, bond issues/redemptions, dividend decisions, officers, M&A, sanctions), plus CMA circulars/drafts (gov.il) and BoI decisions; classify, link to the fact base (a bond issue updates `/debt`, a dividend updates dividend capacity), push. *For:* every daily user. *Why no one free:* Bizportal/Globes show headlines untied to numbers. *Data:* MAYA (the autopilot's existing headless poll), gov.il, boi.org.il. *Cost:* M–L. *Risks:* MAYA limits (poll politely, never evade); misclassification (source PDF + "סווג אוטומטית" tag).

**B2. Mention alerts over filings (Quartr's paid feature, free).** Saved searches ("רכיב הפסד", "סיעוד", "הסדר", "מס יסף") run on each new filing/immediate report; hits push with the page open in the reader. *Why cheap:* the ~108k-page index and reader exist. *Cost:* S–M after B1 + push. *Risk:* noise → per-term threshold, daily digest.

**B3. Thesis tracker: notes that check themselves.** A note becomes a claim ("Harel NB/release ≥ 100% through FY'26", "Menora solvency ex-transitional ≥ 150%"); each autopilot run evaluates claims with the registry formula engine and flags "הופר ב-Q3'26" in the inbox and on the figure; deck targets arrive as pre-built claims. *For:* holders of positions. *Why no one free:* Koyfin notes are static, its alerts price/valuation-based [V]. *Cost:* M, needs sync. *Risk:* restated inputs → store vintage, use first-print/latest switch.

**B4. Season Room.** From 20.11 the home is a live board: 14 rows expected → filed → XBRL live → verified, each with headline deltas vs your claims and vs peers already in ("3/7 in: median ISR margin 17.1%"), plus sector restatement tally; one-tap season pack PPTX; 07:30 digest push in season. *Why no one:* nobody builds sector-relative report day for Israeli insurers (r1 [T]). *Cost:* M on top of gap 1–2.

**B5. Ask fox everywhere.** Remote MCP (gap 7; $0 via the owner's Claude plan) plus an in-site "שאל" box over the same tools, model writes fact ids and the page draws numbers (`spec_ai_chat.md`), capped ≈ $30–50/month, owner-only. *Why:* Fiscal.ai's copilot cannot answer an IFRS 17 question on Harel. *Risk:* hallucinated digits → keep the server-side digit check.

**B6. Shareable research packs.** Book / peer view / scenario as an unlisted read-only snapshot link (Firestore doc or static JSON), live with "as of" stamp, "duplicate to mine"; English chrome for packs only, for foreign LPs. *Cost:* M. *Risk:* notes leak → excluded unless ticked.

**Order:** gap 1–4 before 20.11 (Season Room v1 on top) → B1 + B2 (cadence is the real cap) → B3, B5 → B6/English.
