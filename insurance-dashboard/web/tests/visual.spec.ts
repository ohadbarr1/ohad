import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ROUTES, THEMES, open } from './routes';

/* Visual smoke: every key route × phone/desktop × both themes renders without a console error, without sideways scroll, with its
   own title, and looks like its baseline (threshold-based: 3% of pixels may differ, for data that moved). A baseline is per platform
   (tests/__screenshots__/<platform>/); where none exists yet (a new route, the first run on Linux) the screenshot is attached to the
   report instead of compared. Refresh baselines after an intended change: npm run test:e2e -- --update-snapshots */
for (const theme of THEMES) {
  for (const [name, route] of ROUTES) {
    test(`${name} · ${theme}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR_ABORTED/.test(m.text())) errors.push(m.text()); });
      await open(page, route, theme);
      expect(errors, 'console errors').toEqual([]);
      await expect(page.locator('.notfound')).toHaveCount(0);
      expect(await page.title()).not.toMatch(/^העמוד לא נמצא/);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(sideways, 'page scrolls sideways').toBeLessThanOrEqual(1);
      const file = `${name}-${theme}-${info.project.name}.png`;
      if (existsSync(info.snapshotPath(file)) || info.config.updateSnapshots === 'all' || info.config.updateSnapshots === 'changed') await expect(page).toHaveScreenshot(file);
      else await info.attach(file, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
}
