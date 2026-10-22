// Hand-computed cases for the roster arithmetic (src/lib/rosterCore.ts). Run: node scripts/roster-test.mjs
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../src/lib/rosterCore.ts', import.meta.url), 'utf8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const R = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let n = 0;
const ok = (name, f) => { f(); n++; console.log(`ok  ${name}`); };

ok('equal sets: no flag', () => assert.equal(R.rosterDiff(['a', 'b', 'c'], ['c', 'b', 'a']), null));
ok('new reporter and a missing one', () => assert.deepEqual(R.rosterDiff(['a', 'b', 'd'], ['a', 'b', 'c']), { in: ['d'], out: ['c'], same: ['a', 'b'] }));
ok('series starts (nobody a year earlier): no flag', () => assert.equal(R.rosterDiff(['a', 'b'], []), null));
ok('tooltip text', () => assert.equal(R.rosterText({ in: ['d'], out: ['c'], same: [] }, (x) => x.toUpperCase()), 'נכנסו: D · יצאו: C'));
// a peer median whose YoY is roster-driven: FY'25 {10, 20, 30, 100} vs FY'24 {10, 20, 30} -> 25 vs 20 (+25%); like-for-like 20 vs 20 (0%)
ok('median moves with the roster only', () => {
  assert.equal(R.median([10, 20, 30, 100]), 25);
  assert.equal(R.median([10, 20, 30]), 20);
  assert.equal(R.median([20, 10, 30]), 20);
});
ok('average', () => assert.equal(R.mean([10, 20, 30, 100]), 40));
ok('period -> regulator month', () => {
  assert.equal(R.monthOf('2026Q2'), 202606); assert.equal(R.monthOf('2025FY'), 202512); assert.equal(R.monthOf('2026H1'), 202606); assert.equal(R.monthOf('2025H2'), 202512); assert.equal(R.monthOf('2026Q1'), 202603);
});

// regulator files: group 0, 13 months; gemel family new in month 12 (0 -> 900, 31 funds), insurance 6,000 -> 12,000 with no entries
const months = Array.from({ length: 13 }, (_, i) => 202508 + (i < 5 ? i : 88 + i));  // 202508..202512, 202601..202608
const zero = Array(13).fill(0);
const file = {
  months, groups: ['איילון', 'מנורה'],
  series: {
    '0|gemel': { a: [...zero.slice(0, 12), 900], in3: { 12: 900 }, nin3: { 12: 31 }, out3: {}, in12: { 12: 900 }, nin12: { 12: 31 }, out12: {} },
    '0|insurance': { a: [6000, ...zero.slice(1, 12).map(() => 9000), 12000], in3: {}, nin3: {}, out3: {}, in12: {}, nin12: {}, out12: {} },
    // a track split: a new id with 5,000, the closed id held 4,990 -> net 10 of 50,000 = 0.02% -> not flagged
    '1|pension': { a: [45000, ...zero.slice(1, 12).map(() => 47000), 50000], in3: {}, nin3: {}, out3: {}, in12: { 12: 5000 }, nin12: { 12: 1 }, out12: { 12: 4990 } },
  },
  ev: [[0, 'gemel', 'קופה א', 202607, 0.7, 500], [0, 'gemel', 'קופה ב', 202608, 151.5, 400], [0, 'gemel', 'ישנה', 202401, 50, 60]],
};
ok('new family: flagged, like-for-like = (12,900 - 900) / 6,000 - 1 = 100%', () => {
  const f = R.fundRoster(file, 'איילון', 'all', 202608, 12);
  assert.equal(f.a0, 6000); assert.equal(f.a1, 12900); assert.equal(f.net, 900); assert.equal(f.nIn, 31);
  assert.equal(Math.round(f.lfl * 10) / 10, 100); assert.deepEqual(f.names, ['קופה א', 'קופה ב']); assert.equal(f.m0, 202508);
});
ok('the family alone: started inside the window, no like-for-like', () => {
  const f = R.fundRoster(file, 'איילון', 'gemel', 202608, 12);
  assert.equal(f.fresh, true); assert.equal(f.lfl, null);
});
ok('insurance alone: no entries -> no flag', () => assert.equal(R.fundRoster(file, 'איילון', 'insurance', 202608, 12), null));
ok('track split offsets itself -> no flag', () => assert.equal(R.fundRoster(file, 'מנורה', 'all', 202608, 12), null));
ok('unknown group / window before the files -> null', () => {
  assert.equal(R.fundRoster(file, 'אין', 'all', 202608, 12), null); assert.equal(R.fundRoster(file, 'איילון', 'all', 202512, 12), null);
});
console.log(`${n} roster cases passed`);
