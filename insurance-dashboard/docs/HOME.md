# Home (`/`) · spec

**Purpose.** The home is the season desk: open it and know which report season you are in, how every company did in it, and where the sector's two outside levers (long-term-savings money, rates) moved, each one tap from its depth page. It is not a news feed: a filing is an event *inside* a company or the calendar; the home shows its *result*.

**Readers and their first question.** Insurer/LTS analyst (sell- and buy-side): "who reported, and how did they do vs last year?". CFO office / strategy: "where do we rank this quarter, and who is gaining assets?". Journalist: "one sourced number for tonight: profit, share, rate".

**The five questions the first screen answers** (phone 390 × 844 after the top bar; desktop 1440 × 900):
1. Which season is current, how many companies have reported it, when is the next report due? → season strip.
2. How did each company do in its latest quarter (net profit QTD, YoY, ROE LTM, equity)? → the scoreboard.
3. Who leads in long-term-savings assets and who is gaining share? → the scoreboard's market view (AUM, share, YoY, organic, fees).
4. How big is the LTS market and how fast is it growing? → four sector figures (regulator, monthly).
5. What are the rates and inflation the books are discounted with? → compact macro tiles.

**Section order and why.**
1. *Season strip* (one line): `Q2'26 · 14/14 דיווחו · אחרון 27.08.26 · הבא Q3'26 צפוי 20.11.26 (אומדן)`; when filings arrived since the last visit, a chip opens just those filings in place. Source: `calendar.json` (estimate formula in the source sheet), `filings_latest.json`. Links: `/calendar`.
2. *Scoreboard* (leads the page). Phone: a ranked list, one row per company (identity dot, name, period, the key figure large, YoY and ROE small), no sideways table; the name is the drill-down to Report Day (`/company/:id`), each figure opens its source. View switch דוחות / שוק, filter הכול / ביטוח / בתי השקעות. Desktop: the full sortable table (both column sets from 1600 px), export xlsx. Source: `kpi.json` (XBRL, Report Day engine), `market_home.json` (regulator).
3. *Sector figures*: total LTS assets, pension, gemel+hishtalmut, managers' insurance + savings policies; ₪bn, YoY, `08/26`. Links: `/industry/savings`.
4. *Macro* (compact tiles, no curve chart; the curve stays on the macro/valuation pages): BoI rate, CPI, 10Y nominal/real, breakeven. Source: `macro/macro.json` (BoI, CBS).
5. *Jump row*: peers `/industry/peers`, IFRS 17 · CSM `/industry/csm`, savings lens `/industry/savings`, valuation `/valuation`, restatements `/restatements`, calendar `/calendar`.

On ≥ 1600 px the scoreboard takes the main column and sections 3–4 sit in a sticky side column.

**What moves elsewhere.** The ten-row "דיווחים אחרונים" feed leaves the home. Its full form (`components/home/RecentFilings.tsx`) belongs on `/calendar` above "הדוח הבא" (request to the orchestrator) and stays reachable from the omnibox and each company's `מסמכים` tab. The home keeps only the "new since your last visit" chip, which lists nothing when nothing is new.

**Rules.** No figure without a source sheet; derived figures (`ROE`, YoY, season estimate) carry `calc` provenance and the נגזר/אומדן label. Period grammar `Q2'26 · 08/26 · 27.08.26`. No stock prices. 390 and 1440, both themes.
