// Rollout F1 (spec 18.3, 18.6): node test for src/lib/pageWords.ts. Run: node scripts/page-words-test.mjs
// Bundles the module with esbuild (Vite's own copy). The figures are the LIVE data of 10/26 (public/data/funds.json, funds/cat.json,
// funds/<k>.json; gross as published), read here, put through lib/pageMonths.ts where a page would, and the sentences are compared with
// the exact Hebrew of spec 18.6 (and 3.4 / 4.3 / 5.4 / 6.3 / 7.3 / 16–17 where 18.6 has no figure). Cases no fixture reaches are SYNTHETIC.
// The isolates (LRI … PDI) are checked once and then stripped for the comparisons, as the reader sees the text.
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'pagewordstest-'));
const bundle = async (f) => { const o = join(dir, f.replace(/\W/g, '_') + '.mjs'); await build({ entryPoints: [new URL(`../src/lib/${f}`, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: o, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } }); return import(pathToFileURL(o).href); };
let W, M;
try { W = await bundle('pageWords.ts'); M = await bundle('pageMonths.ts'); } finally { rmSync(dir, { recursive: true, force: true }); }

const plain = (s) => s.replace(/[⁦⁩‎]/g, '');
let n = 0, fail = 0;
function eq(got, want, name) { n++; if (plain(got) !== plain(want)) { fail++; console.error(`FAIL ${name}\n  got:  ${plain(got)}\n  want: ${plain(want)}`); } }
function ok(c, name, got) { n++; if (!c) { fail++; console.error(`FAIL ${name}${got !== undefined ? `\n  got: ${JSON.stringify(got)}` : ''}`); } }

/* ---- live data ---- */
const data = (p) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url)));
const FF = data('funds.json'), ASOF = FF.asof, FUNDS = FF.funds, F = Object.fromEntries(FUNDS.map((f) => [f.k, f])), CATS = data('funds/cat.json');
const PG = 'פנסיה מקיפה | כללי', HG = 'השתלמות | כללי', GG = 'גמל להשקעה | כללי';
const pg = M.typeMembers(FUNDS, PG), hg = M.typeMembers(FUNDS, HG), gg = M.typeMembers(FUNDS, GG);
const labels = { p2009: 'מנורה', p2102: 'מגדל', p2002: 'כלל', p2172: 'הראל גילעד', p2177: 'הראל מנוף' };   // pages/compare/tracks trackLabels
const catAt = (key, p) => { const c = CATS[key], i = c.p.indexOf(p); return c.y[i]; };

/* ---- isolates ---- */
ok(W.pctBracket(-1.033) === '⁦(−1.03%)⁩', 'a bracketed figure is ONE isolate with its brackets and U+2212', W.pctBracket(-1.033));
ok(W.pctAbs(-1.44) === '⁦1.44%⁩' && W.pctSigned(9.15, 1) === '⁦+9.2%⁩' && W.ilsNum(1170) === '⁦1,170⁩', 'figures isolated; half-up rounding (9.15 → 9.2)');
ok(W.placeWords({ lo: 5, hi: 6, n: 13 }) === 'באמצע (⁦5–6⁩ מתוך ⁦13⁩)', 'the range is one isolate', W.placeWords({ lo: 5, hi: 6, n: 13 }));

/* ---- names ---- */
eq(W.typeName(PG), 'פנסיה כללי', 'typeName pension general');
eq(W.typeName(GG), 'גמל להשקעה כללי', 'typeName gemel lehashkaa general');
eq([W.typeLabel('עד 50'), W.typeLabel('50-60'), W.typeLabel('60 ומעלה'), W.typeLabel('עוקב מדד S&P 500'), W.typeLabel('אשראי ואג"ח'), W.typeLabel('עוקב מדדי מניות')].join(' | '), 'עד גיל 50 | גיל 50 עד 60 | מגיל 60 | S&P 500 | אג״ח | מדדי מניות', 'type labels (no dash to flip)');
eq([W.prodLabel('גמל'), W.prodLabel('פוליסות חיסכון וביטוחי מנהלים (מ-2004)'), W.prodLabel('ביטוחי מנהלים 1992-2003')].join(' | '), 'קופת גמל | פוליסות | ביטוח מנהלים ישן', 'product labels');
eq(['m1', 'ytd', 'y12', 'a3', 'a5'].map((p) => W.perWords(p, ASOF)).join(' | '), 'באוקטובר | מתחילת 2026 | ב-12 החודשים האחרונים | ב-3 השנים האחרונות | ב-5 השנים האחרונות', 'saver period words (16.1 4c)');
eq(W.stampWords(ASOF), 'רשות שוק ההון · 10/26 · תשואה ברוטו, כפי שמפורסמת · העבר אינו מבטיח עתיד', 'stamp (18.1 #2)');
eq(W.CORNER, 'באחוזים, לפני דמי ניהול', 'grid corner');

