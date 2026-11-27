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
  // phase 0 (05.11.26): the company opens on its numbers; the thesis is a tab at its own address
  for (const [name, url] of [['תזה', /\/company\/phoenix\/thesis/], ['דוחות', /\/company\/phoenix\/(financials|review|profit|ifrs17)/], ['חיסכון', /\/company\/phoenix\/savings/], ['מסמכים', /\/company\/phoenix\/filings/], ['מספרים', /\/company\/phoenix\/?(\?|$)/]] as const) {
    await places.getByRole('link', { name, exact: name === 'תזה' || name === 'מספרים' }).first().click();
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

/* The phone's bottom bar (the owner's iPhone), Pro door (P0 shell, fox 3.0 plan 05.11.26; track-compare B3/O5 and B1 polish, 26.11.26):
   five places (בית, מסלולים = the track comparison, חיסכון, השוואה ענפית = the insurer comparison, שאלות; review B2: "חיסכון" between the two
   comparisons) and "עוד" (שווי, תרחישים, מה השתנה and the library sheet behind it), each label whole on one line at 375 and 390 px (the
   narrowest iPhones in use), the active place lit for a company page, and the bar inside the screen. */
const PLACES = ['בית', 'מסלולים', 'חיסכון', 'השוואה ענפית', 'שאלות'];
test('phone bottom bar shows the Pro places and the library sheet in WebKit', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, '/company/phoenix', 'phoenix');
  const bar = page.getByRole('navigation', { name: 'ראשי' });
  const items = bar.locator('a.item:visible');
  await expect(items).toHaveCount(5);
  expect(await items.evaluateAll((as) => as.map((a) => (a as HTMLElement).innerText.trim()))).toEqual(PLACES);
  // phase 6, stage-0 P6-B1 (spec p6 T-N1): a company page belongs to the industry section, so the bar lights "השוואה ענפית" there
  await expect(bar.locator('a.item.active:visible')).toHaveAttribute('aria-label', 'השוואה ענפית');
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 812 });
    const fit = await bar.locator(':is(a.item, .lib-btn):visible').evaluateAll((as) => as.map((a) => { const l = a.querySelector('.lbl-p') as HTMLElement; const r = a.getBoundingClientRect(), lr = l.getBoundingClientRect(); return { t: l.innerText, cut: l.scrollWidth > l.clientWidth + 1 || lr.height > 20 || lr.width > r.width + 1, out: r.left < -1 || r.right > innerWidth + 1, small: r.width < 44 || r.height < 44 }; }));
    expect(fit.length).toBe(6);
    expect(fit.filter((f) => f.cut || f.out), `a bottom-bar label wraps, is cut or leaves the screen at ${width} px`).toEqual([]);
    expect(fit.filter((f) => f.small), `a bottom-bar target under 44 px at ${width} px`).toEqual([]);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [name, url] of [['שאלות', /\/questions/], ['חיסכון', /\/savings/], ['השוואה ענפית', /\/industry\/peers/], ['מסלולים', /\/funds\/screen/], ['בית', /\/$/]] as const) {  // rollout B8: Pro's "מסלולים" opens the screener
    await bar.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await settle(page);
    await expect(boundary(page)).toHaveCount(0);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(sideways, `${name} scrolls sideways`).toBeLessThanOrEqual(1);
  }
  // "עוד": the places the bar has no room for, the library and the lab, in a sheet above the bar
  await bar.locator('.lib-btn').click();
  const sheet = bar.locator('.lib-pop');
  await expect(sheet).toBeVisible();
  for (const name of ['שווי', 'תרחישים', 'מה השתנה', 'מצגות משקיעים', 'מסך האיחודים']) await expect(sheet.getByRole('link', { name, exact: true })).toBeVisible();
  await sheet.getByRole('link', { name: 'תרחישים', exact: true }).click();
  await expect(page).toHaveURL(/\/scenarios/);
  await expect(sheet).toBeHidden();
  // the section lights its place on every page of it
  for (const route of ['/savings', '/managers', '/flows']) {
    await page.goto(route); await settle(page);
    await expect(bar.locator('a.item.active:visible'), `חיסכון lit on ${route}`).toHaveAttribute('aria-label', 'חיסכון');
  }
  // the tracks place (rollout B8: the screener) lights "מסלולים", not "חיסכון"; so do a track's card and the track comparison
  for (const route of ['/funds/screen', '/funds/p2009', '/funds/compare?k=p2102,p2172']) {
    await page.goto(route); await settle(page);
    await expect(bar.locator('a.item.active:visible'), `מסלולים lit on ${route}`).toHaveAttribute('aria-label', 'מסלולים');
  }
});

