/* W1 saver · the report card (lib/verdict.ts), the shekel figures (lib/retire.ts) and the negotiation note (lib/script.ts), run in node.
   Hand-built categories first (ties, medians, fee places, the default-fund line, the equity flag, the fallbacks), then a smoke run over
   web/public/data when it is there: the red team's p9757 story (5Y 7 of 7, a default fund) must read as such. Never "עברו", never advice.
   Run: npm run test:verdict */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brief, headline, peersOf, placeTone, textOf, verdictOf, type VFund } from '../src/lib/verdict';
import { ageText, annualFees, coefOf, feeGap, horizon, ilsRound, project, refPair, retireAgeOf, type Plan } from '../src/lib/retire';
import { cardCalc, gapOf, summaryOf } from '../src/lib/myCalc';
import { capOf, feeError } from '../src/lib/feeCaps';
import { scriptOf } from '../src/lib/script';
import { compareKeys } from '../src/lib/saverCompare';
import type { DefaultFile } from '../src/lib/fundsTools';
import type { DecisionFile } from '../src/lib/decision';

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
  ok(placeTone(v.ret!.rank) === 'bad', '6–7 of 7: the best place, 6, is in the bottom quarter (⌈7/4⌉ = 2 places at each end)');
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
  ok(t.includes('הם הגבוהים בקטגוריה') && !t.includes('100%') && t.includes('הממוצע שמשלמים העמיתים'), `fee line (track average), the top edge in words: ${t}`);
  const own = verdictOf(cat[4], cat, 202609, dfile, { fee: 0.1, depfee: 2 });
  ok(own.fee.own && own.fee.word === 'low' && own.fee.pct === 100, 'own fee 0.10: lower than every other track');
  const to = textOf(own.lines.find((l) => l.key === 'fee')!.parts);
  // W5: an own pension fee is read against the default-fund price (0.22% / 1%), not placed among the other tracks' averages
  ok(own.fee.basis === 'tender' && to.includes('דמי הניהול שלך') && to.includes('מהדוח שלך') && to.includes('2% מהפקדה') && to.includes('בקרנות ברירת המחדל') && !to.includes('אף מסלול'), `fee line (own): ${to}`);
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
  ok(refPair(0.6, null)?.depfee === 0 && refPair(0.6, 1.4)?.depfee === 1.4 && refPair(null, 1) === null, 'no category deposit fee: the reference charges 0% (never the reader’s own)');
  ok(ilsRound(123456) === '123,000 ש"ח' && ilsRound(12345) === '12,300 ש"ח' && ilsRound(-987) === '−990 ש"ח', 'estimates are rounded');
}

/* ---- W4: the cost is monotonic in each fee (red team 02.11.26: a 7% deposit fee in a השתלמות made the gap smaller) ---- */
{
  const p: Plan = { age: 38, retire: 67, balance: 120000, monthly: 1570, growth: 2, ret: 4, infl: 2, coef: 200 };
  const ref = refPair(0.5, null)!;
  let prev = -Infinity, mono = true;
  for (const d of [0, 0.5, 1, 2, 3, 4]) { const g = feeGap(p, { fee: 0.6, depfee: d }, ref).balReal; if (!(g > prev)) mono = false; prev = g; }
  ok(mono, 'the gap to the median grows with the deposit fee');
  prev = -Infinity; mono = true;
  for (const a of [0.1, 0.2, 0.3, 0.5, 0.75, 1.05]) { const g = feeGap(p, { fee: a, depfee: 1 }, ref).balReal; if (!(g > prev)) mono = false; prev = g; }
  ok(mono, 'the gap to the median grows with the accumulation fee');
  let pb = Infinity; mono = true;
  for (const d of [0, 1, 2, 4, 6]) for (const a of [0.1, 0.5]) { const b = project(p, { fee: a, depfee: d }).balReal; if (a === 0.1 && !(b < pb)) mono = false; if (a === 0.1) pb = b; }
  ok(mono, 'the balance falls with the deposit fee');
  let pa = -Infinity; mono = true;
  for (const d of [0, 1, 2, 4]) { const x = annualFees(120000, 1570, { fee: 0.6, depfee: d }).total; if (!(x > pa)) mono = false; pa = x; }
  ok(mono && Math.abs(annualFees(120000, 1570, { fee: 0.6, depfee: 1 }).total - (720 + 188.4)) < 1e-9, 'the annual fee in ₪: balance × fee + 12 deposits × deposit fee, rising in each');
  // the card's figures on a השתלמות with no published deposit fee: a higher deposit fee of the reader never shrinks the gap
  const hs = cat.map((x) => ({ ...x, prod: 'השתלמות', track: 'כללי', depfee: null }));
  const lo = cardCalc(hs[4], hs, 202609, dfile, { balance: 120000, monthly: 1570, fee: 0.6, depfee: 0.5 }, null, { age: 38, coef: 200, ret: 4 });
  const hi = cardCalc(hs[4], hs, 202609, dfile, { balance: 120000, monthly: 1570, fee: 0.6, depfee: 3 }, null, { age: 38, coef: 200, ret: 4 });
  ok(lo.med0 && hi.gMed!.balReal > lo.gMed!.balReal && hi.liq!.gMed!.balReal > lo.liq!.gMed!.balReal && hi.annual.total > lo.annual.total, 'השתלמות: own deposit fee 3% costs more than 0.5% at 67, at 6 years and this year');
  ok(lo.liq?.years === 6 && Math.abs(lo.liq.gMed!.mine.months - 72) < 1e-9 && horizon(p, 6).retire === 44, 'השתלמות: the 6-year liquidity horizon');
}

