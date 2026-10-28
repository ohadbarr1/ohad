import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from './Source';
import { Chart } from './Chart';
import { copyText } from './ui';
import { bookOption } from '../lib/bookChart';
import { useBook } from '../lib/book';
import { citeLine } from '../lib/exportProv';
import { load } from '../lib/useData';
import {
  BASIS_HE, CHG_HE, RUNG_HE, RUNGS, basisTag, cites, emailText, figIds, mergeCites, segments, sourceLine,
  type Fig, type OkBody, type Rung,
} from '../lib/answers';
import { aprov, exhibitSpec, ltsCite, useNames, warmBody } from '../lib/answersLoad';
import '../styles/answers.css';

/* S6 · the Answer Ladder: one answer (an S1 question or an S2 finding) at three altitudes one click apart. Corridor = the sentence, one
   number; email = the paragraph with a source line built from the provenance of every figure it quotes (a copy button gives plain
   text, no site name); exhibit = the chart or table with its title, footnotes and sources (to the chart book, or a one-slide PPTX
   without the site's mark). Every figure is a Sourced button: it opens its source sheet. */

/** a figure text with no Hebrew in it ("1.00×", "−5.5%") is isolated left-to-right, as Sourced does */
const ltrNum = (t: string) => /\d/.test(t) && !/[\u0590-\u05FF]/.test(t);

/** a sentence with its tokens as sourced figures; a non-actual figure carries its basis (יעד / צפי / אומדן) beside it */
export function Tokens({ text, figs, thr }: { text: string; figs: Record<string, Fig>; thr?: string }) {
  const segs = useMemo(() => segments(text, figs, thr), [text, figs, thr]);
  return <>{segs.map((s, i) => {
    if (s.k === 'text') return <Fragment key={i}>{s.s}</Fragment>;
    if (s.k === 'thr') return <b key={i} className={`an-thr${ltrNum(s.s) ? ' num' : ''}`}>{ltrNum(s.s) ? s.s : <bdi>{s.s}</bdi>}</b>;
    if (s.k === 'miss') return <span key={i} className="an-miss" title={`לנתון {${s.id}} אין מקור`}>?</span>;
    const tag = basisTag(s.f);
    return <Fragment key={i}><Sourced className="an-fig" src={() => aprov(s.f.prov)} title={`${s.f.l} · ${s.f.asof} · לחיצה: המקור`}>{s.f.t}</Sourced>{tag && <span className={`an-b b-${s.f.b}`}>{tag}</span>}</Fragment>;
  })}</>;
}

const dataDate = () => load<{ built?: string }>('qa.json').then((q) => q.built?.slice(0, 10) ?? undefined, () => undefined);

