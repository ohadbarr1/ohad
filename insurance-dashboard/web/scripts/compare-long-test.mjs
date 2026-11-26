// C8 · node test for src/lib/compareLong.ts ("לאורך זמן"): the period changes the figures (regression "1Y changes nothing"), places and ties
// on the period's band, the category-average tick source, the chart window and the readout line. Fixtures: P3 = p2102, p2172, p2009 at 10/26
// (gross, as published: owner 26.11.26, no net basis), read from public/data. Run: node scripts/compare-long-test.mjs
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'comparelongtest-')), out = join(dir, 'compareLong.mjs');
let L;
try {
  await build({ entryPoints: [new URL('../src/lib/compareLong.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } });
  L = await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
const data = (p) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'));
const F = data('funds.json'), CAT = data('funds/cat.json'), ASOF = F.asof;
const fx = (k) => F.funds.find((f) => f.k === k);
const P3 = ['p2102', 'p2172', 'p2009'].map(fx), cat = CAT['פנסיה מקיפה | כללי'];
let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); } catch (e) { fail++; console.error(`FAIL ${name}\n  ${e.message}`); } };
const r1 = (v) => (v == null ? null : Number(v.toFixed(1)));

t('asof is 10/26', () => assert.equal(ASOF, 202610));
t('figures: LTM 9.2, 10.5, 10.2 (the published y12)', () => { const v = L.periodFigures(P3, 'gross', 'y12', ASOF, cat).vals; assert.deepEqual(v, P3.map((f) => f.y12)); assert.deepEqual(v.map(r1), [9.2, 10.5, 10.2]); });
t('figures: 5Y 8.79, 8.29, 9.02 (the published a5)', () => assert.deepEqual(L.periodFigures(P3, 'gross', 'a5', ASOF, cat).vals, [8.79, 8.29, 9.02]));
t('figures: YTD 6.5, 8.1, 7.3 (the published ytd)', () => assert.deepEqual(L.periodFigures(P3, 'gross', 'ytd', ASOF, cat).vals.map(r1), [6.5, 8.1, 7.3]));
t('REGRESSION: every period gives different figures, rows and category average', () => {
  const f = ['y12', 'a3', 'a5'].map((p) => L.periodFigures(P3, 'gross', p, ASOF, cat));
  assert.notDeepEqual(f[0].vals, f[1].vals); assert.notDeepEqual(f[1].vals, f[2].vals); assert.notDeepEqual(f[0].vals, f[2].vals);
  assert.ok(new Set(f.map((x) => r1(x.avg))).size === 3, `avg ${f.map((x) => x.avg)}`);
  assert.ok(f.every((x) => x.avg != null));
});
t('category average: LTM and 5Y exist and are plausible (between the min and max of 5Y tracks +- 2)', () => {
  const a = L.periodFigures(P3, 'gross', 'a5', ASOF, cat).avg; assert.ok(a > 5 && a < 12, String(a));
});
t('count of tracks in the average', () => assert.ok(L.catCount(cat, 'gross', ASOF) >= 3));
t('the category average is compounded from the gross cat.json y (no net series)', () => { const c = { ...cat, yn: cat.y.map(() => 0) }; assert.equal(L.periodFigures(P3, 'gross', 'a5', ASOF, c).avg, L.periodFigures(P3, 'gross', 'a5', ASOF, cat).avg); });

const rowsOf = (per) => { const v = L.periodFigures(P3, 'gross', per, ASOF, cat).vals; return L.boardRows(P3.map((f, i) => ({ k: f.k, label: f.grp, value: v[i] })), per, ASOF, false); };
t('LTM: Harel first (10.5), Menora second (10.2), Migdal third; Harel/Menora gap 0.3 > band: clean places 1,2,3', () => {
  const r = rowsOf('y12'); assert.deepEqual(r.map((x) => x.label), ['הראל', 'מנורה מבטחים', 'מגדל']); assert.deepEqual(r.map((x) => x.place), ['1', '2', '3']); assert.ok(r.every((x) => !x.tie));
});
t('5Y: Menora, Migdal, Harel; the sort follows the figure', () => {
  const r = rowsOf('a5'); assert.deepEqual(r.map((x) => x.label), ['מנורה מבטחים', 'מגדל', 'הראל']);
});
t('ties share a place and read "2–3"', () => {
  const r = L.boardRows([{ k: 'a', label: 'A', value: 9.0 }, { k: 'b', label: 'B', value: 8.0 }, { k: 'c', label: 'C', value: 7.95 }], 'a5', ASOF, false);
  assert.deepEqual(r.map((x) => x.place), ['1', '2–3', '2–3']); assert.deepEqual(r.map((x) => x.tie), [false, true, true]);
});
t('a missing figure goes last and has no place', () => {
  const r = L.boardRows([{ k: 'a', label: 'A', value: null }, { k: 'b', label: 'B', value: 1 }, { k: 'c', label: 'C', value: 2 }], 'y12', ASOF, false);
  assert.deepEqual(r.map((x) => x.k), ['c', 'b', 'a']); assert.equal(r[2].place, null);
});
t('different risk levels: order kept, no places, no ties', () => {
  const r = L.boardRows([{ k: 'a', label: 'A', value: 1 }, { k: 'b', label: 'B', value: 9 }], 'a5', ASOF, true);
  assert.deepEqual(r.map((x) => x.k), ['a', 'b']); assert.ok(r.every((x) => x.place == null && !x.tie));
});
t('YTD band is pro rata (10 months: 0.083), so 0.05 apart is a tie', () => {
  const r = L.boardRows([{ k: 'a', label: 'A', value: 7.0 }, { k: 'b', label: 'B', value: 6.95 }], 'ytd', ASOF, false); assert.ok(r[0].tie && r[1].tie);
});

t('persOf / perFrom: saver has three words, others four; YTD is not a saver period; default 5Y', () => {
  assert.deepEqual(L.persOf(true).map((x) => x[1]), ['שנה אחרונה', '3 שנים', '5 שנים']); assert.equal(L.persOf(false).length, 4);
  assert.equal(L.perFrom('ytd', true), 'a5'); assert.equal(L.perFrom('ytd', false), 'ytd'); assert.equal(L.perFrom(null, true), 'a5'); assert.equal(L.perFrom('y12', true), 'y12');
});
t('windows: 12 / 36 / 60 / YTD = months of the year; axis has the base month', () => {
  assert.deepEqual(['y12', 'a3', 'a5', 'ytd'].map((p) => L.windowMonths(p, ASOF)), [12, 36, 60, 10]);
  const a = L.windowAxis('y12', ASOF); assert.equal(a.length, 13); assert.equal(a[0], 202510); assert.equal(a[12], 202610);
  const y = L.windowAxis('ytd', ASOF); assert.equal(y[0], 202512); assert.equal(y.length, 11);
});

const H = (k) => data(`funds/${k}.json`);
t('chart: growth of 100 starts at 100; the window changes the end value; drawdown is <= 0 and starts at 0', () => {
  const h = H('p2102'), s = ['y12', 'a3', 'a5'].map((p) => L.chartSeries(L.windowAxis(p, ASOF), h, 'gross', 'g'));
  assert.ok(s.every((x) => x[0] === 100)); assert.equal(new Set(s.map((x) => x[x.length - 1])).size, 3); assert.equal(s[0].length, 13);
  const d = L.chartSeries(L.windowAxis('a5', ASOF), h, 'gross', 'd'); assert.equal(d[0], 0); assert.ok(d.every((v) => v == null || v <= 0));
});
t('chart end value matches the published LTM (gross, 12m)', () => {
  const h = H('p2102'), s = L.chartSeries(L.windowAxis('y12', ASOF), h, 'gross', 'g'), pub = P3[0].y12;
  assert.ok(Math.abs(s[12] - 100 - pub) < 0.02, `${s[12]} vs ${pub}`);
});
t('readout lines', () => {
  const a = L.windowAxis('a5', ASOF), ym = (p) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
  assert.equal(L.readoutTitle('g', a, 60, ym), '100 ש״ח שהושקעו בסוף 10/21 שווים היום:');
  assert.equal(L.readoutTitle('g', a, 30, ym), '100 ש״ח מסוף 10/21, בסוף 04/24:');
  assert.equal(L.readoutTitle('d', a, 30, ym), 'המרחק מהשיא, 04/24:');
});
t('riskOf: worst month in the last 60 and the deepest fall', () => {
  const r = L.riskOf(H('p2102'), 'gross', ASOF); assert.ok(r.worst < 0 && r.dd <= r.worst && r.worstP > 202100);
});
t('labels: company; the same company twice gets its track', () => {
  assert.deepEqual(L.labelsOf(P3).map((x) => x), ['מגדל', 'הראל', 'מנורה']);
  const two = ['p2102', 'p2142'].map(fx); const l = L.labelsOf(two); assert.ok(l[0] !== l[1] && l.every((x) => x.startsWith('מגדל')), l.join('|'));
});
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
