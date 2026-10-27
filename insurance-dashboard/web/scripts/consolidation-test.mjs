// Runs tests/consolidation.unit.ts: bundles it with esbuild (Vite's own copy) into a temp file and runs it in node.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'consolidationtest-')), out = join(dir, 'consolidation.unit.mjs');
try {
  await build({ entryPoints: [new URL('../tests/consolidation.unit.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
