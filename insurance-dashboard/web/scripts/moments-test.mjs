// Runs tests/moments.unit.ts: bundles it with esbuild (Vite's own copy) into a temp file and runs it in node.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'momentstest-')), out = join(dir, 'moments.unit.mjs');
try {
  await build({ entryPoints: [new URL('../tests/moments.unit.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } });
  await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
