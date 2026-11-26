import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import '../styles/rollout.css';

/* <LensTabs>: the view strip of a page about one thing (rollout spec §2.3; compare keeps its own ViewStrip). One sticky, opaque strip
   under the site's top bar, 44-px tabs, role=tablist. Up to five tabs share the width and never scroll; from six tabs the strip scrolls
   sideways inside itself (the page never does) and keeps the chosen tab in view.
   Sticky: the strip measures the site's header (header.top) and sticks under it; it writes --mg-top (its own bottom edge) on its parent,
   so a <MonthGrid> below sticks its head under the strip, as on compare. Arrow keys move between tabs (RTL: → is the previous tab). */

export interface LensTabsProps {
  tabs: [string, string][];      // [id, label]
  value: string;
  onChange: (id: string) => void;
  id?: string;                   // default "views"
  label?: string;                // the tablist's accessible name, default "תצוגה"
  sticky?: boolean;              // default true
}

export function LensTabs({ tabs, value, onChange, id = 'views', label = 'תצוגה', sticky = true }: LensTabsProps) {
  const wrap = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const scroll = tabs.length >= 6;
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || !sticky) return;
    const top = document.querySelector<HTMLElement>('header.top'), parent = el.parentElement;
    const set = () => {
      const th = Math.round(top?.getBoundingClientRect().height ?? 0), sh = Math.round(el.getBoundingClientRect().height);
      el.style.setProperty('--ro-top', `${th}px`);
      parent?.style.setProperty('--mg-top', `${th + sh}px`);
    };
    set();
    const ro = new ResizeObserver(set); if (top) ro.observe(top); ro.observe(el);
    return () => ro.disconnect();
  }, [sticky]);
  // the chosen tab stays in view when the strip scrolls
  useLayoutEffect(() => {
    if (!scroll) return;
    // sideways only, inside the strip (scrollIntoView would also move the page)
    const el = list.current, on = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !on) return;
    const a = el.getBoundingClientRect(), b = on.getBoundingClientRect();
    if (b.left < a.left) el.scrollLeft -= a.left - b.left + 8; else if (b.right > a.right) el.scrollLeft += b.right - a.right + 8;
  }, [value, scroll]);
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const i = tabs.findIndex(([t]) => t === value);
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const fwd = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (fwd ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    onChange(tabs[j][0]);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-tab="${tabs[j][0]}"]`)?.focus());
  };
  return (
    <div className={`ro-tabs${sticky ? ' sticky' : ''}`} ref={wrap}>
      <div className={`ro-tabs-in${scroll ? ' scroll' : ''}`} id={id} role="tablist" aria-label={label} ref={list} onKeyDown={key}>
        {tabs.map(([t, l]) => (
          <button key={t} type="button" role="tab" data-tab={t} aria-selected={t === value} tabIndex={t === value ? 0 : -1}
            className={t === value ? 'on' : undefined} onClick={() => t !== value && onChange(t)}>{l}</button>
        ))}
      </div>
    </div>
  );
}
