import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBox, Loading, copyText } from '../components/ui';
import { Icon } from '../components/Icon';
import { useFunds } from '../lib/useData';
import { useOptional } from '../lib/fundsLoad';
import { useMine } from '../lib/mine';
import { useSaverDoor } from '../lib/door';
import type { FundsFile } from '../lib/funds';
import type { DefaultFile } from '../lib/fundsTools';
import { COEF_PATH, type CoefFile } from '../lib/coef';
import { DECISION_PATH, type DecisionFile } from '../lib/decision';
import { MOMENTS, isMomentId, momentPath, type MomentId } from '../lib/moments';
import { TEXT, askText } from '../lib/momentsContent';
import { CHECKS, MomentChips, SrcA, type Ctx } from '../components/saver/Moments';
import '../styles/saver.css';
import '../styles/moments.css';

/* W9 saver · /my/moment/<id>, "רגעים": one page per moment in a saver's year, one layout. "מה קורה" in plain words; "מה החוק אומר", one
   rule a line, each with its source (lib/momentsContent); "מה לבדוק אצלך", on the reader's own products from /my (this browser only;
   components/saver/Moments); "מה לשאול את הסוכן", a list to copy. /my/moment lists them. Descriptive, never advice. */

const ORDER: MomentId[] = ['job', 'hishtalmut', 'raise', 'sixty', 'switch', 'default'];

export function MomentPage() {
  useSaverDoor();
  const { id } = useParams();
  const ok = isMomentId(id);
  useEffect(() => { if (ok) document.title = `${MOMENTS[id].title} · fox`; }, [ok, id]);
  if (!ok) return <MomentsIndex missing={id ?? ''} />;
  return <Moment id={id} />;
}

function Moment({ id }: { id: MomentId }) {
  const M = MOMENTS[id], T = TEXT[id];
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);
  const coefF = useOptional<CoefFile>(COEF_PATH);
  const [mine] = useMine();
  const list = (Array.isArray(mine) ? mine : []).filter((m) => m && typeof m.k === 'string');
  const [copied, setCopied] = useState<'idle' | 'ok' | 'no'>('idle');
  const Check = CHECKS[id];
  const ctx: Ctx | null = data && dfile !== undefined ? { data, dfile, dec, coefF, list } : null;
  return (
    <div className="sv-page mo-page">
      <div className="pagehead"><div>
        <span className="eyebrow"><Link to="/my">החיסכון שלי</Link> · <Link to="/my/moment">רגעים</Link></span>
        <h1><span className="icotile"><Icon name="mine" /></span>{M.title}</h1>
        <div className="sub sv-sub">{T.lead}</div>
      </div></div>
      <MomentChips current={id} />

      <section className="panel sv-card mo-sec" aria-labelledby="mo-what">
        <h2 id="mo-what">מה קורה</h2>
        <ul className="sv-facts">{T.happens.map((h, i) => <li key={i}>{h}</li>)}</ul>
      </section>

      <section className="panel sv-card mo-sec" aria-labelledby="mo-law">
        <h2 id="mo-law">מה החוק אומר</h2>
        <ul className="sv-facts mo-law">{T.law.map((l, i) => <li key={i}>{l.text} <span className="mo-src">({l.src.map((s, j) => <span key={j}>{j ? ' · ' : ''}<SrcA s={s} /></span>)})</span></li>)}</ul>
        <p className="sv-note">כלל עיקרי בלבד, לא ייעוץ מס או פנסיוני: לכל כלל יש חריגים, והסכומים מתעדכנים כל שנה. המקורות נבדקו ב-02.11.26.</p>
      </section>

      <section className="panel sv-card mo-sec" aria-labelledby="mo-mine">
        <h2 id="mo-mine">מה לבדוק אצלך</h2>
        {error ? <ErrorBox what="נתוני הקופות" error={error} /> : !ctx ? <Loading what="המוצרים שלך" /> : <Check {...ctx} />}
        <p className="sv-privacy"><Icon name="shield" /> הכול מחושב בדפדפן הזה; שום נתון לא נשלח.</p>
      </section>

      <section className="panel sv-card mo-sec" aria-labelledby="mo-ask">
        <h2 id="mo-ask">מה לשאול את הסוכן</h2>
        <ol className="mo-ask">{T.ask.map((q, i) => <li key={i}>{q}</li>)}</ol>
        <div className="sv-acts"><button type="button" className="btn primary" onClick={() => copyText(askText(M.title, T.ask), (ok) => setCopied(ok ? 'ok' : 'no'))}>{copied === 'ok' ? 'השאלות הועתקו ✓' : 'העתקת השאלות'}</button></div>
        {copied === 'no' && <p className="sv-muted" role="status">הדפדפן חסם העתקה: אפשר לסמן את השאלות ולהעתיק.</p>}
      </section>

      <p className="sv-legal">מידע תיאורי, עם מקור לכל כלל ומספר. לא ייעוץ השקעות, לא ייעוץ או שיווק פנסיוני, ואין המלצה למשוך, לעבור או להישאר. האומדנים על הנחות שמוצגות לצדם. <Link to="/about">על האתר והמקורות</Link></p>
    </div>
  );
}

/** /my/moment: the moments as a list */
export function MomentsIndex({ missing }: { missing?: string }) {
  useSaverDoor();
  useEffect(() => { document.title = 'רגעים · fox'; }, []);
  return (
    <div className="sv-page mo-page">
      <div className="pagehead"><div>
        <span className="eyebrow"><Link to="/my">החיסכון שלי</Link></span>
        <h1><span className="icotile"><Icon name="mine" /></span>רגעים</h1>
        <div className="sub sv-sub">מה קורה לחיסכון ברגעים של השנה, מה החוק אומר, ומה לבדוק ולשאול. תיאור, לא המלצה.</div>
      </div></div>
      {missing ? <p className="sv-note" role="status">אין רגע בשם "{missing}". הנה כל הרגעים:</p> : null}
      <ul className="mo-list">
        <li><Link to="/my/checkup" className="panel sv-stmt mo-item"><span className="sv-stmt-t"><b>הדוח השנתי הגיע</b><span>הבדיקה השנתית: דמי הניהול מול מחיר ברירת המחדל, ההפקדות מול החוק ומסלול הגיל, עם מכתב מוכן.</span></span><span className="sv-stmt-go" aria-hidden="true">←</span></Link></li>
        <li><Link to="/my/statement" className="panel sv-stmt mo-item"><span className="sv-stmt-t"><b>איך קוראים את הדוח השנתי</b><span>שדה אחר שדה, עם סעיפי החוזר.</span></span><span className="sv-stmt-go" aria-hidden="true">←</span></Link></li>
        {ORDER.map((id) => <li key={id}><Link to={momentPath(id)} className="panel sv-stmt mo-item"><span className="sv-stmt-t"><b>{MOMENTS[id].title}</b><span>{MOMENTS[id].meta}</span></span><span className="sv-stmt-go" aria-hidden="true">←</span></Link></li>)}
      </ul>
    </div>
  );
}
