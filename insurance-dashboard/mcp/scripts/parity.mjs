// Parity with the site: each case calls a tool, opens the page its answer links to (on a local build or dev server of the site),
// and checks that the page shows the same figures, as text. Needs Chrome and Node's WebSocket:
//   node --experimental-websocket scripts/parity.mjs http://127.0.0.1:5243
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] ?? 'http://127.0.0.1:5243').replace(/\/$/, '');
const here = dirname(fileURLToPath(import.meta.url));
const probe = (tool, args) => JSON.parse(execFileSync(process.execPath, [join(here, '../dist/eval.mjs'), '--probe', tool, JSON.stringify(args), '--compact'], { encoding: 'utf8', maxBuffer: 64e6 }));
const local = (url) => base + url.replace('https://fox-research-il.web.app', '');

/** [name, route on the site, strings the page must show] — every string is a tool's `display` */
function cases() {
  const out = [];
  const f1 = probe('figure', { entity: 'harel', metric: 'st:net', period: "Q2'26" }).facts[0];
  out.push(['Report Day · הראל רווח נקי Q2\'26', f1.view, [f1.display]]);
  const ov = probe('company_overview', { company: 'migdal', period: "Q2'26" });
  const pick = (id) => ov.headline.find((f) => f.metric === id);
  out.push(['Report Day · מגדל שורות כותרת', ov.views.home, ['st:net', 'st:isr', 'st:eq', 'st:assets'].map(pick).filter(Boolean).map((f) => f.display)]);
  const roe = probe('figure', { entity: 'clal', metric: 'kpi:roe' }).facts[0];
  out.push(['KPI ledger · כלל ROE LTM', roe.view.replace(/&w=q$/, ''), [roe.display]]);
  const csm = probe('figure', { entity: 'harel', metric: 'csm', period: "Q2'26" }).facts[0];
  out.push(['Report Day · הראל CSM', `/company/harel?p=2026Q2`, [csm.display]]);
  const pt = probe('peer_table', { metric: 'ifrs:csm_new_business@life', peers: 'ins', period: "FY'25" });
  out.push(['Peer table · CSM עסק חדש חיים FY\'25 + חציון', pt.view, [...pt.rows.filter((r) => r.fact.value != null).map((r) => r.fact.display), pt.median.display]]);
  const isr = probe('peer_table', { metric: 'fs:ins_res', peers: 'big5', period: "Q2'26" });
  out.push(['Peer table · רווח משירותי ביטוח Q2\'26', isr.view, isr.rows.filter((r) => r.fact.value != null).map((r) => r.fact.display)]);
  const lens = probe('savings_lens', { group: 'הפניקס', segment: 'pen', quarter: "Q2'26" });
  const lf = (id) => lens.rows[0].facts.find((f) => f.metric === id);
  out.push(['Savings Lens · הפניקס פנסיה Q2\'26', lens.view, ['lens:aum_share', 'lens:flow_share', 'lens:fy_reg', 'lens:ci', 'lens:ppb'].map(lf).filter(Boolean).map((f) => f.display)]);
  const cal = probe('calendar', {});
  out.push(['Calendar · מועד צפוי', cal.view, cal.rows.slice(0, 6).map((r) => r.next_report.expected).filter(Boolean)]);
  const rs = probe('restatements', { company: 'ayalon', limit: 3 });
  out.push(['Restatements · איילון', rs.view, rs.rows.flatMap((r) => [r.first.display, r.restated.display])]);
  const as = probe('peer_table', { metric: 'mkt:assets@all', peers: 'big5', period: '08/26' }), sh = probe('peer_table', { metric: 'mkt:share@all', peers: 'big5', period: '08/26' });
  out.push(['Market · נכסים ונתח שוק 08/26', '/industry/savings?v=market&p=202608&t=all', [...as.rows, ...sh.rows].map((r) => r.fact.display)]);
  const tr = probe('peer_table', { metric: 'mkt:transfers@gemel', peers: 'big5', period: '08/26', window: 'q' });
  out.push(['Market · ניוד נטו QTD, גמל 08/26', '/industry/savings?v=market&p=202608&t=fam:gemel', tr.rows.filter((r) => r.fact.value != null).map((r) => r.fact.display)]);
  return out;
}

const port = 9900 + Math.floor(Math.random() * 90), prof = mkdtempSync(join(tmpdir(), 'par-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws = null;
for (let i = 0; i < 60 && !ws; i++) { try { const u = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; if (u) ws = new WebSocket(u); } catch { /* not up yet */ } if (!ws) await sleep(200); }
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

let ok = 0, n = 0;
const all = cases();
for (const [name, route, want] of all) {
  await send('Page.navigate', { url: local(route) });
  let text = '', miss = want;
  for (let t = 0; t < 20 && miss.length; t++) {
    await sleep(700);
    text = (await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })).result.result.value ?? '';
    const flat = text.replace(/[⁦-⁩‎‏]/g, '');
    miss = want.filter((s) => !flat.includes(s));
  }
  n++;
  if (!miss.length) ok++;
  console.log(`${miss.length ? '✗' : '✓'} ${name} · ${want.length} figures${miss.length ? ` · missing on the page: ${miss.join(' | ')}` : ''}\n    ${local(route)}`);
}
console.log(`\nparity: ${ok}/${n} pages show every figure the tools return`);
ws.close(); chrome.kill(); await sleep(400); rmSync(prof, { recursive: true, force: true });
process.exit(ok === n ? 0 : 1);
