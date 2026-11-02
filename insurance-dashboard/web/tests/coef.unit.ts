/* W6 · the conversion coefficient (lib/coef.ts): a hand-built file first (the fund's cell by sex, age, birth-year column and option; the
   fallbacks and their reasons; the replacement rate; the age-track note), then a smoke run over web/public/data/funds/coef.json when it is
   there: nine funds, every table with a page and a heading, a man of 67 born 1960 at 165–170 without survivors in every fund that prints
   that column, the assumption untouched (188 / 204 / 200). Run: npm run test:coef */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSUMPTION_WHY, DEFAULT_OPTS, annuityOf, birthYearOf, coefFor, coverageOf, fundChoices, pct0, replacementOf, trackAgeNote, type CoefFile } from '../src/lib/coef';
import { coefOf } from '../src/lib/retire';
import { cardCalc, summaryOf, type SumRow } from '../src/lib/myCalc';
import type { VFund } from '../src/lib/verdict';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number, e = 1e-9) => a != null && Math.abs(a - b) < e;
const BANNED = /עבר[וי]|כדאי לך|מומלץ|אנו ממליצים|תעביר|העבירו/;

/* ---- a hand-built file: one fund with two options, one fund with no table ---- */
const src = { id: 'x', kind: 'primary' as const, fund: 'קרן X', title: 'תקנון X, יוני 2025', edition: 'יוני 2025', url: 'https://x.example/t.pdf', retrieved: '2026-11-02', sha256: 'a'.repeat(64), pages: [100, 110] };
const F: CoefFile = {
  v: 1, asof: '2026-11-02', method: 'm', ages: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70],
  options: { s0_g0: { survivors: 0, guarantee: 0, label: 'ללא קצבת שאירים, בלי הבטחת תשלומים' }, s60_g0: { survivors: 60, guarantee: 0, label: 'קצבה לבן/בת זוג 60%, בלי הבטחת תשלומים' } },
  funds: { X: { src, excluded: [], tables: [
    { opt: 's0_g0', sex: 'm', pages: [101], quote: 'נספח יא1', years: [1960, 1965, 1970], ages: [66, 67, 68], v: [[171.83, 173.63, 175.21], [167.48, 169.28, 170.86], [163.02, 164.82, 166.4]] },
    { opt: 's60_g0', sex: 'm', pages: [102], quote: 'נספח יא2', years: [1960, 1965, 1970], ages: [66, 67, 68], v: [[192.8, 194.6, 196.2], [188.82, 190.6, 192.2], [184.7, 186.5, 188.1]] },
    { opt: 's60_g0', sex: 'f', pages: [102], quote: 'נספח יא2', years: [1960, 1965, 1970], ages: [66, 67, 68], v: [[null, 192.3, 193.9], [null, 188.3, 189.9], [null, 184.2, 185.8]] },
  ] } },
  coverage: [{ grp: 'X', prod: 'פנסיה מקיפה', status: 'table', n: 3 }, { grp: 'Y', prod: 'פנסיה מקיפה', status: 'missing', reason: 'תקנון הקרן לא אותר' }],
  assumption: { coef: 200, m: 188, f: 204, title: 'ביזפורטל', url: 'https://www.bizportal.co.il/x' },
  btl: { single: 1838, single_80: 1941, couple: 2762, from: '2026-01-01', title: 'ביטוח לאומי', url: 'https://www.btl.gov.il/x', retrieved: '2026-11-02', quote: '1,838 ש"ח (החל ב- 01.01.2026)' },
  target: { rate: 70, title: 'משרד האוצר 2016', url: 'https://www.gov.il/x', retrieved: '2026-11-02' },
};
{
  const p = coefFor(F, 'X', 'm', 67, 1960);
  ok(p.real && p.v === 188.82 && p.opt === 's60_g0' && p.page === 102, `default option: 60% to the spouse, no guarantee → 188.82 on p. 102 (${p.v}, ${p.opt}, p${p.page})`);
  ok(p.label === "לפי מקדם מהתקנון, עמ' 102" && p.why.includes('קרן X') && p.why.includes("עמ' 102") && p.why.includes('ילידי 1960'), `why names the fund and page: ${p.why}`);
  const pr = p.prov();
  ok(pr.k === 'report' && pr.pg === 102 && pr.url === src.url && String(pr.value) === '188.82', 'prov: the bylaws page');
  const s = coefFor(F, 'X', 'm', 67, 1960, 's0_g0');
  ok(s.real && s.v === 167.48 && s.page === 101, 'an explicit option: no survivors → 167.48 p. 101');
  const y = coefFor(F, 'X', 'm', 67, 1963);
  ok(y.v === 190.6 && y.year?.used === 1965 && y.why.includes('הקרובה ל-1963'), `born 1963 → the 1965 column (nearest, ties to the later): ${y.v} ${y.year?.used}`);
  ok(coefFor(F, 'X', 'm', 67, 1962).year?.used === 1960, 'born 1962 → 1960 (nearest)');
  ok(coefFor(F, 'X', 'm', 67, 1962.5).year?.used === 1965, 'a tie goes to the later column');
  const f = coefFor(F, 'X', 'f', 67, 1960);
  ok(f.real && f.v === 188.3 && f.year?.used === 1965, `a woman born 1960: the 1960 cell is blank, the nearest filled column is used (${f.v}, ${f.year?.used})`);
  const noYear = coefFor(F, 'X', 'm', 67, null);
  ok(noYear.real && noYear.year?.used === 1970 && noYear.why.includes('שנת לידה לא ידועה'), 'no birth year: the latest column, said so');
  const age = coefFor(F, 'X', 'm', 64.75, 1960);
  ok(!age.real && age.why.includes('הנחה') && age.why.includes('אין טבלה למסלול הקצבה הזה בגיל 65'), `an age the table lacks → assumption with the reason: ${age.why}`);
  const out = coefFor(F, 'X', 'm', 75, 1960);
  ok(!out.real && out.why.includes('60–70'), 'outside 60–70 → assumption, the range named');
  const noSex = coefFor(F, 'X', null, 67, 1960);
  ok(!noSex.real && noSex.v === 200 && noSex.why.includes('תלוי במין'), `no sex → 200 and asks for it: ${noSex.why}`);
  const noFund = coefFor(F, 'Y', 'm', 67, 1960);
  ok(!noFund.real && noFund.v === 188 && noFund.why.includes('תקנון הקרן לא אותר'), `a fund with no table → the assumption with the coverage reason: ${noFund.why}`);
  const unknown = coefFor(F, 'Z', 'f', 67, 1960);
  ok(!unknown.real && unknown.v === 204 && unknown.why.includes(ASSUMPTION_WHY), 'a group not in the file → ASSUMPTION_WHY');
  const noFile = coefFor(null, 'X', 'm', 67, 1960);
  ok(!noFile.real && noFile.v === 188 && noFile.label === 'לפי הנחה', 'no file → the assumption, labelled');
  ok(noFile.prov().k === 'calc' && (noFile.prov() as { est?: boolean }).est === true, 'the assumption\'s prov is an estimate');
  ok(DEFAULT_OPTS[0] === 's60_g0' && DEFAULT_OPTS.includes('s0_g0'), 'default options in order');
  ok(near(annuityOf(600000, p), 600000 / 188.82), 'annuity = balance ÷ coefficient');
  ok(birthYearOf(38, 2026) === 1988, 'birth year from age');
  const ch = fundChoices(F, 'm', 67, 1960);
  ok(ch.length === 1 && ch[0].grp === 'X' && ch[0].pick.v === 188.82, 'fund choices: the funds with a real cell');
  ok(fundChoices(F, null, 67, 1960).length === 0, 'no sex → no choices');
  ok(coverageOf(F, 'Y', 'פנסיה מקיפה')?.status === 'missing' && coverageOf(F, 'Q', 'פנסיה מקיפה') === null, 'coverage lookup');
  ok(![p.why, age.why, noFund.why].some((w) => BANNED.test(w)), 'no advice words');
}

