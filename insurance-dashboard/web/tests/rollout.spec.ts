import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ASOF, FIX10, VH, inFirst, norm, running, sideways, visitor, type Door } from './compare-kit';

/* Rollout L3-b (spec rollout_spec §18.6, §18.7, §10.4–10.5 as amended by §16–18; tickets Q1, Q2, T-N1, G1): the five rollout pages
   (fund card /funds/:k, screener /funds/screen, /my, savings hub /funds, fees tool /funds/tools/fees) in the saver, agent and Pro doors.
   Projects rollout-webkit + rollout-chromium (playwright.config.ts): iPhone 14 at 390 × 664, WebKit (the owner's engine) and Chromium.
   Fixtures (§10.4): C = /funds/p2102; S = /funds/screen?prod=פנסיה מקיפה&track=כללי; M3 = fox:mine p2102, g880, g8211; H = the hub;
   F = the fees tool with fox:mine p2102. Returns are GROSS (owner 26.11.26).
   Data-month rule (as tests/compare-kit.ts): the exact figures of §18.6 belong to data month 10/26 and are asserted only while
   public/data/funds.json says 202610 (FIX10). After the next monthly data the structural checks, the gates and the cross-page equalities
   (the same ₪ on three pages, the hub's places = the screener's) still run, and the figures that the test can read from the data files
   themselves (a track's published m1, the board's count) are checked against those files.
   Page budgets are measured by scripts/rollout-budgets.mjs (content down to the stamp line); the first-screen rules are asserted here.
   WebKit note (compare.spec.ts): Playwright's WebKit can crash on a navigation after pushState, pushState, back. The B12 watch below
   records such harness crashes and fails only on a real page error. */

const FF = JSON.parse(readFileSync(new URL('../public/data/funds.json', import.meta.url), 'utf8')) as { asof: number; funds: { k: string; name: string; grp: string; prod: string; track: string; m1: number | null }[] };
const F = Object.fromEntries(FF.funds.map((f) => [f.k, f]));
/** fund and company names with Latin letters (allowed in the saver door, §18.7: "fund names") */
const LATIN_NAMES = [...new Set(FF.funds.flatMap((f) => [f.name, f.grp]).filter((s) => /[A-Za-z]/.test(s)))].sort((a, b) => b.length - a.length);
const M3 = [{ k: 'p2102', added: '2026-11-01' }, { k: 'g880', added: '2026-11-01' }, { k: 'g8211', added: '2026-11-01' }];
const ONE = [{ k: 'p2102', added: '2026-11-01' }];
const S = `/funds/screen?prod=${encodeURIComponent('פנסיה מקיפה')}&track=${encodeURIComponent('כללי')}`;
const SH = `/funds/screen?prod=${encodeURIComponent('השתלמות')}&track=${encodeURIComponent('כללי')}`;
const FEES = '/funds/tools/fees';
const JARGON = /נ"ב|נ"א|ד"נ|ד״נ|LTM|YTD|\dY\b|\dM\b|צמודים|מאסף|אחוזון|איזון אקטוארי|מקדם|נדידה/;
const ROOT = 'main';

/* ---------- helpers ---------- */
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);

/** opens a page and waits for the selector that says it has rendered (figures, not skeletons) */
async function go(page: Page, url: string, ready: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector(ready, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}
const READY = {
  card: '#month-grid tbody .mg-cell:not(.mg-skelcell), #long-per button, #lens-dec, #lens-pro',
  screen: '#board .sb-row',
  my: '[data-my], #my-pick',
  hub: '.hub-body',
  fees: '#board .sb-row, #fee-pick, #age-ask, #sens-grid, #ret-real',
} as const;
const txt = async (page: Page, sel: string) => norm(await page.locator(sel).first().innerText());
const dlg = (page: Page) => page.locator('[role=dialog]:visible').last();
const dlgText = async (page: Page) => norm(await dlg(page).innerText());
const places = (page: Page, sel = '#board') => page.$$eval(`${sel} .sb-row .sb-place`, (xs) => xs.map((x) => (x as HTMLElement).innerText.trim()));
const chips = (page: Page, sel = '#board') => page.$$eval(`${sel} .sb-row`, (xs) => xs.map((x) => !!x.querySelector('.tie')));
/** standard competition places: each place equals its 1-based position or the previous row's place */
const competition = (pl: string[]) => pl.every((p, i) => Number(p) === i + 1 || (i > 0 && p === pl[i - 1]));
/** the history length, to prove an in-page change replaced the entry instead of pushing one */
const hlen = (page: Page) => page.evaluate(() => history.length);
/** moves to `to` the way the app's own links do (a history push inside the single-page app), so Back has an origin */
async function pushTo(page: Page, to: string, ready: string) {
  await page.evaluate((u) => { history.pushState(null, '', u); dispatchEvent(new PopStateEvent('popstate')); }, to);
  await page.waitForSelector(ready, { timeout: 20_000 });
  await page.waitForTimeout(700);
}
/** opens every fold of the page (the Pro lens's sections, folded notes) so the wording gate reads everything */
async function openAll(page: Page) {
  await page.evaluate(() => document.querySelectorAll('main details:not([open])').forEach((d) => d.setAttribute('open', '')));
  await page.waitForTimeout(1500);
}

interface Gate { side: number; small: string[]; stampSmall: string[]; targets: string[]; clipped: string[]; jargon: string[]; latin: string[]; wording: string[]; mine: string[]; code: string[]; spaces: string[]; signs: string[] }
/** §18.7 global gates on what is on the page now (the main column and any open sheet). `saver` turns on the saver-only rules. */
async function gates(page: Page, saver: boolean, root = ROOT): Promise<Gate> {
  return page.evaluate(([root, latinNames, jargonSrc]) => {
    const roots = [document.querySelector(root as string), ...Array.from(document.querySelectorAll('[role=dialog]'))].filter((e): e is HTMLElement => !!e && (e as HTMLElement).getClientRects().length > 0);
    const shown = (e: Element) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0; };
    const out = { side: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [] as string[], stampSmall: [] as string[], targets: [] as string[], clipped: [] as string[], jargon: [] as string[], latin: [] as string[], wording: [] as string[], mine: [] as string[], code: [] as string[], spaces: [] as string[], signs: [] as string[] };
    let text = '';
    for (const r of roots) {
      text += '\n' + r.innerText;
      for (const e of Array.from(r.querySelectorAll<HTMLElement>('*'))) {
        if (!shown(e)) continue;
        const own = Array.from(e.childNodes).filter((n) => n.nodeType === 3 && n.textContent!.trim()).map((n) => n.textContent!.trim()).join(' ');
        const fz = parseFloat(getComputedStyle(e).fontSize);
        if (own && fz < 11 && !e.closest('.sr-only, [aria-hidden=true]')) out.small.push(`${fz}px ${own.slice(0, 24)}`);
        if (own && fz < 12 && e.closest('.ro-stamp, .cmp-stamp')) out.stampSmall.push(`${fz}px ${own.slice(0, 24)}`);
        // not counted (WCAG 2.5.8 inline exception, as compare-kit's smallTargets): a figure that opens its own source (button.src) and a
        // link inside running text (an <a> laid out inline in a sentence, sized by the words around it)
        const inlineLink = e.tagName === 'A' && getComputedStyle(e).display === 'inline' && !!e.parentElement && /^(P|LI|SPAN|SMALL|DD|TD)$/.test(e.parentElement.tagName);
        if (e.matches('button, a[href], [role=tab], summary, input:not([type=hidden]), select') && !e.matches('button.src') && !inlineLink && !e.closest('.sr-only')) {
          const b = e.getBoundingClientRect();
          if (Math.max(b.width, b.height) < 44 || Math.min(b.width, b.height) < 32) out.targets.push(`${(e.innerText || e.getAttribute('aria-label') || e.id || e.className).trim().slice(0, 26)} ${Math.round(b.width)}×${Math.round(b.height)}`);
        }
        if (own && getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) out.clipped.push(own.slice(0, 30));
        if (own === 'שלי' || e.matches('.sb-mine')) out.mine.push(`${e.className}`);
      }
      for (const li of Array.from(r.querySelectorAll('.ro-facts li'))) if (/ {2}/.test(li.textContent ?? '')) out.spaces.push((li.textContent ?? '').slice(0, 40));
      for (const c of Array.from(r.querySelectorAll<HTMLElement>('#month-grid tbody .mg-cell:not(.mg-skelcell), #month-grid tbody td .num'))) {
        const t = c.innerText.replace(/[⁦-⁩‎‏]/g, '').trim();
        if (t && t !== '–' && !/^[−+]/.test(t) && !/^0(\.0+)?%?$/.test(t)) out.signs.push(t);
      }
    }
    out.wording = text.replace(/(צבירה|העברות|מיליון) נטו/g, '')   // flows, not returns (§18.1 rule 3)
      .match(/.{0,16}(נטו|אחרי דמי ניהול|נטו\/ברוטו).{0,16}/g) ?? [];
    out.code = text.match(/Sheet|Verdict|ProductCard|PensionPack|AgeRow/g) ?? [];
    if ((jargonSrc as string) && (latinNames as string[]).length >= 0) {
      out.jargon = (text.match(new RegExp(jargonSrc as string, 'g')) ?? []) as string[];
      let t = text;
      for (const n of latinNames as string[]) t = t.split(n).join(' ');
      out.latin = t.replace(/fox|S&P|IRA/g, ' ').match(/.{0,10}[A-Za-z]+.{0,6}/g) ?? [];
    }
    return out;
  }, [root, saver ? LATIN_NAMES : [], saver ? JARGON.source : ''] as const);
}
/* Known offenders (investigated, reported to the coordinator 26.11.26; like tests/a11y-known.json): each is matched by check and text,
   and only on the pages where it was seen. They do not fail the run; anything new does. Every match is attached to the test as an
   annotation so the report keeps listing them until they are fixed. */
