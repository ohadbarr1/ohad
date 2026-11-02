/* W0 · the omnibox ranking (lib/searchOmni.ts), run in node: a fund typed by its regulator number ("1093") or the site's key ("p9757")
   is the first item listed (Enter opens it); a company + product query ("אלטשולר שחם פנסיה מקיפה") finds its tracks by every word, the
   general / age tracks first; and the old leads still hold (a screen code after a company). Hand-built pool, then a smoke run over
   web/public/data when it is there. Run: npm run test:search */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPool, canon, ordered, rank, type FundEnt } from '../src/lib/searchOmni';
import type { RegistryCompany } from '../src/lib/types';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }

const reg = [
  { id: 'altshuler', name_he: 'אלטשולר שחם', name_en: 'Altshuler Shaham', kind: 'investment_house' },
  { id: 'harel', name_he: 'הראל', name_en: 'Harel', kind: 'insurance_group' },
] as unknown as RegistryCompany[];
const funds: FundEnt[] = [
  ['אלטשולר שחם פנסיה מקיפה מניות', 'אלטשולר שחם', 'p9761', 'מניות'],
  ['אלטשולר שחם פנסיה מקיפה הלכה', 'אלטשולר שחם', 'p9762', 'הלכה'],
  ['אלטשולר שחם פנסיה מקיפה מסלול לבני 60 ומעלה', 'אלטשולר שחם', 'p9759', '60 ומעלה'],
  ['אלטשולר שחם פנסיה מקיפה משולב סחיר', 'אלטשולר שחם', 'p9763', 'משולב סחיר'],
  ['אלטשולר שחם פנסיה מקיפה מסלול לבני 50 ומטה', 'אלטשולר שחם', 'p9757', 'עד 50'],
  ['אלטשולר שחם פנסיה מקיפה מסלול לבני 50-60', 'אלטשולר שחם', 'p9758', '50-60'],
  ['אלטשולר שחם פנסיה מקיפה עוקב מדדי מניות', 'אלטשולר שחם', 'p9764', 'עוקב מדדי מניות'],
  ['אלטשולר שחם השתלמות כללי', 'אלטשולר שחם', 'g1093', 'כללי'],
  ['הראל גמל מסלול לגילאי 50 ומטה', 'הראל', 'g9744', 'עד 50'],
  ['מיטב גמל לבני 50 עד 60', 'מיטב', 'g103', '50-60'],
  ['הפניקס-אקסלנס אינווסט תיק מנוהל אג"ח 2', 'הפניקס', 'i103', 'אג"ח'],
  // W4: the index tracks, as the regulator spells them (s&p 500, S&P500, "עוקב S&P 500")
  ['הראל השתלמות - עוקב מדד s&p 500', 'הראל', 'g13502', 'עוקב מדד S&P 500'],
  ['הראל השתלמות כללי', 'הראל', 'g13500', 'כללי'],
  ['אלטשולר שחם השתלמות עוקב S&P 500', 'אלטשולר שחם', 'g14862', 'עוקב מדד S&P 500'],
  ['מיטב השתלמות עוקב מדד S&P500', 'מיטב', 'g13245', 'עוקב מדד S&P 500'],
  ['הראל פנסיה עוקב מדד s&p 500', 'הראל', 'p13415', 'עוקב מדד S&P 500'],
];
// a statement line and a question that carry the number, so the fund has to win on order, not on being alone
const rows: [string, string, string, number][] = [['harel', 'bs', 'יתרה 1093 לסוף התקופה', 0]];
const qs = [{ id: 'Q-214', q: 'מה האיזון האקטוארי 1093 בפנסיה?', cos: ['altshuler'] }];
const pool = buildPool(reg, ['אלטשולר שחם', 'הראל'], funds, rows, qs);
const list = (q: string) => ordered(rank(q, pool, (s) => s));

