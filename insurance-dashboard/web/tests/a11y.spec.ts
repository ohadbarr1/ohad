import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ROUTES, THEMES, open } from './routes';

/* Accessibility (IS 5568 / WCAG 2.1 AA, via axe-core): no serious or critical violation on the key routes, in both themes.
   Violations already investigated are listed in tests/a11y-known.json as "rule@route" and do not fail the run; anything new does.
   The report lists every serious/critical rule with its first targets. */
const KNOWN = new Set<string>(JSON.parse(readFileSync(new URL('./a11y-known.json', import.meta.url), 'utf8')).known);
/* Rollout (lane L3-b, 26.11.26): the three colour-contrast defects of the rollout pages (#cmp-cta span, .avgline .num.pos, .ro-sc small)
   were fixed in P2; the set stays for the next one ("rule@route[:dark]"). */
const ROLLOUT_KNOWN = new Set<string>([]);

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

/* Phase 6 (spec p6 §14.6 "a11y additions"; lane P6-3, ticket Q3): every lens of the peers board and of the company overview, the board on a
   quarter-named reading (the rows set outside the ranking) and a company that has not reported the quarter (the guard line), in the Pro
   door. P6_KNOWN lists what was investigated and reported to the coordinator (27.11.26, P6-3 hand-over), as "rule@route[:dark]"; anything
   else fails. Each entry names the owning lane's file; remove it when fixed. */
const P6_KNOWN = new Set<string>([
  'color-contrast@p6-board-csm-qoq',        // the focus row's green change (.mine .p6-sb-val .pos) on the focus tint: styles/peerboard.css (P6-2a)
  'color-contrast@p6-board-table',          // the comps tables' signed cells (.pos / .pos.stale) on their heat: pages/peers/TableLens.tsx, styles (P6-2b)
  'color-contrast@p6-board-table:dark',     // the same, dark theme (.neg.stale)
  'link-in-text-block@p6-co-an',            // the "scenarios" link inside <small> of the stress fold: pages/company/StressFold.tsx (P6-2e)
  'link-in-text-block@p6-co-an:dark',
  'nested-interactive@p6-co-an',            // a <summary> holding an interactive child (#stress fold, the dividend-history fold): StressFold / AnalysisLens (P6-2e)
  'nested-interactive@p6-co-an:dark',
  'nested-interactive@p6-co-cap',           // the phone's folded bond-series list: <summary> with an interactive child: pages/company/CapitalLens.tsx (P6-2e)
]);
const P6: [string, string, string][] = [
  ['p6-board', '/industry/peers', '#board .sb-row'],
  ['p6-board-csm-qoq', '/industry/peers?bm=csm&rd=qoq', '#board .sb-row'],
  ['p6-board-focus', '/industry/peers?lens=focus', '#focus-list'],
  ['p6-board-charts', '/industry/peers?lens=charts', 'main svg, main canvas'],
  ['p6-board-table', '/industry/peers?lens=table', 'main table'],
  ['p6-co', '/company/harel', '#quarter-table tr[data-k]'],
  ['p6-co-chg', '/company/harel?cl=chg', '[data-lens="chg"] li.chg'],
  ['p6-co-qs', '/company/harel?cl=qs', '[data-lens="qs"] table[data-kind="quarters"]'],
  ['p6-co-an', '/company/harel?cl=an', '#analysis'],
  ['p6-co-cap', '/company/harel?cl=cap', '#capital'],
  ['p6-co-tg', '/company/harel?cl=tg', '#targets-lens'],
  ['p6-co-waiting', '/company/clal', '#quarter-table tr[data-k]'],
];
for (const theme of THEMES) {
  for (const [name, route, ready] of P6) {
    test(`a11y ${name} · ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name === 'phone' && theme === 'dark', 'contrast is checked per theme on the desktop; structure on the phone in the light theme');
      await open(page, route, theme);
      await page.waitForSelector(ready, { timeout: 30_000 });
      await page.waitForTimeout(600);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const tag = (v: (typeof bad)[number]) => `${v.id}@${name}${theme === 'dark' ? ':dark' : ''}`;
      const lines = bad.map((v) => `${tag(v)} (${v.impact}, ${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      if (lines.length) await info.attach('axe', { body: lines.join('\n'), contentType: 'text/plain' });
      const fresh = bad.filter((v) => !P6_KNOWN.has(tag(v)) && !KNOWN.has(tag(v)));
      expect(fresh.map((v) => lines[bad.indexOf(v)]), 'new serious/critical accessibility violations').toEqual([]);
    });
  }
}
