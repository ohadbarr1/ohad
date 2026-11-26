/* F5 · the picker's search (lib/pickSearch) on the real funds.json. Run: node scripts/pick-search-test.mjs */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pairHref, pairLabel, pickIndex, pickSearch, isOldGen } from '../src/lib/pickSearch';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }

const file = JSON.parse(readFileSync(join(process.cwd(), 'public/data/funds.json'), 'utf8'));
const idx = pickIndex(file.funds);
const top = (q: string, n = 5) => pickSearch(q, idx, { n }).hits.map((f) => `${f.k}`).join();

ok(idx.length > 1000, `index built (${idx.length} tracks)`);
// the spec's four fixtures
ok(pickSearch('קופת גמל להשקעה מגדל', idx).hits[0]?.k === 'g7936', `"קופת גמל להשקעה מגדל" → g7936 first (${top('קופת גמל להשקעה מגדל')})`);
{
  const r = pickSearch('מגדל', idx, { n: 8 });
  ok(r.hits.length === 8 && !isOldGen(r.hits[0].prod) && r.hits.every((f) => !isOldGen(f.prod)), `"מגדל": no old-generation policy in the first 8 (${top('מגדל', 8)})`);
  ok(r.hits[0].k === 'p2102', `"מגדל": the largest Migdal pension-general leads (${r.hits[0].k})`);
}
{
  const r = pickSearch('מגדל כללי מול הראל כללי', idx);
  ok(!!r.pair && r.pair.prod === 'פנסיה מקיפה' && r.pair.a.grp === 'מגדל' && r.pair.b.grp === 'הראל' && r.pair.a.track === 'כללי' && r.pair.b.track === 'כללי', `"מגדל כללי מול הראל כללי": one pension-general pair (${r.pair?.a.k},${r.pair?.b.k})`);
  ok(r.pair && pairHref(r.pair).split('=')[1].split(',').length === 2 && pairLabel(r.pair).startsWith('להשוואה: '), 'pair link has two keys, label starts "להשוואה: "');
}
{
  const r = pickSearch('מגדל פנסיה כללי מול מגדל מניות', idx);
  ok(r.pair?.a.k === 'p2102' && r.pair?.b.k === 'p2142', `"מגדל פנסיה כללי מול מגדל מניות" → p2102 + p2142 (${r.pair?.a.k},${r.pair?.b.k})`);
}
// order-free, stop-words, synonyms, numbers, keys
ok(pickSearch('מגדל גמל להשקעה', idx).hits[0]?.k === 'g7936' && pickSearch('גמל להשקעה של מגדל', idx).hits[0]?.k === 'g7936', 'word order and stop-words do not matter');
ok(pickSearch('p2142', idx).hits[0]?.k === 'p2142' && pickSearch('2142', idx).hits[0]?.k === 'p2142', 'a key or a number finds the track first');
ok(pickSearch('מגדל השתלמות', idx).hits.every((f) => f.prod === 'השתלמות') && pickSearch('מגדל השתלמות', idx).hits.length > 0, 'a named product filters');
ok(pickSearch('מגדל פנסיה', idx).hits[0]?.prod === 'פנסיה מקיפה', '"פנסיה": comprehensive before general');
ok(pickSearch('', idx).hits.length === 0 && pickSearch('מ', idx).hits.length === 0, 'empty / one letter: nothing');
// category context: typed words filter the current category first
{
  const r = pickSearch('מגדל', idx, { n: 5, cat: { prod: 'השתלמות', track: 'כללי' } });
  ok(r.hits[0]?.prod === 'השתלמות' && r.hits[0]?.track === 'כללי', `inside the current category first (${r.hits[0]?.k})`);
}
// closed tracks and old-generation policies never lead
{
  const r = pickSearch('הראל', idx, { n: 20 });
  const i = r.hits.findIndex((f) => f.closed || isOldGen(f.prod));
  ok(i < 0 || r.hits.slice(i).every((f) => f.closed || isOldGen(f.prod)), 'closed / old-generation tracks only at the tail');
}
// B1 polish: pensioner / special tracks rank after the mainstream ones unless named
{
  const r = pickSearch('מגדל', idx, { n: 8 });
  const first = r.hits.findIndex((f) => f.track === 'מקבלי קצבה');
  ok(first < 0 || r.hits.slice(0, first).every((f) => f.track !== 'מקבלי קצבה') && r.hits.some((f) => f.track === 'מניות'), `"מגדל": מניות before מקבלי קצבה (${r.hits.map((f) => f.track).join()})`);
  ok(r.hits.filter((f) => f.track === 'מקבלי קצבה').length < 3, '"מגדל": not a screen of מקבלי קצבה');
  const n = pickSearch('מגדל מקבלי קצבה', idx, { n: 5 });
  ok(n.hits.every((f) => f.track === 'מקבלי קצבה'), 'a query that names מקבלי קצבה gets them');
  ok(pickSearch('מגדל פנסיה', idx, { n: 4 }).hits.every((f) => f.track !== 'מקבלי קצבה'), '"מגדל פנסיה": mainstream first');
}
// B1 polish: company-name tolerance (matres lectionis + aliases); track words are never corrected
{
  const same = (a: string, b: string) => top(a, 8) === top(b, 8) && top(a, 8) !== '';
  ok(same('מיגדל', 'מגדל'), '"מיגדל" = "מגדל"');
  ok(same('מיגדל השתלמות', 'מגדל השתלמות'), '"מיגדל השתלמות" = "מגדל השתלמות"');
  ok(same('הפניכס', 'הפניקס') && same('הפיניקס', 'הפניקס'), 'הפניכס / הפיניקס → הפניקס');
  ok(same('אלטשלר', 'אלטשולר') && same('אלטשולר', 'אלטשולר שחם'), 'אלטשלר / אלטשולר → אלטשולר שחם');
  ok(pickSearch('מגדל כללי', idx).hits[0]?.track === 'כללי', '"כללי" is a track word, not company כלל');
  ok(pickSearch('כללי', idx).hits[0]?.track === 'כללי', '"כללי" alone still finds the general track');
  ok(pickSearch('מיגדל מול הראל', idx).hits.length > 0, '"מיגדל מול הראל" resolves both sides');
}
console.log(`pickSearch: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
