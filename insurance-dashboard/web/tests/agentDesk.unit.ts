/* fox 3.0 phase 2 · the agent desk without a server: the call list's triggers (lib/agentDesk), the annual reviews, the encrypted book
   backup (lib/bookBackup), the wizard's logic (lib/wizard) and the agent's file reader (lib/clientRead) on the synthetic fixtures in
   tests/fixtures/maslaka; the round-3 gap (no imported product dropped from א.1 / חלק ד'); then a smoke run on the published data and a
   timing of the whole flow on a fixture. Run: npm run test:agent (scripts/agent-test.mjs runs this file after tests/agent.unit.ts). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CALLS_SUM_KEY, EMPTY_CALLS, Q4_MAX, TRIG_ORDER, addYm, anniversary, bookHash, bottomRun, callList, callMsg, daysBetween, folderTriggers, isFreshMonth, markHandled, normCalls, normMark, normSummary,
  rankCats, reviewMsg, reviewsDue, rollCalls, signOff, waLink, whenText, ymShort, MEET_KEY, REVIEW_KEY, type CallsIn, type RankSeries,
} from '../src/lib/agentDesk';
import { backupName, decryptBook, encryptBook, isBookBackup, restoreInto } from '../src/lib/bookBackup';
import { F, MAX_CANDS, candOptions, fmtDur, medianMs, prodFor, prodsFor, pushTime, svcClaims, whyLines, whyText, wizardKeys, wizardSave } from '../src/lib/wizard';
import { NEED_PW, NeedPassword, readClientFiles, readSum } from '../src/lib/clientRead';
import { coverOnly, folderFromImport, heldForDoc, normClients, normFolder, upsert, decryptShare, encryptFolder, type ClientsFile, type Folder, type Held } from '../src/lib/clients';
import { heldOf, type MFund } from '../src/lib/maslaka';
import { nyudTable } from '../src/lib/nyud';
import { docRow, bottomLines, snapOf } from '../src/lib/compareDoc';
import { FORBIDDEN } from '../src/lib/hanmaka';
import type { FundX } from '../src/lib/funds';
import type { DefaultFile } from '../src/lib/fundsTools';
import type { DecisionFile } from '../src/lib/decision';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const TODAY = '2026-11-05';

/* ---- synthetic data ---- */
const FX = (k: string, o: Partial<FundX> = {}): FundX => ({ k, fam: 'pensia', prod: 'פנסיה מקיפה', track: 'כללי', name: `קרן ${k}`, mgr: 'מנהל', grp: 'קבוצה א', assets: 1000, fee: 0.2, depfee: 1.5, ...o } as FundX);
const HX = (o: Partial<Held> = {}): Held => ({ k: 'p1', typeHe: 'קרן פנסיה', provider: 'מנהל', plan: null, track: 'כללי', balance: 200000, monthly: 2500, fee: 0.22, feeHow: null, depfee: 1.0, depHow: null, asof: '2026-09-30', covers: [], note: null, ...o });
const FD = (id: string, label: string, held: Held[], o: Partial<Folder> = {}): Folder => ({ id, label, keys: held.map((h) => h.k).filter((k): k is string => !!k), b: 'net', tags: {}, fields: {}, note: '', created: '2025-11-10', updated: '2026-10-01', snap: null, held, ...o });
const funds: FundX[] = [
  FX('p1', { act_h: [[202512, 0.1], [202603, -0.05], [202606, -0.12]], act: -0.12, act_p: 202606 }),
  FX('p2', { grp: 'קבוצה ב', act_h: [[202606, 0.3]] }),
  FX('g1', { fam: 'gemel', prod: 'השתלמות', grp: 'קבוצה ב' }),
  FX('g2', { fam: 'gemel', prod: 'השתלמות', grp: 'קבוצה א', track: 'מניות' }),
  FX('g3', { fam: 'gemel', prod: 'השתלמות', grp: 'קבוצה ג', closed: true }),
  FX('g4', { fam: 'gemel', prod: 'השתלמות', grp: 'קבוצה ד', name: 'קבוצה ד השתלמות בניהול אישי' }),
];
const ranks: Record<string, RankSeries> = {
  p1: { cat: 'פנסיה מקיפה | כללי', months: [202605, 202606, 202607, 202608, 202609], v: [50, 25, 0, 25, 25], n: [5, 5, 5, 5, 5] },
  g1: { cat: 'השתלמות | כללי', months: [202606, 202607, 202608, 202609], v: [10, 20, null, 20], n: [9, 9, 9, 9] },
};
const fees = { asof: 202609, rows: [{ k: 'p1', grp: 'קבוצה א', prod: 'פנסיה מקיפה', track: 'כללי', fee: 0.22, log: [[202601, 0.15, 0.22], [202410, 0.3, 0.15]] as [number, number, number][] }, { k: 'g1', grp: 'קבוצה ב', prod: 'השתלמות', track: 'כללי', fee: 0.6, log: [[202601, 0.7, 0.6]] as [number, number, number][] }] };
const dfile: DefaultFile = { tenders: [
  { id: '2024', label: 'ההליך הרביעי', from: '2024-11-01', to: '2028-10-31', fee: 0.22, depfee: 1.0, fee_years: 10, src: 'https://x', src_title: 'הודעת תוצאות 2024', verified: true, winners: [{ grp: 'קבוצה ב', ks: ['p2'] }] },
  { id: '2021', label: 'ההליך השלישי', from: '2021-11-01', to: '2024-10-31', fee: 0.22, depfee: 1.0, fee_years: 5, src: 'https://y', verified: false, winners: [{ grp: 'קבוצה א', ks: ['p1'] }] },
] };
const dec = { v: 1, asof: '2026-11-02', method: '', sources: [{ id: 'si25', kind: 'primary', title: 'מדד השירות לשנת 2025', url: 'https://s', retrieved: '2026-11-01' }],
  segments: { pension: { label: 'קרנות פנסיה', year: 2025, prev_year: 2024, n: 9, weights: {}, avg: { total: 79 }, src: 'si25', pg: 28 } },
  companies: {
    'קבוצה א': { grp: 'קבוצה א', in_funds: true, service: { pension: { year: 2025, total: 74, rank: 8, of: 9, prev: 80, chg: -6, src: 'si25', pg: 28, pg_prev: 29 } }, claims: { year: 2025, src: 'si25', entity: 'א', pg: 3, disability: { approved: 81.5, rejected: null, settled: null, cancelled: null, closed: [] }, survivors: { approved: null, rejected: null, settled: null, cancelled: null, closed: [] } } },
    'קבוצה ב': { grp: 'קבוצה ב', in_funds: true, service: { pension: { year: 2025, total: 88, rank: 1, of: 9, prev: 85, chg: 3, src: 'si25', pg: 28 } } },
  }, coverage_default: { src: '', rules: [] }, bm_checklist: [], missing: [] } as unknown as DecisionFile;
