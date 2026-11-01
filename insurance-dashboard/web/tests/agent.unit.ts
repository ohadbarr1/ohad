/* W1 · agent door: the pure libs behind it. Fee distribution (lib/feeDist), the tax/liquidity table (lib/productRules), the pension
   decision data (lib/pensionPack) and the compare bottom line (lib/compareSummary): hand-computed cases, then a smoke run over the
   published web/public/data (funds.json, funds/default.json, a pension history). Run: npm run test:agent */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BAND_HE, MIN_N, bandOf, categoriesOf, counted, feeDist, pcts, wmean, type FeeObs } from '../src/lib/feeDist';
import { RULES, RULES_NOTE, rulesFor, rulesOf } from '../src/lib/productRules';
import { actCompound, actHistory, defaultHits, defaultKeys, defaultNow, isPension, periodText } from '../src/lib/pensionPack';
import { compareSummary, type CmpIn } from '../src/lib/compareSummary';
import type { DefaultFile } from '../src/lib/fundsTools';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number, e = 1e-9) => a != null && Math.abs(a - b) < e;

/* ---- percentiles: PERCENTILE.INC ---- */
const p = pcts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!;
ok(p && near(p.p10, 1.9) && near(p.p25, 3.25) && near(p.p50, 5.5) && near(p.p75, 7.75) && near(p.p90, 9.1), 'p10…p90 match Excel PERCENTILE.INC on 1..10');
ok(pcts([1, 2, 3, 4]) === null && MIN_N === 5, 'fewer than 5 observations: no distribution');
ok(near(pcts([0.5, 0.1, 0.3, 0.2, 0.4])!.p50, 0.3), 'order does not matter');
ok(near(wmean([{ v: 1, w: 1 }, { v: 3, w: 3 }]), 2.5) && near(wmean([{ v: 1, w: 0 }, { v: 3, w: 0 }]), 2), 'assets-weighted mean; equal weights without assets');
ok(bandOf(0.1, p) === '≤p10' && bandOf(5.5, p) === 'p25–p50' && bandOf(9.5, p) === '>p90' && !!BAND_HE['p50–p75'], 'bands');

/* ---- the benchmark ---- */
const F = (k: string, grp: string, fee: number | null, depfee: number | null, assets: number, extra: Partial<FeeObs> = {}): FeeObs => ({ k, name: `${grp} ${k}`, grp, prod: 'השתלמות', track: 'כללי', fee, depfee, assets, ...extra });
const fs: FeeObs[] = [F('a1', 'A', 0.5, null, 100), F('a2', 'A', 0.7, null, 300), F('b', 'B', 0.6, 1, 50), F('c', 'C', 0.8, null, 10), F('d', 'D', 0.4, 2, 10), F('e', 'E', 0.9, null, 10),
  F('x', 'X', 0.01, null, 0), F('y', 'Y', 0.02, null, 5, { closed: true }), F('z', 'Z', 0.03, null, 5, { name: 'Z בניהול אישי' }), F('o', 'O', 0.1, null, 5, { track: 'מניות' })];
ok(!counted(fs[6]) && !counted(fs[7]) && !counted(fs[8]) && counted(fs[0]), 'out: no assets, ענפית, IRA');
const dm = feeDist(fs, 'השתלמות', 'כללי', 'mgr');
ok(dm.fee.obs.length === 5 && dm.nTracks === 6 && dm.nGroups === 5, 'one observation per group');
ok(near(dm.fee.obs.find((o) => o.grp === 'A')!.v, 0.65), 'a group: its tracks weighted by assets (0.5×100 + 0.7×300) ÷ 400');
ok(dm.fee.pcts != null && near(dm.fee.pcts.p50, 0.65), 'median of the five groups');
ok(dm.depfee.pcts === null && dm.depfee.obs.length === 2, 'deposit fee: its own population, too few for a distribution');
const dt = feeDist(fs, 'השתלמות', 'כללי', 'track');
ok(dt.fee.obs.length === 6 && near(dt.fee.pcts!.p50, 0.65), 'per track: six observations, median of 0.4 0.5 0.6 0.7 0.8 0.9');
ok(feeDist(fs, 'השתלמות', null, 'track').fee.obs.length === 7, 'the whole product: every category');
ok(categoriesOf(fs, 'השתלמות').map((c) => c.track).join() === 'כללי', 'categories with 5+ groups');