/* ---- card p2102 (18.6) ---- */
{
  const h = data('funds/p2102.json'), tv = M.trackVsType(h, F.p2102, CATS[PG], 6), type = W.typeName(PG);
  eq(W.cardWords(tv.newest, tv.rows[0].v, tv.rows[0].avg, { y12: tv.y12.v, type, months: tv.months }), 'באוקטובר המסלול ירד 1.44%, יותר מהממוצע בפנסיה כללי (‎−1.03%). בשנה האחרונה עלה 9.2%.', 'card sentence p2102 (18.6)');
  // p2172 in October fell less than the average (3.4 row 2, on gross)
  eq(W.cardWords(ASOF, F.p2172.m1, catAt(PG, ASOF), { y12: F.p2172.y12, type }), 'באוקטובר המסלול ירד 0.72%, פחות מהממוצע בפנסיה כללי (−1.03%). בשנה האחרונה עלה 10.5%.', 'card: fell less (p2172)');
  const sep = h.y[h.p.indexOf(202609)], jul = h.y[h.p.indexOf(202607)];
  eq(W.cardWords(202609, sep, catAt(PG, 202609), { type }), 'בספטמבר המסלול עלה 0.56%, פחות מהממוצע בפנסיה כללי (+0.63%).', 'card: rose less (p2102 September)');
  eq(W.cardWords(202607, jul, catAt(PG, 202607), { type }), `ביולי המסלול עלה ${jul.toFixed(2)}%, והממוצע בפנסיה כללי ירד ${Math.abs(catAt(PG, 202607)).toFixed(2)}%.`, 'card: opposite signs (p2102 July)');
  ok(jul > 0 && catAt(PG, 202607) < 0, 'July: the track rose, the average fell (fixture holds on gross)', [jul, catAt(PG, 202607)]);
  eq(W.cardWords(ASOF, -1.05, -1.03, { y12: 9.2, type }), 'באוקטובר המסלול ירד 1.05%, כמעט כמו הממוצע בפנסיה כללי. בשנה האחרונה עלה 9.2%.', 'card: inside the band (SYNTHETIC)');
  eq(W.cardWords(ASOF, 0, -1.03, { type }), 'באוקטובר המסלול לא זז, והממוצע בפנסיה כללי ירד 1.03%.', 'card: exactly zero (SYNTHETIC)');
  eq(W.cardWords(ASOF, -1.44, null, { y12: 9.15 }), 'באוקטובר המסלול ירד 1.44%. בשנה האחרונה עלה 9.2%.', 'card: no average');
  eq(W.cardWords(ASOF, -1.44, -1.033, { type, months: 3 }), 'באוקטובר המסלול ירד 1.44%, יותר מהממוצע בפנסיה כללי (−1.03%). מסלול חדש: פורסמו 3 חודשים.', 'card: under 12 months');
  eq(W.cardWords(ASOF, null, -1.03), 'אין עדיין תשואה חודשית למסלול הזה.', 'card: no monthly return');
  eq(W.cardWords(ASOF, -1.44, -1.033, { y12: -2.1, type }), 'באוקטובר המסלול ירד 1.44%, יותר מהממוצע בפנסיה כללי (−1.03%). בשנה האחרונה ירד 2.1%.', 'card: last year negative (SYNTHETIC)');
  // years and long
  const yrs = M.trackYears(h, F.p2102, CATS[PG], 5), y25 = yrs.rows.find((r) => r.yr === 2025);
  eq(W.cardYearWords(2025, y25.v, y25.avg, { type, asof: ASOF }), 'ב-2025 המסלול עלה 15.6%, מתחת לממוצע בפנסיה כללי (‎+15.9%).', 'years sentence (18.6)');
  const y23 = yrs.rows.find((r) => r.yr === 2023);
  eq(W.cardYearWords(2023, y23.v, y23.avg, { type, asof: ASOF }), 'ב-2023 המסלול עלה 9.7%, מעל הממוצע בפנסיה כללי (+9.0%).', 'years: above');
  eq(W.cardYearWords(2026, yrs.rows[0].v, yrs.rows[0].avg, { type, asof: ASOF }), 'מתחילת 2026 המסלול עלה 6.5%, מתחת לממוצע בפנסיה כללי (+7.3%).', 'years: the current, partial year');
  const lp = M.placeOf(F.p2102, pg, 'a5', ASOF);
  eq(W.cardLongWords('a5', F.p2102.a5, M.typeWindowAvg(CATS[PG], 'a5', ASOF), { asof: ASOF, type, place: lp }), 'ב-5 השנים האחרונות המסלול עלה 8.8% בשנה בממוצע, כמעט כמו הממוצע בפנסיה כללי. מקום 2 מתוך 5.', 'long sentence (18.6)');
  eq(W.cardLongWords('y12', F.p2102.y12, M.typeWindowAvg(CATS[PG], 'y12', ASOF), { asof: ASOF, type, place: M.placeOf(F.p2102, pg, 'y12', ASOF) }), 'ב-12 החודשים האחרונים המסלול עלה 9.2%, מתחת לממוצע בפנסיה כללי (+10.1%). מקום 5 מתוך 5.', 'long: last year, below');
  eq(['y12', 'a3', 'a5'].map((p) => W.placeWords(M.placeOf(F.p2102, pg, p, ASOF))).join(' | '), 'מקום 5 מתוך 5 | מקום 3 מתוך 5 | מקום 2 מתוך 5', 'long tiles: places (18.6)');
  const L = M.longestPlace(F.p2102, pg, ASOF);
  eq(W.cardHint(L.per, L.pl, ASOF), 'הקשה על מספר פותחת את החודש · ב-5 השנים האחרונות: מקום 2 מתוך 5', 'hint line (3.2 #5)');
  eq(W.cardHint(null, null, ASOF), 'הקשה על מספר פותחת את החודש', 'hint line without a place');
  eq(W.placeLine('a5', lp, ASOF), 'ב-5 השנים האחרונות: מקום 2 מתוך 5', 'plain-words row sub');
  eq(W.cardWhoBest(ASOF, 5), 'מי היה ראשון באוקטובר מבין 5 המסלולים?', '#who-best (16.1 1b)');
  eq(W.avgHeadSub(type, 5), 'פנסיה כללי · 5 ›', 'average head sub');
  eq(W.cmpCta(['מנורה', 'כלל']), 'להשוות מול מנורה וכלל ›', '#cmp-cta (3.2 #6)');
  eq(W.feeRowSub(false) + ' | ' + W.feeRowSub(true), 'בשנה, לדוגמה › | בשנה, שלך ›', 'fee row sub (16.1 2c, 17.1 1c)');
  // build review B1: one vocabulary with the card ("הממוצע ב<סוג>"), no second count beside the asset-weighted average
  eq(W.monthSheetVs(-1.44, -1.033, type), 'המסלול מתחת לממוצע בפנסיה כללי, ב-0.41%.', 'month sheet: below the average');
  eq(W.monthSheetVs(-1.05, -1.033, type), 'המסלול כמעט כמו הממוצע בפנסיה כללי.', 'month sheet: inside the band');
  eq(W.allTracksIn(5, ASOF), 'כל 5 המסלולים באוקטובר', 'month sheet link');
  eq(W.typeMonthTitle(ASOF, type), 'אוקטובר 2026 · פנסיה כללי', 'type-month sheet title (16.3 T-C7)');
  eq(W.typeMonthTitle(202609, type), 'ספטמבר 2026 · פנסיה כללי', 'type-month sheet title, row 2');
  eq(W.typeMonthSub(5), 'כל 5 המסלולים מהסוג הזה · לפני דמי ניהול', 'type-month sheet sub');
  // build review B1 (P2-1): the ranked count and the self-managed remainder
  eq(W.typeMonthSub(13, 7), 'כל 13 המסלולים מהסוג הזה, ועוד 7 בניהול אישי · לפני דמי ניהול', 'type-month sheet sub with self-managed tracks');
  eq(W.selfMore(7) + '|' + W.selfMore(0), 'ועוד 7 בניהול אישי|', 'self-managed remainder');
  eq(W.OLD_POLICY_GUARD, 'פוליסה ישנה (1990–2003): יש בה הבטחות שלא רואים בתשואה.', 'old-policy guard: first sentence only (3.5)');
  eq(W.newTrackWords(4), 'מסלול חדש: פורסמו 4 חודשים.', 'new track');
  eq(W.feeFromBalance(100000, 0.14) + ' | ' + W.feeFromDeposits(2220, 1.56), 'מהחיסכון: 100,000 × 0.14% | מההפקדות: 12 × 2,220 × 1.56%', 'fee sheet lines');
}

