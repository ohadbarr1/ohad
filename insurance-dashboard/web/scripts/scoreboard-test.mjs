// F4 (rollout spec §2.2, §16.1 4a, §18.3): <Scoreboard>'s new props are optional and backward compatible. Bundles the board twice with
// esbuild (CSS imports dropped): the shipped one from the base commit (git show 1c906a5f) and the working copy, renders both with
// react-dom/server, and asserts (1) without the new props the markup is byte-identical, (2) the new props behave: format, trailing beside
// the row button, mine (tint + "שלי", mineWord), bars auto/always/none, no tick once `bars` is passed, head and note.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync , readFileSync} from 'node:fs';
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
  for (const f of ['Scoreboard.tsx', 'MonthGrid.tsx']) writeFileSync(join(old, f), readFileSync(join(web, `scripts/fixtures/base-${BASE}/${f}`)));
  const harness = (src) => `import { createElement as h } from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export * from '${src}'; export const html = (C, p) => renderToStaticMarkup(h(C, p));`;
  writeFileSync(join(dir, 'old.tsx'), harness('./old/components/Scoreboard'));
  writeFileSync(join(dir, 'new.tsx'), harness(join(web, 'src/components/Scoreboard.tsx').replace(/\.tsx$/, '')));
  // the board and the seg before P6 (committed copies, no git history): every prop the rollout pages pass must render byte-identically
  const pre = join(dir, 'pre', 'components'); mkdirSync(pre, { recursive: true });
  for (const f of ['Scoreboard.tsx', 'MonthGrid.tsx', 'PeriodSeg.tsx']) writeFileSync(join(pre, f), readFileSync(join(web, `scripts/fixtures/base-55b08219/${f}`)));
  writeFileSync(join(dir, 'pre.tsx'), harness('./pre/components/Scoreboard') + ` export { PeriodSeg as PeriodSegPre } from './pre/components/PeriodSeg';`);
  writeFileSync(join(dir, 'seg.tsx'), harness(join(web, 'src/components/PeriodSeg.tsx').replace(/\.tsx$/, '')));
  const O = await bundle(join(dir, 'old.tsx'), join(dir, 'old.mjs')), N = await bundle(join(dir, 'new.tsx'), join(dir, 'new.mjs'));
  const P = await bundle(join(dir, 'pre.tsx'), join(dir, 'pre.mjs')), S = await bundle(join(dir, 'seg.tsx'), join(dir, 'seg.mjs'));
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

  /* P6 (spec p6 §2.2, §13.1 F3, §13.3 F3+, §14.4 F3): layout="track", out rows, the quarter seg. First, nothing the rollout pages pass changes. */
  t('rollout props: byte-identical to the board before P6 (format, trailing, mine, mineWord, bars, head, note)', () => {
    const ps = [...fixtures, { rows: pos, format: (v) => `₪${v}`, bars: 'always', benchmark: { label: 'ממוצע', value: 560 } }, { rows: pos, trailing: (k) => `[+${k}]`, bars: 'auto' },
      { rows: pos, mineWord: null }, { rows: neg, bars: 'auto', head: 'HEAD', note: 'NOTE', benchmark: { label: 'הממוצע', value: -1.03 }, decimals: 2 }, { rows: neg, bars: 'none', onOpen: () => {} },
      { rows: [{ k: 'a', label: 'מגדל', color: 'red', value: 540, place: null, tag: 'מהזולים' }], format: (v) => `₪${v}`, bars: 'always' }];
    for (const p of ps) assert.equal(N.html(N.Scoreboard, p), P.html(P.Scoreboard, p));
  });
  t('fund seg: without mode, byte-identical to the seg before P6 (saver and Pro words, a subset of periods)', () => {
    for (const p of [{ door: 'saver', value: 'y12', asof: 202610, onChange: () => {} }, { door: 'pro', value: 'm1', asof: 202610, onChange: () => {}, id: 'x', periods: ['m1', 'y12', 'a5'] }, { door: 'agent', value: 'a3', asof: 202512, onChange: () => {} }])
      assert.equal(S.html(S.PeriodSeg, p), P.html(P.PeriodSegPre, p));
  });
  t('quarter seg: "LTM · Q3\'26 · YoY · QoQ · LTM YoY", role=group, aria-pressed, the quarter\'s own label (never "רבעון נוכחי"); total return 3M · YTD · 12M', () => {
    const h = S.html(S.PeriodSeg, { mode: 'quarter', value: 'qoq', quarter: '2026Q3', onChange: () => {} });
    assert.match(h, /^<div class="p6-seg p6-qseg" id="period-seg" role="group" aria-label="קריאה">/);
    assert.deepEqual([...h.matchAll(/data-r="(\w+)"[^>]*>([^<]+)</g)].map((m) => `${m[1]}=${m[2]}`), ['ltm=LTM', "q=Q3&#x27;26", 'yoy=YoY', 'qoq=QoQ', 'ltmy=LTM YoY']);
    assert.match(h, /<button type="button" aria-pressed="true" class="on" data-r="qoq">QoQ<\/button>/);
    assert.equal((h.match(/aria-pressed="false"/g) || []).length, 4);
    assert.doesNotMatch(h, /tablist|aria-selected|רבעון נוכחי|אשתקד/);
    const r = S.html(S.PeriodSeg, { mode: 'quarter', value: 'r12', quarter: '2026Q3', periods: ['r12', 'rytd', 'r3'], onChange: () => {}, id: 'rd' });
    assert.deepEqual([...r.matchAll(/data-r="\w+">([^<]+)</g)].map((m) => m[1]), ['12M', 'YTD', '3M']);
    assert.equal(S.qReadLabel('q', '2025Q4'), "Q4'25"); assert.equal(S.qReadLabel('ltmy', '2026Q3'), 'LTM YoY');
  });

  // the CSM QoQ board of 26.11.26 (spec §9.2 F2, mockup v2): three reported and ranked, four listed apart with their own Q2'26 figure
  const C = (k, label, value, extra = {}) => ({ k, label, color: `var(--${k})`, value, ...extra });
  const qoq = [C('phoenix', 'הפניקס', 7.1, { place: 1, mine: true }), C('migdal', 'מגדל', 3.5, { place: 2 }), C('harel', 'הראל', 1.0, { place: 3 }),
    C('clal', 'כלל', 1.4, { out: true, tag: "Q2'26 · טרם דיווחה" }), C('menora', 'מנורה', 1.2, { out: true, tag: "Q2'26 · טרם דיווחה" }), C('ayalon', 'איילון', -0.8, { out: true, tag: "Q2'26 · טרם דיווחה" }),
    C('hachshara', 'הכשרה', null, { out: true, tag: "Q2'26 · טרם דיווחה" })];
  const track = { layout: 'track', rows: qoq, decimals: 1, benchmark: { label: null, value: 3.5 }, onOpen: () => {}, outHead: 'לא בדירוג ולא בחציון: הדוח ל-Q3\'26 טרם פורסם', head: 'HEAD', data: { metric: 'csm', reading: 'qoq' } };
  t('scale helpers: a common zero inside [lo, hi]; bars from the zero both ways; a value outside the range pins at its edge', () => {
    assert.deepEqual(N.trackScale([7.1, 3.5, 1.0]), [0, 7.1]); assert.deepEqual(N.trackScale([2, -1, null]), [-1, 2]); assert.deepEqual(N.trackScale([null]), [0, 1]);
    assert.deepEqual(N.trackScale([5], [0.5, 3]), [0, 3]);
    assert.deepEqual(N.barOf(1, [-1, 3]), { start: 25, width: 25, pinned: false });
    assert.deepEqual(N.barOf(-1, [-1, 3]), { start: 0, width: 25, pinned: false });
    assert.deepEqual(N.barOf(9, [0, 3]), { start: 0, width: 100, pinned: true });
    assert.equal(N.posOf(0, [-1, 3]), 25); assert.equal(N.barOf(0, [0, 3]).width, 0.8);
  });
  t('track board: data-metric/reading, head first; ranked rows place · square + name · track · value; name opens the company, not the value', () => {
    const h = N.html(N.Scoreboard, track);
    assert.match(h, /^<div class="board p6-sb" id="board" role="group" data-metric="csm" data-reading="qoq">HEAD<div class="sb-row p6-tr mine" data-k="phoenix"/);
    assert.match(h, /<button type="button" class="p6-sb-open" aria-haspopup="dialog" aria-label="מגדל: מול הקבוצה"><span class="sb-place">2<\/span><span class="p6-sb-nm"><span class="p6-sb-n"><i class="sq" aria-hidden="true"><\/i><b>מגדל<\/b><\/span><\/span><\/button>/);
    assert.match(h, /<span class="p6-sb-val"><span class="num pos">\+3\.5%<\/span><\/span>/);
    assert.doesNotMatch(h, /<button[^>]*>(?:(?!<\/button>).)*<button/);   // no button inside a button
    assert.doesNotMatch(h, /sb-mine|avgline/);   // the focus is tinted without "שלי"; the median sits in the head (label null)
  });
  t('one scale: the bars of the ranked rows start at the common zero, widths by value; the median one x on every ranked row; no zero line when all ≥ 0', () => {
    const h = N.html(N.Scoreboard, track);
    assert.match(h, /data-k="phoenix"[\s\S]*?<i style="inset-inline-start:0%;width:100%"><\/i><em style="inset-inline-start:49\.3%"><\/em>/);
    assert.match(h, /data-k="harel"[\s\S]*?<i style="inset-inline-start:0%;width:14\.08%"><\/i>/);
    assert.equal((h.match(/<em style="inset-inline-start:49\.3%">/g) || []).length, 3);
    assert.doesNotMatch(h, /<s style/); assert.doesNotMatch(h, /p6-neg/);
  });
  t('out rows: after the ranked ones under the sub-head, place "–", their own figure, the quarter tag under the name (not in the track), no bar, no median', () => {
    const h = N.html(N.Scoreboard, track);
    const out = h.slice(h.indexOf('<div class="p6-sb-sub">'));
    assert.match(out, /^<div class="p6-sb-sub">לא בדירוג ולא בחציון: הדוח ל-Q3&#x27;26 טרם פורסם<\/div><div class="sb-row p6-tr out" data-k="clal" style="--c:var\(--clal\);--i:3">/);
    assert.equal((out.match(/class="sb-row p6-tr out"/g) || []).length, 4);
    assert.match(out, /<span class="sb-place">–<\/span><span class="p6-sb-nm"><span class="p6-sb-n"><i class="sq" aria-hidden="true"><\/i><b>כלל<\/b><\/span><span class="p6-sb-tag warn">Q2&#x27;26 · טרם דיווחה<\/span><\/span><\/button><span class="p6-sb-track" aria-hidden="true"><\/span><span class="p6-sb-val"><span class="num pos">\+1\.4%<\/span>/);
    assert.match(out, /data-k="hachshara"[\s\S]*<span class="num mut">–<\/span>/);
    assert.doesNotMatch(out, /<i style|<em /);
    assert.equal((h.match(/class="p6-sb-sub"/g) || []).length, 1);
    assert.doesNotMatch(N.html(N.Scoreboard, { ...track, rows: qoq.slice(0, 3) }), /p6-sb-sub/);
    // the scale is the ranked rows' only: Ayalon's −0.8 (out) draws no zero line
    assert.doesNotMatch(h, /p6-neg/);
  });
  t('negatives: a zero line on every ranked row and bars both ways from it; tags (shared place, "חריג") under the name; range pins an outlier', () => {
    const rows = [C('a', 'הפניקס', 2, { place: 1 }), C('b', 'הראל', -1, { place: 2, tie: true }), C('c', 'מגדל', 6, { place: 3, tag: 'חריג' })];
    const h = N.html(N.Scoreboard, { layout: 'track', rows, decimals: 1, range: [-1, 3], benchmark: { label: 'חציון · 3 חברות', value: 2 } });
    assert.match(h, /class="board p6-sb p6-neg"/);
    assert.equal((h.match(/<s style="inset-inline-start:25%"><\/s>/g) || []).length, 3);
    assert.match(h, /data-k="a"[\s\S]*?<i style="inset-inline-start:25%;width:50%"><\/i>/);
    assert.match(h, /data-k="b"[\s\S]*?<i class="neg" style="inset-inline-start:0%;width:25%"><\/i>/);
    assert.match(h, /data-k="c"[\s\S]*?<i class="pin" style="inset-inline-start:25%;width:75%"><\/i>[\s\S]*?<span class="num pos">\+6\.0%<\/span>/);
    assert.match(h, /<span class="p6-sb-tag">כמעט שווים<\/span>/); assert.match(h, /<span class="p6-sb-tag">חריג<\/span>/);
    assert.match(h, /<div class="avgline"><span>חציון · 3 חברות<\/span><span class="num pos">\+2\.0%<\/span><\/div>/);
    assert.doesNotMatch(N.html(N.Scoreboard, { layout: 'track', rows, benchmark: { label: null, value: 2, line: false } }), /<em /);
  });
  t('cell: the value drawn by the page (Sourced) with the written text; format writes multiples', () => {
    const rows = [C('migdal', 'מגדל', 0.85, { place: 1 }), C('hachshara', 'הכשרה', null, { tag: 'אין מניה נסחרת' })];
    const h = N.html(N.Scoreboard, { layout: 'track', rows, format: (v) => `${v.toFixed(2)}x`, cell: (r, txt) => `<${r.k}:${txt}>`, benchmark: { label: null, value: 1.5 } });
    assert.match(h, /<span class="p6-sb-val">&lt;migdal:0\.85x&gt;<\/span>/); assert.match(h, /&lt;hachshara:–&gt;/);
    assert.match(h, /data-k="hachshara"[\s\S]*<span class="sb-place">–<\/span>[\s\S]*<span class="p6-sb-tag">אין מניה נסחרת<\/span>/);
    assert.match(h, /<i style="inset-inline-start:0%;width:56\.67%"><\/i><em style="inset-inline-start:100%"><\/em>/);
  });
  console.log(`scoreboard: ${n} passed`);
} finally { rmSync(dir, { recursive: true, force: true }); }
