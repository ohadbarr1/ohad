// Track compare, the shell's pure helpers (lane L2-a): pages/compare/extremes.ts (worst / best month, largest drop over 5 years) and
// pages/compare/tracks.ts (column labels and colours). Bundles each module with esbuild into a temp file, then checks hand-computed cases
// and the published data (P3 = p2102 מגדל, p2172 הראל, p2009 מנורה; X2 = p2102 + p2142; data month 10/26, net).
// Run: node scripts/compare-shell-test.mjs
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'compareshelltest-'));
async function bundle(rel, name) {
  const out = join(dir, name);
  await build({ entryPoints: [new URL(rel, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
    define: { 'import.meta.env.BASE_URL': '"/"' } });
  return import(pathToFileURL(out).href);
}
let E, T;
try { E = await bundle('../src/pages/compare/extremes.ts', 'extremes.mjs'); T = await bundle('../src/pages/compare/tracks.ts', 'tracks.mjs'); }
finally { rmSync(dir, { recursive: true, force: true }); }
const { extremes } = E, { trackLabels, shortGrp, TRACK_VARS, trackColor } = T;

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what) => { if (c) pass++; else { fail++; bad.push(what); } };
const near = (a, b, e = 1e-9) => a != null && Math.abs(a - b) < e;
const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/* ---- extremes: hand-computed ---- */
{
  const p = [202601, 202602, 202603, 202604, 202605], y = [2, -10, 5, null, 1];
  const x = extremes(p, y, 202605, 60);
  ok(x.n === 4, 'a missing month is skipped and n counts the months used');
  ok(x.worst.v === -10 && x.worst.p === 202602 && x.best.v === 5 && x.best.p === 202603, 'worst and best month with their months');
  ok(near(x.mdd.v, -10) && x.mdd.p === 202602, 'largest drop: 102 → 91.8 = −10% at the trough month');
  const w = extremes(p, y, 202603, 2);
  ok(w.n === 2 && w.worst.p === 202602 && w.best.p === 202603, 'the window ends at asof and is n months long');
  ok(extremes([202601], [1], 202601).mdd === null, 'no fall: no drop');
  ok(extremes([], [], 202610).n === 0 && extremes([], [], 202610).worst === null, 'empty history');
  const z = extremes([202601, 202602, 202603], [-5, 2, -5], 202603);
  ok(near(z.mdd.v, ((0.95 * 1.02 * 0.95) - 1) * 100) && z.mdd.p === 202603, 'drop measured from the running peak (the base 100), trough in the last month');
}

/* ---- extremes on the published data: P3 net (yn), 60 months to 10/26 ---- */
const data = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const funds = data('funds.json'), asof = funds.asof;
const hist = (k) => data(`funds/${k}.json`);
{
  const g = hist('p2102'), x = extremes(g.p, g.yn ?? g.y, asof, 60);
  ok(x.n === 60, 'p2102: 60 months counted');
  ok(r(x.worst.v, 2) === -3.14, `p2102 worst month in 5 years −3.14% (spec 4.8), got ${x.worst && r(x.worst.v, 2)}`);
  const e = hist('p2142'), xe = extremes(e.p, e.yn ?? e.y, asof, 60);
  ok(r(xe.worst.v, 2) === -5.32, `p2142 worst month in 5 years −5.32% (spec 4.8), got ${xe.worst && r(xe.worst.v, 2)}`);
}

/* ---- labels and colours ---- */
const F = (k) => funds.funds.find((f) => f.k === k);
ok(shortGrp('מנורה מבטחים') === 'מנורה' && shortGrp('הראל') === 'הראל', 'short company name');
ok(JSON.stringify(trackLabels(['p2102', 'p2172', 'p2009'].map(F))) === JSON.stringify(['מגדל', 'הראל', 'מנורה']), 'P3 labels: company names');
ok(JSON.stringify(trackLabels(['p2102', 'p2142'].map(F))) === JSON.stringify(['מגדל כללי', 'מגדל מניות']), 'X2 labels: one company, two tracks');
const hh = trackLabels(['p2172', 'p2177'].map(F));
ok(hh[0] === 'הראל גילעד' && hh[1] === 'הראל מנוף', `two funds of one company in one category: ${hh.join(' / ')}`);
ok(JSON.stringify(trackLabels(['g7936', 'g8211', 'g8675'].map(F))) === JSON.stringify(['מגדל', 'הראל', 'מנורה']), 'G3 labels');
const om = trackLabels(['i17012', 'p2102'].map(F));
ok(om[0] === 'מגדל פוליסה ישנה' && om[1] === 'מגדל פנסיה', `one company, two products with the same track name: ${om.join(' / ')}`);
ok(trackLabels([null, F('p2102')])[0] === '' && trackLabels([null, F('p2102')])[1] === 'מגדל', 'a missing fund keeps its column');
ok(TRACK_VARS.join() === '--s1,--s2,--s4,--s6,--s7,--s8,--s9,--s11' && trackColor(0) === 'var(--s1)' && trackColor(8) === 'var(--s1)', 'colours: the mockup order of the site tokens, wrapping');

console.log(`compare-shell: ${pass} passed, ${fail} failed`);
if (fail) { console.log(bad.map((b) => '  FAIL ' + b).join('\n')); process.exit(1); }
