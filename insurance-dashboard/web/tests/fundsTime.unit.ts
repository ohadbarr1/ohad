/* F2 TIME (lib/fundsTime.ts): the risk statistics, percentile ranks over time, the map's frames and edge, the quilt, the persistence and glide
   readers, and the watchlist, run in node.
   1 · hand-checkable series: drawdown, recovery, Sharpe / Sortino, beta, capture, tracking error;
   2 · the fixtures (tests/fixtures/funds/: the F2 contracts, built from the published F1 files): the browser's fallback (riskFromHist,
       rankSeries) must give the same figures as the build's definitions on the same months, for every track of the fixture categories;
   3 · the watchlist: a stored or imported value of any shape, the badge, the deltas since the last look.
   Run: npm run test:fundstime */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BANDS, NO_WATCH, STAT_KEYS, addM, backM, drawdown, rfFromCurve, deltaOf, frameMonths, frameOf, frontier, markSeen, mergeWatch, normGlide, normPersist, normWatch, outflowStreak, percentiles,
  persistVerdict, pickSet, quartileOf, quilt, rankSeries, retBetween, riskFromHist, riskStats, ddNow, slugOf, statMedians, stepDown, toggleWatch, watchBadge, wilson,
  type RankFile, type StatsFile, type StatsIndex, type WSnap,
} from '../src/lib/fundsTime';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number | null | undefined, tol: number, what: string) =>
  ok((a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol), `${what}: ${a} ≠ ${b}`);
const eq = (a: unknown, b: unknown, what: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
const json = <T,>(p: string) => JSON.parse(readFileSync(p, 'utf8')) as T;

/* ---------------------------------------------------------------- 1 · hand-checkable */
eq(addM(202612, 1), 202701, 'addM over a year end');
eq(backM(202603, 4), [202512, 202601, 202602, 202603], 'backM');
{
  // +10%, −20%, +25%: wealth 1.1, 0.88, 1.1 → deepest fall −20% (peak month 0, trough month 1), back at the peak one month later
  const s = riskStats([10, -20, 25], [5, -10, 10], [0, 0, 0], [3, 10, -20, 25]);
  near(s.dd_max, -20, 1e-9, 'dd_max');
  eq([s.dd_len, s.rec_months], [1, 1], 'peak to trough, trough to recovery');
  near(s.dd_cur, 0, 1e-9, 'dd_cur at the window peak again');
  near(s.a36, (1.1 * 0.8 * 1.25) ** (12 / 3) * 100 - 100, 1e-9, 'annualised return');
  near(s.dd_max_all, -20, 1e-9, 'full-run drawdown');
  near(s.pct_pos_m, 200 / 3, 1e-9, 'share of positive months');
  near(s.vol36, Math.sqrt(525) * Math.sqrt(12), 1e-9, 'volatility');
  near(s.sharpe36, (5 / Math.sqrt(525)) * Math.sqrt(12), 1e-9, 'Sharpe with rf 0');
  near(s.sortino36, (5 / Math.sqrt(400 / 3)) * Math.sqrt(12), 1e-9, 'Sortino: downside √(Σmin²/n)');
  const mr = 5, mc = 5 / 3, cov = (10 - mr) * (5 - mc) + (-20 - mr) * (-10 - mc) + (25 - mr) * (10 - mc), v = (5 - mc) ** 2 + (-10 - mc) ** 2 + (10 - mc) ** 2;
  near(s.beta36_vs_cat, cov / v, 1e-9, 'beta');
  // geometric captures: up months (c = 5, 10): track 10, 25 → √(1.1×1.25) − 1 over √(1.05×1.10) − 1
  near(s.up_cap36, ((Math.sqrt(1.1 * 1.25) - 1) / (Math.sqrt(1.05 * 1.1) - 1)) * 100, 1e-9, 'up capture (geometric)');
  near(s.down_cap36, 200, 1e-9, 'down capture');
  const noRf = riskStats([1, 2, 3], null, null, [1, 2, 3]);
  ok(noRf.sharpe36 == null && noRf.beta36_vs_cat == null, 'no rate, no category: Sharpe and beta are blank, not zero');
  const u = drawdown([10, -10, 5]);
  eq([u.len, u.rec, u.peak, u.trough], [1, null, 0, 1], 'drawdown not recovered');
  near(u.cur, (0.9 * 1.05 - 1) * 100, 1e-9, 'current fall in the window');
  eq(drawdown([-5, 2]).peak, -1, 'a fall in the first month: the peak is before the window');
}
{
  const pc = percentiles(new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]));
  eq([...pc.values()], [0, 25, 50, 75, 100], 'percentiles of five');
  eq(percentiles(new Map([['a', 1], ['b', 2]])).get('a'), null, 'fewer than five: no percentile');
  eq([quartileOf(80), quartileOf(50), quartileOf(30), quartileOf(10), quartileOf(null)], [1, 2, 3, 4, null], 'quartiles');
}
{
  const f = frontier([{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 2.5 }, { x: 4, y: 4 }]);
  eq(f.map((p) => `${p.x},${p.y}`), ['1,1', '2,3', '4,4'], 'efficient edge');
  const fr = frameOf('a', { p: [202601, 202602, 202603], st: [40, 41, 42], a: [1, 2, 3] }, [1, -2, 3], 202603, 3);
  near(fr?.ret, (1.01 * 0.98 * 1.03 - 1) * 100, 1e-9, 'frame return (3 months, not annualised)');
  eq([fr?.st, fr?.a], [42, 3], 'frame exposure and assets at the end');
  eq(frameOf('a', { p: [202602, 202603] }, [1, 2], 202603, 3), null, 'frame: a missing month');
  eq(frameMonths([200001, 200001, 200001, 200001, 200001], 202603, 12, 5).slice(0, 2), [200012, 200112], 'frames from the first full year');
  eq(frameMonths([200001], 202603, 12, 5), [202603], 'frames: too few tracks before, only the latest');
}
{
  const q = quilt([{ k: 'a', grp: 'x', p: [202601, 202602], y: [1, 1] }, { k: 'b', grp: 'y', p: [202601, 202602], y: [2, null] }], 202602, [2026]);
  eq(q.get(2026)?.map((c) => c.k), ['a'], 'quilt: a year needs every month to asof');
  const q2 = quilt([{ k: 'a', grp: 'x', p: [202601, 202602], y: [1, 1] }, { k: 'b', grp: 'y', p: [202601, 202602], y: [2, 2] }], 202602, [2026]);
  eq(q2.get(2026)?.map((c) => c.k), ['b', 'a'], 'quilt: best first');
}
{
  eq(retBetween([202601, 202602, 202603], [1, 2, 3], 202601, 202603)?.ps, [202602, 202603], 'return since a month');
  eq(retBetween([202601, 202603], [1, 3], 202601, 202603), null, 'return since: a gap is null');
  eq(outflowStreak({ dep: [1, 1, 1, 1], wd: [0, 2, 2, 2], tr: [0, 0, 0, 0] }), 3, 'outflow streak');
  const w = wilson(30, 100)!; ok(w[0] < 30 && w[1] > 30 && w[0] > 20, 'Wilson interval');
  eq(ddNow([10, -10, 5]).dd_len, 2, 'months under the all-time peak');
}

