/* W1 saver · the report card (lib/verdict.ts), the shekel figures (lib/retire.ts) and the negotiation note (lib/script.ts), run in node.
   Hand-built categories first (ties, medians, fee places, the default-fund line, the equity flag, the fallbacks), then a smoke run over
   web/public/data when it is there: the red team's p9757 story (5Y 7 of 7, a default fund) must read as such. Never "עברו", never advice.
   Run: npm run test:verdict */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { headline, peersOf, placeTone, textOf, verdictOf, type VFund } from '../src/lib/verdict';
import { feeGap, ilsRound, project, refPair, type Plan } from '../src/lib/retire';
import { scriptOf } from '../src/lib/script';
import type { DefaultFile } from '../src/lib/fundsTools';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const BANNED = /עבר[וי]|כדאי לך|מומלץ|אנו ממליצים|תעביר|העבירו/;

const mk = (k: string, a5: number | null, fee: number | null, extra: Partial<VFund> = {}): VFund => ({
  k, name: `קרן ${k}`, prod: 'פנסיה מקיפה', track: 'עד 50', grp: `גוף ${k}`, fee, depfee: 1.5, assets: 1000, a5: a5 == null ? null : a5 + 0.15, a3: null, y12: 5,
  net: { a5, y12: 4.9 }, st: 50, ...extra });
const cat = [mk('p1', 10.5, 0.14), mk('p2', 10.45, 0.15), mk('p3', 10.2, 0.11), mk('p4', 9.7, 0.16), mk('p5', 9.5, 0.2), mk('p6', 9.0, 0.15, { depfee: 1.2 }), mk('p7', 8.95, 0.15, { st: 80, depfee: 1.5 })];
const dfile: DefaultFile = { tenders: [
  { id: '2024', label: 'ההליך הרביעי', from: '2024-11-01', to: '2028-10-31', fee: 0.22, depfee: 1, fee_years: 10, src: 'https://gov.il/x.pdf', verified: true, winners: [{ grp: 'גוף p7', ks: ['p7'] } as never], fee_alt: [{ fee: 0.2, depfee: 1.2 }] },
  { id: '2021', from: '2021-11-01', to: '2024-10-31', fee: 0.22, depfee: 1, src: 'https://gov.il/y.pdf', verified: false, winners: [] },
] };

/* ---- the place, the median, ties ---- */
{
  const v = verdictOf(cat[6], cat, 202609, dfile);
  ok(v.ret?.per === 'a5' && v.ret.basis === 'net', '5Y net by default');
  ok(v.ret?.rank?.lo === 6 && v.ret.rank.hi === 7 && v.ret.rank.n === 7, 'p7 at 8.95 vs p6 at 9.0: a tie (gap < 10bp) → 6–7 of 7');
  ok(placeTone(v.ret!.rank) === 'mid', 'a range reaching above the bottom quarter is not "bottom"');
  ok(Math.abs(v.ret!.med! - 9.7) < 1e-9 && Math.abs(v.ret!.gap! + 0.75) < 1e-9, 'median 9.7, gap −0.75');
  const r = textOf(v.lines.find((l) => l.key === 'rank')!.parts);
  ok(r.includes('במקום 6–7 מתוך 7') && r.includes('ב-5 השנים האחרונות'), `rank line: ${r}`);
  const g = textOf(v.lines.find((l) => l.key === 'ret')!.parts);
  ok(g.includes('נמוכה ב-0.75 נקודות אחוז') && g.includes('9.70%'), `return line: ${g}`);
  const v1 = verdictOf(cat[0], cat, 202609, dfile);
  ok(v1.ret?.rank?.lo === 1 && v1.ret.rank.hi === 2, 'p1 10.5 vs p2 10.45: shared 1–2');
  ok(placeTone(v1.ret!.rank) === 'good', '1–2 of 7: top quarter (⌈7/4⌉ = 2)');
  const v3 = verdictOf(cat[2], cat, 202609, dfile);
  ok(textOf(v3.lines.find((l) => l.key === 'ret')!.parts).includes('גבוהה ב-0.50'), 'p3 above the median by 0.50');
}

