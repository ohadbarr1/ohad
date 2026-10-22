import { useEffect, useMemo, useState } from 'react';
import type { PriceData, IfrsFact, IfrsData } from './types';
import type { Prov } from './prov';
import { nf, pubLabel } from './format';
import { periodTag, type CompanyKpi } from './kpi';
import { endOf, tag, type Bridge, type Line, type Reports } from './csm';
import { csmProv, resolveCsmAt, type CsmClose } from './csmResolve';
import { load } from './useData';

/* The valuation engine: market inputs (the one place a price enters the site), the shared assumptions, and the models that read
   insurers the way they are priced: justified P/B, residual income, price to equity plus after-tax CSM. Every output is an estimate
   built on labelled assumptions; every input from a filing or a public source opens that source. */

/** A price file from the exchange: last close, market value as TASE prints it, registered shares, ex-dividend amounts. */
export type TasePrice = PriceData & { mcap?: number | null; shares?: number | null; url?: string; name?: string; fetched?: string; div_derived?: boolean };

export const MM = 'מיליוני ש"ח';
export const mil = (v: number) => `${nf(v, 0)} ${MM}`;
export const pctS = (v: number, d = 1) => `${nf(v, d)}%`;
export const xS = (v: number, d = 2) => `${nf(v, d)}x`;
const none = (title: string, why: string): Prov => ({ k: 'none', title, why });

/* ---------- assumptions, shared by every company so the peer table compares like with like ---------- */
export interface Assume { erp: number; beta: number; /** null: the BoI 10-year nominal zero-coupon yield */ rf: number | null; g: number; tax: number }
export const ASSUME0: Assume = { erp: 6, beta: 1, rf: null, g: 2, tax: 34.19 };
export const ASSUME_NOTE = {
  erp: 'פרמיית סיכון שוק · הנחה',
  beta: 'ביתא · הנחה, אחידה לכל החברות',
  rf: 'ריבית חסרת סיכון · ברירת מחדל: תשואה נומינלית אפס 10 שנים, בנק ישראל',
  g: 'צמיחה לטווח ארוך · הנחה; אמצע יעד האינפלציה של בנק ישראל (1%–3%)',
  tax: 'שיעור מס · הנחה; מס חברות 23% ומס רווח 17% במוסדות כספיים',
};
export interface Rf { v: number; month: string; url: string; retrieved: string; code: string }
export const keOf = (a: Assume, rf: Rf | null): number | null => { const r = a.rf ?? rf?.v ?? null; return r == null ? null : r + a.beta * a.erp; };
export function rfProv(a: Assume, rf: Rf | null): Prov {
  if (a.rf != null) return none('ריבית חסרת סיכון', `ההנחה שלך: ${pctS(a.rf, 2)}`);
  if (!rf) return none('ריבית חסרת סיכון', 'קובץ המאקרו לא נטען');
  const [y, m] = rf.month.split('-');
  return { k: 'report', title: 'תשואה נומינלית אפס 10 שנים, ממוצע חודשי', value: pctS(rf.v, 2), unit: '%', url: rf.url, pg: null, doc: 'בנק ישראל · ZCM', period: `${m}/${y.slice(2)}`, note: `${rf.code} · נמשך ${pubLabel(rf.retrieved)}`, srcType: 'נתון חיצוני' };
}
export function keProv(a: Assume, rf: Rf | null): Prov {
  const ke = keOf(a, rf);
  if (ke == null) return none('מחיר ההון', 'אין ריבית חסרת סיכון');
  return { k: 'calc', title: 'מחיר ההון (ke)', value: pctS(ke, 2), unit: '%', est: true, formula: 'ke = ריבית חסרת סיכון + ביתא × פרמיית סיכון שוק',
    inputs: [{ label: a.rf == null ? 'ריבית חסרת סיכון (בנק ישראל)' : 'ריבית חסרת סיכון (ההנחה שלך)', v: pctS(a.rf ?? rf!.v, 2), src: () => rfProv(a, rf) }, { label: 'ביתא (הנחה)', v: nf(a.beta, 2) }, { label: 'פרמיית סיכון שוק (הנחה)', v: pctS(a.erp, 2) }] };
}

