/* W9 saver · the life moments (lib/moments, lib/momentsContent, lib/momentsCalc), run in node: the registry and the search words, every
   rule line sourced and no line that advises, the amounts in the text equal to the constants the arithmetic uses, the arithmetic itself,
   and the default fund by the ID's check digit against the tender file the site publishes. Run: npm run test:moments */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHIP_IDS, MOMENTS, isMomentId, momentHits, momentPath, type MomentId } from '../src/lib/moments';
import { S, TEXT, askText, shortOf } from '../src/lib/momentsContent';
import { BASKET_2026, EMPLOYER_SHARE, GRANT_FACTOR, HISH_WITHHOLD, SEV_EXEMPT_YEAR, defaultFor, digitOf, hishCost, pairOf, raiseRows, retireRows, severance } from '../src/lib/momentsCalc';
import { AVG_WAGE, HISH_CAP_MONTHLY } from '../src/lib/deposits';
import { RULE } from '../src/lib/productRules';
import { FORBIDDEN } from '../src/lib/hanmaka';
import type { DefaultFile } from '../src/lib/fundsTools';
import { allocOf } from '../src/lib/nyud';
import type { Plan } from '../src/lib/retire';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number, tol = 0.51) => a != null && Math.abs(a - b) <= tol;
const IDS = Object.keys(MOMENTS) as MomentId[];

/* ---- the registry ---- */
ok(CHIP_IDS.length === 5 && CHIP_IDS.every((id) => isMomentId(id)) && !CHIP_IDS.includes('default'), 'five chips, the default-fund page is not one of them');
ok(CHIP_IDS.reduce((n, id) => n + MOMENTS[id].chip.split(/\s+/).length, 0) <= 12, 'the chip labels stay short (≤ 12 words on /my)');
ok(momentPath('job') === '/my/moment/job' && isMomentId('sixty') && !isMomentId('toString') && !isMomentId('nope'), 'paths and ids');

