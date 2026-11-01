/* W0 · the tie band of the funds section (lib/fundsTie.ts): shared places and the "צמודים" edges, hand-computed cases, and a smoke
   run over web/public/data/funds.json (5Y net, the section's default). Run: node scripts/fundstie-test.mjs, or bundle this file with
   esbuild as scripts/funds-calc-test.mjs does. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PER, TIE_BP, edges, isTie, rankText, tieBand, tieRanks } from '../src/lib/fundsTie';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-12;

/* ---- the band ---- */
ok(TIE_BP === 10 && DEFAULT_PER === 'a5', 'the convention: 10bp, 5Y by default');
ok(near(tieBand('a5', 202609), 0.1) && near(tieBand('a3', 202609), 0.1) && near(tieBand('y12', 202609), 0.1), '0.10 pp on annualised windows and LTM');
ok(near(tieBand('m1', 202609), 0.1 / 12) && near(tieBand('ytd', 202609), 0.1 * 9 / 12), 'pro rata on a month and on YTD');
ok(isTie(5.0, 4.96, 0.1) && !isTie(5.0, 4.9, 0.1) && !isTie(5.0, 4.85, 0.1), 'a 4bp gap is a tie; exactly 10bp is not (float-safe)');

/* ---- shared places ---- */
const T = (k: string, v: number | null) => ({ k, v });
const peers = [T('a', 6.0), T('b', 5.96), T('c', 5.5), T('d', 5.45), T('e', 5.38), T('f', 4.0), T('x', null)];
const r = tieRanks(peers, (p) => p.v, 0.1);
ok(r.size === 6 && !r.has('x'), 'a track with no value is not ranked');
ok(rankText(r.get('a')!) === '1–2' && rankText(r.get('b')!) === '1–2', 'a 4bp lead at the top: both "1–2", no single #1');
ok(rankText(r.get('c')!) === '3–4' && rankText(r.get('d')!) === '3–5' && rankText(r.get('e')!) === '4–5', 'a chain: each track shares with the ones inside its own band');
ok(rankText(r.get('f')!) === '6' && r.get('f')!.n === 6, 'a clean last place');
const eq = tieRanks([T('p', 1), T('q', 1), T('s', 0.5)], (p) => p.v, 0.1);
ok(rankText(eq.get('p')!) === '1–2' && rankText(eq.get('q')!) === '1–2' && rankText(eq.get('s')!) === '3', 'equal values share');

/* ---- edges: leader, laggard, "צמודים" ---- */
const rows = peers.filter((p) => p.v != null).sort((a, b) => b.v! - a.v!);
const e = edges(rows, (x) => x.v!, 0.1);
ok(e.top.map((x) => x.k).join() === 'a,b' && e.low.map((x) => x.k).join() === 'f' && !e.all, 'a tie at the top, a clean laggard');
const e2 = edges([T('a', 3.0), T('b', 2.5), T('c', 2.45)], (x) => x.v!, 0.1);
ok(e2.top.length === 1 && e2.low.map((x) => x.k).join() === 'b,c', 'a clean leader, a tie at the bottom');
const e3 = edges([T('a', 3.0), T('b', 2.97), T('c', 2.95)], (x) => x.v!, 0.1);
ok(e3.all && e3.top.length === 3, 'the whole category inside the band: one tie');
ok(edges([], (x: { v: number }) => x.v, 0.1).top.length === 0, 'empty');

/* ---- smoke: the published file, 5Y net, open tracks with assets ---- */
const file = join(process.cwd(), 'public/data/funds.json');
if (existsSync(file)) {
  type F = { k: string; prod: string; track: string; assets?: number | null; closed?: boolean; name: string; net?: Record<string, number | null> | null; a5?: number | null };
  const d = JSON.parse(readFileSync(file, 'utf8')) as { asof: number; funds: F[] };
  const by = new Map<string, F[]>();
  d.funds.filter((f) => f.assets && !f.closed && !/בניהול אישי|\bIRA\b/.test(f.name)).forEach((f) => { const k = `${f.prod} | ${f.track}`; by.set(k, [...(by.get(k) ?? []), f]); });
  let cats = 0, tiedTop = 0, tiedLow = 0;
  by.forEach((fs) => {
    const rs = fs.map((f) => ({ k: f.k, v: f.net?.a5 ?? null })).filter((x): x is { k: string; v: number } => x.v != null).sort((a, b) => b.v - a.v);
    if (rs.length < 3) return;
    cats++;
    const x = edges(rs, (y) => y.v, tieBand('a5', d.asof));
    if (x.top.length > 1) tiedTop++;
    if (x.low.length > 1) tiedLow++;
    const t = tieRanks(rs, (y) => y.v, tieBand('a5', d.asof));
    ok([...t.values()].every((q) => q.lo >= 1 && q.lo <= q.hi && q.hi <= q.n), 'every place is a valid range');
  });
  ok(cats > 0, `smoke: ${cats} categories with 3+ tracks on 5Y net`);
  console.log(`  smoke 5Y net: ${cats} categories, ${tiedTop} with a tie at the top, ${tiedLow} at the bottom`);
}

console.log(`fundsTie: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
