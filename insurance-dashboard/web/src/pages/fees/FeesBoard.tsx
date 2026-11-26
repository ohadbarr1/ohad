import { useMemo, type ReactNode } from 'react';
import { Scoreboard, type ScoreRowData } from '../../components/Scoreboard';
import { Takeaway } from '../../components/Takeaway';
import { NumText } from '../../components/NumText';
import type { FundX } from '../../lib/funds';
import { feeBoard, likeForLike, typeFeeAvg, type CareerAssume, type FeeMode, type FeeRow } from '../../lib/pageMonths';
import {
  FEES_MINE_HEAD, NONE_YET, SELF_HEAD, SELF_LINE, TAG_CHEAPEST, amountsBase, calcMine, feeSub, feesAvgLabel, feesBoardHead, feesMinePos,
  feesStamp, feesUnit, feesWords, numIso, typeName, ASSUME_LINK,
} from '../../lib/pageWords';
import { trackLabels } from '../compare/tracks';
import { BALANCE_EX, RETIRE_AGE, exampleMonthly } from '../../lib/retire';
import type { FeeBase } from '../../lib/feeExample';

/* The fees tool's board (rollout spec §7.2 #4–#7, §16.1 2b, §17.1 1f, §18.2 #2/#3/#5, mockup v4 `pageFees`; T-F1, T-F2):
   the sentence (mine first), the reader's row pinned above the list when it is not among the first four, the like-for-like board in
   shekels cheapest first ("הכי זול" on the cheapest, the reader's row tinted with "שלי" in the saver door only), the mean as the closing
   line ("ממוצע 5 המסלולים · בשנה", lib/pageMonths typeFeeAvg: the same function as the card's fee row), the self-managed and IRA tracks
   under "בניהול אישי · לא בהשוואה", tracks with no published fee last ("אין עדיין"), "לחשב על הסכומים שלי" and the stamp naming the
   example. Every ₪ figure comes from lib/pageMonths feeBoard on the amounts of lib/myAmounts (never read here from storage). */

export interface BoardAmounts { own: boolean; depositOwn: boolean; base: FeeBase | null; balance: number | null; monthly: number | null }
export interface FeesBoardProps {
  /** the type's tracks as the pages list them (lib/pageMonths typeMembers): self-managed included, flagged here */
  members: FundX[];
  typeKey: string;
  prod: string;
  /** the reader's saved track of this type (saver door only), else null */
  mineK: string | null;
  /** the reader's own fees from a statement or the clearing-house file (O9): replace the track's average in their row only */
  ownFee?: { fee?: number | null; depfee?: number | null } | null;
  amounts: BoardAmounts;
  /** the base wording's deposit clause: the product has deposits and (the career lens, or a track of the type charges a deposit fee) */
  deposits: boolean;
  mode: FeeMode;
  career?: CareerAssume;
  ageOwn?: boolean;
  /** "עד הפרישה": what the return is (the category's published 10 years, sourced; or an assumption), after the stamp */
  retNote?: ReactNode;
  saver: boolean;
  asof: number;
  onRow: (k: string) => void;
  onAmounts: () => void;
  onAssume: () => void;
}

const ilsCell = (v: number) => <bdi dir="ltr">₪{Math.round(v).toLocaleString('en-US')}</bdi>;
const GOLD = 'var(--s7)', GREY = 'var(--neutral)';

