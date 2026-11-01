/** The routes the visual smoke and the accessibility run cover: one per signature page. */
export const ROUTES: [string, string][] = [
  ['home', '/'],
  ['company', '/company/phoenix'],
  ['thesis', '/company/phoenix/thesis'],
  ['numbers', '/company/phoenix/numbers'],
  ['company-more', '/company/more'],
  ['financials', '/company/phoenix/financials'],
  ['ifrs17', '/company/phoenix/ifrs17'],
  ['peers', '/industry/peers'],
  ['csm', '/industry/csm'],
  ['savings', '/savings'],
  ['funds', '/funds'],                                   // F1: the "חיסכון" hub
  ['funds-screen', '/funds/screen?prod=%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA&track=%D7%9B%D7%9C%D7%9C%D7%99'],
  ['funds-screen-all', '/funds/screen?prod=all&track=all&fam=index'],
  ['funds-compare', '/funds/compare?k=p2009,g12531,i2081&b=net'],
  ['fund', '/funds/p2009'],
  ['funds-tools', '/funds/tools'],                                                  // F2 TOOLS
  ['funds-fees', '/funds/tools/fees'],
  ['funds-default', '/funds/default'],
  ['funds-trackers', '/funds/trackers?g=sp500&w=a3'],
  ['funds-rank', '/funds/rank?cat=%D7%92%D7%9E%D7%9C%20%7C%20%D7%A2%D7%93%2050'],
  ['funds-glide', '/funds/glide?prod=%D7%92%D7%9E%D7%9C'],
  ['funds-watch', '/funds/watch'],
  ['managers', '/managers'],
  ['valuation', '/valuation/phoenix'],
  ['calendar', '/calendar'],
  ['search', '/search?q=%D7%A8%D7%9B%D7%99%D7%91%20%D7%94%D7%A4%D7%A1%D7%93'],
  ['data', '/data'],
  ['positions', '/positions'],
  ['scenarios', '/scenarios'],
  ['scenarios-preset', '/scenarios?e=-25&cr=150'],
  ['regulation', '/warroom/regulation'],
  ['warroom', '/warroom'],
  ['capital', '/capital'],
  ['capital-preset', '/capital?s=eqdd&buf=5'],
  ['fragility', '/fragility'],
  ['fragility-detail', '/fragility?c=altshuler&s=flow&fee_watch=1'],
  ['expectations', '/expectations'],
  ['valuation-expectations', '/valuation/phoenix/expectations'],
  ['consolidation', '/consolidation'],
  ['consolidation-pair', '/consolidation/menora/clal?r=60'],
  ['questions', '/questions'],
  ['questions-filter', '/questions?ch=reg&q=%D7%92%D7%9E%D7%9C'],
  ['question', '/questions/Q-001'],
  ['question-email', '/questions/Q-001?r=email'],
  ['question-exhibit', '/questions/Q-001?r=ex'],
  ['question-missing', '/questions/Q-999'],
  ['findings', '/findings'],
  ['brief', '/brief'],            // S3: the registry, empty in a fresh browser (private: nothing to seed)
  ['brief-demo', '/brief/demo'],  // S3: the built-in demo meeting's brief
  ['watch', '/watch'],
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