/* ---- product rules ---- */
ok(RULES.length === 6 && RULES.every((r) => r.liq.length > 20 && r.tax.length > 20 && r.src.length > 0 && r.src.every((s) => /^https:\/\//.test(s.url))), 'six products, two lines each, every one sourced');
ok(RULES.every((r) => r.src.some((s) => /gov\.il|kolzchut|capitax/.test(s.url))), 'each rule has a gov.il, Tax Authority or Kol Zchut source');
ok(RULES.every((r) => !/אשתקד/.test(r.liq + r.tax)), 'no "אשתקד"');
ok(/לא ייעוץ מס/.test(RULES_NOTE), 'the note: general, not tax advice');
ok(rulesFor('השתלמות')[0].key === 'hishtalmut' && rulesFor('גמל להשקעה')[0].key === 'gemelInvest' && rulesFor('גמל')[0].key === 'gemel', 'gemel products map apart');
ok(rulesFor('פוליסות חיסכון וביטוחי מנהלים (מ-2004)').map((r) => r.key).join() === 'managers,policy', 'the shared bituach-net pool: both products');
ok(rulesFor('ביטוחי מנהלים 1992-2003')[0].key === 'managers' && rulesFor('פנסיה מקיפה')[0].key === 'pension', 'managers and pension');
ok(rulesFor('חיסכון לילד').length === 0 && rulesFor('מרכזית לפיצויים').length === 0, 'no unverified rule for the others');
ok(rulesOf(['גמל להשקעה', 'השתלמות', 'השתלמות']).map((r) => r.key).join() === 'hishtalmut,gemelInvest', 'distinct, in table order');

/* ---- default fund ---- */
const D: DefaultFile = { tenders: [
  { id: '2021', from: '2021-11-01', to: '2024-10-31', fee: 0.22, depfee: 1, src: 's', verified: false, winners: [{ grp: 'M', ks: ['p1', 'p2'] } as never] },
  { id: '2024', from: '2024-11-01', to: '2028-10-31', fee: 0.22, depfee: 1, fee_years: 10, src: 's', verified: true, winners: [{ grp: 'M', ks: ['p1'] } as never, { grp: 'N', k: ['p9'], fee: 0.2, depfee: 1.2 }] },
] };
ok(defaultNow('p1', D, 202609)?.t.id === '2024' && defaultNow('p2', D, 202609) === null, 'in force at 09/26: the 2024 tender');
ok(defaultHits('p1', D, 202609).length === 2 && defaultHits('p2', D, 202609)[0].current === false, 'history: every tender won');
ok(defaultNow('p9', D, 202609)?.fee === 0.2 && defaultNow('p1', D, 202609)?.depfee === 1, 'a winner priced apart; else the tender price');
ok([...defaultKeys(D, 202609)].sort().join() === 'p1,p9' && defaultKeys(D, 202301).has('p2'), 'the keys in force');
ok(periodText(D.tenders[1]) === '11/24–10/28', 'period text');
ok(isPension({ fam: 'pensia' }) && isPension({ k: 'p2009' }) && !isPension({ fam: 'gemel', prod: 'השתלמות', k: 'g1' }), 'pension');

/* ---- actuarial ---- */
const h = { p: [202503, 202504, 202506, 202509], act: [-0.05, null, -0.13, 0.1] };
ok(actHistory(h).map((x) => x.p).join() === '202503,202506,202509' && actHistory(h, 2).length === 2 && actHistory({ p: [1] }).length === 0, 'the published quarters');
ok(near(actCompound(actHistory(h)), ((1 - 0.0005) * (1 - 0.0013) * 1.001 - 1) * 100), 'compounded');

/* ---- the bottom line ---- */
const C = (k: string, fee: number | null, depfee: number | null, r5: number | null, sharpe: number | null, prod = 'השתלמות'): CmpIn => ({ k, name: k, prod, fee, depfee, r5, sharpe });
const s = compareSummary([C('a', 0.5, null, 9.0, 1.1), C('b', 0.5, null, 8.95, 1.2), C('c', 0.6, null, 8.5, 1.2), C('d', null, null, null, null)]);
ok(s.fee?.ks.join() === 'a,b' && s.fee.of === 3 && s.fee.missing.join() === 'd', 'cheapest: a tie at 2 dp, the one with no fee counted out');
ok(s.depfee === null, 'no deposit fees: no line');
ok(s.r5?.ks.join() === 'a,b' && !s.r5.all && near(s.r5.gap!, 0.45), '5Y: a 5bp lead is a shared head; gap to the rest');
ok(s.sharpe?.ks.join() === 'b,c' && !s.mixed, 'Sharpe: a tie');
const s2 = compareSummary([C('a', 0.5, 1, 9.0, 1, 'גמל'), C('b', 0.4, 2, 9.05, 1)]);
ok(s2.r5?.all && s2.r5.gap === null && s2.mixed && s2.depfee?.ks.join() === 'a', 'all tied on 5Y; mixed products flagged');
ok(compareSummary([C('a', 0.5, 1, 9, 1)]).fee === null, 'one track: no bottom line');

/* ---- smoke on the published data ---- */
const data = join(process.cwd(), 'public/data');
const fj = join(data, 'funds.json');
if (existsSync(fj)) {
  const d = JSON.parse(readFileSync(fj, 'utf8')) as { asof: number; funds: (FeeObs & { fam: string; act?: number | null; act_p?: number })[] };
  const pen = feeDist(d.funds, 'פנסיה מקיפה', null, 'mgr');
  ok(pen.fee.pcts && pen.fee.pcts.p10 <= pen.fee.pcts.p50 && pen.fee.pcts.p50 <= pen.fee.pcts.p90 && pen.depfee.pcts, 'smoke: comprehensive pension has both distributions');
  const hs = feeDist(d.funds, 'השתלמות', 'כללי', 'mgr');
  ok(hs.fee.pcts && hs.fee.pcts.n >= MIN_N, 'smoke: השתלמות כללי has a distribution');
  console.log(`  smoke: פנסיה מקיפה, ${pen.fee.pcts?.n} groups: fee p50 ${pen.fee.pcts?.p50.toFixed(3)}%, depfee p50 ${pen.depfee.pcts?.p50.toFixed(3)}%; השתלמות כללי, ${hs.fee.pcts?.n} groups: fee p50 ${hs.fee.pcts?.p50.toFixed(3)}%`);
  const prods = [...new Set(d.funds.map((f) => f.prod))];
  ok(prods.filter((x) => rulesFor(x).length).length >= 8, `smoke: ${prods.filter((x) => rulesFor(x).length).length} of ${prods.length} products have a rule`);
  const withAct = d.funds.filter((f) => f.act != null);
  ok(withAct.length > 0 && withAct.every((f) => isPension(f)), `smoke: ${withAct.length} tracks with an actuarial balance, all pension`);
  const dj = join(data, 'funds/default.json');
  if (existsSync(dj)) {
    const df = JSON.parse(readFileSync(dj, 'utf8')) as DefaultFile;
    const ks = defaultKeys(df, d.asof), live = d.funds.filter((f) => ks.has(f.k));
    ok(live.length > 0 && live.every((f) => isPension(f)), `smoke: ${live.length} live tracks in a default fund at ${d.asof}, all pension`);
  }
  const pj = join(data, 'funds/p2009.json');
  if (existsSync(pj)) ok(actHistory(JSON.parse(readFileSync(pj, 'utf8'))).length === 8, 'smoke: a pension history has 8 quarters to show');
}

console.log(`agent: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
