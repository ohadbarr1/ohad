// Runs tests/brief.unit.ts: bundles it with esbuild (Vite's own copy) into a temp file and runs it in node.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'brieftest-')), out = join(dir, 'brief.unit.mjs');
try {
  // lib/feed.ts imports the data loader (useData.ts), which reads Vite's import.meta.env at load: give it the base URL it expects
  await build({ entryPoints: [new URL('../tests/brief.unit.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
    define: { 'import.meta.env': '{"BASE_URL":"/"}' } });
  await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
