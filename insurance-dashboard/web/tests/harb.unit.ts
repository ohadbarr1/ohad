/* fox 3.0 A6 · the הר הביטוח reader (lib/harb) and the folder's risk side (lib/harbRisk), on the SYNTHETIC fixtures in
   tests/fixtures/harb (built from the circular's field names; no real export was available: see the README there and
   docs/harb-format.md). Run: npm run test:harb */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_SUB, HARB_WARN, XLS_BIN, catsOf, harbDate, harbKind, harbRows, heldFromHarb, htmlCells, looksHarb, monthlyOf, readHarb, splitTable } from '../src/lib/harb';
import { fundOfName, nearAge, riskOf, shortIns, withHarb } from '../src/lib/harbRisk';
import { normRisk } from '../src/lib/harbTypes';
import { coverOnly, folderFromImport, heldSum, normClients, type Held } from '../src/lib/clients';
import { cellOf, type CoversFile } from '../src/lib/coverPrice';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const FIX = join(process.cwd(), 'tests', 'fixtures', 'harb');
const read = (f: string) => new Uint8Array(readFileSync(join(FIX, f)));
const TODAY = '2026-11-06';

/* ---- dates, codes, covers ---- */
{
  ok(harbDate('01032019') === '2019-03-01', 'ddmmyyyy (the circular\'s N8)');
  ok(harbDate('20260101') === '2026-01-01' && harbDate('31122026') === '2026-12-31', 'yyyymmdd when it reads as one, else ddmmyyyy');
  ok(harbDate('01/03/19') === '2019-03-01' && harbDate('1.6.2024') === '2024-06-01', 'short year, dots');
  ok(harbDate('45658') === '2025-01-01', `an Excel serial (${harbDate('45658')})`);
  ok(harbDate('31/02/2026') === null && harbDate('29/02/2024') === '2024-02-29', 'a day past the month is refused, a leap day kept');
  ok(harbDate('13/13/2026') === null && harbDate('abc') === null && harbDate('123') === null, 'nonsense is null');
  ok(CODE_SUB[42].includes('שקל הראשון') && CODE_SUB[9].includes('שב"ן'), 'the circular\'s secondary-branch codes');
  ok(catsOf('מחלות ואשפוז', 'הוצאות רפואיות/ניתוחים מהשקל הראשון', null).join() === 'surg1', 'first-shekel surgery by its branch');
  ok(catsOf('מחלות ואשפוז', 'הוצאות רפואיות/ניתוחים משלים שב"ן', null).join() === 'surgShaban', 'complement to שב"ן');
  ok(catsOf('בריאות', null, 'ניתוחים, השתלות ותרופות').join() === 'transplant,drugs', `a package by its name (${catsOf('בריאות', null, 'ניתוחים, השתלות ותרופות')})`);
  ok(catsOf('חיים מקיף', 'אכ"ע', null).join() === 'di' && catsOf('חיים סיכון בלבד', 'ביטוח חיים ריסק טהור', null).join() === 'life', 'disability and risk life');
  ok(catsOf('חיים מקיף', 'ביטוח חיים משולב בחיסכון', null).join() === 'lifeSave', 'a life policy with savings');
  ok(catsOf('רכב חובה', null, null).join() === 'carMand' && catsOf("רכב רכוש - פרטי וצד ג'", null, null).join() === 'car', 'motor');
  ok(catsOf('מחלות ואשפוז', 'הוצאות רפואיות/אחר', 'כתב שירות ייעוץ ובדיקות').join() === 'ambul', 'a vague branch, a specific product name');
  ok(catsOf('משהו', null, null).join() === 'other', 'unrecognised: other');
  ok(shortIns('הראל חברה לביטוח בע"מ') === 'הראל' && shortIns('מנורה מבטחים ביטוח בע"מ') === 'מנורה מבטחים' && shortIns('איילון חברה לביטוח בע״מ') === 'איילון', 'short company names');
  ok(monthlyOf(1200, 'year') === 100 && monthlyOf(50, 'month') === 50 && monthlyOf(50, null) === null, 'premium a month');
}

