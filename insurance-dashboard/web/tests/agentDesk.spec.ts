import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/* fox 3.0 phase 2 · the agent desk in a real browser (phone 390px and desktop): accessibility (axe, WCAG 2.1 AA, serious/critical)
   on /clients (empty and with a book), /clients/new at each step; the whole wizard on a fixture (the clearing house's protected zip →
   the review → a candidate → the document), timed; the agent's home landing in the wizard; the encrypted backup and its restore in a
   fresh browser. Synthetic fixtures only (tests/fixtures/maslaka, password fox-2026). Nothing is sent anywhere. */
const FIX = join(process.cwd(), 'tests', 'fixtures', 'maslaka');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yearAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return ymd(d); };

/** a book of two folders on published tracks (p2009: a comprehensive pension fund with a negative actuarial quarter) */
const BOOK = () => ({ kind: 'fox-clients', v: 2, folders: [
  { id: 'seed-0001', label: 'לקוח לדוגמה א', keys: ['p2009'], b: 'net', tags: { p2009: 'קיים' }, fields: {}, note: '', created: yearAgo(), updated: yearAgo(), snap: null,
    held: [{ k: 'p2009', typeHe: 'קרן פנסיה', provider: 'מנורה מבטחים', plan: null, track: 'כללי', balance: 180000, monthly: 2200, fee: 0.2, feeHow: null, depfee: 1.5, depHow: null, asof: '2026-09-30', covers: [], note: null }] },
  { id: 'seed-0002', label: 'לקוח לדוגמה ב', keys: ['g12535'], b: 'net', tags: { g12535: 'קיים' }, fields: {}, note: '', created: '2026-10-01', updated: '2026-10-01', snap: null,
    held: [{ k: 'g12535', typeHe: 'קרן השתלמות', provider: 'מור', plan: null, track: 'כללי', balance: 84000, monthly: 1500, fee: 0.6, feeHow: null, depfee: 0, depHow: null, asof: '2026-09-30', covers: [], note: null }] },
] });

async function setup(page: Page, opts: { book?: boolean; theme?: string } = {}) {
  await page.addInitScript(([book, theme]) => {
    try {
      localStorage.setItem('theme2', theme as string); localStorage.setItem('fox:seen', JSON.stringify('2099-01-01')); localStorage.setItem('fox:door', JSON.stringify('agent'));
      if (book && !localStorage.getItem('fox:seeded')) { localStorage.setItem('fox:clients', book as string); localStorage.setItem('fox:seeded', '1'); }
    } catch { /* blocked */ }
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => { (window as unknown as { __prints: number }).__prints++; };
  }, [opts.book ? JSON.stringify(BOOK()) : '', opts.theme ?? 'phoenix']);
}
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !/טוען|בודק את/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(300);
}
async function axe(page: Page, what: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}@${what} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(bad, `accessibility on ${what}`).toEqual([]);
}
// against the configured viewport: a phone browser widens innerWidth to fit content that overflows
const noSideScroll = async (page: Page, what: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth), `no sideways scroll on ${what}`).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 1);
const noIso = async (page: Page, what: string) => expect((await page.locator('main').innerText()).match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/g) ?? [], `no ISO date on ${what}`).toEqual([]);

for (const theme of ['phoenix', 'dark']) {
  test(`a11y /clients and /clients/new, empty · ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name === 'phone' && theme === 'dark', 'contrast per theme on the desktop');
    await setup(page, { theme });
    for (const r of ['/clients', '/clients/new']) { await page.goto(r); await settle(page); await axe(page, r); await noSideScroll(page, r); await noIso(page, r); }
  });
  test(`a11y /clients with a book: call list, reviews, backup · ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name === 'phone' && theme === 'dark', 'contrast per theme on the desktop');
    await setup(page, { book: true, theme });
    await page.goto('/clients'); await settle(page);
    await expect(page.getByRole('heading', { name: 'למי להתקשר החודש' })).toBeVisible();
    await expect(page.locator('.calls .call').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /לסקירה החודש/ })).toBeVisible();
    await expect(page.getByText('עוד לא נשמר גיבוי').first()).toBeVisible();
    await page.locator('.call-msg summary').first().click();
    await axe(page, '/clients (book)'); await noSideScroll(page, '/clients (book)'); await noIso(page, '/clients (book)');
  });
}

