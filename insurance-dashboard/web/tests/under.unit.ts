/* Wave 11 · under (lib/under.ts) against the published files of pipeline/build_under.py: the headline rows obey the rule and add up to
   the series; the latest month agrees with the track card (5Y net, percentile, migration flag in funds.json); every month file adds up
   to its series point; the gap honours the tie band; the generated line is the table's; the saver's line fires only on its rule.
   Run: npm run -s test:under (scripts/under-test.mjs bundles this file with esbuild and runs it in node). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { costProv, headline, headRows, ilsM, medProv, monthRows, pointProv, rowsOf, saverUnder, ym, type UnderFile, type UnderMonth } from '../src/lib/under';
import { TIE_BP } from '../src/lib/fundsTie';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; if (bad.length < 40) bad.push(what); } }
const D = join(process.cwd(), 'public', 'data');
const read = <T,>(p: string) => JSON.parse(readFileSync(join(D, p), 'utf8')) as T;
const near = (a: number, b: number, t = 0.051) => Math.abs(a - b) <= t;

if (!existsSync(join(D, 'under.json'))) ok(false, 'public/data/under.json missing');
else {
  const U = read<UnderFile>('under.json');
  const rows = rowsOf(U), head = headRows(rows), j = U.months.length - 1, S = U.series;
  ok(U.band_bp === TIE_BP, `the file's band (${U.band_bp}bp) is lib/fundsTie.ts TIE_BP`);
  for (const k of ['what', 'past', 'why5', 'net', 'cat', 'pct', 'med', 'gap', 'cost', 'icost', 'flow', 'mig', 'head', 'series', 'not'] as const) ok(U.method[k]?.length > 20, `method ${k} stated`);
  ok(U.method.past.includes('אינן מנבאות'), 'past returns do not predict: stated');
  ok(U.months[0] === 201601 && U.months[j] === U.asof && U.months.length === S.cost.length, 'the series runs from 01/2016 to the data month');

  /* ---- the headline list ---- */
  ok(head.length === U.head_n && head.length === S.n[j], `headline rows ${head.length} = head_n ${U.head_n} = series n ${S.n[j]}`);
  ok(near(head.reduce((t, r) => t + r.cost, 0), S.cost[j]), 'Σ headline cost = the latest series point');
  ok(near(head.reduce((t, r) => t + r.a, 0), S.a[j], 0.5), 'Σ headline assets = series a');
  ok(near(head.reduce((t, r) => t + (r.icost ?? 0), 0), S.icost[j]), 'Σ inflow cost = series icost');
  for (const r of head) {
    ok(r.pct <= U.bq, `${r.k}: bottom quartile`);
    ok(r.gap >= U.band_bp / 100 - 1e-9, `${r.k}: gap outside the band`);
    ok(r.nd12 != null && r.nd12 > 0 && r.c12 != null && r.c12 > 0, `${r.k}: positive 12M flow, as published and without migration`);
    ok(!r.mig || (r.gfl12 != null && r.gfl12 > 0), `${r.k}: a migration-flagged row needs the group's competitive flow positive`);
    ok(near(r.cost, (r.a * r.gap) / 100), `${r.k}: cost = a × gap`);
    ok(r.icost != null && near(r.icost, (r.c12! * r.gap) / 100), `${r.k}: inflow cost = c12 × gap`);
  }
  /* ---- every ranked row: the band, the median, the card ---- */
  const F = read<{ funds: { k: string; net?: { a5?: number | null } | null; pn?: { a5?: number | null } | null; mig?: unknown }[] }>('funds.json');
  const by = new Map(F.funds.map((f) => [f.k, f]));
  let nCard = 0;
  for (const r of rows) {
    ok(r.gap === 0 || r.gap >= U.band_bp / 100 - 1e-9, `${r.k}: a gap is 0 or outside the band`);
    ok(r.gap === 0 ? r.med - r.r5 < U.band_bp / 100 + 1e-9 : near(r.gap, r.med - r.r5, 0.0011), `${r.k}: gap = median − r5`);
    const f = by.get(r.k);
    if (f) { nCard++; ok(f.net?.a5 === r.r5, `${r.k}: r5 ${r.r5} = card ${f.net?.a5}`); ok(f.pn?.a5 === r.pct, `${r.k}: pct ${r.pct} = card ${f.pn?.a5}`); ok(!!f.mig === !!r.mig, `${r.k}: migration flag = card`); }
  }
  ok(nCard === rows.length && rows.length === F.funds.filter((f) => f.pn?.a5 != null).length, `every ranked track is a live card with a 5Y percentile (${nCard}/${rows.length})`);
  const cats = new Map<string, number[]>();
  rows.forEach((r) => cats.set(r.cat, [...(cats.get(r.cat) ?? []), r.r5]));
  for (const [c, xs] of cats) {
    const s = [...xs].sort((a, b) => a - b), n = s.length, med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    ok(n >= 5, `${c}: at least 5 tracks`);
    ok(rows.filter((r) => r.cat === c).every((r) => near(r.med, med, 0.0006)), `${c}: median ${med} on every row`);
  }
  /* ---- month files ---- */
  let nM = 0;
  for (const [i, p] of U.months.entries()) {
    const M = read<UnderMonth>(`under/m/${p}.json`), rs = monthRows(M);
    nM++;
    ok(rs.length === S.n[i], `${p}: rows = n`);
    ok(near(rs.reduce((t, r) => t + r.cost, 0), S.cost[i]), `${p}: Σ cost = series`);
    ok(near(rs.reduce((t, r) => t + r.c12, 0), S.fl[i], 0.5), `${p}: Σ c12 = series fl`);
    ok(S.cost[i] <= S.cost_bq[i] + 0.051, `${p}: headline ≤ bottom-quartile total`);
    ok(near(Object.values(U.byp).reduce((t, xs) => t + (xs[i] ?? 0), 0), S.cost[i], 0.5), `${p}: Σ by product = total`);
    if (p === U.asof) {
      const pv = pointProv(U, M, (k) => k);
      ok(pv.k === 'calc' && pv.inputs.length === rs.length && near(pv.inputs.reduce((t, x) => t + Number(x.v.replace(/,/g, '').replace('−', '-')), 0), S.cost[i], 0.5), 'the series point opens its rows, adding up');
    }
  }
  ok(nM === U.months.length, 'one month file per month');
  /* ---- provenance and the line ---- */
  if (head[0]) {
    const cp = costProv(U, head[0], rows);
    ok(cp.k === 'calc' && cp.inputs.length === 2 && cp.inputs.every((x) => x.src), 'cost opens assets and gap, each sourced');
    const mp = medProv(U, head[0].cat, rows);
    ok(mp.k === 'calc' && mp.inputs.length === head[0].n, 'the median opens every track of the category');
    const line = headline(U, rows)!;
    ok(line.includes(String(head.length)) && line.includes(ilsM(S.cost[j])) && line.includes(head[0].name) && line.startsWith(ym(U.asof)), 'the headline line is the table\'s');
  }
  /* ---- the saver's line ---- */
  let fired = 0, silent = 0;
  for (const r of rows) {
    const s = saverUnder(U, r.k, 250000), want = r.pct <= U.bq && r.gap >= U.saver_bp / 100 - 1e-9;
    ok(!!s === want, `${r.k}: saver line fires only on bottom quartile and gap ≥ ${U.saver_bp}bp`);
    if (s) { fired++; ok(near(s.ils, (250000 * r.gap) / 100, 0.01) && s.own, `${r.k}: ₪ on her balance`); } else silent++;
  }
  const any = rows.find((r) => r.pct <= U.bq && r.gap >= U.saver_bp / 100);
  if (any) { const s = saverUnder(U, any.k, null)!; ok(s && !s.own && s.base === 100000, 'no balance: ₪ on 100,000'); }
  ok(saverUnder(U, 'nope') === null && saverUnder(null, rows[0].k) === null, 'unknown track or no file: nothing');
  const tight = rows.find((r) => r.pct <= U.bq && r.gap > 0 && r.gap < U.saver_bp / 100);
  if (tight) ok(saverUnder(U, tight.k, 100000) === null, `${tight.k}: bottom quartile but gap ${tight.gap} < ${U.saver_bp}bp: nothing`);
  console.log(`under: ${rows.length} ranked rows, ${head.length} headline, ${nM} months; saver line fires on ${fired}, silent on ${silent}`);
}
if (fail) { console.error(`under: ${fail} failed, ${pass} passed\n  ` + bad.join('\n  ')); process.exit(1); }
console.log(`under: ${pass} passed`);