/* ---- the circular-shaped CSV (UTF-8 BOM, two insured, premium type per row) ---- */
const circ = await readHarb(read('harb-circular.csv'));
{
  ok(circ.rows.length === 10, `10 policies, the duplicate row dropped (${circ.rows.length})`);
  ok(circ.asof === '2026-11-05', `as-of from the line above the header (${circ.asof})`);
  ok(circ.warn[0] === HARB_WARN && circ.warn.some((w) => w.includes('2 מבוטחים')), 'says it is unverified, and that there are two insured');
  const h = circ.rows[0];
  ok(h.insurer === 'הראל חברה לביטוח בע"מ' && h.main === 'מחלות ואשפוז' && h.sub?.includes('שקל הראשון') && h.ptype === 'ביטוח יסודי' && h.group === false && h.domain === 'בריאות', `first row (${JSON.stringify(h)})`);
  ok(h.start === '2019-03-01' && h.end === null && h.premium === 112.4 && h.premiumPer === 'month' && h.pol === '…2340' && h.who === 1, 'dates, premium, masked policy, insured ordinal');
  const clal = circ.rows.find((r) => r.insurer?.startsWith('כלל'))!;
  ok(clal.premium === 1104 && clal.premiumPer === 'year' && clal.cats.join() === 'life', 'an annual premium with a thousands separator');
  ok(circ.rows.filter((r) => r.who === 2).length === 1, 'the second insured has one policy');
  ok(circ.rows.find((r) => r.insurer?.startsWith('מגדל'))!.group === true, 'a group policy');
  const s = JSON.stringify(circ);
  ok(!s.includes('000000018') && !s.includes('000000026') && !s.includes('5512340') && !s.includes('77001234'), 'no ID number and no full policy number in what is read');
}

/* ---- held products, storage ---- */
const held = heldFromHarb(circ.rows, circ.asof);
{
  ok(held.length === 10 && held.every((x) => coverOnly(x) && x.risk?.src === 'harb'), 'cover-only held products with a risk record');
  ok(held[0].typeHe.startsWith('ביטוח: ') && held[0].covers[0].cost === 112.4 && held[0].note?.startsWith('מהר הביטוח'), 'type, the cover\'s cost a month, the note');
  const clal = held.find((x) => x.provider?.startsWith('כלל'))!;
  ok(clal.covers[0].cost === 92 && clal.note?.includes('חולקה ב-12'), 'annual ÷ 12, and the note says so');
  const stored = normClients(JSON.parse(JSON.stringify({ folders: [{ label: 'סינתטי', keys: [], held }] }))).folders[0].held;
  ok(stored.length === 10 && stored.every((x) => x.risk?.src === 'harb') && stored[0].risk!.pol === '…2340' && stored[0].risk!.cats.join() === 'surg1' && stored[0].risk!.who === 1, 'the risk record survives storage');
  ok(!JSON.stringify(stored).match(/\d{8,}/), 'nothing ID-shaped is stored');
  ok(normRisk({ src: 'harb', cats: ['nope'], pol: '123456789', who: 999, start: '2020-01-01' })?.pol === null && normRisk({ src: 'harb', cats: ['nope'] })!.cats.join() === 'other' && normRisk({ src: 'x' }) === null, 'normRisk drops what it does not know');
  const f = folderFromImport('ת', held);
  ok(f.keys.length === 0 && f.held.length === 10, 'a harb-only folder: no tracks, ten policies');
  ok(heldSum(held).ins != null && heldSum(held).balance === 0, 'the policies add insurance cost, no balance');
}