/* ---- fees: the track's average, then the reader's own ---- */
{
  const v = verdictOf(cat[4], cat, 202609, dfile);  // 0.20: the others 0.14 0.15 0.11 0.16 0.15 0.15 → all 6 lower
  ok(v.fee.word === 'high' && v.fee.pct === 100 && v.fee.med === 0.15, 'p5 0.20 is above all six others; median 0.15');
  const t = textOf(v.lines.find((l) => l.key === 'fee')!.parts);
  ok(t.includes('גבוהים מ-100%') && t.includes('הממוצע שמשלמים העמיתים'), `fee line (track average): ${t}`);
  const own = verdictOf(cat[4], cat, 202609, dfile, { fee: 0.1, depfee: 2 });
  ok(own.fee.own && own.fee.word === 'low' && own.fee.pct === 100, 'own fee 0.10: lower than every other track');
  const to = textOf(own.lines.find((l) => l.key === 'fee')!.parts);
  ok(to.includes('דמי הניהול שלך מצבירה') && to.includes('מהדוח שלך') && to.includes('2%'), `fee line (own): ${to}`);
  const same = verdictOf(cat[1], cat, 202609, dfile);
  ok(same.fee.word === 'same', '0.15 against a median of 0.15: same');
}

/* ---- default funds ---- */
{
  const w = verdictOf(cat[6], cat, 202609, dfile);
  ok(w.dflt?.winner === true && w.dflt.tender.id === '2024' && w.dflt.fee === 0.22 && w.dflt.depfee === 1, 'p7 is a winner of the tender in force');
  const d = textOf(w.lines.find((l) => l.key === 'dflt')!.parts);
  ok(d.includes('זו אחת מקרנות ברירת המחדל') && d.includes('1% מהפקדה ו-0.22% מצבירה') && d.includes('ל-10 שנים') && d.includes('מ-11/24 עד 10/28'), `default line: ${d}`);
  ok(!d.includes('גבוהים בשני הרכיבים'), 'the track average 0.15 / 1.5: no allowed pair (0.22/1, 0.2/1.2) is lower on both parts');
  const wo = textOf(verdictOf(cat[6], cat, 202609, dfile, { fee: 0.25, depfee: 1.5 }).lines.find((l) => l.key === 'dflt')!.parts);
  ok(wo.includes('שלך גבוהים בשני הרכיבים'), 'own 0.25 / 1.5 is above 0.22 / 1 on both parts');
  const nw = verdictOf(cat[0], cat, 202609, dfile);
  ok(nw.dflt?.winner === false && textOf(nw.lines.find((l) => l.key === 'dflt')!.parts).includes('אינה אחת מקרנות ברירת המחדל'), 'a non-winner says so');
  const g = verdictOf({ ...cat[0], prod: 'השתלמות' }, cat.map((x) => ({ ...x, prod: 'השתלמות' })), 202609, dfile);
  ok(g.dflt == null && !g.tiles.some((t) => t.key === 'dflt'), 'no default-fund line outside comprehensive pension');
  ok(verdictOf(cat[6], cat, 202609, null).dflt == null, 'no default file: no line (nothing invented)');
}

/* ---- equity, fallbacks, self-directed ---- */
{
  const big = [...cat, mk('p8', 9.8, 0.15), mk('p9', 9.9, 0.15)];
  const v = verdictOf(big[6], big, 202609, dfile);
  ok(v.eq != null && v.eq.st === 80 && v.eq.z > 1.5, 'p7 at 80% equity against ~50%: flagged');
  ok(verdictOf(big[0], big, 202609, dfile).eq == null, 'a track at the median: not flagged');
  const young = mk('p10', null, 0.15, { net: { a3: 12, y12: 6 }, a3: 12.1 });
  const yv = verdictOf(young, [...cat, young], 202609, dfile);
  ok(yv.ret?.per === 'a3' && textOf(yv.lines.find((l) => l.key === 'rank')!.parts).includes('ב-3 השנים האחרונות'), 'no 5Y: 3Y, and the line says so');
  const ira = mk('p11', 0, 0.1, { name: 'קרן בניהול אישי IRA' });
  const iv = verdictOf(ira, [...cat, ira], 202609, dfile);
  ok(iv.self && iv.ret == null && iv.lines[0].key === 'self', 'IRA: not ranked, says why');
  ok(!peersOf(cat[0], [...cat, ira]).includes(ira), 'IRA never a peer');
}

