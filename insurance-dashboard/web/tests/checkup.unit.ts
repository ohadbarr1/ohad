/* S1 + S2 saver · the annual check-up (lib/checkup.ts), run in node: the three lines on hand-built categories (the anchor hierarchy, the
   tones, the deposit window, the age tracks), the letters (cited anchors, first person, no advice), the reminder and the saving; then
   the clearing-house fixtures through the real import (lib/maslaka) and the published data, when web/public/data is there.
   Run: npm run test:checkup */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type VFund, verdictOf } from '../src/lib/verdict';
import { cardCalc, gapOf } from '../src/lib/myCalc';
import { feeGap, retireAgeOf, type Plan } from '../src/lib/retire';
import {
  MIN_GAP, ST_FAR, addDays, ageAsk, ageRow, bandOf, checkupOf, depRow, depWindow, dueNegos, dueOf, feeLetter, feeRow, feeShort, icsOf, mailHref, normNegos, savingOf,
  startNego, waHref, worst, yearSaving, type CProd, type CRow,
} from '../src/lib/checkup';
import { letterOf } from '../src/lib/deposits';
import { normGlide, type GlideData } from '../src/lib/fundsTime';
import { applyRows, decodeXml, parseMaslaka, rowsOf, xmlTree, type MFund } from '../src/lib/maslaka';
import type { DefaultFile } from '../src/lib/fundsTools';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const BANNED = /עבר[וי] ל|כדאי לך|מומלץ|אנו ממליצים|תעביר|העבירו|חוסך\/ת|\/ת\b/;

const mk = (k: string, fee: number | null, extra: Partial<VFund> = {}): VFund => ({
  k, name: `קרן ${k}`, prod: 'פנסיה מקיפה', track: 'עד 50', grp: `גוף ${k}`, fee, depfee: 1.5, assets: 1000, a5: 10, a3: null, y12: 5, net: { a5: 9.8, y12: 4.9 }, st: 55, id: Number(k.slice(1)), ...extra });
const cat = [mk('p1', 0.14), mk('p2', 0.15), mk('p3', 0.11), mk('p4', 0.16), mk('p5', 0.2), mk('p6', 0.15, { depfee: 1.2 }), mk('p7', 0.15)];
const dfile: DefaultFile = { tenders: [{ id: '2024', label: 'ההליך הרביעי', from: '2024-11-01', to: '2028-10-31', fee: 0.22, depfee: 1, fee_years: 10, src: 'https://gov.il/x.pdf', verified: true,
  winners: [{ grp: 'גוף p7', ks: ['p7'] } as never], fee_alt: [{ fee: 0.2, depfee: 1.2 }, { fee: 0.1, depfee: 2.2 }], alloc: 'חלוקה לפי ספרת הביקורת בתעודת הזהות: 0,1,2,3,4,5,6,7,8,9 גוף p7' }] };
const O = { age: 38, coef: 200, ret: 4, retire: 67 };
const row = (f: VFund, m: CProd, all = cat): CRow => ({ f, m, c: cardCalc(f, all, 202609, dfile, m, null, O) });

