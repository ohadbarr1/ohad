import type { Prov } from './prov';
import { nf, sn } from './format';
import { useLoad } from './useData';
import { ckanQuery, DS_LABEL } from './sources';
import { keProv, type Assume, type Rf } from './valuation';
import { LensSrc, ltsProv, madd, ql, warmRep, ym, type LensData, type LensRow } from './lens';

/** flow_npv.json (pipeline/build_flow_npv.py): the operating profit that net transfers (ניוד) and net organic flow carry, discounted. */
export type NSeg = 'pen' | 'gem';
export interface NpvRow {
  g: number; s: NSeg; p: string; qs: string[]; c: string | null; mark?: string;
  fees: number | null; sm: number | null; ga: number | null; avg: number | null; fy: number | null; ci: number | null; m: number | null;
  tr: number | null; org: number | null; npv_tr: number | null; npv_org: number | null; rk_tr?: number; rk_org?: number; n_tr?: number; n_org?: number;
}
export interface DurGroup { g: number; c: string; avg: number[]; mean: number; wdm: number[]; wd: number; tro: number[]; out: number; d: number | null }
export interface Dur { v: number; avg: number; wd: number; out: number; wd_rate: number; out_rate: number; n: number; q: string[]; months: number[]; groups: DurGroup[]; res: { id: string; name: string; pkg: string } | null }
export interface FlowNpv {
  meta: { generated: string; asof: number; last_rep: string; ltm: string; source_reg: string; source_rep: string; source_macro: string; formula: string;
    ke: { v: number; rf: number; rf_month: string; rf_code: string; rf_url: string; rf_retrieved: string; beta: number; erp: number } };
  segs: Record<NSeg, string>;
  groups: string[];
  periods: string[];
  dur: Record<NSeg, Dur>;
  rows: NpvRow[];
}
export const useFlowNpv = () => useLoad<FlowNpv>('flow_npv.json');

/** margin basis: the lens's cost/income (S&M + G&A), or G&A only (the run-off margin of assets already won: an upper bound) */
export type Basis = 'ci' | 'ga';
export const NSEGS: [NSeg, string][] = [['pen', 'פנסיה'], ['gem', 'גמל והשתלמות']];
/** "LTM-Q2-2026" → "LTM Q2'26"; "Q2-2026" → "Q2'26" */
export const pl = (p: string) => (p.startsWith('LTM-') ? `LTM ${ql(p.slice(4))}` : ql(p));
export const isLtm = (p: string) => p.startsWith('LTM-');

/** a(D, ke) = (1 − (1 + ke)^−D) ÷ ke: D years of a margin paid at each year end, discounted at ke (ke in percent) */
export const annuity = (D: number, ke: number) => { const k = ke / 100; return k === 0 ? D : (1 - Math.pow(1 + k, -D)) / k; };

