import { defineConfig, devices } from '@playwright/test';

/* Visual smoke + accessibility (lane 2H, ws6 W6-4/W6-16). Runs against the built site served the way Firebase serves it:
   npm run build && npm run test:e2e        (E2E_BASE=https://… to point at another server; E2E_CHROME=0 to use Playwright's own chromium)
   Chrome projects use the installed Google Chrome (channel "chrome") locally; CI sets E2E_CHROME=0 and installs Playwright's own
   chromium + webkit, so the browser version follows the lockfile and the Linux baselines stay stable.
   Projects: phone + desktop (Chrome: visual smoke, axe), webkit-phone (iPhone 13 WebKit, the owner's engine: tests/webkit.spec.ts only).
   Visual baselines are per platform (tests/__screenshots__/{darwin,linux}/): see the note in tests/visual.spec.ts. */
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
  use: { baseURL: BASE, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', testIgnore: /webkit\.spec/, use: { ...chrome, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'desktop', testIgnore: /webkit\.spec/, use: { ...chrome, viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-phone', testMatch: /webkit\.spec/, use: { ...devices['iPhone 13'] } },
  ],
  webServer: process.env.E2E_BASE ? undefined : { command: `node scripts/serve.mjs dist ${PORT}`, url: `${BASE}/`, reuseExistingServer: true, timeout: 20_000 },
});
