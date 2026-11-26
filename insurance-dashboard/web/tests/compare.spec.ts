import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ASOF, FIX10, G3, P3, P4, VH, X2, cmp, dialog, inFirst, keysOf, noErrors, norm, running, screens, settled, sideways, smallTargets, visitor, type Door } from './compare-kit';

/* T1 · track compare (/funds/compare), the acceptance items of spec §10A.3 (C1–C14, D1–D4, D6, B3), the page budgets of §9.2 and the
   picker regression of review B1 (lane L3-e). Projects compare-webkit and compare-chromium (playwright.config.ts): iPhone 14 at
   390 × 664, WebKit (the owner's engine) and Chromium. Fixtures and the data-month rule: tests/compare-kit.ts.
   WebKit note: Playwright's WebKit crashes on a reload or a navigation of a page whose history went pushState, pushState, back (an
   engine bug, not the site's: scratchpad/build/L3e/mini.mjs). Every test that opens a sheet therefore ends on that page, or continues
   in a fresh page of the same context. */

const BANNED_P3 = ['מיסוי ונזילות', 'תשואה מתגלגלת', 'קצבה', 'PPTX', 'איזון אקטוארי'];
const PRO_LABELS: string[] = JSON.parse(readFileSync(new URL('./fixtures/compare-pro-labels.json', import.meta.url), 'utf8'));

const firstRow = (page: Page) => page.$$eval('#month-grid tbody tr:first-child td:not(.avg)', (t) => t.map((x) => (x as HTMLElement).innerText.trim()));
const rowCount = (page: Page) => page.locator('#month-grid tbody tr').count();

