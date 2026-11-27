import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { norm } from './compare-kit';

/* Phase 6 (spec p6 §14.6, §13.4, §9.6; lane P6-3, ticket Q1): the peers board /industry/peers and the company overview /company/:id,
   in the Pro door (and with no door where stated). Projects (playwright.config.ts): p6-webkit = iPhone 14 WebKit at 390 × 664,
   p6-chromium-1440 = 1440 × 900, p6-chromium-1280 = 1280 × 720.
   Data-period guard (§9.5, §14.6): each worker first opens the board and reads `window.__p6.status` (reportStatus('ins') as the page
   computed it). When bq = 2026Q3 and the reporters are exactly הפניקס, הראל, מגדל (the fixtures of 26–27.11.26) the NUMERIC assertions
   run; otherwise only the STRUCTURAL ones (ids, counts derived from the status, sentence shapes, value-equals-source, geometry). Spot
   multiples are numeric only while every price file closes on 2026-11-25. Harel's CSM is read from the peer file itself
   (public/data/peers/m/ifrs-csm_closing.json: P6-D restated 2025, so its YoY is computed from the file, never hard-coded).
   Page budgets are scripts/p6-budgets.mjs (content down to the stamp line); the first-screen rules are asserted here. */

/* ---------- the data the expectations come from ---------- */
const data = (p: string) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'));
type CsmRow = [string, number, ...unknown[]];
const CSM = data('peers/m/ifrs-csm_closing.json') as { e: Record<string, { c: CsmRow[] }> };
const csmAt = (e: string, q: string) => CSM.e[e]?.c.find((r) => r[0] === q)?.[1] ?? null;
const PRICED = ['phoenix', 'harel', 'migdal', 'clal', 'menora', 'ayalon'].map((e) => { try { return data(`companies/${e}.price.json`).asof as string; } catch { return null; } });
const PX = PRICED.every((a) => a === '2026-11-25');
const CHANGES = data('changes/harel.json') as { reports: { p: string; n: number }[] };

interface Status { bq: string; cq: string; reported: string[]; waiting: string[]; last: Record<string, string>; n: number }
const qlab = (q: string) => (q ? `Q${q.slice(5)}'${q.slice(2, 4)}` : '');
const qBack = (q: string, k = 1) => { let y = +q.slice(0, 4), n = +q.slice(5) - k; while (n < 1) { n += 4; y--; } return `${y}Q${n}`; };
const qEnd = (q: string) => `${['31.03', '30.06', '30.09', '31.12'][+q.slice(5) - 1]}.${q.slice(2, 4)}`;
const pct1 = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
const N = (v: number) => Math.round(v).toLocaleString('en-US');

let ST: Status | null = null;
let NUM = false;
/** the guard: once per worker, from the board itself */
async function guard(page: Page, info: TestInfo): Promise<Status> {
  if (ST) return ST;
  await page.goto('/industry/peers', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window as unknown as { __p6?: { status?: unknown } }).__p6?.status, null, { timeout: 30_000 });
  ST = await page.evaluate(() => (window as unknown as { __p6: { status: Status } }).__p6.status);
  NUM = ST.bq === '2026Q3' && ST.reported.join() === 'phoenix,harel,migdal';
  console.log(`[p6 guard · ${info.project.name}] bq=${ST.bq} cq=${ST.cq} reported=${ST.reported.join(',')} → ${NUM ? 'NUMERIC' : 'STRUCTURAL'} mode${NUM && !PX ? ' (prices moved: spot multiples structural)' : ''}`);
  return ST;
}

/* ---------- helpers ---------- */
const isPhone = (info: TestInfo) => info.project.name === 'p6-webkit';
/** the Pro door (as tests/routes.ts open()) */
async function pro(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem('theme2', 'phoenix'); localStorage.setItem('fox:seen', JSON.stringify('2099-01-01')); localStorage.setItem('fox:door', JSON.stringify('pro')); } catch { /* blocked */ } });
}
/** collects page errors */
function errorsOf(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}
async function go(page: Page, url: string, ready: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector(ready, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}
const BOARD = '#board .sb-row';
const COMPANY = '#quarter-table tr[data-k]';
const txt = async (page: Page, sel: string) => norm(await page.locator(sel).first().innerText());
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** the top of the phone's bottom bar (the viewport's bottom on a desktop, where the navigation is a rail) */
const barTop = (page: Page) => page.evaluate(() => {
  const n = Array.from(document.querySelectorAll('nav[aria-label="ראשי"]')).map((e) => e.getBoundingClientRect()).find((r) => r.height > 0 && r.top > innerHeight / 2 && r.width > innerWidth / 2);
  return n ? n.top : innerHeight;
});
/** every element of `sel` is inside the first screen (scroll 0, above the bottom bar) */
async function inFirst(page: Page, sel: string) {
  const bt = await barTop(page);
  return page.evaluate(([s, b]) => {
    const els = Array.from(document.querySelectorAll(s as string));
    if (!els.length || scrollY !== 0) return { ok: false, why: `${els.length} elements, scrollY ${scrollY}` };
    const bad = els.map((e) => e.getBoundingClientRect()).filter((r) => !(r.height > 0 && r.top >= 0 && r.bottom <= (b as number) + 0.5));
    return { ok: !bad.length, why: bad.map((r) => `${Math.round(r.top)}–${Math.round(r.bottom)} (bar ${Math.round(b as number)})`).join(', ') };
  }, [sel, bt] as const);
}

/** the numbers printed in the first screen (number tokens of the visible text of <main>, as the spec's density measure) */
const firstNumbers = (page: Page) => page.evaluate(() => {
  const w = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
  let n = 0, t: Node | null;
  while ((t = w.nextNode())) {
    const e = t.parentElement!, r = e.getBoundingClientRect();
    if (!r.width || r.top < 0 || r.bottom > innerHeight || getComputedStyle(e).visibility === 'hidden') continue;
    n += (t.textContent!.match(/\d[\d,.]*/g) ?? []).length;
  }
  return n;
});
/** the number in a figure's text as printed: sign, digits, separators and decimals ("−46.0%" → "−46.0", "2.36*" → "2.36") */
const core = (s: string) => {
  const m = norm(s).replace(/[−–-](?=\d)/g, '−').match(/[−+]?\d[\d,]*(?:\.\d+)?/);
  return m ? m[0] : norm(s);
};
interface Opened { tap: string; head: string; body: string; parts: number }
/** taps a figure, reads the source sheet it opened (headline value, the body), closes it */
async function openSrc(page: Page, el: Locator): Promise<Opened> {
  await el.scrollIntoViewIfNeeded({ timeout: 10_000 });
  const tap = norm(await el.innerText());
  await el.click();
  const sh = page.locator('.srcsheet');
  await expect(sh, `no source sheet opened for "${tap}"`).toBeVisible({ timeout: 5_000 });
  const head = norm(await sh.locator('.srchead .mval').innerText());
  const body = norm(await sh.innerText());
  const parts = await sh.locator('.srcfacts, .srcformula, .srcin').count();
  await sh.locator('.srcbar button.x').click();
  await expect(sh).toHaveCount(0);
  return { tap, head, body, parts };
}
/* Known offenders (investigated, reported to the coordinator 27.11.26, as tests/a11y-known.json): a source whose headline prints the same
   figure with a different precision. They do not fail the run; anything new does. Matched by where, tapped text and headline. */
