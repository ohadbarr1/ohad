// Rollout page budgets (rollout spec §18.7; ticket Q1): the height of each rollout page, in screens of 664 px (iPhone 14 at 390 × 664,
// the visible viewport under Safari's bars), in WebKit and Chromium. Fails (exit 1) when a page is over its budget in either engine.
// What is measured (coordinator rule, as on compare): the page CONTENT down to the bottom of the stamp line (#stamp), not the site-wide
// footer (the saver home's stamp line is its facts line, .dfacts). A screen with no stamp line (the empty /my, the fees entry and age
// step) is measured to the bottom of <main>,
// which ends before the footer. The figure is (bottom + scrollY) / 664.
// usage: npm run build && node scripts/rollout-budgets.mjs [base url]   (no url: serves dist/ itself on a free port)
//        E2E_CHROME=0 uses Playwright's own Chromium (CI); otherwise the installed Chrome (channel "chrome") locally.
//        --nofont also measures with the web font blocked (the fallback font), reported, not failed.  --json <file> writes the table.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium, devices, webkit } from 'playwright';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const NOFONT = args.includes('--nofont');
let BASE = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--json')?.replace(/\/$/, '');
const VH = 664;
const enc = encodeURIComponent;
const M3 = [{ k: 'p2102', added: '2026-11-01' }, { k: 'g880', added: '2026-11-01' }, { k: 'g8211', added: '2026-11-01' }];
const ONE = [{ k: 'p2102', added: '2026-11-01' }];
const S = `/funds/screen?prod=${enc('פנסיה מקיפה')}&track=${enc('כללי')}`;
const SH = `/funds/screen?prod=${enc('השתלמות')}&track=${enc('כללי')}`;
const CARD = '#month-grid tbody .mg-cell:not(.mg-skelcell), #long-per button, #lens-dec, #lens-pro';

/** [name, door, fox:mine, url, ready selector, budget × 664, the stamp line if not #stamp, { report: report-only row, hide: css to hide }] — §18.7 (saver unless noted); the hishtalmut screener from §10.5 */
const PAGES = [
  // TODO(build review B2, coordinator 26.11.26): REPORT-ONLY until the PM decides what to trim on the home; then either flip `report`
  // off (hard fail at 2.1) or set the new budget. Measured to the home's stamp line (.dfacts "נתוני 10/26 · תשואה ברוטו…"), without the
  // dismissible add-to-home-screen tip (.sv-a2hs, iPhone only).
  ['saver home', 'saver', ONE, '/', '#home-screen', 2.1, 'main .dfacts', { report: true, hide: '.sv-a2hs' }],
  ['card · 6 months', 'saver', null, '/funds/p2102', CARD, 1.5],
  ['card · 12 months', 'saver', null, '/funds/p2102?v=m12', CARD, 1.85],
  ['card · years', 'saver', null, '/funds/p2102?v=y', CARD, 1.25],
  ['card · long', 'saver', null, '/funds/p2102?v=long', CARD, 1.25],
  ['card · agent "להחלטה" (compact tiles, pack collapsed; coordinator 26.11.26: 2.0, was 1.6)', 'agent', null, '/funds/p2102?v=dec', CARD, 2.0],
  ['card · Pro "מקצועי" (sections closed)', 'pro', null, '/funds/p2102?v=pro', CARD, 2.2],
  ['screener · 5 tracks · five years', 'saver', M3, S, '#board .sb-row', 1.3],
  ['screener · 5 tracks · month', 'saver', M3, `${S}&per=m1`, '#board .sb-row', 1.3],
  ['screener · hishtalmut (20 tracks) · month (§10.5)', 'saver', M3, `${SH}&per=m1`, '#board .sb-row', 2.6],
  ['/my · 3 products', 'saver', M3, '/my', '[data-my]', 1.85],
  ['/my · empty', 'saver', null, '/my', '#my-pick', 1.15],
  ['hub · month', 'saver', M3, '/funds', '.hub-body #month-grid', 1.3],
  ['hub · leaders', 'saver', M3, '/funds?v=lead', '.hub-body #lead-0', 1.6],
  ['hub · changes', 'saver', M3, '/funds?v=chg', '.hub-body #spread', 1.1],
  ['fees · year', 'saver', ONE, '/funds/tools/fees', '#board .sb-row', 1.4],
  ['fees · age step', 'saver', ONE, '/funds/tools/fees?v=career', '#age-ask', 1.1],
  ['fees · entry', null, null, '/funds/tools/fees', '#fee-pick', 1.1],
  ['fees · hishtalmut (19 tracks)', 'saver', [{ k: 'g880', added: '2026-11-01' }], '/funds/tools/fees', '#board .sb-row', 3.2],
];

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
let server = null;
if (!BASE) {
  const port = await freePort();
  server = spawn(process.execPath, [new URL('./serve.mjs', import.meta.url).pathname, new URL('../dist', import.meta.url).pathname, String(port)], { stdio: 'ignore' });
  BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/')).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 200)); }
}

