import { expect, test, type Page } from '@playwright/test';
import { open } from './routes';

/* WebKit crash regression (r2-ws3 P0, fixed in 1f74de82): JSC threw "undefined is not a function" from destructuring for…of over the
   large fact arrays, and the company page showed the error boundary ("העמוד לא נטען") on 6 of 9 reloads of /company/phoenix and on
   most tab taps once companies/phoenix.json came from cache. Reload the page three times, then walk the four company places and the
   statement views; any error boundary or uncaught page error fails. Runs in the webkit-phone project (iPhone 13) only. */
const boundary = (page: Page) => page.getByRole('alert').filter({ hasText: 'העמוד לא נטען' });

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !/טוען/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

test('company page survives reloads and place switches in WebKit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const seen: string[] = [];
  const ok = async (where: string) => {
    seen.push(where);
    await expect(boundary(page), `error boundary on ${where}`).toHaveCount(0);
    expect(errors, `page errors on ${where}`).toEqual([]);
  };

  await open(page, '/company/phoenix', 'phoenix');
  await ok('/company/phoenix');
  for (let i = 1; i <= 3; i++) { await page.reload(); await settle(page); await ok(`reload ${i}`); }

  const places = page.getByRole('navigation', { name: 'חברה' });
  for (const [name, url] of [['מספרים', /\/company\/phoenix\/numbers/], ['דוחות', /\/company\/phoenix\/(financials|review|profit|ifrs17)/], ['חיסכון', /\/company\/phoenix\/savings/], ['מסמכים', /\/company\/phoenix\/filings/], ['תזה', /\/company\/phoenix\/?(\?|$)/]] as const) {
    await places.getByRole('link', { name, exact: name === 'תזה' }).first().click();
    await expect(page).toHaveURL(url);
    await settle(page);
    await ok(`place ${name}`);
  }
  // the statement views were the worst case (50–100% in WebKit with a warm cache)
  for (const view of ['review', 'profit', 'ifrs17', 'financials']) {
    await page.goto(`/company/phoenix/${view}`); await settle(page); await ok(view);
  }
  expect(seen.length).toBe(13);
});

/* The phone's bottom bar (the owner's iPhone): the five places only (שאלות added with the Question Index, S1), each label whole on one line, the evidence group off the bar,
   the active place lit for a company page, and the bar inside the screen. */
test('phone bottom bar shows the five places in WebKit', async ({ page }) => {
  await open(page, '/company/phoenix', 'phoenix');
  const bar = page.getByRole('navigation', { name: 'ראשי' });
  const items = bar.locator('a.item:visible');
  await expect(items).toHaveCount(5);
  expect(await items.evaluateAll((as) => as.map((a) => (a as HTMLElement).innerText.trim()))).toEqual(['בית', 'שאלות', 'תרחישים', 'חדר מלחמה', 'עמדות']);
  await expect(bar.locator('.rail-ev')).toBeHidden();
  await expect(bar.locator('a.item.active:visible')).toHaveAttribute('aria-label', 'בית');
  const fit = await items.evaluateAll((as) => as.map((a) => { const l = a.querySelector('.lbl-p') as HTMLElement; const r = a.getBoundingClientRect(); return { cut: l.scrollWidth > l.clientWidth + 1 || l.getBoundingClientRect().height > 20, out: r.left < -1 || r.right > innerWidth + 1 }; }));
  expect(fit.filter((f) => f.cut || f.out), 'a bottom-bar label wraps, is cut or leaves the screen').toEqual([]);
  for (const [name, url] of [['שאלות', /\/questions/], ['תרחישים', /\/scenarios/], ['חדר מלחמה', /\/warroom/], ['עמדות', /\/positions/], ['בית', /\/$/]] as const) {
    await bar.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await settle(page);
    await expect(boundary(page)).toHaveCount(0);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(sideways, `${name} scrolls sideways`).toBeLessThanOrEqual(1);
  }
});

