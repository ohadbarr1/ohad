/* W10 · the standardised IFRS 17 layer and the investment houses, as the pages read them: every printed cell carries a report and a page,
   every derived cell equals the arithmetic of the printed parts it lists, the source of a derived cell opens each part, the VFA view is only
   ever a sum of portfolios, and the houses' margins are result / revenue. Run: node scripts/ifrsstd-test.mjs (against web/public/data). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellProv, mayaUrl, qShort, type Cell, type StdCompany, type StdIndustry } from '../src/lib/ifrsStd';

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; if (bad.length < 20) bad.push(what); } }

ok(mayaUrl(1763684) === 'https://mayafiles.tase.co.il/rpdf/1763001-1764000/P1763684-00.pdf', 'maya url');
ok(mayaUrl(1764000) === 'https://mayafiles.tase.co.il/rpdf/1763001-1764000/P1764000-00.pdf', 'maya url at the range end');
ok(qShort('2026Q2') === "Q2'26", 'quarter label');

function checkCell(c: Cell, where: string) {
  const fl = c[3] ?? 0;
  ok(Number.isFinite(c[0]), `${where}: finite`);
  if (fl & 1) {
    const parts = c[4] as unknown[][];
    ok(Array.isArray(parts) && parts.length >= 1, `${where}: derived cell lists its parts`);
    const signed = parts.every((p) => typeof p[0] === 'number');
    if (signed && !/margin/.test(where)) {
      const sum = parts.reduce((s, p) => s + (p[0] as number) * (p[1] as number), 0);
      ok(Math.abs(sum - c[0]) < 0.01, `${where}: derived ${c[0]} = parts ${sum}`);
    }
    const pv = cellProv(c, where);
    ok(pv.k === 'calc' && pv.inputs.length === parts.length, `${where}: derived source opens every part`);
  } else {
    ok(c[1] != null && c[2] != null, `${where}: printed cell has page and report`);
    const pv = cellProv(c, where);
    ok(pv.k === 'report' && !!pv.url && pv.pg === c[1], `${where}: printed cell opens its page`);
  }
}

const I = json<StdIndustry>('ifrs17/industry.json');
ok(I.insurers.length === 7, 'seven insurers');
ok(I.recon.breaks.length === 0 || I.recon.breaks.every((b) => b.diff != null), 'breaks carry their difference');
for (const id of I.insurers) {
  const C = json<StdCompany>(`ifrs17/${id}.json`);
  for (const [seg, ms] of Object.entries(C.segs)) for (const [m, s] of Object.entries(ms)) for (const [k, c] of Object.entries(s)) checkCell(c, `${id} ${seg} ${m} ${k}`);
  for (const [p, ms] of Object.entries(C.ports)) for (const [m, s] of Object.entries(ms)) for (const [k, c] of Object.entries(s ?? {})) checkCell(c, `${id} ${p} ${m} ${k}`);
  // the model view is a sum of portfolios, never a printed split
  for (const [mv, ms] of Object.entries(C.model_view)) for (const s of Object.values(ms)) for (const c of Object.values(s ?? {})) ok(((c[3] ?? 0) & 1) === 1, `${id} ${mv}: model view is derived`);
  // every quarter of every metric is either a cell or a stated reason
  for (const seg of ['life', 'pc']) for (const m of Object.keys(I.metrics)) for (const k of I.quarters) {
    const has = !!C.segs[seg]?.[m as keyof StdCompany['segs'][string]]?.[k], why = C.nulls[seg]?.[m as never]?.[k];
    ok(has || why != null, `${id} ${seg} ${m} ${k}: a value or a reason`);
  }
  for (const r of C.rfs) if (!r.partial) ok(r.ok === Math.abs(r.diff) <= Math.max(2 * Math.max(1, r.rows.length) * 0.5, Math.abs(r.close[0]) * 0.0005) || r.how === 'signs normalised', `${id} ${r.rp} ${r.w}: identity flag agrees with the difference`);
}

interface H { id: string; rev: Record<string, Record<string, Cell>>; profit: Record<string, Record<string, Cell>>; margin: Record<string, Record<string, Cell>>; aum: Record<string, Record<string, Cell>> }
const HS = json<{ houses: H[] }>('houses.json');
ok(HS.houses.length === 6, 'six houses');
for (const h of HS.houses) {
  for (const [code, s] of Object.entries(h.rev)) for (const [k, c] of Object.entries(s)) checkCell(c, `${h.id} rev ${code} ${k}`);
  for (const [code, s] of Object.entries(h.margin)) for (const [k, c] of Object.entries(s)) {
    const r = h.rev[code]?.[k], p = h.profit[code]?.[k];
    ok(!!r && !!p && Math.abs(p[0] / r[0] * 100 - c[0]) < 0.01, `${h.id} margin ${code} ${k} = result / revenue`);
  }
}
console.log(`ifrsStd: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('FAIL', b)); process.exit(1); }