// P1 (27.11.26): the matrix's solvency (lib/peerBoard sameText) and the ranked changes (lib/changes figText) now head with the cell's own text
const KNOWN_SRC: { where: RegExp; tap: RegExp; head: RegExp; why: string }[] = [];
/** a figure opens a source whose headline is the tapped text, and the source names a document, a formula or components */
async function checkSrc(page: Page, el: Locator, where: string, info: TestInfo): Promise<Opened> {
  const o = await openSrc(page, el);
  const k = KNOWN_SRC.find((x) => x.where.test(where) && x.tap.test(core(o.tap)) && x.head.test(core(o.head)));
  if (k && core(o.head).replace(/\.0$/, '') === core(o.tap)) info.annotations.push({ type: 'known', description: `${where}: "${o.tap}" opens "${o.head}": ${k.why}` });
  else expect(core(o.head), `${where}: tapped "${o.tap}", the source's headline is "${o.head}"`).toBe(core(o.tap));
  expect(o.parts, `${where}: the source of "${o.tap}" has no document, formula or components`).toBeGreaterThan(0);
  return o;
}
/** taps up to `n` figures of a container, spread over it */
async function sample(page: Page, sel: string, n: number, where: string, info: TestInfo) {
  const all = page.locator(sel).filter({ visible: true });
  const c = await all.count();
  expect(c, `${where}: no figure opens a source (${sel})`).toBeGreaterThan(0);
  const idx = c <= n ? [...Array(c).keys()] : [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * (c - 1)) / (n - 1))))];
  const out: Opened[] = [];
  for (const i of idx) out.push(await checkSrc(page, all.nth(i), `${where}#${i}`, info));
  return out;
}

/** the words gate (§14.6, G3, N6, N9): never "אשתקד", "undefined", "NaN", "%%"; no ".0" on a million */
async function wordsGate(page: Page, where: string) {
  const t = await page.evaluate(() => [document.querySelector('main'), ...Array.from(document.querySelectorAll('[role=dialog]'))].filter(Boolean).map((e) => (e as HTMLElement).innerText).join('\n'));
  for (const bad of ['אשתקד', 'undefined', 'NaN', '%%']) expect(t.includes(bad), `${where}: "${bad}" on the page`).toBe(false);
  const m = t.match(/.{0,20}\d\.0 (?:מיליוני|מ׳ ש|מיליון ש).{0,10}|.{0,20}\d\.0 →.{0,10}/g) ?? [];
  expect(m, `${where}: ".0" on millions`).toEqual([]);
}
/** a phone target's hit area (N5: a standalone number ≥ 44 × 32, a grid cell ≥ 43.5 wide, a number in prose 32 tall): the box, widened by
 *  an absolutely placed ::after that extends it (the median cells' 44 px hit area) */
const smallOf = (page: Page, sel: string, minW = 44, minH = 32) => page.evaluate(([s, w, h]) => Array.from(document.querySelectorAll<HTMLElement>(s as string))
  .map((e) => {
    const r = e.getBoundingClientRect(), a = getComputedStyle(e, '::after');
    let W = r.width, H = r.height;
    if (a.content !== 'none' && a.position === 'absolute') { W = Math.max(W, r.width - (parseFloat(a.left) || 0) - (parseFloat(a.right) || 0)); H = Math.max(H, r.height - (parseFloat(a.top) || 0) - (parseFloat(a.bottom) || 0)); }
    return { t: e.innerText.trim().slice(0, 20), W, H, vis: r.width > 0 && r.height > 0 };
  })
  .filter(({ W, H, vis }) => vis && (W < (w as number) - 0.5 || H < (h as number) - 0.5))
  .map(({ t, W, H }) => `${t} ${Math.round(W)}×${Math.round(H)}`), [sel, minW, minH] as const);

/* ---------- a small xlsx reader (zip: stored or deflated) ---------- */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
    out.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nl + xl + cl;
  }
  return out;
}
interface Book { sheets: string[]; xml: Map<string, string>; formulas: string[]; noValue: string[]; links: number; numeric: number }
function readBook(buf: Buffer): Book {
  const z = unzip(buf);
  const wb = z.get('xl/workbook.xml') ?? '';
  const sheets = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const xml = new Map([...z].filter(([k]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)));
  const formulas: string[] = [], noValue: string[] = [];
  let links = 0, numeric = 0;
  for (const [k, s] of xml) {
    for (const c of s.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const inner = c[2] ?? '';
      const f = /<f>([\s\S]*?)<\/f>/.exec(inner)?.[1];
      if (/<v>[^<]*<\/v>/.test(inner) && !/t="(s|str|inlineStr)"/.test(c[1])) numeric++;
      if (f == null) continue;
      formulas.push(f);
      if (/HYPERLINK/.test(f)) links++;
      if (!/<v>[^<]*<\/v>/.test(inner)) noValue.push(`${k}:${/r="([A-Z]+\d+)"/.exec(c[1])?.[1]} =${f.slice(0, 40)}`);
    }
  }
  return { sheets, xml, formulas, noValue, links, numeric };
}
async function download(page: Page, button: Locator, timeout = 60_000) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), button.click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), buf: readFileSync(path!) };
}

/* every test but the no-door one runs in the Pro door; the guard is read once per worker */
test.beforeEach(async ({ page }, info) => {
  if (/^T-N2 /.test(info.title)) return;
  await pro(page);
  await guard(page, info);
});

/* ====================================================== the board ====================================================== */

