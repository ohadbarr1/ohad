import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { monthLabel, pubLabel } from '../lib/format';
import { idCss } from '../lib/identity';
import { useRegistry } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { readStored, storedKeys, writeStored } from '../lib/local';
import { KEY, useSince, useSinceAll, type SinceData, type SinceEvent, type Visit } from '../lib/visits';
import { CardLink } from './ReportCardLink';
import '../styles/since.css';

/* The "since you last looked" marks (lane S2): a dot or a count wherever a company is named, a chip in its header, and on its home the
   list of what arrived since the reader's previous visit. Nothing shows before a first visit. */

const DOC: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'דוח כושר פירעון' };
const per = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const what = (n: number) => (n === 1 ? 'חדש אחד' : `${n} חדשים`);
const title = (n: number, v: Visit | null) => `${what(n)} מאז ${pubLabel(v?.d)}`;

/** A dot (or, with `n`, the count) beside a company's name: new filings, restatements, targets or a regulator month since the last visit. */
export function SinceDot({ id, n = false }: { id: string; n?: boolean }) {
  const { fresh, visit } = useSince(id);
  if (!fresh.length) return null;
  const t = title(fresh.length, visit);
  return n
    ? <span className="since-n num" title={t} aria-label={t}>{fresh.length}</span>
    : <span className="since-dot" title={t} role="img" aria-label={t} />;
}

/** The company header: "3 חדשים מאז 12.10.26", to the list on the company home. */
export function SinceChip({ id }: { id: string }) {
  const { fresh, visit } = useSince(id);
  if (!fresh.length) return null;
  return <Link className="chip since-chip" to={`/company/${id}#since`} title="מה התפרסם מאז הביקור הקודם שלך בחברה"><span className="since-dot" aria-hidden="true" /><span className="num">{fresh.length}</span> חדש מאז <span className="num">{pubLabel(visit?.d)}</span></Link>;
}

/** One event as a row: what it is (with its link), and its date. */
function EventRow({ id, e, data }: { id: string; e: SinceEvent; data: SinceData }) {
  const href = (path: string | null | undefined, pg?: number | null) => (path ? `${data.files}${path}${pg ? `#page=${pg}` : ''}` : null);
  let body: ReactNode;
  if (e[0] === 'f') {
    const [, , , type, p, , path, pages] = e;
    body = <><a href={href(path) ?? undefined} target="_blank" rel="noreferrer">{DOC[type] ?? type} <span className="num">{per(p)}</span></a>{pages != null && <span className="muted num"> · {pages} עמ׳</span>}{(type === 'quarterly' || type === 'annual') && <CardLink id={id} p={p} />}</>;
  } else if (e[0] === 'r') {
    const [, , , season, , , n, big] = e;
    body = <Link to={`/company/${id}?p=${season}#rd-restated`}>הצגה מחדש בדוח <span className="num">{per(season)}</span>: <span className="num">{n}</span> נתונים{big > 0 && <>, <span className="num">{big}</span> ב-2% ומעלה</>}</Link>;
  } else if (e[0] === 't') {
    const [, , , label, entity, , pg, path, revised] = e;
    const h = href(path, pg);
    body = <>{revised ? 'יעד עודכן' : 'יעד'}: {h ? <a href={h} target="_blank" rel="noreferrer">{label}</a> : label}{entity && <span className="muted"> · {entity}</span>}</>;
  } else {
    body = <Link to={`/company/${id}/savings`}>נתוני רשות שוק ההון · <span className="num">{monthLabel(e[3])}</span></Link>;
  }
  return <li>{body}<span className="num muted since-dt">{pubLabel(e[1])}</span></li>;
}

const ORDER: SinceEvent[0][] = ['f', 'r', 't', 'm'];
/** On the company home: what arrived since the previous visit, grouped by kind, each with its link. */
export function SinceBlock({ id }: { id: string }) {
  const { fresh, visit, data } = useSince(id);
  const [all, setAll] = useState(false);
  const phone = usePhone();
  if (!fresh.length || !data) return null;
  const sorted = [...fresh].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]) || b[1].localeCompare(a[1]));
  const shown = all ? sorted : sorted.slice(0, phone ? 3 : 6);
  return (
    <section className="panel since-block" id="since" aria-label="חדש מאז הביקור הקודם">
      <div className="hd"><h2>חדש מאז <span className="num">{pubLabel(visit?.d)}</span></h2><div className="aside"><span className="num">{fresh.length}</span></div></div>
      <ul className="since-list">{shown.map((e) => <EventRow key={e[2]} id={id} e={e} data={data} />)}</ul>
      {sorted.length > shown.length && <button type="button" className="chip" onClick={() => setAll(true)}>עוד <span className="num">{sorted.length - shown.length}</span></button>}
    </section>
  );
}

/** The home's season strip: every company with something new since its own last visit (replaces the one global "since" date). */
export function SinceStrip() {
  const { data, rows } = useSinceAll();
  const reg = useRegistry();
  const [open, setOpen] = useState(false);
  // the one global "seen" date of before: carried once to every company as its last visit, then dropped
  useEffect(() => {
    if (!data) return;
    const seen = readStored<string>('seen', '');
    if (!seen) return;
    if (!storedKeys('visit.').length) Object.keys(data.co).forEach((id) => writeStored(KEY(id), { d: seen, s: [] } satisfies Visit));
    writeStored('seen', undefined);
  }, [data]);
  if (!data || !rows.length) return null;
  const n = rows.reduce((s, r) => s + r.fresh.length, 0);
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  return (
    <>
      <button type="button" className="chip loaded since-sum" aria-expanded={open} onClick={() => setOpen(!open)} title="לכל חברה: מה התפרסם מאז שפתחת אותה בפעם האחרונה">
        <span className="num">{n}</span> חדשים · <span className="num">{rows.length}</span> {rows.length === 1 ? 'חברה' : 'חברות'}
      </button>
      {open && (
        <div className="since-pop">
          {rows.map((r) => (
            <div key={r.id} className="since-co">
              <h3><i className="hm-dot" style={{ background: idCss(r.id) }} aria-hidden="true" /><Link to={`/company/${r.id}#since`}>{name(r.id)}</Link><span className="muted"> · מאז <span className="num">{pubLabel(r.visit.d)}</span></span></h3>
              <ul className="since-list">{r.fresh.slice(0, 5).map((e) => <EventRow key={e[2]} id={r.id} e={e} data={data} />)}</ul>
              {r.fresh.length > 5 && <Link className="muted" to={`/company/${r.id}#since`}>ועוד <span className="num">{r.fresh.length - 5}</span></Link>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