/* ---- W4: the legal fee ceilings (Kol Zchut, תקנות קופות גמל (דמי ניהול) 2012) ---- */
{
  ok(capOf('פנסיה מקיפה').depfee === 6 && capOf('פנסיה מקיפה').fee === 0.5 && capOf('השתלמות').depfee === 4 && capOf('השתלמות').fee === 1.05 && capOf('גמל').fee === 1.05 && capOf('פנסיה כללית').depfee === 4, 'caps: pension 6/0.5, gemel and השתלמות 4/1.05, general pension 4/1.05');
  ok(feeError('השתלמות', 'depfee', 7)?.includes('עד 4%') === true && feeError('השתלמות', 'depfee', 4) === null && feeError('פנסיה מקיפה', 'depfee', 6) === null && feeError('פנסיה מקיפה', 'fee', 0.6)?.includes('0.5%') === true, 'a 7% deposit fee in a השתלמות is refused, 4% is allowed; 0.6% from savings in comprehensive pension is refused');
  ok(feeError('חיסכון לילד', 'fee', 5)?.includes('טעות הקלדה') === true && !capOf('חיסכון לילד').legal, 'an uncovered product: a loose bound, not a legal claim');
  ok(feeError('גמל', 'fee', -1) != null && feeError('גמל', 'fee', null) === null, 'negative refused, empty fine');
}

