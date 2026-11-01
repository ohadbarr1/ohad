import type { ReactNode } from 'react';
import { Sourced } from '../Source';
import { fundP, monthsBack } from '../../lib/market';
import type { Prov } from '../../lib/prov';
import { grossProv, netProv, refOf, type CatX, type FundX, type FundsFile } from '../../lib/funds';
import { TIE_F } from '../../lib/fundsTie';
import { annualised } from '../../lib/fundsCalc';
import type { Tender } from '../../lib/fundsTools';
import { pcf, pcr, rankLabel, tenderSpan, type Fig, type Part, type Verdict } from '../../lib/verdict';
import { svcProv, type DecisionFile } from '../../lib/decision';  // W2

/* The sources of the report card's figures: each figure key of lib/verdict opens the regulator record or the calculation behind it,
   exactly as the fund pages do (Sourced + Prov). The reader's own numbers say so. */

const ym = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
export const ymOf = ym;
const MINE_WHY = 'הנתון שהזנת מהדוח השנתי שלך. נשמר רק בדפדפן הזה ואינו נשלח לשום מקום';

export function tenderProv(t: Tender, what: string, v: string): Prov {
  return { k: 'report', title: `${what} · ${t.label ?? 'הליך ' + t.id}`, value: v, url: t.src, pg: null, doc: t.src_title ?? 'רשות שוק ההון, ביטוח וחיסכון', period: tenderSpan(t),
    note: [t.verified ? null : 'לא אומת מול המקור הראשי.', t.note, t.alloc ? `חלוקה: ${t.alloc}` : null, t.fee_alt?.length ? `טבלת ההמרה: ${t.fee_alt.map((x) => `${pcf(x.depfee)} / ${pcf(x.fee)}`).join(' · ')} (מהפקדה / מצבירה)` : null].filter(Boolean).join(' ') || undefined };
}

/** The Prov of each figure of a verdict. */
export function figsOf(f: FundX, v: Verdict, asof: number, file?: FundsFile, dec?: DecisionFile | null): Record<Fig, () => Prov> {
  const R = refOf(f);
  const retSrc = (x: FundX) => () => (v.ret?.basis === 'net' ? netProv(x, v.ret.per, asof, x.net?.[v.ret.per] ?? null, file?.net_method) : grossProv(x, v.ret!.per, asof));
  const val = (x: FundX) => (v.ret?.basis === 'net' ? x.net?.[v.ret.per] ?? null : x[v.ret!.per as 'a5']);
  const list = () => (v.ret?.ranked ?? []).map((x) => ({ label: x.name, v: pcr(val(x as FundX)), src: retSrc(x as FundX) }));
  const feeRec = (x: FundX, w: 'fee' | 'depfee') => () => fundP(refOf(x), asof, w === 'fee' ? 'AVG_ANNUAL_MANAGEMENT_FEE' : 'AVG_DEPOSIT_FEE', w === 'fee' ? 'דמי ניהול מצבירה, ממוצע בפועל' : 'דמי ניהול מהפקדה, ממוצע בפועל', pcr(x[w]));
  const medOf = (w: 'fee' | 'depfee', value: string): Prov => ({ k: 'calc', title: `${w === 'fee' ? 'דמי ניהול מצבירה' : 'דמי ניהול מהפקדה'}, חציון · ${v.prod} | ${v.track}`, value,
    formula: `החציון של הממוצע בפועל של כל מסלול פתוח בקטגוריה${w === 'depfee' ? ' (מסלולים שמפרסמים דמי ניהול מהפקדה)' : ''}`,
    inputs: (v.peers as FundX[]).filter((x) => x[w] != null && (w === 'fee' || x[w]! > 0)).sort((a, b) => a[w]! - b[w]!).map((x) => ({ label: x.name, v: pcr(x[w]), src: feeRec(x, w) })) });
  const t = v.dflt?.tender;
  return {
    ret: retSrc(f),
    rank: () => ({ k: 'calc', title: `מקום בקטגוריה · ${f.name}`, value: v.ret?.rank ? rankLabel(v.ret.rank) : '–',
      formula: `מקום = מספר המסלולים בקטגוריה (${v.prod}, ${v.track}) שתשואתם גבוהה יותר, ועוד 1. ${TIE_F}. מדורגים: מסלולים פתוחים לציבור, עם נכסים, לא בניהול אישי`, inputs: list() }),
    med: () => ({ k: 'calc', title: `חציון הקטגוריה · ${v.prod} | ${v.track}`, value: pcr(v.ret?.med), formula: 'החציון של המסלולים המדורגים בקטגוריה באותו חלון', inputs: list() }),
    fee: v.fee.own ? () => ({ k: 'none', title: 'דמי ניהול מצבירה · שלך', why: MINE_WHY }) : feeRec(f, 'fee'),
    feeMed: () => medOf('fee', pcf(v.fee.med)),
    feePct: () => ({ k: 'calc', title: `מקום דמי הניהול בקטגוריה · ${f.name}`, value: `${v.fee.pct ?? '–'}%`,
      formula: v.fee.word === 'high' ? 'מסלולים אחרים בקטגוריה עם דמי ניהול מצבירה נמוכים יותר ÷ מספר המסלולים האחרים × 100' : 'מסלולים אחרים בקטגוריה עם דמי ניהול מצבירה גבוהים יותר ÷ מספר המסלולים האחרים × 100',
      inputs: [{ label: v.fee.own ? 'דמי הניהול שלך' : 'דמי הניהול במסלול', v: pcf(v.fee.v) }, { label: 'מסלולים אחרים', v: String(v.fee.n) }, { label: 'עם דמי ניהול גבוהים יותר', v: String(v.fee.higher) }, { label: 'עם דמי ניהול נמוכים יותר', v: String(v.fee.lower) }, { label: 'החציון', v: pcf(v.fee.med), src: () => medOf('fee', pcf(v.fee.med)) }] }),
    dep: v.dep?.own ? () => ({ k: 'none', title: 'דמי ניהול מהפקדה · שלך', why: MINE_WHY }) : feeRec(f, 'depfee'),
    depMed: () => medOf('depfee', pcf(v.dep?.med)),
    tender: () => (t ? tenderProv(t, 'קרנות ברירת המחדל', tenderSpan(t)) : { k: 'none', title: 'קרנות ברירת מחדל', why: 'אין נתון' }),
    tfee: () => (t ? tenderProv(t, 'דמי ניהול מצבירה, מחיר ההליך', pcf(v.dflt!.fee)) : { k: 'none', title: '', why: '' }),
    tdep: () => (t ? tenderProv(t, 'דמי ניהול מהפקדה, מחיר ההליך', pcf(v.dflt!.depfee)) : { k: 'none', title: '', why: '' }),
    eq: () => ({ k: 'fund', title: `חשיפה למניות · ${f.name}`, value: pcr(f.st, 1), ds: R.ds, id: R.id, period: asof, col: 'STOCK_MARKET_EXPOSURE' }),
    eqMed: () => ({ k: 'calc', title: `חשיפה למניות, חציון · ${v.prod} | ${v.track}`, value: pcr(v.eq?.med, 1), formula: 'החציון של החשיפה למניות של המסלולים הפתוחים בקטגוריה. מסומן כשהמסלול רחוק ממנו ביותר מ-1.5 סטיות תקן',
      inputs: (v.peers as FundX[]).filter((x) => x.st != null && !x.closed).sort((a, b) => b.st! - a.st!).map((x) => ({ label: x.name, v: pcr(x.st, 1) })) }),
    // W2: the regulator's service index (the company, not the track)
    svc: () => (dec ? svcProv(dec, f.grp, 'pension', 'rank') : { k: 'none', title: 'מדד השירות', why: 'קובץ נתוני ההחלטה לא נטען' }),
    svcTot: () => (dec ? svcProv(dec, f.grp, 'pension', 'total') : { k: 'none', title: 'מדד השירות', why: 'קובץ נתוני ההחלטה לא נטען' }),
  };
}

