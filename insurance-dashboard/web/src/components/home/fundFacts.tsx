import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { useFunds } from '../../lib/useData';
import { countP, fundP, listP } from '../../lib/market';
import { nf } from '../../lib/format';
import type { Prov } from '../../lib/prov';
import { hasNet, refOf, selfDirected, ym, type FundX, type FundsFile } from '../../lib/funds';

/* W1 shell: the live facts the door pages stand on, all from funds.json (the regulator's gemel-net / pensia-net / bituach-net on
   data.gov.il), counted the way the /funds hub counts them: open to the public, with assets, not closed, not self-directed (IRA).
   Every figure opens its source; medians list every track they come from. */

export const isLive = (f: FundX) => !!f.assets && !f.closed && !f.gone && !selfDirected(f);

export function useFundFacts() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const live = useMemo(() => (data?.funds ?? []).filter(isLive), [data]);
  return { data, error, live, asof: data?.asof ?? 0, net: useMemo(() => hasNet(data?.funds ?? []), [data]) };
}

const LIVE_F = 'המסלולים הפתוחים לציבור שפורסמו בחודש האחרון, עם נכסים, ללא מסלולים סגורים ומסלולים בניהול אישי';
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const bn = (fs: FundX[]) => fs.reduce((t, f) => t + (f.assets ?? 0), 0) / 1000;
const assetsProv = (title: string, fs: FundX[], asof: number): Prov => listP(title, nf(bn(fs), 0), 'מיליארד ש"ח', 'סכום TOTAL_ASSETS של המסלולים, חלקי 1,000',
  [...fs].sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0)).slice(0, 40).map((f) => ({ label: f.name, v: nf(f.assets ?? 0, 1), src: () => fundP(refOf(f), asof, 'TOTAL_ASSETS', 'נכסים', nf(f.assets ?? 0, 1), 'מיליוני ש"ח') })),
  fs.length > 40 ? `מוצגים 40 המסלולים הגדולים מתוך ${nf(fs.length, 0)}` : undefined);

/** A slim strip of the month's facts, sourced: how many tracks, how much money, how many managing groups, the month, the basis. */
export function FundFacts({ className = '' }: { className?: string }) {
  const { data, live, asof, net } = useFundFacts();
  if (!data) return <div className={`dfacts ${className}`} aria-busy="true"><span className="dfacts-sk" /></div>;
  const grps = [...new Set(live.map((f) => f.grp))].sort();
  return (
    <p className={`dfacts ${className}`}>
      <span><Sourced className="num" src={() => countP('מסלולים פתוחים לציבור', live.length, LIVE_F)}>{nf(live.length, 0)}</Sourced> מסלולים</span>
      <span><Sourced className="num" src={() => assetsProv('נכסים, כל המסלולים הפתוחים לציבור', live, asof)}>{nf(bn(live), 0)}</Sourced> מיליארד ש"ח</span>
      <span><Sourced className="num" src={() => listP('גופים מנהלים', nf(grps.length, 0), undefined, 'ספירת הקבוצות שמנהלות מסלול פתוח לציבור', grps.map((g) => ({ label: g, v: nf(live.filter((f) => f.grp === g).length, 0) + ' מסלולים', src: () => countP(`מסלולים · ${g}`, live.filter((f) => f.grp === g).length, LIVE_F) })))}>{nf(grps.length, 0)}</Sourced> גופים מנהלים</span>
      <span>נתוני <b className="num">{ym(asof)}</b></span>
      {net && <span>תשואה נטו אחרי דמי ניהול <Link to="/about" className="dfacts-q">אומדן</Link></span>}
      <span className="dfacts-src">{data.source}</span>
    </p>
  );
}

