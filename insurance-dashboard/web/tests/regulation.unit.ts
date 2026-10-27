/* A8 · the Regulatory Impact Simulator reproduces drivers.ts: every product shock in regulation/impact.json, propagated through the
   company's A1 driver file with web/src/lib/drivers.ts, gives the file's ΔAUM, Δrevenue, Δvariable cost and Δpre-tax profit; the after-tax
   figure is propagate()'s Δnet profit; the exposure is Σ weight × impact; every figure's provenance opens. Run: npm run test:regulation. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { propagate, type DriverFile } from '../src/lib/drivers';
import { BANDS, exposureProv, impactProv, type RegFile } from '../src/lib/regulation';
import type { Prov } from '../src/lib/prov';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number | null | undefined, tol = 1e-3) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const R = json<RegFile>('regulation/impact.json');
const files = new Map<string, DriverFile>();
const drv = (c: string) => { if (!files.has(c)) files.set(c, json<DriverFile>(`drivers/${c}.json`)); return files.get(c)!; };
let nShock = 0, leaves = 0;
const sum = (xs: number[]) => xs.reduce((t, v) => t + v, 0);

for (const ini of R.initiatives) {
  ok(ini.sources.length > 0 && ini.sources.every((s) => /^https:\/\/([a-z0-9.-]+\.)?gov\.il\//.test(s.url) && /^\d{4}-\d\d-\d\d$/.test(s.retrieved)), `${ini.id}: public source with a retrieval date`);
  ok(ini.w === R.meta.weights[ini.status], `${ini.id}: weight = the status weight`);
  if (ini.model.kind === 'none') { ok(ini.impacts.length === 0 && !!ini.model.why, `${ini.id}: not modelled, with a reason`); continue; }
  ok(ini.impacts.length > 0, `${ini.id}: impacts`);
  for (const x of ini.impacts) {
    const f = drv(x.c), m = R.managers[x.c];
    ok(!!m, `${ini.id} ${x.c}: manager inputs`);
    for (const b of BANDS) {
      let net = 0;
      for (const p of x.products) {
        const prod = f.products.find((q) => q.s === p.s)!;
        ok(!!prod, `${ini.id} ${x.c} ${p.s}: product in the driver file`);
        const r = propagate({ ...f, products: [prod] }, p.shock[b]);
        const part = (id: string) => r.parts.find((q) => q.id === id)?.d ?? 0;
        const dA = part(`aum.${p.s}`), dRev = part(`rev.${p.s}`), dOpex = part(`opex.${p.s}`);
        ok(near(dA, p.d[b].dA), `${ini.id} ${x.c} ${p.s} ${b}: ΔAUM ${p.d[b].dA} vs drivers.ts ${dA}`);
        ok(near(dRev, p.d[b].dRev), `${ini.id} ${x.c} ${p.s} ${b}: Δrevenue ${p.d[b].dRev} vs drivers.ts ${dRev}`);
        ok(near(dOpex, p.d[b].dVar), `${ini.id} ${x.c} ${p.s} ${b}: Δvariable cost ${p.d[b].dVar} vs drivers.ts ${dOpex}`);
        ok(near(dRev - dOpex, p.d[b].dOp), `${ini.id} ${x.c} ${p.s} ${b}: Δpre-tax ${p.d[b].dOp} vs drivers.ts ${dRev - dOpex}`);
        net += r.out.net_profit.d ?? NaN;
        nShock++;
      }
      ok(near(net, x.net[b]), `${ini.id} ${x.c} ${b}: Δnet ${x.net[b]} vs drivers.ts ${net}`);
      ok(near(sum(x.products.map((p) => p.d[b].dOp)), x.d[b]), `${ini.id} ${x.c} ${b}: products add up`);
      ok([x.d[b], x.net[b], x.aum[b], x.rev[b]].every(Number.isFinite), `${ini.id} ${x.c} ${b}: finite`);
    }
  }
  if (ini.model.kind === 'default') for (const b of BANDS) ok(Math.abs(sum(ini.impacts.flatMap((x) => x.products.map((p) => p.net_flow?.[b] ?? 0)))) < 0.05, `${ini.id} ${b}: the redistribution sums to zero`);
}

// the exposure: Σ weight × impact; ranked from the most exposed
const imp = new Map(R.initiatives.flatMap((i) => i.impacts.map((x) => [`${i.id}|${x.c}`, x] as const)));
for (const e of R.exposure) for (const b of BANDS) ok(near(sum(e.by.map((t) => t.w * imp.get(`${t.id}|${e.c}`)!.d[b])), e.d[b]), `exposure ${e.c} ${b}: Σ weight × impact`);
ok(R.exposure.every((e, i, a) => i === 0 || a[i - 1].d.central <= e.d.central), 'exposure ranked from the most exposed');

// every figure's provenance opens down to its leaves
const lts = () => ({ k: 'none', title: 'lts', why: 'test' }) as Prov;
const walk = (p: Prov, depth = 0) => { if (depth > 14) return; if (p.k !== 'calc') { leaves++; return; } for (const x of p.inputs) if (x.src) walk(x.src(), depth + 1); };
for (const ini of R.initiatives) for (const x of ini.impacts) for (const b of BANDS) { walk(impactProv(ini, R.managers[x.c], x, b, lts, true)); }
for (const e of R.exposure) walk(exposureProv(R, e, 'central', lts));

console.log(`regulation: ${R.initiatives.length} initiatives, ${nShock} product shocks re-propagated through drivers.ts, ${leaves} provenance leaves opened`);
console.log(`regulation: ${pass} passed, ${fail} failed`);
for (const b of bad.slice(0, 40)) console.log(`  FAIL ${b}`);
if (fail) process.exit(1);
