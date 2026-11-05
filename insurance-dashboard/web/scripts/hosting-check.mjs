// Cache contract check (ws6 G4): firebase.json rules give the right status/Cache-Control per path, every file under dist/assets is
// content-hashed (the only files allowed `immutable`), and, with a server URL, the served responses agree.
// usage: node scripts/hosting-check.mjs [dist] [--serve http://127.0.0.1:4173]
// Rules: rewrite to /index.html for extensionless paths only (!**/*.*); no-cache on every HTML response; a missing file under
// /assets or /data is a real 404 (never the HTML shell with 200); immutable only on /assets (hashed names).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
// the static feeds (W8): never rewritten to the shell, served with their own media type
for (const [p, want] of [['/feed.xml', /application\/rss\+xml/], ['/feed/harel.xml', /application\/rss\+xml/], ['/feed/months.atom', /application\/atom\+xml/], ['/data/cal/reminders.ics', /text\/calendar/]])
  check(rewriteFor(H, p) === null && want.test(headersFor(H, p)['Content-Type'] ?? ''), `${p} not rewritten, Content-Type ${headersFor(H, p)['Content-Type'] ?? '(none)'}`);

// fox inside Excel (P4): the long tables are open to any origin (Power Query, notebooks) and short-lived; nothing else under /data is
for (const p of ['/data/tables/v1/kpi.csv', '/data/tables/v1/manifest.json', '/data/tables/v1/fox_powerquery.xlsx'])
  check(headersFor(H, p)['Access-Control-Allow-Origin'] === '*' && /max-age=300/.test(cc(p)) && rewriteFor(H, p) === null, `${p} CORS * and max-age=300`);
check(!headersFor(H, '/data/kpi.json')['Access-Control-Allow-Origin'], '/data/kpi.json keeps same-origin');

// D2 SEO: indexable by default; noindex only on the private / draft / utility routes and on the data files (lib/seo.ts mirrors the list)
const robots = (p) => headersFor(H, p)['X-Robots-Tag'] ?? '';
for (const [p, g, want] of [['/my', '/@(my|book)', true], ['/my/moment', '/@(my|book)', false], ['/clients/book', '/@(clients|brief)/**', true], ['/clientsx/a', '/@(clients|brief)/**', false]])
  check(globMatch(p, g) === want, `glob ${g} ${want ? 'matches' : 'does not match'} ${p}`);
for (const p of ['/', '/funds/p2009', '/funds/default', '/funds/tools/fees', '/company/harel', '/my/moment', '/my/moment/job', '/my/statement', '/my/checkup', '/questions', '/questions/Q-001',
  '/flows/letter/202609', '/savings', '/about', '/methodology', '/data', '/data/api', '/pro', '/sitemap.xml', '/robots.txt'])
  check(!/noindex/.test(robots(p)), `${p} indexable (X-Robots-Tag ${robots(p) || '(none)'})`);
for (const p of ['/my', '/clients', '/clients/book', '/clients/new', '/brief', '/brief/demo', '/book', '/feebook', '/search', '/data/autopilot', '/positions', '/positions/x1',
  '/consolidation', '/consolidation/menora/clal', '/fragility', '/doc/abc', '/nowcast'])
  check(/noindex/.test(robots(p)) && rewriteFor(H, p) === '/index.html', `${p} noindex: ${robots(p) || '(none)'}`);
for (const p of ['/data/kpi.json', '/data/funds/p2009.json', '/data/tables/v1/kpi.csv', '/data/feebook.json', '/data/nowcast.json'])
  check(/noindex/.test(robots(p)), `${p} (a data file) noindex: ${robots(p) || '(none)'}`);
check(H.cleanUrls === true, 'cleanUrls: /funds/p2009 is served from the prerendered funds/p2009.html');
check(rewriteFor(H, '/sitemap.xml') === null && /application\/xml/.test(headersFor(H, '/sitemap.xml')['Content-Type'] ?? ''), `/sitemap.xml not rewritten, Content-Type ${headersFor(H, '/sitemap.xml')['Content-Type'] ?? '(none)'}`);
check(rewriteFor(H, '/robots.txt') === null, '/robots.txt not rewritten');
// the sitemap lists only indexable addresses, each prerendered (or a section front)
if (existsSync(join(DIST, 'sitemap.xml'))) {
  const locs = [...readFileSync(join(DIST, 'sitemap.xml'), 'utf8').matchAll(/<loc>https:\/\/fox-research-il\.web\.app([^<]*)<\/loc>/g)].map((m) => m[1]);
  const priv = locs.filter((p) => /noindex/.test(robots(p)));
  const bare = locs.filter((p) => !['/', '/funds', '/funds/screen', '/managers', '/flows'].includes(p) && !existsSync(join(DIST, `${p.slice(1)}.html`)));
  check(locs.length > 0 && !priv.length && !bare.length, `sitemap: ${locs.length} URLs, none noindex${priv.length ? ` (${priv.slice(0, 3).join(', ')})` : ''}, each prerendered${bare.length ? ` (missing: ${bare.slice(0, 3).join(', ')})` : ''}`);
}

