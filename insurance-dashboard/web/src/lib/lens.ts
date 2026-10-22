import type { Prov } from './prov';
import type { MetricKey, Win } from './market';
import { nf, pubLabel, sn } from './format';
import { useLoad } from './useData';

/** lens.json (pipeline/build_lens.py): the regulator's months joined to the managers' quarterly P&L. */
export type Seg = 'pen' | 'gem' | 'pg' | 'hish' | 'ins';
export interface LensReg { e: number; m: (number | null)[]; avg: number | null; aE: number | null; aO: number | null; org: number | null; tr: number | null; posted: number | null }
export interface LensRep { c: string; fees: number | null; sm: number | null; ga: number | null; op: number | null; aE: number | null; aO: number | null; keys: { q: string; e: string; o: string } }
export interface LensRow {
  g: number; s: Seg; q: string; reg: LensReg; rep?: LensRep;
  aum_share: number | null; flow_share: number | null; growth: number | null;
  fy_reg?: number; fy_rep?: number; ci?: number; ppb?: number; cover?: number; mark?: string;
  recon?: { st: string; pct: number | null; d: number };
}
export interface LensNow { g: number; s: Seg; m: (number | null)[]; avg: number; org: number | null; tr: number | null; baseAvg: number | null; fy?: number; fees?: number; baseFees?: number | null; cost?: number; op?: number; baseOp?: number | null }
export interface LensData {
  meta: { asof: number; generated: string; p0: number; first_month: number; source_reg: string; source_rep: string; rep_note: string; last_rep: string };
  groups: { name: string; id: string | null; lts: string | null }[];
  segs: Record<Seg, { label: string; set: string; rep: boolean }>;
  months: number[];
  series: Record<string, { a: (number | null)[]; org: (number | null)[]; tr: (number | null)[]; fee: (number | null)[] }>;
  quarters: string[];
  rows: LensRow[];
  nowcast: { q: string; base: string; months: number[]; o: number; rows: LensNow[] };
  breaks: { family: string; metric: string; from: string; note: string }[];
  marks: Record<string, { metrics: string[]; text: string }>;
}
export const useLens = () => useLoad<LensData>('lens.json');

export const SEGS: [Seg, string][] = [['pen', 'פנסיה'], ['gem', 'גמל והשתלמות'], ['pg', 'פנסיה וגמל'], ['hish', 'השתלמות'], ['ins', 'ביטוח']];
export const SEG_LONG: Record<Seg, string> = { pen: 'פנסיה', gem: 'גמל והשתלמות', pg: 'פנסיה וגמל', hish: 'קרנות השתלמות', ins: 'ביטוחי מנהלים ופוליסות חיסכון' };
/** the regulator product sets of a lens segment (market.ts ids) */
const SETS: Record<Seg, string[]> = { pen: ['fam:pension'], gem: ['fam:gemel'], pg: ['fam:pension', 'fam:gemel'], hish: ['p:hishtalmut'], ins: ['fam:insurance'] };
const SET_LABEL: Record<string, string> = { 'fam:pension': 'פנסיה', 'fam:gemel': 'גמל והשתלמות', 'p:hishtalmut': 'השתלמות', 'fam:insurance': 'ביטוח-נט' };
/** why a reported figure is missing for a segment */
export const NO_REP: Record<Seg, string> = {
  pen: 'החברה אינה מנהלת קרן פנסיה, או שהדוח אינו מפרסם את מגזר הפנסיה בנפרד',
  gem: 'החברה אינה מנהלת קופות גמל, או שהדוח אינו מפרסם את המגזר בנפרד',
  pg: 'נדרשים מגזר הפנסיה ומגזר הגמל של אותו רבעון',
  hish: 'הדוחות מאחדים גמל והשתלמות במגזר אחד: אין רווח והפסד לקרנות השתלמות לבד',
  ins: 'ביטוח-נט מאחד ביטוחי מנהלים ופוליסות חיסכון; הכנסות פוליסות החיסכון (חוזי השקעה, IFRS 9) אינן ניתנות להצמדה לנכסים האלה',
};

