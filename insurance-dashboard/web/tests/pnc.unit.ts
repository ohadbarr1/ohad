/* W10 · P&C ratios (pnc.json): every ratio re-derives from the printed inputs, derived periods re-derive from the printed windows, loss +
   expense = combined, the lines add to the total, and every ratio's source opens down to a printed page. Run: npm run test:pnc */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ratios, ratioProv, rrProv, type Metric, type PncFile, type RatioKey } from '../src/lib/pnc';
import type { Prov } from '../src/lib/prov';

const F = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'pnc.json'), 'utf8')) as PncFile;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | undefined, b: number | undefined, tol = 1e-5) => a != null && b != null && Math.abs(a - b) <= tol;
const leaves = (p: Prov, d = 0): Prov[] => (d > 10 ? [] : p.k === 'calc' ? p.inputs.flatMap((x) => (x.src ? leaves(x.src(), d + 1) : [])) : [p]);

const ids = Object.keys(F.cos);
ok(ids.length === 7, `seven insurers (${ids.length})`);
for (const id of ids) {
  const C = F.cos[id];
  ok(F.reports[id]?.f?.startsWith('rpdf/') && F.reports[id].pub, `${id}: report file and publication date`);
  for (const [seg, L] of Object.entries(C.lines)) {
    for (const [pk, P] of Object.entries(L.per)) {
      const parts = F.meta.periods.find((p) => p[0] === pk)![2];
      for (const m of Object.keys(P.x) as Metric[]) {
        const v = parts.reduce((t, [s, w]) => t + s * L.base[w][m]![0], 0);
        ok(near(v, P.x[m], 1e-4), `${id} ${seg} ${pk} ${m}: derives from the printed windows`);
      }
      const R = ratios(P.x);
      for (const k of Object.keys(R) as RatioKey[]) ok(near(R[k], P.r[k]), `${id} ${seg} ${pk} ${k}: re-derives`);
      if (P.r.lr != null && P.r.er != null && P.r.cr != null) ok(near(P.r.lr + P.r.er, P.r.cr), `${id} ${seg} ${pk}: loss + expense = combined`);
      for (const k of Object.keys(P.r) as RatioKey[]) {
        const lv = leaves(ratioProv(F, id, seg, pk, k, seg));
        ok(lv.length > 0 && lv.every((x) => x.k === 'report' && !!x.url && x.pg != null), `${id} ${seg} ${pk} ${k}: source opens to printed pages`);
      }
      const rl = leaves(rrProv(F, id, seg, pk, seg));
      ok(rl.length >= 2 && rl.every((x) => x.k === 'report'), `${id} ${seg} ${pk}: reinsurance result opens to pages`);
    }
  }
  const T = C.lines['pc'];
  for (const w of Object.keys(T.base)) for (const m of Object.keys(T.base[w]) as Metric[]) {
    const parts = ['pc:רכב חובה', 'pc:רכב רכוש', 'pc:אחר'].map((s) => C.lines[s]?.base[w]?.[m]?.[0]);
    if (parts.every((x) => x != null)) ok(Math.abs(parts.reduce((t, x) => t + x!, 0) - T.base[w][m]![0]) <= 3, `${id} ${w} ${m}: lines add to the total`);
  }
}
ok(F.meta.gaps.length >= 4 && F.meta.gaps.every((g) => /לא מדווח בפילוח/.test(g[2])), 'gaps are labelled "לא מדווח בפילוח"');
console.log(`pnc: ${pass} passed, ${fail} failed`);
for (const b of bad.slice(0, 40)) console.log(`  FAIL ${b}`);
if (fail) process.exit(1);