test('T-P1 · board: sentence, ranked board, median with n, guard line and its switch in the first screen', async ({ page }, info) => {
  const errors = errorsOf(page);
  const st = ST!;
  await go(page, '/industry/peers', BOARD);
  await expect(page.locator('#board')).toHaveAttribute('data-metric', 'pbc');
  await expect(page.locator('#board')).toHaveAttribute('data-reading', 'now');
  const ranked = page.locator('#board .sb-row:not(.out)');
  const rows = await ranked.count();
  expect(rows, 'one board row per company of the set').toBe(st.n);
  // the median with its n: "חציון 1.50x · 6 חברות"; n = the companies with a figure
  const valued = await page.locator('#board .sb-row .p6-sb-val button.src').count();
  const med = await txt(page, '#board-median');
  expect(med).toMatch(new RegExp(`^חציון \\S+ · ${valued} חברות$`));
  await expect(page.locator('#takeaway sup.p6-n')).toHaveText(String(valued));
  // the partial-quarter line names the count and offers "all on the last common quarter"
  if (st.waiting.length) {
    const g = await txt(page, '#guard');
    expect(g).toContain(`${st.reported.length} מתוך ${st.n}`);
    expect(g).toContain(`דיווחו ${qlab(st.bq)}`);
    expect(g).toContain(`הכול על ${qlab(st.cq)} ›`);
  }
  if (isPhone(info)) {
    for (const s of ['#takeaway', '#board-median', BOARD]) { const r = await inFirst(page, s); expect(r.ok, `phone: ${s} not inside the first screen: ${r.why}`).toBe(true); }
  } else {
    for (const s of ['#takeaway', '#matrix', BOARD]) { const r = await inFirst(page, s); expect(r.ok, `desktop: ${s} not inside the first screen: ${r.why}`).toBe(true); }
    // the top of the quarters grid, and (spec 14.7) six grid rows at 1440 and at 1280 × 720
    const r6 = await inFirst(page, '#quarter-grid tbody tr');
    expect(r6.ok, `desktop: the six grid rows are not in the first screen: ${r6.why}`).toBe(true);
    const mx = await page.evaluate(() => { const t = document.getElementById('matrix')!; const s = t.closest('.scroll, .p6-mx, section') as HTMLElement; return { t: t.scrollWidth - t.clientWidth, s: s ? s.scrollWidth - s.clientWidth : 0, w: t.getBoundingClientRect().right <= innerWidth + 0.5 }; });
    expect(mx.s <= 1 && mx.w, `the matrix scrolls sideways (${JSON.stringify(mx)})`).toBe(true);
    // ≥ 200 numbers in the first screen at 1440 (14.7; v3 206, today 88)
    if (info.project.name === 'p6-chromium-1440') expect(await firstNumbers(page), 'numbers in the first screen at 1440').toBeGreaterThanOrEqual(200);
  }
  if (NUM && PX) {
    const s = await txt(page, '#takeaway');
    for (const w of ['מגדל', '0.85x', '2.15x', '1.50x']) expect(s).toContain(w);
    await expect(ranked.first()).toHaveAttribute('data-k', 'migdal');
    expect(med).toBe('חציון 1.50x · 6 חברות');
  }
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await wordsGate(page, 'board');
  expect(errors).toEqual([]);
});

test('T-P3 · the guard switches the whole board to the last common quarter and back', async ({ page }) => {
  const st = ST!;
  test.skip(!st.waiting.length, 'every company has reported the latest quarter: no partial-quarter line');
  await go(page, '/industry/peers?bm=csm&rd=qoq', BOARD);
  expect(await page.locator('#board .sb-row.out').count()).toBe(st.waiting.length);
  await page.locator('#guard').click();
  await expect(page).toHaveURL(/[?&]base=common/);
  await page.waitForTimeout(400);
  await expect(page.locator('#board .sb-row.out')).toHaveCount(0);
  expect(await txt(page, '#guard')).toContain(qlab(st.cq));
  expect(await txt(page, '#basis')).toContain(`${qlab(st.cq)} מול ${qlab(qBack(st.cq))}`);
  await page.locator('#guard').click();
  await expect(page).not.toHaveURL(/base=common/);
  await expect(page.locator('#board .sb-row.out')).toHaveCount(st.waiting.length);
});

test('T-P2, T-F8 · partial-quarter rule: quarter-named readings rank reporters only; levels carry, star and count', async ({ page }, info) => {
  const st = ST!;
  await go(page, '/industry/peers', BOARD);
  // two taps: the CSM chip, then QoQ
  await page.locator('#metric-chips [data-m="csm"]').click();
  await expect(page.locator('#board')).toHaveAttribute('data-metric', 'csm');
  await page.locator('#period-seg [data-r="qoq"]').click();
  await expect(page).toHaveURL(/bm=csm/);
  await expect(page).toHaveURL(/rd=qoq/);
  await expect(page.locator('#board')).toHaveAttribute('data-reading', 'qoq');
  const ranked = await page.locator('#board .sb-row:not(.out)').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-k')!));
  const out = await page.locator('#board .sb-row.out').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-k')!));
  expect([...ranked].sort(), 'QoQ of the quarter ranks the reporters only').toEqual([...st.reported].sort());
  expect([...out].sort(), 'the others are listed outside the ranking').toEqual([...st.waiting].sort());
  if (out.length) expect(await txt(page, '#board .p6-sb-sub')).toContain(`הדוח ל-${qlab(st.bq)} טרם פורסם`);
  for (const e of out) expect(await txt(page, `#board .sb-row.out[data-k="${e}"]`)).toContain(`${qlab(st.last[e])} · טרם דיווחה`);
  // the basis line, the median's n = the reporters, the grid of the same reading
  expect(await txt(page, '#basis')).toContain(`${qlab(st.bq)} מול ${qlab(qBack(st.bq))}`);
  expect(await txt(page, '#board-median')).toContain(`${st.reported.length} שדיווחו ${qlab(st.bq)}`);
  const grid = page.locator('#quarter-grid');
  await expect(grid).toHaveAttribute('data-kind', 'quarters');
  await expect(grid).toHaveAttribute('data-reading', 'qoq');
  await expect(grid.locator('tbody tr')).toHaveCount(6);
  const n = await page.locator(`[data-q="${st.bq}"][data-n]`).first().getAttribute('data-n');
  expect(Number(n), `the ${qlab(st.bq)} median of a quarter-named reading stands on the reporters`).toBe(st.reported.length);
  // carried cells are never shown under a quarter-named reading
  expect(await grid.locator(`td.car[data-q="${st.bq}"]`).count()).toBe(0);
  if (NUM) {
    const s = await txt(page, '#takeaway');
    expect(s).toMatch(/^CSM QoQ/);
    for (const w of ['הפניקס', '+7.1%', '+3.5%']) expect(s).toContain(w);
    const h = csmAt('harel', st.bq)!, hq = csmAt('harel', qBack(st.bq))!;
    expect(await txt(page, '#board .sb-row[data-k="harel"] .p6-sb-val')).toBe(pct1((h / hq - 1) * 100));
  }
  // the level: carried, starred and counted (13.2 rule 1): no row outside, the median on every company with a figure
  await page.locator(`#period-seg [data-r="q"]`).click();
  await expect(page.locator('#board')).toHaveAttribute('data-reading', 'q');
  await expect(page.locator('#board .sb-row.out')).toHaveCount(0);
  const withV = await page.locator('#board .sb-row .p6-sb-val button.src').count();
  expect(await txt(page, '#board-median')).toContain(`· ${withV} חברות`);
  const nl = await page.locator(`[data-q="${st.bq}"][data-n]`).first().getAttribute('data-n');
  expect(Number(nl), 'the level\'s median counts the carried companies').toBe(withV);
  if (st.waiting.length) expect(await grid.locator(`td.car[data-q="${st.bq}"]`).count(), 'carried cells are starred').toBeGreaterThan(0);
  if (NUM) expect(withV).toBe(7);
  await wordsGate(page, 'board csm');
  if (info.project.name !== 'p6-webkit') expect(await sideways(page)).toBeLessThanOrEqual(1);
});

