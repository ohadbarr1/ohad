// Rollout F2 (spec 18.3, 18.5, 18.6): node test for src/lib/pageMonths.ts. Run: node scripts/page-months-test.mjs
// Bundles the module with esbuild (Vite's own copy) and checks it on the LIVE data files of the repo (public/data/funds.json,
// public/data/funds/cat.json, public/data/funds/<k>.json; data month 10/26, gross as published) against the figures of spec 18.6,
// plus hand-made cases for placeGroups (anchored groups, standard competition places, the chip rule).
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'pagemonthstest-')), out = join(dir, 'pageMonths.mjs');
let M;
try {
  await build({ entryPoints: [new URL('../src/lib/pageMonths.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } });
  M = await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
const { roundHalf } = await (async () => { const o = join(mkdtempSync(join(tmpdir(), 'pm2-')), 'cm.mjs'); await build({ entryPoints: [new URL('../src/lib/compareMonths.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: o, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } }); return import(pathToFileURL(o).href); })();

let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.error(`FAIL ${what}${got !== undefined ? `\n  got: ${JSON.stringify(got)}` : ''}`); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const r1 = (v) => (v == null ? null : roundHalf(v, 1)), r2 = (v) => (v == null ? null : roundHalf(v, 2));

/* ---- live data ---- */
const data = (p) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url)));
const FF = data('funds.json'), ASOF = FF.asof, FUNDS = FF.funds, F = Object.fromEntries(FUNDS.map((f) => [f.k, f]));
const CATS = data('funds/cat.json'), H = (k) => data(`funds/${k}.json`);
ok(ASOF === 202610, 'data month is 10/26', ASOF);
const PG = 'פנסיה מקיפה | כללי', HG = 'השתלמות | כללי', GG = 'גמל להשקעה | כללי';
const pg = M.typeMembers(FUNDS, PG), hg = M.typeMembers(FUNDS, HG), gg = M.typeMembers(FUNDS, GG);

/* ---- placeGroups: hand-made ---- */
const P = (vals, band) => M.placeGroups(vals, band).map((x) => x.place);
ok(eq(P([-0.72, -0.72, -0.73, -1.44, -1.45], 0.05), [1, 1, 1, 4, 4]), 'pension general month: 1, 1, 1, 4, 4');
ok(eq(P([3, 2.97, 2.93, 2.9], 0.05), [1, 1, 3, 3]), 'anchored on the group FIRST, not chained: 3 / 2.97 / 2.93 / 2.90 → 1, 1, 3, 3');
ok(eq(P([1, 0.95, 0.9], 0.05), [1, 2, 3]), 'exactly the band is out (0.05 apart → new group)');
ok(eq(P([null, 2, undefined, 3], 0.05), [null, 2, null, 1]), 'input order kept; no figure → null');
{
  const g = M.placeGroups([-1.45, -0.72, -1.44, -0.73, -0.72], 0.05);
  ok(g.every((x) => x.shared && !x.chip && x.n === 5), 'everyone shares → shared, no chip', g);
  ok(eq(g.map((x) => [x.lo, x.hi]), [[4, 5], [1, 3], [4, 5], [1, 3], [1, 3]]), 'lo–hi spans', g.map((x) => [x.lo, x.hi]));
  const h = M.placeGroups([9.0, 8.8, 8.6, 8.3, 8.3], 0.1);
  ok(eq(h.map((x) => x.place), [1, 2, 3, 4, 4]) && eq(h.map((x) => x.chip), [false, false, false, true, true]), 'five years: chips only on the shared place 4', h);
  ok(M.anyShared(h) && !M.anyShared(M.placeGroups([3, 2, 1], 0.1)), 'anyShared');
}
ok(eq(M.placeOrder([1, null, 3, 3]), [2, 3, 0, 1]), 'placeOrder: best first, stable, nulls last');

/* ---- like-for-like ---- */
ok(pg.length === 5 && hg.length === 20 && gg.length === 12, 'type members (open, with assets): 5 / 20 / 12', [pg.length, hg.length, gg.length]);
ok(M.likeForLike(hg).length === 13 && M.selfManaged(hg).length === 7, 'hishtalmut general: 13 like-for-like, 7 self-managed', [M.likeForLike(hg).length, M.selfManaged(hg).length]);
ok(M.rankable(F.g880) && !M.rankable(F.g14936) && !M.rankable({ name: 'x', prod: 'ביטוחי מנהלים 1992-2003' }), 'rankable: IRA and old generation are not');

/* ---- screener, pension general (18.6) ---- */
{
  const a5 = M.scoreRows(pg, 'a5', { asof: ASOF });
  ok(eq(a5.map((x) => r1(x.v)), [9.0, 8.8, 8.6, 8.3, 8.3]), 'five years: 9.0, 8.8, 8.6, 8.3, 8.3', a5.map((x) => x.v));
  ok(eq(a5.map((x) => x.f.grp), ['מנורה מבטחים', 'מגדל', 'כלל', 'הראל', 'הראל']), 'five years order: מנורה, מגדל, כלל, הראל ×2');
  ok(eq(a5.map((x) => x.pl.place), [1, 2, 3, 4, 4]) && eq(a5.map((x) => x.pl.chip), [false, false, false, true, true]), 'five years: places 1,2,3,4,4, chips on place 4');
  const m1 = M.scoreRows(pg, 'm1', { asof: ASOF });
  ok(eq(m1.map((x) => r2(x.v)), [-0.72, -0.72, -0.73, -1.44, -1.45]) && eq(m1.map((x) => x.pl.place), [1, 1, 1, 4, 4]) && m1.every((x) => !x.pl.chip), 'month: −0.72 −0.72 −0.73 −1.44 −1.45, places 1 1 1 4 4, no chip');
  const y12 = M.scoreRows(pg, 'y12', { asof: ASOF });
  ok(y12[0].f.grp === 'כלל' && r1(y12[0].v) === 10.6 && r1(y12[0].v - y12[4].v) === 1.5, '12 months: כלל first +10.6, gap 1.5', y12.map((x) => [x.f.grp, x.v]));
}
/* ---- screener, hishtalmut general, month (18.6) ---- */
{
  const r = M.scoreRows(hg, 'm1', { asof: ASOF }), ranked = r.filter((x) => x.ranked);
  // 18.6 quotes 1,2,3,3,5,5,7,7,7,7,7,12,13,14: that list ranks the IRA track g14936 (−0.38%). 18.5 does not rank self-managed tracks,
  // so the rule gives 1,2,3,3,5,5,7,7,7,7,11,12,13 (reported). With the IRA value put back, placeGroups reproduces the quoted list.
  ok(eq(ranked.map((x) => x.pl.place), [1, 2, 3, 3, 5, 5, 7, 7, 7, 7, 11, 12, 13]), 'hishtalmut month (like-for-like): 1,2,3,3,5,5,7,7,7,7,11,12,13', ranked.map((x) => x.pl.place));
  const withIra = M.placeGroups(hg.filter((f) => f.m1 != null).map((f) => f.m1), 0.05).map((x) => x.place).sort((a, b) => a - b);
  ok(eq(withIra, [1, 2, 3, 3, 5, 5, 7, 7, 7, 7, 7, 12, 13, 14]), 'with the IRA track: the 18.6 list exactly', withIra);
  ok(ranked.every((x) => x.pl.chip === x.pl.shared), 'chip exactly on shared rows (some rows do not share)');
  ok(r.slice(ranked.length).every((x) => !x.ranked && x.pl.place == null) && r.length === 20, 'unranked (IRA, no figure) close the list');
  ok(!ranked.some((x) => x.k === 'g14936'), 'the IRA track with a figure is not ranked');
}
/* ---- type-month sheet: the months file and the history fallback give the screener's places (16.2 bug 10) ---- */
{
  const hists = Object.fromEntries(pg.map((f) => [f.k, H(f.k)]));
  const tm = M.typeMonthFromHists(hists, pg.map((f) => f.k), ASOF, CATS[PG]);
  ok(r2(tm.avg) === -1.03 && tm.avgN === 5, 'fallback month: the average is cat.json (−1.03, n 5), not a mean of members', tm);
  const sheet = M.scoreRows(pg, 'm1', { asof: ASOF, p: ASOF, month: tm }), screen = M.scoreRows(pg, 'm1', { asof: ASOF });
  ok(eq(sheet.map((x) => [x.k, x.pl.place]), screen.map((x) => [x.k, x.pl.place])), 'hub/card sheet places = screener places');
  const sep = M.typeMonthFromHists(hists, pg.map((f) => f.k), 202609, CATS[PG]);
  const s9 = M.scoreRows(pg, 'm1', { asof: ASOF, p: 202609, month: sep });
  ok(s9.filter((x) => x.ranked).length === 5 && r2(sep.avg) === 0.63, 'an older month (09/26) ranks from histories; avg cat.json +0.63', [s9.map((x) => x.v), sep.avg]);
  ok(M.scoreRows(pg, 'm1', { asof: ASOF, p: 202609 }).every((x) => !x.ranked), 'an older month without its values ranks nothing');
  // a P1 file built from the same histories
  const months = Array.from({ length: 24 }, (_, i) => { const t = 2026 * 12 + 9 - 23 + i; return Math.floor(t / 12) * 100 + (t % 12) + 1; });
  const file = { v: 1, cat: PG, prod: 'פנסיה מקיפה', track: 'כללי', slug: 'x', asof: ASOF, months, tracks: Object.fromEntries(pg.map((f) => [f.k, months.map((p) => M.monthValue(hists[f.k], p))])), avg: months.map((p) => { const i = CATS[PG].p.indexOf(p); return i < 0 ? null : CATS[PG].y[i]; }), n: months.map(() => 5) };
  const fm = M.typeMonthFromFile(file, ASOF);
  ok(fm && eq(fm.vals, tm.vals) && fm.avg === tm.avg, 'months file month = history fallback month');
  ok(M.typeMonthFromFile(file, 202301) === null && M.typeMonthFromFile(null, ASOF) === null, 'outside the file / no file → null (fall back)');
}

/* ---- card p2102 (18.6) ---- */
{
  const h = H('p2102'), c = CATS[PG], tv = M.trackVsType(h, F.p2102, c, 6);
  ok(tv.rows.length === 6 && tv.rows[0].p === ASOF && r2(tv.rows[0].v) === -1.44 && r2(tv.rows[0].avg) === -1.03, 'first row −1.44 / −1.03', tv.rows[0]);
  ok(r1(tv.half.v) === 1.4 && r1(tv.half.avg) === 2.0, 'half year +1.4 / +2.0', tv.half);
  ok(r1(tv.y12.v) === 9.2 && r1(tv.y12.avg) === 10.1, 'last year +9.2 / +10.1', tv.y12);
  ok(M.trackVsType(h, F.p2102, c, 12).rows.length === 12 && tv.months >= 12 && tv.newest === ASOF, '12 rows; months on file; newest');
  const nc = M.trackVsType(h, F.p2102, null, 6);
  ok(nc.rows[0].avg === null && nc.half.avg === null && nc.y12.avg === null, 'no cat → no average column');
  const yrs = M.trackYears(h, F.p2102, c, 5);
  ok(eq(yrs.rows.map((r) => [r.yr, r1(r.v), r1(r.avg)]), [[2026, 6.5, 7.3], [2025, 15.6, 15.9], [2024, 13.3, 13.2], [2023, 9.7, 9.0], [2022, -2.5, -3.2]]), 'years: 2026 +6.5/+7.3 … 2022 −2.5/−3.2', yrs.rows);
  ok(yrs.rows[0].part && !yrs.rows[1].part, 'the current year is partial');
  ok(r1(yrs.a5.v) === 8.8 && yrs.a5.avg != null && r1(yrs.a3.v) === 13.2, 'years footer: 5Y 8.8, 3Y 13.2', yrs);
  const a5avg = M.typeWindowAvg(c, 'a5', ASOF);
  ok(Math.abs(8.79 - a5avg) < 0.1, `long: 5Y 8.8 vs the type's ${r1(a5avg)} is inside 0.10 ("כמעט כמו")`, a5avg);
  const tiles = ['y12', 'a3', 'a5'].map((per) => M.placeOf(F.p2102, pg, per, ASOF).place);
  ok(eq(tiles, [5, 3, 2]), 'long tiles: place 5, 3, 2 of 5', tiles);
  const lp = M.longestPlace(F.p2102, pg, ASOF);
  ok(lp.per === 'a5' && lp.pl.place === 2 && lp.pl.n === 5, 'hint line: 5 years, place 2 of 5', lp);
  ok(M.trackVsType(null, null, c, 6).newest === null && M.trackVsType({ p: [202610], y: [null] }, null, c, 6).rows.length === 0, 'no monthly return → no rows');
  const young = M.trackVsType({ p: [202608, 202609, 202610], y: [1, 2, 3] }, { y12: null }, c, 6);
  ok(young.rows.length === 3 && young.months === 3 && young.half.v === null && young.y12.v === null, 'a new track: the rows that exist, "–" summaries', young);
  ok(M.hasTypeAvg([1, 2, 3]) && !M.hasTypeAvg([1, 2]), 'average column only from three members');
}
/* ---- /my places (18.6; the like-for-like rule) ---- */
{
  ok(M.placeOf(F.p2102, pg, 'y12', ASOF).place === 5 && M.placeOf(F.p2102, pg, 'y12', ASOF).n === 5, 'p2102 last year: place 5 of 5');
  const g = M.placeOf(F.g880, hg, 'y12', ASOF);
  // 18.6 quotes "באמצע (5–6 מתוך 13)"; 13 counts the IRA track (g14936, +5.21%). 18.5 excludes self-managed tracks from ranking, so
  // the rule gives 12. Reported to the coordinator; the group (5–6) is the same either way.
  ok(g.lo === 5 && g.hi === 6 && g.n === 12, 'g880 last year: 5–6 of 12 (like-for-like; 18.6 says 13 with the IRA track)', g);
  const s = M.placeOf(F.g8211, gg, 'y12', ASOF);
  ok(s.place === 7 && s.n === 11 && !s.shared, 'g8211 last year: place 7 of 11', s);
}
/* ---- hub (18.6) ---- */
{
  const g = M.typeGrid(FUNDS, CATS, 'פנסיה מקיפה', { asof: ASOF, mineKey: PG });
  ok(eq(g.cols.map((c) => c.track), ['כללי', 'עד 50', '50-60', 'מניות']) && g.cols[0].mine, 'pension columns: כללי (mine, first), עד 50, 50-60, מניות', g.cols);
  ok(eq(g.rows[0].vals.map(r2), [-1.03, -1.22, -0.95, -1.76]), 'pension Oct: −1.03 −1.22 −0.95 −1.76', g.rows[0].vals);
  ok(eq(g.half.map(r1), [2.0, 2.0, 2.3, 1.4]) && eq(g.y12.map(r1), [10.1, 10.6, 9.7, 11.6]), 'pension half +2.0 +2.0 +2.3 +1.4; year +10.1 +10.6 +9.7 +11.6', [g.half, g.y12]);
  ok(g.rows.length === 6 && g.rows[0].p === ASOF && g.rows[5].p === 202605, 'six months, newest first');
  const g0 = M.typeGrid(FUNDS, CATS, 'פנסיה מקיפה', { asof: ASOF });
  ok(eq(g0.cols.map((c) => c.track), ['עד 50', 'כללי', '50-60', 'מניות']), 'no saved product: by assets', g0.cols.map((c) => c.track));
  const hh = M.typeGrid(FUNDS, CATS, 'השתלמות', { asof: ASOF, mineKey: HG });
  ok(eq(hh.cols.map((c) => c.track), ['כללי', 'מניות', 'עוקב מדד S&P 500', 'אשראי ואג"ח']) && eq(hh.rows[0].vals.map(r2), [-0.28, -1.05, 2.42, 0.26]), 'hishtalmut: כללי −0.28, מניות −1.05, S&P 500 +2.42, אג״ח +0.26', hh);
  ok(!g.cols.some((c) => /מקבלי קצבה/.test(c.key)), 'no annuitants column');
  // leaders of the reader's type
  const L = M.leaderRows(M.scoreRows(pg, 'm1', { asof: ASOF }), ['p2102']);
  ok(eq(L.map((x) => [x.row.k, x.role, x.row.pl.place, r2(x.row.v)]), [['p2172', 'first', 1, -0.72], ['p2102', 'mine', 4, -1.44], ['p2002', 'last', 4, -1.45]]), 'leaders: הראל גילעד first 1 · מגדל mine 4 · כלל last 4', L.map((x) => [x.row.k, x.role]));
  // changes: gap inside each type this month
  const gaps = g.cols.map((c) => [c.track, r2(M.rankedSpread(M.scoreRows(M.typeMembers(FUNDS, c.key), 'm1', { asof: ASOF })))]);
  ok(eq(gaps, [['כללי', 0.73], ['עד 50', 1.15], ['50-60', 1.01], ['מניות', 1.76]]), 'changes: כללי 0.73, עד 50 1.15, 50-60 1.01, מניות 1.76', gaps);
}
/* ---- fees (18.6) ---- */
{
  const b = M.feeBoard(pg, { mineK: 'p2102' });
  ok(eq(b.rows.map((r) => r.v), [540, 550, 550, 560, 610]) && b.avg === 560 && b.rows.find((r) => r.mine).v === 560, 'pension board 540 550 550 560 610; mean 560; mine 560', b.rows.map((r) => r.v));
  ok(M.typeFeeAvg(pg) === 560 && b.lo === 540 && b.hi === 610 && !b.pin, 'typeFeeAvg = the board mean (card fee row = tool closing line)');
  ok(eq(b.rows.map((r) => r.cheapest), [true, false, false, false, false]) && eq(b.rows.map((r) => r.low), [true, true, true, false, false]), 'cheapest = 540 only; within 20 ₪ = 540, 550, 550');
  const own = { balance: 420000, monthly: 3100 }, bo = M.feeBoard(pg, { mineK: 'p2102', a: own });
  ok(bo.rows.find((r) => r.mine).v === 1170 && bo.lo === 1150 && bo.avg === 1210 && M.typeFeeAvg(pg, own) === 1210, 'with 420,000 / 3,100: mine 1,170, cheapest 1,150, mean 1,210', bo.rows.map((r) => r.v));
  const hb = M.feeBoard(hg, { mineK: 'g880' });
  ok(hb.rows.length === 12 && hb.self.length === 7 && hb.none.length === 1 && hb.avg === 630, 'hishtalmut: 12 in the board, 7 self-managed, 1 without a fee, mean 630', [hb.rows.length, hb.self.length, hb.none.length, hb.avg]);
  const others = hb.rows.filter((r) => !r.mine).map((r) => r.v);
  ok(hb.rows.find((r) => r.mine).v === 600 && Math.min(...others) === 540 && Math.max(...others) === 700, 'hishtalmut mine 600, others 540 to 700', hb.rows.map((r) => r.v));
  ok(!hb.rows.some((r) => /IRA|בניהול אישי/.test(r.f.name)), 'no self-managed row in the board');
  const hb8 = M.feeBoard(hg, { mineK: 'g880', a: { balance: 80000, monthly: null } });
  ok(hb8.rows.find((r) => r.mine).v === 480 && hb8.lo === 430, 'hishtalmut, balance 80,000: mine 480, cheapest 430', hb8.rows.map((r) => r.v));
  ok(!M.typeHasDepositFee(hg) && M.typeHasDepositFee(pg) && M.prodHasDeposit('השתלמות') && !M.prodHasDeposit('גמל להשקעה'), 'deposit fee: none in hishtalmut general (one field), yes in pension');
  ok(hb.mineIdx >= 0 && hb.pin === hb.mineIdx >= 4, 'pin when the reader is not among the first four', hb.mineIdx);
  // until retirement
  const c50 = M.feeBoard(pg, { mineK: 'p2102', mode: 'career', career: { age: 50 } });
  ok(c50.rows.length === 5 && c50.rows.every((r) => r.v % 100 === 0) && c50.avg % 100 === 0 && c50.rows[0].v < c50.rows[4].v, 'career: rounded to 100, cheapest first', c50.rows.map((r) => r.v));
  ok(M.careerFees(F.p2102, null, { age: 70 }) === null, 'past the retirement age: no career figure');
  const plan = M.careerPlan('פנסיה מקיפה', null, {});
  ok(plan.age === 38 && plan.retire === 67 && plan.balance === 100000 && plan.monthly === 2220 && plan.ret === 4 && plan.infl === 2, 'career defaults: 38 → 67, 100,000, 2,220, 4%, 2%', plan);
}

console.log(`page-months: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
