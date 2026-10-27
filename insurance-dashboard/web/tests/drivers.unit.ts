/* A1 · the Driver Graph library reproduces its own edges, the stress lab's disclosed points and M3's NPV, and propagates every company
   without a NaN. Run: npm run test:drivers (bundles this file with esbuild and runs it in node against web/public/data). Exit 1 on failure. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SolvFile } from '../src/lib/solvency';
import { solvLines, targetsAt, type TargetFact } from '../src/lib/stress';
import { NO_SHOCK, OUT_KEYS, edgesOf, elasticityRows, propagate, readLine, toProv, type DriverFile, type GraphFile, type ProvJ, type Shock } from '../src/lib/drivers';
import type { Prov } from '../src/lib/prov';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number | null | undefined, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const graph = json<GraphFile>('drivers/graph.json');
const ids = readdirSync(join(DATA, 'drivers')).filter((f) => f.endsWith('.json') && f !== 'graph.json').map((f) => f.slice(0, -5));
const files = new Map(ids.map((id) => [id, json<DriverFile>(`drivers/${id}.json`)] as const));
const reg = json<{ id: string }[]>('companies/index.json');
ok(reg.every((c) => files.has(c.id)), `a driver file for every registered company (${files.size}/${reg.length})`);
const gEdges = new Set(graph.edges.map((e) => e.id));

// 1 · no shock, no change; every output finite or null; every edge in the graph
for (const [id, f] of files) {
  const r = propagate(f, NO_SHOCK);
  for (const k of OUT_KEYS) {
    const o = r.out[k];
    ok(o.d == null || o.d === 0, `${id} ${k}: no shock moves it by ${o.d}`);
    ok(o.v == null || (Number.isFinite(o.v) && near(o.v, o.base)), `${id} ${k}: v ${o.v} vs base ${o.base}`);
  }
  for (const e of edgesOf(f)) ok(gEdges.has(e.e), `${id} ${e.id}: edge kind ${e.e} in graph.json`);
}

// 2 · fee compression: 1 bp on assets moves savings operating profit by exactly the sum of the identity edges (costs unchanged)
for (const [id, f] of files) {
  const sav = f.products.filter((p) => p.s !== 'ic');
  if (!sav.length || f.nodes.op_profit == null) continue;
  const want = sav.reduce((t, p) => t + (p.edges.find((e) => e.e === 'fee.op')?.v ?? 0), 0);
  const r = propagate(f, { fee: 1 });
  ok(near(r.out.op_profit.d, want, 1e-9), `${id} fee 1bp: Δop ${r.out.op_profit.d} vs Σ edges ${want}`);
  ok(near(r.out.revenue.d, want, 1e-9), `${id} fee 1bp: Δrevenue ${r.out.revenue.d} vs Σ edges ${want}`);
}

// 3 · transfers: NIS 1bn → NPV equals M3's formula over flow_npv.json's own margin, duration and ke; and × the LTM flow = its npv_tr
interface NpvRow { g: number; s: string; p: string; m: number | null; tr: number | null; npv_tr: number | null }
const npv = json<{ meta: { ke: { v: number } }; dur: Record<string, { v: number }>; rows: NpvRow[] }>('flow_npv.json');
const ann = (D: number, ke: number) => { const k = ke / 100; return k === 0 ? D : (1 - Math.pow(1 + k, -D)) / k; };
let nNpv = 0;
for (const [id, f] of files) for (const p of f.products) {
  const e = p.edges.find((x) => x.e === 'tr.npv');
  if (!e || e.v == null) continue;
  const row = npv.rows.find((x) => x.g === p.g && x.s === p.s && x.p.startsWith('LTM-') && x.p === `LTM-${f.meta.base.q.replace(/Q(\d)'(\d\d)/, 'Q$1-20$2')}`);
  ok(row && Math.abs(e.v - 1000 * row.m! / 100 * ann(npv.dur[p.s].v, npv.meta.ke.v)) < 1e-6, `${id} ${p.s}: NPV per NIS 1bn ${e.v} vs M3 formula`);
  if (row?.tr && row.npv_tr != null) ok(Math.abs(row.tr / 1000 * e.v - row.npv_tr) <= 0.01 + 1e-4 * Math.abs(row.npv_tr), `${id} ${p.s}: per-bn × LTM flow ${row.tr / 1000 * e.v} vs npv_tr ${row.npv_tr}`);
  nNpv++;
}

// 4 · the stress lab's solvency points: the same lines as stress.ts solvLines, and propagation returns the printed figure at its shock
const S = json<SolvFile>('csm/solvency.json');
const RS: Record<string, keyof Shock> = { rate: 'y10', equity: 'eq', mortality: 'mortality', morbidity: 'morbidity', lapse: 'lapse' };
let nSolv = 0, nCsm = 0;
for (const [id, f] of files) {
  const L = f.lines.solv;
  if (!L) continue;
  const lab = solvLines(S.sens, id, L.d);
  for (const [risk, pts] of Object.entries(L.pts)) {
    const want = lab.get(risk as 'rate') ?? [];
    ok(pts!.length === want.length && pts!.every((p) => want.some((q) => q.x === p.x && q.v === p.v)), `${id} solvency ${risk}: points = stress.ts solvLines`);
    for (const p of pts!) {
      if (p.b === 'wo') continue;
      const r = propagate(f, { [RS[risk]]: p.x } as Partial<Shock>);
      ok(r.out.solv_w.d === p.v, `${id} solvency ${risk} ${p.x}: Δ ${r.out.solv_w.d} vs printed ${p.v}`);
      nSolv++;
    }
  }
}
// 5 · IFRS 17 CSM and profit points: at the disclosed size the CSM moves by the printed figure; mortality / morbidity move profit by
//     the printed after-tax figure plus the CSM's first-year release after tax (no other channel carries those shocks)
for (const [id, f] of files) {
  for (const [risk, L] of Object.entries(f.lines.csm ?? {})) for (const p of L!.pts) {
    const r = propagate(f, { [RS[risk]]: p.x } as Partial<Shock>);
    ok(near(r.out.csm.d, p.v, 1e-12), `${id} CSM ${risk} ${p.x}: Δ ${r.out.csm.d} vs printed ${p.v}`);
    nCsm++;
    if (risk === 'mortality' || risk === 'morbidity') {
      const np = f.lines.np?.[risk as 'mortality']?.pts.find((q) => q.x === p.x)?.v ?? 0;
      const rel = f.edges.find((e) => e.e === 'csm.isr' && e.v != null)?.v ?? 0;
      ok(near(r.out.net_profit.d, np + p.v * rel * (1 - f.meta.assume.tax / 100), 1e-9), `${id} ${risk} ${p.x}: Δnp ${r.out.net_profit.d} vs printed ${np} + release`);
    }
  }
}

// 6 · the owner's check on Phoenix (as printed, FY'21 solvency report): rates −50bp → −18pp (range −13 to −18), equities −25% → −15pp,
//     morbidity +5% → −12pp, mortality −5% → −14pp; and the employer flag
const ph = files.get('phoenix')!;
const pe = (k: string) => ph.edges.find((e) => e.id === k)!;
ok(pe('y10.solv_w').v === -18 && pe('y10.solv_w').x === -50 && pe('y10.solv_w').range?.[0] === -18 && pe('y10.solv_w').range?.[1] === -13, 'phoenix rates −50bp → −18pp, range −18 to −13');
ok(pe('eq.solv_w').v === -15 && pe('morbidity.solv_w').v === -12 && pe('mortality.solv_w').v === -14, 'phoenix equities −15, morbidity −12, mortality −14');
ok(pe('y10.solv_w').quality === 'low', 'phoenix solvency sensitivities are stale (FY\'21 against an FY\'25 ratio): quality low');
ok(ph.meta.flag === 'employer', 'phoenix carries the employer flag');

// 7 · clamp vs linear beyond the disclosed range
const one: [number, number][] = [[-50, -18], [50, 10]];
ok(readLine(one, -100, 'clamp')!.v === -18 && readLine(one, -100, 'clamp')!.extra, 'clamped at the disclosed edge');
ok(readLine(one, -100, 'linear')!.v === -36, 'linear continues the outer segment');
ok(readLine(one, -25)!.v === -9 && !readLine(one, -25)!.extra, 'interpolated from the origin');
const r100 = propagate(ph, { y10: -100 }), r50 = propagate(ph, { y10: -50 });
ok(r100.out.solv_w.d === r50.out.solv_w.d && r100.flags.some((x) => x.includes('מחוץ לטווח')), 'a −100bp shock is held at the −50bp disclosure and tagged');
ok(propagate(ph, { y10: -100 }, { extrapolate: 'linear' }).out.solv_w.d === -36, 'linear option: −100bp = 2 × −18');

// 8 · targets: the builder's pick (ported) = stress.ts targetsAt on the same facts
for (const [id, f] of files) {
  if (!f.nodes.solv_w?.d) continue;
  for (const b of ['w', 'wo'] as const) {
    const t = targetsAt(f.targets as TargetFact[], f.nodes.solv_w.d!, b);
    ok((t.board?.v ?? null) === (f.nodes[`target_board_${b}`]?.v ?? null), `${id} board target ${b}: ${t.board?.v} vs ${f.nodes[`target_board_${b}`]?.v}`);
    ok((t.div?.v ?? null) === (f.nodes[`target_div_${b}`]?.v ?? null), `${id} dividend threshold ${b}: ${t.div?.v} vs ${f.nodes[`target_div_${b}`]?.v}`);
  }
}

// 9 · a combined shock propagates every company: finite numbers, signs that follow the mechanics, a provenance tree that opens
const crash: Partial<Shock> = { y10: 100, eq: -25, cpi: 2, flow: -2, fee: 2, cost: 3, credit: 100, policy: 50, mortality: -5, morbidity: 5 };
let leaves = 0;
const walk = (p: Prov, depth = 0): void => {
  if (depth > 12) return;
  if (p.k !== 'calc') { leaves++; return; }
  for (const x of p.inputs) if (x.src) walk(x.src(), depth + 1);
};
for (const [id, f] of files) {
  const r = propagate(f, crash);
  for (const k of OUT_KEYS) {
    const o = r.out[k];
    ok([o.v, o.d, o.base].every((x) => x == null || Number.isFinite(x)), `${id} ${k}: finite under the combined shock`);
    walk(o.prov);
  }
  if (f.products.some((p) => p.s !== 'ic' && p.fy) && r.out.revenue.d != null) ok(r.out.revenue.d < 0, `${id}: −25% equities, −2% flow and 2bp fees lower revenue (${r.out.revenue.d})`);
  ok(r.flags.some((x) => x.includes('מרווחי אשראי')), `${id}: the credit-spread shock is flagged as not carried`);
  ok(elasticityRows(f).every((x) => x.v == null || Number.isFinite(x.v)), `${id}: elasticity rows finite`);
  for (const e of edgesOf(f)) { const p = toProv(e.prov as ProvJ); ok(p && p.k, `${id} ${e.id}: provenance opens`); }
}

// 10 · identities: revenue = Σ product fees; ROE = profit ÷ average equity; the builder's checks hold
for (const [id, f] of files) {
  const sav = f.products.filter((p) => p.s !== 'ic');
  if (f.nodes.revenue) ok(near(f.nodes.revenue.v, sav.reduce((t, p) => t + (p.fees_ltm?.v ?? 0), 0), 1e-9), `${id}: revenue = Σ fees`);
  if (f.nodes.roe) ok(near(f.nodes.roe.v, f.nodes.net_profit.v! / f.nodes.equity.v! * 100, 1e-7), `${id}: ROE = profit ÷ equity`);
  ok(f.checks.every((c) => c.ok || c.level === 'warn'), `${id}: identity checks reconcile`);
}

// 11 · the policy rate: −150bp moves net profit by exactly (cash × β − unlinked bank credit) × Δ ÷ 10,000 × (1 − tax), nothing else
//      moves; the same β everywhere; an insurer's IFRS 17 finance result is a labelled gap, never a silent zero
const betas = new Set<number>();
let nPol = 0;
for (const [id, f] of files) {
  const py = f.edges.find((e) => e.e === 'policy.y1'), yi = f.edges.find((e) => e.e === 'y1.inv'), pf = f.edges.find((e) => e.e === 'policy.fin');
  ok(py && py.v != null && py.method === 'regression' && py.n! >= 24, `${id}: policy → 1Y pass-through calibrated`);
  if (py?.v != null) betas.add(py.v);
  const b = py?.v != null ? py.v / py.x! : 0;
  const inv = yi?.v != null ? yi.v / yi.x! * b * -150 : 0, fin = pf?.v != null ? pf.v / pf.x! * -150 : 0;
  const r = propagate(f, { policy: -150 });
  const want = f.nodes.net_profit?.v != null ? (inv - fin) * (1 - f.meta.assume.tax / 100) : null;
  ok(want == null || near(r.out.net_profit.d, want, 1e-9), `${id} policy −150: Δnp ${r.out.net_profit.d} vs (cash × β − bank) × Δ × (1 − t) ${want}`);
  for (const k of ['revenue', 'op_profit', 'csm', 'solv_w', 'solv_wo'] as const) ok(!r.out[k].d, `${id} policy −150 leaves ${k} unchanged`);
  if (yi?.v != null) ok(near(yi.v, f.nodes.cash!.v! / 100, 1e-9), `${id}: y1.inv = cash ÷ 100`);
  if (pf?.v != null) ok(pf.method === 'assumption' && pf.quality === 'low' && near(pf.v, f.nodes.debt_bank!.v! / 100, 1e-9), `${id}: policy.fin = bank credit ÷ 100, a low-quality assumption`);
  if (f.meta.kind === 'insurance_group' && f.lines.csm) {
    ok(f.edges.some((e) => e.e === 'policy.np' && e.quality === 'missing' && e.why), `${id}: policy → IFRS 17 finance result is a labelled gap`);
    ok(r.flags.some((x) => x.includes('IFRS 17') && x.includes('לא נכלל ברווח')), `${id}: the IFRS 17 gap is flagged under a policy shock`);
  }
  if (yi?.v != null && inv) nPol++;
}
ok(betas.size === 1, `one policy → 1Y beta in every file (${[...betas].join(', ')})`);
ok(nPol >= 7, `the nostro cash channel moves profit for the insurers (${nPol})`);

// 12 · the variable cost: no negative fixed cost; a constrained fit says so; a variable cost above the fee yield carries its reason
for (const [id, f] of files) for (const p of f.products) {
  const e = p.edges.find((x) => x.e === 'aum.opex');
  if (!e || e.v == null) continue;
  ok((e.fit?.a ?? 0) >= 0, `${id} ${p.s}: fixed cost ≥ 0 (${e.fit?.a})`);
  if (e.fit?.c) ok((e.fit.a0 ?? 0) < 0 && e.quality !== 'high' && /constrained at a = 0/.test(e.note ?? ''), `${id} ${p.s}: constrained fit labelled`);
  if (p.fy?.v != null && e.v > p.fy.v * 10) {
    ok(/exceeds the fee yield/.test(e.note ?? '') && e.quality !== 'high', `${id} ${p.s}: variable cost above the fee yield labelled`);
    ok(elasticityRows(f).some((x) => x.e === e && x.note), `${id} ${p.s}: the page row carries the reason`);
  }
}
const alt = files.get('altshuler')!.products.find((p) => p.s === 'gem')!, altVc = alt.edges.find((e) => e.e === 'aum.opex')!;
ok(altVc.fit?.c === true && altVc.v! < alt.fy!.v! * 10, `Altshuler gemel: constrained variable cost ${altVc.v} below the fee yield ${alt.fy!.v! * 10}`);
const altG = propagate(files.get('altshuler')!, { flow: 5 });
ok(altG.out.op_profit.d! > 0, `Altshuler: 5% net inflows raise operating profit (${altG.out.op_profit.d})`);

const nE = [...files.values()].reduce((t, f) => t + edgesOf(f).length, 0), nMiss = [...files.values()].reduce((t, f) => t + edgesOf(f).filter((e) => e.quality === 'missing').length, 0);
console.log(`drivers: ${files.size} companies, ${nE} edges (${nMiss} missing), ${nSolv} solvency and ${nCsm} CSM disclosures reproduced, ${nNpv} NPV edges = M3, ${leaves} provenance leaves opened`);
console.log(`drivers: ${pass} passed, ${fail} failed`);
for (const b of bad.slice(0, 40)) console.log(`  FAIL ${b}`);
if (fail) process.exit(1);
