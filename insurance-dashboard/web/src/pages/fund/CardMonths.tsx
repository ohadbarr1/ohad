import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MonthGrid, monthFull, shekels, type MonthGridSum } from '../../components/MonthGrid';
import { Takeaway } from '../../components/Takeaway';
import { StampLine } from '../../components/StampLine';
import { NumText } from '../../components/NumText';
import { DeeperSheet } from '../../components/DeeperSheet';
import { backThen } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { Icon3D } from '../../components/Icon3D';
import { ProdIcon } from '../../components/compare/PickerSheet';
import { Fig, catMonthProv, monthProv } from '../../components/compare/sheetKit';
import { tileOf, TILES } from '../../lib/pickTiles';
import { catKey, type CatX, type FundX, type HistX } from '../../lib/funds';
import type { Door } from '../../lib/door';
import type { SheetHost } from '../../lib/sheetHost';
import { useMyAmounts } from '../../lib/myAmounts';
import { feeParts, type FeeBase } from '../../lib/feeExample';
import type { MyProduct } from '../../lib/mine';
import { compareKeys } from '../../lib/saverCompare';
import type { VFund } from '../../lib/verdict';
import { cum } from '../../lib/compareMonths';
import { ONE_MONTH_NOTE, monthShortYear } from '../../lib/compareWords';
import { addMonths } from '../../lib/market';
import { longestPlace, prodHasDeposit, rankable, trackVsType, typeFeeAvg, typeHasDepositFee } from '../../lib/pageMonths';
import {
  AVG_HEAD, CARD_ROWS, FEE_ROW, FEE_SHEET_CALC, FEE_SHEET_NOTE, FEE_SHEET_TITLE, FEE_SHEET_TO_TOOL, FEE_TOTAL_YEAR, MONTH_SHEET_SUB,
  allTracksIn, amountsBase, avgHeadSub, cardWhoBest, cardWords, cmpCta, feeFromBalance, feeFromDeposits, feeRowSub, feeSheetSub, ilsSym,
  monthSheetVs, placeLine,
} from '../../lib/pageWords';
import { trackColor, trackLabels } from '../compare/tracks';
import '../../styles/fund-card.css';

/* Rollout T-C2 (spec §3.2, §16.1, §17.1 1c, §18.6; mockup v4 frames "card"): the card's months lens, 6 or 12 months.
   The sentence first (lib/pageWords cardWords), then the track against its type's average month by month (lib/pageMonths trackVsType,
   the average = funds/cat.json, asset-weighted), half year, last year and the fee row in shekels (feeCost on the reader's amounts when the
   track is saved and amounts were typed, else "לדוגמה"; the average beside it = typeFeeAvg on the same amounts). A cell opens the card's
   month sheet; the average head and cells open the type-month sheet (T-C7), as does "מי היה ראשון…". Then the compare button, the rows
   and the stamp. Also exported: the shared card context, the month / year sheet and the fee sheet (mounted by the shell). */

/** what every lens of the card gets from the shell (pages/Funds.tsx FundCard) */
export interface CardCtx {
  f: FundX;
  h: HistX;
  /** the type's cat.json series (asset-weighted average), null for a type of fewer than three tracks (3.5) */
  cat: CatX | null;
  /** the type's open tracks (lib/pageMonths typeMembers), the card's own included */
  members: FundX[];
  /** every track (funds.json), for the compare peers */
  funds: FundX[];
  typeKey: string;
  /** the type in words: "פנסיה כללי" */
  tn: string;
  /** the regulator's member count of the type in the newest month (the average's) */
  avgN: number;
  /** tracks ranked in the type (the type-month sheet's count) */
  rankN: number;
  asof: number;
  door: Door;
  /** the reader saved this track ("המוצרים שלי") */
  saved: boolean;
  /** an old-generation managers' insurance policy (1990–2003): no place, no compare button */
  old: boolean;
  host: SheetHost;
  setView: (v: string) => void;
  onMine: () => void;
  /** the reader's saved record of this track (own fee typed or imported, amounts), when saved */
  my?: Pick<MyProduct, 'fee' | 'depfee'> | null;
}

/** "לפי הדוח שלך": the tag of a cost priced on the reader's own fee (the same words as /my, components/saver/MyProductRow OWN_FEE_TAG) */
export const OWN_FEE_TAG = 'לפי הדוח שלך';
/** The card's fee in ₪ a year: the SAME rule as /my (lane L2-c, components/saver/MyProductRow `myFeeCost`, replicated here because that
 *  file is not on this lane's base; the coordinator reconciles at merge): when the reader typed or imported their own fee for this
 *  track, the cost uses it (their deposit fee, else the published one) and carries "לפי הדוח שלך"; otherwise the published fee. The
 *  amounts come from useMyAmounts. The type's average beside it stays on the published fees (typeFeeAvg), on the same amounts. */
