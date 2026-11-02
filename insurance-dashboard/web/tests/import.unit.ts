/* W7 · the import engine around the parser: the zip reader (lib/zipRead: plain, ZipCrypto, AES, nested, wrong / missing password),
   several provider files merged into one (lib/maslaka mergeMFiles), and the הר הביטוח table reader (lib/harb). Node, on the fixtures
   in tests/fixtures/maslaka (synthetic; password fox-2026). Run: npm run test:import */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZipError, unpackZip } from '../src/lib/zipRead';
import { decodeXml, mergeMFiles, parseMaslaka, readTree, xmlTree } from '../src/lib/maslaka';
import { HARB_WARN, harbDate, harbRows, heldFromHarb, readHarb, splitTable, xlsxCells } from '../src/lib/harb';
import { coverOnly, normClients } from '../src/lib/clients';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const FIX = join(process.cwd(), 'tests', 'fixtures', 'maslaka');
const read = (f: string) => new Uint8Array(readFileSync(join(FIX, f)));
const PASS = 'fox-2026';
const kindOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ZipError ? e.kind : `other:${String(e)}`; } };

/* ---- the zip reader ---- */
{
  const plain = await unpackZip(read('fixture-plain.zip'), null);
  ok(plain.xml.length === 2 && plain.xml.map((x) => x.name).sort().join() === 'fixture-bituach.xml,fixture-pension.xml', `a plain zip: its two XMLs (${plain.xml.map((x) => x.name)})`);
  ok(plain.skipped.length === 2 && plain.skipped.some((s) => s.endsWith('.pdf')) && plain.skipped.some((s) => s.endsWith('.xlsx')) && !plain.encrypted, 'the PDF and the Excel are left unread');
  ok(decodeXml(plain.xml.find((x) => x.name === 'fixture-pension.xml')!.data) === readFileSync(join(FIX, 'fixture-pension.xml'), 'utf8'), 'the XML comes out byte for byte');
  ok((await kindOf(unpackZip(read('fixture-zipcrypto.zip'), null))) === 'need-password', 'ZipCrypto without a password: need-password');
  ok((await kindOf(unpackZip(read('fixture-zipcrypto.zip'), 'nope'))) === 'wrong-password', 'ZipCrypto with the wrong password: wrong-password');
  const zc = await unpackZip(read('fixture-zipcrypto.zip'), PASS);
  ok(zc.xml.length === 2 && zc.encrypted && decodeXml(zc.xml[0].data).includes('<Mimshak'), 'ZipCrypto (written by /usr/bin/zip -e) opens with the password');
  ok((await kindOf(unpackZip(read('fixture-aes.zip'), null))) === 'need-password', 'AES without a password: need-password');
  ok((await kindOf(unpackZip(read('fixture-aes.zip'), 'nope'))) === 'wrong-password', 'AES with the wrong password: wrong-password');
  const aes = await unpackZip(read('fixture-aes.zip'), PASS);
  ok(aes.xml.length === 2 && aes.encrypted && parseMaslaka(xmlTree(decodeXml(aes.xml[1].data))).accounts.length > 0, 'AES-256 opens with the password and parses');
  ok((await kindOf(unpackZip(read('fixture-nested.zip'), null))) === 'need-password', 'a zip inside a zip: the inner one asks for the password');
  const nested = await unpackZip(read('fixture-nested.zip'), PASS);
  ok(nested.xml.length === 2 && nested.xml.every((x) => x.path.startsWith('inner.zip/')) && nested.skipped.length === 3, `nested zip: the inner XMLs with their path (${nested.xml.map((x) => x.path)})`);
  ok((await kindOf(unpackZip(new TextEncoder().encode('<Mimshak/>'), null))) === 'not-zip', 'not a zip: not-zip');
  ok((await kindOf(unpackZip(new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5, 6]), null))) === 'not-zip', 'a broken zip: not-zip');
}