/* ---------- periods ---------- */
export const ym = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
/** "Q2-2026" → "Q2'26" */
export const ql = (k: string) => `${k.slice(0, 2)}'${k.slice(5)}`;
/** "2026-06" → "06/26" */
export const bl = (k: string) => `${k.slice(5)}/${k.slice(2, 4)}`;
export const madd = (p: number, k: number) => { const t = Math.floor(p / 100) * 12 + (p % 100 - 1) + k; return Math.floor(t / 12) * 100 + (t % 12) + 1; };
const mdiff = (a: number, b: number) => (Math.floor(a / 100) * 12 + a % 100) - (Math.floor(b / 100) * 12 + b % 100);

/* ---------- formats ---------- */
export const bn = (x: number | null | undefined, d = 1) => (x == null ? '–' : nf(x / 1000, d));
export const pc = (x: number | null | undefined, d = 2) => (x == null ? '–' : `${nf(x, d)}%`);
export const spc = (x: number | null | undefined, d = 1) => (x == null ? '–' : `${sn(x, d)}%`);
const mil = (x: number | null | undefined, d = 1) => (x == null ? '–' : nf(x, d));

/* ---------- sources ---------- */
export class LensSrc {
  constructor(readonly d: LensData) {}
  pi(p: number) { return mdiff(p, this.d.meta.p0); }
  name(g: number) { return g < 0 ? 'כלל השוק' : this.d.groups[g].name; }
  /** a regulator aggregate of one segment, rebuilt from its tracks by the source sheet; a two-family segment lists both */
  reg(metric: MetricKey, p: number, w: Win, s: Seg, g: number, value: string, unit?: string, title?: string): Prov {
    const sets = SETS[s];
    const one = (set: string): Prov => ({ k: 'reg', metric, pi: this.pi(p), w, set, g });
    if (sets.length === 1) return one(sets[0]);
    return { k: 'calc', title: title ?? `${metric} · ${this.name(g)} · ${SEG_LONG[s]} · ${ym(p)}`, value, unit, formula: 'פנסיה ועוד גמל והשתלמות',
      inputs: sets.map((x) => ({ label: SET_LABEL[x], v: '', src: () => one(x) })) };
  }
  /** the regulator's four month ends behind a quarter's average assets */
  avgP(r: LensRow): Prov {
    const e = r.reg.e, ms = [madd(e, -3), madd(e, -2), madd(e, -1), e];
    return { k: 'calc', title: `נכסים ממוצעים, רשות · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${ql(r.q)}`, value: bn(r.reg.avg, 2), unit: 'מיליארד ש"ח',
      formula: '(A₀ ÷ 2 + A₁ + A₂ + A₃ ÷ 2) ÷ 3: טרפז על ארבעה סופי חודש. A₀ = סוף הרבעון הקודם',
      inputs: ms.map((p, i) => ({ label: `נכסים · ${ym(p)}`, v: bn(r.reg.m[i], 2), src: () => this.reg('assets', p, 'm', r.s, r.g, bn(r.reg.m[i], 2), 'מיליארד ש"ח', `נכסים · ${this.name(r.g)} · ${ym(p)}`) })) };
  }
  /** a reported segment figure: the formula and printed components of lts_prov/<company>.json */
  rep(r: LensRow, metric: 'fees' | 'sm' | 'ga' | 'op' | 'aum', at: 'q' | 'e' | 'o'): Prov {
    const rp = r.rep!, key = rp.keys[at];
    const v = metric === 'aum' ? (at === 'o' ? rp.aO : rp.aE) : rp[metric];
    const title = `${REP_LABEL[metric]} · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${at === 'q' ? ql(key) : bl(key)}`;
    const unit = metric === 'aum' ? 'מיליארד ש"ח' : 'מיליוני ש"ח', dec = metric === 'aum' ? 2 : 1;
    const pre = r.s === 'ins' ? 'ic' : r.s;
    if (pre === 'pg') return { k: 'calc', title, value: v == null ? '–' : nf(v, dec), unit, formula: 'מגזר הפנסיה ועוד מגזר הגמל, מהדוח',
      inputs: (['pen', 'gem'] as const).map((p) => ({ label: SEG_LONG[p], v: '', src: () => ltsProv(rp.c, `${p}.${metric}`, key, title.replace(SEG_LONG.pg, SEG_LONG[p]), unit) })) };
    return ltsProv(rp.c, `${pre}.${metric}`, key, title, unit, metric === 'aum' && pre === 'ic' ? 'הדוח מדפיס במיליוני ש"ח; מוצג כאן במיליארדים' : undefined, v == null ? '–' : nf(v, dec));
  }
  fyReg(r: LensRow): Prov {
    return { k: 'calc', title: `תשואת דמי ניהול על נכסי הרשות · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${ql(r.q)}`, value: pc(r.fy_reg, 3), unit: 'שנתי',
      formula: 'הכנסות מדמי ניהול ברבעון (מהדוח) × 4 ÷ נכסים ממוצעים ברבעון (רשות) × 100',
      inputs: [{ label: `הכנסות מדמי ניהול · ${ql(r.q)}`, v: mil(r.rep?.fees), src: () => this.rep(r, 'fees', 'q') }, { label: 'נכסים ממוצעים, רשות (מיליארד)', v: bn(r.reg.avg, 2), src: () => this.avgP(r) }],
      note: r.cover != null && Math.abs(r.cover - 100) > 3 ? `הנכסים המדווחים הם ${nf(r.cover, 1)}% מנכסי הרשות: ההכנסות כוללות פעילות שאינה בקבוצה של הרשות (למשל קרנות ותיקות) או להפך` : undefined };
  }
  fyRep(r: LensRow): Prov {
    return { k: 'calc', title: `תשואת דמי ניהול על נכסים מדווחים · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${ql(r.q)}`, value: pc(r.fy_rep, 3), unit: 'שנתי',
      formula: 'הכנסות מדמי ניהול ברבעון × 4 ÷ ((נכסים בתחילת הרבעון + בסופו) ÷ 2) × 100, הכול מהדוח',
      inputs: [{ label: `הכנסות מדמי ניהול · ${ql(r.q)}`, v: mil(r.rep?.fees), src: () => this.rep(r, 'fees', 'q') },
        { label: `נכסים · ${bl(r.rep!.keys.o)}`, v: mil(r.rep?.aO, 2), src: () => this.rep(r, 'aum', 'o') }, { label: `נכסים · ${bl(r.rep!.keys.e)}`, v: mil(r.rep?.aE, 2), src: () => this.rep(r, 'aum', 'e') }] };
  }
  ci(r: LensRow): Prov {
    const rp = r.rep!;
    return { k: 'calc', title: `הוצאות להכנסות · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${ql(r.q)}`, value: pc(r.ci, 1), formula: '(שיווק ומכירה + הנהלה וכלליות) ÷ הכנסות מדמי ניהול × 100',
      inputs: [{ label: 'שיווק ומכירה', v: mil(rp.sm), src: () => this.rep(r, 'sm', 'q') }, { label: 'הנהלה וכלליות', v: mil(rp.ga), src: () => this.rep(r, 'ga', 'q') }, { label: 'הכנסות מדמי ניהול', v: mil(rp.fees), src: () => this.rep(r, 'fees', 'q') }], note: r.mark };
  }
  ppb(r: LensRow): Prov {
    return { k: 'calc', title: `רווח תפעולי לכל מיליארד ש"ח נכסים · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${ql(r.q)}`, value: r.ppb == null ? '–' : nf(r.ppb, 2), unit: 'מיליוני ש"ח למיליארד, שנתי',
      formula: 'רווח תפעולי ברבעון (דמי ניהול פחות שיווק ומכירה פחות הנהלה וכלליות, מהדוח) × 4 ÷ נכסים ממוצעים ברבעון במיליארדים (רשות)',
      inputs: [{ label: `רווח תפעולי · ${ql(r.q)}`, v: mil(r.rep?.op), src: () => this.rep(r, 'op', 'q') }, { label: 'נכסים ממוצעים, רשות (מיליארד)', v: bn(r.reg.avg, 2), src: () => this.avgP(r) }], note: r.mark };
  }
  cover(r: LensRow): Prov {
    return { k: 'calc', title: `נכסים מדווחים מול נכסי הרשות · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${bl(r.rep!.keys.e)}`, value: pc(r.cover, 1),
      formula: 'נכסים מנוהלים כפי שהודפסו בדוח ליום המאזן ÷ סכום נכסי המסלולים של הקבוצה ברשות באותו חודש × 100. מעל 100: הדוח כולל נכסים שאינם בקבוצה של הרשות (קרנות ותיקות, מקבלי קצבה)',
      inputs: [{ label: `נכסים בדוח · ${bl(r.rep!.keys.e)}`, v: mil(r.rep?.aE, 2), src: () => this.rep(r, 'aum', 'e') }, { label: `נכסים ברשות · ${ym(r.reg.e)}`, v: bn(r.reg.aE, 2), src: () => this.reg('assets', r.reg.e, 'm', r.s, r.g, bn(r.reg.aE, 2), 'מיליארד ש"ח') }],
      note: r.recon ? `התאמה בעמוד החברה: ${r.recon.st === 'match' ? 'תואם' : r.recon.st === 'close' ? 'קרוב' : r.recon.st === 'near' ? 'מדד קרוב, לא זהה' : 'פער לא מוסבר'}${r.recon.pct != null ? ` (${sn(r.recon.pct, 2)}%)` : ''}` : undefined };
  }
  share(r: LensRow, all: LensRow[], kind: 'aum' | 'flow'): Prov {
    const peers = all.filter((x) => x.s === r.s && x.q === r.q);
    if (kind === 'aum') return { k: 'calc', title: `נתח מנכסים · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${ym(r.reg.e)}`, value: pc(r.aum_share, 1), formula: 'נכסי הקבוצה ÷ נכסי כל הקבוצות × 100, בחודש האחרון של הרבעון',
      inputs: [{ label: this.name(r.g), v: bn(r.reg.aE), src: () => this.reg('assets', r.reg.e, 'm', r.s, r.g, bn(r.reg.aE), 'מיליארד ש"ח') }, { label: 'כלל השוק', v: bn(peers.reduce((t, x) => t + (x.reg.aE ?? 0), 0)), src: () => this.reg('assets', r.reg.e, 'm', r.s, -1, '', 'מיליארד ש"ח') }] };
    const net = (x: LensRow) => (x.reg.org == null || x.reg.tr == null ? null : x.reg.org + x.reg.tr);
    const tot = peers.reduce((t, x) => t + (net(x) ?? 0), 0);
    return { k: 'calc', title: `נתח מהצבירה נטו · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${ql(r.q)}`, value: pc(r.flow_share, 1),
      formula: '(צבירה אורגנית + העברות נטו) של הקבוצה ברבעון ÷ אותו סכום לכל הקבוצות × 100. מעל הנתח מהנכסים: הקבוצה צוברת מהר מהשוק',
      inputs: [{ label: `צבירה אורגנית · ${ql(r.q)}`, v: bn(r.reg.org, 2), src: () => this.reg('organic', r.reg.e, 'q', r.s, r.g, bn(r.reg.org, 2), 'מיליארד ש"ח') },
        { label: `העברות נטו · ${ql(r.q)}`, v: bn(r.reg.tr, 2), src: () => this.reg('transfers', r.reg.e, 'q', r.s, r.g, bn(r.reg.tr, 2), 'מיליארד ש"ח') },
        { label: 'צבירה נטו, כל הקבוצות', v: bn(tot, 2), src: () => this.reg('netflow', r.reg.e, 'q', r.s, -1, bn(tot, 2), 'מיליארד ש"ח') }] };
  }
  growth(r: LensRow): Prov {
    return { k: 'calc', title: `צמיחה אורגנית · ${this.name(r.g)} · ${SEG_LONG[r.s]} · ${ql(r.q)}`, value: spc(r.growth, 2), formula: '(צבירה אורגנית + העברות נטו) ברבעון ÷ נכסים בסוף הרבעון הקודם × 100. לא שנתי',
      inputs: [{ label: 'צבירה אורגנית', v: bn(r.reg.org, 2), src: () => this.reg('organic', r.reg.e, 'q', r.s, r.g, bn(r.reg.org, 2), 'מיליארד ש"ח') }, { label: 'העברות נטו', v: bn(r.reg.tr, 2), src: () => this.reg('transfers', r.reg.e, 'q', r.s, r.g, bn(r.reg.tr, 2), 'מיליארד ש"ח') },
        { label: `נכסים · ${ym(madd(r.reg.e, -3))}`, v: bn(r.reg.aO, 2), src: () => this.reg('assets', madd(r.reg.e, -3), 'm', r.s, r.g, bn(r.reg.aO, 2), 'מיליארד ש"ח') }] };
  }
  /** the nowcast: an estimate, with its method and every input */
  now(n: LensNow, base: LensRow | undefined, kind: 'fees' | 'op' | 'avg'): Prov {
    const nc = this.d.nowcast, ms = [nc.o, ...nc.months];
    const avgP: Prov = { k: 'calc', est: true, title: `נכסים ממוצעים QTD, רשות · ${this.name(n.g)} · ${SEG_LONG[n.s]} · ${ql(nc.q)}`, value: bn(n.avg, 2), unit: 'מיליארד ש"ח',
      formula: `טרפז על סופי החודשים שפורסמו: (A₀ ÷ 2 + … + Aₖ ÷ 2) ÷ k, k = ${nc.months.length}`,
      inputs: ms.map((p, i) => ({ label: `נכסים · ${ym(p)}`, v: bn(n.m[i], 2), src: () => this.reg('assets', p, 'm', n.s, n.g, bn(n.m[i], 2), 'מיליארד ש"ח') })) };
    if (kind === 'avg') return avgP;
    const feesP: Prov = { k: 'calc', est: true, title: `אומדן הכנסות מדמי ניהול · ${this.name(n.g)} · ${SEG_LONG[n.s]} · ${ql(nc.q)}`, value: mil(n.fees), unit: 'מיליוני ש"ח',
      formula: `אומדן: תשואת דמי הניהול של ${ql(nc.base)} ÷ 100 × נכסים ממוצעים QTD × 3 ÷ 12. מניח שהשיעור האפקטיבי לא השתנה ושהנכסים בהמשך הרבעון בממוצע שפורסם`,
      inputs: [{ label: `תשואת דמי ניהול · ${ql(nc.base)}`, v: pc(n.fy, 3), src: base ? () => this.fyReg(base) : undefined }, { label: `נכסים ממוצעים QTD (${nc.months.map(ym).join(', ')})`, v: bn(n.avg, 2), src: () => avgP }] };
    if (kind === 'fees') return feesP;
    return { k: 'calc', est: true, title: `אומדן רווח תפעולי · ${this.name(n.g)} · ${SEG_LONG[n.s]} · ${ql(nc.q)}`, value: mil(n.op), unit: 'מיליוני ש"ח',
      formula: `אומדן: אומדן ההכנסות פחות הוצאות שיווק ומכירה והנהלה וכלליות של ${ql(nc.base)} (מניח הוצאות קבועות)`,
      inputs: [{ label: 'אומדן הכנסות מדמי ניהול', v: mil(n.fees), src: () => feesP }, { label: `שיווק + הנהלה · ${ql(nc.base)}`, v: mil(n.cost), src: base?.rep ? () => ({ k: 'calc', title: `שיווק + הנהלה · ${this.name(n.g)} · ${ql(nc.base)}`, value: mil(n.cost), unit: 'מיליוני ש"ח', formula: 'שיווק ומכירה ועוד הנהלה וכלליות',
        inputs: [{ label: 'שיווק ומכירה', v: mil(base.rep!.sm), src: () => this.rep(base, 'sm', 'q') }, { label: 'הנהלה וכלליות', v: mil(base.rep!.ga), src: () => this.rep(base, 'ga', 'q') }] }) : undefined }] };
  }
}
const REP_LABEL = { fees: 'הכנסות מדמי ניהול', sm: 'שיווק ומכירה', ga: 'הנהלה וכלליות', op: 'רווח תפעולי', aum: 'נכסים מנוהלים בדוח' } as const;

