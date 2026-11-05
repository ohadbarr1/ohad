/* fox 3.0 phase 0, lane C (trust & measurement): lib/track (F2) sends nothing but a path or an event name, and nothing at all while
   ANALYTICS_CODE is empty; lib/contact (F3) shows nothing until the owner fills it; corrections.json meets its contract.
   Run: node scripts/trust-test.mjs (bundles this file with esbuild and runs it in node). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANALYTICS_CODE, endpoint, hitUrl, safePath, track } from '../src/lib/track';
import { CONTACT, DISCLOSURE, OWNER_NAME, contactHref, disclosure } from '../src/lib/contact';
import { contractOf, violations } from '../src/lib/schema';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }

/* ---- F2: what may leave the browser ---- */
ok(endpoint('') === null && endpoint('a b') === null && endpoint('x.evil.com/') === null, 'no endpoint without a plain site code');
ok(endpoint('fox') === 'https://fox.goatcounter.com/count', 'the GoatCounter endpoint of a site code');
ok(safePath('/funds/9757') === '/funds/9757', 'a fund id is kept');
ok(safePath('/company/harel/numbers/') === '/company/harel/numbers', 'trailing slash dropped');
ok(safePath('/my/123456789') === '/my/:x', 'a 9-digit value (an ID number) never leaves');
ok(safePath('/x/a%40b.co') === '/x/:x' && safePath('/x/a@b.co') === '/x/:x', 'an e-mail address never leaves');
ok(safePath(`/q/${'a'.repeat(41)}`) === '/q/:x', 'a long free-text segment never leaves');
ok(safePath('/') === '/' && safePath('') === '/', 'the root');
const u = new URL(hitUrl('https://fox.goatcounter.com/count', '/funds/9757', false));
ok([...u.searchParams.keys()].sort().join() === 'e,p,rnd', 'a hit carries only p, e and a cache breaker');
ok(u.searchParams.get('p') === '/funds/9757' && u.searchParams.get('e') === 'false', 'path and event flag as given');
// off by default: no code, and no window in node, so track() must not throw or send
ok(ANALYTICS_CODE === '' || /^[a-z0-9-]+$/i.test(ANALYTICS_CODE), 'ANALYTICS_CODE is empty or a plain site code');
let threw = false; try { track('xlsx_dl'); track('import_done'); } catch { threw = true; }
ok(!threw, 'track() is a silent no-op where it cannot send');
// the source of track.ts never reads page data: no query string, title, referrer, storage or cookie access
const src = readFileSync(join(process.cwd(), 'src', 'lib', 'track.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
for (const k of ['location.search', 'location.hash', 'document.title', 'document.referrer', 'localStorage', 'sessionStorage', 'document.cookie', 'screen.'])
  ok(!src.includes(k), `track.ts does not read ${k}`);

/* ---- F3: nothing shown until the owner fills it in ---- */
ok(disclosure('') === null && disclosure('  ') === null, 'no disclosure without a name');
ok(disclosure('ישראל ישראלי')!.startsWith('ישראל ישראלי עובד בענף הביטוח;') && !disclosure('א')!.includes('{name}'), 'the disclosure carries the name');
ok(DISCLOSURE.includes('בלי עמלות, בלי לידים ובלי פרסום') && DISCLOSURE.includes('הפניקס מכוסה כמו כל חברה אחרת'), 'the approved wording');
ok(contactHref('') === null && contactHref('a@b.co') === 'mailto:a@b.co' && contactHref('https://x.org/f') === 'https://x.org/f', 'the contact link');
ok(typeof OWNER_NAME === 'string' && typeof CONTACT === 'string', 'owner constants exist');

/* ---- the corrections log meets its contract ---- */
const corr = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'corrections.json'), 'utf8'));
ok(contractOf('corrections.json') === 'corrections', 'corrections.json has a contract');
ok(violations('corrections.json', corr, true).length === 0, 'corrections.json meets its contract');
const good = { id: 'c-1', date: '05.11.26', route: '/company/harel/numbers', field: 'CSM Q2\'26', before: '1', after: '2', note: 'עמוד שגוי', source: null };
ok(violations('corrections.json', { entries: [good] }, true).length === 0, 'a well-formed entry passes');
ok(violations('corrections.json', { entries: [{ ...good, date: '2026-11-05' }] }, true).length > 0, 'an ISO date (never on screen) fails');
ok(violations('corrections.json', { entries: [{ ...good, route: 'company' }] }, true).length > 0, 'a route must start with /');
ok(violations('corrections.json', { entries: [{ ...good, extra: 1 }] }, true).length > 0, 'no unknown keys');

if (fail) { console.error(`trust: ${pass} passed, ${fail} failed`); bad.forEach((b) => console.error('  FAIL', b)); process.exit(1); }
console.log(`trust: ${pass} passed, 0 failed`);
