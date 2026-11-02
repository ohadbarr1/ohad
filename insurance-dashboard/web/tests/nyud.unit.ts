/* W7 (wave 2, agent door): the ניוד engine (lib/nyud), the הנמקה wording (lib/hanmaka), the branding (lib/branding) and the encrypted
   folder share (lib/clients). Hand-computed cases; every verbatim quote checked against the regulator's text in tests/fixtures/hanmaka.
   Run: npm run test:nyud */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { A1_COLS, BASIS_TEXT, UNCHANGED, allocOf, familyOf, annexPair, candLeg, checkDigit, coefDiff, coverDiff, feeDiff, fullCost, nyudTable, ownLeg, planOf, riskCost, seniority, type Candidate } from '../src/lib/nyud';
import { A1, DEFAULT_RULE, DOC_B, DOC_KINDS, FOLLOWED, FORBIDDEN, LETTER, PART_B, PART_C, PART_E, RULES, allQuotes } from '../src/lib/hanmaka';
import { EMPTY_BRAND, LOGO_MAX_BYTES, brandLine, hasBrand, logoBytes, normBranding } from '../src/lib/branding';
import { brandOfFile, decryptShare, encryptFolder, exportText, isShareFile, normClients, normFolder, type Folder, type Held } from '../src/lib/clients';
import type { CoefFile } from '../src/lib/coef';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number, e = 1e-6) => a != null && Math.abs(a - b) < e;

/* ---- the fixtures ---- */
const H = (o: Partial<Held> = {}): Held => ({ k: 'i1', typeHe: 'ביטוח מנהלים', provider: 'מבטח', plan: 'עדיף', track: 'כללי', balance: 300000, monthly: 2000, fee: 1.0, feeHow: 'מתנאי החשבון', depfee: 3, depHow: null, asof: '2026-09-30', covers: [{ name: 'אובדן כושר עבודה', kind: 'א.כ.ע', sum: 7000, cost: 120, rate: 75 }, { name: 'ריסק מוות', kind: 'מוות', sum: 500000, cost: 80, rate: null }], note: null, ...o });
const C = (k: string, o: Partial<Candidate> = {}): Candidate => ({ k, name: `מסלול ${k}`, prod: 'פנסיה מקיפה', track: 'עד 50', id: 100, mgr: 'מנהל', grp: 'קבוצה', pen: true, old: false, fee: 0.3, depfee: 2, a3g: 9, st: 55, dflt: null, ...o });
const IN = { age: 40, retire: 67, sex: 'm' as const, ret: 4 };
const COEF: CoefFile = { v: 1, asof: '2026-10', method: '', ages: [60, 62, 64, 65, 67, 70], options: { s60_g0: { survivors: 60, guarantee: 0, label: '60% לבן/בת זוג, בלי הבטחה' } },
  funds: { 'קבוצה': { src: { id: 's', kind: 'primary', title: 'תקנון', edition: '10/2026', url: 'https://x', retrieved: '2026-11-01', sha256: 'abc', pages: [40] }, tables: [{ opt: 's60_g0', sex: 'm', pages: [40], quote: 'q', years: [1985], ages: [67], v: [[190]] }], excluded: [] } },
  coverage: [], assumption: { coef: 200, m: 188, f: 204, title: 'a', url: 'https://a' }, btl: { single: 1, single_80: 1, couple: 1, from: '', title: '', url: '', retrieved: '', quote: '' }, target: { rate: 70, title: '', url: '', retrieved: '' } };