export function FeesBoard(p: FeesBoardProps) {
  const { members, typeKey, prod, mineK, ownFee, amounts, deposits, mode, career, saver, asof } = p;
  const retire = career?.retire ?? RETIRE_AGE;
  // O9: the reader's own fee pair in their own row only (the mean stays on the tracks' published averages, as on the card)
  const priced = useMemo(() => members.map((f) => (mineK && f.k === mineK && ownFee && (ownFee.fee != null || ownFee.depfee != null)
    ? { ...f, fee: ownFee.fee ?? f.fee, depfee: ownFee.depfee ?? f.depfee } : f)), [members, mineK, ownFee]);
  const b = useMemo(() => feeBoard(priced, { mineK, a: amounts.base, mode, career }), [priced, mineK, amounts.base, mode, career]);
  const avg = useMemo(() => typeFeeAvg(members, amounts.base, mode, career ?? {}), [members, amounts.base, mode, career]);
  const lab = useMemo(() => {
    const lfl = likeForLike(members), all = trackLabels(members), l = trackLabels(lfl), m = new Map<string, string>();
    members.forEach((f, i) => m.set(f.k, all[i]));
    lfl.forEach((f, i) => m.set(f.k, l[i]));
    return m;
  }, [members]);
  const own = (f: FundX) => !!mineK && f.k === mineK && !!ownFee && (ownFee.fee != null || ownFee.depfee != null);
  const row = (r: FeeRow, o: { color?: string; tag?: boolean } = {}): ScoreRowData => ({
    k: r.k, label: lab.get(r.k) ?? r.f.grp, color: o.color ?? GOLD, value: r.v, place: null,
    sub: <><NumText t={feeSub(r.f.fee, r.f.depfee)} />{own(r.f) ? ' · שלך' : null}</>,
    tag: o.tag && r.cheapest ? TAG_CHEAPEST : undefined, mine: saver && r.mine,
  });
  const rows = b.rows.map((r) => row(r, { tag: true }));
  const n = b.rows.length, unit = feesUnit(mode, retire);
  const base = amountsBase({ own: amounts.own, depositOwn: amounts.depositOwn, deposits });
  const text = feesWords(b.rows.map((r) => ({ k: r.k, label: lab.get(r.k) ?? r.f.grp, v: r.v })), saver ? mineK : null,
    { mode, own: amounts.own, base, age: career?.age, ageOwn: p.ageOwn, retire });
  const mineRow = saver && b.pin ? rows[b.mineIdx] : null;
  const stamp = feesStamp({
    own: amounts.own, base, balance: amounts.own && amounts.balance != null ? amounts.balance : BALANCE_EX,
    monthly: amounts.depositOwn && amounts.monthly != null ? amounts.monthly : exampleMonthly(prod).v, deposits, asof,
    career: mode === 'career' && career ? { age: career.age ?? 38, retire, ret: career.ret ?? 4 } : null,
  });
  const head = (title: ReactNode, aside: ReactNode) => <div className="fb-bh"><b>{title}</b><span>{aside}</span></div>;
  return (
    <>
      <Takeaway text={text} />
      {mineRow ? (
        <Scoreboard id="board-mine" rows={[mineRow]} format={ilsCell} bars="none" mineWord={saver ? 'שלי' : null} onOpen={p.onRow}
          head={head(FEES_MINE_HEAD, <NumText t={feesMinePos(b.mineIdx, n)} />)} />
      ) : null}
      {n ? (
        <Scoreboard rows={rows} format={ilsCell} bars="always" mineWord={saver ? 'שלי' : null} onOpen={p.onRow}
          head={head(<NumText t={feesBoardHead(n, typeName(typeKey))} />, <NumText t={unit} />)}
          benchmark={avg != null ? { label: <NumText t={feesAvgLabel(n, mode, retire)} />, value: avg } : null} />
      ) : null}
      {b.self.length ? (
        <Scoreboard id="board-self" rows={b.self.map((r) => row(r, { color: GREY }))} format={ilsCell} bars="none" mineWord={saver ? 'שלי' : null} onOpen={p.onRow}
          head={<>{head(SELF_HEAD, <NumText t={`${numIso(b.self.length)} מסלולים`} />)}<p className="fb-selfline">{SELF_LINE}</p></>} />
      ) : null}
      {b.none.length ? (
        <Scoreboard id="board-none" rows={b.none.map((f) => ({ k: f.k, label: lab.get(f.k) ?? f.grp, color: GREY, value: null, place: null }))} bars="none" onOpen={p.onRow}
          head={head('בלי דמי ניהול מפורסמים', NONE_YET)} />
      ) : null}
      <button type="button" className="ro-rowlink fb-calc" id="calc-mine" onClick={p.onAmounts} aria-haspopup="dialog">
        <span className="fb-ic" aria-hidden="true">✎</span><span className="fb-calct">{calcMine(amounts.own, deposits)}</span><span aria-hidden="true">›</span>
      </button>
      <p className="ro-stamp" id="stamp"><NumText t={stamp} />{mode === 'career' && p.retNote ? <> · {p.retNote}</> : null} · <button type="button" onClick={p.onAssume} aria-haspopup="dialog">{ASSUME_LINK}</button></p>
    </>
  );
}