/** The products an agent starts from, pension first. The label is the regulator's product as the screener names it. */
export const PRODUCTS: [string, string][] = [
  ['פנסיה מקיפה', 'פנסיה מקיפה'], ['פנסיה כללית', 'פנסיה כללית'], ['השתלמות', 'קרנות השתלמות'], ['גמל', 'קופות גמל'], ['גמל להשקעה', 'גמל להשקעה'],
  ['פוליסות חיסכון וביטוחי מנהלים (מ-2004)', 'פוליסות חיסכון וביטוחי מנהלים, מ-2004'], ['חיסכון לילד', 'חיסכון לילד'],
];
export const screenHref = (prod: string) => `/funds/screen?prod=${encodeURIComponent(prod)}`;

export interface ProdRow { prod: string; label: string; fs: FundX[]; fee: number | null; dep: number | null }
export function useProducts(): { rows: ProdRow[]; asof: number; ready: boolean } {
  const { data, live, asof } = useFundFacts();
  const rows = useMemo(() => PRODUCTS.map(([prod, label]) => {
    const fs = live.filter((f) => f.prod === prod);
    const deps = fs.filter((f) => f.depfee != null);
    // a deposit fee median only where most of the product publishes one and it is a real charge (pension, policies); a median of
    // zero or near it (gemel, hishtalmut) says nothing an agent needs and would read as a figure
    const dep = deps.length * 2 > fs.length ? median(deps.map((f) => f.depfee!)) : null;
    return { prod, label, fs, fee: median(fs.filter((f) => f.fee != null).map((f) => f.fee!)), dep: dep != null && dep >= 0.05 ? dep : null };
  }).filter((r) => r.fs.length > 0), [live]);
  return { rows, asof, ready: !!data };
}

const feeProv = (r: ProdRow, k: 'fee' | 'depfee', asof: number): Prov => {
  const fs = r.fs.filter((f) => f[k] != null).sort((a, b) => a[k]! - b[k]!);
  const what = k === 'fee' ? 'דמי ניהול מצבירה, ממוצע בפועל' : 'דמי ניהול מהפקדה, ממוצע בפועל';
  const m = k === 'fee' ? r.fee : r.dep;
  return listP(`${what} · חציון · ${r.label}`, m == null ? '–' : nf(m, 2) + '%', undefined, `החציון של ${what} בין המסלולים הפתוחים לציבור במוצר (לא משוקלל בנכסים)`,
    fs.map((f) => ({ label: f.name, v: nf(f[k]!, 2) + '%', src: () => fundP(refOf(f), asof, k === 'fee' ? 'AVG_ANNUAL_MANAGEMENT_FEE' : 'AVG_DEPOSIT_FEE', what, nf(f[k]!, 2) + '%') })));
};

/** The figures of one product, each sourced: tracks, assets, the median fees */
export function ProdFigs({ r, asof, full = false }: { r: ProdRow; asof: number; full?: boolean }) {
  return (
    <>
      <span className="pf-n"><Sourced className="num" src={() => listP(`מסלולים · ${r.label}`, nf(r.fs.length, 0), 'מסלולים', LIVE_F, r.fs.map((f) => ({ label: f.name, v: f.track, src: () => fundP(refOf(f), asof, 'TOTAL_ASSETS', 'נכסים', nf(f.assets ?? 0, 1), 'מיליוני ש"ח') })))}>{nf(r.fs.length, 0)}</Sourced> מסלולים</span>
      {full && <span className="pf-a"><Sourced className="num" src={() => assetsProv(`נכסים · ${r.label}`, r.fs, asof)}>{nf(bn(r.fs), 0)}</Sourced> מיליארד</span>}
      {full && <span className="pf-f">{r.fee != null && <>מצבירה <Sourced className="num" src={() => feeProv(r, 'fee', asof)}>{nf(r.fee, 2)}%</Sourced></>}</span>}
      {full && <span className="pf-d">{r.dep != null && <>מהפקדה <Sourced className="num" src={() => feeProv(r, 'depfee', asof)}>{nf(r.dep, 2)}%</Sourced></>}</span>}
    </>
  );
}