test.describe('first screen and budgets (C1, C3, C4, C5, C9, D6, §9.2)', () => {
  test('P3 saver: the table, its summary rows and the sentence in the first screen', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P3}`);
    for (const sel of ['#month-grid tbody tr:nth-child(1)', '#month-grid tbody tr:nth-child(6)', '#month-grid tfoot tr:last-child', '#month-insight', '#fee-line'])
      expect(await inFirst(page, sel), `${sel} in the first screen`).toBe(true);
    expect(await rowCount(page)).toBe(6);
    const r1 = await firstRow(page);
    expect(r1.length).toBe(3);
    expect(r1.every((t) => t.endsWith('%')), `first-row cells end with "%": ${r1}`).toBe(true);
    expect(r1.every((t) => /^[⁦-⁩‎]*[−+]|^[⁦-⁩‎]*0(\.0+)?%$/.test(t)), `every heat cell carries its sign: ${r1}`).toBe(true);
    const views = await page.evaluate(() => { const e = document.querySelector('#views')!; return { n: e.children.length, fits: e.scrollWidth <= e.clientWidth }; });
    expect(views).toEqual({ n: 4, fits: true });
    expect(await sideways(page), 'no horizontal page scroll').toBeLessThanOrEqual(1);
    expect(await screens(page), 'page ≤ 1.5 screens (to the stamp)').toBeLessThanOrEqual(1.5);
    // the best of a row is marked without colour: a dot and the words, for every ringed cell
    const best = await page.$$eval('#month-grid tbody .mg-cell.best', (b) => b.map((x) => !!x.querySelector('.mg-dot') && /הגבוה בשורה/.test(x.getAttribute('aria-label') ?? '')));
    expect(best.length).toBeGreaterThan(0);
    expect(best.every(Boolean), 'best-of-row mark has a dot and a label').toBe(true);
    const fee = norm(await page.locator('#fee-line').innerText());
    expect(fee).toMatch(/דמי ניהול/);
    expect(fee).toMatch(/₪\d/);
    // C9: none of the old page's deep blocks on the saver's first page; C5 never "אינה בעלת משמעות"
    const txt = await page.locator('main').innerText();
    for (const w of [...BANNED_P3, 'אינה בעלת משמעות']) expect(txt, `"${w}" on the saver page`).not.toContain(w);
    // D6: no "נטו" / "ברוטו" control in the first screen
    const nb = await page.evaluate(() => [...document.querySelectorAll('main button, main a')].filter((b) => /^(נטו|ברוטו)$/.test((b as HTMLElement).innerText.trim()) && b.getBoundingClientRect().bottom <= innerHeight).length);
    expect(nb).toBe(0);
    // §9.2: above the fold, no button that does not change the grid (the chips, the views, the cells, the fee row and the guard lines do)
    const stray = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a[href]')].filter((b) => {
      const r = b.getBoundingClientRect(); if (!r.height || r.top >= innerHeight || r.bottom <= 0) return false;
      return !b.closest('#views, .trackbar, #month-grid, .gline, #cross-line, #product-line, #old-line, #similar, header, nav, .cmp-insight');
    }).map((b) => b.innerText.trim() || b.id));
    expect(stray, 'buttons above the fold that do not change the grid').toEqual([]);
    if (FIX10) {
      expect(r1.map(norm)).toEqual(['−1.44%', '−0.72%', '−0.73%']);  // the published MONTHLY_YIELD, gross (owner 26.11.26)
      expect(norm(await page.locator('#month-grid tbody tr:first-child th').innerText())).toBe('אוקטובר 26');
      expect(norm(await page.locator('#month-insight').innerText())).toBe('באוקטובר כולם ירדו: הראל ומנורה הכי פחות, מגדל הכי הרבה. הכי הרבה בשנה האחרונה: הראל, +10.5%.');
      for (const v of ['₪560', '₪550', '₪610']) expect(fee).toContain(v);
      const half = norm(await page.locator('#month-grid tfoot tr:nth-child(1)').innerText()), year = norm(await page.locator('#month-grid tfoot tr:nth-child(2)').innerText());
      expect(half).toMatch(/\+1\.4%.*\+2\.4%.*\+2\.4%/);
      expect(year).toMatch(/\+9\.2%.*\+10\.5%.*\+10\.2%/);
    }
    expect(await smallTargets(page), 'touch targets ≥ 44 / 32 px').toEqual([]);
    await noErrors(errors);
  });

  test('P3 + a fourth track: short month names, "%" kept, ≤ 1.75 screens', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P4}`);
    const r1 = await firstRow(page);
    expect(r1.length).toBe(4);
    expect(r1.every((t) => t.endsWith('%')), `"%" on the first row up to four columns: ${r1}`).toBe(true);
    if (FIX10) expect(norm(await page.locator('#month-grid tbody tr:first-child th').innerText())).toBe('אוק׳ 26');
    expect(await screens(page)).toBeLessThanOrEqual(1.75);
    expect(await sideways(page)).toBeLessThanOrEqual(1);
    expect(await page.locator('#add-track').count(), 'no "＋ מסלול" at the saver cap of four').toBe(0);
    await noErrors(errors);
  });

  test('X2 saver: risk banner, no marks, last year above the fold (C5)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${X2}`);
    expect(await page.locator('#month-grid .best').count(), 'no "best" mark across risk levels').toBe(0);
    const banner = page.locator('#cross-line');
    await expect(banner).toBeVisible();
    expect((await banner.boundingBox())!.height, 'the banner is one line').toBeLessThanOrEqual(48);
    expect(await inFirst(page, '#month-grid tfoot tr:nth-child(2)'), '"שנה אחרונה" in the first screen').toBe(true);
    expect(norm(await page.locator('#month-grid tfoot tr:nth-child(2) th').innerText())).toContain('שנה אחרונה');
    const subs = await page.$$eval('#month-grid thead th small', (s) => s.map((x) => (x as HTMLElement).innerText));
    expect(subs.filter((s) => /מניות/.test(s)).length, 'equity share under each column head').toBe(2);
    expect(await screens(page)).toBeLessThanOrEqual(1.5);
    expect(await sideways(page)).toBeLessThanOrEqual(1);
    expect(await page.locator('main').innerText()).not.toContain('אינה בעלת משמעות');
    expect(await smallTargets(page)).toEqual([]);
    await noErrors(errors);
  });

  test('G3 saver: gemel lehashkaa fits the same budget', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${G3}`);
    for (const sel of ['#month-grid tbody tr:nth-child(6)', '#month-grid tfoot tr:last-child', '#month-insight']) expect(await inFirst(page, sel), `${sel} in the first screen`).toBe(true);
    expect(await screens(page)).toBeLessThanOrEqual(1.5);
    expect(await sideways(page)).toBeLessThanOrEqual(1);
    if (FIX10) for (const v of ['₪620', '₪550', '₪590']) expect(norm(await page.locator('#fee-line').innerText())).toContain(v);
    expect(await smallTargets(page)).toEqual([]);
    await noErrors(errors);
  });

  test('ranges: 12 months and more, calendar years and more (C1)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P3}`);
    await page.locator('#views [role=tab]', { hasText: '12 חודשים' }).click();
    await expect(page.locator('#month-grid tbody tr')).toHaveCount(12);
    expect(page.url()).toContain('r=12');
    await page.locator('#more-months').click();
    await expect(page.locator('#month-grid tbody tr')).toHaveCount(18);
    await page.locator('#views [role=tab]', { hasText: 'שנים' }).click();
    await expect(page.locator('#month-grid tbody tr')).toHaveCount(5);
    const y1 = norm(await page.locator('#month-grid tbody tr:first-child th').innerText());
    expect(y1).toContain(String(Math.floor(ASOF / 100)));
    if (ASOF % 100 !== 12) expect(y1, 'the partial year says "עד <month>"').toMatch(/עד /);
    await page.locator('#more-years').click();
    await expect(page.locator('#month-grid tbody tr')).toHaveCount(12);
    if (FIX10) {
      const y2025 = norm(await page.locator('#month-grid tbody tr', { has: page.locator('th', { hasText: /^2025$/ }) }).innerText());
      expect(y2025).toMatch(/\+15\.6%?.*\+14\.5%?.*\+16\.6%?/);
    }
    await noErrors(errors);
  });
});

