import { Link } from 'react-router-dom';
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

/** One event: when, what, who, the headline (a link to the page that shows it), its document, then its figures. */
export function FeedItem({ F, e, byId, compact }: { F: FeedFile; e: FeedEvent; byId?: Map<string, FeedEvent>; compact?: boolean }) {
  const name = F.cos[e.c] ?? e.c;
  const src = eventSource(F, e);
  return (
    <li className={`fd-ev t-${e.t}`} id={compact ? undefined : `ev-${e.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`}>
      <div className="fd-hd">
        <span className="fd-when num" title={`${DK_HE[e.dk]}${e.dk === 'month' ? ' (יום הפרסום של הרשות אינו נשמר)' : ''}`}>{e.dk === 'month' ? <>{ymLabel(Number(e.per))}<small>חודש נתונים</small></> : <>{pubLabel(e.d)}{e.dk === 'fetched' && <small>התקבל</small>}</>}</span>
        <span className={`chip fd-t t-${e.t}${e.st ? ` st-${e.st}` : ''}`}>{TYPE_SHORT[e.t]}</span>
        {e.c === 'market' ? <span className="fd-co">{name}</span> : <Link className="fd-co" to={`/company/${e.c}`}><i className="pdot" style={{ background: idCss(e.c) }} />{name}</Link>}
        <Link className="fd-h" to={e.to}>{e.h}</Link>
        {!compact && (src.href ? <a className="fd-src" href={src.href} target="_blank" rel="noreferrer" title="המסמך במאיה">{src.text}</a> : <span className="fd-src">{src.text}</span>)}
      </div>
      {!compact && <Rows F={F} e={e} name={name} />}
      {!compact && e.refs?.length ? (
        <div className="fd-refs">מעברים בצבירה נטו, LTM: {e.refs.map((id, i) => { const x = byId?.get(id); return x ? <span key={id}>{i ? ' · ' : ''}<a href={`#ev-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`}>{F.cos[x.c] ?? x.c}</a> <span className="dim">{x.h.split(':')[0]}</span></span> : null; })}</div>
      ) : null}
    </li>
  );
}