/* ---- places (16.1 5b, 18.6) ---- */
eq(W.placeWords(M.placeOf(F.p2102, pg, 'y12', ASOF)), 'מקום 5 מתוך 5', '/my p2102');
eq(W.placeWords(M.placeOf(F.g8211, gg, 'y12', ASOF)), 'מקום 7 מתוך 11', '/my g8211');
eq(W.placeWords({ lo: 5, hi: 6, n: 13 }), 'באמצע (5–6 מתוך 13)', '/my g880 as quoted in 18.6 (the like-for-like rule gives "מתוך 12": see page-months-test)');
eq(W.placeWords(M.placeOf(F.g880, hg, 'y12', ASOF)), 'באמצע (5–6 מתוך 12)', '/my g880 by the 18.5 rule (IRA not ranked)');
eq(W.placeWords({ lo: 1, hi: 3, n: 5 }) + ' | ' + W.placeWords({ lo: 4, hi: 5, n: 5 }), 'מהראשונים (1–3 מתוך 5) | מהאחרונים (4–5 מתוך 5)', 'ends of the list');
eq(W.placeWords({ lo: 1, hi: 5, n: 5 }), 'כל 5 המסלולים כמעט שווים', 'everyone in one group (not in the spec: my wording)');
eq(W.placeWords(null), '', 'not ranked: nothing');
eq(W.tieNote('m1'), 'מסלולים בהפרש קטן מ-0.05% בחודש חולקים מקום, והמקום הבא ממשיך לפי הסדר (1, 1, 3).', 'tie note, month (18.5)');
eq(W.tieNote('a5'), 'מסלולים בהפרש קטן מ-0.10% בשנה חולקים מקום, והמקום הבא ממשיך לפי הסדר (1, 1, 3).', 'tie note, year views (18.5)');

