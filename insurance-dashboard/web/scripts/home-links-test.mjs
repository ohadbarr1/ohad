// Rollout R1 (spec 8, 4e): the saver home's links and the "my track" line (lib/saverLinks homeLinks, homeMineLine), on the 10/26 figures.
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const web = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(web, '.homelinks-'));
const strip = (s) => s.replace(/[⁦-⁩]/g, '');
try {
  writeFileSync(join(dir, 'e.ts'), `export { homeLinks, homeMineLine } from '${join(web, 'src/lib/saverLinks')}';`);
  await build({ entryPoints: [join(dir, 'e.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'o.mjs'), external: ['react', 'react-router-dom'], logLevel: 'silent', define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env': '{}' },
    plugins: [{ name: 'no-css', setup(b) { b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'n' })); b.onLoad({ filter: /.*/, namespace: 'n' }, () => ({ contents: '', loader: 'css' })); } }] });
  const { homeLinks, homeMineLine } = await import(pathToFileURL(join(dir, 'o.mjs')).href);
  const lead = { k: 'p2102', prod: 'פנסיה כללית', track: 'כללי' };
  const L = homeLinks(lead);
  assert.equal(L.screen, `/funds/screen?prod=${encodeURIComponent('פנסיה כללית')}&track=${encodeURIComponent('כללי')}&per=m1`);
  assert.equal(L.hub, `/funds?prod=${encodeURIComponent('פנסיה כללית')}`);
  assert.equal(L.card, '/funds/p2102');
  const N = homeLinks(null);
  assert.deepEqual([N.screen, N.hub, N.card], ['/funds/screen?per=m1', '/funds', null]);
  assert.equal(strip(homeMineLine(202610, -1.449, 9.04)), 'באוקטובר ירד 1.45% · בשנה האחרונה +9.0%');
  assert.equal(strip(homeMineLine(202610, 0.001, null)), 'באוקטובר לא זז');
  assert.equal(homeMineLine(202610, null, null), '');
  console.log('home-links-test: ok');
} finally { rmSync(dir, { recursive: true, force: true }); }
