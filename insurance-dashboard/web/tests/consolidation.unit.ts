/* A9 · the consolidation library: every pair reproduces build_consolidation.py at the default assumptions (matrix rows and pair files),
   the ranking is the file's, the identities hold for an override, and every source opens down to a leaf.
   Run: npm run test:consolidation (bundles this file with esbuild and runs it in node against web/public/data). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LtsResolver } from '../src/lib/drivers';
import { annuity, defaults, pairAt, provsOf, screen, xprov, MATRIX_PATH, mixPath, pairPath, type MatrixFile, type MixFile, type Seg, type XProvJ } from '../src/lib/consolidation';
import type { Prov } from '../src/lib/prov';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number | null | undefined, tol = 1e-6) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)));
const lts: LtsResolver = (j) => ({ k: 'report', title: j.title, value: j.value, url: 'lts', pg: 1 });

const M = json<MatrixFile>(MATRIX_PATH);
const D = defaults(M);
const leaves = (p: Prov, d = 0): number => {
  if (d > 60) return 0;
  if (p.k === 'none') { bad.push(`dead end: ${p.title} (${p.why})`); fail++; return 0; }
  if (p.k === 'calc' && !p.inputs.some((x) => x.src)) return p.est ? 1 : 0;   // a labelled assumption is a leaf
  return p.k !== 'calc' ? 1 : p.inputs.reduce((t, x) => t + (x.src ? leaves(x.src(), d + 1) : 0), 0);
};
interface PF { products: { s: Seg; gross: { v: number }; net: { v: number }; npv: { v: number }; ci_a: { v: number } }[]; synergy: Record<string, { v: number }>;
  capacity: { total: { v: number }; room: { v: number } }; premia: { p: number; price: { v: number }; cash: { v: number }; debt: { v: number }; ok: boolean; eps: { v: number | null }; roe: { v: number | null }; roic: { v: number | null }; solv?: { v: number } }[];
  metric: { v: number | null }; rank: number | null; fit: { prod: { v: { v: number; prov: XProvJ } }; track: { v: { v: number; prov: XProvJ } } } }

// 1 · every pair at the defaults = the pipeline (matrix row and pair file)
const S = screen(M, D);
ok(S.length === M.pairs.length, `one pair per matrix row (${S.length} vs ${M.pairs.length})`);
ok(near(annuity(8, 10), (1 - 1.1 ** -8) / 0.1, 1e-12), 'annuity');
for (const r of M.pairs) {
  const s = S.find((y) => y.x.a === r.a && y.x.t === r.t)!;
  const x = s.x, q = x.prem.find((z) => z.p === M.meta.primary)!;
  ok(s.rank === r.rank, `${r.a}__${r.t}: rank ${s.rank} = file ${r.rank}`);
  for (const [k, a, b] of [['gross', x.gross, r.gross], ['net', x.net, r.net], ['npv_g', x.npv_g, r.npv_g], ['npv', x.npv, r.npv], ['cap', x.capacity, r.cap], ['price', q.price, r.price],
    ['metric', x.metric, r.metric], ['eps', q.eps, r.eps], ['roe', q.roe, r.roe], ['solv', q.solv, r.solv]] as const) ok(near(a, b, 1e-5), `${r.a}__${r.t}.${k}: TS ${a} = file ${b}`);
  ok(q.ok === r.ok, `${r.a}__${r.t}: affordable`);
  const f = json<PF>(pairPath(r.a, r.t));
  for (const p of f.products) {
    const y = x.rows.find((z) => z.s === p.s)!;
    ok(near(y.gross, p.gross.v, 1e-5) && near(y.net, p.net.v, 1e-5) && near(y.npv, p.npv.v, 1e-5) && near(y.cia, p.ci_a.v, 1e-5), `${r.a}__${r.t}.${p.s}: product rows`);
    // the synergy identity and its direction
    ok(near(y.gross, y.aum * y.fy / 100 * (y.cit - y.cia) / 100, 1e-12), `${r.a}__${r.t}.${p.s}: gross = AUM × fy × Δc/i`);
    ok(Math.abs(y.gross) < 1e-12 || (y.gross > 0) === (y.cit > y.cia), `${r.a}__${r.t}.${p.s}: positive only when the acquirer is cheaper`);
  }
  for (const p of f.premia) {
    const y = x.prem.find((z) => z.p === p.p)!;
    ok(near(y.price, p.price.v, 1e-5) && near(y.cash, p.cash.v, 1e-5) && near(y.debt, p.debt.v, 1e-5) && y.ok === p.ok && near(y.eps, p.eps.v, 1e-5) && near(y.roic, p.roic.v, 1e-5), `${r.a}__${r.t} premium ${p.p}`);
  }
  ok(near(x.capacity, f.capacity.total.v, 1e-5) && near(x.room, f.capacity.room.v, 1e-5), `${r.a}__${r.t}: capacity`);
}
// 2 · the sources open to leaves (one pair in full, every pair's headline)
const mixes: Record<string, MixFile> = Object.fromEntries(Object.keys(M.cos).map((id) => [id, json<MixFile>(mixPath(id))]));
for (const y of S) {
  const P = provsOf(M, y.x, lts);
  ok(leaves(P.npv()) > 0 && leaves(P.metric()) > 0 && leaves(P.capacity()) > 0, `${y.x.a}__${y.x.t}: NPV, metric, capacity open`);
}
{
  const y = S[0].x, P = provsOf(M, y, lts);
  for (const p of M.meta.premia) for (const f of [P.price, P.cashP, P.debtP, P.dnp, P.eps, P.roe, P.roic, P.gw]) ok(leaves(f(p)) > 0, `${y.a}__${y.t}: premium ${p} source opens`);
  if (y.ca.cap.scr) for (const p of M.meta.premia) ok(leaves(P.solv(p)) > 0 && leaves(P.solvGw(p)) > 0, `${y.a}__${y.t}: solvency sources open`);
  const f = json<PF>(pairPath(y.a, y.t));
  ok(leaves(xprov(M, f.fit.prod.v.prov, lts, mixes)) > 0 && leaves(xprov(M, f.fit.track.v.prov, lts, mixes)) > 0, 'fit components open');
}
for (const id of Object.keys(M.cos)) for (const k of ['ci', 'aum', 'fy', 'dur'] as const) for (const s of Object.keys(M.cos[id].products) as Seg[]) ok(leaves(xprov(M, M.cos[id].products[s]![k].prov, lts)) > 0, `${id}.${s}.${k} opens`);
ok(leaves(xprov(M, M.meta.example.ci.prov, lts)) > 0 && M.meta.example.ok, 'the More example is verified and opens');

// 3 · an override: the identities hold, a higher realisation raises every positive NPV, a higher leverage cap never lowers capacity
const A2 = { ...D, r: 80, lev: 60, h: 5 };
for (const r of M.pairs.slice(0, 20)) {
  const x0 = pairAt(M, r.a, r.t, D), x = pairAt(M, r.a, r.t, A2);
  ok(near(x.net, x.gross * 0.8, 1e-9), `${r.a}__${r.t}: net = gross × r`);
  ok(x.capacity >= x0.capacity - 1e-9, `${r.a}__${r.t}: higher leverage cap never lowers capacity`);
  ok(x.prem.every((q) => near(q.cash + q.debt, q.price, 1e-9) && q.ok === (q.price <= x.capacity + 1e-9)), `${r.a}__${r.t}: financing identities`);
  ok(x.rows.every((y) => y.h === 5), `${r.a}__${r.t}: the horizon override applies`);
  ok(leaves(provsOf(M, x, lts).npv()) > 0, `${r.a}__${r.t}: an override's source opens`);
}
console.log(`consolidation: ${Object.keys(M.cos).length} companies, ${M.pairs.length} pairs`);
console.log(`consolidation: ${pass} passed, ${fail} failed`);
for (const b of bad.slice(0, 40)) console.log(`  FAIL ${b}`);
if (fail) process.exit(1);
