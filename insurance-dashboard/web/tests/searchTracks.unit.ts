/* C14 · the saver's search lists tracks before groups (lib/searchOmni tracksFirst). Run: node scripts/search-tracks-test.mjs */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tracksFirst, type Item } from '../src/lib/searchOmni';
import { pickIndex, pickSearch } from '../src/lib/pickSearch';

let fail = 0, pass = 0;
const bad: string[] = [];
const ok = (c: unknown, w: string) => { if (c) pass++; else { fail++; bad.push(w); } };
const idx = pickIndex(JSON.parse(readFileSync(join(process.cwd(), 'public/data/funds.json'), 'utf8')).funds);
const it = (kind: Item['kind'], to: string): Item => ({ kind, label: to, meta: '', to, score: 1 });

const list = [it('קופה', '/savings?g=x'), it('קופה', '/funds/i259012'), it('חברה', '/company/harel')];
const best = pickSearch('הראל', idx, { n: 6 }).hits;
const out = tracksFirst(list, best);
ok(out[0].to.startsWith('/funds/') && !out[0].to.startsWith('/funds/i2590'), 'the best-ranked track leads, not an old-generation policy');
ok(out.findIndex((x) => x.to === '/savings?g=x') > out.findIndex((x) => x.to === '/funds/i259012'), 'group after tracks');
ok(tracksFirst(list).map((x) => x.to).join() === '/funds/i259012,/savings?g=x,/company/harel', 'no best list: tracks still before groups');
console.log(`searchTracks: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
