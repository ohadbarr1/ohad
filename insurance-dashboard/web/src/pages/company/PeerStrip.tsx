import { Link } from 'react-router-dom';
import { Sourced } from '../../components/Source';
import { BBY, fmtRead, medianProv, shOf } from '../../lib/peerBoard';
import { coBoard, placeOf, STRIP } from './rows';
import type { CoData } from './QuarterLens';

/** "מול {set}" (spec 5.4, 9.4 rule 5): nine business and operations metrics, the company's value, the set's median with its n and the
 *  place, each on the board's reading and rule (`boardRows`, carried values starred). Never a price or a multiple: those live on the
 *  peers page only; the company row keeps its "שווי ›" link. */
export function PeerStrip({ co }: { co: CoData }) {
  const { entry, ctx, kind, setName } = co, e = entry.id;
  const name = (x: string) => co.book.name(x);
  const rows = STRIP[kind].map((k) => BBY.get(k)!).filter((m) => m && m.tok?.[kind]);
  return (
    <section className="panel co6-panel" id="peer-strip" aria-labelledby="ps-h">
      <div className="co6-ph"><h2 id="ps-h">מול {setName} <small>· ערך · חציון<sup className="p6-n">n</sup> · מקום (1 = הגבוהה) · בלי נתוני מניה</small></h2>
        <Link className="co6-chip" to={`/industry/peers?hl=${e}`}>ללוח ›</Link></div>
      <div className="co6-ps">{rows.map((m) => {
        const b = coBoard(ctx, m), x = b.rows.find((r) => r.e === e), pl = placeOf(b, e);
        const v = x && x.v != null && Number.isFinite(x.v) ? x : null;
        return (
          <div className="co6-psr" key={m.key} data-k={m.key}>
            <span className="l">{shOf(m)}{m.type === 'flow' ? ' LTM' : ''}</span>
            <span className="v">
              {v ? <Sourced src={v.val.prov} className="co6-n">{`${fmtRead(m, b.rd, v.v!)}${v.stale ? '*' : ''}`}</Sourced> : <span className="muted" title={x?.val.why ?? 'אין נתון'}>–</span>}
              {b.med.v != null ? <span className="co6-med"><Sourced src={() => medianProv(b, name)}>{fmtRead(m, b.rd, b.med.v)}</Sourced><sup className="p6-n">{b.med.n}</sup></span> : <span className="muted">–</span>}
              <span className="co6-pl num" title={pl.star ? 'טרם דיווחה על הרבעון: לפי הדוח האחרון, מסומן ונספר' : undefined}>{pl.text}</span>
            </span>
          </div>
        );
      })}</div>
    </section>
  );
}
