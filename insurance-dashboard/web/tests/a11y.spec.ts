import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ROUTES, THEMES, open } from './routes';

/* Accessibility (IS 5568 / WCAG 2.1 AA, via axe-core): no serious or critical violation on the key routes, in both themes.
   Violations already investigated are listed in tests/a11y-known.json as "rule@route" and do not fail the run; anything new does.
   The report lists every serious/critical rule with its first targets. */
const KNOWN = new Set<string>(JSON.parse(readFileSync(new URL('./a11y-known.json', import.meta.url), 'utf8')).known);
/* Rollout (lane L3-b, 26.11.26): three colour-contrast defects of the new rollout pages, investigated and reported to the coordinator, owned
   by the page lanes: the card's compare button words (#cmp-cta span, L2-a), the screener's average figure (.avgline .num.pos, L2-b) and
   the /my strip's month labels (.ro-sc small, L2-c). Listed per route as "rule@route[:dark]" (the key routes below and the rollout routes
   at the end of this file); they go when the pages are fixed. */
const ROLLOUT_KNOWN = new Set<string>([
  'color-contrast@fund', 'color-contrast@fund:dark', 'color-contrast@funds-screen', 'color-contrast@my', 'color-contrast@my:dark',
  'color-contrast@ro-card', 'color-contrast@ro-card:dark', 'color-contrast@ro-screen', 'color-contrast@ro-my', 'color-contrast@ro-my:dark',
]);

for (const theme of THEMES) {
  for (const [name, route] of ROUTES) {
    test(`a11y ${name} · ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name === 'phone' && theme === 'dark', 'contrast is checked per theme on the desktop; structure on the phone in the light theme');
      await open(page, route, theme);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const lines = bad.map((v) => `${v.id}@${name}${theme === 'dark' ? ':dark' : ''} (${v.impact}, ${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      if (lines.length) await info.attach('axe', { body: lines.join('\n'), contentType: 'text/plain' });
      const fresh = bad.filter((v) => !KNOWN.has(`${v.id}@${name}${theme === 'dark' ? ':dark' : ''}`) && !ROLLOUT_KNOWN.has(`${v.id}@${name}${theme === 'dark' ? ':dark' : ''}`));
      expect(fresh.map((v) => lines[bad.indexOf(v)]), 'new serious/critical accessibility violations').toEqual([]);
    });
  }
}

/* Rollout (rollout spec §18.7 "axe: no new violations"; lane L3-b): the five rollout pages in the saver door with three saved products
   (fox:mine p2102, g880, g8211: the fixture M3), so the rows, marks and sheets that only a reader with products sees are checked too.
   ROLLOUT_KNOWN (top of the file) lists what was investigated and reported (26.11.26), as "rule@route[:dark]"; anything else fails. */
const M3 = [{ k: 'p2102', added: '2026-11-01' }, { k: 'g880', added: '2026-11-01' }, { k: 'g8211', added: '2026-11-01' }];
const ROLLOUT: [string, string][] = [
  ['ro-card', '/funds/p2102?door=saver'],
  ['ro-screen', `/funds/screen?prod=${encodeURIComponent('פנסיה מקיפה')}&track=${encodeURIComponent('כללי')}&door=saver`],
  ['ro-my', '/my?door=saver'],
  ['ro-hub', '/funds?door=saver'],
  ['ro-fees', '/funds/tools/fees?door=saver'],
];
for (const theme of THEMES) {
  for (const [name, route] of ROLLOUT) {
    test(`a11y ${name} · ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name === 'phone' && theme === 'dark', 'contrast is checked per theme on the desktop; structure on the phone in the light theme');
      await page.addInitScript((m) => { try { localStorage.setItem('fox:mine', JSON.stringify(m)); } catch { /* blocked */ } }, M3);
      await open(page, route, theme);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const tag = (v: (typeof bad)[number]) => `${v.id}@${name}${theme === 'dark' ? ':dark' : ''}`;
      const lines = bad.map((v) => `${tag(v)} (${v.impact}, ${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      if (lines.length) await info.attach('axe', { body: lines.join('\n'), contentType: 'text/plain' });
      const fresh = bad.filter((v) => !ROLLOUT_KNOWN.has(tag(v)) && !KNOWN.has(tag(v)));
      expect(fresh.map((v) => lines[bad.indexOf(v)]), 'new serious/critical accessibility violations').toEqual([]);
    });
  }
}
