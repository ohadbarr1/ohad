/* W3 · the clearing-house reader (lib/maslaka.ts), run in node on the synthetic fixtures in tests/fixtures/maslaka (built from the
   holdings-interface XSD v008; no real person). Then the matching against web/public/data/funds.json when it is there.
   Run: npm run test:maslaka */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyRows, code30, decodeXml, heldOf, isoDate, parseMaslaka, rowsOf, sim, sniff, words, xmlTree, type MFund, type Row } from '../src/lib/maslaka';
import { backupState, coverOnly, folderFromImport, heldCost, heldForDoc, heldOne, heldSum, normClients, type Held } from '../src/lib/clients';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number, e = 1e-6) => a != null && Math.abs(a - b) < e;
const FIX = join(process.cwd(), 'tests', 'fixtures', 'maslaka');  // run from web/ (npm run test:maslaka)
const read = (f: string) => readFileSync(join(FIX, f));

/* ---- the XML reader ---- */
{
  const t = xmlTree('<?xml version="1.0"?><!-- c --><a:Root xmlns:a="x"><B>1 &amp; 2</B><C/><D xsi:nil="true"></D><E><![CDATA[<x>]]></E></a:Root>');
  ok(t.n === 'Root', 'namespace prefix dropped from the root name');
  ok(t.c.length === 4 && t.c[0].t === '1 & 2', 'entities decoded');
  ok(t.c[1].n === 'C' && t.c[1].c.length === 0, 'self-closing element');
  ok(t.c[2].nil === true, 'xsi:nil read');
  ok(t.c[3].t === '<x>', 'CDATA kept as text');
  let threw = false; try { xmlTree('<A><B></A>'); } catch { threw = true; }
  ok(threw, 'a mismatched close throws');
  threw = false; try { xmlTree('<A>'); } catch { threw = true; }
  ok(threw, 'an unclosed root throws');
  ok(isoDate('20260930') === '2026-09-30' && isoDate('202609') === '2026-09-01' && isoDate('20261399') === null, 'dates');
  const c = code30('512245812-00000000000168-2184-000');
  ok(c?.company === 512245812 && c.product === 168 && c.track === 2184 && c.fee === 0, `30-digit code split: ${JSON.stringify(c)}`);
  ok(code30('123') === null && code30(null) === null, 'short code: null');
  ok(sniff(new Uint8Array([0x50, 0x4b, 3, 4])) === 'zip' && sniff(new TextEncoder().encode('%PDF-1.4')) === 'pdf' && sniff(new TextEncoder().encode('﻿<?xml')) === 'xml', 'sniff zip / pdf / xml');
  const w1255 = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="windows-1255"?><A>'), 0xf9, 0xec, 0xe5, 0xed, ...new TextEncoder().encode('</A>')]);
  ok(xmlTree(decodeXml(w1255)).t === 'שלום', 'windows-1255 declared encoding decoded');
  ok(sim(words('מנורה מבטחים פנסיה - מסלול לבני 50-60'), words('50-60')) > 0.6, 'track words');
}