/* ---- W4: the folded card (brief), the fallback reason, shared places, and the strip ---- */
{
  const v2 = verdictOf(cat[1], cat, 202609, dfile);  // p2 10.45 shares 1–2 with p1
  ok(placeTone({ lo: 2, hi: 3, n: 7 } as never) === 'good' && placeTone({ lo: 3, hi: 4, n: 7 } as never) === 'mid' && placeTone({ lo: 5, hi: 6, n: 7 } as never) === 'mid' && placeTone({ lo: 7, hi: 7, n: 7 } as never) === 'bad', 'shared places by the best place: 2–3/7 top, 3–4 and 5–6 middle, 7 bottom');
  const b = brief(v2).map((l) => textOf(l.parts));
  ok(b.length <= 3 && b[0].includes('מקום 1–2 מתוך 7') && b[0].includes('ברבע העליון') && b.some((t) => t.includes('דמי הניהול מצבירה')), `brief: at most 3 lines, place and fee: ${b.join(' | ')}`);
  const young = mk('p10', null, 0.15, { net: { a3: 12, y12: 6 }, a3: 12.1, a5: null });
  const yv = verdictOf(young, [...cat, young], 202609, dfile);
  ok(yv.ret?.why === 'אין למסלול 5 שנות היסטוריה' && textOf(brief(yv)[0].parts).includes('3Y, כי אין למסלול 5 שנות היסטוריה'), `no 5Y: says why (${yv.ret?.why})`);
  const gapNet = mk('p12', null, 0.15, { net: { a3: 12, y12: 6 }, a3: 12.1, a5: 9.9 });
  ok(verdictOf(gapNet, [...cat, gapNet], 202609, dfile).ret?.why === 'אין נתון נטו ל-5 שנים', 'gross 5Y without net 5Y: says so');
  const dl = textOf(verdictOf(cat[6], cat, 202609, dfile).lines.find((l) => l.key === 'dflt')!.parts);
  ok(dl.includes('מחיר הבסיס בהליך') && dl.includes('צירוף שווה ערך מטבלת ההמרה') && dl.includes('1.20% מהפקדה ו-0.20% מצבירה'), `default line: the base price, then the conversion table once: ${dl}`);
  // the strip: the fees add up; the one action is the biggest gap
  const opts = { age: 38, coef: coefOf(null).v, ret: 4 };
  const rows = [cat[4], cat[2]].map((f, i) => ({ k: f.k, name: f.name, prod: f.prod, c: cardCalc(f, cat, 202609, dfile, i === 0 ? { balance: 180000, monthly: 4000, fee: 0.25, depfee: 1.5 } : null, null, opts) }));
  const s = summaryOf(rows);
  ok(Math.abs(s.fees - rows[0].c.annual.total - rows[1].c.annual.total) < 1e-6 && Math.abs(rows[0].c.annual.total - (180000 * 0.0025 + 48000 * 0.015)) < 1e-6, `strip: fees add up (${Math.round(s.fees)})`);
  ok(s.feesAvg && s.feesEx && s.penN === 2 && s.pension! > 0, 'strip: labelled when a fee is an average or an amount an example; two pension funds add up');
  ok(s.act.kind === 'fee' && s.act.k === 'p5' && s.act.ref === 'dflt' && s.act.own, `strip: the one action is the biggest gap, an own pension fee against the default-fund terms (W5) (${JSON.stringify(s.act).slice(0, 120)})`);
  ok(gapOf(rows[1].c) == null || gapOf(rows[1].c)!.v > 0, 'gapOf: only a positive gap');
  ok(coefOf('f').v === 204 && coefOf('m').v === 188 && coefOf(null).v === 200, 'coefficient by sex');
}

/* ---- the note ---- */
{
  const v = verdictOf(cat[4], cat, 202609, dfile, { fee: 0.25, depfee: 1.8 });
  const s = scriptOf({ name: 'קרן p5', id: 5, prod: 'פנסיה מקיפה', track: 'עד 50', src: 'פנסיה-נט, 09/26', v });
  ok(s.includes('אני משלם/ת 0.25% דמי ניהול מהצבירה ו-1.80% מההפקדות') && s.includes('חציון דמי הניהול הממוצעים בפועל בקטגוריה (פנסיה מקיפה, עד 50) הוא 0.15%') && s.includes('אשמח לקבל הצעה מעודכנת'), `note: ${s}`);
  ok(s.includes('מוגבלים ל-1% מההפקדה ו-0.22% מהצבירה'), 'the default-fund terms in the note');
  const s2 = scriptOf({ name: 'קרן p5', prod: 'פנסיה מקיפה', track: 'עד 50', src: 'פנסיה-נט, 09/26', v: verdictOf(cat[4], cat, 202609, dfile) });
  ok(s2.includes('אשמח לדעת כמה אני משלם/ת בפועל'), 'without own fees it asks');
  ok(!BANNED.test(s) && !BANNED.test(s2), 'the note recommends nothing');
}

