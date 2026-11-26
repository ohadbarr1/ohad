import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CompareTray, FundsNav } from '../../components/FundsNav';
import { Icon } from '../../components/Icon';
import { NumText } from '../../components/NumText';
import { Scoreboard, type ScoreRowData } from '../../components/Scoreboard';
import { PeriodSeg, perLabel } from '../../components/PeriodSeg';
import { Takeaway } from '../../components/Takeaway';
import { StampLine } from '../../components/StampLine';
import { GuardLine } from '../../components/GuardLine';
import { DeeperSheet } from '../../components/DeeperSheet';
import { backThen } from '../../components/Sheet';
import { ProdIcon } from '../../components/compare/PickerSheet';
import { useSheetHost } from '../../lib/sheetHost';
import { TILES } from '../../lib/pickTiles';
import { annual, useTray, TRAY_MAX, type FundX, type Per } from '../../lib/funds';
import { labelMap } from '../../lib/trackNames';
import {
  ADD_COMPARE, CLEAR_FILTER, EMPTY_FILTER, IN_COMPARE, OLD_POLICY_GUARD, TO_CARD, TO_HUB, WHY_TEXT, numIso, pctSigned, prodLabel,
  screenBench, screenHead, screenSub, screenWords, selfMore, tieNote, typeLabel, typeName,
} from '../../lib/pageWords';
import type { Board, BoardRow, ColKey } from './screenCalc';
import type { DoorW } from './ScreenFilters';
import '../../styles/rollout.css';
import '../../styles/compare-sheets.css';
import '../../components/compare/picker.css';
import '../../styles/funds.css';

/* Rollout L2-b, T-S1 / T-S3: the screener on a phone (spec 4.2 as amended by 16.1 4a–4e, 17.1 3a/6a/6b, 18.5; mockup v4 frames 6–7).
   Head "מסלולים" with "5 מסלולים מהסוג הזה · 10/26"; three 44-px pills (product ▾ · type ▾ · סינון); <PeriodSeg> (the one control that
   changes the board; default five years, D7); the sentence (quiet); one <Scoreboard> for one period: five rows a screen, shared places
   as one number with "כמעט שווים" only where some rows do not share, bars only when every figure is positive, the quiet line wraps and
   never truncates (saver: the other period; agent: fees and the actuarial balance; Pro: percentile, fee, Sharpe, equity), "שלי" on the
   saver's own tracks, a "＋" beside each row for the compare tray; the type's average closes the board, then the tie note; self-managed
   and IRA tracks are listed apart, unranked; the 46-px row to the hub; the stamp. A row opens the track sheet ("לכרטיס המסלול ›",
   "＋ להשוואה") with every per-track figure the desktop table carries, each opening its source.
   Sheets live in the address (?sheet=prod | trk | filters | policy | track:<k> | why), written with replace. */

export interface ScreenGroup {
  k: string; prod: string; track: string;
  board: Board;
  /** the rows that pass the filters (the board's places are kept: filters hide rows, they do not re-rank) */
  rows: BoardRow[]; self: BoardRow[];
  members: FundX[];
  avg: number | null;
}
export interface Measure { key: ColKey; label: string; asc: boolean; fmt: (v: number) => ReactNode; unit?: (f: FundX) => string | undefined }
export interface ScreenPhoneProps {
  door: DoorW;
  asof: number;
  per: Per;
  setPer: (p: Per) => void;
  prod: string; T: string; all: string;
  prods: string[];
  tracks: [string, number][];
  trackCount: (t: string) => number;
  setProdTrack: (prod: string, track: string | null) => void;
  groups: ScreenGroup[];
  shownN: number;
  nFilters: number;
  real: boolean;
  measure: Measure | null;
  clearMeasure: () => void;
  mineKeys: Set<string>;
  val: (f: FundX, p: Per) => number | null;
  /** the desktop's sourced cells and flags, reused in the track sheet */
  cell: (f: FundX, c: ColKey) => ReactNode;
  place: (f: FundX) => ReactNode;
  ret: (f: FundX, p: Per) => ReactNode;
  flags: (f: FundX) => ReactNode;
  mgr: (f: FundX) => ReactNode;
  find: (k: string) => FundX | undefined;
  filters: (open: boolean, onClose: () => void) => ReactNode;
  clearFilters: () => void;
  refused: boolean;
  sharedPolicy: boolean;
  method: ReactNode;
}

