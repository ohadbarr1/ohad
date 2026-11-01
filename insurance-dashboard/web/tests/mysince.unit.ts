/* W3 · "מה השתנה מאז הביקור הקודם" (lib/mySince.ts) and the agent's client folders (lib/clients.ts), run in node.
   Run: npm run test:mysince */
import { baselineOf, changesOf, nextSeen, normSeen, snapOf, type MySnap, type SnapP } from '../src/lib/mySince';
import { verdictOf, type VFund } from '../src/lib/verdict';
import { EMPTY, exportText, mergeClients, normClients, normFolder, removeFolder, upsert } from '../src/lib/clients';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const BANNED = /עבר[וי] ל|כדאי לך|מומלץ|אנו ממליצים|תעביר|העבירו/;

/* ---- the baseline follows the data month ---- */
const S = (asof: number, p: Record<string, Partial<SnapP>> = {}): MySnap => ({ v: 1, asof, at: '2026-01-01', p: Object.fromEntries(Object.entries(p).map(([k, x]) => [k, { per: 'a5', basis: 'net', lo: null, hi: null, n: null, tone: null, fee: null, depfee: null, m1: null, ...x }])) });
{
  ok(baselineOf({ cur: null, prev: null }, 202609) === null, 'first visit: no baseline');
  const s1 = nextSeen({ cur: null, prev: null }, S(202608, { a: {} }));
  ok(s1.cur?.asof === 202608 && s1.prev === null, 'first visit stores the month seen');
  ok(baselineOf(s1, 202608) === null, 'same month again: nothing fires');
  ok(baselineOf(s1, 202609)?.asof === 202608, 'a new month: the old month is the baseline');
  const s2 = nextSeen(s1, S(202609, { a: {}, b: {} }));
  ok(s2.cur?.asof === 202609 && s2.prev?.asof === 202608, 'leaving: the new month becomes cur, the old one prev');
  ok(baselineOf(s2, 202609)?.asof === 202608, 'a reload in the same month keeps the same baseline (the changes do not vanish)');
  const s3 = nextSeen(s2, S(202609, { c: {} }));
  ok(s3.prev?.asof === 202608 && s3.cur && 'a' in s3.cur.p && 'c' in s3.cur.p, 'same month: products added are merged, the baseline kept');
  ok(nextSeen(s2, S(202607)) === s2, 'an older data file does not overwrite a newer snapshot');
  ok(normSeen('junk').cur === null && normSeen({ cur: { asof: 'x' } }).cur === null && normSeen(s2).cur?.asof === 202609, 'stored junk reads as empty');
}

/* ---- the change rules ---- */
{
  const base: SnapP = { per: 'a5', basis: 'net', lo: 5, hi: 5, n: 12, tone: 'mid', fee: 0.15, depfee: 1.5, m1: 0.4 };
  const none = changesOf(base, { ...base, m1: 0.6 }, [0.1, 0.5, 0.9]);
  ok(none.length === 1 && none[0].kind === 'month' && none[0].text.includes('0.60%') && none[0].text.includes('0.50%'), `only the month line when nothing moved: ${none.map((c) => c.text).join(' | ')}`);
  const down = changesOf(base, { ...base, lo: 10, hi: 11, tone: 'bad' });
  ok(down.some((c) => c.kind === 'rank' && c.tone === 'bad' && c.text.includes('10–11 מתוך 12') && c.text.includes('מ-5 מתוך 12')), 'rank fell, shown as a range');
  ok(down.some((c) => c.kind === 'quart' && c.text === 'ירד לרבע התחתון של הקטגוריה'), 'entering the bottom quarter is called out');
  const up = changesOf({ ...base, tone: 'bad', lo: 11, hi: 11 }, { ...base, lo: 6, hi: 6, tone: 'mid' });
  ok(up.some((c) => c.kind === 'quart' && c.tone === 'good' && c.text.includes('יצא מהרבע התחתון')), 'leaving the bottom quarter');
  const top = changesOf(base, { ...base, lo: 1, hi: 2, tone: 'good' });
  ok(top.some((c) => c.text.includes('עלה לרבע העליון')), 'entering the top quarter');
  const fee = changesOf(base, { ...base, fee: 0.18, depfee: 1.49 });
  ok(fee.some((c) => c.kind === 'fee' && c.tone === 'bad' && c.text.includes('0.18%') && c.text.includes('0.15%')), 'accumulation fee up');
  ok(fee.some((c) => c.kind === 'dep' && c.tone === 'good'), 'deposit fee down by 0.01pp is reported');
  ok(!changesOf(base, { ...base, fee: 0.154 }).some((c) => c.kind === 'fee'), 'a fee move under the published precision is not');
  const win = changesOf(base, { ...base, per: 'a3', lo: 1, hi: 1, tone: 'good' });
  ok(!win.some((c) => c.kind === 'rank' || c.kind === 'quart'), 'a different window is not compared');
  ok(changesOf(undefined, base).length === 0, 'no baseline: no changes');
  ok([...down, ...up, ...fee, ...none].every((c) => !BANNED.test(c.text)), 'descriptive only');
}

