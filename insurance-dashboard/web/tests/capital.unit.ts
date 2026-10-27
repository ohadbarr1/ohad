/* A7 · the capital library: the option rows reproduce build_capital.py at the file's buffer, the identities hold for any buffer, every
   A2 preset gives a finite stressed surplus or a gap (never a zero passed off as an effect), and every source opens down to a leaf.
   Run: npm run test:capital (bundles this file with esbuild and runs it in node against web/public/data). PRINT=1 prints the tables. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverFile, LtsResolver } from '../src/lib/drivers';
import { ncRows, presets, type CatFile, type CurveFile, type MacroFile, type NowcastFile } from '../src/lib/scenarios';
import { bindingOf, cprov, isBolt, isOk, isRow, optionsAt, stressOf, worstOf, type CapFile, type CProvJ, type OptRow } from '../src/lib/capital';
import type { Prov } from '../src/lib/prov';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number | null | undefined, tol = 1e-6) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)));
const lts: LtsResolver = (j) => ({ k: 'none', title: j.title, why: 'test' });

const F = json<CapFile>('capital/options.json');
const cos = F.companies.filter(isOk);
const reg = json<{ id: string; kind: string }[]>('companies/index.json');
ok(F.companies.length === reg.length, `one entry per company (${F.companies.length} vs ${reg.length})`);
ok(F.companies.filter((c) => !isOk(c)).every((c) => c.status === 'na' && 'why' in c && c.why.length > 10), 'every company not computed says why');
ok(cos.length >= 6, `insurers computed (${cos.length})`);
const nc = json<NowcastFile>('nowcast.json'), NC = ncRows(nc);
const P = presets(json<CurveFile>('macro/boi_curve.json'), json<CatFile>('funds/cat.json'), json<MacroFile>('macro/macro.json'), nc, F.meta.base.end);
const now = P.find((p) => p.id === 'now')!;
const ncAt = { eq: now.sc.eq, y10: now.sc.y10 };
const VAL = readFileSync(join(process.cwd(), 'src', 'lib', 'valuation.ts'), 'utf8');
const A0 = /ASSUME0: Assume = \{ erp: ([\d.]+), beta: ([\d.]+), rf: null, g: ([\d.]+), tax: ([\d.]+) \}/.exec(VAL);
ok(A0, 'valuation.ts ASSUME0 read');

/** every source opens to leaves; no ref is left unresolved */
const leaves = (p: Prov, d = 0): number => {
  if (d > 30) return 0;
  if (p.k === 'none' && /לא נמצא בקובץ/.test(p.why)) { bad.push(`unresolved ref: ${p.title}`); fail++; return 0; }
  return p.k !== 'calc' ? 1 : p.inputs.reduce((t, x) => t + (x.src ? leaves(x.src(), d + 1) : 0), 0);
};

