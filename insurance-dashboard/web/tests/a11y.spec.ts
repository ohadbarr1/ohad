import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ROUTES, THEMES, open } from './routes';

/* Accessibility (IS 5568 / WCAG 2.1 AA, via axe-core): no serious or critical violation on the key routes, in both themes.
   Violations already investigated are listed in tests/a11y-known.json as "rule@route" and do not fail the run; anything new does.
   The report lists every serious/critical rule with its first targets. */
const KNOWN = new Set<string>(JSON.parse(readFileSync(new URL('./a11y-known.json', import.meta.url), 'utf8')).known);

for (const theme of THEMES) {
  for (const [name, route] of ROUTES) {
    test(`a11y ${name} · ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name === 'phone' && theme === 'dark', 'contrast is checked per theme on the desktop; structure on the phone in the light theme');
      await open(page, route, theme);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const lines = bad.map((v) => `${v.id}@${name}${theme === 'dark' ? ':dark' : ''} (${v.impact}, ${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      if (lines.length) await info.attach('axe', { body: lines.join('\n'), contentType: 'text/plain' });
      const fresh = bad.filter((v) => !KNOWN.has(`${v.id}@${name}${theme === 'dark' ? ':dark' : ''}`));
      expect(fresh.map((v) => lines[bad.indexOf(v)]), 'new serious/critical accessibility violations').toEqual([]);
    });
  }
}