test('T-F2 · basis lines: QoQ, YoY of a balance, LTM YoY of a flow, margins in points', async ({ page }) => {
  const st = ST!;
  const q = st.bq;
  await go(page, '/industry/peers?bm=np&rd=ltmy', BOARD);
  expect(await txt(page, '#basis')).toContain(`LTM ${qlab(q)} מול LTM ${qlab(qBack(q, 4))}`);
  expect(await txt(page, '#takeaway')).toContain(`LTM ${qlab(q)} מול LTM ${qlab(qBack(q, 4))}`);
  // LTM-based changes carry (13.2 rule 1): every company is ranked
  await expect(page.locator('#board .sb-row.out')).toHaveCount(0);
  if (NUM) expect(await txt(page, '#board .sb-row[data-k="phoenix"] .p6-sb-val')).toBe('−1.7%');
  await go(page, '/industry/peers?bm=csm&rd=yoy', BOARD);
  expect(await txt(page, '#basis')).toContain(`${qlab(q)} מול ${qlab(qBack(q, 4))}`);
  if (NUM) {
    // Harel's CSM YoY from the peer file (P6-D restated the 2025 comparatives: 16,983 → +5.4%; the first print 17,133 gave +4.4%)
    const h = csmAt('harel', q)!, y = csmAt('harel', qBack(q, 4))!;
    expect(await txt(page, '#board .sb-row[data-k="harel"] .p6-sb-val')).toBe(pct1((h / y - 1) * 100));
  }
  await go(page, '/industry/peers?bm=isrm&rd=qoq', BOARD);
  expect(await txt(page, '#takeaway')).toMatch(/^מרווח ביטוח QoQ|^מרווח שירותי ביטוח QoQ/);
  const vals = await page.locator('#board .p6-sb-val button.src').allInnerTexts();
  expect(vals.length).toBeGreaterThan(0);
  for (const v of vals) expect(norm(v), 'a margin\'s change is in points').toMatch(/נק׳/);
  // regulator data: no partial-quarter line (13.2 rule 3)
  await go(page, '/industry/peers?bm=oshare&rd=yoy', BOARD);
  await expect(page.locator('#guard')).toHaveCount(0);
  if (NUM) {
    const s = await txt(page, '#takeaway');
    expect(s).toContain('הפניקס'); expect(s).toContain('+0.34 נק׳');
  }
});

