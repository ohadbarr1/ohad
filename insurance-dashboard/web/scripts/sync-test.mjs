// Runs tests/sync.unit.ts: bundles it with esbuild (Vite's own copy) into a temp file and runs it in node.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'synctest-')), out = join(dir, 'sync.unit.mjs');
try {
  await build({ entryPoints: [new URL('../tests/sync.unit.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  await import(pathToFileURL(out).href);
} finally { setTimeout(() => rmSync(dir, { recursive: true, force: true }), 3000); }
