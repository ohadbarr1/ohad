import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../Icon';
import { Tokens } from '../Answer';
import { usePhone } from '../../lib/useMedia';
import { isOk, qScore, topFirst } from '../../lib/answers';
import { useAnswerIndex, useFindings, useNames, warmBody } from '../../lib/answersLoad';
import '../../styles/hub.css';
import '../../styles/answers.css';

/* S1 / S2 on the home page, under the advisory hub: the Finding Engine's top finding at the corridor rung (its figures open their
   sources; the link opens its ladder on /findings) and a field that filters the Question Index and jumps to an answer. Without
   findings.json the finding cell is not drawn; without the index the strip is not drawn. */
export function AskStrip() {
  const { data: I } = useAnswerIndex();
  const { data: F } = useFindings();
  const phone = usePhone();
  const names = useNames();
  const nav = useNavigate();
  const [text, setText] = useState('');
  const hits = useMemo(() => (I && text.trim() ? I.rows.map((r) => ({ r, s: qScore(r, text, names) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.r.id.localeCompare(b.r.id)).slice(0, phone ? 4 : 5).map((x) => x.r) : []), [I, text, names, phone]);
  const top = useMemo(() => (F ? topFirst(F.rows).find((r) => isOk(r)) ?? null : null), [F]);
  const tf = top && isOk(top) ? top : null;
  useEffect(() => { if (tf) warmBody(tf); }, [tf]);
  if (!I && !tf) return null;
  return (
    <section className={`ask${tf ? '' : ' one'}`} aria-label="שאלות וממצאים">
      {tf && top && <div className="ask-cell ask-f">
        <div className="hub-hd"><h2><Link className="hub-t" to="/findings"><span className="icotile sm"><Icon name="spark" /></span>הממצא המוביל{F!.dets[top.det] && <span className="muted"> · {F!.dets[top.det].he}</span>}</Link></h2><Link className="hub-more" to={`/findings?f=${top.id}`}>לתשובה המלאה</Link></div>
        <p className="hub-line ask-corr"><Tokens text={tf.corr} figs={tf.figs} /></p>
        <p className="hub-sub">מהותיות <b className="num">{top.mat?.t ?? '–'}</b> · הפתעה <b className="num">{top.sur?.t ?? '–'}</b> · שני רכיבים נפרדים, בלי ציון מצרפי{tf.asof && <> · נכון ל-<span className="num">{tf.asof}</span></>}</p>
      </div>}
      {I && <div className="ask-cell ask-q">
        <div className="hub-hd"><h2><Link className="hub-t" to="/questions"><span className="icotile sm"><Icon name="questions" /></span>שאלות</Link></h2><Link className="hub-more" to="/questions">כל השאלות · <span className="num">{I.n}</span></Link></div>
        <form role="search" aria-label="חיפוש שאלה" onSubmit={(e) => { e.preventDefault(); if (hits[0]) nav(`/questions/${hits[0].id}`); else if (text.trim()) nav(`/questions?q=${encodeURIComponent(text.trim())}`); }}>
          <label className="qi-search"><span className="sr-only">חיפוש שאלה באינדקס</span><Icon name="search" /><input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="מה שואלים אותך? מילה, חברה, Q-001" /></label>
        </form>
        {hits.length > 0 ? <ul className="ask-hits">{hits.map((r) => <li key={r.id}><span className="mono dim">{r.id}</span> <Link to={`/questions/${r.id}`}>{r.q}</Link></li>)}</ul>
          : text.trim() ? <p className="hub-sub">אין שאלה כזו באינדקס · <Link to="/questions">לרשום אותה ב"השאלות שלי"</Link></p>
          : <p className="hub-sub"><span className="num">{I.ok}</span> תשובות מחושבות מחדש בכל בנייה, לפי מי ששואל: {Object.values(I.chairs).slice(0, 4).join(', ')} ועוד</p>}
      </div>}
    </section>
  );
}
