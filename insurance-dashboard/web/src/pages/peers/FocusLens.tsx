import { useMemo } from 'react';
import { Sourced } from '../../components/Source';
import { Takeaway } from '../../components/Takeaway';
import { idCss } from '../../lib/identity';
import { BBY, boardMetrics, boardRows, defRead, fmtRead, pairRead, type BMetric, type BoardOut } from '../../lib/peerBoard';
import type { QRead } from '../../lib/quarters';
import { focusWords, toneOf } from '../../lib/peerWords';
import { isChg, qlab } from '../../lib/quarters';
import { boardSrc, ctxOf, Words, type BoardData } from './BoardLens';
import '../../styles/peerboard.css';

/* Lens "חברה" (spec p6 §3.2, §3.7, §13.1 M16): the shipped lede as the sentence (lib/peerWords focusWords, with the tie branch), then one
   list instead of the tiles and the three uneven map columns: per metric with a direction, its name (a tap opens that metric on the
   board), the group's dots on a robust span (median ± 3 × MAD, as the positioning map was) with the median tick and the focus ringed,
   the focus company's figure (its source in one tap) and its place "3/7". Sections המניה (זול ← יקר), העסק, חיסכון, ביטוח (חלש ← חזק);
   each head says what place 1 is. A company without a listed share has no stock section. */

type FSec = 'mkt' | 'biz' | 'sav' | 'ins';
const SEC_HE: [FSec, string][] = [['mkt', 'המניה'], ['biz', 'העסק'], ['sav', 'חיסכון'], ['ins', 'ביטוח']];
/** the levels shown as their growth (the shipped tiles' רווח YoY, CSM YoY, AUM YoY); 15–25 rows in all (spec 3.7) */
const GROWTH = new Set(['np', 'rev', 'csm', 'aum', 'oaum']);
const secOf = (m: BMetric): FSec => (m.sec === 'ops' ? (m.grp === 'ins' ? 'ins' : 'sav') : m.sec);

/** the focus sentence of a company (lens חברה and the company sheet) */
export function FocusSentence({ d, e, id }: { d: BoardData; e: string; id?: string }) {
  const ctx = useMemo(() => ctxOf(d), [d]);
  const pb = useMemo(() => boardRows(ctx, BBY.get('pb')!, 'now'), [ctx]);
  const roe = useMemo(() => boardRows(ctx, BBY.get('roe')!, 'ltm'), [ctx]);
  const name = (x: string) => d.book.short(x);
  const src = (b: BoardOut) => boardSrc(b, name);
  // the lede's figures are P/B's and ROE's: the first two figure references resolve on the P/B board, the next two on ROE's
  const parts = focusWords(e, pb, roe, name);
  const which = new Map<number, BoardOut>();
  let seen = 0;
  parts.forEach((p, i) => { if (p.k === 'n' && p.ref && (p.ref.k === 'row' || p.ref.k === 'med')) { which.set(i, seen < 2 ? pb : roe); seen += 1; } });
  return <span id={id}><Words parts={parts} src={(r, i) => { const b = which.get(i); return b ? src(b)(r, i) : null; }} /></span>;
}