/* Sticky-column lint (r2-ws3 #2). iOS WebKit paints a position:sticky cell inside an RTL horizontal scroller off its scroll origin
   (blank first column), so every sticky column needs the iOS override (`@supports (-webkit-touch-callout: none)` → position: static,
   end of styles.css). Desktop WebKit and Chrome do not match that condition, so the check re-inserts every touch-callout block in place
   under an always-true condition (same sheet, same index: the real cascade and specificity) and fails on any element that is still
   sticky on the inline axis inside an RTL overflow-x scroller. */
const STICKY_ROUTES = ['/', '/company/phoenix/financials', '/industry/peers', '/industry/peers?t=csm&v=series', '/industry/peers?pin=0', '/industry/csm', '/industry/csm?view=sens',
  '/industry/csm?view=econ', '/industry/csm?view=curve', '/ownership', '/holdings', '/presentations', '/restatements', '/funds', '/managers', '/data', '/scenarios?e=-25&cr=150'];

test('sticky columns in RTL scrollers are all covered by the iOS override', async ({ page }) => {
  test.setTimeout(240_000);
  const bad = new Set<string>();
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of STICKY_ROUTES) {
      await open(page, route, 'phoenix');
      const found = await page.evaluate(() => {
        let swapped = 0;
        const walk = (owner: CSSStyleSheet | CSSGroupingRule) => {
          const list = owner.cssRules;
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (r instanceof CSSSupportsRule && /touch-callout/.test(r.conditionText)) {
              const text = r.cssText.replace(/@supports\s*\([^{]*touch-callout[^{]*\)\s*\{/, '@supports (display: block) {');
              owner.deleteRule(i); owner.insertRule(text, i); swapped++;
            } else if ('cssRules' in r) walk(r as CSSGroupingRule);
          }
        };
        for (const s of Array.from(document.styleSheets)) { try { walk(s); } catch { /* cross-origin: none here */ } }
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
          const cs = getComputedStyle(el);
          if (cs.position !== 'sticky' || (cs.left === 'auto' && cs.right === 'auto')) continue;
          let p = el.parentElement;
          while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowX)) p = p.parentElement;
          if (!p || getComputedStyle(p).direction !== 'rtl') continue;
          const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
          const tbl = el.closest('table');
          out.push(`${el.tagName.toLowerCase()}${cls}${el.matches(':first-child') ? ':first-child' : ''} in ${tbl ? 'table.' + Array.from(tbl.classList).join('.') : p.className}`);
        }
        return { swapped, out };
      });
      expect(found.swapped, 'iOS override blocks found').toBeGreaterThan(0);
      for (const o of found.out) bad.add(`${o} @ ${route} (${width} px)`);
    }
  }
  expect([...bad], 'sticky columns without the iOS override (add their selector to the @supports (-webkit-touch-callout: none) block at the end of styles.css)').toEqual([]);
});

/* A2 · /scenarios on the owner's engine: the page survives reloads, a preset and a slider reprice the ranking, the sliders open in a
   sheet on the phone, and nothing scrolls sideways. */
test('scenario studio reprices in WebKit without sideways scroll', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, '/scenarios', 'phoenix');
  for (let i = 0; i < 2; i++) { await page.reload(); await settle(page); }
  await expect(boundary(page)).toHaveCount(0);
  const first = async () => (await page.locator('.scn-r .who a').first().textContent()) ?? '';
  await page.getByRole('button', { name: 'מפולת מניות' }).click();
  await expect(page).toHaveURL(/e=-25/);
  const a = await first();
  await page.getByRole('button', { name: 'תקרת דמי ניהול' }).click();
  await expect(page).toHaveURL(/fg=10/);
  expect(await page.locator('.scn-r').count()).toBeGreaterThan(5);
  // the sliders live in a sheet on the phone
  await page.locator('.ctxbar-in').click();
  const sheet = page.getByRole('dialog', { name: 'מחוונים' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('slider', { name: /^מניות/ }).fill('-40');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/e=-40/);
  expect(a.length).toBeGreaterThan(0);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(sideways, 'page scrolls sideways').toBeLessThanOrEqual(1);
  await expect(boundary(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
