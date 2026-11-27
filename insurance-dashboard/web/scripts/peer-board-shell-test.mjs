// P6-2a: node test for the board shell's pure pieces (no data period involved): the view strip's addresses (ViewStrip viewHref / viewOf,
// tester P5), the matrix sections (Matrix secCols: ≤ 12 columns, the paired change after its level), the metric of an address
// (PeersBoard resolveMetric: D2 default, old change-column links), the grid's figures (BoardLens gridFmt). Run: node scripts/peer-board-shell-test.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'peer-shell-'));
let n = 0, fails = 0;
const ok = (c, msg, got) => { n++; if (!c) { fails++; console.error(`FAIL ${msg}${got !== undefined ? `\n  got: ${JSON.stringify(got)}` : ''}`); } };
const eq = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), `${msg} (want ${JSON.stringify(want)})`, got);
let X;
try {
  const entry = join(tmp, 'entry.ts');
  writeFileSync(entry, [
    `export { viewHref, viewOf, BOARD_ONLY } from '${join(web, 'src/pages/peers/ViewStrip')}';`,
    `export { secCols, SECS } from '${join(web, 'src/pages/peers/Matrix')}';`,
    `export { resolveMetric } from '${join(web, 'src/pages/PeersBoard')}';`,
    `export { gridFmt } from '${join(web, 'src/pages/peers/BoardLens')}';`,
    `export { BBY, boardMetrics } from '${join(web, 'src/lib/peerBoard')}';`,
  ].join('\n'));
  const out = join(tmp, 'b.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty' }, define: { 'import.meta.env': '{"BASE_URL":"/","DEV":false,"PROD":true}' } });
  X = await import(pathToFileURL(out).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }

/* ---------- the view strip ---------- */
const q = (s) => new URLSearchParams(s);
eq(X.viewHref(q('lens=charts&bm=csm&rd=qoq&base=common&sec=biz&gq=12&bx=roe&sheet=ctx&hl=harel&s=ins&door=pro'), 'free').toString(), 'hl=harel&s=ins&door=pro&v=table', 'P5: board lens → free table drops lens and every board key');
eq(X.viewHref(q('lens=charts&hl=harel'), 'series').toString(), 'hl=harel&v=series', 'board → series');
eq(X.viewHref(q('v=table&hl=harel&c=a'), 'company').toString(), 'hl=harel&c=a&lens=focus', 'free table → lens חברה');
eq(X.viewHref(q('lens=focus&bm=pb&sheet=co:harel'), 'board').toString(), 'bm=pb', 'lens → board: no lens, no sheet, the metric kept');
eq(X.viewHref(q('v=series'), 'charts').toString(), 'lens=charts', 'series → charts');
eq(['', 'lens=focus', 'lens=charts', 'lens=table', 'v=table', 'v=series', 'v=table&lens=charts'].map((s) => X.viewOf(q(s))), ['board', 'company', 'charts', 'table', 'free', 'series', 'free'], 'viewOf');

/* ---------- the matrix sections ---------- */
const ins = X.boardMetrics(['ins', 'ins', 'ins', 'ins', 'ins', 'ins', 'ins']), have = new Set(ins.map((m) => m.key)), has = (k) => have.has(k);
for (const [s] of X.SECS) {
  const cols = X.secCols(s, has);
  ok(cols.length > 0 && cols.length <= 12, `section ${s}: 1–12 columns`, cols.length);
  cols.forEach(([m, r], i) => { if (r === 'yoy' || r === 'ltmy') ok(i > 0 && cols[i - 1][0] === m, `section ${s}: ${m.key} ${r} sits after its level`, cols.map(([x, y]) => `${x.key}.${y}`)); });
}
eq(X.secCols('mix', has).map(([m, r]) => `${m.key}.${r}`), ['mcap.now', 'pe.now', 'pb.now', 'pbc.now', 'dy.now', 'tr.r12', 'np.ltm', 'roe.ltm', 'isrm.ltm', 'csm.q', 'csmeq.q', 'sr.q'], 'עיקרי: the spec 3.5 list, no paired changes');
eq(X.secCols('biz', has).slice(0, 4).map(([m, r]) => `${m.key}.${r}`), ['np.ltm', 'np.ltmy', 'roe.ltm', 'roe.yoy'], 'העסק: LTM level then LTM against LTM (14.3 rule 2)');
const fund = X.boardMetrics(['fund', 'fund', 'fund']), fh = new Set(fund.map((m) => m.key));
ok(!X.secCols('mix', (k) => fh.has(k)).some(([m]) => m.key === 'pbc' || m.key === 'csm'), 'fund houses: no P/(B+CSM), no CSM in עיקרי');

/* ---------- the metric of an address ---------- */
const rm = (bm, rd, ms = ins, all = true) => { const x = X.resolveMetric(bm, rd, ms, all); return `${x.m.key}.${x.rd}`; };
eq(rm(null, null), 'pbc.now', 'D2: an insurer set opens on P/(B+CSM)');
eq(rm(null, null, fund, false), 'pb.now', 'D2: a fund-house set opens on P/B');
eq(rm('csm', 'qoq'), 'csm.qoq', 'bm=csm&rd=qoq');
eq(rm('csm', 'ltm'), 'csm.q', 'a reading the metric does not have falls back to its default');
eq(rm('csmy', null), 'csm.yoy', 'old link bm=csmy → CSM YoY');
eq(rm('npy', null), 'np.ltmy', 'old link bm=npy (LTM YoY in the tables) → net profit LTM YoY');
eq(rm('r3', null), 'tr.r3', 'old link bm=r3 → total return 3M');
eq(rm('oshd', null), 'oshare.yoy', 'old link bm=oshd → share YoY');
eq(rm('nope', null), 'pbc.now', 'unknown metric → the default');

/* ---------- the grid's figures ---------- */
const B = (k) => X.BBY.get(k);
eq(X.gridFmt(B('csm'), 'qoq')(7.0849), '+7.1', 'CSM QoQ: signed percent, one decimal');
eq(X.gridFmt(B('csm'), 'q')(17893), '17,893', 'CSM level: full number, no "K"');
eq(X.gridFmt(B('isrm'), 'qoq')(-0.04), '−0.0'.replace('−', ''), 'margin QoQ: points, a zero has no sign');
eq(X.gridFmt(B('csmeq'), 'yoy')(0.0512), '+0.05', 'CSM / equity YoY: two decimals in x');
eq(X.gridFmt(B('oshare'), 'yoy')(-0.191), '−0.19', 'share YoY: two decimals, U+2212');
eq(X.gridFmt(B('onet'), 'ltm')(8.66), '+8.7', 'net accumulation level: signed (the flow changes sign)');
eq(X.gridFmt(B('pbc'), 'now')(1.7), '1.70', 'a multiple: two decimals, the unit in the head');

console.log(`peer-board-shell-test: ${n - fails}/${n} passed`);
if (fails) process.exit(1);