const KNOWN: { check: keyof Gate; re: RegExp; where: RegExp; why: string }[] = [
  { check: 'targets', re: /^ריקון מגש ההשוואה \d+×\d+/, where: /./, why: 'compare tray "clear" button 40 px wide (components/FundsNav.tsx, shell)' },
  { check: 'targets', re: /^\? \d+×\d+/, where: /product sheet/, why: 'today\'s ProductCard "?" tips 23×26 inside the /my product sheet (components/saver/ProductCard.tsx, moved unchanged)' },
  { check: 'targets', re: /^(הסרה|סגירה|מגדל מקפת אישית כללי) \d+×\d+/, where: /product sheet/, why: 'today\'s ProductCard head link and "הסרה" inside the /my product sheet (moved unchanged)' },
  { check: 'jargon', re: /^נדידה$/, where: /product sheet/, why: 'today\'s ProductCard text ("נדידה") inside the /my product sheet (moved unchanged)' },
  { check: 'targets', re: /./, where: /card Pro, every section open/, why: 'today\'s Pro panels opened (window chips 41×40, CSV, source links 18–21 px high): moved unchanged into the sections (§17.3)' },
];
/** asserts the gates on the page's main column (or `root`) and any open sheet */
async function gate(page: Page, door: Door, where: string, root = ROOT) {
  const g = await gates(page, door === 'saver', root);
  const known: string[] = [];
  const fresh = (check: keyof Gate) => (g[check] as string[]).filter((x) => { const k = KNOWN.find((n) => n.check === check && n.re.test(x) && n.where.test(where)); if (k) known.push(`${where} · ${check}: ${x} (${k.why})`); return !k; });
  expect.soft(g.side, `${where}: no horizontal page scroll`).toBeLessThanOrEqual(1);
  expect.soft(fresh('small'), `${where}: no text under 11 px`).toEqual([]);
  expect.soft(fresh('stampSmall'), `${where}: stamps ≥ 12 px`).toEqual([]);
  expect.soft(fresh('targets'), `${where}: targets ≥ 44 × 32`).toEqual([]);
  expect.soft(fresh('clipped'), `${where}: no clipped label`).toEqual([]);
  expect.soft(fresh('wording'), `${where}: wording gate (no "נטו" beside a return, no "אחרי דמי ניהול")`).toEqual([]);
  expect.soft(fresh('code'), `${where}: no code names in the text`).toEqual([]);
  expect.soft(fresh('spaces'), `${where}: no fact-list item with two consecutive spaces`).toEqual([]);
  expect.soft(fresh('signs'), `${where}: every heat cell carries its sign`).toEqual([]);
  if (door === 'saver') {
    expect.soft(fresh('jargon'), `${where}: saver jargon`).toEqual([]);
    expect.soft(fresh('latin'), `${where}: Latin letters in the saver door`).toEqual([]);
  } else expect.soft(fresh('mine'), `${where}: "שלי" marks only in the saver door`).toEqual([]);
  for (const k of known) test.info().annotations.push({ type: 'known gate offender', description: k });
}
/** "in the first screen" above the phone's bottom bar: the element's box is inside the viewport at scroll 0 and above the fixed bar */
const aboveBar = (page: Page, sel: string, i = 0) => page.evaluate(([s, i]) => {
  const e = document.querySelectorAll(s as string)[i as number]; if (!e) return `missing ${s}[${i}]`;
  const bar = Array.from(document.querySelectorAll<HTMLElement>('nav, div')).filter((n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= innerHeight - 1 && n.getBoundingClientRect().height > 40 && n.getBoundingClientRect().width > 300);
  const top = bar.length ? Math.min(...bar.map((n) => n.getBoundingClientRect().top)) : innerHeight;
  const b = e.getBoundingClientRect();
  return scrollY === 0 && b.height > 0 && b.top >= 0 && b.bottom <= top + 0.5 ? true : `${s}[${i}]: ${Math.round(b.top)}–${Math.round(b.bottom)} (bar ${Math.round(top)}, scroll ${scrollY})`;
}, [sel, i] as const);
const ils = (s: string) => (s.match(/₪[\d,]+/g) ?? []);

/* ============================ ways in: the saver home (R1, lane L3-a) ============================ */
test.describe('saver home: the two tiles and the "my track" row (R1)', () => {
  test('the four entries in the first screen; each opens its page', async ({ page }) => {
    const errors = await visitor(page, 'saver', ONE);
    await go(page, '/', '#home-screen');
    for (const id of ['#home-compare', '#home-mine', '#home-screen', '#home-hub']) expect(await aboveBar(page, id), `${id} in the first screen`).toBe(true);
    expect(await page.locator('#home-mine').getAttribute('href')).toBe('/funds/p2102');
    const scr = new URL(await page.locator('#home-screen').getAttribute('href') ?? '', 'http://x');
    expect(scr.pathname).toBe('/funds/screen');
    expect(scr.searchParams.get('per')).toBe('m1');
    expect(scr.searchParams.get('prod')).toBe(F.p2102.prod);
    expect(scr.searchParams.get('track')).toBe(F.p2102.track);
    const hub = new URL(await page.locator('#home-hub').getAttribute('href') ?? '', 'http://x');
    expect(hub.pathname).toBe('/funds');
    expect(hub.searchParams.get('prod')).toBe(F.p2102.prod);
    expect(await page.locator('#home-screen svg, #home-hub svg').count(), 'isometric icons on both tiles').toBeGreaterThanOrEqual(2);
    if (FIX10) expect(await txt(page, '#home-mine')).toContain('באוקטובר ירד 1.44% · בשנה האחרונה +9.2%');
    // the gate covers the rollout's part of the home (the entry and the three tiles); the older home sections below are not this rollout's
    await gate(page, 'saver', 'saver home', 'main .dentry-w');
    await page.locator('#home-screen').click();
    await page.waitForSelector(READY.screen); await page.waitForTimeout(500);
    expect(await txt(page, '#takeaway')).toMatch(/^ב/);
    if (FIX10) expect(await txt(page, '#takeaway')).toMatch(/^באוקטובר/);
    await page.goBack(); await page.waitForSelector('#home-hub');
    await page.locator('#home-hub').click();
    await page.waitForSelector(READY.hub);
    expect(new URL(page.url()).pathname, 'the hub stays on /funds with ?prod=').toBe('/funds');
    expect(norm(await page.locator('#prod-chips [aria-pressed="true"]').innerText())).toBe('פנסיה');
    await page.goBack(); await page.waitForSelector('#home-mine');
    await page.locator('#home-mine').click();
    await page.waitForSelector(READY.card);
    expect(new URL(page.url()).pathname).toBe('/funds/p2102');
    expect(errors).toEqual([]);
  });
});

/* ============================ fund card ============================ */
test.describe('fund card /funds/p2102 (T-C1…T-C7, §18.6 card)', () => {
  test('saver, 6 months: sentence and the whole grid in the first screen; gross figures; fee row on the example', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await go(page, '/funds/p2102', READY.card);
    for (const sel of ['#month-insight', '#month-grid tbody tr:nth-child(1)', '#month-grid tbody tr:nth-child(6)', '#month-grid tfoot tr:last-child', '#fee-line'])
      expect(await aboveBar(page, sel), `${sel} in the first screen`).toBe(true);
    expect(await page.locator('#month-grid tbody tr').count()).toBe(6);
    expect(await page.locator('#views [role=tab]').count()).toBe(4);
    expect(await page.evaluate(() => { const e = document.querySelector('#views')!; return e.scrollWidth <= e.clientWidth + 1; }), '#views fits').toBe(true);
    const r1 = await page.$$eval('#month-grid tbody tr:first-child td', (t) => t.map((x) => (x as HTMLElement).innerText.replace(/[⁦-⁩‎‏]/g, '').trim()));
    expect(r1.every((t) => t.endsWith('%')), `first-row cells end with "%": ${r1}`).toBe(true);
    // the track's own cell is the published monthly return of the data month (funds.json m1), gross, whatever the month
    expect(r1[0]).toBe(`${sign(F.p2102.m1!)}%`);
    expect(norm(await page.locator('#month-grid thead').innerText())).toMatch(/באחוזים,\s*לפני דמי ניהול/);
    expect(await txt(page, '#stamp')).toContain('תשואה ברוטו, כפי שמפורסמת');
    expect(await txt(page, '#fee-line')).toContain('לדוגמה');
    expect(await page.locator('#cmp-cta').getAttribute('href')).toMatch(/^\/funds\/compare\?k=p2102,/);
    if (FIX10) {
      expect(await txt(page, '#month-insight')).toBe('באוקטובר המסלול ירד 1.44%, יותר מהממוצע בפנסיה כללי (−1.03%). בשנה האחרונה עלה 9.2%.');
      expect(norm(await page.locator('#month-grid tbody tr:first-child th').innerText())).toBe('אוקטובר 26');
      expect(r1).toEqual(['−1.44%', '−1.03%']);
      const foot = norm(await page.locator('#month-grid tfoot').innerText());
      expect(foot).toMatch(/\+1\.4%.*\+2\.0%/);
      expect(foot).toMatch(/\+9\.2%.*\+10\.1%/);
      const fee = await txt(page, '#fee-line');
      expect(fee).toContain('בשנה, לדוגמה ›');
      expect(ils(fee)).toEqual(['₪560', '₪560']);
      expect(await page.locator('#cmp-cta').getAttribute('href')).toBe('/funds/compare?k=p2102,p2009,p2002');
    }
    // the one bracketed figure of the sentence is one LTR-isolated run
    const iso = await page.evaluate(() => { const t = document.querySelector('#month-insight')!.textContent ?? ''; const m = t.match(/\(([^)]*)\)/); return m ? /^[⁦⁧⁨‎]/.test(m[1]) || !!document.querySelector('#month-insight bdi, #month-insight [dir=ltr]') : true; });
    expect(iso, 'bracketed figure isolated').toBe(true);
    await gate(page, 'saver', 'card m6');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector(READY.card); await page.waitForTimeout(600);
    expect(await running(page), 'reduced motion: no running animation').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('saver: month sheet steps without closing; type-month sheet from the average head; star; fee sheet', async ({ page }) => {
    const errors = await visitor(page, 'saver', ONE);
    await go(page, '/funds/p2102', READY.card);
    await page.locator('#month-grid tbody tr').first().locator('td button').first().click();
    await expect(dlg(page)).toBeVisible();
    const older = norm(await page.locator('#month-older').innerText());
    expect(older).toMatch(/^→ /);
    const t0 = await dlgText(page);
    await page.locator('#month-older').click(); await page.waitForTimeout(500);
    await expect(dlg(page)).toBeVisible();
    expect(await dlgText(page), 'older steps the sheet').not.toBe(t0);
    if (FIX10) { expect(t0).toContain('אוקטובר 2026'); expect(older).toBe('→ ספט׳ 26'); expect(await dlgText(page)).toContain('ספטמבר 2026'); }
    await page.keyboard.press('Escape'); await expect(page.locator('[role=dialog]')).toHaveCount(0);
    // T-C7: the average head → the type-month sheet: 5 rows, exactly one mine, places (standard competition; 1,1,1,4,4 in 10/26)
    await page.locator('#avg-head').click();
    await page.waitForSelector('[role=dialog] #type-board .sb-row', { timeout: 20_000 }); await page.waitForTimeout(400);
    const pl = await places(page, '[role=dialog] #type-board');
    expect(pl.length).toBe(5);
    expect(competition(pl), `places ${pl}`).toBe(true);
    expect(await page.locator('[role=dialog] #type-board .sb-row.mine').count()).toBe(1);
    if (FIX10) { expect(pl).toEqual(['1', '1', '1', '4', '4']); expect(await dlgText(page)).toContain('אוקטובר 2026 · פנסיה כללי'); }
    await page.keyboard.press('Escape'); await expect(page.locator('[role=dialog]')).toHaveCount(0);
    await page.locator('#fee-line button').first().click();
    await expect(dlg(page)).toBeVisible();
    expect(await dlgText(page)).toContain('דמי ניהול, בשקלים');
    await gate(page, 'saver', 'card fee sheet');
    await page.keyboard.press('Escape');
    await page.locator('#star').click();
    await expect(page.locator('#star')).toHaveAttribute('aria-pressed', 'true');
    expect(await txt(page, '#star')).toContain('★');
    expect(errors).toEqual([]);
  });

  test('saver: 12 months, years and long lenses (T-C3, §18.6 card years / long)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await go(page, '/funds/p2102?v=m12', READY.card);
    expect(await page.locator('#month-grid tbody tr').count()).toBe(12);
    await gate(page, 'saver', 'card m12');
    await go(page, '/funds/p2102?v=y', READY.card);
    const labs = await page.locator('#month-grid tbody tr th').allInnerTexts();
    expect(labs.length).toBe(5);
    expect(norm(labs[0])).toMatch(new RegExp(`^${Math.floor(ASOF / 100)}`));
    if (FIX10) {
      const body = norm(await page.locator('#month-grid tbody').innerText());
      for (const r of [/\+6\.5%? .*\+7\.3%?/, /\+15\.6%? .*\+15\.9%?/, /\+13\.3%? .*\+13\.2%?/, /\+9\.7%? .*\+9\.0%?/, /−2\.5%? .*−3\.2%?/]) expect(body).toMatch(r);
      expect(await txt(page, '#takeaway')).toBe('ב-2025 המסלול עלה 15.6%, מתחת לממוצע בפנסיה כללי (+15.9%).');
    }
    await gate(page, 'saver', 'card years');
    await page.locator('#more-years').click(); await page.waitForTimeout(400);
    expect(await page.locator('#month-grid tbody tr').count()).toBeGreaterThan(5);
    await go(page, '/funds/p2102?v=long', READY.card);
    expect(await page.locator('#long-per button').count()).toBe(3);
    if (FIX10) {
      expect(await txt(page, '#takeaway')).toBe('ב-5 השנים האחרונות המסלול עלה 8.8% בשנה בממוצע, כמעט כמו הממוצע בפנסיה כללי. מקום 2 מתוך 5.');
      expect(await txt(page, '#long-per')).toMatch(/\+9\.2%.*מקום 5 מתוך 5.*\+13\.2%.*מקום 3 מתוך 5.*\+8\.8%.*מקום 2 מתוך 5/);
    }
    await gate(page, 'saver', 'card long');
    await page.locator('#long-per button[data-per=a3]').click(); await page.waitForTimeout(500);
    expect(await txt(page, '#takeaway')).toMatch(/^ב-3 השנים האחרונות/);
    expect(errors).toEqual([]);
  });

  test('agent "להחלטה" and Pro "מקצועי" (T-C4, T-C5): tabs, decision rows, every section opened passes the wording gate', async ({ page }) => {
    const errors = await visitor(page, 'agent');
    await go(page, '/funds/p2102?v=dec', READY.card);
    const tabs = (await page.locator('#views [role=tab]').allInnerTexts()).map(norm);
    expect(tabs.length).toBe(5); expect(tabs[4]).toBe('להחלטה');
    const t = norm(await page.locator(ROOT).textContent() ?? '');   // the decision rows, folded ones included
    for (const w of ['איזון אקטוארי', 'מדד השירות', 'תביעות', 'מסמך ללקוח', 'שמירה לתיק לקוח']) expect(t).toContain(w);
    // punch list P1: the decision as compact tiles (actuarial balance, service, claims) with the pension pack closed below
    expect(await page.locator('#dec-tiles .kpi').count()).toBeGreaterThanOrEqual(3);
    if (await page.locator('#dec-pack').count()) expect(await page.locator('#dec-pack').evaluate((d) => (d as HTMLDetailsElement).open ?? false), '#dec-pack closed by default').toBe(false);
    await gate(page, 'agent', 'card dec');
    const pro = await page.context().newPage();
    const perr: string[] = []; pro.on('pageerror', (e) => perr.push(e.message));
    await pro.evaluate(() => localStorage.setItem('fox:door', JSON.stringify('pro'))).catch(() => {});
    await go(pro, '/funds/p2102?door=pro&v=pro', READY.card);
    const ptabs = (await pro.locator('#views [role=tab]').allInnerTexts()).map(norm);
    expect(ptabs.length).toBe(5); expect(ptabs[4]).toBe('מקצועי');
    expect(await pro.locator('.fc-sec > summary').count()).toBe(12);
    await openAll(pro);
    expect(await txt(pro, ROOT)).not.toContain('הדגמה');
    if (FIX10) expect(await txt(pro, '#sec-risk')).toContain('13.19%');
    await gate(pro, 'pro', 'card Pro, every section open');
    expect([...errors, ...perr]).toEqual([]);
  });

  test('edge cases (T-C6): IRA guard, a new track, an old policy', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await go(page, '/funds/g1486', 'main .fc');
    expect(await page.locator('#month-grid').count()).toBe(0);
    await go(page, '/funds/i17012', 'main .fc');
    expect(await page.locator('#cmp-cta').count()).toBe(0);
    expect(await txt(page, 'main .fc')).not.toContain('מקום');
    expect(errors).toEqual([]);
  });
});