test.describe('sheets (C2, C4, C5, C7, C10, D6)', () => {
  test('month sheet: a cell opens the month, the older button steps back (C2)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P3}`);
    await page.locator('#month-grid tbody tr:first-child td .mg-cell').first().click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    if (FIX10) await expect(d.locator('h2')).toContainText('אוקטובר 2026');
    await expect(d.locator('.ms-bar:not(.avg):not(.skel)')).toHaveCount(3);
    await expect(d.locator('.ms-bar.avg')).toContainText('ממוצע הסוג');
    const t0 = await d.locator('h2').innerText();
    await page.locator('#month-older').click();
    await expect(d.locator('h2')).not.toHaveText(t0);
    if (FIX10) await expect(d.locator('h2')).toContainText('ספטמבר 2026');
    expect(await smallTargets(page, '[role=dialog]')).toEqual([]);
    await noErrors(errors);
  });

  test('fee sheet: the switch changes the sheet and the row follows (C4)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P3}`);
    const before = norm(await page.locator('#fee-line').innerText());
    await page.locator('#fee-line .mg-sumlbl').click();
    const d = dialog(page);
    await expect(d.locator('h2')).toContainText('דמי ניהול, בשקלים');
    await expect(d).toContainText('על חיסכון של 100,000 ש״ח, לשנה אחת');
    const cells = () => d.locator('#fee-table tbody td').allInnerTexts().then((a) => a.map(norm));
    if (FIX10) expect(await cells()).toEqual(['560', '550', '610']);
    await d.getByRole('button', { name: 'בלי הפקדות' }).click();
    if (FIX10) await expect.poll(cells).toEqual(['140', '160', '150']);
    else await expect.poll(cells).not.toEqual([]);
    await page.goBack();
    await expect(page.locator('[role=dialog]')).toHaveCount(0);
    const after = norm(await page.locator('#fee-line').innerText());
    expect(after, 'the table row follows the sheet after closing').not.toBe(before);
    if (FIX10) for (const v of ['₪140', '₪160', '₪150']) expect(after).toContain(v);
    await noErrors(errors);
  });

  test('risk note: "עוד ›" explains why there is no winner (C5)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${X2}`);
    await page.locator('#cross-line').click();
    const d = dialog(page);
    await expect(d).toContainText('למה אין כאן ״מי הגבוה״?');
    if (FIX10) { await expect(d).toContainText('−5.30%'); await expect(d).toContainText('−3.12%'); }
    expect(await d.innerText()).not.toContain('אינה בעלת משמעות');
    await noErrors(errors);
  });

  test('track sheet: chip → sheet with the fund number; "הסרה" removes the column (C7)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P3}`);
    await page.locator('.trackbar .tchip:not(.add)').first().click();
    const d = dialog(page);
    await expect(d).toContainText('מס׳ קופה');
    for (const s of ['כמה הרוויח', 'כמה זה עולה', 'כמה זה עולה ויורד', 'גודל']) await expect(d).toContainText(s);
    await expect(d).not.toContainText('למקצוענים');
    await page.locator('#track-remove').click();
    await expect(page.locator('[role=dialog]')).toHaveCount(0);
    await expect.poll(() => keysOf(page).length).toBe(2);
    await expect(page.locator('#month-grid thead th:not(.m)')).toHaveCount(2);
    await noErrors(errors);
  });

  test('similar chips add a column in one tap; at the cap neither chips nor "＋ מסלול" (C7)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P3}`);
    const chip = page.locator('#similar .pk-chip').first();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect.poll(() => keysOf(page).length).toBe(4);
    await expect(page.locator('#month-grid thead th:not(.m)')).toHaveCount(4);
    await expect(page.locator('#similar')).toHaveCount(0);
    await expect(page.locator('#add-track')).toHaveCount(0);
    await noErrors(errors);
  });

  test('share: WhatsApp link, and the copied link reopens the same view (C10)', async ({ page, context }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P3}&r=12`);
    expect(await page.locator('#wa').getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/);
    await page.locator('#share').click();
    const d = dialog(page);
    const url = norm(await d.locator('#share-url').innerText());
    expect(url).toContain(`k=${P3}`);
    expect(url).not.toContain('sheet=');
    expect(await d.locator('#share-wa').getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/);
    const p2 = await context.newPage();   // a fresh page: no navigation after the sheet's history (WebKit, see the note at the top)
    await p2.goto(new URL(url).pathname + new URL(url).search, { waitUntil: 'networkidle' });
    await settled(p2);
    expect(keysOf(p2).join()).toBe(P3);
    await expect(p2.locator('#month-grid tbody tr')).toHaveCount(12);
    await p2.close();
    await noErrors(errors);
  });

  test('"איך מחשבים?": returns are gross, before fees; no basis switch (owner 26.11.26)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P3}&b=net`);  // an old net link renders gross
    await expect(page.locator('#stamp')).toContainText('תשואה ברוטו, כפי שמפורסמת');
    await page.locator('#stamp button', { hasText: 'איך מחשבים?' }).click();
    const d = dialog(page);
    await expect(d.locator('#basis-switch')).toHaveCount(0);
    await expect(d).toContainText('לפני דמי ניהול');
    expect(await d.innerText()).not.toMatch(/נטו|אחרי דמי ניהול/);
    expect(await page.locator('main').innerText()).not.toMatch(/נטו|אחרי דמי ניהול/);
    await noErrors(errors);
  });
});