/* W1 · three doors (plan 01.11.26): a first visit lands on the picker; ?door= opens a door and keeps it; each door has its own bottom bar
   (saver five places, agent six, Pro five and "עוד"), whole labels at 375 px; the phone's door menu switches doors and goes back to the
   picker; a Pro page opened from the saver's door works and says so. No open() here: it chooses Pro on every load. */
const DOOR_BARS: [string, string[]][] = [['saver', ['בית', 'המוצרים שלי', 'דמי ניהול', 'השוואה', 'רגעים']], ['agent', ['בית', 'לקוחות', 'מסלולים', 'השוואה', 'גופים', 'כלים']]];
test('three doors: picker, ?door=, per-door bottom bar and the door menu in WebKit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => { try { localStorage.setItem('theme2', 'phoenix'); localStorage.setItem('fox:seen', JSON.stringify('2099-01-01')); } catch { /* blocked */ } });
  await page.goto('/'); await settle(page);
  await expect(page.getByRole('heading', { level: 3, name: 'הבדיקה השנתית' })).toBeVisible();
  await expect(page.locator('.dfacts .src').first()).toBeVisible();
  const bar = page.getByRole('navigation', { name: 'ראשי' });
  for (const [door, places] of DOOR_BARS) {
    await page.goto(`/?door=${door}`); await settle(page);
    await expect(page).toHaveURL(/\/$/);  // the door is kept, the address is clean
    const items = bar.locator('a.item:visible');
    expect(await items.evaluateAll((as) => as.map((a) => (a as HTMLElement).innerText.trim()))).toEqual(places);
    const fit = await items.evaluateAll((as) => as.map((a) => { const l = a.querySelector('.lbl-p') as HTMLElement; const r = a.getBoundingClientRect(), lr = l.getBoundingClientRect(); return l.scrollWidth > l.clientWidth + 1 || lr.height > 20 || lr.width > r.width + 1 || r.left < -1 || r.right > innerWidth + 1; }));
    expect(fit.filter(Boolean), `a ${door} bar label wraps, is cut or leaves the screen`).toEqual([]);
    await page.reload(); await settle(page);
    expect(await items.count(), `${door} kept after a reload`).toBe(places.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${door} home scrolls sideways`).toBeLessThanOrEqual(1);
  }
  // the door menu: switch to Pro (its five places on the bar, and "עוד"), then back to the picker
  const pill = page.locator('.door-pill');
  await pill.click();
  await page.getByRole('menuitemradio', { name: /^Pro/ }).click();
  await expect(bar.locator('a.item:visible')).toHaveCount(5);
  await expect(bar.locator('.lib-btn')).toBeVisible();
  await pill.click();
  await page.getByRole('menuitem', { name: 'כל הדלתות' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'הבדיקה השנתית' })).toBeVisible();
  // a Pro page from the saver's door: it opens, with the chip and the saver's bar
  await page.goto('/warroom?door=saver'); await settle(page);
  await expect(boundary(page)).toHaveCount(0);
  await expect(page.locator('.pro-chip')).toContainText('עמוד מקצועי');
  await expect(bar.locator('a.item:visible')).toHaveCount(5);
  expect(errors).toEqual([]);
});

/* F1 · the funds section on the phone: hub, screener rows, the compare tray into the head-to-head; no error, no sideways scroll.
   Rollout (spec rollout_spec §4, §6, 26.11.26): the hub is the month grid of the product's types (.hub-body #month-grid), the screener a
   board of rows (#board .sb-row) whose "＋" (.sb-trail button) puts a track in the tray. */
test('funds hub, screener and compare work on the phone in WebKit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 812 });
  const flat = async (where: string) => {
    await expect(boundary(page), `error boundary on ${where}`).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${where} scrolls sideways`).toBeLessThanOrEqual(1);
  };
  await open(page, '/funds', 'phoenix');
  await expect(page.locator('.hub-body #month-grid tbody .mg-cell').first()).toBeVisible({ timeout: 15_000 });
  await flat('/funds');
  await page.goto('/funds/screen?prod=%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA&track=%D7%9B%D7%9C%D7%9C%D7%99'); await settle(page);
  const rows = page.locator('#board .sb-row');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  expect(await rows.count()).toBeGreaterThan(5);
  await flat('/funds/screen');
  // two tracks into the tray, then the tray opens compare with both
  await page.locator('#board .sb-trail button').nth(0).click();
  await page.locator('#board .sb-trail button').nth(1).click();
  const tray = page.getByRole('region', { name: 'מגש השוואה' });
  await expect(tray).toContainText('2');
  await tray.getByRole('link').click();
  await expect(page).toHaveURL(/\/funds\/compare\?k=[gip]\d+,[gip]\d+/);
  await settle(page);
  // the track comparison (redesign 26.11.26): the month-by-month grid, one column per track (no more per-track cards)
  await expect(page.locator('#month-grid tbody .mg-cell:not(.mg-skelcell)').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('#month-grid thead th:not(.m):not(.avg)').count()).toBeGreaterThanOrEqual(2);
  await flat('/funds/compare');
  // closed tracks (funds/closed.json, F1 data) join their type when asked, tagged "נסגר" and unranked
  if ((await page.request.get('/data/funds/closed.json')).ok()) {
    await page.goto('/funds/screen?prod=%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA&track=%D7%9B%D7%9C%D7%9C%D7%99&gone=1'); await settle(page);
    await expect(page.locator('main').getByText('נסגר', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await flat('/funds/screen?gone=1');
  }
  // the old table link lands on the screener with its pickers
  await page.goto('/funds?prod=%D7%92%D7%9E%D7%9C&track=%D7%9E%D7%A0%D7%99%D7%95%D7%AA'); await settle(page);
  await expect(page).toHaveURL(/\/funds\/screen\?prod=/);
  expect(errors).toEqual([]);
});

/* Sticky-column lint (r2-ws3 #2). iOS WebKit paints a position:sticky cell inside an RTL horizontal scroller off its scroll origin
   (blank first column), so every sticky column needs the iOS override (`@supports (-webkit-touch-callout: none)` → position: static,
   end of styles.css). Desktop WebKit and Chrome do not match that condition, so the check re-inserts every touch-callout block in place
   under an always-true condition (same sheet, same index: the real cascade and specificity) and fails on any element that is still
   sticky on the inline axis inside an RTL overflow-x scroller. */
const STICKY_ROUTES = ['/', '/company/phoenix/financials', '/industry/peers', '/industry/peers?t=csm&v=series', '/industry/peers?pin=0', '/industry/csm', '/industry/csm?view=sens',
  '/industry/csm?view=econ', '/industry/csm?view=curve', '/holdings', '/presentations', '/restatements', '/funds', '/funds/screen?prod=%D7%92%D7%9E%D7%9C&track=all', '/funds/compare?k=p2009,g12531', '/funds/p2009', '/managers', '/data', '/scenarios?e=-25&cr=150'];

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

/* W4 · the saver's /my on the owner's engine (red team 02.11.26): the picker's saver card (now "לבדיקה השנתית") enters the saver door; the visit's baseline
   is stored on arrival (iOS may never fire pagehide); a "?" opens on a tap; a deposit fee above the legal ceiling is refused inline;
   two products fold to under 400 words with nothing sideways; and the fee tool opens on the saver's own track and a 4% return. */
test('saver /my: door, baseline on arrival, tap tips, fee ceiling, folded cards in WebKit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/'); await settle(page);
  await expect(page.locator('.door-pill span').first()).toHaveText('בחירת דלת');
  // red team 06.11.26: the saver door card teaches the check-up and opens it
  await page.locator('a.door-go.primary', { hasText: 'לבדיקה השנתית' }).first().click();
  await expect(page).toHaveURL(/\/my\/checkup$/);
  expect(await page.evaluate(() => localStorage.getItem('fox:door'))).toBe('"saver"');
  await expect(page.locator('.door-pill span').first()).toHaveText('חוסך');
  await page.evaluate(() => localStorage.setItem('fox:mine', JSON.stringify([
    { k: 'p9757', added: '2026-11-01', balance: 180000, monthly: 4000, fee: 0.25, depfee: 1.5 },
    { k: 'g13502', added: '2026-11-01', balance: 120000, monthly: 1570, fee: 0.6 }])));
  await page.goto('/my'); await settle(page);
  // rollout (spec rollout_spec §5, T-M1, T-M2): /my is one row per product ([data-my]); today's product card opens in the product sheet
  // (the row's head), and the summary strip ("דבר אחד לעשות") lives in the profile sheet ("הפרטים שלי", #me-btn)
  await expect(page.locator('[data-my=p9757]')).toBeVisible({ timeout: 15_000 });
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('fox:my:seen') ?? 'null'));
  expect(seen?.cur?.p?.p9757, 'baseline stored on arrival').toBeTruthy();
  // the folded page
  const m = await page.evaluate(() => ({ words: (document.querySelector('main')!.innerText.match(/\S+/g) ?? []).length, side: document.documentElement.scrollWidth - innerWidth }));
  expect(m.words, '/my with two products, folded').toBeLessThan(400);
  expect(m.side, 'page scrolls sideways').toBeLessThanOrEqual(1);
  await page.locator('#me-btn').tap();
  const prof = page.getByRole('dialog').last();
  await expect(prof.locator('.sv-sum')).toContainText('דבר אחד לעשות');
  await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0);
  // a "?" opens on a tap: on a phone the explanation is a sheet (lane L0-c, B5), closed by its "סגירה"
  await page.locator('[data-my=p9757] .my-h').tap();
  const sheet = page.locator('#sheet-product');
  await expect(sheet.locator('article.sv-card')).toBeVisible();
  await sheet.locator('article.sv-card .sv-mine summary').click();
  const tip = sheet.locator('article.sv-card .tip-b:visible').first();
  await tip.scrollIntoViewIfNeeded(); await tip.tap();
  await expect(tip).toHaveAttribute('aria-expanded', 'true');
  const tipSheet = page.getByRole('dialog').filter({ has: page.locator('.tip-sheet') });
  await expect(tipSheet).toBeVisible();
  expect((await tipSheet.locator('.tip-sheet').innerText()).trim().length, 'the sheet explains the term').toBeGreaterThan(10);
  await tipSheet.getByRole('button', { name: 'סגירה' }).tap();
  await expect(tipSheet).toBeHidden();
  await expect(sheet.locator('.tip-b[aria-expanded=true]'), 'the tip closed, the product sheet stays').toHaveCount(0);
  await expect(sheet).toBeVisible();
  await page.goBack(); await expect(page.locator('#sheet-product')).toHaveCount(0);
  // a 7% deposit fee in a השתלמות is refused (the ceiling is 4%)
  await page.locator('[data-my=g13502] .my-h').tap();
  const card = page.locator('#sheet-product article.sv-card');
  await expect(card).toBeVisible();
  await card.locator('.sv-mine summary').click();
  // rollout (T-F4): the amounts moved to their own sheet ("לשנות את הסכומים", lib/myAmounts); the fold keeps the two own fees
  await card.locator('.sv-mine input[type=number], .sv-mine input[inputmode]').last().fill('7');
  await expect(card.locator('.sv-err')).toContainText('עד 4%');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fox:mine')!)[1].depfee ?? null)).toBeNull();
  // the fee tool (rollout T-F1) opens on the saver's first product, marked as theirs. In a fresh page of the same context: Playwright's
  // WebKit crashes on a navigation of a page whose history went pushState, pushState, back (the sheets above; compare.spec.ts note)
  const fees = await page.context().newPage();
  fees.on('pageerror', (e) => errors.push(e.message));
  await fees.goto('/funds/tools/fees'); await settle(fees);
  await expect(fees.locator('#takeaway')).toContainText('המסלול שלך');
  await expect(fees.locator('#board .sb-row.mine, #board-mine .sb-row')).not.toHaveCount(0);
  const tools = await fees.evaluate(() => [...document.querySelectorAll('.scroll')].map((s) => s.scrollWidth - s.clientWidth));
  expect(Math.max(0, ...tools), 'a fee-tool table wider than the phone').toBeLessThanOrEqual(1);
  await expect(boundary(fees)).toHaveCount(0);
  await expect(boundary(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

/* Regression (fix-compare-bugs 25.11.26): the screener's "דירוג וסינון" sheet on the phone. A picker in the sheet writes the address
   (replace) over the sheet's own history entry; closing went back to the page's entry and the period reverted to 5Y. The choices must
   stay after "סגירה" and after the phone's Back, and the sheet must leave no history entry behind. */
test('screener sheet keeps its choices after closing in WebKit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const how of ['button', 'back'] as const) {
    await open(page, '/data', 'phoenix');
    await page.goto('/funds/screen?prod=%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA&track=%D7%9B%D7%9C%D7%9C%D7%99'); await settle(page);
    // rollout (T-S1, T-S2): the period is the strip above the board (#period-seg); "סינון" (#filter-btn) opens the sheet
    await page.locator('#period-seg button', { hasText: '1M' }).click();
    await expect(page).toHaveURL(/per=m1/);
    const toggle = page.locator('#filter-btn');
    await toggle.click();
    const sheet = page.getByRole('dialog', { name: 'סינון' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'כולל קופות ענפיות' }).click();
    await sheet.getByRole('spinbutton').first().fill('20');
    await expect(page).toHaveURL(/closed=1/); await expect(page).toHaveURL(/eqmin=20/); await expect(page).toHaveURL(/per=m1/);
    if (how === 'button') await sheet.locator('.scr-show').click(); else await page.goBack();
    await expect(sheet).toBeHidden();
    await page.waitForTimeout(800);
    await expect(page, `choices kept after closing (${how})`).toHaveURL(/closed=1/);
    await expect(page).toHaveURL(/eqmin=20/);
    await expect(page).toHaveURL(/per=m1/);
    await expect(page.locator('#period-seg button[aria-pressed=true], #period-seg button.on').first()).toContainText('1M');
    await page.goBack();
    await expect(page, `no leftover sheet entry (${how})`).toHaveURL(/\/data$/);
    // let /data finish loading before the next navigation: WebKit logs a fetch that a navigation cancels ("Fetch API cannot load
    // …/data/consistency.json due to access control checks") as a JavaScript error, which Playwright reports as a page error
    await settle(page);
  }
  expect(errors).toEqual([]);
});

