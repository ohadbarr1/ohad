/* S1 / S2 / S6 · the token renderer and the email builder (lib/answers.ts), run in node on the published answers (web/public/data/answers)
   and on a findings fixture (tests/fixtures/findings.json: the S2 contract, with a target-basis figure and a nodata row).
   Checks: every token renders as its figure's display text and the renderer agrees with the builder's own (index.json corr); no digit
   outside a figure survives in the plain-text email (only period labels, dates and counts the core allows); the email carries a source
   line naming a document for every figure it quotes and no site name; {thr} renders the threshold; target / forward / estimate figures
   carry their basis; findings keep materiality and surprise as two components and the top ones lead; the text filter.
   Run: npm run test:answers (bundled with esbuild, run in node). */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  cites, compLine, emailText, figIds, mergeCites, plain, qScore, segments, sourceLine, topFirst,
  type Answer, type Body, type FindingsFile, type IndexFile, type OkBody, type TopicFile,
} from '../src/lib/answers';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }

// the digits a sentence may carry outside its figures (pipeline/answer_core.py ALLOWED, the same pattern)
const ALLOWED = new RegExp(
  "(Q[1-4]'\\d\\d|H[12]'\\d\\d|FY'\\d\\d|9M'\\d\\d|\\b\\d\\d/\\d\\d\\b|\\b\\d{1,2}\\.\\d{1,2}\\.\\d{2,4}\\b|\\b(19|20)\\d\\d\\b|\\b[QF]-\\d{3}\\b|\\b\\d{1,2}M\\b|\\b\\d{1,2}Y\\b|" +
  '\\b\\d{1,2} (רבעונים|רבעונים רצופים|חודשים|שנים|מנהלים|חברות|קבוצות|מתחרים|עמיתים|מסלולים|רבעון|חודש|שנה|מוצרים|קטגוריות)(?![\\u0590-\\u05FF])|' +
  '(?<![\\u0590-\\u05FF])(ב|ל|מ|ה)-\\d{1,2} (רבעונים|חודשים|שנים|המנהלים|החברות)(?![\\u0590-\\u05FF]))', 'g');  // JS \\b is ASCII-only: Hebrew edges by lookaround (Python's \\b is Unicode)
/** the plain text with every quoted figure's display text removed and the allowed labels removed: what is left must hold no digit */
function strayDigits(text: string, b: OkBody, ids: string[]): string | null {
  let t = text;
  for (const id of [...ids].sort((x, y) => b.figs[y].t.length - b.figs[x].t.length)) t = t.split(b.figs[id].t).join(' ');
  t = t.replace(ALLOWED, ' ');
  const m = /.{0,12}\d.{0,12}/.exec(t);
  return m ? m[0] : null;
}

function checkBody(where: string, b: Body, corrFromBuilder?: string | null) {
  if (b.st !== 'ok') { ok(!!b.why, `${where}: nodata has a reason`); return; }
  for (const [k, text] of [['corr', b.corr], ['email', b.email]] as const) {
    const segs = segments(text, b.figs);
    ok(segs.every((s) => s.k !== 'miss'), `${where}/${k}: every token has a figure`);
    const p = plain(text, b.figs);
    ok(!/\{[a-z][a-z0-9_]*\}/.test(p), `${where}/${k}: no token left in the plain text`);
    for (const id of figIds(text)) ok(p.includes(b.figs[id].t), `${where}/${k}: {${id}} renders as ${b.figs[id].t}`);
    const stray = strayDigits(p, b, figIds(text));
    ok(stray == null, `${where}/${k}: a digit outside a figure (${stray})`);
  }
  if (corrFromBuilder != null && Object.values(b.figs).every((f) => f.b === 'actual')) ok(plain(b.corr, b.figs) === corrFromBuilder, `${where}: the corridor renders as the builder wrote it (${plain(b.corr, b.figs)} vs ${corrFromBuilder})`);
  // the email to paste: the paragraph, then the as-of and the source line; no site name, no link to the site
  const mail = emailText(b);
  const [para, ...rest] = mail.split('\n\n');
  const tail = rest.join('\n\n');
  ok(para === plain(b.email, b.figs).trim(), `${where}: the email paragraph is the rendered email`);
  ok(strayDigits(para, b, figIds(b.email)) == null, `${where}: no digit outside a figure in the pasted paragraph`);
  ok(/מקורות: /.test(tail), `${where}: the pasted email carries a source line`);
  ok(!/fox|fox-research|web\.app/i.test(mail), `${where}: no site name in the pasted email`);
  for (const id of figIds(b.email)) ok(cites(b.figs[id].prov).length > 0, `${where}: {${id}} names a source document`);
  ok(sourceLine(b.figs, figIds(b.email)) !== '', `${where}: source line built`);
  if (b.chg) {
    const t = plain(b.chg.text, b.figs, b.chg.thr);
    // a falsifier may name its threshold ({thr}) or describe the crossing in words ("when X overtakes Y"); either way no token survives
    ok(!t.includes('{thr}') && (!b.chg.text.includes('{thr}') || t.includes(b.chg.thr)), `${where}/chg: {thr} renders the threshold (${t})`);
    ok(b.chg.st === 'holds' || b.chg.st === 'tripped', `${where}/chg: state`);
  }
}

