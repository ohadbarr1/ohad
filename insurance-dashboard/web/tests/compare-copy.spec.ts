import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { G3, P3, X2, cmp, dialog, settled, visibleText, visitor } from './compare-kit';

/* T2 · copy lint of the saver door on track compare (spec §7, §9.2, §10A.3 T2). In the saver door, the visible words of the entry screen,
   the picker, P3, X2, G3, the long view and every sheet a saver can open match none of the professional shorthand of §10A.3 T2 (both
   quote forms of the Hebrew abbreviations), and carry no Latin letters other than "fox" and the funds' own names (§9.2). Links shown as
   text (the share sheet's address) are not words. Sheets open by their deep link (?sheet=…), each in a fresh page. */
// the words are the same in both engines: the lint runs in WebKit (the owner's engine) only, to keep the CI run short
test.skip(({ browserName }) => browserName !== 'webkit', 'copy is engine-independent; linted in WebKit');

const BANNED = /נ["״]ב|נ["״]א|ד["״]נ|LTM|YTD|\b\d+[YM]\b|צמודים|איזון אקטוארי|מקדם|נק׳ אחוז|קטגוריה/g;
const funds: { name?: string; track?: string; mgr?: string }[] = JSON.parse(readFileSync(new URL('../public/data/funds.json', import.meta.url), 'utf8')).funds;
const LATIN_OK = new Set(['fox', ...funds.flatMap((f) => `${f.name ?? ''} ${f.track ?? ''} ${f.mgr ?? ''}`.match(/[A-Za-z]+/g) ?? []).map((w) => w.toLowerCase())]);

async function lint(page: Page, where: string) {
  const text = (await visibleText(page)).replace(/https?:\/\/\S+/g, ' ');
  expect([...new Set(text.match(BANNED) ?? [])], `saver shorthand on ${where}`).toEqual([]);
  const latin = [...new Set((text.match(/[A-Za-z]+/g) ?? []).filter((w) => !LATIN_OK.has(w.toLowerCase())))];
  expect(latin, `Latin words on ${where}`).toEqual([]);
}

test('saver door: entry screen and every step of the picker', async ({ page }) => {
  const errors = await visitor(page, 'saver');
  await cmp(page, '', '#cmp-empty');
  await lint(page, 'the entry screen');
  await page.locator('#cmp-prods .pk-prod', { hasText: 'פנסיה' }).first().click();
  await page.waitForSelector('#pk-step2'); await lint(page, 'picker step 2');
  await page.locator('#picker .pk-chip', { hasText: /^כללי/ }).first().click();
  await page.waitForSelector('#pk-companies'); await lint(page, 'picker step 3');
  await page.locator('#pk-companies .pk-co').first().click(); await page.waitForTimeout(300);
  await lint(page, 'picker after a pick');
  await page.locator('#pk-sib').click(); await page.waitForSelector('#pk-sibs'); await lint(page, 'the house\'s other tracks');
  await page.locator('#pkq').fill('מגדל'); await page.waitForTimeout(600); await lint(page, 'picker search results');
  await page.locator('#pkq').fill('מגדל פנסיה כללי מול מגדל מניות'); await page.waitForTimeout(600); await lint(page, 'picker pair card');
  expect(errors).toEqual([]);
});

const VIEWS: [string, string, string?][] = [
  ['P3', `k=${P3}`], ['P3, 12 months', `k=${P3}&r=12`], ['P3, years', `k=${P3}&r=y`], ['X2', `k=${X2}`], ['G3', `k=${G3}`],
  ['P3, long view', `k=${P3}&v=long`, '#lens-long #board'], ['X2, long view', `k=${X2}&v=long`, '#lens-long #board'], ['G3, long view', `k=${G3}&v=long`, '#lens-long #board'],
  ['mixed products', 'k=p2102,g7936'],
];
for (const [name, q, what] of VIEWS) {
  test(`saver door: ${name}`, async ({ page }) => {
    const errors = await visitor(page, 'saver');
    await cmp(page, q, what);
    const ext = page.locator('#extremes summary');
    if (await ext.count()) { await ext.click(); await page.waitForTimeout(200); }   // the collapsed block is a saver layer too
    await lint(page, name);
    expect(errors).toEqual([]);
  });
}

const SHEETS: [string, string][] = [
  ['month sheet', `k=${P3}&sheet=month:202610`], ['year sheet', `k=${P3}&r=y&sheet=year:2025`], ['fee sheet', `k=${P3}&sheet=fee`],
  ['fee sheet, gemel', `k=${G3}&sheet=fee`], ['track sheet', `k=${P3}&sheet=track:p2172`], ['track sheet, gemel', `k=${G3}&sheet=track:g7936`],
  ['risk note', `k=${X2}&sheet=risknote`], ['share sheet', `k=${P3}&sheet=share`], ['how it is computed', `k=${P3}&sheet=why`],
  ['tax and withdrawal rules', `k=p2102,g7936&sheet=rules`], ['picker on a comparison', `k=${P3}&sheet=picker`],
];
test('saver door: every sheet', async ({ context, page }) => {
  test.setTimeout(120_000);
  const errors = await visitor(page, 'saver');
  await cmp(page, `k=${P3}`);   // the door and the "seen" flag are now stored for this context
  for (const [name, q] of SHEETS) {
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await p.goto(`/funds/compare?${q}`, { waitUntil: 'networkidle' });
    await settled(p, '[role=dialog]');
    await expect(dialog(p), `${name} opens from its link`).toBeVisible();
    const folded = dialog(p).locator('details:not([open]) > summary');   // folded sections are read too
    for (let i = 0; i < 12 && (await folded.count()) > 0; i++) await folded.first().click();
    await lint(p, name);
    if (name === 'fee sheet') {
      const off = dialog(p).getByRole('button', { name: 'בלי הפקדות' });
      if (await off.count()) { await off.click(); await p.waitForTimeout(300); await lint(p, 'fee sheet without deposits'); }
    }
    await p.close();
  }
  expect(errors).toEqual([]);
});
