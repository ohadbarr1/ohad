/* One value engine for every family of metric the site shows, each through the code of the page that shows it:
     st:<role>      the statements' headline lines (Report Day, company home): pages/ReportDay.tsx resolve / flowAt / figAt
     kpi:<key>      the tagged headline figures with the printed canon (KPI ledger, ROE LTM): lib/kpi.ts CompanyKpi
     csm            the one CSM rule (net, group; fallbacks labelled): lib/csmResolve.ts
     <src>:<id>     any metric of the peer registry, Q / H / FY / LTM (peer table): lib/registry.ts Book, lib/seriesCols.ts cellVal
     mkt:<m>@<set>  the regulator's monthly aggregates of a market group (Savings Lens market view): lib/market.ts Market */
import { KPI_BY_KEY, KPI_DEFS } from '../../web/src/lib/kpi';
import { fmtV, plab, UNIT_HE, yearAgo, back, type Freq, type MetricDef as RegMetric, type Val } from '../../web/src/lib/registry';
import { cellVal, parseCol, formulaTok } from '../../web/src/lib/seriesCols';
import { ALIASES } from '../../web/src/lib/seriesExpr';
import { resolveCsmAt, csmProv } from '../../web/src/lib/csmResolve';
import { METRIC_BY_KEY, METRIC_DEFS, WIN_LABEL, type MetricKey, type Win as MWin } from '../../web/src/lib/market';
import { figAt, figProv, flowAt, qShift, resolve, ROLES, YTD, endOf as rdEnd, type Fig } from '../../web/src/pages/ReportDay';
import { shiftYear } from '../../web/src/lib/company';
import { nf, pct } from '../../web/src/lib/format';
import { matches, terms } from '../../web/src/lib/hebrew';
import type { Prov } from '../../web/src/lib/prov';
import { entity, period as parsePeriod, provOut, qkey, qLabel, reportKey, round, siteUrl, type Ent, type Fact, type Per } from './core';
import { bookFor, capital, csmReports, kpiOf, market, peerRegistry, settle, storeOf } from './site';
import { periodName } from '../../web/src/lib/csm';
import { amt as csmAmt } from '../../web/src/lib/csmData';

export type Window = 'q' | 'ytd' | 'ltm' | 'fy' | 'h' | 'instant' | 'm';
export interface Metric { id: string; family: 'st' | 'kpi' | 'csm' | 'cap' | 'reg' | 'mkt' | 'expr'; label: string; unit: string; flow: boolean; ratio: boolean; reg?: RegMetric; tok?: string }

/* ---------- the catalogue ---------- */
/** the capital view of the CSM ledger (csm/capital.json): the main insurer of each group, as printed in the financial report */
const CAP: [string, string, string, boolean][] = [
  ['sr_w', 'יחס כושר פירעון, עם הוראות מעבר (חברת הביטוח העיקרית, כפי שהודפס בדוח הכספי)', '%', true],
  ['sr_wo', 'יחס כושר פירעון, ללא הוראות מעבר (חברת הביטוח העיקרית, כפי שהודפס בדוח הכספי)', '%', true],
  ['dividend_paid', 'דיבידנד ששולם לבעלי המניות (תזרים המזומנים)', 'מיליוני ש"ח', false],
  ['dividend_declared', 'דיבידנד שהוכרז', 'מיליוני ש"ח', false],
  ['payout', 'שיעור חלוקה: דיבידנד ששולם ÷ רווח לבעלי המניות (נגזר)', '%', true],
];
const SETS: Record<string, string> = { all: 'all', pension: 'fam:pension', gemel: 'fam:gemel', insurance: 'fam:insurance', hishtalmut: 'p:hishtalmut', 'gemel_invest': 'p:gemel_invest', pension_new: 'p:pension_new' };
const SET_HE: Record<string, string> = { all: 'כל המוצרים', pension: 'פנסיה', gemel: 'גמל והשתלמות', insurance: 'ביטוח-נט', hishtalmut: 'קרנות השתלמות', gemel_invest: 'גמל להשקעה', pension_new: 'פנסיה: קרנות חדשות' };
const KPI_UNIT: Record<string, string> = { m: 'מיליוני ש"ח', nis: 'ש"ח', '%': '%', x: 'מכפיל' };

