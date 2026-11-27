/** Quarters for the Pro surfaces (phase 6: the peers board and the company overview). Thin wrappers over lib/registry `back` / `plab`,
 *  and the one place for the change rules: a percent change needs a positive base ("בסיס שלילי" otherwise), a ratio changes in points,
 *  a flow that changes sign changes as a difference. Pure; node-tested in scripts/peer-board-test.mjs. */
import { nf, pubLabel, sn } from './format';
import { back, plab } from './registry';

/** a reading of a metric on the board (the same union as components/PeriodSeg's quarter mode) */
export type QRead = 'ltm' | 'q' | 'yoy' | 'qoq' | 'ltmy' | 'now' | 'r3' | 'rytd' | 'r12';
export const isChg = (rd: QRead) => rd === 'yoy' || rd === 'qoq' || rd === 'ltmy';
export const isRet = (rd: QRead) => rd === 'r3' || rd === 'rytd' || rd === 'r12';

/** "2026Q3" → "Q3'26"; a half or a year key → "H1'26" / "FY'25"; null → "–" */
export const qlab = (q: string | null | undefined): string => (!q ? '–' : plab('Q', q));
/** k quarters back ("2026Q3", 4 → "2025Q3") */
export const qBack = (q: string, k: number): string => back('Q', q, k);
/** the quarter key of a date ("2026-09-30" → "2026Q3") */
export const qOfDate = (d: string): string => `${d.slice(0, 4)}Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;
/** the newest of two quarter keys (null-safe) */
export const qMax = (a: string | null | undefined, b: string | null | undefined) => (!a ? b ?? null : !b ? a : a > b ? a : b);
/** a semi-annual or annual figure stored at a quarter end, named by its period: Q2 → "H1'26", Q4 → "FY'25"; H1 / FY keys as they are */
export function perLabel(p: string): string {
  if (/H\d$/.test(p) || p.endsWith('FY')) return qlab(p);
  if (p.endsWith('Q2')) return `H1'${p.slice(2, 4)}`;
  if (p.endsWith('Q4')) return `FY'${p.slice(2, 4)}`;
  return qlab(p);
}
/** a date as the site prints it: "2026-09-30" → "30.09.26" */
export const dlab = (d: string | null | undefined) => pubLabel(d ?? '') || '–';

/** the label of a reading on the seg and in the sentence: the quarter's own label for `q`, never "רבעון נוכחי" */
export function readLabel(rd: QRead, q: string): string {
  return ({ now: 'עכשיו', ltm: 'LTM', ltmy: 'LTM YoY', q: qlab(q), yoy: 'YoY', qoq: 'QoQ', r3: '3M', rytd: 'YTD', r12: '12M' } as Record<QRead, string>)[rd];
}
/** how far back a change reaches: QoQ one quarter, YoY and LTM YoY four */
export const chgLag = (rd: QRead) => (rd === 'qoq' ? 1 : 4);

/** the sum of four quarters, or null when any is missing (a missing quarter is never zero) */
export function ltmSum(qs: (number | null | undefined)[]): number | null {
  if (qs.length !== 4 || qs.some((v) => v == null || !Number.isFinite(v))) return null;
  return (qs as number[]).reduce((s, v) => s + v, 0);
}
export type ChgWhy = 'בסיס שלילי' | 'אין נתון' | 'בסיס קטן';
/** B1 item 10: a change above this many percent stands on a base too small for a percent to say anything (Hachshara's QoQ +1,831.7%):
 *  it is read as the loss-base rule reads a change, the difference (or "–" with the reason), never as a percent */
export const PCT_CAP = 1000;
/** a percent change; a negative or zero base has no percent (the cell shows "–" with the title "בסיס שלילי") */
export function chgPct(a: number | null | undefined, b: number | null | undefined): { v: number | null; why?: ChgWhy } {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return { v: null, why: 'אין נתון' };
  if (!(b > 0)) return { v: null, why: 'בסיס שלילי' };
  const v = (a / b - 1) * 100;
  return v > PCT_CAP ? { v: null, why: 'בסיס קטן' } : { v };
}
/** a change in points (a ratio) or a difference (an amount whose sign may change): new less old */
export function chgPts(a: number | null | undefined, b: number | null | undefined): number | null {
  return a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) ? null : a - b;
}

/* ---------- figures ---------- */
/** "+7.1%", "−0.2%" */
export const fmtPct = (v: number, d = 1) => `${sn(v, d)}%`;
/** "+0.34 נק׳" */
export const fmtPts = (v: number, d = 1) => `${sn(v, d)} נק׳`;
/** a difference in NIS billions: "+8.7 מ׳ד" */
export const fmtBnDiff = (v: number, d = 1) => `${sn(v, d)} מ׳ד`;
/** millions on the Pro pages: no decimal ("462", not "462.0"); the printed value stays in the source sheet */
export const fmtMil = (v: number) => nf(v, 0);