const HE = /[\u0590-\u05FF]/;
/** `num` (tabular, left-to-right) only on a figure with no Hebrew in it: "7 מתוך 7" or "2,000 ש\"ח" keep the line's direction */
export const numCls = (t: string) => (HE.test(t) ? undefined : 'num');
/** A line of the verdict with its figures sourced. The punctuation that touches a figure ("(", ")." , ",") stays on its line with it. */
export function Parts({ parts, figs }: { parts: Part[]; figs: Record<Fig, () => Prov> }) {
  const strs = parts.map((p) => (typeof p === 'string' ? p : null));
  const out: ReactNode[] = [];
  parts.forEach((p, i) => {
    if (typeof p === 'string') return;
    const prev = i > 0 ? strs[i - 1] : null, next = i < parts.length - 1 ? strs[i + 1] : null;
    const pre = prev ? (prev.match(/[^\s]*$/)?.[0] ?? '') : '', post = next ? (next.match(/^[^\s]*/)?.[0] ?? '') : '';
    if (prev != null) strs[i - 1] = prev.slice(0, prev.length - pre.length);
    if (next != null) strs[i + 1] = next.slice(post.length);
    out[i] = <span key={i} className="sv-nw">{pre}<Sourced src={figs[p.fig]}><b className={numCls(p.t)}>{p.t}</b></Sourced>{post}</span>;
  });
  return <>{parts.map((p, i) => (typeof p === 'string' ? (strs[i] ? <span key={i}>{strs[i]}</span> : null) : out[i]))}</>;
}

/** The return assumption: the category's 10-year gross (asset-weighted average of its tracks), as the fees tool does; null when short. */
export function cat10(c: CatX | undefined): number | null { return c ? annualised(c.y, 120) : null; }
export function cat10Prov(cat: string, c: CatX, v: number): Prov {
  const ms = c.p.slice(-120);
  return { k: 'calc', est: true, title: `תשואה שנתית ברוטו, 10Y · ${cat}`, value: pcr(v), formula: '((1 + r₁) × … × (1 + r₁₂₀)) בחזקת 12 ÷ 120, פחות 1, על ממוצע הקטגוריה המשוקלל בנכסים של כל חודש (ברוטו, לפני דמי ניהול; דמי הניהול מנוכים בחישוב)',
    note: 'הנחה: תשואת העבר של הקטגוריה כאומדן לעתיד. אינה תחזית', inputs: ms.map((p, i) => ({ label: `ממוצע הקטגוריה · ${ym(p)}`, v: pcr(c.y[c.y.length - 120 + i]) })) };
}
export const last12 = (asof: number) => monthsBack(asof, 12);

/** a figure with an estimate's source */
export function Est({ src, children }: { src: () => Prov; children: string }) { return <Sourced src={src}><b className={`sv-ils ${numCls(children) ?? ''}`}>{children}</b></Sourced>; }