// 1 · every published answer
const I = json<IndexFile>(join(DATA, 'answers', 'index.json'));
const bodies = new Map<string, Answer>();
for (const f of readdirSync(join(DATA, 'answers')).filter((x) => x.endsWith('.json') && x !== 'index.json')) json<TopicFile>(join(DATA, 'answers', f)).rows.forEach((a) => bodies.set(a.id, a));
for (const r of I.rows) {
  const a = bodies.get(r.id);
  ok(!!a, `${r.id}: in its topic file`);
  if (a) { ok(a.st === r.st, `${r.id}: state agrees with the index`); checkBody(r.id, a, r.corr); }
}
ok(I.rows.length > 0, 'the index has rows');
const q1b = bodies.get('Q-001');
if (q1b && q1b.st === 'ok') { const l = sourceLine(q1b.figs, figIds(q1b.email)); ok((l.match(/רשות שוק ההון/g) ?? []).length === 1 && l.includes('גמל-נט') && l.includes('פנסיה-נט'), `the regulator's files are one source entry (${l})`); }

// 2 · the renderer on hand-made text: a missing token stays visible, a target carries its basis, mixed bases are said
const F = json<FindingsFile>(join(process.cwd(), 'tests', 'fixtures', 'findings.json'));
const sd = F.rows.find((r) => r.id === 'F-002')! as OkBody & { id: string };
ok(plain('ראו {nope}', sd.figs) === 'ראו {nope}', 'a token without a figure stays visible');
ok(segments('ראו {nope}', sd.figs).some((s) => s.k === 'miss'), 'a token without a figure is a missing segment');
ok(plain(sd.email, sd.figs).includes('₪2,000 מיליון (יעד)'), 'a target figure carries its basis in the plain text');
ok(!plain(sd.email, sd.figs).includes('₪700 מיליון (בפועל)'), 'an actual figure carries no basis label');
ok(emailText(sd).includes('בסיסים: בפועל, יעד'), 'mixed bases are said in the pasted email');
ok(emailText(sd).includes('עמ׳ 12, 45'), `pages of one document merge in the source line (${sourceLine(sd.figs, figIds(sd.email))})`);
ok(mergeCites([...cites(sd.figs.ac.prov), ...cites(sd.figs.tg.prov)]).length === 1, 'one document, one entry');
ok(cites({ k: 'lts', c: 'harel', metric: 'pen.fees', period: 'Q2-2026', title: 't', unit: 'm', value: '1' }, undefined, { harel: 'הראל' })[0].doc.includes('הראל'), 'an unresolved lts node names its company');
ok(cites({ k: 'calc', title: 't', value: '1', formula: 'א ÷ ב', inputs: [{ label: 'a', v: '1' }] })[0].doc.startsWith('חישוב'), 'a computation with no sourced input is named by its formula');

// 3 · findings: every body obeys the same rules, two components shown apart, top ones first, nothing combined
for (const r of F.rows) checkBody(r.id, r);
const order = topFirst(F.rows).map((r) => r.id).join(',');
ok(order === 'F-001,F-003,F-002,F-004', `top findings lead, file order kept within (${order})`);
ok(compLine(F.rows[0]) === 'מהותיות ₪120 מיליון · הפתעה 2.4σ', `materiality and surprise shown as two components (${compLine(F.rows[0])})`);
ok(!JSON.stringify(F).match(/"(score|scores|rating|composite|grade|overall)"/), 'the findings contract carries no combined score');

// 4 · the text filter
const q1 = I.rows.find((r) => r.id === 'Q-001');
if (q1) {
  ok(qScore(q1, 'מור', { more: 'מור' }) > 0, 'filter: a company word');
  ok(qScore(q1, 'בגמל') > 0, 'filter: a word behind a prefix letter');
  ok(qScore(q1, 'Q-001') > 0 && qScore(q1, 'q001') > 0, 'filter: the id');
  ok(qScore(q1, 'סולבנסי') === 0, 'filter: a word not in the question');
  ok(qScore(q1, '') > 0, 'filter: an empty query keeps every row');
}

console.log(`answers: ${pass} passed, ${fail} failed`);
if (fail) { bad.slice(0, 40).forEach((b) => console.log('FAIL', b)); process.exit(1); }
