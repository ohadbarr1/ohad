// Rollout L2-e (spec §7, §16–18; T-F1…T-F4): node test for the fees tool's pure logic in src/pages/fees/FeesCareer.tsx (the lens an
// address opens on; the calculator model's defaults per door and its address inputs) and for the board's figures on the LIVE data
// (public/data/funds.json, 10/26): lib/pageMonths feeBoard / typeFeeAvg and lib/pageWords feesWords as the page composes them.
// Run: node scripts/fees-page-test.mjs
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'feespagetest-')), out = join(dir, 'fees.mjs');
let M;
try {
  await build({
    stdin: { contents: "export * from './src/pages/fees/FeesCareer.tsx'; export * from './src/lib/pageMonths.ts'; export * from './src/lib/pageWords.ts'; export { trackLabels } from './src/pages/compare/tracks.ts';", resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', jsx: 'automatic', loader: { '.css': 'empty', '.svg': 'empty' },
    define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  });
  M = await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }

let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.error(`FAIL ${what}${got !== undefined ? `\n  got: ${JSON.stringify(got)}` : ''}`); } };
const strip = (s) => s.replace(/[⁦-⁩]/g, '');
const Q = (s) => new URLSearchParams(s);

/* ---- the lens an address opens on ---- */
const SAVER = ['rank', 'career'], PRO = ['rank', 'career', 'sens', 'ret'];
ok(M.feesLensOf(Q(''), SAVER, true) === 'rank', 'no lens: בשנה');
ok(M.feesLensOf(Q('v=career'), SAVER, true) === 'career', 'v=career');
ok(M.feesLensOf(Q('v=sens'), SAVER, true) === 'rank', 'saver: sens is not a saver lens → בשנה');
ok(M.feesLensOf(Q('age=45&sal=20000'), PRO, false) === 'ret', 'Pro old link → בפרישה');
ok(M.feesLensOf(Q('age=45&sal=20000'), SAVER, true) === 'career', 'saver old link → עד הפרישה');
ok(M.feesLensOf(Q('fa=0.2&v=rank'), PRO, false) === 'rank', 'v wins over old inputs');
ok(M.feesLensOf(Q('cat=x&k=p2102'), PRO, false) === 'rank', 'cat and k are not calculator inputs');

/* ---- live data ---- */
const FF = JSON.parse(readFileSync(new URL('../public/data/funds.json', import.meta.url)));
const FUNDS = FF.funds, ASOF = FF.asof;
const PG = 'פנסיה מקיפה | כללי', HG = 'השתלמות | כללי';
const pg = M.typeMembers(FUNDS, PG), hg = M.typeMembers(FUNDS, HG);
const calc = (mem) => mem.filter((f) => !/בניהול אישי|\bIRA\b/.test(f.name) && f.fee != null).sort((a, b) => (a.fee - b.fee) || ((a.depfee ?? 0) - (b.depfee ?? 0)));
const RT = { v: 67, why: 'x', own: false };
const model = (q, o = {}) => M.feeModel({ sp: Q(q), saver: o.saver ?? true, cat: o.cat ?? PG, prod: (o.cat ?? PG).split(' | ')[0], asof: ASOF, members: calc(o.mem ?? pg), ageS: o.ageS ?? null, sex: null, retire: RT, balance: o.balance ?? null, monthly: o.monthly ?? null, own: o.own });

