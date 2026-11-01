import { useEffect, useMemo, useRef, useState } from 'react';
import { useStored } from '../lib/local';
import type { Doc, DocKind } from '../lib/doc';
import '../styles/deliver.css';

/* S4 · "הפק מסמך": a kind (one-pager, memo, board paper, talking points, exhibit pack, email summary) × a format (PowerPoint, Word,
   PDF, text), an optional editable preview (title, subtitle, the author, every ⟦placeholder⟧ the producer left for the author), then
   the file. The producers and renderers (lib/deliver) load only when used. The author's name is kept in this browser only. */

const KINDS: [DocKind, string][] = [['onepager', 'עמוד אחד'], ['memo', 'מזכר'], ['board', 'נייר לדירקטוריון'], ['talking', 'נקודות לשיחה'], ['exhibits', 'חבילת מוצגים'], ['email', 'סיכום למייל']];
type Format = 'pptx' | 'docx' | 'pdf' | 'txt';
const FORMATS: [Format, string][] = [['docx', 'Word'], ['pptx', 'PowerPoint'], ['pdf', 'PDF'], ['txt', 'טקסט']];
const AUTHOR_KEY = 'deliver:author';
interface Last { kind: DocKind; format: Format; preview: boolean }

/** the menu. `make` builds the doc of a kind (null: nothing to deliver) */
export function DeliverMenu({ make, label = 'הפק מסמך', note }: { make: (kind: DocKind) => Promise<Doc | null>; label?: string; note?: string }) {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useStored<Last>('deliver:last', { kind: 'onepager', format: 'docx', preview: false });
  const [author, setAuthor] = useStored<string>(AUTHOR_KEY, '');
  const [name, setName] = useState(author);
  useEffect(() => setName(author), [author]);
  const [busy, setBusy] = useState<string | null>(null);
  const [prev, setPrev] = useState<Doc | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('dialog')) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const flash = (s: string) => { setBusy(s); setTimeout(() => setBusy(null), 4000); };
  const go = async () => {
    const who = name.trim();
    if (!who) { flash('נא למלא את שם המחבר'); return; }
    if (who !== author) setAuthor(who);
    setBusy('מכין…');
    try {
      const d = await make(last.kind);
      if (!d) { flash('אין תשובה להפיק ממנה מסמך'); return; }
      const doc = { ...d, author: who };
      if (last.preview) { setPrev(doc); setBusy(null); return; }
      await write(doc);
    } catch (e) { flash(e instanceof Error ? e.message : 'שגיאה בהפקה'); }
  };
  const write = async (doc: Doc) => {
    setBusy('מפיק…');
    try {
      const { exportDoc } = await import('../lib/deliver');
      await exportDoc(doc, last.format);
      flash(last.format === 'pdf' ? 'חלון ההדפסה נפתח: לשמור כ-PDF' : 'הקובץ ירד ✓');
    } catch (e) { flash(e instanceof Error ? e.message : 'שגיאה בהפקה'); }
  };
  return (
    <div className="dv" ref={box}>
      <button type="button" className="an-btn dv-open" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>{label} ▾</button>
      {busy && !open && <span className="dim dv-st" role="status">{busy}</span>}
      {open && (
        <div className="dv-pop" role="group" aria-label={label}>
          <fieldset><legend>סוג המסמך</legend>
            <div className="dv-opts">{KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={last.kind === k} onClick={() => setLast({ ...last, kind: k })}>{l}</button>)}</div></fieldset>
          <fieldset><legend>פורמט</legend>
            <div className="dv-opts">{FORMATS.map(([k, l]) => <button key={k} type="button" aria-pressed={last.format === k} onClick={() => setLast({ ...last, format: k })}>{l}</button>)}</div></fieldset>
          <label className="field dv-name"><span>שם המחבר</span><input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="יופיע על המסמך" /></label>
          <label className="dv-chk"><input type="checkbox" checked={last.preview} onChange={(e) => setLast({ ...last, preview: e.target.checked })} /> תצוגה מקדימה ועריכה לפני ההפקה</label>
          <p className="dv-priv">{note ?? 'כל מספר יוצא עם הערת מקור; יעד, צפי ואומדן מסומנים; בלי שם האתר. השם נשמר בדפדפן הזה בלבד.'}</p>
          <div className="an-tools"><button type="button" className="an-btn dv-go" disabled={!!busy && busy.endsWith('…')} onClick={() => void go()}>{busy ?? 'הפקה'}</button></div>
        </div>
      )}
      {prev && <Preview doc={prev} format={last.format} onClose={() => setPrev(null)} onWrite={(d) => { setPrev(null); void write(d); }} />}
    </div>
  );
}