/* ---- the text: sourced, descriptive ---- */
const ADVICE = /מומלץ|אנו ממליצים|fox ממליץ|כדאי (?:לך |לכם )?(?:למשוך|לעבור|להישאר|לנייד)|עדיף ל|חובה עליך/;
for (const id of IDS) {
  const T = TEXT[id];
  ok(T && T.happens.length >= 3 && T.law.length >= 3 && T.ask.length >= 3, `${id}: happens, law and questions present`);
  T.law.forEach((l, i) => {
    ok(l.src.length >= 1 && l.src.every((s) => /^https:\/\//.test(s.url) && s.t && /^\d{4}-\d\d-\d\d$/.test(s.read)), `${id} law ${i}: every source has a URL, a title and a read date`);
    ok(l.src.some((s) => s.kind !== 'issuer') || /למשל|לדוגמה/.test(l.text), `${id} law ${i}: a line sourced to an issuer only says it is an example`);
  });
  const all = [T.lead, ...T.happens, ...T.law.map((l) => l.text), ...T.ask].join(' ');
  ok(!ADVICE.test(all) && !FORBIDDEN.test(all), `${id}: no line advises (${(all.match(ADVICE) ?? all.match(FORBIDDEN) ?? [''])[0]})`);
}
ok(Object.values(S).every((s) => typeof s === 'function' || /^https:\/\/(www\.)?(gov\.il|kolzchut\.org\.il|as-invest\.co\.il)\//.test(s.url)), 'sources: gov.il, Kol Zchut, or the one issuer example');
ok(S.g161d(6).pg === 6 && shortOf(S.g161d(6)) === "רשות המסים, עמ' 6" && shortOf(S.hish) === 'כל זכות' && shortOf(S.ageModel) === "חוזר 2016-9-13, עמ' 4" && shortOf(S.move) === 'התקנות', 'the short link words');
ok(askText('x', ['a', 'b']) === 'שאלות לסוכן או לקרן: x\n1. a\n2. b', 'the list to copy');

/* ---- the amounts in the text are the constants the arithmetic uses ---- */
const has = (id: MomentId, s: string) => TEXT[id].law.some((l) => l.text.includes(s));
ok(has('job', SEV_EXEMPT_YEAR.toLocaleString('en-US')) && RULE.pension.liq.includes(SEV_EXEMPT_YEAR.toLocaleString('en-US')), 'job: the severance exemption is the rules table\'s 13,750');
ok(has('hishtalmut', (HISH_CAP_MONTHLY * 12).toLocaleString('en-US')) && has('hishtalmut', HISH_CAP_MONTHLY.toLocaleString('en-US')) && RULE.hishtalmut.tax.includes((HISH_CAP_MONTHLY * 12).toLocaleString('en-US')), 'hishtalmut: 188,544 / 15,712 as in lib/deposits and the rules table');
ok(has('hishtalmut', `${HISH_WITHHOLD}%`), 'hishtalmut: the 47% withholding');
ok(has('raise', AVG_WAGE.toLocaleString('en-US')), 'raise: the average wage of lib/deposits');
ok(near(9430 * 0.575 * 180, BASKET_2026, 1) && has('sixty', BASKET_2026.toLocaleString('en-US')) && has('sixty', '5,422') && has('sixty', '9,430') && has('sixty', '5,306'), 'sixty: the basket 976,005 = 9,430 × 57.5% × 180, and the guide\'s amounts');
ok(GRANT_FACTOR === 1.35 && has('job', '1.35') && has('sixty', '1.35'), 'the 1.35 factor');

/* ---- the moments a query names ---- */
const top = (q: string) => momentHits(q)[0]?.id;
ok(top('עזבתי עבודה') === 'job' && top('פיצויים') === 'job' && top('משיכת השתלמות') === 'hishtalmut' && top('העלאה') === 'raise' && top('גיל 60') === 'sixty' && top('ניוד') === 'switch' && top('ברירת מחדל') === 'default', 'momentHits: the headline phrases');
ok(top('60') === 'sixty' && top('161ד') === 'sixty' && top('טופס 161') === 'job', 'momentHits: numbers ("60", "161ד", "טופס 161")');
ok(momentHits('השתלמות').length === 0 && momentHits('גמל').length === 0 && momentHits('1560').length === 0 && momentHits('מה').length === 0 && momentHits('').length === 0, 'momentHits: a product word, a fund number, a stop word: none');
ok(momentHits('עזבתי עבודה').every((h) => h.score >= 98), 'momentHits: scores lead the saver tools (95)');

/* ---- severance ---- */
const plan: Plan = { age: 38, retire: 67, balance: 180000, monthly: 4000, growth: 2, ret: 4, infl: 2, coef: 200 };
const sv = severance(100000, 5, plan, { fee: 0.2, depfee: 1 }, 200);
ok(sv.exempt === 68750 && sv.taxable === 31250 && near(sv.basketCut, 92812.5) && sv.pensionCut != null && sv.pensionCut > 500 && sv.pensionCut < 1200, `severance: 5 years exempt 68,750, 31,250 above, basket −92,813, pension ${Math.round(sv.pensionCut ?? 0)}`);
ok(severance(50000, 10).exempt === 50000 && severance(50000, 10).taxable === 0 && severance(50000, 10).pensionCut === null, 'severance: the exemption never exceeds the amount; no plan, no pension figure');

/* ---- השתלמות ---- */
const hc = hishCost({ balance: 100000, fee: 0.6, years: 6, ret: 4, infl: 2 });
ok(near(hc.feeYear, 600) && hc.keepReal > 100000 && hc.keepReal < 110000 && near(hc.taxSaved, hc.gainReal * 0.25, 0.01), `hishCost: fee 600 a year, ${Math.round(hc.keepReal)} in 6 years (real), the tax saved 25% of the real gain`);
ok(near(hc.early.lo, 100000 * EMPLOYER_SHARE * 0.47) && near(hc.early.hi, 47000) && near(EMPLOYER_SHARE, 0.75, 1e-9), 'hishCost: early withholding 35,250–47,000 on 100,000');
ok(hishCost({ balance: 100000, fee: 0.6, years: 0, ret: 4, infl: 2 }).keepReal === 100000, 'hishCost: no years, no growth');

/* ---- a raise ---- */
const rr = raiseRows(15000, 16500, [{ kind: 'pension', monthly: 2500 }, { kind: 'hishtalmut', monthly: null }]);
ok(near(rr[0].next.total, 3052.5) && near(rr[0].now!.total, 2775) && near(rr[0].delta, 277.5) && rr[0].gap === 275, 'raise: pension 18.5% of 16,500 = 3,052.5; entered 2,500 against 2,775 owed: 275 short');
ok(rr[1].next.capped && near(rr[1].next.total, 1571.2) && near(rr[1].delta, 71.2) && rr[1].gap === null, 'raise: השתלמות capped at 15,712');
ok(raiseRows(null, 10000, [{ kind: 'pension', monthly: 1850 }])[0].now === null, 'raise: no current salary, no "now" column');

/* ---- retiring at 62 / 65 / 67 ---- */
const rt = retireRows(plan, { fee: 0.2, depfee: 1 }, (a) => ({ v: a === 62 ? 215 : a === 65 ? 205 : 195, real: true }));
ok(rt.length === 3 && rt[0].age === 62 && rt[2].pension > rt[1].pension && rt[1].pension > rt[0].pension && near(rt[0].pension, rt[0].balReal / 215, 1e-6), 'retireRows: later is more, balance ÷ the age\'s coefficient');
ok(retireRows({ ...plan, age: 64 }, { fee: 0.2, depfee: 1 }, () => ({ v: 200, real: false })).map((r) => r.age).join() === '65,67', 'retireRows: only ages ahead');

/* ---- the default fund by the check digit, on the published tender file ---- */
ok(digitOf('123456782') === 2 && digitOf('7') === 7 && digitOf('') === null && digitOf('ab') === null, 'digitOf: the last digit only');
const f = join(process.cwd(), 'public/data/funds/default.json');
if (existsSync(f)) {
  const d = JSON.parse(readFileSync(f, 'utf8')) as DefaultFile;
  const at = (dig: number) => defaultFor(d, 202609, dig, true)!.winners.map((w) => w.grp).join();
  ok(at(7) === 'אינפיניטי' && at(9) === 'אינפיניטי' && at(4) === 'מור' && at(6) === 'מור' && at(2) === 'אלטשולר שחם' && at(3) === 'אלטשולר שחם' && at(0) === 'מיטב' && at(1) === 'מיטב', 'default: 7,8,9 אינפיניטי · 4,5,6 מור · 2,3 אלטשולר שחם · 0,1 מיטב (the tender\'s own rule)');
  const small = defaultFor(d, 202609, null, false)!;
  ok(small.tender.id === '2024' && small.winners.length === 4, 'default: a smaller employer sees the four winners');
  ok(defaultFor(d, 202609, null, true)!.winners.length === 0, 'default: no digit, no fund');
  const p = pairOf(small.tender, small.winners[0]);
  ok(p != null && p.fee === 0.22 && p.depfee === 1, 'default: the 2024 price is 1% / 0.22%');
  const line = TEXT.default.law.find((l) => /ספרות/.test(l.text))!.text;
  const said = new Map<number, string>();
  for (const m of line.matchAll(/(\d(?:,\s*\d)*):\s*([^·;,.]+?)(?=\s*[·;.]|$)/g)) m[1].split(',').forEach((x) => said.set(Number(x.trim()), m[2].trim()));
  const file = allocOf(small.tender.alloc);
  ok(file.size === 10 && [...file].every(([k, v]) => said.get(k) === v), `default: the page states the tender's allocation as the file has it (${[...said].map(([k, v]) => `${k}=${v}`).join(' ')})`);
} else ok(true, 'default.json not here: skipped');
ok(defaultFor(null, 202609, 1, true) === null, 'default: no file, no answer');

console.log(`moments: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  FAIL', b)); process.exit(1); }