const MM = 'מיליוני ש"ח';
const m1 = (v: number | null | undefined, d = 1) => (v == null ? '–' : nf(v, d));
const s1 = (v: number | null | undefined, d = 1) => (v == null ? '–' : sn(v, d));
const pc = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${nf(v, d)}%`);

export interface NpvCtx { ke: number; keP: () => Prov; D: Record<NSeg, number>; Dset: Record<NSeg, boolean>; basis: Basis }

/** Every figure of the view and its source: the lens's own provenance for the quarter's flows, fee yield and costs; the reports and the
    regulator for the default duration; the valuation page's ke. */
export class NpvSrc {
  readonly ls: LensSrc;
  private byQ = new Map<string, LensRow>();
  constructor(readonly d: FlowNpv, readonly lens: LensData, readonly c: NpvCtx) {
    this.ls = new LensSrc(lens);
    lens.rows.forEach((r) => this.byQ.set(`${r.g}|${r.s}|${r.q}`, r));
  }
  name(g: number) { return this.d.groups[g]; }
  lr(g: number, s: NSeg, q: string) { return this.byQ.get(`${g}|${s}|${q}`); }
  seg(s: NSeg) { return this.d.segs[s]; }
  a(s: NSeg) { return annuity(this.c.D[s], this.c.ke); }

  /* ---------- the margin and its parts ---------- */
  margin(r: NpvRow): number | null {
    if (r.fy == null) return null;
    if (this.c.basis === 'ci') return r.ci == null ? null : r.fy * (1 - r.ci / 100);
    return r.ga == null || !r.fees ? null : r.fy * (1 - r.ga / r.fees);
  }
  npv(r: NpvRow, k: 'tr' | 'org'): number | null { const m = this.margin(r), F = r[k]; return m == null || F == null ? null : F * m / 100 * this.a(r.s); }

  private tag(r: NpvRow) { return `${this.name(r.g)} · ${this.seg(r.s)} · ${pl(r.p)}`; }
  /** a sum over the four quarters of an LTM row, each quarter opening its own source */
  private sum4(r: NpvRow, label: string, v: string, unit: string, each: (lr: LensRow, q: string) => { v: string; src: () => Prov }): Prov {
    return { k: 'calc', title: `${label} · ${this.tag(r)}`, value: v, unit, formula: `סכום ארבעת הרבעונים ${r.qs.map(ql).join(', ')}`,
      inputs: r.qs.map((q) => { const lr = this.lr(r.g, r.s, q); const e = lr ? each(lr, q) : { v: '–', src: undefined }; return { label: ql(q), v: e.v, src: e.src }; }) };
  }
  flow(r: NpvRow, k: 'tr' | 'org'): Prov {
    const metric = k === 'tr' ? 'transfers' : 'organic', label = k === 'tr' ? 'העברות (ניוד) נטו' : 'צבירה אורגנית נטו';
    const one = (lr: LensRow) => this.ls.reg(metric, lr.reg.e, 'q', lr.s, lr.g, nf((k === 'tr' ? lr.reg.tr : lr.reg.org)! / 1000, 2), 'מיליארד ש"ח');
    if (!isLtm(r.p)) { const lr = this.lr(r.g, r.s, r.p); return lr ? one(lr) : { k: 'none', title: label, why: 'אין שורת עדשה לרבעון' }; }
    return this.sum4(r, label, m1(r[k], 0), MM, (lr) => ({ v: m1(k === 'tr' ? lr.reg.tr : lr.reg.org, 0), src: () => one(lr) }));
  }
  fy(r: NpvRow): Prov {
    if (!isLtm(r.p)) { const lr = this.lr(r.g, r.s, r.p); return lr ? this.ls.fyReg(lr) : { k: 'none', title: 'תשואת דמי ניהול', why: 'אין שורת עדשה' }; }
    return { k: 'calc', title: `תשואת דמי ניהול על נכסי הרשות · ${this.tag(r)}`, value: pc(r.fy, 3), unit: 'שנתי',
      formula: 'Σ הכנסות מדמי ניהול בארבעת הרבעונים (מהדוח) ÷ (Σ נכסים ממוצעים ברבעון, רשות ÷ 4) × 100. אותה הגדרה של העדשה (fy_reg), על ארבעה רבעונים',
      inputs: [{ label: 'Σ הכנסות מדמי ניהול', v: m1(r.fees), src: () => this.sum4(r, 'הכנסות מדמי ניהול', m1(r.fees), MM, (lr) => ({ v: m1(lr.rep?.fees), src: () => this.ls.rep(lr, 'fees', 'q') })) },
        { label: 'Σ נכסים ממוצעים, רשות', v: m1(r.avg, 0), src: () => this.sum4(r, 'נכסים ממוצעים, רשות', m1(r.avg, 0), MM, (lr) => ({ v: m1(lr.reg.avg, 0), src: () => this.ls.avgP(lr) })) }] };
  }
  private part(r: NpvRow, k: 'sm' | 'ga' | 'fees', label: string): Prov {
    if (!isLtm(r.p)) { const lr = this.lr(r.g, r.s, r.p); return lr?.rep ? this.ls.rep(lr, k, 'q') : { k: 'none', title: label, why: 'אין נתון מהדוח' }; }
    return this.sum4(r, label, m1(r[k]), MM, (lr) => ({ v: m1(lr.rep?.[k]), src: () => this.ls.rep(lr, k, 'q') }));
  }
  ci(r: NpvRow): Prov {
    if (!isLtm(r.p)) { const lr = this.lr(r.g, r.s, r.p); if (lr?.ci != null) return this.ls.ci(lr); }
    return { k: 'calc', title: `הוצאות להכנסות · ${this.tag(r)}`, value: pc(r.ci, 1), formula: '(Σ שיווק ומכירה + Σ הנהלה וכלליות) ÷ Σ הכנסות מדמי ניהול × 100. אותה הגדרה של העדשה (ci)',
      inputs: [{ label: 'שיווק ומכירה', v: m1(r.sm), src: () => this.part(r, 'sm', 'שיווק ומכירה') }, { label: 'הנהלה וכלליות', v: m1(r.ga), src: () => this.part(r, 'ga', 'הנהלה וכלליות') },
        { label: 'הכנסות מדמי ניהול', v: m1(r.fees), src: () => this.part(r, 'fees', 'הכנסות מדמי ניהול') }], note: r.mark };
  }
  gaRatio(r: NpvRow): Prov {
    return { k: 'calc', title: `הנהלה וכלליות להכנסות · ${this.tag(r)}`, value: r.ga != null && r.fees ? pc(r.ga / r.fees * 100, 1) : '–', formula: 'הנהלה וכלליות ÷ הכנסות מדמי ניהול × 100 (בלי שיווק ומכירה)',
      inputs: [{ label: 'הנהלה וכלליות', v: m1(r.ga), src: () => this.part(r, 'ga', 'הנהלה וכלליות') }, { label: 'הכנסות מדמי ניהול', v: m1(r.fees), src: () => this.part(r, 'fees', 'הכנסות מדמי ניהול') }], note: r.mark };
  }
  marginP(r: NpvRow): Prov {
    const m = this.margin(r), ci = this.c.basis === 'ci';
    return { k: 'calc', title: `מרווח תפעולי על נכסים · ${this.tag(r)}`, value: pc(m, 3), unit: 'לשנה',
      formula: ci ? 'm = תשואת דמי ניהול × (1 − הוצאות להכנסות ÷ 100). שווה לרווח התפעולי ÷ הנכסים הממוצעים' : 'm = תשואת דמי ניהול × (1 − הנהלה וכלליות ÷ הכנסות). בלי שיווק ומכירה: המרווח של נכסים שכבר נוידו, גבול עליון',
      inputs: [{ label: 'תשואת דמי ניהול', v: pc(r.fy, 3), src: () => this.fy(r) }, ci ? { label: 'הוצאות להכנסות', v: pc(r.ci, 1), src: () => this.ci(r) } : { label: 'הנהלה וכלליות להכנסות', v: r.ga != null && r.fees ? pc(r.ga / r.fees * 100, 1) : '–', src: () => this.gaRatio(r) }],
      note: [m != null && m < 0 ? 'מרווח שלילי: ההוצאות ברבעונים אלה עולות על ההכנסות, ולכן ערך הזרימה שלילי גם כשהיא חיובית' : '', r.mark ?? ''].filter(Boolean).join(' · ') || undefined };
  }

  /* ---------- the assumptions ---------- */
  durP(s: NSeg): Prov {
    const du = this.d.dur[s], set = this.c.Dset[s];
    du.groups.forEach((g) => warmRep(g.c));  // the printed transfers out load while the sheet is read
    const def = this.durDefault(s);
    if (set) return { k: 'calc', est: true, title: `משך (D) · ${this.seg(s)}`, value: `${nf(this.c.D[s], 2)} שנים`, formula: 'ההנחה שלך. ברירת המחדל: ותק משתמע משיעור היציאה', inputs: [{ label: 'ברירת המחדל', v: `${nf(du.v, 2)} שנים`, src: () => def }] };
    return def;
  }
  private durDefault(s: NSeg): Prov {
    const du = this.d.dur[s], q = du.q, seg = this.seg(s);
    const per = (label: string, v: string, list: (g: DurGroup) => { v: string; src: () => Prov }): Prov => ({ k: 'calc', title: `${label} · ${seg} · LTM ${ql(q[3])}`, value: v, unit: MM, formula: `סכום ${du.n} המנהלים שמפרסמים ניוד החוצה`,
      inputs: du.groups.map((g) => ({ label: this.name(g.g), ...list(g) })) });
    const avgP = (g: DurGroup): Prov => ({ k: 'calc', title: `נכסים ממוצעים LTM · ${this.name(g.g)} · ${seg}`, value: m1(g.mean, 0), unit: MM, formula: 'ממוצע הנכסים הממוצעים של ארבעת הרבעונים (טרפז על סופי חודש, רשות)',
      inputs: q.map((k, i) => { const lr = this.lr(g.g, s, k); return { label: ql(k), v: m1(g.avg[i], 0), src: lr ? () => this.ls.avgP(lr) : undefined }; }) });
    const wdP = (g: DurGroup): Prov => ({ k: 'calc', title: `משיכות LTM · ${this.name(g.g)} · ${seg}`, value: m1(g.wd, 0), unit: MM, formula: 'סכום 12 החודשים: WITHDRAWLS של מסלולי הקבוצה ברשות',
      inputs: du.months.map((p, i) => ({ label: ym(p), v: m1(g.wdm[i]), src: () => this.wdMonth(s, g, p, g.wdm[i]) })) });
    const outP = (g: DurGroup): Prov => ({ k: 'calc', title: `ניוד החוצה LTM · ${this.name(g.g)} · ${seg}`, value: m1(g.out, 0), unit: MM, formula: 'סכום ארבעת הרבעונים: העברות צבירה מהקרן, ברוטו, מהדוח (מיליארדים × 1,000)',
      inputs: q.map((k, i) => ({ label: ql(k), v: nf(g.tro[i], 3), src: () => ltsProv(g.c, `${s}.tr_out`, k, `ניוד החוצה · ${this.name(g.g)} · ${seg} · ${ql(k)}`, 'מיליארדי ש"ח', undefined, nf(g.tro[i], 3)) })) });
    return { k: 'calc', est: true, title: `משך (D), ברירת מחדל · ${seg}`, value: `${nf(du.v, 2)} שנים`,
      formula: 'D = Σ נכסים ממוצעים ÷ Σ (משיכות + ניוד החוצה), LTM: הוותק המשתמע משיעור היציאה. אומדן: ניוד החוצה ברוטו כולל מעבר בין מסלולים של אותו מנהל כשהדוח אינו מנכה אותו, ולכן ה-D נמוך מעט מדי',
      inputs: [{ label: 'Σ נכסים ממוצעים, רשות', v: m1(du.avg, 0), src: () => per('נכסים ממוצעים', m1(du.avg, 0), (g) => ({ v: m1(g.mean, 0), src: () => avgP(g) })) },
        { label: `Σ משיכות, רשות (${pc(du.wd_rate, 1)} מהנכסים)`, v: m1(du.wd, 0), src: () => per('משיכות', m1(du.wd, 0), (g) => ({ v: m1(g.wd, 0), src: () => wdP(g) })) },
        { label: `Σ ניוד החוצה, דוחות (${pc(du.out_rate, 1)} מהנכסים)`, v: m1(du.out, 0), src: () => per('ניוד החוצה', m1(du.out, 0), (g) => ({ v: m1(g.out, 0), src: () => outP(g) })) }] };
  }
  private wdMonth(s: NSeg, g: DurGroup, p: number, v: number): Prov {
    const res = this.d.dur[s].res, ds = s === 'pen' ? 'pensia' : 'gemel';
    return { k: 'report', title: `משיכות · ${this.name(g.g)} · ${this.seg(s)} · ${ym(p)}`, value: m1(v), unit: MM, url: res ? ckanQuery(res.id, { REPORT_PERIOD: p }, ['FUND_ID', 'FUND_NAME', 'MANAGING_CORPORATION', 'WITHDRAWLS', 'TOTAL_ASSETS']) : null, pg: null,
      doc: `${DS_LABEL[ds]} · ${res?.name ?? ''}`, period: ym(p), srcType: 'רשות שוק ההון · data.gov.il', note: `WITHDRAWLS, סכום מסלולי ${this.name(g.g)} בחודש ${ym(p)} (REPORT_PERIOD ${p}). הקישור מחזיר את כל המסלולים של החודש` };
  }
  annuityP(s: NSeg): Prov {
    const a = this.a(s);
    return { k: 'calc', est: true, title: `מקדם היוון (a) · ${this.seg(s)}`, value: nf(a, 3), unit: 'שנים מהוונות', formula: 'a(D, ke) = (1 − (1 + ke)^−D) ÷ ke: D שנים של מרווח שנתי, בסוף כל שנה, מהוונות ב-ke',
      inputs: [{ label: 'D (שנים)', v: nf(this.c.D[s], 2), src: () => this.durP(s) }, { label: 'ke', v: pc(this.c.ke, 2), src: this.c.keP }] };
  }

  /* ---------- the NPV ---------- */
  npvP(r: NpvRow, k: 'tr' | 'org'): Prov {
    warmRep(r.c);  // the printed fees and costs behind the margin (phones have no hover)
    const v = this.npv(r, k), m = this.margin(r), label = k === 'tr' ? 'ערך נוכחי של הניוד נטו' : 'ערך נוכחי של הצבירה האורגנית נטו';
    return { k: 'calc', est: true, title: `${label} · ${this.tag(r)}`, value: s1(v), unit: MM,
      formula: `NPV = F × m ÷ 100 × a(D, ke). F = ${k === 'tr' ? 'העברות נטו' : 'צבירה אורגנית נטו (הפקדות פחות משיכות)'} ${isLtm(r.p) ? 'בארבעת הרבעונים' : 'ברבעון'}; m = מרווח תפעולי על נכסים; a = מקדם היוון. רווח תפעולי של המגזר, לפני מס`,
      inputs: [{ label: `F, ${k === 'tr' ? 'ניוד נטו' : 'צבירה אורגנית'} (מיליוני ש"ח)`, v: s1(r[k], 0), src: () => this.flow(r, k) }, { label: 'm, מרווח על נכסים', v: pc(m, 3), src: () => this.marginP(r) },
        { label: 'a(D, ke)', v: nf(this.a(r.s), 3), src: () => this.annuityP(r.s) }],
      note: [m != null && m < 0 ? 'מרווח שלילי: הסימן הפוך לסימן הזרימה' : '', r.mark ?? ''].filter(Boolean).join(' · ') || undefined };
  }
  /** a sum over managers (a KPI), each manager opening its NPV */
  totalP(rows: NpvRow[], k: 'tr' | 'org', s: NSeg, p: string): Prov {
    const t = rows.reduce((x, r) => x + (this.npv(r, k) ?? 0), 0);
    return { k: 'calc', est: true, title: `${k === 'tr' ? 'ערך נוכחי של הניוד' : 'ערך נוכחי של הצבירה האורגנית'}, סך המנהלים · ${this.seg(s)} · ${pl(p)}`, value: s1(t), unit: MM,
      formula: k === 'tr' ? 'Σ NPV של הניוד נטו של המנהלים שיש להם דוח. הניוד נטו של כל השוק קרוב לאפס; הסכום הוא הערך שעבר ממרווח נמוך לגבוה (או להפך)' : 'Σ NPV של הצבירה האורגנית נטו של המנהלים שיש להם דוח',
      inputs: rows.filter((r) => this.npv(r, k) != null).map((r) => ({ label: this.name(r.g), v: s1(this.npv(r, k)), src: () => this.npvP(r, k) })) };
  }
  /** the reader's ke, the valuation page's assumptions (or this view's override) */
  static keDefault(a: Assume, d: FlowNpv): { ke: number; rf: Rf; p: () => Prov } {
    const k = d.meta.ke, rf: Rf = { v: k.rf, month: k.rf_month, url: k.rf_url, retrieved: k.rf_retrieved, code: k.rf_code };
    return { ke: (a.rf ?? rf.v) + a.beta * a.erp, rf, p: () => keProv(a, rf) };
  }
}
/** the months of a quarter's LTM window, for labels: 07/25–06/26 */
export const ltmMonths = (e: number) => `${ym(madd(e, -11))}–${ym(e)}`;
