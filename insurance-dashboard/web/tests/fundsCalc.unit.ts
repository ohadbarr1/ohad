/* F2 TOOLS · the funds tools' arithmetic (lib/fundsCalc.ts), the contracts' readers (lib/fundsTools.ts) and the compare pack
   (lib/fundsPack.ts), run in node: hand-computed cases (closed forms of an annuity, conservation of money in the career model, the
   IRR of a constant return), the fixtures of funds/default.json and funds/trackers.json (tests/fixtures), and a smoke run of the
   hindsight calculator over a real category of web/public/data. Run: npm run test:fundscalc */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { annualised, career, deposits, dist, feeGrid, irr, median, monthsFromTo, placeOf, quantile, runTrack, totalOf, type Career } from '../src/lib/fundsCalc';
import { ols, priceOf, tenderAt, tendersOf, trackersFrom, type DefaultFile, type FundLike, type TrackersFile } from '../src/lib/fundsTools';
import { comparePack, fillFee, type PackTrack } from '../src/lib/fundsPack';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number, tol = 1e-6) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const json = <T,>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

/* ---- months and deposits ---- */
ok(monthsFromTo(202411, 202502).join() === '202411,202412,202501,202502', 'monthsFromTo crosses the year');
const d24 = deposits({ mode: 'm', start: 202001, end: 202112, amount: 1000, raise: 10 });
ok(d24.size === 24 && d24.get(202001) === 1000 && near(d24.get(202101), 1100) && near(totalOf(d24), 25200), 'monthly deposits rise every 12 months');
const dl = deposits({ mode: 'l', start: 202001, end: 202112, amount: 50000, raise: 0, extra: [[202006, 1000], [203001, 5]] });
ok(dl.size === 2 && dl.get(202001) === 50000 && dl.get(202006) === 1000, 'a lump sum plus an extra deposit; out-of-window extras ignored');
ok(deposits({ mode: 'm', start: 202013, end: 202112, amount: 1, raise: 0 }).size === 0, 'an invalid month gives no deposits');

/* ---- one track ---- */
const p12 = monthsFromTo(202001, 202012), r1 = p12.map(() => 1);
const d12 = deposits({ mode: 'm', start: 202001, end: 202012, amount: 1000, raise: 0 });
const run = runTrack(p12, r1, d12, { start: 202001, end: 202012, depfee: 0 })!;
const annuityDue = 1000 * 1.01 * (1.01 ** 12 - 1) / 0.01;
ok(near(run.bal, annuityDue), `deposits at the start of the month earn its return (annuity due ${annuityDue.toFixed(2)} vs ${run.bal.toFixed(2)})`);
ok(run.dep === 12000 && run.months === 12 && run.filled === 0 && run.closedAt == null, 'run counts');
const runF = runTrack(p12, r1, d12, { start: 202001, end: 202012, depfee: 2 })!;
ok(near(runF.bal, annuityDue * 0.98) && near(runF.depFee, 240), 'the deposit fee comes off each deposit');
ok(runTrack(monthsFromTo(202003, 202012), r1.slice(2), d12, { start: 202001, end: 202012, depfee: 0 }) === null, 'a track born after the start is not a choice');
// a track that closed in 06/20: the rest of the window runs on the fill (the category), counted
const pC = monthsFromTo(201901, 202006), rC = pC.map(() => 1);
const fill = new Map(p12.map((p) => [p, 0] as [number, number]));
const runC = runTrack(pC, rC, d12, { start: 202001, end: 202012, depfee: 0, fill })!;
ok(runC.closedAt === 202006 && runC.after === 6 && runC.zero === 0, 'a closed track runs on the fill after its last month');
const firstHalf = 1000 * 1.01 * (1.01 ** 6 - 1) / 0.01;
ok(near(runC.bal, firstHalf + 6000), 'after closing: the fill (0%) and the deposits');
ok(runTrack(monthsFromTo(201801, 201912), monthsFromTo(201801, 201912).map(() => 1), d12, { start: 202001, end: 202012, depfee: 0, fill }) === null, 'a track closed before the start is not a choice');
// a gap inside the life, no fill: counted as 0%
const rGap = r1.map((x, i) => (i === 5 ? null : x));
const runG = runTrack(p12, rGap, d12, { start: 202001, end: 202012, depfee: 0 })!;
ok(runG.filled === 1 && runG.zero === 1 && runG.bal < run.bal, 'a missing month without a fill counts as 0% and is reported');

