// Phase-6 page budgets (spec p6 §14.7; lane P6-3, ticket Q2): the height of each lens of the peers board (/industry/peers) and the
// company overview (/company/harel), in screens, on the phone (iPhone 14 at 390 × 664, WebKit and Chromium) and at 1440 × 900 (Chromium).
// Fails (exit 1) when a hard-fail row is over its budget, or a page does not load, in any engine.
// What is measured (coordinator rule, as rollout-budgets.mjs and compare): the page CONTENT down to the bottom of the stamp line (#stamp),
// not the site-wide footer. A company lens with no stamp line (ניתוח, הון, יעדים) is measured to the bottom of the company's lens
// container (.co6), which ends before the footer; so is רבעונים, whose stamp line sits under its grid, above the ledger and the review
// that its budget includes ("with ledger and review"). The figure is (bottom + scrollY) / the viewport's height. Pro door.
// usage: npm run build && node scripts/p6-budgets.mjs [base url]   (no url: serves dist/ itself on a free port)
//        E2E_CHROME=0 uses Playwright's own Chromium (CI); otherwise the installed Chrome (channel "chrome") locally.
//        --json <file> writes the table.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium, devices, webkit } from 'playwright';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
let BASE = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--json')?.replace(/\/$/, '');

const B = '/industry/peers', C = '/company/harel';
/* Build review B1 (27.11.26) ruled on the two report-only rows: the charts lens's phone budget is 6.0 (seven real charts; the exports fold
   into one "⋯" per chart and the notes into two lines), 2.5 at 1440; the table lens keeps 4.5. Both are hard fails again (P1). */
const REPORT_PHONE = '';

/** [name, url, ready selector, budget phone, budget 1440, stamp selector (null = #stamp), { reportPhone, settle }] — spec §14.7 */
const PAGES = [
  ['board · לוח', B, '#board .sb-row', 2.3, 1.3],
  ['board · חברה', `${B}?lens=focus`, '#focus-list', 3.0, 1.6],
  ['board · גרפים (seven charts)', `${B}?lens=charts`, 'main svg, main canvas', 6.0, 2.5, null, { settle: 2000 }],
  ['board · טבלה', `${B}?lens=table`, 'main table', 4.5, 3.0],
  ['company · הרבעון', C, '#quarter-table tr[data-k]', 1.6, 1.3],
  ['company · שינויים', `${C}?cl=chg`, '[data-lens="chg"] li.chg', 3.0, 1.6],
  ['company · רבעונים (grid, ledger, review)', `${C}?cl=qs`, '[data-lens="qs"] table[data-kind="quarters"]', 5.0, 2.5, '.co6', { settle: 1500 }],
  ['company · ניתוח', `${C}?cl=an`, '#analysis', 4.0, 2.0, '.co6', { settle: 1500 }],
  ['company · הון (with sensitivities)', `${C}?cl=cap`, '#capital', 6.0, 3.0, '.co6', { settle: 1500 }],
  ['company · יעדים', `${C}?cl=tg`, '#targets-lens', 4.5, 2.5, '.co6', { settle: 1500 }],
];
const VIEWS = [
  ['webkit', 'phone', () => webkit.launch(), { ...devices['iPhone 14'], viewport: { width: 390, height: 664 } }],
  ['chromium', 'phone', () => (process.env.E2E_CHROME === '0' ? chromium.launch() : chromium.launch({ channel: 'chrome' })), { ...devices['iPhone 14'], viewport: { width: 390, height: 664 } }],
  ['chromium', '1440', () => (process.env.E2E_CHROME === '0' ? chromium.launch() : chromium.launch({ channel: 'chrome' })), { viewport: { width: 1440, height: 900 } }],
];

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
let server = null;
if (!BASE) {
  const port = await freePort();
  server = spawn(process.execPath, [new URL('./serve.mjs', import.meta.url).pathname, new URL('../dist', import.meta.url).pathname, String(port)], { stdio: 'ignore' });
  BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/')).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 200)); }
}

async function measure(browser, opts, [, url, ready, , , stamp, opt]) {
  const ctx = await browser.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('theme2', 'phoenix'); localStorage.setItem('fox:seen', JSON.stringify('2099-01-01')); localStorage.setItem('fox:door', JSON.stringify('pro')); } catch { /* blocked */ }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(opt?.settle ?? 700);
    const r = await page.evaluate((sel) => {
      const st = document.querySelector(sel ?? '#stamp'), main = document.querySelector('main');
      const to = st ?? main;
      return { h: (to.getBoundingClientRect().bottom + scrollY) / innerHeight, to: st ? (sel ?? 'stamp') : 'main', doc: document.documentElement.scrollHeight / innerHeight };
    }, stamp ?? null);
    return { ...r, errors };
  } catch (e) {
    return { h: Infinity, to: 'error', doc: NaN, errors: [...errors, String(e.message ?? e).split('\n')[0]] };
  } finally { await ctx.close(); }
}

const rows = [];
let bad = 0;
try {
  for (const [eng, vw, launch, opts] of VIEWS) {
    const browser = await launch();
    try {
      for (const p of PAGES) {
        let m = await measure(browser, opts, p);
        if (m.to === 'error') m = await measure(browser, opts, p);   // one retry on a load timeout (a busy machine), never on a height
        const budget = vw === 'phone' ? p[3] : p[4];
        const report = vw === 'phone' && p[6]?.reportPhone ? p[6].reportPhone : null;
        const over = !(m.h <= budget) || m.errors.length > 0;
        if (over && (!report || m.to === 'error' || m.errors.length)) bad++;
        rows.push({ engine: eng, view: vw, page: p[0], budget, reportOnly: !!report, screens: +m.h.toFixed(2), to: m.to, withFooter: +m.doc.toFixed(2), errors: m.errors, ok: !over });
        console.log(`${report ? `REPORT-ONLY (${over ? 'over' : 'within'}) ·` : over ? 'OVER' : 'ok  '} ${eng.padEnd(8)} ${vw.padEnd(5)} ${p[0].padEnd(42)} ${m.h.toFixed(2)} / ${budget} (to ${m.to}; with footer ${m.doc.toFixed(2)})${m.errors.length ? '  errors: ' + m.errors.join(' | ') : ''}`);
      }
    } finally { await browser.close(); }
  }
} finally { if (server) server.kill(); }
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
console.log(`\np6 budgets: ${rows.filter((r) => r.ok).length} within, ${bad} over (or failed to load) on hard-fail rows, ${rows.filter((r) => r.reportOnly).length} report-only; ${PAGES.length} lenses × ${VIEWS.length} views`);
if (REPORT_PHONE) console.log(`REPORT-ONLY rows: ${REPORT_PHONE}.`);
process.exit(bad ? 1 : 0);
