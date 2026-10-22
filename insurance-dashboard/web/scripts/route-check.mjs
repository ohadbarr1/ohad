// Route check: every route rendered in headless Chrome at phone and desktop width; fails on what a reader must never see.
// usage: node --experimental-websocket scripts/route-check.mjs <base url, e.g. http://localhost:4173> [--json out.json]
// Fails (exit 1) on: the page scrolling sideways at 390 px, an ISO date (2026-08-27) in the text, a route without its own title,
// a valid route landing on the not-found page. Reports, without failing: Latin runs of 3+ words, first-figure position, transfer size.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173').replace(/\/$/, '') + '/#';
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROUTES = [
  '/', '/companies', '/company/phoenix', '/company/phoenix/report', '/company/phoenix/review', '/company/phoenix/financials', '/company/phoenix/profit',
  '/company/phoenix/ifrs17', '/company/phoenix/savings', '/company/phoenix/filings', '/company/harel/financials', '/company/altshuler', '/company/altshuler/savings',
  '/industry/sectors', '/industry/lines', '/industry/csm', '/industry/ifrs', '/industry/capital', '/industry/econ', '/industry/savings', '/industry/headline',
  '/industry/search', '/industry/matrix', '/funds', '/funds/makers', '/managers', '/market/overview', '/market/ranking', '/market/funds', '/valuation/phoenix/dcf', '/valuation/phoenix/sotp',
];
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
  for (let i = 0; i < 60 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(200); }
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
  if (!r.title || r.title === 'fox' || r.title.startsWith('העמוד לא נמצא')) errs.push(`title "${r.title}"`);
  if (r.notFound) errs.push('not-found page');
  if (errs.length) fail++;
  const warn = r.latinN ? ` · latin ×${r.latinN}: ${r.latin.join(' | ')}` : '';
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${String(r.width).padStart(4)} ${r.route.padEnd(30)} first ${String(r.first ?? '–').padStart(5)} px · ${String(r.kb).padStart(4)} KB${errs.length ? ' · ' + errs.join(' · ') : ''}${warn}`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(all, null, 1));
console.log(`\n${all.length - fail}/${all.length} route checks passed`);
process.exit(fail ? 1 : 0);