const PERS: Per[] = ['m1', 'ytd', 'y12', 'a3', 'a5'];


/** the 46-px "＋" beside a row: in and out of the compare tray, never opening a sheet */
function AddBtn({ k, label }: { k: string; label: string }) {
  const t = useTray();
  const on = t.has(k), full = !on && t.keys.length >= TRAY_MAX;
  return (
    <button type="button" className="scr-add" aria-pressed={on} disabled={full} aria-label={on ? `הוצאה מההשוואה: ${label}` : `הוספה להשוואה: ${label}`}
      title={full ? `המגש מלא: עד ${TRAY_MAX} מסלולים` : undefined} onClick={(e) => { e.stopPropagation(); t.toggle(k); }}>
      <span aria-hidden="true">{on ? '✓' : '＋'}</span>
    </button>
  );
}

export function ScreenPhone(p: ScreenPhoneProps) {
  const host = useSheetHost();
  const nav = useNavigate();
  const tray = useTray();
  const [open, setOpen] = useState<string[]>([]);
  const [selfOpen, setSelfOpen] = useState<string[]>([]);
  const saver = p.door === 'saver';
  const d = p.per === 'm1' ? 2 : 1;
  const multi = p.groups.length > 1 || p.T === p.all;
  const shown = (k: string) => !multi || p.groups.length <= 2 || open.includes(k);
  const own = host.own?.[0] ?? null;
  const close = host.closeSheet;
  const leave = (to: string) => backThen(() => nav(to));
  const pick = (patch: () => void) => backThen(patch);

  /* ---- rows ---- */
  const labelsOf = (g: ScreenGroup) => labelMap(g.members, g.board.rows.filter((r) => r.kind === 'ranked').map((r) => r.f));
  const subOf = (f: FundX): ReactNode => {
    const s = screenSub(p.door, { m1: p.val(f, 'm1'), y12: p.val(f, 'y12'), fee: f.fee, depfee: f.depfee, act: f.act, st: f.st, sharpe: f.sharpe, pr: f.pr }, p.per, p.asof);
    if (!p.measure) return <NumText t={s} />;
    const r = p.val(f, p.per);
    return <><span>{perLabel(p.per, p.door, p.asof)}: </span><NumText t={r == null ? numIso('–') : pctSigned(r, d)} />{saver ? null : <> · <NumText t={s} /></>}</>;
  };
  const rowOf = (r: BoardRow, lab: Map<string, string>): ScoreRowData => ({
    k: r.f.k, label: lab.get(r.f.k) ?? r.f.name, color: 'var(--link)', sub: subOf(r.f), value: r.v,
    unit: p.measure?.unit?.(r.f), place: r.pl?.place ?? null, tie: !!r.pl?.chip,
    tag: r.kind === 'gone' ? 'נסגר' : r.kind === 'old' ? 'סגור להצטרפות' : r.kind === 'self' ? 'בניהול אישי' : undefined,
    mine: saver && p.mineKeys.has(r.f.k),
  });
  const boardOf = (g: ScreenGroup, id: string) => {
    const lab = labelsOf(g);
    const ranked = g.rows.filter((r) => r.kind === 'ranked'), anyShared = ranked.some((r) => r.pl?.shared);
    const bench = p.measure || p.real ? null : { label: screenBench(p.door, typeName(g.k), p.per), value: g.avg };
    return (
      <>
        {g.rows.length ? (
          <Scoreboard id={id} rows={g.rows.map((r) => rowOf(r, lab))} decimals={d} benchmark={bench} bars={p.measure ? 'none' : 'auto'} mineWord={saver ? undefined : null}
            format={p.measure ? p.measure.fmt : undefined} onOpen={(k) => host.openSheet({ t: 'track', k })}
            trailing={(k) => (g.rows.find((r) => r.f.k === k)?.f.gone ? null : <AddBtn k={k} label={lab.get(k) ?? k} />)}
            note={!p.measure && anyShared ? <span id={id === 'board' ? 'tie-note' : undefined}><NumText t={tieNote(p.per, p.asof)} /></span> : undefined} />
        ) : null}
        {g.self.length ? (
          <div className="scr-self">
            <button type="button" className="scr-self-h" id={`${id}-self-btn`} aria-expanded={selfOpen.includes(g.k)} onClick={() => setSelfOpen(selfOpen.includes(g.k) ? selfOpen.filter((x) => x !== g.k) : [...selfOpen, g.k])}>
              <span><b>בניהול אישי · לא בדירוג · <NumText t={numIso(g.self.length)} /></b><small>כל חוסך בוחר בעצמו את ההשקעות, ולכן המסלולים האלה לא מדורגים מול האחרים.</small></span>
              <i aria-hidden="true">{selfOpen.includes(g.k) ? '▾' : '◂'}</i>
            </button>
            {selfOpen.includes(g.k) ? <Scoreboard id={`${id}-self`} rows={g.self.map((r) => ({ ...rowOf(r, lab), tag: undefined, place: null }))} decimals={d} bars="none" mineWord={saver ? undefined : null}
              format={p.measure ? p.measure.fmt : undefined} onOpen={(k) => host.openSheet({ t: 'track', k })} trailing={(k) => <AddBtn k={k} label={lab.get(k) ?? k} />} /> : null}
          </div>
        ) : null}
      </>
    );
  };

  /* ---- the sentence ---- */
  const one = p.groups.length === 1 && !multi ? p.groups[0] : null;
  const sentence = (() => {
    if (!one || p.measure) return null;
    const ranked = one.rows.filter((r) => r.kind === 'ranked'), lab = labelsOf(one);
    if (!ranked.length && one.rows.some((r) => r.kind === 'old')) return OLD_POLICY_GUARD;
    return screenWords(p.per, ranked.map((r) => ({ label: lab.get(r.f.k) ?? r.f.name, v: r.v })), p.asof);
  })();

  /* ---- head ---- */
  // build review B1 (P2-1): the head counts the tracks RANKED for the period on screen, and names the self-managed remainder
  // (the same rule as pageMonths typeCount on the card, the hub and the type-month sheet)
  const rankedN = (g: ScreenGroup) => g.rows.filter((r) => r.kind === 'ranked').length;
  const prodName = p.prod === p.all ? 'כל המוצרים' : prodLabel(p.prod);
  const trackName = p.T === p.all ? 'כל הסוגים' : typeLabel(p.T);
  // the hub opens on the reader's own product (D5). Not /funds?prod=…: App.tsx (frozen) still redirects /funds?prod= to this page.
  const hubTo = p.prod === p.all ? '/funds' : `/funds?prod=${encodeURIComponent(p.prod)}`;

  /* ---- the track sheet ---- */
  const tk = host.cmp?.t === 'track' ? host.cmp.k : null;
  const tf = tk ? p.find(tk) : undefined;
  const tg = tf ? p.groups.find((g) => g.members.some((m) => m.k === tf.k)) : undefined;
  const tlab = tf && tg ? labelsOf(tg).get(tf.k) ?? tf.name : tf?.name ?? '';
  const kv = (l: string, v: ReactNode) => <><dt>{l}</dt><dd>{v}</dd></>;

  return (
    <div className="ro-page scr-page">
      <div className="pagehead scr-head"><div>
        <h1><span className="icotile"><Icon name="funds" /></span>מסלולים</h1>
        <div className="sub">{one ? <NumText t={screenHead(rankedN(one), p.asof, one.self.length)} /> : <><NumText t={numIso(p.shownN)} /> מסלולים · <NumText t={numIso(`${String(p.asof % 100).padStart(2, '0')}/${String(Math.floor(p.asof / 100)).slice(2)}`)} /></>}</div>
      </div></div>
      <FundsNav />
      <CompareTray />
      <div className="scr-pick" id="screen-pick">
        <button type="button" className="scr-pill" id="prod-pill" aria-haspopup="dialog" onClick={() => host.openSheet('prod')}><span>{prodName}</span><i aria-hidden="true">⌄</i></button>
        <button type="button" className="scr-pill" id="track-pill" aria-haspopup="dialog" onClick={() => host.openSheet('trk')}><span>{trackName}</span><i aria-hidden="true">⌄</i></button>
        <button type="button" className="scr-pill f" id="filter-btn" aria-haspopup="dialog" onClick={() => host.openSheet('filters')}><Icon name="sliders" /><span>סינון{p.nFilters ? <> · <span className="num">{p.nFilters}</span></> : null}</span></button>
      </div>
      <PeriodSeg door={p.door} value={p.per} onChange={p.setPer} asof={p.asof} />
      {p.refused ? <div className="fnote" role="status">אין מסלולים כאלה; הסינון הקודם נשמר</div> : null}
      {p.sharedPolicy ? <GuardLine kind="product" text="מסלול משותף לשני המוצרים" onOpen={() => host.openSheet('policy')} id="policy-line" /> : null}
      {p.measure ? (
        <div className="scr-by" id="rank-head"><span>דירוג לפי: <b>{p.measure.label}</b> · {p.measure.asc ? 'מהנמוך לגבוה' : 'מהגבוה לנמוך'}</span><button type="button" className="linkbtn" onClick={p.clearMeasure}>לפי התשואה</button></div>
      ) : sentence ? <Takeaway tone="quiet" text={sentence} /> : null}

      {p.groups.length === 0 ? (
        <div className="ro-take scr-empty" id="board-empty"><b>{EMPTY_FILTER}</b>{p.nFilters > 0 ? <button type="button" className="cs-btn" onClick={p.clearFilters}>{CLEAR_FILTER}</button> : null}</div>
      ) : one ? boardOf(one, 'board') : p.groups.map((g, i) => (
        <section className="scr-grp" key={g.k}>
          <button type="button" className="scr-grp-h" aria-expanded={shown(g.k)} onClick={() => setOpen(open.includes(g.k) ? open.filter((x) => x !== g.k) : [...open, g.k])} disabled={p.groups.length <= 2}>
            <b>{typeName(g.k)}</b><small><NumText t={numIso(rankedN(g))} /> מסלולים{g.self.length ? <> · <NumText t={selfMore(g.self.length)} /></> : null}{g.avg != null && !p.real && !p.measure ? <> · ממוצע <NumText t={pctSigned(g.avg, d)} />{annual(p.per) ? ' בשנה' : ''}</> : null}</small>
            {p.groups.length > 2 ? <i aria-hidden="true">{shown(g.k) ? '▾' : '◂'}</i> : null}
          </button>
          {shown(g.k) ? boardOf(g, i === 0 ? 'board' : `board-${i}`) : null}
        </section>
      ))}

      <Link className="ro-rowlink" id="to-hub" to={hubTo}><span>{TO_HUB}</span><span aria-hidden="true">›</span></Link>
      <StampLine asof={p.asof} basis={p.real ? 'תשואה ריאלית (בניכוי מדד המחירים לצרכן), ברוטו' : undefined} onWhy={() => host.openSheet({ t: 'why' })} />

      {/* ---- sheets ---- */}
      <DeeperSheet open={own === 'prod'} onClose={close} id="sheet-product" title="איזה מוצר?">
        <div className="pk-prods" id="prod-tiles">
          {TILES.filter((t) => t.prods.some((x) => p.prods.includes(x))).map((t) => {
            const to = t.prods.find((x) => p.prods.includes(x))!, on = t.prods.includes(p.prod);
            return <button key={t.id} type="button" className={`pk-prod${on ? ' on' : ''}`} aria-pressed={on} onClick={() => pick(() => p.setProdTrack(to, null))}><ProdIcon art={t.art} /><span>{t.label}</span></button>;
          })}
        </div>
        <p className="cs-subh">כל המוצרים</p>
        <div className="fchips" id="prod-chips">
          {[p.all, ...p.prods].map((x) => <button key={x} type="button" className="chip" aria-pressed={x === p.prod} onClick={() => pick(() => p.setProdTrack(x, null))}>{x === p.all ? 'כל המוצרים' : x}</button>)}
        </div>
      </DeeperSheet>
      <DeeperSheet open={own === 'trk'} onClose={close} id="sheet-track-type" title="איזה סוג מסלול?" sub={prodName}>
        <div className="fchips scr-trk" id="trk-chips">
          {[[p.all, p.tracks.reduce((u, [, c]) => u + c, 0)] as [string, number], ...p.tracks].map(([t]) => {
            const n = t === p.all ? p.tracks.reduce((u, [x]) => u + p.trackCount(x), 0) : p.trackCount(t), none = n === 0;
            return <button key={t} type="button" className="chip" aria-pressed={t === p.T} disabled={none} onClick={() => pick(() => p.setProdTrack(p.prod, t))}>
              {t === p.all ? 'כל הסוגים' : typeLabel(t)} <small className="num">{n}</small></button>;
          })}
        </div>
      </DeeperSheet>
      {p.filters(own === 'filters', close)}
      <DeeperSheet open={own === 'policy'} onClose={close} id="sheet-policy" title="מסלול משותף לשני המוצרים">
        <p className="cs-note" style={{ fontSize: 14, color: 'var(--fg)' }}>ביטוח-נט מפרסם מסלולי השקעה. פוליסת חיסכון וביטוח מנהלים שהונפק מ-2004 מושקעים באותו מסלול, ולכן התשואה זהה; הנכסים ודמי הניהול הממוצעים כוללים את שני המוצרים.</p>
      </DeeperSheet>
      <DeeperSheet open={host.cmp?.t === 'why'} onClose={close} id="why-sheet-dlg" title="איך מחשבים?">
        <ul className="ro-facts" id="why-sheet">
          <li>{WHY_TEXT}</li>
          <li><NumText t={tieNote(p.per, p.asof)} /></li>
          {p.method}
        </ul>
      </DeeperSheet>
      <DeeperSheet open={!!tk} onClose={close} id="track-sheet-dlg" title={tf ? tlab : '…'} sub={tf ? <>{tf.name} · מס׳ קופה <span className="num">{tf.id}</span></> : undefined}
        footer={tf ? <div className="cs-nav">
          <button type="button" className="cs-btn pri" id="to-card" onClick={() => leave(`/funds/${tf.k}${p.per === 'y12' ? '?v=m12' : ''}`)}>{TO_CARD}</button>
          {tf.gone ? null : <button type="button" className="cs-btn" aria-pressed={tray.has(tf.k)} disabled={!tray.has(tf.k) && tray.keys.length >= TRAY_MAX} onClick={() => tray.toggle(tf.k)}>{tray.has(tf.k) ? IN_COMPARE : ADD_COMPARE}</button>}
        </div> : undefined}>
        {tf ? (
          <div id="track-sheet">
            <div className="ts-tiles scr-tiles">
              {PERS.map((x) => <div className={`ts-tile${x === p.per ? ' on' : ''}`} key={x}><small>{perLabel(x, p.door, p.asof)}{annual(x) ? (saver ? ', בשנה' : '') : ''}</small><span className="big">{p.ret(tf, x)}</span></div>)}
            </div>
            <dl className="scr-dl">
              {kv(saver ? 'המקום' : `מקום · ${perLabel(p.per, p.door, p.asof)}`, p.place(tf))}
              {saver ? null : kv('אחוזון', p.cell(tf, 'pct'))}
              {kv(saver ? 'דמי ניהול מהחיסכון' : 'ד"נ מצבירה', p.cell(tf, 'fee'))}
              {tf.depfee != null ? kv(saver ? 'דמי ניהול מההפקדה' : 'ד"נ מהפקדה', p.cell(tf, 'depfee')) : null}
              {!saver && /^פנסיה/.test(tf.prod) ? kv('איזון אקטוארי', p.cell(tf, 'act')) : null}
              {kv(saver ? 'חשיפה למניות' : 'מניות', p.cell(tf, 'st'))}
              {saver ? null : kv('שארפ', p.cell(tf, 'sharpe'))}
              {kv(saver ? 'גודל (מיליוני ש"ח)' : 'נכסים, מ׳ ש"ח', p.cell(tf, 'assets'))}
              {kv('גוף מנהל', p.mgr(tf))}
            </dl>
            <div className="fcard-meta scr-flags">{p.flags(tf)}</div>
          </div>
        ) : <div className="cs-skel" />}
      </DeeperSheet>
    </div>
  );
}