/* ---- snapshots from the card's verdict ---- */
{
  const mk = (k: string, a5: number, fee: number, m1: number): VFund & { m1: number } => ({ k, name: `קרן ${k}`, prod: 'פנסיה מקיפה', track: 'עד 50', grp: `גוף ${k}`, fee, depfee: 1.5, assets: 1000, a5: a5 + 0.15, a3: null, y12: 5, net: { a5, m1 }, m1: m1 + 0.01 });
  const cat = [mk('p1', 10.5, 0.14, 0.5), mk('p2', 10.2, 0.15, 0.4), mk('p3', 9.9, 0.11, 0.3), mk('p4', 9.5, 0.16, 0.2), mk('p5', 9.0, 0.2, 0.1)];
  const v = verdictOf(cat[4], cat, 202609, null);
  const s = snapOf(cat[4], v);
  ok(s.per === 'a5' && s.basis === 'net' && s.lo === 5 && s.hi === 5 && s.n === 5 && s.tone === 'bad' && s.m1 === 0.1 && s.fee === 0.2, `snapshot of the card: ${JSON.stringify(s)}`);
}

/* ---- client folders ---- */
{
  const f0 = normFolder({ label: '  לקוח א  ', keys: ['p2009', 'p2009', 'bad', 'g12535'], tags: { p2009: 'קיים', g12535: 'xx', zz: 'מומלץ' }, fields: { 'a1:p2009:rec': 'טקסט', 'bad key!': 'x', empty: '  ' } });
  ok(f0 && f0.label === 'לקוח א' && f0.keys.join() === 'p2009,g12535', 'keys: valid, unique');
  ok(f0 && Object.keys(f0.tags).join() === 'p2009' && Object.keys(f0.fields).join() === 'a1:p2009:rec', 'tags and fields: only valid ones');
  ok(normFolder({ label: '', keys: ['p1'] }) === null && normFolder({ label: 'x', keys: [] }) === null, 'a folder needs a label and a track');
  let file = EMPTY;
  const r1 = upsert(file, { label: 'דנה', keys: ['p2009', 'p2184'], b: 'net' }, '2026-11-01'); file = r1.file;
  ok(r1.created && file.folders.length === 1, 'new folder');
  const r2 = upsert(file, { id: r1.folder.id, label: 'דנה', keys: ['p2009', 'p2184'], fields: { 'hnm:fit': 'מתאים' }, tags: { p2009: 'קיים' } }, '2026-11-02'); file = r2.file;
  ok(!r2.created && file.folders[0].fields['hnm:fit'] === 'מתאים' && file.folders[0].created === '2026-11-01' && file.folders[0].updated === '2026-11-02', 'saving from the print page updates by id');
  const r3 = upsert(file, { label: ' דנה ', keys: ['p2009', 'p2184', 'p2015'], b: 'gross' }, '2026-11-03'); file = r3.file;
  ok(!r3.created && file.folders.length === 1 && file.folders[0].keys.length === 3 && file.folders[0].fields['hnm:fit'] === 'מתאים', 'saving from compare by the same label keeps the worksheet');
  const txt = exportText(file, '2026-11-03');
  const back = normClients(JSON.parse(txt));
  ok(back.kind === 'fox-clients' && back.folders[0].keys.length === 3 && back.folders[0].b === 'gross', 'export → import round trip');
  const m = mergeClients(EMPTY, JSON.parse(txt));
  ok(m.added === 1 && m.updated === 0, 'import into an empty browser adds');
  const older = JSON.parse(txt); older.folders[0].updated = '2026-10-01'; older.folders[0].keys = ['p2009'];
  const m2 = mergeClients(file, older);
  ok(m2.updated === 0 && m2.file.folders[0].keys.length === 3, 'an older copy does not overwrite a newer one');
  ok(mergeClients(file, { folders: 'x' }).added === 0 && normClients(null).folders.length === 0, 'a broken file imports nothing');
  ok(removeFolder(file, file.folders[0].id).folders.length === 0, 'remove');
}

console.log(`mysince: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