async function measure(browser, [name, door, mine, url, ready, , stamp, opt], nofont) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: VH }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  if (nofont) await ctx.route(/\.(woff2?|ttf|otf)(\?|$)|fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await ctx.addInitScript(([d, m]) => {
    try {
      if (sessionStorage.getItem('rb:init')) return;
      sessionStorage.setItem('rb:init', '1');
      localStorage.setItem('theme2', 'phoenix'); localStorage.setItem('fox:seen', JSON.stringify('2099-01-01'));
      if (d) localStorage.setItem('fox:door', JSON.stringify(d));
      if (m) localStorage.setItem('fox:mine', JSON.stringify(m));
    } catch { /* blocked */ }
  }, [door, mine]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready, { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    if (opt?.hide) { await page.addStyleTag({ content: `${opt.hide} { display: none !important; }` }); await page.waitForTimeout(200); }
    const r = await page.evaluate((sel) => {
      const st = sel ? document.querySelector(sel) : document.getElementById('stamp'), main = document.querySelector('main');
      const to = st ?? main;
      return { h: (to.getBoundingClientRect().bottom + scrollY) / 664, to: st ? (sel ?? 'stamp') : 'main', doc: document.documentElement.scrollHeight / 664 };
    }, stamp ?? null);
    return { ...r, errors };
  } catch (e) {
    return { h: Infinity, to: 'error', doc: NaN, errors: [...errors, String(e.message ?? e).split('\n')[0]] };
  } finally { await ctx.close(); }
}

const engines = [['webkit', () => webkit.launch()], ['chromium', () => (process.env.E2E_CHROME === '0' ? chromium.launch() : chromium.launch({ channel: 'chrome' }))]];
const rows = [];
let bad = 0;
try {
  for (const [eng, launch] of engines) {
    const browser = await launch();
    try {
      for (const p of PAGES) {
        let m = await measure(browser, p, false);
        if (m.to === 'error') m = await measure(browser, p, false);   // one retry on a load timeout (a busy machine), never on a height
        const f = NOFONT ? await measure(browser, p, true) : null;
        const report = !!p[7]?.report;
        const over = !(m.h <= p[5]) || m.errors.length > 0;
        if (over && !report) bad++;
        rows.push({ engine: eng, page: p[0], budget: p[5], reportOnly: report, screens: +m.h.toFixed(2), to: m.to, withFooter: +m.doc.toFixed(2), fallbackFont: f ? +f.h.toFixed(2) : null, errors: m.errors, ok: !over });
        console.log(`${report ? `REPORT-ONLY home budget: ${over ? 'over' : 'within'} ·` : over ? 'OVER' : 'ok  '} ${eng.padEnd(8)} ${p[0].padEnd(46)} ${m.h.toFixed(2)} / ${p[5]} (to ${m.to}; with footer ${m.doc.toFixed(2)}${f ? `; fallback font ${f.h.toFixed(2)}` : ''})${m.errors.length ? '  errors: ' + m.errors.join(' | ') : ''}`);
      }
    } finally { await browser.close(); }
  }
} finally { if (server) server.kill(); }
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
console.log(`\nrollout budgets: ${rows.filter((r) => r.ok).length} within, ${bad} over (or failed to load) on hard-fail rows, ${rows.filter((r) => r.reportOnly).length} report-only; ${PAGES.length} pages × ${engines.length} engines`);
process.exit(bad ? 1 : 0);
