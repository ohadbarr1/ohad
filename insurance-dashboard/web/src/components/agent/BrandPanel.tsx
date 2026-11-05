import { useId, useState } from 'react';
import { Icon } from '../Icon';
import { EMPTY_BRAND, LOGO_MAX_BYTES, brandLine, hasBrand, logoBytes, resizeLogo, useBranding } from '../../lib/branding';

/* W7 · /clients, the agent's branding: name, licence, phone, e-mail, company, logo. Kept in this browser only; printed in the header and
   the signature block of the client document (the circular allows a logo and nothing else to change: §3(ג)). */
export function BrandPanel() {
  const [b, setB] = useBranding();
  const [open, setOpen] = useState(!hasBrand(b));
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const field = (k: keyof typeof b, label: string, extra: Record<string, unknown> = {}) => (
    <label htmlFor={`${id}-${k}`}>{label}<input id={`${id}-${k}`} value={(b[k] as string) ?? ''} onChange={(e) => setB({ ...b, [k]: e.target.value })} maxLength={120} autoComplete="off" {...extra} /></label>
  );
  const onLogo = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    try { setB({ ...b, logo: await resizeLogo(f) }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="abrand">
      <div className="abrand-row">
        {b.logo && <img className="abrand-logo" src={b.logo} alt="לוגו" />}
        <span className="abrand-line">{hasBrand(b) ? brandLine(b) : 'עוד לא הוגדרו פרטי בעל הרישיון: הם מודפסים בכותרת המסמך ללקוח ובחתימה'}</span>
        <button type="button" className="chip" onClick={() => setOpen(!open)}>{open ? 'סגירה' : 'עריכה'}</button>
      </div>
      {open && <form className="abrand-form" onSubmit={(e) => e.preventDefault()}>
        {field('name', 'שם מלא', { maxLength: 80 })}
        {field('lic', 'מספר רישיון', { inputMode: 'numeric', maxLength: 20 })}
        {field('phone', 'טלפון', { inputMode: 'tel', maxLength: 30 })}
        {field('email', 'דוא"ל', { inputMode: 'email' })}
        {field('co', 'פועל באמצעות חברה (שם)')}
        {field('coId', 'ח.פ. החברה', { inputMode: 'numeric', maxLength: 20 })}
        {field('addr', 'כתובת', { maxLength: 160 })}
        <label className="chip cl-imp abrand-up"><Icon name="download" /> {b.logo ? 'החלפת לוגו' : 'לוגו (תמונה)'}<input type="file" accept="image/*" onChange={(e) => { void onLogo(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {b.logo && <button type="button" className="chip" onClick={() => setB({ ...b, logo: null })}>הסרת הלוגו ({Math.round(logoBytes(b.logo) / 1000)} KB)</button>}
        <button type="button" className="chip" onClick={() => { if (confirm('למחוק את פרטי בעל הרישיון מהדפדפן הזה?')) setB(EMPTY_BRAND); }}>מחיקת הפרטים</button>
        {err && <p role="alert" className="ci-err">{err}</p>}
        <p className="csave-priv">נשמר בדפדפן הזה בלבד ולא נשלח לשום מקום; מצורף לקובץ הגיבוי של התיקים, כך שמכשיר אחר מקבל אותו בשחזור. הלוגו מוקטן במכשיר ל-{Math.round(LOGO_MAX_BYTES / 1000)} KB לכל היותר. החוזר מתיר להוסיף למסמך ההנמקה סימנים מסחריים (לוגו) ואוסר כל שינוי אחר בנוסח ובסדר (חוזר סוכנים ויועצים "מסמך הנמקה – תיקון", 18.07.2018, §3(ג)).</p>
      </form>}
    </div>
  );
}