export function cardFeeCost(f: Pick<FundX, 'prod' | 'fee' | 'depfee'>, my: Pick<MyProduct, 'fee' | 'depfee'> | null | undefined, base: FeeBase | null): { cost: number | null; ownFee: boolean; x: Pick<FundX, 'prod' | 'fee' | 'depfee'> } {
  const ownFee = my?.fee != null && Number.isFinite(my.fee);
  const x = ownFee ? { prod: f.prod, fee: my!.fee!, depfee: my!.depfee ?? f.depfee } : f;
  return { cost: feeParts(x, true, base).total, ownFee, x };
}

/** the product tile's isometric art */
export const prodArt = (prod: string) => (tileOf(prod) ?? TILES[0]).art;

export function CardMonths({ c, n }: { c: CardCtx; n: 6 | 12 }) {
  const { f, h, cat, members, tn, host, door } = c;
  const tv = useMemo(() => trackVsType(h, f, cat, n), [h, f, cat, n]);
  const amt = useMyAmounts({ k: f.k });
  const { cost, ownFee } = cardFeeCost(f, c.my, amt.base);
  const avgFee = cat ? typeFeeAvg(members, amt.base) : null;
  const newest = tv.newest ?? c.asof;
  const first = tv.rows[0];
  const sentence = cardWords(newest, first?.v, cat ? first?.avg : null, { y12: tv.y12.v, type: cat ? tn : null, months: tv.months });

  const footer: MonthGridSum[] = [
    { key: 'half', label: 'חצי שנה', vals: [tv.half.v], avg: tv.half.avg },
    { key: 'y12', label: 'שנה אחרונה', vals: [tv.y12.v], avg: tv.y12.avg },
  ];
  if (f.fee != null) footer.push({ key: 'fee', id: 'fee-line', label: FEE_ROW, sub: ownFee ? feeRowSub(amt.own).replace(' ›', ` · ${OWN_FEE_TAG} ›`) : feeRowSub(amt.own), vals: [cost], avg: cat ? avgFee : null, unit: 'ils', onOpen: () => host.openSheet({ t: 'fee' }) });

  const typeSheet = (p: number) => host.openSheet(`type:${p}`);
  const place = c.old ? null : longestPlace(f, members, c.asof);
  const peers = useMemo(() => (c.old ? [] : compareKeys([{ k: f.k }], c.funds as unknown as VFund[]).filter((k) => k !== f.k)), [c.old, f.k, c.funds]);
  const labels = useMemo(() => { const all = trackLabels(members); return new Map(members.map((m, i) => [m.k, all[i]])); }, [members]);
  const peerLabels = peers.map((k) => labels.get(k) ?? k);

  return (
    <div className="fc-lens">
      <Takeaway id="month-insight" text={sentence} />
      <MonthGrid id="month-grid" cols={[{ k: f.k, label: 'המסלול', color: trackColor(0) }]} showAvg={!!cat}
        avgLabel={[AVG_HEAD, avgHeadSub(tn, c.avgN)]} onAvg={cat ? () => typeSheet(newest) : undefined}
        rows={tv.rows.map((r) => ({ p: r.p, vals: [r.v], avg: r.avg }))} footer={footer} mark="none" labels={door === 'pro' ? 'short' : 'auto'}
        onCell={(rk, k) => (k == null ? (cat ? typeSheet(Number(rk)) : undefined) : host.openSheet({ t: 'month', p: rk }))} />
      {cat && c.rankN > 1 && !c.old ? (
        <button type="button" className="ro-rowlink" id="who-best" onClick={() => typeSheet(newest)} aria-haspopup="dialog">
          <span><NumText t={cardWhoBest(newest, c.rankN)} /></span><span aria-hidden="true">›</span>
        </button>
      ) : null}
      {peers.length ? (
        <Link className="fc-cta" id="cmp-cta" to={`/funds/compare?k=${[f.k, ...peers].join(',')}`}>
          <Icon name="compare" /><span>{cmpCta(peerLabels)}</span>
        </Link>
      ) : null}
      <CardRows c={c} place={place ? placeLine(place.per, place.pl, c.asof) : null} />
      <StampLine asof={c.asof} onWhy={() => host.openSheet({ t: 'why' })} />
    </div>
  );
}

/** "במילים פשוטות", "זה המסלול שלי", "פרטים מקצועיים" (3.2 #7; mockup v4). An old-generation policy has no place, so its plain row
 *  does not promise one (T-C6: no "מקום" on its card). Saver door: all three (the second hidden once saved);
 *  agent and Pro have their own lens ("להחלטה", "מקצועי") and the saver's plain-words sheet renders for the saver only. */