const IN = (folders: Folder[], o: Partial<CallsIn> = {}): CallsIn => ({ folders, funds, asof: 202609, today: TODAY, ranks, fees, dfile, dec, ...o });

/* ---- the bottom-quartile run ---- */
{
  const r = bottomRun(ranks.p1, 202609);
  ok(r.run === 4 && r.from === 202606 && r.vals.join() === '25,0,25,25' && r.n === 5, `bottom run: 4 months from 06/26 (${JSON.stringify(r)})`);
  ok(bottomRun(ranks.g1, 202609).run === 1, 'a null month breaks the run (g1: only 09/26)');
  ok(bottomRun(ranks.p1, 202610).run === 0 && bottomRun(null, 202609).run === 0, 'no run when the data month is not in the series');
  ok(bottomRun({ cat: 'x', months: [202606, 202608, 202609], v: [10, 10, 10] }, 202609).run === 2, 'a gap in the months breaks the run');
  ok(Q4_MAX === 25 && addYm(202601, -1) === 202512 && addYm(202612, 1) === 202701 && ymShort(202609) === '09/26', 'month helpers');
}

/* ---- the triggers of a folder ---- */
const byK = new Map(funds.map((f) => [f.k, f]));
{
  const f = FD('a1', 'ד.כ.', [HX({ k: 'p1' }), HX({ k: 'g1', typeHe: 'קרן השתלמות', fee: 0.6, depfee: 0 })]);
  const ts = folderTriggers(f, IN([f]), byK);
  const ids = ts.map((t) => t.id);
  ok(ids.includes('q4') && ids.includes('act') && ids.includes('fee') && ids.includes('tender') && ids.includes('svc'), `p1 fires q4, act, fee, tender, svc (${ids})`);
  ok(ts.every((t, i) => i === 0 || TRIG_ORDER.indexOf(ts[i - 1].id) <= TRIG_ORDER.indexOf(t.id)), 'triggers in the fixed order');
  const q4 = ts.find((t) => t.id === 'q4')!;
  ok(q4.key === 'q4|p1|202606' && /4 חודשים ברצף/.test(q4.title) && /06\/26: 25/.test(q4.detail), 'q4: the key names the month the run began; the title the run length');
  const act = ts.find((t) => t.id === 'act')!;
  ok(act.key === 'act|p1|202606' && /-0\.12%/.test(act.title) && /פנסיה-נט/.test(act.src), 'act: the last quarter, its source');
  const fee = ts.find((t) => t.id === 'fee')!;
  ok(fee.key === 'fee|p1|202601' && /0\.15% ל-0\.22%/.test(fee.title) && /לא בהכרח דמי הניהול של הלקוח/.test(fee.src), 'fee: the rise within 12 months (01/26), not the older fall; the source says it is the track average');
  ok(!ts.some((t) => t.id === 'fee' && t.k === 'g1'), 'a fee cut is not a trigger');
  const win = ts.find((t) => t.key.startsWith('tender|'))!;
  ok(win && win.key === 'tender|קבוצה א|2024' && /ההליך השלישי/.test(win.title) && /קבוצה ב/.test(win.detail), 'tender: won the previous tender, not the one in force');
  const end = ts.find((t) => t.key.startsWith('tenderEnd|'))!;
  ok(end && /11\.2026/.test(end.title) && /10\.2029/.test(end.title), `tender end: joined 11.2021–10.2024 + 5 years = 11.2026–10.2029 (${end?.title})`);
  const svc = ts.find((t) => t.id === 'svc')!;
  ok(svc.key === 'svc|קבוצה א|pension|2025' && /80 ל-74/.test(svc.title) && /עמ' 28/.test(svc.src), 'svc: the fall against the year before, with the page');
  ok(ts.every((t) => t.src && t.msg && !FORBIDDEN.test(t.msg) && !FORBIDDEN.test(t.title)), 'every trigger has a source and a message, and none recommends');
  // a second product in the same track gives one line, naming both
  const f2 = FD('a2', 'ב', [HX({ k: 'p1' }), HX({ k: 'p1', typeHe: 'קרן פנסיה', provider: 'שני' })]);
  const t2 = folderTriggers(f2, IN([f2]), byK);
  ok(t2.filter((t) => t.id === 'q4').length === 1 && /שני/.test(t2.find((t) => t.id === 'q4')!.what), 'one line per track, both products named');
  // no data: no trigger
  ok(folderTriggers(f, IN([f], { ranks: null, fees: null, dfile: null, dec: null }), byK).map((t) => t.id).join() === 'act', 'without the optional files only the actuarial line (from funds.json) remains');
  ok(folderTriggers(FD('a3', 'ג', [HX({ k: null })]), IN([]), byK).length === 0, 'an unmatched product has no trigger');
  const list = callList(IN([FD('z', 'ריק', [HX({ k: 'p2', fee: 0.22, depfee: 1 })]), f]));
  ok(list.length === 1 && list[0].label === 'ד.כ.', 'the call list keeps folders with a trigger');
  ok(rankCats([f], funds).sort().join() === ['השתלמות | כללי', 'פנסיה מקיפה | כללי'].sort().join(), 'rank categories of the held tracks');
  // the message: descriptive, no name, no balance
  const m = callMsg(ts, 202609, signOff({ name: 'יוסי כהן', phone: '050-0000000' }));
  ok(m.includes('נתוני 09/26') && m.includes('יוסי כהן · 050-0000000') && !m.includes('ד.כ.') && !/200,000|200000/.test(m) && !FORBIDDEN.test(m), 'the draft: data month, sign-off, no client label, no balance');
  ok(waLink('שלום\nא').startsWith('https://wa.me/?text=') && decodeURIComponent(waLink('שלום\nא').split('=')[1]) === 'שלום\nא', 'WhatsApp link carries the text');
}

/* ---- the look: new month, handled marks ---- */
{
  let s = rollCalls(EMPTY_CALLS, 202608, '2026-10-02');
  ok(s.month === 202608 && s.prev == null, 'first look');
  s = markHandled(s, ['q4|p1|202606', 'act|p1|202606'], '2026-10-02');
  s = rollCalls(s, 202609, TODAY);
  ok(s.month === 202609 && s.prev === 202608 && s.handled['q4|p1|202606'] === '2026-10-02', 'a new month keeps the marks (their keys name the data)');
  ok(isFreshMonth(s, 202609, TODAY) && !isFreshMonth(s, 202609, '2026-11-20'), 'fresh for 7 days');
  ok(rollCalls(s, 202609, '2026-11-09') === s && rollCalls(s, 202607, TODAY) === s, 'the same or an older month changes nothing');
  ok(!markHandled(s, ['act|p1|202606'], TODAY, false).handled['act|p1|202606'], 'unmark');
  const n = normCalls({ month: 202609, prev: 'x', at: '2026-11-05', handled: { a: '2026-11-05', b: 'nope', ['x'.repeat(300)]: '2026-11-05' } });
  ok(n.month === 202609 && n.prev == null && Object.keys(n.handled).join() === 'a', 'normCalls drops what is not well formed');
  ok(normSummary({ asof: 202609, clients: 2, open: 3, at: TODAY })?.open === 3 && normSummary({ asof: 'x' }) === null && CALLS_SUM_KEY === 'agent:calls:sum', 'the home summary');
}

/* ---- annual reviews ---- */
{
  const mk = (id: string, created: string, fields: Record<string, string> = {}) => FD(id, id, [HX()], { created, fields });
  const fs = [mk('meet', '2026-01-01', { [MEET_KEY]: '2025-11-20' }), mk('imp', '2025-11-03'), mk('young', '2026-02-01'), mk('late', '2025-09-15'), mk('done', '2025-11-12', { [REVIEW_KEY]: '2026-11-01' }), mk('old', '2025-06-01'), mk('leap', '2024-11-30', { [MEET_KEY]: '2024-02-29' })];
  const due = reviewsDue(fs, TODAY);
  ok(due.map((d) => d.folder.id).join() === 'late,imp,meet', `due: late first, then by day; reviewed, too young, out of window left out (${due.map((d) => d.folder.id)})`);
  ok(due.find((d) => d.folder.id === 'meet')!.by === 'meet' && due.find((d) => d.folder.id === 'imp')!.by === 'import', 'the meeting date wins over the import date');
  ok(anniversary('2024-02-29', 2026) === '2026-02-28' && anniversary('2025-11-20', 2026) === '2026-11-20', 'anniversary, 29.02 in a common year');
  const msg = reviewMsg(due[0], 202609, 'יוסי');
  ok(/09\.2025/.test(msg) && /נתוני 09\/26/.test(msg) && !msg.includes('late') && !FORBIDDEN.test(msg), 'review message: the last meeting month, the data month, no label');
  ok(daysBetween('2026-11-01', TODAY) === 4 && whenText('2026-11-05T23:10:00', TODAY) === 'היום 23:10' && whenText('2026-11-04T09:05:00', TODAY) === 'אתמול 09:05' && whenText('2026-10-01T09:05:00', TODAY) === '01.10.2026', 'when text: no ISO on screen');
}

/* ---- the backup ---- */
{
  const a = FD('bk01', 'א', [HX()]), b = FD('bk02', 'ב', [HX({ k: 'g1', typeHe: 'קרן השתלמות' })]);
  const file: ClientsFile = { kind: 'fox-clients', v: 2, folders: [a, b] };
  ok(bookHash(normClients(file).folders) === bookHash(normClients(JSON.parse(JSON.stringify(file))).folders) && bookHash([a]) !== bookHash([a, b]) && /^[0-9a-f]{8}$/.test(bookHash([])), 'the fingerprint is stable and changes with the book');
  ok(normMark({ at: '2026-11-05T10:00:00', hash: 'deadbeef', n: 2 })?.n === 2 && normMark({ at: 'x', hash: 'deadbeef', n: 2 }) === null, 'backup mark');
  const calls = markHandled(EMPTY_CALLS, ['q4|p1|202606'], TODAY);
  const text = await encryptBook(file, { v: 1, name: 'יוסי', lic: '1', phone: '', email: '', co: '', coId: '', addr: '', logo: null }, calls, 'correct horse', TODAY);
  ok(isBookBackup(JSON.parse(text)) && !text.includes('ד.כ.') && !text.includes('קרן פנסיה') && backupName(TODAY).endsWith('.json'), 'the backup is sealed: no folder text in the clear');
  const o = await decryptBook(text, 'correct horse');
  ok(o.file.folders.length === 2 && (o.brand as { name: string }).name === 'יוסי' && o.calls?.handled['q4|p1|202606'] === TODAY && o.exported === TODAY, 'the backup opens: folders, brand, marks');
  let wrong = '';
  try { await decryptBook(text, 'wrong pass'); } catch (e) { wrong = e instanceof Error ? e.message : ''; }
  ok(/הסיסמה שגויה/.test(wrong), 'a wrong passphrase says so');
  let other = '';
  try { await decryptBook(await encryptFolder(a, 'correct horse', TODAY), 'correct horse'); } catch (e) { other = e instanceof Error ? e.message : ''; }
  ok(/אינו קובץ גיבוי/.test(other), 'a one-folder share file is not a book backup');
  ok((await decryptShare(await encryptFolder(a, 'correct horse', TODAY), 'correct horse')).label === 'א', 'the share file still opens after the refactor (same envelope)');
  const here: ClientsFile = { kind: 'fox-clients', v: 2, folders: [{ ...a, updated: '2026-01-01', label: 'ישן' }] };
  const r = restoreInto(here, markHandled(EMPTY_CALLS, ['x'], TODAY), o);
  ok(r.added === 1 && r.updated === 1 && r.file.folders.find((f) => f.id === 'bk01')!.label === 'א' && r.calls.handled.x && r.calls.handled['q4|p1|202606'], 'restore merges: newer folders win, marks of both kept');
}

/* ---- the wizard's logic ---- */
{
  const held = [HX({ k: 'g1', typeHe: 'קרן השתלמות', balance: 50000 }), HX({ k: null, typeHe: 'ביטוח מנהלים (ביטוח חיים משולב חיסכון)', balance: 300000 }), HX({ k: null, typeHe: 'ביטוח ריסק', balance: null, monthly: null, covers: [{ name: 'ריסק', kind: 'מוות', sum: 1, cost: 50, rate: null }] })];
  ok(prodFor(held[0], byK) === 'השתלמות' && prodFor(held[1], byK) === 'פנסיה מקיפה' && prodFor(held[2], byK) === null, 'the picker opens on the own product, an old managers\' policy on "פנסיה מקיפה", risk on none');
  ok(prodsFor(held, byK).join() === 'השתלמות,פנסיה מקיפה,פנסיה כללית,גמל,פוליסות חיסכון וביטוחי מנהלים (מ-2004)', 'the products of the families with money');
  const opts = candOptions(funds, 'השתלמות', held, dfile, 202609);
  ok(opts.map((o) => o.k).join() === 'g1,g2', `open, not self-directed, own track first (${opts.map((o) => o.k)})`);
  ok(candOptions(funds, 'השתלמות', held, dfile, 202609, 'מניות').length === 0 && candOptions(funds, 'השתלמות', held, dfile, 202609, 'g2').length === 1, 'search by name');
  ok(candOptions(funds, 'פנסיה מקיפה', [], dfile, 202609)[0].k === 'p2' && candOptions(funds, 'פנסיה מקיפה', [], dfile, 202609)[0].dflt, 'a default fund in force before the rest');
  // keys: candidates always fit; the rest stays in held
  const many = FD('m', 'm', Array.from({ length: 9 }, (_, i) => HX({ k: `p${100 + i}`, balance: 1000 * (i + 1) })));
  const wk = wizardKeys(many, ['p2', 'g1', 'g2', 'g9']);
  ok(wk.keys.length === 8 && wk.keys.slice(-3).join() === 'p2,g1,g2' && wk.tags.p2 === 'מומלץ' && wk.tags.p108 === 'קיים' && !wk.keys.includes('p100') && MAX_CANDS === 3, 'candidates fit (3 max), the largest existing fill the rest');
  const f0 = FD('w', 'w', held, { fields: { 'a1:g2:why': 'כתבתי', 'doc:client': 'ישן' } });
  const sv = wizardSave(f0, ['g2', 'p2'], { snap: null, kind: 'focused', client: ' דנה ', meet: '2026-11-05', age: 41, sex: 'f', ms: 183000, today: TODAY, why: { g2: 'נוצר', p2: 'שורה' } });
  ok(sv.fields!['a1:g2:why'] === 'כתבתי' && sv.fields!['a1:p2:why'] === 'שורה' && sv.fields![F.client] === 'דנה' && sv.fields![F.meet] === '2026-11-05' && sv.fields![F.age] === '41' && sv.fields![F.wizMs] === '183000' && sv.id === 'w', 'save: the agent\'s text kept, prefills only empty fields, the settings and the time');
  const u = upsert({ kind: 'fox-clients', v: 2, folders: [f0] }, sv, TODAY);
  ok(u.folder.tags.g2 === 'מומלץ' && u.folder.tags.g1 === 'קיים' && u.folder.held.length === 3 && !u.created, 'the saved folder: candidates "מומלץ", the held products all kept');
  ok(fmtDur(183000) === '3:03' && medianMs([3, 1, 2]) === 2 && medianMs([]) === null && pushTime([1, 'x'], 5).join() === '1,5', 'the clock');
  const sc = svcClaims(dec, { grp: 'קבוצה א', fam: 'pensia', prod: 'פנסיה מקיפה' }, { grp: 'קבוצה ב', fam: 'pensia', prod: 'פנסיה מקיפה' });
  ok(sc.length === 2 && /74, מקום 8 מתוך 9 ← קבוצה ב 88, מקום 1 מתוך 9/.test(sc[0].text) && /עמ' 28/.test(sc[0].src) && /81\.5%/.test(sc[1].text) && /לא פורסם/.test(sc[1].text) && /דיווח החברה/.test(sc[1].src), 'service and claims, both companies, sourced');
}

/* ---- the files: the agent's reader on the fixtures, and the round-3 gap ---- */
const DATA = join(process.cwd(), 'public', 'data');
const FIX = join(process.cwd(), 'tests', 'fixtures', 'maslaka');
const fileOf = (n: string) => { const b = readFileSync(join(FIX, n)); return { name: n, size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; };
if (existsSync(join(DATA, 'funds.json'))) {
  const d = JSON.parse(readFileSync(join(DATA, 'funds.json'), 'utf8')) as { asof: number; funds: FundX[] };
  const realDf = JSON.parse(readFileSync(join(DATA, 'funds/default.json'), 'utf8')) as DefaultFile;
  const realDec = JSON.parse(readFileSync(join(DATA, 'funds/decision.json'), 'utf8')) as DecisionFile;
  const realFees = JSON.parse(readFileSync(join(DATA, 'flows/fees.json'), 'utf8'));
  const mf = d.funds as unknown as MFund[];
  // the zip as the clearing house sends it
  let need: unknown = null;
  try { await readClientFiles([fileOf('fixture-zipcrypto.zip')], mf, null); } catch (e) { need = e; }
  ok(need instanceof NeedPassword && !(need as NeedPassword).wrong && (need as Error).message === NEED_PW, 'a protected zip asks for the password');
  let wrongPw: unknown = null;
  try { await readClientFiles([fileOf('fixture-aes.zip')], mf, 'nope'); } catch (e) { wrongPw = e; }
  ok(wrongPw instanceof NeedPassword && (wrongPw as NeedPassword).wrong, 'a wrong password says so');
  const t0 = performance.now();
  const reads = await readClientFiles([fileOf('fixture-zipcrypto.zip'), fileOf('fixture-mor.xml')], mf, 'fox-2026');
  const rows = reads.flatMap((r) => r.rows);
  const uniq = rows;
  const sum = readSum(uniq);
  ok(reads[0].parts === 2 && rows.length > 0 && sum.rows === uniq.length && sum.matched + sum.unmatched + sum.skipped === sum.rows, `reader: the zip's 2 provider files and the study-fund file (${JSON.stringify(sum)})`);
  ok(sum.byCode >= 3 && sum.unmatched >= 1 && sum.skipped >= 2, 'matched by the unified code / fund number; one fund not in the data; two risk policies kept');
  const held = heldOf(uniq) as Held[];
  const f = normFolder({ id: 'fx1', ...folderFromImport('בדיקה', held), b: 'net', created: TODAY, updated: TODAY })!;
  const bm = f.held.find((h) => /ביטוח מנהלים/.test(h.typeHe))!;
  ok(bm && bm.coefGuaranteed?.v === 161.85, 'the managers\' policy keeps its guaranteed coefficient');
  // round-3 gap: a managers' policy with no balance in the file is still a savings product, not "cover only"
  ok(!coverOnly({ ...bm, k: null, balance: null }) && coverOnly(HX({ k: null, typeHe: 'ביטוח ריסק', balance: null, covers: [{ name: 'ריסק', kind: null, sum: 1, cost: 1, rate: null }] })), 'a managers\' policy without a balance stays in א.1; a risk policy is cover only');
  // step 2: candidates for the pension and the study fund
  const pen = candOptions(d.funds, 'פנסיה מקיפה', f.held, realDf, d.asof);
  const hish = candOptions(d.funds, 'השתלמות', f.held, realDf, d.asof);
  const cands = [pen.find((o) => o.dflt)?.k ?? pen[0].k, hish.find((o) => !f.held.some((h) => h.k === o.k))!.k];
  const plan = wizardKeys(f, cands);
  const byKR = new Map(d.funds.map((x) => [x.k, x]));
  const docRows = plan.keys.map((k) => byKR.get(k)!).map((x) => docRow(x, { net: true, asof: d.asof, dfile: realDf, dec: realDec }));
  const ny = nyudTable(f.held, docRows, plan.tags, null, { basis: 'fox', age: 45, sex: 'm' }, ymShort(d.asof));
  ok(ny.rows.length >= 2 && ny.rows.some((r) => r.coef || r.coefWhy) && ny.rows.every((r) => r.fee || r.feeWhy), `ניוד: ${ny.rows.length} pairs, the coefficient line on the managers' policy`);
  const whys = ny.rows.map((r) => whyLines(r, r.exist.k ? byKR.get(r.exist.k) : null, byKR.get(r.cand.k), realDec, ymShort(d.asof)));
  ok(whys.every((w) => w.length >= 3 && w.every((x) => x.text && x.src)) && whys.flat().some((x) => /מדד השירות/.test(x.text)) && whys.flat().every((x) => !FORBIDDEN.test(x.text)), 'every pair has sourced why lines, the service index among them, none recommending');
  ok(whyText(whys[0]).split('\n').length === whys[0].length, 'the why text: one line each');
  // step 3: the save, and the document's view of the products: none dropped
  const sv = wizardSave(f, cands, { snap: snapOf(docRows, bottomLines(docRows, true), TODAY, d.asof, 'net'), kind: 'full', client: '', meet: TODAY, age: 45, sex: 'm', ms: performance.now() - t0, today: TODAY });
  const saved = upsert({ kind: 'fox-clients', v: 2, folders: [f] }, sv, TODAY).folder;
  const exist = saved.keys.filter((k) => saved.tags[k] === 'קיים');
  const { onRow, loose } = heldForDoc(saved.held, saved.keys, exist);
  const inA1 = [...onRow.values()].flat().length + loose.filter((x) => !coverOnly(x.h)).length;
  const inD = [...onRow.values()].flat().length + loose.length;
  ok(inD === saved.held.length, `חלק ד': every imported product (${inD} of ${saved.held.length})`);
  ok(inA1 === saved.held.filter((h) => !coverOnly(h)).length && loose.some((x) => !x.h.k && /גמל/.test(x.h.typeHe)), 'א.1: every savings product, the unmatched provident fund among them');
  ok(saved.snap?.rows.length === saved.keys.length && saved.fields[F.meet] === TODAY, 'the snapshot and the meeting date are in the folder');
  const ms = performance.now() - t0;
  console.log(`  timing: fixture zip+xml → ${saved.held.length} products → ${ny.rows.length} ניוד pairs → saved folder, in ${Math.round(ms)} ms (engine only; the agent's clicks are measured in e2e)`);
  // the call list on the published data, for the fixture folder
  const calls = callList({ folders: [saved], funds: d.funds, asof: d.asof, today: TODAY, ranks: null, fees: realFees, dfile: realDf, dec: realDec });
  ok(calls.every((c) => c.triggers.every((t) => t.src && t.title && !FORBIDDEN.test(t.msg))), `smoke: the call list on the published data (${calls.reduce((t, c) => t + c.triggers.length, 0)} triggers)`);
  const rankIdx = JSON.parse(readFileSync(join(DATA, 'funds/stats/index.json'), 'utf8')) as { cats: { cat: string; slug: string; rank?: boolean }[] };
  const cs = rankCats([saved], d.funds);
  ok(cs.length > 0 && cs.every((c) => rankIdx.cats.some((x) => x.cat === c)), 'smoke: every held category has a rank file in the index');
}

console.log(`agentDesk: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
