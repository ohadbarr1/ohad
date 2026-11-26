// P6 F2 (spec 3.3, 4, 13.2, 14.3): node test for the board's numbers, src/lib/peerBoard.ts (phase-6 part) and src/lib/quarters.ts.
// Run: node scripts/peer-board-test.mjs
// On the COMMITTED data (public/data/peers/*, companies/*.price.json, mkt.json). Data-period guard (spec 9.5, 14.6): the numeric
// assertions run when reportStatus('ins') gives bq = 2026Q3 with exactly הפניקס, הראל, מגדל reported (and, for the spot multiples, the
// price files close on 2026-11-25); otherwise only the structural ones run. The guard prints which mode ran.
// Harel's CSM YoY at Q3'26 carries both expectations (14.2, P6-D1): +4.4% on the first prints (17,133 at Q3'25), +5.4% on the restated
// comparative (16,983). Cases no fixture reaches (chain tie, negative base) run on a SYNTHETIC book, marked as such.
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(web, 'public/data');
const tmp = mkdtempSync(join(tmpdir(), 'peer-board-'));
let n = 0, fails = 0;
const ok = (c, msg, got) => { n++; if (!c) { fails++; console.error(`FAIL ${msg}${got !== undefined ? `\n  got: ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`); } };
const eq = (got, want, msg) => ok(got === want, `${msg} (want ${JSON.stringify(want)})`, got);
const near = (got, want, tol, msg) => ok(got != null && Math.abs(got - want) <= tol, `${msg} (want ${want} ± ${tol})`, got);
let P, Q, Book;
try {
  const entry = join(tmp, 'entry.ts');
  writeFileSync(entry, `export * from '${join(web, 'src/lib/peerBoard')}';\nexport * as Q from '${join(web, 'src/lib/quarters')}';\nexport { Book } from '${join(web, 'src/lib/registry')}';\n`);
  const out = join(tmp, 'b.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{"BASE_URL":"/","DEV":false,"PROD":true,"MODE":"test"}' } });
  P = await import(pathToFileURL(out).href); Q = P.Q; Book = P.Book;
} finally { rmSync(tmp, { recursive: true, force: true }); }

/* ---------- quarters.ts ---------- */
eq(Q.qlab('2026Q3'), "Q3'26", 'qlab quarter'); eq(Q.qlab('2026H1'), "H1'26", 'qlab half'); eq(Q.qlab('2025FY'), "FY'25", 'qlab year'); eq(Q.qlab(null), '–', 'qlab null');
eq(Q.qBack('2026Q3', 4), '2025Q3', 'qBack 4'); eq(Q.qBack('2026Q1', 1), '2025Q4', 'qBack across a year');
eq(Q.perLabel('2026Q2'), "H1'26", 'perLabel Q2 = H1'); eq(Q.perLabel('2025Q4'), "FY'25", 'perLabel Q4 = FY');
eq(Q.dlab('2026-09-30'), '30.09.26', 'dlab');
eq(Q.readLabel('q', '2026Q3'), "Q3'26", 'the seg names the quarter itself'); eq(Q.readLabel('ltmy', '2026Q3'), 'LTM YoY', 'LTM YoY label');
eq(Q.ltmSum([1, 2, 3, 4]), 10, 'ltmSum'); eq(Q.ltmSum([1, null, 3, 4]), null, 'ltmSum: a missing quarter is not zero');
eq(Q.chgPct(110, 100).v.toFixed(6), '10.000000', 'chgPct'); eq(Q.chgPct(20, -50).why, 'בסיס שלילי', 'chgPct: negative base'); eq(Q.chgPct(5, 0).v, null, 'chgPct: zero base');
eq(Q.chgPts(17.9, 16.2).toFixed(1), '1.7', 'chgPts');
eq(Q.fmtBnDiff(8.66), '+8.7 מ׳ד', 'a ₪bn difference'); eq(Q.fmtPts(-0.19, 2), '−0.19 נק׳', 'points'); eq(Q.fmtPct(7.087), '+7.1%', 'percent');

/* ---------- metric shapes ---------- */
ok(P.METRICS.every((m) => m.type), 'every table metric has a type', P.METRICS.filter((m) => !m.type).map((m) => m.key));
ok(P.METRICS.every((m) => m.reads?.length || m.of || m.hide), 'every table metric has readings, or is a change column of a base, or hidden');
ok(P.METRICS.filter((m) => m.of).every((m) => P.BBY.has(m.of)), 'every change column points at a board metric');
const BM = P.boardMetrics(['ins', 'ins', 'ins', 'ins', 'ins', 'ins', 'ins']).map((m) => m.key);
['pbc', 'pb', 'pe', 'roe', 'np', 'csm', 'isrm', 'oshare', 'onet', 'tr', 'rev', 'csmeq', 'sr'].forEach((k) => ok(BM.includes(k), `insurer board offers ${k}`));
['npy', 'csmy', 'r3', 'r12', 'oshd', 'maum', 'oflowa'].forEach((k) => ok(!BM.includes(k), `insurer board folds ${k}`));
const M = (k) => P.BBY.get(k);
eq(P.defRead(M('pbc')), 'now', 'P/(B+CSM) reads now'); eq(P.defRead(M('np')), 'ltm', 'net profit opens on LTM'); eq(P.defRead(M('csm')), 'q', 'CSM opens on the quarter');
eq(P.defRead(M('tr')), 'r12', 'total return opens on 12M'); eq(P.readOf(M('csm'), 'ltmy'), 'q', 'a reading the metric lacks falls back to its default');
// 13.2: quarter-named readings
const QN = [['np', 'q', true], ['np', 'yoy', true], ['np', 'qoq', true], ['np', 'ltm', false], ['np', 'ltmy', false], ['csm', 'q', false], ['csm', 'qoq', true],
  ['isrm', 'q', true], ['isrm', 'ltm', false], ['isrm', 'ltmy', false], ['roe', 'yoy', false], ['roe', 'qoq', false], ['csmeq', 'q', false], ['csmeq', 'qoq', true],
  ['oshare', 'yoy', false], ['onet', 'q', false], ['pbc', 'now', false], ['sr', 'q', false], ['tr', 'r12', false]];
QN.forEach(([k, rd, w]) => eq(P.quarterNamed(M(k), rd), w, `quarterNamed(${k}, ${rd})`));
eq(P.basisText(M('csm'), 'qoq', '2026Q3'), "Q3'26 מול Q2'26", 'basis: CSM QoQ'); eq(P.basisText(M('np'), 'ltmy', '2026Q3'), "LTM Q3'26 מול LTM Q3'25", 'basis: LTM YoY');
eq(P.basisText(M('np'), 'yoy', '2026Q3'), "Q3'26 מול Q3'25", 'basis: quarter YoY'); eq(P.basisText(M('roe'), 'qoq', '2026Q3'), "LTM Q3'26 מול LTM Q2'26", "basis: ROE QoQ is on LTM");
eq(P.basisText(M('csm'), 'q', '2026Q3'), '', 'no basis on a level');
eq(P.basisShort(M('np'), 'ltmy', '2026Q3'), 'LTM מול LTM', 'table head beside an LTM level'); eq(P.basisShort(M('csm'), 'yoy', '2026Q3'), "מול Q3'25", 'table head beside a balance');
eq(P.basisShort(M('roe'), 'qoq', '2026Q3'), 'LTM מול LTM קודם', 'table head, ROE QoQ');
eq(P.pairRead(M('np')), 'ltmy', 'pairRead: a flow pairs LTM with LTM'); eq(P.pairRead(M('csm')), 'yoy', 'pairRead: a balance pairs quarter end'); eq(P.pairRead(M('isrm')), 'ltmy', 'pairRead: a margin');
eq(P.pairRead(M('roe')), 'yoy', 'pairRead: ROE (LTM based)'); eq(P.pairRead(M('pbc')), null, 'pairRead: a multiple has none');
eq(P.chgKind(M('onet')), 'diff', 'net accumulation changes as a difference'); eq(P.chgKind(M('oshare')), 'pts', 'share changes in points'); eq(P.chgKind(M('csm')), 'pct', 'CSM changes in percent');
eq(P.fmtRead(M('onet'), 'yoy', 3.868), '+3.9 מ׳ד', 'a sign-changing flow: ₪bn'); eq(P.fmtRead(M('csmeq'), 'qoq', 0.041), '+0.04x', 'CSM / equity change in x');
eq(P.fmtRead(M('oshare'), 'yoy', 0.338), '+0.34 נק׳', 'share YoY in points'); eq(P.fmtRead(M('pbc'), 'now', 0.853), '0.85x', 'a multiple');
eq(P.fmtRead(M('csm'), 'q', 17893), '17,893', 'no K: five digits in full'); eq(P.fmtRead(M('roe'), 'qoq', 0.2), '+0.2 נק׳', 'ROE change in points');
eq(P.bandOf(M('pbc'), 'now', []), 0.02, 'band: P/B-type two displayed units'); eq(P.bandOf(M('pe'), 'now', []), 0.2, 'band: P/E 0.2');
eq(P.bandOf(M('roe'), 'ltm', []), 0.2, 'band: ROE 0.2 points'); eq(P.bandOf(M('oshare'), 'q', []), 0.02, 'band: share 0.02 points');
eq(P.bandOf(M('csm'), 'qoq', []), 0.2, 'band: percent change 0.2'); eq(P.bandOf(M('csm'), 'q', [100, 200, 300]), 1, 'band: amount 0.5% of the median');

/* ---------- SYNTHETIC: chain tie and a negative base ---------- */
{
  const reg = { asof: 'x', entities: ['a', 'b', 'c', 'd'].map((id) => ({ id, n: id.toUpperCase(), k: 'ins' })), sets: [], groups: [], src: {}, notes: [], reg: { p0: 0, groups: [] },
    metrics: [{ id: 'ifrs:profit_attributable', l: 'רווח', g: '', src: 'ifrs', u: 'm', k: 'f', f: 'np', n: 0, r: ['', ''], e: [] }] };
  const qs = ['2025Q3', '2025Q4', '2026Q1', '2026Q2', '2026Q3'];
  const ser = { a: [100, 1, 1, 1, 110], b: [100, 1, 1, 1, 109.85], c: [100, 1, 1, 1, 109.7], d: [-50, 1, 1, 1, 20] };
  const file = { u: [], e: Object.fromEntries(Object.entries(ser).map(([e, vs]) => [e, { c: vs.map((v, i) => [qs[i], v, null, null, 0]) }])) };
  const sb = new Book(reg, new Map([['np', file]]));
  const st = P.reportStatus(sb, ['a', 'b', 'c', 'd']);
  eq(st.bq, '2026Q3', 'synthetic: bq');
  const b = P.boardRows({ book: sb, ents: ['a', 'b', 'c', 'd'], q: '2026Q3', status: st }, M('np'), 'yoy');
  eq(b.rows.map((r) => `${r.e}${r.place ?? '–'}`).join(' '), 'a1 b1 c3 d–', 'SYNTHETIC chain tie: +10.00, +9.85, +9.70 (band 0.2) → places 1, 1, 3');
  ok(b.rows[0].shared && b.rows[1].shared && !b.rows[2].shared, 'SYNTHETIC: the first two share, the third does not');
  const d = b.rows.find((r) => r.e === 'd');
  ok(d.v == null && /בסיס שלילי/.test(d.val.why ?? ''), 'SYNTHETIC negative base: no percent, "בסיס שלילי"', d.val.why);
  eq(b.n, 3, 'SYNTHETIC: the median counts the three with a figure');
}

/* ---------- the committed data ---------- */
const reg = JSON.parse(readFileSync(join(data, 'peers/registry.json'), 'utf8'));
const files = new Map(reg.metrics.map((m) => [m.f, JSON.parse(readFileSync(join(data, `peers/m/${m.f}.json`), 'utf8'))]));
const book = new Book(reg, files);
const ents = reg.sets.find((s) => s.id === 'ins').ids;
const px = Object.fromEntries(ents.map((e) => { try { return [e, JSON.parse(readFileSync(join(data, `companies/${e}.price.json`), 'utf8'))]; } catch { return [e, null]; } }));
const mk = JSON.parse(readFileSync(join(data, 'mkt.json'), 'utf8'));
const st = P.reportStatus(book, ents);
const qReg = book.latest('reg:assets@all', 'LTM', ents);
const C = { book, ents, q: st.bq, qReg, px, mk, status: st };
const NUM = st.bq === '2026Q3' && st.reported.join() === 'phoenix,harel,migdal';
const PX = NUM && ents.every((e) => !px[e] || px[e].asof === '2026-11-25');
console.log(`guard: bq=${st.bq} cq=${st.cq} reported=${st.reported.join(',')} asof=${reg.asof} → ${NUM ? 'NUMERIC' : 'STRUCTURAL'} mode${NUM && !PX ? ' (prices moved: spot multiples structural)' : ''}`);

// structural, always
ok(st.reported.length + st.waiting.length + st.none.length === ents.length, 'reportStatus partitions the set');
ok(st.reported.every((e) => st.last[e] === st.bq) && st.waiting.every((e) => st.last[e] < st.bq && st.last[e] >= st.cq), 'reported = bq, waiting between cq and bq');
eq(st.n, ents.length - st.none.length, 'n = companies with statements');
const board = (k, rd, c = C) => P.boardRows(c, M(k), rd);
for (const k of BM) for (const rd of M(k).reads) {
  const b = board(k, rd);
  ok(b.rows.length === ents.length, `${k}:${rd} one row per company`);
  ok(b.med.n === b.rows.filter((r) => !r.out && r.v != null).length, `${k}:${rd} the median's n = the ranked rows with a figure`);
  ok(b.rows.filter((r) => r.out).every((r) => b.strict && st.waiting.includes(r.e)), `${k}:${rd} only quarter-named readings set companies aside, and only those still waiting`);
  ok(b.rows.every((r) => !r.out || r.place == null), `${k}:${rd} a set-aside row has no place`);
  const pls = b.rows.filter((r) => r.place != null).map((r) => r.place);
  ok(pls.every((p, i) => i === 0 || p >= pls[i - 1]), `${k}:${rd} rows in place order`);
  if (b.strict) ok(b.n <= st.reported.length, `${k}:${rd} strict: n ≤ reporters`);
}
// the common basis (base=common): everyone at cq, nobody set aside or starred on a filing metric
{
  const Cc = { ...C, q: st.cq };
  const b = board('csm', 'qoq', Cc);
  ok(b.rows.every((r) => !r.out && !r.stale), 'common basis: CSM QoQ at cq, nobody set aside or starred');
  eq(b.q, st.cq, 'common basis: the board reads cq');
  eq(P.basisText(M('csm'), 'qoq', st.cq), `${Q.qlab(st.cq)} מול ${Q.qlab(Q.qBack(st.cq, 1))}`, 'common basis: the basis follows');
}

if (NUM) {
  const v = (b, e) => b.rows.find((r) => r.e === e);
  // the multiples of the spec's header (live board 26.11.26)
  if (PX) {
    const pe = board('pe', 'now'), pb = board('pb', 'now'), pbc = board('pbc', 'now');
    near(v(pe, 'phoenix').v, 13.5, 0.05, 'Phoenix P/E 13.5x'); near(v(pb, 'phoenix').v, 3.10, 0.005, 'Phoenix P/B 3.10x'); near(v(pbc, 'phoenix').v, 2.15, 0.005, 'Phoenix P/(B+CSM) 2.15x');
    near(v(pe, 'harel').v, 12.3, 0.05, 'Harel P/E 12.3x'); near(v(pb, 'harel').v, 2.80, 0.005, 'Harel P/B 2.80x'); near(v(pbc, 'harel').v, 1.45, 0.005, 'Harel P/(B+CSM) 1.45x');
    near(pbc.med.v, 1.50, 0.005, 'P/(B+CSM) median 1.50x'); eq(pbc.med.n, 6, 'P/(B+CSM) median on 6 (הכשרה: no listed share)');
    eq(pbc.rows[0].e, 'migdal', 'cheapest first: מגדל'); near(pbc.rows[0].v, 0.85, 0.005, 'מגדל 0.85x'); eq(pbc.rows[5].e, 'phoenix', 'dearest of the six: הפניקס');
    ok(v(pbc, 'hachshara').noShare && v(pbc, 'hachshara').v == null && v(pbc, 'hachshara').place == null, 'הכשרה: no listed share, no figure, not ranked, last');
    eq(pbc.rows[6].e, 'hachshara', 'the company without a share closes the list');
    ok(v(pbc, 'clal').stale && v(pbc, 'clal').q === '2026Q2', 'כלל P/(B+CSM): latest close over Q2\'26 figures, starred (rule 1)');
    eq(v(pbc, 'migdal').val.prov().k, 'calc', 'a board value opens its formula');
  }
  const roe = board('roe', 'ltm');
  near(v(roe, 'phoenix').v, 24.0, 0.05, 'Phoenix ROE 24.0%'); near(v(roe, 'harel').v, 23.85, 0.06, 'Harel ROE 23.9%');
  eq(roe.n, 7, 'ROE LTM: all seven, carried ones counted');
  // CSM QoQ: +7.1 / +3.5 / +1.0, three ranked, four out
  const cq = board('csm', 'qoq');
  ok(cq.strict, 'CSM QoQ is quarter-named');
  eq(cq.rows.filter((r) => !r.out).map((r) => r.e).join(), 'phoenix,migdal,harel', 'CSM QoQ ranks the three reporters');
  near(v(cq, 'phoenix').v, 7.1, 0.05, 'Phoenix CSM QoQ +7.1%'); near(v(cq, 'migdal').v, 3.5, 0.05, 'Migdal +3.5%'); near(v(cq, 'harel').v, 1.0, 0.05, 'Harel +1.0%');
  near(cq.med.v, 3.5, 0.05, 'CSM QoQ median +3.5%'); eq(cq.n, 3, 'CSM QoQ median on 3');
  eq(cq.rows.filter((r) => r.out).length, 4, 'four set aside'); ok(cq.rows.filter((r) => r.out).every((r) => r.q === '2026Q2'), "each with its own Q2'26 figure");
  eq(P.fmtRead(M('csm'), 'qoq', v(cq, 'phoenix').v), '+7.1%', 'formatted +7.1%');
  const pv = v(cq, 'phoenix').val.prov();
  ok(pv.k === 'calc' && pv.inputs.length === 2 && pv.note === "Q3'26 מול Q2'26" && pv.inputs[0].label.includes("Q3'26") && pv.inputs[1].label.includes("Q2'26"), 'a change opens both quarters and its basis', pv);
  ok(pv.inputs.every((i) => i.src && i.src().k === 'report'), 'each quarter of the change opens its report page');
  // CSM / equity: level on 7 (carried, starred), QoQ on 3
  const ce = board('csmeq', 'q'), ceq = board('csmeq', 'qoq');
  eq(ce.n, 7, 'CSM / הון level: median on 7'); ok(!ce.rows.some((r) => r.out), 'CSM / הון level: nobody set aside'); ok(ce.rows.filter((r) => r.stale).map((r) => r.e).sort().join() === 'ayalon,clal,hachshara,menora', 'the four waiting are starred');
  eq(ceq.n, 3, 'CSM / הון QoQ: median on 3'); eq(ceq.rows.filter((r) => r.out).length, 4, 'CSM / הון QoQ: four listed outside');
  // net profit: LTM YoY on 7 (Phoenix −1.7%), quarter YoY on 3
  const ny = board('np', 'ltmy');
  near(v(ny, 'phoenix').v, -1.7, 0.05, 'Phoenix net profit LTM YoY −1.7%'); eq(ny.n, 7, 'LTM YoY on 7'); ok(!ny.strict, 'LTM YoY is carried, not quarter-named');
  ok(/טרם דווח על Q3'26/.test(v(ny, 'clal').val.prov().note ?? ''), 'a carried LTM YoY opens with "טרם דווח על Q3\'26"', v(ny, 'clal').val.prov().note);
  eq(board('np', 'yoy').n, 3, 'quarter YoY on 3');
  // share YoY (spec 3.4): Phoenix +0.34, Menora −0.19, median +0.21
  const sy = board('oshare', 'yoy');
  eq(sy.rows[0].e, 'phoenix', 'share YoY: the highest is הפניקס'); eq(P.fmtRead(M('oshare'), 'yoy', sy.rows[0].v), '+0.34 נק׳', 'הפניקס +0.34 נק׳');
  eq(sy.rows.filter((r) => r.v != null).pop().e, 'menora', 'the lowest is מנורה'); eq(P.fmtRead(M('oshare'), 'yoy', sy.rows.find((r) => r.e === 'menora').v), '−0.19 נק׳', 'מנורה −0.19 נק׳');
  eq(P.fmtRead(M('oshare'), 'yoy', sy.med.v), '+0.21 נק׳', 'median +0.21 נק׳'); ok(!sy.strict && sy.n === 7, 'regulator readings are complete: all seven');
  // net accumulation YoY in ₪bn (a difference, never a percent)
  const nfy = board('onet', 'yoy');
  ok(nfy.rows.filter((r) => r.v != null).every((r) => /מ׳ד$/.test(P.fmtRead(M('onet'), 'yoy', r.v)) && !/%/.test(P.fmtRead(M('onet'), 'yoy', r.v))), 'net accumulation YoY: ₪bn, no percent');
  const hv = v(nfy, 'harel'), ha = book.get('reg:netflow@all', 'harel', 'Q', qReg).v, hb = book.get('reg:netflow@all', 'harel', 'Q', Q.qBack(qReg, 4)).v;
  near(hv.v, ha - hb, 1e-9, `Harel net accumulation YoY = Q - Q a year earlier (${P.fmtRead(M('onet'), 'yoy', ha - hb)})`);
  // Clal's Q3'26 P/B grid cell = Q3'26 close ÷ Q2'26 equity (T-D4)
  const g = P.gridRow(C, M('pb'), 'now', '2026Q3'), cc = g.cells.find((x) => x.e === 'clal');
  const mc3 = book.get('mkt:mcap', 'clal', 'LTM', '2026Q3').v, eq2 = book.get('ifrs:equity_attributable', 'clal', 'Q', '2026Q2').v;
  ok(cc.star && cc.from === '2026Q2' && Math.abs(cc.v - mc3 / eq2) < 1e-9, `Clal P/B Q3'26* = close 30.09.26 ÷ equity 30.06.26 (${(mc3 / eq2).toFixed(4)})`, cc);
  eq(g.med.n, 6, "P/B grid Q3'26: median on 6 (carried counted)"); eq(P.closeAt(mk, 'clal', '2026Q3'), '2026-09-30', 'the quarter-end close is 30.09.26');
  // CSM QoQ grid: the bq row ranks reporters only, the waiting are hatched "טרם דיווחה"
  const gq = P.gridRow(C, M('csm'), 'qoq', '2026Q3');
  eq(gq.med.n, 3, 'CSM QoQ grid row Q3\'26: n = 3'); ok(gq.cells.filter((x) => st.waiting.includes(x.e)).every((x) => x.v == null && x.why === 'טרם דיווחה'), 'the waiting are hatched "טרם דיווחה"');
  eq(P.quarterGrid(C, M('pbc'), 'now', 12).length, 12, 'grid 12 rows');
  // the CSM basis: Harel Q4'23 is gross (17,011†), its YoY at Q4'24 is "–" with the reason (T-R2b)
  const g23 = P.gridRow(C, M('csm'), 'q', '2023Q4').cells.find((x) => x.e === 'harel');
  ok(g23.v === 17011 && g23.dag === 'gross', "Harel CSM Q4'23 = 17,011†", g23);
  const y24 = P.gridRow(C, M('csm'), 'yoy', '2024Q4').cells.find((x) => x.e === 'harel');
  ok(y24.v == null && y24.why === P.CSM_CROSS, "Harel CSM YoY Q4'24: '–', net against gross", y24.why);
  eq(P.csmBasis(book, 'phoenix', '2025Q2'), null, 'an unstated basis is not a different basis');
  ok(P.gridRow(C, M('csm'), 'q', '2025Q2').cells.find((x) => x.e === 'phoenix').dag == null, 'no † on an unstated basis');
  // Harel CSM YoY at Q3'26: first prints +4.4%, restated comparative +5.4% (P6-D1)
  const h25 = book.get('ifrs:csm_closing', 'harel', 'Q', '2025Q3').v, post = h25 === 16983;
  near(v(board('csm', 'yoy'), 'harel').v, post ? 5.4 : 4.4, 0.05, `Harel CSM YoY Q3'26 (${post ? 'restated, P6-D1 landed' : 'first prints, before P6-D1'}; Q3'25 = ${h25})`);
  // a half-year metric: tagged with its period, ranked
  const sr = board('sr', 'q');
  ok(sr.rows.every((r) => r.v == null || /Q[24]$/.test(r.per)), 'solvency rows carry their half / year'); eq(sr.n, 7, 'solvency ranked on 7');
  // the median opens its components and the rule
  const mp = P.medianProv(cq, (e) => book.short(e));
  ok(mp.k === 'calc' && mp.inputs.length === 3 && /חציון של 3 חברות שדיווחו Q3'26/.test(mp.formula), 'the median opens its 3 parts and its rule', mp.formula);
  const mp7 = P.medianProv(ce, (e) => book.short(e));
  ok(mp7.inputs.length === 7 && mp7.inputs.filter((i) => i.label.includes('*')).length === 4 && mp7.note === P.CARRY_RULE, 'a level median: 7 parts, carried ones starred, the carry rule');
}
console.log(`peer-board: ${n - fails}/${n} passed`);
if (fails) { console.error(`${fails} failed`); process.exit(1); }