test('the wizard on a fixture: protected zip → ניוד → הנמקה document, timed', async ({ page }, info) => {
  await setup(page);
  const t0 = Date.now();
  await page.goto('/clients/new'); await settle(page);
  const steps: [string, number][] = [];
  const lap = (s: string) => steps.push([s, Date.now() - t0]);
  // 1: the zip as the clearing house sends it, then its password
  await page.locator('input[type=file]').first().setInputFiles([join(FIX, 'fixture-zipcrypto.zip'), join(FIX, 'fixture-mor.xml')]);
  await page.getByLabel('הסיסמה לקובץ', { exact: false }).fill('fox-2026');
  await page.getByRole('button', { name: 'פתיחת הקובץ' }).click();
  await expect(page.locator('.ci-sum')).toContainText('8 מוצרים בקובץ');
  await expect(page.locator('.ci-sum')).toContainText('בלי מסלול באתר');
  await page.getByLabel('שם או כינוי לתיק החדש').fill('בדיקה ' + info.project.name);
  if (info.project.name === 'desktop') await axe(page, '/clients/new review');
  await page.getByRole('button', { name: /יצירת תיק והמשך לניוד/ }).click();
  lap('import');
  // 2: a candidate, the before/after, the why lines
  await expect(page.getByRole('heading', { name: /2\. ניוד/ })).toBeFocused();
  await page.locator('.wiz-opt').first().click();
  await expect(page.locator('.nyud-t tbody tr').first()).toBeVisible();
  await expect(page.locator('.wiz-why').first()).toContainText('מקור:');
  await noSideScroll(page, 'wizard step 2'); await noIso(page, 'wizard step 2');
  if (info.project.name === 'desktop') await axe(page, '/clients/new step 2');
  await page.getByRole('button', { name: /המשך: מסמך ההנמקה/ }).click();
  lap('nyud');
  // 3: the settings, then the document (print stubbed)
  await expect(page.getByRole('heading', { name: /3\. מסמך ההנמקה/ })).toBeFocused();
  if (info.project.name === 'desktop') await axe(page, '/clients/new step 3');
  await noIso(page, 'wizard step 3');
  await page.getByRole('button', { name: 'שמירה בתיק והפקת PDF' }).click();
  await expect(page).toHaveURL(/\/funds\/compare\/print\?k=/);
  await expect(page.locator('.docbar')).toContainText('שלב 3 מתוך 3');
  await page.waitForFunction(() => (window as unknown as { __prints: number }).__prints > 0, null, { timeout: 20_000 });
  lap('pdf');
  const doc = await page.locator('.adoc-wrap').innerText();
  // the round-3 gap: the unmatched provident fund and the managers' policy are in the document (א.1 and חלק ד')
  expect(doc).toContain('לא נמצא מסלול תואם ב-fox');
  expect(doc).toContain('ביטוח מנהלים');
  expect(doc).toContain('חלק ד – טבלת סיכום');
  expect(doc).toContain('ניוד: לפני ואחרי');
  const book = await page.evaluate(() => JSON.parse(localStorage.getItem('fox:clients') ?? '{}'));
  const f = book.folders.find((x: { label: string }) => x.label.startsWith('בדיקה'));
  expect(f.held.length).toBe(8);
  expect(Object.values(f.tags)).toContain('מומלץ');
  expect(f.fields['meet:date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  console.log(`  wizard (${info.project.name}): ${steps.map(([s, ms]) => `${s} ${(ms / 1000).toFixed(1)} s`).join(' → ')} (automated clicks; the agent's reading time comes on top)`);
});

test('the agent home lands in the wizard at step 2', async ({ page }) => {
  await setup(page);
  await page.goto('/'); await settle(page);
  await page.locator('.dnew input[type=file]').setInputFiles(join(FIX, 'fixture-mor.xml'));
  await page.getByLabel('שם או כינוי לתיק החדש').fill('מהבית');
  await page.getByRole('button', { name: /יצירת תיק והמשך לניוד/ }).click();
  await expect(page).toHaveURL(/\/clients\/new$/);
  await expect(page.getByRole('heading', { name: /2\. ניוד.*מהבית/ })).toBeVisible();
});

test('encrypted backup, then a restore in a fresh browser', async ({ page, browser }) => {
  await setup(page, { book: true });
  await page.goto('/clients'); await settle(page);
  await page.locator('.bk').getByRole('button', { name: /גיבוי עכשיו/ }).click();
  await page.getByLabel('סיסמה לקובץ הגיבוי (8 תווים לפחות)').fill('correct horse');
  await page.getByLabel('שוב, לאימות').fill('correct horse');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'הורדת גיבוי מוצפן' }).click()]);
  const path = await dl.path();
  const text = readFileSync(path!, 'utf8');
  expect(JSON.parse(text).kind).toBe('fox-book-backup');
  expect(text).not.toContain('לקוח לדוגמה');
  await expect(page.locator('.bk-big').first()).toContainText('גיבוי אחרון: היום');
  const fresh = await browser.newContext({ baseURL: page.url().replace(/\/clients.*/, ''), viewport: page.viewportSize() ?? undefined });
  const p2 = await fresh.newPage();
  await setup(p2);
  await p2.goto('/clients'); await settle(p2);
  await p2.locator('.bk-rest input[type=file]').setInputFiles({ name: 'fox-book.backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await p2.getByLabel(/הסיסמה של/).fill('correct horse');
  await p2.getByRole('button', { name: 'שחזור', exact: true }).click();
  await expect(p2.getByText(/נוספו 2 תיקים/)).toBeVisible();
  await expect(p2.getByText('לקוח לדוגמה א').first()).toBeVisible();
  await fresh.close();
});