/* ---- fees ---- */
{
  const h = H(), c = C('p2'), t = C('i1', { prod: 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים', pen: false, fee: 1.1, depfee: 3.5 });
  ok(ownLeg(h, t).basis === 'file' && ownLeg(H({ fee: null }), t).basis === 'avg' && ownLeg(H({ fee: null }), null).basis === 'none', 'own fee: the file, else the matched track\'s average, else none');
  ok(candLeg(c).basis === 'avg' && candLeg(C('p9', { dflt: { t: '2024', fee: 0.22, depfee: 1 } })).basis === 'tender' && near(candLeg(C('p9', { dflt: { t: '2024', fee: 0.22, depfee: 1 } })).pair.fee, 0.22), 'candidate fee: the tender price when a default fund, else the average');
  const d = feeDiff(h, t, c, IN).d!;
  ok(d && d.balRealDiff > 0 && d.feesRealDiff > 0 && d.balCand > d.balOwn && near(d.years, 27), 'a cheaper candidate leaves more money by retirement (27 years)');
  ok(near(d.annualOwn, 300000 * 0.01 + 24000 * 0.03) && near(d.annualCand, 300000 * 0.003 + 24000 * 0.02), 'this year\'s fee cost: balance × fee + 12 × deposit × deposit fee');
  const same = feeDiff(h, t, C('p3', { fee: 1.0, depfee: 3 }), IN).d!;
  ok(near(same.balRealDiff, 0, 1e-6) && near(same.feesRealDiff, 0, 1e-6), 'the same fees: no difference');
  ok(feeDiff(H({ fee: null }), null, c, IN).d === null && /לא חושב/.test(feeDiff(H({ fee: null }), null, c, IN).why!), 'no own fee and no track: no figure, a reason');
  const pf = planOf({ ...IN, basis: 'fox' }, 1, 1), pb = planOf({ ...IN, basis: 'annexB' }, 1, 1);
  ok(pf.growth === 2 && pf.infl === 2 && pb.growth === 0 && pb.infl === 0 && pb.ret === 4, 'two bases: fox (2% / 2%) and annex B (0% / 0%, 4%)');
  const db = feeDiff(h, t, c, { ...IN, basis: 'annexB' }).d!;
  ok(db.balRealDiff > 0 && Math.abs(db.balRealDiff - d.balRealDiff) > 1, 'annex B basis gives a different (still positive) figure');
  ok(/4\.86/.test(BASIS_TEXT.annexB) && /lib\/retire/.test(BASIS_TEXT.fox), 'each basis says what it is, annex B names the designated-bond slice it does not model');
  const ex = feeDiff(H({ balance: null, monthly: null }), t, c, IN).d!;
  ok(ex.exBalance && ex.exMonthly && ex.balance === 100000, 'no balance in the file: the example amounts, flagged');
}

/* ---- covers ---- */
{
  const h = H();
  ok(near(riskCost([h]).v, 200) && riskCost([h]).n === 2 && riskCost([H({ covers: [{ name: 'בריאות', kind: null, sum: null, cost: 50, rate: null }] })]).v === null, 'risk covers: disability + death summed; a health cover is not a risk cover');
  const both = coverDiff(h, [H({ k: 'p2', covers: [{ name: 'נכות', kind: 'נכות', sum: null, cost: 90, rate: 75 }, { name: 'שאירים', kind: 'שאירים', sum: null, cost: 60, rate: null }] })]);
  ok(near(both.diff, 50) && both.exist === 200 && both.cand === 150, 'both sides with a cost: the monthly difference');
  const one = coverDiff(h, []);
  ok(one.diff === null && /הגוף המנהל/.test(one.why!), 'no candidate cost: null with the reason');
  ok(coverDiff(H({ covers: [] }), []).why!.includes('אין כיסוי'), 'no cover on the existing side: said so');
}

/* ---- the guaranteed coefficient ---- */
{
  const h = H({ coefGuaranteed: { v: 160, at: 67, src: 'file' } }), c = C('p2');
  const f = feeDiff(h, null, c, IN).d!;
  const r = coefDiff(h, c, f, COEF, IN).d!;
  ok(r && r.cand.real && r.cand.v === 190 && near(r.annG, f.balCand / 160) && near(r.annC, f.balCand / 190) && r.diff > 0 && /מתקנון/.test(r.text), 'guaranteed 160 against the fund\'s 190 from its bylaws: the same balance, two annuities');
  const a = coefDiff(h, C('p3', { grp: 'אחר' }), f, COEF, IN).d!;
  ok(a && !a.cand.real && a.cand.v === 188 && /הנחת האתר/.test(a.text), 'a fund with no table: the assumption, said so');
  const np = coefDiff(h, C('g5', { prod: 'גמל', pen: false }), f, COEF, IN);
  ok(np.d === null && /אינו קרן פנסיה/.test(np.why!), 'a non-pension candidate: no coefficient, a reason');
  ok(coefDiff(H(), c, f, COEF, IN).d === null && coefDiff(H(), c, f, COEF, IN).why === null, 'no guaranteed coefficient: nothing');
}

/* ---- seniority, notes, questions, annex rows ---- */
{
  const h = H({ k: 'g1', typeHe: 'קרן השתלמות', balance: 80000, monthly: 1200, fee: 0.7, depfee: null, covers: [] });
  ok(seniority(h, C('g1', { prod: 'השתלמות', pen: false })) !== null && /אינו משתנה/.test(seniority(h, C('g1', { prod: 'השתלמות', pen: false }))!.text), 'השתלמות, the same fund: the liquidity date does not move');
  const s = seniority(h, C('g2', { prod: 'השתלמות', pen: false }))!;
  ok(/6 שנים/.test(s.text) && /הוותק נשמר/.test(s.text) && /2008/.test(s.src) && /לא נבדק/.test(s.src), 'another fund: the clock, both cases, the source (with its unverified part named)');
  ok(seniority(H(), C('p2')) === null, 'not השתלמות: no seniority line');
  const t = nyudTable([H(), h], [C('i1', { prod: 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים', pen: false }), C('p2', { dflt: { t: '2024', fee: 0.22, depfee: 1 } }), C('p3')], { i1: 'קיים', p2: 'נבחן', p3: 'מומלץ' }, COEF, IN, '09/2026');
  ok(t.rows.length === 2 && t.cands.map((c) => c.k).join() === 'p3,p2' && t.exist.length === 2 && t.skipped.length === 2 && t.skipped.every((x) => /לא ניוד באותה משפחת מוצרים/.test(x)), 'two existing × two candidates, recommended first; the השתלמות product is not paired with pension candidates (not a ניוד), said so');
  ok(familyOf('קרן השתלמות') === 'hish' && familyOf('השתלמות') === 'hish' && familyOf('ביטוח מנהלים') === 'kitzba' && familyOf('פנסיה מקיפה') === 'kitzba' && familyOf('גמל') === 'kitzba' && familyOf('גמל להשקעה') === 'invest' && familyOf('מרכזית לפיצויים') === 'other', 'families: annuity products together, השתלמות apart, גמל להשקעה apart');
  const hh = nyudTable([h], [C('g2', { prod: 'השתלמות', pen: false, fee: 0.5, depfee: 0 })], { g2: 'מומלץ' }, COEF, IN, '09/2026');
  ok(hh.rows.length === 1 && hh.rows[0].seniority != null && hh.rows[0].fee != null, 'השתלמות against השתלמות: a row with the seniority line');
  const r = t.rows[0];
  ok(r.cand.k === 'p3' && r.fee && r.annex.before['דמי ניהול מחיסכון מצטבר'].includes('1.00%') && r.annex.after['דמי ניהול מחיסכון מצטבר'].includes('0.30%'), 'annex rows: before (the client\'s own) and after (the candidate\'s average)');
  ok(A1_COLS.length === 10 && Object.keys(r.annex.before).length === 10 && Object.keys(r.annex.after).length === 10, 'ten columns of part א.1');
  const same = annexPair(H({ k: 'p9' }), C('p9', { st: 55 }), C('p8', { st: 55 }), null, null, '09/2026');
  ok(same.after['רמת הסיכון של מסלול ההשקעה'] === UNCHANGED && same.after['המלצה'] === '', '"לא שונה" where a parameter does not change (§5א(1)(ח)), never in the recommendation column');
  const dr = t.rows.find((x) => x.cand.k === 'p2')!;
  ok(dr.fee!.cand.basis === 'tender' && dr.notes.some((n) => /ברירת מחדל/.test(n) && /10 שנים/.test(n)), 'a default-fund candidate: the tender price and its note');
  ok(r.notes.some((n) => /קרן פנסיה, נזילות/.test(n)) && r.notes.some((n) => /ביטוח מנהלים/.test(n) && /מקדם/.test(n)), 'the rules\' liquidity line and the managers\'-insurance reminder');
  const g = nyudTable([H({ coefGuaranteed: { v: 150, at: null, src: 'agent' } })], [C('p2')], { p2: 'מומלץ' }, COEF, IN, '09/2026');
  ok(g.rows[0].questions.length === 1 && g.rows[0].questions[0].id === 'א' && /מקדם 150/.test(g.rows[0].questions[0].detail), 'a guaranteed coefficient answers question (א) in the affirmative');
  ok(r.questions.length === 0, 'no guaranteed coefficient, no old fund: no question');
  const fc = fullCost(t.rows)!;
  ok(fc.n === 2 && fc.own > 0 && fc.cand > 0, 'the full cost line sums the rows that have a figure');
  ok(nyudTable([H({ k: 'p3' })], [C('p3')], { p3: 'מומלץ' }, COEF, IN, '').skipped.length === 1, 'a product already in the candidate\'s track is skipped and said');
  ok(JSON.stringify(t.rows).indexOf('אשתקד') < 0 && !FORBIDDEN.test(JSON.stringify(t.rows)), 'no forbidden words in the rows');
}

/* ---- the allocation mechanism ---- */
{
  const m = allocOf('חלוקה לפי ספרת הביקורת בתעודת הזהות: 7,8,9 אינפיניטי · 4,5,6 מור · 2,3 אלטשולר שחם · 0,1 מיטב; חלה על מעסיק של 50 עובדים ומעלה מ-01.06.25');
  ok(m.size === 10 && m.get(7) === 'אינפיניטי' && m.get(4) === 'מור' && m.get(2) === 'אלטשולר שחם' && m.get(0) === 'מיטב' && m.get(1) === 'מיטב', 'every check digit maps to a selected fund');
  ok(allocOf(null).size === 0 && allocOf('בלי מנגנון').size === 0, 'no mechanism: an empty map');
  ok(checkDigit('012345678') === 8 && checkDigit('x') === null, 'the check digit is the last digit');
  ok(DEFAULT_RULE.employees === 50 && DEFAULT_RULE.from === '2025-06-01' && /2025-1264/.test(DEFAULT_RULE.src.title), 'the employer threshold with its source');
}

/* ---- the binding wording: every quote verbatim in the regulator's text ---- */
{
  const dir = join(process.cwd(), 'tests/fixtures/hanmaka');
  const norm = (s: string) => s.replace(/למה\?/g, '').replace(/[\s.,:;"'()!?–\-_’“”«»♥׳״]/g, '');
  const texts = ['2018-10-11.txt', 'draft-2025-3.txt', '2024-9-6.txt', '2025-1264.txt'].filter((f) => existsSync(join(dir, f))).map((f) => norm(readFileSync(join(dir, f), 'utf8')));
  ok(texts.length === 4, 'four regulator texts in the fixtures');
  /** The PDF's text layer puts a clause label ("(ב)", "ג.", "שים לב", a footnote digit, a struck-out insertion) INSIDE some sentences
   *  where the layout broke a line: those quotes are checked in pieces, split just before the marker word listed here. */
  const splits: [string, string[]][] = [
    ['יידע את עובדיו לגבי הקרן הנבחרת', ['הקרן הנבחרת בהתאם']], ['מקדם המרה המגלם הבטחת תשואה', ['תשואה, או הפסקת']], ['שינויים בתוחלת החיים אינם משפיעים', ['משפיעים על עדכון']],
    ['שינויים בתשואה אינם משפיעים', ['משפיעים על עדכון']], ['אם החסרת מידע רלוונטי', ['תוכל לעדכן']], ['להלן רשימת הגופים המוסדיים', ['הרשימה מסודרת', 'קיבלתי את מירב']],
    ['בעל רישיון לא ישנה את נוסח', ['למעט הוספת']], ['הנמקה לא תהיה במונחים', ['המתאים ביותר ללקוח']], ['החל מיום 1 ביוני 2025, מעסיק', ['שעובדו לא בחר']],
  ];
  const piecesOf = (text: string): string[] => {
    const sp = splits.find(([k]) => text.includes(k));
    if (!sp) return [text];
    let rest = text; const out: string[] = [];
    for (const m of sp[1]) { const i = rest.indexOf(m); if (i < 0) return [text]; out.push(rest.slice(0, i)); rest = rest.slice(i); }
    out.push(rest);
    return out.map((x) => x.replace(/_+/g, '').replace(/\d{4}$/, '')).filter((x) => x.trim().length > 3);
  };
  let n = 0;
  for (const l of allQuotes()) {
    const parts = piecesOf(l.text);
    const found = parts.every((pt) => texts.some((t) => t.includes(norm(pt))));
    ok(found, `verbatim in the regulator's text: ${l.sec} "${l.text.slice(0, 50)}…"`);
    n++;
  }
  ok(n >= 45, `${n} verbatim quotes checked`);
  ok(LETTER.length === 4 && /לקוח יקר/.test(LETTER[0].text) && /חתום/.test(LETTER[2].text), 'the opening letter');
  ok(/אזהרה/.test(A1.warning.text) && /משיכת פיצויי הפיטורין/.test(A1.warning.text), 'the withdrawal warning');
  ok(A1.questions.length === 6 && PART_B.items.length === 7 && PART_B.decl.length === 3 && PART_E.sigs.length === 3, 'six questions, seven characteristics, three declarations, three signatures');
  ok(PART_C.listCols.length === 5 && PART_C.nonPenCols.length === 3, 'part ג tables');
  ok(DOC_KINDS.length === 3 && DOC_KINDS.map((d) => d.sec).join() === '§4(א),§4(ב),§4(ג)', 'the three document types of §4');
  ok(RULES.some((r) => r.sec === '§3(ג)' && r.kind === 'q') && FOLLOWED.length >= 10, 'the no-change rule quoted; the followed sections listed');
  const all = JSON.stringify({ A1, PART_B, PART_C, PART_E, RULES, DOC_B, DOC_KINDS }).replace(FORBIDDEN.source, '');
  ok(!/אנו ממליצים|fox ממליץ|מומלץ לעבור/.test(all), 'the module never recommends');
  ok(DOC_B.items.length === 7 && DOC_B.defaultNotice.length === 5 && /מבנה של fox/.test(DOC_B.fox) && DOC_B.src.every((s) => /^https:\/\/www\.gov\.il/.test(s.url)), 'מסמך ב\': seven items, five quoted notices, labelled fox\'s structure, gov.il sources');
  ok(DOC_B.src[0].note != null && /לא נקרא כאן/.test(DOC_B.src[0].note!), 'the joining circular\'s items are marked as read from a secondary source');
}

/* ---- branding ---- */
{
  const b = normBranding({ name: ' ישראל ישראלי ', lic: '12-345', phone: '050', email: 'a@b.c', co: 'סוכנות', coId: '51', logo: 'data:image/png;base64,' + 'A'.repeat(400) });
  ok(b.name === 'ישראל ישראלי' && b.lic === '12345' && b.logo != null && hasBrand(b) && !hasBrand(EMPTY_BRAND), 'normalised: trimmed, digits only in the licence');
  ok(/ישראל ישראלי, רישיון 12345/.test(brandLine(b)) && /סוכנות \(ח\.פ\. 51\)/.test(brandLine(b)), 'the brand line');
  ok(logoBytes('data:image/png;base64,' + 'A'.repeat(400)) === 300 && logoBytes('data:image/png;base64,QUJD') === 3 && logoBytes('data:image/png;base64,QUI=') === 2, 'base64 byte count');
  const big = normBranding({ logo: 'data:image/png;base64,' + 'A'.repeat(Math.ceil((LOGO_MAX_BYTES + 100) * 4 / 3)) });
  ok(big.logo === null && normBranding({ logo: 'data:text/html;base64,QUJD' }).logo === null && normBranding(null).name === '', 'an oversized or non-image logo is dropped; garbage gives the empty brand');
  const f = exportText({ kind: 'fox-clients', v: 2, folders: [] }, '2026-11-02', b);
  ok(brandOfFile(JSON.parse(f)) != null && normBranding(brandOfFile(JSON.parse(f))).lic === '12345' && brandOfFile({}) === null, 'the branding rides in the backup file and comes back');
}

/* ---- the encrypted share ---- */
{
  const folder: Folder = normFolder({ id: 'abcd1234', label: 'ד.כ.', keys: ['p2155'], b: 'net', tags: { p2155: 'קיים' }, fields: { 'r:fit': 'טקסט' }, note: 'הערה', created: '2026-10-01', updated: '2026-10-02', held: [H()] })!;
  const text = await encryptFolder(folder, 'סיסמה-ארוכה-1', '2026-11-02');
  const parsed = JSON.parse(text);
  ok(isShareFile(parsed) && parsed.alg === 'AES-GCM' && parsed.kdf === 'PBKDF2-SHA-256' && parsed.iter >= 100000 && !text.includes('ד.כ.".') && !text.includes('p2155'), 'an AES-GCM file: no folder content in clear (the label alone rides outside for the file name)');
  const back = await decryptShare(text, 'סיסמה-ארוכה-1');
  ok(back.id === 'abcd1234' && back.label === 'ד.כ.' && back.keys[0] === 'p2155' && back.fields['r:fit'] === 'טקסט' && back.held.length === 1 && back.held[0].balance === 300000, 'round trip: the folder as saved');
  let err = '';
  try { await decryptShare(text, 'סיסמה-אחרת-2'); } catch (e) { err = (e as Error).message; }
  ok(/שגויה/.test(err), 'a wrong passphrase: a Hebrew error');
  err = '';
  try { await encryptFolder(folder, 'קצר', '2026-11-02'); } catch (e) { err = (e as Error).message; }
  ok(/8 תווים/.test(err), 'a short passphrase is refused');
  err = '';
  try { await decryptShare('{"kind":"x"}', 'סיסמה-ארוכה-1'); } catch (e) { err = (e as Error).message; }
  ok(/אינו קובץ שיתוף/.test(err), 'not a share file: said so');
  ok(normClients({ kind: 'fox-clients', v: 2, folders: [back] }).folders.length === 1, 'the decrypted folder merges like any import');
}

console.log(`nyud: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