/* ---- the pension fixture ---- */
const pen = parseMaslaka(xmlTree(decodeXml(read('fixture-pension.xml'))));
{
  ok(pen.version === '009' && pen.runDate === '2026-10-15', 'header');
  ok(pen.accounts.length === 3, `3 accounts (2 pension + 1 risk): ${pen.accounts.length}`);
  const a = pen.accounts[0];
  ok(a.type === 2 && a.pensionKind === 2 && !a.old && a.typeHe === 'קרן פנסיה', 'product type: new comprehensive pension');
  ok(a.balance === 182450, `balance = Σ PerutYitrot (182,450.37, rounded to ₪): ${a.balance}`);
  ok(a.monthly === 3588 && a.lastDep === '2026-09-15', `monthly = Σ the last deposit's rows (3,587.50, before the insurance cost): ${a.monthly}`);
  ok(near(a.fee, 0.22) && a.feeHow === 'terms', 'accumulation fee from the terms (SUG-HOTZAA 1)');
  ok(near(a.depfee, 1.49) && a.depHow === 'terms', 'deposit fee from the terms (SUG-HOTZAA 2)');
  ok(a.tracks.length === 1 && a.tracks[0].amount != null && near(a.tracks[0].amount, 182450.37), 'the same track for balance and deposits is one track; nil amount ignored');
  ok(near(a.ytd, 9.12) && a.asof === '2026-09-30', 'ytd, as-of');
  const b = pen.accounts[1];
  ok(b.monthly == null && b.warn.some((w) => w.includes('01/22')), 'a deposit older than six months is not a monthly deposit');
  ok(near(b.depfee, 6) && near(b.fee, 0.5), 'the frozen account keeps its own terms');
  // privacy: the parser never carries the holder's ID, name, employer or account number
  const s = JSON.stringify(pen);
  ok(!s.includes('000000018') && !s.includes('ישראלה') && !s.includes('בדיקתית') && !s.includes('מעסיק לדוגמה') && !s.includes('7700001'), 'no ID, name, employer or account number in the parsed result');
}

/* ---- the Mor fixture: a study fund by its own number, a provident fund by its parent fund and name, one not in the data ---- */
const mor = parseMaslaka(xmlTree(decodeXml(read('fixture-mor.xml'))));
{
  ok(mor.accounts.length === 3, '3 accounts');
  const h = mor.accounts[0];
  ok(h.type === 4 && h.balance === 84000, 'study fund balance');
  ok(h.monthly === 1750 && h.lastDep === '2026-09-01', `monthly from this year's rows, latest month (437.5 + 1312.5): ${h.monthly}`);
  ok(near(h.fee, 0.6) && h.feeHow === 'month12', `accumulation fee: monthly 0.05 × 12 when there are no terms: ${h.fee}`);
  ok(h.depfee === 0 && h.depHow === 'actual', 'deposit fee 0 read as 0, not missing');
}

/* ---- not a clearing-house file ---- */
{
  let msg = ''; try { parseMaslaka(xmlTree('<Other><x/></Other>')); } catch (e) { msg = String(e); }
  ok(msg.includes('זה לא נראה כמו קובץ מהמסלקה הפנסיונית') && !/Mimshak|Root|Other/.test(msg), 'another XML is refused in plain Hebrew, without the XML root names (W5)');
}

