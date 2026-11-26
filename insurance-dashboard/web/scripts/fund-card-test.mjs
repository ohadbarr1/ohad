// Rollout L2-a (fund card): node test for the card's pure pieces in src/pages/fund/CardMonths.tsx. Run: node scripts/fund-card-test.mjs
// - cardFeeCost: the card's fee row prices a track with the SAME rule as /my (lane L2-c, MyProductRow myFeeCost): the reader's own fee
//   when typed or imported ("לפי הדוח שלך"), else the published fee; on the reader's amounts (useMyAmounts' FeeBase) or the example.
//   Checked on the live funds.json (10/26) against spec 18.6: p2102 ₪560 on the example, ₪1,170 on 420,000 / 3,100.
// - rankedCount: the type-month sheet's count (self-managed and old-generation tracks are not ranked).
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// bundled next to this script (not in the system temp dir) so the external packages resolve from the app's node_modules
const dir = mkdtempSync(new URL('./.fundcardtest-', import.meta.url).pathname), out = join(dir, 'card.mjs');
let M;
try {
  await build({ entryPoints: [new URL('../src/pages/fund/CardMonths.tsx', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
    jsx: 'automatic', loader: { '.css': 'empty' }, packages: 'external', define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' } });
  M = await import(pathToFileURL(out).href);
} finally { /* the bundle is imported; remove it at the end */ }

let pass = 0, fail = 0;
const ok = (name, c, info = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${c ? '' : '  · ' + JSON.stringify(info)}`); };
const data = JSON.parse(readFileSync(new URL('../public/data/funds.json', import.meta.url)));
const F = (k) => data.funds.find((f) => f.k === k);
const p2102 = F('p2102');

let r = M.cardFeeCost(p2102, null, null);
ok('p2102, example, published fee: ₪560 (18.6)', r.cost === 560 && !r.ownFee, r);
r = M.cardFeeCost(p2102, { fee: null, depfee: null }, { balance: 420000, monthly: 3100 });
ok('p2102 on 420,000 / 3,100: ₪1,170 (18.6)', r.cost === 1170 && !r.ownFee, r);
r = M.cardFeeCost(p2102, { fee: 0.1, depfee: 1 }, null);
ok('own fee 0.10% + 1% of the example deposit: 100 + 266.4 → ₪370, "לפי הדוח שלך"', r.cost === 370 && r.ownFee, r);
r = M.cardFeeCost(p2102, { fee: 0.1 }, null);
ok('own accumulation fee only: the published deposit fee stays', r.x.depfee === p2102.depfee && r.ownFee, r);
r = M.cardFeeCost({ prod: p2102.prod, fee: null, depfee: null }, null, null);
ok('no published fee: null', r.cost == null, r);
ok('OWN_FEE_TAG is /my\'s words', M.OWN_FEE_TAG === 'לפי הדוח שלך');

const type = (k) => data.funds.filter((f) => `${f.prod} | ${f.track}` === k && !f.closed && (f.assets ?? 0) > 0);
ok('pension general: 5 ranked', M.rankedCount(type('פנסיה מקיפה | כללי')) === 5, M.rankedCount(type('פנסיה מקיפה | כללי')));
const hish = type('השתלמות | כללי');
ok('hishtalmut general: self-managed tracks not counted', M.rankedCount(hish) === hish.filter((f) => !/בניהול אישי|\bIRA\b/.test(f.name)).length && M.rankedCount(hish) < hish.length, [M.rankedCount(hish), hish.length]);

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