/* ---------- market inputs of one company ---------- */
export interface Mkt {
  px: number | null; pxProv: () => Prov; manual: boolean;
  shares: number | null; sharesProv: () => Prov;
  mcap: number | null; mcapProv: () => Prov;
  eq: number | null; eqPeriod: string | null; eqProv: () => Prov;
  ltm: number | null; ltmProv: () => Prov;
  roe: number | null; roePeriod: string | null; roeProv: () => Prov;
  pb: number | null; pbProv: () => Prov; pe: number | null; peProv: () => Prov;
  dps: number | null; dy: number | null; dyProv: () => Prov; payout: number | null; payoutProv: () => Prov;
}
const ttm = (p: TasePrice) => { const lo = `${Number(p.asof.slice(0, 4)) - 1}${p.asof.slice(4)}`; return p.dividends.filter(([d]) => d > lo).reduce((s, [, v]) => s + v, 0); };
const vendor = (p: TasePrice) => `${p.source}${p.ticker ? ` · נייר ${p.ticker}` : ''}`;

/** The market side of one company: the price (TASE close, or the reader's own input), market value, and the multiples on the latest filings. */
export function marketOf(k: CompanyKpi, p: TasePrice | null, manualPx: number | null): Mkt {
  const eqP = k.latest('equity'), ltmP = k.latest('profit', 'ltm'), roeP = k.latest('roe');
  const eq = eqP?.v ?? null, ltm = ltmP?.v ?? null, roe = roeP?.v ?? null;
  const tasePx = p ? p.last / 100 : null;
  const manual = manualPx != null && Number.isFinite(manualPx) && manualPx > 0;
  const px = manual ? manualPx : tasePx;
  const pxProv = (): Prov => manual ? none('מחיר למניה', `קלט ידני: ${nf(manualPx!, 2)} ש"ח. ${p ? `סגירה אחרונה בבורסה: ${nf(tasePx!, 2)} ש"ח (${pubLabel(p.asof)})` : ''}`)
    : p ? { k: 'price', title: 'מחיר סגירה אחרון (קלט להערכה)', value: `${nf(tasePx!, 2)} ש"ח`, ticker: p.name ?? p.ticker, vendor: vendor(p), date: p.asof } : none('מחיר למניה', 'אין קובץ מחיר לחברה; אפשר להזין מחיר ידנית');
  // shares: the registered capital TASE computes market value on; otherwise derived from annual profit and EPS
  const shares = p?.shares ?? k.lastShares();
  const sharesProv = (): Prov => p?.shares ? { k: 'price', title: 'הון רשום למסחר (מניות)', value: `${nf(p.shares / 1e6, 1)} מיליון`, ticker: p.name ?? p.ticker, vendor: vendor(p), date: p.asof } : k.sharesProv();
  const mcap = !manual && p?.mcap != null ? p.mcap : px != null && shares ? (px * shares) / 1e6 : null;
  const mcapProv = (): Prov => {
    if (mcap == null) return none('שווי שוק', 'אין מחיר לחברה');
    if (!manual && p?.mcap != null) return { k: 'price', title: 'שווי שוק כפי שמפרסמת הבורסה', value: mil(p.mcap), ticker: p.name ?? p.ticker, vendor: vendor(p), date: p.asof };
    return { k: 'calc', title: 'שווי שוק', value: mil(mcap), unit: MM, est: true, formula: 'שווי שוק = מחיר × מניות', inputs: [{ label: manual ? 'מחיר (קלט ידני)' : 'מחיר סגירה', v: `${nf(px!, 2)} ש"ח`, src: pxProv }, { label: 'מניות', v: `${nf(shares! / 1e6, 1)} מיליון`, src: sharesProv }] };
  };
  const eqProv = (): Prov => (eqP ? k.explain('equity', 'q', eqP.period) : none('הון', 'אין הון מדווח'));
  const ltmProv = (): Prov => (ltmP ? k.explain('profit', 'ltm', ltmP.period) : none('רווח LTM', 'חסר רבעון'));
  const roeProv = (): Prov => (roeP ? k.explain('roe', 'q', roeP.period) : none('ROE', 'חסר רווח LTM או הון לפני שנה'));
  const pb = mcap != null && eq ? mcap / eq : null, pe = mcap != null && ltm && ltm > 0 ? mcap / ltm : null;
  const pbProv = (): Prov => pb == null ? none('P/B', 'אין שווי שוק או הון') : { k: 'calc', title: 'מכפיל הון (P/B)', value: xS(pb), est: true, formula: 'P/B = שווי שוק ÷ הון לבעלי המניות',
    inputs: [{ label: 'שווי שוק', v: mil(mcap!), src: mcapProv }, { label: `הון, ${periodTag(eqP!.period)}`, v: mil(eq!), src: eqProv }] };
  const peProv = (): Prov => pe == null ? none('P/E', 'אין שווי שוק או רווח LTM חיובי') : { k: 'calc', title: 'מכפיל רווח (P/E), LTM', value: xS(pe, 1), est: true, formula: 'P/E = שווי שוק ÷ רווח נקי LTM',
    inputs: [{ label: 'שווי שוק', v: mil(mcap!), src: mcapProv }, { label: `רווח LTM, ${periodTag(ltmP!.period)}`, v: mil(ltm!), src: ltmProv }] };
  const dps = p ? ttm(p) / 100 : null;
  const dy = dps && px ? (dps / px) * 100 : null;
  const dpsProv = (): Prov => p ? { k: 'price', title: 'דיבידנד למניה, LTM לפי יום האקס', value: `${nf(dps!, 2)} ש"ח`, ticker: p.name ?? p.ticker, vendor: `${vendor(p)} · נגזר מהתאמת שער הבסיס ביום האקס`, date: p.asof } : none('דיבידנד', 'אין קובץ מחיר');
  const dyProv = (): Prov => dy == null ? none('תשואת דיבידנד', 'לא חולק דיבידנד ב-12 החודשים שעד תאריך המחיר') : { k: 'calc', title: 'תשואת דיבידנד, LTM', value: pctS(dy), unit: '%', est: true, formula: 'תשואה = דיבידנד למניה LTM ÷ מחיר',
    inputs: [{ label: 'דיבידנד למניה, LTM', v: `${nf(dps!, 2)} ש"ח`, src: dpsProv }, { label: 'מחיר', v: `${nf(px!, 2)} ש"ח`, src: pxProv }] };
  const paid = dps != null && p?.shares ? (dps * p.shares) / 1e6 : null;
  const payout = paid != null && ltm && ltm > 0 ? Math.min(100, (paid / ltm) * 100) : null;
  const payoutProv = (): Prov => payout == null ? none('שיעור חלוקה', 'אין דיבידנד או רווח LTM חיובי') : { k: 'calc', title: 'שיעור חלוקה, LTM', value: pctS(payout, 0), unit: '%', est: true, formula: 'שיעור חלוקה = דיבידנד למניה LTM × מניות ÷ רווח נקי LTM',
    inputs: [{ label: 'דיבידנד למניה, LTM', v: `${nf(dps!, 2)} ש"ח`, src: dpsProv }, { label: 'מניות', v: `${nf(p!.shares! / 1e6, 1)} מיליון`, src: sharesProv }, { label: 'רווח LTM', v: mil(ltm!), src: ltmProv }] };
  return { px, pxProv, manual, shares, sharesProv, mcap, mcapProv, eq, eqPeriod: eqP?.period ?? null, eqProv, ltm, ltmProv, roe, roePeriod: roeP?.period ?? null, roeProv, pb, pbProv, pe, peProv, dps, dy, dyProv, payout, payoutProv };
}

/* ---------- justified P/B ---------- */
export const justifiedPb = (roe: number, ke: number, g: number): number | null => (ke > g ? (roe - g) / (ke - g) : null);
/** ke at which the market's P/B is the justified one: g + (ROE − g) ÷ P/B */
export const impliedKe = (pb: number, roe: number, g: number): number | null => (pb > 0 ? g + (roe - g) / pb : null);
/** ROE the market's P/B asks for at ke and g: g + P/B × (ke − g) */
export const requiredRoe = (pb: number, ke: number, g: number): number => g + pb * (ke - g);

/* ---------- residual income ---------- */
export interface RiIn { b0: number; roe1: number; roeL: number; fade: number; payout: number; ke: number; g: number }
export interface RiRow { t: number; roe: number; b0: number; ri: number; pv: number }
export function residualIncome(a: RiIn): { rows: RiRow[]; sumPv: number; tv: number; pvTv: number; value: number } {
  const rows: RiRow[] = []; let b = a.b0, sum = 0;
  const n = Math.max(1, Math.round(a.fade));
  for (let t = 1; t <= n; t++) {
    const roe = a.roe1 + (a.roeL - a.roe1) * (n === 1 ? 1 : (t - 1) / (n - 1));
    const ri = (roe - a.ke) / 100 * b, pv = ri / Math.pow(1 + a.ke / 100, t);
    rows.push({ t, roe, b0: b, ri, pv }); sum += pv;
    b *= 1 + (roe / 100) * (1 - a.payout / 100);
  }
  const spread = (a.ke - a.g) / 100;
  const tv = spread > 0 ? ((a.roeL - a.ke) / 100 * b) / spread : NaN;
  const pvTv = tv / Math.pow(1 + a.ke / 100, n);
  return { rows, sumPv: sum, tv, pvTv, value: a.b0 + sum + pvTv };
}

/* ---------- CSM: the one rule (csmResolve), at the latest date it resolves ---------- */
export interface CsmOf { p: string; end: string; close: Line; b: Bridge; prov: (title: string) => Prov; inc: boolean; label: string; cs: CsmClose }
interface FactsFile { files: IfrsData['files']; reports: Record<string, IfrsFact[]> }
const QKEY = (p: string) => `${p.slice(0, 4)}${p.endsWith('FY') ? 'Q4' : p.slice(4)}`;
/** Closing CSM of each company at its latest report date: net of reinsurance, group level, never savings-policy future profit; the fallback
    (life plus health, gross) is labelled. The same figure the peer table, the CSM ledger and the company page show for that date. */
export function useCsm(ids: string[], d: IfrsData | null): Map<string, CsmOf | null> {
  const [m, setM] = useState<Map<string, CsmOf | null>>(new Map());
  const key = ids.join();
  useEffect(() => {
    if (!d || !ids.length) return;
    let live = true;
    load<FactsFile>('csm/facts.json').then((f) => {
      if (!live) return;
      const periods = Object.keys(f.reports).sort((a, b) => QKEY(a).localeCompare(QKEY(b)));
      const out = new Map<string, CsmOf | null>();
      ids.forEach((id) => {
        const rs: Reports = periods.map((p) => ({ p, F: tag(f.reports[p].filter((x) => x.c === id), p) })).filter((r) => r.F.length);
        const own = d.files.filter((x) => x.company === id).map((x) => x.period).sort((a, b) => QKEY(a).localeCompare(QKEY(b)));
        // the latest report date that resolves; a report that prints no CSM for its own date falls back to the one before
        const p = [...own].reverse().find((q) => resolveCsmAt(rs, q));
        const cs = p ? resolveCsmAt(rs, p) : null;
        if (!p || !cs) { out.set(id, null); return; }
        const end = endOf(p), w = p.endsWith('FY') ? 'fy' : p.endsWith('Q1') ? 'q' : 'ytd';
        const b: Bridge = { end, w, scope: cs.scope, b: cs.b, score: 10, open: null, openPrev: false, close: cs.line, steps: [], gap: null };
        out.set(id, { p, end, close: { ...cs.line, v: cs.v }, b, cs, inc: false, label: cs.label, prov: (title: string) => csmProv(cs, d, title) });
      });
      setM(out);
    }, () => live && setM(new Map(ids.map((id) => [id, null]))));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, d]);
  return m;
}
export interface CsmMult { csmNet: number; adj: number; pec: number | null; implied: number | null }
/** CSM after tax, equity plus it, price over that, and the multiple of after-tax CSM the market value implies above book. */
export function csmMultiples(eq: number | null, csm: number | null, tax: number, mcap: number | null): CsmMult | null {
  if (eq == null || csm == null) return null;
  const csmNet = csm * (1 - tax / 100), adj = eq + csmNet;
  return { csmNet, adj, pec: mcap != null && adj > 0 ? mcap / adj : null, implied: mcap != null && csmNet > 0 ? (mcap - eq) / csmNet : null };
}

/** Peer list: the insurance groups with recent filings, in registry order (the order the identity colours follow). */
export function useInsurers(reg: { id: string; kind: string }[] | null, kpis: Map<string, CompanyKpi> | null): string[] {
  return useMemo(() => (reg ?? []).filter((c) => c.kind === 'insurance_group' && kpis?.get(c.id)?.latest('equity')?.period.startsWith('202')
    && Number(kpis.get(c.id)!.latest('equity')!.period.slice(0, 4)) >= 2025).map((c) => c.id), [reg, kpis]);
}
