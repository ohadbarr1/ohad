// Runs tests/verdict.unit.ts: bundles it with esbuild (Vite's own copy) into a temp file and runs it in node.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'verdicttest-')), out = join(dir, 'verdict.unit.mjs');
try {
  await build({ entryPoints: [new URL('../tests/verdict.unit.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  await import(pathToFileURL(out).href);
  // B4: the tender's name carries its own article, so "לא בין הזוכות ב" + "ההליך הרביעי" must not read "בההליך"
  const out2 = join(dir, 'tender.mjs');
  await build({ stdin: { contents: "export { inTender } from '" + new URL('../src/lib/verdict.ts', import.meta.url).pathname + "';", resolveDir: dir }, bundle: true, format: 'esm', platform: 'node', outfile: out2, logLevel: 'error' });
  const { inTender } = await import(pathToFileURL(out2).href);
  const eq = (a, b) => { if (a !== b) { console.error(`FAIL inTender: got "${a}", want "${b}"`); process.exit(1); } };
  eq(`לא בין הזוכות ${inTender('ההליך הרביעי')}`, 'לא בין הזוכות בהליך הרביעי');
  eq(inTender('ההליך הראשון'), 'בהליך הראשון'); eq(inTender('הליך 4'), 'בהליך 4'); eq(inTender(undefined), 'בהליך'); eq(inTender(null), 'בהליך');
  console.log('inTender: ok (no "בההליך")');
} finally { rmSync(dir, { recursive: true, force: true }); }
