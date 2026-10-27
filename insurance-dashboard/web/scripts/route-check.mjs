// Route check: every route rendered in headless Chrome at phone and desktop width; fails on what a reader must never see.
// usage: node --experimental-websocket scripts/route-check.mjs <base url, e.g. http://localhost:4173> [--json out.json] [--hash] [--only /feed,/card]
// Fails (exit 1) on: the page scrolling sideways at 390 px, an ISO date (2026-08-27) in the text, a route without its own title,
// a valid route landing on the not-found page. Reports, without failing: Latin runs of 3+ words, first-figure position, transfer size.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
// clean URLs; --hash for a build that still routes through the fragment
const BASE = (args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--only' && args[i - 1] !== '--json') ?? 'http://localhost:4173').replace(/\/$/, '') + (args.includes('--hash') ? '/#' : '');
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROUTES = [
  '/', '/companies', '/company/phoenix', '/company/phoenix/report', '/company/phoenix/review', '/company/phoenix/financials', '/company/phoenix/profit',
  '/company/phoenix/ifrs17', '/company/phoenix/savings', '/company/phoenix/filings', '/company/harel/financials', '/company/altshuler', '/company/altshuler/savings',
  '/industry/sectors', '/industry/lines', '/industry/csm', '/industry/csm?view=econ', '/industry/csm?view=sens', '/industry/csm?view=stress', '/industry/csm?view=stress&r=-100&eq=-20', '/industry/csm?view=capital', '/industry/csm?view=curve', '/industry/csm?view=facts', '/industry/ifrs', '/industry/capital', '/industry/econ', '/industry/savings', '/industry/headline',
  '/industry/search', '/industry/matrix', '/industry/peers', '/industry/peers?t=csm&v=series', '/industry/peers?t=reg&n=5', '/compare', '/funds', '/funds/makers', '/managers', '/market/overview', '/market/ranking', '/market/funds', '/valuation/phoenix', '/valuation/phoenix/ri', '/valuation/phoenix/csm', '/valuation/phoenix/dcf', '/valuation/phoenix/sotp', '/valuation/harel/sotp', '/valuation/hachshara', '/valuation/altshuler/sotp', '/calendar', '/book', '/search?q=%D7%A8%D7%9B%D7%99%D7%91%20%D7%94%D7%A4%D7%A1%D7%93', '/doc/1765739?page=32&q=%D7%93%D7%99%D7%91%D7%99%D7%93%D7%A0%D7%93', '/data', '/data?cite=%2Fcompany%2Fharel&f=CSM', '/restatements', '/restatements?season=2026Q2&min=2', '/presentations', '/credibility', '/credibility?co=phoenix&v=scored', '/mine', '/presentations?co=harel&q=%D7%AA%D7%A9%D7%95%D7%90%D7%94',
  // lane A2: fund houses, an unlisted insurer, the report and window carried between company views
  '/company/yelin', '/company/hachshara', '/company/altshuler/financials', '/company/phoenix?p=2025FY&w=ltm&row=st%3Anet', '/company/phoenix/review?p=2025Q3&w=ytd', '/company/phoenix/financials?p=2025Q3&w=ltm',
  // the advisory surface: the thesis is the company home, the report day moved to "numbers" (old deep links land there)
  '/company/phoenix/thesis', '/company/phoenix/numbers', '/company/phoenix/numbers?p=2025FY&w=ltm&row=st%3Anet', '/company/phoenix/report?p=2025Q3', '/company/more', '/company/more/numbers', '/company/more/review', '/company/idi', '/company/idi/numbers',
  '/scenarios', '/warroom', '/positions', '/fragility', '/capital',
  // lane AP: the report-day autopilot's status page
  '/data/autopilot',
  // lane DL: debt ladder (industry wall, a group with a capital-raising subsidiary, a fund house, a pinned date and view)
  '/debt', '/debt?k=fund', '/debt/phoenix', '/debt/meitav', '/debt/harel?d=2025-12-31&v=group&by=link',
  // lane FT: the fact table with the vintage toggle
  '/facts/harel', '/facts/clal?s=bs&vin=o', '/facts/phoenix?s=cf&w=FY&vin=2025-08-31',
  // lane OW: who owns whom
  '/ownership', '/ownership/harel', '/ownership/phoenix', '/ownership/yelin', '/ownership/infinity', '/ownership?cell=phoenix~harel',
  // lane AL: quarterly asset lists (index, a pension+gemel house, a participating portfolio, a blocked site, pinned views)
  '/holdings', '/holdings?m=ta35_pct&pair=altshuler~meitav', '/holdings/meitav', '/holdings/migdal?u=pct', '/holdings/altshuler?f=%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA', '/holdings/menora',
  // lane S2: report cards (an insurer quarter, an annual report, a fund house)
  '/card/harel/2026Q2', '/card/phoenix/2025FY', '/card/meitav/2026Q2',
  // module M2: the delta feed (all, one company, one type, the empty estimate slot)
  '/feed', '/feed?co=harel', '/feed?t=fee', '/feed?co=market&t=regmonth', '/feed?t=est',
  '/industry/savings?v=now', '/industry/savings?v=rank', '/industry/savings?v=market', '/industry/savings?s=ins', '/industry/savings?g=%D7%9E%D7%99%D7%98%D7%91&s=gem', '/funds/p2009', '/market/group/%D7%94%D7%A8%D7%90%D7%9C',
];
/** addresses that must land on the not-found page (with its title), not on an empty shell */
const MUST_404 = ['/company/zzz', '/company/zzz/financials', '/debt/zzz', '/facts/zzz', '/ownership/zzz', '/holdings/zzz', '/card/zzz/2026Q2'];
ROUTES.push(...MUST_404);
// --only <a,b>: just the routes that contain one of these strings (a module's own pages while it is built)
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
if (ONLY) ROUTES.splice(0, ROUTES.length, ...ROUTES.filter((r) => ONLY.some((o) => r.includes(o))));
const SIZES = [[390, 844, true], [1440, 900, false]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = `(() => {
  const de = document.documentElement, text = document.body.innerText;
  const iso = text.match(/\\b(19|20)\\d{2}-\\d{2}-\\d{2}\\b/g) || [];
  const latin = (text.match(/[A-Za-z][A-Za-z'’]+(?:,? +[A-Za-z][A-Za-z'’]+){2,}/g) || []).filter((s) => !/^(IFRS|CSM|LTM|YoY|QoQ|XBRL|MAYA|SCR|ROE|PNG|CSV)/.test(s));
  const numRe = /^[−\\-–+]?\\(?\\d[\\d,]*(\\.\\d+)?\\)?%?$/;
  let first = null; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const t = n.textContent.trim(); if (!t || t.length > 14 || !numRe.test(t)) continue; const el = n.parentElement;
    if (!el || el.closest('nav,select,option,.subnav,.seg,.chip,header,sup,.stdtabs')) continue; const r = el.getBoundingClientRect(); if (!r.width) continue;
    const top = r.top + scrollY; if (first == null || top < first) first = Math.round(top); }
  let kb = 0; for (const r of performance.getEntriesByType('resource')) kb += r.encodedBodySize || 0;
  return { scrollW: de.scrollWidth, vw: innerWidth, iso: [...new Set(iso)].slice(0, 5), isoN: iso.length, latin: [...new Set(latin)].slice(0, 4), latinN: latin.length,
    title: document.title, notFound: !!document.querySelector('.notfound'), first, kb: Math.round(kb / 1024) };
})()`;

async function run(width, height, phone) {
  const port = 9300 + Math.floor(Math.random() * 600), prof = mkdtempSync(join(tmpdir(), 'rc-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 150 && !wsUrl; i++)  // up to 30 s: a cold CI runner can take >12 s to start Chrome
  { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(200); }
  if (!wsUrl) throw new Error(`Chrome did not expose a debugging target on port ${port} within 30 s`);
  const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: phone ? 2 : 1, mobile: false });
  if (phone) await send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] });
  const out = [];
  for (const route of ROUTES) {
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: BASE + route });
    await sleep(phone ? 4500 : 4000);
    const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    out.push({ route, width, ...(r.result?.result?.value ?? { error: 'probe failed' }) });
  }
  ws.close(); chrome.kill(); await sleep(300); rmSync(prof, { recursive: true, force: true });
  return out;
}

