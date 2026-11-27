import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../../components/Source';
import { Icon } from '../../components/Icon';
import { Seg } from '../../components/ui';
import { CardLink } from '../../components/ReportCardLink';
import { docUrl, repName } from '../../lib/changes';
import { nf, pct, periodLabel, pubLabel } from '../../lib/format';
import { shiftYear } from '../../lib/company';
import { track } from '../../lib/track';
import { endOf, figProv, movers, restatedBy, type Fig, type Mover, type Restated } from '../ReportDay';
import { calc } from '../companyProv';
import { ChangeList, CoStamp, XlsxChip, type CoData } from './QuarterLens';

const k1 = (f: Fig) => (f.unit === 'k' ? f.v / 1e3 : f.v);
const sgn = (x: number, d = 0) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${nf(Math.abs(x), d)}`;
const tone = (x: number) => (Math.abs(x) < 1e-9 ? '' : x > 0 ? ' pos' : ' neg');

/** Lens שינויים (`cl=chg`, spec 5.2, 5.6): the report's ranked changes (all N, each with its page; "הוצג מחדש" on its own line), the
 *  report links (PDF, Excel, the report card), then "מה זז הכי הרבה" (עלו / ירדו) and "הוצג מחדש בדוח" with the 2% filter: the content of
 *  the shipped report day, every figure opening its page. */
export default function ChangesLens({ co }: { co: CoData }) {
  const { ch, chr, entry, store, P, phone } = co, id = entry.id;
  const end = P ? endOf(P) : '';
  const W = P.endsWith('Q1') ? 'q' : co.win === 'ltm' ? 'ltm' : co.win === 'ytd' ? 'ytd' : P.endsWith('FY') ? 'ytd' : 'q';
  const moved = useMemo(() => (store && end ? movers(store, end, W) : { up: [], down: [], skipped: [] }), [store, end, W]);
  const rest = useMemo(() => (store && end ? restatedBy(store, end) : []), [store, end]);
  const [thr, setThr] = useState<'big' | 'all'>('big');
  const CAP = 6;  // the lens stays within its budget (14.7); the rest opens on /restatements
  const nBig = rest.filter((r) => r.big).length, list = thr === 'big' ? rest.filter((r) => r.big) : rest;
  const pdf = ch && chr ? docUrl(ch, chr.rid) : null;
  const T = W === 'ytd' ? ({ '03-31': 'Q', '06-30': 'H', '09-30': '9M', '12-31': 'FY' } as Record<string, string>)[end.slice(5)] : 'Q', L = W === 'ltm' ? 'LTM ' : '';
  const curL = end ? L + periodLabel(T, end) : '', yoyL = end ? L + periodLabel(T, shiftYear(end, -1)) : '';
  const restProv = (r: Restated, txt: string, formula: string, u: string) => calc(`${r.line} · ${r.period} · הוצג מחדש`, txt, formula,
    [{ label: 'כפי שדווח אז', v: nf(k1(r.first), 1), src: () => figProv(r.first, r.line, r.period, 'כפי שדווח אז') }, { label: `כפי שהוצג מחדש (${repName(P)})`, v: nf(k1(r.last), 1), src: () => figProv(r.last, r.line, r.period, `כפי שהוצג מחדש בדוח ${repName(P)}`) }], u);
  return (
    <div className="co6-lens" data-lens="chg">
      <section className="panel co6-panel" aria-labelledby="chg-h">
        <div className="co6-ph">
          <h2 id="chg-h">{P ? <span className="num">{repName(P)}</span> : null} · <span className="num">{chr?.n ?? 0}</span> שינויים <small>· מדורג לפי מהותיות{chr?.pub ? <> · פורסם <span className="num">{pubLabel(chr.pub)}</span></> : null}</small></h2>
          <XlsxChip id={id} report={P} company="xlsx-co2" />
        </div>
        <div className="co6-links">
          {pdf && <a className="co6-chip" href={pdf} target="_blank" rel="noreferrer">הדוח המלא (PDF{chr?.pages ? <>, <span className="num">{chr.pages}</span> עמ׳</> : null})</a>}
          {entry.has_financials && <a className="co6-chip" href={`/data/xlsx/${id}.xlsx`} download={`fox-${id}.xlsx`} onClick={() => track('xlsx_dl')}><Icon name="download" size={14} /> Excel מעודכן</a>}
          {P && <CardLink id={id} p={P} className="co6-chip" />}
          {rest.length > 0 && <a className="co6-chip" href="#co6-rest" onClick={() => { const d = document.getElementById('co6-rest') as HTMLDetailsElement | null; if (d) d.open = true; }}><span className="num">{rest.length}</span> נתונים הוצגו מחדש</a>}
          {chr?.st === 'unverified' && <span className="chip est" title="לפי תיוג ה-XBRL של הדוח; יאומת מול המספרים המודפסים">XBRL · טרם אומת</span>}
        </div>
        {ch && chr ? <ChangeList d={ch} r={chr} /> : <p className="muted co6-none">אין רשימת שינויים לדוח הזה.</p>}
        {ch && <p className="co6-note" title={ch.rule}>מיליוני ש"ח · יחסים בנק׳ · מדורג לפי |שינוי| ÷ ההון לבעלי המניות, משוקלל בתנודתיות השורה · כל מספר נפתח בעמוד המקור.</p>}
      </section>

      {store && end && (
        <div className="co6-g2">
          <details className="panel co6-panel co6-det" open={!phone || undefined}>
            <summary className="co6-ph"><h2 id="mv-h">מה זז הכי הרבה <small>· YoY מול <span className="num">{yoyL}</span> · שורות רווח והפסד, ללא סיכומים · מיליוני ש"ח</small></h2></summary>
            {moved.up.length + moved.down.length === 0 ? <p className="muted co6-none">אין שורות עם נתון בשתי התקופות.</p> : (
              <div className="co6-mv">{([['עלו', moved.up], ['ירדו', moved.down]] as [string, Mover[]][]).map(([t, ms]) => (
                <div key={t}><h3>{t}</h3>{ms.length === 0 ? <span className="muted">–</span> : ms.map((m) => (
                  <div className="co6-mvr" key={m.label}>
                    <span className="l">{m.label}<small><Sourced src={() => figProv(m.prev, m.label, yoyL)}>{nf(k1(m.prev), 0)}</Sourced> ← <Sourced src={() => figProv(m.cur, m.label, curL)}>{nf(k1(m.cur), 0)}</Sourced></small></span>
                    <Sourced src={() => calc(`${m.label} · ${curL} מול ${yoyL}`, sgn(m.d / 1e3), `${curL} − ${yoyL}`, [[m.cur, curL], [m.prev, yoyL]].map(([f, l]) => ({ label: l as string, v: nf(k1(f as Fig), 1), src: () => figProv(f as Fig, m.label, l as string) })), 'מיליוני ש"ח')}
                      className={`co6-n${tone(m.d)}`}>{sgn(m.d / 1e3)}</Sourced>
                  </div>
                ))}</div>
              ))}</div>
            )}
            {moved.skipped.length > 0 && <p className="co6-note">לא דורגו, סימן הפוך בין שני הדוחות: {moved.skipped.join(' · ')}.</p>}
          </details>
          <details className="panel co6-panel co6-det" id="co6-rest" open={!phone || undefined}>
            <summary className="co6-ph"><h2 id="rs-h">הוצג מחדש בדוח <span className="num">{repName(P)}</span> <small>· <span className="num">{rest.length}</span> נתונים, <span className="num">{nBig}</span> ב-2% ומעלה</small></h2></summary>
            {rest.length > 0 && <Seg label="סף מהותיות" value={thr} onChange={setThr} options={[['big', `2% ומעלה (${nBig})`], ['all', `הכול (${rest.length})`]]} />}
            {rest.length === 0 ? <p className="muted co6-none">הדוח לא הציג מחדש נתונים של תקופות קודמות.</p> : list.length === 0 ? <p className="muted co6-none">אין הצגה מחדש של 2% ומעלה. <button type="button" className="linkbtn" onClick={() => setThr('all')}>הצג את כל {rest.length}</button></p> : (
              <div className="scroll"><table className="co6-all co6-rt">
                <thead><tr><th scope="col">שורה ותקופה</th><th scope="col">כפי שדווח אז</th><th scope="col">כפי שהוצג מחדש</th><th scope="col">הפרש</th></tr></thead>
                <tbody>{list.slice(0, CAP).map((r, i) => {
                  const d = k1(r.last) - k1(r.first), dt = sgn(d, r.unit === 'nis' ? 2 : 0), pp = r.first.v > 0 && r.last.v > 0 ? pct(Number(((r.last.v / r.first.v - 1) * 100).toFixed(1)) || 0, 1, true) : null;
                  return (
                    <tr key={`${r.sheet}|${r.line}|${r.period}|${i}`}>
                      <th scope="row">{r.line}<small><span className="num">{r.period}</span> · {r.std}</small></th>
                      <td><Sourced src={() => figProv(r.first, r.line, r.period, 'כפי שדווח אז')}>{nf(k1(r.first), r.unit === 'nis' ? 2 : 0)}</Sourced></td>
                      <td><Sourced src={() => figProv(r.last, r.line, r.period, `כפי שהוצג מחדש בדוח ${repName(P)}`)}>{nf(k1(r.last), r.unit === 'nis' ? 2 : 0)}</Sourced></td>
                      <td><Sourced src={() => restProv(r, dt, 'הוצג מחדש − כפי שדווח אז', r.unit === 'nis' ? 'ש"ח' : 'מיליוני ש"ח')} className={`co6-n${tone(d)}`}>{dt}</Sourced>
                        {pp && <> <Sourced src={() => restProv(r, pp, 'הוצג מחדש ÷ כפי שדווח אז − 1', '%')} className="co6-dp">{pp}</Sourced></>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>{list.length > CAP && <p className="co6-note"><Link to={`/restatements?season=${P}&co=${id}`}>כל {list.length} ›</Link></p>}</div>
            )}
            {rest.length > 0 && <p className="co6-note"><Link to={`/restatements?season=${P}&co=${id}`}>תיקונים בדוח זה</Link> · <Link to={`/restatements?season=${P}`}>הצגות מחדש בענף · {repName(P)}</Link></p>}
          </details>
        </div>
      )}
      <CoStamp co={co} />
    </div>
  );
}
