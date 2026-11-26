// Track compare F1 (lib/compareMonths.ts): month and year matrices, summary rows, row lead, heat scale. Bundles the module with esbuild
// (Vite's own copy) into a temp file, then checks hand-computed cases and the §10A.3 fixtures on the published data (P3 = p2102 מגדל,
// p2172 הראל, p2009 מנורה; pension general; data month 10/26, gross as published: owner 26.11.26, no net basis). Run: node scripts/compare-months-test.mjs
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'comparemonthstest-')), out = join(dir, 'compareMonths.mjs');
let M;
try {
  await build({ entryPoints: [new URL('../src/lib/compareMonths.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } });
  M = await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
const { monthRows, yearRows, yearsAvailable, cum, spreadOf, halfYear, lastYear, periodRow, rowBand, roundHalf, rowLead, rowMarks, heatScale, heatFill } = M;

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what) => { if (c) pass++; else { fail++; bad.push(what); } };
const near = (a, b, e = 1e-9) => a != null && Math.abs(a - b) < e;
const r1 = (v) => (v == null ? null : roundHalf(v, 1)), r2 = (v) => (v == null ? null : roundHalf(v, 2));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---- hand-computed ---- */
ok(near(cum([10, 10]), 21) && cum([]) === null && cum([1, null]) === null, 'cum compounds; empty or a gap is null');
ok(near(spreadOf([-0.73, null, -1.45]), 0.72) && spreadOf([1]) === null, 'spread = high − low, two values at least');
ok(roundHalf(8.85, 1) === 8.9 && roundHalf(-0.745, 2) === -0.75 && roundHalf(1.357, 1) === 1.4, 'half-up rounding, float-safe');
ok(rowBand('month') === 0.05 && rowBand('y12') === 0.1 && rowBand('year') === 0.1 && rowBand('half') === 0.1, 'bands: month 0.05, the rest 0.10');
ok(eq(rowLead([-1.45, -0.73, -0.74], 0.05), [1, 2]) && eq(rowLead([1, 0.95, 0.9], 0.05), [0]) && eq(rowLead([1, 0.96, 0.9], 0.05), [0, 1]), 'lead: inside the band of the max, the max included; exactly 5bp is out');
ok(eq(rowLead([0.04, 0.0, null], 0.05), [0, 1]) && eq(rowLead([null, null], 0.05), []), 'nulls are never in the lead');
ok(eq(rowLead([0.996, 0.954], 0.05, 2), [0]) && eq(rowLead([0.996, 0.954], 0.05), [0, 1]), 'dec: compares the displayed figures (1.00 vs 0.95 is a 5bp gap)');
ok(eq(rowMarks([1, 0.98, 0.97], 0.05), []) && eq(rowMarks([2], 0.05), []) && eq(rowMarks([1, 0.98, 0.5], 0.05), [0, 1]), 'marks: none when all tie or a single value');
ok(heatScale([1, -2, 3, 4, 5, 6, 7, 8, 9, -10]) === 10 && heatScale([]) === 1 && heatScale([null]) === 1, 'heat scale: value at floor(0.9n) of sorted |v|');
ok(heatScale(Array.from({ length: 20 }, (_, i) => i + 1)) === 19, 'heat scale: 20 values → the 19th');
const hf = heatFill(-5, 10), hu = heatFill(20, 10);
ok(hf.dir === 'down' && hf.a === 0.24 && hu.dir === 'up' && hu.a === 0.4 && heatFill(0, 10).dir === null && heatFill(null, 10).a === 0, 'heat fill: 0.07–0.40 by size, capped');

const H = (p, y, yn = y) => ({ p, y, yn, a: p.map(() => 1), fee: p.map(() => 0.1), st: [], fo: [], fx: [] });
const h1 = H([202511, 202512, 202601, 202602], [1, 2, 3, 4]), h2 = H([202601, 202602], [-1, null]);
const mr = monthRows([h1, h2, null], 'gross', 3, { asof: 202602 });
ok(mr.length === 3 && eq(mr.map((r) => r.p), [202602, 202601, 202512]), 'months newest first, across a year end');
ok(eq(mr[0].vals, [4, null, null]) && eq(mr[1].vals, [3, -1, null]) && eq(mr[2].vals, [2, null, null]), 'values by column; a missing month or history is null');
ok(mr[0].avg === null && mr[1].spread === 4, 'no cat: avg null; spread per row');
const yr = yearRows([h1, h2], 'gross', 2, { asof: 202602 });
ok(yr[0].yr === 2026 && yr[0].part && yr[0].months === 2 && near(yr[0].vals[0], (1.03 * 1.04 - 1) * 100) && yr[0].vals[1] === null, 'partial year: Jan–asof; a gap is null');
ok(yr[1].yr === 2025 && !yr[1].part && yr[1].vals[0] === null, 'a track without all twelve months of a year: null');
const hg = H([202601], [1.0], [0.9]);
ok(monthRows([hg], 'gross', 1)[0].vals[0] === 1.0, 'gross y is read (a stale net yn in the file is ignored); asof defaults to the newest month');
const hx = { p: [202601], y: [1.2], a: [1], fee: [1.2], st: [], fo: [], fx: [] };
ok(monthRows([hx], 'gross', 1)[0].vals[0] === 1.2, 'the fee is never subtracted from the month (owner 26.11.26)');

/* ---- fixtures: the published data ---- */
const D = new URL('../public/data/', import.meta.url).pathname;
const J = (f) => JSON.parse(readFileSync(join(D, f), 'utf8'));
const file = J('funds.json'), asof = file.asof;
const P3 = ['p2102', 'p2172', 'p2009'], fs = P3.map((k) => file.funds.find((f) => f.k === k)), hs = P3.map((k) => J(`funds/${k}.json`));
const cat = J('funds/cat.json')[`${fs[0].prod} | ${fs[0].track}`];
ok(asof === 202610, `fixtures are for 10/26 (funds.json asof ${asof})`);
const rows = monthRows(hs, 'gross', 6, { asof, cat });
ok(rows[0].p === 202610 && rows[5].p === 202605, 'six rows, October newest');
ok(eq(rows[0].vals.map(r2), [-1.44, -0.72, -0.73]) && eq(rows[0].vals, hs.map((h) => h.y[h.p.indexOf(202610)])), `P3 first row = the published MONTHLY_YIELD −1.44, −0.72, −0.73 (got ${rows[0].vals.map(r2)})`);
ok(near(rows[0].spread, 0.72, 0.006), `October spread 0.72 (got ${rows[0].spread?.toFixed(3)})`);
ok(rows[0].avg === cat.y[cat.p.indexOf(202610)] && rows[0].avgN === cat.n[cat.p.indexOf(202610)], `October category average from cat.json y, n tracks (got ${rows[0].avg}, ${rows[0].avgN})`);
ok(eq(rowMarks(rows[0].vals, rowBand('month'), 2), [1, 2]), 'row lead of October = Harel and Menora (−0.72, −0.73 inside 0.05)');
const half = halfYear(hs, 'gross', { asof, cat });
ok(eq(half.vals.map(r1), [1.4, 2.4, 2.4]), `half year +1.4, +2.4, +2.4 (got ${half.vals.map((v) => v.toFixed(3))})`);
ok(eq(rowMarks(half.vals, rowBand('half'), 1), [1, 2]), 'half year: Harel and Menora tie at the top, Migdal unmarked');
const ly = lastYear(fs, 'gross', { asof, cat });
ok(eq(ly.vals.map(r1), [9.2, 10.5, 10.2]), `last year +9.2, +10.5, +10.2 (got ${ly.vals})`);
ok(eq(ly.vals, fs.map((f) => f.y12)), 'last year is the published f.y12');
ok(eq(lastYear(fs, 'gross').vals, fs.map((f) => f.y12)), 'gross: the published f.y12');
ok(eq(rowMarks(ly.vals, rowBand('y12'), 1), [1]), 'last year: Harel alone (10.5 vs 10.2, outside 0.10)');
ok(ly.avg != null && Math.abs(ly.avg) < 30, `last year category average compounded from cat.json (${ly.avg?.toFixed(2)})`);
const p5 = periodRow(fs, 'gross', 'a5', { asof, cat });
ok(eq(p5.vals, fs.map((f) => f.a5)) && p5.avg != null, '5 years, a year: the published f.a5; avg annualised');
const yrs = yearRows(hs, 'gross', 5, { asof, cat }), y25 = yrs.find((r) => r.yr === 2025);
ok(yrs.length === 5 && yrs[0].yr === 2026 && yrs[0].part && yrs[0].months === 10 && yrs[0].last === 202610, 'years: 2026 to October first, five rows');
ok(y25 && eq(y25.vals.map(r1), [15.6, 14.5, 16.6]), `2025 = +15.6, +14.5, +16.6 (got ${y25?.vals.map((v) => v.toFixed(3))})`);
ok(eq(rowMarks(y25.vals, rowBand('year'), 1), [2]), '2025: Menora alone');
const all = yearsAvailable(hs, 'gross', { asof });
ok(all >= 12 && yearRows(hs, 'gross', 12, { asof }).every((r) => r.vals.every((v) => v != null)), `"עוד שנים ▾": twelve full years available (${all})`);
const sc = heatScale(rows.flatMap((r) => r.vals));
ok(sc > 1 && sc < 3, `heat scale of the six P3 months: ${sc}`);
const m60 = monthRows(hs, 'gross', 60, { asof, cat });
ok(m60.length === 60 && m60.every((r) => r.vals.every((v) => v != null)), '60 months ("עוד 6 חודשים ▾" up to 60), all published');

console.log(`compareMonths: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