test('T-F1 · every number opens its own source: sentence, board, median, grid (carried cell, quarter-end close), matrix, company sheet', async ({ page }, info) => {
  test.setTimeout(150_000);
  const st = ST!;
  await go(page, '/industry/peers', BOARD);
  await sample(page, '#takeaway button.src', 4, 'sentence', info);
  await sample(page, '#board-median button.src', 1, 'board median', info);
  const board = await sample(page, '#board .p6-sb-val button.src', 3, 'board', info);
  expect(board[0].body, 'a spot multiple names its close date').toMatch(/\d{2}\.\d{2}\.\d{2}/);
  // grid: a reported cell opens the quarter-end close (not the latest close); a carried cell says so
  const rep = st.reported[0];
  const cell = page.locator(`#quarter-grid td[data-e="${rep}"][data-q="${st.bq}"] button.src`);
  if (await cell.count()) {
    const g = await checkSrc(page, cell, 'grid cell', info);
    const spot = await checkSrc(page, page.locator(`#board .sb-row[data-k="${rep}"] .p6-sb-val button.src`), 'board row', info);
    const mv = (b: string) => /שווי שוק[^\t\n]*?(\d{1,3}(?:,\d{3})+)/.exec(b)?.[1];
    expect(mv(g.body), 'the grid source lists the market value').toBeTruthy();
    expect(g.body, 'the grid\'s market value is the quarter\'s').toMatch(new RegExp(`שווי שוק · (LTM )?${qlab(st.bq).replace("'", "['׳]")}`));
    expect(mv(g.body), 'a quarter-end multiple opens with the quarter-end market value, never the spot one (M1)').not.toBe(mv(spot.body));
    expect(g.body, `grid cell ${rep} ${qlab(st.bq)}: the source names the close date (spec T-F1 M1 "with the close of 30.09.26")`).toContain(qEnd(st.bq));
  }
  const car = page.locator(`#quarter-grid td.car[data-q="${st.bq}"] button.src`);
  if (st.waiting.length && await car.count()) {
    const c = await checkSrc(page, car.first(), 'grid carried cell', info);
    expect(c.body).toContain(`טרם דווח על`);
    expect(c.body).toContain(qlab(st.cq));
  }
  await sample(page, '#quarter-grid td.avg button.src, #quarter-grid-med button.src', 2, 'grid median', info);
  // the close rule under a multiple's grid (14.1, T-R2a)
  const close = await txt(page, '#quarter-grid-close');
  for (const w of ['ברשת', 'בלוח', qEnd(st.bq)]) expect(close).toContain(w);
  expect(close).toMatch(/\d{2}\.\d{2}\.\d{2}/);
  await sample(page, '#quarter-grid-close button.src', 2, 'close rule', info);
  if (!isPhone(info)) {
    await sample(page, '#matrix td button.src', 6, 'matrix', info);
    const starred = page.locator('#matrix td button.src', { hasText: '*' });
    if (await starred.count()) {
      const c = await checkSrc(page, starred.first(), 'matrix carried', info);
      expect(c.body, 'a starred matrix cell opens on the quarter it was carried from').toContain(qlab(st.cq));
      // spec 13.2 rule 1: "open with 'טרם דווח על Q3'26: …'"
      expect(c.body, `matrix starred cell "${c.tap}": the line "טרם דווח על ${qlab(st.bq)}" (spec 13.2 rule 1)`).toContain(`טרם דווח על ${qlab(st.bq)}`);
    }
  }
  // a company's name opens the company sheet: its numbers open sources, its footer is on screen
  await page.locator('#board .sb-row .p6-sb-open').first().click();
  const sheet = page.locator('#co-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#sheet-foot')).toBeInViewport();
  await expect(page.locator('#co-focus')).toHaveText('במיקוד');
  await expect(page.locator('#sheet-foot')).toContainText('לדף החברה');
  await sample(page, '#co-sheet button.src', 3, 'company sheet', info);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('T-P6 · metric sheet, company sheet "במיקוד", Escape', async ({ page }) => {
  await go(page, '/industry/peers', BOARD);
  await page.locator('#all-metrics').click();
  const ms = page.locator('#metric-sheet');
  await expect(ms).toBeVisible();
  expect(await ms.locator('.p6-ms-sec').count()).toBeGreaterThanOrEqual(4);
  await ms.locator('[data-m="pb"]').click();
  await expect(ms).toHaveCount(0);
  await expect(page.locator('#board')).toHaveAttribute('data-metric', 'pb');
  await expect(page).toHaveURL(/bm=pb/);
  // "במיקוד" moves the focus tint and `hl`
  const other = await page.locator('#board .sb-row:not(.mine)').first().getAttribute('data-k');
  await page.locator(`#board .sb-row[data-k="${other}"] .p6-sb-open`).click();
  await expect(page.locator('#co-sheet')).toBeVisible();
  await page.locator('#co-focus').click();
  await expect(page).toHaveURL(new RegExp(`hl=${other}`));
  await expect(page.locator(`#board .sb-row[data-k="${other}"]`)).toHaveClass(/mine/);
  await expect(page.locator('#co-sheet')).toHaveCount(0);
});

test('T-P7 · lenses חברה, גרפים, טבלה: content, Excel in the top row, no sideways scroll', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = errorsOf(page);
  for (const [lens, ready] of [['focus', '#focus-list'], ['charts', 'main svg, main canvas'], ['table', 'main table']] as const) {
    await go(page, `/industry/peers?lens=${lens}`, ready);
    await page.waitForTimeout(lens === 'charts' ? 1500 : 300);
    const top = await page.locator('#xlsx-top').boundingBox();
    expect(top && top.y + top.height <= 120 + 0.5, `${lens}: Excel within the top 120 px (${JSON.stringify(top)})`).toBe(true);
    await expect(page.locator('#views [aria-selected="true"]')).toHaveAttribute('data-tab', lens === 'focus' ? 'company' : lens);
    if (lens === 'focus') {
      const s = await txt(page, '#takeaway');
      expect(s).toMatch(/P\/B/); expect(s).toMatch(/ROE/);
      expect(await page.locator('#focus-list .p6-fl-row').count()).toBeGreaterThanOrEqual(15);
      await sample(page, '#focus-list button.src', 3, 'focus list', info);
    } else if (lens === 'charts') {
      expect(await txt(page, 'main')).toContain('R²');
    } else {
      expect(await page.locator('main table').count()).toBeGreaterThanOrEqual(4);
    }
    expect(await sideways(page), `${lens}: sideways scroll`).toBeLessThanOrEqual(1);
    await wordsGate(page, `lens ${lens}`);
  }
  expect(errors).toEqual([]);
});

test('T-P9, P5 · address hygiene: the free table and the series drop the board\'s keys (lens=charts never survives)', async ({ page }, info) => {
  await go(page, '/industry/peers?lens=charts&bm=pb&rd=now&gq=12', 'main svg, main canvas');
  if (isPhone(info)) {
    for (const v of ['table', 'series'] as const) {
      await page.locator('#hub-menu').click();
      await page.locator(`#hub-${v}`).click();
      await expect(page).toHaveURL(new RegExp(`v=${v}`));
      const u = new URL(page.url());
      for (const k of ['lens', 'bm', 'rd', 'gq']) expect(u.searchParams.has(k), `${v}: "${k}" left in the address`).toBe(false);
      await go(page, '/industry/peers?lens=charts&bm=pb', 'main svg, main canvas');
    }
  } else {
    for (const [id, v] of [['#tab-table', 'table'], ['#tab-series', 'series']] as const) {
      await page.locator(id).click();
      await expect(page).toHaveURL(new RegExp(`v=${v}`));
      const u = new URL(page.url());
      for (const k of ['lens', 'bm', 'rd', 'gq']) expect(u.searchParams.has(k), `${v}: "${k}" left in the address`).toBe(false);
      await expect(page.locator(`${id}`)).toHaveAttribute('aria-selected', 'true');
      expect(await page.locator('[role=tablist][aria-label="תצוגה"]').count(), 'one "תצוגה" strip').toBe(1);
      await go(page, '/industry/peers?lens=charts&bm=pb', 'main svg, main canvas');
    }
  }
});