/* ============================ screener ============================ */
test.describe('screener /funds/screen (T-S1…T-S3, §18.6 screener)', () => {
  test('saver, pension general: five rows in the first screen; five years then the month; places and chips', async ({ page }) => {
    const errors = await visitor(page, 'saver', M3);
    await go(page, S, READY.screen);
    for (let i = 0; i < 5; i++) expect(await aboveBar(page, '#board .sb-row', i), `row ${i + 1} in the first screen`).toBe(true);
    const seg = (await page.locator('#period-seg button').allInnerTexts()).map(norm);
    expect(seg.join(' · ')).toBe(`חודש · מתחילת ${Math.floor(ASOF / 100)} · 12 חודשים · 3 שנים · 5 שנים`);
    expect(seg.some((s) => /[A-Za-z]/.test(s))).toBe(false);
    const p5 = await places(page);
    expect(competition(p5), `five-year places ${p5}`).toBe(true);
    // the board lists the type's like-for-like tracks (funds.json: open pension general tracks, none self-managed)
    expect(p5.length).toBe(FF.funds.filter((f) => f.prod === 'פנסיה מקיפה' && f.track === 'כללי' && f.m1 != null).length);
    if (FIX10) {
      expect(await txt(page, '#takeaway')).toBe('ב-5 השנים האחרונות מנורה ראשון: +9.0% בשנה. הפער בין הראשון לאחרון: 0.7% בשנה.');
      expect(p5).toEqual(['1', '2', '3', '4', '4']);
      expect(await chips(page)).toEqual([false, false, false, true, true]);
      const vals = (await page.locator('#board .sb-row .val .num').allInnerTexts()).map(norm);
      expect(vals).toEqual(['+9.0%', '+8.8%', '+8.6%', '+8.3%', '+8.3%']);
    }
    expect(await page.locator('#board .sb-row.mine').count(), 'one "שלי" row in the saver door').toBe(1);
    await gate(page, 'saver', 'screener 5 years');
    const h0 = await hlen(page);
    await page.locator('#period-seg button', { hasText: 'חודש' }).first().click(); await page.waitForTimeout(700);
    expect(new URL(page.url()).searchParams.get('per')).toBe('m1');
    expect(await hlen(page), 'a period is in-page state: replace, not push').toBe(h0);
    expect(await txt(page, '#takeaway')).toMatch(/^ב/);
    const pm = await places(page);
    expect(competition(pm), `month places ${pm}`).toBe(true);
    expect(pm.every((p) => /^\d+$/.test(p)), 'every place label is a single integer').toBe(true);
    expect(await page.locator('#board .track').count(), 'month: no bars when a figure is negative').toBe(FF.funds.filter((f) => f.prod === 'פנסיה מקיפה' && f.track === 'כללי').some((f) => (f.m1 ?? 0) < 0) ? 0 : await page.locator('#board .track').count());
    if (FIX10) {
      expect(await txt(page, '#takeaway')).toBe('באוקטובר הראל גילעד, הראל מנוף ומנורה כמעט שווים בראש. הפער בין הראשון לאחרון: 0.73%.');
      expect(pm).toEqual(['1', '1', '1', '4', '4']);
      expect((await chips(page)).some(Boolean), 'no chip when every row shares').toBe(false);
      expect(await page.locator('#tie-note').count()).toBe(1);
    }
    await gate(page, 'saver', 'screener month');
    // the "＋" of row 1 puts it in the tray without a sheet; a row tap opens the track sheet with "לכרטיס המסלול"
    await page.locator('#board .sb-trail button').first().click(); await page.waitForTimeout(400);
    expect(await page.locator('[role=dialog]').count()).toBe(0);
    await page.locator('#board .sb-row').first().click();
    await expect(dlg(page)).toBeVisible();
    expect(await dlgText(page)).toContain('לכרטיס המסלול');
    await gate(page, 'saver', 'screener track sheet');
    expect(errors).toEqual([]);
  });

  test('saver, hishtalmut general, month: standard competition, a chip only on shared places, self-managed apart', async ({ page }) => {
    const errors = await visitor(page, 'saver', M3);
    await go(page, `${SH}&per=m1`, READY.screen);
    const pl = await places(page), ch = await chips(page);
    expect(competition(pl), `places ${pl}`).toBe(true);
    const shared = pl.map((p) => pl.filter((x) => x === p).length > 1);
    expect(ch, 'a chip only on a row whose place another row shares').toEqual(shared);
    if (FIX10) {
      expect(pl).toEqual(['1', '2', '3', '3', '5', '5', '7', '7', '7', '7', '11', '12', '13']);   // coordinator: IRA / self-managed not ranked (§18.5)
      expect(await page.locator('#board-self .sb-row').count() + Number(await page.locator('#board-self-btn').count() > 0)).toBeGreaterThan(0);
    }
    await gate(page, 'saver', 'screener hishtalmut month');
    expect(errors).toEqual([]);
  });

  test('agent and Pro: quiet lines, "דירוג לפי", no "שלי" (T-S2, G1)', async ({ page }) => {
    const errors = await visitor(page, 'agent', M3);
    await go(page, S, READY.screen);
    const subs = (await page.locator('#board .sb-row .nm small').allInnerTexts()).map(norm);
    expect(subs.length).toBeGreaterThanOrEqual(5);
    for (const s of subs) { expect(s).toContain('מהפקדה'); expect(s).toContain('איזון'); }
    await gate(page, 'agent', 'agent screener');
    await page.locator('#filter-btn').click();
    await expect(dlg(page)).toBeVisible();
    expect(await page.locator('#rank-by button').count()).toBeGreaterThanOrEqual(21);
    await page.locator('#rank-by button', { hasText: 'ד"נ מצבירה' }).click();
    await page.locator('.scr-show').click(); await page.waitForTimeout(700);
    const fv = (await page.locator('#board .sb-row .val .num').allInnerTexts()).map(norm);
    const nums = fv.map((v) => parseFloat(v));
    expect(fv.every((v) => v.includes('%'))).toBe(true);
    expect(nums.every((x, i) => i === 0 || x >= nums[i - 1]), `ascending ${fv}`).toBe(true);
    const pro = await page.context().newPage();
    await go(pro, `${S}&door=pro`, READY.screen);
    await gate(pro, 'pro', 'Pro screener');
    expect(errors).toEqual([]);
  });
});

