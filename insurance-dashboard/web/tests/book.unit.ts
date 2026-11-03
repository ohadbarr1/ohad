/* W11 (agent door): the book stress test (lib/agentBook) and the claims-adjusted cover price (lib/coverPrice). Hand-computed cases on
   synthetic folders, then the published covers.json and decision.json read as the page reads them.
   Run: npm run test:book */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addMonths, bookOf, catMedians, hhiText, tenderHits } from '../src/lib/agentBook';
import { adjust, effProv, effRows, rawProv, sortEff, type CoversFile } from '../src/lib/coverPrice';
import type { Folder, Held } from '../src/lib/clients';
import type { FundX } from '../src/lib/funds';
import type { DecisionFile } from '../src/lib/decision';
import type { DefaultFile } from '../src/lib/fundsTools';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number, e = 1e-6) => a != null && Math.abs(a - b) < e;

/* ---- fixtures ---- */
const F = (k: string, o: Partial<FundX> = {}): FundX => ({ k, fam: 'pensia', prod: 'פנסיה מקיפה', track: 'כללי', name: `קרן ${k}`, mgr: 'מנהל', grp: 'א', assets: 100, fee: 0.2, depfee: 1.5,
  m1: 0, ytd: 0, y12: 0, a3: 0, a5: 0, ...o } as unknown as FundX);
const funds: FundX[] = [
  F('p1', { grp: 'א', fee: 0.1, act_h: [[202603, 0.1], [202606, -0.2]] }),
  F('p2', { grp: 'ב', fee: 0.2, act_h: [[202606, 0.3]] }),
  F('p3', { grp: 'ג', fee: 0.3 }),
  F('p4', { grp: 'ד', fee: 0.4 }),
  F('g1', { fam: 'gemel', prod: 'השתלמות', track: 'כללי', grp: 'א', fee: 0.7 }),
  F('i1', { fam: 'insurance', prod: 'ביטוחי מנהלים 1990-2003 (קרן ותיקה)', track: 'משתתף ברווחים', grp: 'ב', fee: 1.0 }),
];
const H = (o: Partial<Held>): Held => ({ k: null, typeHe: 'קרן פנסיה', provider: 'גוף', plan: null, track: null, balance: null, monthly: null, fee: null, feeHow: null, depfee: null, depHow: null, asof: null, covers: [], note: null, ...o });
const Fo = (id: string, label: string, held: Held[]): Folder => ({ id, label, keys: [], b: 'net', tags: {}, fields: {}, note: '', created: '2026-01-01', updated: '2026-01-01', snap: null, held });
const DF: DefaultFile = { tenders: [
  { id: '2016', from: '2016-11-01', to: '2018-10-31', fee: null, depfee: null, fee_years: 10, src: 'x', verified: false, winners: [{ grp: 'ב', fee: 0.01, depfee: 1.31, ks: ['p2'] }] },
  { id: '2024', from: '2024-11-01', to: '2028-10-31', fee: 0.22, depfee: 1, fee_years: 10, src: 'x', verified: true, winners: [{ grp: 'ב', ks: ['p2'] }] },
  { id: '2021', from: '2021-11-01', to: '2024-10-31', fee: 0.22, depfee: 1, src: 'x', verified: false, winners: [{ grp: 'ג', ks: ['p3'] }] },
] };
const folders = [
  Fo('a', 'לקוח א', [H({ k: 'p1', balance: 400000, monthly: 3000, fee: 0.3, depfee: 2 }), H({ k: 'g1', typeHe: 'קרן השתלמות', balance: 100000, fee: 0.7 })]),
  Fo('b', 'לקוח ב', [H({ k: 'p2', balance: 300000, monthly: 2000, fee: 0.01, depfee: 1.31 }), H({ k: 'i1', typeHe: 'ביטוח מנהלים', balance: 200000, fee: 1.2, coefGuaranteed: { v: 180, at: 65, src: 'file' } })]),
  Fo('c', 'לקוח ג', [H({ k: 'p3', balance: 0, monthly: 1000, fee: 0.22, depfee: 1 }), H({ k: null, typeHe: 'פוליסת חיסכון', provider: 'חברה ז', balance: 50000 })]),
];
const TODAY = '2026-11-03';