test.describe('long view (C8)', () => {
  test('"שנה אחרונה" changes the board; dragging on the chart changes the readout', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, `k=${P3}&v=long`, '#lens-long #board');
    const board = page.locator('#board');
    await expect(board).toBeVisible();
    await page.waitForSelector('#lens-long canvas', { timeout: 15_000 });
    const b0 = norm(await board.innerText());
    const per = page.locator('#long-per button', { hasText: 'שנה אחרונה' });
    if ((await per.getAttribute('aria-pressed')) === 'true') await page.locator('#long-per button').nth(1).click();
    else await per.click();
    await expect.poll(async () => norm(await board.innerText()), { message: 'the board follows the period' }).not.toBe(b0);
    // scrub the chart: the readout above it follows the finger
    const plot = page.locator('#lens-long .cl-plot');
    await plot.scrollIntoViewIfNeeded();
    const box = (await plot.boundingBox())!;
    const ro = page.locator('#readout');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.15, y);
    await page.waitForTimeout(300);
    const r1 = norm(await ro.innerText());
    await page.mouse.move(box.x + box.width * 0.85, y, { steps: 8 });
    await expect.poll(async () => norm(await ro.innerText()), { message: 'the readout follows the pointer' }).not.toBe(r1);
    expect(await sideways(page)).toBeLessThanOrEqual(1);
    await noErrors(errors);
  });
});