/* ---- the risk side ---- */
const cov = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'funds', 'covers.json'), 'utf8')) as CoversFile;
const pension: Held = { k: null, typeHe: 'פנסיה מקיפה', provider: 'מגדל מקפת קרנות פנסיה וקופות גמל בע"מ', plan: null, track: null, balance: 250000, monthly: 2400, fee: 0.2, feeHow: null, depfee: 1.5, depHow: null, asof: '2026-09-30', covers: [{ name: 'נכות', kind: null, sum: null, cost: 41, rate: 75 }], note: null };
{
  const out = riskOf([pension, ...held], TODAY, { cov, age: 43, sex: null });
  ok(out.rows.length === 10 && out.rows[0].i === 1, 'risk rows point at the folder\'s held index');
  ok(out.people === 2, 'two insured');
  const titles = out.flags.map((f) => f.title);
  const dup = out.flags.find((f) => f.sev === 'high');
  ok(dup && dup.title.includes('ניתוחים מהשקל הראשון') && dup.title.includes('מבוטח 1') && dup.rows.length === 2 && dup.text.includes('קבוצתית'), `duplicate first-shekel surgery for insured 1, one of them a group policy (${titles})`);
  ok(!out.flags.some((f) => f.title.includes('מבוטח 2')), 'insured 2 has nothing to flag (one policy)');
  ok(titles.some((t) => t.includes('שקל ראשון לצד משלים שב"ן')), 'first-shekel next to the שב"ן complement');
  ok(titles.some((t) => t.includes('אובדן כושר עבודה פרטי לצד כיסוי נכות')), 'private disability next to the pension fund');
  ok(titles.some((t) => t.includes('ריסק פרטי לצד כיסוי שאירים')), 'private risk life next to the pension fund');
  ok(titles.some((t) => t.startsWith('מסתיימות בחודשיים הקרובים: 4')), 'two motor and two group health policies end within 60 days');
  ok(titles.some((t) => t.includes('כבר הסתיימה')), 'the home policy already ended by its own dates');
  ok(out.flags[0].sev === 'high', 'the strongest flag first');
  const act = out.rows.filter((r) => r.active && !r.r.cats.includes('lifeSave'));
  const expect = act.reduce((t, r) => t + (r.monthly ?? 0), 0);
  ok(Math.abs(out.monthly - expect) < 1e-9 && out.annual === out.monthly * 12 && out.unknownPer === 0, `the monthly total (${out.monthly})`);
  ok(Math.abs(out.monthly - (112.4 + 58.1 + 21.3 + 31 + 92 + 96.5 + 1450 / 12 + 2980 / 12 + 64.2)) < 0.02, 'the monthly total by hand (the ended home policy left out)');
  // per company, with the pension-fund bylaws price where covers.json has the group
  ok(nearAge(43, [30, 40, 50]) === 40 && nearAge(47, [30, 40, 50]) === 50 && nearAge(null, [30, 40, 50]) === 40, 'nearest bylaws age');
  ok(fundOfName(cov, 'הראל חברה לביטוח בע"מ')?.grp === 'הראל' && fundOfName(cov, 'מנורה מבטחים ביטוח בע"מ')?.grp === 'מנורה מבטחים' && fundOfName(cov, 'איילון חברה לביטוח בע"מ') === null && fundOfName(cov, 'כלל חברה לביטוח בע"מ')?.grp === 'כלל', 'company → covers.json group');
  const harel = out.companies.find((c) => c.name === 'הראל')!, migdal = out.companies.find((c) => c.name === 'מגדל')!;
  ok(harel.n === 3 && Math.abs((harel.monthly ?? 0) - (112.4 + 31 + 64.2)) < 1e-9, 'Harel: three policies and their premium');
  const want = cellOf(cov.funds.harel, 'm', 40)!.total;
  ok(harel.cell?.total === want && harel.cellF?.total === cellOf(cov.funds.harel, 'f', 40)!.total && want != null, `Harel: the bylaws price at 40, man and woman (${want})`);
  ok(migdal.pension && migdal.n === 2 && migdal.cell != null, 'Migdal: the client\'s pension fund and two policies');
  ok(!out.companies.some((c) => c.name === 'איילון'), 'Ayalon: its only policy ended, so no company row');
  const withSex = riskOf(held, TODAY, { cov, age: 31, sex: 'f' });
  ok(withSex.age === 30 && withSex.companies.find((c) => c.name === 'הראל')!.cell?.sex === 'f' && withSex.companies.find((c) => c.name === 'הראל')!.cellF === null, 'the folder\'s age and sex choose the cell');
  const mRisk: Held = { ...pension, typeHe: 'ביטוח ריסק', provider: 'כלל חברה לביטוח בע"מ', balance: null, monthly: null, fee: null, depfee: null, covers: [{ name: 'ריסק למקרה מוות', kind: null, sum: 1000000, cost: 92, rate: null }] };
  const both = riskOf([mRisk, ...held], TODAY).flags.find((f) => f.title.startsWith('ריסק פרטי לצד'));
  ok(both && both.text.includes('אותה פוליסה') && !both.text.includes('קצבה'), 'a risk policy from the clearing house and the same company in הר הביטוח: maybe the same policy');
  ok(riskOf([pension], TODAY).rows.length === 0 && riskOf([pension], TODAY).flags.length === 0, 'a folder without the file: nothing');
  const again = withHarb([pension, ...held], heldFromHarb(circ.rows.slice(0, 2), null));
  ok(again.length === 3 && again[0] === pension, 'a new read replaces the earlier policies, keeps the rest');
}

