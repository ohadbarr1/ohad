import { defineConfig } from '@playwright/test';

/* Visual smoke + accessibility (lane 2H, ws6 W6-4/W6-16). Runs against the built site served the way Firebase serves it:
   npm run build && npm run test:e2e        (E2E_BASE=https://… to point at another server; E2E_CHROME=0 to use Playwright's own chromium)
   Uses the installed Google Chrome (channel "chrome"), so no browser download is needed here or on the GitHub runner. */
const PORT = Number(process.env.E2E_PORT ?? 4174);
const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${PORT}`;
const chrome = process.env.E2E_CHROME === '0' ? {} : { channel: 'chrome' as const };

export default defineConfig({
  testDir: 'tests',
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.03, threshold: 0.25, animations: 'disabled', caret: 'hide' } },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: { baseURL: BASE, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', ...chrome, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: process.env.E2E_BASE ? undefined : { command: `node scripts/serve.mjs dist ${PORT}`, url: `${BASE}/`, reuseExistingServer: true, timeout: 20_000 },
});
