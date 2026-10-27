/* A1 · the Driver Graph: shock propagation over one company's calibrated graph (web/public/data/drivers/<company>.json, built by
   pipeline/build_drivers.py). Pure functions only, no React: the page, the unit test (tests/drivers.unit.ts) and every later module
   (A2 scenario studio, A3 expectations, A4 attribution, A5 war room, A7 capital, A8 regulation, A9 consolidation, A10 fragility) call
   exactly this API. Keep it stable: add fields, never rename or re-type them.

   API (stable)
     type Shock        { policy, y10, eq, credit, cpi, flow, fee, cost, mortality?, morbidity?, lapse? }
                       policy, y10, credit: basis points; eq, cost, mortality, morbidity, lapse: % change; cpi: percentage points of
                       inflation over the year; flow: extra net flow, % of each product's assets a year; fee: fee compression on
                       assets in bp (positive = lower fees)
     NO_SHOCK          the zero vector
     propagate(file, shock, opts?) -> Propagated
                       opts: { extrapolate?: 'clamp' | 'linear' (default 'clamp', the stress lab's rule), tax?: %, g?: % }
                       Propagated.out[key]: { key, he, unit, base, v, d, prov, flags }, keys OUT_KEYS:
                         revenue, op_profit        savings segments (pension + gemel), LTM, NIS m: base + Δ (annual run rate)
                         net_profit, roe           group, LTM attributable profit + Δ after tax; ROE on the base average equity
                         solv_w, solv_wo           solvency ratio with / without transitional, % (insurers)
                         csm                       CSM net, NIS m (insurers)
                         dist_capital, div_capacity  own funds over the board target / the dividend threshold, NIS m (insurers)
                         pb                        justified P/B = (ROE − g) ÷ (ke − g), x
                       each `prov` is a calc Prov whose inputs walk the graph down to the printed / regulator / BoI sources
                       Propagated.parts: every edge that moved something (id, Δ, unit), Propagated.flags: what was left out and why
     edgesOf(file)     every calibrated edge (group + per product), elasticityRows(file): the page's table
     toProv(j, lts?)   a provenance node of the file as a Prov; `lts` resolves managing-company components (lens.ts ltsProv)
     driversPath(id)   the file path under public/data

   Mechanics (graph.json carries the equations): ΔAUM/AUM = β_eq × eq + β_y × y10/100 + flow (regressions on the regulator's monthly
   returns); Δrevenue = (AUM + ΔAUM) × (fy − fee/100) − AUM × fy; Δopex = variable cost × ΔAUM + opex × (cpi + cost)/100; disclosed
   IFRS 17 and solvency effects are read off the printed points exactly as the stress lab reads them (stress.ts evalLine: interpolated
   between disclosed points, clamped beyond, never diversified); ΔCSM releases at the FY'25 release rate; Δfinancing = CPI-linked
   principal × cpi + next-12-month maturities × y10; Δnet profit = Σ Δpre-tax × (1 − tax) + printed after-tax effects. */
import type { Prov } from './prov';
import { evalLine, type Pt } from './stress';

/* ---------- the shock vector ---------- */
export interface Shock {
  /** BoI policy rate, bp */ policy: number; /** 10Y risk-free yield (parallel curve shift), bp */ y10: number; /** equities, % */ eq: number;
  /** credit spreads, bp */ credit: number; /** CPI, pp over the year */ cpi: number; /** extra net flow, % of assets a year */ flow: number;
  /** fee compression on assets, bp (+ = lower fees) */ fee: number; /** cost inflation beyond CPI, % */ cost: number;
  mortality?: number; morbidity?: number; lapse?: number;
}
export const NO_SHOCK: Shock = { policy: 0, y10: 0, eq: 0, credit: 0, cpi: 0, flow: 0, fee: 0, cost: 0, mortality: 0, morbidity: 0, lapse: 0 };
export const SHOCK_KEYS = ['policy', 'y10', 'eq', 'credit', 'cpi', 'flow', 'fee', 'cost', 'mortality', 'morbidity', 'lapse'] as const;
export type ShockKey = (typeof SHOCK_KEYS)[number];

/* ---------- the file ---------- */
/** a provenance node as the builder writes it: Prov, plus `lts` (a managing company's printed components) and calc inputs with `p` */
export type ProvJ =
  | Exclude<Prov, { k: 'calc' }>
  | { k: 'calc'; title: string; value: string; unit?: string; formula: string; inputs: { label: string; v: string; p?: ProvJ }[]; est?: boolean; note?: string }
  | { k: 'lts'; c: string; metric: string; period: string; title: string; unit: string; value: string; note?: string };
