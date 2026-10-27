/* A5 · the war room library: the flow model is zero-sum and reproduces the regression's own quantity (B × relative-fee change × assets),
   a full match with share weights is exactly the regression's relative-fee arithmetic, the NPV equals the M3 formula, the matrix and the
   best-response profile are finite, and every figure's provenance opens down to a regulator track and month (a `fund` leaf) or the
   regulator's dataset. Run: npm run test:warroom (bundles this file with esbuild and runs it in node against web/public/data). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverFile } from '../src/lib/drivers';
import type { Prov } from '../src/lib/prov';
import {
  BoardSrc, H, STRATS, WPRODS, a1Impact, breakEven, elasticity, matrix, nash, npv, payoff, quarters, run, simulate, total, valueOf, weights,
  type BoardFile, type Ctx, type ElFile,
} from '../src/lib/warroom';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number, b: number, tol = 1e-7) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const el = json<ElFile>('warroom/elasticity.json'), b = json<BoardFile>('warroom/board.json');
const ids = [...new Set(Object.values(b.co).filter((c): c is string => !!c))];
const files = new Map<string, DriverFile>(ids.map((c) => { try { return [c, json<DriverFile>(`drivers/${c}.json`)] as const; } catch { return null; } }).filter((x): x is readonly [string, DriverFile] => !!x));
const src = new BoardSrc(b);

/** every provenance leaf under p: true when one reaches a regulator track-month or a data.gov.il dataset */
function reaches(p: Prov, depth = 0): boolean {
  if (p.k === 'fund' || p.k === 'reg') return true;
  if (p.k === 'report') return /data\.gov\.il/.test(p.url ?? '');
  if (p.k === 'calc' && depth < 8) return p.inputs.some((i) => i.src && reaches(i.src(), depth + 1));
  return false;
}

// 1 · the elasticity file: n, se, t on every specification, finite
for (const k of WPRODS) {
  const P = el.products[k];
  for (const s of [P.main, ...Object.values(P.rob)]) ok([s.B, s.se, s.t, s.r2].every(Number.isFinite) && s.n > 100, `${k}: a specification without finite B/se/t or n`);
  ok(near(P.main.coef.slice(0, 7).reduce((t, c) => t + c.b, 0), P.main.B, 1e-4), `${k}: B = Σ lags`);
  ok(reaches(elasticity(el, k, 'main', null).p()), `${k}: elasticity provenance reaches the regulator`);
}

// 2 · one mover, the others holding: zero-sum, and the mover's flow = −B/100 × A × bp × Σ ramp
const B = -0.05, ramp = [1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7, 1];
for (const k of WPRODS) for (const c of b.products[k].cats.slice(0, 4)) {
  const m = c.mgrs[0];
  for (const al of ['rev', 'share'] as const) {
    const fl = simulate({ cat: c, cuts: new Map([[m.g, 5]]) }, B, ramp, al);
    const sum = [...fl.m.values()].reduce((t, xs) => t + total(xs), 0);
    ok(Math.abs(sum) < 1e-6, `${k}/${c.cat}/${al}: flows do not net to zero (${sum})`);
    const exp = -B / 100 * m.A * 5 * Array.from({ length: H }, (_, t) => ramp[Math.min(t, 6)]).reduce((x, y) => x + y, 0);
    const w = weights(c, m.g, al);
    const ws = [...w.w.values()].reduce((x, y) => x + y, 0);
    ok(near(total(fl.m.get(m.g)!), exp * ws, 1e-6), `${k}/${c.cat}/${al}: mover flow ${total(fl.m.get(m.g)!)} vs ${exp * ws}`);
    ok(Math.abs(ws - 1) < 2e-3, `${k}/${c.cat}/${al}: weights sum to ${ws}`);
  }
  // a full match by the second manager, share weights: the mover's flow = B × its relative-fee change (−bp × (1 − w_j)) × A
  const j = c.mgrs[1];
  const fl2 = simulate({ cat: c, cuts: new Map([[m.g, 5], [j.g, 5]]) }, B, [1, 1, 1, 1, 1, 1, 1], 'share');
  const others = c.mgrs.filter((x) => x.g !== m.g).reduce((t, x) => t + x.A, 0);
  ok(near(fl2.m.get(m.g)![0], -B / 100 * m.A * 5 * (1 - j.A / others), 1e-9), `${k}/${c.cat}: a full match is not the relative-fee arithmetic`);
}

// 3 · the default scenario: NPV = the M3 formula, the matrix and the profile finite, A1 finite, provenance reaches the regulator
const P = b.products.hisht, cat = P.cats.find((c) => c.cat === 'כללי')!, me = cat.mgrs.find((x) => x.c === 'altshuler')!;
const use = elasticity(el, 'hisht', 'main', null);
const ctx: Ctx = { prod: 'hisht', a1: P.a1, cats: P.cats, files, el: use, alloc: 'rev' };
const r0 = run(ctx, { mover: me.g, cat: cat.cat, bp: 5, resp: new Map() })[0];
const v = valueOf(files, cat, me, 'gem')!;
ok(!!v && !v.est, 'altshuler: an M3 margin from its A1 edge');
const fq = quarters(r0.fl.m.get(me.g)!);
const n = npv(v, fq, me.A, 5);
const byHand = v.a * fq.reduce((t, f, q) => t + f * (v.m - 0.05) / 100 * Math.pow(1 + v.ke / 100, -(q + 0.5) / 4), 0) - v.a * me.A * 5 / 10_000;
ok(near(n.v, byHand, 1e-9), `NPV ${n.v} vs by hand ${byHand}`);
const pay = payoff(ctx, [r0], me.g);
ok(!!pay && near(pay.v, n.v, 1e-9), 'payoff = npv for the lone mover');
const players = cat.mgrs.filter((x) => x.g !== me.g).map((x) => x.g);
const eq = nash(ctx, me.g, cat.cat, 5, players);
ok(eq.prof.size === players.length, 'a strategy for every competitor');
const rows = matrix(ctx, me.g, cat.cat, 5, players, 'hold', eq.prof);
ok(rows.every((rw) => rw.cells.length === STRATS.length && rw.cells.every((c) => c.v == null ? !!c.na : Number.isFinite(c.v))), 'matrix cells finite or explained');
ok(rows.every((rw) => rw.best != null), 'a best answer for every competitor');
const a = a1Impact(files, me, 'gem', total(r0.fl.m.get(me.g)!), 5, me.A);
ok(a.rev != null && Number.isFinite(a.rev) && a.op != null && Number.isFinite(a.op), 'A1: finite revenue and operating profit');
const be = breakEven(ctx, me.g, cat.cat, 5);
ok(be == null || Number.isFinite(be), 'break-even finite');
ok(reaches(src.assets(me, cat.cat)) && reaches(src.fee(me, cat.cat)) && reaches(src.trq(me, cat.cat)) && reaches(src.relFee(cat, me).p()), 'board figures reach a regulator track-month');
const ctxTr = src.ctxTr(me.g, 'pen', b.ctx.q[b.ctx.q.length - 1]);
ok(!!ctxTr && reaches(ctxTr.p()), 'the context line opens a regulator aggregate');

console.log(`warroom: default scenario Altshuler −5bp hishtalmut general: flow ${total(r0.fl.m.get(me.g)!).toFixed(0)}m, NPV ${n.v.toFixed(1)}m, best responses ${[...new Set(rows.map((rw) => rw.best))].join('/')}`);
console.log(`warroom: ${pass} passed, ${fail} failed`);
for (const x of bad.slice(0, 40)) console.log(`  FAIL ${x}`);
if (fail) process.exit(1);
