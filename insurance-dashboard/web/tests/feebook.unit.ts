/* Wave 11 · fee book (lib/feebook.ts) and the flow-to-earnings nowcast (lib/nowcastF2e.ts) against the published files of
   pipeline/build_feebook.py and pipeline/build_nowcast.py: the page's EV formula equals the build's for every row, manager total and
   sensitivity cell; the assumptions move EV the right way; no EV without reported costs; F2E point = ratio × implied and the range brackets it;
   the hit-rate summary re-derives from the ledger rows; every live estimate's segment base was printed before its as-of day.
   Run: npm run -s test:feebook (scripts/feebook-test.mjs bundles this file with esbuild and runs it in node). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseAssume, evBook, mgrEv, rowEv, type FeeBookData } from '../src/lib/feebook';
import type { F2eData } from '../src/lib/nowcastF2e';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const D = join(process.cwd(), 'public', 'data');
const read = <T,>(p: string) => JSON.parse(readFileSync(join(D, p), 'utf8')) as T;
const near = (a: number | null | undefined, b: number | null | undefined, tol = 0.01) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol + Math.abs(b) * 1e-9);

/* ---- the formula on a hand case ---- */
// 1 year, no floor, no erosion: 1000 × 1% × (1 − 0.5) / 1.08
ok(near(evBook(1000, 1, 0, null, 1, 0.5, 8, 0, 1), 1000 * 0.01 * 0.5 / 1.08, 1e-12), 'one-year EV by hand');
// 2 years, survival 0.9, growth 10%: year 2 balance = 1000 × 0.9 × 1.1
ok(near(evBook(1000, 1, 0, null, 0.9, 0, 0, 10, 2), 10 + 9.9, 1e-12), 'two-year EV with survival and growth');
// erosion stops at the floor; a fee already below the floor stays where it is
ok(near(evBook(100, 0.3, -0.1, 0.22, 1, 0, 0, 0, 3), 0.3 + 0.22 + 0.22, 1e-12), 'erosion floored at the tender fee');
ok(near(evBook(100, 0.15, -0.1, 0.22, 1, 0, 0, 0, 3), 0.15 * 3, 1e-12), 'a fee under the floor is held, never raised to it');
ok(evBook(100, 0.5, 0, null, 0.9, null, 8, 0, 30) === null, 'no cost ratio -> no EV');

if (!existsSync(join(D, 'feebook.json'))) ok(false, 'public/data/feebook.json missing');
else {
  const d = read<FeeBookData>('feebook.json'), a = baseAssume(d);
  let n = 0;
  for (const x of d.rows) {
    if (x.skip) { ok(x.ev == null, `${x.c} ${x.p}: a skipped row has no EV`); continue; }
    n++;
    ok(near(rowEv(x, a), x.ev, 0.002), `${x.c} ${x.p}: page EV ${rowEv(x, a)} vs build ${x.ev}`);
    ok((x.ci == null) === (x.ev == null) || x.surv == null, `${x.c} ${x.p}: EV only with reported costs`);
    ok(x.eros != null && x.eros <= 0, `${x.c} ${x.p}: no rising fee in the base case`);
  }
  ok(n > 40, `${n} valued rows`);
  for (const m of d.managers) {
    const rs = d.rows.filter((x) => x.g === m.g), t = mgrEv(rs, a);
    ok(near(t.ev, m.ev, 0.01), `${m.c}: total ${t.ev} vs ${m.ev}`);
    if (m.grid) d.assume.grid_r.forEach((r, i) => d.assume.grid_s.forEach((s, j) => {
      ok(near(mgrEv(rs, a, { disc: r, ds: s }).ev, m.grid![i][j], 0.06), `${m.c} grid r ${r} s ${s}`);
    }));
    if (m.ev != null && m.ev > 0) {
      const hi = mgrEv(rs, { ...a, disc: a.disc + 2 }).ev!, ga = mgrEv(rs, { ...a, basis: 'ga' }).ev!, up = mgrEv(rs, { ...a, ds: 2 }).ev!;
      ok(hi < m.ev, `${m.c}: a higher discount rate lowers EV`);
      ok(ga >= m.ev, `${m.c}: G&A-only costs do not lower EV`);
      ok(up > m.ev, `${m.c}: higher survival raises EV`);
    }
    if (m.csm) ok(m.csm.parts.length > 0 && m.csm.url && m.csm.parts.every((p) => p.pg > 0), `${m.c}: the CSM opens to its report page`);
  }
}

if (!existsSync(join(D, 'nowcast_f2e.json'))) ok(false, 'public/data/nowcast_f2e.json missing');
else {
  const f = read<F2eData>('nowcast_f2e.json');
  for (const L of f.ledger) for (const e of L.rows) {
    let rev = 0, lo = 0, hi = 0;
    for (const [s, x] of Object.entries(e.segs)) {
      if (!x) continue;
      ok(near(x.rev, x.ratio * x.imp, 0.01), `${L.quarter} ${e.c} ${s}: point = ratio × implied`);
      ok(x.lo <= x.rev && x.rev <= x.hi, `${L.quarter} ${e.c} ${s}: the range brackets the point`);
      ok(near(x.imp, x.acc + x.dep, 0.001), `${L.quarter} ${e.c} ${s}: implied = accumulation + deposit fees`);
      const acc = (x.months[0].R / 2 + x.months[1].R + x.months[2].R + x.months[3].R / 2) / 12;
      ok(near(acc, x.acc, 0.001), `${L.quarter} ${e.c} ${s}: accumulation fees re-derive from the month ends`);
      ok(x.base.every((b) => b.printed < e.asof), `${L.quarter} ${e.c} ${s}: every calibration quarter printed before the as-of day`);
      const inN = x.base.filter((b) => b.in_n).map((b) => b.ratio);
      ok(near(inN.reduce((p, q) => p + q, 0) / inN.length, x.ratio, 1e-4), `${L.quarter} ${e.c} ${s}: ratio = mean of the flagged quarters`);
      rev += x.rev; lo += x.lo; hi += x.hi;
    }
    ok(near(rev, e.rev, 0.01) && near(lo, e.lo, 0.01) && near(hi, e.hi, 0.01), `${L.quarter} ${e.c}: manager = Σ segments`);
  }
  // the summary re-derives from the backtest rows
  for (const [c, s] of Object.entries(f.summary)) {
    const rs = f.backtest.filter((b) => c === 'all' || b.c === c), e = rs.map((b) => b.e_rev!).filter((x) => x != null);
    const abs = e.map(Math.abs).sort((p, q) => p - q), med = abs.length % 2 ? abs[(abs.length - 1) / 2] : (abs[abs.length / 2 - 1] + abs[abs.length / 2]) / 2;
    ok(s.rev && near(s.rev.mdae, med, 0.006) && s.rev.n === e.length, `${c}: median |error| ${s.rev?.mdae} vs ${med}`);
    ok(s.rev && near(s.rev.cover!, rs.filter((b) => b.in).length / rs.length * 100, 0.06), `${c}: range cover`);
  }
  ok(f.backtest.every((b) => b.day < b.T), 'every backtest estimate is dated before its print');
  ok(f.backtest.every((b) => (b.in === 1) === (b.lo <= b.act.rev && b.act.rev <= b.hi)), 'in-range flags re-derive');
}

console.log(`feebook: ${pass} passed, ${fail} failed`);
for (const b of bad.slice(0, 12)) console.log('FAIL', b);
process.exit(fail ? 1 : 0);