export type Method = 'identity' | 'regression' | 'disclosure' | 'assumption' | 'none';
export type Quality = 'high' | 'medium' | 'low' | 'missing';
export interface Edge {
  id: string; e: string; from: string; to: string; he: string; unit: string; sign: number;
  /** the shock the effect is quoted at (from-units) */ x: number | null; /** the effect at x (to-units); null = not usable */ v: number | null;
  method: Method; quality: Quality; seg?: 'pen' | 'gem' | 'ic'; n?: number; window?: string; fit?: { r2: number; t: number; se?: number; a?: number };
  range?: [number, number]; note?: string; why?: string; prov: ProvJ;
  /** disclosure edges: the disclosed points [x, v] and their date */ pts?: [number, number][]; d?: string; b?: string; scale?: number;
  m?: number; D?: number; ke?: number; a?: number;
}
export interface NodeV { v: number | null; unit: string; period: string; prov: ProvJ; d?: string; basis?: string; m?: string; g?: number; skipped?: string[] }
export interface Product {
  s: 'pen' | 'gem' | 'ic'; he: string; g: number; group: string;
  avg: NodeV; aum: NodeV; fy?: NodeV; fees_ltm?: NodeV; sm_ltm?: NodeV; ga_ltm?: NodeV; op_ltm?: NodeV; opex_ltm?: NodeV; tr_ltm?: NodeV; org_ltm?: NodeV;
  edges: Edge[];
}
export interface LinePt { x: number; v: number; p: ProvJ; b?: string }
export type Risk = 'rate' | 'equity' | 'mortality' | 'morbidity' | 'lapse';
export interface DriverFile {
  meta: { company: string; name: string; kind: string; built: string; base: { q: string; end: string; ltm: string[] };
    assume: { tax: number; g: number; beta: number; erp: number; ke: number; rf: number; rf_month: string }; flag?: string; flag_note?: string; note?: string };
  products: Product[];
  nodes: Record<string, NodeV>;
  edges: Edge[];
  lines: { csm?: Partial<Record<Risk, { eff: string; b: string; pts: LinePt[] }>>; np?: Partial<Record<Risk, { eff: string; b: string; pts: LinePt[] }>>;
    eqb?: Partial<Record<Risk, { eff: string; b: string; pts: LinePt[] }>>; solv?: { d: string; b: string[]; pts: Partial<Record<Risk, LinePt[]>> } };
  targets: { m: string; d: string; v: number; l?: string; s?: string; n?: string; pg?: number | null; rp?: string; u?: string | null }[];
  checks: { id: string; he: string; lhs: number; rhs: number; tol: number; unit: string; ok: boolean; level: 'fail' | 'warn' }[];
  notes: { id: string; he: string }[];
}
export interface GraphFile {
  meta: { built: string; v: number; methods: Record<string, string>; quality: Record<string, string>; units: Record<string, string> };
  shocks: { k: ShockKey; he: string; unit: string; range: [number, number] }[];
  nodes: { id: string; he: string; unit: string; kind: string }[];
  equations: { id: string; out: string; text: string; kind: string }[];
  edges: { id: string; from: string; to: string; sign: number; unit: string; he: string }[];
}
export const driversPath = (id: string) => `drivers/${id}.json`;
export const GRAPH_PATH = 'drivers/graph.json';

/* ---------- provenance ---------- */
export type LtsResolver = (j: Extract<ProvJ, { k: 'lts' }>) => Prov;
const noLts: LtsResolver = (j) => ({ k: 'none', title: j.title, why: 'רכיבי הדוח של החברה המנהלת נטענים בעמוד עצמו' });
/** a provenance node of the file as a Prov (nested sources become lazy `src` thunks) */
export function toProv(j: ProvJ, lts: LtsResolver = noLts): Prov {
  if (j.k === 'lts') return lts(j);
  if (j.k === 'calc') return { k: 'calc', title: j.title, value: j.value, unit: j.unit, formula: j.formula, est: j.est, note: j.note,
    inputs: j.inputs.map((x) => ({ label: x.label, v: x.v, src: x.p ? () => toProv(x.p!, lts) : undefined })) };
  return j as Prov;
}

/* ---------- reading the file ---------- */
export const edgesOf = (f: DriverFile): Edge[] => [...f.edges, ...f.products.flatMap((p) => p.edges)];
const edgeOf = (f: DriverFile, id: string) => f.edges.find((e) => e.id === id);
const pEdge = (p: Product, e: string) => p.edges.find((x) => x.e === e);
const usable = (e: Edge | undefined): e is Edge & { v: number } => !!e && e.quality !== 'missing' && e.v != null;
/** an edge's effect per one unit of its shock (identities and regressions are linear) */
const per = (e: Edge & { v: number }) => e.v / (e.x || 1);

/* ---------- formats (plain, so the library has no DOM or locale dependency beyond Intl) ---------- */
const MINUS = '−';
export const fmt = (v: number | null | undefined, d = 1) => {
  if (v == null || !Number.isFinite(v)) return '–';
  const t = v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return /^-[0.,]+$/.test(t) ? t.slice(1) : t.replace('-', MINUS);
};
export const fmtS = (v: number | null | undefined, d = 1) => (v != null && Number(v.toFixed(d)) > 0 ? '+' : '') + fmt(v, d);
const MM = 'מיליוני ש"ח';

/* ---------- the disclosed lines (the stress lab's reading) ---------- */
type Mode = 'clamp' | 'linear';
export interface Read { v: number; extra: boolean; x: number; xe: number }
/** the effect of shock x on a line of disclosed points: stress.ts evalLine (exact at a disclosed point, interpolated between, clamped beyond);
    mode 'linear' continues the outermost segment past the edge instead of holding it (tagged in both cases) */
