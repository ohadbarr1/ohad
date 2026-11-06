// Runs tests/checkup.unit.ts: bundles it with esbuild (Vite's own copy) into a temp file and runs it in node.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'checkuptest-')), out = join(dir, 'checkup.unit.mjs');
try {
  // Vite's `?url` asset imports (lib/zipRead's WASM file) have no meaning in node: stubbed to '' so zip.js uses its built-in copy
  const urlStub = { name: 'vite-url-stub', setup(b) { b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: 'url-stub' })); b.onLoad({ filter: /.*/, namespace: 'url-stub' }, () => ({ contents: 'export default ""', loader: 'js' })); } };
  await build({ entryPoints: [new URL('../tests/checkup.unit.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' }, plugins: [urlStub] });
  await import(pathToFileURL(out).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
