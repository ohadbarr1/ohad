import { Link } from 'react-router-dom';
import { Panel } from './ui';
import { Sourced } from './Source';
import { Icon } from './Icon';
import { pubLabel } from '../lib/format';
import { readerHref } from '../lib/search';
import { track } from '../lib/track';
import { chgProv, figText, repName, useChanges, type ChgFig, type ChgItem, type Changes } from '../lib/changes';

const pkey = (p: string) => Number(p.slice(0, 4)) * 4 + (p.endsWith('FY') ? 4 : Number(p.slice(5)));
const tone = (it: ChgItem) => (it.gd > 0 ? 'pos' : it.gd < 0 ? 'neg' : '');

/** The page a change is read from: the reader at that page; a computed figure says so; a T+0 figure is an XBRL tag. */
function PageLink({ d, f }: { d: Changes; f: ChgFig }) {
  const s = f.s;
  if (s.k === 'pg' && s.rid && s.pg) return <Link className="rd-chg-pg sv-u" to={readerHref(s.rid, s.pg)} title={`${d.docs[String(s.rid)] ? 'פתיחת העמוד בקורא' : 'עמוד המקור'}`}>עמ׳ <span className="num">{s.pg}</span></Link>;
  if (s.k === 'xbrl') return <span className="rd-chg-pg muted">XBRL</span>;
  const first = s.in?.find((x) => x.s.k === 'pg');
  return first?.s.rid && first.s.pg ? <Link className="rd-chg-pg sv-u" to={readerHref(first.s.rid, first.s.pg)} title="מחושב; העמוד של הרכיב הראשון">נגזר · עמ׳ <span className="num">{first.s.pg}</span></Link> : <span className="rd-chg-pg muted">נגזר</span>;
}

/** Report Day hero: "Q2'26 · 10 שינויים", the most material changes of the report, both figures and the change each opening its page. */
export function ChangesPanel({ id, P, latest }: { id: string; P: string; latest: boolean }) {
  const ch = useChanges(id);
  const d = ch.data;
  if (!d) return null;
  // a report filed today exists only as its XBRL tags until the statements are read: shown on the default view, labelled
  const head = d.reports[0];
  const r = latest && head && head.st === 'unverified' && pkey(head.p) > pkey(P) ? head : d.reports.find((x) => x.p === P);
  if (!r) return null;
  const stock = (it: ChgItem) => it.g === 'ifrs' && it.k === 'csm';
  const title = <><span className="num">{repName(r.p)}</span> · <span className="num">{r.n}</span> שינויים</>;
  return (
    <section id="rd-changes" aria-label={`${repName(r.p)}: ${r.n} שינויים מהותיים`}>
      <Panel className="rd-chg" title={title} aside={<>
        {r.st === 'unverified' && <span className="chip est" title="לפי תיוג ה-XBRL של הדוח; יאומת מול המספרים המודפסים">XBRL · טרם אומת</span>}
        {r.pub && <span>פורסם <span className="num">{pubLabel(r.pub)}</span></span>}
        <a className="rd-chg-xl sv-u" href={`/data/xlsx/${id}.xlsx`} download={`fox-${id}.xlsx`} onClick={() => track('xlsx_dl')}><Icon name="download" size={14} />Excel מעודכן</a>
        <span className="chip" title={d.rule}>מדורג לפי מהותיות</span>
      </>}>
        {r.items.length === 0 ? <p className="muted rd-chg-none">אין בדוח שינוי מעל סף המהותיות (<span className="num">0.5%</span> מההון).</p> : (
          <ol className="rd-chg-list">
            {r.items.map((it, i) => (
              <li key={it.k} className="rd-chg-row">
                <span className="rd-chg-n num" aria-hidden="true">{i + 1}</span>
                <div className="rd-chg-l">
                  <span className="rd-chg-t">{it.l}</span>
                  <span className="rd-chg-meta">
                    <span className="num">{it.pl}</span>
                    {it.rest && <Sourced src={() => chgProv(d, it.rest!, it.l, it.lb, 'כפי שדווח לראשונה')} className="chip est" title={`הוצג מחדש: במקור ${figText(it.rest)}`}>הוצג מחדש</Sourced>}
                    {it.tx && <span className="chip est" title="נקרא מטקסט הדוח (הערכת החברה), לא מטבלה">מטקסט הדוח</span>}
                    {it.alt && <span className="chip est" title="אין בדוח שורת ייחוס לבעלי המניות">שורת הרווח הכוללת</span>}
                    {it.der && <span className="chip" title="מחושב מהמספרים המודפסים">נגזר</span>}
                  </span>
                  {it.why && <span className="rd-chg-why">{it.why.t} <Link className="sv-u" to={readerHref(it.why.s.rid ?? 0, it.why.s.pg)}>עמ׳ <span className="num">{it.why.s.pg}</span></Link></span>}
                </div>
                <div className="rd-chg-v">
                  <Sourced src={() => chgProv(d, it.b, it.l, it.lb, undefined, stock(it))} className="rd-chg-b" title={`${it.lb}: ${figText(it.b)}`}>{figText(it.b)}</Sourced>
                  <span className="rd-chg-arr" aria-hidden="true">←</span>
                  <Sourced src={() => chgProv(d, it.a, it.l, it.la, undefined, stock(it))} className="rd-chg-a" title={`${it.la}: ${figText(it.a)}`}>{figText(it.a)}</Sourced>
                </div>
                <div className={`rd-chg-d ${tone(it)}`}>
                  <Sourced src={() => chgProv(d, it.d, it.l, `${it.la} מול ${it.lb}`)}>{figText(it.d)}</Sourced>
                  {it.dp && <Sourced src={() => chgProv(d, it.dp!, it.l, `${it.la} מול ${it.lb}`)} className="rd-chg-dp">{figText(it.dp)}</Sourced>}
                </div>
                <PageLink d={d} f={it.a} />
              </li>
            ))}
          </ol>
        )}
        <p className="src">מיליוני ש"ח · יחסים בנק׳ · מדורג לפי |שינוי| ÷ ההון לבעלי המניות, משוקלל בתנודתיות השורה · השוואה כפי שהודפסה בדוח · כל מספר נפתח בעמוד המקור.</p>
      </Panel>
    </section>
  );
}
