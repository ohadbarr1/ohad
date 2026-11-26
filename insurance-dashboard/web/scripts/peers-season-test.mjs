// P6 (26.11.26): the peer board's rules for a quarter not every insurer has reported, on the published data. node web/scripts/peers-season-test.mjs
//   B2  Harel Q4'25 on the peer registry = the company page's (FY − Q1 − Q2 − Q3 on the latest prints): 3,669 / 576
//   B3  P/B over time at the board's quarter: a company that has not reported is read on its latest equity and the quarter-end close
//       (lib/seriesCols.carriedVal), so the median counts every company; the free table's latest column follows the same rule
//   B17 a balance's source title names its quarter end, never "LTM"
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(web, 'public/data');
const tmp = mkdtempSync(join(tmpdir(), 'peers-season-'));
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error(`FAIL ${msg}`); } else console.log(`ok   ${msg}`); };
try {
  const entry = join(tmp, 'entry.ts');
  writeFileSync(entry, `export { Book } from '${join(web, 'src/lib/registry')}';\nexport { cellVal, carriedVal, parseCol } from '${join(web, 'src/lib/seriesCols')}';\nexport { histVal, MBY, median } from '${join(web, 'src/lib/peerBoard')}';\n`);
  const out = join(tmp, 'b.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{"BASE_URL":"/","DEV":false,"PROD":true,"MODE":"test"}' } });
  const { Book, cellVal, carriedVal, parseCol, histVal, MBY, median } = await import(pathToFileURL(out).href);
  const reg = JSON.parse(readFileSync(join(data, 'peers/registry.json'), 'utf8'));
  const files = new Map(reg.metrics.map((m) => [m.f, JSON.parse(readFileSync(join(data, `peers/m/${m.f}.json`), 'utf8'))]));
  const book = new Book(reg, files);
  const ins = ['phoenix', 'harel', 'migdal', 'clal', 'menora', 'ayalon', 'hachshara'];

  // B2
  const q4 = book.get('ifrs:insurance_revenue', 'harel', 'Q', '2025Q4'), q4s = book.get('ifrs:insurance_service_result', 'harel', 'Q', '2025Q4');
  ok(q4.v === 3669 && q4s.v === 576, `Harel Q4'25 insurance revenue / service result = 3,669 / 576 (got ${q4.v} / ${q4s.v})`);
  const ltm = book.get('ifrs:insurance_revenue', 'harel', 'LTM', '2026Q3');
  ok(ltm.v === 14372, `Harel LTM Q3'26 insurance revenue = 14,372 (got ${ltm.v})`);
  ok(book.get('ifrs:insurance_revenue', 'harel', 'Q', '2025Q1').fl & 8, "Harel Q1'25 insurance revenue flagged restated (8)");

  // B3: P/B at Q3'26, the board's quarter
  const pb = MBY.get('pb');
  const at = (e, carry) => histVal(book, pb, e, 'ins', '2026Q3', ins, carry);
  const reported = ins.filter((e) => at(e, false)?.v != null), carried = ins.filter((e) => at(e, false)?.v == null && at(e, true)?.v != null);
  ok(['harel', 'migdal', 'phoenix'].every((e) => reported.includes(e)), `reported Q3'26: ${reported.join(', ')}`);
  ok(carried.includes('clal'), `carried at Q3'26: ${carried.join(', ')}`);
  const c = at('clal', true), mc3 = book.get('mkt:mcap', 'clal', 'LTM', '2026Q3').v, eq2 = book.get('ifrs:equity_attributable', 'clal', 'Q', '2026Q2').v;
  ok(c.stale && c.p === '2026Q2' && Math.abs(c.v - mc3 / eq2) < 1e-9, `Clal P/B Q3'26* = mcap 30.09.26 / equity 30.06.26 = ${(mc3 / eq2).toFixed(4)} (got ${c.v?.toFixed(4)})`);
  const med3 = median(ins.map((e) => at(e, true)?.v).filter((v) => v != null && v > 0)), n3 = ins.filter((e) => at(e, true)?.v != null).length;
  const med2 = median(ins.map((e) => histVal(book, pb, e, 'ins', '2026Q2', ins)?.v).filter((v) => v != null && v > 0)), n2 = ins.filter((e) => histVal(book, pb, e, 'ins', '2026Q2', ins)?.v != null).length;
  ok(n3 === n2, `the Q3'26 median counts as many companies as Q2'26's (${n3} vs ${n2}); medians ${med2?.toFixed(4)} -> ${med3?.toFixed(4)}`);
  // the free table's latest column: LTM net profit
  const col = parseCol('ifrs:profit_attributable', book);
  const x = cellVal(book, col, 'clal', 'LTM', '2026Q3', ins), y = carriedVal(book, col, 'clal', 'LTM', '2026Q3', ins), z = cellVal(book, col, 'clal', 'LTM', '2026Q2', ins);
  ok(x.v == null && y && y.from === '2026Q2' && y.v === z.v, `free table: Clal LTM Q3'26 profit = LTM Q2'26* ${z.v} (got ${y?.v}, from ${y?.from})`);
  ok(carriedVal(book, col, 'harel', 'LTM', '2026Q3', ins)?.v === cellVal(book, col, 'harel', 'LTM', '2026Q2', ins).v, 'carriedVal reads one period back (Harel)');

  // B17
  const t = book.get('solv:sr_wo', 'phoenix', 'LTM', '2025Q4').prov().title;
  ok(!t.includes('LTM') && t.includes("Q4'25"), `solvency source title: ${t}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('peers-season: all passed');
