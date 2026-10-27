import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from './Source';
import { Unverified } from './Unverified';
import { periodLabel, pubLabel } from '../lib/format';
import { idCss } from '../lib/identity';
import type { Prov } from '../lib/prov';
import { calc, report } from '../pages/companyProv';

/* The report card (lane S2, v1 numbers only): cards/<company>/<period>.json from pipeline/build_cards.py. The page shows exactly the
   text of each fact (`t`), never a number of its own: pipeline/check_cards.py proves every digit on the card is a published fact. */

export type Tok = string | { f: string } | { p: string } | { d: string } | { pl: [string, string] } | { y: number };
export interface CardSrc { k: 'pg' | 'calc' | 'xbrl' | 'count'; u?: number | null; pg?: number | null; dp?: string | null; dt?: string; fl?: string[]; l?: string | null; late?: string;
  op?: string; in?: string[]; fx?: string; rid?: number | null; ref?: { l: string; q?: string } }
export interface CardFact { v: number; u: 'm' | 'pct' | 'pp' | 'dpct' | 'dm' | 'x' | 'n' | 'tpct'; t: string; s: CardSrc; std?: '17' | '4' }
export interface CardRow { k: string; l: string; cur: string; yoy?: string; dy?: string | null; qoq?: string; dq?: string | null; y0?: string; alt?: 1; der?: 1; dyx?: string; dqx?: string; basis?: string; at?: string; multi?: 1 }
export interface CardTarget { i: number; l: string; e: string; src?: string | null; v?: string; lo?: string; hi?: string; h?: number | null; act?: string; st?: string | null; y?: number }
export interface Card {
  v: number; c: string; name: string; kind: 'ins' | 'fund'; p: string; end: string; w: 'Q' | 'FY'; st: 'verified' | 'unverified';
  doc: { rid: number | null; pub: string | null; u: number | null; pages: number | null } | null; cmp?: { y: string | null; q: string | null }; t0?: { how?: string };
  rows: CardRow[]; lead: Tok[][]; board?: { t: string[]; d: string; hd?: string; base?: 'w' | 'wo' };
  rest?: { n: string; big: string; top: { i: number; l: string; pl: [string, string]; a: string; b: string; d: string }[] }; tg: CardTarget[];
  f: Record<string, CardFact>; u: string[]; chk: string;
}

export const repName = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const UNIT: Record<CardFact['u'], string> = { m: 'מיליוני ש"ח', pct: '%', tpct: '%', pp: 'נק׳', dpct: '%', dm: 'מיליוני ש"ח', x: '', n: '' };
const DOC: Record<string, string> = { report: 'דוח', deck: 'מצגת', solvency: 'דוח כושר פירעון' };
const COUNT: Record<string, string> = { rest: 'נתונים של תקופות קודמות שהדוח הציג בערך שונה מזה שדווח אז', rest_big: 'מהם בשינוי של 2% ומעלה מהערך שדווח אז', facts: 'מספרים מודפסים שהכרטיס נבדק מולם, כל אחד בעמוד שבו הודפס' };

/** Where a fact comes from, in the site's source sheet: the printed page, the computation and its inputs, or the XBRL tag. */
export function cardProv(card: Card, id: string, title: string): Prov {
  const f = card.f[id], s = f.s;
  if (s.k === 'calc') {
    return calc(title, f.t, s.fx ?? '', (s.in ?? []).map((x) => ({ label: card.f[x]?.s.l ?? labelOf(card, x), v: card.f[x]?.t ?? '', src: () => cardProv(card, x, `${title} · ${card.f[x]?.s.l ?? labelOf(card, x)}`) })), UNIT[f.u] || undefined,
      s.op === 'tgact' ? 'בפועל כפי שחושב מול היעד (טבלת היעדים); ההגדרה של החברה עשויה להיות שונה' : undefined);
  }
  if (s.k === 'count') return { k: 'calc', title, value: f.t, formula: COUNT[s.ref?.q ?? ''] ?? 'ספירה', inputs: [] };
  if (s.k === 'xbrl') return { k: 'xbrl', title, value: f.t, unit: UNIT[f.u], company: card.c, period: repName(card.p), rid: s.rid ?? null, concept: title, status: 'לא מאומת' };
  const fl = s.fl ?? [];
  return report({ title, value: f.t, unit: UNIT[f.u] || undefined, url: s.u != null ? card.u[s.u] ?? null : null, pg: s.pg ?? null, doc: `${DOC[s.dt ?? 'report'] ?? 'דוח'}${s.dp ? ` ${repName(s.dp)}` : ''}`,
    der: fl.includes('der'), old: f.std === '4' || fl.includes('ifrs4'),
    note: [s.l ? `שורה: ${s.l}` : '', s.late ? `כפי שהודפס מחדש בדוח ${repName(s.late)}` : '', fl.includes('re') ? 'הוצג מחדש בדוח מאוחר יותר' : '', fl.includes('chart') ? 'נקרא מגרף' : '', fl.includes('text') ? 'נקרא מטקסט הדוח' : '', fl.includes('cmp') ? 'ממספרי ההשוואה של דוח מאוחר יותר' : ''].filter(Boolean).join(' · ') || undefined });
}

