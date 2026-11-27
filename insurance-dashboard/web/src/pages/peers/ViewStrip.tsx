import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMedia } from '../../lib/useMedia';
import '../../styles/rollout.css';
import '../../styles/peerboard.css';

/* <ViewStrip>: the one "תצוגה" strip of the peers page (spec p6 §14.1 G3, T-P9): לוח · חברה · גרפים · טבלה ‖ טבלה חופשית · סדרה.
   Pure address (no board data), so the free table and the series (pages/Peers.tsx) render the same strip with their own tab selected.
   - Board lenses: `v` dropped, `lens=focus|charts|table` (the board itself has no `lens`).
   - The peer table's views: `v=table|series`; the board's own keys are dropped (tester P5: `lens=charts` never survives a switch).
   - Phones: the four board lenses only (the free table and the series sit in the hub menu); at v=table|series the strip is not drawn.
   Sticky under the site's header like <LensTabs> (whose markup and classes it reuses, plus a separator and a label). */

export type ViewId = 'board' | 'company' | 'charts' | 'table' | 'free' | 'series';
const LENS: Record<'board' | 'company' | 'charts' | 'table', string | null> = { board: null, company: 'focus', charts: 'charts', table: 'table' };
/** keys the board writes; none of them means anything on the free table or the series */
export const BOARD_ONLY = ['lens', 'bm', 'rd', 'base', 'sec', 'sheet', 'gq', 'bx', 'by', 'bh', 'bs', 'bf', 'bw', 'src'];
const TABS: [ViewId, string][] = [['board', 'לוח'], ['company', 'חברה'], ['charts', 'גרפים'], ['table', 'טבלה'], ['free', 'טבלה חופשית'], ['series', 'סדרה']];

/** the address of a view, from the current one */
export function viewHref(cur: URLSearchParams, to: ViewId): URLSearchParams {
  const n = new URLSearchParams(cur);
  if (to === 'free' || to === 'series') { BOARD_ONLY.forEach((k) => n.delete(k)); n.set('v', to === 'free' ? 'table' : 'series'); return n; }
  n.delete('v'); n.delete('sheet'); n.delete('src');
  const l = LENS[to];
  if (l) n.set('lens', l); else n.delete('lens');
  return n;
}
/** the view an address is on */
export function viewOf(sp: URLSearchParams): ViewId {
  const v = sp.get('v');
  if (v === 'table') return 'free';
  if (v === 'series') return 'series';
  const l = sp.get('lens');
  return l === 'focus' ? 'company' : l === 'charts' ? 'charts' : l === 'table' ? 'table' : 'board';
}

export function ViewStrip({ active }: { active?: ViewId }) {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const desk = useMedia('(min-width: 1000px)');
  const cur = active ?? viewOf(sp);
  const wrap = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const tabs = desk ? TABS : TABS.slice(0, 4);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const top = document.querySelector<HTMLElement>('header.top'), parent = el.parentElement;
    const set = () => {
      const th = Math.round(top?.getBoundingClientRect().height ?? 0), sh = Math.round(el.getBoundingClientRect().height);
      el.style.setProperty('--ro-top', `${th}px`);
      parent?.style.setProperty('--mg-top', `${th + sh}px`);
    };
    set();
    const ro = new ResizeObserver(set); if (top) ro.observe(top); ro.observe(el);
    return () => ro.disconnect();
  }, [desk]);
  if (!desk && (cur === 'free' || cur === 'series')) return null;
  const go = (t: ViewId) => {
    if (t === cur) return;
    const n = viewHref(new URLSearchParams(window.location.search), t), s = n.toString();
    nav({ search: s ? `?${s}` : '' }, { replace: false });
    window.scrollTo({ top: 0 });
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = tabs.findIndex(([t]) => t === cur), rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const j = (i + ((e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault(); go(tabs[j][0]);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-tab="${tabs[j][0]}"]`)?.focus());
  };
  return (
    <div className="ro-tabs sticky p6-views" ref={wrap}>
      {desk ? <span className="p6-views-l" aria-hidden="true">תצוגה</span> : null}
      <div className="ro-tabs-in" id="views" role="tablist" aria-label="תצוגה" ref={list} onKeyDown={key}>
        {tabs.map(([t, l], i) => (
          <span key={t} className="p6-vt">
            {desk && i === 4 ? <i className="p6-vsep" aria-hidden="true" /> : null}
            <button type="button" role="tab" data-tab={t} id={t === 'free' ? 'tab-table' : t === 'series' ? 'tab-series' : undefined} aria-selected={t === cur} tabIndex={t === cur ? 0 : -1}
              className={t === cur ? 'on' : undefined} onClick={() => go(t)}>{l}</button>
          </span>
        ))}
      </div>
    </div>
  );
}
