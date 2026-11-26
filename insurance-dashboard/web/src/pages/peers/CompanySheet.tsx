import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DeeperSheet, SheetSwatch } from '../../components/DeeperSheet';
import { Sourced } from '../../components/Source';
import { idCss } from '../../lib/identity';
import { useAddressWrite } from '../../lib/sheetHost';
import { BBY, boardMetrics, boardRows, CSM_BASIS_HE, csmBasis, defRead, fmtRead, medianProv, shOf, type BMetric } from '../../lib/peerBoard';
import { placeText, toneOf } from '../../lib/peerWords';
import { fmtPts, qlab } from '../../lib/quarters';
import { nf, sn } from '../../lib/format';
import { ctxOf, type BoardData } from './BoardLens';
import { FocusSentence } from './FocusLens';
import '../../styles/peerboard.css';

/* The company sheet (`?sheet=co:<id>`, spec p6 §3.2, §13.1 M9 / M16): a board row's name, a matrix name or a grid head opens it. The focus
   sentence, then eleven metrics with the company's figure, the group's median with its n, the difference to the median (neutral inside
   the band: no colour), and the place with its direction ("מקום 6 מ-6, 1 = הזולה"). Every number opens its source. The actions are a
   pinned footer: "במיקוד" (sets `hl`), "לדף החברה", "הערכת שווי" (insurers). */

const KEYS_INS = ['pe', 'pb', 'pbc', 'dy', 'roe', 'np', 'csm', 'isrm', 'sr', 'oshare', 'onetr'];
const KEYS_FUND = ['pe', 'pb', 'maum', 'dy', 'roe', 'np', 'nm', 'aum', 'oshare', 'onetr', 'tr'];

/** the difference to the median, in the metric's own unit ("+0.65x", "+0.1 נק׳", "+1,204") */
function delta(m: BMetric, v: number): string {
  if (m.u === 'x') return `${sn(v, m.dec)}x`;
  if (m.u === 'pct' || m.u === 'pctx' || m.u === 'pp') return fmtPts(v, m.dec >= 2 ? 2 : 1);
  return sn(v, m.dec);
}

export function CompanySheet({ d, e, onClose }: { d: BoardData; e: string; onClose: () => void }) {
  const { book } = d;
  const write = useAddressWrite();
  const ctx = useMemo(() => ctxOf(d), [d]);
  const have = useMemo(() => new Set(boardMetrics(d.ents.map(d.kindOf)).map((m) => m.key)), [d]);
  const keys = (d.kindOf(e) === 'fund' ? KEYS_FUND : KEYS_INS).filter((k) => have.has(k));
  const rows = useMemo(() => keys.map((k) => { const m = BBY.get(k)!; return { m, b: boardRows(ctx, m, defRead(m)) }; }), [keys.join(), ctx]);  // eslint-disable-line react-hooks/exhaustive-deps
  const name = (x: string) => book.short(x);
  const last = d.status.last[e];
  const ins = book.ent.get(e)?.k !== 'fund';
  const footer = (
    <div className="p6-sh-foot" id="sheet-foot">
      <button type="button" className="btn primary" id="co-focus" aria-pressed={d.focus === e} onClick={() => write({ hl: e, sheet: null })}>במיקוד</button>
      <Link className="btn" to={`/company/${e}`}>לדף החברה</Link>
      {ins ? <Link className="btn" to={`/valuation/${e}`}>הערכת שווי</Link> : null}
    </div>
  );
  return (
    <DeeperSheet open onClose={onClose} id="co-sheet" title={book.name(e)} lead={<SheetSwatch color={idCss(e)} />}
      sub={<>מול הקבוצה · כספיים <bdi dir="ltr">{qlab(last)}</bdi>{last && last < d.status.bq ? <> · טרם דיווחה <bdi dir="ltr">{qlab(d.status.bq)}</bdi></> : null}</>}
      footer={footer}>
      <p className="p6-co-lede"><FocusSentence d={d} e={e} /></p>
      <div className="p6-kvs">
        {rows.map(({ m, b }) => {
          const x = b.rows.find((r) => r.e === e)!, has = x.v != null && Number.isFinite(x.v), rd = b.rd;
          const dv = has && !x.out && b.med.v != null ? x.v! - b.med.v : null;
          const inBand = dv == null || Math.abs(dv) < b.band - 1e-9 || Math.abs(dv) < 1e-9;
          const good = dv == null || inBand || !m.better ? null : m.better === 'hi' ? dv > 0 : dv < 0;
          const tone = m.u === 'pctx' ? toneOf(x.v) : null;
          const basis = m.key === 'csm' && x.q ? csmBasis(book, e, x.q) : null;
          return (
            <div className="p6-kv" key={m.key} data-m={m.key}>
              <span className="p6-kv-l">{shOf(m)}{m.type === 'flow' || (m.type === 'ratio' && rd === 'ltm' && m.key !== 'roe') ? ' LTM' : ''}
                {x.stale && x.q ? <span className="p6-tag warn"><bdi dir="ltr">{qlab(x.q)}</bdi></span> : null}
                {x.per ? <span className="p6-tag"><bdi dir="ltr">{qlab(x.per)}</bdi></span> : null}
                {basis ? <span className="p6-tag">{CSM_BASIS_HE[basis]}</span> : null}</span>
              <span className="p6-kv-v">
                {has ? <Sourced className={`num${tone ? ` ${tone}` : ''}`} src={x.val.prov}>{fmtRead(m, rd, x.v!)}{x.stale ? '*' : ''}</Sourced> : <span className="mut" title={x.val.why ?? 'אין נתון'}>–</span>}
              </span>
              <span className="p6-kv-s">
                חציון {b.med.v == null || b.med.n < 2 ? '–' : <><Sourced className="num" src={() => medianProv(b, name)}>{fmtRead(m, rd, b.med.v)}</Sourced><sup className="p6-n">{b.med.n}</sup></>}
                {dv != null ? <> · <bdi dir="ltr" className={`p6-d${good == null ? '' : good ? ' pos' : ' neg'}`} data-d={nf(dv, 4)}>{delta(m, dv)}</bdi></> : null}
                {' · '}{has && !x.out && x.place != null ? placeText(x.place, b.n, m) : 'לא בדירוג'}
              </span>
            </div>
          );
        })}
      </div>
    </DeeperSheet>
  );
}
