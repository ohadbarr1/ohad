// Bundles the server, the eval runner and the smoke test into dist/*.mjs.
// The site's own logic is imported from ../web/src (lib/*.ts, pages/ReportDay.tsx) so every number is computed by the code that draws
// the page. Only the pure modules below are bundled as they are; anything else the site imports (components, charts, theme, styles)
// is replaced by an inert stub, since the server never renders.
import * as esbuild from 'esbuild';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = resolve(here, '../web/src');
const REAL = new Set([
  'lib/format.ts', 'lib/company.ts', 'lib/kpi.ts', 'lib/csm.ts', 'lib/csmResolve.ts', 'lib/csmData.ts', 'lib/useData.ts', 'lib/schema.ts',
  'lib/schemas.json', 'lib/types.ts', 'lib/sources.ts', 'lib/market.ts', 'lib/lens.ts', 'lib/registry.ts', 'lib/search.ts', 'lib/searchOmni.ts',
  'lib/hebrew.ts', 'lib/prov.ts', 'lib/seriesCols.ts', 'lib/seriesExpr.ts', 'lib/rosterCore.ts', 'pages/ReportDay.tsx', 'pages/companyProv.ts',
]);
const STUB_PKGS = /^(echarts|zrender|firebase|pptxgenjs|pdfjs-dist)(\/|$)/;

const stubs = {
  name: 'fox-stubs',
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'fox-empty' }));
    b.onResolve({ filter: STUB_PKGS }, (a) => ({ path: a.path, namespace: 'fox-stub' }));
    b.onResolve({ filter: /^\.\.?\// }, async (a) => {
      if (a.namespace !== 'file' || !a.importer.startsWith(webSrc + sep)) return undefined;
      const r = await b.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, pluginData: 'inner' });
      if (r.errors.length || !r.path.startsWith(webSrc + sep)) return undefined;
      const rel = relative(webSrc, r.path).split(sep).join('/');
      return REAL.has(rel) ? { path: r.path } : { path: rel, namespace: 'fox-stub' };
    });
    b.onLoad({ filter: /.*/, namespace: 'fox-empty' }, () => ({ contents: '', loader: 'js' }));
    // CommonJS on purpose: a named import of a CommonJS module is a property read, so any name resolves (to undefined) and nothing is called
    b.onLoad({ filter: /.*/, namespace: 'fox-stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  },
};

await esbuild.build({
  entryPoints: { server: join(here, 'src/server.ts'), eval: join(here, 'src/eval.ts'), smoke: join(here, 'src/smoke.ts') },
  outdir: join(here, 'dist'), outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', target: 'node20', format: 'esm', sourcemap: 'linked', legalComments: 'none',
  jsx: 'automatic', loader: { '.json': 'json' },
  // the site reads its data under import.meta.env.BASE_URL; the server answers that origin from disk or from the live site (src/data.ts)
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({ BASE_URL: 'http://fox.data/', DEV: false, PROD: true, MODE: 'production' }) },
  banner: { js: "import { createRequire as __foxReq } from 'node:module'; const require = __foxReq(import.meta.url);" },
  plugins: [stubs], logLevel: 'warning',
});
console.log('built dist/server.mjs, dist/eval.mjs, dist/smoke.mjs');
