import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/* S1 + S2 saver · /my/checkup, the annual check-up, on the phone and the desktop (Chrome projects): the empty state opens on the
   import; with products the three lines stand with a status word, an anchor and an action; the letter, the reminder and the saving;
   the moments list and the saver home lead here; /my stays under its 400-word cap; and no serious or critical axe violation, in both
   themes, on /my/checkup and the routes it touches. Not a visual snapshot (no baseline for this route). */

const PRODUCTS = [
  // comprehensive pension, own fees above the tender (0.25% / 1.5% vs 0.22% / 1%), three months of deposits with a gap in 08/26
  { k: 'p9757', added: '2026-11-01', imp: '2026-10-15', balance: 180000, monthly: 3330, fee: 0.25, depfee: 1.5, salary: 18000,
    deposits: [{ ym: '2026-07', employee: 1080, employer: 1170, severance: 1080 }, { ym: '2026-09', employee: 1080, employer: 1170, severance: 1080 }, { ym: '2026-10', employee: 1080, employer: 1170, severance: 1080 }] },
  // a השתלמות with its own fee
  { k: 'g13502', added: '2026-11-01', balance: 120000, monthly: 1570, fee: 0.6, depfee: 0 },
];
async function seed(page: Page, theme: 'phoenix' | 'dark', withProducts: boolean, extra: Record<string, unknown> = {}) {
  await page.addInitScript(({ t, mine, extra }) => {
    try {
      localStorage.setItem('theme2', t); localStorage.setItem('fox:seen', JSON.stringify('2099-01-01')); localStorage.setItem('fox:door', JSON.stringify('saver'));
      if (mine) { localStorage.setItem('fox:mine', JSON.stringify(mine)); localStorage.setItem('fox:my:age', '52'); localStorage.setItem('fox:my:sex', JSON.stringify('f')); }
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, JSON.stringify(v));
    } catch { /* blocked */ }
  }, { t: theme, mine: withProducts ? PRODUCTS : null, extra });
}
async function go(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !/טוען/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
async function axe(page: Page) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test('check-up: empty state opens on the import', async ({ page }) => {
  await seed(page, 'phoenix', false);
  await go(page, '/my/checkup');
  await expect(page.locator('h1')).toContainText('הבדיקה השנתית');
  await expect(page.locator('#mk-h')).toBeVisible();
  await expect(page.locator('.ck-line')).toHaveCount(0);
  expect(await axe(page), 'axe, empty').toEqual([]);
});

test('check-up: three lines, anchors, letter, reminder, saving', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seed(page, 'phoenix', true);
  await go(page, '/my/checkup');
  const lines = page.locator('.ck-line');
  await expect(lines).toHaveCount(3);
  // 1. fees: red against the default-fund price, with the source of the anchor
  await expect(lines.nth(0).locator('.ck-st')).toContainText('לטיפול');
  await expect(lines.nth(0).locator('.ck-src')).toContainText('קרנות ברירת המחדל');
  await expect(lines.nth(0)).toContainText('ההליך הרביעי');
  // a woman of 52 (born 1974) retires at 65, not 67
  await expect(page.locator('.ck-ret b')).toHaveText('65');
  // 2. deposits: 08/26 is a real gap (the rows carry salary months; none is payment-dated): red, with the employer letter
  await expect(lines.nth(1).locator('.ck-st')).toContainText('לטיפול');
  await expect(lines.nth(1)).toContainText('08/2026');
  await expect(lines.nth(1).locator('.sv-script-t')).toContainText('לא נמצאה הפקדה: 08/2026');
  // 3. the age: the age track "עד 50" at 52 is red
  await expect(lines.nth(2).locator('.ck-st')).toContainText('לטיפול');
  await expect(lines.nth(2)).toContainText('"50-60"');
  // no ISO dates on screen, no slash-gendered words
  const txt = await page.locator('main').innerText();
  expect(txt).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  expect(txt).not.toMatch(/חוסך\/ת|\/ת\b/);
  // the letter cites the anchors; copying starts the 30-day loop in this browser
  const letter = lines.nth(0).locator('.sv-script-t');
  await expect(letter).toContainText('אבקש להפחית');
  await expect(letter).toContainText('התקרה בחוק');
  await expect(lines.nth(0).locator('a', { hasText: 'WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
  await expect(lines.nth(0).locator('a', { hasText: 'דוא"ל' })).toHaveAttribute('href', /^mailto:\?subject=/);
  const [dl] = await Promise.all([page.waitForEvent('download'), lines.nth(0).locator('button', { hasText: 'תזכורת בעוד 30 יום' }).click()]);
  expect(dl.suggestedFilename()).toBe('fox-tizkoret.ics');
  const negos = await page.evaluate(() => JSON.parse(localStorage.getItem('fox:my:nego') ?? '[]'));
  expect(negos.length).toBe(1);
  expect(negos[0].k).toBe('p9757');
  // the new fees: the saving and the share card
  await lines.nth(0).locator('button', { hasText: 'הזינו את דמי הניהול החדשים' }).click();
  const form = lines.nth(0).locator('form.ck-new');
  await form.locator('input').nth(0).fill('1');
  await form.locator('input').nth(1).fill('0.22');
  await form.locator('button[type="submit"]').click();
  // the pension line turns green and its form closes; the saving stands at the top, in ₪ to retirement, with the share card
  const saved = page.locator('.ck-saved');
  await expect(saved.locator('.ck-win-t')).toContainText('חסכתם כ-');
  await expect(saved.locator('.ck-win-t')).toContainText('עד הפרישה');
  await expect(saved.locator('.ck-share button')).toBeVisible();
  const mine = await page.evaluate(() => JSON.parse(localStorage.getItem('fox:mine') ?? '[]'));
  expect(mine.find((m: { k: string }) => m.k === 'p9757').fee).toBe(0.22);
  // the page reads sideways on the phone without scrolling
  const side = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(side, 'sideways scroll').toBeLessThanOrEqual(1);
  expect(errors, 'page errors').toEqual([]);
  if (info.project.name === 'phone') await page.screenshot({ path: test.info().outputPath('checkup-phone.png'), fullPage: true });
});

test('check-up: the reminder is due after 30 days', async ({ page }) => {
  await seed(page, 'phoenix', true, { 'fox:my:nego': [{ k: 'p9757', at: '2026-01-01', before: { fee: 0.25, depfee: 1.5 }, after: null }] });
  await go(page, '/my/checkup');
  await expect(page.locator('.ck-due')).toContainText('עברו 30 יום');
  await go(page, '/my');
  await expect(page.locator('.sv-ck')).toContainText('עברו 30 יום');
});

test('entries: the saver home and the moments lead to the check-up; /my stays under 400 words', async ({ page }) => {
  await seed(page, 'phoenix', true);
  await go(page, '/?door=saver');
  await expect(page.locator('a.door-go.primary', { hasText: 'ייבוא מהמסלקה' })).toHaveAttribute('href', '/my/checkup');
  await go(page, '/my/moment');
  await expect(page.locator('a[href="/my/checkup"]', { hasText: 'הדוח השנתי הגיע' })).toBeVisible();
  // the cap is measured as tests/webkit.spec.ts measures it: two products, folded
  await page.evaluate(() => localStorage.setItem('fox:mine', JSON.stringify([
    { k: 'p9757', added: '2026-11-01', balance: 180000, monthly: 4000, fee: 0.25, depfee: 1.5 },
    { k: 'g13502', added: '2026-11-01', balance: 120000, monthly: 1570, fee: 0.6 }])));
  await page.evaluate(() => { localStorage.removeItem('fox:my:age'); localStorage.removeItem('fox:my:sex'); });
  await page.addInitScript(() => { localStorage.removeItem('fox:my:age'); localStorage.removeItem('fox:my:sex'); localStorage.setItem('fox:mine', JSON.stringify([
    { k: 'p9757', added: '2026-11-01', balance: 180000, monthly: 4000, fee: 0.25, depfee: 1.5 },
    { k: 'g13502', added: '2026-11-01', balance: 120000, monthly: 1570, fee: 0.6 }])); });
  await go(page, '/my');
  await expect(page.locator('a.sv-ck')).toHaveAttribute('href', '/my/checkup');
  const words = await page.evaluate(() => (document.querySelector('main')!.innerText.match(/\S+/g) ?? []).length);
  expect(words, '/my with two products').toBeLessThan(400);
});

for (const theme of ['phoenix', 'dark'] as const) {
  for (const route of ['/my/checkup', '/my', '/my/moment', '/', '/my/statement']) {
    test(`a11y ${route} with products · ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name === 'phone' && theme === 'dark', 'contrast per theme on the desktop; structure on the phone in the light theme');
      await seed(page, theme, true);
      await go(page, route);
      expect(await axe(page), `axe ${route}`).toEqual([]);
    });
  }
}