for (const c of cos) {
  const bind = bindingOf(c), Bb = c.bases[bind.basis]!;
  // 1 · identities on every constraint and for the distributable capital
  for (const k of c.constraints) { const b = c.bases[k.basis]!; ok(near(k.headroom.v, b.of.v! - b.scr.v! * k.t / 100, 1e-9), `${c.id} ${k.id}: headroom = own funds − SCR × target`); }
  ok(near(c.distributable.v, Bb.of.v! - Bb.scr.v! * bind.t / 100 - c.buffer.v, 1e-9), `${c.id}: distributable = own funds − SCR × target − buffer`);
  ok(c.constraints.every((k) => k.headroom.v! >= bind.headroom.v! - 1e-9), `${c.id}: the binding constraint is the lowest`);
  // ke = the valuation page's: rf + beta × erp (valuation.ts ASSUME0)
  if (A0) ok(near(c.pnl.ke.v, c.pnl.rf.v! + Number(A0[2]) * Number(A0[1]), 1e-6) && near(c.pnl.tax.v, Number(A0[4])), `${c.id}: ke and tax = valuation.ts`);
  // 2 · the option rows: the TS library reproduces the pipeline at the file's buffer
  const R = optionsAt(c);
  for (const id of ['div', 'org'] as const) {
    const f = c.options.find((o) => o.id === id) as OptRow, t = R[id];
    for (const k of ['cap', 'roic', 'solv', 'roe', 'eps', 'eps_bb'] as const) if (f[k]) ok(near(t[k]?.v, f[k]!.v, 1e-5), `${c.id} ${id}.${k}: TS ${t[k]?.v} = file ${f[k]!.v}`);
    ok(near(t.per_bn, f.per_bn, 1e-5), `${c.id} ${id}: per NIS 1bn`);
    for (const k of ['cap', 'roic', 'solv', 'roe', 'eps'] as const) if (f[k].v != null) ok(leaves(cprov(c, f[k].prov as CProvJ, lts)) > 0, `${c.id} ${id}.${k}: the source opens to a leaf`);
  }
  ok(JSON.stringify(R.rank) === JSON.stringify(c.rank), `${c.id}: rank ${R.rank} = file ${c.rank}`);
  ok(c.options.some((o) => o.id === 'bolt' && !isRow(o)) && c.options.some((o) => o.id === 'hold' && !isRow(o)), `${c.id}: bolt-on (A9) and hold rows present`);
  // the A9 bolt-on: a filled row opens to leaves (its refs resolve inside the row's table), or says why there is none
  const bolt = c.options.find((o) => o.id === 'bolt')!;
  if (isBolt(bolt)) for (const k of ['cap', 'roic', 'roe', 'eps', 'npv', 'metric', 'solv'] as const) { const f = bolt[k]; if (f) ok(leaves(cprov(c, f.prov, lts)) > 0, `${c.id} bolt.${k}: the source opens to a leaf`); }
  else ok(bolt.status !== 'none' || ('why' in bolt && bolt.why.length > 10), `${c.id}: no bolt-on, with a reason`);
  // a buffer of zero gives the headroom; a larger buffer lowers the capacity one for one (dividend) and never raises the growth capacity
  const R0 = optionsAt(c, 0), R9 = optionsAt(c, c.buffer.pp + 5);
  ok(near(R0.dist, bind.headroom.v, 1e-9) && near(R9.dist, bind.headroom.v! - Bb.scr.v! * (c.buffer.pp + 5) / 100, 1e-9), `${c.id}: buffer override identity`);
  ok((R9.org.cap.v ?? 0) <= (R.org.cap.v ?? 0) + 1e-9, `${c.id}: a larger buffer never raises the growth capacity`);
  ok(R9.override && leaves(cprov(c, R9.div.cap.prov as CProvJ, lts)) > 0, `${c.id}: an override's source opens`);
  // 3 · the A2 overlay
  const f = json<DriverFile>(`drivers/${c.id}.json`);
  for (const mode of ['clamp', 'linear'] as const) {
    const S = stressOf(c, f, P, NC, ncAt, lts, c.buffer.pp, mode);
    ok(S.length === P.filter((p) => p.ok).length, `${c.id}: every preset`);
    for (const s of S) {
      ok([s.v, s.dW, s.dWo, s.survive, s.pctScr].every((x) => x == null || Number.isFinite(x)), `${c.id} ${s.id}/${mode}: finite`);
      if (s.v == null) ok(s.gap.length > 0, `${c.id} ${s.id}: not computed, with a reason`);
      for (const x of s.cons) if (x.v != null) { const k = c.constraints.find((y) => y.id === x.id)!; ok(near(x.v, k.headroom.v! + c.bases[k.basis]!.scr.v! * x.d! / 100, 1e-9), `${c.id} ${s.id} ${x.id}: stressed = headroom + SCR × Δ`); }
      if (!(s.preset.sc.y10 || s.preset.sc.eq)) ok((s.dW ?? 0) === 0 && s.gap.length > 0, `${c.id} ${s.id}: no solvency channel shown as a gap, the surplus as at base`);
      if (s.v != null) ok(leaves(s.prov()) > 0, `${c.id} ${s.id}: the stressed figure opens`);
    }
    if (c.id === 'phoenix' && mode === 'clamp') {
      const eq = S.find((s) => s.id === 'eqdd')!, rt = S.find((s) => s.id === 'rate')!;
      ok(eq.v != null && eq.v < c.distributable.v! && rt.v != null && rt.v < c.distributable.v!, 'Phoenix: equity drawdown and rate shock both consume surplus');
    }
  }
}
if (process.env.PRINT) for (const c of cos) {
  const R = optionsAt(c), f = json<DriverFile>(`drivers/${c.id}.json`), S = stressOf(c, f, P, NC, ncAt, lts, c.buffer.pp), W = worstOf(S);
  const b = bindingOf(c);
  console.log(`\n== ${c.id} ${c.period} · binding ${b.id} ${b.t}% · headroom ${b.headroom.v!.toFixed(1)} · buffer ${c.buffer.pp}pp ${c.buffer.v.toFixed(1)} · distributable ${c.distributable.v!.toFixed(1)}`);
  for (const o of [R.div, R.org]) console.log(`  ${o.id}: cap ${o.cap.v!.toFixed(1)} roic ${o.roic.v!.toFixed(2)} solv ${o.solv.v!.toFixed(1)}pp (${o.per_bn.toFixed(2)}/bn) ΔROE ${o.roe.v?.toFixed(2)} EPS ${o.eps.v?.toFixed(2)}%${o.eps_bb ? ` buyback EPS ${o.eps_bb.v?.toFixed(2)}%` : ''}`);
  for (const s of S) console.log(`  ${s.id.padEnd(6)} dW ${s.dW?.toFixed(1)} dWo ${s.dWo?.toFixed(1)} → ${s.v?.toFixed(1)} (${s.survive?.toFixed(0)}% survives, ${s.pctScr?.toFixed(1)}% SCR) ${s.binding}${s.gap.length ? ' GAP' : ''}${s.est.length ? ' EST' : ''}`);
  console.log(`  worst: ${W?.id} ${W?.v?.toFixed(1)} rank ${R.rank}`);
}
console.log(`capital: ${cos.length} insurers, ${P.length} presets`);
console.log(`capital: ${pass} passed, ${fail} failed`);
for (const b of bad.slice(0, 40)) console.log(`  FAIL ${b}`);
if (fail) process.exit(1);
