/** nowcast.json (pipeline/build_nowcast.py, module M1, UNPUBLISHED): frozen estimates, the scorecard and the backtest, and the
 *  provenance of every estimate down to the regulator month and the report page (through lens.json's sources, lib/lens.ts). */
import type { Prov } from './prov';
import { nf } from './format';
import { LensSrc, SEG_LONG, bn, pc, ql, ym, type LensData, type LensRow, type Seg } from './lens';
import { useLoad } from './useData';

export type NcSegKey = 'pen' | 'gem';
export interface NcMonth { ym: number; a: number; est?: 1; flow?: number; flows?: { ym: number; v: number | null }[] }
export interface NcBase { q: string; printed: string; fees: number; sm: number | null; ga: number | null; avg: number; fy: number; in4: 0 | 1 }
export interface NcSeg {
  rev: number; opex: number | null; yld: number; y_tr: number; slope: number; drift: number; avg: number; months: NcMonth[]; base: NcBase[];
  ci_base: number | null; ci: number | null; k: number; ks: { y: number; k: number }[];
}
export interface NcNostro { bal: number; date: string; period: string; rid: number | null; url?: string | null; printed: string; parts: { l: string; v: number; pg: number | null }[]; rate: number; est: number }
export interface NcEst {
  c: string; g: number; q: string; stage: 1 | 2; asof: string; segs: Partial<Record<NcSegKey, NcSeg>>; rev: number; op: number | null; lag_ok: boolean;
  nostro?: NcNostro; op_whole?: number; T_expected: string | null; nominal_day: string | null; scope: 'house' | 'segment';
}
export interface NcLedger { quarter: string; stage: 1 | 2; created_at: string; method_version: string; inputs_hash: string; rows: NcEst[] }
export interface NcErr { e_rev: number | null; e_op: number | null; e_opm: number | null }
export interface NcStageBt extends Partial<NcErr> {
  day: string; rev: number; op: number | null; lag_ok: boolean;
  segs: Partial<Record<NcSegKey, { rev: number; opex: number | null; yld: number; y_tr: number; drift: number; avg: number; ci: number | null; k: number }>>;
  lens: ({ rev: number; op: number | null } & Partial<NcErr>) | null;
}
export interface NcBt { c: string; q: string; T: string; s1: NcStageBt; s2?: NcStageBt; act: { rev: number; op: number | null }; rev_s1s2?: number | null }
export interface NcStat { n: number; mape: number; bias: number; max: number }
export interface NcStageSum { rev: NcStat | null; op: NcStat | null; opm: NcStat | null; lens_rev: NcStat | null; lens_op: NcStat | null; lens_opm: NcStat | null }
export interface NcScore { c: string; q: string; act: { rev: number; op: number | null } | null; rev_s1s2?: number | null;
  s1?: ({ rev: number; op: number | null; created_at: string } & Partial<NcErr>) | null; s2?: ({ rev: number; op: number | null; created_at: string } & Partial<NcErr>) | null }
export interface NowcastData {
  meta: { method: string; draft: true; built_from: { lens: string; regulator_asof: number; last_rep: string }; live: { q: string; stage: 1 | 2 | null } };
  params: { S1_DAYS: number; S2_DAYS: number; PUB_DAY: number; DRIFT_DAMP: number; DRIFT_H: number; K_LO: number; K_HI: number; MIN_BASE: number };
  cover: string[]; houses: string[]; abstain: Record<string, string>; not_covered: Record<string, string>;
  ledger: NcLedger[]; score: NcScore[]; backtest: NcBt[]; summary: Record<string, { s1: NcStageSum; s2: NcStageSum; rev_s1s2: NcStat | null }>;
}
export const useNowcast = () => useLoad<NowcastData>('nowcast.json');

export const NAME: Record<string, string> = {
  harel: 'הראל', migdal: 'מגדל', clal: 'כלל', menora: 'מנורה', meitav: 'מיטב', altshuler: 'אלטשולר', more: 'מור', analyst: 'אנליסט', yelin: 'ילין', phoenix: 'הפניקס', ibi: 'IBI',
};
/** "2026-11-20" -> "20.11.26" */
export const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : '–');
const m1 = (x: number | null | undefined, d = 1) => (x == null ? '–' : nf(x, d));

