# Ask fox over MCP

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server over the published fox data (`web/public/data`). Connect it
to Claude Desktop or Claude Code and ask in Hebrew; the assistant calls the tools, and every number in the answer comes from a tool
result with its filing page. No model runs inside the server and nothing is written anywhere: zero API cost.

- Code: `mcp/` (TypeScript, Node 20, `@modelcontextprotocol/sdk` 1.32.1 pinned, stdio transport). Own `package.json`; nothing added to `web/`.
- The numbers are computed by the site's own code: the server imports `web/src/lib/*.ts` (kpi, csm, csmResolve, csmData, registry,
  seriesCols, market, lens, search, searchOmni, company, format…) and `pages/ReportDay.tsx`, bundled with esbuild (`mcp/build.mjs`).
  Components, charts and styles are stubbed out. A figure from the server equals the figure on the page that its `view` link opens.
- Data source: the local `web/public/data` by default; `FOX_DATA_URL=https://fox-research-il.web.app/data/` reads the live site
  instead; `FOX_DATA_DIR=/path/to/data` any other copy. The server makes no other outside request (its fetch refuses anything else).

## Build

```sh
cd insurance-dashboard/mcp
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
npm ci            # pinned: @modelcontextprotocol/sdk, zod, esbuild, typescript, @types/node
npm run build     # → dist/server.mjs (self-contained bundle), dist/eval.mjs, dist/smoke.mjs
npm test          # golden set (20 questions) + a stdio smoke test
```

## Connect

The paths below assume the repo at `~/code/ohad`. Use the absolute path of `node` (Claude Desktop does not read your shell's nvm
setup) and of the bundle. Nothing here is applied automatically: you paste it.

**Claude Desktop** · Settings → Developer → Edit Config (`~/Library/Application Support/Claude/claude_desktop_config.json`), add under `mcpServers`:

```json
{
  "mcpServers": {
    "fox": {
      "command": "/Users/ohadbar/.nvm/versions/node/v20.20.0/bin/node",
      "args": ["/Users/ohadbar/code/ohad/insurance-dashboard/mcp/dist/server.mjs"]
    }
  }
}
```

To read the live site instead of the local copy, add `"env": { "FOX_DATA_URL": "https://fox-research-il.web.app/data/" }`.
Restart Claude Desktop; the tools appear under the plug icon as "fox".

**Claude Code** · from any directory:

```sh
claude mcp add fox --scope user -- /Users/ohadbar/.nvm/versions/node/v20.20.0/bin/node /Users/ohadbar/code/ohad/insurance-dashboard/mcp/dist/server.mjs
claude mcp list   # fox: ✓ connected
```

## The contract: numbers come only from tools

The server sends these rules to the client as its `instructions`, and every tool result follows them:

