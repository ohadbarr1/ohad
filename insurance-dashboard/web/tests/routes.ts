/** The routes the visual smoke and the accessibility run cover: one per signature page. */
export const ROUTES: [string, string][] = [
  ['home', '/'],
  ['company', '/company/phoenix'],
  ['financials', '/company/phoenix/financials'],
  ['ifrs17', '/company/phoenix/ifrs17'],
  ['peers', '/industry/peers'],
  ['csm', '/industry/csm'],
  ['savings', '/savings'],
  ['funds', '/funds'],
  ['fund', '/funds/p2009'],
  ['managers', '/managers'],
  ['valuation', '/valuation/phoenix'],
  ['calendar', '/calendar'],
  ['search', '/search?q=%D7%A8%D7%9B%D7%99%D7%91%20%D7%94%D7%A4%D7%A1%D7%93'],
  ['data', '/data'],
  ['positions', '/positions'],
  ['warroom', '/warroom'],
];
export const THEMES = ['phoenix', 'dark'] as const;

/** Opens a route in a theme and waits until its data has arrived (no "טוען" placeholder left). */
export async function open(page: import('@playwright/test').Page, route: string, theme: (typeof THEMES)[number]) {
  await page.addInitScript((t) => { try { localStorage.setItem('theme2', t); localStorage.setItem('fox:seen', JSON.stringify('2099-01-01')); } catch { /* blocked */ } }, theme);
  await page.goto(route, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !/טוען/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