/* ---- screener, pension general (18.6) ---- */
{
  const rows = (per) => M.scoreRows(pg, per, { asof: ASOF }).filter((r) => r.ranked).map((r) => ({ label: labels[r.k], v: r.v }));
  eq(W.screenWords('a5', rows('a5'), ASOF), 'ב-5 השנים האחרונות מנורה ראשון: ‎+9.0% בשנה. הפער בין הראשון לאחרון: 0.7% בשנה.', 'screener five years (18.6)');
  eq(W.screenWords('m1', rows('m1'), ASOF), 'באוקטובר הראל גילעד, הראל מנוף ומנורה כמעט שווים בראש. הפער בין הראשון לאחרון: 0.73%.', 'screener month (18.6)');
  eq(W.screenWords('y12', rows('y12'), ASOF), 'ב-12 החודשים האחרונים כלל ראשון: ‎+10.6%. הפער בין הראשון לאחרון: 1.5%.', 'screener 12 months (18.6)');
  eq(W.screenWords('y12', [1, 2, 3, 4, 5].map((i) => ({ label: `x${i}`, v: 10 - i * 0.01 })), ASOF), 'ב-12 החודשים האחרונים כל 5 המסלולים כמעט שווים.', 'all inside the band (SYNTHETIC)');
  eq(W.screenWords('y12', [10, 9.98, 9.97, 9.95, 8].map((v, i) => ({ label: `x${i}`, v })), ASOF), 'ב-12 החודשים האחרונים 4 מסלולים כמעט שווים בראש. הפער בין הראשון לאחרון: 2.0%.', 'more than three at the top (SYNTHETIC)');
  eq(W.screenWords('y12', [{ label: 'הראל', v: 8.3 }], ASOF), 'ב-12 החודשים האחרונים: הראל, ‎+8.3%.', 'one track');
  eq(W.screenWords('a5', [{ label: 'x', v: null }], ASOF), 'אין מסלולים עם תשואה לתקופה הזאת.', 'none with a figure');
  eq(W.screenSub('saver', F.p2102, 'a5', ASOF), 'ב-12 חודשים: +9.2%', 'saver quiet line');
  eq(W.screenSub('saver', F.p2102, 'y12', ASOF), 'באוקטובר: −1.44%', 'saver quiet line on the 12-month view');
  eq(W.screenSub('agent', F.p2102, 'a5', ASOF), 'ד״נ 0.14% · מהפקדה 1.56% · איזון −0.05%', 'agent quiet line (pension: actuarial balance)');
  eq(W.screenSub('agent', F.g880, 'a5', ASOF), `ד״נ 0.60% · מניות ${Math.round(F.g880.st)}%`, 'agent quiet line (no balance: equity)');
  eq(W.screenSub('pro', F.p2102, 'a5', ASOF), 'אחוזון 75 · ד״נ 0.14% · שארפ 1.28 · מניות 51%', 'Pro quiet line (4.2)');
  eq(W.screenHead(5, ASOF), '5 מסלולים מהסוג הזה · 10/26', 'screener head (4.2 #1)');
  eq(W.screenHead(13, ASOF, 7), '13 מסלולים מהסוג הזה, ועוד 7 בניהול אישי · 10/26', 'screener head with self-managed tracks (B1 P2-1)');
  eq(W.screenBench('saver', 'פנסיה כללי', 'a5') + ' | ' + W.screenBench('pro', 'פנסיה כללי', 'm1'), 'ממוצע פנסיה כללי · בשנה, בממוצע | ממוצע הקטגוריה', 'board closing line');
}