1. Every numeric result is a **fact**: `value` (number, in `unit`), `display` (the site's own formatting), `unit`, `period`
   (`Q2'26`, `FY'25`, `H1'26`, `LTM Q2'26`, regulator months `08/26`), `entity`, and either
   - `source`: `doc_id` (MAYA report id), `page`, `url` = the page in the fox reader (`https://fox-research-il.web.app/doc/<id>?page=N`),
     `pdf` (the filed PDF); or for regulator figures `dataset`, `months`, `group` and the data.gov.il resource; or
   - `calc`: `formula` and `inputs`, each with its own `source` or `calc` (`detail: "full"` opens every input down to its page).
   - and `view`: the page of the site that shows the figure.
2. The assistant quotes `display` and links `url` or `view`; it never writes a figure that no tool returned. A missing figure comes back
   with `value: null` and `missing` (why), never a guess.
3. Derived figures say so (`flags`: נגזר, IFRS 4, מעמודת ההשוואה…; Q4 = FY − 9M, LTM = four quarters); estimates carry `estimate: true` /
   the flag אומדן (Savings Lens nowcast, the reporting calendar).
4. Fundamentals only: no prices, market caps or multiples on price. "פוליסות חיסכון" (IFRS 9) are not "ביטוחי מנהלים" (IFRS 17).

A later grounded chat on the site (W7-R6) adds the server-side digit checker; over MCP the contract is enforced by the tool design and
the golden set.

## Tools

| Tool | What it answers | Engine (site code) |
|---|---|---|
| `search` | entities, statement lines, documents, metric ids (`kinds:["metric"]`), full text of every filed page with a snippet and reader link | `searchOmni.rank`, `search.searchText`, `snippet` |
| `company_overview` | Report Day of one company: net, comprehensive, insurance service result, investments, pre-tax, equity, assets, each with YoY; ROE LTM, EPS, leverage; CSM; regulator assets, share, net flows; latest filings; next report | `ReportDay` roles, `CompanyKpi`, `resolveCsm`, `Market` |
| `figure` | one figure or a series (`n`) for an entity × metric × period × window, `compare: yoy/qoq` by the rule of the page that shows it | see metric families below |
| `peer_table` | one metric across a peer set (`ins`, `big5`, `lts`, `fund`, `all`, `market`, or a list), ranked, with median (≥ 3) and mean (≥ 2) | as `figure`; `seriesCols.cellVal` for registry metrics |
| `csm_ledger` | CSM roll-forward: opening, new business, interest, estimates, release, closing, unexplained gap, ratios | `csmData.atQ`, `csm.lineProv / ratioProv / gapProv` |
| `savings_lens` | regulator flows × managers' P&L: AUM share, flow share, fee yield (regulator and reported assets), cost/income, profit per ₪bn, growth; nowcast (אומדן) | `lens.LensSrc` over `lens.json` |
| `document_page` | the text of a filed page and its reader link; `find` checks that a figure is printed on it | `search.pageText` |
| `restatements` | figures a later filing reprinted with another value, both pages | `restatements.json` (as `/restatements`) |
| `calendar` | next expected report per company (estimate from its own record) and the last one | `calendar.json` (as `/calendar`) |

Metric families of `figure` / `peer_table`:

| Id | Meaning | Site page |
|---|---|---|
| `st:net` `st:comp` `st:isr` `st:inv` `st:pbt` `st:rev` `st:eq` `st:assets` | statement headline lines, windows `q` / `ytd` (H1, 9M, FY column) / `ltm` | company home (Report Day) |
| `kpi:profit` `kpi:oci` `kpi:pretax` `kpi:equity` `kpi:assets` `kpi:eps` `kpi:roe` `kpi:leverage` | XBRL headline figures with the printed canon; `roe` = LTM profit ÷ average equity | KPI ledger |
| `csm` | CSM closing balance by the one CSM rule (net, group; fallbacks labelled) | company IFRS 17 tab, CSM ledger |
| `cap:sr_w` `cap:sr_wo` `cap:dividend_paid` `cap:dividend_declared` `cap:payout` | solvency (main insurer, as printed in the financial report), dividends, payout | `/industry/csm?view=capital` |
| any registry id (`ifrs:…`, `fs:…`, `sop:…`, `lts:…`, `econ:…`, `reg:…@…`) or alias (`np`, `eq`, `csm0`, `nb`, `rel`, `sr`, `div`…) or a formula (`=np / eq * 100`) | `Q` / `H` / `FY` / `LTM` by the registry's rules (flows add, balances are read, ratios never summed) | `/industry/peers` |
| `mkt:<metric>@<set>`: metric = assets, share, organic, transfers, netflow, fee, ret, growth, rate; set = all, pension, gemel, insurance, hishtalmut | regulator monthly aggregates of a market group, windows `m` / `q` / `ytd` / `ltm` | Savings Lens · market view |

## Quality

- `npm run eval` — 20 golden analyst questions (`mcp/eval/golden.json`, Hebrew) run through the MCP protocol (in-process transport) with
  139 checks on values, units, periods and pages. Expected values were read from the data independently of the server (pipeline outputs:
  `csm/summary.json`, `kpi.json`, `market.json`, `csm/capital.json`, `lens.json`, `peers/m/*.json`, `companies/*.json`), and printed
  figures are confirmed on the cited page with `document_page(find)`. Result on 23.10.26: **20/20**.
- `node --experimental-websocket scripts/parity.mjs http://127.0.0.1:<port>` — opens the page each answer links to on a local build or dev
  server of the site (headless Chrome) and checks that the page shows every figure the tools returned (Report Day, KPI ledger, peer
  table with median, Savings Lens, market view, calendar, restatements). Result on 23.10.26: **11/11 pages**.
- `npm run typecheck` — the server and the site modules it imports; a change in `web/src/lib` that breaks the server fails here.

## Later: a hosted endpoint (not implemented)

The same `buildServer()` (`mcp/src/registry.ts`) can be served over the SDK's Streamable HTTP transport, so a phone or claude.ai can use
fox as a remote MCP connector:

1. **Runtime.** Cloud Run (container: `node dist/server-http.mjs`) or Firebase Functions gen 2 (`onRequest`, which runs on Cloud Run) in
   project `fox-research-il`, region `me-west1` or `europe-west1`; `FOX_DATA_URL` pointing at Hosting, so a data deploy needs no
   server deploy. `maxInstances: 2`, `minInstances: 0`, 512 MiB, concurrency 20; responses cached in memory per data `built` stamp.
2. **Access.** A remote connector needs authentication: OAuth 2.1 per the MCP authorization spec (Firebase Auth / Google as the identity
   provider, allowlist of e-mails), or a bearer token for personal use. CORS limited to the client origins; rate limit per user.
3. **Cost (אומדן, check the current price pages before enabling).** No model cost: the model runs on the user's Claude plan. Compute: a
   tool call is ~50–300 ms of one vCPU over cached JSON; at personal use (hundreds of calls a day) it stays inside Cloud Run's monthly
   free tier (on the order of 2M requests and 180k vCPU-seconds). Functions gen 2 requires the Blaze plan; set a budget alert of a few
   dollars. Cold start ~1–2 s (data loads lazily per file). Egress is small (answers are a few KB to tens of KB).
4. **Owner steps.** Blaze plan + budget alert; enable the chosen auth provider; deploy; add the URL in Claude → Settings → Connectors.
