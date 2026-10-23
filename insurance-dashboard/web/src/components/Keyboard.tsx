import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';

const SHORTCUTS: [string, string][] = [
  ['/', 'חיפוש: חברה, קופה, שורה בדוח, או חברה + קוד (הראל CSM)'], ['g h', 'דף הבית'], ['g c', 'חברות'], ['g i', 'השוואה ענפית'], ['g f', 'קופות ושוק'],
  ['g v', 'הערכת שווי'], ['g d', 'נתונים ואיכות'], ['t', 'החלפת ערכת עיצוב'], ['1–7', 'טבלת עמיתים: תבניות'], ['8 9 0', 'טבלת עמיתים: תצוגות שמורות'], ['← → ↑ ↓', 'מעבר בין מספרים בטבלה (אחרי Tab אל הטבלה)'], ['Enter', 'פתיחת המקור של המספר'], ['?', 'רשימה זו'],
];

const typing = (t: EventTarget | null) => { const e = t as HTMLElement | null; return !!e && (e.tagName === 'INPUT' || e.tagName === 'SELECT' || e.tagName === 'TEXTAREA' || e.isContentEditable); };

/** The site's keyboard: shortcuts, one tab stop per table with arrow keys between its figures, and the list of recent pages for the search. */
export function useKeyboard(toggleTheme: () => void): { help: boolean; setHelp: (v: boolean) => void } {
  const nav = useNavigate();
  const loc = useLocation();
  const [help, setHelp] = useState(false);
  const pendingG = useRef(0);

  // recent pages, newest first, for the search's empty state
  useEffect(() => {
    if (loc.pathname === '/') return;
    const id = setTimeout(() => {
      try {
        const title = document.title.replace(/ · fox$/, '');
        if (title.startsWith('העמוד לא נמצא')) return;
        const cur = JSON.parse(localStorage.getItem('fox:recent') ?? '[]') as { p: string; t: string }[];
        const next = [{ p: loc.pathname, t: title }, ...cur.filter((x) => x.p !== loc.pathname)].slice(0, 8);
        localStorage.setItem('fox:recent', JSON.stringify(next));
      } catch { /* storage may be blocked */ }
    }, 400);
    return () => clearTimeout(id);
  }, [loc.pathname]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      // arrows move between the figures of a table
      if (e.key.startsWith('Arrow') && t.matches?.('td .src')) {
        const td = t.closest('td')!, tr = td.parentElement as HTMLTableRowElement, table = tr.closest('table')!;
        const rows = [...table.querySelectorAll('tbody tr')] as HTMLTableRowElement[];
        const ci = [...tr.children].indexOf(td), ri = rows.indexOf(tr);
        const at = (r: number, c: number) => rows[r]?.children[c]?.querySelector('.src') as HTMLElement | null;
        let next: HTMLElement | null = null;
        // the page is right-to-left: ArrowLeft moves to the next column
        if (e.key === 'ArrowLeft') for (let c = ci + 1; !next && c < tr.children.length; c++) next = at(ri, c);
        if (e.key === 'ArrowRight') for (let c = ci - 1; !next && c >= 0; c--) next = at(ri, c);
        if (e.key === 'ArrowDown') for (let r = ri + 1; !next && r < rows.length; r++) next = at(r, ci);
        if (e.key === 'ArrowUp') for (let r = ri - 1; !next && r >= 0; r--) next = at(r, ci);
        if (next) { e.preventDefault(); t.tabIndex = -1; next.tabIndex = 0; next.focus(); }
        return;
      }
      if (typing(t)) return;
      if (e.key === '?') { e.preventDefault(); setHelp((v) => !v); return; }
      if (e.key === 'Escape') { setHelp(false); return; }
      if (e.key === 't') { toggleTheme(); return; }
      if (e.key === 'g') { pendingG.current = Date.now(); return; }
      if (Date.now() - pendingG.current < 1200) {
        const to = { h: '/', c: '/companies', i: '/industry', f: '/funds', v: '/valuation', d: '/data' }[e.key];
        pendingG.current = 0;
        if (to) { e.preventDefault(); nav(to); }
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [nav, toggleTheme]);

  // one tab stop per table: the first figure is reachable with Tab, the rest with the arrows (thousands of tab stops otherwise)
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const apply = () => main.querySelectorAll('table').forEach((tb) => {
      const figs = tb.querySelectorAll<HTMLElement>('td .src');
      if (!figs.length || tb.dataset.roving === String(figs.length)) return;
      tb.dataset.roving = String(figs.length);
      const hasStop = [...figs].some((f) => f.tabIndex === 0 && f.dataset.stop);
      figs.forEach((f, i) => { if (!(hasStop && f.dataset.stop)) f.tabIndex = i === 0 && !hasStop ? 0 : -1; if (i === 0 && !hasStop) f.dataset.stop = '1'; });
    });
    apply();
    const mo = new MutationObserver(() => apply());
    mo.observe(main, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [loc.pathname]);

  return { help, setHelp };
}

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="sheetwrap center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet dialog" role="dialog" aria-modal="true" aria-label="קיצורי מקלדת">
        <div className="sheet-hd"><b>קיצורי מקלדת</b><button type="button" className="btn" onClick={onClose} autoFocus>סגירה</button></div>
        <div className="sheet-body"><table className="keys"><tbody>{SHORTCUTS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table></div>
      </div>
    </div>,
    document.body,
  );
}
