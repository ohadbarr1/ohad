// Axis ticks of foxchart: neighbouring ticks never print the same label (B7: −1%, −1%, −2%, −2%).
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'foxticktest-')), out = join(dir, 'm.mjs'), ent = join(dir, 'e.ts');
try {
  writeFileSync(ent, `export { tickNum } from ${JSON.stringify(new URL('../src/lib/foxchart.ts', import.meta.url).pathname)};`);
  await build({ entryPoints: [ent], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  const { tickNum } = await import(pathToFileURL(out).href);
  for (const step of [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 50]) {
    const labels = Array.from({ length: 8 }, (_, i) => tickNum(-i * step));
    assert.equal(new Set(labels).size, labels.length, `step ${step}: ${labels.join(' ')}`);
  }
  assert.match(tickNum(-0.5), /-?0\.5|−0\.5/); assert.ok(!/\./.test(tickNum(-2)));
  console.log('foxtick: ok');
} finally { rmSync(dir, { recursive: true, force: true }); }