export function FocusLens({ d }: { d: BoardData }) {
  const { book, focus } = d;
  const ctx = useMemo(() => ctxOf(d), [d]);
  // a metric with a direction on its own reading; a few levels without one (net profit, revenue, CSM, assets) on their paired change
  // (LTM against LTM for flows, quarter end against quarter end for balances): growth has a direction, as the shipped tiles' "YoY"
  const ms = useMemo(() => boardMetrics(d.ents.map(d.kindOf)).flatMap((m): [BMetric, QRead][] => (m.key === 'mcap' ? [] : m.better ? [[m, defRead(m)]] : GROWTH.has(m.key) && pairRead(m) ? [[m, pairRead(m)!]] : [])), [d]);
  const boards = useMemo(() => new Map(ms.map(([m, r]) => [m.key, boardRows(ctx, m, r)])), [ms, ctx]);
  const noShare = !d.px[focus];
  const toBoard = (k: string, r: QRead) => { d.put('lens', null); d.put('rd', r === defRead(BBY.get(k)!) ? null : r); d.put('bm', k); window.scrollTo({ top: 0 }); };
  return (
    <div className="p6-focus">
      <Takeaway id="takeaway"><FocusSentence d={d} e={focus} /></Takeaway>
      <section className="panel" id="focus-list" aria-label={`${book.name(focus)} מול הקבוצה`}>
        {SEC_HE.map(([sec, title]) => {
          if (sec === 'mkt' && noShare) return null;
          const rows = ms.filter(([m]) => secOf(m) === sec).map(([m]) => ({ m, b: boards.get(m.key)! })).filter(({ b }) => b.rows.some((r) => r.v != null && Number.isFinite(r.v)));
          if (!rows.length) return null;
          const mkt = sec === 'mkt';
          return (
            <div key={sec} className="p6-fl-sec" data-sec={sec}>
              <div className="p6-fl-hd"><span>{title}</span><span>{mkt ? 'זול ← יקר' : 'חלש ← חזק'} · קו: חציון · מקום 1 = {mkt ? 'הזולה' : 'הגבוהה'}</span></div>
              {rows.map(({ m, b }) => <FocusRow key={m.key} m={m} b={b} focus={focus} mkt={mkt} onPick={() => toBoard(m.key, b.rd)} name={(x) => book.short(x)} />)}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function FocusRow({ m, b, focus, mkt, onPick, name }: { m: BMetric; b: BoardOut; focus: string; mkt: boolean; onPick: () => void; name: (e: string) => string }) {
  const rd = b.rd, ok = b.rows.filter((r) => !r.out && r.v != null && Number.isFinite(r.v));
  const xs = ok.map((r) => r.v!), md = b.med.v ?? xs[0];
  const mad = xs.map((x) => Math.abs(x - md)).sort((a, c) => a - c)[Math.floor(xs.length / 2)] || 0;
  const lo = mad ? Math.max(Math.min(...xs), md - 3 * mad) : Math.min(...xs), hi = mad ? Math.min(Math.max(...xs), md + 3 * mad) : Math.max(...xs);
  const span = hi - lo || 1;
  // stock: the better end at the start ("זול ← יקר"); the rest: the weaker end at the start ("חלש ← חזק")
  const pos = (v: number) => { const t = Math.min(1, Math.max(0, (Math.min(hi, Math.max(lo, v)) - lo) / span)); const good = m.better === 'lo' && !isChg(rd) ? t : 1 - t; return (mkt ? good : 1 - good) * 100; };
  const f = b.rows.find((r) => r.e === focus)!, fh = !f.out && f.v != null && Number.isFinite(f.v);
  const tone = isChg(rd) || m.u === 'pctx' ? toneOf(f.v) : null;
  const label = isChg(rd) ? `${m.bsh ?? m.sh} ${rd === 'ltmy' ? 'LTM YoY' : 'YoY'}` : `${m.sh}${m.type === 'flow' || (m.type === 'ratio' && rd === 'ltm' && m.key !== 'roe') ? ' LTM' : ''}`;
  return (
    <div className="p6-fl-row" data-m={m.key}>
      <button type="button" className="p6-fl-name" onClick={onPick} title={`${m.l}: לוח הדירוג`}>{label} ›</button>
      <span className="p6-fl-track" aria-hidden="true">
        {b.med.v != null ? <em style={{ insetInlineStart: `${pos(b.med.v)}%` }} /> : null}
        {ok.filter((r) => r.e !== focus).map((r) => <i key={r.e} style={{ insetInlineStart: `${pos(r.v!)}%`, background: idCss(r.e) }} title={`${name(r.e)}: ${fmtRead(m, rd, r.v!)}`} />)}
        {fh ? <i className="f" style={{ insetInlineStart: `${pos(f.v!)}%`, background: idCss(focus) }} /> : null}
      </span>
      <span className="p6-fl-v">{f.v != null && Number.isFinite(f.v)
        ? <Sourced className={`num${tone ? ` ${tone}` : ''}`} src={f.val.prov} title={f.stale ? `טרם דווח על ${qlab(b.q)}: ${qlab(f.q)}` : undefined}>{fmtRead(m, rd, f.v)}{f.stale ? '*' : ''}</Sourced>
        : <span className="mut" title={f.val.why ?? 'אין נתון'}>–</span>}</span>
      <span className="p6-fl-p"><bdi dir="ltr">{fh && f.place != null ? `${f.place}/${b.n}` : '–'}</bdi></span>
    </div>
  );
}