/* ---------------------------------------------------------------- 2 · fixtures against the published histories */
const FX = join(process.cwd(), 'tests', 'fixtures', 'funds'), PUB = join(process.cwd(), 'public', 'data');
const idx = json<StatsIndex>(join(FX, 'stats', 'index.json'));
ok(idx.cats.length > 10 && idx.cats.every((c) => /^c[0-9a-f]{10}$/.test(c.slug) && c.cat === `${c.prod} | ${c.track}`), 'index: slugs and category keys');
eq(slugOf(idx, 'nope'), null, 'index: unknown category');
const curve = json<{ months: string[]; nominal: Record<string, (number | null)[]> }>(join(PUB, 'macro', 'boi_curve.json'));
const cats = json<Record<string, { p: number[]; y: number[]; yn?: (number | null)[] }>>(join(PUB, 'funds', 'cat.json'));
let compared = 0;
// the build rounds: 2 decimals (beta 3); and its rf carries the last curve month forward
const TOL: Partial<Record<string, number>> = { beta36_vs_cat: 6e-4, up_cap36: 0.06, down_cap36: 0.06, pct_pos_m: 0.051, a36: 0.0051 };
for (const cat of ['השתלמות | כללי', 'גמל | עד 50']) {
  const row = slugOf(idx, cat);
  ok(row, `index has ${cat}`);
  if (!row) continue;
  const st = json<StatsFile>(join(FX, 'stats', `${row.slug}.json`));
  eq(st.cat, cat, 'stats file carries its category');
  const rf = rfFromCurve(curve, st.asof);
  ok(rf && rf.get(st.asof) != null, 'rf reaches asof');
  if (st.rf?.a36 != null && rf) { const ps = backM(st.asof, 36); near((ps.reduce((g, p) => g * (1 + rf.get(p)! / 100), 1) ** (12 / 36) - 1) * 100, st.rf.a36, 0.002, `${cat}: rf over the window equals the build's`); }
  const c = cats[cat];
  for (const t of st.tracks) {
    const hp = join(PUB, 'funds', `${t.k}.json`);
    if (!existsSync(hp)) continue;
    const h = json<{ p: number[]; y: (number | null)[]; yn?: (number | null)[] }>(hp);
    const y = t.basis === 'net' ? h.yn ?? h.y : h.y;
    const cs = c ? { p: c.p, y: (t.basis === 'net' ? c.yn : null) ?? c.y } : null;
    const mine = riskFromHist(h, y, st.asof, cs, rf);
    if (t.vol36 == null) { ok(!mine, `no 36 months in the file, none in the browser: ${t.k}`); continue; }
    ok(mine, `browser stats for ${t.k}`);
    if (!mine) continue;
    for (const k of STAT_KEYS) { const pub = t[k]; if (pub === undefined) continue; near(mine[k] ?? null, pub ?? null, TOL[k] ?? 0.0051 + Math.abs(pub ?? 0) * 1e-4, `${cat} ${t.k} ${k}`); }
    compared++;
  }
  const med = statMedians(st.tracks.filter((t) => !t.gone));
  near(med.vol36, st.cat_median.vol36, 0.02, `${cat} median volatility`);
  // rank over time: the browser's series equals the file's on the last months (the build ranks returns rounded to 0.01: ±1 allowed)
  const rk = json<RankFile>(join(FX, 'rank', `${row.slug}.json`));
  const set = pickSet(rk, 'y12', 'net');
  ok(set && set === rk.sets?.[0], 'pickSet from sets');
  ok(pickSet({ ...rk, sets: undefined }, 'y12', 'net')?.tracks === rk.tracks, 'pickSet: top level when no sets');
  eq(pickSet({ ...rk, sets: undefined }, 'a3', 'net'), null, 'pickSet: a series the file lacks');
  const last = rk.months.slice(-3);
  const members = Object.keys(set!.tracks).filter((k) => existsSync(join(PUB, 'funds', `${k}.json`)) && last.some((_, i) => set!.tracks[k][rk.months.length - 3 + i] != null));
  const hs = members.map((k) => { const h = json<{ p: number[]; y: (number | null)[]; yn?: (number | null)[] }>(join(PUB, 'funds', `${k}.json`)); return { k, p: h.p, y: h.yn ?? h.y }; });
  const mine = rankSeries(hs, last, 12);
  let agree = 0, of = 0;
  members.forEach((k) => mine.tracks[k].forEach((v, i) => { const pub = set!.tracks[k][rk.months.length - 3 + i]; if (pub == null) return; of++; if (v != null && Math.abs(v - pub) <= 1) agree++; }));
  ok(of > 0 && agree / of > 0.95, `${cat}: browser rank equals the file's within one point (${agree}/${of})`);
}
ok(compared > 50, `compared the browser's statistics with the fixture on ${compared} tracks`);