// mockup v4 defaults in every door: age 38, retirement 67, 4% gross, coefficient 200, 100,000 ₪ and the example deposit (2,220 ₪ a month)
for (const saver of [true, false]) {
  const m = model('', { saver });
  ok(m.C.age === 38 && m.C.retire === 67 && m.C.ret === 4 && m.C.coef === 200 && m.C.start === 100000, `defaults (${saver ? 'saver' : 'Pro'})`, m.C);
  ok(Math.round(m.C.salary * m.C.rate / 100) === 2220, `example deposit 2,220 (${saver ? 'saver' : 'Pro'})`, m.C.salary);
  ok(!m.ageOwn, `example age is not the reader's (${saver ? 'saver' : 'Pro'})`);
}
const ms = model('', { ageS: 50 });
ok(ms.C.age === 50 && ms.ageOwn, 'saver: the stored age is used and is the reader\'s');
ok(model('', { ageS: 50, saver: false }).C.age === 38, 'Pro: the stored age is not a client\'s');
const mx = model('age=ex', { ageS: null });
ok(mx.C.age === 38 && !mx.ageOwn && mx.ageEx, 'age=ex: the example age, labelled as the example');
const mo = model('age=45&sal=20000&r=5&ra=65', { saver: false });
ok(mo.C.age === 45 && mo.C.salary === 20000 && mo.C.ret === 5 && mo.C.retire === 65 && mo.ageOwn, 'old link inputs applied', mo.C);
ok(mo.retSrc === 'user', 'return typed → the reader\'s');
const ma = model('', { balance: 420000, monthly: 3100 });
ok(ma.C.start === 420000 && Math.abs(ma.C.salary * ma.C.rate / 100 - 3100) < 2, 'own amounts feed the calculator', ma.C);
ok(ma.assume.age === 38 && ma.assume.retire === 67 && ma.assume.ret === 4, 'career board assumptions = the calculator\'s');
// pair A: the reader's track and own fee pair (O9); pair B: the cheapest
const mm = model('', { own: { k: 'p2102', added: 'x', fee: 0.1, depfee: 1 } });
ok(mm.mine.k === 'p2102' && mm.A.fee === 0.1 && mm.A.depfee === 1 && mm.LA === 'דמי הניהול שלך', 'own fee pair on the reader\'s track', mm.A);
ok(mm.cheap.k === calc(pg)[0].k && mm.B.fee === calc(pg)[0].fee, 'pair B = the cheapest of the type');
ok(model('k=p2009').mine.k === 'p2009', 'k selects the track of pair A');
ok(model('fa=9').A.fee <= model('fa=9').cap.fee, 'a fee above the legal cap is computed at the cap');

/* ---- the board as the page composes it (18.6) ---- */
const words = (mem, mineK, a, mode = 'yr', career) => {
  const b = M.feeBoard(mem, { mineK, a, mode, career });
  const lfl = M.likeForLike(mem), L = new Map(lfl.map((f, i) => [f.k, M.trackLabels(lfl)[i]]));
  const deposits = M.prodHasDeposit(mem[0].prod) && (mode === 'career' || M.typeHasDepositFee(mem));
  const base = M.amountsBase({ own: !!a, depositOwn: !!(a && a.monthly != null), deposits });
  return { b, t: strip(M.feesWords(b.rows.map((r) => ({ k: r.k, label: L.get(r.k), v: r.v })), mineK, { mode, own: !!a, base, age: career?.age, ageOwn: true, retire: 67 })), avg: M.typeFeeAvg(mem, a, mode, career ?? {}) };
};
let w = words(pg, 'p2102', null);
ok(w.t === 'המסלול שלך (מגדל): כ-560 ש״ח בשנה, על דוגמה של 100,000 ש״ח. האחרים: 540 עד 610.', 'pension general sentence', w.t);
ok(w.b.rows.map((r) => r.v).join() === '540,550,550,560,610' && w.avg === 560, 'pension general board and mean', w.b.rows.map((r) => r.v));
w = words(pg, 'p2102', { balance: 420000, monthly: 3100 });
ok(w.t === 'המסלול שלך (מגדל): כ-1,170 ש״ח בשנה, על הסכומים שלך. הזול מהסוג הזה: 1,150.' && w.avg === 1210, '420,000 / 3,100', [w.t, w.avg]);
w = words(hg, 'g880', null);
ok(w.b.rows.length === 12 && w.b.self.length === 7 && w.avg === 630, 'hishtalmut: 12 like-for-like, 7 self-managed, mean 630', [w.b.rows.length, w.b.self.length, w.avg]);
ok(w.t === 'המסלול שלך (מיטב): כ-600 ש״ח בשנה, על דוגמה של 100,000 ש״ח. האחרים: 540 עד 700.', 'hishtalmut sentence', w.t);
ok(!M.typeHasDepositFee(hg), 'hishtalmut: no deposit fee → the amounts sheet has one field');
w = words(hg, 'g880', { balance: 80000, monthly: null });
ok(w.t === 'המסלול שלך (מיטב): כ-480 ש״ח בשנה, על היתרה שלך. הזול מהסוג הזה: 430.', 'hishtalmut balance 80,000', w.t);
w = words(pg, 'p2102', null, 'career', model('', { ageS: 50 }).assume);
ok(/^מגיל 50 עד 67: המסלול שלך \(מגדל\): כ-[\d,]+ ש״ח דמי ניהול עד הפרישה/.test(w.t) && w.b.rows.every((r) => r.v % 100 === 0), 'career at 50: sentence and multiples of 100', w.t);

console.log(`fees-page-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
