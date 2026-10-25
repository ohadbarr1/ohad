/* The stress lab reproduces every disclosed figure at its disclosed shock size, and never reads past the disclosed range without a tag.
   Run: npm run test:stress (bundles this file with esbuild and runs it in node against web/public/data). Exit code 1 on any failure. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SensRow } from '../src/lib/csmData';
import type { SolvFile } from '../src/lib/solvency';
import { applyLines, basisOf, evalLine, ifrsLines, solvLines, targetsAt, xOfSens, xOfSolv, ZERO, buildPreset, PRESETS, type CurveFile, type CatFile } from '../src/lib/stress';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }

// 1 · IFRS 17: every row with a stated direction, on its own company, effect line and basis
const sens = json<{ rows: SensRow[] }>('csm/sens.json').rows;
let nIfrs = 0, skippedIfrs = 0;
const coverage = new Map<string, Set<string>>();
for (const r of sens) {
  const x = xOfSens(r);
  if (x == null || !['rate', 'equity', 'mortality', 'morbidity', 'lapse'].includes(r.risk)) { skippedIfrs++; continue; }
  const lines = ifrsLines(sens, r.c, r.eff, r.b);
  const eff = applyLines(lines, { ...ZERO, [r.risk]: x });
  nIfrs++;
  ok(eff.v === r.v && !eff.extra && !eff.combo, `IFRS 17 ${r.c} ${r.risk} ${x} ${r.eff}/${r.b}: lab ${eff.v} vs printed ${r.v} (p.${r.pg})`);
  (coverage.get(r.c) ?? coverage.set(r.c, new Set()).get(r.c)!).add(r.risk);
}
// 2 · solvency ratio: every row whose wording names a shock the sliders carry
const S = json<SolvFile>('csm/solvency.json');
let nSolv = 0, otherSolv = 0;
for (const s of S.sens) {
  const x = xOfSolv(s);
  if (x == null) { if (['rate', 'equity', 'mortality', 'morbidity', 'lapse'].includes(s.risk)) ok(false, `solvency row unread: ${s.c} ${s.d} "${s.l}"`); else otherSolv++; continue; }
  const lines = solvLines(S.sens, s.c, s.d);
  const pts = lines.get(s.risk as 'rate')!;
  const same = S.sens.filter((y) => y.c === s.c && y.d === s.d && y.risk === s.risk && xOfSolv(y) === x);
  ok(new Set(same.map((y) => y.v)).size === 1, `solvency ${s.c} ${s.d} ${s.risk} ${x}: two different printed values for one shock`);
  const e = applyLines(lines, { ...ZERO, [s.risk]: x });
  nSolv++;
  ok(pts && e.v === s.v && !e.extra, `solvency ${s.c} ${s.d} ${s.risk} ${x}: lab ${e.v} vs printed ${s.v} (p.${s.pg})`);
}
// 3 · the line: interpolation inside, clamped and tagged outside, zero at zero
const L = [{ x: -50, v: -10, row: 0 }, { x: 50, v: 30, row: 0 }];
ok(evalLine(L, 25)!.v === 15 && !evalLine(L, 25)!.extra, 'interpolates between the origin and a disclosed point');
ok(evalLine(L, -25)!.v === -5, 'interpolates on the negative side');
const out = evalLine(L, 200)!; ok(out.v === 30 && out.extra && out.xe === 50, 'clamps beyond the disclosed range and tags it');
ok(evalLine(L, 0)!.v === 0, 'no shock, no effect');
const one = evalLine([{ x: -50, v: -14, row: 0 }], 50)!; ok(one.v === 0 && one.extra, 'one-sided disclosure: the other direction is outside the range');
const combo = applyLines(new Map([['rate', L], ['equity', [{ x: -10, v: -7, row: 0 }]]]) as never, { ...ZERO, rate: 50, equity: -10 });
ok(combo.v === 23 && combo.combo, 'shocks add with no diversification and are tagged');
// 4 · targets: basis read from the wording
ok(basisOf({ m: 'target_solvency_ratio_min_without_transitional', l: '' }) === 'wo', 'basis: without transitional');
ok(basisOf({ m: 'target_dividend_threshold_with_transitional', l: '' }) === 'w', 'basis: with transitional');
ok(targetsAt([{ m: 'target_dividend_threshold_with_transitional', d: '2025-09-30', v: 135 }, { m: 'target_solvency_ratio_minimum_end_2032', d: '2032-12-31', v: 135 }], '2025-12-31', 'w').div?.v === 135, 'targets: threshold in force, glide path left out');
// 5 · presets come from the macro files with their months
const curve = json<CurveFile>('macro/boi_curve.json'), cat = json<CatFile>('funds/cat.json');
for (const p of PRESETS) { const b = buildPreset(p, curve, cat); ok(b.r && b.e && b.sc.rate !== 0 && b.sc.equity !== 0, `preset ${p.id} built from the files (rate ${b.sc.rate} bp, equity ${b.sc.equity}%)`); }

const cov = [...coverage.entries()].map(([c, s]) => `${c}: ${[...s].join('/')}`).join(' · ');
console.log(`stress: ${nIfrs} IFRS 17 rows and ${nSolv} solvency rows reproduced at their disclosed size (${skippedIfrs} IFRS 17 rows with no stated direction, ${otherSolv} solvency rows on risks with no slider) · ${cov}`);
console.log(`stress: ${pass} passed, ${fail} failed`);
for (const b of bad) console.log(`  FAIL ${b}`);
if (fail) process.exit(1);
