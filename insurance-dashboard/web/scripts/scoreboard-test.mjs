// F4 (rollout spec §2.2, §16.1 4a, §18.3): <Scoreboard>'s new props are optional and backward compatible. Bundles the board twice with
// esbuild (CSS imports dropped): the shipped one from the base commit (git show 1c906a5f) and the working copy, renders both with
// react-dom/server, and asserts (1) without the new props the markup is byte-identical, (2) the new props behave: format, trailing beside
// the row button, mine (tint + "שלי", mineWord), bars auto/always/none, no tick once `bars` is passed, head and note.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = fileURLToPath(new URL('..', import.meta.url));
const BASE = '1c906a5f';
// inside web/ so the bundles resolve react and react-dom (kept external) from web/node_modules; removed at the end
const dir = mkdtempSync(join(web, '.scoreboardtest-'));
const bundle = async (entry, out) => {
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', jsx: 'automatic', external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
    plugins: [{ name: 'no-css', setup(b) { b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'no-css' })); b.onLoad({ filter: /.*/, namespace: 'no-css' }, () => ({ contents: '', loader: 'css' })); } }] });
  return import(pathToFileURL(out).href);
};
try {
  // the shipped board, with its sibling MonthGrid, from the base commit
  const old = join(dir, 'old', 'components'); mkdirSync(old, { recursive: true });
  for (const f of ['Scoreboard.tsx', 'MonthGrid.tsx']) writeFileSync(join(old, f), execFileSync('git', ['show', `${BASE}:insurance-dashboard/web/src/components/${f}`], { cwd: web }));
  const harness = (src) => `import { createElement as h } from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export * from '${src}'; export const html = (C, p) => renderToStaticMarkup(h(C, p));`;
  writeFileSync(join(dir, 'old.tsx'), harness('./old/components/Scoreboard'));
  writeFileSync(join(dir, 'new.tsx'), harness(join(web, 'src/components/Scoreboard.tsx').replace(/\.tsx$/, '')));
  const O = await bundle(join(dir, 'old.tsx'), join(dir, 'old.mjs')), N = await bundle(join(dir, 'new.tsx'), join(dir, 'new.mjs'));
  let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ' + name); };

  const rows = [
    { k: 'p2102', label: 'מגדל', color: 'var(--s1)', value: 8.8, unit: 'בשנה, בממוצע', place: '2', sub: 'דמי ניהול 0.15% מהחיסכון' },
    { k: 'p2009', label: 'הראל גילעד', color: 'var(--s2)', value: 8.3, place: '4–5', tie: true },
    { k: 'p2172', label: 'מנורה', color: 'var(--s4)', value: -0.72, place: null },
    { k: 'p1', label: 'כלל', color: 'var(--s6)', value: null, place: '5', tag: '73% מניות' },
    { k: 'p2', label: 'מור', color: 'var(--s7)', value: 1.2, place: '3', extra: 'חודש גרוע −2.1%' },
  ];
  const fixtures = [
    { rows },
    { rows, decimals: 2, benchmark: { label: 'ממוצע הסוג', value: 8.6 }, id: 'b2', onOpen: () => {} },
    { rows: rows.slice(0, 2), benchmark: { label: 'ממוצע', value: null }, max: 20 },
    { rows: [], benchmark: { label: 'x', value: -1.03 } },
  ];
  t('without the new props: byte-identical to the shipped board (4 fixtures, tick included)', () => {
    for (const p of fixtures) assert.equal(N.html(N.Scoreboard, p), O.html(O.Scoreboard, p));
    assert.match(N.html(N.Scoreboard, fixtures[1]), /<u style="--x:/);
  });
  const pos = [{ k: 'a', label: 'מגדל', color: 'red', value: 560 }, { k: 'b', label: 'הראל', color: 'red', value: 610, mine: true }];
  const neg = [{ k: 'a', label: 'הראל גילעד', color: 'red', value: -0.72, place: 1 }, { k: 'b', label: 'מגדל', color: 'red', value: -1.44, place: 4, mine: true }];
  t('format: the caller writes the figure (₪, no sign colour), the benchmark too', () => {
    const h = N.html(N.Scoreboard, { rows: pos, format: (v) => `₪${v}`, bars: 'always', benchmark: { label: 'ממוצע 5 המסלולים · בשנה', value: 560 } });
    assert.match(h, /<span class="num">₪560<\/span>/);
    assert.match(h, /<div class="avgline"><span>ממוצע 5 המסלולים · בשנה<\/span><span class="num">₪560<\/span>/);
    assert.doesNotMatch(h, /class="num pos"/);
  });
  t('trailing: beside the row button, not inside it; the row and the control in one .sb-rowx', () => {
    const h = N.html(N.Scoreboard, { rows: pos, trailing: (k) => `[+${k}]`, bars: 'auto' });
    assert.match(h, /<div class="sb-rowx"><button[^>]*class="sb-row"[\s\S]*?<\/button><span class="sb-trail">\[\+a\]<\/span><\/div>/);
    assert.match(h, /<div class="sb-rowx mine"><button[^>]*class="sb-row mine"/);
  });
  t('mine: tinted with "שלי"; mineWord null keeps the tint without the word', () => {
    assert.match(N.html(N.Scoreboard, { rows: pos }), /class="sb-row mine"[\s\S]*<b>הראל<span class="sb-mine">שלי<\/span><\/b>/);
    const h = N.html(N.Scoreboard, { rows: pos, mineWord: null });
    assert.match(h, /class="sb-row mine"/); assert.doesNotMatch(h, /sb-mine/);
  });
  t('bars: auto = bars only when every figure is ≥ 0; none; always keeps negative bars; no tick once bars is passed', () => {
    const b = { label: 'הממוצע', value: -1.03 };
    const autoNeg = N.html(N.Scoreboard, { rows: neg, bars: 'auto', benchmark: b, decimals: 2 });
    assert.doesNotMatch(autoNeg, /class="track"/); assert.match(autoNeg, /class="sb-row nobar"/); assert.doesNotMatch(autoNeg, /<u/);
    const autoPos = N.html(N.Scoreboard, { rows: pos, bars: 'auto', benchmark: { label: 'x', value: 580 } });
    assert.equal((autoPos.match(/class="track"/g) || []).length, 2); assert.doesNotMatch(autoPos, /<u/);
    assert.doesNotMatch(N.html(N.Scoreboard, { rows: pos, bars: 'none' }), /class="track"/);
    assert.equal((N.html(N.Scoreboard, { rows: neg, bars: 'always' }).match(/<i class="neg"/g) || []).length, 2);
    assert.equal(N.showBars('auto', [0, 1, null]), true); assert.equal(N.showBars('auto', [-0.01, 1]), false); assert.equal(N.showBars('auto', [null]), false);
    assert.equal(N.showBars(undefined, [-1]), true);
  });
  t('head above the rows, note under the average; a board with new props is marked .ro', () => {
    const h = N.html(N.Scoreboard, { rows: neg, bars: 'auto', head: 'HEAD', note: 'NOTE', benchmark: { label: 'הממוצע', value: -1.03 } });
    assert.match(h, /^<div class="board ro" id="board">HEAD<button/);
    assert.match(h, /<\/div><div class="sb-note">NOTE<\/div><\/div>$/);
  });
  t('place null with a tag (fees: "מהזולים"): the colour square and the chip', () => {
    const h = N.html(N.Scoreboard, { rows: [{ k: 'a', label: 'מגדל', color: 'red', value: 540, place: null, tag: 'מהזולים' }], format: (v) => `₪${v}`, bars: 'always' });
    assert.match(h, /<span class="sb-place"><i class="sq" aria-hidden="true"><\/i><\/span>/); assert.match(h, /<span class="tie">מהזולים<\/span>/);
  });
  console.log(`scoreboard: ${n} passed`);
} finally { rmSync(dir, { recursive: true, force: true }); }
