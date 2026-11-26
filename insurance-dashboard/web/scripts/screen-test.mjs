// Rollout L2-b: node test for src/pages/screen/screenCalc.ts (the screener's board, the type's window average, the opening type).
// Run: node scripts/screen-test.mjs. Bundles the module with esbuild (Vite's own copy) and checks it on the LIVE data files of the repo
// (public/data/funds.json, public/data/funds/cat.json; data month 10/26, gross as published) against spec 18.6.
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const load = async (entry) => {
  const dir = mkdtempSync(join(tmpdir(), 'screentest-')), out = join(dir, 'm.mjs');
  try {
    await build({ entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } });
    return await import(pathToFileURL(out).href);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
const S = await load('../src/pages/screen/screenCalc.ts');
const T = await load('../src/lib/fundsTie.ts');
const R = await load('../src/lib/compareMonths.ts');
const PM = await load('../src/lib/pageMonths.ts');

let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.error(`FAIL ${what}${got !== undefined ? `\n  got: ${JSON.stringify(got)}` : ''}`); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const r1 = (v) => (v == null ? null : R.roundHalf(v, 1)), r2 = (v) => (v == null ? null : R.roundHalf(v, 2));

const data = (p) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url)));
const FF = data('funds.json'), ASOF = FF.asof, FUNDS = FF.funds, CATS = data('funds/cat.json');
ok(ASOF === 202610, 'data month is 10/26', ASOF);
// the screener's members: the category, open to the public, with assets (FundsScreen `all` + `closed` off)
const mem = (prod, track) => FUNDS.filter((f) => f.prod === prod && f.track === track && !f.closed && f.assets !== 0);
const PG = mem('פנסיה מקיפה', 'כללי'), HG = mem('השתלמות', 'כללי');
const grp = (b) => b.rows.filter((r) => r.kind === 'ranked').map((r) => r.f.grp);