test('T-N10 · board Excel: six sheets, formulas with their computed values, MEDIAN / COUNT, live links', async ({ page }) => {
  test.setTimeout(120_000);
  await go(page, '/industry/peers', BOARD);
  const { name, buf } = await download(page, page.locator('#xlsx-top'));
  expect(name).toMatch(/\.xlsx$/);
  const b = readBook(buf);
  expect(b.sheets.length, `sheets: ${b.sheets.join(', ')}`).toBe(6);
  for (const s of ['רבעונים', 'מקורות']) expect(b.sheets).toContain(s);
  const stock = [...b.xml.values()][b.sheets.indexOf('המניה')] ?? '';
  expect(stock, 'the multiples of המניה are formulas over the inputs').toMatch(/<f>C\d+\/D\d+<\/f>/);
  expect(b.formulas.filter((f) => /^MEDIAN\(/.test(f)).length).toBeGreaterThan(0);
  expect(b.formulas.filter((f) => /^COUNT\(/.test(f)).length).toBeGreaterThan(0);
  expect(b.links, 'live HYPERLINK cells').toBeGreaterThan(50);
  expect(b.formulas.filter((f) => !/HYPERLINK/.test(f)).length, 'other formulas').toBeGreaterThan(40);
  expect(b.noValue, 'every formula cell carries its computed value (P1: previews that do not recalculate)').toEqual([]);
  expect(b.numeric).toBeGreaterThan(100);
});

/* ====================================================== the company page ====================================================== */

test('T-C1 · company: sentence and seven rows in the first screen, six lenses, the CSM row from the data', async ({ page }, info) => {
  const errors = errorsOf(page);
  const st = ST!;
  await go(page, '/company/harel', COMPANY);
  const q = st.last.harel;
  await expect(page.locator(COMPANY)).toHaveCount(7);
  expect(await page.locator('[role=tablist][aria-label="עדשה"] [role=tab]').count(), 'six lenses').toBe(6);
  const s = await txt(page, '#takeaway');
  expect(s.startsWith(`${qlab(q)}:`)).toBe(true);
  // N4: a figure and its label are one LTR unit; YoY precedes QoQ
  expect(s).toMatch(/[−+]\d+\.\d% YoY, [−+]\d+\.\d% QoQ/);
  expect(s).toMatch(/ROE LTM \d+\.\d%/);
  expect(await txt(page, '#quarter-table thead')).toContain(`מול ${qlab(qBack(q, 4))}`);
  expect(await txt(page, '#quarter-table thead')).toContain(`מול ${qlab(qBack(q))}`);
  // the CSM row: level, YoY and QoQ against the peer file (restated by P6-D)
  const h = csmAt('harel', q), y = csmAt('harel', qBack(q, 4)), p = csmAt('harel', qBack(q));
  const csmRow = await page.locator('#quarter-table tr[data-k="csm"] button.src').allInnerTexts();
  if (h != null) expect(norm(csmRow[0])).toBe(N(h));
  if (h != null && y != null) expect(norm(csmRow[1])).toBe(pct1((h / y - 1) * 100));
  if (h != null && p != null) expect(norm(csmRow[2])).toBe(pct1((h / p - 1) * 100));
  if (NUM) for (const w of ["Q3'26", '462', '−46.0%', '−56.7%', '23.9%']) expect(s).toContain(w);
  // no ".0" on a million in the table
  const cells = await page.locator('#quarter-table button.src').allInnerTexts();
  expect(cells.map(norm).filter((t) => /^[−+]?\d{1,3}(,\d{3})+\.0$|^\d{3,}\.0$/.test(t))).toEqual([]);
  if (isPhone(info)) {
    for (const sel of ['#takeaway', COMPANY]) { const r = await inFirst(page, sel); expect(r.ok, `phone: ${sel} not inside the first screen: ${r.why}`).toBe(true); }
    const bt = await barTop(page), last = await page.locator(COMPANY).last().boundingBox();
    expect(bt - (last!.y + last!.height), 'the seventh row ends ≥ 4 px above the bar').toBeGreaterThanOrEqual(4);
    // the six lenses fit the strip
    const strip = await page.evaluate(() => { const t = document.querySelector('[role=tablist][aria-label="עדשה"]') as HTMLElement; return Array.from(t.querySelectorAll('[role=tab]')).every((b) => { const r = b.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5; }); });
    expect(strip, 'six lenses inside the strip').toBe(true);
  } else {
    // desktop: five changes, the 8-quarter grid and the peers strip without changing lens
    expect(await page.locator('#changes-top li').count()).toBe(Math.min(5, CHANGES.reports.find((r) => r.p === q)?.n ?? 5));
    await expect(page.locator('#quarter-grid-d tbody tr')).toHaveCount(8);
    expect(await page.locator('#peer-strip [data-k]').count()).toBeGreaterThanOrEqual(7);
    const r = await inFirst(page, '#takeaway');
    expect(r.ok).toBe(true);
    if (info.project.name === 'p6-chromium-1440') expect(await firstNumbers(page), 'numbers in the first screen at 1440 (9.7: ≥ 120)').toBeGreaterThanOrEqual(120);
  }
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await wordsGate(page, 'company');
  expect(errors).toEqual([]);
});

test('T-F1 · company: every number opens its own source (sentence, table, changes, peers strip, grid, row sheet)', async ({ page }, info) => {
  test.setTimeout(150_000);
  const st = ST!;
  const q = st.last.harel;
  await go(page, '/company/harel', COMPANY);
  await sample(page, '#takeaway button.src', 5, 'company sentence', info);
  await sample(page, '#quarter-table button.src', 8, 'company table', info);
  const yoy = await checkSrc(page, page.locator('#quarter-table tr[data-k="csm"] button.src').nth(1), 'CSM YoY', info);
  expect(yoy.body, 'a YoY opens both quarters').toContain(qlab(q)); expect(yoy.body).toContain(qlab(qBack(q, 4)));
  if (!isPhone(info)) {
    await sample(page, '#changes-top button.src', 4, 'changes', info);
    await sample(page, '#peer-strip button.src', 3, 'peer strip', info);
    await sample(page, '#quarter-grid-d button.src', 4, 'company grid', info);
  }
  // a row's name opens eight quarters and the report link (T-C2)
  await page.locator('#quarter-table tr[data-k="np"] th button, #quarter-table tr[data-k="np"] th a').first().click();
  const rs = page.locator('#row-sheet');
  await expect(rs).toBeVisible();
  expect(await rs.locator('[data-q], tbody tr').count()).toBeGreaterThanOrEqual(8);
  await sample(page, '#row-sheet button.src', 3, 'row sheet', info);
  await page.keyboard.press('Escape');
});

test('T-C9 · company: no stock data (P/E, P/B, market value, total return, dividend yield) outside "שווי ›"', async ({ page }) => {
  await go(page, '/company/harel', COMPANY);
  const t = await page.evaluate(() => { const m = document.querySelector('main')!.cloneNode(true) as HTMLElement; m.querySelectorAll('a').forEach((a) => { if (/^שווי/.test(a.textContent?.trim() ?? '')) a.remove(); }); return m.innerText; });
  for (const w of ['P/E', 'P/B', 'שווי שוק', 'תשואה כוללת', 'תשואת דיב']) expect(t.includes(w), `"${w}" on the company page`).toBe(false);
});

test('T-C3, T-C4, lenses שינויים · רבעונים · ניתוח · הון · יעדים: content, sources, no sideways scroll', async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors = errorsOf(page);
  const st = ST!;
  const q = st.last.harel;
  // שינויים: N ranked changes, each with its page
  await go(page, '/company/harel?cl=chg', '[data-lens="chg"] .chg, [data-lens="chg"] li');
  const nCh = CHANGES.reports.find((r) => r.p === q)?.n ?? 0;
  if (nCh) {
    expect(await page.locator('[role=tab][aria-selected="true"]').first().innerText()).toContain(String(nCh));
    expect(await page.locator('[data-lens="chg"] li.chg').count()).toBeGreaterThanOrEqual(Math.min(nCh, 5));
    const pages = await page.locator('[data-lens="chg"] li.chg').evaluateAll((ls) => ls.map((l) => /עמ['׳]/.test((l as HTMLElement).innerText)));
    expect(pages.every(Boolean), 'every change carries its page').toBe(true);
  }
  await sample(page, '[data-lens="chg"] li.chg button.src', 3, 'changes lens', info);
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await wordsGate(page, 'lens chg');
  // רבעונים: eight quarters; QoQ sets cp=qoq and the cells become signed changes
  await go(page, '/company/harel?cl=qs', '[data-lens="qs"] table[data-kind="quarters"]');
  const g = page.locator('[data-lens="qs"] table[data-kind="quarters"]').first();
  await expect(g.locator('tbody tr')).toHaveCount(8);
  const seg = page.locator('[data-lens="qs"] .p6-qseg').first();
  await seg.locator('[data-r="qoq"]').click();
  await expect(page).toHaveURL(/cp=qoq/);
  const vals = (await g.locator('tbody td button.src').allInnerTexts()).map(norm).filter((v) => v !== '–');
  expect(vals.length).toBeGreaterThan(0);
  expect(vals.filter((v) => !/^[−+]/.test(v) && !/^0(\.0+)?%?$/.test(v)), 'QoQ cells are signed').toEqual([]);
  await sample(page, '[data-lens="qs"] table[data-kind="quarters"] button.src', 3, 'quarters lens', info);
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await wordsGate(page, 'lens qs');
  // ניתוח · הון · יעדים
  for (const [cl, ready] of [['an', '#analysis'], ['cap', '#capital'], ['tg', '#targets-lens']] as const) {
    await go(page, `/company/harel?cl=${cl}`, ready);
    await page.waitForTimeout(800);
    expect(await sideways(page), `${cl}: sideways scroll`).toBeLessThanOrEqual(1);
    await wordsGate(page, `lens ${cl}`);
    if (cl === 'cap') expect(await page.locator('#solv tbody tr').count(), 'solvency by report').toBeGreaterThanOrEqual(5);
  }
  expect(errors).toEqual([]);
});

test('targets lens · the table first; a solvency threshold meets the ratio on the same basis only', async ({ page }, info) => {
  await go(page, '/company/harel?cl=tg', '#targets-table tbody tr');
  const first = await page.evaluate(() => { const l = document.getElementById('targets-lens')!; return l.querySelector('section, table')?.id; });
  expect(['targets', 'targets-table']).toContain(first);
  expect(await page.locator('#targets-table tbody tr').count()).toBeGreaterThanOrEqual(7);
  if (NUM) { const t = await txt(page, '#targets-table'); for (const w of ['1,900–2,100', '2,954', '18–19%', '27.1%', '520', 'פתוח · עד 2026']) expect(t).toContain(w); }
  const rows = await page.locator('#targets-table tbody tr').evaluateAll((trs) => trs.map((tr) => {
    const th = (tr.querySelector('th') as HTMLElement).innerText, act = tr.querySelectorAll('td')[1] as HTMLElement;
    return { l: th.split('\n')[0], b: (act.querySelector('.p6-tg-b') as HTMLElement | null)?.innerText ?? null, miss: !!act.querySelector('.p6-tg-miss'), fig: !!act.querySelector('.src') };
  }));
  const solv = rows.filter((r) => /כושר פירעון/.test(r.l));
  expect(solv.length, 'solvency thresholds in the table').toBeGreaterThan(0);
  for (const r of solv) {
    if (!r.fig) continue;   // no actual on that basis: "–" with the reason, never a figure of the other basis
    expect(r.b, `${r.l}: the actual states its basis`).not.toBeNull();
    if (/עם הוראות מעבר/.test(r.l)) expect(r.b).toMatch(/^עם הוראות מעבר/);
    if (/ללא הוראות מעבר/.test(r.l)) expect(r.b).toMatch(/^ללא הוראות מעבר/);
  }
  const a = solv.find((r) => /עם הוראות מעבר/.test(r.l) && r.fig), b = solv.find((r) => /ללא הוראות מעבר/.test(r.l) && r.fig);
  if (a && b) {
    const with_ = page.locator('#targets-table tbody tr', { hasText: 'עם הוראות מעבר' }).first().locator('td').nth(1).locator('.src');
    const wo = page.locator('#targets-table tbody tr', { hasText: 'ללא הוראות מעבר' }).first().locator('td').nth(1).locator('.src');
    expect(norm(await with_.innerText()), 'the two bases are two different ratios').not.toBe(norm(await wo.innerText()));
    const o = await checkSrc(page, wo, 'targets actual', info);
    expect(o.body).toContain('מושווה לסף על אותו בסיס בלבד');
  }
});

test('T-C8 · old links: #review opens רבעונים at the review, #analysis opens ניתוח', async ({ page }) => {
  await go(page, '/company/harel#review', '[data-lens="qs"]');
  await expect(page.locator('.co6')).toHaveAttribute('data-lens', 'qs');
  await expect(page.locator('#review')).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.locator('#review')).toBeInViewport();
  await go(page, '/company/harel#analysis', '#analysis');
  await expect(page.locator('.co6')).toHaveAttribute('data-lens', 'an');
  // a lens tap drops the old anchor
  await page.locator('[role=tablist][aria-label="עדשה"] [role=tab]').first().click();
  await expect(page.locator('.co6')).toHaveAttribute('data-lens', 'q');
  expect(new URL(page.url()).hash).toBe('');
});

test('T-C5 · a company that has not reported the quarter: its own latest quarter, "טרם פורסם"', async ({ page }) => {
  const st = ST!;
  const e = st.waiting.includes('clal') ? 'clal' : st.waiting[0];
  test.skip(!e, 'every company has reported the latest quarter');
  await go(page, `/company/${e}`, COMPANY);
  expect((await txt(page, '#takeaway')).startsWith(`${qlab(st.last[e])}:`)).toBe(true);
  const g = await txt(page, '#guard');
  expect(g).toContain(`הדוח ל-${qlab(st.bq)} טרם פורסם`);
  expect(g).toContain(`${st.reported.length} מתוך ${st.n}`);
  await wordsGate(page, `company ${e}`);
});

test('T-C6 · "מול העמיתים ›" lands on the board\'s focus lens for the company', async ({ page }) => {
  await go(page, '/company/harel', COMPANY);
  await page.getByRole('link', { name: /מול העמיתים/ }).first().click();
  await expect(page).toHaveURL(/\/industry\/peers\?/);
  const u = new URL(page.url());
  expect(u.searchParams.get('hl')).toBe('harel');
  expect(u.searchParams.get('lens')).toBe('focus');
  await page.waitForSelector('#focus-list');
});

test('T-C10 · a fund house: its own rows and the fund-house strip', async ({ page }) => {
  await go(page, '/company/meitav', 'main .co6');
  await page.waitForTimeout(1500);
  expect(await page.locator('#quarter-table tr[data-k]').count(), 'six fund-house rows').toBe(6);
  await expect(page.getByText('נכסים מנוהלים, פנסיה וגמל', { exact: true }), 'FundHouseStrip').toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await wordsGate(page, 'company meitav');
});

test('T-N10 · company Excel: named after the report on screen, SUM formulas with values, live links', async ({ page }) => {
  test.setTimeout(150_000);
  const st = ST!;
  await go(page, '/company/harel', COMPANY);
  const { name, buf } = await download(page, page.locator('#xlsx-co'), 120_000);
  expect(name).toBe(`fox-harel-${st.last.harel}.xlsx`);
  const b = readBook(buf);
  expect(b.formulas.filter((f) => /^SUM\(/.test(f)).length, 'LTM rows are SUM formulas').toBeGreaterThan(0);
  expect(b.links, 'live HYPERLINK cells').toBeGreaterThan(20);
  expect(b.noValue, 'every formula cell carries its computed value').toEqual([]);
});

/* ====================================================== the shell ====================================================== */

test('T-N1 · nav: "השוואה ענפית" is the lit place on the board and on a company page', async ({ page }) => {
  for (const url of ['/industry/peers', '/company/harel']) {
    await go(page, url, url.startsWith('/company') ? COMPANY : BOARD);
    const lit = await page.locator('nav[aria-label="ראשי"] a.item.active').evaluateAll((as) => as.filter((a) => (a as HTMLElement).offsetParent !== null).map((a) => a.getAttribute('aria-label')));
    expect(lit, url).toEqual(['השוואה ענפית']);
  }
});

test('T-N2 · no door: the Pro shell on /industry/peers, and search answers the company first', async ({ page }) => {
  await page.addInitScript(() => { try { if (sessionStorage.getItem('nd')) return; sessionStorage.setItem('nd', '1'); localStorage.clear(); localStorage.setItem('fox:seen', JSON.stringify('2099-01-01')); } catch { /* blocked */ } });
  await go(page, '/industry/peers', BOARD);
  expect(await page.evaluate(() => localStorage.getItem('fox:door'))).toBeNull();
  const items = await page.locator('nav[aria-label="ראשי"] a.item').evaluateAll((as) => as.filter((a) => (a as HTMLElement).offsetParent !== null).map((a) => a.getAttribute('aria-label')));
  expect(items).toContain('השוואה ענפית');
  expect(items).toContain('שאלות');
  // search: the header field (a phone opens the search sheet first)
  const field = page.locator('header input[type=search], header input[aria-label="חיפוש"]').first();
  await field.click();
  await page.keyboard.type('הפניקס');
  const first = page.locator('#search-results [role=option]').first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  await expect(first).toHaveAttribute('href', /\/company\/phoenix/);
});

test('T-N3, T-N5, T-G2 · phone: the hub row, ≥ 44 × 32 numbers, ≥ 44 px controls in the first screen', async ({ page }, info) => {
  test.skip(!isPhone(info), 'phone only');
  await go(page, '/industry/peers', BOARD);
  const hub = await page.locator('#hub-menu').boundingBox();
  expect(hub!.height, 'the industry hub row is one 44 px row').toBeGreaterThanOrEqual(43.5);
  await page.locator('#hub-menu').click();
  expect(await page.locator('.p6-hubmenu a.p6-hubrow').count(), 'the hub\'s seven pages and the peer views').toBeGreaterThanOrEqual(7);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await smallOf(page, '#board .p6-sb-val button.src'), 'board numbers ≥ 44 × 32').toEqual([]);
  // the head's median ("חציון 1.50x · 6 חברות", 14.1 G1): a standalone 44 × 32 target (B1 item 4)
  expect(await smallOf(page, '#board-median button.src'), 'the head median ≥ 44 × 32').toEqual([]);
  expect(await smallOf(page, '#quarter-grid td button.src', 43.5, 32), 'grid cells ≥ 43.5 wide').toEqual([]);
  expect(await smallOf(page, '#quarter-grid-med button.src'), 'median strip ≥ 44 × 32').toEqual([]);
  expect(await smallOf(page, '#takeaway button.src', 0, 32), 'numbers in the sentence ≥ 32 tall').toEqual([]);
  // controls of the first screen (figures excepted: they are the numbers above)
  const ctl = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('main button:not(.src), main a[href], main [role=tab]'))
    .map((e) => ({ t: (e.innerText || e.getAttribute('aria-label') || e.id).trim().slice(0, 24), r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && (Math.max(r.width, r.height) < 44 || Math.min(r.width, r.height) < 32))
    .map(({ t, r }) => `${t} ${Math.round(r.width)}×${Math.round(r.height)}`));
  expect(ctl, 'first-screen controls under 44 × 32').toEqual([]);
  await go(page, '/company/harel', COMPANY);
  expect(await smallOf(page, '#quarter-table button.src'), 'company table numbers ≥ 44 × 32').toEqual([]);
  expect(await smallOf(page, '#takeaway button.src', 0, 32), 'numbers in the company sentence ≥ 32 tall').toEqual([]);
});
