# Fact table with vintage + line taxonomy

Phase 3, ws5 W5-R1 (and W5-1/18). One table holds every figure of every company workbook with **every report that printed it**:
the first print of a period and each later report that printed it again as a comparative, each with its page. Builders and pages
that today re-derive figures from `companies/<id>.json` move to it one at a time (order below).

```
python3 pipeline/build_facts.py            # build (≈2.5 min: build_workbook.py runs in shadow)
python3 pipeline/build_facts.py --check    # gate check `facts` (pipeline/gate.py), reads only published files, < 1 s
```

## Files

| Path | What |
|---|---|
| `pipeline/build_facts.py` | the builder and the check |
| `pipeline/taxonomy/rules.py` | core lines (curated ids + patterns), blocks, the frozen caption normaliser, IFRS 4↔17 bridge |
| `pipeline/taxonomy/build.py` | line ids for every workbook row, taxonomy entries, coverage |
| `pipeline/taxonomy/shadow.py` | runs `build_workbook.py` with additive hooks that keep every print (see below) |
| `pipeline/taxonomy/registry.json` | normalised caption → line id, **append-only** (what keeps ids stable) |
| `pipeline/taxonomy/lines.json` | the taxonomy: one entry per id (label, statement, block, tier, unit, nature, additive flags, standard, bridge, companies, aliases) |
| `pipeline/taxonomy/coverage.json` | share of workbook rows on a cross-company id, by kind and company, and the unmapped tail |
| `web/public/data/facts/<id>.json` | the fact table of one company (columnar, lazy-loaded) |
| `web/public/data/facts/index.json` | companies, counts, flags, policies, taxonomy summary |
| `web/public/data/facts/taxonomy.json` | the client's copy of the taxonomy (core + shared + statement lines) |
| `web/src/lib/facts.ts` | loader and queries |
| `web/src/components/VintageToggle.tsx` | the toggle, the per-cell mark, `useVintage` |
| `/facts/:id` (`pages/Facts.tsx`) | one statement read from the table, with the toggle (verification route, title "עובדות") |

## The model

A **row** is one figure: `(company, line instance, period, vintage)`.

- **Line instance** = a workbook row (metric): its line id, entity (F parent / I insurer / P pension), sheet, standard block
  (`17` / `4`) and dimension (segment · basis). The same line id can have several instances in one company: the IFRS 17 and IFRS 4
  blocks of a statement, the statement built from the reports and the Phoenix spreadsheet's own statement, segments.
- **Period** = window + period end: `Q`, `H`, `9M`, `FY` (flows) or `I` (a balance date).
- **Vintage** = the report that printed it: MAYA report id, the report's period (`2026Q2`), publication date, URL; the row keeps the
  page (`alt` lists other pages of the same report that print the same figure).

Statement cells (balance sheet, P&L, comprehensive income, cash flows; 2021 onward) carry every print. The series sheets (segments,
capital, savings) and the Phoenix spreadsheet carry the one print they were read from (flag 128 when that print is a comparative).

### Row flags (bitmask)

