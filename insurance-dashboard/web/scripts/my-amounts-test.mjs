// T-F4 (rollout spec §17.2, §18.2 #3): the amounts store and the number field. Bundles src/lib/myAmounts.ts and
// src/components/NumField.tsx with esbuild (react kept external, so the bundle sits inside web/) and checks: which record a page gets
// (a saved product by key, the fees tool's product AND type, else the product-kind entry; never another product), writing and clearing,
// the session overlay when storage is blocked, the FeeBase handed to feeCost (420,000 / 3,100 on p2102 → ₪1,170), and the field's
// parsing and separators.
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(web, '.myamountstest-'));
// a browser's storage and events, enough for lib/local
class Store { constructor() { this.m = new Map(); this.blocked = false; } get length() { return this.m.size; } key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { if (this.blocked) throw new Error('QuotaExceededError'); this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
globalThis.localStorage = new Store();
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus); globalThis.removeEventListener = bus.removeEventListener.bind(bus); globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.window = globalThis; globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
try {
  const noCss = { name: 'no-css', setup(b) { b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'no-css' })); b.onLoad({ filter: /.*/, namespace: 'no-css' }, () => ({ contents: '', loader: 'css' })); } };
  writeFileSync(join(dir, 'e.ts'), `export * from '${join(web, 'src/lib/myAmounts')}'; export { feeCost } from '${join(web, 'src/lib/feeExample')}'; export { digitsOf, groupDigits, parseNum, showNum, caretAfter } from '${join(web, 'src/components/NumField')}';`);
  await build({ entryPoints: [join(dir, 'e.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'e.mjs'), logLevel: 'error', jsx: 'automatic', external: ['react', 'react-dom', 'react/*', 'react-dom/*', 'react-router-dom'], plugins: [noCss] });
  const A = await import(pathToFileURL(join(dir, 'e.mjs')).href);
  let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ' + name); };

  const funds = [
    { k: 'p2102', prod: 'פנסיה מקיפה', track: 'כללי', fee: 0.14, depfee: 1.56 },
    { k: 'p2172', prod: 'פנסיה מקיפה', track: 'כללי', fee: 0.2, depfee: 1.5 },
    { k: 'p9001', prod: 'פנסיה מקיפה', track: 'עד 50', fee: 0.2, depfee: 1.5 },
    { k: 'g880', prod: 'השתלמות', track: 'כללי', fee: 0.6, depfee: null },
    { k: 'g8211', prod: 'גמל להשקעה', track: 'כללי', fee: 0.55, depfee: 0 },
  ];
  const mine = [{ k: 'p2102', added: '2026-11-01', balance: 420000, monthly: 3100 }, { k: 'g880', added: '2026-11-01' }, { k: 'g8211', added: '2026-11-01', balance: 0, monthly: null }];
  const kind = { 'השתלמות': { balance: 80000, monthly: null }, 'פנסיה מקיפה': { balance: 1, monthly: 1 } };

  t('a saved product by key: its own record; g880 saved without amounts stays on the example', () => {
    assert.deepEqual(A.resolveAmounts({ k: 'p2102' }, mine, kind), { where: 'mine', k: 'p2102', prod: null, amounts: { balance: 420000, monthly: 3100 } });
    assert.deepEqual(A.resolveAmounts({ k: 'g880', prod: 'השתלמות' }, mine, kind).amounts, { balance: null, monthly: null });
    assert.equal(A.resolveAmounts({ k: 'g880', prod: 'השתלמות' }, mine, kind).where, 'mine');
  });
  t('a card of a track the reader has not saved: none (the example), even when the product-kind entry exists', () => {
    const r = A.resolveAmounts({ k: 'p2172', prod: 'פנסיה מקיפה' }, mine, kind);
    assert.equal(r.where, 'none'); assert.equal(r.amounts.balance, null);
  });
  t('fees tool: the saved product of the product AND type on screen; another type of the same product → the product-kind entry', () => {
    assert.equal(A.resolveAmounts({ prod: 'פנסיה מקיפה', cat: 'פנסיה מקיפה | כללי', funds }, mine, kind).k, 'p2102');
    const other = A.resolveAmounts({ prod: 'פנסיה מקיפה', cat: 'פנסיה מקיפה | עד 50', funds }, mine, kind);
    assert.equal(other.where, 'kind'); assert.deepEqual(other.amounts, { balance: 1, monthly: 1 });
    const none = A.resolveAmounts({ prod: 'השתלמות', cat: 'השתלמות | כללי', funds }, [], kind);
    assert.deepEqual(none, { where: 'kind', k: null, prod: 'השתלמות', amounts: { balance: 80000, monthly: null } });
    assert.equal(A.resolveAmounts({ cat: 'גמל להשקעה | כללי', funds }, [], {}).prod, 'גמל להשקעה');
  });
  t('never crosses products: amounts of one saved product are not used for another', () => {
    assert.equal(A.resolveAmounts({ k: 'g880' }, mine, kind).amounts.balance, null);
    assert.equal(A.resolveAmounts({ k: 'g8211' }, mine, kind).amounts.balance, 0);
  });
  t('stored junk is cleaned: negatives, strings, a deposit without a balance; nine digits at most', () => {
    assert.deepEqual(A.cleanAmounts({ balance: -5, monthly: 3 }), { balance: null, monthly: null });
    assert.deepEqual(A.cleanAmounts({ balance: '7', monthly: 3 }), { balance: null, monthly: null });
    assert.deepEqual(A.cleanAmounts({ balance: 2e12, monthly: 3.4 }), { balance: 999999999, monthly: 3 });
    assert.deepEqual(A.cleanAmounts(null), { balance: null, monthly: null });
  });
  t('writing: a saved product\'s record keeps its other fields; a null balance removes both; the kind store adds and removes', () => {
    const m2 = A.withMineAmounts([{ k: 'g880', added: 'x', fee: 0.5 }], 'g880', { balance: 80000, monthly: null });
    assert.deepEqual(m2, [{ k: 'g880', added: 'x', fee: 0.5, balance: 80000, monthly: null }]);
    assert.deepEqual(A.withMineAmounts(m2, 'g880', { balance: null, monthly: 5 }), [{ k: 'g880', added: 'x', fee: 0.5 }]);
    assert.deepEqual(A.withKindAmounts({}, 'פנסיה מקיפה', { balance: 250000, monthly: 3000 }), { 'פנסיה מקיפה': { balance: 250000, monthly: 3000 } });
    assert.deepEqual(A.withKindAmounts({ a: { balance: 1, monthly: null } }, 'a', { balance: null, monthly: null }), {});
  });
  t('the FeeBase for feeCost: 420,000 / 3,100 on p2102 → ₪1,170; a balance only keeps the example deposit; nothing → the example ₪560', () => {
    assert.equal(A.feeCost(funds[0], true, A.amountsBase({ balance: 420000, monthly: 3100 })), 1170);
    assert.deepEqual(A.amountsBase({ balance: 80000, monthly: null }), { balance: 80000, monthly: null });
    assert.equal(A.feeCost(funds[3], true, A.amountsBase({ balance: 80000, monthly: null })), 480);
    assert.equal(A.amountsBase({ balance: null, monthly: null }), null);
    assert.equal(A.feeCost(funds[0], true, null), 560);
  });
  t('saveAmounts: to the saved record (per profile key), to fox:fees:amounts; cleared; storage blocked → "blocked" and the tab still sees it', () => {
    localStorage.setItem('fox:mine', JSON.stringify(mine));
    const seen = []; addEventListener('fox:stored', (e) => seen.push(e.detail));
    assert.equal(A.saveAmounts('me', { where: 'mine', k: 'g880', prod: 'השתלמות' }, { balance: 80000, monthly: null }), 'saved');
    assert.equal(JSON.parse(localStorage.getItem('fox:mine'))[1].balance, 80000);
    assert.equal(A.saveAmounts('spouse', { where: 'kind', k: null, prod: 'פנסיה מקיפה' }, { balance: 250000, monthly: 3000 }), 'saved');
    assert.deepEqual(JSON.parse(localStorage.getItem('fox:fees:amounts@spouse')), { 'פנסיה מקיפה': { balance: 250000, monthly: 3000 } });
    assert.equal(A.saveAmounts('spouse', { where: 'kind', k: null, prod: 'פנסיה מקיפה' }, { balance: null, monthly: null }), 'cleared');
    assert.deepEqual(JSON.parse(localStorage.getItem('fox:fees:amounts@spouse')), {});
    assert.deepEqual(seen, ['mine', 'fees:amounts@spouse', 'fees:amounts@spouse']);
    localStorage.blocked = true;
    assert.equal(A.saveAmounts('me', { where: 'kind', k: null, prod: 'השתלמות' }, { balance: 90000, monthly: 1000 }), 'blocked');
    assert.equal(localStorage.getItem('fox:fees:amounts'), null);
    // the overlay: the next write in the tab builds on what the tab already holds
    assert.equal(A.saveAmounts('me', { where: 'kind', k: null, prod: 'פנסיה מקיפה' }, { balance: 5, monthly: null }), 'blocked');
    localStorage.blocked = false;
    assert.equal(A.saveAmounts('me', { where: 'kind', k: null, prod: 'גמל להשקעה' }, { balance: 7, monthly: null }), 'saved');
    assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem('fox:fees:amounts'))).sort(), ['גמל להשקעה', 'השתלמות', 'פנסיה מקיפה']);
  });
  t('NumField: digits only, nine at most, separators while typing ("420000" → "420,000"), none for an age; empty → null; zero kept', () => {
    assert.equal(A.digitsOf('420,000 ש"ח'), '420000');
    assert.equal(A.digitsOf('1234567890123'), '123456789');
    assert.equal(A.digitsOf('٤٢٠'), '420');
    assert.equal(A.digitsOf('007'), '7'); assert.equal(A.digitsOf('0'), '0');
    assert.equal(A.groupDigits('420000'), '420,000'); assert.equal(A.groupDigits('3100'), '3,100'); assert.equal(A.groupDigits('52', false), '52');
    assert.equal(A.parseNum(''), null); assert.equal(A.parseNum(' , '), null); assert.equal(A.parseNum('0'), 0); assert.equal(A.parseNum('3,100'), 3100);
    assert.equal(A.showNum(420000), '420,000'); assert.equal(A.showNum(null), ''); assert.equal(A.showNum(52, false), '52');
  });
  t('NumField caret: after the same digit once separators move ("4200|0" → "42,00|0")', () => {
    assert.equal(A.caretAfter('42,000', 4), 5); assert.equal(A.caretAfter('420,000', 3), 3); assert.equal(A.caretAfter('1,000', 0), 0); assert.equal(A.caretAfter('1,000', 9), 5);
  });
  console.log(`my amounts: ${n} passed`);
} finally { rmSync(dir, { recursive: true, force: true }); }
