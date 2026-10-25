import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { ROUTES, THEMES, open } from './routes';

/* Visual smoke: every key route × phone/desktop × both themes renders without a console error, without sideways scroll, with its
   own title, and looks like its baseline (threshold-based: 3% of pixels may differ, for data that moved).
   Baselines are per platform: tests/__screenshots__/darwin/ (the owner's Mac, installed Chrome) and tests/__screenshots__/linux/ (the CI
   runner, Playwright's chromium). Where none exists yet (a new route, a platform without baselines) the screenshot is attached to the
   report instead of compared, and with E2E_WRITE_BASELINES=1 (set in CI) it is also written to the baseline path: CI uploads them as
   the `linux-baselines` artifact, and committing that folder turns the comparison on for Linux (docs/PIPELINE.md, "Visual baselines").
   Refresh baselines after an intended change: npm run test:e2e -- --update-snapshots (Linux: re-run CI with update_baselines). */
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
      else {
        const shot = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });  // what toHaveScreenshot takes
        await info.attach(file, { body: shot, contentType: 'image/png' });
        if (process.env.E2E_WRITE_BASELINES === '1') { mkdirSync(dirname(info.snapshotPath(file)), { recursive: true }); writeFileSync(info.snapshotPath(file), shot); }
      }
    });
  }
}
