/* S10 · Watch & Wake: matching the browser's subscriptions to the published changes (lib/watch.ts) and the morning brief as a Doc
   (lib/watchDoc.ts), run in node on a synthetic watch file and on the published one (public/data/watch.json).
   Checks: a change matches by its own id, its topic or a company, and only then; what "tells" (verdict, trip, new, gone) and what does
   not (the number moved); since-the-last-look filtering; one entry per id over several builds (a change undone drops out); the prep
   queue merges the published calendar with the browser's meetings in date order, reads a malformed registry as none; the Doc quotes
   every number as a figure token that resolves, keeps no digit outside a token but dates, ids and counts, and names no site.
   Run: npm run test:watch (bundled with esbuild, run in node). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NO_SUBS, brief, collapse, daysTo, matchSub, newsCount, normSubs, prepQueue, readMeetings, sinceOf, tells, toggleSub,
  type WChange, type WSide, type WatchFile,
} from '../src/lib/watch';
import { watchDoc } from '../src/lib/watchDoc';
import type { Block } from '../src/lib/doc';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const eq = (a: unknown, b: unknown, what: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const side = (vk: string, cs: string, v: number, t: string, chg: WSide['chg'] = 'holds'): WSide =>
  ({ vk, corr: cs.replace('{x}', t), cs, cf: { x: { l: 'יחס', v, u: 'x', t, b: 'actual', asof: "Q2'26" } }, h: `${vk}|${t}`, chg });
const ch = (o: Partial<WChange> & Pick<WChange, 'id' | 'kind' | 'd'>): WChange =>
  ({ pd: '2026-10-28', sev: null, from: side('a', 'קודם {x}.', 1.1, '1.1×'), to: side('b', 'עכשיו {x}.', 1.4, '1.4×'), topic: 'flows', cos: ['more'], q: 'שאלה?', det: null, ...o });

const W: WatchFile = {
  v: 1, asof: '2026-11-03', snaps: ['2026-10-28', '2026-11-01', '2026-11-03'], snapsrc: {}, n: { answer: 0, tripped: 0, finding: 0, new: 0, gone: 0 }, rule: 'כלל',
  latest_regmonth: null,
  changes: [
    ch({ id: 'Q-002', kind: 'answer', sev: 'verdict', d: '2026-11-03', pd: '2026-11-01' }),
    ch({ id: 'Q-003', kind: 'answer', sev: 'figure', d: '2026-11-03', pd: '2026-11-01', from: side('a', 'מקום {x}.', 3, '3'), to: side('a', 'מקום {x}.', 2, '2') }),
    ch({ id: 'Q-004', kind: 'tripped', d: '2026-11-03', pd: '2026-11-01', topic: 'capital', cos: ['harel'], from: side('a', 'א {x}.', 1, '1'), to: side('a', 'א {x}.', 2, '2', 'tripped') }),
    ch({ id: 'F-peer-clal-gem-ci', kind: 'new', d: '2026-11-03', pd: '2026-11-01', topic: null, cos: ['clal'], q: null, det: 'peer', from: null }),
    ch({ id: 'Q-009', kind: 'gone', d: '2026-11-03', pd: '2026-11-01', topic: 'mix', cos: ['phoenix'], to: null }),
    ch({ id: 'Q-002', kind: 'answer', sev: 'figure', d: '2026-11-01', pd: '2026-10-28', from: side('a', 'קודם {x}.', 1.0, '1.0×'), to: side('a', 'קודם {x}.', 1.1, '1.1×') }),
    ch({ id: 'Q-005', kind: 'answer', sev: 'verdict', d: '2026-11-01', topic: 'fees', cos: ['meitav'] }),
  ],
  upcoming: [
    { d: '2026-11-09', lo: '2026-11-09', hi: '2026-11-09', c: 'market', kind: 'regmonth', per: '202609', what: 'נתוני רשות 09/26', src: 'אומדן', est: true, n: 1 },
    { d: '2026-11-03', lo: '2026-10-30', hi: '2026-11-06', c: 'phoenix', kind: 'report', per: '2026Q3', what: "דוח Q3'26", src: 'calendar.json', est: true, n: 3 },
    { d: '2026-09-30', lo: '2026-09-30', hi: '2026-09-30', c: 'market', kind: 'qend', per: 'Q3-2026', what: 'סוף רבעון', src: 'nowcast.json', est: false },
  ],
};

// ---------- subscriptions
const subs = normSubs({ q: ['Q-002', 'Q-002', 7, ''], t: ['capital'], c: ['clal'], junk: 1 });
eq(subs, { v: 1, q: ['Q-002'], f: [], t: ['capital'], c: ['clal'] }, 'normSubs drops duplicates, non-strings and unknown keys');
eq(normSubs(null), NO_SUBS, 'normSubs of nothing');
eq(toggleSub(toggleSub(subs, 'f', 'F-x'), 'f', 'F-x').f, [], 'toggle twice = off');
eq(matchSub(W.changes[0], subs), { k: 'q', id: 'Q-002' }, 'match by question id');
eq(matchSub(W.changes[2], subs), { k: 't', id: 'capital' }, 'match by topic');
eq(matchSub(W.changes[3], subs), { k: 'c', id: 'clal' }, 'match a finding by company');
eq(matchSub(W.changes[6], subs), null, 'no match');
eq(matchSub(W.changes[3], normSubs({ q: ['F-peer-clal-gem-ci'] })), null, 'a finding id is never matched as a question');
eq(matchSub(W.changes[3], normSubs({ f: ['F-peer-clal-gem-ci'] })), { k: 'f', id: 'F-peer-clal-gem-ci' }, 'match by finding id');

// ---------- what tells
ok(tells(W.changes[0]) && tells(W.changes[2]) && tells(W.changes[3]) && tells(W.changes[4]), 'verdict / tripped / new / gone tell');
ok(!tells(W.changes[1]), 'a moved number alone does not tell');

// ---------- since the last look, collapse
eq(sinceOf(W, '2026-11-01').map((c) => c.id).sort(), ['F-peer-clal-gem-ci', 'Q-002', 'Q-003', 'Q-004', 'Q-009'], 'since 01.11: the 03.11 build only');
eq(sinceOf(W, null).length, 5, 'never looked: the latest build');
eq(sinceOf(W, '2026-11-03').length, 0, 'looked at the latest build: nothing');
const all = collapse(sinceOf(W, '2026-10-28'));
const q2 = all.find((c) => c.id === 'Q-002')!;
eq([q2.pd, q2.from?.corr, q2.to?.corr, q2.sev], ['2026-10-28', 'קודם 1.0×.', 'עכשיו 1.4×.', 'verdict'], 'collapse: from the first from to the last to');
const undone = collapse([ch({ id: 'Q-007', kind: 'answer', sev: 'figure', d: '2026-11-01', from: side('a', 'x {x}.', 1, '1'), to: side('a', 'x {x}.', 2, '2') }),
  ch({ id: 'Q-007', kind: 'answer', sev: 'figure', d: '2026-11-03', from: side('a', 'x {x}.', 2, '2'), to: side('a', 'x {x}.', 1, '1') })]);
eq(undone.length, 0, 'a change undone drops out');
eq(collapse([ch({ id: 'Q-8', kind: 'new', d: '2026-11-01', from: null }), ch({ id: 'Q-8', kind: 'gone', d: '2026-11-03', to: null })]).length, 0, 'appeared and went: drops out');

// ---------- the brief and the badge
const b = brief(W, subs, '2026-11-01');
eq(b.mine.map((c) => c.id), ['Q-004', 'Q-002', 'F-peer-clal-gem-ci'], 'followed changes that tell, trips first');
eq(b.mineFig.map((c) => c.id), [], 'followed moved numbers');
eq(b.rest.map((c) => c.id).sort(), ['Q-003', 'Q-009'], 'the rest');
eq([b.tripped.length, b.newFindings.length, b.count, b.first], [1, 1, 3, false], 'brief counts');
eq(newsCount(W, subs, '2026-11-01'), 3, 'badge = followed changes that tell');
eq(newsCount(W, NO_SUBS, '2026-11-01'), 0, 'nothing followed: no badge');
eq(newsCount(W, subs, '2026-11-03'), 0, 'seen the latest build: no badge');
eq(brief(W, normSubs({ q: ['Q-003'] }), '2026-11-01').mineFig.map((c) => c.id), ['Q-003'], 'a followed moved number is listed apart');

// ---------- the prep queue
eq(daysTo('2026-11-09', '2026-11-01'), 8, 'days to go');
eq(daysTo('2027-01-01', '2026-12-31'), 1, 'over the year end');
const meetings = readMeetings([{ id: 'm1', name: 'פורום הנהלה', type: 'exec', date: '2026-11-05' }, { name: 'בלי תאריך' }, 'x', null, { id: 2, name: 'דירקטוריון', date: '2026-11-09T10:00' }]);
eq(meetings.map((m) => [m.id, m.date]), [['m1', '2026-11-05'], ['2', '2026-11-09']], 'meetings read defensively');
eq(readMeetings({ not: 'an array' }), [], 'a registry of another shape reads as none');
const prep = prepQueue(W.upcoming, meetings, '2026-11-04');
eq(prep.map((p) => [p.kind, p.d, p.days]), [['report', '2026-11-03', -1], ['meeting', '2026-11-05', 1], ['meeting', '2026-11-09', 5], ['regmonth', '2026-11-09', 5]],
  'prep queue: a report whose window is still open stays; past quarter ends go; meetings first on a shared day');

// ---------- the Doc
const ALLOWED = /(Q[1-4]'\d\d|H[12]'\d\d|FY'\d\d|\b\d\d\/\d\d\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b(19|20)\d\d\b|\b[QF]-\d{3}\b|F-[a-z]+-[a-z0-9_-]+|\(\d{1,2}\.\d{2}\.\d{2}\)|ועוד \d+ שינויים)/g;
const richTexts = (bs: Block[]): string[] => bs.flatMap((x) => (x.k === 'p' || x.k === 'callout' ? [x.rich.text] : x.k === 'bullets' ? x.items.map((i) => i.text) : []));
function checkDoc(where: string, w: WatchFile, s: ReturnType<typeof normSubs>, since: string | null) {
  const d = watchDoc({ w, b: brief(w, s, since), prep: prepQueue(w.upcoming, meetings, '2026-11-04'), author: 'א. כותב', today: '2026-11-04', names: { phoenix: 'הפניקס' } });
  ok(d.kind === 'email' && d.author === 'א. כותב' && d.date === '04.11.26', `${where}: kind, author, date`);
  for (const t of richTexts(d.blocks)) {
    for (const m of t.matchAll(/\{([a-z][a-z0-9_]*)\}/g)) ok(d.figs[m[1]]?.prov && d.figs[m[1]].t, `${where}: token {${m[1]}} resolves to a sourced figure`);
    const rest = t.replace(/\{[a-z][a-z0-9_]*\}/g, ' ').replace(ALLOWED, ' ');
    ok(!/\d/.test(rest), `${where}: no digit outside a figure: ${rest.slice(0, 80)}`);
  }
  ok(!/fox/i.test(JSON.stringify({ ...d, figs: {} })), `${where}: no site name`);
  return d;
}
const d1 = checkDoc('synthetic', W, subs, '2026-11-01');
ok(Object.keys(d1.figs).some((k) => k.startsWith('q_002_to_')) && Object.keys(d1.figs).some((k) => k.startsWith('q_002_from_')), 'synthetic: both sides of Q-002 quoted as figures');
ok(d1.figs['q_002_from_x'].prov.k === 'calc' && /כפי שפורסם/.test((d1.figs['q_002_from_x'].prov as { title: string }).title), 'the earlier figure is sourced as published on its date');
ok(d1.blocks.some((x) => x.k === 'table'), 'synthetic: the prep queue is a table');

// ---------- the published file
const P = join(process.cwd(), 'public', 'data', 'watch.json');
if (existsSync(P)) {
  const pub = JSON.parse(readFileSync(P, 'utf8')) as WatchFile;
  ok(Array.isArray(pub.changes) && Array.isArray(pub.upcoming) && Array.isArray(pub.snaps) && pub.snaps.length >= 1, 'published: shape');
  ok(pub.changes.every((c) => pub.snaps.includes(c.d) && pub.snaps.includes(c.pd)), 'published: every change dates to a snapshot');
  ok(pub.upcoming.every((u, i, a) => i === 0 || a[i - 1].d <= u.d), 'published: upcoming in date order');
  checkDoc('published', pub, normSubs({ t: Object.keys({ flows: 1, capital: 1 }) }), null);
}

console.log(`watch: ${pass} passed, ${fail} failed`);
for (const x of bad.slice(0, 30)) console.log('FAIL', x);
if (fail) process.exit(1);