/* ---- W5 (red team 3): Dana, 38, pension, own 0.22% from savings and 1.5% from deposits ----
   The averages actually paid in her category run 0.11%–0.19%; the default-fund tender price is 0.22% / 1%. The old card said "the most
   expensive in the category, no other track costs more" (her own fee against the others' averages), and the next line said the default
   funds charge exactly 0.22%. The deposit fee, 1.5% against 1%, was never flagged, and the ₪ gap to the default terms was folded away. */
{
  const dana = [mk('d1', 10.2, 0.15, { depfee: 1.73 }), mk('d2', 10.0, 0.14, { depfee: 1.53 }), mk('d3', 9.9, 0.16, { depfee: 1.47 }), mk('d4', 9.8, 0.14, { depfee: 1.52 }),
    mk('d5', 9.6, 0.14, { depfee: 1.56 }), mk('d6', 9.4, 0.11, { depfee: 1.25 }), mk('d7', 9.0, 0.15, { depfee: 1.24 }), mk('d8', 8.9, 0.19, { depfee: 1.05 }), mk('d9', 8.8, 0.18, { depfee: 1.0 })];
  const my = { fee: 0.22, depfee: 1.5 };
  const v = verdictOf(dana[3], dana, 202609, dfile, my);
  const all = [...v.lines.map((l) => textOf(l.parts)), ...brief(v).map((l) => textOf(l.parts)), ...v.tiles.map((t) => `${t.label} ${typeof t.value === 'string' ? t.value : t.value.t} ${t.word}`), headline(v)];
  const MOST = /היקרים בקטגוריה|הגבוהים בקטגוריה|אף מסלול אחר לא יקר|יקרים מהחציון|גבוהים מ-\d+% מהמסלולים/;
  ok(all.every((t) => !MOST.test(t)), `Dana: her own fee is never "the most expensive" against the others' averages: ${all.filter((t) => MOST.test(t)).join(' | ')}`);
  ok(v.fee.basis === 'tender' && v.fee.ref === 0.22 && v.fee.word === 'same', 'Dana: 0.22% from savings is the default-fund price, read as the same');
  ok(v.dep?.basis === 'tender' && v.dep.ref === 1 && v.dep.word === 'high' && v.lever === 'dep', 'Dana: 1.5% from deposits is above the 1% price: the deposit fee is the lever');
  const b = brief(v).map((l) => textOf(l.parts));
  ok(b.some((t) => t.includes('0.22% מצבירה ו-1.50% מהפקדה') && t.includes('בקרנות ברירת המחדל: 0.22% מצבירה ו-1% מהפקדה')), `Dana brief: both parts against the price: ${b.join(' | ')}`);
  ok(b.some((t) => t.includes('הפער הוא בדמי הניהול מהפקדה: 1.50% לעומת 1%')), `Dana brief: the deposit fee is flagged on the card face: ${b.join(' | ')}`);
  const tile = v.tiles.find((t) => t.key === 'dep');
  ok(tile?.tone === 'bad' && tile.word.includes('מעל קרנות ברירת המחדל (1%)'), `Dana tile: the deposit fee (${tile?.word})`);
  ok(textOf(v.lines.find((l) => l.key === 'fee')!.parts).includes('ממוצע בפועל') || textOf(v.lines.find((l) => l.key === 'fee')!.parts).includes('משלמים בפועל'), 'Dana: the others\' figures are labelled as averages actually paid');
  const c = cardCalc(dana[3], dana, 202609, dfile, { balance: 150000, monthly: 2220, ...my }, null, { age: 38, coef: 204, ret: 4, retire: 65 });
  const gF = feeGap(c.plan, c.mine, { fee: 0.22, depfee: c.mine.depfee }).balReal, gD = feeGap(c.plan, c.mine, { fee: c.mine.fee, depfee: 1 }).balReal;
  ok(gF === 0 && gD > 0 && c.lever === 'dep', `Dana ₪: the deposit fee is all of the gap (${Math.round(gD)})`);
  ok(c.tBest != null && c.tBest.g.balReal > 0 && gapOf(c)?.ref === 'dflt', `Dana ₪: the gap to the default terms (${Math.round(c.tBest?.g.balReal ?? 0)}) is the card's figure, not the median's`);
  ok(c.plan.retire === 65 && c.tBest!.g.mine.months === 27 * 12, 'Dana: retires at 65 (a woman born after 1970), 27 years');
  const sn = scriptOf({ name: 'קרן d4', prod: 'פנסיה מקיפה', track: 'עד 50', src: 'פנסיה-נט, 09/26', v, sex: 'f' });
  ok(sn.includes('אני חוסכת') && sn.includes('אני משלמת') && !sn.includes('/ת') && sn.includes('מההפקדה (1.50% לעומת 1%)'), `Dana's note is in her voice and names the deposit fee: ${sn}`);
  ok(scriptOf({ name: 'x', prod: 'פנסיה מקיפה', track: 'עד 50', src: 's', v, sex: 'm' }).includes('אני חוסך ב'), 'a man\'s note');
  // not her own fee: the track's average against the others' averages is apples to apples, and keeps its place
  ok(verdictOf(dana[7], dana, 202609, dfile).fee.basis === 'avg' && verdictOf(dana[7], dana, 202609, dfile).fee.pct === 100, 'the track average 0.19% is still the highest average');
  // outside pension: own fee against the median and the cheapest quarter of the averages actually paid, and the legal ceiling
  const hs = dana.map((x) => ({ ...x, prod: 'השתלמות', track: 'כללי' }));
  const vh = verdictOf(hs[3], hs, 202609, dfile, { fee: 0.7, depfee: 0 });
  const th = textOf(vh.lines.find((l) => l.key === 'fee')!.parts);
  ok(vh.fee.basis === 'avg' && th.includes('מעל חציון הממוצע בפועל') && th.includes('התקרה בחוק: 1.05%') && th.includes('ברבע המסלולים הזולים') && !MOST.test(th), `השתלמות, own: ${th}`);
  // W5: a gemel on /my with no monthly deposit: no deposit-fee line
  const gm = dana.map((x) => ({ ...x, prod: 'גמל', track: 'כללי' }));
  const vg = verdictOf(gm[3], gm, 202609, dfile, { fee: 0.5, monthly: null });
  ok(vg.dep?.quiet === true && !brief(vg).some((l) => l.key === 'dep') && !vg.tiles.some((t) => t.key === 'dep'), 'gemel with no deposit: the deposit fee is quiet');
  ok(verdictOf(gm[3], gm, 202609, dfile, { fee: 0.5, monthly: 500 }).dep?.quiet === false, 'gemel with a deposit: shown');
}

