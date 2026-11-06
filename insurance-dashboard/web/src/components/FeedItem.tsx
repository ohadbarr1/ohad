import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NumText } from './NumText';
import { copyText } from './ui';
import { SITE } from '../lib/seo';
import { Sourced } from './Source';
import { pubLabel } from '../lib/format';
import { idCss } from '../lib/identity';
import { DK_HE, eventSource, figProv, fmtFig, toneOf, TYPE_SHORT, UNIT_HE, ymLabel, type FeedEvent, type FeedFig, type FeedFile, type FeedRow } from '../lib/feed';
import '../styles/feed.css';

/** One figure of the feed: the number opens its source (a page of a filing, the regulator's tracks, a fund month, or the formula). */
export function Fig({ F, f, title, className = '' }: { F: FeedFile; f: FeedFig; title: string; className?: string }) {
  return <Sourced className={`num ${toneOf(f)} ${className}`.trim()} src={() => figProv(F, f, title)}>{fmtFig(f)}</Sourced>;
}

function Rows({ F, e, name }: { F: FeedFile; e: FeedEvent; name: string }) {
  const rows = e.rows ?? [];
  if (!rows.length) return null;
  const t = (r: FeedRow, k: 0 | 1) => `${r.l} · ${name}${r.ab?.[k] ? ` · ${r.ab[k]}` : ''}`;
  return (
    <div className="fd-rows" role="table" aria-label={`${name} · ${e.h}`}>
      {rows.map((r, i) => (
        <div className="fd-r" role="row" key={i}>
          <div className="fd-l" role="cell"><span>{r.l}</span>{(r.a.u === 'm' || r.a.u === 'bn') && <span className="fd-u">{UNIT_HE[r.a.u]}</span>}{r.note && <span className="fd-note">{r.note}</span>}</div>
          {r.rng ? (
            <div className="fd-a fd-rng" role="cell"><Fig F={F} f={r.a} title={`${r.l} (תחתית) · ${name}`} /> עד {r.b && <Fig F={F} f={r.b} title={`${r.l} (תקרה) · ${name}`} />}</div>
          ) : (
            <>
              <div className="fd-a" role="cell"><Fig F={F} f={r.a} title={t(r, 0)} className="fd-cur" />{r.ab?.[0] && <span className="fd-p num">{r.ab[0]}</span>}</div>
              <div className="fd-b" role="cell">{r.b ? <><Fig F={F} f={r.b} title={t(r, 1)} />{r.ab?.[1] && <span className="fd-p num">{r.ab[1]}</span>}</> : null}</div>
              <div className="fd-d" role="cell">
                {r.d && <Fig F={F} f={r.d} title={`שינוי · ${r.l} · ${name}`} />}
                {r.dp && <Fig F={F} f={r.dp} title={`שינוי % · ${r.l} · ${name}`} className="fd-dp" />}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** the anchor of an event on /feed: its permalink is /feed#ev-<anchor> (stable: event ids are stable across rebuilds, build_feed.py) */
export const evAnchor = (id: string) => `ev-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

/** a copy-permalink chip: SITE/feed#ev-<id>, the item's address to cite */
function Permalink({ id }: { id: string }) {
  const [done, setDone] = useState<'' | 'ok' | 'fail'>('');
  const url = `${SITE}/feed#${evAnchor(id)}`;
  return <a className="fd-link" href={`#${evAnchor(id)}`} title={`קישור קבוע לפריט: ${url}`}
    onClick={(ev) => { ev.preventDefault(); history.replaceState(history.state, '', `#${evAnchor(id)}`); copyText(url, (ok) => { setDone(ok ? 'ok' : 'fail'); setTimeout(() => setDone(''), 1600); }); }}>{done === 'ok' ? 'הועתק' : done === 'fail' ? 'העתקה נכשלה' : 'קישור'}</a>;
}

/** One event: when, what, who, the headline (a link to the page that shows it), its document, then its figures. */
/** the period an event describes: a quarter or year of a filing, a data month, a solvency date */
export const perText = (e: FeedEvent) => (/^\d{6}$/.test(e.per) ? ymLabel(Number(e.per)) : /^\d{4}FY$/.test(e.per) ? `FY'${e.per.slice(2, 4)}` : /^\d{4}Q\d$/.test(e.per) ? `${e.per.slice(4)}'${e.per.slice(2, 4)}` : /^\d{4}-\d{2}-\d{2}$/.test(e.per) ? pubLabel(e.per) : e.per);

/** `got`: the day fox received the event (data/feed_seen.json, pipeline/build_rss.py): [date, r] is shown as "התקבל" next to the period;
 *  [date, b] (before the ledger began) keeps the event's own date. Without it (the home block) the item shows the event's date only. */
export function FeedItem({ F, e, byId, compact, got }: { F: FeedFile; e: FeedEvent; byId?: Map<string, FeedEvent>; compact?: boolean; got?: [string, 'r' | 'b'] }) {
  const name = F.cos[e.c] ?? e.c;
  const src = eventSource(F, e);
  return (
    <li className={`fd-ev t-${e.t}`} id={compact ? undefined : evAnchor(e.id)}>
      <div className="fd-hd">
        {got?.[1] === 'r'
          ? <span className="fd-when num" title="היום שבו fox קלטה את השינוי">{pubLabel(got[0])}<small>התקבל</small></span>
          : <span className="fd-when num" title={`${DK_HE[e.dk]}${e.dk === 'month' ? ' (יום הפרסום של הרשות אינו נשמר)' : ''}`}>{e.dk === 'month' ? <>{ymLabel(Number(e.per))}<small>חודש נתונים</small></> : <>{pubLabel(e.d)}<small>{e.dk === 'fetched' ? 'התקבל' : e.dk === 'frozen' ? 'הוקפא' : 'פורסם'}</small></>}</span>}
        {/* the period, unless the date column already is it (a data month shown as its own date): an empty cell keeps the column */}
        {got && (got[1] !== 'r' && e.dk === 'month' ? <span className="fd-per" aria-hidden="true" /> : <span className="fd-per num" title="התקופה שהנתון מתאר"><small>תקופה</small>{perText(e)}</span>)}
        <span className={`chip fd-t t-${e.t}${e.st ? ` st-${e.st}` : ''}${e.fs ? ` fs-${e.fs}` : ''}`}>{TYPE_SHORT[e.t]}{e.fs ? ` · ${e.fs === 'alert' ? 'התראה' : 'מעקב'}` : ''}</span>
        {e.c === 'market' ? <span className="fd-co">{name}</span> : <Link className="fd-co" to={`/company/${e.c}`}><i className="pdot" style={{ background: idCss(e.c) }} />{name}</Link>}
        <Link className="fd-h" to={e.to}><NumText t={e.h} /></Link>
        {!compact && (src.href ? <a className="fd-src" href={src.href} target="_blank" rel="noreferrer" title="המסמך במאיה">{src.text}</a> : <span className="fd-src">{src.text}</span>)}
        {!compact && <Permalink id={e.id} />}
      </div>
      {!compact && <Rows F={F} e={e} name={name} />}
      {!compact && e.refs?.length ? (
        <div className="fd-refs">מעברים בצבירה נטו, LTM: {e.refs.map((id, i) => { const x = byId?.get(id); return x ? <span key={id}>{i ? ' · ' : ''}<a href={`#${evAnchor(id)}`}>{F.cos[x.c] ?? x.c}</a> <span className="dim">{x.h.split(':')[0]}</span></span> : null; })}</div>
      ) : null}
    </li>
  );
}

