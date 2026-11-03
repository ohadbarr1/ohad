/** nowcast_f2e.json (pipeline/build_nowcast.py, F2E section, wave 11): flow-to-earnings. The regulator's fee book (Σ assets × fee, plus
 *  Σ deposits × deposit fee) mapped to the reported fee line by each manager's calibrated ratio; the frozen live quarter, the hit-rate
 *  ledger of every past quarter and the ratio's history. Every figure opens to the regulator month or the report page behind it. */
import type { Prov } from './prov';
import { nf } from './format';
import { LensSrc, SEG_LONG, bn, pc, ql, ym, type LensData, type LensRow, type Seg } from './lens';
import { NAME, dmy } from './nowcast';
import { DS_LABEL, ckanQuery, resourceOf, type RegResource } from './sources';
import { useLoad } from './useData';

export type FSeg = 'pen' | 'gem';
export interface FMonth { ym: number; a: number; fee: number; cov: number; R: number }
export interface FDMonth { ym: number; dep: number; depfee: number | null; dcov: number | null; D: number; n?: number }
export interface FHist { q: string; printed: string; fees: number; acc: number; dep: number; imp: number; ratio: number; R: number[]; D: number[]; in_n?: 0 | 1 }
export interface FSegEst { rev: number; lo: number; hi: number; ratio: number; sd: number; acc: number; dep: number; imp: number; months: FMonth[]; dmonths: FDMonth[]; base: FHist[]; ci: number | null; opex: number | null }
export interface FEst { c: string; g: number; q: string; asof: string; segs: Partial<Record<FSeg, FSegEst>>; rev: number; lo: number; hi: number; imp: number; op: number | null; m1_rev: number | null; lag_ok: boolean; scope: 'house' | 'segment'; T_expected?: string | null }
export interface FBt { c: string; q: string; T: string; day: string; rev: number; lo: number; hi: number; imp: number; op: number | null; lag_ok: boolean; act: { rev: number; op: number | null };
  e_rev: number | null; in: 0 | 1; e_opm: number | null; m1_rev: number | null; e_m1: number | null; segs: Partial<Record<FSeg, { rev: number; lo: number; hi: number; ratio: number; sd: number; acc: number; dep: number; imp: number; ci: number | null }>> }
export interface FStat { n: number; mdae: number; mape: number; bias: number; max: number; cover?: number }
export interface F2eData {
  meta: { method: string; draft: true; built_from: { lens: string; regulator_asof: number; last_rep: string; depfee: string };
    depfee: { asof: number; fetched: string; from: number; method: string; src: string; resources: Record<'pensia' | 'gemel', RegResource[]> } };
  params: { F2E_N: number; F2E_SD: number; F2E_Z: number; S2_DAYS: number; PUB_DAY: number; FIRST_TARGET: string };
  cover: string[]; houses: string[]; hist: Record<string, Partial<Record<FSeg, FHist[]>>>;
  ledger: { quarter: string; stage: 2; created_at: string; method_version: string; inputs_hash: string; rows: FEst[] }[];
  score: { c: string; q: string; rev: number; lo: number; hi: number; op: number | null; created_at: string; act: { rev: number; op: number | null } | null; e_rev?: number | null; e_opm?: number | null; in?: 0 | 1 }[];
  backtest: FBt[]; summary: Record<string, { rev: FStat | null; opm: FStat | null; m1: FStat | null }>;
}
export const useF2e = () => useLoad<F2eData>('nowcast_f2e.json');

const m1 = (x: number | null | undefined, d = 1) => (x == null ? '–' : nf(x, d));
const madd = (p: number, k: number) => { const t = Math.floor(p / 100) * 12 + (p % 100 - 1) + k; return Math.floor(t / 12) * 100 + (t % 12) + 1; };
const DS: Record<FSeg, 'pensia' | 'gemel'> = { pen: 'pensia', gem: 'gemel' };

/** every F2E figure opens to its inputs: regulator assets and fee (rebuilt from the tracks), deposits × deposit fee (the regulator's own
 *  query for that month), the reported fee line (report page), and each labelled assumption */
export class F2eSrc {
  private rows = new Map<string, LensRow>();
  constructor(readonly d: F2eData, readonly lens: LensData, readonly src = new LensSrc(lens)) {
    lens.rows.forEach((r) => this.rows.set(`${r.g}|${r.s}|${r.q}`, r));
  }
  private t(c: string, q: string, what: string) { return `${what} · ${NAME[c] ?? c} · ${ql(q)}`; }