/* ---- W5: the saver's compare tab opens on their tracks and the cheapest of the category ---- */
{
  const hs = cat.map((x) => ({ ...x, k: 'h' + x.k.slice(1), prod: 'השתלמות', track: 'כללי' }));
  const ks = compareKeys([{ k: 'h1' }, { k: 'p7' }], [...cat, ...hs]);
  ok(ks[0] === 'p7' && ks.length === 4 && ks.includes('p3') && !ks.some((k) => k.startsWith('h')), `pension first, then the 3 cheapest of its category by fee (${ks.join(',')})`);
  ok(compareKeys([], cat).length === 0 && compareKeys([{ k: 'nope' }], cat).length === 0, 'nothing saved: no keys');
}

/* ---- W5: the statutory retirement age (Kol Zchut "גיל פרישה", the 2021 amendment) ---- */
{
  ok(retireAgeOf('f', 38, 2026).v === 65 && retireAgeOf('m', 38, 2026).v === 67 && retireAgeOf(null, 38, 2026).v === 67, 'women born 1970+: 65; men: 67; unknown: 67 (labelled)');
  ok(retireAgeOf('f', 60, 2026).v === 64 && Math.abs(retireAgeOf('f', 57, 2026).v - 64.75) < 1e-9 && Math.abs(retireAgeOf('f', 66, 2026).v - (62 + 4 / 12)) < 1e-9, 'born 1966: 64; 1969: 64 and 9 months; 1960: 62 and 4 months');
  ok(ageText(64.75) === '64 ו-9 חודשים' && ageText(65) === '65', 'the age in words');
}

/* ---- W2: the service-index line (pension) and the managers'-insurance line ---- */
{
  const dec = { segments: { pension: { label: 'קרנות פנסיה', year: 2025, n: 9, weights: {}, avg: { total: 79 }, src: 'si25', pg: 28 } },
    companies: { 'גוף p7': { grp: 'גוף p7', in_funds: true, service: { pension: { year: 2025, name: 'החברה של p7', total: 81, rank: 4, of: 9, src: 'si25', pg: 28 } } } } } as unknown as DecisionFile;
  const v = verdictOf(cat[6], cat, 202609, dfile, null, dec);
  const l = v.lines.find((x) => x.key === 'svc');
  const t = l ? textOf(l.parts) : '';
  ok(v.svc?.row.rank === 4 && t.includes('במדד השירות של רשות שוק ההון ל-2025, החברה של p7 במקום 4 מתוך 9 בקרנות הפנסיה (ציון 81 מ-100)'), `svc line: ${t}`);
  ok(l?.tone === 'info' && !BANNED.test(t) && t.includes('ולא תשואה או דמי ניהול'), 'svc line is descriptive, says what it does not measure');
  ok(l!.parts.some((p) => typeof p !== 'string' && p.fig === 'svc') && l!.parts.some((p) => typeof p !== 'string' && p.fig === 'svcTot'), 'svc figures are sourced');
  ok(!verdictOf(cat[6], cat, 202609, dfile).lines.some((x) => x.key === 'svc'), 'no decision file: no svc line');
  ok(!verdictOf(cat[0], cat, 202609, dfile, null, dec).lines.some((x) => x.key === 'svc'), 'a company not in the index: no svc line');
  const gm = verdictOf({ ...cat[6], k: 'g7', prod: 'גמל', fam: 'gemel' }, [{ ...cat[6], k: 'g7', prod: 'גמל', fam: 'gemel' }], 202609, dfile, null, dec);
  ok(!gm.lines.some((x) => x.key === 'svc'), 'gemel: no pension svc line');
  ok(!v.lines.some((x) => x.key === 'bm'), 'pension: no managers\' insurance line');
  const ins = (prod: string, k: string): VFund => ({ ...cat[0], k, prod, track: 'כללי', fam: 'insurance' });
  const old = verdictOf(ins('ביטוחי מנהלים 1992-2003', 'i1'), [ins('ביטוחי מנהלים 1992-2003', 'i1')], 202609, dfile);
  const ob = old.lines.find((x) => x.key === 'bm');
  ok(old.bm === 'old' && ob?.href === '/funds/bm' && textOf(ob.parts).includes('מקדם קצבה מובטח') && !BANNED.test(textOf(ob.parts)), `old managers' insurance: ${ob ? textOf(ob.parts) : '–'}`);
  const nw = verdictOf(ins('פוליסות חיסכון וביטוחי מנהלים (מ-2004)', 'i2'), [ins('פוליסות חיסכון וביטוחי מנהלים (מ-2004)', 'i2')], 202609, dfile);
  const nt = textOf(nw.lines.find((x) => x.key === 'bm')?.parts ?? []);
  ok(nw.bm === 'new' && nt.includes('ביטוח מנהלים (ולא פוליסת חיסכון)') && nt.includes('2013') && nt.includes('2012') && !BANNED.test(nt), `2004+ pool, conditional, both cutoffs: ${nt}`);
}