{
  const p = normPersist(json(join(FX, 'persist.json')));
  ok(p.tests.length >= 8 && p.tests.every((t) => t.m.length === 4 && t.m.every((r) => r.length === 5)), `persist: 4×5 matrices (${p.tests.length})`);
  ok(p.tests.some((t) => t.prod === 'הכל') && p.tests.some((t) => t.basis === 'gross'), 'persist: pooled family and both bases');
  ok(p.tests.every((t) => t.stay.k === t.m[0][0] && t.stay.n === t.m[0].reduce((a, b) => a + b, 0)), 'persist: stay-top is the top-left cell over its row');
  ok(p.tests.every((t) => t.surv.lo == null || (t.surv.lo <= (t.surv.share ?? 0) + 1e-9 && (t.surv.share ?? 0) <= (t.surv.hi ?? 0) + 1e-9) || t.ci === 'wilson'), 'persist: the survivors share sits inside its bootstrap interval');
  ok(p.tests.every((t) => ['above', 'below', 'coin'].includes(persistVerdict(t))), 'persist: a verdict for every test');
  eq(normPersist({ rows: [{ fam: 'x', win: '12', rows: [{ q: 1, to: [1, 2] }] }, 'x'] }).tests.length, 0, 'persist: malformed rows are skipped');
  const one = normPersist({ rows: [{ fam: 'גמל', win: '12', basis: 'net', thin: true, coin: 25, wilson90: { k: 5, n: 20, lo: 12, hi: 41, pct: 25 }, rows: [1, 2, 3, 4].map((q) => ({ q, to: [5, 5, 5, 5], gone: 0 })) }] }).tests[0];
  eq([one.win, one.ci, one.surv.share, persistVerdict(one)], [12, 'wilson', 25, 'coin'], 'persist: a thin sample falls back to Wilson; 25% is a coin');
}
{
  const g = normGlide(json(join(FX, 'glide.json')));
  ok(g.prods.length >= 2 && g.months.length > 24, 'glide: products and months');
  ok(g.prods.every((p) => p.groups.every((x) => x.tracks.every((t) => (BANDS as readonly string[]).includes(t.band) && (!t.hist || t.hist.st.length === g.months.length)))), 'glide: bands, history aligned');
  const gs = g.prods.flatMap((p) => p.groups);
  ok(gs.filter((x) => x.gap?.st != null).every((x) => Math.abs((stepDown(x) ?? 0) - x.gap!.st!) < 0.051), 'glide: the step-down equals the build’s gap');
  eq(normGlide({ prods: [{ prod: 'גמל', mgrs: [{ grp: 'x', tracks: { '40': { k: 'g1' } } }] }] }).prods[0].groups.length, 0, 'glide: unknown band dropped');
}