| bit | meaning |
|---|---|
| 1 | derived: Q4 = FY − 9M, H2 = FY − H1. `der` holds `[row, op, input A, input B]`; an input is a row index, or `[value]` when the workbook took it from outside the line |
| 2 | from the IFRS 4 statement, as originally reported (a line that runs through the change of standard) |
| 4 | sign turned to the latest presentation (the company flipped the line's sign convention) |
| 8 | restated: the current figure differs from the first print beyond rounding (the workbook's flag) |
| 16 | **current**: the figure the site shows today (= `companies/<id>.json`) |
| 32 | **first print** in the table ("as first reported") |
| 64 | not plausibly the same line as the current figure (opposite sign at a different size, or more than ×2 apart): kept for audit, ignored by every policy |
| 128 | printed as a comparative column of a later report, not by the period's own report |

### Vintage policies (`lib/facts.ts`)

| policy | per cell |
|---|---|
| `latest` | the row with flag 16, i.e. exactly what the site shows |
| `original` | the row with flag 32; a derived quarter uses the year and the part **as first printed** (stored as its own derived row) |
| `asof:YYYY-MM-DD` | the latest print published on or before the day (publication date from `search/docs.json`; 1 of 270 reports has none and counts from its period end); a derived quarter is recomputed from the year and the part as known that day |

URL form: `?vin=o` (original), `?vin=2025-08-31` (as of), absent = latest.

### Counts (23.10.26)

13 companies · 6,432 line ids · 190,070 rows · 115,510 cells · 45,957 cells printed by more than one report ·
1,660 restated cells (flag 8) · 270 reports · 5.8 MB = 0.76× `companies/` (budget 1.5×).

## The taxonomy

Every workbook row gets a line id. Three tiers:

| tier | ids | rule |
|---|---|---|
| **core** | 103 | curated in `rules.CORE`: readable id (`pl.pbt`, `bs.total_assets`, `cf.cfo`, `oci.total` …), a pattern over the caption, a nature. The 29 roles of `lines.json` are core ids (`ROLE_ID`), so the peer lines keep their keys. |
| **shared** | 283 | the same normalised caption, in the same statement **block**, printed by two or more companies. Id = `<stmt>.<block>.<6 hex>` of the first caption it was registered under. |
| **own** | 6,046 | a line only one company prints (most are the Phoenix spreadsheet's notes, `px.*`), a caption a company prints twice in one block ("סך הכול", "אחרות"), or a second row of one company that reached an id already taken in that block (suffix `~2`). Stable within the company; no cross-company identity. |

Series rows keep the extractor's metric key: `n.<metric>` (shared when two companies have it), with the segment and basis as the
dimension.

**Blocks** keep apart one caption in two places: balance sheet `a` (assets) / `le` (liabilities and equity); cash flows `op`, `adj`,
`wc`, `inv`, `fin`, `cash`, `app`; P&L `pl` / `eps`. "רכוש קבוע" is `bs.ppe` among assets, a depreciation adjustment in `cf.adj`,
an investment in `cf.inv`.

**Wording changes.** Every caption a row was printed under in any report (and the captions of rows `build_workbook.py` joined into it:
"הכנסות (הוצאות) אחרות" ↔ "הוצאות אחרות", renamed lines) is an alias of that row. All aliases of a row, across companies, meet in one
id (union of captions within a block), and the registry keeps every alias → id forever, so a later rewording joins the old id instead of
minting a new one. The caption normaliser is a frozen copy (v1) of `build_workbook.norm`: tuning the builder never moves an id.

**Attributes** per id: `unit` (k = NIS thousands · nis = per share · shares · pct), `nature` (inc / exp / res / bal / ps / cnt / ratio /
flow), `tadd` (additive across periods: Q1+Q2 = H1, the derivation allow-list), `sadd` (additive across segments: money), `std`
(17 / 4 / both), `bridge`. Sign convention: every figure is in the company's **latest** presentation (flag 4 marks the turned ones); per
company, an `exp`/`inc` line carries `o` = +1 when the company prints it positive, −1 negative, so a consumer can normalise.

**IFRS 4 ↔ 17 bridge.** A line printed under both standards with one caption (profit, taxes, totals) is one id, `bridge.kind = same`
(its IFRS 4 years carry flag 2). A line that IFRS 17 replaced points to its successor, `kind = successor`, with a note (definition
break, BreakChip): `pl.gpe → pl.ins_rev`, `pl.claims_gross → pl.ins_exp`, `pl.reins_premiums → pl.reins_exp`,
`pl.claims_reins → pl.reins_inc`, `pl.inv_gains_ifrs4 → pl.inv_total`, `bs.reins_assets → bs.reins_contract_assets`;
`bs.dac` ended (`kind = ended`).

### Coverage

| kind | rows | core | shared | own | rows on a cross-company id | figures on one |
|---|---|---|---|---|---|---|
| primary statements (from the reports) | 3,762 | 1,178 | 752 | 1,832 | **51.3%** | **61.8%** |
| series sheets (segments, capital, savings) | 2,911 | – | 2,441 | 470 | **83.9%** | **92.8%** |
| Phoenix spreadsheet sheets | 4,625 | 196 | 92 | 4,337 | 6.2% | 9.3% (company-specific notes) |
| all workbook rows | 11,298 | 1,374 | 3,285 | 6,639 | **41.2%** | **60.9%** |

The tail (`coverage.json → tail`): detailed cash-flow lines each company names its own way ("ריבית שנצברה ושערוך התחייבויות לתאגידים
בנקאיים"), generic captions printed twice in a block ("סך הכול"), second prints of a core line in a combined statement, and the Phoenix
spreadsheet's notes. Raising it is curation: add a `CORE` pattern (the row moves to the readable id; the old auto id stays in the registry).
`role_mismatch` lists a workbook role the core pattern rejects (1: Altshuler's `intangibles` role sits on a header-level row).

## How the table is built (and why it can be trusted)

`build_workbook.py` already reads every print of every period and keeps one. `taxonomy/shadow.py` runs **its own code** with additive
hooks spliced into the source text (each anchored on an exact line; a missing anchor stops the build and names it):

- the picked cell keeps the list of prints it was picked from (report, value, page, URL, rounding step, plausible?);
- prints of a line whose sign convention changed are turned like the cell; prints of a row joined into another follow it;
- derived cells keep their two inputs; statement rows keep every caption; the workbooks are captured instead of written.

`build_facts.py` then requires the shadow's workbooks to equal the published `companies/<id>.json` **exactly**, so the fact table can
never drift from what the site shows. The page texts `build_workbook.py` reads for unlabeled rows (Drive) are cached in
`~/.cache/fox/captions.json`; a page that cannot be read in 4 s is replayed from the published workbook (the equality check guards it).

`--check` (gate `facts`): every one of the 115,510 workbook figures has exactly one current row with the same value, page, report and
flags 1/2/4/8; every statement pair of `restatements.json` (1,184) is in the table with both values, report ids and pages; one current and
at most one first-print row per cell; derived rows equal their inputs; every id is in the taxonomy; canonical JSON; size ≤ 1.5×.
Note pairs of `restatements.json` (102, IFRS 17 notes from `ifrs_*.json`) are outside the table until `build_ifrs.py` migrates. A pair the
workbook no longer has is reported as *stale* (3 today: Yelin pairs from Atrao's 2023 filings, which `build_workbook.py` now excludes —
`build_restatements.py --check` fails on the same 3; rerun it).

## Migration: builders that should read facts (do not migrate in this wave)

Order = dependency and payoff. Each step first regenerates today's JSON from the table (zero UI change, byte-compare), then switches.

1. **`build_workbook.py` → split.** Keep the extraction merge as the *writer* of facts (move the hooks' data into the builder: prints,
   captions, derivation inputs), and generate `companies/<id>.json` from `facts/` (`latest` policy). Retires `shadow.py`.
2. **`build_restatements.py`** → a query: first-print vs current per cell (flags 32/16) instead of the workbook's `restated` list; the
   log gains intermediate prints and the rows joined across wordings.
3. **`check_consistency.py`, `check_additivity.py`, gate `balance` / `cross_layer`** → read facts by line id; additivity within one
   vintage (W5-1: Q1+Q2 = H1 per vintage, not across).
4. **`canon_kpi.py`, `csm_resolve.py`** → resolve a KPI to a line id + policy; "printed over XBRL" becomes a vintage rule.
5. **`build_series.py`** → its rows become `n.*` lines with every print (today one print per cell, flag 128 where comparative).
6. **`build_ifrs.py`** → IFRS 17 note facts as lines (`n.*`, dims = segment/basis/bucket); brings the 102 note pairs in.
7. **`build_sop.py`, `build_registry.py`** (metric registry of the Peer Table) → registry entries reference line ids; peer series become
   `facts.series(id, window, policy)` per company.

Pages: `Company.tsx` statements first (snippet below), then Report Day deltas (`original` vs `latest` of the same period), Peers
(policy per table), Restatements page (from the table, with every print).

### Integration snippet: statement grid (`pages/Company.tsx`, `FinancialsInner`) — for the orchestrator

```tsx
import { countChanged, useVintage, VintageMark, VintageToggle, vintageProv } from '../components/VintageToggle';
import { FL } from '../lib/facts';

// inside FinancialsInner, after `const fromReports = sheetCode.startsWith('X.')` (move that line up, before `raw`):
const vin = useVintage(fromReports ? companyId : null);          // ?vin=; facts/<id>.json loads only when the toggle leaves 'latest'
const vLine = (mi: number) => vin.facts?.byMi.get(mi) ?? null;
const vP = (pi: number) => (vin.facts ? vin.facts.periodIndex(d.periods[pi].type, d.periods[pi].end) : -1);
const vCell = (mi: number, pi: number) => { const l = vLine(mi), p = vP(pi); return l && p >= 0 && vin.policy !== 'latest' ? vin.facts!.cell(l, p, vin.policy) : undefined; };

// raw(): the cell under the policy (LTM, YoY and the chart follow, all within one vintage)
const raw = (mi: number | null, pi: number): number | null => {
  if (mi == null || pi < 0) return null;
  const c = vCell(mi, pi);
  if (c !== undefined) return c && seen({ old: !!(c.f & FL.IFRS4) }) ? c.v : null;
  const f = store.byMetric.get(mi)?.get(pi); return f && seen(f) ? f.v : null;
};
// valProv(): the source sheet of the cell under the policy, with both prints
//   if (vin.facts && vLine(mi) && vP(pi) >= 0) return vintageProv(vin.facts, vLine(mi)!, vP(pi), vin.policy, scale) ?? printedAt(mi, pi);
// pdfHref(): const c = vCell(mi, pi); if (c) return vin.facts!.pdf(c);   (before the workbook lookup)

// toolbar, beside the IFRS 17 / IFRS 4 tabs:
{fromReports && <VintageToggle value={vin.policy} onChange={vin.setPolicy} busy={vin.loading}
  changed={vin.facts ? countChanged(vin.facts, rows.filter((r) => !r.m.header).map((r) => vLine(r.idx)!).filter(Boolean), cols.map(vP).filter((p) => p >= 0)) : restated.length} />}

// each value cell: the mark replaces the `re` class once the table is loaded (before <Sourced>):
{vin.facts && vLine(r.idx) && vP(pi) >= 0 ? <VintageMark facts={vin.facts} line={vLine(r.idx)!} p={vP(pi)} policy={vin.policy} scale={scale} /> : null}
//   and in the class list: `${f?.re && !vin.facts ? ' re' : ''}`
// OWN (the set of URL keys the page owns) gains 'vin'.
```