// immutable is only safe for content-hashed names
if (existsSync(join(DIST, 'assets'))) {
  const bad = readdirSync(join(DIST, 'assets')).filter((f) => !/-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(f));
  check(bad.length === 0, `every file in ${DIST}/assets is content-hashed${bad.length ? ': ' + bad.slice(0, 5).join(', ') : ''}`);
}

// the served site (scripts/serve.mjs, the emulator or the live host)
if (SERVE) {
  const idx = existsSync(join(DIST, 'assets')) ? readdirSync(join(DIST, 'assets')).find((f) => /^index-.*\.js$/.test(f)) : null;
  const probes = [['/', 200, /text\/html/, /no-cache/], ['/company/harel', 200, /text\/html/, /no-cache/], ['/data/autopilot', 200, /text\/html/, /no-cache/],
    ['/data/kpi.json', 200, /json/, /max-age=300/], ['/data/companies/nope.json', 404, null, null], ['/assets/index-OLDHASH.js', 404, null, null], ['/sw.js', 200, /javascript/, /no-cache/],
    ['/feed.xml', 200, /application\/rss\+xml/, /max-age=900/], ['/feed/months.atom', 200, /application\/atom\+xml/, /max-age=900/], ['/feed/nope.xml', 404, null, null], ['/feed', 200, /text\/html/, /no-cache/]];
  if (idx) probes.push([`/assets/${idx}`, 200, /javascript/, /immutable/]);
  probes.push(['/robots.txt', 200, /text\/plain/, null]);
  if (existsSync(join(DIST, 'sitemap.xml'))) probes.push(['/sitemap.xml', 200, /application\/xml/, /max-age=3600/]);
  for (const [p, status, type, cache] of probes) {
    const r = await fetch(SERVE.replace(/\/$/, '') + p, { redirect: 'manual' });
    const t = r.headers.get('content-type') ?? '', c = r.headers.get('cache-control') ?? '';
    check(r.status === status && (!type || type.test(t)) && (!cache || cache.test(c)), `GET ${p} -> ${r.status} ${t.split(';')[0]} · ${c || '(no cache-control)'}`);
  }
  // D2 SEO: a prerendered page is served at its clean address with its own head; its .html address redirects there; noindex where firebase.json says
  if (existsSync(join(DIST, 'funds/p2009.html'))) {
    const base = SERVE.replace(/\/$/, '');
    const r = await fetch(base + '/funds/p2009', { redirect: 'manual' }), html = await r.text();
    check(r.status === 200 && /no-cache/.test(r.headers.get('cache-control') ?? '') && html.includes('<meta name="fox:route" content="/funds/p2009"') && html.includes('<link rel="canonical" href="https://fox-research-il.web.app/funds/p2009"')
      && !/noindex/.test(r.headers.get('x-robots-tag') ?? ''), `GET /funds/p2009 -> ${r.status}, the prerendered head, indexable`);
    const h = await fetch(base + '/funds/p2009.html', { redirect: 'manual' });
    check(h.status === 301 && h.headers.get('location') === '/funds/p2009', `GET /funds/p2009.html -> ${h.status} ${h.headers.get('location') ?? ''}`);
    const s = await fetch(base + '/funds/p2009/financials', { redirect: 'manual' }), sh = await s.text();
    check(s.status === 200 && !sh.includes('fox:route'), `GET /funds/p2009/financials -> ${s.status}, the plain shell`);
  }
  for (const [p, want] of [['/my', true], ['/clients/book', true], ['/data/kpi.json', true], ['/company/harel', false], ['/', false]]) {
    const r = await fetch(SERVE.replace(/\/$/, '') + p, { redirect: 'manual' }), x = r.headers.get('x-robots-tag') ?? '';
    check(/noindex/.test(x) === want, `GET ${p} X-Robots-Tag ${x || '(none)'}`);
  }
}
console.log(fail ? `\n${fail} cache-contract check(s) failed` : '\ncache contract holds');
process.exit(fail ? 1 : 0);