/** the exhibit rung: chart (the chart book's renderer) or table, its footnotes and sources, and the two exports */
function ExhibitView({ b, bookKey, route }: { b: OkBody; bookKey: string; route: string }) {
  const ex = b.ex!;
  const spec = useMemo(() => exhibitSpec(ex, b, bookKey, route), [ex, b, bookKey, route]);
  const book = useBook();
  const inBook = book.has(bookKey);
  const [deck, setDeck] = useState<string | null>(null);
  const table = ex.kind === 'table' && ex.rows && ex.rows.length > 1;
  const srcText = citeLine(spec.sources, 5);
  const pptx = async () => {
    setDeck('…');
    try {
      const [{ exportDeck }, dd] = await Promise.all([import('../lib/pptx'), dataDate()]);
      await exportDeck([{ ...spec, dataDate: dd }], { title: ex.title, theme: 'phoenix', host: location.host, built: new Date().toISOString(), dataDate: dd, brand: false });
      setDeck(null);
    } catch { setDeck('שגיאה'); setTimeout(() => setDeck(null), 1800); }
  };
  const add = async () => { const dd = await dataDate(); book.add({ ...spec, dataDate: dd }); };
  return (
    <figure className="an-ex">
      <figcaption><b className="an-ex-t">{ex.title}</b><span className="an-ex-s">{[ex.unit, ex.span].filter(Boolean).join(' · ')}</span></figcaption>
      {table ? (
        <div className="an-tw"><table className="an-tbl">
          <thead><tr>{ex.rows![0].map((h, i) => <th key={i} scope="col">{h ?? ''}</th>)}</tr></thead>
          <tbody>{ex.rows!.slice(1).map((r, i) => <tr key={i}>{r.map((c, k) => (k === 0 ? <th key={k} scope="row">{c ?? '–'}</th> : <td key={k} className="num">{c == null ? '–' : typeof c === 'number' ? c.toLocaleString('he-IL') : c}</td>))}</tr>)}</tbody>
        </table></div>
      ) : <Chart build={() => bookOption(spec)} deps={[spec]} label={ex.title} height={300} tools={false} bookable={false} />}
      {(ex.foot?.length ?? 0) > 0 && <ol className="an-foot">{ex.foot.map((f, i) => <li key={i}>{f}</li>)}</ol>}
      <p className="an-srcs"><b>מקורות:</b> {srcText || 'הנתונים בטבלת הנתונים למטה, כל אחד עם המקור שלו'}</p>
      <div className="an-tools">
        {table ? <span className="dim" title="ספר הגרפים מחזיק גרפים; טבלה יוצאת כשקף">טבלה: ייצוא כשקף בלבד</span>
          : inBook ? <Link className="an-btn" to="/book">בספר הגרפים ✓</Link> : <button type="button" className="an-btn" onClick={() => void add()}>+ לספר הגרפים</button>}
        <button type="button" className="an-btn" onClick={() => void pptx()} title="שקף PowerPoint אחד, גרף עריך ומקורות, בלי סימן האתר">{deck ?? 'שקף PPTX'}</button>
      </div>
    </figure>
  );
}

/** the three rungs, one click apart. `rung` / `onRung` let a page keep the rung in its address; else the ladder keeps it */
export function Ladder({ b, bookKey, route, rung: given, onRung, compact }: { b: OkBody; bookKey: string; route: string; rung?: Rung; onRung?: (r: Rung) => void; compact?: boolean }) {
  const [own, setOwn] = useState<Rung>('corr');
  const rung = given ?? own, set = onRung ?? setOwn;
  const names = useNames();
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { warmBody(b); }, [b]);
  const ids = figIds(b.email);
  const srcLine = sourceLine(b.figs, ids, ltsCite, names);
  const copy = () => copyText(emailText(b, { lts: ltsCite, names }), (ok) => { setCopied(ok ? 'הועתק ✓' : 'ההעתקה נחסמה'); setTimeout(() => setCopied(null), 1800); });
  const rungs = RUNGS.filter((r) => r !== 'ex' || b.ex);
  return (
    <div className={`an-ladder${compact ? ' compact' : ''}`}>
      <div className="an-rungs" role="group" aria-label="גובה התשובה">
        {rungs.map((r, i) => <button key={r} type="button" aria-pressed={rung === r} onClick={() => set(r)}><span className="an-rn num" aria-hidden="true">{i + 1}</span>{RUNG_HE[r]}</button>)}
      </div>
      {rung === 'corr' && <p className="an-corr"><Tokens text={b.corr} figs={b.figs} /></p>}
      {rung === 'email' && <div className="an-mail">
        <p className="an-email"><Tokens text={b.email} figs={b.figs} /></p>
        <p className="an-meta">{b.asof && <>נכון ל-<span className="num">{b.asof}</span></>}{b.mix && b.mix.length > 1 && <> · <span className="an-mix">בסיסים מעורבים: {b.mix.map((x) => BASIS_HE[x] ?? x).join(', ')}</span></>}</p>
        {srcLine && <p className="an-srcs">{srcLine}</p>}
        <div className="an-tools"><button type="button" className="an-btn" onClick={copy}>{copied ?? 'העתקת המייל עם המקורות'}</button><span className="dim">טקסט פשוט, בלי שם האתר</span></div>
      </div>}
      {rung === 'ex' && b.ex && <ExhibitView b={b} bookKey={bookKey} route={route} />}
    </div>
  );
}