/* ---- pension general, five years (18.6) ---- */
{
  const b = S.screenBoard(PG, (f) => f.a5, T.tieBand('a5', ASOF));
  const rk = b.rows.filter((r) => r.kind === 'ranked');
  ok(eq(rk.map((r) => r1(r.v)), [9.0, 8.8, 8.6, 8.3, 8.3]), 'pension general 5Y: +9.0, +8.8, +8.6, +8.3, +8.3', rk.map((r) => r.v));
  ok(eq(rk.map((r) => r.pl.place), [1, 2, 3, 4, 4]), 'pension general 5Y places 1,2,3,4,4', rk.map((r) => r.pl.place));
  ok(eq(rk.map((r) => r.pl.chip), [false, false, false, true, true]), 'chips only on the two at place 4', rk.map((r) => r.pl.chip));
  ok(grp(b)[0] === 'מנורה מבטחים', 'Menora first', grp(b));
  ok(b.shared && b.n === 5 && b.self.length === 0, 'shared, 5 ranked, no self-managed', [b.shared, b.n, b.self.length]);
  ok(r1(S.windowAvg(CATS[PG[0].prod + ' | ' + PG[0].track], 'a5', ASOF)) === 8.7, 'type average 5Y +8.7 (mockup avg line)', S.windowAvg(CATS['פנסיה מקיפה | כללי'], 'a5', ASOF));
}
/* ---- pension general, month ---- */
{
  const b = S.screenBoard(PG, (f) => f.m1, T.tieBand('m1', ASOF));
  const rk = b.rows.filter((r) => r.kind === 'ranked');
  ok(eq(rk.map((r) => r2(r.v)), [-0.72, -0.72, -0.73, -1.44, -1.45]), 'pension general month: −0.72, −0.72, −0.73, −1.44, −1.45', rk.map((r) => r.v));
  ok(eq(rk.map((r) => r.pl.place), [1, 1, 1, 4, 4]), 'month places 1,1,1,4,4', rk.map((r) => r.pl.place));
  ok(rk.every((r) => !r.pl.chip), 'no chip when every row shares', rk.map((r) => r.pl.chip));
  ok(r2(S.windowAvg(CATS['פנסיה מקיפה | כללי'], 'm1', ASOF)) === -1.03, 'type average month −1.03', S.windowAvg(CATS['פנסיה מקיפה | כללי'], 'm1', ASOF));
}
/* ---- pension general, 12 months ---- */
{
  const b = S.screenBoard(PG, (f) => f.y12, T.tieBand('y12', ASOF));
  ok(grp(b)[0] === 'כלל' && r1(b.rows[0].v) === 10.6, '12 months: כלל first, +10.6', [grp(b)[0], b.rows[0].v]);
  ok(r1(S.windowAvg(CATS['פנסיה מקיפה | כללי'], 'y12', ASOF)) === 10.1, 'type average 12 months +10.1 (card 18.6)', S.windowAvg(CATS['פנסיה מקיפה | כללי'], 'y12', ASOF));
}
/* ---- hishtalmut general, month (18.6, coordinator decision 2: self-managed not ranked) ---- */
{
  const b = S.screenBoard(HG, (f) => f.m1, T.tieBand('m1', ASOF));
  const rk = b.rows.filter((r) => r.kind === 'ranked');
  ok(eq(rk.map((r) => r.pl.place), [1, 2, 3, 3, 5, 5, 7, 7, 7, 7, 11, 12, 13]), 'hishtalmut month places 1,2,3,3,5,5,7,7,7,7,11,12,13', rk.map((r) => r.pl.place));
  ok(rk.every((r) => r.pl.chip === (rk.filter((x) => x.pl.place === r.pl.place).length > 1)), 'a chip only on rows whose place is shared', rk.map((r) => [r.pl.place, r.pl.chip]));
  ok(b.self.length === 7 && b.self.every((r) => r.pl == null), '7 self-managed rows, unranked', b.self.length);
  ok(HG.length === 20 && b.rows.length + b.self.length === 20, '20 tracks on screen', HG.length);
  // one ranking: the same places as pageMonths.scoreRows (the hub's and the card's type-month sheets)
  const sr = PM.scoreRows(PM.typeMembers(FUNDS, 'השתלמות | כללי'), 'm1', { asof: ASOF }).filter((x) => x.ranked);
  ok(eq(sr.map((x) => [x.k, x.pl.place]), rk.map((r) => [r.f.k, r.pl.place])), 'identical places to pageMonths.scoreRows', [sr.map((x) => x.k), rk.map((r) => r.f.k)]);
}
/* ---- ascending measure (fee), exact band ---- */
{
  const b = S.screenBoard(PG, (f) => f.fee, S.EXACT_BAND, { asc: true });
  const v = b.rows.filter((r) => r.kind === 'ranked').map((r) => r.v);
  ok(v.every((x, i) => i === 0 || x >= v[i - 1]), 'fee ranks ascending', v);
  ok(b.rows[0].pl.place === 1, 'cheapest first, place 1', b.rows[0]);
}
/* ---- hand-made: unranked rows close the board ---- */
{
  const mk = (k, v, extra = {}) => ({ k, name: `x ${k}`, prod: 'השתלמות', track: 'כללי', grp: 'g', a5: v, ...extra });
  const b = S.screenBoard([mk('a', null), mk('b', 5), mk('c', 7, { gone: true }), mk('d', 6), mk('e', 9, { name: 'מסלול IRA' }), mk('f', 4, { prod: 'ביטוחי מנהלים 1992-2003' })], (f) => f.a5, 0.1);
  ok(eq(b.rows.map((r) => [r.f.k, r.kind]), [['d', 'ranked'], ['b', 'ranked'], ['f', 'old'], ['a', 'none'], ['c', 'gone']]), 'ranked, then old/no figure, then gone', b.rows.map((r) => [r.f.k, r.kind]));
  ok(eq(b.self.map((r) => r.f.k), ['e']), 'IRA apart', b.self);
}
/* ---- the opening type ---- */
{
  ok(eq(S.screenDefault('saver', []), { prod: 'פנסיה מקיפה', track: 'כללי' }), 'saver, nothing saved: pension general');
  ok(eq(S.screenDefault(null, []), { prod: 'פנסיה מקיפה', track: 'כללי' }), 'no door: as the saver');
  ok(eq(S.screenDefault('saver', [{ prod: 'השתלמות', track: 'כללי' }, { prod: 'פנסיה מקיפה', track: 'עד 50' }]), { prod: 'פנסיה מקיפה', track: 'עד 50' }), 'saver: the pension product first');
  ok(eq(S.screenDefault('saver', [{ prod: 'השתלמות', track: 'מניות' }]), { prod: 'השתלמות', track: 'מניות' }), 'saver: the first saved product');
  ok(eq(S.screenDefault('agent'), { prod: 'פנסיה מקיפה', track: 'עד 50' }), 'agent: pension up to 50');
  ok(eq(S.screenDefault('pro'), { prod: 'השתלמות', track: 'כללי' }), 'Pro: hishtalmut general');
}

console.log(`screen: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
