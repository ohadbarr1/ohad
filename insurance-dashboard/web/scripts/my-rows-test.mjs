// Rollout T-M1 / T-M4 (spec 5.2, 16.1 5b/5e, 17.1 1b, 18.6): the figures of /my's product rows, on the live data of 10/26 (gross).
// Bundles the pure helpers of src/components/saver/MyProductRow.tsx (myRowFigures, myFeeCost) with esbuild (react kept external, css
// dropped) and checks the M3 fixture (p2102, g880, g8211): the six-month strip and its ringed month, the line against the type's average,
// the last year with its place (placeGroups; self-managed / IRA tracks not ranked, coordinator decision 2), the yearly fee in ₪ on the
// example and on 420,000 / 3,100 (= ₪1,170, the fees tool's and the card's figure through the same feeCost), the reader's own fee
// (5.5), the total line, and the household rule that removing a profile drops its fees-tool amounts (lib/household PER_PROFILE_KEYS).
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(web, '.myrowstest-'));
const data = (p) => JSON.parse(readFileSync(join(web, 'public/data', p), 'utf8'));
const strip = (s) => s.replace(/[⁦-⁩]/g, '');
try {
  const noCss = { name: 'no-css', setup(b) { b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'no-css' })); b.onLoad({ filter: /.*/, namespace: 'no-css' }, () => ({ contents: '', loader: 'css' })); } };
  writeFileSync(join(dir, 'e.ts'), [
    `export { myRowFigures, myFeeCost } from '${join(web, 'src/components/saver/MyProductRow')}';`,
    `export { typeMembers, typeHasDepositFee } from '${join(web, 'src/lib/pageMonths')}';`,
    `export { myWords, myYearLine, vsAvgWords, myFeeLine, myFeeSum, amountsBase, fullLabel } from '${join(web, 'src/lib/pageWords')}';`,
    `export { removeProfile, PER_PROFILE_KEYS } from '${join(web, 'src/lib/household')}';`,
    `export { catKey } from '${join(web, 'src/lib/funds')}';`,
  ].join('\n'));
  await build({ entryPoints: [join(dir, 'e.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'e.mjs'), logLevel: 'error', jsx: 'automatic', external: ['react', 'react-dom', 'react/*', 'react-dom/*', 'react-router-dom', 'echarts', 'echarts/*'], plugins: [noCss], define: { 'import.meta.env': JSON.stringify({ BASE_URL: '/', DEV: false, PROD: true, MODE: 'test' }) } });
  const A = await import(pathToFileURL(join(dir, 'e.mjs')).href);
  let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ' + name); };

  const file = data('funds.json'), cats = data('funds/cat.json'), asof = file.asof;
  assert.equal(asof, 202610, 'fixture month 10/26');
  const F = (k) => file.funds.find((f) => f.k === k);
  const row = (k) => { const f = F(k), key = A.catKey(f), mem = A.typeMembers(file.funds, key); return { f, mem, fig: A.myRowFigures(f, data(`funds/${k}.json`), mem, cats[key], asof) }; };
  const P = row('p2102'), G = row('g880'), H = row('g8211');

  t('strip: six months, oldest first, the newest last = the published October month', () => {
    for (const r of [P, G, H]) { assert.equal(r.fig.months.length, 6); assert.equal(r.fig.months[5].p, 202610); assert.equal(r.fig.p, 202610); }
    assert.deepEqual([P, G, H].map((r) => r.fig.v), [-1.44, -0.19, 0.01]);
    assert.equal(P.fig.months[0].p, 202605);
  });
  t('against the type average (cat.json, asset-weighted): 18.6 lines', () => {
    assert.equal(strip(A.vsAvgWords(P.fig.p, P.fig.v, P.fig.avg, P.fig.type)), 'באוקטובר: מתחת לממוצע בפנסיה כללי (−1.03%)');
    assert.equal(strip(A.vsAvgWords(G.fig.p, G.fig.v, G.fig.avg, G.fig.type)), 'באוקטובר: מעל הממוצע בהשתלמות כללי (−0.28%)');
    assert.equal(strip(A.vsAvgWords(H.fig.p, H.fig.v, H.fig.avg, H.fig.type)), 'באוקטובר: מעל הממוצע בגמל להשקעה כללי (−0.19%)');
  });
  t('last year and place (12 months, placeGroups; the IRA is not ranked: g880 of 12, not 13)', () => {
    assert.equal(strip(A.myYearLine(P.fig.y12, P.fig.place)), 'בשנה האחרונה: +9.2% · מקום 5 מתוך 5');
    assert.equal(strip(A.myYearLine(G.fig.y12, G.fig.place)), 'בשנה האחרונה: +9.2% · באמצע (5–6 מתוך 12)');
    assert.equal(strip(A.myYearLine(H.fig.y12, H.fig.place)), 'בשנה האחרונה: +8.9% · מקום 7 מתוך 11');
    // build review B2 (novice #3): 13 ranked on the month, 12 with a full year: the count says why
    assert.equal(G.fig.typeN, 13);
    assert.equal(strip(A.myYearLine(G.fig.y12, G.fig.place, G.fig.typeN)), 'בשנה האחרונה: +9.2% · באמצע (5–6 מתוך 12 שיש להם שנה מלאה)');
    assert.equal(strip(A.myYearLine(P.fig.y12, P.fig.place, P.fig.typeN)), 'בשנה האחרונה: +9.2% · מקום 5 מתוך 5');
  });
  t('the /my sentence of 18.6', () => {
    assert.equal(strip(A.myWords(asof, [P, G, H].map((r) => ({ m: r.f.m1, y: r.f.y12 })))), 'באוקטובר שניים מהמסלולים שלך ירדו ואחד כמעט לא זז. בשנה האחרונה כולם עלו: בין +8.9% ל-+9.2%.');
  });
  t('fees on the example: 560, 600, 550; total 1,710 "לדוגמה"', () => {
    const c = [P, G, H].map((r) => A.myFeeCost(r.f, null, null).cost);
    assert.deepEqual(c, [560, 600, 550]);
    assert.equal(strip(A.myFeeSum(c.map((cost) => ({ cost, own: false }))).text), 'דמי ניהול, לדוגמה: כ-1,710 ש״ח בשנה על כל 3 המוצרים');
    assert.deepEqual(A.myFeeLine(560, false, '').tag, 'לדוגמה');
  });
  t('18.6 acceptance: 420,000 / 3,100 on p2102 → ₪1,170 "על הסכומים שלך"; the others stay on the example; total 2,320 with 2 on the example', () => {
    const own = A.myFeeCost(P.f, null, { balance: 420000, monthly: 3100 }).cost;
    assert.equal(own, 1170);
    const base = A.amountsBase({ own: true, depositOwn: true, deposits: A.typeHasDepositFee(P.mem) });
    assert.equal(base, 'על הסכומים שלך');
    const s = A.myFeeSum([{ cost: own, own: true }, { cost: 600, own: false }, { cost: 550, own: false }]);
    assert.equal(strip(s.text), 'דמי ניהול: כ-2,320 ש״ח בשנה על כל 3 המוצרים');
    assert.equal(strip(s.sub), 'כולל 2 מוצרים על דוגמה של 100,000 ש״ח');
  });
  t('hishtalmut general charges no deposit fee: one field, "על היתרה שלך"', () => {
    assert.equal(A.typeHasDepositFee(G.mem), false);
    assert.equal(A.amountsBase({ own: true, depositOwn: false, deposits: false }), 'על היתרה שלך');
  });
  t('the reader\'s own fee (statement / clearing house, 5.5) prices the row', () => {
    const r = A.myFeeCost(P.f, { fee: 0.1, depfee: 1.0 }, { balance: 420000, monthly: 3100 });
    assert.equal(r.ownFee, true); assert.equal(r.cost, Math.round((0.001 * 420000 + 0.01 * 3100 * 12) / 10) * 10);
    assert.equal(A.myFeeCost(P.f, { fee: null }, null).ownFee, false);
  });
  t('a self-managed track: the guard line, no strip, no place', () => {
    const r = row('g1487');
    assert.equal(r.fig.months.length, 0); assert.ok(r.fig.guard && /בניהול אישי/.test(r.fig.guard)); assert.equal(r.fig.place, null);
  });
  t('labels: "מגדל · פנסיה כללי"', () => {
    assert.equal(A.fullLabel(P.f.grp, A.catKey(P.f)), 'מגדל · פנסיה כללי');
    assert.equal(A.fullLabel(G.f.grp, A.catKey(G.f)), 'מיטב · השתלמות כללי');
  });
  t('household: removing a profile drops its fees-tool amounts too', () => {
    assert.ok(A.PER_PROFILE_KEYS.includes('fees:amounts'));
    const r = A.removeProfile({ v: 1, active: 'spouse', list: ['me', 'spouse'] }, 'spouse');
    assert.ok(r.drop.includes('fees:amounts@spouse') && r.drop.includes('mine@spouse'));
  });
  console.log(`my rows: ${n} passed`);
} finally { rmSync(dir, { recursive: true, force: true }); }