export function readLine(pts: LinePt[] | [number, number][] | undefined, x: number, mode: Mode = 'clamp'): Read | null {
  if (!pts?.length || !x) return null;
  const P: Pt<null>[] = (pts as (LinePt | [number, number])[]).map((p) => (Array.isArray(p) ? { x: p[0], v: p[1], row: null } : { x: p.x, v: p.v, row: null }));
  const e = evalLine(P, x);
  if (!e) return null;
  if (!e.extra || mode === 'clamp') return { v: e.v, extra: e.extra, x, xe: e.xe };
  // linear: the slope of the outermost segment on the shock's side (from the origin when one point is disclosed on that side)
  const side = P.filter((p) => Math.sign(p.x) === Math.sign(e.xe)).sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  if (!side.length) return { v: e.v, extra: true, x, xe: e.xe };   // no point on that side: the origin, as the lab holds it
  const out = side[side.length - 1], inn = side.length > 1 ? side[side.length - 2] : { x: 0, v: 0 };
  const k = (out.v - inn.v) / (out.x - inn.x);
  return { v: out.v + k * (x - out.x), extra: true, x, xe: e.xe };
}
const RISK_SHOCK: Record<Risk, ShockKey> = { rate: 'y10', equity: 'eq', mortality: 'mortality', morbidity: 'morbidity', lapse: 'lapse' };
export const RISKS: Risk[] = ['rate', 'equity', 'mortality', 'morbidity', 'lapse'];

/* ---------- propagation ---------- */
export const OUT_KEYS = ['revenue', 'op_profit', 'net_profit', 'roe', 'solv_w', 'solv_wo', 'csm', 'dist_capital', 'div_capacity', 'pb'] as const;
export type OutKey = (typeof OUT_KEYS)[number];
export const OUT_HE: Record<OutKey, [string, string]> = {
  revenue: ['הכנסות מדמי ניהול, פנסיה וגמל', MM], op_profit: ['רווח תפעולי, פנסיה וגמל', MM], net_profit: ['רווח נקי לבעלי המניות', MM],
  roe: ['תשואה להון', '%'], solv_w: ['יחס כושר פירעון, עם הוראות מעבר', '%'], solv_wo: ['יחס כושר פירעון, ללא הוראות מעבר', '%'], csm: ['CSM', MM],
  dist_capital: ['הון עודף מעל יעד הדירקטוריון', MM], div_capacity: ['עודף מעל סף חלוקת דיבידנד', MM], pb: ['מכפיל הון מוצדק', 'x'],
};
export interface Output { key: OutKey; he: string; unit: string; base: number | null; v: number | null; d: number | null; prov: Prov; flags: string[] }
export interface PartOut { id: string; he: string; d: number; unit: string; to: string; extra?: boolean }
export interface Propagated { shock: Shock; out: Record<OutKey, Output>; parts: PartOut[]; flags: string[] }
export interface PropOpts { extrapolate?: Mode; tax?: number; g?: number; lts?: LtsResolver }

const SHOCK_HE: Record<ShockKey, [string, string]> = {
  policy: ['ריבית בנק ישראל', 'נ״ב'], y10: ['תשואת 10 שנים', 'נ״ב'], eq: ['מניות', '%'], credit: ['מרווחי אשראי', 'נ״ב'], cpi: ['מדד', 'נ״א'],
  flow: ['צבירה נטו', '% מהנכסים'], fee: ['שחיקת דמי ניהול', 'נ״ב'], cost: ['אינפלציית הוצאות', '%'], mortality: ['תמותה', '%'], morbidity: ['תחלואה', '%'], lapse: ['ביטולים', '%'],
};
export const shockLabel = (k: ShockKey, x: number) => `${SHOCK_HE[k][0]} ${fmtS(x, Math.abs(x) % 1 ? 1 : 0)} ${SHOCK_HE[k][1]}`;
export const shockHe = (k: ShockKey) => SHOCK_HE[k];

