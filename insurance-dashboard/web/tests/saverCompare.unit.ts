/* C12 · the saver's compare keys: the reader's own tracks, then the TWO LARGEST open tracks of the category by assets (O3).
   Real funds.json for the spec's case, plus synthetic edge cases. Run: node scripts/saver-compare-test.mjs */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PEERS_N, compareKeys } from '../src/lib/saverCompare';
import type { VFund } from '../src/lib/verdict';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }

const funds = JSON.parse(readFileSync(join(process.cwd(), 'public/data/funds.json'), 'utf8')).funds as VFund[];
ok(PEERS_N === 2, 'PEERS_N = 2 (O3)');
const k = compareKeys([{ k: 'p2102' }], funds).join();
ok(k === 'p2102,p2009,p2002', `mine = p2102 → p2102, p2009, p2002 (${k})`);
ok(compareKeys([{ k: 'p2102' }], funds, 2).join() === 'p2102,p2009', 'the tray cap trims the peers, never the own tracks first');
ok(compareKeys([{ k: 'g7936' }, { k: 'p2102' }], funds).join() === 'p2102,p2009,p2002', 'comprehensive pension leads the category');

const mk = (kk: string, assets: number | null, extra: Partial<VFund> = {}): VFund => ({ k: kk, name: kk, prod: 'פנסיה מקיפה', track: 'כללי', grp: kk, fee: 0.2, depfee: 1, assets, a5: 1, a3: 1, y12: 1, ...extra });
const cat = [mk('p1', 100), mk('p2', 500), mk('p3', 300), mk('p4', 900, { closed: true }), mk('p5', 0), mk('p6', 700, { name: 'x בניהול אישי' }), mk('p7', 400, { track: 'מניות' })];
ok(compareKeys([{ k: 'p1' }], cat).join() === 'p1,p2,p3', 'largest open: closed, zero-asset, self-directed and other tracks are out');
ok(compareKeys([{ k: 'p1' }, { k: 'p2' }], cat).join() === 'p1,p2,p3', 'own tracks of the category are not repeated as peers');
ok(compareKeys([], cat).length === 0 && compareKeys([{ k: 'nope' }], cat).length === 0, 'nothing saved: no keys');
console.log(`saverCompare: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
