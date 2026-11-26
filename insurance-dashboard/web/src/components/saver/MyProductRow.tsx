import { useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { MonthStrip, type StripMonth } from '../MonthStrip';
import { NumText } from '../NumText';
import { catKey, selfDirected, type CatX, type FundX, type HistX } from '../../lib/funds';
import { feeCost, type FeeBase } from '../../lib/feeExample';
import { useMyAmounts } from '../../lib/myAmounts';
import type { MyProduct } from '../../lib/mine';
import { hasTypeAvg, oldGeneration, placeOf, trackVsType, typeCount, typeHasDepositFee, type Place } from '../../lib/pageMonths';
import {
  MY_COMPARE, NO_MONTHLY_GUARD, SELF_MANAGED_GUARD, amountsBase, fullLabel, myFeeLine, myYearLine, typeName, vsAvgParts,
} from '../../lib/pageWords';
import { trackColor } from '../../pages/compare/tracks';

/* One product on /my (rollout spec 5.2 #3, 16.1 5b/5c/5e, 17.1 1a–1c, 18.6; tickets T-M1, T-M4; mockup v4 frame 8):
   - head row "מגדל · פנסיה כללי ‹" (a 44-px button: today's ProductCard in a sheet);
   - <MonthStrip> of the track's last six published months, the newest last and ringed; each square is its own button and opens that
     month's sheet for this product;
   - "באוקטובר: מתחת לממוצע בפנסיה כללי (−1.03%)": the newest month against the type's average (cat.json, asset-weighted), "כמו
     הממוצע" inside 0.05;
   - "בשנה האחרונה: +9.2% · מקום 5 מתוך 5" (lib/pageMonths placeOf on 12 months, placeGroups; self-managed and old-generation tracks
     are not ranked);
   - "דמי ניהול ₪560 בשנה" + "לדוגמה" or the base of the reader's own amounts ("על הסכומים שלך"). The amounts come ONLY from
     lib/myAmounts useMyAmounts (17.2); the cost from lib/feeExample feeCost, the same function as the card and the fees tool. With the
     reader's own fee from the statement or the clearing-house file (5.5, O9) the cost uses it and says "לפי הדוח שלך".
   - "השוואה ›": compare on this product and the two largest of its type (lib/saverCompare compareKeys, passed in as `cmpHref`).
   Edge cases (5.5): a self-managed / IRA track shows the guard line instead of the strip and no "השוואה ›"; a track with no monthly
   return the same with its own line; an old-generation policy has the strip but no place. Numbers come from pure helpers below
   (node-tested in scripts/my-rows-test.mjs). */

export const OWN_FEE_TAG = 'לפי הדוח שלך';

/** The figures of one product row (pure). `h`: the track's history (undefined while it loads); `members`: its type's tracks
 *  (lib/pageMonths typeMembers); `cat`: the type's cat.json entry. */
export interface MyRowFig {
  key: string; type: string;
  months: StripMonth[];
  /** the newest published month and its return, and the type's average that month (null: fewer than three tracks, or not published) */
  p: number | null; v: number | null; avg: number | null;
  y12: number | null; place: Place | null;
  /** the type's ranked tracks on the month (pageMonths typeCount): the count the card, the hub and the screener show */
  typeN?: number;
  guard: string | null;
}
export function myRowFigures(f: FundX, h: HistX | null | undefined, members: FundX[], cat: CatX | null | undefined, asof: number): MyRowFig {
  const key = catKey(f), type = typeName(key);
  const place = oldGeneration(f) || selfDirected(f) ? null : placeOf(f, members, 'y12', asof);
  const base = { key, type, y12: f.y12 ?? null, place, typeN: place ? typeCount(members, 'm1', { asof }).ranked : undefined };
  if (selfDirected(f)) return { ...base, months: [], p: null, v: null, avg: null, guard: SELF_MANAGED_GUARD };
  const tv = trackVsType(h, f, hasTypeAvg(members) ? cat : null, 6);
  if (!h) return { ...base, months: [], p: null, v: null, avg: null, guard: null };
  if (!tv.rows.length) return { ...base, months: [], p: null, v: null, avg: null, guard: NO_MONTHLY_GUARD };
  const now = tv.rows[0];
  return { ...base, months: tv.rows.slice().reverse().map((r) => ({ p: r.p, v: r.v })), p: now.p, v: now.v, avg: now.avg, guard: null };
}

/** A product's yearly fee in ₪ (pure): the published fees, or the reader's own fee when known; on the reader's amounts (`base`, from
 *  useMyAmounts) or the example (null). */
export function myFeeCost(f: Pick<FundX, 'prod' | 'fee' | 'depfee'>, my: Pick<MyProduct, 'fee' | 'depfee'> | null | undefined, base: FeeBase | null): { cost: number | null; ownFee: boolean } {
  const ownFee = my?.fee != null && Number.isFinite(my.fee);
  const x = ownFee ? { prod: f.prod, fee: my!.fee!, depfee: my!.depfee ?? f.depfee } : f;
  return { cost: feeCost(x, true, base), ownFee };
}

export interface ProductFee { cost: number | null; own: boolean; ownFee: boolean; base: string; deposits: boolean }
/** The fee of one saved product on the reader's amounts for THAT product (useMyAmounts), never another product's. */
export function useProductFee(f: FundX, my: MyProduct | undefined, members: FundX[], example = false): ProductFee {
  const a = useMyAmounts({ k: example ? null : f.k });
  const deposits = typeHasDepositFee(members.length ? members : [f]);
  const { cost, ownFee } = myFeeCost(f, example ? null : my, a.base);
  return { cost, own: a.own, ownFee, deposits, base: amountsBase({ own: a.own, depositOwn: a.depositOwn, deposits }) };
}

export interface MyProductRowProps {
  f: FundX;
  i: number;
  fig: MyRowFig;
  members: FundX[];
  my?: MyProduct;
  example?: boolean;
  cmpHref?: string | null;
  onOpen?: () => void;
  onMonth?: (p: number) => void;
  onFee?: (k: string, fee: ProductFee) => void;
}

/** the place's bracket "(5–6 מתוך 12)" never breaks inside (build review B1, novice #10) */
function yrParts(yr: string) {
  const i = yr.indexOf('(');
  if (i < 0) return <NumText t={yr} />;
  return <><NumText t={yr.slice(0, i)} /><span style={{ whiteSpace: 'nowrap' }}><NumText t={yr.slice(i)} /></span></>;
}

export function MyProductRow({ f, i, fig, members, my, example = false, cmpHref, onOpen, onMonth, onFee }: MyProductRowProps) {
  const fee = useProductFee(f, my, members, example);
  useEffect(() => { onFee?.(f.k, fee); }, [f.k, fee.cost, fee.own, fee.ownFee, fee.base, fee.deposits]);  // eslint-disable-line react-hooks/exhaustive-deps
  const label = fullLabel(f.grp, fig.key);
  const vs = vsAvgParts(fig.p ?? 0, fig.v, fig.avg, fig.type);
  const yr = myYearLine(fig.y12, fig.place, fig.typeN);
  const fl = myFeeLine(fee.cost, fee.own, fee.base);
  const loading = !fig.guard && !fig.months.length;
  const head = (
    <>
      <i className="my-sq" aria-hidden="true" />
      <b>{label}</b>
      {onOpen ? <span className="my-chev" aria-hidden="true">‹</span> : null}
    </>
  );
  return (
    <div className={`my-row${example ? ' ex' : ''}`} {...(example ? {} : { 'data-my': f.k, id: f.k })} style={{ '--c': trackColor(i) } as CSSProperties}>
      {onOpen
        ? <button type="button" className="my-h" onClick={onOpen} aria-label={`${label}: הכרטיס של המוצר`}>{head}</button>
        : <div className="my-h">{head}</div>}
      {fig.guard
        ? <p className="my-guard">{fig.guard}</p>
        : loading
          ? <div className="my-strip-skel" aria-hidden="true" />
          : <MonthStrip months={fig.months} label={label} onOpen={onMonth} />}
      {vs ? <p className="my-vs"><NumText t={`${vs.when} `} /><b>{vs.rel}</b> <NumText t={vs.rest} /></p> : null}
      <div className="my-f">
        <div className="my-lines">
          {yr ? <span className={`my-yr${(fig.y12 ?? 0) < 0 ? ' dn' : ''}`}>{yrParts(yr)}</span> : null}
          <span className="my-fee"><NumText t={fl.text} /> <small className={fee.own ? 'own' : 'ex'}>{fl.tag}{fee.ownFee ? ` · ${OWN_FEE_TAG}` : ''}</small></span>
        </div>
        {cmpHref && !fig.guard ? <Link className="my-cmp" to={cmpHref}>{MY_COMPARE}</Link> : null}
      </div>
    </div>
  );
}
