import { Link } from 'react-router-dom';
import { DeeperSheet } from '../../components/DeeperSheet';
import { idCss } from '../../lib/identity';
import { pdfPage } from '../../lib/sources';
import type { Prov } from '../../lib/prov';
import { qlab } from '../../lib/quarters';
import { coBoard, coSeries, placeOf, rowsFor, type CoKey } from './rows';
import { Num, Spark, type CoData } from './QuarterLens';

/** the document page of a figure: printed, or the first printed component of a computed one */
function pageOf(p: Prov): { url: string; pg: number | null; doc?: string } | null {
  if (p.k === 'report' && p.url) return { url: pdfPage(p.url, p.pg ?? undefined), pg: p.pg, doc: p.doc };
  if (p.k === 'calc') for (const i of p.inputs) { const x = i.src ? pageOf(i.src()) : null; if (x) return x; }
  return null;
}

/** A row of "עיקרי הדוח" (spec 5.2 item 6, T-C2): eight quarters, each with its YoY, every figure opening its source; the report page of the
 *  quarter on screen; "מול העמיתים" in the pinned footer (13.1 M9). `?sheet=row:<key>` in the address; Back closes it. */
export function RowSheet({ co, k, onClose }: { co: CoData; k: CoKey; onClose: () => void }) {
  const r = rowsFor(co.kind).find((x) => x.k === k);
  if (!r) return null;
  const { book, entry, kind, q, ents, ctx } = co, e = entry.id;
  const s = coSeries(book, r, e, kind, q, ents);
  const last = [...s].reverse().find((x) => x.v.v != null), pg = last ? pageOf(last.v.prov()) : null;
  const pl = r.board ? placeOf(coBoard(ctx, r.board), e) : null;
  const peers = `/industry/peers?hl=${e}&lens=focus${r.board ? `&bm=${r.board.key}` : ''}`;
  return (
    <DeeperSheet open onClose={onClose} id="row-sheet" title={`${r.l} · ${entry.name_he}`} sub={<>8 רבעונים עד <span className="num">{qlab(q)}</span>{pl && pl.place != null ? <> · מקום <span className="num">{pl.text}</span> ב-{co.setName}</> : null}</>}
      footer={<div className="co6-sfoot">
        {pg && <a className="btn" href={pg.url} target="_blank" rel="noreferrer">הדוח{pg.pg != null ? <>, עמ׳ <span className="num">{pg.pg}</span></> : null} ↗</a>}
        <Link className="btn primary" to={peers}>מול העמיתים ›</Link>
      </div>}>
      <div className="co6-rs-spark"><Spark vals={s.map((x) => x.v.v)} color={idCss(e)} w={300} h={56} /></div>
      <table className="co6-rs">
        <thead><tr><th scope="col">רבעון</th><th scope="col">{r.m.u === 'pct' ? 'יחס' : 'מיליוני ש"ח'}</th><th scope="col">YoY</th></tr></thead>
        <tbody>{[...s].reverse().map((x) => (
          <tr key={x.q} className={x.q === q ? 'cur' : undefined}><th scope="row" className="num">{qlab(x.q)}</th><td><Num f={x.v} /></td><td><Num f={x.yoy} /></td></tr>
        ))}</tbody>
      </table>
      <p className="co6-note">{r.k === 'roe' ? 'ROE: רווח LTM ÷ הון ממוצע (נגזר); YoY בנקודות, LTM מול LTM' : r.k === 'sr' ? 'יחס כושר פירעון ללא הוראות מעבר, מתפרסם לחציונים ולשנים; YoY בנקודות' : 'כפי שדווח; YoY מול אותו רבעון לפני שנה'} · כל מספר נפתח במקור שלו.</p>
    </DeeperSheet>
  );
}
