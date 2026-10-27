/* A2 · the Scenario Studio library: every preset runs every company without a NaN, a gap is never a zero, the per-product fee and flow
   inputs reproduce the driver graph's identities, the URL round-trips, and a frame (17 companies) recomputes well inside 16 ms.
   Run: npm run test:scenarios (bundles this file with esbuild and runs it in node against web/public/data). PRINT=1 prints the rankings. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_KEYS, type DriverFile, type LtsResolver } from '../src/lib/drivers';
import {
  SLIDERS, ZERO, headline, makeCtx, ncRows, presets, rank, readScn, runAll, runOne, sentence, writeScn,
  type CatFile, type CurveFile, type MacroFile, type NowcastFile, type Scn,
} from '../src/lib/scenarios';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number | null | undefined, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const lts: LtsResolver = (j) => ({ k: 'none', title: j.title, why: 'test' });

const reg = json<{ id: string; name_he: string }[]>('companies/index.json');
const nc = json<NowcastFile>('nowcast.json'), NC = ncRows(nc);
const files = reg.map((c) => [c, json<DriverFile>(`drivers/${c.id}.json`)] as const);
const ctx = files.map(([c, f]) => makeCtx(c.id, c.name_he, f, NC, lts));
ok(ctx.length === 17, `17 companies (${ctx.length})`);
const P = presets(json<CurveFile>('macro/boi_curve.json'), json<CatFile>('funds/cat.json'), json<MacroFile>('macro/macro.json'), nc, files[0][1].meta.base.end);
const now = P.find((p) => p.id === 'now')!;
const ncAt = { eq: now.sc.eq, y10: now.sc.y10 };

// 1 · no shock: nothing moves, nothing is flagged as a gap
for (const r of runAll(ctx, ZERO, ncAt, 'clamp', lts)) for (const k of OUT_KEYS) {
  const c = r.cells[k];
  ok(c.d == null || c.d === 0, `${r.id} ${k}: no shock, Δ ${c.d}`);
  ok(!c.gap.length, `${r.id} ${k}: no gap without a shock (${c.gap[0]})`);
}

// 2 · the URL round-trips every slider, the horizon and the overlay
const s0: Scn = { ...ZERO, policy: -150, y10: 35, eq: -25, credit: 150, cpi: 2.5, flow: -100, h: 8, fp: 5, fg: 10.5, cost: 3, nc: 1 };
const back = readScn(writeScn(new URLSearchParams('src=1&x=lin'), s0));
ok(SLIDERS.every((d) => back[d.k] === s0[d.k]) && back.h === 8 && back.nc === 1, 'the scenario round-trips through the URL');
ok(writeScn(new URLSearchParams('src=1'), s0).get('src') === '1', 'other parameters survive');

// 3 · every preset, both modes: finite, gaps are null never zero, every source opens
const walk = (p: { k: string; inputs?: { src?: () => unknown }[] }, d = 0): number => (d > 8 || p.k !== 'calc' ? 1 : (p.inputs ?? []).reduce((t, x) => t + (x.src ? walk(x.src() as never, d + 1) : 0), 0));
ok(P.length === 7 && P.every((p) => p.ok), `seven presets, all built (${P.filter((p) => !p.ok).map((p) => p.id).join(', ')})`);
for (const p of P) for (const mode of ['clamp', 'linear'] as const) {
  const rs = runAll(ctx, p.sc, ncAt, mode, lts);
  for (const r of rs) {
    for (const k of OUT_KEYS) {
      const c = r.cells[k];
      ok([c.v, c.d, c.base].every((x) => x == null || Number.isFinite(x)), `${p.id}/${mode} ${r.id} ${k}: finite`);
      walk(c.o.prov as never);
    }
    ok([r.vul, r.capUse, r.earnUse].every((x) => x == null || Number.isFinite(x)), `${p.id} ${r.id}: ranking parts finite`);
    ok(sentence(r).startsWith(r.name), `${p.id} ${r.id}: a sentence`);
    walk(r.capProv() as never); walk(r.earnProv() as never); if (r.head) walk(r.head.prov() as never);
  }
  ok(rank(rs, 'vul').length === 17 && headline(rank(rs, 'vul'), p.he).length > 10, `${p.id}: ranked`);
}
// Menora: solvency sensitivities not extracted → under an equity shock the stressed ratio is a gap, not the base
const menora = ctx.find((c) => c.id === 'menora')!;
const mr = runOne(menora, { ...ZERO, eq: -25 }, ncAt, 'clamp', lts);
ok(mr.cells.solv_w.v == null && mr.cells.solv_w.gap.length > 0 && mr.cells.solv_w.base != null, 'Menora solvency under −25% equities: gap with the base kept');
// credit spreads: a gap everywhere, never an effect
for (const r of runAll(ctx, { ...ZERO, credit: 150 }, ncAt, 'clamp', lts)) {
  ok(OUT_KEYS.every((k) => !r.cells[k].d), `${r.id}: credit alone moves nothing`);
  ok(r.rowGap.some((g) => g.includes('מרווחי אשראי')), `${r.id}: credit marked as a gap`);
}
// the transitional measures: without-basis moves are labelled estimates where no disclosure on that basis exists
const ph = runOne(ctx.find((c) => c.id === 'phoenix')!, { ...ZERO, eq: -25 }, ncAt, 'clamp', lts);
ok(ph.cells.solv_wo.est.length > 0 && ph.cells.solv_w.q === 'low', 'Phoenix: FY\'21 solvency read is low quality, the without-basis move an estimate');

// 4 · per-product inputs reproduce the identities: fee cap = 5 × fee.op(pen) + 10 × fee.op(gem); freeze = −2 × LTM transfers
for (const c of ctx) {
  const sav = c.f.products.filter((p) => p.s !== 'ic' && p.fy?.v != null);
  if (!sav.length || c.f.nodes.op_profit?.v == null) continue;
  const want = sav.reduce((t, p) => t + (p.edges.find((e) => e.e === 'fee.op')?.v ?? 0) * (p.s === 'pen' ? 5 : 10), 0);
  const r = runOne(c, { ...ZERO, fp: 5, fg: 10 }, ncAt, 'clamp', lts);
  ok(near(r.cells.op_profit.d, want, 1e-6), `${c.id}: fee cap Δop ${r.cells.op_profit.d} vs ${want}`);
  const fz = runOne(c, { ...ZERO, flow: -100, h: 8 }, ncAt, 'clamp', lts);
  for (const p of fz.prods) { const pr = c.f.products.find((x) => x.s === p.s)!; if (pr.tr_ltm?.v != null) ok(near(p.flow, -2 * pr.tr_ltm.v / pr.avg.v! * 100, 1e-9), `${c.id} ${p.s}: freeze flow`); }
}
// the overlay: with M1, a covered product's AUM lands on the regulator's quarter average (market channel netted out)
for (const c of ctx.filter((x) => x.nc)) {
  const r = runOne(c, now.sc, ncAt, 'clamp', lts);
  for (const pr of c.f.products) {
    const seg = c.nc!.segs[pr.s as 'pen' | 'gem'];
    const part = r.P.parts.find((x) => x.id === `aum.${pr.s}`);
    if (seg && pr.fy?.v != null) ok(near(pr.avg.v! + (part?.d ?? 0), seg.avg, 1e-6), `${c.id} ${pr.s}: AUM = M1 quarter average (${pr.avg.v! + (part?.d ?? 0)} vs ${seg.avg})`);
  }
}

// 5 · a frame: 17 companies through propagate, both the sliders' common case and the heaviest preset
const t0 = performance.now(); let n = 0;
for (let i = 0; i < 60; i++) for (const p of P) { runAll(ctx, { ...p.sc, eq: p.sc.eq + (i % 7) }, ncAt, i % 2 ? 'linear' : 'clamp', lts); n++; }
const ms = (performance.now() - t0) / n;
ok(ms < 16, `one frame recomputes in ${ms.toFixed(2)} ms`);

if (process.env.PRINT) for (const id of ['eqdd', 'rate', '2008', 'fee', 'freeze', 'stag', 'now']) {
  const p = P.find((x) => x.id === id)!, rs = rank(runAll(ctx, p.sc, ncAt, 'clamp', lts), 'vul');
  console.log(`\n== ${p.he} · ${JSON.stringify(Object.fromEntries(Object.entries(p.sc).filter(([, v]) => v)))}\n${headline(rs, p.he)}`);
  rs.slice(0, 8).forEach((r, i) => console.log(`${i + 1}. [t${r.tier}] vul ${r.vul?.toFixed(1)} cap ${r.capUse?.toFixed(1)} earn ${r.earnUse?.toFixed(1)} head ${r.head?.base.toFixed(1)}→${r.head?.v?.toFixed(1)} ΔROE ${r.cells.roe.d?.toFixed(2)} · ${sentence(r)}`));
}
console.log(`scenarios: ${ctx.length} companies, ${P.length} presets, ${ms.toFixed(2)} ms per frame (17 companies)`);
console.log(`scenarios: ${pass} passed, ${fail} failed`);
for (const b of bad.slice(0, 40)) console.log(`  FAIL ${b}`);
if (fail) process.exit(1);