/* ---- several providers → one file ---- */
{
  const u = await unpackZip(read('fixture-plain.zip'), null);
  const parts = u.xml.map((x) => ({ name: x.name, file: parseMaslaka(readTree(decodeXml(x.data))) }));
  const m = mergeMFiles(parts);
  ok(m.accounts.length === 5 && m.parts?.length === 2, `5 accounts from 2 providers (${m.accounts.length}, ${m.parts?.length})`);
  ok(m.parts![0].from === 0 && m.parts![0].to === m.parts![1].from && m.parts![1].to === 5, 'the parts cover the accounts in order');
  ok(new Set(m.accounts.map((a) => a.providerName)).size === 2 && m.parts!.every((p) => m.accounts.slice(p.from, p.to).every((a) => a.providerName === p.provider)), 'every account names its own provider');
  ok(m.version === '009', 'the version is kept when every part agrees');
  const one = mergeMFiles([parts[0]]);
  ok(one.accounts.length === parts[0].file.accounts.length && one.parts?.length === 1, 'one file: itself, with one part');
}

/* ---- הר הביטוח: the table reader ---- */
{
  ok(harbDate('01/03/2019') === '2019-03-01' && harbDate('2021-06-15') === '2021-06-15' && harbDate('20260101') === '2026-01-01' && harbDate('') === null, 'dates');
  const cells = splitTable('a,b\n"x, y",2\n');
  ok(cells.length === 2 && cells[1][0] === 'x, y' && cells[1][1] === '2', 'CSV with a quoted comma');
  ok(splitTable('a\tb\nc\td')[1][1] === 'd', 'TSV');
  const r = await readHarb(read('harb-sample.csv'));
  ok(r.rows.length === 3, `3 policies: the duplicate row dropped (${r.rows.length})`);
  const harel = r.rows[0];
  ok(harel.insurer?.startsWith('הראל') && harel.kind === 'בריאות' && harel.product === 'ניתוחים, השתלות ותרופות' && harel.premium === 186.4 && harel.start === '2019-03-01' && harel.end === null, `the first row's columns (${JSON.stringify(harel)})`);
  ok(r.rows[2].premium === 1230 && r.rows[2].end === '2026-12-31', 'a thousands separator and an end date');
  ok(r.rows.every((x) => x.warn.includes(HARB_WARN)) && r.warn.includes(HARB_WARN), 'every row says the file structure is unverified');
  ok(!JSON.stringify(r).includes('88445566') && !JSON.stringify(r).includes('1234567'), 'no policy number is kept');
  const none = harbRows([['שלום', 'עולם'], ['1', '2']]);
  ok(none.rows.length === 0 && none.warn[0].includes('לא נמצאה שורת כותרות'), 'no header row: says so');
  const held = heldFromHarb(r.rows, '2026-09-30');
  ok(held.length === 3 && held.every((h) => coverOnly(h)) && held[0].covers[0].cost === 186.4 && held[0].typeHe === 'ביטוח: בריאות' && held[0].provider?.startsWith('הראל'), 'held rows are cover-only products with the premium as the cover\'s cost');
  const stored = normClients({ folders: [{ label: 'ה', keys: [], held }] }).folders[0].held;
  ok(stored.length === 3 && stored[0].covers[0].cost === 186.4 && stored[0].note?.includes('הר הביטוח'), 'they survive storage');
  // an annual premium column
  const y = harbRows([['חברה', 'ענף', 'פרמיה שנתית'], ['כלל', 'דירה', '1,200']]);
  ok(y.rows[0].premium === 1200 && y.rows[0].premiumPer === 'year' && heldFromHarb(y.rows, null)[0].covers[0].cost === 100 && heldFromHarb(y.rows, null)[0].note?.includes('חולקה ב-12'), 'an annual premium is divided by 12 and the note says so');
  // a tiny xlsx made of the same table (shared strings + inline strings + numbers), through the zip reader
  const xlsx = await makeXlsx([['שם חברת הביטוח', 'ענף ביטוח', 'פרמיה חודשית'], ['הראל', 'בריאות', 186.4], ['מגדל', 'חיים', 92]]);
  const cx = await xlsxCells(xlsx);
  ok(cx.length === 3 && cx[0][0] === 'שם חברת הביטוח' && cx[1][2] === '186.4', `xlsx cells (${JSON.stringify(cx)})`);
  const rx = await readHarb(xlsx);
  ok(rx.rows.length === 2 && rx.rows[1].insurer === 'מגדל' && rx.rows[1].premium === 92, 'an xlsx export reads like the CSV');
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

console.log(`import: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