/** the falsifier: what would change the answer, its threshold, and whether it has been crossed */
export function Falsifier({ b }: { b: OkBody }) {
  if (!b.chg) return null;
  const c = b.chg;
  return (
    <div className={`an-chg ${c.st}`}>
      <span className="an-chg-l">משתנה אם</span>
      <span className="an-chg-t"><Tokens text={c.text} figs={b.figs} thr={c.thr} /></span>
      <span className={`an-st ${c.st}`}>{CHG_HE[c.st]}</span>
      {b.figs[c.fig] && <span className="dim">עכשיו: <Sourced src={() => aprov(b.figs[c.fig].prov)}>{b.figs[c.fig].t}</Sourced> · סף {ltrNum(c.thr) ? <span className="num">{c.thr}</span> : <bdi>{c.thr}</bdi>}</span>}
    </div>
  );
}

/** every figure of the answer: label, value (its source), basis, as-of, source document */
export function FigTable({ b }: { b: OkBody }) {
  const names = useNames();
  const rows = Object.entries(b.figs);
  return (
    <div className="an-ftw">
      <table className="an-ft">
        <caption className="sr-only">הנתונים של התשובה</caption>
        <thead><tr><th scope="col">נתון</th><th scope="col">ערך</th><th scope="col">בסיס</th><th scope="col">נכון ל-</th><th scope="col">מקור</th></tr></thead>
        <tbody>{rows.map(([id, f]) => {
          const cs = mergeCites(cites(f.prov, ltsCite, names));
          return (
            <tr key={id}>
              <th scope="row" data-l="נתון">{f.l}</th>
              <td data-l="ערך"><Sourced className="an-fig" src={() => aprov(f.prov)} title={`${f.l} · לחיצה: המקור`}>{f.t}</Sourced></td>
              <td data-l="בסיס"><span className={`an-b b-${f.b}${f.b === 'actual' ? ' plain' : ''}`}>{BASIS_HE[f.b] ?? f.b}</span></td>
              <td data-l="נכון ל-"><span className="num">{f.asof}</span></td>
              <td data-l="מקור" className="an-fsrc">{cs.length ? cs.slice(0, 2).map((c) => `${c.doc}${c.pages.length ? `, עמ׳ ${c.pages.join(', ')}` : ''}`).join('; ') + (cs.length > 2 ? ` ועוד ${cs.length - 2}` : '') : '–'}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

/** the whole answer: the ladder, then what would change it, its figures, its basis mix, the related questions and the detail pages */
export function AnswerDetail({ b, bookKey, route, rung, onRung, rel }: { b: OkBody; bookKey: string; route: string; rung?: Rung; onRung?: (r: Rung) => void; rel?: { id: string; q: string }[] }) {
  return (
    <div className="an">
      <Ladder b={b} bookKey={bookKey} route={route} rung={rung} onRung={onRung} />
      <Falsifier b={b} />
      {b.note && <p className="an-note">{b.note}</p>}
      <section className="an-sec" aria-labelledby={`ft-${bookKey}`}>
        <h2 id={`ft-${bookKey}`} className="an-h">הנתונים{b.mix && b.mix.length > 1 && <span className="an-mix">בסיסים מעורבים: {b.mix.map((x) => BASIS_HE[x] ?? x).join(', ')}, כל נתון מסומן</span>}</h2>
        <FigTable b={b} />
      </section>
      {((rel && rel.length > 0) || b.links.length > 0) && (
        <div className="an-more">
          {rel && rel.length > 0 && <div><h2 className="an-h">שאלות קשורות</h2><ul className="an-rel">{rel.map((r) => <li key={r.id}><span className="mono dim">{r.id}</span> <Link to={`/questions/${r.id}`}>{r.q}</Link></li>)}</ul></div>}
          {b.links.length > 0 && <div><h2 className="an-h">לעמודי הפירוט</h2><ul className="an-rel">{b.links.map((l) => <li key={l.to}><Link to={l.to}>{l.l}</Link></li>)}</ul></div>}
        </div>
      )}
    </div>
  );
}
