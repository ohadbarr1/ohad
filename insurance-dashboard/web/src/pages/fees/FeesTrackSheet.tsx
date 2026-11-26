import { useNavigate } from 'react-router-dom';
import { DeeperSheet, SheetSection } from '../../components/DeeperSheet';
import { backThen } from '../../components/Sheet';
import { perLabel } from '../../components/PeriodSeg';
import { Fig, Plain, catWin, catWinProv, winProv } from '../../components/compare/sheetKit';
import { fundP } from '../../lib/market';
import { nf } from '../../lib/format';
import { TRAY_MAX, annual, catKey, pc, refOf, retOf, useTray, type CatX, type FundX, type FundsFile, type Per } from '../../lib/funds';
import type { MyProduct } from '../../lib/mine';
import type { Door } from '../../lib/door';
import { ADD_COMPARE, BEFORE_FEES, IN_COMPARE, TO_CARD, typeName } from '../../lib/pageWords';
import '../../styles/compare-sheets.css';

/* Build review B2 (novice B2 #2): the track sheet a fees-board row opens. The frozen compare TrackSheet speaks the compare page's words
   ("כמה הרוויח", "ממוצע הסוג") and carries compare's footer (☆ / remove); the rollout pages speak the card's: "כמה עשה" and
   "הממוצע ב<סוג>". Same figures and sources (components/compare/sheetKit: the published gross return per period, the type's
   asset-weighted average from funds/cat.json, the published fees), and the screener sheet's footer: "לכרטיס המסלול ›" and
   "＋ להשוואה". The reader's own fee shows in the saver door only (the agent's and Pro's doors carry no "שלי"). */

const PERS: Per[] = ['m1', 'ytd', 'y12', 'a3', 'a5'];

export interface FeesTrackSheetProps {
  k: string;
  file: FundsFile | null;
  cats: Record<string, CatX> | null | undefined;
  door: Door;
  /** the reader's saved record of this track (saver door), for the own fee */
  own?: MyProduct | null;
  onClose: () => void;
}

export function FeesTrackSheet({ k, file, cats, door, own, onClose }: FeesTrackSheetProps) {
  const nav = useNavigate();
  const tray = useTray();
  const f = (file?.funds as FundX[] | undefined)?.find((x) => x.k === k);
  const asof = file?.asof ?? 0;
  const saver = door === 'saver';
  const ck = f ? catKey(f) : '', cat = f && cats ? cats[ck] ?? null : null, type = f ? typeName(ck) : '';
  const ownFee = saver && own && own.fee != null && Number.isFinite(own.fee) ? own : null;
  return (
    <DeeperSheet open onClose={onClose} id="track-sheet-dlg" title={f?.name ?? (file ? 'המסלול לא נמצא' : '…')}
      sub={f ? <>מס׳ קופה <span className="num">{f.id}</span> · {type}{f.closed || f.gone ? ' · נסגר' : ''}</> : undefined}
      footer={f ? <div className="cs-nav">
        <button type="button" className="cs-btn pri" id="to-card" onClick={() => backThen(() => nav(`/funds/${f.k}`))}>{TO_CARD}</button>
        {f.gone ? null : <button type="button" className="cs-btn" aria-pressed={tray.has(f.k)} disabled={!tray.has(f.k) && tray.keys.length >= TRAY_MAX} onClick={() => tray.toggle(f.k)}>{tray.has(f.k) ? IN_COMPARE : ADD_COMPARE}</button>}
      </div> : undefined}>
      {!f ? <div className="cs-skel" /> : (
        <div id="track-sheet" className="fts">
          <SheetSection title="כמה עשה" open>
            <div className="ts-tiles">
              {PERS.map((per) => {
                const v = retOf(f, per).v, d = per === 'm1' ? 2 : 1, a = catWin(cat, per, asof, 'gross');
                return (
                  <div className="ts-tile" key={per}>
                    <small>{perLabel(per, door, asof)}{annual(per) ? ', בשנה' : ''}</small>
                    <Fig v={v} d={d} className="big" src={() => winProv(f, per, 'gross', asof, file)} />
                    {cat ? <><em>{`הממוצע ב${type}`}</em><Fig v={a} d={d} tone={false} className="avg" src={() => catWinProv(ck, cat, per, asof, 'gross')} /></> : null}
                  </div>
                );
              })}
            </div>
            <p className="cs-note">{BEFORE_FEES}.{f.a5 == null ? ' אין עדיין 5 שנים של נתונים.' : ''}</p>
          </SheetSection>
          <SheetSection title="כמה זה עולה" open>
            <dl className="ts-dl">
              <dt>דמי ניהול מהחיסכון, בשנה</dt>
              <dd><Plain v={f.fee} className="b" src={() => fundP(refOf(f), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', pc(f.fee))} /></dd>
              {f.depfee != null ? <><dt>דמי ניהול מכל הפקדה</dt><dd><Plain v={f.depfee} className="b" src={() => fundP(refOf(f), asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', pc(f.depfee))} /></dd></> : null}
              {ownFee ? <><dt>דמי הניהול שלך, לפי הדוח שלך</dt><dd><bdi dir="ltr" className="n b">{nf(ownFee.fee!, 2)}%</bdi>{ownFee.depfee != null ? <small> · מכל הפקדה <bdi dir="ltr" className="n">{nf(ownFee.depfee, 2)}%</bdi></small> : null}</dd></> : null}
            </dl>
            <p className="cs-note">{ownFee ? 'הממוצע בפועל של כל החוסכים במסלול, ומתחתיו דמי הניהול שהזנת מהדוח השנתי.' : 'הממוצע בפועל של כל החוסכים במסלול. דמי הניהול שלך כתובים בדוח השנתי.'}</p>
          </SheetSection>
        </div>
      )}
    </DeeperSheet>
  );
}