/* ---- money ---- */
{
  const p: Plan = { age: 38, retire: 67, balance: 100000, monthly: 2220, growth: 2, ret: 5, infl: 2, coef: 200 };
  const a = project(p, { fee: 0.3, depfee: 2 }), b = project(p, { fee: 0.15, depfee: 1 });
  ok(a.months === 348 && b.balReal > a.balReal, '29 years; cheaper fees leave more');
  const g = feeGap(p, { fee: 0.3, depfee: 2 }, { fee: 0.15, depfee: 1 });
  ok(Math.abs(g.balReal - (b.balReal - a.balReal)) < 1e-6 && g.balReal > 0 && g.pensionReal > 0, 'the gap is the reference minus mine');
  ok(feeGap(p, { fee: 0.2, depfee: 1 }, { fee: 0.2, depfee: 1 }).balReal === 0, 'same fees, no gap');
  ok(refPair({ fee: 0.5, depfee: 0 }, 0.6, null)?.depfee === 0, 'no category deposit fee: the reader’s own is kept');
  ok(ilsRound(123456) === '123,000 ש"ח' && ilsRound(12345) === '12,300 ש"ח' && ilsRound(-987) === '−990 ש"ח', 'estimates are rounded');
}

/* ---- the note ---- */
{
  const v = verdictOf(cat[4], cat, 202609, dfile, { fee: 0.25, depfee: 1.8 });
  const s = scriptOf({ name: 'קרן p5', id: 5, prod: 'פנסיה מקיפה', track: 'עד 50', src: 'פנסיה-נט, 09/26', v });
  ok(s.includes('אני משלם/ת 0.25% דמי ניהול מהצבירה ו-1.80% מההפקדות') && s.includes('החציון בקטגוריה (פנסיה מקיפה, עד 50) הוא 0.15%') && s.includes('אשמח לקבל הצעה מעודכנת'), `note: ${s}`);
  ok(s.includes('מוגבלים ל-1% מההפקדה ו-0.22% מהצבירה'), 'the default-fund terms in the note');
  const s2 = scriptOf({ name: 'קרן p5', prod: 'פנסיה מקיפה', track: 'עד 50', src: 'פנסיה-נט, 09/26', v: verdictOf(cat[4], cat, 202609, dfile) });
  ok(s2.includes('אשמח לדעת כמה אני משלם/ת בפועל'), 'without own fees it asks');
  ok(!BANNED.test(s) && !BANNED.test(s2), 'the note recommends nothing');
}

/* ---- smoke over the published data ---- */
const root = join(process.cwd(), 'public', 'data');
if (existsSync(join(root, 'funds.json')) && existsSync(join(root, 'funds', 'default.json'))) {
  const d = JSON.parse(readFileSync(join(root, 'funds.json'), 'utf8')) as { asof: number; funds: VFund[] };
  const df = JSON.parse(readFileSync(join(root, 'funds', 'default.json'), 'utf8')) as DefaultFile;
  const f = d.funds.find((x) => x.k === 'p9757');
  if (f) {
    const v = verdictOf(f, d.funds, d.asof, df);
    const all = v.lines.map((l) => textOf(l.parts));
    console.log('  p9757: ' + headline(v));
    all.forEach((t) => console.log('    · ' + t));
    ok(v.ret?.per === 'a5' && v.ret.rank?.lo === 7 && v.ret.rank.hi === 7 && v.ret.rank.n === 7, 'p9757: 5Y net, 7 of 7 (the red team story)');
    ok(v.dflt?.winner === true && v.dflt.tender.id === '2024', 'p9757: a winner of the fourth default-fund tender');
    ok(all.some((t) => t.includes('אינו אומר דבר על התשואה')), 'p9757: the cheap-price ≠ return line');
    ok(all.every((t) => !BANNED.test(t)), 'no advice words in p9757');
  }
  const g = d.funds.find((x) => x.k === 'g1093') ?? d.funds.find((x) => x.prod === 'השתלמות' && x.track === 'כללי' && !x.closed);
  if (g) { const v = verdictOf(g, d.funds, d.asof, df); console.log(`  ${g.k} (${g.name}): ` + headline(v)); v.lines.forEach((l) => console.log('    · ' + textOf(l.parts))); ok(v.dflt == null, `${g.k}: no default line`); }
  let n = 0;
  for (const x of d.funds) { if (x.closed || !x.assets) continue; const v = verdictOf(x, d.funds, d.asof, df); n++; if (v.lines.some((l) => BANNED.test(textOf(l.parts)) || /undefined|NaN/.test(textOf(l.parts)))) { ok(false, `bad text for ${x.k}`); break; } }
  ok(n > 500, `smoke: ${n} open tracks read without NaN, undefined or advice`);
}

console.log(`verdict: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
