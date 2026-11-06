import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../Icon';
import { upsert, useClients, type Folder } from '../../lib/clients';
import { REVIEW_KEY } from '../../lib/agentDesk';
import { F, fmtDur } from '../../lib/wizard';
import type { NyudIn } from '../../lib/nyud';
import { today } from '../../lib/visits';
import { track } from '../../lib/track';
import '../../styles/agentDesk.css';

/* fox 3.0 phase 2 · the bar over the client document (/funds/compare/print) when it is opened by the agent desk, through the router's
   state (never the URL):
   - mode "wizard" (A2, step 3 of /clients/new): "שלב 3 מתוך 3", the time from the file, the way back to the wizard, and, when asked
     (`print`), the print dialog once the figures are in (the הנמקה PDF: track('hanmaka_pdf'))
   - mode "review" (A5, the annual-review batch on /clients): which client of the queue this is, and "נשלח: לבא בתור" which marks the
     folder reviewed today and opens the next client's document
   Outside these modes it renders nothing. */
export interface DocNav { folder?: string; mode?: 'wizard' | 'review'; print?: boolean; t0?: number | null; queue?: string[] }
export const docMode = (s: unknown): DocNav['mode'] | null => {
  const m = s && typeof s === 'object' ? (s as DocNav).mode : null;
  return m === 'wizard' || m === 'review' ? m : null;
};
/** the client's age and sex as the wizard saved them, for the document's ניוד table (so it shows what the wizard showed) */
export function nyudInOf(f: Folder | null | undefined): Pick<NyudIn, 'age' | 'sex'> {
  if (!f) return {};
  const a = Number(f.fields[F.age]), s = f.fields[F.sex];
  return { ...(Number.isFinite(a) && a >= 16 && a <= 80 ? { age: a } : {}), ...(s === 'm' || s === 'f' ? { sex: s } : {}) };
}

export function DocBar({ folder, nav: st, ready, annex }: { folder: Folder | null; nav: unknown; ready: boolean; annex: boolean }) {
  const s = (st && typeof st === 'object' ? st : {}) as DocNav;
  const mode = docMode(s);
  const [clients, setClients] = useClients();
  const go = useNavigate();
  const printed = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'wizard' || !s.print || !ready || !folder || printed.current) return;
    printed.current = true;
    // the figures are in: one frame for the page to lay out, then the print dialog (the PDF)
    const t = setTimeout(() => { if (annex) track('hanmaka_pdf'); window.print(); }, 350);
    return () => clearTimeout(t);
  }, [mode, s.print, ready, folder, annex]);
  if (!mode || !folder) return null;
  if (mode === 'wizard') {
    const ms = s.t0 ? Date.now() - s.t0 : null;
    return (
      <div className="docbar" role="region" aria-label="אשף לקוח חדש">
        <span className="docbar-step"><span className="n">3</span> שלב 3 מתוך 3 · מסמך ההנמקה של <b>{folder.label}</b>{ms != null ? ` · מהקובץ: ${fmtDur(ms)}` : ''}</span>
        <span className="docbar-acts">
          <button type="button" className="cmp-doc" onClick={() => { if (annex) track('hanmaka_pdf'); window.print(); }}><Icon name="download" />הדפסה / PDF</button>
          <Link className="chip" to="/clients/new" state={{ folder: folder.id, step: 2, t0: s.t0 ?? null }}>חזרה לאשף</Link>
          <Link className="chip" to="/clients">לתיקי הלקוחות</Link>
        </span>
      </div>
    );
  }
  const q = (s.queue ?? []).filter((id) => clients.folders.some((f) => f.id === id));
  const i = q.indexOf(folder.id), nextId = i >= 0 ? q[i + 1] : undefined, next = nextId ? clients.folders.find((f) => f.id === nextId) : undefined;
  const done = folder.fields[REVIEW_KEY] === today();
  const mark = () => {
    const r = upsert(clients, { id: folder.id, label: folder.label, keys: folder.keys, fields: { ...folder.fields, [REVIEW_KEY]: today() } }, today());
    setClients(r.file);
    if (next) go(`/funds/compare/print?k=${next.keys.join(',')}&b=${next.b}`, { state: { folder: next.id, mode: 'review', queue: q } });
    else setMsg('כל הסקירות בתור סומנו');
  };
  return (
    <div className="docbar" role="region" aria-label="סקירה שנתית">
      <span className="docbar-step"><Icon name="calendar" /> סקירה שנתית{q.length > 1 && i >= 0 ? ` ${i + 1} מתוך ${q.length}` : ''} · <b>{folder.label}</b>{done ? ' · סומנה היום' : ''}</span>
      <span className="docbar-acts">
        <button type="button" className="cmp-doc" onClick={() => window.print()}><Icon name="download" />הדפסה / PDF</button>
        <button type="button" className="btn" onClick={mark}>{next ? `נשלח · לבא בתור: ${next.label}` : 'סימון: נשלח'}</button>
        <Link className="chip" to="/clients">לתיקי הלקוחות</Link>
      </span>
      {msg && <span role="status" className="csave-msg">{msg}</span>}
    </div>
  );
}
