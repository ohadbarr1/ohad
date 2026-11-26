// Track compare F4 (lib/feeExample.ts): the fee example in shekels, the "almost equal" ring and the fee sentence. Bundles the module
// with esbuild (Vite's own copy) into a temp file, then checks hand-computed cases and the §10A.3 fixtures on the published data
// (P3 = p2102 מגדל, p2172 הראל, p2009 מנורה; G3 = g7936 מגדל, g8211 הראל, g8675 מנורה). Run: node scripts/fee-example-test.mjs
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'feeexampletest-')), out = join(dir, 'feeExample.mjs');
let M;
try {
  await build({ entryPoints: [new URL('../src/lib/feeExample.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } });
  M = await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
const { FEE_TIE, feeCost, feeParts, feeLow, feeRing, feeSentence, feeTable, hasDeposit } = M;

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what) => { if (c) pass++; else { fail++; bad.push(what); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = (s) => s?.replace(/[⁦-⁩]/g, '');

/* ---- hand-computed ---- */
ok(FEE_TIE === 20, 'the tie is 20 ₪');
ok(hasDeposit('פנסיה מקיפה') && hasDeposit('השתלמות') && !hasDeposit('גמל להשקעה'), 'example deposit: pension and hishtalmut only');
const pp = feeParts({ prod: 'פנסיה מקיפה', fee: 0.14, depfee: 1.56 });
ok(pp.balance === 100000 && pp.monthly === 2220 && Math.abs(pp.acc - 140) < 1e-9 && Math.abs(pp.dep - 415.584) < 1e-9 && pp.total === 560, 'pension: 140 + 1.56% × 2,220 × 12 = 555.58 → 560');
ok(feeCost({ prod: 'השתלמות', fee: 0.5, depfee: 0 }) === 500 && feeCost({ prod: 'השתלמות', fee: 0.6, depfee: 1 }) === 740, 'hishtalmut: 1,200 ₪ a month (600 + 144 = 744 → 740)');
ok(feeCost({ prod: 'גמל להשקעה', fee: 0.55, depfee: null }) === 550 && feeCost({ prod: 'גמל להשקעה', fee: null, depfee: 0.1 }) === null, 'no deposit fee counts 0; no fee: null');
ok(feeParts({ prod: 'פנסיה מקיפה', fee: 0.14, depfee: 1.56 }, false).monthly === 0, 'without deposits: monthly 0');
ok(eq(feeLow([540, 550, 560]), [0, 1]) && eq(feeRing([540, 550, 560]), [0, 1]), '540/550/560: 540 and 550 ringed, 560 not (from the lowest, no chain)');
ok(eq(feeRing([560, 550, 610]), [0, 1]) && eq(feeRing([550, 550, 600]), [0, 1]), 'P3-like: the two cheapest ringed; equal costs share');
ok(eq(feeRing([550, 560, 565]), []) && eq(feeRing([550]), []) && eq(feeRing([550, null]), []), 'all inside the tie, or a single cost: no ring');
ok(eq(feeRing([500, 600, null]), [0]) && eq(feeLow([null, null]), []), 'one clear cheapest is ringed alone; nulls never');

/* ---- sentences (section 6.1) ---- */
const S = (xs) => plain(feeSentence(xs.map(([label, cost]) => ({ label, cost }))));
ok(S([['מגדל', 560], ['הראל', 550], ['מנורה', 610]]) === 'דמי ניהול: הכי נמוכים אצל הראל ומגדל, כ-550 ש״ח בשנה. מנורה: כ-610.', '6.1 "Fees, clear" (stage-2 wording): ' + S([['מגדל', 560], ['הראל', 550], ['מנורה', 610]]));
ok(S([['מגדל', 560], ['הראל', 550], ['מנורה', 565]]) === 'דמי ניהול: כמעט זהים, כ-550 ש״ח בשנה.', '6.1 "Fees, within 20 ₪"');
ok(S([['מגדל', 620], ['הראל', 550], ['מנורה', 590]]) === 'דמי ניהול: הכי נמוכים אצל הראל, כ-550 ש״ח בשנה. מנורה: כ-590. מגדל: כ-620.', 'one cheapest: ' + S([['מגדל', 620], ['הראל', 550], ['מנורה', 590]]));
ok(S([['א', 540], ['ב', 550], ['ג', 560]]) === 'דמי ניהול: הכי נמוכים אצל א וב, כ-540 ש״ח בשנה. ג: כ-560.', 'no chain in the sentence either');
ok(S([['א', 1240], ['ב', 1245], ['ג', 1300], ['ד', 1230]]) === 'דמי ניהול: הכי נמוכים אצל ד, א וב, כ-1,230 ש״ח בשנה. ג: כ-1,300.', 'three cheapest listed; thousands comma');
ok(S([['א', 550]]) === 'דמי ניהול: כ-550 ש״ח בשנה.' && feeSentence([{ label: 'א', cost: null }]) === null, 'one track; no costs: null');
ok(feeSentence([{ label: 'מגדל', cost: 560 }, { label: 'הראל', cost: 550 }]).includes('⁦550⁩'), 'figures in LRI…PDI');

/* ---- fixtures: the published data ---- */
const file = JSON.parse(readFileSync(new URL('../public/data/funds.json', import.meta.url), 'utf8'));
const F = (ks) => ks.map((k) => file.funds.find((f) => f.k === k));
const P3 = F(['p2102', 'p2172', 'p2009']), G3 = F(['g7936', 'g8211', 'g8675']);
const c3 = P3.map((f) => feeCost(f)), c3n = P3.map((f) => feeCost(f, false)), g3 = G3.map((f) => feeCost(f)), g3n = G3.map((f) => feeCost(f, false));
ok(eq(c3, [560, 550, 610]), `P3 with deposits 560, 550, 610 (got ${c3})`);
ok(eq(c3n, [140, 160, 150]), `P3 without deposits 140, 160, 150 (got ${c3n})`);
ok(eq(g3, [620, 550, 590]) && eq(g3n, g3), `G3 620, 550, 590, deposits make no difference (got ${g3})`);
ok(eq(feeRing(c3), [0, 1]) && eq(feeRing(c3n), [0, 2]) && eq(feeRing(g3), [1]), 'rings: P3 Migdal + Harel; without deposits Migdal + Menora (150 − 140 < 20); G3 Harel');
const lab = ['מגדל', 'הראל', 'מנורה'];
ok(plain(feeSentence(P3.map((f, i) => ({ label: lab[i], cost: feeCost(f) })))) === 'דמי ניהול: הכי נמוכים אצל הראל ומגדל, כ-550 ש״ח בשנה. מנורה: כ-610.', 'P3 sentence = coordinator wording');
ok(plain(feeSentence(P3.map((f, i) => ({ label: lab[i], cost: feeCost(f, false) })))) === 'דמי ניהול: הכי נמוכים אצל מגדל ומנורה, כ-140 ש״ח בשנה. הראל: כ-160.', 'P3 without deposits');
ok(!plain(feeSentence([{ label: 'א', cost: 100 }, { label: 'ב', cost: 110 }, { label: 'ג', cost: 200 }])).includes('הזולים'), 'no "הזולים" (no adjective on company names)');

/* ---- feeTable: the row and the sheet from one function (lane L2-b), with the reader's own fee (O9) ---- */
const T = feeTable(P3), Tn = feeTable(P3, false);
ok(eq(T.cols.map((c) => c.cost), [560, 550, 610]) && eq(T.ring, [0, 1]) && T.base === null && T.cols.every((c) => !c.own), 'feeTable P3 = feeCost + feeRing, example base');
ok(eq(Tn.cols.map((c) => c.cost), [140, 160, 150]) && eq(Tn.ring, [0, 2]), 'feeTable P3 without deposits');
// a seeded "mine" entry for Migdal with its own fees, balance and deposit
const mine = [{ k: 'p2102', fee: 0.1, depfee: 1.0, balance: 250000, monthly: 3000 }, { k: 'g1', fee: 9 }];
const To = feeTable(P3, true, mine);
// Migdal: 0.1% × 250,000 + 1.0% × 3,000 × 12 = 250 + 360 = 610; Harel: 0.16% × 250,000 + 1.47% × 36,000 = 400 + 529.2 = 929.2 → 930;
// Menora: 0.15% × 250,000 + 1.73% × 36,000 = 375 + 622.8 = 997.8 → 1,000
ok(eq(To.cols.map((c) => c.cost), [610, 930, 1000]) && eq(To.cols.map((c) => c.own), [true, false, false]) && eq(To.base, { balance: 250000, monthly: 3000 }), `own fee + the reader's base for all (got ${To.cols.map((c) => c.cost)})`);
ok(eq(feeTable(P3, false, mine).cols.map((c) => c.cost), [250, 400, 380]), 'own base without deposits: 250 / 400 / 375 → 380');
const Tf = feeTable(P3, true, [{ k: 'p2172', fee: 0.05 }]);
ok(eq(Tf.cols.map((c) => c.cost), [560, 440, 610]) && Tf.base === null && eq(Tf.cols.map((c) => c.own), [false, true, false]), 'own fee without a balance: the example base, Harel 0.05% × 100,000 + 1.47% × 26,640 = 441.6 → 440');
ok(feeTable(P3, true, [{ k: 'p2102', fee: null, balance: 1 }]).base === null && feeTable([null, P3[1]]).cols.length === 1, 'no own fee: no base; missing funds skipped');

console.log(`feeExample: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
