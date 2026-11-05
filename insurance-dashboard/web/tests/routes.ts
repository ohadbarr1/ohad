/** The routes the visual smoke and the accessibility run cover: one per signature page. */
export const ROUTES: [string, string][] = [
  ['home', '/'],                                         // the Pro door's home (open() chooses Pro unless the route says ?door=)
  ['doors', '/?door=pick'],                              // W1: the door picker (no door chosen)
  ['home-saver', '/?door=saver'],                        // W1: the saver's home
  ['home-agent', '/?door=agent'],                        // W1: the agent's home
  ['pro', '/pro'],                                       // W1: the Pro home at its fixed address
  ['pro-from-saver', '/warroom?door=saver'],             // W1: a Pro page opened from the saver's door (the "עמוד מקצועי" chip, the saver's nav)
  ['company', '/company/phoenix'],                     // phase 0: the company opens on its numbers
  ['thesis', '/company/phoenix/thesis'],
  ['numbers', '/company/phoenix/numbers'],
  ['numbers-review', '/company/phoenix/numbers#review'],   // wave 2b: the review by chapter (was /company/<id>/review) and "ניתוח", sections of "מספרים"
  ['company-more', '/company/more'],
  ['financials', '/company/phoenix/financials'],
  ['ifrs17', '/company/phoenix/ifrs17'],
  ['peers', '/industry/peers'],
  ['csm', '/industry/csm'],
  ['ifrs17-std', '/industry/csm?view=std'],               // wave 2b: "IFRS 17", a tab of "השוואה ענפית"
  ['savings', '/savings'],
  ['savings-value', '/savings?v=npv'],                   // wave 2b: the savings hub's "ערך" (the flows' value · the fee book)
  ['feebook', '/feebook'],
  ['funds', '/funds'],                                   // F1: the "חיסכון" hub
  ['funds-screen', '/funds/screen?prod=%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA&track=%D7%9B%D7%9C%D7%9C%D7%99'],
  ['funds-screen-all', '/funds/screen?prod=all&track=all&fam=index'],
  ['funds-compare', '/funds/compare?k=p2009,g12531,i2081&b=net'],
  ['fund', '/funds/p2009'],
  ['funds-tools', '/funds/tools'],                                                  // F2 TOOLS; phase 0: a list, each tool with its question
  ['funds-fees', '/funds/tools/fees'],
  ['funds-default', '/funds/default'],
  ['funds-trackers', '/funds/trackers?g=sp500&w=a3'],
  ['funds-persist', '/funds/screen?prod=%D7%92%D7%9E%D7%9C&track=%D7%A2%D7%93%2050&sort=persist'],  // wave 2b: was /funds/rank
  ['funds-glide', '/funds/glide?prod=%D7%92%D7%9E%D7%9C'],
  ['managers', '/managers'],
  ['valuation', '/valuation/phoenix'],
  ['calendar', '/calendar'],                             // phase 0: a tab of /feed
  ['search', '/search?q=%D7%A8%D7%9B%D7%99%D7%91%20%D7%94%D7%A4%D7%A1%D7%93'],
  ['data', '/data'],                                     // phase 0: quality · autopilot · API tabs
  ['positions', '/positions'],
  ['my', '/my'],                                         // W1 saver: "המוצרים שלי", empty in a fresh browser (picker + example)
  ['scenarios', '/scenarios'],
  ['scenarios-preset', '/scenarios?e=-25&cr=150'],
  ['scenarios-solvency', '/scenarios?view=solvency'],   // wave 2b: the stress lab (was /industry/csm?view=stress)
  ['regulation', '/warroom/regulation'],
  ['warroom', '/warroom'],
  ['capital', '/capital'],
  ['capital-preset', '/capital?s=eqdd&buf=5'],
  ['fragility', '/fragility'],
  ['fragility-detail', '/fragility?c=altshuler&s=flow&fee_watch=1'],
  ['valuation-index', '/valuation'],                     // wave 2b: the market-expectations ranking (was /expectations)
  ['valuation-expectations', '/valuation/phoenix/expectations'],
  ['consolidation', '/consolidation'],
  ['consolidation-pair', '/consolidation/menora/clal?r=60'],
  ['questions', '/questions'],
  ['questions-filter', '/questions?ch=reg&q=%D7%92%D7%9E%D7%9C'],
  ['question', '/questions/Q-001'],
  ['question-email', '/questions/Q-001?r=email'],
  ['question-exhibit', '/questions/Q-001?r=ex'],
  ['question-missing', '/questions/Q-999'],
  ['findings', '/findings'],                             // phase 0: a tab of /questions
  ['brief', '/brief'],            // S3: the registry, empty in a fresh browser (private: nothing to seed)
  ['brief-demo', '/brief/demo'],  // S3: the built-in demo meeting's brief
  ['watch', '/watch'],                                   // phase 0: the "שאני עוקב" tab of /feed
];
export const THEMES = ['phoenix', 'dark'] as const;

/** Opens a route in a theme and waits until its data has arrived (no "טוען" placeholder left). The Pro door is chosen (W1: the
 *  routes are the terminal's pages, and their baselines show its rail) unless the route asks for another door with ?door=. */
export async function open(page: import('@playwright/test').Page, route: string, theme: (typeof THEMES)[number]) {
  await page.addInitScript((t) => { try { localStorage.setItem('theme2', t); localStorage.setItem('fox:seen', JSON.stringify('2099-01-01')); localStorage.setItem('fox:door', JSON.stringify('pro')); } catch { /* blocked */ } }, theme);
  await page.goto(route, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !/טוען/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