/** a fact's name, from the row or block that shows it */
function labelOf(card: Card, id: string): string {
  for (const r of card.rows) {
    const which = r.cur === id ? 'cur' : r.yoy === id ? 'yoy' : r.qoq === id ? 'qoq' : r.dy === id ? 'dy' : r.dq === id ? 'dq' : r.y0 === id ? 'y0' : null;
    if (which) return `${r.l}${which === 'cur' ? '' : which === 'yoy' ? ' · שנה קודם' : which === 'qoq' ? ' · רבעון קודם' : which === 'y0' ? ' · כפי שדווח לראשונה' : ' · שינוי'}`;
  }
  if (card.board?.hd === id) return 'מרווח מעל יעד הדירקטוריון';
  if (card.board?.t.includes(id)) return 'יעד הדירקטוריון';
  if (id === 'nbrel') return 'עסק חדש ÷ שחרור לרווח';
  if (id === card.chk) return 'נבדק מול';
  return card.f[id]?.s.l ?? id;
}

/** One fact as the card shows it: its own text, opening its source. */
export function N({ card, id, title, className = '' }: { card: Card; id: string | null | undefined; title?: string; className?: string }) {
  if (!id || !card.f[id]) return <span className="muted">–</span>;
  const f = card.f[id], change = f.u === 'dpct' || f.u === 'dm' || f.u === 'pp' || f.u === 'x';
  const tone = change ? (f.v > 0 && f.u !== 'x' ? 'pos' : f.v < 0 ? 'neg' : '') : f.v < 0 ? 'neg' : '';
  const t = `${title ?? labelOf(card, id)} · ${card.name} · ${repName(card.p)}`;
  // the figure is isolated left to right; a Hebrew unit after it ("נק׳", "מ׳") stays outside the isolate
  const m = /^(.*?\d)(\s*[\u0590-\u05FF].*)?$/.exec(f.t), digits = m ? m[1] : f.t, unit = m?.[2];
  return <Sourced className={`rc-n ${tone} ${f.s.k === 'calc' && !change ? 'der' : ''} ${className}`} src={() => cardProv(card, id, t)} title={f.s.pg != null ? `עמ׳ ${f.s.pg}` : f.s.k === 'calc' ? 'חושב' : undefined}><span className="num">{digits}</span>{unit}</Sourced>;
}

/** A templated sentence: literal text, facts, periods and dates. */
export function Line({ card, toks }: { card: Card; toks: Tok[] }) {
  return <>{toks.map((t, i): ReactNode => typeof t === 'string' ? t
    : 'f' in t ? <N key={i} card={card} id={t.f} />
    : 'p' in t ? <span key={i} className="num">{repName(t.p)}</span>
    : 'pl' in t ? <span key={i} className="num">{periodLabel(t.pl[0], t.pl[1])}</span>
    : 'd' in t ? <span key={i} className="num">{pubLabel(t.d)}</span>
    : <span key={i} className="num">{t.y}</span>)}</>;
}

// the same words as the targets tracker (lib/targets ST_HE), so a policy or a partial target never shows its raw key
const ST_HE: Record<string, string> = { open: 'פתוח', met: 'הושג', missed: 'לא הושג', partial: 'חלקית', nc: 'לא ניתן להשוואה', policy: 'מדיניות' };

/** The card itself: header, lead, headline table, capital, restatements, targets, stamp. With `tiles` (a phone), the tiles take the
 *  table's place under the header, so the first screen carries every headline figure. */
