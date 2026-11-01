/* S3 · the Briefing Builder's pure part (lib/brief.ts, lib/briefDoc.ts), run in node.
   1 · fixtures (built below, small and hand-checkable): cadence arithmetic and "mark as held"; the "since" window; event filtering and
       materiality order; question ranking (tripped first, chairs, companies, topic, recency; another company's question excluded);
       the three numbers (distinct, deterministic); the lead finding (focus, else the industry's, said so); every flag kind; S10 changes
       (absent → said so); the registry's import / merge; the Doc (every token resolves to a sourced figure, no site name, empty sections
       still say something).
   2 · the published data (web/public/data), when present: the demo meeting's brief builds, its figures are all sourced.
   Run: npm run test:brief (bundled with esbuild, run in node). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cites, type Fig, type FindingsFile, type IndexFile } from '../src/lib/answers';
import type { FeedFile } from '../src/lib/feed';
import type { FragFile } from '../src/lib/fragility';
import type { Block, Doc, Rich } from '../src/lib/doc';
import {
  addMonths, buildBrief, cleanMeeting, demoMeeting, markHeld, mergeMeetings, nextDate, parseMeetingsFile, rankQuestions, threeNumbers,
  type BriefData, type CalFile, type Meeting, type WatchFile,
} from '../src/lib/brief';
import { briefDoc } from '../src/lib/briefDoc';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const eq = (a: unknown, b: unknown, what: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

/* ---------------------------------------------------------------------------------------------------------- fixtures */
const rep = (title: string, pg: number) => ({ k: 'report' as const, title, value: '', url: 'https://example.invalid/r.pdf', pg, doc: `דוח בדיקה ${title}` });
const fig = (l: string, v: number, t: string, pg: number): Fig => ({ l, v, u: 'pct', t, b: 'actual', asof: "Q2'26", prov: rep(l, pg) });
const row = (id: string, chairs: string[], topic: string, cos: string[], o: Partial<IndexFile['rows'][number]> = {}, f?: Fig) => ({
  id, q: `שאלה ${id}`, chairs, topic, cos, st: 'ok' as const, corr: 'x', why: null, asof: "Q2'26", chg: 'holds' as const, h: id,
  cs: `התשובה היא {x}.`, cf: { x: f ?? fig(`נתון ${id}`, 1, `${id.slice(2)}%`, 10) }, ...o,
});
const I: IndexFile = {
  v: 1, chairs: { ceo: 'מנכ״ל', cfo: 'סמנכ״ל כספים', board: 'דירקטוריון', reg: 'רגולטור' }, topics: { flows: 'ניודים', capital: 'הון', fees: 'דמי ניהול' }, bases: {}, n: 7, ok: 6,
  rows: [
    row('Q-001', ['ceo'], 'flows', ['alpha']),
    row('Q-002', ['board', 'cfo'], 'capital', ['alpha']),
    row('Q-003', ['board'], 'capital', [], { chg: 'tripped' }),
    row('Q-004', ['board', 'cfo'], 'capital', ['beta']),             // another company: excluded when the focus is alpha
    row('Q-005', ['board', 'cfo'], 'fees', []),
    row('Q-006', ['board', 'cfo'], 'fees', [], {}, fig('נתון Q-005', 1, '005%', 10)),  // the same figure as Q-005: not a second "number"
    { ...row('Q-007', ['board'], 'capital', ['alpha']), st: 'nodata', cs: null, cf: null, why: 'אין נתונים' },
  ],
};
const ff = (v: number, pg: number) => ({ v, u: 'm' as const, s: { k: 'pg' as const, rid: 1, pg } });
const ev = (id: string, t: string, d: string, c: string, o: Record<string, unknown> = {}) => ({ id, t, d, dk: 'pub', c, per: '2026Q2', h: `אירוע ${id}`, to: '/feed', src: { k: 'doc', rid: 1 }, rows: [{ l: 'רווח', ab: ["Q2'26", "Q1'26"], a: ff(100, 5), b: ff(80, 6), d: { v: 20, u: 'dm', s: { k: 'calc', fx: "Q2'26 − Q1'26", in: [{ l: "Q2'26", ...ff(100, 5) }, { l: "Q1'26", ...ff(80, 6) }] } } }], ...o });
const FEED = {
  v: 1, built: '2026-10-28', from: '2025-01-01', files: 'https://example.invalid/', source: '', types: {}, rules: {}, cos: { alpha: 'אלפא', beta: 'בטא', market: 'השוק' }, groups: [],
  docs: { 1: ['alpha', 'quarterly', '2026Q2', '2026-08-20', 'a.pdf', 40] },
  events: [
    ev('e1', 'filing', '2026-10-20', 'alpha'),
    ev('e2', 'target', '2026-10-16', 'alpha', { st: 'missed' }),
    ev('e3', 'filing', '2026-10-21', 'beta'),                          // another company: out
    ev('e4', 'regmonth', '2026-10-09', 'market', { src: { k: 'reg', ym: 202608 } }),
    ev('e5', 'filing', '2026-06-01', 'alpha'),                         // before the window
    ev('e6', 'solv', '2026-10-25', 'alpha'),
  ],
} as unknown as FeedFile;
const FIND: FindingsFile = {
  v: 1, asof: "Q2'26", dets: { sd: { he: 'אמירה–עשייה', rule: '' }, peer: { he: 'חריג עמיתים', rule: '' } }, order_rule: '',
  rows: [
    { id: 'F-1', det: 'peer', c: 'beta', top: true, mat: { v: 1, u: 'm', t: '1', why: '' }, sur: { v: 1, u: 'sd', t: '1', why: '' }, st: 'ok', figs: { g: fig('פער בטא', 2, '2%', 3) }, corr: 'בטא חריגה ב-{g}.', email: '', ex: null, chg: null, vk: 'a', links: [], rel: [] },
    { id: 'F-2', det: 'peer', c: 'alpha', top: false, mat: { v: 1, u: 'm', t: '1', why: '' }, sur: { v: 1, u: 'sd', t: '1', why: '' }, st: 'ok', figs: { g: fig('פער אלפא', 3, '3%', 4) }, corr: 'אלפא חריגה ב-{g}.', email: '', ex: null, chg: null, vk: 'a', links: [], rel: [] },
    { id: 'F-3', det: 'sd', c: 'alpha', top: false, mat: { v: 1, u: 'm', t: '1', why: '' }, sur: { v: 1, u: 'sd', t: '1', why: '' }, st: 'ok', figs: { g: fig('פער יעד אלפא', 4, '4%', 5) }, corr: 'אלפא עברה את היעד ב-{g}.', email: '', ex: null, chg: null, vk: 'a', links: [], rel: [] },
  ],
};
const FRAG = {
  v: 1, asof: {}, rule: '', params: {}, stale_ratio_m: 15, presets: [], cos: {}, skipped: [], events: [],
  sigs: [{ id: 'flow', he: 'ניוד נטו' }, { id: 'fee', he: 'דמי ניהול' }],
  rows: [
    { c: 'alpha', name: 'אלפא', kind: 'fund_house', nodata: [], flags: [{ sig: 'flow', st: 'watch' }], sig: { flow: { st: 'watch', seg: 'pen', segs: { pen: { st: 'watch', v: -388.7, asof: '08/26', prov: { k: 'reg', metric: 'transfers', pi: 1, w: 'q', set: 'fam:pension', g: 3 } } } } } },
    { c: 'beta', name: 'בטא', kind: 'fund_house', nodata: [], flags: [{ sig: 'fee', st: 'alert' }], sig: { fee: { st: 'alert', seg: 'gem', segs: { gem: { st: 'alert', v: 0.25, asof: '08/26', prov: rep('דמי ניהול בטא', 7) } } } } },
  ],
} as unknown as FragFile;
const CAL: CalFile = { built: '2026-10-28', basis: '', companies: [
  { id: 'alpha', name: 'אלפא', next: { period: '2026Q3', expected: '2026-11-10', lo: '2026-11-08', hi: '2026-11-12' } },
  { id: 'alpha_gemel', name: 'אלפא גמל', next: { period: '2026Q3', expected: '2026-12-20' } },   // the managing company counts as alpha; after the meeting
  { id: 'beta', name: 'בטא', next: { period: '2026Q3', expected: '2026-11-11' } },
  { id: 'alpha2', name: 'אלפא אחרת', next: { period: '2027Q1', expected: '2027-05-01' } },
] };
const WATCH: WatchFile = { v: 1, asof: '2026-10-30', changes: [
  { d: '2026-10-29', id: 'Q-005', kind: 'answer', from: { vk: 'a', corr: 'x' }, to: { vk: 'b', corr: 'y' }, topic: 'fees', cos: [] },
  { d: '2026-10-29', id: 'Q-004', kind: 'answer', from: { vk: 'a', corr: 'x' }, to: { vk: 'b', corr: 'y' }, topic: 'capital', cos: ['beta'] },
  { d: '2026-01-01', id: 'Q-002', kind: 'answer', from: null, to: null, topic: 'capital', cos: ['alpha'] },
] };
const TODAY = '2026-11-01';
const M: Meeting = { id: 'm1', name: 'דירקטוריון', type: 'board', date: '2026-11-15', cadence: 'quarterly', audience: 'חברי הדירקטוריון', agenda: ['תוצאות'], chairs: ['board', 'cfo'], topics: ['capital', 'fees'], cos: ['alpha'], n: 4 };
const DATA: BriefData = { today: TODAY, index: I, findings: FIND, feed: FEED, frag: FRAG, cal: CAL, watch: WATCH, names: { alpha: 'אלפא', beta: 'בטא' } };

