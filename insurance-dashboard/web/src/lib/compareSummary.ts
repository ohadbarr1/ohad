/* W1 · agent door: the bottom line of a head-to-head, descriptive, not advice (W4: no crowning across categories).
   A comparison is made only inside one category (the same product and the same investment track, `cat`): the lowest fee (each fee on
   its own, average actual), the highest 5Y return with the section's tie band (a gap under 10bp a year is shared, so nothing is singled
   out inside it), and the highest Sharpe as published. Tracks of different categories carry different risk: across them the summary
   reports each track's own figures and its equity exposure, never which is higher (`cross`). Old-generation managers' insurance
   (policies sold 1990-2003, `old`) has guarantees no return or fee figure shows, so its tracks are kept out of every comparison line.
   A fee or a Sharpe ratio ties at its published precision (2 dp). Tracks with no value for a measure are left out of it and counted.
   Pure (no React). */
import { TIE_BP, tieRanks } from './fundsTie';

export interface CmpIn {
  k: string; name: string; prod: string; fee: number | null; depfee: number | null; r5: number | null; sharpe: number | null;
  /** the category (product | track); defaults to the product */
  cat?: string; track?: string;
  /** equity exposure, % of assets */
  st?: number | null;
  /** an old-generation managers' insurance track (1990-2003) */
  old?: boolean;
}
export interface Lead { ks: string[]; v: number; of: number; missing: string[]; all: boolean }
export type R5Lead = (Lead & { gap: number | null }) | null;
export interface CatSummary { cat: string; label: string; ks: string[]; fee: Lead | null; depfee: Lead | null; r5: R5Lead; sharpe: Lead | null }
export interface CmpSummary {
  /** the one category's lines (null when the tracks span more than one category, or have no comparable pair) */
  fee: Lead | null; depfee: Lead | null; r5: R5Lead; sharpe: Lead | null;
  /** more than one product */
  mixed: boolean;
  /** more than one category among the tracks compared */
  cross: boolean;
  /** an old-generation policy is in the set */
  old: boolean;
  /** every category with two tracks or more (old-generation tracks left out), in the order of first appearance */
  cats: CatSummary[];
  /** the keys alone in their category (no line compares them) */
  alone: string[];
  /** the old-generation keys (never in a comparison line) */
  oldKs: string[];
  /** equity exposure across the set: the lowest and the highest published */
  stRange: [number, number] | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** the rows that share the best value (lower or higher is better), at the published precision */
function best(xs: CmpIn[], val: (x: CmpIn) => number | null, low: boolean): Lead | null {
  const have = xs.filter((x) => val(x) != null && Number.isFinite(val(x)!));
  if (have.length < 2) return null;
  const vs = have.map((x) => r2(val(x)!)), b = low ? Math.min(...vs) : Math.max(...vs);
  const ks = have.filter((_, i) => vs[i] === b).map((x) => x.k);
  return { ks, v: b, of: have.length, missing: xs.filter((x) => !have.includes(x)).map((x) => x.k), all: ks.length === have.length };
}

function r5Lead(xs: CmpIn[]): R5Lead {
  const band = TIE_BP / 100;
  const have5 = xs.filter((x) => x.r5 != null);
  if (have5.length < 2) return null;
  const tr = tieRanks(have5, (x) => x.r5, band);
  const ks = have5.filter((x) => tr.get(x.k)!.lo === 1).map((x) => x.k);
  const top = Math.max(...have5.map((x) => x.r5!));
  // the gap from the shared head to the highest of the rest (null when every track shares the head)
  const rest = have5.filter((x) => !ks.includes(x.k)).map((x) => x.r5!);
  const headLow = Math.min(...have5.filter((x) => ks.includes(x.k)).map((x) => x.r5!));
  return { ks, v: top, of: have5.length, missing: xs.filter((x) => x.r5 == null).map((x) => x.k), all: ks.length === have5.length, gap: rest.length ? headLow - Math.max(...rest) : null };
}

const catOf = (x: CmpIn) => x.cat ?? x.prod;
export function compareSummary(xs: CmpIn[]): CmpSummary {
  const oldKs = xs.filter((x) => x.old).map((x) => x.k);
  const live = xs.filter((x) => !x.old);
  const order = [...new Set(xs.map(catOf))];
  const cats: CatSummary[] = [];
  const alone: string[] = [];
  for (const c of order) {
    const g = live.filter((x) => catOf(x) === c);
    if (g.length < 2) { alone.push(...g.map((x) => x.k)); continue; }
    cats.push({ cat: c, label: g[0].track ? `${g[0].prod} · ${g[0].track}` : g[0].prod, ks: g.map((x) => x.k), fee: best(g, (x) => x.fee, true), depfee: best(g, (x) => x.depfee, true), r5: r5Lead(g), sharpe: best(g, (x) => x.sharpe, false) });
  }
  const cross = order.length > 1;
  const one = !cross && cats.length === 1 ? cats[0] : null;
  const sts = xs.map((x) => x.st).filter((v): v is number => v != null && Number.isFinite(v));
  return {
    fee: one?.fee ?? null, depfee: one?.depfee ?? null, r5: one?.r5 ?? null, sharpe: one?.sharpe ?? null,
    mixed: new Set(xs.map((x) => x.prod)).size > 1, cross, old: oldKs.length > 0, cats, alone, oldKs,
    stRange: sts.length ? [Math.min(...sts), Math.max(...sts)] : null,
  };
}

/** the measure's words in a bottom line: "the lowest / highest among the tracks chosen", never a place or a winner */
export const LEAD_HE = {
  fee: 'דמי הניהול מצבירה הנמוכים מבין המסלולים שנבחרו (ממוצע בפועל)',
  depfee: 'דמי הניהול מהפקדה הנמוכים מבין המסלולים שנבחרו (ממוצע בפועל)',
  r5: 'התשואה השנתית ב-5Y הגבוהה מבין המסלולים שנבחרו',
  sharpe: 'השארפ הגבוה מבין המסלולים שנבחרו (כפי שהרשות מפרסמת)',
} as const;
/** what the bottom line says when the tracks are of different categories */
export const CROSS_HE = 'המסלולים שנבחרו שייכים לקטגוריות שונות, ברמות סיכון שונות. השוואת תשואה בין רמות סיכון שונות אינה בעלת משמעות, ולכן מוצגים הנתונים של כל מסלול לצד החשיפה שלו למניות, בלי "גבוה" ו"נמוך" ביניהם. השוואה מוצגת רק בין מסלולים מאותה קטגוריה';
/** what it says about the old-generation policies */
export const OLD_HE = 'ביטוח מנהלים מדור ישן (פוליסות 1990-2003) אינו נכלל בשום שורת השוואה: מקדם קצבה מובטח או הבטחת תשואה, אם יש בפוליסה, אינם מופיעים בנתוני התשואה ודמי הניהול';