/* ---- codes, windows-1255, semicolons ---- */
{
  const r = await readHarb(read('harb-codes-1255.csv'));
  ok(r.rows.length === 4, `four rows (${r.rows.length})`);
  ok(r.rows[0].insurer === 'מנורה מבטחים ביטוח בע"מ' && r.rows[0].main === 'מחלות ואשפוז' && r.rows[0].sub === 'הוצאות רפואיות/תרופות' && r.rows[0].ptype === 'נספח/הרחבה' && r.rows[0].group === false, `codes become names (${JSON.stringify(r.rows[0])})`);
  ok(r.rows[0].premium === 420 && r.rows[0].premiumPer === 'year' && r.rows[0].start === '2022-01-01', 'an annual-premium header; ddmmyyyy');
  ok(r.rows[3].main === 'קוד 99' && r.rows[3].sub === 'קוד 77' && r.rows[3].cats.join() === 'other', 'an unknown code is said, not guessed');
  const o = riskOf(heldFromHarb(r.rows, null), TODAY);
  ok(o.flags.some((f) => f.sev === 'high' && f.title.includes('תרופות') && !f.title.includes('מבוטח')), 'two drug covers: a duplicate (one insured: no ordinal in the title)');
  ok(o.flags.some((f) => f.title.includes('בלי כיסוי מזוהה')), 'the unknown code is flagged as unchecked');
}

/* ---- an HTML table saved as .xls; a binary .xls; sniffing ---- */
{
  ok(harbKind(read('harb-table.xls')) === 'html' && harbKind(read('harb-biff.xls')) === 'xls-bin' && harbKind(read('harb-circular.csv')) === 'text', 'file kinds by their bytes');
  const r = await readHarb(read('harb-table.xls'));
  ok(r.rows.length === 2, `two policies, the totals line dropped (${r.rows.length})`);
  ok(r.rows[0].insurer === 'הראל חברה לביטוח בע"מ' && r.rows[0].sub === 'מחלות קשות' && r.rows[0].start === '2023-01-01' && r.rows[0].end === '2042-12-31' && r.rows[0].premiumPer === 'month', `entities, period column, premium type (${JSON.stringify(r.rows[0])})`);
  ok(riskOf(heldFromHarb(r.rows, null), TODAY).flags.some((f) => f.sev === 'info' && f.title.startsWith('מחלות קשות: 2')), 'two critical-illness covers: compensation, flagged to check, not as a duplicate');
  let msg = '';
  try { await readHarb(read('harb-biff.xls')); } catch (e) { msg = (e as Error).message; }
  ok(msg === XLS_BIN, 'a binary .xls is refused with the save-as instruction');
  ok(htmlCells('<table><tr><td>a<br>b</td><td>&amp;</td></tr></table>')[0].join('|') === 'a b|&', 'html cells');
  const enc = new TextEncoder();
  ok(looksHarb('policies.xlsx', new Uint8Array([0x50, 0x4b])) && looksHarb('x.csv', enc.encode('a,b')) && !looksHarb('maslaka.zip', new Uint8Array([0x50, 0x4b])) && !looksHarb('a.xml', enc.encode('<?xml')), 'harb or clearing house, by name');
  ok(!looksHarb('noext', enc.encode('<?xml version="1.0"?><Mimshak/>')) && looksHarb('noext', enc.encode('חברה,ענף\nהראל,בריאות')), 'by contents when there is no extension');
}