/* ---------------------------------------------------------------------------------------------------------- 1 · fixtures */
// cadence
eq(addMonths('2026-01-31', 1), '2026-02-28', 'cadence: a month from 31.01 clamps');
eq(nextDate('2026-11-15', 'weekly'), '2026-11-22', 'cadence: weekly');
eq(nextDate('2026-11-15', 'quarterly'), '2027-02-15', 'cadence: quarterly crosses the year');
eq(nextDate('2026-11-15', 'once'), '2026-11-15', 'cadence: once keeps its date');
const held = markHeld(M);
eq([held.last, held.date], ['2026-11-15', '2027-02-15'], 'mark as held: last = date, date rolls by cadence');

// the window
const b = buildBrief(M, DATA);
eq([b.since, b.days, b.sinceIsLast], ['2026-08-03', 90, false], 'since: no last meeting → 90 days back for a quarterly meeting');
const b2 = buildBrief({ ...M, last: '2026-10-15' }, DATA);
eq([b2.since, b2.days, b2.sinceIsLast], ['2026-10-15', 17, true], 'since: from the last meeting');
eq(b2.events.map((x) => x.e.id), ['e2', 'e6', 'e1'], 'since: focus events in the window, most material first (missed target, solvency, filing); other company and old out; regmonth not a capital/fees topic');
const b3 = buildBrief({ ...M, cos: [], topics: ['flows'], last: '2026-10-01' }, DATA);
eq(b3.events.map((x) => x.e.id), ['e4'], 'since: no focus → events on the topics (flows → regulator month)');
ok(b2.events[0].fig?.t === '₪100.0 מיליון' && b2.events[1].dfig?.t === '+₪20.0 מיליון', `since: key figure and its change, with units (${b2.events[0].fig?.t} / ${b2.events[1].dfig?.t})`);
ok(b2.events.every((x) => !x.fig || cites(x.fig.prov).length > 0), 'since: every event figure names a source');

