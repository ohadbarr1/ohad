// F7: the pure helpers of <MonthGrid> (labels, signed figures, heat, row lead, layout by column count). Bundles src/components/MonthGrid.tsx
// with esbuild (Vite's own copy; CSS imports dropped) and checks it against the P3 fixture (p2102, p2172, p2009, net, 10/26).
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'monthgridtest-')), out = join(dir, 'mg.mjs');
try {
  await build({ entryPoints: [new URL('../src/components/MonthGrid.tsx', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', jsx: 'automatic', loader: { '.css': 'empty' } });
  const M = await import(pathToFileURL(out).href);
  let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ' + name); };

  t('month labels: full up to three columns, short from four, two-digit year', () => {
    assert.equal(M.monthLabel(202610), 'אוקטובר 26');
    assert.equal(M.monthLabel(202610, true), 'אוק׳ 26');
    assert.equal(M.monthLabel(202605, true), 'מאי 26');
    assert.equal(M.monthFull(202610), 'אוקטובר 2026');
  });
  t('signed figures: U+2212 minus, a written plus, half-up on the published value, "%" on request, "–" for none', () => {
    assert.equal(M.signed(-1.452), '−1.45');
    assert.equal(M.signed(0.848), '+0.85');
    assert.equal(M.signed(8.85, 1, true), '+8.9%');
    assert.equal(M.signed(-0.733, 2, true), '−0.73%');
    assert.equal(M.signed(null), '–');
    assert.equal(M.shekels(1560), '₪1,560');
  });
  t('heat: 90th percentile scale; 7%–40% by size; hue by sign; none for zero or missing', () => {
    const vals = [-1.452, -0.733, -0.742, 0.548, 0.847, 0.538, 0.848, 1.147, 1.278, 0.158, -0.923, -0.052, -0.792, -0.543, -0.972, 2.078, 2.547, 2.277];
    const s = M.heatScale(vals);
    assert.equal(s, 2.277);
    assert.deepEqual(M.heatFill(-1.452, s), { hue: 'down', alpha: 0.28 });
    assert.deepEqual(M.heatFill(2.547, s), { hue: 'up', alpha: 0.4 });
    assert.deepEqual(M.heatFill(0.001, 100), { hue: 'up', alpha: 0.07 });
    assert.deepEqual(M.heatFill(null, s), { hue: null, alpha: 0 });
  });
  t('row lead: October P3 → Harel and Menora share it inside 0.05 (−0.73, −0.74); a row inside the band marks nobody', () => {
    assert.deepEqual(M.leadOf([-1.45, -0.73, -0.74], 0.05), [1, 2]);
    assert.deepEqual(M.leadOf([0.55, 0.85, 0.54], 0.05), [1]);
    assert.deepEqual(M.leadOf([-0.73, -0.74, -0.75], 0.05), []);
    assert.deepEqual(M.leadOf([1.0, null], 0.05), []);
  });
  t('summary lead: half year +1.4/+2.3/+2.3 rings two; last year +9.0/+10.3/+10.0 rings Harel; fees 560/550/610 (lower, 20 ₪) ring Migdal and Harel', () => {
    assert.deepEqual(M.leadOf([1.4, 2.3, 2.3], 0.1), [1, 2]);
    assert.deepEqual(M.leadOf([9.0, 10.31, 9.99], 0.1), [1]);
    assert.deepEqual(M.leadOf([560, 550, 610], 20, 'lo'), [0, 1]);
    assert.deepEqual(M.leadOf([560, 560], 20, 'lo'), []);
  });
  t('layout: 3 columns full names, wide label, "%" on the first row; 4 short names, "%" kept; 5+ scroll sideways, no "%"', () => {
    assert.deepEqual(M.gridLayout(3), { short: false, mw: 84, wideLabel: true, pctFirst: true, compact: false, wide: false, width: null });
    const four = M.gridLayout(4); assert.equal(four.short, true); assert.equal(four.mw, 62); assert.equal(four.pctFirst, true); assert.equal(four.wide, false);
    const five = M.gridLayout(5); assert.equal(five.pctFirst, false); assert.equal(five.wide, true); assert.equal(five.width, 62 + 5 * 74);
    assert.equal(M.gridLayout(3, 'years').mw, 72); assert.equal(M.gridLayout(3, 'years').wideLabel, false);
  });

  /* rollout (spec §2.2, §16.1 1a): the card's grid = one track column + the type's average, mark="none", the fee row in shekels with the
     average under it; the average head opens the type-month sheet. Rendered with react-dom/server (react kept external, so the bundles
     sit inside web/); the shipped grid of the base commit is rendered too, to show nothing changes without the new prop. */
  const web = fileURLToPath(new URL('..', import.meta.url)), rd = mkdtempSync(join(web, '.monthgridtest-'));
  try {
    const noCss = { name: 'no-css', setup(b) { b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'no-css' })); b.onLoad({ filter: /.*/, namespace: 'no-css' }, () => ({ contents: '', loader: 'css' })); } };
    const mk = async (src, name) => {
      writeFileSync(join(rd, `${name}.tsx`), `import { createElement as h } from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export * from '${src}'; export const html = (C, p) => renderToStaticMarkup(h(C, p));`);
      await build({ entryPoints: [join(rd, `${name}.tsx`)], bundle: true, format: 'esm', platform: 'node', outfile: join(rd, `${name}.mjs`), logLevel: 'error', jsx: 'automatic', external: ['react', 'react-dom', 'react/*', 'react-dom/*'], plugins: [noCss] });
      return import(pathToFileURL(join(rd, `${name}.mjs`)).href);
    };
    mkdirSync(join(rd, 'old'), { recursive: true });
    writeFileSync(join(rd, 'old', 'MonthGrid.tsx'), execFileSync('git', ['show', '1c906a5f:insurance-dashboard/web/src/components/MonthGrid.tsx'], { cwd: web }));
    const R = await mk(new URL('../src/components/MonthGrid', import.meta.url).pathname, 'cur'), O = await mk('./old/MonthGrid', 'old');
    const card = {
      cols: [{ k: 'p2102', label: 'המסלול', color: 'var(--s1)' }], showAvg: true, avgLabel: ['הממוצע', 'פנסיה כללי · 5 ›'], mark: 'none',
      rows: [{ p: 202610, vals: [-1.44], avg: -1.03 }, { p: 202609, vals: [0.56], avg: 0.63 }],
      footer: [{ key: 'half', label: 'חצי שנה', vals: [1.4], avg: 2.0 }, { key: 'y12', label: 'שנה אחרונה', vals: [9.2], avg: 10.1 },
        { key: 'fee', label: 'דמי ניהול', sub: 'בשנה, לדוגמה ›', unit: 'ils', vals: [560], avg: 560, id: 'fee-line', onOpen: () => {} }],
      onCell: () => {},
    };
    t('card grid: one column + the average, "%" on the first row, the average cells are buttons with no heat, no lead marks, ₪ under the average', () => {
      const h = R.html(R.MonthGrid, card);
      assert.match(h, /<b>הממוצע<\/b><small>פנסיה כללי · 5 ›<\/small>/);
      assert.match(h, /<td class="avg"><button type="button" class="mg-cell" style="--a:0"[^>]*><span class="num">−1.03%<\/span>/);
      assert.match(h, /<span class="num">−1.44%<\/span>/);
      assert.doesNotMatch(h, /mg-dot|class="mg-cell best"|sumc best/);
      assert.match(h, /<td class="avg"><span class="sumc mut"><span class="num">₪560<\/span>/);
      assert.match(h, /באחוזים,<br\/>לפני דמי ניהול/);
    });
    t('the average head: a plain head without onAvg (byte-identical to the shipped grid), a 44-px button #avg-head with it', () => {
      assert.equal(R.html(R.MonthGrid, card), O.html(O.MonthGrid, card));
      assert.doesNotMatch(R.html(R.MonthGrid, card), /avg-head/);
      const h = R.html(R.MonthGrid, { ...card, onAvg: () => {} });
      assert.match(h, /<th scope="col" class="avg"[^>]*><button type="button" class="mg-col mg-avgh" id="avg-head" aria-haspopup="dialog"><i class="mg-bar" aria-hidden="true"><\/i><b>הממוצע<\/b>/);
      assert.match(R.html(R.MonthGrid, { ...card, onAvg: () => {}, avgId: 'avg-head-y' }), /id="avg-head-y"/);
    });
    t('the hub: four type columns, mark="none": no lead mark anywhere', () => {
      const hub = { cols: ['כללי', 'עד גיל 50', 'גיל 50 עד 60', 'מניות'].map((l, i) => ({ k: `t${i}`, label: l, color: 'red' })), mark: 'none',
        rows: [{ p: 202610, vals: [-1.03, -1.22, -0.95, -1.76] }], footer: [{ key: 'y12', label: 'שנה אחרונה', vals: [10.1, 10.6, 9.7, 11.6] }] };
      assert.doesNotMatch(R.html(R.MonthGrid, hub), /best|mg-dot/);
    });
  } finally { rmSync(rd, { recursive: true, force: true }); }
  console.log(`month grid: ${n} passed`);
} finally { rmSync(dir, { recursive: true, force: true }); }