/* ---- IRR ---- */
ok(near(irr(202001, d12, run.bal, 12), (1.01 ** 12 - 1) * 100, 1e-6), 'IRR of a constant 1% month is 12.68% a year');
ok(near(irr(202001, d12, 12000, 12), 0, 1e-6), 'IRR of no growth is 0');
ok(irr(202001, d12, 0, 12) === null, 'no balance: no IRR');
const lump = new Map([[202001, 100]]);
ok(near(irr(202001, lump, 110, 12), 10, 1e-6), 'IRR of a lump sum = its return');

/* ---- statistics ---- */
ok(median([3, 1, 2]) === 2 && median([4, 1, 2, 3]) === 2.5 && median([]) === null, 'median');
ok(quantile([1, 2, 3, 4, 5], 0.25) === 2 && quantile([1, 2], 0.5) === 1.5, 'quantile, linear');
const ds = dist([5, 1, 3])!;
ok(ds.min === 1 && ds.med === 3 && ds.max === 5 && ds.n === 3, 'dist');
const pl = placeOf(3, [1, 3, 5, 7, 9]);
ok(pl.rank === 4 && pl.n === 5 && pl.pct === 25, 'placeOf: rank 1 = best; percentile among the others');
ok(near(annualised([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 12), (1.01 ** 12 - 1) * 100) && annualised([1, null], 2) === null, 'annualised');

/* ---- fees over a career ---- */
const C0: Career = { age: 30, retire: 67, salary: 10000, growth: 0, rate: 18.5, ret: 0, infl: 0, start: 0, coef: 200 };
const c0 = career(C0, { depfee: 0, fee: 0 });
ok(c0.months === 444 && near(c0.bal, 10000 * 0.185 * 444) && near(c0.pension, c0.bal / 200), 'no return, no fee: the deposits');
const cF = career(C0, { depfee: 1, fee: 0.22 });
ok(near(cF.bal + cF.fees, cF.dep, 1e-9), 'no return: balance + fees = deposits (nothing lost or made)');
ok(near(career(C0, { depfee: 2, fee: 0 }).bal, c0.bal * 0.98), 'a deposit fee only: 98% of the deposits');
const Cr: Career = { ...C0, ret: 5, age: 57 };
const n = 120, rm = 1.05 ** (1 / 12) - 1, dpm = 1850;
ok(near(career(Cr, { depfee: 0, fee: 0 }).bal, dpm * (1 + rm) * ((1 + rm) ** n - 1) / rm, 1e-9), 'a return, no fee: the annuity due');
const Ci: Career = { ...Cr, infl: 2 };
const ci = career(Ci, { depfee: 0, fee: 0 });
ok(near(ci.balReal, ci.bal / 1.02 ** 10, 1e-9), "today's ₪: divided by (1 + inflation)^years");
const g = feeGrid({ ...Cr, ret: 4 }, [0, 1, 6], [0.1, 0.5]);
ok(g.length === 3 && g[0].length === 2 && g[0][0].bal > g[0][1].bal && g[0][0].bal > g[2][0].bal && g[2][1].bal < g[1][1].bal, 'the grid falls as either fee rises');
// growth: the salary rises every 12 months
const cg = career({ ...C0, age: 65, growth: 10 }, { depfee: 0, fee: 0 });
ok(near(cg.dep, 1850 * 12 + 1850 * 1.1 * 12), 'salary growth steps every 12 months');

/* ---- the contracts: default funds ---- */
const FX = join(process.cwd(), 'tests', 'fixtures');
const df = json<DefaultFile>(join(FX, 'funds-default.json'));
const ts = tendersOf(df);
ok(ts.length === 2 && ts[0].id === '2024', 'tenders: the malformed row is dropped, newest first');
ok(tenderAt(ts, 202609)?.id === '2024' && tenderAt(ts, 202201)?.id === 'T0' && tenderAt(ts, 201001)?.id === '2024', 'tender in force (else the latest)');
ok(priceOf(ts[1], ts[1].winners[0]).fee === 0.05 && priceOf(ts[0], ts[0].winners[0]).fee === 0.22 && priceOf(ts[1], ts[1].winners[1]).fee === null, 'price: the winner\'s own, else the tender\'s');
ok((df.funds ?? []).every((r) => r.tender && typeof r.sel === 'boolean'), 'before/after rows');
ok(tendersOf(null).length === 0 && tendersOf({ tenders: [] } as DefaultFile).length === 0, 'no file: no tenders');

/* ---- the contracts: trackers ---- */
const tf = json<TrackersFile>(join(FX, 'funds-trackers.json'));
ok(tf.groups.every((gr) => gr.tracks.every((t) => t.td.y12 == null || gr.med.y12 == null || near(t.td.y12, (t.g.y12 ?? 0) - gr.med.y12))), 'fixture: gap = gross − group median');
const fl: FundLike[] = [
  { k: 'a', name: 'x', grp: 'A', prod: 'גמל', track: 'עוקב מדד S&P 500', fee: 0.5, assets: 10, y12: 10, a3: 8, a5: null, net: { y12: 9.5 } },
  { k: 'b', name: 'y', grp: 'B', prod: 'גמל', track: 'עוקב מדד S&P 500', fee: 0.2, assets: 10, y12: 12, a3: 9, a5: null },
  { k: 'c', name: 'z', grp: 'C', prod: 'השתלמות', track: 'עוקב מדד S&P 500', fee: 0.8, assets: 10, y12: 11, a3: null, a5: null },
  { k: 'd', name: 'w בניהול אישי', grp: 'D', prod: 'גמל', track: 'עוקב מדד S&P 500', fee: 0, assets: 10, y12: 0, a3: 0, a5: 0 },
  { k: 'e', name: 'v', grp: 'E', prod: 'גמל', track: 'כללי', fee: 0.5, assets: 10, y12: 5, a3: 5, a5: 5 },
  { k: 'f', name: 'u', grp: 'F', prod: 'גמל', track: 'עוקב מדדי אג"ח', fee: 0.5, assets: 0, y12: 5, a3: 5, a5: 5 },
];
const tb = trackersFrom(fl, 202609);
ok(tb.groups.length === 1 && tb.groups[0].label === 'S&P 500' && tb.groups[0].n === 3, 'fallback: trackers only, IRA and empty tracks out');
ok(tb.groups[0].med.y12 === 11 && tb.groups[0].med.a3 === 8.5 && tb.groups[0].med.a5 === null, 'fallback: medians per window');
ok(tb.groups[0].tracks.find((t) => t.k === 'b')!.td.y12 === 1 && tb.groups[0].tracks.find((t) => t.k === 'c')!.td.a3 == null, 'fallback: gaps');
const fit = ols([[0, 1], [1, 3], [2, 5]])!;
ok(near(fit.b, 2) && near(fit.a, 1) && near(fit.r2, 1), 'ols');

/* ---- the compare pack ---- */
const pk = monthsFromTo(202001, 202212);
const tA: PackTrack = { k: 'g1', name: 'מסלול א', mgr: 'מנהל', prod: 'גמל', track: 'כללי', p: pk, y: pk.map(() => 1), fee: pk.map(() => 0.6), depfee: 0, assets: 100 };
const tB: PackTrack = { k: 'g2', name: 'מסלול ב [בדיקה]: שם ארוך מאוד שחורג משלושים ואחד תווים', mgr: 'מנהל', prod: 'גמל', track: 'כללי', p: pk.slice(12), y: pk.slice(12).map((_, i) => (i === 3 ? null : -0.5)), fee: pk.slice(12).map(() => 0.3), gone: true, end: 202212 };
const wb = comparePack([tA, tB], 202212);
ok(wb.length === 5 && wb[0].name === 'סיכום' && wb[3].name === 'חודשי' && wb[4].name === 'מקורות', 'pack: summary, a sheet per track, side by side, sources');
ok(wb.slice(1, 3).every((s) => s.name.length <= 31 && !/[\\/?*[\]:]/.test(s.name)), 'pack: legal sheet names');
const cellsOf = (s: (typeof wb)[number]) => s.rows.flat();
const allText = wb.flatMap(cellsOf).map((c) => (c && typeof c === 'object' ? `${c.v ?? ''} ${c.f ?? ''}` : String(c ?? ''))).join(' ');
ok(!/fox/i.test(allText), 'pack: no site name anywhere');
const sA = wb[1];
const d2 = sA.rows[1][3] as { v: number; f: string };
ok(d2.f === 'IF(OR(B2="",C2=""),"",B2-C2/12)' && near(d2.v, 1 - 0.05), 'pack: net is a live formula with its cached value');
const ltmRow = wb[0].rows.find((r) => r[0] === 'LTM %')! as unknown as [string, { v: number; f: string }, { v: number; f: string }];
const expLtm = (0.95 ** 0 * 1.0095 ** 12 - 1) * 100;
ok(near(ltmRow[1].v, expLtm, 1e-5) && /^\('1 מסלול א'!E37\/'1 מסלול א'!E25-1\)\*100$/.test(ltmRow[1].f), `pack: LTM from the index cells (${ltmRow[1].f})`);
const a3Row = wb[0].rows.find((r) => r[0] === '3Y שנתי %')!;
ok(near((a3Row[1] as { v: number }).v, expLtm, 1e-5) && (a3Row[2] as unknown) === '–', 'pack: 3Y over the full 36 months uses the base 100; a shorter track gets a dash');
const cntRow = wb[0].rows.find((r) => r[0] === 'חודשים עם תשואה')!;
ok((cntRow[2] as { v: number }).v === 23, 'pack: a month without a return is not counted');
ok(wb[0].rows.some((r) => r[1] === 'פעיל' && r[2] === 'נסגר 12/22'), 'pack: a closed track is flagged');

const ff = fillFee([null, 0.5, null, 0.4, null]);
ok(ff.fee.join() === '0.5,0.5,0.5,0.4,0.4' && ff.filled === 3, 'fillFee: last published, first before it');

/* ---- smoke: hindsight over a real category ---- */
const DATA = join(process.cwd(), 'public', 'data');
if (existsSync(join(DATA, 'funds.json'))) {
  type F = { k: string; prod: string; track: string; name: string; assets: number | null; depfee: number | null };
  const funds = json<{ asof: number; funds: F[] }>(join(DATA, 'funds.json'));
  const closed = json<{ funds: F[] }>(join(DATA, 'funds', 'closed.json')).funds;
  const cat = 'השתלמות | כללי';
  const mem = [...funds.funds, ...closed].filter((f) => `${f.prod} | ${f.track}` === cat && !/בניהול אישי|\bIRA\b/.test(f.name));
  const cats = json<Record<string, { p: number[]; y: (number | null)[]; yn?: (number | null)[] }>>(join(DATA, 'funds', 'cat.json'));
  const c = cats[cat], fillM = new Map(c.p.map((p, i) => [p, c.yn?.[i] ?? null] as [number, number | null]));
  const start = 201601, end = funds.asof;
  const dep = deposits({ mode: 'm', start, end, amount: 1000, raise: 0 });
  const runs = mem.map((f) => { const h = json<{ p: number[]; y: (number | null)[]; yn?: (number | null)[] }>(join(DATA, 'funds', `${f.k}.json`)); return runTrack(h.p, h.yn ?? h.y, dep, { start, end, depfee: f.depfee ?? 0, fill: fillM }); });
  const live = runs.filter((r): r is NonNullable<typeof r> => !!r);
  const dd = dist(live.map((r) => r.bal))!;
  ok(live.length >= 10 && dd.min > 0 && dd.min <= dd.med && dd.med <= dd.max && live.every((r) => r.dep === totalOf(dep)), `smoke ${cat}: ${live.length} of ${mem.length} tracks, median ${dd.med.toFixed(0)} on ${totalOf(dep)} deposited`);
  ok(live.some((r) => r.closedAt != null), `smoke ${cat}: closed tracks are included while they lived (${live.filter((r) => r.closedAt != null).length})`);
}

console.log(`fundsCalc: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