// questions
const ranked = rankQuestions(M, I, WATCH);
eq(ranked.map((q) => q.row.id), ['Q-003', 'Q-002', 'Q-005', 'Q-006', 'Q-001'], 'questions: tripped first; then chairs, companies, topic, recency (a focus-company question asked by another chair last); another company and nodata out');
eq(b.questions.length, 4, 'questions: the meeting asks for 4');
eq(b.qPool, 5, 'questions: the pool before the cut');
ok(ranked.find((q) => q.row.id === 'Q-005')?.changed === '2026-10-29', 'questions: the change date from watch.json');
const r2 = rankQuestions({ ...M, chairs: [], topics: [], cos: [] }, I, null);
eq(r2.length, 6, 'questions: an open meeting takes every answered question');

// the three numbers
const three = threeNumbers(ranked);
eq(three.map((x) => x.row.id), ['Q-003', 'Q-002', 'Q-005'], 'three: the corridor figure of the top answers');
eq(threeNumbers(rankQuestions({ ...M, cos: [], chairs: ['board', 'cfo'], topics: ['fees'] }, I, null)).map((x) => x.row.id).includes('Q-006'), false, 'three: a figure already chosen is not chosen twice');
eq(JSON.stringify(threeNumbers(ranked)), JSON.stringify(three), 'three: deterministic');