/* ---- dates and medians ---- */
ok(addMonths('2016-11-01', 120) === '2026-11-01' && addMonths('2024-01-31', 1) === '2024-02-29' && addMonths(TODAY, 12) === '2027-11-03', 'addMonths: years, month ends, leap year');
{
  const m = catMedians(funds);
  ok(near(m.get('פנסיה מקיפה | כללי')!.fee, 0.25) && m.get('פנסיה מקיפה | כללי')!.n === 4, 'category median of the published average fees (0.1, 0.2, 0.3, 0.4 → 0.25)');
}

/* ---- the book ---- */
const b = bookOf(folders, funds, DF, TODAY, 1);
ok(b.folders === 3 && b.extra === 1 && b.products === 6 && b.matched === 5, 'counts: folders, unsaved, products, matched');
ok(near(b.balance, 1050000) && near(b.monthly, 6000), 'totals: balances and monthly deposits');
ok(near(b.feeYear, 400000 * 0.003 + 36000 * 0.02 + 100000 * 0.007 + 300000 * 0.0001 + 24000 * 0.0131 + 200000 * 0.012 + 12000 * 0.01), 'annual fee cost = Σ balance × fee + 12 × deposit × deposit fee');
{
  const g = Object.fromEntries(b.byGroup.map((s) => [s.label, s]));
  ok(near(g['א'].balance, 500000) && near(g['א'].share, 500000 / 1050000 * 100) && g['א'].folders.join() === 'a', 'group exposure: ₪, % and the folders behind it');
  ok(g['חברה ז'] && !g['חברה ז'].matched, 'an unmatched product counts under its provider, marked unmatched');
  ok(b.top?.label === 'א' && b.hhi === Math.round(b.byGroup.reduce((t, s) => t + s.share ** 2, 0)), 'largest group and HHI = Σ share²');
  ok(/10,000 = גוף אחד/.test(hhiText(b.hhi, 3)), 'the HHI line explains its scale, no verdict');
  ok(b.byProduct.some((s) => s.label === 'פנסיה מקיפה' && near(s.balance, 700000)), 'product exposure');
}
ok(near(b.act.base, 700000) && near(b.act.neg, 400000) && near(b.act.share!, 400000 / 700000 * 100) && b.act.items[0].folder === 'a' && b.act.asof === 202606,
  'negative actuarial balance: the last published quarter, as a share of the pension balances that have one');
ok(near(b.fee.base, 700000) && near(b.fee.above, 400000) && near(b.fee.gap, 400000 * 0.0005) && b.fee.items.length === 1 && /0\.25%/.test(b.fee.items[0].detail),
  'own fee above the category median: p1 at 0.30% against 0.25%, ₪200 a year; p2 at 0.01% is below; gemel and BM categories too small');
ok(b.fee.noCat === 2, 'a category with fewer than 3 tracks is counted, not compared');
{
  const h = tenderHits(folders[1].held[0], DF.tenders);
  ok(h[0].byFee && h[0].t.id === '2016' && h[0].end?.join() === '2026-11-01,2028-10-31', 'tender hit: the 2016 price (0.01% / 1.31%) matched by fee, its 10 years end 11.2026–10.2028');
  ok(b.dflt.items.length === 1 && b.dflt.items[0].folder === 'b' && /2016/.test(b.dflt.items[0].detail), 'the default-price line lists the product whose window meets the next 12 months');
  ok(b.dflt.unknown === 1, 'a tender with no published price period (2021) is counted as unknown, not flagged');
}
ok(b.coef.items.length === 1 && /דור סגור/.test(b.coef.items[0].detail) && /180/.test(b.coef.items[0].detail), 'closed generation with a guaranteed coefficient');
ok(b.unmatched.items.length === 1 && b.unmatched.items[0].folder === 'c', 'unmatched product listed');
ok(b.lines.length === 5 && b.lines.every((l) => l.folders === new Set(l.items.map((i) => i.folder)).size), 'every line carries its folders');
ok(!b.lines.some((l) => /טוב|רע|מומלץ|עדיף/.test(l.title + l.sub)), 'no line judges a product');
{
  const e = bookOf([], funds, null, TODAY);
  ok(e.balance === 0 && e.top === null && e.hhi === null && e.act.share === null && e.fee.share === null, 'an empty book: zeros and nulls, no NaN');
}