/** the editable preview: the title, the subtitle, every placeholder; the page as it will print */
function Preview({ doc, format, onClose, onWrite }: { doc: Doc; format: Format; onClose: () => void; onWrite: (d: Doc) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(doc.title), [sub, setSub] = useState(doc.subtitle ?? '');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [lib, setLib] = useState<typeof import('../lib/deliver') | null>(null);
  const [pics, setPics] = useState<Record<number, string>>({});
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let live = true;
    void import('../lib/deliver').then(async (m) => {
      if (!live) return;
      setLib(m);
      try { const p = await m.exhibitPics(doc); if (live) setPics(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.url]))); } catch { /* the preview shows the data tables */ }
    });
    return () => { live = false; };
  }, [doc]);
  const phs = useMemo(() => (lib ? lib.placeholders(doc).filter((p) => p !== 'שם המחבר') : []), [lib, doc]);
  const edited = useMemo((): Doc | null => (lib ? lib.fillPlaceholders({ ...doc, title: title.trim() || doc.title, subtitle: sub.trim() || undefined }, { ...vals, 'שם המחבר': doc.author }) : null), [lib, doc, title, sub, vals]);
  const html = useMemo(() => (lib && edited ? lib.docHtml(edited, { images: pics, kindLabel: lib.KIND_HE[edited.kind] }) : ''), [lib, edited, pics]);
  return (
    <dialog ref={ref} className="dv-dlg" aria-label="תצוגה מקדימה" onClose={onClose} onCancel={onClose}>
      <div className="dv-dh"><h2>תצוגה מקדימה ועריכה</h2><button type="button" className="an-btn quiet" onClick={() => ref.current?.close()}>סגירה</button></div>
      <div className="dv-body">
        <div className="dv-form">
          <label className="field"><span>כותרת</span><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field"><span>כותרת משנה</span><input type="text" value={sub} onChange={(e) => setSub(e.target.value)} /></label>
          {phs.length > 0 && <p className="dv-priv">שדות להשלמה: המסמך לא ממליץ בעצמו. שדה שנשאר ריק יוצא מסומן בצהוב.</p>}
          {phs.map((p) => (
            <label key={p} className="field"><span>{p.replace(/^להשלמה( על ידי המחבר)?:\s*/, '') || p}</span>
              <textarea rows={2} value={vals[p] ?? ''} onChange={(e) => setVals({ ...vals, [p]: e.target.value })} /></label>
          ))}
          <div className="an-tools"><button type="button" className="an-btn dv-go" disabled={!edited} onClick={() => edited && onWrite(edited)}>הפקה: {FORMATS.find((f) => f[0] === format)?.[1]}</button></div>
        </div>
        <iframe className="dv-frame" title="המסמך" sandbox="" srcDoc={html} />
      </div>
    </dialog>
  );
}

/* ---------- several answers at once: the selection on /questions, kept for this tab's session ---------- */
const PICK = 'fox:deliver:pick', PICK_EV = 'deliver:pick';
const readPick = (): string[] => { try { return JSON.parse(sessionStorage.getItem(PICK) ?? '[]') as string[]; } catch { return []; } };
/** the questions picked for one deliverable (this tab only: sessionStorage) */
export function usePick(): [string[], (ids: string[]) => void] {
  const [v, setV] = useState<string[]>(readPick);
  useEffect(() => { const on = () => setV(readPick()); window.addEventListener(PICK_EV, on); return () => window.removeEventListener(PICK_EV, on); }, []);
  return [v, (ids) => { try { sessionStorage.setItem(PICK, JSON.stringify(ids)); } catch { /* storage may be blocked */ } setV(ids); window.dispatchEvent(new Event(PICK_EV)); }];
}