export async function catalogue(): Promise<Metric[]> {
  const reg = await peerRegistry();
  const out: Metric[] = [
    ...ROLES.map((r) => ({ id: `st:${r.key}`, family: 'st' as const, label: r.label, unit: 'מיליוני ש"ח', flow: r.flow, ratio: false })),
    ...KPI_DEFS.filter((d) => !['pb', 'pe', 'mcap'].includes(d.key)).map((d) => ({ id: `kpi:${d.key}`, family: 'kpi' as const, label: d.key === 'roe' ? 'ROE, LTM (רווח נקי LTM ÷ הון ממוצע)' : d.label, unit: KPI_UNIT[d.unit], flow: d.flow, ratio: d.unit === '%' || d.unit === 'x' })),
    { id: 'csm', family: 'csm', label: 'CSM, יתרת סגירה (נטו, קבוצה; כלל ה-CSM של האתר)', unit: 'מיליוני ש"ח', flow: false, ratio: false },
    ...CAP.map(([k, label, unit, ratio]) => ({ id: `cap:${k}`, family: 'cap' as const, label, unit, flow: !ratio && k !== 'equity_attributable', ratio })),
    ...reg.metrics.map((m) => ({ id: m.id, family: 'reg' as const, label: m.l, unit: UNIT_HE[m.u], flow: m.k === 'f', ratio: m.u === 'pct' || m.u === 'x', reg: m })),
  ];
  for (const d of METRIC_DEFS) for (const s of Object.keys(SETS)) out.push({ id: `mkt:${d.key}@${s}`, family: 'mkt', label: `${d.label} · ${SET_HE[s]} (רשות, חודשי)`, unit: d.unit === 'bn' ? 'מיליארדי ש"ח' : '%', flow: d.win, ratio: d.unit === '%' });
  return out;
}

/** A metric from its id, an alias of the peer table's formulas (np, eq, csm…), a KPI key, or words of its Hebrew label. */
export async function metric(q: string): Promise<Metric> {
  const all = await catalogue();
  const s = q.trim();
  const direct = all.find((m) => m.id === s) ?? (KPI_BY_KEY[s] ? all.find((m) => m.id === `kpi:${s}`) : undefined) ?? (ALIASES[s] && s !== 'csm' ? all.find((m) => m.id === ALIASES[s]) : undefined)
    ?? all.find((m) => m.id === `st:${s}`);
  if (direct) return direct;
  if (/^=|[*/+]/.test(s)) return { id: s.replace(/^=/, ''), family: 'expr', label: s.replace(/^=/, ''), unit: '', flow: true, ratio: false, tok: formulaTok('נוסחה', 'm', s.replace(/^=/, '')) };
  const qs = terms(s);
  const scored = all.map((m) => { const ws = terms(m.label); const hit = qs.filter((w) => ws.some((x) => matches(x, w))).length; return { m, hit, len: ws.length }; })
    .filter((x) => x.hit === qs.length && qs.length > 0).sort((a, b) => a.len - b.len);
  if (scored.length) return scored[0].m;
  throw new Error(`מדד לא מוכר: "${q}". חפשו מדד בכלי search עם kinds=["metric"]`);
}
export async function metricCandidates(q: string, n = 12): Promise<Metric[]> {
  const all = await catalogue();
  const qs = terms(q);
  return all.map((m) => { const ws = terms(`${m.label} ${m.id.replace(/[:@._]/g, ' ')}`); return { m, hit: qs.filter((w) => ws.some((x) => matches(x, w))).length, len: ws.length }; })
    .filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit || a.len - b.len).slice(0, n).map((x) => x.m);
}

/* ---------- windows ---------- */
export function windowOf(p: Per, w?: string | null): Window {
  if (w) return w as Window;
  return p.kind === 'M' ? 'm' : p.kind === 'FY' ? 'fy' : p.kind === 'H' ? 'h' : p.kind === 'LTM' ? 'ltm' : 'q';
}
const freqOf = (w: Window): Freq => (w === 'fy' ? 'FY' : w === 'h' ? 'H' : w === 'ltm' ? 'LTM' : 'Q');

/** one value: the number, how it is shown, and the site's provenance of it */
interface One { v: number | null; display: string; label: string; prov: () => Prov; why?: string; std?: string; flags?: string[] }