/* ---- the cover price ---- */
ok(near(adjust(10, { approved: 50, fast: 20, n: null }), 20) && near(adjust(10, { approved: 50, fast: 0, n: null })!, 20) && adjust(10, { approved: 0, fast: 50, n: null }) === null && adjust(null, { approved: 50, fast: 50, n: null }) === null, 'adjust: cost ÷ approved; the 30-day share never divides; a zero or missing approval gives null');
const cov = JSON.parse(readFileSync(join(process.cwd(), 'public/data/funds/covers.json'), 'utf8')) as CoversFile;
const dec = JSON.parse(readFileSync(join(process.cwd(), 'public/data/funds/decision.json'), 'utf8')) as DecisionFile;
{
  const rows = effRows(cov, dec, 'm', 40);
  ok(rows.length === 9, 'nine comprehensive funds with a table');
  const more = rows.find((r) => r.grp === 'מור')!;
  const cl = dec.companies['מור'].claims!;
  ok(near(more.eff!, more.dis! / (cl.disability.approved! / 100) + more.surv! / (cl.survivors.approved! / 100), 1e-9), 'effective price = each part ÷ its own approval share (speed shown apart)');
  ok(near(more.raw!, more.dis! + more.surv!, 0.002) && more.mult! > 1, 'raw = disability + survivors; the effective price is never below the raw one');
  const clal = rows.find((r) => r.grp === 'כלל')!;
  ok(clal.raw != null && clal.eff === null && /נספח ב3|דוח תביעות/.test(clal.why ?? ''), 'no annex B3 (Clal): the raw price stands, the effective is null with the reason');
  const alt = effRows(cov, dec, 'f', 30).find((r) => r.grp === 'אלטשולר שחם')!;
  ok(alt.raw === null && alt.eff === null && /copy|העתק|זהים|same cells/.test(alt.why ?? ''), 'Altshuler women: the copied table leaves the price null, with why');
  const s = sortEff(rows, 'eff');
  const nn = s.filter((r) => r.eff != null).length;
  ok(nn >= 5 && s.slice(0, nn).every((r, i, a) => i === 0 || a[i - 1].eff! <= r.eff!) && s.slice(nn).every((r) => r.eff === null), 'sort by effective price ascending, nulls last');
  const inf = rows.find((r) => r.grp === 'אינפיניטי')!;
  ok(inf.s?.fast === 0 && inf.eff != null && inf.s?.approved != null && inf.s.approved > 0, 'Infinity: no survivors claim closed within 30 days, but approval is reported, so the effective price stands (speed is shown, not divided)');
  ok(sortEff(rows, 'raw', -1)[0].raw! >= sortEff(rows, 'raw', -1)[1].raw!, 'sort descending');
  const p = rawProv(cov, more.fund, more.cell!);
  ok(p.k === 'calc' && p.inputs.some((i) => /מקדם עלות נכות/.test(i.label)) && p.inputs.every((i) => !i.src || i.src().k === 'report'), 'raw price provenance: every table cell links to the bylaws page');
  const ep = effProv(cov, dec, more);
  ok(ep.k === 'calc' && ep.inputs.length === 6 && /לא דירוג/.test(ep.note ?? ''), 'effective price provenance: six inputs, states it is not a ranking');
  ok(cov.coverage.every((c) => c.status === 'table'), 'every comprehensive group has its bylaws tables');
}

console.log(`book: ${pass} passed, ${fail} failed`);
if (fail) { console.log(bad.map((b) => `  ✗ ${b}`).join('\n')); process.exit(1); }
