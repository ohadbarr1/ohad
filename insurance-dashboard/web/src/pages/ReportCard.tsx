import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { ReportCardTiles, ReportCardView, repName, type Card } from '../components/ReportCard';
import { useCards, cardPath } from '../components/ReportCardLink';
import { useLoad, useRegistry } from '../lib/useData';
import { NotFound } from './NotFound';
import { usePhone } from '../lib/useMedia';
import '../styles/reportcard.css';

/** /card/:company/:period — the report card of one filing (lane S2): one screen on a phone, an A4 sheet on a desktop, shareable. */
export function ReportCardPage() {
  const { company = '', period = '' } = useParams();
  const idx = useCards();
  const reg = useRegistry();
  const listed = idx.data?.co[company]?.p ?? null;
  const ok = /^[a-z_]+$/.test(company) && /^\d{4}(Q[1-3]|FY)$/.test(period) && (!idx.data || !!listed?.includes(period));
  const card = useLoad<Card>(ok && idx.data ? `cards/${company}/${period}.json` : null);
  const phone = usePhone();
  const nav = useNavigate();
  const [copied, setCopied] = useState(false);

  if (reg.data && !reg.data.some((x) => x.id === company)) return <NotFound />;
  if (idx.error) return <ErrorBox what="רשימת הכרטיסים" error={idx.error} />;
  if (!idx.data) return <Loading what="כרטיס דוח" />;
  if (!ok) return <Empty title="אין כרטיס דוח לתקופה זו">{listed?.length ? <Link to={cardPath(company, listed[0])}>הכרטיס האחרון · <span className="num">{repName(listed[0])}</span></Link> : <Link to="/">לדף הבית</Link>}</Empty>;
  if (card.error) return <ErrorBox what="כרטיס הדוח" error={card.error} />;
  if (!card.data) return <Loading what="כרטיס דוח" />;
  const c = card.data, i = listed!.indexOf(period), newer = i > 0 ? listed![i - 1] : null, older = i < listed!.length - 1 ? listed![i + 1] : null;

  const share = async () => {
    const url = location.href, title = `כרטיס דוח · ${c.name} · ${repName(c.p)}`;
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* the reader closed the share sheet */ }
  };
  const actions = (
    <>
      <button type="button" className="chip" onClick={() => void share()}>{copied ? 'הקישור הועתק' : 'שיתוף'}</button>
      {!phone && <button type="button" className="chip" onClick={() => print()}>הדפסה</button>}
      <span className="rc-nav">
        <button type="button" className="chip" disabled={!older} onClick={() => older && nav(cardPath(company, older), { replace: true })} aria-label="הדוח הקודם">‹ {older ? <span className="num">{repName(older)}</span> : null}</button>
        <select aria-label="דוח" value={period} onChange={(e) => nav(cardPath(company, e.target.value), { replace: true })}>{listed!.map((p) => <option key={p} value={p}>{repName(p)}</option>)}</select>
        <button type="button" className="chip" disabled={!newer} onClick={() => newer && nav(cardPath(company, newer), { replace: true })} aria-label="הדוח הבא">{newer ? <span className="num">{repName(newer)}</span> : null} ›</button>
      </span>
    </>
  );
  return (
    <div className="page rc-page">
      <ReportCardView card={c} actions={actions} tiles={phone ? <ReportCardTiles card={c} /> : undefined} />
    </div>
  );
}
