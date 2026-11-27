// P6 F1 (spec 3.4, 4, 5.3, 5.5, 13.1–13.2, 14.1 N4): node test for src/lib/peerWords.ts and src/lib/companyWords.ts.
// Run: node scripts/p6-words-test.mjs
// The board sentences are built on the COMMITTED data (public/data/peers/*, companies/*.price.json, mkt.json, changes/*.json) through
// lib/peerBoard, as a page would, and compared with the exact Hebrew of the spec. Data-period guard (9.5, 14.6): the exact-text
// assertions on figures run when reportStatus('ins') gives bq = 2026Q3 with exactly הפניקס, הראל, מגדל reported (spot sentences also
// need the 25.11.26 close); otherwise only sentence shapes (regular expressions) run. The guard prints which mode ran.
// Harel's spec sentence names a top change that the data has since re-ranked ("רווח תפעולי … −613" → today's first item): the spec's
// exact sentence runs on its own inputs (SYNTHETIC top), the live sentence runs on changes/harel.json. Other cases no fixture reaches
// (a loss, a missing base, windows, fewer than two companies, the expected date) are SYNTHETIC and marked.
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(web, 'public/data');
const tmp = mkdtempSync(join(tmpdir(), 'p6-words-'));
let n = 0, fails = 0;
const ok = (c, msg, got) => { n++; if (!c) { fails++; console.error(`FAIL ${msg}${got !== undefined ? `\n  got: ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`); } };
let X;
try {
  const entry = join(tmp, 'entry.ts');
  writeFileSync(entry, ['peerBoard', 'peerWords', 'companyWords'].map((f) => `export * from '${join(web, `src/lib/${f}`)}';`).join('\n') + `\nexport * as Q from '${join(web, 'src/lib/quarters')}';\nexport { Book } from '${join(web, 'src/lib/registry')}';\n`);
  const out = join(tmp, 'b.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{"BASE_URL":"/","DEV":false,"PROD":true,"MODE":"test"}' } });
  X = await import(pathToFileURL(out).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }
const { Book, Q } = X;

/* the reader's text: isolates checked once, then stripped; bold is plain */
const ISO = /⁦[^⁦⁩]*⁩/;
const txt = (parts) => X.wordsText(parts).replace(/[⁦⁩]/g, '');
const same = (parts, want, msg) => ok(parts && txt(parts) === want, `${msg}\n  want: ${want}`, parts ? txt(parts) : parts);
const like = (parts, re, msg) => ok(parts && re.test(txt(parts)), `${msg} (${re})`, parts ? txt(parts) : parts);
const NEVER = /אשתקד|רבעון נוכחי|שנה שעברה|ו-−|\d\.0 מיליוני/;
const clean = (parts, msg) => ok(!NEVER.test(txt(parts)), `${msg}: no "אשתקד", "רבעון נוכחי", "ו-−" or ".0 מיליוני"`, txt(parts));

/* ---------- the committed data, through lib/peerBoard ---------- */
const reg = JSON.parse(readFileSync(join(data, 'peers/registry.json'), 'utf8'));
const files = new Map(reg.metrics.map((m) => [m.f, JSON.parse(readFileSync(join(data, `peers/m/${m.f}.json`), 'utf8'))]));
const book = new Book(reg, files);
const ents = reg.sets.find((s) => s.id === 'ins').ids;
const px = Object.fromEntries(ents.map((e) => { try { return [e, JSON.parse(readFileSync(join(data, `companies/${e}.price.json`), 'utf8'))]; } catch { return [e, null]; } }));
const mk = JSON.parse(readFileSync(join(data, 'mkt.json'), 'utf8'));
const st = X.reportStatus(book, ents), qReg = book.latest('reg:assets@all', 'LTM', ents);
const C = { book, ents, q: st.bq, qReg, px, mk, status: st };
const NUM = st.bq === '2026Q3' && st.reported.join() === 'phoenix,harel,migdal';
const PX = NUM && ents.every((e) => !px[e] || px[e].asof === '2026-11-25');
console.log(`guard: bq=${st.bq} cq=${st.cq} reported=${st.reported.join(',')} → ${NUM ? 'NUMERIC' : 'STRUCTURAL'} mode${NUM && !PX ? ' (prices moved: spot sentences structural)' : ''}`);
const name = (e) => book.short(e), M = (k) => X.BBY.get(k), board = (k, rd, c = C) => X.boardRows(c, M(k), rd);

/* ---------- isolates and parts ---------- */
{
  const p = X.peersWords(board('csm', 'qoq'), 'phoenix', name);
  ok(ISO.test(X.wordsText(p)), 'figures are wrapped LRI … PDI');
  ok(p.filter((x) => x.k === 'n' && x.ref).every((x) => x.ref.k === 'row' || x.ref.k === 'med'), 'every tappable figure points at a row or the median');
  ok(p.some((x) => x.k === 'n' && x.ref?.k === 'med' && x.sup === board('csm', 'qoq').n), "the sentence's median carries its n");
  ok(X.wordsText(p, { sup: true }).includes('³'), 'the n renders as a superscript on request');
  ok(p.some((x) => x.k === 'basis'), 'a change carries its basis part');
}

/* ---------- peersWords (3.4) ---------- */
// every metric and reading: a sentence of the right shape, and clean
for (const m of X.boardMetrics(ents.map(() => 'ins'))) for (const rd of m.reads) {
  const b = board(m.key, rd), p = X.peersWords(b, 'phoenix', name);
  const ranked = b.rows.filter((r) => !r.out && r.v != null).length;
  if (ranked < 2) like(p, /^אין מספיק חברות עם .+ להשוואה\.$/, `${m.key}:${rd} too few`);
  else like(p, /^.+: (הזולה|הגבוהה|הנמוכה) .+, .+; (היקרה|הנמוכה|הגבוהה) .+, .+\. חציון .+\.( .+)?$/, `${m.key}:${rd} shape`);
  clean(p, `${m.key}:${rd}`);
  if (m.type !== 'spot') ok(!/הזולה|היקרה/.test(txt(p)), `${m.key}:${rd} "הזולה" only on a multiple`, txt(p));
  if (b.strict && b.rows.some((r) => r.out)) like(p, new RegExp(`בדירוג: \\d שדיווחו ${Q.qlab(b.q)}\\.$`), `${m.key}:${rd} strict tail`);
  if (X.Q.isChg(rd) && ranked >= 2) ok(txt(p).includes(`(${X.basisText(m, rd, b.q)})`), `${m.key}:${rd} basis inside the sentence`, txt(p));
}
if (NUM) {
  if (PX) {
    same(X.peersWords(board('pbc', 'now'), 'phoenix', name), 'P/(B+CSM): הזולה מגדל, 0.85x; היקרה הפניקס, 2.15x. חציון 1.50x.', 'spec 3.4 live example 1 (focus at an end: two sentences)');
    same(X.peersWords(board('pbc', 'now'), 'harel', name), 'P/(B+CSM): הזולה מגדל, 0.85x; היקרה הפניקס, 2.15x. חציון 1.50x. הראל: 1.45x, מקום 3 מתוך 6.', 'focus in the middle');
    same(X.peersWords(board('pbc', 'now'), 'hachshara', name), 'P/(B+CSM): הזולה מגדל, 0.85x; היקרה הפניקס, 2.15x. חציון 1.50x. להכשרה אין נתון.', 'focus without a figure (no listed share)');
  }
  same(X.peersWords(board('csm', 'qoq'), 'phoenix', name), "CSM QoQ (Q3'26 מול Q2'26): הגבוהה הפניקס, +7.1%; הנמוכה הראל, +1.0%. חציון +3.5%. בדירוג: 3 שדיווחו Q3'26.", 'spec 3.4 live example 2 (+ the basis, 13.1 F2)');
  same(X.peersWords(board('csm', 'qoq'), 'migdal', name), "CSM QoQ (Q3'26 מול Q2'26): הגבוהה הפניקס, +7.1%; הנמוכה הראל, +1.0%. חציון +3.5%. מגדל: +3.5%, מקום 2 מתוך 3. בדירוג: 3 שדיווחו Q3'26.", 'focus in the middle of a strict reading');
  same(X.peersWords(board('csm', 'qoq'), 'clal', name), "CSM QoQ (Q3'26 מול Q2'26): הגבוהה הפניקס, +7.1%; הנמוכה הראל, +1.0%. חציון +3.5%. כלל טרם דיווחה Q3'26. בדירוג: 3 שדיווחו Q3'26.", 'focus has not reported');
  same(X.peersWords(board('oshare', 'yoy'), 'phoenix', name), "נתח שוק YoY (Q3'26 מול Q3'25): הגבוהה הפניקס, +0.34 נק׳; הנמוכה מנורה, −0.19 נק׳. חציון +0.21 נק׳.", 'spec 3.4 live example 3 (+ basis)');
  same(X.peersWords(board('np', 'q'), 'phoenix', name), "רווח נקי Q3'26: הגבוהה מגדל, 526; הנמוכה הראל, 462. חציון 518. הפניקס: 518, מקום 2 מתוך 3. בדירוג: 3 שדיווחו Q3'26.", 'a flow\'s quarter is named after the quarter');
  same(X.peersWords(board('np', 'ltmy'), 'migdal', name), "רווח נקי LTM YoY (LTM Q3'26 מול LTM Q3'25): הגבוהה הכשרה, +55.7%; הנמוכה הפניקס, −1.7%. חציון +23.2%. מגדל: +23.2%, מקום 4 מתוך 7.", 'LTM YoY: carried, counted, no strict tail');
  like(X.peersWords(board('onet', 'yoy'), 'phoenix', name), /^צבירה נטו YoY \(Q3'26 מול Q3'25\): הגבוהה כלל, \+10\.0 מ׳ד; הנמוכה הפניקס, −2\.5 מ׳ד\. חציון \+2\.5 מ׳ד\.$/, 'net accumulation YoY in ₪bn');
}
// SYNTHETIC: fewer than two
same(X.peersWords({ m: M('csm'), rd: 'qoq', q: '2026Q3', rows: [{ e: 'a', v: 1, out: false, place: 1 }, { e: 'b', v: null, out: false, place: null }], med: { v: 1, n: 1, parts: [] }, band: 0.2, strict: true, n: 1 }, 'a', (e) => e),
  'אין מספיק חברות עם CSM להשוואה.', 'SYNTHETIC: fewer than two ranked companies');
// direction words
ok(X.endWords(M('pbc')).join() === 'הזולה,היקרה' && X.endWords(M('owdr')).join() === 'הנמוכה,הגבוהה' && X.endWords(M('csm')).join() === 'הגבוהה,הנמוכה', 'end words: multiple / lower-is-better / other');
ok(X.placeText(6, 6, M('pbc')) === 'מקום 6 מ-6, 1 = הזולה' && X.placeText(2, 7, M('roe')) === 'מקום 2 מ-7, 1 = הגבוהה', 'a place carries its direction (M16)');

/* ---------- focusWords (3.4) ---------- */
{
  const pb = board('pb', 'now'), roe = board('roe', 'ltm');
  like(X.focusWords('harel', pb, roe, name), /^הראל נסחרת ב-P\/B של [\d.]+x מול חציון [\d.]+x \((פרמיה|דיסקאונט) של \d+%\), עם ROE של [\d.]+% מול חציון [\d.]+%\. (המכפיל והתשואה להון באותו צד של החציון|תשואה להון מעל החציון במכפיל מתחתיו|מכפיל מעל החציון בתשואה להון מתחתיו|התשואה להון בגובה החציון)\.$/, 'focus lede shape');
  same(X.focusWords('hachshara', pb, roe, name), 'להכשרה אין מניה נסחרת או שחסר נתון; מוצגים נתוני העסק והפעילות בלבד.', 'focus without a listed share');
  if (PX) {
    same(X.focusWords('phoenix', pb, roe, name), 'הפניקס נסחרת ב-P/B של 3.10x מול חציון 2.49x (פרמיה של 25%), עם ROE של 24.0% מול חציון 23.9%. התשואה להון בגובה החציון.', 'tie branch: ROE within 0.2 of the median (tester B9)');
    same(X.focusWords('migdal', pb, roe, name), `מגדל נסחרת ב-P/B של 1.63x מול חציון 2.49x (דיסקאונט של 34%), עם ROE של 18.1% מול חציון 23.9%. המכפיל והתשואה להון באותו צד של החציון.`, 'both under the median');
  }
}

/* ---------- the guard line, tags, the median legend (13.2, 14.1) ---------- */
if (NUM) {
  const g = X.guardWords(st, 'latest', name);
  same(g.parts, "3 מתוך 7 דיווחו Q3'26. כלל, מנורה, הכשרה, איילון: לפי Q2'26, מסומנות ונספרות. רבעון בודד, YoY ו-QoQ של הרבעון: רק מי שדיווח.", 'guard line (13.2 rule 4)');
  ok(g.action === "הכול על Q2'26 ›", 'guard action', g.action);
  const gc = X.guardWords(st, 'common', name);
  same(gc.parts, "מוצג על בסיס Q2'26, הרבעון האחרון שכל 7 החברות דיווחו.", 'guard, common basis'); ok(gc.action === "חזרה ל-Q3'26 ›", 'common action', gc.action);
  ok(X.outHead(st.bq) === "לא בדירוג ולא בחציון: הדוח ל-Q3'26 טרם פורסם", 'the set-aside sub-head');
  const cq = board('csm', 'qoq'), tagOf = (b, e) => X.rowTag(b.rows.find((r) => r.e === e), b.m);
  ok(tagOf(cq, 'clal').s === "Q2'26 · טרם דיווחה" && tagOf(cq, 'clal').warn, 'set-aside tag');
  ok(tagOf(board('csmeq', 'q'), 'clal').s === "Q2'26", 'carried tag: its quarter');
  ok(tagOf(board('sr', 'q'), 'harel').s === "H1'26" && tagOf(board('sr', 'q'), 'menora').s === "FY'25", 'a half-year metric carries its period');
  if (PX) ok(tagOf(board('pbc', 'now'), 'hachshara').s === 'אין מניה נסחרת', 'no listed share: on stock metrics');
  ok(tagOf(board('onet', 'ltm'), 'hachshara').s === 'אין נתון', '"אין נתון" on a non-stock metric (M8)');
  if (PX) same(X.medWords(board('pbc', 'now')), 'חציון 1.50x · 6 חברות', 'median legend (T-G1b)');
  same(X.medWords(cq), "חציון +3.5% · 3 שדיווחו Q3'26", 'median legend, quarter-named');
  // the close rule (14.1): Phoenix 3.49x on the grid at Q3'26, 3.10x on the board
  if (PX) {
    const gv = X.gridRow(C, M('pb'), 'now', st.bq).cells.find((c) => c.e === 'phoenix').v, bv = board('pb', 'now').rows.find((r) => r.e === 'phoenix').v;
    same(X.closeRuleWords({ q: st.bq, qClose: X.closeAt(mk, 'phoenix', st.bq), lastClose: px.phoenix.asof, e: 'phoenix', name: name('phoenix'), grid: X.fmtRead(M('pb'), 'now', gv), board: X.fmtRead(M('pb'), 'now', bv) }),
      "ברשת: שווי השוק בסגירת סוף כל רבעון (Q3'26: 30.09.26) ÷ הנתון המדווח. בלוח: הסגירה האחרונה, 25.11.26. לכן הפניקס: 3.49x ברשת ל-Q3'26, 3.10x בלוח.", 'the close rule (14.1, T-R2a)');
  }
}
// structural guard shape, always
{
  const g = X.guardWords(st, 'latest', name);
  if (st.waiting.length) like(g.parts, /^\d+ מתוך \d+ דיווחו Q\d'\d\d\. .+: לפי .+, (מסומנות ונספרות|מסומנת ונספרת)\. רבעון בודד, YoY ו-QoQ של הרבעון: רק מי שדיווח\.$/, 'guard shape');
  else ok(g === null, 'no guard when everyone reported');
  const five = { ...st, waiting: ['a', 'b', 'c', 'd', 'e'], last: { ...st.last, a: '2026Q2', b: '2026Q2', c: '2026Q2', d: '2026Q2', e: '2026Q2' }, reported: ['x', 'y'], n: 7, bq: '2026Q3', cq: '2026Q2' };
  like(X.guardWords(five, 'latest', (e) => e).parts, /^2 מתוך 7 דיווחו Q3'26\. 5 חברות: לפי Q2'26, מסומנות ונספרות\./, 'SYNTHETIC: more than four waiting → a count');
  const one = { ...five, waiting: ['a'], reported: ['b', 'c', 'd', 'e', 'f', 'g'] };
  like(X.guardWords(one, 'latest', (e) => e).parts, /^6 מתוך 7 דיווחו Q3'26\. a: לפי Q2'26, מסומנת ונספרת\./, 'SYNTHETIC: one waiting → singular');
}
ok(X.daggerNote('gross', 'net') === '† ה-CSM של הרבעון הודפס על בסיס אחר (ברוטו) מהבסיס הנוכחי של החברה (נטו); שינוי מול רבעון כזה אינו מחושב.', 'the † line (14.3 rule 4)');

/* ---------- companyWords (5.3, M13, N4) ---------- */
const npQ = (e, q) => book.get('ifrs:profit_attributable', e, 'Q', q).v;
const roeOf = (e) => board('roe', 'ltm').rows.find((r) => r.e === e).v;
const chg = (e) => JSON.parse(readFileSync(join(data, `changes/${e}.json`), 'utf8')).reports[0];
const topOf = (r) => { const it = r.items?.[0]; return it ? { l: it.l, d: it.d.v, cmp: it.cmp, u: it.d.u === 'pp' ? 'pp' : undefined } : null; };
// the spec's sentence, on the spec's inputs (Harel's top change as the spec printed it: SYNTHETIC top)
same(X.companyWords({ q: '2026Q3', np: 462, npY: 462 / (1 - 0.46), npQ: 462 / (1 - 0.567), roe: 23.9, top: { l: 'רווח תפעולי לפני מסים על ההכנסה', d: -613, cmp: 'YoY' } }),
  'Q3\'26: רווח נקי 462 מיליוני ש"ח, −46.0% YoY, −56.7% QoQ. ROE LTM 23.9%. השינוי המהותי ביותר: רווח תפעולי לפני מסים על ההכנסה, −613 YoY.', 'spec 5.3 Harel example, comma joins (M13)');
{
  const p = X.companyWords({ q: '2026Q3', np: 462, npY: 855.6, npQ: 1067, roe: 23.9 });
  const units = p.filter((x) => x.k === 'n').map((x) => `${x.pre ?? ''}${x.s}${x.post ?? ''}`);
  ok(units.indexOf('−46.0% YoY') >= 0 && units.indexOf('−46.0% YoY') < units.indexOf('−56.7% QoQ'), 'N4: the YoY unit precedes the QoQ unit', units);
  ok(units.includes('ROE LTM 23.9%'), 'N4: "ROE LTM 23.9%" is one unit', units);
  ok(p.filter((x) => x.k === 'n').every((x) => x.ref?.k === 'co'), 'every company figure is tappable to its source');
  ok(X.wordsText(p).includes('⁦−46.0% YoY⁩') && X.wordsText(p).includes('⁦ROE LTM 23.9%⁩'), 'each unit is one isolate');
}
if (NUM) {
  // live: Clal (Q2'26) exactly as the spec prints it; Harel with today's first change
  const cr = chg('clal');
  same(X.companyWords({ q: st.last.clal, np: npQ('clal', '2026Q2'), npY: npQ('clal', '2025Q2'), npQ: npQ('clal', '2026Q1'), roe: roeOf('clal'), top: cr.p === st.last.clal ? topOf(cr) : null }),
    'Q2\'26: רווח נקי 617 מיליוני ש"ח, +14.5% YoY, +41.2% QoQ. ROE LTM 22.7%. השינוי המהותי ביותר: הון לבעלי המניות, +620 QoQ.', 'spec 5.3 Clal example on the committed data');
  const hr = chg('harel'), ht = topOf(hr);
  const hw = X.companyWords({ q: '2026Q3', np: npQ('harel', '2026Q3'), npY: npQ('harel', '2025Q3'), npQ: npQ('harel', '2026Q2'), roe: roeOf('harel'), top: hr.p === '2026Q3' ? ht : null });
  like(hw, new RegExp(`^Q3'26: רווח נקי 462 מיליוני ש"ח, −46\\.0% YoY, −56\\.7% QoQ\\. ROE LTM 23\\.9%\\. השינוי המהותי ביותר: ${ht.l.replace(/[()|.]/g, '\\$&')}, [+−][\\d,]+ (YoY|QoQ)\\.$`), 'Harel live sentence (figures of the spec, today\'s first change)');
  clean(hw, 'Harel live');
  // a company that has not reported (Clal): the line under the sentence
  same(X.waitingWords({ bq: st.bq, q: st.last.clal, pub: cr.pub, reported: st.reported.length, total: st.n }), "הדוח ל-Q3'26 טרם פורסם; מוצג Q2'26, שפורסם 19.08.26. 3 מתוך 7 המבטחות כבר דיווחו.", 'waitingWords (5.5) on the committed data');
  const h = chg('harel');
  ok(X.companyStamp({ name: 'הראל', q: '2026Q3', pub: h.pub, pages: h.pages }) === "דוחות הראל, Q3'26 · פורסם 23.11.26 · 193 עמ׳ · כפי שהודפס · YoY מול Q3'25, QoQ מול Q2'26 · ROE: רווח LTM ÷ הון ממוצע (נגזר)", 'the company stamp (5.2 item 7)');
}
// SYNTHETIC cases of 5.3
same(X.companyWords({ q: '2026Q3', np: 462, npY: null, npQ: 1067, roe: 23.9 }), 'Q3\'26: רווח נקי 462 מיליוני ש"ח, −56.7% QoQ. ROE LTM 23.9%.', 'SYNTHETIC: no YoY base → the part and its connector are dropped; no top → ends after ROE');
same(X.companyWords({ q: '2026Q3', np: -120, npY: 60, npQ: -40 }), 'Q3\'26: הפסד של 120 מיליוני ש"ח, −180 מיליוני ש"ח YoY, −80 מיליוני ש"ח QoQ.', 'SYNTHETIC: a loss; changes from or to a loss are absolute');
same(X.companyWords({ q: '2026Q3', np: 300, npY: -50, npQ: 200, roe: 9.04 }), 'Q3\'26: רווח נקי 300 מיליוני ש"ח, +350 מיליוני ש"ח YoY, +50.0% QoQ. ROE LTM 9.0%.', 'SYNTHETIC: from a loss to a profit');
same(X.companyWords({ q: '2026Q3', win: '9m', np: 1500, npY: 1200, npQ: 999, roe: 20 }), "9M'26: רווח נקי 1,500 מיליוני ש\"ח, +25.0% YoY. ROE LTM 20.0%.", 'SYNTHETIC: 9M window, YoY only');
same(X.companyWords({ q: '2026Q3', win: 'ltm', np: 2000, npY: 2100, roe: 20 }), "LTM Q3'26: רווח נקי 2,000 מיליוני ש\"ח, −4.8% YoY. ROE LTM 20.0%.", 'SYNTHETIC: LTM window');
same(X.companyWords({ q: '2026Q2', np: 617, npY: 539, npQ: 437, top: { l: 'יחס כושר פירעון', d: 16, cmp: 'QoQ', u: 'pp' } }), 'Q2\'26: רווח נקי 617 מיליוני ש"ח, +14.5% YoY, +41.2% QoQ. השינוי המהותי ביותר: יחס כושר פירעון, +16.0 נק׳ QoQ.', 'SYNTHETIC: a ratio top change in points, no ROE');
ok(X.companyWords({ q: '2026Q3', np: null }) === null, 'no net profit: no sentence (the page keeps its own blocks)');
same(X.waitingWords({ bq: '2026Q3', q: '2026Q2', pub: '2026-08-19', reported: 3, total: 7, expected: { date: '2026-11-30', est: true } }), "הדוח ל-Q3'26 טרם פורסם; מוצג Q2'26, שפורסם 19.08.26. 3 מתוך 7 המבטחות כבר דיווחו. צפוי 30.11.26 (אומדן).", 'SYNTHETIC: the calendar\'s expected date with its "אומדן" tag');
same(X.waitingWords({ bq: '2026Q3', q: '2026Q2', reported: 4, total: 8, setWord: 'בתי ההשקעות' }), "הדוח ל-Q3'26 טרם פורסם; מוצג Q2'26. 4 מתוך 8 בתי ההשקעות כבר דיווחו.", 'SYNTHETIC: a fund house, no publication date');
ok(X.filerWords('ילין לפידות', 100) === 'נתוני ילין לפידות, 100%' && X.filerWords('מור', 53.5) === 'נתוני מור, 53.5%', 'the filer note');
ok(X.coChgHead('2026Q3', 'yoy') === "מול Q3'25" && X.coChgHead('2026Q3', 'qoq') === "מול Q2'26", 'company table change heads');

console.log(`p6-words: ${n - fails}/${n} passed`);
if (fails) { console.error(`${fails} failed`); process.exit(1); }
