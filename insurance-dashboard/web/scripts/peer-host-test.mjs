// P6-2c: node test for src/lib/peerHost.ts (address hygiene of the peer-table views, the partial-quarter line over the free table and
// the series, basis lines). Run: node scripts/peer-host-test.mjs. Pure logic on literal inputs (no data period involved).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'peer-host-'));
let n = 0, fails = 0;
const ok = (c, msg, got) => { n++; if (!c) { fails++; console.error(`FAIL ${msg}${got !== undefined ? `\n  got: ${JSON.stringify(got)}` : ''}`); } };
const eq = (got, want, msg) => ok(got === want, `${msg} (want ${JSON.stringify(want)})`, got);
let H;
try {
  const entry = join(tmp, 'entry.ts');
  writeFileSync(entry, `export * from '${join(web, 'src/lib/peerHost')}';\n`);
  const out = join(tmp, 'b.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{"BASE_URL":"/","DEV":false}' } });
  H = await import(pathToFileURL(out).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }

// P5: leaving the board drops its keys, keeps the set, the focus and the door
const q = (s) => new URLSearchParams(s);
eq(H.leaveBoard(q('lens=charts&bm=csm&rd=qoq&base=common&sec=biz&sheet=ctx&hl=harel&s=ins&door=pro&bx=roe')).toString(), 'hl=harel&s=ins&door=pro', 'leaveBoard');
eq(H.peerViewSearch('?lens=charts&hl=harel&door=pro&bm=pb', 'table'), '?hl=harel&door=pro&v=table', 'board lens -> free table');
eq(H.peerViewSearch('?v=table&c=a&c=b&f=Q&hl=harel', 'series'), '?c=a&c=b&f=Q&hl=harel&v=series', 'table -> series keeps the columns');
eq(H.peerViewSearch('?v=series&c=a&f=Q&n=3&hl=x', 'board'), '?hl=x', 'series -> board drops the table keys and v');
eq(H.peerViewSearch('?v=table&c=a&hl=x', 'deck'), '?hl=x&v=deck', 'table -> deck');
eq(H.peerViewSearch('', 'board'), '', 'empty stays empty');

// the line over the free table and the series
const base = { f: 'LTM', p: '', auto: '2026Q3', n: 7, names: ['כלל', 'מנורה', 'הכשרה', 'איילון'], from: '2026Q2', bq: '2026Q3', cq: '2026Q2', waiting: 4 };
const g = H.tableGuard(base);
eq(g?.mode, 'latest', 'latest mode'); eq(g?.to, '2026Q2', 'action reads at the carried period');
ok(/^3 מתוך 7 דיווחו Q3'26\. כלל, מנורה, הכשרה, איילון: לפי Q2'26, מסומנות ונספרות\.$/.test(g?.text ?? ''), 'text of the line', g?.text);
eq(g?.action, "הכול על Q2'26 ›", 'action label');
ok(/5 חברות: לפי/.test(H.tableGuard({ ...base, names: ['א', 'ב', 'ג', 'ד', 'ה'], waiting: 5 })?.text ?? ''), 'more than four names -> a count');
const c = H.tableGuard({ ...base, f: 'Q', p: '2026Q2', names: [] });
eq(c?.mode, 'common', 'common mode'); eq(c?.to, '', 'way back clears p');
ok(/מוצג על בסיס Q2'26, הרבעון האחרון שכל 7 החברות דיווחו\./.test(c?.text ?? ''), 'common text', c?.text);
eq(c?.action, "חזרה ל-Q3'26 ›", 'common action');
eq(H.tableGuard({ ...base, names: [] }), null, 'nobody carried: no line');
eq(H.tableGuard({ ...base, p: '2025Q3' }), null, 'an explicit older period: no line');
eq(H.tableGuard({ ...base, f: 'FY', p: '2025FY', names: [] }), null, 'annual table never gets the common line');
eq(H.tableGuard({ ...base, f: 'Q', p: '2026Q2', names: [], waiting: 0 }), null, 'everyone reported: no common line');

// basis lines
eq(H.basisLine('y', 'LTM', '2026Q3'), "YoY: LTM Q3'26 מול LTM Q3'25", 'YoY basis');
eq(H.basisLine('q', 'Q', '2026Q3'), "מול תקופה קודמת: Q3'26 מול Q2'26", 'vs previous');
eq(H.basisLine('c', 'FY', '2025FY'), "CAGR 3 שנים: FY'25 מול FY'22", 'CAGR');
eq(H.basisLine('v', 'Q', '2026Q3'), null, 'a level has no basis line');
ok(!/אשתקד/.test(H.seriesBasis('y')), 'no "אשתקד"');
eq(H.medN(6), 'חציון על 6 חברות', 'median n');
console.log(`peer-host-test: ${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
