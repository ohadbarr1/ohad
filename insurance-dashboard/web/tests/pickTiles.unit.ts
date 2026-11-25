/* C6 / C7 · the guided picker's steps and the similar chips (lib/pickTiles) on the real funds.json. Run: node scripts/pick-tiles-test.mjs */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trackLabels, trackColor, TILES, PRODS, capOf, companiesOf, labelOf, labelsOf, pushRecent, siblingWords, similarOf, tileOf, tracksOf, twinNote, a5Of, type PFund } from '../src/lib/pickTiles';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }

const file = JSON.parse(readFileSync(join(process.cwd(), 'public/data/funds.json'), 'utf8'));
const funds: PFund[] = file.funds;
const F = (k: string) => funds.find((f) => f.k === k)!;

// six tiles, all live: every tile's first product has open tracks
ok(TILES.length === 6, 'six product tiles');
for (const t of TILES) ok(tracksOf(funds, t.prods[0]).length > 0, `tile ${t.label}: tracks of ${t.prods[0]}`);
ok(tileOf(PRODS.pensia)?.id === 'pension' && tileOf(PRODS.hash)?.id === 'hash' && tileOf(PRODS.pol)?.id === 'managers' && tileOf(PRODS.pol, 'policy')?.id === 'policy', 'tileOf');

// step 2: the general track first, annuitants last
{
  const t = tracksOf(funds, PRODS.pensia);
  ok(t[0].track === 'כללי' && t[0].n === 5, `pension: first chip כללי with 5 tracks (${t[0].track} ${t[0].n})`);
  ok(t[t.length - 1].track === 'מקבלי קצבה', `pension: annuitants last (${t[t.length - 1].track})`);
  ok(t.slice(1, 4).map((x) => x.track).join() === 'עד 50,50-60,60 ומעלה', `pension: age tracks after כללי (${t.slice(1, 4).map((x) => x.track)})`);
}

// step 3: pension general, alphabetical, Harel's two funds told apart
{
  const c = companiesOf(funds, PRODS.pensia, 'כללי');
  ok(c.map((x) => x.label).join('|') === 'הראל · גילעד|הראל · מנוף|כלל|מגדל|מנורה', `pension general tiles A–Z (${c.map((x) => x.label).join('|')})`);
  ok(c.find((x) => x.k === 'p2102')?.a5 === 8.6, `Migdal 5Y net 8.6 (${c.find((x) => x.k === 'p2102')?.a5})`);
  ok(twinNote(c) === 'להראל שתי קרנות פנסיה. השם של הקרן שלך כתוב בדוח השנתי; ברוב המקרים זו הגדולה (גילעד).', `twin note (${twinNote(c)})`);
}
// gemel lehashkaa general: every company, alphabetical, no twin note
{
  const c = companiesOf(funds, PRODS.hash, 'כללי');
  const want = funds.filter((f) => f.prod === PRODS.hash && f.track === 'כללי' && !f.closed).length;
  ok(c.length === want && c.length >= 11, `gemel lehashkaa general: ${c.length} tiles`);
  const labs = c.map((x) => x.label);
  ok(labs.join() === [...labs].sort((a, b) => a.localeCompare(b, 'he')).join(), `gemel lehashkaa A–Z (${labs.join('|')})`);
  ok(labs.includes('מגדל') && labs.includes('מנורה') && labs.includes('אלטשולר'), 'short company names');
  ok(twinNote(c) === null, 'no twin note');
  ok(a5Of(F('g7936')) === 6.67 && a5Of(F('g7936'), 'gross') === F('g7936').a5, 'a5 on the basis');
}
// a company with several tracks in a category: distinct labels
{
  const cat = funds.filter((f) => f.prod === PRODS.pol && f.track === 'כללי' && !f.closed);
  const l = labelsOf(cat);
  const vals = [...l.values()];
  ok(new Set(vals).size === vals.length, `policies general: labels unique (${vals.join('|')})`);
  ok(labelOf(funds, F('p2177'), ' ') === 'הראל מנוף', `chip label "הראל מנוף" (${labelOf(funds, F('p2177'), ' ')})`);
}
// the house's other tracks
ok(siblingWords(funds, F('p2102')).startsWith('מניות, עד 50, 50-60, 60 ומעלה'), `siblings of Migdal general (${siblingWords(funds, F('p2102'))})`);

// the page's column labels and colours (private copy of pages/compare/tracks.ts)
ok(trackLabels([F('p2102'), F('p2172'), F('p2177')]).join('|') === 'מגדל|הראל גילעד|הראל מנוף', `trackLabels (${trackLabels([F('p2102'), F('p2172'), F('p2177')]).join('|')})`);
ok(trackLabels([F('p2102'), F('p2142')]).join('|') === 'מגדל כללי|מגדל מניות', `trackLabels across categories (${trackLabels([F('p2102'), F('p2142')]).join('|')})`);
ok(trackColor(0) === 'var(--s1)' && trackColor(2) === 'var(--s4)', 'trackColor order');

// caps
ok(capOf('saver') === 4 && capOf('agent') === 6 && capOf('pro') === 8 && capOf(null) === 4 && capOf('pro', 6) === 6, 'door caps 4/6/8, hard limit');

// similar chips: same category, not on screen, largest first; none across categories or at the cap
{
  const s = similarOf(funds, ['p2102', 'p2172', 'p2009'], 4).map((f) => f.k);
  ok(s.join() === 'p2002,p2177', `P3 saver: two chips at three of four (mockup v3) = כלל, הראל מנוף (${s})`);
  const s8 = similarOf(funds, ['p2102', 'p2172', 'p2009'], 8).map((f) => f.k);
  ok(s8.join() === 'p2002,p2177', `P3 Pro: כלל then הראל מנוף (${s8})`);
  ok(similarOf(funds, ['p2102', 'p2142'], 4).length === 0, 'X2 (different risk levels): no chips');
  ok(similarOf(funds, ['p2102', 'p2172', 'p2009', 'p2002'], 4).length === 0, 'at the cap: no chips');
  ok(similarOf(funds, [], 4).length === 0, 'no keys: no chips');
}

// recents
{
  let r: string[][] = [];
  r = pushRecent(r, ['a', 'b']); r = pushRecent(r, ['c', 'd']); r = pushRecent(r, ['b', 'a']); r = pushRecent(r, ['e', 'f']); r = pushRecent(r, ['g', 'h']);
  ok(r.length === 3 && r[0].join() === 'g,h' && r[2].join() === 'b,a', `recents: three, newest first, deduplicated (${JSON.stringify(r)})`);
  ok(pushRecent(r, ['x']).length === 3 && pushRecent(r, ['x'])[0].join() === 'g,h', 'a single track is not a comparison');
}

console.log(`pickTiles: ${pass} passed, ${fail} failed`);
if (fail) { for (const b of bad) console.log('  FAIL', b); process.exit(1); }
