import type { Prov } from './prov';
import type { Fund, FundHist } from './useData';
import { nf, sn } from './format';

/* fox fund rating: a published, reproducible score. Every input is a regulator figure of the track or of its category peers.
   It is fox's methodology, not advice. */
export const RATING_NOTE = 'שיטת fox: ציון יחסי בתוך הקטגוריה מנתוני הרשות. אינו המלצה ואינו ייעוץ השקעות.';
interface Comp { key: 'sharpe' | 'ret' | 'cons' | 'fee'; label: string; w: number; lower?: boolean; get: (f: Fund) => number | null; show: (v: number) => string; col: string }
export const COMPS: Comp[] = [
  { key: 'sharpe', label: 'תשואה מותאמת סיכון (שארפ)', w: 35, get: (f) => (f.sd != null && f.sd > 0 ? f.sharpe : null), show: (v) => nf(v, 2), col: 'SHARPE_RATIO' },
  { key: 'ret', label: 'תשואה שנתית ממוצעת, 5Y (או 3Y)', w: 25, get: (f) => f.a5 ?? f.a3, show: (v) => `${nf(v, 2)}%`, col: 'AVG_ANNUAL_YIELD_TRAILING_5YRS / 3YRS' },
  { key: 'cons', label: 'עקביות: שנים ברבע העליון', w: 20, get: (f) => (f.yrs != null && f.yrs >= 3 ? f.top! / f.yrs : null), show: (v) => `${nf(v * 100, 0)}%`, col: 'מחושב מתשואות חודשיות' },
  { key: 'fee', label: 'דמי ניהול מצבירה (נמוך עדיף)', w: 20, lower: true, get: (f) => f.fee, show: (v) => `${nf(v, 2)}%`, col: 'AVG_ANNUAL_MANAGEMENT_FEE' },
];
export const RATING_FORMULA = 'ציון = Σ (משקל × אחוזון) ÷ Σ משקלים, על הרכיבים הזמינים. אחוזון רכיב = 100 × (מספר המסלולים בקטגוריה עם ערך גרוע יותר + חצי מהשווים) ÷ (n − 1). משקלים: שארפ 35, תשואה 5Y (3Y כשאין 5Y, ומול מסלולים עם אותו חלון) 25, עקביות 20, דמי ניהול 20. נדרשים 36 חודשי היסטוריה, 5 מסלולים לפחות עם נתון בכל רכיב, ו-3 רכיבים לפחות (אחד מהם שארפ או תשואה). דרגה: 80+ = 5, 60+ = 4, 40+ = 3, 20+ = 2, אחרת 1';

export interface Rating { score: number | null; band: number | null; why?: string; parts: { c: Comp; v: number | null; p: number | null; n: number; worse: number; ties: number }[] }

/** the rating of one track among its category peers (same product and track, as the table ranks them) */
export function rate(f: Fund, peers: Fund[]): Rating {
  const parts = COMPS.map((c) => {
    // the return component compares like with like: 5Y against 5Y, else 3Y against 3Y
    const get = c.key === 'ret' ? (f.a5 != null ? (x: Fund) => x.a5 : (x: Fund) => x.a3) : c.get;
    const v = get(f), vals = peers.filter((x) => x.k !== f.k).map(get).filter((x): x is number => x != null);
    if (v == null || vals.length < 4) return { c, v, p: null, n: vals.length + (v == null ? 0 : 1), worse: 0, ties: 0 };
    const worse = vals.filter((x) => (c.lower ? x > v : x < v)).length, ties = vals.filter((x) => x === v).length;
    return { c, v, p: (100 * (worse + ties / 2)) / vals.length, n: vals.length + 1, worse, ties };
  });
  const have = parts.filter((x) => x.p != null);
  if (f.n < 36) return { score: null, band: null, why: `נדרשים 36 חודשי היסטוריה (למסלול ${f.n})`, parts };
  if (have.length < 3 || !have.some((x) => x.c.key === 'sharpe' || x.c.key === 'ret')) return { score: null, band: null, why: 'פחות משלושה רכיבים עם 5 מסלולים לפחות בקטגוריה', parts };
  const score = have.reduce((t, x) => t + x.c.w * x.p!, 0) / have.reduce((t, x) => t + x.c.w, 0);
  return { score, band: score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1, parts };
}

