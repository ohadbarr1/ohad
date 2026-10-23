import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from './Sheet';
import { fmt, pubLabel } from '../lib/format';
import { mayaReport } from '../lib/sources';
import { usePhone } from '../lib/useMedia';
import '../styles/autopilot.css';

/** What the report-day skeleton knows about one period (kpi.json companies.<id>.t0[period], status.json unverified[]). */
export interface T0Info {
  period?: string;
  rid?: number | null;
  pub?: string | null;
  /** q: the tag is the quarter · ytd: a year-to-date tag differenced back by the filer's habit · withheld: flows left out · kpi: from the warehouse */
  how?: string;
  conflict?: { printed: number; tagged: number | null; pg?: number | null; by?: string } | null;
}

const pl = (p?: string) => (!p ? '' : p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const HOW: Record<string, string> = {
  ytd: 'החברה מתייגת ברבעון זה נתונים מתחילת השנה: הרבעון חושב כהפרש מהרבעונים הקודמים, לפי דפוס הדיווח שלה.',
  withheld: 'שורות הזרם הושמטו: לא ניתן לדעת מהתיוג אם הוא רבעוני או מתחילת השנה. היתרות (הון, נכסים) מוצגות.',
};

/** The "לא מאומת" chip: a figure from the XBRL tags of a report filed today (T+0), before the printed figure of the same report has
 *  been extracted and found equal. A tap explains it (a sheet on a phone, a popover on a desktop) and links the filing. */
export function Unverified({ info, compact = false }: { info?: T0Info; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open || phone) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', off); addEventListener('keydown', key);
    return () => { removeEventListener('mousedown', off); removeEventListener('keydown', key); };
  }, [open, phone]);
  const label = info?.conflict ? 'לא תואם לדוח' : 'לא מאומת';
  const body = <UnverifiedBody info={info} />;
  return (
    <span className="unv-wrap" ref={box}>
      <button type="button" className={`chip est unv${compact ? ' compact' : ''}${info?.conflict ? ' conflict' : ''}`} aria-haspopup="dialog" aria-expanded={open}
        title={`${label}${info?.period ? ` · ${pl(info.period)}` : ''}: נתון XBRL מיום הפרסום`} onClick={() => setOpen((o) => !o)}>
        <span className="unv-dot" aria-hidden="true" />{compact ? <span className="sr-only">{label}</span> : label}
      </button>
      {open && (phone
        ? <Sheet open onClose={() => setOpen(false)} title={`${label}${info?.period ? ` · ${pl(info.period)}` : ''}`}>{body}</Sheet>
        : <span className="unv-pop" role="dialog" aria-label={label}>{body}</span>)}
    </span>
  );
}

export function UnverifiedBody({ info }: { info?: T0Info }) {
  return (
    <span className="unv-body">
      <b>נתון T+0 · טרם אומת מול הדוח</b>
      <span>מקור: תיוג XBRL (טופס ת930) שהחברה צירפה לדוח{info?.period ? <> <span className="num">{pl(info.period)}</span></> : ''}{info?.pub ? <>, פורסם <span className="num">{pubLabel(info.pub)}</span></> : ''}.</span>
      <span>נקלט ביום הפרסום, לפני שהנתונים המודפסים בדוח חולצו ונבדקו. מאומת אוטומטית כשהרווח המודפס באותו דוח שווה לנתון המתויג, בתוך עיגול.</span>
      {info?.how && HOW[info.how] && <span>{HOW[info.how]}</span>}
      {info?.conflict && <span className="neg">המודפס <span className="num">{fmt(info.conflict.printed / 1000, 'm')}</span> מול המתויג <span className="num">{fmt(info.conflict.tagged == null ? null : info.conflict.tagged / 1000, 'm')}</span> מ׳ ש״ח{info.conflict.pg ? <> (עמ׳ <span className="num">{info.conflict.pg}</span>)</> : ''}: נבדק ידנית לפני פרסום.</span>}
      <span className="unv-links">
        {info?.rid ? <a href={mayaReport(info.rid)} target="_blank" rel="noreferrer">הדוח ב-MAYA</a> : null}
        <Link to="/data/autopilot">טייס אוטומטי</Link>
      </span>
    </span>
  );
}