/* ---- line 1: the anchor hierarchy ---- */
{
  // (1) own pension fees above the tender: red, read against the tender (never the others' averages)
  const own = row(cat[4], { k: 'p5', balance: 200000, monthly: 2500, fee: 0.3, depfee: 2.5 });
  const r = feeRow(own);
  ok(r.anchor === 'tender' && r.own && r.tone === 'red', `own pension fees 0.30% / 2.5% vs the tender 0.22% / 1%: red on the tender anchor (${r.anchor}, ${r.tone})`);
  ok(r.gap != null && r.gap >= MIN_GAP && Math.abs(r.gap - own.c.tBest!.g.balReal) < 1e-6, 'the ₪ is the card\'s own tender gap (lib/myCalc tBest), so /my and the check-up agree');
  const g = gapOf(own.c);
  ok(g?.ref === 'dflt' && Math.abs(g.v - r.gap!) < 1e-6, 'the same figure /my\'s "one thing to do" uses (gapOf → the default-fund price)');
  ok(r.ask?.fee === 0.22 && r.ask.depfee === 1 && r.avg.fee === 0.2, 'the letter asks for the tender\'s base price; the track\'s average (0.20%) is context');
  // red team 3: an own fee below the others' averages but at the tender price is not red
  const at = feeRow(row(cat[4], { k: 'p5', balance: 200000, monthly: 2500, fee: 0.22, depfee: 1 }));
  ok(at.tone === 'green' && at.anchor === 'tender', `own fees at the tender price: green, whatever the others' averages (${at.tone})`);
  const atC = row(cat[4], { k: 'p5', balance: 200000, monthly: 2500, fee: 0.22, depfee: 1 }).c;
  ok(atC.tBest!.g.balReal > 0 && gapOf(atC) === null, `at the price, /my's "one thing to do" no longer asks for a cut because another table row would leave more (tBest gap ${Math.round(atC.tBest!.g.balReal)}, gapOf null)`);
  const below = feeRow(row(cat[4], { k: 'p5', balance: 200000, monthly: 2500, fee: 0.1, depfee: 1 }));
  ok(below.tone === 'green' && (below.gap ?? 0) <= 0, 'own fees under the tender price: green, no gap');
  // a part above the base price while the mix costs no more (the conversion table): amber, never green against the card's "above"
  const mix = row(cat[4], { k: 'p5', balance: 400000, monthly: 1000, fee: 0.1, depfee: 2.2 });
  const rm = feeRow(mix);
  ok(mix.c.v.lever === 'dep' && rm.tone !== 'green', `0.10% / 2.2% (a row of the conversion table): the card says the deposit fee is above the base price, so not green (${rm.tone}, gap ${Math.round(rm.gap ?? 0)})`);
  // (2) a השתלמות: the median of the averages, at the 6-year horizon
  const hs = cat.map((x) => ({ ...x, prod: 'השתלמות', track: 'כללי', depfee: null, fee: (x.fee ?? 0) * 4 }));
  const h = feeRow(row(hs[4], { k: 'p5', balance: 120000, monthly: 1500, fee: 1.0, depfee: 0 }, hs));
  ok(h.anchor === 'avg' && h.horizon === 'liq' && h.years === 6 && h.tone === 'red', `השתלמות 1.00% vs a median of ${h.med}%: red, at 6 years (${h.tone}, ${Math.round(h.gap ?? 0)})`);
  ok(h.ask != null && h.ask.fee === h.q1 && h.ask.fee < 1, 'the השתלמות letter asks for the cheapest quarter of the averages');
  ok(h.cap?.fee === 1.05 && h.cap.depfee === 4, 'the legal ceiling travels with the row');
  // (3) no own fees: amber, on the track's average, labelled
  const avg = feeRow(row(cat[4], { k: 'p5' }));
  ok(avg.tone === 'amber' && !avg.own && avg.ex, 'no own fees: amber, and the amounts are examples');
  // the verdict's word "above the median" never comes out green
  const near = hs.map((x) => ({ ...x }));
  const nr = feeRow(row(near[4], { k: 'p5', balance: 1000, monthly: 0, fee: (near[4].fee ?? 0) + 0.01, depfee: 0 }, near));
  ok(nr.tone === 'amber' && (nr.gap ?? 0) < MIN_GAP, `an own fee a hair above the median on a small balance: the card says "above", the check-up says amber (${nr.tone})`);
  const L = checkupOf([own, row(cat[2], { k: 'p3', balance: 50000, monthly: 1000, fee: 0.22, depfee: 1 })], { age: 38, profileSalary: null, glide: null }).fee!;
  ok(L.tone === 'red' && L.top?.k === 'p5' && L.rows.length === 2 && Math.abs(L.total - r.gap!) < 1e-6, 'the line: the worst tone, the red product first, the red gaps added');
  ok(worst(['green', 'amber']) === 'amber' && worst(['amber', 'red', 'green']) === 'red' && worst([]) === 'green', 'worst()');
}