export function CardRows({ c, place }: { c: CardCtx; place: string | null }) {
  if (c.door !== 'saver') return null;
  return (
    <div className="fc-rows">
      <Row id="row-plain" icon={<ProdIcon art={prodArt(c.f.prod)} size={30} />} title={CARD_ROWS.plain.title} sub={place ? <NumText t={place} /> : c.old ? CARD_ROWS.plain.sub.replace('מקום, ', '') : CARD_ROWS.plain.sub}
        go="›" onClick={() => c.host.openSheet('plain')} dialog />
      {c.saved ? null : <Row id="row-mine" icon={<Icon3D name="home" size={30} />} title={CARD_ROWS.mine.title} sub={CARD_ROWS.mine.sub} go="＋" onClick={c.onMine} />}
      <Row id="row-pro" icon={<Icon3D name="market" size={30} />} title={CARD_ROWS.pro.title} sub={CARD_ROWS.pro.sub} go="›" onClick={() => c.setView('pro')} />
    </div>
  );
}
function Row({ id, icon, title, sub, go, onClick, dialog }: { id: string; icon: ReactNode; title: string; sub: ReactNode; go: string; onClick: () => void; dialog?: boolean }) {
  return (
    <button type="button" className="fc-row" id={id} onClick={onClick} aria-haspopup={dialog ? 'dialog' : undefined}>
      <span className="fc-ic" aria-hidden="true">{icon}</span>
      <span className="fc-rt"><b>{title}</b><small>{sub}</small></span>
      <span className="fc-go" aria-hidden="true">{go}</span>
    </button>
  );
}

/* ---------------- the card's month (or year) sheet ---------------- */

const yearOf = (p: number) => Math.floor(p / 100);
const valAt = (s: { p: number[]; y: (number | null)[] } | null | undefined, p: number): number | null => {
  if (!s) return null; const i = s.p.indexOf(p); const v = i < 0 ? null : s.y[i];
  return v == null || !Number.isFinite(v) ? null : v;
};

/** "אוקטובר 2026": the track's bar against the type's average, above / below it, "חודש אחד לא אומר הרבה", the link to every track of
 *  the type that month (the type-month sheet), and the previous / next month without closing. `p`: yyyymm, or yyyy for a year row. */
export function CardMonthSheet({ c, p, onClose }: { c: CardCtx; p: string; onClose: () => void }) {
  const { f, h, cat, host, tn } = c;
  const isYear = /^\d{4}$/.test(p), pv = Number(p);
  const months = isYear ? h.p.filter((x) => yearOf(x) === pv) : [pv];
  const v = isYear ? cum(months.map((m) => valAt(h, m))) : valAt(h, pv);
  const avg = !cat ? null : isYear ? cum(months.map((m) => valAt(cat, m))) : valAt(cat, pv);
  const have = h.p.filter((x) => valAt(h, x) != null);
  const older = isYear ? (have.some((x) => yearOf(x) === pv - 1) ? pv - 1 : null) : (have.includes(addMonths(pv, -1)) ? addMonths(pv, -1) : null);
  const newer = isYear ? (have.some((x) => yearOf(x) === pv + 1) ? pv + 1 : null) : (have.includes(addMonths(pv, 1)) ? addMonths(pv, 1) : null);
  const go = (x: number) => host.openSheet(isYear ? { t: 'year', y: String(x) } : { t: 'month', p: String(x) });
  const lab = (x: number) => (isYear ? String(x) : monthShortYear(x));
  const all = [v, avg].filter((x): x is number => x != null), lo = Math.min(0, ...all), hi = Math.max(0, ...all), span = hi - lo || 1, z = ((0 - lo) / span) * 100;
  const bar = (x: number, i: number, avgBar = false) => (
    <span className="ms-t" style={{ '--z': `${z}%` } as CSSProperties} aria-hidden="true">
      <i className={`${x < 0 ? 'neg' : 'pos'}${avgBar ? ' avg' : ''}`} style={{ '--l': `${(x < 0 ? ((x - lo) / span) * 100 : z).toFixed(1)}%`, '--w': `${Math.max(1.5, (Math.abs(x) / span) * 100).toFixed(1)}%`, '--i': i } as CSSProperties} />
    </span>
  );
  const vs = monthSheetVs(v, avg, c.avgN, tn);
  return (
    <DeeperSheet open onClose={onClose} id="month-sheet-dlg" title={isYear ? p : monthFull(pv)} sub={isYear ? MONTH_SHEET_SUB.replace('בחודש הזה', 'בשנה הזו') : MONTH_SHEET_SUB}
      footer={<div className="cs-nav">
        <button type="button" className="cs-btn" id="month-older" disabled={older == null} onClick={() => older != null && go(older)}>{older != null ? `→ ${lab(older)}` : '→'}</button>
        <button type="button" className="cs-btn" id="month-newer" disabled={newer == null} onClick={() => newer != null && go(newer)}>{newer != null ? `${lab(newer)} ←` : 'האחרון ←'}</button>
      </div>}>
      <div id="month-sheet" key={p}>
        {v == null ? <p className="cs-note">אין נתונים {isYear ? 'לשנה הזו' : 'לחודש הזה'}.</p> : (
          <div className="ms-bar" style={{ '--c': trackColor(0) } as CSSProperties}>
            <span className="ms-l"><i aria-hidden="true" />המסלול</span>
            {bar(v, 0)}
            <span className="ms-v"><Fig v={v} d={isYear ? 1 : 2} src={isYear ? undefined : () => monthProv(f, h, pv)} /></span>
          </div>
        )}
        {avg != null ? (
          <div className="ms-bar avg">
            <span className="ms-l">{AVG_HEAD}</span>
            {bar(avg, 1, true)}
            <span className="ms-v"><Fig v={avg} d={isYear ? 1 : 2} src={isYear || !cat ? undefined : () => catMonthProv(c.typeKey, cat, pv, 'gross')} /></span>
          </div>
        ) : null}
        <ul className="ro-facts">
          {vs ? <li><NumText t={vs} /></li> : null}
          {isYear ? null : <li>{ONE_MONTH_NOTE}</li>}
        </ul>
        {!isYear && cat && c.rankN > 1 && !c.old ? (
          <button type="button" className="ro-rowlink" id="month-all" onClick={() => host.openSheet(`type:${pv}`)}>
            <span><NumText t={allTracksIn(c.rankN, pv)} /></span><span aria-hidden="true">›</span>
          </button>
        ) : null}
      </div>
    </DeeperSheet>
  );
}

