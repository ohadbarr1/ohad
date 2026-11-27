// P6-2d (spec 5.2–5.5, 13.1 F6, 14.3, 14.6): node test for src/pages/company/rows.ts, the company overview's numbers, and for the
// company workbook's quarters sheet (src/lib/exportCompany.ts `quartersSheet`: LTM = SUM formulas, YoY formulas, cached values, live links).
// Run: node scripts/company-p6-test.mjs
// On the COMMITTED data (public/data/peers/*, changes/*.json). Data-period guard (9.5, 14.6): the numeric assertions run when
// reportStatus('ins') gives bq = 2026Q3 with exactly הפניקס, הראל, מגדל reported; otherwise only the structural ones. Harel's CSM YoY
// carries both expectations (14.2, P6-D1): +4.4% on the first prints, +5.4% on the restated comparative. The guard prints which mode ran.
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(web, 'public/data');
const tmp = mkdtempSync(join(tmpdir(), 'company-p6-'));
let n = 0, fails = 0;
const ok = (c, msg, got) => { n++; if (!c) { fails++; console.error(`FAIL ${msg}${got !== undefined ? `\n  got: ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`); } };
const eq = (got, want, msg) => ok(got === want, `${msg} (want ${JSON.stringify(want)})`, got);
let X;
try {
  const entry = join(tmp, 'entry.ts');
  writeFileSync(entry, `export * as R from '${join(web, 'src/pages/company/rows')}';\nexport * as P from '${join(web, 'src/lib/peerBoard')}';\nexport { Book } from '${join(web, 'src/lib/registry')}';\nexport { quartersSheet, changesSheet } from '${join(web, 'src/lib/exportCompany')}';\n`);
  const out = join(tmp, 'b.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{"BASE_URL":"/","DEV":false,"PROD":true,"MODE":"test"}' } });
  X = await import(pathToFileURL(out).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }
const { R, P, Book } = X;

const reg = JSON.parse(readFileSync(join(data, 'peers/registry.json'), 'utf8'));
const files = new Map(reg.metrics.map((m) => [m.f, JSON.parse(readFileSync(join(data, `peers/m/${m.f}.json`), 'utf8'))]));
const book = new Book(reg, files);
const ents = reg.sets.find((s) => s.id === 'ins').ids;
const kindOf = (e) => (reg.entities.find((x) => x.id === e)?.k === 'fund' ? 'fund' : 'ins');
const st = P.reportStatus(book, ents);
const live = st.bq === '2026Q3' && st.reported.join() === 'phoenix,harel,migdal';
console.log(`company-p6: data-period guard → ${live ? 'NUMERIC (bq 2026Q3, הפניקס הראל מגדל reported)' : `STRUCTURAL only (bq ${st.bq}, reported ${st.reported.join(',')})`}`);

/* ---------- structure ---------- */
eq(R.INS_ROWS.map((r) => r.k).join(), 'np,comp,isr,csm,eq,roe,sr', 'insurer rows: seven, solvency last (13.1 F6)');
eq(R.FUND_ROWS.map((r) => r.k).join(), 'np,rev,nm,aum,eq,roe', 'fund-house rows: six (5.2)');
ok(R.STRIP.ins.length === 9 && R.STRIP.fund.length === 9, 'peers strip: nine metrics each (5.4)');
ok([...R.STRIP.ins, ...R.STRIP.fund].every((k) => { const m = P.BBY.get(k); return m && !m.spot && m.sec !== 'mkt'; }), 'peers strip: no price, multiple or market metric (9.4 rule 5, T-C9)');
ok(!R.coNeedIds(book, 'ins').some((id) => id.startsWith('mkt:')), 'the company page loads no market file');

const q = st.last.harel, ctx = R.coCtx(book, ents, st, kindOf);
const cell = (k, what, e = 'harel', qq = st.last[e]) => R.coCell(book, R.rowDef(kindOf(e), k), e, kindOf(e), qq, what, ents);
// every figure opens a source; every "–" says why
for (const r of R.INS_ROWS) for (const w of ['v', 'yoy', 'qoq', 'ltm']) {
  const f = cell(r.k, w);
  ok(f.text === '–' ? !!f.why : typeof f.prov === 'function' && f.prov().k !== 'none', `harel ${r.k} ${w}: a figure opens its source, a dash has a reason`, f.text);
  ok(!/\d\.0(?![\d%])/.test(f.text) || r.m.u !== 'm', `harel ${r.k} ${w}: no ".0" on a million`, f.text);
}
eq(cell('sr', 'qoq').text, '–', 'solvency: no QoQ (published for halves)');
ok(/Q[24]$/.test(cell('sr', 'v').p ?? ''), 'solvency carries its own period (a half or a year end)', cell('sr', 'v').p);
const place = R.placeOf(R.coBoard(ctx, P.BBY.get('np')), 'harel');
ok(place.n === st.n, 'place is out of the set count', place);

/* ---------- the waiting company (5.5, T-C5) ---------- */
const waiting = st.waiting[0];
if (waiting) {
  ok(st.last[waiting] < st.bq, `${waiting}: its quarter is behind the set's`);
  const f = cell('np', 'v', waiting);
  ok(f.v != null, `${waiting}: the sentence has its own latest quarter's net profit`, f);
  const pl = R.placeOf(R.coBoard(ctx, P.BBY.get('csm')), waiting);
  ok(pl.text === '–' || pl.star, `${waiting}: a level's place is carried and starred ("3/7*")`, pl);
}

/* ---------- numbers (guarded) ---------- */
if (live) {
  eq(cell('np', 'v').text, '462', "Harel Q3'26 net profit 462");
  eq(cell('np', 'yoy').text, '−46.0%', 'Harel net profit YoY −46.0%');
  eq(cell('np', 'qoq').text, '−56.7%', 'Harel net profit QoQ −56.7%');
  eq(cell('np', 'ltm').text, '2,886', 'Harel net profit LTM 2,886');
  eq(cell('comp', 'v').text, '477', 'Harel comprehensive income 477');
  eq(cell('isr', 'v').text, '692', 'Harel insurance service result 692');
  eq(cell('csm', 'v').text, '17,893', 'Harel CSM 17,893');
  ok(['+4.4%', '+5.4%'].includes(cell('csm', 'yoy').text), 'Harel CSM YoY +4.4% (first prints) or +5.4% (restated, P6-D1)', cell('csm', 'yoy').text);
  eq(cell('csm', 'qoq').text, '+1.0%', 'Harel CSM QoQ +1.0%');
  eq(cell('eq', 'v').text, '12,676', 'Harel equity 12,676');
  eq(cell('roe', 'v').text, '23.9%', 'Harel ROE LTM 23.9%');
  eq(cell('sr', 'v').text, '158%', 'Harel solvency 158% (H1\'26)');
  eq(cell('sr', 'v').p, '2026Q2', "solvency read at H1'26");
  eq(cell('sr', 'yoy').text, '−1.0 נק׳', 'solvency YoY in points against H1\'25');
  const w = R.wordsIn(book, 'ins', 'harel', q, ents);
  eq(w.np.text, '462', 'sentence input: net profit'); eq(w.roe.text, '23.9%', 'sentence input: ROE LTM');
  eq(R.npPct(w.np.v, w.npY.v).toFixed(1), '-46.0', 'sentence: YoY on the same two figures as the table');
  eq(st.last.clal, '2026Q2', 'Clal waits on Q2\'26');
  eq(cell('np', 'v', 'clal').text, '617', "Clal Q2'26 net profit 617");
  eq(cell('np', 'qoq', 'clal').text, '+41.2%', 'Clal QoQ +41.2%');
}

/* ---------- the workbook's quarters sheet (N10: LTM = SUM, YoY formulas, cached values, live links) ---------- */
{
  const sh = X.quartersSheet(book, 'harel', 'ins', q, ents, 'הראל');
  const cells = sh.rows.flat().filter((c) => c && typeof c === 'object');
  const sums = cells.filter((c) => /^SUM\(/.test(c.f ?? '')), yoys = cells.filter((c) => /-1\)\*100$/.test(c.f ?? ''));
  ok(sums.length >= 3 * 8, 'quarters sheet: LTM rows are SUM formulas', sums.length);
  ok(sums.every((c) => typeof c.v === 'number'), 'quarters sheet: every SUM stores its cached value');
  ok(yoys.length >= 20 && yoys.every((c) => typeof c.v === 'number'), 'quarters sheet: YoY rows are formulas with cached values', yoys.length);
  const links = cells.filter((c) => /^HYPERLINK\(/.test(c.f ?? ''));
  ok(links.length > 20 && links.every((c) => typeof c.v === 'string' && c.v), 'quarters sheet: > 20 live HYPERLINK cells with their text cached', links.length);
  if (live) {
    const ltmRow = sh.rows.find((r) => r[0] === 'רווח נקי, LTM'), last = ltmRow[ltmRow.length - 1];
    ok(Math.abs(last.v - 2886) < 1, 'quarters sheet: Harel LTM net profit Q3\'26 cached ≈ 2,886', last);
  }
}

console.log(`company-p6: ${n - fails} / ${n} passed`);
process.exit(fails ? 1 : 0);