/** the score as a figure with its formula and every component, each component opening its own calculation */
export function ratingProv(f: Fund, r: Rating, srcOf: (c: Comp['key']) => (() => Prov) | undefined): Prov {
  if (r.score == null) return { k: 'none', title: `דירוג fox · ${f.name}`, why: r.why ?? 'לא דורג' };
  return { k: 'calc', title: `דירוג fox · ${f.name}`, value: `${nf(r.score, 0)} · ${r.band}/5`, formula: RATING_FORMULA, note: RATING_NOTE,
    inputs: r.parts.map((x) => ({ label: `${x.c.label} · משקל ${x.c.w}`, v: x.p == null ? '–' : `אחוזון ${nf(x.p, 0)}`,
      src: x.p == null ? undefined : (): Prov => ({ k: 'calc', title: `אחוזון · ${x.c.label} · ${f.name}`, value: nf(x.p!, 0), formula: `100 × (גרועים + חצי מהשווים) ÷ (n − 1)${x.c.lower ? '. נמוך יותר = טוב יותר' : ''}`,
        inputs: [{ label: `ערך המסלול (${x.c.col})`, v: x.c.show(x.v!), src: srcOf(x.c.key) }, { label: 'מסלולים בקטגוריה עם נתון (n)', v: nf(x.n, 0) }, { label: 'גרועים מהמסלול', v: nf(x.worse, 0) }, { label: 'שווים לו', v: nf(x.ties, 0) }] }) })) };
}

/* ---------- crises: drawdown and recovery from the track's own monthly returns ---------- */
export const CRISES: { key: string; label: string; base: number; to: number }[] = [
  { key: 'gfc', label: 'משבר 2008', base: 200712, to: 200906 },
  { key: 'covid', label: 'קורונה 2020', base: 202001, to: 202012 },
  { key: 'rates', label: 'ריבית 2022', base: 202112, to: 202212 },
  { key: 'war', label: 'מלחמה 10/23', base: 202309, to: 202403 },
];
export const CRISIS_FORMULA = 'מדד = מכפלת (1 + תשואה חודשית) מסוף חודש הבסיס. ירידה = השפל בחלון ÷ המדד בבסיס, פחות 1. התאוששות = חודשים מהשפל עד שהמדד חוזר לרמת הבסיס';
export interface Crisis { dd: number; trough: number; rec: number | null; months: number[] }
const next = (p: number) => (p % 100 === 12 ? (Math.floor(p / 100) + 1) * 100 + 1 : p + 1);
/** drawdown from the base month to the trough inside the window, and months from the trough until the base level is regained */
export function crisis(s: { p: number[]; y: (number | null)[] }, base: number, to: number): Crisis | null {
  const at = new Map(s.p.map((p, i) => [p, s.y[i]]));
  if (!s.p.includes(base) && !(s.p[0] < base)) return null;
  let idx = 1, low = 1, trough = base, p = next(base);
  const months: number[] = [];
  for (; p <= to; p = next(p)) { const r = at.get(p); if (r == null) return null; months.push(p); idx *= 1 + r / 100; if (idx < low) { low = idx; trough = p; } }
  if (trough === base) return { dd: 0, trough, rec: 0, months };
  // recovery: carry on from the trough
  idx = 1; let q = next(base), rec: number | null = null, k = 0;
  for (; at.has(q); q = next(q)) { const r = at.get(q); if (r == null) break; idx *= 1 + r / 100; if (q > trough) { k++; if (idx >= 1) { rec = k; break; } } if (q > trough) months.push(q); }
  return { dd: (low - 1) * 100, trough, rec, months: [...new Set(months)].sort((a, b) => a - b) };
}
export const ddText = (c: Crisis | null) => (c == null ? '–' : `${sn(c.dd, 1)}%`);
export type { FundHist };
