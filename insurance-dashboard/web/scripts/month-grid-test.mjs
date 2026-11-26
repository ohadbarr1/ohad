// F7: the pure helpers of <MonthGrid> (labels, signed figures, heat, row lead, layout by column count). Bundles src/components/MonthGrid.tsx
// with esbuild (Vite's own copy; CSS imports dropped) and checks it against the P3 fixture (p2102, p2172, p2009, net, 10/26).
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync , readFileSync} from 'node:fs';
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
    writeFileSync(join(rd, 'old', 'MonthGrid.tsx'), readFileSync(join(web, 'scripts/fixtures/base-1c906a5f/MonthGrid.tsx')));
    mkdirSync(join(rd, 'pre'), { recursive: true });
    writeFileSync(join(rd, 'pre', 'MonthGrid.tsx'), readFileSync(join(web, 'scripts/fixtures/base-55b08219/MonthGrid.tsx')));
    const R = await mk(new URL('../src/components/MonthGrid', import.meta.url).pathname, 'cur'), O = await mk('./old/MonthGrid', 'old'), P = await mk('./pre/MonthGrid', 'pre');
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

    /* P6 (spec p6 §2.2, §13.3 F3+, §14.4 F3; tester P2/P3): kind="quarters". First: months and years, every prop the compare page and the
       rollout pages pass, render byte-identically to the grid before P6 (committed copy scripts/fixtures/base-55b08219, no git history). */
    const cmp = {
      cols: [{ k: 'p2102', label: 'מגדל', color: 'var(--s1)', sub: 'כללי' }, { k: 'p2009', label: 'הראל', color: 'var(--s2)', closed: true }, { k: 'p2172', label: 'מנורה', color: 'var(--s4)' }, { k: 'p1', label: 'כלל', color: 'var(--s6)' }, { k: 'p2', label: 'מור', color: 'var(--s7)' }],
      rows: [{ p: 202610, vals: [-1.452, -0.733, -0.742, 0.1, null], avg: -0.9 }, { p: 202609, vals: [0.548, 0.847, 0.538, 0, 2.2], lead: [1] }, { p: 202608, vals: [1, 1, 1, 1, 1] }],
      footer: [{ key: 'half', label: 'חצי שנה', vals: [1.4, 2.3, 2.3, null, 0], avg: 2 }, { key: 'fee', label: 'דמי ניהול', sub: 'בשנה ›', unit: 'ils', vals: [560, 550, 610, null, 600], avg: null, onOpen: () => {}, id: 'fee-line' }],
      onCell: () => {}, onCol: () => {}, showAvg: true,
    };
    const variants = [card, { ...card, onAvg: () => {}, avgId: 'x' }, cmp, { ...cmp, kind: 'years', rows: [{ label: '2026', sub: 'עד אוק׳', vals: [8.1, 9.2, 7.7, 1, null], avg: 8 }] },
      { ...cmp, labels: 'full', decimals: 1, tie: 0.2, scale: 2 }, { ...cmp, more: { label: 'עוד 6 חודשים ▾', onClick: () => {}, id: 'more' }, unit: 'U' }, { ...cmp, loading: true }, { ...cmp, loading: true, skeletonRows: 3, footer: [] },
      { ...cmp, cols: cmp.cols.slice(0, 3), rows: cmp.rows.map((r) => ({ ...r, vals: r.vals.slice(0, 3) })), mark: 'none', basis: 'gross' }];
    t('months and years: byte-identical to the grid before P6 on 9 fixtures (compare, card, hub, years, skeleton, more)', () => {
      for (const p of variants) assert.equal(R.html(R.MonthGrid, p), P.html(P.MonthGrid, p));
    });

    const Q = ['2026Q3', '2026Q2', '2026Q1', '2025Q4', '2025Q3', '2025Q2', '2025Q1', '2024Q4', '2024Q3', '2024Q2', '2024Q1', '2023Q4'];
    const ins = [['phoenix', 'הפניקס'], ['harel', 'הראל'], ['migdal', 'מגדל'], ['clal', 'כלל'], ['menora', 'מנורה מבטחים'], ['hachshara', 'הכשרה'], ['ayalon', 'איילון']].map(([k, label], i) => ({ k, label, color: `var(--s${i + 1})` }));
    // P/(B+CSM) at quarter-end closes (mockup v3, 6 quarters): Clal, Menora and Ayalon carried at Q3'26; Hachshara has no listed share
    const pbc = [[2.42, 1.70, 1.02, 1.31, 2.36, null, 2.22], [2.23, 1.33, 0.84, 1.01, 1.97, null, 1.39], [2.28, 1.51, 0.88, 1.01, 2.13, null, 1.58], [1.85, 1.09, 0.84, 0.94, 1.83, null, 1.07], [1.77, 1.01, 0.66, 0.80, null, null, null], [1.36, 0.88, 0.56, 0.74, 1.31, null, 0.80]];
    const med = [1.96, 1.36, 1.55, 1.08, 0.91, 0.84], nn = [6, 6, 6, 6, 4, 6];
    const qrows = pbc.map((vals, i) => ({ key: Q[i], vals, avg: med[i], n: nn[i], star: i === 0 ? [false, false, false, true, true, false, true] : undefined,
      why: vals.map((v, j) => (v != null ? null : j === 5 ? 'אין מניה נסחרת' : 'אין נתון')) }));
    const grid = { kind: 'quarters', cols: ins, rows: qrows, showAvg: true, decimals: 2, focus: 'phoenix', onCell: () => {}, onCol: () => {}, unit: 'סוף רבעון', data: { reading: 'level' } };

    t('quarter labels: "2026Q3" → "Q3\'26"; plain levels with commas and U+2212; cell marks "†" then "*"', () => {
      assert.equal(R.quarterLabel('2026Q3'), "Q3'26"); assert.equal(R.quarterLabel('2023Q4'), "Q4'23"); assert.equal(R.quarterLabel('H1'), 'H1');
      assert.equal(R.plain(17893, 0), '17,893'); assert.equal(R.plain(-0.5, 1), '−0.5'); assert.equal(R.plain(1.7), '1.70'); assert.equal(R.plain(null), '–'); assert.equal(R.plain(-0.001, 1), '0.0');
      assert.equal(R.cellText('17,011', false, true), '17,011†'); assert.equal(R.cellText('2.22', true), '2.22*');
      assert.deepEqual(R.chunk([1, 2, 3, 4, 5, 6, 7], 6), [[1, 2, 3, 4, 5, 6], [7]]);
    });
    t('quarters grid: id, data-kind, data-reading; rows data-q with "Q3\'26" labels newest first; cells data-e/data-q; no lead marks, no "%"', () => {
      const h = R.html(R.MonthGrid, grid);
      assert.match(h, /<table class="mg p6-q" id="quarter-grid" data-kind="quarters" data-reading="level">/);
      assert.deepEqual([...h.matchAll(/<tr data-q="(\d{4}Q\d)"/g)].map((m) => m[1]), Q.slice(0, 6));
      assert.match(h, /<tr data-q="2026Q3" class="cur"[^>]*><th class="m" scope="row">Q3&#x27;26<\/th>/);
      assert.match(h, /<td data-e="harel" data-q="2026Q3"><button type="button" class="mg-cell" style="--k:0 0 0;--a:0" aria-label="הראל, Q3&#x27;26: 1.70"><span class="num">1.70<\/span><\/button><\/td>/);
      assert.doesNotMatch(h, /mg-dot|class="mg-cell best"|%/);
      assert.match(h, /<span class="mg-unit">סוף רבעון<\/span>/);
    });
    t('quarters grid: carried cells starred (class car, "*", the reason in the label); no figure → hatched "–" with its reason; focus column bold', () => {
      const h = R.html(R.MonthGrid, grid);
      assert.match(h, /<td data-e="clal" data-q="2026Q3" class="car"><button[^>]*aria-label="כלל, Q3&#x27;26: 1.31\*, טרם דיווחה: הנתון האחרון שלה"><span class="num">1.31\*<\/span>/);
      assert.equal((h.match(/class="car"/g) || []).length, 3);
      assert.match(h, /<td data-e="hachshara" data-q="2026Q3" class="p6-na" title="אין מניה נסחרת"><span class="mg-cell" aria-label="הכשרה, Q3&#x27;26: אין מניה נסחרת">–<\/span><\/td>/);
      assert.match(h, /<td data-e="menora" data-q="2025Q3" class="p6-na" title="אין נתון">/);
      assert.match(h, /<th scope="col" data-e="phoenix" class="fc"/); assert.match(h, /<td data-e="phoenix" data-q="2026Q3" class="fc">/);
      assert.match(h, /<b>מנורה מבטחים<\/b>/);   // the full name, never cut (CSS wraps it)
    });
    t('the median: n always as a superscript, a last column and a row block (auto); "row" only the block, "col" only the column (P2)', () => {
      const h = R.html(R.MonthGrid, grid);
      assert.match(h, /<div class="mgw p6-qw p6-at-auto">/);
      assert.match(h, /<td class="avg p6-avgc" data-q="2025Q3" data-n="4"><button type="button" class="mg-cell" aria-label="חציון, Q3&#x27;25: 0.91, על 4 חברות"><span class="num">0.91<\/span><sup class="p6-n">4<\/sup><\/button><\/td>/);
      assert.match(h, /<th scope="col" class="avg p6-avgc"><span class="mg-col"><b>חציון<sup class="p6-n">n<\/sup><\/b><\/span><\/th>/);
      // the row block: the same quarter labels as heads, in the grid's order, the medians bold under them, each with its n
      const blk = h.slice(h.indexOf('<div class="p6-medrow" id="quarter-grid-med">'));
      assert.match(blk, /^<div class="p6-medrow" id="quarter-grid-med"><table class="p6-mr"><thead><tr><th scope="col" class="m" aria-label="רבעון"><\/th><th scope="col" class="cur">Q3&#x27;26<\/th><th scope="col">Q2&#x27;26<\/th>/);
      assert.deepEqual([...blk.matchAll(/<td data-q="(\d{4}Q\d)" data-n="(\d)">/g)].map((m) => `${m[1]}:${m[2]}`), Q.slice(0, 6).map((q, i) => `${q}:${nn[i]}`));
      const row = R.html(R.MonthGrid, { ...grid, avgAt: 'row' }), col = R.html(R.MonthGrid, { ...grid, avgAt: 'col' });
      assert.doesNotMatch(row, /p6-avgc/); assert.match(row, /p6-medrow/); assert.match(row, /p6-at-row/);
      assert.doesNotMatch(col, /p6-medrow/); assert.equal((col.match(/<td class="avg p6-avgc"/g) || []).length, 6);
      assert.doesNotMatch(R.html(R.MonthGrid, { ...grid, showAvg: false }), /p6-avgc|p6-medrow|p6-at-/);
    });
    t('12 quarters: rowsMax keeps 6 or 12; the phone block puts twelve medians in two lines of six', () => {
      const r12 = Q.map((q, i) => ({ key: q, vals: ins.map((_, j) => (j === 5 ? null : 1 + i / 10 + j / 100)), avg: 1 + i / 10, n: 6 }));
      const g12 = { ...grid, rows: r12 };
      assert.equal((R.html(R.MonthGrid, { ...g12, rowsMax: 6 }).match(/<tr data-q=/g) || []).length, 6);
      const h = R.html(R.MonthGrid, { ...g12, rowsMax: 12 });
      assert.equal((h.match(/<tr data-q=/g) || []).length, 12);
      assert.equal((h.match(/<table class="p6-mr">/g) || []).length, 2);
      assert.match(h, /<th scope="col">Q4&#x27;23<\/th><\/tr><\/thead>/);
      const seg = R.html(R.RowsSeg, { value: 6, onChange: () => {} });
      assert.equal(seg, '<div class="p6-seg" id="gq-seg" role="group" aria-label="מספר רבעונים"><button type="button" aria-pressed="true">6</button><button type="button" aria-pressed="false">12</button></div>');
    });
    t('a change reading: heat="sign" tints by sign, figures signed; format per column; "†" on a gross CSM print and "–" for its change', () => {
      const chg = { kind: 'quarters', cols: ins.slice(0, 3), heat: 'sign', decimals: 1, showAvg: true, avgAt: 'col', format: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`,
        rows: [{ key: '2026Q3', vals: [7.1, 1.0, 3.5], avg: 3.5, n: 3 }, { key: '2024Q4', vals: [2.0, null, -1.5], why: [null, 'בסיס אחר: אין שינוי', null], avg: 0.25, n: 2 }], data: { reading: 'qoq' } };
      const h = R.html(R.MonthGrid, chg);
      assert.match(h, /class="mg p6-q p6-heat"/); assert.match(h, /data-reading="qoq"/);
      assert.match(h, /style="--k:var\(--heat-up\);--a:0\.4"[^>]*aria-label="הפניקס, Q3&#x27;26: \+7\.1%"><span class="num">\+7\.1%<\/span>/);
      assert.match(h, /style="--k:var\(--heat-down\)[^"]*"[^>]*><span class="num">−1\.5%<\/span>/);
      assert.match(h, /<td data-e="harel" data-q="2024Q4" class="p6-na" title="בסיס אחר: אין שינוי">/);
      assert.match(h, /<span class="num">\+0\.3%<\/span><sup class="p6-n">2<\/sup>/);
      const lvl = R.html(R.MonthGrid, { kind: 'quarters', cols: ins.slice(1, 2), decimals: 0, rows: [{ key: '2023Q4', vals: [17011], dagger: [true] }] });
      assert.match(lvl, /aria-label="הראל, Q4&#x27;23: 17,011†, על בסיס אחר"><span class="num">17,011†<\/span>/);
      assert.match(lvl, /class="p6-dag"/); assert.doesNotMatch(lvl, /heat-up|heat-down/);
    });
    t('renderCell: the page draws each figure (Sourced) inside the tinted cell; the median too (k = null) with its n', () => {
      const seen = [];
      const h = R.html(R.MonthGrid, { ...grid, rowsMax: 1, renderCell: (q, k, txt, v) => { seen.push(`${q}|${k}|${txt}|${v}`); return `[${txt}]`; } });
      assert.match(h, /<td data-e="clal" data-q="2026Q3" class="car"><span class="mg-cell p6-x" style="--k:0 0 0;--a:0">\[1\.31\*\]<\/span><\/td>/);
      assert.ok(seen.includes('2026Q3|harel|1.70|1.7')); assert.ok(seen.includes('2026Q3|null|1.96|1.96'));
      assert.match(h, /<span class="mg-cell p6-x p6-med">\[1\.96\]<sup class="p6-n">6<\/sup><\/span>/);
      assert.doesNotMatch(h, /<button type="button" class="mg-cell"/);
    });
    t('loading: skeleton rows of the grid\'s count, the median column kept; sets above eight columns scroll sideways', () => {
      const h = R.html(R.MonthGrid, { ...grid, loading: true, rowsMax: 12 });
      assert.match(h, /aria-busy="true"/); assert.equal((h.match(/<tr>/g) || []).length, 13);
      const ten = R.html(R.MonthGrid, { ...grid, cols: [...ins, ...ins.slice(0, 3).map((c) => ({ ...c, k: c.k + '2' }))] });
      assert.match(ten, /<div class="mgw p6-qw scroll p6-at-auto">/);
      assert.doesNotMatch(R.html(R.MonthGrid, grid), /p6-qw scroll/);
    });
  } finally { rmSync(rd, { recursive: true, force: true }); }
  console.log(`month grid: ${n} passed`);
} finally { rmSync(dir, { recursive: true, force: true }); }