/* ---- the old behaviour: the assumption is unchanged ---- */
ok(coefOf('m').v === 188 && coefOf('f').v === 204 && coefOf(null).v === 200, 'coefOf: 188 / 204 / 200 as before');

/* ---- the replacement rate ---- */
{
  const r = replacementOf(7000, 14000, F)!;
  ok(near(r.noBtl, 0.5) && near(r.withBtl, (7000 + 1838) / 14000) && near(r.target, 0.7) && r.btl === 1838, 'pension ÷ salary, with the basic old-age pension, the 70% benchmark');
  ok(replacementOf(7000, 0, F) === null && replacementOf(-1, 10000, F) === null, 'no salary or a negative pension → null');
  ok(pct0(0.6314) === '63%' && pct0(1.004) === '100%', 'pct0 rounds');
}

/* ---- the age–track note ---- */
{
  const n = trackAgeNote('עד 50', 63)!;
  ok(n && n.to === '60 ומעלה' && n.text.includes('בני 50 ומטה') && n.text.includes('בגיל 63') && n.text.includes('"60 ומעלה"'), `63 in "עד 50": ${n?.text}`);
  ok(trackAgeNote('50-60', 61)?.to === '60 ומעלה' && trackAgeNote('עד 50', 55)?.to === '50-60', 'the band the model moves to');
  ok(trackAgeNote('עד 50', 49) === null && trackAgeNote('50-60', 59) === null && trackAgeNote('60 ומעלה', 70) === null, 'inside the band, or the top band: no note');
  ok(trackAgeNote('מניות', 70) === null && trackAgeNote('עד 50', null) === null, 'not an age track, or no age: no note');
  ok(!BANNED.test(n.text), 'descriptive');
}

