# r2 · ws1 · Strategy and positioning (25 Oct 2026)

Tags: [V] verified today on the live site, in code, or on a competitor's page · [T] second-hand or inferred · [J] judgment. Shots: `round2/shots/ws1/`.

## 1. Grade today: **7.0** (round 1: 6.0)

The wedge from round 1 now exists in the product; the strategy around it does not. fox is the best Israeli insurance and long-term-savings fact base, and almost nobody outside the owner can find, share, embed or quote it. On this niche no competitor scores above 4. On reach and report-day distribution the benchmark is Quartr at about 8 [J].

1. **Round 1's signature moves have shipped [V]:** Savings Lens, CSM ledger and capital engine, `/holdings` (5 managers, ₪651bn: `phoenix_1440_holdings.png`), `/ownership` (Harel only), full-text search, Report Day as company home (`phoenix_1440_company_harel.png`), MCP 20/20. `/data` shows 95% coverage (115/121), 1,708 open files and a citation generator (`web/src/lib/cite.ts`). This is the full point gained.
2. **Hidden from search by its own config [V].** `web/firebase.json` sends `X-Robots-Tag: noindex, nofollow` on `**` (live `curl -I` confirms); `/robots.txt` serves the SPA's HTML; every URL is the same 1.8 KB shell titled `fox` with one generic `og:image`, so a shared CSM chart previews as a logo. "Harel financials" on Google returns stockanalysis, Simply Wall St, TipRanks [V]: generic templates, no CSM or regulator data.
3. **Embedding is blocked [V].** The site sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` on every path. No journalist can put a fox chart in an article.
4. **"First" is not yet true [V].** data.gov.il gemel-net holds `REPORT_PERIOD` 202609 (API `MAX`); TheMarker's free Supermarker already shows September 2026; fox shows 08/26 and `coverage.json` calls it "fresh". The autopilot is built but off.
5. **Quartr owns report day in English and in search [V].** Its public Harel page has an AI summary of Q2'26 (CSM ₪17.7bn, comprehensive income ₪1.024bn) dated 26 Aug, the filing date, caveated "AI can get things wrong". fox has the same numbers with pages, but no English and no index.
6. **The strategy doc contradicts the product [V].** `PRODUCT.md`: "Users: One professional investor"; `docs/HOME.md` designs for analysts, CFO offices, journalists. Round-1 decisions #7 (public/private) and #9 (benchmarks) are still open.
7. **No distribution or measurement rails [V].** No analytics anywhere in the source; no RSS, no push in `sw.js`, no newsletter; the MCP is stdio-only and private. The only outbound feed is `calendar.ics`.
8. **Competitor depth is unchanged.** prodata is still a login-only agent tool with no financials [V]; Koyfin Free has 2Y of financials [V]; Fiscal Free has 6 quarters and no exports [T]. The data moat holds. The gap is reach.

## 2. Gap to 9.0+

**Wedge (rewritten):** *The reference of record for Israeli insurance and long-term savings. Every number has its page. Free, first, and quotable.* The data itself is public, so the defensible parts are elsewhere:
- the per-cell provenance across about 100k facts (99.8% found on the cited page, round-1 sample);
- the Hebrew taxonomy across 17 filers;
- a vintage history that compounds every quarter;
- speed, once the autopilot runs;
- authority, which compounds through citations.

A funded entrant (Quartr, a Big-4 firm, TMX/prodata) could copy the data in a year, but not the authority and speed [J].

**Segments and the job each brings:**
1. **Insurer and LTS equity analysts** (sell-side, buy-side, foreign holders). Job: what changed, versus whom, and what it is worth, within hours of a filing.
2. **Industry insiders** (strategy, FP&A, IR, actuarial at the 17 groups; Big-4, InsurTool's audience). Job: the quarterly "us versus the market" board pack.
3. **Journalists and commentators.** Job: one sourced chart tonight, including the monthly "who gained flows" story.
4. **LTS allocators and advisors** (pension committees, employer consultants, family offices). Job: manager due diligence on fees, flows, profitability and holdings.

**What fox should become:** a **data utility** at the core (FRED / Our World in Data for Israeli long-term savings), with a **media layer** for distribution and the **tool** for retention. Not a UGC platform: the network is too small. With no paywall, value capture is citations and authority, so every page must be a citable, shareable, embeddable object. fox has about 50 routes and almost no outside readers; another module will not make it special. Freeze new modules for one season and make it reachable [J].

| # | Change | Effort | Depends on | Test that proves it |
|---|---|---|---|---|
| G1 | Go public: drop `noindex`, add a real `robots.txt` and `sitemap.xml` (companies × metrics × funds) | S | owner decision #7 | Google Search Console shows ≥ 1,000 indexed URLs within 60 days; fox is in the top 10 for 15 of 20 tracked Hebrew queries ("CSM הראל", "דמי ניהול מיטב") |
| G2 | Prerender HTML per route at build: title, description, h1, a key-figures table, schema.org `Dataset` JSON-LD | M | G1, pipeline DAG | `curl /company/harel` returns ≥ 5 KB with the company name and latest net profit in the body; Lighthouse SEO ≥ 95 |
| G3 | One OG card per URL, rendered at build (satori/resvg: figure, sparkline, period, source) | M | G2 | 50 sampled URLs all preview with their own title and figure on WhatsApp, LinkedIn and X |
| G4 | T+0 freshness: autopilot ON with a "לא מאומת" badge; regulator ingest triggered by data.gov.il `last_modified`; the freshness rule compares against the source's latest period, not SLA days | M | autopilot gates | Q3'26 season (Nov 2026): headline deltas live ≤ 6 h after MAYA for ≥ 12/14 filings; regulator month live ≤ 24 h after data.gov.il |
| G5 | Distribution rails: RSS/Atom per company and sector; Web Push via FCM; Telegram/WhatsApp channel; email digest on a free tier (Gmail SMTP / Buttondown free) | S–M | G4 | ≥ 300 subscribers across channels by the end of the Q3'26 season [target J] |
| G6 | `/embed/*` routes with `frame-ancestors *` scoped to them, carrying an attribution and a link back | M | CSP split | ≥ 3 external articles embed or cite fox during the Q3'26 season |
| G7 | Rewrite `PRODUCT.md`: wedge, four segments, one front door per segment, benchmark set (InsurTool, prodata funds layer, Quartr, Koyfin/Fiscal) | S | — | Playwright: each segment's first job is ≤ 2 taps from home at 390 px and 1440 px |
| G8 | Cookieless analytics (Cloudflare Web Analytics or GoatCounter, free) plus Search Console and a referrer log; north star = sourced citations per month | S | G1 | A weekly report of visits, referrers and citations exists and is trended |
| G9 | Coverage the promise implies: ownership 1 → 14 listed entities, holdings 5 → 17 managers, IDI statements, Infinity/Globalnet marked "רשות בלבד" | L | MAYA access, extraction budget | Coverage matrix ≥ 98%; ownership tab on 14/14 |

G1–G8 lift the grade to about 8.5. G9 plus Options A and B below take it past 9.0 [J].

## 3. Bold options

**A. "FRED for Israeli long-term savings": a public series page for every number.** Each company × metric gets one static, prerendered URL (`/s/harel/csm-net`). The page carries a chart, a table, the source page, a citation, CSV/xlsx downloads, embed code and an OG card. About 5k metric pages plus 1,251 fund pages, regenerated each quarter.
- **For:** everyone who arrives from search; journalists; students.
- **Why no free venue has it:** the sites that rank use generic templates with no IFRS 17, CSM, solvency or regulator flows [V search]; Quartr has summaries, not series [V].
- **Data:** already built (`web/public/data`, `prov/`).
- **Cost:** M.
- **Risks:** needs the public decision; vendors may scrape, but their buyers are not fox's users [J].

**B. The report-day wire, a media layer with deterministic numbers.** With the autopilot on, each filing produces within hours a numbers-only report card: 8 headline deltas, CSM movement, restated cells, rank against peers, and the page link for every number. It is pushed to RSS, Web Push, a Telegram/WhatsApp channel and email. A season league table follows once all 14 have reported, and a monthly flows pack goes out the day data.gov.il updates (the story Funder and Calcalist write by hand [T]).
- **For:** analysts, IR, journalists.
- **Why nobody free has it:** Quartr's version is AI-written, English and caveated [V]. Funder publishes articles, not sourced series [V].
- **Data:** MAYA PDFs and XBRL; data.gov.il gemelnet/pensyanet/bituachnet.
- **Cost:** M (the autopilot exists).
- **Risks:** a T+0 error is very visible; keep the "לא מאומת" badge and never overwrite a verified figure.

**C. Charts in every article: embeds plus a citation network.** Live `/embed` charts with an attribution line, the existing citation generator, and a "fox chart pack" per story (flows, fees, CSM, solvency).
- **For:** the 10–20 journalists on the insurance/pension beat [T].
- **Why nobody has it:** Supermarker has share links, no embeds, no sources [V].
- **Data:** existing.
- **Cost:** S–M.
- **Risks:** a misquoted chart carries fox's name; each embed shows its period and source page.

**D. Ask fox everywhere: a public remote MCP, `llms.txt` and a documented JSON API.** Host the existing MCP over streamable HTTP on Cloud Run's free tier, rate-limited, listed in the MCP registries, plus `llms.txt` and a documented `/data` API, so assistants answering "what is Harel's CSM" cite fox with a page link.
- **For:** analysts working in Claude/ChatGPT; AI search.
- **Why nobody has it:** Quartr sells "AI-ready IR data" through a paid, contact-sales API [V]. No Israeli insurance source has an MCP [J].
- **Data:** existing.
- **Cost:** S–M; likely $0 at this volume [T].
- **Risk:** abuse, handled with rate limits and read-only access.

**E. The English mirror for foreign holders.** The company page, report card, tear sheet and series pages in English. Labels come from the taxonomy; IFRS 17 terms are English at source.
- **For:** foreign holders of the TA-Insurance names (Harel at the Jefferies Israel Financials Summit, London, 21 Oct [T]); English-speaking analysts.
- **Why nobody has it:** today's English venues are Quartr summaries and generic templates [V].
- **Cost:** M–L.
- **Risk:** label quality across about 5k lines; ship the 400 with roles first.

**F. The quarterly peer pack for insiders.** One click produces "ערכת עמיתים Q3'26" for any of the 17 groups: native PPTX plus xlsx, house style, a source footer with the URL on every chart. Every team rebuilds this deck by hand each season; every board deck it enters is a backlink.
- **For:** segment 2 and the Big-4 firms.
- **Why nobody free has it:** EY InsurTool is a single-quarter Power BI with no series and no export [V-prior `insurtool_summary.md`].
- **Data:** existing; the chart book → PPTX already ships.
- **Cost:** S–M.
- **Risk:** peer-set disputes; fixed default, saved custom set.

**Loops that fit a no-paywall product:**
- citation (cite → click → cite);
- programmatic SEO that compounds each quarter (A);
- embeds (C);
- forwards of the wire in WhatsApp-heavy Israeli finance circles (B) [J];
- deck footers (F);
- LLM citations (D).

**Loops that do not fit:** sign-up walls on exports, referral schemes, and accounts-for-access. Each one taxes the citation loop, which is the only revenue fox has.
