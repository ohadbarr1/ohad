// F2 · node test for src/lib/compareWords.ts (npm run test:comparewords is not wired; run: node scripts/compare-words-test.mjs).
// Bundles the module with esbuild (Vite's own copy) into a temp file and checks every sentence of spec 6.1 (as amended by 4.0 rows 12–13
// and 4.0b row 7) on the acceptance fixtures P3 = p2102,p2172,p2009 · X2 = p2102,p2142 · G3 = g7936,g8211,g8675, data month 10/26, net.
// Fixture numbers are copied from public/data/funds.json (net.y12/a3/a5/ytd, st) and public/data/funds/<k>.json (yn, the monthly net
// series; worst month = min of the last 60), funds/cat.json (yn, nn) at asof 202610. Cases that no fixture reaches are marked SYNTHETIC.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'comparewordstest-')), out = join(dir, 'compareWords.mjs');
let W;
try {
  await build({ entryPoints: [new URL('../src/lib/compareWords.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  W = await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }

const ASOF = 202610;
// the rendered text: LRI…PDI dropped (NumText turns them into <bdi dir="ltr">)
const plain = (s) => s.replace(/[⁦⁩]/g, '');
let n = 0, fail = 0;
function eq(got, want, name) {
  n++;
  try { assert.equal(plain(got), want); }
  catch { fail++; console.error(`FAIL ${name}\n  got:  ${plain(got)}\n  want: ${want}`); }
}
const cols = (labels, vals) => labels.map((label, i) => ({ label, v: vals[i] }));

/* ---- fixtures ---- */
const P3 = ['מגדל', 'הראל', 'מנורה'];                     // p2102, p2172, p2009 (הראל = גילעד)
const P3m = { 202610: [-1.452, -0.733, -0.742], 202609: [0.548, 0.847, 0.538], 202607: [0.158, -0.923, -0.052] };
const P3net = { y12: [9.0, 10.31, 9.99], a3: [13.02, 12.71, 13.8], a5: [8.6, 8.1, 8.85], ytd: [6.38, 7.98, 7.12] };
const X2 = ['מגדל כללי', 'מגדל מניות'];                   // p2102, p2142
const X2risk = [{ label: 'מגדל כללי', worst: -3.137, worstP: 202209, equity: 50.6 }, { label: 'מגדל מניות', worst: -5.317, worstP: 202209, equity: 73.1 }];
const X2m = [-1.452, -2.322], X2y12 = [9.0, 10.28];
const G3 = ['מגדל', 'הראל', 'מנורה'];                     // g7936, g8211, g8675
const G3m = { 202610: [-0.302, -0.036, -0.509], 202609: [-0.022, -0.336, 0.081] };
const G3net = { y12: [8.37, 8.3, 8.84], a3: [13.21, 13.93, 13.2], a5: [6.67, 7.08, 6.6] };

/* ---- 6.1 rows 1–4 + 4.0 row 12: the month sentence (#month-insight) ---- */
eq(W.monthInsight({ p: 202610, row: cols(P3, P3m[202610]), lastYear: cols(P3, P3net.y12) }),
  'באוקטובר כולם ירדו: הראל ומנורה הכי פחות, מגדל הכי הרבה. הכי הרבה בשנה האחרונה: הראל, +10.3%.', 'P3 Oct, all fell + last year (C3 fixture)');
eq(W.rowWords(202609, cols(P3, P3m[202609])), 'בספטמבר כולם עלו: הראל הכי הרבה, מגדל ומנורה הכי פחות.', 'P3 Sep, all rose, tie at the low end');
eq(W.rowWords(202607, cols(P3, P3m[202607])), 'ביולי חלק עלו וחלק ירדו. הכי גבוה: מגדל, הכי נמוך: הראל.', 'P3 Jul, mixed');
eq(W.monthInsight({ p: 202610, row: cols(G3, G3m[202610]), lastYear: cols(G3, G3net.y12) }),
  'באוקטובר כולם ירדו: הראל הכי פחות, מנורה הכי הרבה. הכי הרבה בשנה האחרונה: מנורה, +8.8%.', 'G3 Oct + last year (4.0 row 12)');
eq(W.rowWords(202609, cols(G3, G3m[202609])), 'בספטמבר חלק עלו וחלק ירדו. הכי גבוה: מנורה, הכי נמוך: הראל.', 'G3 Sep, mixed');
// SYNTHETIC: every track inside the 0.05 band
eq(W.rowWords(202610, cols(P3, [-0.73, -0.74, -0.76])), 'באוקטובר כולם ירדו, כמעט באותה מידה.', 'all inside the month band');
eq(W.rowWords(202610, cols(P3, [0.02, -0.01, 0.0])), 'באוקטובר כולם כמעט ללא שינוי.', 'all inside the band around zero (SYNTHETIC)');
// the band: −0.73 vs −0.74 is a tie (O4), −0.73 vs −0.80 is not
eq(W.rowWords(202610, cols(['הראל', 'מנורה', 'מגדל'], [-0.73, -0.80, -1.45])), 'באוקטובר כולם ירדו: הראל הכי פחות, מגדל הכי הרבה.', 'outside the band: one top (SYNTHETIC)');
// two tracks
eq(W.rowWords(202610, cols(X2, X2m)), 'באוקטובר שניהם ירדו: מגדל כללי פחות, מגדל מניות יותר.', 'two tracks, both fell');
eq(W.rowWords(202607, cols(['מגדל', 'הראל'], [0.158, -0.923])), 'ביולי עלה המסלול של מגדל וירד המסלול של הראל.', 'two tracks, mixed (P3 data)');
// years view (r=y): the partial year and a full one, band 0.10, no last-year clause
eq(W.monthInsight({ p: 2026, row: cols(P3, [6.38, 7.98, 7.12]), lastYear: cols(P3, P3net.y12), asof: ASOF }),
  'מתחילת 2026 כולם עלו: הראל הכי הרבה, מגדל הכי פחות.', 'years view, partial current year');
// last-year clause: tie and all-negative
eq(W.lastYearWords(cols(['הראל גילעד', 'הראל מנוף', 'מנורה'], [10.31, 10.24, 10.30])), 'בשנה האחרונה הם כמעט שווים.', 'last year, all tied (SYNTHETIC)');
eq(W.lastYearWords(cols(P3, [-1.2, -1.5, -2.0])), 'בשנה האחרונה כולם ירדו. הכי פחות: מגדל, −1.2%.', 'last year, all negative (SYNTHETIC)');

/* ---- 6.1 row 9 + 4.0b row 7: different risk levels (X2) ---- */
eq(W.monthInsight({ p: 202610, row: cols(X2, X2m), lastYear: cols(X2, X2y12), cross: true }), 'יותר מניות: עולה ויורד חזק יותר.', 'X2 banner');
eq(W.RISK_MORE, 'עוד ›', 'banner link');
eq(W.riskWords(X2risk), 'מסלול עם יותר מניות עולה ויורד חזק יותר. החודש הכי גרוע ב-5 שנים: מגדל מניות −5.32%, מגדל כללי −3.14%. לכן כאן לא מסמנים מי הגבוה.', 'X2 6.1 row 9');
eq(W.riskLongWords(X2risk.map((c) => c.equity)), 'מסלול עם יותר מניות עולה ויורד חזק יותר (כאן: 51% מול 73% מניות). המספרים מוצגים זה לצד זה, בלי ״מקום ראשון״.', 'X2 long view');
eq(W.RISK_NOTE_TITLE, 'למה אין כאן ״מי הגבוה״?', 'risk sheet title');
const facts = W.riskNoteFacts(X2risk);
eq(facts[1], 'החודש הכי גרוע ב-5 שנים: מגדל מניות −5.32% (ספט׳ 22), מגדל כללי −3.14% (ספט׳ 22).', 'X2 risk sheet worst months');
n++; if (!(facts.join(' ').includes('−5.32%') && facts.join(' ').includes('−3.14%'))) { fail++; console.error('FAIL risk sheet carries both worst months'); }
eq(W.MAX_DROP, 'הירידה הכי גדולה לפני שחזר לעלות', '4.0 row 11');

/* ---- 6.1 rows 7–8 + 4.0 row 13: the long view ---- */
const L = (per, labels, vals, band) => W.longWords(per, cols(labels, vals), { asof: ASOF, band });
eq(L('a5', P3, P3net.a5), 'ב-5 השנים האחרונות המסלול של מנורה ראשון: +8.9% בשנה, מול +8.6% של מגדל.', 'P3 5Y (4.0 row 13)');
eq(L('a3', P3, P3net.a3), 'ב-3 השנים האחרונות המסלול של מנורה ראשון: +13.8% בשנה, מול +13.0% של מגדל.', 'P3 3Y');
eq(L('y12', P3, P3net.y12), 'בשנה האחרונה המסלול של הראל ראשון: +10.3%, מול +10.0% של מנורה.', 'P3 last year');
eq(L('ytd', P3, P3net.ytd, 0.1 * 10 / 12), 'מתחילת 2026 המסלול של הראל ראשון: +8.0%, מול +7.1% של מנורה.', 'P3 YTD, pro-rata band');
eq(L('y12', G3, G3net.y12), 'בשנה האחרונה המסלול של מנורה ראשון: +8.8%, מול +8.4% של מגדל.', 'G3 last year');
eq(L('a5', G3, G3net.a5), 'ב-5 השנים האחרונות המסלול של הראל ראשון: +7.1% בשנה, מול +6.7% של מגדל.', 'G3 5Y');
// tie at the top: G3 + כלל (g7988, a3 14.0) — הראל 13.93 is inside 0.10
eq(L('a3', [...G3, 'כלל'], [...G3net.a3, 14.0]), 'ב-3 השנים האחרונות המסלולים של הראל ושל כלל כמעט שווים בראש (+13.9%, +14.0% בשנה).', 'G3 + Clal 3Y, tie at the top');
// all tied: the two Harel pension funds (p2172 גילעד 12.71, p2177 מנוף 12.73), 3Y
eq(L('a3', ['הראל גילעד', 'הראל מנוף'], [12.71, 12.73]), 'ב-3 השנים האחרונות שני המסלולים כמעט שווים: ההבדל ביניהם קטן מדי כדי לקבוע מי ראשון.', 'two Harel funds, all tied');
// the band is strict, as in lib/fundsTie.ts: 13.9 vs 13.8 (כלל, מנורה) is a gap of exactly 0.10, not a tie
eq(L('a3', ['מנורה', 'כלל', 'מגדל'], [13.8, 13.9, 13.02]), 'ב-3 השנים האחרונות המסלול של כלל ראשון: +13.9% בשנה, מול +13.8% של מנורה.', 'pension 3Y, a 0.10 gap is not a tie');
eq(L('ytd', P3, [-1.2, -1.5, -2.0], 0.083), 'מתחילת 2026 כל המסלולים ירדו. המסלול של מגדל ירד הכי פחות: −1.2%, מול −1.5% של הראל.', 'all down (SYNTHETIC)');
eq(L('y12', ['מגדל'], [9.0]), 'מסלול אחד נבחר. הוסיפו עוד אחד כדי להשוות.', 'one track');

/* ---- 4.4 + 4.0 row 13: the month sheet ---- */
eq(W.sheetTitle(202610), 'אוקטובר 2026', 'C2 title');
eq(W.sheetTitle(202609), 'ספטמבר 2026', 'C2 older month');
eq(W.gapWords(P3m[202610]), 'הפער בין הגבוה לנמוך: 0.72%.', 'P3 Oct gap (4.0 row 13)');
// cat.json "פנסיה מקיפה | כללי" 202610: yn −1.045, nn 5
eq(W.avgWords(-1.045, 5, P3m[202610]), 'הממוצע של כל 5 המסלולים מהסוג הזה: −1.05%. 2 מתוך 3 שבחרת מעליו.', 'P3 Oct category average');
eq(W.avgWords(-0.243, 17, G3m[202610]), 'הממוצע של כל 17 המסלולים מהסוג הזה: −0.24%. 1 מתוך 3 שבחרת מעליו.', 'G3 Oct category average');

/* ---- helpers and the convention ---- */
const raw = W.monthInsight({ p: 202610, row: cols(P3, P3m[202610]), lastYear: cols(P3, P3net.y12) });
n++; if (!raw.includes('⁦+10.3%⁩')) { fail++; console.error('FAIL figures are wrapped in LRI…PDI'); }
const neg = W.gapWords([1, 0]) + W.riskWords(X2risk);
n++; if (/\u2066-/.test(neg) || !neg.includes('−')) { fail++; console.error('FAIL minus is U+2212'); }
eq(W.joinNames(['מגדל', 'הראל', 'מנורה']), 'מגדל, הראל ומנורה', 'list of three');
eq(W.joinNames(['מגדל', 'IBI']), 'מגדל ו-IBI', 'Latin label takes ו-');

/* ---- saver copy rules (spec 7.1, T2): no jargon in any output ---- */
const all = [raw, W.rowWords(202607, cols(P3, P3m[202607])), W.riskWords(X2risk), W.riskLongWords([50.6, 73.1]), ...facts,
  L('a5', P3, P3net.a5), L('a3', [...G3, 'כלל'], [...G3net.a3, 14.0]), W.gapWords(P3m[202610]), W.avgWords(-1.045, 5, P3m[202610]),
  W.RISK_BANNER, W.PRODUCTS_LINE, W.OLD_POLICY_LINE, W.ONE_MONTH_NOTE, W.ONE_TRACK].map(plain).join(' ');
const JARGON = /נ"ב|נ"א|ד"נ|LTM|YTD|\b\d+[YM]\b|צמודים|איזון אקטוארי|מקדם|נק׳ אחוז|קטגוריה|אשתקד|אינה בעלת משמעות|ראשונה|הזולה|הגבוהה/;
n++; if (JARGON.test(all)) { fail++; console.error(`FAIL jargon or inflected label: ${all.match(JARGON)[0]}`); }

console.log(`compare-words: ${n - fail}/${n} passed`);
if (fail) process.exit(1);
