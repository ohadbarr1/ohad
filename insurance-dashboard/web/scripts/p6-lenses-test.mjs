// P6-2b (spec p6 §13.1 F4 / F8, §14.1 N10, §14.3 rule 2; tester round 3 P1): node test for the board workbook's writer and the tables'
// column model. Run: node scripts/p6-lenses-test.mjs
// lib/xlsx.ts: a formula cell stores its computed value (a number as <v>, a text result as t="str"), =HYPERLINK cells carry their label,
// quotes are doubled. pages/peers/exportBoard.ts: each shipped table column is read through the board reading it is (a change column = its
// base metric's paired YoY: LTM against LTM for flows, quarter end against quarter end for balances), a half-filed flow keeps the shipped
// cell, and the total / weighted rows follow the shipped rules. Synthetic inputs only (no data period involved).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'p6-lenses-'));
let n = 0, fails = 0;
const ok = (c, msg, got) => { n++; if (!c) { fails++; console.error(`FAIL ${msg}${got !== undefined ? `\n  got: ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`); } };
const eq = (got, want, msg) => ok(got === want, `${msg} (want ${JSON.stringify(want)})`, got);
let X, E, P;
try {
  const entry = join(tmp, 'entry.ts');
  writeFileSync(entry, `export * as X from '${join(web, 'src/lib/xlsx')}';\nexport * as E from '${join(web, 'src/pages/peers/exportBoard')}';\nexport * as P from '${join(web, 'src/lib/peerBoard')}';\n`);
  const out = join(tmp, 'b.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{"BASE_URL":"/","DEV":false,"PROD":true,"MODE":"test"}' } });
  ({ X, E, P } = await import(pathToFileURL(out).href));
} finally { rmSync(tmp, { recursive: true, force: true }); }

/* ---------- lib/xlsx.ts: formulas carry their values ---------- */
const hl = X.hyperlink('https://example.org/a.pdf#page=22', 'דוח "Q3" עמ׳ 22');
eq(hl.f, 'HYPERLINK("https://example.org/a.pdf#page=22","דוח ""Q3"" עמ׳ 22")', 'hyperlink: a live formula, quotes doubled');
eq(hl.v, 'דוח "Q3" עמ׳ 22', 'hyperlink: the label is the cached value');
const long = X.hyperlink(`https://example.org/${'x'.repeat(300)}`, 'מסמך');
ok(!long.f && long.link, 'hyperlink: a URL over 255 characters falls back to a relationship link', long);
const blob = X.xlsxBlob([{ name: 'א', rows: [[{ v: 2.5, f: 'C5/D5', fmt: 'n2' }, { v: 'עמ׳ 22', f: 'HYPERLINK("u","עמ׳ 22")' }, { v: '', f: 'IF(COUNT(A1:A2)=0,"",MEDIAN(A1:A2))' }, { v: null, f: 'A1*2' }, 7]] }]);
const xml = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));  // stored zip: the parts are plain text inside
ok(xml.includes('<f>C5/D5</f><v>2.5</v>'), 'a numeric formula stores its value');
ok(/<c r="B1" s="\d+" t="str"><f>HYPERLINK\(&quot;u&quot;,&quot;עמ׳ 22&quot;\)<\/f><v>עמ׳ 22<\/v><\/c>/.test(xml), 'a text formula stores its text as t="str"');
ok(/<c r="C1" s="\d+" t="str"><f>IF\(COUNT\(A1:A2\)=0,&quot;&quot;,MEDIAN\(A1:A2\)\)<\/f><v><\/v><\/c>/.test(xml), 'an empty text result is stored as such');
ok(/<c r="D1" s="\d+"><f>A1\*2<\/f><\/c>/.test(xml), 'a formula without a value is written bare');
ok(xml.includes('fullCalcOnLoad="1"'), 'Excel recalculates on load');

/* ---------- exportBoard.ts: the column model ---------- */
const M = (k) => P.MBY.get(k) ?? P.BBY.get(k);
const d = { major: 'ins' };
const rdOf = (k) => { const r = E.readingOf(d, M(k)); return r ? `${r.bm.key}/${r.rd}` : null; };
eq(rdOf('np'), 'np/ltm', 'net profit: LTM');
eq(rdOf('npy'), 'np/ltmy', 'net profit YoY beside LTM: LTM against LTM (14.3 rule 2)');
eq(rdOf('csm'), 'csm/q', 'CSM: quarter end');
eq(rdOf('csmy'), 'csm/yoy', 'CSM YoY beside a balance: quarter end against quarter end');
eq(rdOf('revy'), 'rev/ltmy', 'insurance revenue YoY: LTM against LTM');
eq(rdOf('rlifey'), 'rlife/ltmy', 'segment revenue YoY: LTM against LTM');
eq(rdOf('oshd'), 'oshare/yoy', 'share change: points, quarter end against quarter end');
eq(rdOf('r12'), 'tr/r12', 'a return window = total return at that window');
eq(rdOf('pbc'), 'pbc/now', 'a multiple: the latest close');
eq(rdOf('gpc'), null, 'gross premiums (filed by halves): the shipped cell keeps its LTM from halves');
eq(rdOf('gpcy'), null, 'their YoY: the shipped cell');
eq(rdOf('aumy'), null, "insurers' AUM YoY: its own token (the base AUM is a fund-house metric)");
eq(E.isChgRd('ltmy') && E.isChgRd('yoy') && E.isChgRd('qoq') && !E.isChgRd('ltm') && !E.isChgRd(null), true, 'isChgRd');

// the weighted multiple and the operating totals (synthetic columns)
const col = (key, vals, stale = {}) => ({ m: M(key), rd: null, cells: new Map(Object.entries(vals).map(([e, v]) => [e, { e, v, stale: !!stale[e], out: false }])) });
const mc = col('mcap', { a: 100, b: 300, c: null }), pe = col('pe', { a: 10, b: 15, c: 8 });
eq(E.aggOf('mkt', pe, [mc, pe], ['a', 'b', 'c']), 400 / (100 / 10 + 300 / 15), 'weighted P/E = Σ market value ÷ Σ earnings (a company without a price is out)');
eq(E.aggOf('mkt', mc, [mc, pe], ['a', 'b', 'c']), 400, 'market value: the sum');
eq(E.aggOf('sav', col('odep', { a: 1, b: 2 }), [], ['a', 'b']), 3, 'deposits: a sum of one period');
eq(E.aggOf('sav', col('odep', { a: 1, b: 2 }, { b: true }), [], ['a', 'b']), null, 'a carried figure is not summed with reported ones');
eq(E.aggOf('sav', col('odep', { a: 1, b: null }), [], ['a', 'b']), null, 'a missing company: no total (a missing part is never zero)');
eq(E.aggOf('sav', col('opol', { a: 1, b: null }), [], ['a', 'b']), 1, 'an asset balance by product: a group without the product holds none');
eq(E.aggOf('biz', col('np', { a: 1, b: 2 }), [], ['a', 'b']), null, 'the business table has no total row');

console.log(`${fails ? 'FAILED' : 'ok'}: ${n - fails} / ${n} checks passed (p6-lenses: xlsx formulas with values, the tables' column model)`);
process.exit(fails ? 1 : 0);