export function ReportCardView({ card, actions, tiles }: { card: Card; actions?: ReactNode; tiles?: ReactNode }) {
  const docUrl = card.doc?.u != null ? card.u[card.doc.u] : null;
  const curL = periodLabel(card.w, card.end);
  const yL = card.cmp?.y ? (card.w === 'FY' ? repName(card.cmp.y) : repName(card.cmp.y)) : '';
  const qL = card.cmp?.q ? repName(card.cmp.q).replace('FY', 'Q4') : '';
  const hasQ = card.rows.some((r) => r.qoq);
  const sr = card.rows.find((r) => r.k === 'sr');
  const hd = card.board?.hd ? card.f[card.board.hd] : null, tg0 = card.board?.t.length === 1 ? card.f[card.board.t[0]] : null;
  return (
    <article className={`rc rc-${card.st}`} aria-label={`כרטיס דוח · ${card.name} · ${repName(card.p)}`}>
      <header className="rc-head">
        <div className="rc-id">
          <span className="rc-kicker">כרטיס דוח</span>
          <h1><i className="rc-dot" style={{ background: idCss(card.c) }} aria-hidden="true" /><Link to={`/company/${card.c}`}>{card.name}</Link> <span className="num rc-per">{repName(card.p)}</span></h1>
          <div className="rc-meta">
            {card.doc?.pub && <span>פורסם <span className="num">{pubLabel(card.doc.pub)}</span></span>}
            {card.st === 'verified'
              ? <span className="chip rc-ok" title="כל מספר בכרטיס מהדוח המודפס, עם העמוד שבו הודפס; נבדק אוטומטית מול הנתונים המפורסמים">מאומת</span>
              : <Unverified info={{ period: card.p, rid: card.doc?.rid ?? null, pub: card.doc?.pub ?? null, how: card.t0?.how }} />}
          </div>
        </div>
        <div className="rc-acts">
          {docUrl && <a className="chip" href={docUrl} target="_blank" rel="noreferrer">הדוח המלא{card.doc?.pages ? <> · <span className="num">{card.doc.pages}</span> עמ׳</> : null}</a>}
          <Link className="chip" to={`/company/${card.c}?p=${card.p}`}>יום הדוח</Link>
          {actions}
        </div>
      </header>

      {tiles}
      {card.lead.length > 0 && <ul className="rc-lead">{card.lead.map((l, i) => <li key={i}><Line card={card} toks={l} /></li>)}</ul>}

      {!tiles && card.rows.length > 0 && (
        <section className="rc-sec">
          <h2>עיקרי הדוח <span className="muted">מיליוני ש"ח · כפי שדווח</span></h2>
          <div className="rc-tbl" role="table" aria-label="עיקרי הדוח">
            <div className="rc-tr rc-th" role="row"><span role="columnheader">שורה</span><span role="columnheader" className="num">{curL}</span><span role="columnheader">YoY{yL && <> · <span className="num">{yL}</span></>}</span>{hasQ && <span role="columnheader" className="rc-q">QoQ{qL && <> · <span className="num">{qL}</span></>}</span>}</div>
            {card.rows.map((r) => (
              <div className="rc-tr" role="row" key={r.k}>
                <span role="rowheader" className="rc-l">{r.l}
                  {r.alt && <span className="chip est" title="אין בדוח שורת ייחוס לבעלי המניות; מוצגת שורת הרווח לתקופה">שורת הרווח</span>}
                  {r.der && <span className="chip est">נגזר</span>}
                  {r.basis && <span className="chip">{r.basis}</span>}
                  {r.at && r.at !== card.end && <span className="chip est">ליום <span className="num">{pubLabel(r.at)}</span></span>}
                  {r.multi && <span className="chip est">כמה ערכים</span>}
                  {card.f[r.cur]?.s.late && <span className="chip est" title="הנתון כפי שהודפס מחדש בדוח מאוחר יותר">לפי <span className="num">{repName(card.f[r.cur].s.late!)}</span></span>}
                </span>
                <span role="cell" className="rc-cur"><N card={card} id={r.cur} /></span>
                <span role="cell" className="rc-c" data-h="YoY">{r.yoy ? <>{r.dy ? <N card={card} id={r.dy} className="rc-d" /> : <span className="rc-d muted" title="הנתונים נמדדו לפי תקנים שונים">{r.dyx === 'std' ? 'תקן שונה' : ''}</span>}<span className="rc-base"><N card={card} id={r.yoy} />{r.y0 && <span className="rc-y0" title="הנתון שדווח לראשונה, לפני ההצגה מחדש">במקור <N card={card} id={r.y0} /></span>}</span></> : <span className="muted">–</span>}</span>
                {hasQ && <span role="cell" className="rc-c rc-q" data-h="QoQ">{r.qoq ? <>{r.dq ? <N card={card} id={r.dq} className="rc-d" /> : <span className="rc-d muted">{r.dqx === 'std' ? 'תקן שונה' : ''}</span>}<span className="rc-base"><N card={card} id={r.qoq} /></span></> : <span className="muted">–</span>}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {sr && card.board && (
        <section className="rc-sec rc-cap">
          <h2>כושר פירעון מול יעד הדירקטוריון</h2>
          <div className="rc-capline">
            <span>יחס, עם הוראות מעבר <N card={card} id={sr.cur} /></span>
            <span>יעד{card.board.base === 'wo' ? ' (ללא הוראות מעבר)' : ''} {card.board.t.map((t, i) => <span key={t}>{i > 0 && ' · '}<N card={card} id={t} /></span>)}</span>
            {card.board.hd && <span>מרווח <N card={card} id={card.board.hd} /></span>}
          </div>
          {hd && tg0 && card.board.base === 'w' && (
            <div className="rc-bar" aria-hidden="true"><i className="rc-bar-v" style={{ inlineSize: `${Math.min(100, (card.f[sr.cur].v / Math.max(card.f[sr.cur].v, tg0.v) / 1.15) * 100)}%` }} /><i className="rc-bar-t" style={{ insetInlineStart: `${Math.min(100, (tg0.v / Math.max(card.f[sr.cur].v, tg0.v) / 1.15) * 100)}%` }} /></div>
          )}
        </section>
      )}

      {card.rest && (
        <section className="rc-sec">
          <h2>הוצג מחדש בדוח <span className="muted"><N card={card} id={card.rest.n} /> נתונים · <N card={card} id={card.rest.big} /> ב-2% ומעלה</span></h2>
          {card.rest.top.length > 0 && <table className="rc-rest tight"><thead><tr><th>שורה ותקופה</th><th>כפי שדווח אז</th><th>כפי שהוצג מחדש</th><th>הפרש</th></tr></thead>
            <tbody>{card.rest.top.map((t) => <tr key={t.a}><td className="lbl">{t.l} <span className="dim num">{periodLabel(t.pl[0], t.pl[1])}</span></td><td><N card={card} id={t.a} title={`${t.l} · כפי שדווח אז`} /></td><td><N card={card} id={t.b} title={`${t.l} · כפי שהוצג מחדש`} /></td><td><N card={card} id={t.d} title={`${t.l} · הפרש`} /></td></tr>)}</tbody></table>}
          <Link className="rc-more" to={`/company/${card.c}?p=${card.p}#rd-restated`}>כל ההצגות מחדש בדוח</Link>
        </section>
      )}

      {card.tg.length > 0 && (
        <section className="rc-sec">
          <h2>יעדים {card.w === 'FY' && <span className="muted">יעד מול בפועל, <span className="num">FY'{card.p.slice(2, 4)}</span></span>}</h2>
          <table className="rc-tg tight"><thead><tr><th>יעד</th><th>יעד</th>{card.tg.some((t) => t.act) && <th>בפועל</th>}</tr></thead>
            <tbody>{card.tg.map((t) => (
              <tr key={t.i}>
                <td className="lbl">{t.l}<span className="dim">{t.e}{t.h ? <> · <span className="num">{t.h}</span></> : null}{t.src === 'pres' ? ' · מצגת' : ''}</span></td>
                <td>{t.v ? <N card={card} id={t.v} title={t.l} /> : <>{t.lo && <N card={card} id={t.lo} title={`${t.l} · מ-`} />}{t.lo && t.hi && '–'}{t.hi && <N card={card} id={t.hi} title={`${t.l} · עד`} />}</>}</td>
                {card.tg.some((x) => x.act) && <td>{t.act ? <><N card={card} id={t.act} title={`${t.l} · בפועל`} />{t.st && <span className={`chip ${t.st === 'met' ? 'rc-ok' : t.st === 'missed' ? 'neg' : ''}`}>{ST_HE[t.st] ?? t.st}</span>}</> : <span className="muted">–</span>}</td>}
              </tr>
            ))}</tbody></table>
        </section>
      )}

      <footer className="rc-foot">
        <span>אוטומטי · נבדק מול <N card={card} id={card.chk} /> עובדות מודפסות · כל מספר נפתח בעמוד המקור</span>
        <span className="muted">fox · MAYA{card.doc?.pub ? <> · <span className="num">{pubLabel(card.doc.pub)}</span></> : null}</span>
      </footer>
    </article>
  );
}

/** The phone face: the headline figures as tiles, one screen. */
export function ReportCardTiles({ card }: { card: Card }) {
  return (
    <div className="rc-tiles">{card.rows.map((r) => (
      <div className="rc-tile" key={r.k}>
        <span className="rc-tl">{r.l}</span>
        <span className="rc-tv"><N card={card} id={r.cur} /></span>
        <span className="rc-ts">{r.dy ? <><N card={card} id={r.dy} /> YoY</> : r.at ? <>ליום <span className="num">{pubLabel(r.at)}</span></> : ' '}</span>
      </div>
    ))}</div>
  );
}
