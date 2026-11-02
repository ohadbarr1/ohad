/* Wave 3 · flows (lib/flows.ts) against the published files of pipeline/build_flows.py: the page's 3M / 12M windows equal the build's
   `latest` sums for every product and group; the scorecard ranks and the headline come from the table; a cell's sources add up to the
   cell; the fee change log re-derives from the track histories exactly as the build wrote it; the saver's line fires only on its rule.
   Run: npm run -s test:flows (scripts/flows-test.mjs bundles this file with esbuild and runs it in node). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellProv, feeLog, headline, saverAlert, scoreRows, signalText, win, type FeesFile, type FlowsIndex, type FlowsMonth, type FlowsProd, type Signal } from '../src/lib/flows';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const D = join(process.cwd(), 'public', 'data');
const read = <T,>(p: string) => JSON.parse(readFileSync(join(D, p), 'utf8')) as T;

if (!existsSync(join(D, 'flows.json'))) ok(false, 'public/data/flows.json missing');
else {
  const idx = read<FlowsIndex>('flows.json');
  ok(idx.method.comp && idx.method.mig && idx.method.dd && idx.method.cl && idx.coverage.tr_split.includes('נטו בלבד'), 'methods and the transfers-split statement are in the file');
  ok(idx.received && /^\d{4}-\d{2}-\d{2}$/.test(idx.received), 'the received date is stamped');

  /* ---- windows: the page's sums equal the build's ---- */
  let nWin = 0;
  for (const [pid, by] of Object.entries(idx.latest)) {
    const doc = read<FlowsProd>(`flows/${pid}.json`), j = doc.months.length - 1;
    for (const [g, L] of Object.entries(by)) {
      const S = g === 'tot' ? doc.tot : doc.groups[g];
      for (const f of ['tr', 'org', 'net', 'comp', 'dd', 'dt', 'mig'] as const) for (const n of [3, 12]) {
        const mine = win(S[f], j, n), theirs = L[`${f}${n}`] ?? null;
        nWin++;
        ok(mine === theirs || (mine != null && theirs != null && Math.abs(mine - theirs) < 0.051), `${pid} ${g} ${f}${n}: page ${mine} vs build ${theirs}`);
      }
    }
  }
  ok(nWin > 500, `windows compared: ${nWin}`);

  /* ---- the scorecard and the headline ---- */
  const pm = read<FlowsProd>('flows/pm.json'), j = pm.months.length - 1;
  const rows = scoreRows(pm, j, idx.bucket);
  const ranked = rows.filter((r) => r.rk != null);
  ok(ranked.length >= 5 && ranked[0].rk === 1, 'pension scorecard ranks from 1');
  ok(ranked.every((r, i) => i === 0 || r.comp! <= ranked[i - 1].comp!), 'ranks follow the competitive transfers');
  ok(rows.every((r) => r.comp == null || Math.abs(r.comp - ((r.tr ?? 0) - (r.dt ?? 0) - (r.cl ?? 0))) < 0.051), 'comp = tr − dt − cl on every row');
  const line = headline(pm, j, idx.bucket)!;
  ok(line.startsWith(`בספטמבר 2026, פנסיה מקיפה: ${ranked[0].grp} `) && line.includes('בהעברות תחרותיות, אחרי ניכוי ברירת מחדל ונדידה פנימית'), `headline: ${line}`);
  ok(!/(מרשים|דרמטי|חזק|חלש|ענק)/.test(line), 'no adjectives in the headline');

  /* ---- a cell's sources add up to the cell ---- */
  const m = read<FlowsMonth>(`flows/m/${pm.months[j]}.json`);
  for (const g of ranked.slice(0, 4).map((r) => r.grp)) {
    for (const f of ['dep', 'tr', 'a'] as const) {
      const v = pm.groups[g][f]![j]!;
      const p = cellProv({ idx, prod: pm, grp: g, p: pm.months[j], f, value: v, rows: m.g.pm[g], name: (k) => k });
      const s = p.k === 'calc' ? p.inputs.reduce((t, x) => t + Number(x.v.replace(/[,−]/g, (c) => (c === '−' ? '-' : ''))), 0) : NaN;
      ok(Math.abs(s - v) <= 0.5, `${g} ${f}: sources ${s.toFixed(1)} vs cell ${v}`);
    }
  }

  /* ---- the fee log ---- */
  const fees = read<FeesFile>('flows/fees.json');
  let nLog = 0;
  for (const r of fees.rows.slice(0, 400)) {
    const h = read<{ p: number[]; fee: (number | null)[] }>(`funds/${r.k}.json`);
    const mine = feeLog(h.p, h.fee, fees.since);
    nLog += mine.length;
    ok(JSON.stringify(mine) === JSON.stringify(r.log), `${r.k}: fee log differs`);
  }
  ok(nLog > 0, 'some fee moves logged');
}

/* ---- the saver's rule ---- */
const S = (nd3: number | null, n3: number, up3: number): Signal => ({ nd3, nd12: null, n3, up3, n12: 0, up12: 0, share3: n3 ? up3 / n3 : null, share12: null });
ok(saverAlert(S(-50, 10, 7), false) === 'out', 'outflow while most peers grew: the line');
ok(saverAlert(S(-50, 10, 5), false) === null, 'half the peers grew: no line');
ok(saverAlert(S(20, 10, 9), false) === null, 'inflow: no line');
ok(saverAlert(S(-50, 4, 4), false) === null, 'fewer than five peers: no line');
ok(saverAlert(null, true) === 'mig', 'the migration flag: the line');
ok(signalText(-898.7, 0.6, 3) === 'ב-3 החודשים: יצאו ₪899 מיליון נטו; 60% מהמסלולים בקטגוריה גדלו', `signal text: ${signalText(-898.7, 0.6, 3)}`);

console.log(`flows: ${pass} passed, ${fail} failed`);
if (fail) { console.log(bad.slice(0, 20).join('\n')); process.exit(1); }