// lead
eq([b.lead?.f.id, b.lead?.scope], ['F-2', 'focus'], 'lead: the top finding on a focus company');
eq([buildBrief({ ...M, cos: ['gamma'] }, DATA).lead?.scope], ['industry'], 'lead: no finding on the focus → the industry top, said so');
eq(buildBrief({ ...M, cos: [] }, DATA).lead?.f.id, 'F-1', 'lead: no focus → the top finding');

// flags
const kinds = b.flags.map((f) => f.k + (f.k === 'frag' ? `:${f.c}` : f.k === 'report' ? `:${f.c}:${f.before}` : ''));
eq(kinds, ['tripped', 'frag:alpha', 'saydo', 'target', 'report:alpha:true', 'report:alpha_gemel:false'], 'flags: tripped, focus fragility, say–do, missed target, reports before the meeting and until the next');
const fr = b.flags.find((f) => f.k === 'frag');
ok(fr && fr.k === 'frag' && fr.fig && fr.fig.t.includes('מיליארד') && cites(fr.fig.prov).length > 0, 'flags: the fragility figure is sourced, with its unit');
const open = buildBrief({ ...M, cos: [] }, DATA).flags.filter((f) => f.k === 'frag').map((f) => f.k === 'frag' && f.c);
eq(open, ['beta'], 'flags: no focus → fragility alerts only');
ok(!b.flags.some((f) => f.k === 'report' && f.c === 'alpha2'), 'flags: a report after the window is out');

// S10 changes
eq(b.watch, 'ok', 'watch: present');
eq(b.changes.map((x) => x.c.id), ['Q-005'], 'watch: changes since the window on the focus topics (another company and old out)');
const noW = buildBrief(M, { ...DATA, watch: null });
eq([noW.watch, noW.changes.length], ['absent', 0], 'watch: absent → said so, no changes');

// empty inputs: every section honest
const empty = buildBrief(M, { today: TODAY, index: null, findings: null, feed: null, frag: null, cal: null, watch: null, names: {} });
ok(empty.feedMissing && empty.indexMissing && empty.findingsMissing && !empty.flags.length && !empty.three.length, 'empty: nothing loaded, nothing invented');

// the registry
ok(cleanMeeting({ id: 'x', name: 'n', date: '2026-13-45' }) === null, 'registry: a bad date is dropped');
ok(cleanMeeting({ id: 'x', name: 'n', date: '2026-11-01', type: 'zzz', cadence: 'yearly', chairs: ['a', 3] })?.chairs.length === 1, 'registry: unknown type / cadence fall back, non-strings dropped');
const parsed = parseMeetingsFile(JSON.stringify({ v: 1, kind: 'meetings', exported: '', meetings: [M, { id: 'bad' }] }));
eq(parsed?.map((m) => m.id), ['m1'], 'registry: the export file reads back, malformed rows dropped');
eq(parseMeetingsFile('not json'), null, 'registry: a non-JSON file is refused');
eq(mergeMeetings([M, { ...M, id: 'm2' }], [{ ...M, name: 'חדש' }]).map((m) => `${m.id}:${m.name}`), ['m2:דירקטוריון', 'm1:חדש'], 'registry: import replaces by id');