/* ---- smoke over the published data ---- */
const root = join(process.cwd(), 'public', 'data');
if (existsSync(join(root, 'funds.json')) && existsSync(join(root, 'funds', 'default.json'))) {
  const d = JSON.parse(readFileSync(join(root, 'funds.json'), 'utf8')) as { asof: number; funds: VFund[] };
  const df = JSON.parse(readFileSync(join(root, 'funds', 'default.json'), 'utf8')) as DefaultFile;
  const dec = existsSync(join(root, 'funds', 'decision.json')) ? JSON.parse(readFileSync(join(root, 'funds', 'decision.json'), 'utf8')) as DecisionFile : null;
  const f = d.funds.find((x) => x.k === 'p9757');
  if (f) {
    const v = verdictOf(f, d.funds, d.asof, df, null, dec);
    const all = v.lines.map((l) => textOf(l.parts));
    console.log('  p9757: ' + headline(v));
    all.forEach((t) => console.log('    · ' + t));
    ok(v.ret?.per === 'a5' && v.ret.rank?.lo === 7 && v.ret.rank.hi === 7 && v.ret.rank.n === 7, 'p9757: 5Y net, 7 of 7 (the red team story)');
    ok(v.dflt?.winner === true && v.dflt.tender.id === '2024', 'p9757: a winner of the fourth default-fund tender');
    ok(all.some((t) => t.includes('אינו אומר דבר על התשואה')), 'p9757: the cheap-price ≠ return line');
    ok(all.every((t) => !BANNED.test(t)), 'no advice words in p9757');
    if (dec) { const r = dec.companies[f.grp]?.service?.pension; ok(!!r && all.some((t) => t.includes(`במקום ${r.rank} מתוך ${r.of} בקרנות הפנסיה`)), `p9757: the service-index line from decision.json`); }
  }
  const g = d.funds.find((x) => x.k === 'g1093') ?? d.funds.find((x) => x.prod === 'השתלמות' && x.track === 'כללי' && !x.closed);
  if (g) { const v = verdictOf(g, d.funds, d.asof, df); console.log(`  ${g.k} (${g.name}): ` + headline(v)); v.lines.forEach((l) => console.log('    · ' + textOf(l.parts))); ok(v.dflt == null, `${g.k}: no default line`); }
  let n = 0;
  for (const x of d.funds) { if (x.closed || !x.assets) continue; const v = verdictOf(x, d.funds, d.asof, df, null, dec); n++; if (v.lines.some((l) => BANNED.test(textOf(l.parts)) || /undefined|NaN/.test(textOf(l.parts)))) { ok(false, `bad text for ${x.k}`); break; } }
  ok(n > 500, `smoke: ${n} open tracks read without NaN, undefined or advice`);
}

console.log(`verdict: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