test.describe('entry, picker and ways in (C6, C11, C13, C14)', () => {
  test('six taps, no typing, the search always visible (C6)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, '', '#cmp-empty');
    const pkq = async (when: string) => {
      const b = await page.locator('#pkq').boundingBox();
      expect(!!b && b.y >= 0 && b.y + b.height <= VH, `#pkq visible ${when}`).toBe(true);
    };
    let taps = 0;
    await page.locator('#cmp-prods .pk-prod', { hasText: 'פנסיה' }).first().click(); taps++;
    await page.waitForSelector('#pk-step2'); await pkq('after the product tile');
    await page.locator('#picker .pk-chip', { hasText: /^כללי/ }).first().click(); taps++;
    await page.waitForSelector('#pk-companies'); await pkq('after the track chip');
    for (const co of ['מגדל', 'הראל', 'מנורה']) {
      await page.locator('#pk-companies .pk-co', { hasText: co }).first().click(); taps++;
      await page.waitForTimeout(250); await pkq(`after ${co}`);
      if (co === 'מגדל') await expect(page.getByText('להשוות למסלול אחר של מגדל')).toBeVisible();
    }
    await expect(page.locator('#pk-go')).toHaveText('להשוואה · 3 מסלולים');
    await page.locator('#pk-go').click(); taps++;
    await settled(page);
    expect(taps).toBe(6);
    expect(keysOf(page).length).toBe(3);
    await expect(page.locator('[role=dialog]')).toHaveCount(0);
    await noErrors(errors);
  });

  test('gemel lehashkaa general: every company tile in the sheet\'s first screen (C6)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, '', '#cmp-empty');
    await page.locator('#cmp-prods .pk-prod', { hasText: 'גמל להשקעה' }).first().click();
    await page.locator('#picker .pk-chip', { hasText: /^כללי/ }).first().click();
    await page.waitForSelector('#pk-companies'); await page.waitForTimeout(600);
    const fit = await page.evaluate(() => {
      const body = document.getElementById('pk-body')!.getBoundingClientRect();
      const t = [...document.querySelectorAll('#pk-companies .pk-co')].map((e) => e.getBoundingClientRect());
      return { n: t.length, inside: t.filter((r) => r.top >= body.top - 0.5 && r.bottom <= body.bottom + 0.5).length };
    });
    expect(fit.n).toBeGreaterThanOrEqual(8);
    expect(fit.inside, 'tiles inside the sheet at its first screen').toBe(fit.n);
    expect(await smallTargets(page, '#picker')).toEqual([]);
    await noErrors(errors);
  });

  test('header search in the saver door: a company, and "X מול Y" (C11, C14)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await page.goto('/?door=saver', { waitUntil: 'networkidle' });
    const search = async (q: string) => {
      await page.locator('input[type=search][aria-label="חיפוש"]:visible').first().click();
      const layer = page.locator('.omni-full');
      await expect(layer).toBeVisible();
      await layer.getByRole('combobox').fill(q);
      const opt = layer.getByRole('option').first();
      await expect(opt).toBeVisible({ timeout: 15_000 });
      return opt;
    };
    const o1 = await search('הראל');
    expect(await o1.getAttribute('href')).toMatch(/^\/funds\//);
    await page.keyboard.press('Escape');
    await page.goto('/?door=saver', { waitUntil: 'networkidle' });
    const o2 = await search('מגדל כללי מול הראל כללי');
    await expect(o2).toContainText('להשוואה:');
    await o2.click();
    await expect(page).toHaveURL(/\/funds\/compare\?k=[gip]\d+,[gip]\d+/);
    await settled(page);
    expect(keysOf(page).length).toBe(2);
    await noErrors(errors);
  });

  test('saver home: the entry card and the fee link lead to compare (C13)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await page.goto('/?door=saver', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    expect(await inFirst(page, '#home-compare'), '"כמה הרוויח המסלול שלי?" in the first screen').toBe(true);
    await expect(page.locator('#home-compare')).toContainText('כמה הרוויח המסלול שלי?');
    expect(new URL(await page.locator('#home-compare').evaluate((a) => (a as HTMLAnchorElement).href)).pathname).toBe('/funds/compare');
    const fees = page.locator('#home-fees');
    await expect(fees).toHaveText('להשוות דמי ניהול בין מסלולים ›');
    expect(new URL(await fees.evaluate((a) => (a as HTMLAnchorElement).href)).pathname).toBe('/funds/compare');
    await page.locator('#home-compare').click();
    await expect(page).toHaveURL(/\/funds\/compare/);
    await settled(page);
    await noErrors(errors);
  });
});