// 1. a fund number: that track first, as a fund, linking to its page
{
  const l = list('1093');
  ok(l[0]?.kind === 'קופה' && l[0].to === '/funds/g1093', `"1093": first item is fund g1093 (got ${l[0]?.kind} ${l[0]?.to})`);
  ok(l.some((x) => x.kind === 'שורה בדוח'), '"1093": the statement line is still listed, after the fund');
  const k = list('p9757');
  ok(k[0]?.to === '/funds/p9757' && k[0].kind === 'קופה', `"p9757": first item is fund p9757 (got ${k[0]?.to})`);
  const two = list('103');
  ok(two.slice(0, 2).map((x) => x.to).sort().join() === '/funds/g103,/funds/i103', '"103": both tracks with that number lead (gemel and insurance)');
  ok(!list('10930').some((x) => x.to === '/funds/g1093'), '"10930": no prefix match on a fund number');
  ok(!list('12').some((x) => x.kind === 'קופה'), '"12": too short to be a fund number');
}
// 2. company + product: every track that carries every word, the default (general / age) tracks first, and the tracks lead the list
{
  const l = list('אלטשולר שחם פנסיה מקיפה');
  const f = l.filter((x) => x.kind === 'קופה').map((x) => x.to);
  ok(l[0]?.kind === 'קופה', `"אלטשולר שחם פנסיה מקיפה": a track leads (got ${l[0]?.kind})`);
  ok(f.slice(0, 3).join() === '/funds/p9757,/funds/p9758,/funds/p9759', `age tracks first, youngest first (got ${f.slice(0, 3).join()})`);
  ok(f.includes('/funds/p9757'), 'the age-50-and-under track is found');
  ok(!f.includes('/funds/g1093'), 'a track missing a word (השתלמות, not פנסיה מקיפה) is not listed');
  ok(l.some((x) => x.kind === 'חברה' && x.to === '/company/altshuler'), 'the company is still listed');
  const full = list('אלטשולר שחם פנסיה מקיפה מסלול לבני 50 ומטה');
  ok(full[0]?.to === '/funds/p9757', `the full name: that track first (got ${full[0]?.to})`);
}
// 2b. W4 · S&P and passive synonyms (red team 02.11.26): "S&P" used to vanish (one-letter words and "&" are not indexed)
{
  ok(canon('S&P') === 'snp 500' && canon('s&p500') === 'snp 500' && canon('SP500') === 'snp 500' && canon('S & P 500') === 'snp 500' && canon('אס אנד פי') === 'snp 500', `canon: the spellings of S&P 500 meet (${canon('S&P')}, ${canon('SP500')}, ${canon('אס אנד פי')})`);
  ok(canon('מחקה S&P 500') === 'עוקב snp 500' && canon('מסלול פסיבי') === 'מסלול עוקב', 'canon: מחקה / פסיבי → עוקב');
  ok(canon('speed') === 'speed' && canon('spa 500') === 'spa 500', 'canon: other words untouched');
  const snp = (q: string) => list(q).filter((x) => x.kind === 'קופה').map((x) => x.to);
  const h = snp('השתלמות S&P');
  ok(h.length >= 3 && h.slice(0, 3).every((t) => ['/funds/g13502', '/funds/g14862', '/funds/g13245'].includes(t)) && !h.includes('/funds/g1093') && !h.includes('/funds/g13500'), `"השתלמות S&P": the S&P השתלמות tracks, no general track (got ${h.join()})`);
  const hr = list('הראל השתלמות S&P');
  ok(hr[0]?.to === '/funds/g13502', `"הראל השתלמות S&P": Harel's S&P השתלמות first (got ${hr[0]?.to})`);
  const m = snp('מחקה S&P 500');
  ok(m.length >= 4 && m.every((t) => ['/funds/g13502', '/funds/g14862', '/funds/g13245', '/funds/p13415'].includes(t)), `"מחקה S&P 500": the S&P tracks (got ${m.join()})`);
  for (const q of ['SP500', 'אס אנד פי', 's&p500', 'השתלמות sp500']) ok(snp(q).includes('/funds/g13502'), `"${q}" finds the S&P tracks`);
  ok(list('עוקב S&P').some((x) => x.to === '/funds/trackers') || snp('עוקב S&P').length > 0, '"עוקב S&P": tracks or the trackers lab');
}
// 3. the old leads: a company and a screen code; a company alone
{
  const l = list('הראל csm');
  ok(l[0]?.kind === 'פונקציה' && l[0].to === '/company/harel/ifrs17', `"הראל csm": the screen leads (got ${l[0]?.to})`);
  const c = list('הראל');
  ok(c[0]?.kind === 'חברה' && c[0].to === '/company/harel', `"הראל": the company leads (got ${c[0]?.to})`);
}
// 4. smoke over the published files: every fund number of funds.json finds its own track first
{
  const D = join(process.cwd(), 'public', 'data') + '/';
  if (existsSync(D + 'search/entities.json') && existsSync(D + 'companies/index.json')) {
    const ent = JSON.parse(readFileSync(D + 'search/entities.json', 'utf8')) as { groups: string[]; funds: FundEnt[] };
    const real = buildPool(JSON.parse(readFileSync(D + 'companies/index.json', 'utf8')), ent.groups, ent.funds, [], []);
    const withKey = ent.funds.filter((x) => x[2]);
    ok(withKey.length === ent.funds.length && withKey.length > 1000, `entities.json: every fund carries its key (${withKey.length} of ${ent.funds.length})`);
    let miss = 0;
    for (const [, , k] of withKey) { const l = ordered(rank(k!.length >= 4 ? k!.slice(1) : k!, real, (s) => s)); /* a 1-2 digit number by its key (i50) */ const n = l.findIndex((x) => x.to === `/funds/${k}`); if (n < 0 || n > 2 || l[0].kind !== 'קופה') miss++; }
    ok(miss === 0, `every fund number (3-6 digits; shorter ones by key) lists its track first (${miss} misses)`);
    const sh = ordered(rank('הראל השתלמות S&P', real, (s) => s));
    ok(sh[0]?.to === '/funds/g13502', `published data: "הראל השתלמות S&P" opens g13502 (got ${sh[0]?.to})`);
    const hs = ordered(rank('השתלמות S&P', real, (s) => s)).filter((x) => x.kind === 'קופה');
    ok(hs.length >= 3 && hs.every((x) => /s&p|S&P/i.test(x.label) && /השתלמות/.test(x.label)), `published data: "השתלמות S&P" lists S&P השתלמות tracks only (got ${hs.map((x) => x.label).join(' | ')})`);
    const mk = ordered(rank('מחקה S&P 500', real, (s) => s)).filter((x) => x.kind === 'קופה');
    ok(mk.length >= 3 && mk.every((x) => /s&p|S&P/i.test(x.label)), `published data: "מחקה S&P 500" finds S&P tracks (${mk.length})`);
    const alt = ordered(rank('אלטשולר שחם פנסיה מקיפה', real, (s) => s));
    ok(alt[0]?.to === '/funds/p9757', `published data: "אלטשולר שחם פנסיה מקיפה" opens p9757 (got ${alt[0]?.to})`);
  } else console.log('search: web/public/data absent, smoke run skipped');
}

console.log(`search: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  FAIL', b)); process.exit(1); }