/* ---- matching against the published data ---- */
const data = join(process.cwd(), 'public', 'data', 'funds.json');
if (existsSync(data)) {
  const d = JSON.parse(readFileSync(data, 'utf8')) as { asof: number; funds: MFund[] };
  const rp = rowsOf(pen, d.funds, 'p'), rm = rowsOf(mor, d.funds, 'm');
  const one = (rs: Row[], i: number) => rs[i];
  ok(rp.length === 3, `pension rows: ${rp.length}`);
  ok(one(rp, 0).k === 'p2184' && one(rp, 0).by === 'track', `fund 168, track 2184 → p2184 by track: ${one(rp, 0).k} ${one(rp, 0).by} (${one(rp, 0).why})`);
  ok(one(rp, 0).balance === 182450 && one(rp, 0).monthly === 3588 && near(one(rp, 0).fee, 0.22), 'the row carries the reader\'s numbers');
  ok(one(rp, 1).k === 'p2015' && one(rp, 1).by === 'name', `fund 168, track 0002 "לבני 50-60" → p2015 by name: ${one(rp, 1).k} ${one(rp, 1).by} (${one(rp, 1).why})`);
  ok(one(rp, 2).skip && one(rp, 2).k == null, 'a risk-only policy is skipped with a reason');
  ok(one(rm, 0).k === 'g12535' && one(rm, 0).by === 'id', `study fund 12535 by its own number: ${one(rm, 0).k} ${one(rm, 0).by}`);
  ok(one(rm, 1).k === 'g12532' && one(rm, 1).by === 'name', `provident fund 8694 (parent), "לבני 50 ומטה" → g12532: ${one(rm, 1).k} ${one(rm, 1).by} (${one(rm, 1).why})`);
  ok(one(rm, 2).k == null && one(rm, 2).why.includes('99999') && one(rm, 2).cands.length > 0, `an unknown fund number is unmatched, says why, offers the manager's tracks: ${one(rm, 2).why}`);
  // a company that is not in the data
  const alien = rowsOf({ ...mor, accounts: [{ ...mor.accounts[0], providerId: '999999999', tracks: [{ ...mor.accounts[0].tracks[0], code: '999999999000000000125350000000' }] }] }, d.funds);
  ok(alien[0].k == null && alien[0].why.includes('999999999'), `unknown company: ${alien[0].why}`);

  /* saving: new and updated products, two accounts in one track add up */
  const rows = [...rp, ...rm];
  const r1 = applyRows([{ k: 'g12535', added: '2026-01-01', fee: 0.9 }], rows, '2026-11-02');
  ok(r1.added === 3 && r1.updated === 1, `3 new, 1 updated: ${r1.added}/${r1.updated}`);
  const g = r1.list.find((m) => m.k === 'g12535')!;
  ok(g.added === '2026-01-01' && near(g.fee, 0.6) && g.balance === 84000 && g.imp === '2026-09-30', 'an existing product keeps its date and takes the file\'s numbers');
  ok(!r1.list.some((m) => m.k == null) && r1.list.every((m) => /^[gip]\d+$/.test(m.k)), 'only matched rows are saved');
  const dup = applyRows([], [{ ...rp[0] }, { ...rp[0], key: 'x', balance: 100, monthly: 10 }], '2026-11-02');
  ok(dup.list.length === 1 && dup.list[0].balance === 182550 && dup.list[0].monthly === 3598, 'two accounts in one track add up');
  ok(!JSON.stringify(r1.list).includes('000000018'), 'nothing personal beyond the numbers is saved');
  /* W5 · red team 3: the client document keeps the client's money. Every imported product reaches the current state, matched or
     not; the annual fee cost is the balance × the client's fee from savings, plus 12 × the monthly deposit × the fee from deposits. */
  {
    const held = heldOf([...rp, ...rm]) as Held[];
    // an old managers' policy with no fox track, the client's largest asset (the red team's case): added as the file would give it
    const bm: Held = { k: null, typeHe: 'ביטוח מנהלים (ביטוח חיים משולב חיסכון)', provider: 'חברת ביטוח לדוגמה', plan: 'פוליסה 1995', track: null, balance: 640000, monthly: null, fee: 1.05, feeHow: 'מתנאי החשבון בקובץ (שנתי)', depfee: null, depHow: null, asof: '2026-09-30', covers: [], note: 'לא הותאם למסלול' };
    const all = [...held, bm];
    const fo = folderFromImport('לקוח', all);
    ok(fo.held.length === all.length && fo.held.some((h) => h.balance === 640000), `W5: the folder keeps every product, the unmatched policy too (${fo.held.length})`);
    const pen0 = all.find((h) => h.k === 'p2184')!;
    const c0 = heldCost(pen0);
    ok(near(c0.acc, 182450 * 0.22 / 100, 1e-6) && near(c0.dep, 3588 * 12 * 1.49 / 100, 1e-6) && near(c0.total, 401.39 + 641.5344, 1e-6), `W5: the pension's annual fee cost: balance × 0.22% + 12 × 3,588 × 1.49% (${c0.total})`);
    const st = all.find((h) => h.k === 'g12535')!;
    ok(near(heldCost(st).acc, 504) && heldCost(st).dep === 0, `W5: the study fund: 84,000 × 0.6% = ₪504; its deposit fee is 0 (${heldCost(st).acc}, ${heldCost(st).dep})`);
    ok(near(heldCost(bm).total, 6720) && heldCost(bm).dep == null, 'W5: the unmatched policy: 640,000 × 1.05% = ₪6,720 a year; no deposit, no deposit cost');
    ok(heldCost({ balance: null, monthly: null, fee: 0.5, depfee: 2 }).total === null, 'W5: no balance and no deposit: no cost (not zero)');
    const s = heldSum(all);
    const expBal = all.reduce((t, h) => t + (h.balance ?? 0), 0);
    ok(s.balance === expBal && s.balance >= 640000 + 182450 + 84000 && s.n === all.length, `W5: the total balance counts every product, matched or not (${s.balance})`);
    ok(near(s.total, all.reduce((t, h) => t + (heldCost(h).total ?? 0), 0), 1e-6) && s.total > 6720, `W5: the annual fee total includes the unmatched policy (${s.total.toFixed(2)})`);
    // the document: the matched tracks as "קיים" carry their product; everything else is listed on its own
    const { onRow, loose } = heldForDoc(all, fo.keys, fo.keys.filter((k) => fo.tags[k] === 'קיים'));
    ok(onRow.has('p2184') && heldOne(onRow.get('p2184')!).balance === 182450, 'W5: a matched existing track carries the client\'s balance (סכום צפוי)');
    ok(loose.some((x) => x.h.balance === 640000 && x.why === 'לא נמצא מסלול תואם ב-fox'), 'W5: the unmatched policy is in the current state, marked "לא נמצא מסלול תואם ב-fox"');
    ok(loose.some((x) => x.h.k == null && x.h.balance !== 640000 && x.why === 'לא נמצא מסלול תואם ב-fox') && onRow.size + loose.length <= all.length && [...onRow.values()].flat().length + loose.length === all.length, 'W5: every product is either on its track or listed on its own; none dropped');
    const risk = all.find((h) => h.typeHe === 'ביטוח ריסק');
    ok(!risk || coverOnly(risk) === (risk.balance == null && risk.covers.length > 0), 'W5: a risk-only policy is cover only (kept out of the savings composition, still in the current state)');
    // a matched track the agent tags "מומלץ": its product is still listed as current
    const re = heldForDoc(all, fo.keys, []);
    ok(re.onRow.size === 0 && re.loose.length === all.length && re.loose.find((x) => x.h.k === 'p2184')?.why === 'המסלול מופיע במסמך בסיווג אחר', 'W5: retagging a track does not drop the client\'s product from the current state');
    ok(normClients({ folders: [{ label: 'x', keys: [], held: [bm] }] }).folders[0].held[0].balance === 640000, 'W5: a folder of one unmatched product survives storage');
  }
  /* W5 · the backup reminder */
  {
    const f = normClients({ folders: [{ id: 'abcd1234', label: 'א', keys: ['p2184'], created: '2026-10-01', updated: '2026-10-20' }, { id: 'abcd5678', label: 'ב', keys: ['p2184'], created: '2026-10-01', updated: '2026-10-01' }] });
    const never = backupState(f, '', '2026-11-02');
    ok(never.days === null && never.nudge && never.changed === 2, 'W5: never exported: nudge');
    const fresh = backupState(f, '2026-10-25', '2026-11-02');
    ok(fresh.days === 8 && fresh.changed === 0 && !fresh.nudge, `W5: exported after the last change: no nudge (${JSON.stringify(fresh)})`);
    const stale = backupState(f, '2026-10-10', '2026-11-02');
    ok(stale.days === 23 && stale.changed === 1 && stale.nudge, `W5: a folder changed since a 23-day-old export: nudge (${JSON.stringify(stale)})`);
    ok(!backupState(normClients({}), null, '2026-11-02').nudge, 'W5: no folders: nothing to back up');
    ok(backupState(f, '2026-09-01', '2026-11-02').nudge, 'W5: a month without a backup: nudge');
  }
} else console.log('  (no web/public/data/funds.json: matching skipped)');

console.log(`maslaka: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