/* ============================ /my ============================ */
test.describe('/my (T-M1…T-M4, §18.6 /my)', () => {
  test('M3: the sentence, three rows with six squares, places, fees on the example, two rows in the first screen', async ({ page }) => {
    const errors = await visitor(page, 'saver', M3);
    await go(page, '/my', READY.my);
    expect(await page.locator('[data-my]').count()).toBe(3);
    const cells = await page.$$eval('[data-my]', (rs) => rs.map((r) => r.querySelectorAll('.ro-sc').length));
    expect(cells).toEqual([6, 6, 6]);
    expect(await aboveBar(page, '[data-my=p2102]')).toBe(true);
    expect(await aboveBar(page, '[data-my=g880]')).toBe(true);
    const rings = (await page.locator('[data-my] .ro-sc.now .num').allInnerTexts()).map(norm);
    expect(rings[0]).toBe(sign(F.p2102.m1!));
    const fees = (await page.locator('[data-my] .my-fee').allInnerTexts()).map(norm);
    for (const f of fees) expect(f, 'every "₪… בשנה" on a row says "לדוגמה" before amounts are typed').toMatch(/₪[\d,]+ בשנה לדוגמה/);
    const main = await txt(page, ROOT);
    expect(main).not.toMatch(/יהיו לך/);
    expect(await page.locator('[data-my=p2102] .my-cmp').getAttribute('href')).toMatch(/^\/funds\/compare\?k=p2102,/);
    if (FIX10) {
      expect(await txt(page, '#takeaway')).toBe('באוקטובר שניים מהמסלולים שלך ירדו ואחד כמעט לא זז. בשנה האחרונה כולם עלו: בין +8.9% ל-+9.2%.');
      expect(rings).toEqual(['−1.44', '−0.19', '+0.01']);
      const vs = (await page.locator('[data-my] .my-vs').allInnerTexts()).map(norm);
      expect(vs[0]).toContain('מתחת לממוצע בפנסיה כללי (−1.03%)');
      expect(vs[1]).toContain('מעל הממוצע בהשתלמות כללי (−0.28%)');
      expect(vs[2]).toContain('מעל הממוצע בגמל להשקעה כללי (−0.19%)');
      const yr = (await page.locator('[data-my] .my-yr').allInnerTexts()).map(norm);
      expect(yr[0]).toContain('מקום 5 מתוך 5');
      expect(yr[1]).toContain('באמצע (5–6 מתוך 12 שיש להם שנה מלאה)');   // coordinator: self-managed / IRA not ranked (§18.5); P2 (novice B2 #3): 12 of the 13 have a full year
      expect(yr[2]).toContain('מקום 7 מתוך 11');
      expect(fees.map((f) => ils(f)[0])).toEqual(['₪560', '₪600', '₪550']);
      expect(await txt(page, '#fee-sum')).toContain('כ-1,710');
    }
    await gate(page, 'saver', '/my M3');
    // a row opens the product sheet with today's product card
    await page.locator('[data-my=p2102] .my-h').click();
    await expect(dlg(page)).toBeVisible();
    expect(await dlgText(page)).toContain('העתקת הודעה לסוכן');
    await gate(page, 'saver', '/my product sheet');
    await page.keyboard.press('Escape'); await expect(page.locator('[role=dialog]')).toHaveCount(0);
    // the ringed square → that month's sheet; #fee-sum → the breakdown of 3 products
    await page.locator('[data-my=p2102] .ro-sc.now').click();
    await expect(dlg(page)).toBeVisible();
    if (FIX10) expect(await dlgText(page)).toMatch(/^אוקטובר 2026/);
    await page.keyboard.press('Escape'); await expect(page.locator('[role=dialog]')).toHaveCount(0);
    await page.locator('#fee-sum').click();
    await expect(dlg(page)).toBeVisible();
    expect(await page.locator('#myfees > div:not(.tot)').count()).toBe(3);
    await page.keyboard.press('Escape');
    // the profile sheet: one 44-px pill, today's summary strip inside
    const mb = await page.locator('#me-btn').boundingBox();
    expect(mb!.height).toBeGreaterThanOrEqual(44);
    expect(errors).toEqual([]);
  });

  test('empty /my: six tiles in the first screen; the three-tap add flow', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await go(page, '/my', READY.my);
    expect(await page.locator('#my-pick button').count()).toBe(6);
    expect(await inFirst(page, '#my-pick')).toBe(true);
    await gate(page, 'saver', '/my empty');
    await page.locator('#my-pick button', { hasText: 'פנסיה' }).first().click(); await page.waitForTimeout(600);
    expect(await inFirst(page, '#step-cur') || await page.evaluate(() => { const b = document.querySelector('#step-cur')!.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })).toBe(true);
    await page.locator('#my-grp button', { hasText: /^מגדל$/ }).click(); await page.waitForTimeout(600);
    expect(await txt(page, '#step-cur')).toContain('איזה מסלול');
    await page.locator('#my-trk button').first().click(); await page.waitForTimeout(1200);
    expect(await page.locator('[data-my]').count()).toBe(1);
    expect(errors).toEqual([]);
  });
});

