// W8 feeds: lib/news.ts over a feed fixture (tests/fixtures/news-feed.json: real feed.json events of migdal and harel, with the documents
// they cite) and over the published slim file (public/data/news.json). Run: npm run test:news
import { readFileSync } from 'node:fs';
import { calLinks, feedPath, monthHe, newMonths, newsForFund, type NewsFile } from '../src/lib/news';
import type { FeedFile } from '../src/lib/feed';

let pass = 0, fail = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const F = JSON.parse(readFileSync(new URL('tests/fixtures/news-feed.json', `file://${process.cwd()}/`), 'utf8')) as FeedFile;
const now = new Date('2026-02-15T12:00:00Z');

// a track's own fee change: one line, with the month in words, the two fees and the regulator's source
const a = newsForFund(F, { k: 'p9453', grp: 'מגדל' }, { now });
ok(a.length === 2, `p9453: 2 lines (its fee, then migdal's restatement), got ${a.length}`);
ok(a[0]?.kind === 'fund' && a[0].text === 'מגדל: שינוי בדמי הניהול הממוצעים במסלול, ינואר 2026: 0.23% → 0.18%', `p9453 fee line: ${a[0]?.text}`);
ok(a[0]?.src.text === 'רשות שוק ההון, פנסיה-נט, ינואר 2026', `p9453 fee source: ${a[0]?.src.text}`);
ok(a[0]?.to === '/funds/p9453', `p9453 links to its card: ${a[0]?.to}`);
// the manager's restatement: a company-level line, sourced to the MAYA filing (a URL on mayafiles)
ok(a[1]?.kind === 'company' && a[1].text.startsWith('מגדל: ') && /הציג מחדש/.test(a[1].text) && /\(\d+ נתונים\)$/.test(a[1].text), `restatement line: ${a[1]?.text}`);
ok(!!a[1]?.src.href && a[1].src.href.startsWith('https://mayafiles.tase.co.il/'), `restatement source is the filing: ${a[1]?.src.href}`);
// another migdal track: no fee event of its own, only the manager's restatement
const b = newsForFund(F, { k: 'g99999', grp: 'מגדל' }, { now });
ok(b.length === 1 && b[0].kind === 'company', `another migdal track: the restatement only, got ${b.map((x) => x.text).join(' | ')}`);
// matching by company id instead of the group name
ok(newsForFund(F, { k: 'g99999', c: 'migdal' }, { now }).length === 1, 'match by company id');
// a track of a manager with nothing in the window: nothing (the caller renders nothing)
ok(newsForFund(F, { k: 'g1', grp: 'ילין לפידות' }, { now }).length === 0, 'no events: []');
// a regulator month, a filing and another manager's fee never reach a track's line
ok(!a.concat(b).some((x) => x.id.startsWith('regmonth:') || x.id.startsWith('filing:') || x.id === 'fee:i9564:202601'), 'only fee / company-level types');
ok(newsForFund(F, { k: 'i9564', grp: 'הראל' }, { now }).length === 1, 'harel insurance track: its own fee');
// the window: 90 days back from now, by the received day when the ledger knows it
ok(newsForFund(F, { k: 'p9453', grp: 'מגדל' }, { now: new Date('2026-06-15T00:00:00Z') }).length === 0, 'outside 90 days: []');
ok(newsForFund(F, { k: 'p9453', grp: 'מגדל' }, { now: new Date('2026-06-15T00:00:00Z'), days: 220 }).length === 2, 'days = 220 widens the window');
const seen = { v: 1, since: '2026-01-01', seen: { 'fee:p9453:202601': ['2026-05-30', 'r'] as [string, 'r'] } };
const c = newsForFund(F, { k: 'p9453', grp: 'מגדל' }, { now: new Date('2026-06-15T00:00:00Z'), seen });
ok(c.length === 1 && c[0].got === '2026-05-30', `received 30.05.26: inside the window by its received day (${c[0]?.got})`);
ok(newsForFund(F, { k: 'p9453', grp: 'מגדל' }, { now, max: 1 }).length === 1, 'max caps the lines');
ok(newsForFund(F, { k: 'p9453', grp: 'מגדל' }, { now: new Date('2025-01-01T00:00:00Z') }).length === 0, 'events after now are not shown');

// the published slim file has the shape the component reads, and every event in it is a news type
const N = JSON.parse(readFileSync(new URL('public/data/news.json', `file://${process.cwd()}/`), 'utf8')) as NewsFile;
ok(Array.isArray(N.events) && N.events.every((e) => ['fee', 'restate', 'merger', 'tender', 'service', 'regdec'].includes(e.t)), 'news.json: news types only');
ok(N.events.every((e) => !!N.seen[e.id]), 'news.json: every event has its received date');
ok(N.events.every((e) => e.src.k !== 'doc' || !!N.docs[String(e.src.rid)]), 'news.json: every cited document is in docs');
const anyCo = N.events.find((e) => e.t === 'restate');
if (anyCo) ok(newsForFund(N, { k: 'x', c: anyCo.c }, { now: new Date(`${N.built}T12:00:00Z`), days: N.days }).length > 0, 'news.json: a restatement reaches its manager\'s tracks');

// helpers
ok(monthHe(202609) === 'ספטמבר 2026' && monthHe('202601') === 'ינואר 2026', 'monthHe');
ok(feedPath({}).rss === '/feed.xml' && feedPath({ co: 'harel' }).rss === '/feed/harel.xml' && feedPath({ t: 'regmonth' }).atom === '/feed/months.atom' && feedPath({ t: 'fee' }).rss === '/feed/funds.xml' && feedPath({ t: 'filing' }).rss === '/feed.xml', 'feedPath');
const l = calLinks('/data/cal/reminders.ics');
ok(l.webcal === 'webcal://fox-research-il.web.app/data/cal/reminders.ics' && l.https === 'https://fox-research-il.web.app/data/cal/reminders.ics', 'calLinks');
const reg = { ym: 202609, id: 'regmonth:202609', d: '2026-11-01', kind: 'r' as const };
ok(newMonths(202608, reg) === 1 && newMonths(202512, reg) === 9 && newMonths(202609, reg) === 0 && newMonths(null, reg) === 0 && newMonths(202608, null) === 0, 'newMonths');

console.log(`news: ${pass} passed, ${fail} failed`);
if (fail) { for (const x of bad) console.log('FAIL', x); process.exit(1); }