const QE = ['03-31', '06-30', '09-30', '12-31'];
/** the quarter end of a period key: 2026Q2 → 2026-06-30, 2025FY → 2025-12-31, 2026H1 → 2026-06-30 */
const endOfKey = (k: string) => (k.endsWith('H1') ? `${k.slice(0, 4)}-06-30` : k.endsWith('H2') ? `${k.slice(0, 4)}-12-31` : rdEnd(k.replace(/Q4$/, 'FY')));
const keyOfEnd = (e: string) => `${e.slice(0, 4)}${e.endsWith('12-31') ? 'FY' : `Q${QE.indexOf(e.slice(5)) + 1}`}`;

/* ---------- st: Report Day lines ---------- */
const stFmt = (f: Fig) => nf(f.unit === 'k' ? f.v / 1e3 : f.v, f.unit === 'nis' ? 2 : 1) + (f.unit === 'pct' ? '%' : '');
async function stValue(ent: Ent, key: string, end: string, w: Window): Promise<One> {
  const role = ROLES.find((r) => r.key === key)!;
  const store = await storeOf(ent.id).catch(() => null);
  const none = (why: string): One => ({ v: null, display: '–', label: '', prov: () => ({ k: 'none', title: role.label, why }), why });
  if (!store) return none('לחברה אין דוחות כספיים מחולצים באתר');
  let r = resolve(store, role);
  const win = w === 'fy' || w === 'h' ? 'ytd' : w === 'instant' ? 'q' : (w as 'q' | 'ytd' | 'ltm');
  const at = (rows: typeof r.rows) => (role.flow ? flowAt(store, rows, end, win) : figAt(store, rows, 'I', end));
  let f = at(r.rows);
  if (!f && !r.alt && role.alt) { const a = resolve(store, role, true); const c = at(a.rows); if (c) { r = a; f = c; } }
  const label = !role.flow ? qLabel(keyOfEnd(end)).replace("FY'", "Q4'") : win === 'ltm' ? `LTM ${qLabel(keyOfEnd(end)).replace("FY'", "Q4'")}` : win === 'q' || YTD[end.slice(5)] === 'Q' ? qLabel(keyOfEnd(end)).replace("FY'", "Q4'") : `${YTD[end.slice(5)] === 'H' ? 'H1' : YTD[end.slice(5)]}'${end.slice(2, 4)}`;
  if (!f) return none(`אין נתון ל-${label}`);
  const ff = f;
  return { v: ff.unit === 'k' ? ff.v / 1e3 : ff.v, display: stFmt(ff), label, std: ff.std, prov: () => figProv(ff, role.label, label, r.alt ? role.altNote : undefined), flags: [ff.der ? 'נגזר' : '', ff.std === '4' ? 'IFRS 4' : '', r.alt ? role.altChip ?? '' : ''].filter(Boolean) };
}

/* ---------- kpi ---------- */
async function kpiValue(ent: Ent, key: string, k: string, w: Window): Promise<One> {
  const kp = await kpiOf(ent.id), def = KPI_BY_KEY[key];
  const none = (why: string): One => ({ v: null, display: '–', label: '', prov: () => ({ k: 'none', title: def.label, why }), why });
  if (!kp) return none('לחברה אין נתוני XBRL באתר');
  const per = k.endsWith('Q4') ? `${k.slice(0, 4)}FY` : k.endsWith('H1') || k.endsWith('H2') ? '' : k;
  if (!per) return none('מדדי XBRL זמינים לרבעון, LTM ושנה');
  if (def.flow && (w === 'ytd' || w === 'h')) return none('מדדי XBRL מוצגים לרבעון, ל-LTM ולשנה; לחלון מתחילת השנה השתמשו ב-st:net / st:comp');
  const basis = !def.flow ? 'q' : w === 'ltm' ? 'ltm' : w === 'fy' ? 'fy' : 'q';
  const pt = kp.series(key, basis).find((p) => p.period === per);
  const tag = per.endsWith('FY') ? (basis === 'q' && def.flow ? `Q4'${per.slice(2, 4)}` : `FY'${per.slice(2, 4)}`) : `${per.slice(4)}'${per.slice(2, 4)}`;
  const label = key === 'roe' ? `LTM ${tag.replace("FY'", "Q4'")}` : basis === 'ltm' ? `LTM ${tag.replace("FY'", "Q4'")}` : tag;
  if (!pt || pt.v == null) return { ...none(`אין נתון ל-${label}`), prov: () => kp.explain(key, basis, per) };
  const dec = def.unit === 'nis' ? 2 : def.unit === '%' || def.unit === 'x' ? 1 : 0;
  return { v: pt.v, display: `${nf(pt.v, dec)}${def.unit === '%' ? '%' : def.unit === 'x' ? '×' : ''}`, label, prov: () => kp.explain(key, basis, per), flags: [def.derived ? 'נגזר' : '', kp.filer ? `נתוני ${kp.filer.name}` : ''].filter(Boolean) };
}