/* ---- the strip: no headline pension before a balance; the coefficient flags ---- */
{
  const mk = (k: string, prod: string): VFund => ({ k, name: k, prod, track: 'כללי', grp: 'X', fee: 0.2, depfee: 1.5, assets: 1000, a5: 9, a3: null, y12: 5, st: 40 });
  const all = [mk('p1', 'פנסיה מקיפה'), mk('p2', 'פנסיה מקיפה'), mk('g1', 'גמל')];
  const row = (f: VFund, my: { balance?: number } | undefined, coefReal: boolean): SumRow => ({ k: f.k, name: f.name, prod: f.prod, coefReal, c: cardCalc(f, all, 202609, null, my, null, { age: 40, coef: 188.82, ret: 4, retire: 67 }) });
  const s0 = summaryOf([row(all[0], undefined, true), row(all[2], undefined, false)]);
  ok(s0.pension != null && s0.penBal === 0 && s0.penEx && s0.penReal, 'example balances only: penBal 0 (the strip shows "הזינו יתרה"), penReal true');
  const s1 = summaryOf([row(all[0], { balance: 300000 }, true), row(all[1], undefined, false)]);
  ok(s1.penBal === 1 && s1.penN === 2 && !s1.penReal, 'one own balance, one assumption coefficient: penBal 1, penReal false');
}

/* ---- a smoke run over the published file ---- */
const path = join(process.cwd(), 'public/data/funds/coef.json');
if (existsSync(path)) {
  const d = JSON.parse(readFileSync(path, 'utf8')) as CoefFile;
  const grps = Object.keys(d.funds);
  ok(grps.length === 9, `nine funds (${grps.length})`);
  ok(d.coverage.filter((c) => c.prod === 'פנסיה מקיפה' && c.status === 'table').length === 9 && d.coverage.some((c) => c.status === 'missing' && c.reason), 'coverage: 9 comprehensive funds with a table; the general funds listed as missing with a reason');
  let tables = 0, cells = 0;
  for (const g of grps) {
    const f = d.funds[g];
    ok(/^https:\/\//.test(f.src.url) && f.src.edition && f.src.retrieved && /^[0-9a-f]{64}$/.test(f.src.sha256), `${g}: source url, edition, date, hash`);
    for (const t of f.tables) {
      tables++;
      ok(t.pages.length > 0 && t.quote.length > 0 && t.pages.every((p) => p >= f.src.pages[0] && p <= f.src.pages[1]), `${g} ${t.opt} ${t.sex}: page and heading inside the appendix`);
      for (const r of t.v) for (const v of r) if (v != null) { cells++; if (!(v >= 145 && v <= 260)) ok(false, `${g} ${t.opt} ${t.sex}: ${v} out of range`); }
    }
    const m = coefFor(d, g, 'm', 67, 1960, 's0_g0');
    if (m.real && m.year?.used === 1960) ok(m.v >= 165 && m.v <= 170, `${g}: a man of 67 born 1960 without survivors at ${m.v} (165–170)`);
    const w = coefFor(d, g, 'f', 67, 1988);
    ok(w.real && w.v > 150 && w.v < 230 && /עמ'/.test(w.label), `${g}: a woman of 38 today retiring at 67 → a real cell with a page (${w.v}, ${w.label})`);
    const mm = coefFor(d, g, 'm', 67, 1988);
    ok(mm.real && mm.opt === (g === 'אינפיניטי' ? 'sx_g0' : 's60_g0'), `${g}: the default option is the 60%-spouse table (Infinity: unspecified share) (${mm.opt})`);
  }
  ok(tables >= 180 && cells >= 18000, `${tables} tables, ${cells} cells`);
  ok(d.funds['מור'].excluded.length === 2 && d.funds['מור'].excluded.every((e) => e.pages.length && e.why), 'Mor: the two garbled tables are excluded with pages and a reason');
  ok(d.btl.single === 1838 && d.btl.from === '2026-01-01' && d.target.rate === 70, 'the National Insurance amount and the benchmark');
  ok(fundChoices(d, 'f', 67, 1965).length === 9, 'the calculator can offer all nine funds to a woman born 1965');
} else {
  console.log('coef: no public/data/funds/coef.json here, smoke run skipped');
}

console.log(`coef: ${pass} passed, ${fail} failed`);
for (const b of bad) console.log('FAIL', b);
if (fail) process.exit(1);