/* ---------- printed components of report figures (web/public/data/lts_prov/<company>.json), loaded when needed ---------- */
interface LtsProvFile { entity?: string | null; urls: Record<string, string | null>; parts: [string, number | null, string, number, string, string, string][]; facts: Record<string, [string, number[]]> }
const provCache = new Map<string, LtsProvFile>(), pend = new Set<string>();
export function warmRep(c: string | undefined | null) {
  if (!c || provCache.has(c) || pend.has(c)) return;
  pend.add(c);
  fetch(`${import.meta.env.BASE_URL}data/lts_prov/${c}.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) provCache.set(c, j); }).catch(() => {}).finally(() => pend.delete(c));
}
const unitHe = (u: string) => u.replace('NIS thousands', 'אלפי ש"ח').replace('NIS thousand', 'אלפי ש"ח').replace('NIS millions', 'מיליוני ש"ח').replace('NIS billions', 'מיליארדי ש"ח');
const WIN_HE: Record<string, string> = { q: 'רבעון', ytd: 'YTD', fy: 'FY', h1: 'H1', instant: '' };
function ltsProv(c: string, metric: string, period: string, title: string, unit: string, note?: string, value?: string): Prov {
  const pr = provCache.get(c), f = pr?.facts[`${metric}|${period}`];
  if (!pr) { warmRep(c); return { k: 'none', title, why: 'פירוט הרכיבים מהדוח נטען כעת. נסו שוב בעוד רגע.' }; }
  if (!f) return { k: 'none', title, why: 'לנתון זה לא נרשמו רכיבים מודפסים.' };
  const parts = f[1].map((i) => pr.parts[i]);
  return { k: 'calc', title, value: value ?? '', unit, formula: f[0].replace(/\bthe\s+/g, ''), note: [pr.entity ?? 'דוחות החברה המנהלת', note].filter(Boolean).join(' · '),
    inputs: parts.slice(0, 40).map(([file, pg, label, val, u, date, win]) => ({ label: `${label} · ${pubLabel(date)}${win && WIN_HE[win] !== '' ? ` · ${WIN_HE[win] ?? win}` : ''}`, v: `${nf(val, Math.abs(val) < 100 ? 2 : 0)} ${unitHe(u)}`,
      src: file ? () => ({ k: 'report', title: label, value: nf(val, Math.abs(val) < 100 ? 2 : 0), unit: unitHe(u), url: pr.urls[file] ?? null, pg, doc: `${file.startsWith('ic:') ? 'דוח חברת הביטוח' : pr.entity ?? 'דוח החברה המנהלת'}, ${file.replace('ic:', '')}`, period: pubLabel(date), srcType: file.startsWith('ic:') ? 'דוח חברת הביטוח' : 'דוח החברה המנהלת' }) as Prov : undefined })) };
}

/* ---------- rank history ---------- */
export type RankBy = 'aum' | 'flow' | 'fee' | 'fy';
/** ranks of the groups per month (aum, flow, posted fee) or per quarter (reported fee yield); 1 = largest */
export function rankHistory(d: LensData, s: Seg, by: RankBy): { x: string[]; ranks: Map<number, (number | null)[]>; vals: Map<number, (number | null)[]>; n: number[] } {
  const G = d.groups.length;
  if (by === 'fy') {
    const x = d.quarters, ranks = new Map<number, (number | null)[]>(), vals = new Map<number, (number | null)[]>(), n: number[] = [];
    x.forEach((q, qi) => {
      const rs = d.rows.filter((r) => r.s === s && r.q === q && r.fy_reg != null).sort((a, b) => b.fy_reg! - a.fy_reg!);
      n.push(rs.length);
      rs.forEach((r, i) => { if (!ranks.has(r.g)) { ranks.set(r.g, x.map(() => null)); vals.set(r.g, x.map(() => null)); } ranks.get(r.g)![qi] = i + 1; vals.get(r.g)![qi] = r.fy_reg!; });
    });
    return { x: x.map(ql), ranks, vals, n };
  }
  const ranks = new Map<number, (number | null)[]>(), vals = new Map<number, (number | null)[]>(), n: number[] = [];
  const val = (g: number, i: number): number | null => {
    const ser = d.series[`${g}|${s}`]; if (!ser) return null;
    if (by === 'aum') return ser.a[i];
    if (by === 'fee') return ser.fee[i];
    // flows: organic + transfers over the last three months
    if (i < 2) return null;
    let t = 0;
    for (let k = i - 2; k <= i; k++) { const o = ser.org[k], tr = ser.tr[k]; if (o == null || tr == null) return null; t += o + tr; }
    return t;
  };
  d.months.forEach((_, i) => {
    const rs = Array.from({ length: G }, (_, g) => ({ g, v: val(g, i) })).filter((x): x is { g: number; v: number } => x.v != null && (by !== 'aum' || x.v > 0) && d.groups[x.g].name !== 'קרנות ענפיות ואחרות')
      .sort((a, b) => (by === 'fee' ? b.v - a.v : b.v - a.v));
    n.push(rs.length);
    rs.forEach((r, k) => { if (!ranks.has(r.g)) { ranks.set(r.g, d.months.map(() => null)); vals.set(r.g, d.months.map(() => null)); } ranks.get(r.g)![i] = k + 1; vals.get(r.g)![i] = r.v; });
  });
  return { x: d.months.map(ym), ranks, vals, n };
}
