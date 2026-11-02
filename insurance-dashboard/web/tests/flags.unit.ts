/* W6 · the trust flags (lib/flags.ts) against the published funds.json: the intra-group migration rule re-derives in the browser's own
   terms, the exposure bounds match the pipeline (funds_lib.EXP_HI / EXP_LO), and the verified example holds: Menora's general pension
   track (p2009) shows a strongly negative 12-month accrual while the group's pension total is positive (09/26 data).
   Run: npm run -s test:flags (scripts/flags-test.mjs bundles this file with esbuild and runs it in node). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECK_HE, checksOf, EXP_HI, EXP_LO, implausible, MIG_HE, migOf, migProv } from '../src/lib/flags';
import type { FundX } from '../src/lib/funds';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }

/* ---- the bounds ---- */
ok(EXP_HI === 120 && EXP_LO === -20, 'the exposure bounds: above 120% or below −20% of assets');
ok(implausible(184.2) && implausible(-25) && !implausible(100) && !implausible(0) && !implausible(null), 'implausible: 184% yes, 100% no, missing no');
ok(checksOf({ chk: null, stock: 50, foreign: 131.4, fx: 71.6 } as never).join() === 'fo', 'without a build flag the same rule runs on the row: foreign only');
ok(checksOf({ chk: ['st'], stock: 50, foreign: 131.4, fx: 0 } as never).join() === 'st', 'the build flag wins when present');
ok(MIG_HE === 'נדידה בתוך הקבוצה' && CHECK_HE === 'לבדיקה מול המנהל', 'the two labels, as the methodology page names them');

/* ---- the rule, the same arithmetic as funds_lib.migration, run over the published file ---- */
const p = join(process.cwd(), 'public', 'data', 'funds.json');
if (!existsSync(p)) { ok(false, 'public/data/funds.json missing'); }
else {
  const F = JSON.parse(readFileSync(p, 'utf8')) as { asof: number; funds: FundX[]; mig_method?: string; exp_method?: string };
  const live = F.funds;
  ok(typeof F.mig_method === 'string' && F.mig_method.includes('נדידה') && typeof F.exp_method === 'string', 'funds.json prints both methods');
  const tot = new Map<string, { t: number; n: number }>();
  live.forEach((f) => { if (f.nd12 != null) { const k = `${f.grp}|${f.prod}`; const e = tot.get(k) ?? { t: 0, n: 0 }; e.t += f.nd12; e.n++; tot.set(k, e); } });
  const want = new Set<string>();
  live.forEach((f) => {
    if (f.nd12 == null || !(f.assets! > 0)) return;
    const e = tot.get(`${f.grp}|${f.prod}`)!;
    if (e.n < 2 || Math.abs(f.nd12) < 250 || Math.abs(f.nd12) < 0.01 * f.assets!) return;
    if ((f.nd12 < 0 && e.t > 0) || (f.nd12 > 0 && e.t < 0)) want.add(f.k);
  });
  const got = new Set(live.filter((f) => f.mig).map((f) => f.k));
  const miss = [...want].filter((k) => !got.has(k)), extra = [...got].filter((k) => !want.has(k));
  ok(!miss.length && !extra.length, `mig re-derives from the rows: ${miss.length} missing, ${extra.length} extra (${[...miss, ...extra].slice(0, 3).join(', ')})`);
  live.forEach((f) => { if (f.mig) { const e = tot.get(`${f.grp}|${f.prod}`)!; if (Math.abs(e.t - f.mig.grp) > 0.06 || e.n !== f.mig.n) ok(false, `${f.k}: mig.grp ${f.mig.grp} / n ${f.mig.n} vs ${e.t.toFixed(1)} / ${e.n}`); } });
  ok(live.every((f) => (f.chk ?? []).join() === checksOf({ ...f, chk: null } as never).join()), 'chk re-derives from st / fo / fx on every row');
  // the verified example (09/26): Menora general comprehensive pension, −₪10.2bn against a +₪5.2bn group pension total
  const m = live.find((f) => f.k === 'p2009');
  if (F.asof === 202609 && m) {
    ok(migOf(m) != null && (m.nd12 ?? 0) < -10000 && (m.mig?.grp ?? 0) > 5000, `p2009: flagged, nd12 ${m.nd12} against group ${m.mig?.grp}`);
    const pv = migProv(m as FundX & { mig: { grp: number; n: number } });
    ok(pv.k === 'calc' && pv.inputs.length === 2 && pv.title.includes(MIG_HE), 'the flag opens as a calculation with the track and the group as inputs');
    const alt = live.find((f) => f.k === 'g14862');
    ok(alt?.chk?.includes('fo') === true && (alt.fo ?? 0) > 180, `g14862 (Altshuler S&P hishtalmut): foreign ${alt?.fo}% marked for checking`);
  }
  console.log(`flags: ${live.filter((f) => f.mig).length} migration flags, ${live.filter((f) => f.chk).length} exposure checks over ${live.length} tracks (${F.asof})`);
}

console.log(`flags: ${pass} passed, ${fail} failed`);
for (const b of bad) console.log('FAIL', b);
process.exit(fail ? 1 : 0);