test.describe('doors (D1–D4, B3)', () => {
  test('one first screen in every door; 4, 5, 5 tabs, none off-screen; Pro average column (D1, D4)', async ({ page }) => {
    const errors = await visitor(page, 'saver');
    const rows: Record<string, string> = {};
    for (const door of ['saver', 'agent', 'pro'] as Door[]) {
      await cmp(page, `k=${P3}&door=${door}`);
      rows[door] = (await firstRow(page)).map(norm).join(' ');
      const v = await page.evaluate(() => { const e = document.querySelector('#views')!; return { n: e.children.length, fits: e.scrollWidth <= e.clientWidth, on: [...e.children].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) }; });
      expect(v, `${door}: the view strip`).toEqual({ n: door === 'saver' ? 4 : 5, fits: true, on: true });
      expect(await sideways(page)).toBeLessThanOrEqual(1);
      if (door !== 'saver') expect(norm(await page.locator('#views [role=tab]').nth(4).innerText())).toBe(door === 'agent' ? 'להחלטה' : 'מקצועי');
      if (door === 'pro') {
        await expect(page.locator('#month-grid thead th.avg')).toHaveCount(1);
        expect(norm(await page.locator('#fee-line td.avg').innerText()), 'no invented average fee').toBe('—');
        expect(await screens(page), 'Pro with the average column').toBeLessThanOrEqual(1.6);
      }
    }
    expect(rows.agent).toBe(rows.saver);
    expect(rows.pro).toBe(rows.saver);
    await noErrors(errors);
  });

  test('agent "להחלטה": the decision rows, the client document and the way back (D2)', async ({ page }) => {
    const errors = await visitor(page, 'agent');
    await cmp(page, `k=${P3}&door=agent`);
    await page.locator('#views [role=tab]').nth(4).click();
    await page.waitForSelector('#dec-grid tbody tr');
    expect(page.url()).toContain('v=dec');
    const labels = (await page.$$eval('#dec-grid tbody th', (t) => t.map((x) => (x as HTMLElement).innerText))).map(norm);
    const want = ['דמי ניהול מצבירה', 'דמי ניהול מהפקדה', 'תשואה 5Y, שנתי', 'תשואה LTM', 'חשיפה למניות', 'שארפ', 'נכסים', 'מדד השירות', 'איזון אקטוארי', 'תביעות נכות שאושרו', 'קרן ברירת מחדל', 'קצבה בגיל 67'];
    expect(want.filter((w) => !labels.some((l) => l.includes(w))), 'decision rows missing').toEqual([]);
    expect(await page.locator('#dec-doc').evaluate((a) => (a as HTMLAnchorElement).getAttribute('href'))).toMatch(new RegExp(`^/funds/compare/print\\?k=${P3}`));
    await expect(page.locator('#lens-switch')).toHaveCount(0);
    const pill = page.locator('#simple-hint');
    await expect(pill).toHaveText('תצוגה פשוטה: חוסך ›');
    expect((await pill.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);  // 44 px in CSS; WebKit's box can read 43.99998 at a fractional y
    expect(await smallTargets(page, '#lens-dec')).toEqual([]);
    await pill.click();
    await page.waitForSelector('#month-grid tbody .mg-cell:not(.mg-skelcell)');
    expect(keysOf(page).join()).toBe(P3);
    await expect(page.locator('#views [role=tab]')).toHaveCount(4);
    await noErrors(errors);
  });

  test('agent: "מסמך ללקוח" opens the print route', async ({ page }) => {
    const errors = await visitor(page, 'agent');
    await cmp(page, `k=${P3}&door=agent&v=dec`, '#dec-grid tbody tr');
    await page.locator('#dec-doc').click();
    await expect(page).toHaveURL(/\/funds\/compare\/print\?k=/);
    await page.waitForLoadState('networkidle');
    expect((await page.locator('main').innerText()).length).toBeGreaterThan(400);
    await noErrors(errors);
  });

  test('Pro "מקצועי": the two-way switch, and every metric of the old Pro page in "סיכון" (D3)', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await visitor(page, 'pro');
    await cmp(page, `k=${P3}&door=pro`);
    await page.locator('#views [role=tab]', { hasText: 'מקצועי' }).click();
    await page.waitForSelector('#lens-dec');
    const sw = page.locator('#lens-switch button');
    await expect(sw).toHaveCount(2);
    expect((await sw.allInnerTexts()).map(norm)).toEqual(['להחלטה', 'סיכון']);
    for (const b of await sw.all()) { const r = (await b.boundingBox())!; expect(r.x >= 0 && r.x + r.width <= 390 && r.y + r.height <= VH).toBe(true); }
    await sw.nth(1).click();
    await page.waitForSelector('#risk-grid tbody tr');
    expect(page.url()).toContain('v=risk');
    await expect(page.locator('#views [role=tab].on')).toHaveText('מקצועי');
    const closed = page.locator('#lens-risk .cr-tg[aria-expanded="false"]');
    for (let i = 0; i < 20 && (await closed.count()) > 0; i++) { await closed.first().click(); await page.waitForTimeout(150); }
    await page.waitForTimeout(1500);
    const strip = (s: string) => norm(s).replace(/\s*[?↕]\s*$/g, '').trim();
    const txt = norm(await page.locator('#lens-risk').innerText());
    expect(PRO_LABELS.map(strip).filter((l) => l && !txt.includes(l)), 'metric labels of the Pro compare before the redesign, missing from "סיכון"').toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(1);
    await noErrors(errors);
  });

  // rollout B8 (rollout spec §9, §18.3): Pro's "מסלולים" now opens the screener (/funds/screen); compare stays one tap away from it
  test('Pro phone bar: "מסלולים" → /funds/screen (rollout B8), no "השוואה" to /industry (B3)', async ({ page }) => {
    const errors = await visitor(page, 'pro');
    await page.goto('/?door=pro', { waitUntil: 'networkidle' });
    const bar = page.getByRole('navigation', { name: 'ראשי' });
    const tracks = bar.getByRole('link', { name: 'מסלולים', exact: true });
    await expect(tracks).toBeVisible();
    expect(new URL(await tracks.evaluate((a) => (a as HTMLAnchorElement).href)).pathname).toBe('/funds/screen');
    const wrong = await bar.locator('a').evaluateAll((as) => as.filter((a) => (a as HTMLElement).innerText.trim() === 'השוואה' && /\/industry/.test((a as HTMLAnchorElement).getAttribute('href') ?? '')).length);
    expect(wrong).toBe(0);
    await tracks.click();
    await expect(page).toHaveURL(/\/funds\/screen/);
    await noErrors(errors);
  });
});