/** propagate one shock vector through one company's graph */
export function propagate(f: DriverFile, s0: Partial<Shock>, opts: PropOpts = {}): Propagated {
  const s: Shock = { ...NO_SHOCK, ...s0 };
  const mode = opts.extrapolate ?? 'clamp', lts = opts.lts ?? noLts;
  const tax = opts.tax ?? f.meta.assume.tax, g = opts.g ?? f.meta.assume.g;
  const P = (j: ProvJ) => () => toProv(j, lts);
  const N = f.nodes, flags: string[] = [], parts: PartOut[] = [];
  const active = SHOCK_KEYS.filter((k) => (s[k] ?? 0) !== 0);
  const shockTxt = active.map((k) => shockLabel(k, s[k]!)).join(' · ') || 'ללא זעזוע';
  const add = (id: string, he: string, d: number, unit: string, to: string, extra?: boolean) => { if (d) parts.push({ id, he, d, unit, to, extra }); };

  /* --- savings products --- */
  type Inp = { label: string; v: string; src?: () => Prov };
  const savIn: Inp[] = [], opIn: Inp[] = [];
  let dRevSav = 0, dOpSav = 0, dOpAll = 0;
  for (const p of f.products) {
    const A = p.avg.v, fy = p.fy?.v ?? null;
    if (A == null) continue;
    const bEq = pEdge(p, 'eq.aum'), bY = pEdge(p, 'y10.aum');
    let dPct = s.flow;
    if (s.eq) { if (usable(bEq)) dPct += per(bEq) * s.eq; else flags.push(`${p.he}: אין β למניות (${bEq?.why ?? 'חסר'}); הנכסים לא זזו עם המניות`); }
    if (s.y10) { if (usable(bY)) dPct += per(bY) * s.y10; else flags.push(`${p.he}: אין רגישות של הנכסים לתשואה (${bY?.why ?? 'חסר'})`); }
    const dA = A * dPct / 100;
    if (fy == null) { if (dA || s.fee) flags.push(`${p.he}: אין תשואת דמי ניהול; ההכנסות לא חושבו`); continue; }
    const dRev = (A + dA) * (fy - s.fee / 100) / 100 - A * fy / 100;
    const vc = pEdge(p, 'aum.opex');
    const dVar = usable(vc) ? per(vc) * dA / 1000 : 0;
    if (dA && !usable(vc) && p.s !== 'ic') flags.push(`${p.he}: אין אומדן לרכיב ההוצאה המשתנה; ההוצאות לא זזו עם הנכסים`);
    const opex = p.opex_ltm?.v ?? null;
    const dInf = opex != null ? opex * (s.cpi + s.cost) / 100 : 0;
    if ((s.cpi || s.cost) && opex == null && p.s !== 'ic') flags.push(`${p.he}: אין הוצאות מגזריות; המדד לא הוחל`);
    const dOp = dRev - dVar - dInf;
    add(`aum.${p.s}`, `נכסים · ${p.he}`, dA, MM, 'aum'); add(`rev.${p.s}`, `הכנסות · ${p.he}`, dRev, MM, 'revenue'); add(`opex.${p.s}`, `הוצאות · ${p.he}`, dVar + dInf, MM, 'opex');
    const pin: Inp[] = [{ label: 'נכסים ממוצעים', v: fmt(A / 1000, 2) + ' מיליארד', src: P(p.avg.prov) }];
    if (p.fy) pin.push({ label: 'תשואת דמי ניהול', v: `${fmt(fy, 3)}%`, src: P(p.fy.prov) });
    if (usable(bEq) && s.eq) pin.push({ label: `β מניות (${bEq.quality})`, v: fmt(per(bEq), 3), src: P(bEq.prov) });
    if (usable(bY) && s.y10) pin.push({ label: `רגישות לתשואה, 100 נ״ב (${bY.quality})`, v: fmt(bY.v, 3), src: P(bY.prov) });
    if (usable(vc) && dA) pin.push({ label: `הוצאה משתנה לכל מיליארד ש״ח (${vc.quality})`, v: fmt(vc.v, 2), src: P(vc.prov) });
    if (opex != null && (s.cpi || s.cost)) pin.push({ label: 'הוצאות LTM (הצמדה מלאה, הנחה)', v: fmt(opex), src: P(p.opex_ltm!.prov) });
    const pProv: Prov = { k: 'calc', title: `${p.he} · ${shockTxt}`, value: `${fmtS(dOp)} ${MM}`, unit: 'לשנה', est: true,
      formula: `ΔAUM = AUM × (${fmt(dPct, 3)}%) = ${fmt(dA)}; Δהכנסות = (AUM + ΔAUM) × (fy − ${fmt(s.fee / 100, 3)}%) − AUM × fy = ${fmtS(dRev)}; Δהוצאות = ${fmtS(dVar + dInf)}; Δרווח תפעולי = ${fmtS(dOp)}`,
      inputs: pin };
    if (p.s === 'ic') {
      if (dRev) flags.push(`${p.he}: Δהכנסות ${fmtS(dRev)} נכנס לרווח הנקי בלבד (אין רווח תפעולי מגזרי מודפס)`);
    } else { dRevSav += dRev; dOpSav += dOp; savIn.push({ label: p.he, v: fmtS(dRev), src: () => pProv }); opIn.push({ label: p.he, v: fmtS(dOp), src: () => pProv }); }
    dOpAll += dOp;
  }
  const out = {} as Record<OutKey, Output>;
  const mk = (key: OutKey, base: number | null, d: number | null, prov: Prov, fl: string[] = []): Output =>
    ({ key, he: OUT_HE[key][0], unit: OUT_HE[key][1], base, d, v: base != null && d != null ? base + d : null, prov, flags: fl });
  const nodeIn = (label: string, n: NodeV | undefined, d = 1): Inp => ({ label, v: n?.v == null ? '–' : fmt(n.v, d), src: n ? P(n.prov) : undefined });
  const calc = (title: string, v: number | null, unit: string, formula: string, inputs: Inp[], est = true, note?: string): Prov =>
    ({ k: 'calc', title: `${title} · ${f.meta.name} · ${shockTxt}`, value: v == null ? '–' : fmt(v, unit === '%' || unit === 'x' ? 2 : 1), unit, formula, inputs, est, note });
  out.revenue = mk('revenue', N.revenue?.v ?? null, f.products.some((p) => p.s !== 'ic') ? dRevSav : null,
    calc('הכנסות מדמי ניהול, פנסיה וגמל', N.revenue?.v != null ? N.revenue.v + dRevSav : null, MM, 'בסיס LTM (מגזרי) + Σ Δהכנסות לכל מוצר (קצב שנתי)', [nodeIn('בסיס LTM', N.revenue), ...savIn]),
    N.revenue ? [] : ['אין דוח מגזרי: הבסיס חסר, השינוי מחושב']);
  out.op_profit = mk('op_profit', N.op_profit?.v ?? null, f.products.some((p) => p.s !== 'ic') ? dOpSav : null,
    calc('רווח תפעולי, פנסיה וגמל', N.op_profit?.v != null ? N.op_profit.v + dOpSav : null, MM, 'בסיס LTM (מגזרי, לפני מס) + Σ Δרווח תפעולי לכל מוצר', [nodeIn('בסיס LTM', N.op_profit), ...opIn]),
    N.op_profit ? [] : ['אין דוח מגזרי: הבסיס חסר']);

  /* --- financing --- */
  const cf = edgeOf(f, 'cpi.fin'), yf = edgeOf(f, 'y10.fin');
  let dFin = 0; const finIn: Inp[] = [];
  if (s.cpi) { if (usable(cf)) { dFin += per(cf) * s.cpi; finIn.push({ label: `קרן צמודה × Δמדד (${cf.quality})`, v: fmtS(per(cf) * s.cpi), src: P(cf.prov) }); } else flags.push(`מדד ← מימון: ${cf?.why ?? 'חסר'}`); }
  if (s.y10) { if (usable(yf)) { dFin += per(yf) * s.y10; finIn.push({ label: `מחזור פירעונות 12 חודשים (${yf.quality}, הנחה)`, v: fmtS(per(yf) * s.y10), src: P(yf.prov) }); } else if (f.edges.some((e) => e.e === 'y10.fin')) flags.push(`תשואה ← מימון: ${yf?.why ?? 'חסר'}`); }
  if (s.policy) flags.push(`ריבית בנק ישראל: ${edgeOf(f, 'policy.fin')?.why ?? 'אין ערוץ מכויל'}; לא הוחל`);
  if (s.credit) flags.push('מרווחי אשראי: אף חברה לא גילתה רגישות (CSM, רווח או כושר פירעון); לא הוחל');
  add('fin', 'הוצאות מימון', dFin, MM, 'financing');

  /* --- insurers: the disclosed lines --- */
  const sum = (ln: 'csm' | 'np' | 'eqb') => {
    let v = 0, extra = false; const inp: Inp[] = [];
    for (const r of RISKS) {
      const x = s[RISK_SHOCK[r]] ?? 0; if (!x) continue;
      const L = f.lines[ln]?.[r];
      const e = readLine(L?.pts, x, mode);
      if (!e) { if (f.lines[ln]) flags.push(`${ln === 'csm' ? 'CSM' : 'רווח'}: לא גולתה רגישות ל${SHOCK_HE[RISK_SHOCK[r]][0]}; לא נכלל`); continue; }
      v += e.v; extra ||= e.extra;
      const pts = L!.pts;
      inp.push({ label: `${shockLabel(RISK_SHOCK[r], x)}${e.extra ? (mode === 'clamp' ? ' · נחתך בקצה הגילוי' : ' · הארכה לינארית') : ''}`, v: fmtS(e.v),
        src: () => ({ k: 'calc', title: `${shockLabel(RISK_SHOCK[r], x)} · ${ln === 'csm' ? 'CSM' : 'רווח נקי'}`, value: fmtS(e.v), unit: MM, est: e.extra || undefined,
          formula: 'מקו הנקודות שגולו (stress.ts evalLine): בנקודה שגולתה כפי שהודפס, ביניהן קו ישר, מעבר לקצה ' + (mode === 'clamp' ? 'נחתך' : 'מוארך לינארית (אומדן)'),
          inputs: pts.map((q) => ({ label: `גולה: ${fmtS(q.x, 0)}`, v: fmtS(q.v), src: P(q.p) })) }) });
    }
    return { v, extra, inp };
  };
  const ins = f.meta.kind === 'insurance_group' && !!f.lines.csm;
  const C = ins ? sum('csm') : { v: 0, extra: false, inp: [] as Inp[] };
  const D = ins ? sum('np') : { v: 0, extra: false, inp: [] as Inp[] };
  if (C.extra || D.extra) flags.push(mode === 'clamp' ? 'זעזוע מחוץ לטווח שגולה: ההשפעה נחתכה בנקודה הקיצונית (כלל מעבדת התרחישים)' : 'זעזוע מחוץ לטווח שגולה: הוארך לינארית (אומדן)');
  add('csm', 'CSM', C.v, MM, 'csm', C.extra); add('np.disc', 'רווח נקי, גילוי (אחרי מס)', D.v, MM, 'net_profit', D.extra);
  const rel = edgeOf(f, 'csm.isr');
  const dRel = usable(rel) ? C.v * rel.v : 0;
  if (C.v && !usable(rel)) flags.push(`שחרור ה-CSM שזז לא נכלל ברווח: ${rel?.why ?? 'אין קצב שחרור'}`);
  add('csm.isr', 'שחרור CSM בשנה הבאה', dRel, MM, 'isr');
  out.csm = mk('csm', N.csm?.v ?? null, ins ? C.v : null, calc('CSM', N.csm?.v != null ? N.csm.v + C.v : null, MM, 'CSM (Q2\'26, csm_resolve) + Σ ההשפעות שגולו (FY\'25), ללא פיזור', [nodeIn('CSM', N.csm), ...C.inp]),
    ins ? [] : ['לא מבטחת, או שלא חולצו גילויי IFRS 17']);

  /* --- net profit, ROE, P/B --- */
  const pre = dOpAll + dRel - dFin, keep = 1 - tax / 100;
  const dNp = pre * keep + D.v;
  const npIn: Inp[] = [nodeIn('רווח נקי LTM', N.net_profit), { label: 'Δ רווח תפעולי, כל המוצרים (לפני מס)', v: fmtS(dOpAll) }, { label: 'Δ שחרור CSM (לפני מס)', v: fmtS(dRel), src: usable(rel) ? P(rel.prov) : undefined },
    { label: 'Δ הוצאות מימון (לפני מס)', v: fmtS(-dFin), src: finIn.length ? () => ({ k: 'calc', title: 'Δ הוצאות מימון', value: fmtS(dFin), unit: MM, formula: 'Σ הערוצים', inputs: finIn }) : undefined },
    { label: `× (1 − מס ${fmt(tax, 2)}%)`, v: fmt(keep, 4), src: N.tax ? P(N.tax.prov) : undefined }, { label: 'Δ גילוי IFRS 17, אחרי מס', v: fmtS(D.v), src: D.inp.length ? () => ({ k: 'calc', title: 'Δ רווח, גילוי', value: fmtS(D.v), unit: MM, formula: 'Σ ההשפעות שגולו, ללא פיזור', inputs: D.inp }) : undefined }];
  const npBase = N.net_profit?.v ?? null;
  out.net_profit = mk('net_profit', npBase, dNp, calc('רווח נקי לבעלי המניות', npBase != null ? npBase + dNp : null, MM, 'LTM + (Δ רווח תפעולי + Δ שחרור CSM − Δ מימון) × (1 − מס) + Δ גילוי אחרי מס (קצב שנתי + השפעה מיידית)', npIn),
    npBase == null ? ['אין רווח נקי LTM'] : []);
  const eq = N.equity?.v ?? null, roeB = N.roe?.v ?? null;
  const dRoe = eq ? dNp / eq * 100 : null, roeV = roeB != null && dRoe != null ? roeB + dRoe : null;
  out.roe = mk('roe', roeB, roeV != null ? dRoe : null, calc('תשואה להון', roeV, '%', 'רווח נקי אחרי הזעזוע ÷ הון ממוצע (בסיס, ללא שינוי) × 100',
    [{ label: 'רווח נקי אחרי הזעזוע', v: fmt(npBase != null ? npBase + dNp : null), src: () => out.net_profit.prov }, nodeIn('הון ממוצע', N.equity)]));
  const ke0 = N.ke?.v ?? f.meta.assume.ke, ke1 = ke0 + s.y10 / 100;
  const pbB = N.pb?.v ?? null, pb0 = roeB != null && ke0 > g ? (roeB - g) / (ke0 - g) : null, pbV = roeV != null && ke1 > g ? (roeV - g) / (ke1 - g) : null;
  const dPb = pbV != null && pb0 != null ? pbV - pb0 : null;   // the change on the model; the level on the file's rounded base
  out.pb = mk('pb', pbB, pbB != null ? dPb : null, calc('מכפיל הון מוצדק', pbB != null && dPb != null ? pbB + dPb : null, 'x', `P/B = (ROE − g) ÷ (ke − g); ke = ${fmt(ke0, 2)}% + Δ תשואת 10 שנים`,
    [{ label: 'ROE אחרי הזעזוע', v: `${fmt(roeV, 2)}%`, src: () => out.roe.prov }, { label: 'ke אחרי הזעזוע', v: `${fmt(ke1, 2)}%`, src: N.ke ? P(N.ke.prov) : undefined }, { label: 'g (הנחה)', v: `${fmt(g, 1)}%` }]),
    ke1 <= g ? ['ke ≤ g: המכפיל אינו מוגדר'] : []);

  /* --- solvency --- */
  const SL = f.lines.solv;
  const sw = N.solv_w?.v ?? null, swo = N.solv_wo?.v ?? null, scr = N.scr?.v ?? null, of = N.own_funds?.v ?? null;
  let dW = 0, extraW = false; const wIn: Inp[] = [nodeIn(`יחס ${N.solv_w?.period ?? ''}`, N.solv_w, 0)], woPts: { r: Risk; v: number }[] = [];
  const solvFl: string[] = [];
  if (SL) for (const r of RISKS) {
    const x = s[RISK_SHOCK[r]] ?? 0; if (!x) continue;
    const pts = (SL.pts[r] ?? []).filter((q) => q.b !== 'wo');
    const e = readLine(pts, x, mode);
    if (!e) { solvFl.push(`לא גולתה רגישות של יחס כושר הפירעון ל${SHOCK_HE[RISK_SHOCK[r]][0]}`); continue; }
    dW += e.v; extraW ||= e.extra;
    const wo = (SL.pts[r] ?? []).filter((q) => q.b === 'wo'); const ewo = readLine(wo, x, mode); if (ewo) woPts.push({ r, v: ewo.v });
    wIn.push({ label: `${shockLabel(RISK_SHOCK[r], x)}${e.extra ? ' · מחוץ לטווח' : ''}`, v: `${fmtS(e.v, 1)} נ״א`,
      src: () => ({ k: 'calc', title: `${shockLabel(RISK_SHOCK[r], x)} · יחס כושר פירעון`, value: `${fmtS(e.v, 1)} נ״א`, unit: 'נקודות אחוז', est: e.extra || undefined,
        formula: `מקו הנקודות שגולו בדוח כושר הפירעון ליום ${SL.d} (stress.ts evalLine)`, inputs: pts.map((q) => ({ label: `גולה: ${fmtS(q.x, 0)}`, v: `${fmtS(q.v, 1)} נ״א`, src: P(q.p) })) }) });
  }
  if (ins && !SL) solvFl.push('רגישויות יחס כושר הפירעון לא חולצו לחברה');
  const stale = SL ? edgesOf(f).find((e) => e.to === 'solv_w' && e.method === 'disclosure')?.quality === 'low' : false;
  if (stale && dW) solvFl.push(`הגילוי האחרון ליום ${SL!.d}: ישן מ-36 חודשים לפני יחס הבסיס (איכות נמוכה)`);
  if (extraW) solvFl.push('זעזוע מחוץ לטווח שגולה');
  if (SL?.b.includes('na') && dW) solvFl.push('בסיס הגילוי לא צוין: מוחל על היחס עם הוראות מעבר');
  if (s.policy || s.credit || s.fee || s.flow || s.cpi || s.cost) solvFl.push('דמי ניהול, צבירה, מדד ואשראי אינם מגולגלים ליחס (אין גילוי)');
  out.solv_w = mk('solv_w', sw, ins && sw != null ? dW : null, calc('יחס כושר פירעון, עם הוראות מעבר', sw != null ? sw + dW : null, '%', 'היחס ליום הבסיס + Σ ההשפעות שגולו (נקודות אחוז), ללא פיזור', wIn), solvFl);
  // without the transitional measures: a disclosure on that basis, else the same relative move (an assumption, labelled)
  let dWo: number | null = null; const woFl: string[] = [];
  if (swo != null && sw) {
    if (woPts.length) dWo = woPts.reduce((t, x) => t + x.v, 0);
    else if (dW) { dWo = dW * swo / sw; woFl.push('אומדן: לא גולה ללא הוראות מעבר; אותה תזוזה יחסית כמו ביחס עם הוראות מעבר'); }
    else dWo = 0;
  }
  out.solv_wo = mk('solv_wo', swo, ins ? dWo : null, calc('יחס כושר פירעון, ללא הוראות מעבר', swo != null && dWo != null ? swo + dWo : null, '%',
    woPts.length ? 'היחס + Σ ההשפעות שגולו ללא הוראות מעבר' : 'היחס + Δ(עם הוראות מעבר) × יחס ללא ÷ יחס עם (הנחה: אותה תזוזה יחסית)',
    [nodeIn('יחס ללא הוראות מעבר', N.solv_wo, 0), nodeIn('יחס עם הוראות מעבר', N.solv_w, 0), { label: 'Δ עם הוראות מעבר', v: `${fmtS(dW, 1)} נ״א`, src: () => out.solv_w.prov }]), woFl);
  // capital over the board target and over the dividend threshold (SCR held at its base)
  const cap = (key: 'dist_capital' | 'div_capacity', kind: 'board' | 'div') => {
    const tw = N[`target_${kind}_w`], two = N[`target_${kind}_wo`];
    const useW = tw && sw != null, t = useW ? tw : two, ratio = useW ? sw : swo, dR = useW ? dW : dWo;
    if (!ins || !t || t.v == null || ratio == null || scr == null || of == null) {
      return mk(key, null, null, { k: 'none', title: OUT_HE[key][0], why: !ins ? 'לא מבטחת' : !t ? (kind === 'board' ? 'לא הודפס יעד דירקטוריון ליחס' : 'לא הודפס סף לחלוקת דיבידנד') : 'אין הון עצמי ו-SCR לתאריך הבסיס' }, []);
    }
    const base = useW ? of - scr * t.v / 100 : scr * (ratio - t.v) / 100;
    const d = scr * (dR ?? 0) / 100;
    return mk(key, base, d, calc(OUT_HE[key][0], base + d, MM, useW ? 'הון עצמי − SCR × יעד ÷ 100 + SCR × Δיחס ÷ 100 (SCR קבוע)' : 'SCR × (יחס ללא − יעד) ÷ 100 + SCR × Δיחס ÷ 100',
      [nodeIn('הון עצמי', N.own_funds, 0), nodeIn('SCR', N.scr, 0), nodeIn(`${kind === 'board' ? 'יעד' : 'סף'} (${useW ? 'עם' : 'ללא'} הוראות מעבר)`, t, 0), { label: 'Δ יחס', v: `${fmtS(dR ?? 0, 1)} נ״א`, src: () => (useW ? out.solv_w : out.solv_wo).prov }]),
      [...(useW ? [] : ['היעד הודפס ללא הוראות מעבר בלבד']), ...(useW ? out.solv_w.flags : out.solv_wo.flags)]);
  };
  out.dist_capital = cap('dist_capital', 'board');
  out.div_capacity = cap('div_capacity', 'div');
  return { shock: s, out, parts, flags: [...new Set(flags)] };
}