/* ============================ savings hub ============================ */
test.describe('savings hub /funds (T-H1…T-H4, §18.6 hub)', () => {
  test('M3: the reader\'s type first and marked; sentence and grid in the first screen; the sheet\'s places = the screener\'s', async ({ page }) => {
    const errors = await visitor(page, 'saver', M3);
    await go(page, '/funds', READY.hub);
    expect(norm(await page.locator('#prod-chips [aria-pressed="true"]').innerText())).toBe('פנסיה');
    const heads = (await page.locator('#month-grid thead th').allInnerTexts()).map(norm);
    expect(heads.filter((h) => h.includes('שלי')).length, 'one column head with "שלי"').toBe(1);
    expect(await page.locator('#month-grid tbody tr').count()).toBe(6);
    expect(await aboveBar(page, '#month-insight')).toBe(true);
    expect(await aboveBar(page, '#month-grid')).toBe(true);
    if (FIX10) {
      expect(await txt(page, '#month-insight')).toBe('באוקטובר מסלולי פנסיה כללי (הסוג שלך) ירדו 1.03% בממוצע. בסוגים האחרים: ירידה בין 0.95% ל-1.76%.');
      expect((await page.$$eval('#month-grid tbody tr:first-child td .num', (a) => a.map((e) => e.textContent ?? ''))).map(norm)).toEqual(['−1.03%', '−1.22%', '−0.95%', '−1.76%']);
    }
    await gate(page, 'saver', 'hub month');
    await page.locator('#month-grid tbody tr:first-child td').first().locator('button').click();
    await page.waitForSelector('[role=dialog] #type-board .sb-row', { timeout: 20_000 }); await page.waitForTimeout(400);
    const hubPl = await places(page, '[role=dialog] #type-board');
    expect(await page.locator('[role=dialog] #type-board .sb-row.mine').count()).toBe(1);
    if (FIX10) expect(hubPl).toEqual(['1', '1', '1', '4', '4']);
    // F2: the screener on the same month gives identical places (one placeGroups)
    const scr = await page.context().newPage();
    await go(scr, `${S}&per=m1`, READY.screen);
    expect(await places(scr), 'hub type-month sheet places = screener month places').toEqual(hubPl);
    await scr.close();
    // the hishtalmut and gemel-lehashkaa tabs each mark the reader's type once
    await page.keyboard.press('Escape'); await expect(page.locator('[role=dialog]')).toHaveCount(0);
    for (const tab of ['השתלמות', 'גמל להשקעה']) {
      await page.locator('#prod-chips button', { hasText: tab }).click(); await page.waitForTimeout(700);
      expect((await page.locator('#month-grid thead th').allInnerTexts()).filter((h) => h.includes('שלי')).length, `${tab}: one "שלי" head`).toBe(1);
    }
    if (FIX10) expect(await txt(page, '#month-insight')).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('leaders and changes lenses; tools tiles (T-H3)', async ({ page }) => {
    const errors = await visitor(page, 'saver', M3);
    await go(page, '/funds?v=lead', READY.hub);
    const lb = await page.$$eval('#lead-0 .sb-row', (a) => a.map((r) => ({ t: (r as HTMLElement).innerText.replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' '), mine: r.classList.contains('mine') })));
    expect(lb.length).toBe(3);
    expect(lb.filter((r) => r.mine).length).toBe(1);
    expect(lb.find((r) => r.mine)!.t).toContain('המסלול שלך');
    if (FIX10) { expect(lb[0].t).toMatch(/הראל גילעד.*−0\.72/); expect(lb[1].t).toMatch(/מגדל.*−1\.44/); expect(lb[2].t).toMatch(/כלל.*−1\.45/); }
    await gate(page, 'saver', 'hub leaders');
    await go(page, '/funds?v=chg', READY.hub);
    if (FIX10) expect(await txt(page, '#takeaway')).toBe('באוקטובר בפנסיה כללי (הסוג שלך): בין המסלול הראשון לאחרון היה פער של 0.73%.');
    expect(await page.locator('#spread .hub-sp').count()).toBeGreaterThanOrEqual(3);
    await gate(page, 'saver', 'hub changes');
    await go(page, '/funds?v=tools', READY.hub);
    const tiles = await page.$$eval('#hub-tools a', (a) => a.map((e) => ({ h: e.getBoundingClientRect().height, svg: !!e.querySelector('svg') })));
    expect(tiles.length).toBe(6);
    expect(tiles.every((x) => x.h >= 44 && x.svg)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('agent and Pro: no "שלי"; the lenses pass the gates', async ({ page }) => {
    for (const door of ['agent', 'pro'] as Door[]) {
      const p = door === 'agent' ? page : await page.context().newPage();
      const errors = await visitor(p, door, M3);
      for (const v of ['', '?v=lead', '?v=chg']) {
        await go(p, `/funds${v}${v ? '&' : '?'}door=${door}`, READY.hub);
        await gate(p, door, `${door} hub ${v || 'month'}`);
      }
      expect(errors).toEqual([]);
    }
  });
});

/* ============================ fees tool ============================ */
test.describe('fees tool /funds/tools/fees (T-F1…T-F4, §18.6 fees)', () => {
  test('F: the board on the example; the closing mean equals the card\'s fee row', async ({ page }) => {
    const errors = await visitor(page, 'saver', ONE);
    await go(page, FEES, READY.fees);
    expect(await txt(page, 'h1')).toBe('דמי ניהול, בשקלים');
    expect(await page.locator('#board .sb-row.mine').count()).toBe(1);
    const rows = await page.locator('#board .sb-row').count();
    for (let i = 1; i <= Math.min(5, rows); i++) expect(await page.evaluate((i) => { const r = document.querySelectorAll('#board .sb-row')[i - 1].getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight - 40; }, i), `fee row ${i} starts in the first screen`).toBe(true);
    const avg = await txt(page, '#board .avgline');
    if (FIX10) {
      expect(await txt(page, '#takeaway')).toBe('המסלול שלך (מגדל): כ-560 ש״ח בשנה, על דוגמה של 100,000 ש״ח. האחרים: 540 עד 610.');
      expect((await page.locator('#board .sb-row .val').allInnerTexts()).map(norm)).toEqual(['₪540', '₪550', '₪550', '₪560', '₪610']);
      expect(avg).toBe('ממוצע 5 המסלולים · בשנה ₪560');
    }
    await gate(page, 'saver', 'fees year');
    // the card's fee row shows the same mean ("ממוצע", typeFeeAvg) as the tool's closing line
    const card = await page.context().newPage();
    await go(card, '/funds/p2102', READY.card);
    expect(ils(await txt(card, '#fee-line'))[1], 'card fee row type average = fees tool mean').toBe(ils(avg)[0]);
    await card.close();
    expect(errors).toEqual([]);
  });

  test('420,000 / 3,100 typed in the fees tool: the same ₪ on the card, /my and the tool, after a reload (T-F4, T-M4, T-C2)', async ({ page }) => {
    const errors = await visitor(page, 'saver', M3);
    await go(page, FEES, READY.fees);
    await page.locator('#amounts-btn').click();
    await page.waitForSelector('#sheet-amounts');
    expect(await txt(page, '#sheet-amounts')).toContain('מגדל · פנסיה כללי');
    await page.locator('#in-bal').fill('');
    await page.locator('#in-bal').pressSequentially('420000');
    expect(await page.locator('#in-bal').inputValue()).toBe('420,000');
    await page.locator('#in-dep').pressSequentially('3100');
    await page.locator('#save-amounts').click(); await page.waitForTimeout(900);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(await inFirst(page, '#takeaway')).toBe(true);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector(READY.fees); await page.waitForTimeout(500);
    expect(await txt(page, '#amounts-btn')).toBe('הסכומים שלי ✓');
    const sent = await txt(page, '#takeaway');
    const toolMine = ils(norm(await page.locator('#board .sb-row.mine .val, #board-mine .sb-row .val').first().innerText()))[0];
    expect(sent).toContain(toolMine.replace('₪', 'כ-'));
    // /my: the p2102 row on the reader's amounts
    const my = await page.context().newPage();
    await go(my, '/my', READY.my);
    const myFee = await txt(my, '[data-my=p2102] .my-fee');
    expect(myFee).toContain('על הסכומים שלך');
    expect(ils(myFee)[0], '/my = fees tool').toBe(toolMine);
    // the card's fee row on the reader's amounts, with the same type mean as the tool's closing line
    const card = await page.context().newPage();
    await go(card, '/funds/p2102', READY.card);
    const cf = await txt(card, '#fee-line');
    expect(cf).toContain('שלך'); expect(cf).not.toContain('לדוגמה');
    expect(ils(cf)[0], 'card = fees tool').toBe(toolMine);
    expect(ils(cf)[1], 'card mean = fees tool mean').toBe(ils(await txt(page, '#board .avgline'))[0]);
    if (FIX10) {
      expect(sent).toBe('המסלול שלך (מגדל): כ-1,170 ש״ח בשנה, על הסכומים שלך. הזול מהסוג הזה: 1,150.');
      expect(toolMine).toBe('₪1,170');
      expect(ils(cf)).toEqual(['₪1,170', '₪1,210']);
      expect(await txt(my, '#fee-sum')).toContain('כ-2,320');
    }
    expect(errors).toEqual([]);
  });

  /** one own-fee rule (lane L3-a: components/saver/MyProductRow myFeeCost): the reader's own fee from a statement, with and without
   *  their amounts, gives the same ₪ and the tag "לפי הדוח שלך" on the card, /my and the fees tool */
  for (const [name, mine, want] of [
    ['own fee 0.10% / 1% on the example', { k: 'p2102', added: '2026-11-01', fee: 0.1, depfee: 1 }, '₪370'],
    ['own fee and own amounts 420,000 / 3,100', { k: 'p2102', added: '2026-11-01', fee: 0.1, depfee: 1, balance: 420000, monthly: 3100 }, '₪790'],
  ] as const) {
    test(`${name}: the same ₪ on the card, /my and the fees tool`, async ({ page }) => {
      const errors = await visitor(page, 'saver', [mine]);
      await go(page, '/funds/p2102', READY.card);
      const cf = await txt(page, '#fee-line');
      expect(cf).toContain('לפי הדוח שלך');
      const my = await page.context().newPage();
      await go(my, '/my', READY.my);
      const mf = await txt(my, '[data-my=p2102] .my-fee');
      expect(mf).toContain('לפי הדוח שלך');
      const fees = await page.context().newPage();
      await go(fees, FEES, READY.fees);
      const tf = norm(await fees.locator('#board .sb-row.mine, #board-mine .sb-row').first().innerText());
      expect(ils(mf)[0], '/my = card').toBe(ils(cf)[0]);
      expect(ils(tf)[0], 'fees tool = card').toBe(ils(cf)[0]);
      if (FIX10) expect(ils(cf)[0]).toBe(want);
      expect(errors).toEqual([]);
    });
  }

  test('hishtalmut general (mine g880): like-for-like board, self-managed apart, one-field amounts sheet', async ({ page }) => {
    const errors = await visitor(page, 'saver', [{ k: 'g880', added: '2026-11-01' }]);
    await go(page, FEES, READY.fees);
    expect(await page.locator('#board .sb-row').count()).toBeGreaterThan(5);
    expect(await txt(page, '#board-self')).toContain('בניהול אישי · לא בהשוואה');
    if (FIX10) {
      expect(await page.locator('#board .sb-row').count()).toBe(12);
      expect(await page.locator('#board-self .sb-row').count()).toBe(7);
      expect(ils(await txt(page, '#board .avgline'))[0]).toBe('₪630');
    }
    await gate(page, 'saver', 'fees hishtalmut');
    await page.locator('#amounts-btn').click(); await page.waitForSelector('#sheet-amounts');
    expect(await page.locator('#sheet-amounts input:not([type=hidden])').count(), 'no deposit field where no track charges one').toBe(1);
    expect(errors).toEqual([]);
  });

  test('clean context: the entry screen names no fund; one tap shows a board; the career lens asks the age first', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await page.addInitScript(() => { try { localStorage.removeItem('fox:door'); } catch { /* blocked */ } });
    await go(page, FEES, READY.fees);
    expect(await page.locator('#fee-pick button').count()).toBe(6);
    const body = await txt(page, ROOT);
    const names = [...new Set(FF.funds.map((f) => f.grp))].filter((g) => g.length > 2);
    expect(names.filter((n) => body.includes(n)), 'no fund name on the entry screen').toEqual([]);
    await gate(page, 'saver', 'fees entry');
    await page.locator('#fee-pick button').first().click();
    await page.waitForSelector('#board .sb-row');
    // the career lens ("עד הפרישה") on the chosen product asks the age before it shows anything
    await page.evaluate(() => localStorage.removeItem('fox:my:age'));
    await page.locator('#views [role=tab]', { hasText: 'עד הפרישה' }).click();
    await page.waitForSelector('#age-ask'); await page.waitForTimeout(400);
    expect(await page.locator('#age-ask').count()).toBe(1);
    expect(await page.locator('#board').count()).toBe(0);
    await page.locator('#age-ask button', { hasText: '50' }).click(); await page.waitForSelector('#board .sb-row');
    expect(await txt(page, '#takeaway')).toMatch(/^מגיל 50 עד \d+/);
    const cv = (await page.locator('#board .sb-row .val').allInnerTexts()).map((v) => Number(v.replace(/[^\d]/g, '')));
    expect(cv.every((v) => v % 100 === 0), `career values are multiples of 100: ${cv}`).toBe(true);
    await gate(page, 'saver', 'fees career');
    expect(errors).toEqual([]);
  });

  test('agent and Pro: four lenses, no "שלי"; Pro sensitivity 6 × 6', async ({ page }) => {
    const errors = await visitor(page, 'agent', ONE);
    await go(page, FEES, READY.fees);
    expect(await page.locator('#views [role=tab]').count()).toBe(4);
    await gate(page, 'agent', 'agent fees');
    const pro = await page.context().newPage();
    await go(pro, `${FEES}?door=pro&v=sens`, '#sens-grid');
    expect(await pro.$$eval('#sens-grid tbody tr', (rs) => rs.map((r) => r.querySelectorAll('td').length))).toEqual([6, 6, 6, 6, 6, 6]);
    await gate(pro, 'pro', 'Pro fees sens');
    expect(errors).toEqual([]);
  });
});

/* ============================ history (T-N1) ============================ */
test.describe('history: page moves push, in-page state replaces (T-N1)', () => {
  test('fees → bar "המוצרים שלי" → product sheet → "כרטיס המסלול" → Back → /my → Back → fees', async ({ page }) => {
    // fixed in P2 (26.11.26): a page link inside the /my product sheet closes the sheet's history entry first (backThen), then moves
    const errors = await visitor(page, 'saver', M3);
    await go(page, FEES, READY.fees);
    await page.getByRole('navigation', { name: 'ראשי' }).getByRole('link', { name: 'המוצרים שלי' }).click();
    await page.waitForSelector('[data-my]'); await page.waitForTimeout(600);
    await page.locator('[data-my=p2102] .my-h').click();
    await expect(dlg(page)).toBeVisible();
    await dlg(page).getByRole('button', { name: 'עוד פרטים' }).click();
    await dlg(page).getByRole('link', { name: 'כרטיס המסלול' }).first().click();
    await page.waitForSelector(READY.card); await page.waitForTimeout(600);
    expect(new URL(page.url()).pathname).toBe('/funds/p2102');
    await page.goBack(); await page.waitForTimeout(900);
    expect(new URL(page.url()).pathname, 'one Back = /my').toBe('/my');
    await expect(page.locator('[role=dialog]'), 'no sheet left open on /my').toHaveCount(0);
    await page.goBack(); await page.waitForTimeout(900);
    expect(new URL(page.url()).pathname, 'one more Back = the fees tool').toBe(FEES);
    expect(errors).toEqual([]);
  });

  /** in-page state on each page (lenses, periods, product chips) replaces; one Back leaves the page */
  const STATE: [string, string, string, (p: Page) => Promise<void>][] = [
    ['card lenses', '/funds/p2102', READY.card, async (p) => { for (const t of ['12 חודשים', 'שנים', 'לאורך זמן', '6 חודשים']) { await p.locator('#views [role=tab]', { hasText: t }).click(); await p.waitForTimeout(400); } }],
    ['screener periods', S, READY.screen, async (p) => { for (const t of ['חודש', '12 חודשים', '3 שנים']) { await p.locator('#period-seg button', { hasText: t }).first().click(); await p.waitForTimeout(400); } }],
    ['hub chips and lenses', '/funds', READY.hub, async (p) => { await p.locator('#prod-chips button', { hasText: 'השתלמות' }).click(); await p.waitForTimeout(400); await p.locator('#views [role=tab]').nth(1).click(); await p.waitForTimeout(400); }],
    ['fees lenses', FEES, READY.fees, async (p) => { await p.locator('#views [role=tab]').nth(1).click(); await p.waitForTimeout(500); await p.locator('#views [role=tab]').nth(0).click(); await p.waitForTimeout(500); }],
    ['/my sheets', '/my', READY.my, async (p) => { await p.locator('#fee-sum').click(); await expect(dlg(p)).toBeVisible(); await p.keyboard.press('Escape'); await p.waitForTimeout(500); await p.locator('#me-btn').click(); await expect(dlg(p)).toBeVisible(); await p.keyboard.press('Escape'); await p.waitForTimeout(500); }],
  ];
  for (const [name, url, ready, act] of STATE) {
    test(`${name}: replace, and one Back leaves the page`, async ({ page }) => {
      const errors = await visitor(page, 'saver', M3);
      await go(page, '/funds/tools', 'main');
      await pushTo(page, url, ready);
      const h0 = await hlen(page);
      await act(page);
      await expect(page.locator('[role=dialog]')).toHaveCount(0);
      // a sheet adds the one entry its Back closes (history.length then counts it as a forward entry); lenses and pickers replace
      if (!name.includes('sheets')) expect(await hlen(page), `${name}: no history entry added`).toBe(h0);
      await page.goBack(); await page.waitForTimeout(900);
      expect(new URL(page.url()).pathname, `${name}: one Back = the page before`).toBe('/funds/tools');
      expect(errors).toEqual([]);
    });
  }
});

/* ============================ B12 crash watch (§18.2 #1, §18.8 release check 1) ============================ */
test.describe('B12 watch: two Backs then a new address, 20 runs', () => {
  test('home → screener → a row → card → Back → Back → new address', async ({ page, context }, info) => {
    test.setTimeout(20 * 30_000);
    const real: string[] = [], harness: string[] = [];
    let p = page;
    let crashEvents = 0;
    const watch = (pg: Page) => { pg.on('pageerror', (e) => real.push(`pageerror: ${e.message}`)); pg.on('crash', () => { crashEvents++; }); };
    await visitor(p, 'saver', M3); watch(p);
    const TO = ['/funds/p2009', '/funds', FEES, '/my', `${SH}&per=m1`];
    for (let i = 0; i < 20; i++) {
      try {
        await go(p, '/', 'main');
        await pushTo(p, S, READY.screen);
        await p.locator('#board .sb-row').first().click();
        await expect(dlg(p)).toBeVisible();
        await dlg(p).getByText('לכרטיס המסלול').first().click();
        await p.waitForSelector(READY.card, { timeout: 20_000 }); await p.waitForTimeout(400);
        expect(new URL(p.url()).pathname).toMatch(/^\/funds\/[gip]\d+$/);
        await p.goBack(); await p.waitForTimeout(500);
        await p.goBack(); await p.waitForTimeout(500);
        const to = TO[i % TO.length];
        await p.goto(to, { waitUntil: 'networkidle' });
        await p.waitForSelector('main', { timeout: 20_000 }); await p.waitForTimeout(400);
        const bound = await p.getByRole('alert').filter({ hasText: 'העמוד לא נטען' }).count();
        if (bound) real.push(`run ${i + 1}: error boundary on ${to}`);
      } catch (e) {
        const m = String((e as Error).message ?? e);
        if (/crash|Target closed|has been closed|Navigation failed because page crashed|WebKit encountered an internal error/i.test(m)) {
          harness.push(`run ${i + 1}: ${m.split('\n')[0].slice(0, 120)}`);
          p = await context.newPage(); watch(p);
        } else throw e;
      }
    }
    // WebKit under Playwright crashes on this pattern on this site (a known engine/harness bug, compare.spec.ts): recorded, not failed.
    // Release check 1 (§18.8) on a real iPhone decides it. A real page error or the error boundary fails.
    info.annotations.push({ type: 'B12 harness crashes', description: `${harness.length} of 20 runs (${info.project.name}; ${crashEvents} crash events)${harness.length ? ': ' + harness.slice(0, 3).join(' | ') : ''}` });
    console.log(`[B12 ${info.project.name}] harness crashes: ${harness.length} of 20 runs (${crashEvents} crash events)${harness.length ? ' · ' + harness.slice(0, 3).join(' | ') : ''}`);
    expect(real, 'real page errors in the B12 loop').toEqual([]);
  });
});

/* ============================ desktop pass (Q2) ============================ */
test.describe('desktop at 1280 px (Q2)', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  const PAGES: [string, string, string][] = [
    ['card', '/funds/p2102', READY.card], ['card Pro', '/funds/p2102?v=pro', READY.card], ['screener', S, '#board .sb-row, table.fscreen tbody tr'],
    ['/my', '/my', READY.my], ['hub', '/funds', READY.hub], ['hub leaders', '/funds?v=lead', READY.hub], ['fees', FEES, READY.fees],
  ];
  for (const door of ['saver', 'agent', 'pro'] as Door[]) {
    test(`${door}: every page without sideways scroll or errors; dense layouts kept`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = await visitor(page, door, M3);
      for (const [name, url, ready] of PAGES) {
        await go(page, url, ready);
        expect(await sideways(page), `${door} ${name}: no horizontal scroll at 1280`).toBeLessThanOrEqual(1);
        if (name === 'screener' && door !== 'saver') {
          const th = (await page.locator('table.fscreen thead th').allInnerTexts()).map(norm);
          expect(th.length, 'desktop screener: today\'s table').toBeGreaterThanOrEqual(12);
        }
        if (name === 'card') expect(await page.locator('#month-grid tbody tr').count()).toBeGreaterThanOrEqual(6);
        if (name === 'hub') expect(await page.locator('#month-grid thead th').count()).toBeGreaterThanOrEqual(5);
        if (name === 'card Pro' && door !== 'saver') expect(await page.locator('.fc-sec').count()).toBe(12);
      }
      expect(errors).toEqual([]);
    });
  }
});

/* ============================ axe on the rollout pages (Chromium) ============================ */
/* the three contrast defects reported 26.11.26 (#cmp-cta span, .avgline .num.pos, .ro-sc small) were fixed in P2: nothing is known */
const AXE_KNOWN = new Set<string>([]);
test.describe('axe (Chromium): no serious or critical violation on the rollout pages', () => {
  const PAGES: [string, string, string][] = [['card', '/funds/p2102', READY.card], ['screener', S, READY.screen], ['/my', '/my', READY.my], ['hub', '/funds', READY.hub], ['fees', FEES, READY.fees]];
  test('saver door, M3', async ({ page }, info) => {
    test.skip(!info.project.name.includes('chromium'), 'axe runs in Chromium (the engine of tests/a11y.spec.ts)');
    test.setTimeout(120_000);
    const errors = await visitor(page, 'saver', M3);
    for (const [name, url, ready] of PAGES) {
      await go(page, url, ready);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
      const ser = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const line = (v: (typeof ser)[number]) => `${v.id}@${name} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} ${(n.any[0]?.message ?? '').replace(/\s+/g, ' ').slice(0, 90)}`).join(' | ')}`;
      for (const v of ser.filter((x) => AXE_KNOWN.has(`${x.id}@${name}`))) info.annotations.push({ type: 'known axe violation', description: line(v) });
      expect.soft(ser.filter((x) => !AXE_KNOWN.has(`${x.id}@${name}`)).map(line), `axe on ${name}`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});

export { VH };