/* ---- /my, M3 = p2102, g880, g8211 (18.6) ---- */
{
  const M3 = ['p2102', 'g880', 'g8211'].map((k) => F[k]);
  eq(W.myWords(ASOF, M3.map((f) => ({ m: f.m1, y: f.y12 }))), 'באוקטובר שניים מהמסלולים שלך ירדו ואחד כמעט לא זז. בשנה האחרונה כולם עלו: בין ‎+8.9% ל-‎+9.2%.', '/my sentence (18.6)');
  eq(W.myWords(ASOF, [{ m: F.p2102.m1, y: F.p2102.y12 }]), 'באוקטובר המסלול שלך ירד 1.44%. בשנה האחרונה הוא עלה 9.2%.', '/my one product (16.3 T-M3 on gross)');
  eq(W.myWords(ASOF, [{ m: -1.44, y: 9 }, { m: -0.19, y: 8 }]), 'באוקטובר שני המסלולים שלך ירדו. בשנה האחרונה כולם עלו: בין +8.0% ל-+9.0%.', 'two, both fell');
  eq(W.myWords(ASOF, [{ m: 0.4, y: 1 }, { m: 0.2, y: 2 }, { m: 0.3, y: 3 }]), 'באוקטובר כל 3 המסלולים שלך עלו. בשנה האחרונה כולם עלו: בין +1.0% ל-+3.0%.', 'three, all rose (SYNTHETIC)');
  eq(W.myWords(ASOF, [{ m: 0.4, y: 1 }, { m: -0.2, y: -2 }, { m: 0.3, y: 3 }]), 'באוקטובר אחד מהמסלולים שלך ירד ושניים עלו. בשנה האחרונה חלק עלו וחלק ירדו.', 'mixed, last year mixed (SYNTHETIC)');
  eq(W.myWords(ASOF, [{ m: -0.4, y: -1 }, { m: -0.2, y: -2 }, { m: 0.3, y: -3 }, { m: -0.3, y: -3 }]), 'באוקטובר 3 מהמסלולים שלך ירדו ואחד עלה. בשנה האחרונה כולם ירדו.', 'mixed with a count, all down a year (SYNTHETIC)');
  eq(W.myWords(ASOF, [{ m: 0.01, y: null }, { m: -0.02, y: null }]), 'באוקטובר שני המסלולים שלך כמעט לא זזו.', 'all flat (SYNTHETIC)');
  eq(W.myWords(ASOF, [{ m: 0.01, y: 8.9 }]), 'באוקטובר המסלול שלך כמעט לא זז. בשנה האחרונה הוא עלה 8.9%.', 'one product, flat (18.2 +)');
  eq(W.myWords(ASOF, [{ m: null, y: 9 }]), 'אין עדיין תשואה חודשית למוצרים שלך.', 'no monthly data');
  // build review B1 (novice #1): the same last-year figure reads once, not "בין +9.2% ל-+9.2%"
  eq(W.myWords(ASOF, [{ m: -1.44, y: 9.21 }, { m: -0.19, y: 9.18 }]), 'באוקטובר שני המסלולים שלך ירדו. בשנה האחרונה שניהם עלו 9.2%.', 'two, same year figure');
  eq(W.myWords(ASOF, [{ m: 0.4, y: 3 }, { m: 0.2, y: 3 }, { m: 0.3, y: 3.04 }]), 'באוקטובר כל 3 המסלולים שלך עלו. בשנה האחרונה כולם עלו 3.0%.', 'three, same year figure (SYNTHETIC)');
  eq(W.myWords(ASOF, [{ m: -0.4, y: -2 }, { m: -0.2, y: -2 }]), 'באוקטובר שני המסלולים שלך ירדו. בשנה האחרונה שניהם ירדו 2.0%.', 'two, same fall (SYNTHETIC)');
  eq(W.myWords(ASOF, [{ m: -1.44, y: 9.15 }], { who: 'בן/בת הזוג' }), 'באוקטובר המסלול של בן/בת הזוג ירד 1.44%. בשנה האחרונה הוא עלה 9.2%.', 'another profile (5.5)');
  // the lines under the squares
  eq(W.vsAvgWords(ASOF, F.p2102.m1, catAt(PG, ASOF), W.typeName(PG)), 'באוקטובר: מתחת לממוצע בפנסיה כללי (‎−1.03%)', 'vs line p2102 (18.6)');
  eq(W.vsAvgWords(ASOF, F.g880.m1, catAt(HG, ASOF), W.typeName(HG)), 'באוקטובר: מעל הממוצע בהשתלמות כללי (‎−0.28%)', 'vs line g880 (18.6)');
  eq(W.vsAvgWords(ASOF, F.g8211.m1, catAt(GG, ASOF), W.typeName(GG)), 'באוקטובר: מעל הממוצע בגמל להשקעה כללי (‎−0.19%)', 'vs line g8211 (18.6)');
  eq(W.vsAvgWords(ASOF, -1.05, -1.03, 'פנסיה כללי'), 'באוקטובר: כמו הממוצע בפנסיה כללי (−1.03%)', 'vs line inside the band');
  ok(W.vsAvgParts(ASOF, -1.44, -1.03, 'x').rel === 'מתחת לממוצע', 'vs parts: the bold word');
  eq(W.myYearLine(F.p2102.y12, M.placeOf(F.p2102, pg, 'y12', ASOF)), 'בשנה האחרונה: +9.2% · מקום 5 מתוך 5', 'year line (16.3 T-M4)');
  // fees on /my: example 560, 600, 550 = 1,710 (18.6)
  const costs = M3.map((f) => M.feeValue(f, null));
  ok(JSON.stringify(costs) === '[560,600,550]', 'example fees 560, 600, 550', costs);
  const fl = W.myFeeLine(costs[0], false, W.amountsBase({ own: false, depositOwn: false, deposits: true }));
  eq(`${fl.text} · ${fl.tag}`, 'דמי ניהול ₪560 בשנה · לדוגמה', 'product fee line, example');
  const s0 = W.myFeeSum(costs.map((c) => ({ cost: c, own: false })));
  eq(s0.text, 'דמי ניהול, לדוגמה: כ-1,710 ש״ח בשנה על כל 3 המוצרים', 'fee total, all example (5.2, 18.6)');
  eq(s0.sub, 'על חיסכון של 100,000 ש״ח בכל מוצר, לפי הממוצע במסלול', 'fee total sub, all example');
  // 17.6 fixture on gross: 420,000 / 3,100 on the pension only
  const own = M.feeValue(F.p2102, { balance: 420000, monthly: 3100 });
  const s1 = W.myFeeSum([{ cost: own, own: true }, { cost: costs[1], own: false }, { cost: costs[2], own: false }]);
  eq(s1.text, 'דמי ניהול: כ-2,320 ש״ח בשנה על כל 3 המוצרים', 'fee total, one typed (17.6)');
  eq(s1.sub, 'כולל 2 מוצרים על דוגמה של 100,000 ש״ח', 'fee total sub, one typed');
  ok(W.myFeeSum([{ cost: 1, own: true }]).sub === '' && plain(W.myFeeSum([{ cost: 560, own: true }]).text) === 'דמי ניהול: כ-560 ש״ח בשנה על המוצר', 'all typed: no second line; one product "על המוצר"');
  eq(W.myFeesSub([{ own: false }, { own: false }]) + ' | ' + W.myFeesSub([{ own: true }, { own: false }, { own: false }]) + ' | ' + W.myFeesSub([{ own: true }]), 'לדוגמה: חיסכון של 100,000 ש״ח בכל מוצר | 2 מוצרים עדיין על דוגמה | על הסכומים שלך', 'fee breakdown sub');
  eq(W.myFeesRowTag(true) + ' | ' + W.myFeesRowTag(false), 'על הסכומים שלך · לשנות › | לדוגמה · להזין את שלי ›', 'fee breakdown row tags (17.1 1b)');
  eq(W.todoAmounts('מיטב · השתלמות כללי'), 'כדי לראות את המספר שלך במיטב · השתלמות כללי: להזין כמה יש בו וכמה מפקידים', '#todo-amt');
  eq(W.fullLabel('מגדל', PG), 'מגדל · פנסיה כללי', 'full label');
  eq(W.retireGapWords(10700, false, { age: 38 }), 'בדוגמה (חיסכון 100,000 ש״ח, גיל 38): כ-10,700 ש״ח יותר בגיל הפרישה', 'retirement gap on the example (5.2)');
}

