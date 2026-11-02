/* W0 · the omnibox ranking (lib/searchOmni.ts), run in node: a fund typed by its regulator number ("1093") or the site's key ("p9757")
   is the first item listed (Enter opens it); a company + product query ("אלטשולר שחם פנסיה מקיפה") finds its tracks by every word, the
   general / age tracks first; and the old leads still hold (a screen code after a company). Hand-built pool, then a smoke run over
   web/public/data when it is there. Run: npm run test:search */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPool, canon, fundHits, fundIdx, ordered, rank, type FundEnt } from '../src/lib/searchOmni';
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
// 3b. W5 · red team 3: one matcher for the omnibox and the compare page; the product type is searchable; the fund number is shown
{
  const P: FundEnt[] = [
    ['אלטשולר שחם חיסכון פלוס כללי', 'אלטשולר שחם', 'g7798', 'כללי', 'גמל להשקעה'],
    ['אלטשולר שחם חיסכון פלוס מניות', 'אלטשולר שחם', 'g7799', 'מניות', 'גמל להשקעה'],
    ['אלטשולר שחם גמל כללי', 'אלטשולר שחם', 'g1020', 'כללי', 'גמל'],
    ['מיטב פנסיה מקיפה לבני 50 ומטה', 'מיטב', 'p2155', 'עד 50', 'פנסיה מקיפה'],
    ['אלטשולר שחם פנסיה מקיפה מסלול לבני 50 ומטה', 'אלטשולר שחם', 'p9757', 'עד 50', 'פנסיה מקיפה'],
  ];
  const pp = buildPool(reg, ['אלטשולר שחם'], P, [], []);
  const fl = (q: string) => ordered(rank(q, pp, (s) => s)).filter((x) => x.kind === 'קופה');
  const g = fl('אלטשולר גמל להשקעה');
  ok(g.length === 2 && g.every((x) => /חיסכון פלוס/.test(x.label)) && g[0].to === '/funds/g7798', `omnibox: "אלטשולר גמל להשקעה" finds the חיסכון פלוס tracks by product type, the general one first (got ${g.map((x) => x.to).join()})`);
  ok(fl('2155')[0]?.to === '/funds/p2155' && /מס' 2155/.test(fl('2155')[0].meta) && /פנסיה מקיפה/.test(fl('2155')[0].meta), `omnibox: the result shows the fund number and product (${fl('2155')[0]?.meta})`);
  ok(fl('פנסיה מקיפה עד 50').length === 2, 'omnibox: the track words are searchable too ("עד 50")');
  // the compare page's search runs the same matcher over funds.json rows
  const rows = P.map(([name, grp, k, track, prod], i) => ({ f: { k: k!, name, assets: 100 - i }, x: fundIdx(name, grp, k, track, prod) }));
  const h = (q: string) => fundHits(q, rows).map((x) => x.f.k);
  ok(h('2155').join() === 'p2155' && h('9757').join() === 'p9757', `compare: a fund number finds its track (2155 → ${h('2155').join()}, 9757 → ${h('9757').join()})`);
  ok(h('p9757').join() === 'p9757' && h('215').length === 0 && h('21550').length === 0, 'compare: the key works; no prefix match on a number');
  ok(h('אלטשולר גמל להשקעה').join() === 'g7798,g7799', `compare: product type, general track first (${h('אלטשולר גמל להשקעה').join()})`);
  ok(h('מיטב').join() === 'p2155' && h('ה').length === 0, 'compare: the company; one letter is not a search');
  ok(h('אלטשולר גמל').includes('g1020') && h('אלטשולר גמל').includes('g7798'), 'compare: "גמל" matches גמל and גמל להשקעה');
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
    ok(ent.funds.every((x) => typeof x[4] === 'string' && x[4].length > 1), 'W5: entities.json carries every fund\'s product type');
    const ag = ordered(rank('אלטשולר גמל להשקעה', real, (s) => s)).filter((x) => x.kind === 'קופה');
    ok(ag.length > 0 && ag.every((x) => /אלטשולר/.test(x.label) && /גמל להשקעה/.test(x.meta)), `W5 published data: "אלטשולר גמל להשקעה" finds Altshuler's גמל להשקעה tracks (${ag.map((x) => x.label).join(' | ')})`);
    for (const n of ['2155', '9757']) { const r = ordered(rank(n, real, (s) => s)); ok(r[0]?.kind === 'קופה' && r[0].to.endsWith(n) && r[0].meta.includes(`מס' ${n}`), `W5 published data: "${n}" opens its track and shows the number (${r[0]?.to} ${r[0]?.meta})`); }
    const fj = JSON.parse(readFileSync(D + 'funds.json', 'utf8')) as { funds: { k: string; name: string; grp: string; track: string; prod: string; assets: number | null }[] };
    const cmp = fj.funds.filter((f) => f.assets).map((f) => ({ f, x: fundIdx(f.name, f.grp, f.k, f.track, f.prod) }));
    for (const n of ['2155', '9757']) ok(fundHits(n, cmp).some((x) => x.f.k.slice(1) === n), `W5 published data: the compare search finds ${n}`);
    ok(fundHits('אלטשולר גמל להשקעה', cmp).length > 0, 'W5 published data: the compare search finds אלטשולר גמל להשקעה');
    const alt = ordered(rank('אלטשולר שחם פנסיה מקיפה', real, (s) => s));
    ok(alt[0]?.to === '/funds/p9757', `published data: "אלטשולר שחם פנסיה מקיפה" opens p9757 (got ${alt[0]?.to})`);
  } else console.log('search: web/public/data absent, smoke run skipped');
}

/* W4: in the saver and agent doors a fund comes before questions, and report pages drop out once a fund matched */
{
  const mk = (kind: Parameters<typeof ordered>[0][number]['kind'], score = 50) => ({ kind, label: kind, to: '/', score }) as Parameters<typeof ordered>[0][number];
  const list = [mk('מסמך'), mk('שאלה'), mk('קופה', 60), mk('שורה בדוח')];
  const pro = ordered(list).map((x) => x.kind), saver = ordered(list, true).map((x) => x.kind);
  ok(pro.includes('מסמך') && pro.includes('שורה בדוח'), 'pro keeps report pages');
  ok(saver.indexOf('קופה') < saver.indexOf('שאלה'), 'fund door: fund before question');
  ok(!saver.includes('מסמך') && !saver.includes('שורה בדוח'), 'fund door: report pages dropped when a fund matched');
}

console.log(`search: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  FAIL', b)); process.exit(1); }