/* ---------- csm ---------- */
async function csmValue(ent: Ent, k: string): Promise<One> {
  const x = await csmReports(ent.id);
  const none = (why: string): One => ({ v: null, display: '–', label: '', prov: () => ({ k: 'none', title: 'CSM', why }), why });
  if (!x) return none('החברה אינה בספר ה-CSM (שבע המבטחות)');
  const rk = reportKey(k), label = qLabel(rk).replace("FY'", "Q4'");
  const c = resolveCsmAt(x.rs, rk);
  if (!c) return none(`אין יתרת CSM מודפסת ל-${label}`);
  const flags = [c.label, c.flags & 1 ? 'נגזר' : '', c.flags & 16 ? 'נקרא מגרף או מטקסט' : '', c.flags & 64 ? `מעמודת ההשוואה בדוח ${qLabel(c.rp)}` : ''].filter(Boolean);
  return { v: c.v, display: nf(c.v, Math.abs(c.v) < 100 ? 1 : 0), label, prov: () => csmProv(c, x.d, `CSM, יתרת סגירה · ${ent.he} · ${label}`), flags };
}

/* ---------- cap: pages/csm/CapitalView.tsx (its ptProv and payout, ported as they are) ---------- */
const capKey = (k: string) => (k.endsWith('Q4') ? `${k.slice(0, 4)}FY` : k);
async function capValue(ent: Ent, key: string, k: string): Promise<One> {
  const C = await capital(), co = C.companies[ent.id] as Record<string, Record<string, { v: number; pg?: number | null; u?: string | null; std?: string; der?: number; cmp?: number; s?: string }>> | undefined;
  const p = capKey(k), lab = /^sr_/.test(key) ? periodName(p).replace('FY', 'Q4') : periodName(p);
  const none = (why: string): One => ({ v: null, display: '–', label: lab, prov: () => ({ k: 'none', title: key, why }), why });
  if (!co) return none('החברה אינה בטבלת ההון (שבע המבטחות)');
  const ptProv = (kk: string, title: string, unit: string, text: string): Prov => {
    const x = co[kk][p];
    return { k: 'report', title: `${title} · ${ent.he} · ${lab}`, value: text, unit, url: x.u ?? null, pg: x.pg ?? null, doc: 'דוח כספי', period: lab, old: x.std === 'IFRS 4' || undefined, der: !!x.der || undefined,
      note: [x.cmp ? 'מעמודת ההשוואה של דוח מאוחר' : '', x.s && x.s !== 'group' ? `ישות: ${x.s}` : ''].filter(Boolean).join(' · ') || undefined };
  };
  if (key === 'payout') {
    const dv = co.dividend_paid?.[p], pr = co.profit_attributable?.[p];
    if (!p.endsWith('FY')) return none('שיעור החלוקה מחושב לשנה מלאה');
    if (!dv || !pr || !(pr.v > 0)) return none('אין דיבידנד ששולם או רווח חיובי לשנה');
    const v = (Math.abs(dv.v) / pr.v) * 100;
    return { v, display: `${nf(v, 1)}%`, label: lab, flags: ['נגזר'], prov: () => ({ k: 'calc', title: `שיעור חלוקה · ${ent.he} · ${lab}`, value: `${nf(v, 1)}%`, formula: 'דיבידנד ששולם בשנה ÷ רווח לבעלי המניות באותה שנה × 100', note: 'דיבידנד ששולם בשנה מתייחס לרוב לרווחי השנה הקודמת; מדד מזומן, לא מדיניות',
      inputs: [{ label: 'דיבידנד ששולם', v: csmAmt(Math.abs(dv.v)), src: () => ptProv('dividend_paid', 'דיבידנד ששולם', 'מיליוני ש"ח', csmAmt(Math.abs(dv.v))) }, { label: 'רווח לבעלי המניות', v: csmAmt(pr.v), src: () => ptProv('profit_attributable', 'רווח לבעלי המניות', 'מיליוני ש"ח', csmAmt(pr.v)) }] }) };
  }
  const x = co[key]?.[p];
  if (!x) return none(`אין נתון ל-${lab}`);
  const sr = /^sr_/.test(key), v = sr ? x.v : key === 'dividend_paid' ? Math.abs(x.v) : x.v;
  const text = sr ? `${nf(x.v, x.v % 1 ? 1 : 0)}%` : csmAmt(v);
  const title = CAP.find((c) => c[0] === key)![1].replace(/ \(.*$/, '');
  return { v, display: text, label: lab, std: x.std === 'IFRS 4' ? '4' : '17', flags: [x.std === 'IFRS 4' ? 'IFRS 4' : '', x.der ? 'נגזר' : '', x.cmp ? 'מעמודת ההשוואה של דוח מאוחר' : ''].filter(Boolean), prov: () => ptProv(key, title, sr ? '%' : 'מיליוני ש"ח', text) };
}

/* ---------- registry ---------- */
async function regValue(ent: Ent, m: Metric, freq: Freq, p: string, tr: 'v' | 'y' = 'v', peers: string[] = []): Promise<One> {
  const tok = m.tok ?? m.id;
  const book0 = await bookFor(m.reg ? [m.id] : []);
  const col0 = parseCol(`${tr === 'v' ? '' : `${tr}!`}${tok}`, book0);
  const book = col0.ids.length ? await bookFor(col0.ids) : book0;
  const col = parseCol(`${tr === 'v' ? '' : `${tr}!`}${tok}`, book);
  // the managing companies' printed components behind lts: figures load on demand, as on the page
  if (col.ids.some((id) => id.startsWith('lts:'))) { const { warmLts } = await import('../../web/src/lib/registry'); warmLts([ent.id === 'idi' ? 'direct' : ent.id]); }
  let val: Val = cellVal(book, col, ent.id, freq, p, peers);
  for (let i = 0; i < 40 && col.ids.some((id) => id.startsWith('lts:')) && val.v != null && val.prov().k === 'none'; i++) { await settle(); val = cellVal(book, col, ent.id, freq, p, peers); }
  const label = plab(freq, p);
  const flags = [val.fl & 1 ? 'נגזר' : '', val.fl & 2 ? 'IFRS 4' : '', val.fl & 8 ? 'הוצג מחדש' : '', val.fl & 16 ? 'נקרא מגרף או מטקסט' : '', val.fl & 32 ? 'תג XBRL שתוקן מול הדוח' : '', val.fl & 64 ? 'מעמודת ההשוואה בדוח מאוחר' : ''].filter(Boolean);
  if (val.v == null) return { v: null, display: '–', label, prov: val.prov, why: val.why ?? (val.prov().k === 'none' ? (val.prov() as { why: string }).why : 'אין נתון'), flags };
  const disp = tr === 'v' ? fmtV(col.unit, val.v) : (m.ratio ? `${val.v > 0 ? '+' : ''}${nf(val.v, 1)} נק׳` : pct(val.v, 1, true));
  return { v: val.v, display: disp, label, prov: val.prov, flags };
}

/* ---------- mkt ---------- */
async function mktValue(ent: Ent, key: MetricKey, set: string, k: string, w: Window): Promise<One> {
  const m = await market(), def = METRIC_BY_KEY[key];
  const g = ent.kind === 'market_group' || ent.group ? m.groupIndex(ent.group ?? ent.he) : -1;
  const none = (why: string): One => ({ v: null, display: '–', label: '', prov: () => ({ k: 'none', title: def.label, why }), why });
  if (g < 0 && ent.id !== 'market') return none('החברה אינה קבוצה בקובצי הרשות');
  const pi = m.P.indexOf(Number(k));
  if (pi < 0) return none(`החודש אינו בנתוני הרשות (עד ${m.plabel(m.LAST)})`);
  const mw: MWin = def.win ? (w === 'm' || w === 'q' || w === 'ytd' || w === 'ltm' ? w : 'm') : 'm';
  const s = SETS[set] ?? set, gi = ent.id === 'market' ? -1 : g;
  const v = m.value(key, pi, mw, s, gi);
  const label = `${m.plabel(pi)}${def.win && mw !== 'm' ? ` · ${WIN_LABEL[mw]}` : ''}`;
  if (v == null) return { ...none('אין ערך: הקבוצה אינה פעילה במוצר, או שחסר חודש בחלון'), label };
  const dec = def.dec ?? (def.unit === '%' ? (key === 'fee' ? 2 : 1) : Math.abs(v) < 10 ? 2 : 1);
  return { v, display: `${nf(v, dec)}${def.unit === '%' ? '%' : ''}`, label, prov: () => m.explain(key, pi, mw, s, gi) };
}

/* ---------- the dispatcher ---------- */
export interface FigArgs { entity: string; metric: string; period?: string; window?: string; n?: number; compare?: 'yoy' | 'qoq' | null }
export function viewOf(ent: Ent, m: Metric, k: string, w: Window): string {
  if (m.family === 'st' || m.family === 'kpi') return siteUrl(`/company/${ent.id}?p=${reportKey(qkey(k).replace(/H1$/, 'Q2').replace(/H2$/, 'Q4'))}${w === 'q' || w === 'ytd' || w === 'ltm' ? `&w=${w}` : ''}`);
  if (m.family === 'csm') return siteUrl(`/company/${ent.id}/ifrs17?p=${reportKey(qkey(k))}`);
  if (m.family === 'cap') return siteUrl(`/industry/csm?view=capital${m.id === 'cap:sr_wo' ? '&sr=wo' : ''}`);
  if (m.family === 'mkt') { const set = m.id.split('@')[1]; return siteUrl(`/industry/savings?v=market&p=${k}&t=${SETS[set] ?? set}${ent.group ? `&c=${encodeURIComponent(ent.group)}` : ''}`); }
  return siteUrl(`/industry/peers?e=${ent.id}&f=${freqOf(w)}&p=${k}&c=${encodeURIComponent(m.tok ?? m.id)}`);
}

/** The axis key of a period for a metric family: a quarter key (2026Q2), FY key, H key or month. Latest resolves per family. */
async function keyFor(ent: Ent, m: Metric, p: Per, w: Window): Promise<string> {
  if (p.kind === 'M') { if (m.family !== 'mkt') throw new Error('תקופה חודשית (08/26) קיימת רק למדדי רשות (mkt:…)'); return p.key; }
  if (m.family === 'mkt') {
    const mk = await market();
    if (p.kind === 'latest') return String(mk.P[mk.LAST]);
    const e = endOfKey(p.key || '');
    return String(Number(e.slice(0, 4)) * 100 + Number(e.slice(5, 7)));
  }
  if (p.kind !== 'latest' && p.key) {
    if (m.family === 'reg') return freqOf(w) === 'FY' ? `${p.key.slice(0, 4)}FY` : freqOf(w) === 'H' ? (p.key.match(/H[12]$/) ? p.key : `${p.key.slice(0, 4)}${Number(qkey(p.key).slice(5)) <= 2 ? 'H1' : 'H2'}`) : qkey(p.key);
    return qkey(p.key.replace(/H1$/, 'Q2').replace(/H2$/, 'Q4'));
  }
  // latest: the newest period the family has for this company
  if (m.family === 'reg' || m.family === 'expr') {
    const book = await bookFor(m.reg ? [m.id] : []);
    const l = book.latest(m.id, freqOf(w), [ent.id]);
    if (!l) throw new Error('אין נתון למדד זה לחברה');
    return l;
  }
  if (m.family === 'cap') {
    const C = await capital(), co = C.companies[ent.id] as Record<string, Record<string, unknown>> | undefined, kk = m.id.slice(4) === 'payout' ? 'dividend_paid' : m.id.slice(4);
    const ps = Object.keys(co?.[kk] ?? {}).filter((x) => !/Q4$/.test(x) && (w !== 'fy' || x.endsWith('FY'))).sort((a, b) => (a.slice(0, 4) + (a.endsWith('FY') ? '4' : a.slice(5))).localeCompare(b.slice(0, 4) + (b.endsWith('FY') ? '4' : b.slice(5))));
    if (!ps.length) throw new Error('אין נתון למדד זה לחברה');
    return qkey(ps[ps.length - 1]);
  }
  if (m.family === 'csm') { const s = await csmReports(ent.id); const ps = s ? s.rs.map((r) => r.p) : []; return qkey(ps[ps.length - 1] ?? ''); }
  const kp = await kpiOf(ent.id);
  if (m.family === 'st') { const store = await storeOf(ent.id).catch(() => null); if (store) { const { reportsOf } = await import('../../web/src/pages/ReportDay'); const r = reportsOf(store)[0]; if (r) return qkey(r); } }
  const q = kp?.quarters[kp.quarters.length - 1];
  if (!q) throw new Error('אין נתונים לחברה');
  return qkey(q.period);
}
const stepBack = (m: Metric, k: string, w: Window, i: number): string => {
  if (m.family === 'mkt') { const y = Math.floor(Number(k) / 100), mo = Number(k) % 100, t = y * 12 + mo - 1 - i; return String(Math.floor(t / 12) * 100 + (t % 12) + 1); }
  const f = freqOf(w);
  if (m.family === 'reg' || m.family === 'expr') return back(f, k, i);
  // statements / kpi / csm: quarter keys; a year window steps a year at a time
  return f === 'FY' || (m.family !== 'csm' && w === 'ytd') || (f === 'H') ? `${Number(k.slice(0, 4)) - i}${k.slice(4)}` : back('Q', k, i);
};

export async function value(ent: Ent, m: Metric, k: string, w: Window, peers: string[] = []): Promise<One> {
  switch (m.family) {
    case 'st': { const e = endOfKey(k); return stValue(ent, m.id.slice(3), e, w === 'fy' || w === 'h' ? 'ytd' : w); }
    case 'kpi': return kpiValue(ent, m.id.slice(4), k, w);
    case 'csm': return csmValue(ent, k);
    case 'cap': return capValue(ent, m.id.slice(4), k);
    case 'reg': case 'expr': return regValue(ent, m, freqOf(w), k, 'v', peers);
    case 'mkt': { const [key, set] = m.id.slice(4).split('@'); return mktValue(ent, key as MetricKey, set, k, w); }
  }
}

export async function toFact(ent: Ent, m: Metric, k: string, w: Window, one: One): Promise<Fact> {
  const p = await provOut(one.prov());
  return { entity: ent.id, entity_he: ent.he, metric: m.id, label: m.label, period: one.label || k, value: round(one.v), unit: m.family === 'expr' ? '' : m.unit, display: one.display,
    source: one.v == null ? null : p.source, calc: one.v == null ? null : p.calc, missing: one.v == null ? one.why ?? p.missing : undefined, flags: one.flags?.length ? one.flags : undefined, view: viewOf(ent, m, k, w) };
}

/* ---------- comparisons, each by the rule of the page that shows the figure ---------- */
/** The change between two periods, by the rule of the page that shows the figure.
    Report Day (st:, csm): a ratio in points; a percent only between two positive figures; otherwise the difference in NIS millions; never across standards.
    KPI ledger (kpi:, mkt:): a ratio's change is a difference (points only for a percentage); a percent only between two positives; otherwise the difference. */
function change(m: Metric, a: One, b: One): { v: number | null; display: string; formula: string; unit: string; why?: string } {
  if (a.v == null || b.v == null) return { v: null, display: '–', formula: '', unit: '', why: 'חסר אחד הערכים' };
  const signed = (x: number, d = 1) => { const r = Number(x.toFixed(d)) || 0; return (r > 0 ? '+' : '') + nf(r, d); };
  const pctOf = (x: number) => (x > 300 ? `×${nf(a.v! / b.v!, 1)}` : pct(Number(x.toFixed(1)) || 0, 1, true));
  if (m.family === 'st' || m.family === 'csm') {
    if (a.std && b.std && a.std !== b.std) return { v: null, display: 'תקן שונה', formula: '', unit: '', why: 'הנתונים נמדדו לפי תקנים שונים (IFRS 17 מול IFRS 4) ואינם בני השוואה' };
    if (m.unit === '%') { const x = a.v - b.v; return { v: x, display: `${signed(x)} נק׳`, formula: `${a.label} − ${b.label} (נק׳)`, unit: 'נק׳' }; }
    if (a.v > 0 && b.v > 0) { const x = (a.v / b.v - 1) * 100; return { v: x, display: pctOf(x), formula: `${a.label} ÷ ${b.label} − 1`, unit: '%' }; }
    const x = a.v - b.v, nis = m.unit === 'ש"ח';
    return { v: x, display: `${signed(x, nis ? 2 : 1)}${nis ? '' : ' מ׳'}`, formula: `${a.label} − ${b.label}`, unit: m.unit };
  }
  const kd = m.family === 'kpi' ? KPI_BY_KEY[m.id.slice(4)] : null;
  const dec = kd ? (kd.unit === 'nis' ? 2 : kd.unit === '%' || kd.unit === 'x' ? 1 : 0) : m.id.startsWith('mkt:fee') ? 2 : 1;
  if (m.ratio) { const x = a.v - b.v; return { v: x, display: `${x > 0 ? '+' : ''}${nf(x, dec)}${m.unit === '%' ? ' נק׳' : ''}`, formula: `${a.label} − ${b.label}`, unit: m.unit === '%' ? 'נק׳' : m.unit }; }
  if (a.v > 0 && b.v > 0) { const x = (a.v / b.v - 1) * 100; return { v: x, display: pctOf(x), formula: `${a.label} ÷ ${b.label} − 1`, unit: '%' }; }
  const x = a.v - b.v;
  return { v: x, display: `${x > 0 ? '+' : ''}${nf(x, dec)}`, formula: `${a.label} − ${b.label}`, unit: m.unit };
}

export interface FigOut { facts: Fact[]; change?: Fact | null; note?: string }
export async function figure(args: FigArgs): Promise<FigOut> {
  const ent = await entity(args.entity), m = await metric(args.metric), p = parsePeriod(args.period);
  const w = windowOf(p, args.window);
  const k = await keyFor(ent, m, p, w);
  const n = Math.min(Math.max(args.n ?? 1, 1), 24);
  const keys = Array.from({ length: n }, (_, i) => stepBack(m, k, w, n - 1 - i));
  const ones = await Promise.all(keys.map((kk) => value(ent, m, kk, w)));
  const facts = await Promise.all(ones.map((o, i) => toFact(ent, m, keys[i], w, o)));
  let ch: Fact | null | undefined;
  if (args.compare) {
    const last = ones[ones.length - 1];
    if (m.family === 'reg' || m.family === 'expr') {
      // the peer table's YoY column (lib/seriesCols.ts): a change in percent needs two figures of one sign; a ratio changes in points
      const y = await regValue(ent, m, freqOf(w), k, 'y');
      const f = await toFact(ent, m, k, w, y);
      ch = { ...f, metric: `${m.id}#yoy`, label: `${m.label} · YoY`, unit: m.ratio ? 'נק׳' : '%' };
    } else {
      const pk = args.compare === 'qoq' ? (m.family === 'mkt' ? stepBack(m, k, w, 1) : back('Q', k, 1)) : m.family === 'mkt' ? stepBack(m, k, w, 12) : w === 'ltm' || w === 'q' || m.family === 'csm' ? back('Q', k, 4) : `${Number(k.slice(0, 4)) - 1}${k.slice(4)}`;
      const prev = await value(ent, m, pk, w);
      const c = change(m, last, prev);
      const prevFact = await toFact(ent, m, pk, w, prev);
      facts.unshift(prevFact);
      const [pa, pb] = await Promise.all([provOut(last.prov()), provOut(prev.prov())]);
      ch = { entity: ent.id, entity_he: ent.he, metric: `${m.id}#${args.compare}`, label: `${m.label} · ${args.compare === 'yoy' ? 'YoY' : 'QoQ'}`, period: `${last.label} מול ${prev.label}`, value: round(c.v), unit: c.unit, display: c.display,
        source: null, calc: c.v == null ? null : { formula: c.formula, inputs: [{ label: last.label, display: last.display, value: round(last.v), source: pa.source, calc: pa.calc }, { label: prev.label, display: prev.display, value: round(prev.v), source: pb.source, calc: pb.calc }] },
        missing: c.why, view: facts[facts.length - 1].view };
    }
  }
  return { facts, change: ch };
}
export { endOfKey, keyOfEnd, shiftYear, qShift, yearAgo, freqOf, SETS, SET_HE };