/* ---- hub (18.6) ---- */
{
  const g = M.typeGrid(FUNDS, CATS, 'פנסיה מקיפה', { asof: ASOF, mineKey: PG });
  const cols = g.cols.map((c, i) => ({ label: W.typeLabel(c.track), v: g.rows[0].vals[i] }));
  eq(W.hubWords(ASOF, 'פנסיה מקיפה', cols, 0), 'באוקטובר מסלולי פנסיה כללי (הסוג שלך) ירדו 1.03% בממוצע. בסוגים האחרים: ירידה בין 0.95% ל-1.76%.', 'hub pension, mine first (18.6)');
  const h = M.typeGrid(FUNDS, CATS, 'השתלמות', { asof: ASOF, mineKey: HG });
  const hc = h.cols.map((c, i) => ({ label: W.typeLabel(c.track), v: h.rows[0].vals[i] }));
  ok(plain(W.hubWords(ASOF, 'השתלמות', hc, 0)).endsWith('בסוגים האחרים חלק עלו וחלק ירדו.') && plain(W.hubWords(ASOF, 'השתלמות', hc, 0)).startsWith('באוקטובר מסלולי השתלמות כללי (הסוג שלך) ירדו 0.28% בממוצע.'), 'hub hishtalmut, mixed (18.6)', plain(W.hubWords(ASOF, 'השתלמות', hc, 0)));
  eq(hc.map((c) => c.label).join(' | '), 'כללי | מניות | S&P 500 | אג״ח', 'hub hishtalmut column labels');
  const g0 = M.typeGrid(FUNDS, CATS, 'פנסיה מקיפה', { asof: ASOF });
  eq(W.hubWords(ASOF, 'פנסיה מקיפה', g0.cols.map((c, i) => ({ label: W.typeLabel(c.track), v: g0.rows[0].vals[i] }))), 'באוקטובר כל סוגי המסלולים בפנסיה ירדו: גיל 50 עד 60 הכי פחות (−0.95%), מניות הכי הרבה (−1.76%).', 'hub, no saved product, all fell (6.3 on gross)');
  eq(W.hubWords(202605, 'השתלמות', [{ label: 'מניות', v: 3.51 }, { label: 'S&P 500', v: 0.41 }]), 'במאי כל סוגי המסלולים בהשתלמות עלו: מניות הכי הרבה (+3.51%), S&P 500 הכי פחות (+0.41%).', 'hub all rose (6.3 pattern)');
  eq(W.hubWords(ASOF, 'השתלמות', h.cols.map((c, i) => ({ label: W.typeLabel(c.track), v: h.rows[0].vals[i] }))), 'באוקטובר בהשתלמות חלק עלו וחלק ירדו: S&P 500 (+2.42%), מניות (−1.05%).', 'hub mixed, no saved product (6.3 on gross)');
  eq(W.hubWords(ASOF, 'פנסיה מקיפה', [{ label: 'a', v: -1.0 }, { label: 'b', v: -1.02 }]), 'באוקטובר כל סוגי המסלולים בפנסיה ירדו, כמעט באותה מידה.', 'hub all inside 0.05');
  eq(W.hubWords(ASOF, 'פנסיה מקיפה', [{ label: 'כללי', v: -1.03 }, { label: 'מניות', v: -1.76 }], 0), 'באוקטובר מסלולי פנסיה כללי (הסוג שלך) ירדו 1.03% בממוצע. מניות: ירידה של 1.76%.', 'hub, one other type');
  eq(W.hubWords(ASOF, 'פנסיה מקיפה', [{ label: 'כללי', v: -1.03 }, { label: 'a', v: 0.5 }, { label: 'b', v: 1.2 }], 0), 'באוקטובר מסלולי פנסיה כללי (הסוג שלך) ירדו 1.03% בממוצע. בסוגים האחרים: עלייה בין 0.50% ל-1.20%.', 'hub, others rose (SYNTHETIC)');
  eq(W.hubSub(ASOF), 'אוקטובר 2026 · ממוצע של כל סוג מסלול', 'hub head (6.2 #1)');
  eq(W.hubWhoBest(ASOF, 'פנסיה כללי'), 'מי היה ראשון באוקטובר בפנסיה כללי?', 'hub who-best row (16.1 3d)');
  // leaders and changes
  const L = M.leaderRows(M.scoreRows(pg, 'm1', { asof: ASOF }), ['p2102']);
  eq(L.map((x) => `${labels[x.row.k]} ${W.leaderLabel(x.role, x.mine)}`).join(' · '), 'הראל גילעד ראשון · מגדל המסלול שלך · כלל אחרון', 'leaders (18.6)');
  eq(W.leaderLabel('first', true) + ' | ' + W.leaderLabel('last', true), 'ראשון · המסלול שלך | אחרון · המסלול שלך', 'leaders: mine at an end (17.1 2c)');
  eq(W.hubLeadIntro(ASOF), 'באוקטובר, בכל סוג: מי היה ראשון ומי אחרון.', 'leaders intro');
  eq(W.leadHeadSub(5, catAt(PG, ASOF)), '5 מסלולים · ממוצע −1.03%', 'leaders board head');
  eq(W.hubSpreadWords(ASOF, W.typeName(PG), M.rankedSpread(M.scoreRows(pg, 'm1', { asof: ASOF })), true), 'באוקטובר בפנסיה כללי (הסוג שלך): בין המסלול הראשון לאחרון היה פער של 0.73%.', 'changes sentence (18.6)');
  eq(W.hubSpreadHead(ASOF), 'הפער בין הראשון לאחרון, באוקטובר', 'changes card head');
  ok(!/הכי הרבה/.test(plain(W.hubLeadIntro(ASOF))), 'leaders lens: no "הכי הרבה" (16.3)');
}