/* ---------- the page's elasticity table ---------- */
export interface ElRow { sec: 'sav' | 'grp' | 'ins'; seg?: string; label: string; shock: string; e: Edge | null; v: number | null; unit: string; note?: string; est?: boolean }
const Q_ORDER: Record<string, number> = { 'fee.op': 0, 'tr.npv': 1, 'eq.aum': 2, 'y10.aum': 3, 'aum.rev': 4, 'aum.opex': 5, 'cpi.opex': 6 };
/** one row per elasticity: savings per product, the group's financing / tax / ROE / P/B, the insurer's disclosed sensitivities */
export function elasticityRows(f: DriverFile): ElRow[] {
  const rows: ElRow[] = [];
  for (const p of f.products) {
    for (const e of [...p.edges].sort((a, b) => (Q_ORDER[a.e] ?? 9) - (Q_ORDER[b.e] ?? 9))) {
      const lab: Record<string, [string, string, string]> = {
        'fee.op': ['שחיקת דמי ניהול ← רווח תפעולי', '1 נ״ב', 'מיליוני ש״ח לשנה'], 'tr.npv': ['ניוד נטו ← ערך נוכחי של רווח תפעולי', 'מיליארד ש״ח', 'מיליוני ש״ח'],
        'eq.aum': ['מניות ← נכסים מנוהלים', '+1%', '% מהנכסים'], 'y10.aum': ['תשואת 10 שנים ← נכסים מנוהלים', '+100 נ״ב', '% מהנכסים'],
        'aum.rev': ['נכסים ← הכנסות', 'מיליארד ש״ח', 'מיליוני ש״ח לשנה'], 'aum.opex': ['נכסים ← הוצאות (משתנה)', 'מיליארד ש״ח', 'מיליוני ש״ח לשנה'], 'cpi.opex': ['מדד ← הוצאות', '+1 נ״א', 'מיליוני ש״ח לשנה'],
      };
      const L = lab[e.e]; if (!L) continue;
      rows.push({ sec: 'sav', seg: p.he, label: L[0], shock: L[1], e, v: e.v == null ? null : e.e === 'eq.aum' ? e.v / (e.x || 1) : e.v, unit: L[2] });
    }
  }
  const G: [string, string, string, string][] = [['cpi.fin', 'מדד ← הוצאות מימון', '+1 נ״א', 'מיליוני ש״ח לשנה'], ['y10.fin', 'תשואת 10 שנים ← הוצאות מימון', '+100 נ״ב', 'מיליוני ש״ח לשנה'],
    ['policy.fin', 'ריבית בנק ישראל ← הוצאות מימון', '+100 נ״ב', 'מיליוני ש״ח לשנה'], ['op.np', 'רווח לפני מס ← רווח נקי', '1 ש״ח', 'ש״ח'], ['np.roe', 'רווח נקי ← תשואה להון', '100 מיליוני ש״ח', 'נ״א'],
    ['y10.ke', 'תשואת 10 שנים ← מחיר ההון', '+100 נ״ב', 'נ״א'], ['roe.pb', 'תשואה להון ← מכפיל הון מוצדק', '+1 נ״א', 'x'], ['csm.isr', 'CSM ← שחרור לרווח בשנה', 'מיליון ש״ח', 'מיליוני ש״ח'],
    ['solv.dist', 'יחס כושר פירעון ← הון עודף', '+1 נ״א', 'מיליוני ש״ח']];
  for (const [id, label, shock, unit] of G) { const e = edgeOf(f, id); if (e) rows.push({ sec: 'grp', label, shock, e, v: e.v, unit }); }
  if (f.meta.kind === 'insurance_group') {
    const I: [string, string][] = [['y10', 'ריבית'], ['eq', 'מניות'], ['mortality', 'תמותה'], ['morbidity', 'תחלואה'], ['lapse', 'ביטולים'], ['credit', 'מרווחי אשראי']];
    for (const [k, he] of I) for (const [to, toHe, unit] of [['solv_w', 'יחס כושר פירעון, עם', 'נ״א'], ['solv_wo', 'יחס כושר פירעון, ללא', 'נ״א'], ['csm', 'CSM', 'מיליוני ש״ח'], ['np', 'רווח נקי (אחרי מס)', 'מיליוני ש״ח']] as const) {
      const e = edgeOf(f, `${k}.${to}`); if (!e) continue;
      rows.push({ sec: 'ins', label: `${he} ← ${toHe}`, shock: e.x == null ? '–' : shockLabel(k as ShockKey, e.x).replace(`${SHOCK_HE[k as ShockKey][0]} `, ''), e, v: e.v, unit });
      // the owner's standard shocks where the disclosure is at a smaller size: a labelled linear read (never the default propagation)
      const std: Partial<Record<string, number>> = { y10: -100, eq: -25 };
      const xs = std[k];
      if (xs != null && e.pts?.length && e.x != null && e.x !== xs && e.v != null) {
        const r = readLine(e.pts, xs, 'linear'), sc = e.scale ?? 1;
        if (r) rows.push({ sec: 'ins', label: `${he} ← ${toHe}`, shock: shockLabel(k as ShockKey, xs).replace(`${SHOCK_HE[k as ShockKey][0]} `, ''), e, v: r.v * (e.b === 'wo~' ? sc : 1), unit, est: true, note: 'הארכה לינארית של הגילוי (אומדן)' });
      }
    }
  }
  return rows;
}
export const QUALITY_HE: Record<Quality, string> = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה', missing: 'חסר' };
export const METHOD_HE: Record<Method, string> = { identity: 'זהות', regression: 'רגרסיה', disclosure: 'גילוי', assumption: 'הנחה', none: '–' };
