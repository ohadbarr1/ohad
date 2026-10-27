import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, Seg } from '../components/ui';
import { useBook, type ChartSpec } from '../lib/book';
import { bookOption } from '../lib/bookChart';
import { citeDocs, pagesText } from '../lib/exportProv';
import { pubLabel } from '../lib/format';
import { pdfPage } from '../lib/sources';
import { useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import type { DeckTheme } from '../lib/pptx';
import '../styles/book.css';

/** The chart book: the charts a reader collected across the site, drawn live from their specs, ordered, titled and annotated,
 *  exported as a native PowerPoint deck (every chart editable, every slide footnoted with its filing pages) or as a workbook. */
export function ChartBook() {
  const { book, items, remove, update, move, setTitle, clear } = useBook();
  const qa = useLoad<{ built?: string }>('qa.json');
  const built = qa.data?.built?.slice(0, 10);
  const [theme, setTheme] = useState<DeckTheme>(() => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'phoenix'));
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const phone = usePhone();
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); }, [sure]);

  const deck = async (only?: ChartSpec) => {
    setBusy(only ? only.id : 'pptx');
    try {
      const { exportDeck } = await import('../lib/pptx');
      await exportDeck(only ? [only] : items, { title: only ? only.title : book.title, theme, host: location.host, built: new Date().toISOString(), dataDate: built });
    } finally { setBusy(null); }
  };
  const xlsx = async () => {
    setBusy('xlsx');
    try { const { exportBookXlsx } = await import('../lib/exportBook'); await exportBookXlsx(items, book.title, location.host); } finally { setBusy(null); }
  };
  const docs = useMemo(() => new Set(items.flatMap((s) => citeDocs(s.sources).docs.map((d) => d.url ?? d.doc))).size, [items]);

  return (
    <div className="book">
      <div className="pagehead">
        <div className="book-head">
          <input className="book-title" value={book.title} onChange={(e) => setTitle(e.target.value)} aria-label="שם הספר" maxLength={80} />
          <div className="sub">
            <span className="num">{items.length}</span> גרפים{docs > 0 && <> · <span className="num">{docs}</span> מסמכי מקור</>}{built && <> · נתונים <span className="num">{pubLabel(built)}</span></>}
          </div>
        </div>
        {items.length > 0 && (
          <div className="book-actions">
            <Seg label="ערכת עיצוב למצגת" value={theme} onChange={setTheme} options={[['phoenix', 'בהיר'], ['dark', 'כהה']]} />
            <button type="button" className="btn primary" onClick={() => void deck()} disabled={!!busy}>{busy === 'pptx' ? 'מכין…' : 'PowerPoint'}</button>
            <button type="button" className="btn" onClick={() => void xlsx()} disabled={!!busy}>{busy === 'xlsx' ? 'מכין…' : 'Excel'}</button>
            <button type="button" className="btn ghost" onClick={() => (sure ? (clear(), setSure(false)) : setSure(true))}>{sure ? 'לרוקן? לחיצה נוספת' : 'ריקון'}</button>
          </div>
        )}
      </div>

      {!items.length ? (
        <Empty title="הספר ריק">
          <span>בכל גרף באתר: <b>+ לספר</b>. הגרפים נשמרים בדפדפן הזה ומיוצאים כמצגת עם מקורות.</span>
          <span className="book-starts"><Link to="/industry/peers">טבלת עמיתים</Link><Link to="/industry/csm?view=econ">כלכלת CSM</Link><Link to="/savings">עדשת חיסכון</Link><Link to="/company/harel/financials">דוחות הראל</Link></span>
        </Empty>
      ) : (
        <ol className="book-grid">
          {items.map((s, i) => {
            const stale = built && s.dataDate && s.dataDate < built;
            const { docs: ds, formulas, texts } = citeDocs(s.sources);
            return (
              <li key={s.id} className={`panel book-card${drag === s.id ? ' dragging' : ''}`}
                onDragOver={(e) => { if (drag) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (drag && drag !== s.id) move(drag, i); setDrag(null); }}>
                <div className="book-card-hd">
                  <span className="book-n num" draggable={!phone} onDragStart={(e) => { setDrag(s.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDrag(null)} title={phone ? undefined : 'גרירה לשינוי הסדר'}>{i + 1}</span>
                  <input className="book-card-title" value={s.title} onChange={(e) => update(s.id, { title: e.target.value })} aria-label={`כותרת גרף ${i + 1}`} placeholder={s.label} />
                  <div className="book-tools">
                    <button type="button" className="iconbtn" onClick={() => move(s.id, i - 1)} disabled={i === 0} aria-label="הזזה למעלה">↑</button>
                    <button type="button" className="iconbtn" onClick={() => move(s.id, i + 1)} disabled={i === items.length - 1} aria-label="הזזה למטה">↓</button>
                    <button type="button" className="iconbtn" onClick={() => remove(s.id)} aria-label="הסרה מהספר">×</button>
                  </div>
                </div>
                <div className="book-meta">
                  {s.title !== s.label && <span>{s.label}</span>}
                  {s.unit && <span>{s.unit}</span>}
                  {s.span && <span className="num">{s.span}</span>}
                  <Link to={s.route} className="book-open">בעמוד המקור</Link>
                </div>
                <Chart label={s.title || s.label} height={phone ? 260 : 300} deps={[s.updated, s.title]} build={() => bookOption(s)} exportName="" bookable={false} />
                <textarea className="book-note" value={s.note ?? ''} onChange={(e) => update(s.id, { note: e.target.value })} placeholder="מסקנה לשקף (אופציונלי)" rows={1} aria-label={`הערה לגרף ${i + 1}`} />
                <div className="book-src">
                  <span className="k">מקור</span>
                  {ds.slice(0, 4).map((d, k) => (
                    <span key={k}>{d.url ? <a href={d.kind === 'report' ? pdfPage(d.url, d.pages[0]) : d.url} target="_blank" rel="noreferrer">{d.doc}</a> : d.doc}{d.pages.length > 0 && <>, {pagesText(d.pages)}</>}</span>
                  ))}
                  {ds.length > 4 && <span>ועוד <span className="num">{ds.length - 4}</span></span>}
                  {texts.map((t) => <span key={t}>{t}</span>)}
                  {formulas.length > 0 && <span className="calc">מחושב: {formulas[0]}{formulas.length > 1 && <> (+<span className="num">{formulas.length - 1}</span>)</>}</span>}
                  {!ds.length && !texts.length && !formulas.length && <span className="muted">לא נרשם מקור לנקודות</span>}
                </div>
                <div className="book-foot">
                  <span className="muted">נוסף <span className="num">{pubLabel(s.added)}</span>{s.dataDate && <> · נתונים <span className="num">{pubLabel(s.dataDate)}</span></>}</span>
                  {stale && <Link to={s.route} className="chip warn">יש נתונים חדשים · פתיחה מרעננת</Link>}
                  <button type="button" className="chip" onClick={() => void deck(s)} disabled={!!busy}>{busy === s.id ? 'מכין…' : 'שקף PPTX'}</button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