test.describe('global gate (§9.2, §10A.3 Global)', () => {
  test('reduced motion leaves no running animation; axe finds no serious violation on P3, X2, G3', async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await visitor(page, 'saver');
    for (const k of [P3, X2, G3]) {
      await cmp(page, `k=${k}`);
      expect(await running(page), `running animations on k=${k}`).toEqual([]);
      if (info.project.name.includes('chromium')) {   // axe in Chromium only (the engine of tests/a11y.spec.ts)
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
        const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        expect(bad, `axe on k=${k}`).toEqual([]);
      }
    }
    await noErrors(errors);
  });
});

/* Picker regression (review B1 P1, lane L3-e): every way into a comparison, in all three doors, lands on the grid with the chosen keys
   and no sheet left open; it stays there (a late popstate must not bounce it back); Back returns to the page the reader came from,
   never to a reopened picker. Each path runs in a fresh page (the WebKit note at the top). */
const CAP: Record<Door, number> = { saver: 4, agent: 6, pro: 8 };
for (const door of ['saver', 'agent', 'pro'] as Door[]) {
  test.describe(`picker regression · ${door}`, () => {
    const landed = async (page: Page, n: number) => {
      await page.waitForSelector('#month-grid tbody .mg-cell:not(.mg-skelcell)', { timeout: 15_000 });
      await page.waitForTimeout(600);
      const ks = keysOf(page);
      expect(ks.length, `grid with ${n} keys (${page.url()})`).toBe(n);
      expect(page.url()).not.toMatch(/sheet=/);
      await expect(page.locator('[role=dialog]')).toHaveCount(0);
      await page.waitForTimeout(1200);
      expect(keysOf(page).join(), 'still there 1.2 s later').toBe(ks.join());
      await expect(page.locator('[role=dialog]')).toHaveCount(0);
    };
    const backTo = async (page: Page, origin: string) => {
      await page.goBack(); await page.waitForTimeout(900);
      await expect(page.locator('[role=dialog]')).toHaveCount(0);
      expect(page.url()).not.toMatch(/sheet=picker/);
      expect(new URL(page.url()).pathname, 'Back returns to the origin').toBe(origin);
    };
    /** opens /funds, then moves to `to` the way the app's own links do (history push), so Back has an origin */
    const via = async (page: Page, to: string) => {
      await page.goto('/funds', { waitUntil: 'networkidle' });
      await page.evaluate((u) => { history.pushState(null, '', u); dispatchEvent(new PopStateEvent('popstate')); }, to);
      await page.waitForLoadState('networkidle'); await page.waitForTimeout(900);
    };

    test('home entry → tile → כללי → three companies → go; Back to home', async ({ page }) => {
      const errors = await visitor(page, door);
      await page.goto('/', { waitUntil: 'networkidle' });
      const entry = page.locator('#home-compare');
      const fromHome = (await entry.count()) > 0;
      if (fromHome) await entry.click(); else await page.goto('/funds/compare', { waitUntil: 'networkidle' });
      await settled(page, '#cmp-empty');
      await page.locator('#cmp-prods .pk-prod', { hasText: 'פנסיה' }).first().click();
      await page.locator('#picker .pk-chip', { hasText: /^כללי/ }).first().click();
      for (const co of ['מגדל', 'הראל', 'מנורה']) { await page.locator('#pk-companies .pk-co', { hasText: co }).first().click(); await page.waitForTimeout(150); }
      await page.locator('#pk-go').click();
      await landed(page, 3);
      if (fromHome) await backTo(page, '/');
      await noErrors(errors);
    });

    test('"＋ מסלול" on a comparison adds one company; Back to the origin', async ({ page }) => {
      const errors = await visitor(page, door);
      await via(page, `/funds/compare?k=${P3}`);
      await page.locator('#add-track').click();
      await page.locator('#pk-companies .pk-co:not(.on)').first().click(); await page.waitForTimeout(200);
      await page.locator('#pk-go').click();
      await landed(page, 4);
      await backTo(page, '/funds');
      await noErrors(errors);
    });

    test('typed search pick from the entry screen; Back to the origin', async ({ page }) => {
      const errors = await visitor(page, door);
      await via(page, '/funds/compare');
      await page.locator('#open-search').click(); await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.activeElement?.id), 'focus in the search field').toBe('pkq');
      await page.locator('#pkq').fill('הראל'); await page.waitForTimeout(600);
      await page.locator('#pkres .pk-row').first().click(); await page.waitForTimeout(400);
      await page.locator('#pk-companies .pk-co:not(.on)').first().click(); await page.waitForTimeout(200);
      await page.locator('#pk-go').click();
      await landed(page, 2);
      await backTo(page, '/funds');
      await noErrors(errors);
    });

    test('"X מול Y" pair from the entry screen; Back to the origin', async ({ page }) => {
      const errors = await visitor(page, door);
      await via(page, '/funds/compare');
      await page.locator('#open-search').click(); await page.waitForTimeout(300);
      await page.locator('#pkq').fill('מגדל כללי מול הראל כללי'); await page.waitForTimeout(700);
      await page.locator('#pk-pair .pk-sg').click();
      await landed(page, 2);
      await backTo(page, '/funds');
      await noErrors(errors);
    });

    test('the reader\'s own track: one tap from home (A2, C12) and the own fee labelled (O9)', async ({ page }) => {
      const errors = await visitor(page, door, [{ k: 'p2102', added: '2026-11-01', fee: 0.1, depfee: 1.0 }]);
      await page.goto('/', { waitUntil: 'networkidle' });
      const row = page.locator('#home-mine');
      if (await row.count()) {
        // rollout R1 (spec 8): the "my track" row states the month and the year and opens the card (the compare entry above keeps its route)
        await expect(row).toContainText('בשנה האחרונה');
        await row.click();
        await expect(page).toHaveURL(/\/funds\/p2102/);
        await expect(page.locator('#fee-line')).toContainText('לפי הדוח שלך');
        await backTo(page, '/');
      } else {
        await page.goto('/funds/compare', { waitUntil: 'networkidle' });
        await landed(page, 3);
        expect(keysOf(page).join(), 'the bare page opens on the saved track and the two largest peers').toBe('p2102,p2009,p2002');
      }
      await noErrors(errors);
    });

    test(`at the cap (${CAP[door]}) there is no "＋ מסלול"`, async ({ page }) => {
      const errors = await visitor(page, door);
      const ks = ['p2009', 'p2102', 'p2184', 'p9974', 'p2002', 'p2172', 'p9823', 'p9654'].slice(0, CAP[door]);
      await cmp(page, `k=${ks.join(',')}`);
      await expect(page.locator('#add-track')).toHaveCount(0);
      expect(await sideways(page), 'wide grids scroll in their box, not the page').toBeLessThanOrEqual(1);
      await noErrors(errors);
    });
  });
}