/* ---- the letters ---- */
{
  const r = feeRow(row(cat[4], { k: 'p5', balance: 200000, monthly: 2500, fee: 0.3, depfee: 2.5 }));
  const t = feeLetter(r, { id: 5, src: 'פנסיה-נט, 09/26', retire: '64 ו-9 חודשים' });
  ok(t.startsWith('שלום,') && t.includes('(מספר קופה 5)') && t.includes('0.3% מהצבירה ו-2.5% מכל הפקדה'), 'the letter: the fund, its number, the reader\'s own fees');
  ok(t.includes('ההליך הרביעי, 01.11.24–31.10.28') && t.includes('0.22% מהצבירה ו-1% מכל הפקדה') && t.includes('ל-10 שנים'), `the tender anchor with its name, period and price: ${t}`);
  ok(t.includes('הממוצע שמשלמים בפועל העמיתים במסלול שלי: 0.2% מהצבירה ו-1.5% מהפקדה (פנסיה-נט, 09/26)'), 'the track\'s average as context, with its source');
  ok(t.includes('התקרה בחוק: 0.5% מהצבירה ו-6% מהפקדה') && t.includes('התשע"ב-2012'), 'the legal ceiling, cited');
  ok(/כ-[\d,]+ ש"ח עד גיל 64 ו-9 חודשים \(אומדן, בשקלי היום\)/.test(t), 'the ₪ gap, labelled an estimate, at the reader\'s statutory retirement age');
  ok(t.includes('אבקש להפחית') && !BANNED.test(t), 'a request, first person, gender-neutral, no advice');
  const s = feeShort(r);
  ok(s.split('\n').length === 3 && s.includes('0.22%') && !BANNED.test(s), `the WhatsApp text: three lines (${s})`);
  ok(waHref('א ב').startsWith('https://wa.me/?text=') && waHref('א ב').includes('%D7%90%20') && mailHref('נ', 'ג').startsWith('mailto:?subject='), 'WhatsApp and mail links carry no recipient');
  const hs = cat.map((x) => ({ ...x, prod: 'השתלמות', track: 'כללי', depfee: null, fee: (x.fee ?? 0) * 4 }));
  const th = feeLetter(feeRow(row(hs[4], { k: 'p5', balance: 120000, monthly: 1500, fee: 1.0, depfee: 0 }, hs)), { src: 'גמל-נט, 09/26', retire: '67' });
  ok(th.includes('חציון הממוצע שמשלמים בפועל') && th.includes('בעוד 6 שנים') && th.includes('1.05% מהצבירה ו-4% מהפקדה') && !BANNED.test(th), `השתלמות letter: the median, the 6-year horizon, the ceiling (${th})`);
}

/* ---- line 2: deposits over the rows' own window ---- */
{
  ok(depWindow([{ ym: '2026-07' }, { ym: '2026-09' }]).join() === '2026-07,2026-08,2026-09', 'the window runs from the first to the last row');
  ok(depWindow([{ ym: '2024-01' }, { ym: '2026-09' }]).length === 12 && depWindow([{ ym: '2024-01' }, { ym: '2026-09' }])[0] === '2025-10', 'at most the last 12 months');
  ok(depWindow([]).length === 0 && depWindow([{ ym: 'bad' }]).length === 0, 'no rows, no window');
  const f = cat[4];
  const full = (ym: string) => ({ ym, employee: 900, employer: 975, severance: 900 });  // 15,000 × 18.5% = 2,775
  const ok1 = depRow(f, { k: 'p5', salary: 15000, deposits: ['2026-01', '2026-02', '2026-03'].map(full) }, null)!;
  ok(ok1.tone === 'green' && ok1.audit!.months.length === 3, 'three full months: green, and only three months are read (no "missing" months before the file starts)');
  const gap = depRow(f, { k: 'p5', salary: 15000, deposits: [full('2026-01'), full('2026-03'), { ym: '2026-04', employee: 900, employer: 975, severance: 0 }] }, null)!;
  ok(gap.tone === 'red' && gap.audit!.missing.map((m) => m.ym).join() === '2026-02' && gap.audit!.short.map((m) => m.ym).join() === '2026-04', 'pension: a month between rows with nothing, and a short month → red');
  const h = depRow({ ...f, prod: 'השתלמות' }, { k: 'p5', salary: 15000, deposits: [{ ym: '2026-01', total: 1500 }, { ym: '2026-03', total: 1500 }] }, null)!;
  ok(h.tone === 'amber' && h.kind === 'hishtalmut', 'השתלמות: a missing month is amber (agreed rates, no statutory duty)');
  ok(depRow(f, { k: 'p5' }, null)!.why === 'nodata' && depRow(f, { k: 'p5', deposits: [{ ym: '2026-01', total: 100 }] }, null)!.why === 'nosalary', 'no rows / no salary: amber, says what is missing');
  ok(depRow(f, { k: 'p5', deposits: [{ ym: '2026-01', total: 2775, salary: 15000 }] }, null)!.tone === 'green', 'the salary of the row itself is used');
  ok(depRow({ ...f, prod: 'גמל' }, { k: 'p5' }, null) === null, 'גמל: not read');
  const pd = depRow(f, { k: 'p5', salary: 15000, deposits: [{ ...full('2026-01'), paid: '2026-02-10' }, { ...full('2026-03'), paid: '2026-03-12' }] }, null)!;
  ok(pd.unsure.join() === '2026-02' && pd.audit!.missing.length === 0 && pd.tone === 'amber', 'a gap before a payment-dated row is unsure, not missing: amber');
  ok(depRow(f, { k: 'p5', salary: 15000, deposits: [full('2022-01')] }, null, '2026-10')!.why === 'inactive' && depRow(f, { k: 'p5', salary: 15000, deposits: [full('2026-05')] }, null, '2026-10')!.why === null, 'no deposit in the last 6 months: inactive, not checked');
  const late = depRow(f, { k: 'p5', salary: 15000, deposits: [{ ...full('2026-01'), paid: '2026-03-01' }] }, null)!;
  ok(late.tone === 'amber' && late.audit!.late.length === 1, 'late only: amber');
  const L = letterOf(gap.audit!, { fund: f.name, prod: f.prod, id: f.id });
  ok(L.includes('02/2026') && L.includes('04/2026') && !BANNED.test(L), 'the employer letter names the months, first person');
}

/* ---- line 3: age and track ---- */
{
  const G: GlideData = normGlide({ asof: 202609, months: [202609], ages: [], prods: [{ prod: 'פנסיה מקיפה', med: { 'עד 50': { st: 58, n: 9 }, '50-60': { st: 50, n: 9 }, '60 ומעלה': { st: 31, n: 9 } },
    mgrs: [{ grp: 'גוף p5', tracks: { 'עד 50': { k: 'p50', name: 'קרן עד 50', st_now: 59 }, '50-60': { k: 'p51', name: 'קרן 50-60', st_now: 49 }, '60 ומעלה': { k: 'p52', name: 'קרן 60+', st_now: 30 } } }] }] });
  ok(bandOf(49) === 'עד 50' && bandOf(50) === '50-60' && bandOf(60) === '60 ומעלה', 'bands');
  const f = cat[4];
  ok(ageRow(f, 38, G)?.tone === 'green' && ageRow(f, 38, G)?.kind === 'age-ok', '38 in "עד 50": green');
  ok(ageRow(f, 62, G)?.tone === 'red' && ageRow(f, 62, G)?.kind === 'age-past', 'the red team\'s 62 in a "50 ומטה" track: red');
  ok(ageRow(f, 50, G)?.tone === 'amber' && ageRow(f, 50, G)?.kind === 'age-edge', 'exactly 50 in "עד 50": amber (the move happens near the age)');
  ok(ageRow({ ...f, track: '60 ומעלה' }, 40, G)?.kind === 'age-young', '40 in "60 ומעלה": amber, an older band');
  const chosen = ageRow({ ...f, track: 'מניות', st: 95 }, 62, G)!;
  ok(chosen.kind === 'chosen-far' && chosen.ref === 30 && chosen.refFrom === 'mgr' && chosen.refK === 'p52', `a chosen equity track at 62: far from the manager's 60+ track (${chosen.st} vs ${chosen.ref})`);
  ok(ageRow({ ...f, track: 'כללי', st: 52 }, 52, G)?.kind === 'chosen-ok' && Math.abs(52 - 49) < ST_FAR, 'a general track near the 50-60 track: green');
  ok(ageRow({ ...f, grp: 'אחר', track: 'מניות', st: 95 }, 62, G)?.refFrom === 'med', 'no age track at the manager: the band\'s median');
  ok(ageRow({ ...f, track: 'מקבלי קצבה' }, 70, G) === null && ageRow({ ...f, prod: 'השתלמות' }, 40, G) === null && ageRow(f, 40, null) === null, 'pensioners, השתלמות, no glide file: no line');
  ok(!BANNED.test(ageAsk(ageRow(f, 62, G)!)) && ageAsk(ageRow(f, 62, G)!).includes('האם הכסף יועבר'), 'the question to the fund asks, never advises');
  // the retirement age follows the law: a woman born in 1964 retires at 63 and 6 months, not 67
  ok(retireAgeOf('f', 62, 2026).v === 63.5 && retireAgeOf('f', 40, 2026).v === 65 && retireAgeOf('m', 40, 2026).v === 67, 'women\'s statutory retirement age by birth year');
  const w = cardCalc(f, cat, 202609, dfile, { balance: 200000, monthly: 2500, fee: 0.3, depfee: 2.5 }, null, { ...O, age: 40, retire: 65 });
  ok(w.plan.retire === 65 && w.tBest!.g.years === 25, 'the card (and so the check-up) runs to the woman\'s retirement age, 65');
}

/* ---- S2: the reminder and the saving ---- */
{
  ok(addDays('2026-11-05', 30) === '2026-12-05' && addDays('2026-01-31', 30) === '2026-03-02', '30 days');
  let n = startNego([], 'p5', { fee: 0.3, depfee: 2.5 }, '2026-11-05');
  n = startNego(n, 'p5', { fee: 0.3, depfee: 2.5 }, '2026-11-06');
  ok(n.length === 1 && n[0].at === '2026-11-06' && dueOf(n[0]) === '2026-12-06', 'one open negotiation per product');
  ok(dueNegos(n, '2026-12-05').length === 0 && dueNegos(n, '2026-12-06').length === 1 && dueNegos([{ ...n[0], after: { fee: 0.2, depfee: 1 } }], '2027-01-01').length === 0, 'due after 30 days, until the new fees are entered');
  ok(normNegos([null, { k: 'x' }, { k: 'p5', at: '2026-11-06', before: { fee: 0.3, depfee: 2.5 } }, 'junk']).length === 1 && normNegos('x').length === 0, 'stored negotiations are read defensively');
  const p: Plan = { age: 38, retire: 67, balance: 200000, monthly: 2500, growth: 2, ret: 4, infl: 2, coef: 200 };
  const s = savingOf(p, { fee: 0.3, depfee: 2.5 }, { fee: 0.22, depfee: 1 });
  ok(s > 0 && Math.abs(s - feeGap(p, { fee: 0.3, depfee: 2.5 }, { fee: 0.22, depfee: 1 }).balReal) < 1e-6, `the saving is the card's fee gap, before → after (${Math.round(s)} ₪)`);
  ok(savingOf(p, { fee: 0.3, depfee: 2.5 }, { fee: 0.3, depfee: 2.5 }) === 0 && savingOf(p, { fee: 0.2, depfee: 1 }, { fee: 0.3, depfee: 2 }) < 0, 'no change: 0; a higher fee: negative');
  ok(Math.abs(yearSaving(p, { fee: 0.3, depfee: 2.5 }, { fee: 0.22, depfee: 1 }) - (200000 * 0.0008 + 30000 * 0.015)) < 1e-6, 'this year\'s fees in ₪');
  const ics = icsOf('2026-12-06', 'https://fox-research-il.web.app/my/checkup', new Date('2026-11-06T10:00:00Z'));
  ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.includes('DTSTART;VALUE=DATE:20261206') && ics.includes('DTEND;VALUE=DATE:20261207') && ics.includes('TRIGGER;RELATED=START:PT9H') && ics.includes('DTSTAMP:20261106T100000Z'), 'the ICS: an all-day event on the due day, a 09:00 alert');
  ok(!/\d+\.\d+%|ש"ח|קרן /.test(ics), 'the ICS carries no figure and no fund');
}

/* ---- the clearing-house fixtures through the real import and the published data ---- */
const D = join(process.cwd(), 'public', 'data');
const FIX = join(process.cwd(), 'tests', 'fixtures', 'maslaka');
if (existsSync(join(D, 'funds.json'))) {
  const d = JSON.parse(readFileSync(join(D, 'funds.json'), 'utf8')) as { asof: number; funds: (VFund & MFund)[] };
  const df = JSON.parse(readFileSync(join(D, 'funds', 'default.json'), 'utf8')) as DefaultFile;
  const gl = normGlide(JSON.parse(readFileSync(join(D, 'funds', 'glide.json'), 'utf8')));
  const byK = new Map(d.funds.map((f) => [f.k, f]));
  const run = (file: string, age: number, sex: 'f' | 'm' | null) => {
    const parsed = parseMaslaka(xmlTree(decodeXml(new Uint8Array(readFileSync(join(FIX, file))))));
    const saved = applyRows([], rowsOf(parsed, d.funds, 'x'), '2026-11-05').list as CProd[];
    const retire = retireAgeOf(sex, age, 2026).v;
    const rows: CRow[] = saved.flatMap((m) => { const f = byK.get(m.k); return f ? [{ f, m, c: cardCalc(f, d.funds, d.asof, df, m, null, { age, coef: 200, ret: 4, retire }) }] : []; });
    return { rows, ck: checkupOf(rows, { age, profileSalary: null, glide: gl }), retire };
  };
  const say = (label: string, x: ReturnType<typeof run>) => {
    const f = x.ck.fee, dp = x.ck.dep, a = x.ck.age;
    console.log(`  ${label} (retire ${x.retire}):`);
    f?.rows.forEach((r) => console.log(`    fee   ${r.tone.padEnd(5)} ${r.name} · ${r.anchor} · mine ${r.mine.fee}/${r.mine.depfee} vs ${r.ref?.fee}/${r.ref?.depfee} · gap ${r.gap == null ? '–' : Math.round(r.gap)} ₪ (${r.horizon})`));
    dp?.rows.forEach((r) => console.log(`    dep   ${r.tone.padEnd(5)} ${r.name} · ${r.why ?? `${r.audit!.months.length} months, missing ${r.audit!.missing.length}, short ${r.audit!.short.length}, late ${r.audit!.late.length}, gap ${Math.round(r.audit!.totalGap)} ₪`}`));
    a?.rows.forEach((r) => console.log(`    age   ${r.tone.padEnd(5)} ${r.name} · ${r.kind} · track ${r.track} · band ${r.band} · st ${r.st} vs ${r.ref}`));
  };
  // the pension fixture: Menora, comprehensive pension "עד 50" (p2184) by the unified code at 0.22% / 1.49%, and a frozen "50-60" account
  const pen = run('fixture-pension.xml', 41, 'f');
  say('fixture-pension.xml, a woman of 41', pen);
  const p2184 = pen.ck.fee?.rows.find((r) => r.k === 'p2184');
  ok(p2184 && p2184.anchor === 'tender' && p2184.own && p2184.mine.depfee === 1.49 && p2184.tone !== 'green', `fixture: own 0.22% / 1.49% against the tender's 0.22% / 1%: the deposit fee is above, not green (${p2184?.tone}, ${Math.round(p2184?.gap ?? 0)})`);
  ok(pen.retire === 65 && pen.rows.every((r) => r.c.plan.retire === 65), 'fixture: a woman of 41 (born 1985) runs to 65, not 67');
  const dep = pen.ck.dep?.rows.find((r) => r.k === 'p2184');
  ok(dep && dep.audit && dep.audit.months.map((m) => m.ym).join() === '2026-07,2026-09' && dep.unsure.join() === '2026-08' && dep.tone === 'amber',
    `fixture: the window is the file's own (07/26–09/26, not 12 months); 08/26 is not "missing": the 09/26 row is dated by its payment (${dep?.audit?.months.map((m) => m.ym)} · unsure ${dep?.unsure})`);
  ok(pen.ck.dep?.rows.find((r) => r.k !== 'p2184')?.why === 'inactive', 'fixture: the frozen account (last deposit 01/22) has no current deposits to check');
  ok(pen.ck.age?.rows.some((r) => r.k === 'p2184' && r.kind === 'age-ok'), 'fixture: 41 in "עד 50" fits');
  ok(pen.ck.age?.rows.some((r) => r.kind === 'age-young') ?? false, 'fixture: the frozen account in "50-60" at 41 is flagged amber');
  const mor = run('fixture-mor.xml', 52, null);
  say('fixture-mor.xml, age 52, sex not given', mor);
  ok(mor.retire === 67 && (mor.ck.fee?.rows.length ?? 0) >= 1, 'fixture: Mor (השתלמות + גמל) reads, sex not given → 67 (labelled on the page)');
  ok(mor.ck.age?.rows.some((r) => r.kind === 'age-past') ?? false, 'fixture: the gemel in "לבני 50 ומטה" at 52 is red');
  const hs = mor.ck.fee?.rows.find((r) => r.prod === 'השתלמות');
  ok(hs && hs.anchor === 'avg' && hs.horizon === 'liq', 'fixture: the השתלמות reads on the median at 6 years');
  const bit = run('fixture-bituach.xml', 50, 'm');
  say('fixture-bituach.xml, a man of 50', bit);
  ok((bit.ck.fee?.rows.length ?? 0) === 1 && bit.ck.dep == null && bit.ck.age == null, 'fixture: a managers\' policy has a fee line only (no statutory deposit check, no age tracks)');
  // the letter on the real tender
  const lt = feeLetter(p2184!, { id: byK.get('p2184')?.id, src: 'פנסיה-נט, 09/26', retire: '65' });
  ok(lt.includes('ההליך הרביעי') && lt.includes('1% מכל הפקדה') && !BANNED.test(lt), 'fixture: the letter quotes the fourth tender');
  // every check-up line is consistent with the report card's own word for the same product
  for (const r of [...pen.rows, ...mor.rows, ...bit.rows]) {
    const v = verdictOf(r.f, d.funds, d.asof, df, r.m, null);
    const fr = feeRow(r);
    if (fr.own && v.fee.basis === 'tender' && v.lever) ok(fr.tone !== 'green', `${r.f.k}: the card says above the default funds, the check-up is not green`);
    if (fr.own && v.fee.basis === 'avg' && v.fee.word === 'high') ok(fr.tone !== 'green', `${r.f.k}: the card says above the median, the check-up is not green`);
  }
} else console.log('  (no web/public/data: the fixture walkthrough was skipped)');

console.log(`checkup: ${pass} passed, ${fail} failed`);
if (fail) { for (const b of bad) console.log('  FAIL ' + b); process.exit(1); }