const all = [];
for (const [w, h, phone] of SIZES) all.push(...(await run(w, h, phone)));
let fail = 0;
for (const r of all) {
  const errs = [];
  if (r.error) errs.push(r.error);
  if (r.width === 390 && r.scrollW > r.vw + 1) errs.push(`scrolls sideways (${r.scrollW} px wide)`);
  if (r.isoN) errs.push(`ISO dates ×${r.isoN}: ${r.iso.join(', ')}`);
  if (MUST_404.includes(r.route)) { if (!r.notFound || !r.title.startsWith('העמוד לא נמצא')) errs.push(`expected the not-found page, got title "${r.title}"`); }
  else {
    if (!r.title || r.title === 'fox' || r.title.startsWith('העמוד לא נמצא')) errs.push(`title "${r.title}"`);
    if (r.notFound) errs.push('not-found page');
  }
  if (errs.length) fail++;
  const warn = r.latinN ? ` · latin ×${r.latinN}: ${r.latin.join(' | ')}` : '';
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${String(r.width).padStart(4)} ${r.route.padEnd(30)} first ${String(r.first ?? '–').padStart(5)} px · ${String(r.kb).padStart(4)} KB${errs.length ? ' · ' + errs.join(' · ') : ''}${warn}`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(all, null, 1));
console.log(`\n${all.length - fail}/${all.length} route checks passed`);
process.exit(fail ? 1 : 0);