/* ---- an .xlsx (zip of XML), dates as Excel serials ---- */
{
  const x = await makeXlsx([['רשימת פוליסות (סינתטי)'], ['חברה', 'ענף ראשי', 'ענף משני', 'תאריך התחלה', 'תאריך סיום', 'פרמיה', 'סוג פרמיה', 'מספר פוליסה'],
    ['הראל חברה לביטוח בע"מ', 'מחלות ואשפוז', 'סיעודי', 44927, 54788, 88.5, 'חודשית', 'SYN-000123'], ['כלל חברה לביטוח בע"מ', 'מחלות ואשפוז', 'סיעודי', 45292, '', 960, 'שנתית', 'SYN-000456']]);
  ok(harbKind(x) === 'xlsx', 'an xlsx by its bytes');
  const r = await readHarb(x);
  ok(r.rows.length === 2 && r.rows[0].start === '2023-01-01' && r.rows[0].end === '2049-12-31' && r.rows[0].pol === '…0123', `xlsx rows, serial dates (${JSON.stringify(r.rows[0])})`);
  ok(r.rows[1].premiumPer === 'year' && monthlyOf(r.rows[1].premium, r.rows[1].premiumPer) === 80, 'xlsx premium type per row');
  ok(riskOf(heldFromHarb(r.rows, null), TODAY).flags.some((f) => f.title.startsWith('סיעוד: 2')), 'two long-term-care covers: flagged');
}

/** a minimal .xlsx (zip of XML) for the test: strings inline, numbers as values */
async function makeXlsx(rows: (string | number)[][]): Promise<Uint8Array> {
  const { BlobReader, BlobWriter, ZipWriter, configure } = await import('@zip.js/zip.js');
  configure({ useWebWorkers: false });
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const w = new ZipWriter(new BlobWriter('application/zip'));
  await w.add('[Content_Types].xml', new BlobReader(new Blob(['<Types/>'])));
  await w.add('xl/workbook.xml', new BlobReader(new Blob(['<workbook/>'])));
  await w.add('xl/worksheets/sheet1.xml', new BlobReader(new Blob([sheet])));
  return new Uint8Array(await (await w.close()).arrayBuffer());
}

/* ---- header matching is by name, not position ---- */
{
  const a = harbRows([['פרמיה', 'סוג פרמיה', 'ענף משני', 'חברה'], ['50', 'חודשית', 'שיניים', 'כלל']]).rows[0];
  const b = harbRows([['חברה', 'ענף משני', 'סוג פרמיה', 'פרמיה'], ['כלל', 'שיניים', 'חודשית', '50']]).rows[0];
  ok(JSON.stringify(a) === JSON.stringify(b) && a.cats.join() === 'dental' && a.premiumPer === 'month', 'the same table in another column order reads the same');
  const c = harbRows([['חברה', 'ענף', 'פרמיה'], ['כלל', 'דירה', '1,200']]);
  ok(c.rows[0].premiumPer === null && c.warn.some((w) => w.includes('חודשית או שנתית')) && heldFromHarb(c.rows, null)[0].covers[0].cost === null, 'no period for the premium: said, and not put in the monthly cost');
  ok(harbRows([['שלום', 'עולם'], ['1', '2']]).rows.length === 0, 'no header row: no rows');
  ok(splitTable('a;b;c\n"x;y";2;3')[1][0] === 'x;y', 'semicolon CSV with a quoted separator');
}

console.log(`harb: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
