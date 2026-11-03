/* W10 · capital/forward.json: one vintage per insurer (the latest report, labelled), the walk foots, capacity = headroom − distributions after
   publication on every constraint, the binding constraint is the lowest, the worst shock is reproduced, every figure opens to a page.
   Run: npm run test:forward */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toProv } from '../src/lib/drivers';
import { bindOf, fwdOk, sensFor, worstShock, type FwdFile } from '../src/lib/forward';
import type { Prov } from '../src/lib/prov';

const F = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'capital', 'forward.json'), 'utf8')) as FwdFile;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const leaves = (p: Prov, d = 0): Prov[] => (d > 12 ? [] : p.k === 'calc' ? p.inputs.flatMap((x) => (x.src ? leaves(x.src(), d + 1) : [])) : [p]);
const pages = (p: Prov) => leaves(p).every((x) => x.k === 'none' || (x.k === 'report' && !!x.url && x.pg != null));

const cos = F.companies.filter(fwdOk);
ok(cos.length === 7, `seven insurers with a latest report (${cos.length})`);
ok(new Set(cos.map((c) => c.date)).size === 1, `one vintage for all (${[...new Set(cos.map((c) => c.date))]})`);
for (const c of cos) {
  ok(c.pub > c.date && c.url, `${c.id}: publication after the calculation date, file linked`);
  ok(sensFor(c, 'rate') && sensFor(c, 'equity'), `${c.id}: rate and equity sensitivities disclosed`);
  ok(c.sens.every((s) => pages(toProv(s.prov))), `${c.id}: sensitivities open to pages`);
  const W = c.ratio_walk!;
  ok(W && W.check < 0.05, `${c.id}: the ratio walk reaches the closing ratio`);
  const g = (k: string) => c.walk.find((x) => x.step === k);
  for (const m of ['of', 'scr', 'su'] as const) {
    const mid = ['operating', 'economic', 'new_business', 'capital_actions', 'tax_tiers'].reduce((t, k) => t + g(k)![m]!.v, 0);
    ok(Math.abs(g('open_wo')![m]!.v + mid - g("close_wo")![m]!.v) <= 2.5, `${c.id} walk ${m}: opening + movements = closing`);
    ok(Math.abs(g('close_wo')![m]!.v + g('transitional')![m]!.v - g("close")![m]!.v) <= 2.5, `${c.id} walk ${m}: + transitional = closing`);
  }
  for (const k of c.constraints) {
    ok(Math.abs(k.head.v - c.after.v - k.rem.v) < 0.5, `${c.id} ${k.id}: remaining = headroom − after-publication distributions`);
    ok(pages(toProv(k.rem.prov)) && pages(toProv(k.t_prov)), `${c.id} ${k.id}: capacity opens to pages`);
  }
  ok(c.constraints.every((k) => k.rem.v >= bindOf(c).rem.v), `${c.id}: binding is the lowest`);
  ok(c.constraints.some((k) => k.kind === 'reg' && k.t === 100 && k.basis === 'wo'), `${c.id}: the regulator's 100% without transitional measures, from the report`);
  const w = worstShock(c);
  if (w) {
    const sw = c.lines.scr_w.v, b = bindOf(c), s = c.sens.find((x) => x.l === w.l)!;
    ok(Math.abs(w.after[b.id] - (b.rem.v + s.v / 100 * sw)) < 0.5, `${c.id}: worst shock reproduces`);
  }
}
console.log(`forward: ${pass} passed, ${fail} failed`);
for (const b of bad.slice(0, 40)) console.log(`  FAIL ${b}`);
if (fail) process.exit(1);