/* Regression (fix-compare-bugs 25.11.26): the phone's full-screen search. Tapping a result went back over the layer's history entry and
   pushed the result after a timeout; WebKit's late popstate undid the push (the page bounced back) and the cleanup went back twice.
   The result must stay, Back must return to the page the search was opened on, and Back while the search is open only closes it. */
test('phone search result stays and Back returns to the origin in WebKit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const origin of ['/', '/funds/p2009', '/funds/compare?k=p2009,g12531']) {
    await open(page, '/data', 'phoenix');
    await page.goto(origin); await settle(page);
    const here = page.url();
    await page.locator('input[type=search][aria-label="חיפוש"]:visible').first().click();
    const layer = page.locator('.omni-full');
    await expect(layer).toBeVisible();
    await layer.getByRole('combobox').fill('הראל');
    const opt = layer.getByRole('option').first();
    await expect(opt).toBeVisible({ timeout: 15_000 });
    const to = (await opt.getAttribute('href'))!;
    await opt.click();
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname + new URL(page.url()).search, `result kept from ${origin}`).toBe(to);
    await expect(layer).toBeHidden();
    await page.goBack();
    await expect(page, `Back returns to ${origin}`).toHaveURL(here);
  }
  // Back while the search is open closes it and stays on the page
  await page.locator('input[type=search][aria-label="חיפוש"]:visible').first().click();
  await expect(page.locator('.omni-full')).toBeVisible();
  const here = page.url();
  await page.goBack();
  await expect(page.locator('.omni-full')).toBeHidden();
  await expect(page).toHaveURL(here);
  await page.goBack();
  await expect(page).toHaveURL(/\/data$/);
  expect(errors).toEqual([]);
});