/* ---- fees (18.6) ---- */
{
  const lab = (r) => ({ k: r.k, label: labels[r.k] ?? r.f.grp, v: r.v });
  const ex = W.amountsBase({ own: false, depositOwn: false, deposits: true });
  eq(ex, 'על דוגמה של 100,000 ש״ח', 'base: the example');
  eq(W.amountsBase({ own: true, depositOwn: false, deposits: true }), 'על היתרה שלך והפקדה לדוגמה', 'base: balance only, with deposits (17.1 1f)');
  eq(W.amountsBase({ own: true, depositOwn: true, deposits: true }), 'על הסכומים שלך', 'base: both typed');
  eq(W.amountsBase({ own: true, depositOwn: false, deposits: false }), 'על היתרה שלך', 'base: no deposit fee in the type (18.2 #3)');
  const b = M.feeBoard(pg, { mineK: 'p2102' });
  eq(W.feesWords(b.rows.map(lab), 'p2102', { mode: 'yr', own: false, base: ex }), 'המסלול שלך (מגדל): כ-560 ש״ח בשנה, על דוגמה של 100,000 ש״ח. האחרים: 540 עד 610.', 'fees pension, example (18.6)');
  const a = { balance: 420000, monthly: 3100 }, bo = M.feeBoard(pg, { mineK: 'p2102', a });
  eq(W.feesWords(bo.rows.map(lab), 'p2102', { mode: 'yr', own: true, base: W.amountsBase({ own: true, depositOwn: true, deposits: true }) }), 'המסלול שלך (מגדל): כ-1,170 ש״ח בשנה, על הסכומים שלך. הזול מהסוג הזה: 1,150.', 'fees pension, own amounts (17.6 on gross)');
  eq(W.feesWords(b.rows.map(lab), null, { mode: 'yr', own: false, base: ex }), 'על דוגמה של 100,000 ש״ח: בין 540 ל-610 ש״ח בשנה.', 'fees, no own track');
  eq(W.feesWords([{ k: 'a', label: 'x', v: 550 }, { k: 'b', label: 'y', v: 560 }], null, { mode: 'yr', own: false, base: ex }), 'על דוגמה של 100,000 ש״ח: כמעט זהה בכל המסלולים, כ-550 ש״ח בשנה.', 'fees, spread under 20 ₪ (mockup v4 wording)');
  eq(W.feesWords([{ k: 'a', label: 'מגדל', v: 900 }, { k: 'b', label: 'y', v: 950 }], 'a', { mode: 'yr', own: true, base: 'על הסכומים שלך' }), 'המסלול שלך (מגדל): כ-900 ש״ח בשנה, על הסכומים שלך. הוא הזול מהסוג הזה.', 'fees, mine is the cheapest');
  eq(W.feesWords([{ k: 'a', label: 'x', v: null }], null, { mode: 'yr', own: false, base: ex }), 'אין דמי ניהול מפורסמים למסלולים האלה.', 'fees, none published');
  // hishtalmut: the like-for-like board, mine g880 (מיטב)
  const hb = M.feeBoard(hg, { mineK: 'g880' }), hlab = (r) => ({ k: r.k, label: r.k === 'g880' ? 'מיטב' : r.f.grp, v: r.v });
  eq(W.feesWords(hb.rows.map(hlab), 'g880', { mode: 'yr', own: false, base: ex }), 'המסלול שלך (מיטב): כ-600 ש״ח בשנה, על דוגמה של 100,000 ש״ח. האחרים: 540 עד 700.', 'fees hishtalmut, example (18.6)');
  const deposits = M.prodHasDeposit('השתלמות') && M.typeHasDepositFee(hg);
  const hb8 = M.feeBoard(hg, { mineK: 'g880', a: { balance: 80000, monthly: null } });
  eq(W.feesWords(hb8.rows.map(hlab), 'g880', { mode: 'yr', own: true, base: W.amountsBase({ own: true, depositOwn: false, deposits }) }), 'המסלול שלך (מיטב): כ-480 ש״ח בשנה, על היתרה שלך. הזול מהסוג הזה: 430.', 'fees hishtalmut, balance 80,000 (18.6)');
  // career: the age first, rounded to 100
  const c50 = M.feeBoard(pg, { mineK: 'p2102', a, mode: 'career', career: { age: 50 } });
  const cw = W.feesWords(c50.rows.map(lab), 'p2102', { mode: 'career', own: true, base: 'על הסכומים שלך', age: 50, ageOwn: true });
  ok(plain(cw).startsWith('מגיל 50 עד 67: המסלול שלך (מגדל): כ-') && plain(cw).includes(' ש״ח דמי ניהול עד הפרישה, בשקלי היום, על הסכומים שלך. הזול מהסוג הזה: '), 'career sentence pattern (16.1 2d)', plain(cw));
  ok(plain(W.feesWords(c50.rows.map(lab), 'p2102', { mode: 'career', own: false, base: ex, age: 38, ageOwn: false })).startsWith('מגיל 38 עד 67, לדוגמה: '), 'career on the example age: ", לדוגמה"');
  // board heads and lines
  eq(W.feesAvgLabel(5, 'yr'), 'ממוצע 5 המסלולים · בשנה', 'closing line (18.6)');
  eq(W.feesAvgLabel(5, 'career'), 'ממוצע 5 המסלולים · עד גיל 67', 'closing line, career');
  eq(W.feesBoardHead(12, W.typeName(HG)), '12 מסלולי השתלמות כללי, מהזול ליקר', 'board head');
  eq(W.feesMinePos(5, 12), '6 מתוך 12, מהזול ליקר', 'pinned own row (18.2 #2)');
  eq(W.SELF_HEAD + ' | ' + W.selfCount(7), 'בניהול אישי · לא בהשוואה | 7 מסלולים', 'self-managed group');
  eq(W.feeSub(0.14, 1.56) + ' | ' + W.feeSub(0.6, null), '0.14% מהחיסכון · 1.56% מכל הפקדה | 0.60% מהחיסכון', 'row quiet line');
  eq(W.feesStamp({ own: false, base: ex, balance: 100000, monthly: 2220, deposits: true, asof: ASOF }), 'דוגמה: חיסכון 100,000 ש״ח, הפקדה 2,220 ש״ח בחודש · דמי הניהול הממוצעים בכל מסלול (רשות שוק ההון, 10/26), לא מה שחוסך מסוים משלם · אומדן', 'fees stamp (7.2 #7)');
  eq(W.feesStamp({ own: true, base: 'על היתרה שלך', balance: 80000, monthly: 1200, deposits: false, asof: ASOF }), 'היתרה שלך: חיסכון 80,000 ש״ח · דמי הניהול הממוצעים בכל מסלול (רשות שוק ההון, 10/26), לא מה שחוסך מסוים משלם · אומדן', 'fees stamp, balance only, no deposit fee');
  eq(W.calcMine(false, true) + ' | ' + W.calcMine(false, false) + ' | ' + W.calcMine(true, true), 'לחשב על הסכומים שלי: כמה יש לי, כמה מפקידים | לחשב על הסכומים שלי: כמה יש לי | לשנות את הסכומים שלי', '#calc-mine');
  eq(W.amountsBtn(true), 'הסכומים שלי ✓', 'amounts pill');
  eq(W.ageExample(), 'להראות על דוגמה (גיל 38) ›', 'age step example');
  eq(W.amountsSub('מגדל · פנסיה כללי'), 'מגדל · פנסיה כללי · נשמר בדפדפן הזה, לכל מוצר בנפרד', 'amounts sheet sub (17.1 1a)');
}

/* ---- wording gate (18.6): nothing generated here says net, after fees, or "estimate" beside a return ---- */
{
  const all = Object.values(W).filter((v) => typeof v === 'string').join(' ');
  ok(!/נטו|אחרי דמי ניהול/.test(all), 'no "נטו" / "אחרי דמי ניהול" in any constant');
  // "אחוזון" appears only in NO_MOVERS, a line of the agent / Pro "שינויים" lens (17.1 2d), never in the saver door
  ok(!/ד"נ/.test(all) && !/1M|YTD|LTM|צמודים|מאסף|נק׳ אחוז/.test(all) && Object.entries(W).filter(([, v]) => typeof v === 'string' && /אחוזון/.test(v)).every(([k]) => k === 'NO_MOVERS'), 'no saver jargon in the constants');
}

console.log(`page-words: ${n - fail} passed, ${fail} failed`);
if (fail) process.exit(1);