/** every estimate opens to its inputs: regulator dataset + month, report page, and each labelled assumption */
export class NcSrc {
  private rows = new Map<string, LensRow>();
  constructor(readonly d: NowcastData, readonly lens: LensData, readonly src = new LensSrc(lens)) {
    lens.rows.forEach((r) => this.rows.set(`${r.g}|${r.s}|${r.q}`, r));
  }
  row(g: number, s: Seg, q: string) { return this.rows.get(`${g}|${s}|${q}`); }
  title(e: NcEst, what: string) { return `${what} · ${NAME[e.c] ?? e.c} · ${ql(e.q)} · שלב ${e.stage}`; }

  rev(e: NcEst): Prov {
    return { k: 'calc', est: true, title: this.title(e, 'אומדן הכנסות מדמי ניהול, פנסיה וגמל'), value: m1(e.rev), unit: 'מיליוני ש"ח, רבעון',
      formula: 'סכום המגזרים', note: `${e.scope === 'segment' ? 'אומדן מגזרי של החברה המנהלת בלבד; אינו רווח הקבוצה. ' : ''}קפוא ${dmy(e.asof)} · שיטה ${this.d.meta.method}`,
      inputs: (Object.keys(e.segs) as NcSegKey[]).map((s) => ({ label: SEG_LONG[s], v: m1(e.segs[s]!.rev), src: () => this.segRev(e, s) })) };
  }
  segRev(e: NcEst, s: NcSegKey): Prov {
    const x = e.segs[s]!;
    return { k: 'calc', est: true, title: this.title(e, `אומדן הכנסות · ${SEG_LONG[s]}`), value: m1(x.rev), unit: 'מיליוני ש"ח',
      formula: 'תשואת דמי ניהול ÷ 100 × נכסים ממוצעים × 3 ÷ 12',
      inputs: [{ label: 'תשואת דמי ניהול, שנתי', v: pc(x.yld, 3), src: () => this.yld(e, s) }, { label: 'נכסים ממוצעים ברבעון (מיליארד)', v: bn(x.avg, 2), src: () => this.avg(e, s) }] };
  }
  yld(e: NcEst, s: NcSegKey): Prov {
    const x = e.segs[s]!, p = this.d.params;
    return { k: 'calc', est: true, title: this.title(e, `תשואת דמי ניהול · ${SEG_LONG[s]}`), value: pc(x.yld, 3), unit: 'שנתי',
      formula: 'תשואה ממומשת ב-4 הרבעונים האחרונים שפורסמו + סחף',
      inputs: [{ label: 'תשואה ממומשת, 4 רבעונים', v: pc(x.y_tr, 3), src: () => this.trailing(e, s) },
        { label: 'סחף (הנחה)', v: pc(x.drift, 4), src: () => ({ k: 'calc', est: true, title: this.title(e, `סחף בתשואה · ${SEG_LONG[s]}`), value: pc(x.drift, 4),
          formula: `הנחה: ${nf(p.DRIFT_DAMP, 1)} × שיפוע OLS של התשואה הרבעונית (${x.base.length} רבעונים) × ${nf(p.DRIFT_H, 1)} רבעונים (ממרכז החלון לרבעון היעד). שיפוע: ${nf(x.slope, 5)} לרבעון`,
          inputs: x.base.map((b) => ({ label: `תשואה · ${ql(b.q)}`, v: pc(b.fy, 3), src: this.lensFn(e.g, s, b.q, (r) => this.src.fyReg(r)) })) }) }] };
  }
  trailing(e: NcEst, s: NcSegKey): Prov {
    const x = e.segs[s]!, b4 = x.base.filter((b) => b.in4);
    return { k: 'calc', title: this.title(e, `תשואה ממומשת, 4 רבעונים · ${SEG_LONG[s]}`), value: pc(x.y_tr, 3), unit: 'שנתי',
      formula: 'Σ הכנסות מדמי ניהול (דוחות) × 4 ÷ Σ נכסים ממוצעים (רשות) × 100. רק רבעונים שפורסמו לפני יום האומדן',
      inputs: b4.flatMap((b) => [
        { label: `הכנסות · ${ql(b.q)} · פורסם ${dmy(b.printed)}`, v: m1(b.fees), src: this.lensFn(e.g, s, b.q, (r) => this.src.rep(r, 'fees', 'q')) },
        { label: `נכסים ממוצעים · ${ql(b.q)} (מיליארד)`, v: bn(b.avg, 2), src: this.lensFn(e.g, s, b.q, (r) => this.src.avgP(r)) }]) };
  }
  avg(e: NcEst, s: NcSegKey): Prov {
    const x = e.segs[s]!;
    return { k: 'calc', est: e.stage === 1, title: this.title(e, `נכסים ממוצעים · ${SEG_LONG[s]}`), value: bn(x.avg, 2), unit: 'מיליארד ש"ח',
      formula: '(A₀ ÷ 2 + A₁ + A₂ + A₃ ÷ 2) ÷ 3: טרפז על ארבעה סופי חודש, רשות שוק ההון' + (e.stage === 1 ? '. A₃ באומדן' : ''),
      inputs: x.months.map((m) => m.est
        ? { label: `נכסים · ${ym(m.ym)} (אומדן)`, v: bn(m.a, 2), src: () => this.a3(e, s, m, x.months[2]) }
        : { label: `נכסים · ${ym(m.ym)}`, v: bn(m.a, 2), src: () => this.src.reg('assets', m.ym, 'm', s, e.g, bn(m.a, 2), 'מיליארד ש"ח', `נכסים · ${NAME[e.c]} · ${SEG_LONG[s]} · ${ym(m.ym)}`) }) };
  }
  a3(e: NcEst, s: NcSegKey, m: NcMonth, a2: NcMonth): Prov {
    return { k: 'calc', est: true, title: this.title(e, `נכסים · ${ym(m.ym)} · אומדן`), value: bn(m.a, 2), unit: 'מיליארד ש"ח',
      formula: 'הנחה: A₃ = A₂ + ממוצע הצבירה נטו (צבירה אורגנית + העברות נטו) של חודשים 1–2. אין תשואת שוק בחודש 3',
      inputs: [{ label: `נכסים · ${ym(a2.ym)}`, v: bn(a2.a, 2), src: () => this.src.reg('assets', a2.ym, 'm', s, e.g, bn(a2.a, 2), 'מיליארד ש"ח') },
        ...(m.flows ?? []).map((f) => ({ label: `צבירה נטו · ${ym(f.ym)}`, v: f.v == null ? 'לא פורסם' : bn(f.v, 2), src: () => this.src.reg('netflow', f.ym, 'm', s, e.g, bn(f.v, 2), 'מיליארד ש"ח') }))] };
  }
  op(e: NcEst): Prov {
    return { k: 'calc', est: true, title: this.title(e, 'אומדן רווח תפעולי מגזרי'), value: m1(e.op), unit: 'מיליוני ש"ח, רבעון',
      formula: 'הכנסות באומדן − הוצאות באומדן (שיווק ומכירה + הנהלה וכלליות), סכום המגזרים. אותה הגדרה כמו הרווח המגזרי בדוח',
      note: e.scope === 'segment' ? 'אומדן מגזרי בלבד; אינו רווח הקבוצה ואינו רווח למניה' : undefined,
      inputs: (Object.keys(e.segs) as NcSegKey[]).flatMap((s) => [
        { label: `הכנסות · ${SEG_LONG[s]}`, v: m1(e.segs[s]!.rev), src: () => this.segRev(e, s) },
        { label: `הוצאות · ${SEG_LONG[s]}`, v: m1(e.segs[s]!.opex), src: () => this.opex(e, s) }]) };
  }
  opex(e: NcEst, s: NcSegKey): Prov {
    const x = e.segs[s]!, b4 = x.base.filter((b) => b.in4), q4 = e.q.startsWith('Q4');
    return { k: 'calc', est: true, title: this.title(e, `אומדן הוצאות · ${SEG_LONG[s]}`), value: m1(x.opex), unit: 'מיליוני ש"ח',
      formula: `הכנסות באומדן × הוצאות להכנסות. הוצאות להכנסות = Σ(שיווק + הנהלה) ÷ Σ(הכנסות × s), s = 1 ב-Q1–Q3 ו-k ב-Q4${q4 ? '; רבעון היעד Q4: × k' : ''}`,
      inputs: [{ label: 'הכנסות באומדן', v: m1(x.rev), src: () => this.segRev(e, s) }, { label: 'הוצאות להכנסות', v: pc(x.ci == null ? null : x.ci * 100, 2) },
        { label: `k, עונתיות Q4 (הנחה; ${x.ks.length ? x.ks.map((z) => `FY'${String(z.y).slice(2)} ${nf(z.k, 3)}`).join(', ') : 'אין שנה מלאה: 1'})`, v: nf(x.k, 3) },
        ...b4.flatMap((b) => [
          { label: `שיווק ומכירה · ${ql(b.q)}`, v: m1(b.sm), src: this.lensFn(e.g, s, b.q, (r) => this.src.rep(r, 'sm', 'q')) },
          { label: `הנהלה וכלליות · ${ql(b.q)}`, v: m1(b.ga), src: this.lensFn(e.g, s, b.q, (r) => this.src.rep(r, 'ga', 'q')) },
          { label: `הכנסות · ${ql(b.q)}`, v: m1(b.fees), src: this.lensFn(e.g, s, b.q, (r) => this.src.rep(r, 'fees', 'q')) }])] };
  }
  nostro(e: NcEst): Prov {
    const n = e.nostro!;
    return { k: 'calc', est: true, title: this.title(e, 'אומדן הכנסות נוסטרו'), value: m1(n.est), unit: 'מיליוני ש"ח, רבעון',
      formula: 'הנחה: נכסים פיננסיים של הנוסטרו × ריבית בנק ישראל ביום האומדן ÷ 4 (תשואה מנורמלת, ללא רווחי או הפסדי שערוך). לא נמדד מול בפועל',
      inputs: [...n.parts.map((p) => ({ label: `${p.l} · ${dmy(n.date)}`, v: m1(p.v), src: () => ({ k: 'report', title: p.l, value: m1(p.v), unit: 'מיליוני ש"ח', url: n.url ?? null, pg: p.pg,
        doc: `דוח ${n.period.endsWith('FY') ? 'שנתי' : 'רבעוני'} ${NAME[e.c]}`, period: dmy(n.date), srcType: 'דוח כספי' }) as Prov })),
        { label: `ריבית בנק ישראל ביום ${dmy(e.asof)}`, v: `${nf(n.rate, 2)}%`, src: () => ({ k: 'report', title: 'ריבית בנק ישראל', value: `${nf(n.rate, 2)}%`, url: 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BR/1.0/MNT_RIB_BOI_D?startperiod=2019-01-01&format=csv', pg: null, doc: 'בנק ישראל, סדרה MNT_RIB_BOI_D', srcType: 'בנק ישראל' }) as Prov }] };
  }
  /** the reported actual of the same segments */
  actual(c: string, g: number, q: string, segs: string[], metric: 'fees' | 'op', v: number | null): Prov {
    return { k: 'calc', title: `${metric === 'fees' ? 'הכנסות מדמי ניהול' : 'רווח תפעולי מגזרי'}, בפועל · ${NAME[c]} · ${ql(q)}`, value: m1(v), unit: 'מיליוני ש"ח', formula: 'סכום המגזרים, מהדוח',
      inputs: segs.map((s) => ({ label: SEG_LONG[s as Seg], v: '', src: this.lensFn(g, s as Seg, q, (r) => this.src.rep(r, metric, 'q')) })) };
  }
  /** a backtest estimate: the per-segment inputs as of its stage day */
  bt(b: NcBt, st: 's1' | 's2'): Prov {
    const x = b[st]!;
    return { k: 'calc', est: true, title: `בדיקה לאחור · ${NAME[b.c]} · ${ql(b.q)} · שלב ${st === 's1' ? 1 : 2} · ${dmy(x.day)}`, value: m1(x.rev), unit: 'מיליוני ש"ח',
      formula: 'אותה שיטה, מהנתונים שפורסמו עד יום השלב (דוחות שפורסמו קודם לכן; חודשי רשות עד חודש השלב)',
      note: x.lag_ok ? undefined : 'ביום השלב הנומינלי חודש הרשות האחרון עוד לא פורסם (הנחת פרסום: היום ה-9 בחודש M+2)',
      inputs: (Object.keys(x.segs) as NcSegKey[]).flatMap((s) => { const z = x.segs[s]!; return [
        { label: `${SEG_LONG[s]} · תשואה`, v: pc(z.yld, 3) }, { label: `${SEG_LONG[s]} · נכסים ממוצעים (מיליארד)`, v: bn(z.avg, 2) },
        { label: `${SEG_LONG[s]} · הכנסות`, v: m1(z.rev) }, { label: `${SEG_LONG[s]} · הוצאות להכנסות`, v: pc(z.ci == null ? null : z.ci * 100, 2) }]; }) };
  }
  private lensFn(g: number, s: Seg, q: string, f: (r: LensRow) => Prov): (() => Prov) | undefined {
    const r = this.row(g, s, q);
    return r ? () => f(r) : undefined;
  }
}