  rev(e: FEst): Prov {
    return { k: 'calc', est: true, title: this.t(e.c, e.q, 'אומדן הכנסות מדמי ניהול, זרימה-לרווח'), value: m1(e.rev), unit: 'מיליוני ש"ח, רבעון',
      formula: 'Σ מגזרים: יחס מכויל × הכנסות משתמעות מהרשות', note: `${e.scope === 'segment' ? 'אומדן מגזרי של החברה המנהלת בלבד; אינו רווח הקבוצה. ' : ''}נקבע ${dmy(e.asof)} · שיטה ${this.d.meta.method}`,
      inputs: (Object.keys(e.segs) as FSeg[]).map((s) => ({ label: SEG_LONG[s], v: m1(e.segs[s]!.rev), src: () => this.segRev(e, s) })) };
  }
  range(e: FEst): Prov {
    const z = this.d.params.F2E_Z;
    return { k: 'calc', est: true, title: this.t(e.c, e.q, 'טווח האומדן'), value: `${m1(e.lo)}–${m1(e.hi)}`, unit: 'מיליוני ש"ח',
      formula: `לכל מגזר: הכנסות משתמעות × (יחס מכויל ∓ ${nf(z, 1)} × סטיית התקן של היחס); טווח המנהל = סכום טווחי המגזרים (הנחה: סטיות המגזרים מתואמות לחלוטין, הקריאה הרחבה)`,
      inputs: (Object.keys(e.segs) as FSeg[]).flatMap((s) => { const x = e.segs[s]!; return [
        { label: `${SEG_LONG[s]} · הכנסות משתמעות`, v: m1(x.imp), src: () => this.implied(e, s) },
        { label: `${SEG_LONG[s]} · יחס מכויל`, v: nf(x.ratio, 4), src: () => this.ratio(e, s) },
        { label: `${SEG_LONG[s]} · סטיית תקן של היחס (${x.base.length} רבעונים)`, v: nf(x.sd, 4), src: () => this.ratio(e, s) }]; }) };
  }
  segRev(e: FEst, s: FSeg): Prov {
    const x = e.segs[s]!;
    return { k: 'calc', est: true, title: this.t(e.c, e.q, `אומדן הכנסות · ${SEG_LONG[s]}`), value: m1(x.rev), unit: 'מיליוני ש"ח',
      formula: 'יחס מכויל × הכנסות משתמעות מהרשות',
      inputs: [{ label: 'יחס מכויל (מדווח ÷ משתמע)', v: nf(x.ratio, 4), src: () => this.ratio(e, s) }, { label: 'הכנסות משתמעות, רשות', v: m1(x.imp), src: () => this.implied(e, s) }] };
  }
  ratio(e: FEst, s: FSeg): Prov {
    const x = e.segs[s]!, p = this.d.params;
    return { k: 'calc', est: true, title: this.t(e.c, e.q, `יחס מכויל · ${SEG_LONG[s]}`), value: nf(x.ratio, 4),
      formula: `ממוצע ${p.F2E_N} היחסים האחרונים שפורסמו לפני ${dmy(e.asof)} (הנחה). יחס = הכנסות מדמי ניהול בדוח ÷ הכנסות משתמעות מהרשות באותו רבעון. סטיית תקן: עד ${p.F2E_SD} רבעונים`,
      inputs: x.base.map((b) => ({ label: `${ql(b.q)} · פורסם ${dmy(b.printed)}${b.in_n ? ' · בממוצע' : ''}`, v: nf(b.ratio, 4), src: () => this.histRatio(e.c, e.g, s, b) })) };
  }
  /** one printed quarter's ratio: the report's fee line over the regulator-implied fees of that quarter */
  histRatio(c: string, g: number, s: FSeg, b: FHist): Prov {
    const r = this.rows.get(`${g}|${s}|${b.q}`);
    return { k: 'calc', title: this.t(c, b.q, `יחס מדווח ÷ משתמע · ${SEG_LONG[s]}`), value: nf(b.ratio, 4),
      formula: 'הכנסות מדמי ניהול בדוח ÷ (דמי ניהול מצבירה משתמעים + דמי ניהול מהפקדה משתמעים)',
      inputs: [{ label: `הכנסות מדמי ניהול בדוח · ${ql(b.q)}`, v: m1(b.fees), src: r ? () => this.src.rep(r, 'fees', 'q') : undefined },
        { label: 'דמי ניהול מצבירה, משתמע (רשות)', v: m1(b.acc), src: () => this.histAcc(c, g, s, b) },
        { label: 'דמי ניהול מהפקדה, משתמע (רשות)', v: m1(b.dep), src: () => this.histDep(c, s, b) }] };
  }
  private months(q: string) { const e = Number(q.slice(3)) * 100 + Number(q[1]) * 3; return [madd(e, -3), madd(e, -2), madd(e, -1), e]; }
  histAcc(c: string, g: number, s: FSeg, b: FHist): Prov {
    return { k: 'calc', title: this.t(c, b.q, `דמי ניהול מצבירה, משתמע · ${SEG_LONG[s]}`), value: m1(b.acc), unit: 'מיליוני ש"ח',
      formula: '(R₀ ÷ 2 + R₁ + R₂ + R₃ ÷ 2) ÷ 12, R = Σ מסלולים נכסים × דמי ניהול ÷ 100 (שיעור שנתי). הנכסים ודמי הניהול הממוצעים נפתחים למסלולים',
      inputs: this.months(b.q).map((p, i) => ({ label: `R · ${ym(p)}`, v: m1(b.R[i], 2), src: () => ({ k: 'calc', title: this.t(c, b.q, `R · ${ym(p)}`), value: m1(b.R[i], 2), unit: 'מיליוני ש"ח בשנה',
        formula: 'נכסים × דמי ניהול ממוצעים משוקללים ÷ 100', inputs: [
          { label: `נכסים · ${ym(p)}`, v: '', src: () => this.src.reg('assets', p, 'm', s as Seg, g, '', 'מיליארד ש"ח') },
          { label: `דמי ניהול ממוצעים · ${ym(p)}`, v: '', src: () => this.src.reg('fee', p, 'm', s as Seg, g, '', 'אחוז') }] }) as Prov })) };
  }
  histDep(c: string, s: FSeg, b: FHist): Prov {
    const ds = DS[s], res = this.d.meta.depfee.resources[ds];
    return { k: 'calc', title: this.t(c, b.q, `דמי ניהול מהפקדה, משתמע · ${SEG_LONG[s]}`), value: m1(b.dep), unit: 'מיליוני ש"ח',
      formula: 'Σ חודשי הרבעון: Σ מסלולי הקבוצה הפקדות × AVG_DEPOSIT_FEE ÷ 100', note: `${DS_LABEL[ds]}, data.gov.il; הקובץ nowcast_depfee.json`,
      inputs: this.months(b.q).slice(1).map((p, i) => { const rr = resourceOf(res, p); return { label: ym(p), v: m1(b.D[i], 2),
        src: rr ? () => ({ k: 'report', title: `${DS_LABEL[ds]} · ${ym(p)} · הפקדות ודמי ניהול מהפקדה`, value: m1(b.D[i], 2), unit: 'מיליוני ש"ח',
          url: ckanQuery(rr.id, { REPORT_PERIOD: p }, ['FUND_ID', 'FUND_NAME', 'MANAGING_CORPORATION', 'DEPOSITS', 'AVG_DEPOSIT_FEE']), pg: null, doc: `${rr.name} (data.gov.il)`, srcType: 'רשות שוק ההון' }) as Prov : undefined }; }) };
  }
  implied(e: FEst, s: FSeg): Prov {
    const x = e.segs[s]!;
    return { k: 'calc', title: this.t(e.c, e.q, `הכנסות משתמעות מהרשות · ${SEG_LONG[s]}`), value: m1(x.imp), unit: 'מיליוני ש"ח',
      formula: 'דמי ניהול מצבירה + דמי ניהול מהפקדה, מספרי הרשות ברמת המסלול',
      inputs: [{ label: 'מצבירה', v: m1(x.acc), src: () => this.acc(e, s) }, { label: 'מהפקדה', v: m1(x.dep), src: () => this.dep(e, s) }] };
  }
  acc(e: FEst, s: FSeg): Prov {
    const x = e.segs[s]!, g = e.g;
    return { k: 'calc', title: this.t(e.c, e.q, `דמי ניהול מצבירה, משתמע · ${SEG_LONG[s]}`), value: m1(x.acc), unit: 'מיליוני ש"ח',
      formula: '(R₀ ÷ 2 + R₁ + R₂ + R₃ ÷ 2) ÷ 12, R = נכסים × דמי ניהול ממוצעים משוקללים ÷ 100 (שיעור שנתי, מיליוני ש"ח). R₀ = סוף הרבעון הקודם. מסלולים בלי דמי ניהול מפורסמים: הנחה, ממוצע הקבוצה',
      inputs: x.months.flatMap((m) => [
        { label: `נכסים · ${ym(m.ym)} (מיליארד)`, v: bn(m.a, 2), src: () => this.src.reg('assets', m.ym, 'm', s as Seg, g, bn(m.a, 2), 'מיליארד ש"ח') },
        { label: `דמי ניהול ממוצעים · ${ym(m.ym)}${m.cov < 99.95 ? ` (כיסוי ${nf(m.cov, 1)}%)` : ''}`, v: pc(m.fee, 3), src: () => this.src.reg('fee', m.ym, 'm', s as Seg, g, pc(m.fee, 3), 'אחוז') }]) };
  }
  dep(e: FEst, s: FSeg): Prov {
    const x = e.segs[s]!, ds = DS[s], res = this.d.meta.depfee.resources[ds];
    return { k: 'calc', title: this.t(e.c, e.q, `דמי ניהול מהפקדה, משתמע · ${SEG_LONG[s]}`), value: m1(x.dep), unit: 'מיליוני ש"ח',
      formula: 'Σ חודשי הרבעון: Σ מסלולי הקבוצה הפקדות × דמי ניהול ממוצעים מהפקדה (AVG_DEPOSIT_FEE) ÷ 100; מסלולים בלי שיעור מפורסם: הנחה, ממוצע הקבוצה',
      note: `${DS_LABEL[ds]}, data.gov.il: הקישור פותח את רשומות החודש במקור. הקובץ: nowcast_depfee.json (${this.d.meta.depfee.fetched})`,
      inputs: x.dmonths.map((m) => { const rr = resourceOf(res, m.ym); return { label: `${ym(m.ym)}: הפקדות ${m1(m.dep)} × ${m.depfee == null ? '–' : pc(m.depfee, 2)}${m.dcov != null && m.dcov < 99.95 ? ` (כיסוי ${nf(m.dcov, 1)}%)` : ''}`, v: m1(m.D, 2),
        src: rr ? () => ({ k: 'report', title: `${DS_LABEL[ds]} · ${ym(m.ym)} · הפקדות ודמי ניהול מהפקדה`, value: m1(m.D, 2), unit: 'מיליוני ש"ח', url: ckanQuery(rr.id, { REPORT_PERIOD: m.ym }, ['FUND_ID', 'FUND_NAME', 'MANAGING_CORPORATION', 'DEPOSITS', 'AVG_DEPOSIT_FEE']),
          pg: null, doc: `${rr.name} (data.gov.il)`, srcType: 'רשות שוק ההון', note: 'סכום על מסלולי הקבוצה (שיוך לפי החברה המנהלת, כמו בכל האתר)' }) as Prov : undefined }; }) };
  }
  op(e: FEst): Prov {
    return { k: 'calc', est: true, title: this.t(e.c, e.q, 'אומדן רווח תפעולי מגזרי, זרימה-לרווח'), value: m1(e.op), unit: 'מיליוני ש"ח, רבעון',
      formula: 'Σ מגזרים: הכנסות באומדן × (1 − הוצאות להכנסות). הוצאות להכנסות: מהדוחות בלבד (4 רבעונים אחרונים, שיווק ומכירה + הנהלה וכלליות ÷ הכנסות, עונתיות Q4 כמו באומדן M1)',
      note: e.scope === 'segment' ? 'אומדן מגזרי בלבד; אינו רווח הקבוצה ואינו רווח למניה' : undefined,
      inputs: (Object.keys(e.segs) as FSeg[]).flatMap((s) => [{ label: `הכנסות · ${SEG_LONG[s]}`, v: m1(e.segs[s]!.rev), src: () => this.segRev(e, s) },
        { label: `הוצאות להכנסות · ${SEG_LONG[s]} (מהדוחות)`, v: pc(e.segs[s]!.ci == null ? null : e.segs[s]!.ci! * 100, 2) }]) };
  }
  /** the reported fee line of the same segments, each opening to its report page */
  actual(c: string, g: number, q: string, segs: string[], v: number): Prov {
    return { k: 'calc', title: `הכנסות מדמי ניהול, בפועל · ${NAME[c] ?? c} · ${ql(q)}`, value: m1(v), unit: 'מיליוני ש"ח', formula: 'סכום המגזרים, מהדוח',
      inputs: segs.map((s) => { const r = this.rows.get(`${g}|${s}|${q}`); return { label: SEG_LONG[s as Seg], v: m1(r?.rep?.fees), src: r ? () => this.src.rep(r, 'fees', 'q') : undefined }; }) };
  }
  /** a backtest row as of its stage day */
  bt(b: FBt): Prov {
    return { k: 'calc', est: true, title: `בדיקה לאחור · ${NAME[b.c]} · ${ql(b.q)} · ${dmy(b.day)}`, value: m1(b.rev), unit: 'מיליוני ש"ח',
      formula: 'אותה שיטה, מהנתונים שפורסמו עד יום השלב (דוחות שפורסמו קודם לכן; חודשי הרשות של הרבעון)',
      note: b.lag_ok ? undefined : `ביום השלב הנומינלי חודש הרשות האחרון עוד לא פורסם (הנחת פרסום: היום ה-${this.d.params.PUB_DAY} בחודש M+2)`,
      inputs: (Object.keys(b.segs) as FSeg[]).flatMap((s) => { const z = b.segs[s]!; return [
        { label: `${SEG_LONG[s]} · הכנסות משתמעות`, v: m1(z.imp) }, { label: `${SEG_LONG[s]} · יחס מכויל`, v: nf(z.ratio, 4) },
        { label: `${SEG_LONG[s]} · טווח`, v: `${m1(z.lo)}–${m1(z.hi)}` }]; }) };
  }
}