/* ---------------- the card's fee sheet ---------------- */

/** "דמי ניהול, בשקלים": the fee row's sum on the reader's amounts ("על הסכומים שלך") or the example ("לדוגמה, על סכום אחד לכולם"),
 *  from the balance and from the deposits; "לחשב על הסכומים שלי" for a saved track still on the example; the fees tool. */
export function CardFeeSheet({ c, onClose }: { c: CardCtx; onClose: () => void }) {
  const { f, host } = c;
  const nav = useNavigate();
  const amt = useMyAmounts({ k: f.k });
  const own = cardFeeCost(f, c.my, amt.base), x = feeParts(own.x, true, amt.base);
  const deposits = prodHasDeposit(f.prod) && typeHasDepositFee(c.members);
  const base = amountsBase({ own: amt.own, depositOwn: amt.depositOwn, deposits });
  const tool = `/funds/tools/fees?cat=${encodeURIComponent(catKey(f))}&k=${encodeURIComponent(f.k)}`;
  return (
    <DeeperSheet open onClose={onClose} id="fee-sheet-dlg" title={FEE_SHEET_TITLE} sub={<NumText t={feeSheetSub(amt.own, base)} />}
      footer={<button type="button" className="cs-btn pri" id="fee-to-tool" onClick={() => backThen(() => nav(tool))}>{FEE_SHEET_TO_TOOL}</button>}>
      <dl className="fc-dl" id="fee-sheet">
        <dt><NumText t={feeFromBalance(x.balance, own.x.fee ?? 0)} /></dt><dd><NumText t={ilsSym(x.acc)} /></dd>
        {x.monthly > 0 && (own.x.depfee ?? 0) > 0 ? <><dt><NumText t={feeFromDeposits(x.monthly, own.x.depfee ?? 0)} /></dt><dd><NumText t={ilsSym(x.dep)} /></dd></> : null}
        <dt><b>{FEE_TOTAL_YEAR}</b>{own.ownFee ? <small className="fc-own"> · {OWN_FEE_TAG}</small> : null}</dt><dd><b>{shekels(x.total)}</b></dd>
      </dl>
      {c.saved && !amt.own ? (
        <button type="button" className="ro-rowlink" id="fee-calc" onClick={() => host.openSheet(`amounts:${f.k}`)}><span>{FEE_SHEET_CALC}</span><span aria-hidden="true">›</span></button>
      ) : null}
      <p className="cs-note">{FEE_SHEET_NOTE}</p>
    </DeeperSheet>
  );
}

/** the ranked count of a type (the type-month sheet's "כל N המסלולים") */
export const rankedCount = (members: FundX[]) => members.filter(rankable).length;
