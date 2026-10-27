/* A10 · the Fragility Monitor library: the page's rules (lib/fragility.ts stateOf) give every state the builder wrote, a threshold change
   moves states the way the rule says, the file carries no composite, and the scenario-headroom signal equals what the A2 engine itself
   (lib/scenarios.ts runAll over its presets) computes for every insurer. Run: npm run test:fragility (bundled with esbuild, run in node
   against web/public/data); pipeline/gate.py runs it as `fragility_lib`. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverFile, LtsResolver } from '../src/lib/drivers';
import { makeCtx, ncRows, presets, runAll, type CatFile, type CurveFile, type MacroFile, type NowcastFile } from '../src/lib/scenarios';
import { SIG_ORDER, defaults, evaluate, isData, readParams, stateOf, type FragFile } from '../src/lib/fragility';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number | null | undefined, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const lts: LtsResolver = (j) => ({ k: 'none', title: j.title, why: 'test' });

const F = json<FragFile>('fragility.json');
const D = defaults(F);

// 1 · every segment's state follows the rule on its inputs; every cell is its worst segment; flags = the cells in watch / alert
for (const r of F.rows) for (const s of SIG_ORDER) {
  const c = r.sig[s];
  for (const [k, x] of Object.entries(c.segs)) if (isData(x!.st)) ok(x!.x && stateOf(s, x!.x, D) === x!.st, `${r.c} ${s} ${k}: rule gives ${x!.x ? stateOf(s, x!.x, D) : '?'} vs ${x!.st}`);
  if (isData(c.st)) ok(c.seg && c.segs[c.seg]?.st === c.st, `${r.c} ${s}: the cell is its driving segment`);
  else ok(!!c.why, `${r.c} ${s}: ${c.st} has a reason`);
}
const E = evaluate(F, D);
for (const [i, r] of F.rows.entries()) {
  ok(JSON.stringify(E[i].flags) === JSON.stringify(r.flags), `${r.c}: flags re-run (${JSON.stringify(E[i].flags)} vs ${JSON.stringify(r.flags)})`);
  for (const s of SIG_ORDER) ok(E[i].sig[s].st === r.sig[s].st, `${r.c} ${s}: re-run state`);
}

// 2 · the URL overrides: only known keys, a stricter threshold never adds a watch, a looser one never removes one
const { p: P0, changed } = readParams(F, new URLSearchParams('fee_watch=99&fee_alert=120&junk=3&cost_alert=abc'));
ok(changed.join() === 'fee_watch,fee_alert' && P0.cost_alert === D.cost_alert, `URL params read (${changed.join()})`);
ok(evaluate(F, P0).every((r) => r.sig.fee.st !== 'watch' && r.sig.fee.st !== 'alert'), 'fee thresholds at 99/120 bp: no fee flag');
const loose = evaluate(F, { ...D, solv_watch: 1000, scen_watch: 1000 });
ok(loose.every((r, i) => (!isData(F.rows[i].sig.solv.st) || r.sig.solv.st !== 'ok') && (!isData(F.rows[i].sig.scen.st) || r.sig.scen.st !== 'ok')), 'solvency and scenario at 1000 pp: every insurer with data is flagged');

// 3 · no composite anywhere: no score, rating, index, total, rank, overall, grade, points
const BAN = /^(score|scores|rating|ratings|composite|grade|index|total|overall|rank|fox_rating|fragility_score|points)$/i;
const keys = (o: unknown, out: string[] = []): string[] => { if (Array.isArray(o)) o.forEach((x) => keys(x, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); keys(v, out); } return out; };
ok(!keys(F).some((k) => BAN.test(k)), `no composite field (${keys(F).filter((k) => BAN.test(k)).join(', ')})`);

// 4 · the scenario headroom = the A2 engine: the same presets, and per insurer the lowest headroom over the board target
const reg = json<{ id: string; name_he: string }[]>('companies/index.json');
const nc = json<NowcastFile>('nowcast.json'), NC = ncRows(nc);
const files = reg.map((c) => [c, json<DriverFile>(`drivers/${c.id}.json`)] as const);
const ctx = files.map(([c, f]) => makeCtx(c.id, c.name_he, f, NC, lts));
const PR = presets(json<CurveFile>('macro/boi_curve.json'), json<CatFile>('funds/cat.json'), json<MacroFile>('macro/macro.json'), nc, files[0][1].meta.base.end);
const now = PR.find((p) => p.id === 'now')!;
const ncAt = { eq: now.sc.eq, y10: now.sc.y10 };
for (const p of F.presets) {
  const q = PR.find((x) => x.id === p.id);
  ok(q && q.ok === p.ok && q.sc.y10 === p.y10 && q.sc.eq === p.eq, `preset ${p.id}: y10 ${q?.sc.y10}/${p.y10}, eq ${q?.sc.eq}/${p.eq}, ok ${q?.ok}/${p.ok}`);
}
const heads = new Map<string, (number | null)[]>();
for (const p of PR.filter((x) => x.ok)) for (const r of runAll(ctx, p.sc, ncAt, 'clamp', lts)) {
  if (!heads.has(r.id)) heads.set(r.id, []);
  heads.get(r.id)!.push(r.head ? r.head.v : undefined as unknown as null);
}
let n4 = 0;
for (const r of F.rows) {
  const x = r.sig.scen.segs.all;
  if (!x || x.st === 'na') continue;
  const hs = heads.get(r.c) ?? [];
  if (x.x && x.x.hw != null) {
    n4++;
    const vals = hs.filter((v): v is number => v != null);
    ok(vals.length === hs.length && near(Math.min(...vals), x.x.hw as number, 1e-6), `${r.c}: worst-case headroom ${Math.min(...vals)} (A2) vs ${x.x.hw}`);
    ok(near(x.x.h0 as number, ctx.find((c) => c.id === r.c)!.f.nodes[ctx.find((c) => c.id === r.c)!.target!.ratio]!.v! - ctx.find((c) => c.id === r.c)!.target!.v), `${r.c}: base headroom`);
  } else ok(hs.some((v) => v == null || v === undefined), `${r.c}: no headroom here, and A2 has none under some preset (${x.why})`);
}
ok(n4 >= 2, `scenario headroom compared for ${n4} insurers`);

console.log(`fragility: ${F.rows.length} managers, ${n4} scenario headrooms checked against A2`);
console.log(`fragility: ${pass} passed, ${fail} failed`);
for (const b of bad.slice(0, 40)) console.log(`  FAIL ${b}`);
if (fail) process.exit(1);