/* ---------------------------------------------------------------- 3 · the watchlist */
{
  const s = (asof: number, pct: number | null, fee: number | null, pct3: number | null = 60): WSnap => ({ asof, b: 'net', m1: 0.5, pct, pctN: 40, pct3, fee });
  eq(normWatch(null), NO_WATCH, 'watch: nothing stored');
  eq(normWatch({ items: ['g1', 'g1', { k: 'x1' }, { k: 'p22', base: { asof: 'bad' } }] }).items.map((i) => [i.k, i.base]), [['g1', null], ['p22', null]], 'watch: dedup, bad keys and snapshots dropped');
  eq(normWatch(['g1', 'i2']).items.length, 2, 'watch: a bare list of keys is read');
  let w = toggleWatch(NO_WATCH, 'g1', 'קופה', s(202607, 80, 0.5), '2026-08-20');
  w = toggleWatch(w, 'g2', 'קופה ב', s(202607, 30, 0.6), '2026-08-20');
  eq(w.items.length, 2, 'watch: added');
  eq(toggleWatch(w, 'g1', '', null, '').items.map((i) => i.k), ['g2'], 'watch: removed');
  eq(watchBadge(w, 202607), 0, 'badge: same month');
  eq(watchBadge(w, 202608), 2, 'badge: a new month');
  const d = deltaOf(w.items[0], s(202608, 40, 0.45, 20))!;
  eq([d.fresh, d.months, d.dPct, d.qMove, d.bottom3], [true, 1, -40, [1, 3], true], 'delta: rank, quartile, 3Y bottom');
  near(d.dFee, -0.05, 1e-9, 'delta: fee');
  eq(deltaOf({ ...w.items[0], base: null }, s(202608, 40, 0.45))?.fresh, false, 'delta: a first look is not new');
  eq(deltaOf({ ...w.items[0], base: { ...s(202607, 80, 0.5), b: 'gross' } }, s(202608, 40, 0.5))?.dPct, null, 'delta: ranks on another basis are not compared');
  const seen = markSeen(w, new Map([['g1', s(202608, 40, 0.45)]]));
  eq([seen.items[0].base?.asof, seen.items[1].base?.asof], [202608, 202607], 'mark seen: tracks shown take today’s snapshot');
  eq(watchBadge(seen, 202608), 1, 'badge after the look');
  eq(watchBadge(markSeen(w, new Map([['g1', s(202608, 40, 0.45)]]), 202608), 202608), 0, 'a track with nothing to show (closed) is seen too');
  eq(mergeWatch(w, { items: [{ k: 'g1', base: s(202601, 1, 1) }, { k: 'i9' }] }).items.map((i) => [i.k, i.base?.asof ?? null]), [['g1', 202607], ['g2', 202607], ['i9', null]], 'import merges, stored wins');
  const many = normWatch({ items: Array.from({ length: 80 }, (_, i) => `g${i + 1}`) });
  eq(many.items.length, 60, 'watch: capped');
}

console.log(`fundsTime: ${pass} passed, ${fail} failed`);
for (const x of bad.slice(0, 30)) console.log('FAIL', x);
if (fail) process.exit(1);
