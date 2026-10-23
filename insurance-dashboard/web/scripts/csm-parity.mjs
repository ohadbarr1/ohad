// The CSM the company page and the valuation pages compute in the browser (lib/csmResolve.ts), for every insurer and balance date,
// printed as JSON: { company: { date: [value, label, report period, flags] } }. pipeline/check_consistency.py compares it with the
// Python rule (csm_resolve.py) that the ledger and the peer table publish. node web/scripts/csm-parity.mjs
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'csmp-'));
try {
  const out = join(tmp, 'r.mjs');
  await build({ entryPoints: [join(web, 'src/lib/csmResolve.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  const { resolveCsm } = await import(pathToFileURL(out).href);
  const dir = join(web, 'public/data/csm/facts'), res = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const rs = Object.keys(d.reports).map((p) => ({ p, F: d.reports[p].map((x) => ({ ...x, rp: p })) }));
    const dates = [...new Set(rs.flatMap((r) => r.F.filter((x) => (x.m === 'csm_closing' || x.m === 'csm_opening') && /-(03-31|06-30|09-30|12-31)/.test(x.d)).map((x) => x.d.slice(0, 10))))].sort();
    const co = {};
    for (const dt of dates) { const c = resolveCsm(rs, dt); if (c) co[dt] = [c.v, c.label, c.rp, c.flags]; }
    res[d.company ?? f.replace('.json', '')] = co;
  }
  process.stdout.write(JSON.stringify(res));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
