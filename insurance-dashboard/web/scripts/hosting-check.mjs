// Cache contract check (ws6 G4): firebase.json rules give the right status/Cache-Control per path, every file under dist/assets is
// content-hashed (the only files allowed `immutable`), and, with a server URL, the served responses agree.
// usage: node scripts/hosting-check.mjs [dist] [--serve http://127.0.0.1:4173]
// Rules: rewrite to /index.html for extensionless paths only (!**/*.*); no-cache on every HTML response; a missing file under
// /assets or /data is a real 404 (never the HTML shell with 200); immutable only on /assets (hashed names).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { globMatch, headersFor, loadHosting, rewriteFor } from './hosting.mjs';

const args = process.argv.slice(2);
const DIST = args.find((a) => !a.startsWith('--') && !/^https?:/.test(a)) ?? 'dist';
const SERVE = args.includes('--serve') ? args[args.indexOf('--serve') + 1] : null;
const H = loadHosting();
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const cc = (p) => headersFor(H, p)['Cache-Control'] ?? '(none)';

// the matcher itself: cases checked against minimatch 3/9 (what superstatic uses) when this was written
for (const [p, g, want] of [['/', '!**/*.*', true], ['/company/harel', '!**/*.*', true], ['/data/kpi.json', '!**/*.*', false], ['/a.b/c', '!**/*.*', true],
  ['/assets/x-1.js', '/assets/**', true], ['/data/autopilot', '/data/**/*.*', false], ['/data/companies/x.json', '/data/**/*.*', true], ['/index.html', '**/*.html', true],
  ['/sw.js', '/sw.js', true], ['/.well-known/x', '!**/*.*', true]]) check(globMatch(p, g) === want, `glob ${g} ${want ? 'matches' : 'does not match'} ${p}`);

// HTML: the shell for every app route, never cached without revalidation
for (const p of ['/', '/index.html', '/company/harel', '/company/harel/financials', '/data', '/data/autopilot', '/holdings/meitav', '/search'])
  check(/no-cache/.test(cc(p)) && (p.endsWith('.html') || p === '/' || rewriteFor(H, p) === '/index.html'), `${p} -> shell, Cache-Control ${cc(p)}`);
// files: no rewrite (a missing one is a 404), the right cache class
for (const p of ['/assets/index-OLDHASH.js', '/assets/x-AbCd1234.css', '/data/companies/nope.json', '/data/kpi.json', '/sw.js', '/manifest.webmanifest', '/nope.txt'])
  check(rewriteFor(H, p) === null, `${p} is not rewritten (missing -> 404)`);
check(/immutable/.test(cc('/assets/index-AbCd1234.js')), `/assets/* immutable: ${cc('/assets/index-AbCd1234.js')}`);
for (const p of ['/', '/company/harel', '/data/kpi.json', '/sw.js', '/index.html', '/manifest.webmanifest']) check(!/immutable/.test(cc(p)), `${p} not immutable`);
check(/max-age=300/.test(cc('/data/kpi.json')), `/data files short-lived: ${cc('/data/kpi.json')}`);
check(/no-cache/.test(cc('/sw.js')), `/sw.js no-cache`);
check(!!headersFor(H, '/company/harel')['Content-Security-Policy'], 'CSP on every path');

// immutable is only safe for content-hashed names
if (existsSync(join(DIST, 'assets'))) {
  const bad = readdirSync(join(DIST, 'assets')).filter((f) => !/-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(f));
  check(bad.length === 0, `every file in ${DIST}/assets is content-hashed${bad.length ? ': ' + bad.slice(0, 5).join(', ') : ''}`);
}

// the served site (scripts/serve.mjs, the emulator or the live host)
if (SERVE) {
  const idx = existsSync(join(DIST, 'assets')) ? readdirSync(join(DIST, 'assets')).find((f) => /^index-.*\.js$/.test(f)) : null;
  const probes = [['/', 200, /text\/html/, /no-cache/], ['/company/harel', 200, /text\/html/, /no-cache/], ['/data/autopilot', 200, /text\/html/, /no-cache/],
    ['/data/kpi.json', 200, /json/, /max-age=300/], ['/data/companies/nope.json', 404, null, null], ['/assets/index-OLDHASH.js', 404, null, null], ['/sw.js', 200, /javascript/, /no-cache/]];
  if (idx) probes.push([`/assets/${idx}`, 200, /javascript/, /immutable/]);
  for (const [p, status, type, cache] of probes) {
    const r = await fetch(SERVE.replace(/\/$/, '') + p, { redirect: 'manual' });
    const t = r.headers.get('content-type') ?? '', c = r.headers.get('cache-control') ?? '';
    check(r.status === status && (!type || type.test(t)) && (!cache || cache.test(c)), `GET ${p} -> ${r.status} ${t.split(';')[0]} · ${c || '(no cache-control)'}`);
  }
}
console.log(fail ? `\n${fail} cache-contract check(s) failed` : '\ncache contract holds');
process.exit(fail ? 1 : 0);