// the Doc
const TOKEN = /\{([a-z][a-z0-9_]*)\}/g;
function checkDoc(doc: Doc, where: string) {
  const riches: Rich[] = [];
  const walk = (bl: Block) => {
    if (bl.k === 'p' || bl.k === 'callout') riches.push(bl.rich);
    else if (bl.k === 'bullets') riches.push(...bl.items);
    else if (bl.k === 'table') bl.rows.forEach((r) => r.forEach((c) => { if (typeof c !== 'string') riches.push(c); }));
  };
  doc.blocks.forEach(walk);
  let n = 0;
  for (const r of riches) for (const m of r.text.matchAll(TOKEN)) {
    n++;
    const f = r.figs?.[m[1]] ?? doc.figs[m[1]];
    ok(!!f, `${where}: {${m[1]}} resolves`);
    if (f) ok(cites(f.prov).length > 0, `${where}: {${m[1]}} (${f.l}) names a source`);
  }
  for (const [id, f] of Object.entries(doc.figs)) ok(cites(f.prov).length > 0, `${where}: doc.figs.${id} names a source`);
  ok(!/fox|web\.app/i.test(JSON.stringify(doc)), `${where}: no site name in the doc`);
  ok(doc.kind === 'onepager' && doc.author === '', `${where}: a one-pager, author left to the renderer`);
  const heads = doc.blocks.filter((x) => x.k === 'h').map((x) => (x.k === 'h' ? x.text : ''));
  ok(heads.some((h) => h.startsWith('מאז הפגישה הקודמת')) && heads.includes('שלושת המספרים') && heads.includes('שאלות צפויות, עם תשובות') && heads.includes('לפתוח עם זה') && heads.includes('דגל'), `${where}: every section heading`);
  return n;
}
const doc = briefDoc(M, DATA);
ok(checkDoc(doc, 'doc') >= 10, 'doc: the figures are quoted as tokens');
ok(Object.keys(doc.figs).some((k) => k.startsWith('qq003_')) && Object.keys(doc.figs).some((k) => k.startsWith('qq002_')), 'doc: tokens namespaced per answer (two {x} never collide)');
eq(doc.subtitle?.startsWith('15.11.26 · חברי הדירקטוריון'), true, 'doc: header = date · audience');
const emptyDoc = briefDoc(M, { today: TODAY, index: null, findings: null, feed: null, frag: null, cal: null, watch: null, names: {} });
checkDoc(emptyDoc, 'empty doc');
ok(emptyDoc.blocks.filter((x) => x.k === 'p').length >= 5, 'empty doc: every section says why it is empty');

/* ---------------------------------------------------------------------------------------------------------- 2 · the published data */
const DATAD = join(process.cwd(), 'public', 'data');
const j = <T,>(p: string): T | null => (existsSync(join(DATAD, p)) ? (JSON.parse(readFileSync(join(DATAD, p), 'utf8')) as T) : null);
const RI = j<IndexFile>('answers/index.json');
if (RI) {
  const reg = j<{ id: string; name_he: string }[]>('companies/index.json') ?? [];
  const real: BriefData = { today: TODAY, index: RI, findings: j<FindingsFile>('findings.json'), feed: j<FeedFile>('feed.json'), frag: j<FragFile>('fragility.json'), cal: j<CalFile>('calendar.json'), watch: j<WatchFile>('watch.json'), names: Object.fromEntries(reg.map((c) => [c.id, c.name_he])) };
  const demo = demoMeeting(TODAY);
  const rb = buildBrief(demo, real);
  eq(rb.questions.length, demo.n, 'data: the demo brief has its likely questions');
  eq(rb.three.length, 3, 'data: three numbers');
  ok(rb.questions.every((q) => !q.row.cos.length || q.row.cos.some((c) => demo.cos.includes(c))), 'data: no question about a company outside the focus');
  checkDoc(briefDoc(demo, real), 'data doc');
  for (const t of ['exec', 'board', 'division', 'pipeline', 'earnings', 'regulator', 'dist'] as const) {
    const x = buildBrief({ ...demo, type: t, cos: [] }, real);
    ok(x.three.every((n) => cites(n.f.prov).length > 0), `data: ${t} three numbers sourced`);
  }
  console.log(`brief (data): demo → ${rb.events.length}+${rb.eventsMore} events, ${rb.qPool} questions in pool, ${rb.flags.length} flags, lead ${rb.lead?.f.id ?? '–'}; questions ${rb.questions.map((q) => `${q.row.id}[${q.row.cos.join('/')}]`).join(' ')}; three ${rb.three.map((x) => x.f.l).join(' | ')}`);
}

console.log(`brief: ${pass} passed, ${fail} failed`);
if (fail) { bad.slice(0, 40).forEach((x) => console.log('FAIL', x)); process.exit(1); }
