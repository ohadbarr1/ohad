/* F2 TIME (lib/fundsTime.ts): the risk statistics, percentile ranks over time, the glide reader and the watchlist, run in node (the map,
   the quilt, the persistence view and the old watchlist page's helpers were cut with their pages in phase 0, 05.11.26).
   1 · hand-checkable series: drawdown, recovery, Sharpe / Sortino, beta, capture, tracking error;
   2 · the fixtures (tests/fixtures/funds/: the F2 contracts, built from the published F1 files): the browser's fallback (riskFromHist,
       rankSeries) must give the same figures as the build's definitions on the same months, for every track of the fixture categories;
   3 · the watchlist: a stored or imported value of any shape, the badge, the deltas since the last look.
   Run: npm run test:fundstime */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BANDS, NO_WATCH, STAT_KEYS, addM, backM, drawdown, rfFromCurve, deltaOf, markSeen, normGlide, normWatch, percentiles,
  pickSet, quartileOf, rankSeries, riskFromHist, riskStats, slugOf, statMedians, stepDown, toggleWatch, watchBadge,
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
  const many = normWatch({ items: Array.from({ length: 80 }, (_, i) => `g${i + 1}`) });
  eq(many.items.length, 60, 'watch: capped');
}

console.log(`fundsTime: ${pass} passed, ${fail} failed`);
for (const x of bad.slice(0, 30)) console.log('FAIL', x);
if (fail) process.exit(1);
