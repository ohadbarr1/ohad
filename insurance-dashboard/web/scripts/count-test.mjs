// M1 usage counter (src/lib/count.ts): the event paths are built only from fixed lists, nothing personal can pass, and with
// ANALYTICS_CODE empty no request is ever made. Bundled with esbuild (Vite's own copy) and run in node.
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'counttest-')), entry = join(dir, 'entry.ts'), out = join(dir, 'count.mjs');
const src = new URL('../src/lib/count.ts', import.meta.url).pathname, trk = new URL('../src/lib/track.ts', import.meta.url).pathname;
writeFileSync(entry, `export * from ${JSON.stringify(src)}; export { ANALYTICS_CODE } from ${JSON.stringify(trk)};`);
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
try {
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } });
  const C = await import(pathToFileURL(out).href);
  // paths
  ok(C.countPath('cmp_open', undefined, 'saver', 'pension') === 'event/cmp_open/saver/pension', 'cmp_open path');
  ok(C.countPath('cmp_lens', { lens: 'long' }, 'agent', 'hishtalmut') === 'event/cmp_lens/long/agent/hishtalmut', 'cmp_lens path');
  ok(C.countPath('cmp_picker_done', { n: 3, route: 'text' }, 'pro', 'hash') === 'event/cmp_picker_done/3-text/pro/hash', 'picker path');
  ok(C.countPath('cmp_share', { channel: 'wa' }, 'saver', 'mixed') === 'event/cmp_share/wa/saver/mixed', 'share path');
  ok(C.countPath('cmp_fee_sheet', undefined, 'saver', 'none') === 'event/cmp_fee_sheet/saver/none', 'fee sheet path');
  // nothing outside the lists passes
  ok(C.countPath('cmp_lens', { lens: 'p2102' }, 'saver', 'pension') === null, 'a track key is not a lens');
  ok(C.countPath('cmp_lens', undefined, 'saver', 'pension') === null, 'lens required');
  ok(C.countPath('cmp_picker_done', { n: 9, route: 'guided' }, 'saver', 'pension') === null, 'n above the cap');
  ok(C.countPath('cmp_picker_done', { n: 2.5, route: 'guided' }, 'saver', 'pension') === null, 'n integer');
  ok(C.countPath('cmp_picker_done', { n: 2, route: 'p2102' }, 'saver', 'pension') === null, 'route list');
  ok(C.countPath('cmp_share', { channel: 'https://x' }, 'saver', 'pension') === null, 'channel list');
  ok(C.countPath('import_done', undefined, 'saver', 'pension') === null, 'not a compare event');
  ok(C.countPath('cmp_open', undefined, 'me', 'pension') === null, 'door list');
  ok(C.countPath('cmp_open', undefined, 'saver', 'מגדל') === null, 'family list');
  for (const e of ['cmp_open', 'cmp_month_sheet', 'cmp_track_sheet']) ok(!/[gip]\d{3,}/.test(C.countPath(e, undefined, 'saver', 'pension')), `${e}: no key`);
  // families
  ok(C.familyOf(['פנסיה מקיפה', 'פנסיה מקיפה']) === 'pension', 'family pension');
  ok(C.familyOf(['גמל להשקעה']) === 'hash', 'family hash');
  ok(C.familyOf(['פוליסות חיסכון וביטוחי מנהלים (מ-2004)']) === 'managers', 'family managers');
  ok(C.familyOf(['השתלמות', 'גמל להשקעה']) === 'mixed', 'family mixed');
  ok(C.familyOf([]) === 'none' && C.familyOf([null, undefined]) === 'none', 'family none');
  // off while the code is empty: no request, whatever the browser
  ok(C.ANALYTICS_CODE === '', 'ANALYTICS_CODE stays empty in the repo');
  let sent = 0;
  globalThis.window = globalThis; globalThis.location = { hostname: 'fox.example' };
  Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon: () => { sent++; return true; }, doNotTrack: '0' }, configurable: true });
  globalThis.Image = class { set src(_v) { sent++; } };
  C.setCountContext('saver', 'pension');
  C.count('cmp_open'); C.count('cmp_lens', { lens: 'long' }); C.count('cmp_share', { channel: 'wa' });
  ok(sent === 0, 'no request while ANALYTICS_CODE is empty');
  console.log(`count: ${pass} passed, 0 failed`);
} finally { rmSync(dir, { recursive: true, force: true }); }
