import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/* Shared kit of the track-compare specs (tests/compare.spec.ts, tests/compare-copy.spec.ts; spec pm_spec §9.2, §10A.3).
   Fixtures (§10A.3): P3 = Migdal, Harel, Menora pension general; X2 = Migdal pension general vs Migdal equity; G3 = three gemel-lehashkaa
   general tracks. The exact figures of §10A.3 belong to data month 10/26: they are asserted only while public/data/funds.json says
   202610 (FIX10); after the next monthly data the structural checks still run and the figures are skipped, not failed. */
export const P3 = 'p2102,p2172,p2009', X2 = 'p2102,p2142', G3 = 'g7936,g8211,g8675', P4 = 'p2102,p2172,p2009,p2002';
export const ASOF: number = JSON.parse(readFileSync(new URL('../public/data/funds.json', import.meta.url), 'utf8')).asof;
export const FIX10 = ASOF === 202610;
export const VH = 664;              // the spec's phone: iPhone 14 at 390 × 664 (the visible viewport under Safari's bars)
export type Door = 'saver' | 'agent' | 'pro';

/** strips the bidi isolates and marks the page wraps signed figures in, and folds runs of white space */
export const norm = (s: string) => s.replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim();

/** a fresh visitor in a door: theme, the "seen" flag and the door are written once per tab (sessionStorage guard), so later reloads
 *  keep what the page itself stored. `mine` seeds the saver's own tracks (lib/mine.ts). Collects page errors and console errors. */
export async function visitor(page: Page, door: Door, mine?: unknown[]) {
  await page.addInitScript(([d, m]) => {
    try {
      if (sessionStorage.getItem('l4:init')) return;
      sessionStorage.setItem('l4:init', '1');
      localStorage.setItem('theme2', 'phoenix');
      localStorage.setItem('fox:seen', JSON.stringify('2099-01-01'));
      localStorage.setItem('fox:door', JSON.stringify(d));
      if (m) localStorage.setItem('fox:mine', JSON.stringify(m));
    } catch { /* blocked */ }
  }, [door, mine ?? null] as const);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR_ABORTED/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return errors;
}

/** waits until the month grid shows numbers (not the skeleton) or, on the other views, until the lens has rendered */
export async function settled(page: Page, what = '#month-grid tbody .mg-cell:not(.mg-skelcell), #lens-long #board, #lens-dec, #lens-risk, #cmp-empty') {
  await page.waitForSelector(what, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

/** opens /funds/compare?<q> and waits for it */
export async function cmp(page: Page, q: string, what?: string) {
  await page.goto(`/funds/compare${q ? `?${q}` : ''}`, { waitUntil: 'networkidle' });
  await settled(page, what);
}

/** "in the first screen": the element's box is fully inside the viewport at scroll 0 (§10A.3) */
export const inFirst = (page: Page, sel: string) => page.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return false;
  const b = e.getBoundingClientRect(); return scrollY === 0 && b.height > 0 && b.top >= 0 && b.bottom <= innerHeight;
}, sel);

/** the page budget (§9.2, coordinator: content up to the bottom of the stamp line, not the site footer), in screens */
export const screens = (page: Page) => page.evaluate(() => {
  const s = document.getElementById('stamp'); if (!s) return Infinity;
  return (s.getBoundingClientRect().bottom + scrollY) / innerHeight;
});

export const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** every visible button / link-button in the viewport: larger side ≥ 44 px and smaller ≥ 32 px (§10A.3 Global). Returns the offenders.
 *  Not counted: a figure that opens its own source (`button.src`, the repo's Sourced pattern) — it is the number itself, inline in a
 *  sentence or a cell, and sized by the text around it (WCAG 2.5.8 inline exception). */
export const smallTargets = (page: Page, scope = 'main, [role=dialog]') => page.evaluate((sc) => {
  const out: string[] = [];
  for (const root of Array.from(document.querySelectorAll(sc))) {
    for (const b of Array.from(root.querySelectorAll<HTMLElement>('button, [role=tab], a.cmp-btn, input[type=search]'))) {
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) continue;
      const cs = getComputedStyle(b); if (cs.visibility === 'hidden' || cs.display === 'none' || b.matches('button.src')) continue;
      if (Math.max(r.width, r.height) < 44 || Math.min(r.width, r.height) < 32) out.push(`${(b.innerText || b.getAttribute('aria-label') || b.className).trim().slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return [...new Set(out)];
}, scope);

/** running animations (reduced motion must leave none) */
export const running = (page: Page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => (a as CSSAnimation).animationName ?? a.id ?? 'anim'));

export const keysOf = (page: Page) => (new URL(page.url()).searchParams.get('k') ?? '').split(',').filter(Boolean);
export const dialog = (page: Page) => page.locator('[role=dialog]:visible');

/** the visible words of the saver layers: the page's main column and any open sheet (the site's own header, footer and bottom bar
 *  are the shell's, linted elsewhere) */
export const visibleText = (page: Page) => page.evaluate(() => [document.querySelector('main'), ...Array.from(document.querySelectorAll('[role=dialog]'))]
  .filter(Boolean).map((e) => (e as HTMLElement).innerText).join('\n'));

export async function noErrors(errors: string[]) { expect(errors, 'page and console errors').toEqual([]); }
