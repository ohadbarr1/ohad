// P6-2e (spec p6 §5.2, §14.1 G2/G4, §14.4 T-C6–T-C8; tester round 3 "same basis", P6): node test for the company depth lenses' pure rules,
// src/pages/company/lensLogic.ts. Run: node scripts/p6-lenses-test.mjs
// Part 1 runs on SYNTHETIC rows (marked). Part 2 runs on the COMMITTED data (public/data/targets.json, csm/solvency.json) behind a data-period
// guard: the Harel numbers are asserted only when the file carries the FY'25 actuals the lens was built on (targets.json `built` and Harel's
// 2026 threshold rows); otherwise only the structural checks run. The guard prints which mode ran.
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(web, 'public/data');
const tmp = mkdtempSync(join(tmpdir(), 'p6-lenses-'));
let n = 0, fails = 0;
const ok = (c, msg, got) => { n++; if (!c) { fails++; console.error(`FAIL ${msg}${got !== undefined ? `\n  got: ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`); } };
const eq = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), `${msg} (want ${JSON.stringify(want)})`, got);

let L;
try {
  const entry = join(tmp, 'entry.ts'), out = join(tmp, 'out.mjs');
  writeFileSync(entry, `export * from ${JSON.stringify(join(web, 'src/pages/company/lensLogic.ts'))};`);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  L = await import(pathToFileURL(out).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }

/* ---------- 1. synthetic ---------- */
eq(L.noDotZero('⁦561.0⁩ → ⁦692.0⁩ מיליוני ש"ח (⁦+23.4%⁩)'), '⁦561⁩ → ⁦692⁩ מיליוני ש"ח (⁦+23.4%⁩)', 'noDotZero: millions lose ".0", the percent keeps its decimal');
eq(L.noDotZero('−5.0 מיליוני ש"ח · 12.05 · 10.0%'), '−5 מיליוני ש"ח · 12.05 · 10.0%', 'noDotZero: 12.05 and 10.0% untouched');

eq(L.targetBasis({ m: 'target_solvency_ratio_dividend_threshold_with_tmtp', l: '' }), 'w', 'basis: with_tmtp');
eq(L.targetBasis({ m: 'target_solvency_ratio_dividend_threshold_without_tmtp', l: '' }), 'wo', 'basis: without_tmtp (not read as "with")');
eq(L.targetBasis({ m: 'target_dividend_threshold_without_transitional', l: '' }), 'wo', 'basis: without_transitional');
eq(L.targetBasis({ m: 'target_solvency_ratio', l: 'יעד יחס כושר פירעון, ללא הוראות מעבר' }), 'wo', 'basis: from the printed label');
eq(L.targetBasis({ m: 'target_solvency_ratio', l: 'יעד יחס כושר פירעון' }), '?', 'basis: unstated');

const both = { k: 'sr', v: 148, y: 2025, f: 'הבסיס לא צוין ביעד', in: [['יחס כושר פירעון, עם הוראות מעבר', 165, 'u', 33, "FY'25", null], ['יחס כושר פירעון, ללא הוראות מעבר', 148, 'u', 35, "FY'25", null]] };
const w = L.sameBasisActual({ m: 'x_with_tmtp', l: '' }, both);
eq([w.kind, w.v, w.input[3]], ['same', 165, 33], 'SYNTHETIC same basis: a with-TM threshold meets the with-TM ratio (165%, p. 33), never 148%');
const wo = L.sameBasisActual({ m: 'x_without_tmtp', l: '' }, both);
eq([wo.kind, wo.v], ['same', 148], 'SYNTHETIC same basis: a without-TM threshold meets 148%');
const onlyWo = { k: 'sr', v: 148, y: 2025, f: 'יחס כושר פירעון של חברת הביטוח, ללא הוראות מעבר, כפי שהודפס', in: [['יחס כושר פירעון', 148, 'u', 35, "FY'25", null]] };
const miss = L.sameBasisActual({ m: 'x_with_tmtp', l: '' }, onlyWo);
ok(miss.kind === 'missing' && /עם הוראות מעבר/.test(miss.why) && /אינו מושווה/.test(miss.why), 'SYNTHETIC missing basis: says so instead of comparing across bases', miss);
eq(L.sameBasisActual({ m: 'x_without_tmtp', l: '' }, onlyWo).kind, 'same', 'SYNTHETIC a bare label takes the basis its formula states');
const un = L.sameBasisActual({ m: 'target_solvency_ratio', l: 'יעד' }, both);
eq([un.kind, un.v], ['unstated', 148], 'SYNTHETIC unstated basis: the lower, labelled');
eq(L.sameBasisActual({ m: 'target_roe', l: '' }, { k: 'roe', v: 27.1, y: 2025, f: '', in: [] }).kind, 'asis', 'not a solvency target: as the data carries it');
eq(L.sameBasisActual({ m: 'target_roe', l: '' }, undefined), null, 'no actual: null');

eq(L.vsTarget(27.1, { m: 'target_roe', l: 'יעד תשואה להון', v: null, lo: 18, hi: 19 }), 'מעל היעד', 'vs: above a range');
eq(L.vsTarget(18.5, { m: 'target_roe', l: '', v: null, lo: 18, hi: 19 }), 'בטווח היעד', 'vs: inside a range');
eq(L.vsTarget(165, { m: 'target_solvency_ratio_dividend_threshold_with_tmtp', l: 'סף', v: 135, lo: null, hi: null }), 'מעל הסף', 'vs: a threshold reads "מעל הסף"');
eq(L.vsTarget(110, { m: 'target_solvency_ratio_minimum', l: '', v: 135, lo: null, hi: null }), 'מתחת לסף', 'vs: below a minimum');

const R = (o) => ({ c: 'x', m: 'm', l: 'l', e: 'הקבוצה', t: 'strategy', h: null, d: '2025-01-01', src: 'report', st: 'policy', st1: null, ...o });
const syn = [R({ m: 'a', h: 2026, st: 'open', d: '2026-12-31', st1: ['2026-03-01', 1, 2] }), R({ m: 'a', h: 2026, st: 'open', d: '2026-12-31', src: 'pres', st1: ['2026-11-23', 2, 3] }),
  R({ m: 'b', h: 2026, st: 'open', t: 'capital', st1: ['2026-03-25', 1, 9], act: { k: 'sr' } }), R({ m: 'c', h: 2026, st: 'open', act: { k: 'roe' } }), R({ m: 'd', h: 2028, st: 'open' }), R({ m: 'z', h: 2024, st: 'met' }),
  R({ m: 'p', d: '2021-02-28' }), R({ m: 'p', d: '2026-03-25' }), R({ m: 'p', e: 'חברת הביטוח', d: '2026-03-25' })];
eq(L.openYears(syn, 2026), [2026, 2028], 'SYNTHETIC open horizons from this year, nearest first; a scored year drops out');
const hr = L.horizonRows(syn, 2026);
eq(hr.map((t) => t.m), ['c', 'a', 'b'], 'SYNTHETIC one row per kind: strategy first (with an actual first), then capital');
eq(hr.find((t) => t.m === 'a').src, 'pres', 'SYNTHETIC the latest statement of a kind wins');
const pg = L.policyGroups(syn);
eq(pg.map((g) => [g[0].m, g[0].e, g.length, g[0].d]), [['p', 'הקבוצה', 2, '2026-03-25'], ['p', 'חברת הביטוח', 1, '2026-03-25']], 'SYNTHETIC policy: one group per kind and entity, newest first');

const sbr = L.solvencyByReport({ '2024-12-31': { sr_wo: { v: 149 }, sr_w: { v: 172 } }, '2025-06-30': { sr_wo: { v: 159 } }, '2025-12-31': { sr_wo: { v: 148 }, sr_w: { v: 165 } }, '2017-01-01': {} }, 8);
eq(sbr.map((r) => [r.d, r.dwo, r.dw]), [['2025-12-31', -11, null], ['2025-06-30', 10, null], ['2024-12-31', null, null]], 'SYNTHETIC solvency by report: newest first, change per basis, none across a gap');
eq([L.halfLabel('2026-06-30'), L.halfLabel('2025-12-31'), L.halfLabel('2025-09-30')], ["H1'26", "FY'25", "Q3'25"], 'halfLabel');
eq([L.bridgeBehind('2026Q2', '2026Q3'), L.bridgeBehind('2026Q3', '2026Q3'), L.bridgeBehind('2025Q3', '2025FY'), L.bridgeBehind('2026Q3', '')], [true, false, true, false], 'bridgeBehind');
eq(L.moneyScale([520000]), { div: 1000, unit: 'מיליארדי ש"ח' }, 'money: AUM in billions');
eq(L.moneyScale([null, 1900, 2100]), { div: 1, unit: 'מיליוני ש"ח' }, 'money: profit in millions');

/* ---------- 2. committed data ---------- */
const T = JSON.parse(readFileSync(join(data, 'targets.json'), 'utf8'));
const S = JSON.parse(readFileSync(join(data, 'csm/solvency.json'), 'utf8'));
const harel = T.rows.filter((t) => t.c === 'harel');
const thW = harel.find((t) => t.m === 'target_solvency_ratio_dividend_threshold_with_tmtp' && t.h === 2026);
const numeric = !!thW && thW.act?.y === 2025 && !!S.companies.harel?.['2026-06-30'];
console.log(`p6-lenses-test: data-period guard → ${numeric ? 'NUMERIC (Harel FY\'25 actuals, solvency H1\'26)' : 'STRUCTURAL only'}`);
// structural, every insurer: a solvency threshold with a stated basis is never compared with a ratio printed on the other basis
for (const t of T.rows.filter((x) => x.act?.k === 'sr')) {
  const r = L.sameBasisActual(t, t.act), b = L.targetBasis(t);
  if (b === '?') { ok(r.kind === 'unstated', `${t.c} ${t.m}: unstated basis labelled`, r); continue; }
  ok(r.kind === 'missing' || (r.kind === 'same' && r.basis === b && L.inputBasis(r.input[0], t.act.in.length === 1 ? t.act.f : '') === b), `${t.c} ${t.m}: compared on its own basis (${b})`, r);
}
for (const c of Object.keys(S.companies)) {
  const rows = L.solvencyByReport(S.companies[c], 8);
  ok(rows.length >= 1 && rows.every((r, i) => i === 0 || r.d < rows[i - 1].d), `${c}: solvency reports newest first`);
}
for (const c of [...new Set(T.rows.map((t) => t.c))]) {
  const pg2 = L.policyGroups(T.rows.filter((t) => t.c === c)), keys = pg2.map((g) => `${g[0].m}|${g[0].e}`);
  ok(new Set(keys).size === keys.length, `${c}: one policy row per kind and entity`);
}
if (numeric) {
  const r = L.sameBasisActual(thW, thW.act);
  eq([r.kind, r.v, r.input[3]], ['same', 165, 33], 'Harel: 135% (with TM) against 165% (with TM, FY\'25 p. 33), not 148% as before');
  const thWo = harel.find((t) => t.m === 'target_solvency_ratio_dividend_threshold_without_tmtp' && t.h === 2026);
  eq(L.sameBasisActual(thWo, thWo.act).v, 148, 'Harel: 118% (without TM) against 148%');
  const yrs = L.openYears(harel, 2026); eq(yrs[0], 2026, 'Harel: the table opens on 2026');
  const rows = L.horizonRows(harel, 2026);
  ok(rows.length >= 7, `Harel: ≥ 7 targets for 2026 (${rows.length})`);
  const ci = rows.find((t) => t.m === 'target_comprehensive_income'), roe = rows.find((t) => t.m === 'target_roe');
  eq([ci?.lo, ci?.hi, ci?.act?.v], [1900, 2100, 2954], 'Harel: comprehensive profit 1,900–2,100 against 2,954');
  eq([roe?.lo, roe?.hi, roe?.act?.v], [18, 19, 27.1], 'Harel: ROE 18–19% against 27.1%');
  const pol = L.policyGroups(harel);
  ok(pol.filter((g) => g.length > 1).length >= 3, 'Harel: ≥ 3 policies with history');
  const sr = L.solvencyByReport(S.companies.harel, 8);
  eq([sr[0].d, sr[0].wo, sr[0].w, sr[0].dwo], ['2026-06-30', 158, 172, 10], 'Harel: H1\'26 158% / 172%, +10 pts');
}

console.log(`p6-lenses-test: ${n - fails}/${n} passed`);
if (fails) process.exit(1);
