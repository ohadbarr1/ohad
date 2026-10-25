import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';

export function Panel({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || aside) && <div className="hd">{title && <h2>{title}</h2>}{aside && <div className="aside">{aside}</div>}</div>}
      {children}
    </section>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className="kpi">
      <div className="l">{label}</div>
      <div className={`v num ${tone ?? ''}`}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

/** A break in a regulator series inside the period a figure compares (most groups moved in the same month): the comparison spans it. */
export function BreakChip({ b }: { b: { label: string; note: string } | null | undefined }) {
  return b ? <span className="chip est" title={`${b.note} · ${b.label}`}>שבר בסדרה · <span className="num">{b.label}</span></span> : null;
}

/** An empty state: a glyph on a soft tile (inbox by default; pass `icon` for the section's own), the title, one line of words. */
export function Empty({ title, icon = 'inbox', children }: { title: string; icon?: IconName | string; children?: ReactNode }) {
  return <div className="empty"><span className="icotile lg"><Icon name={icon} /></span><b>{title}</b>{children && <p>{children}</p>}</div>;
}

/** Data on its way: the mark flaps until it lands (the one looping motion, and only while loading; reduced motion stills it). */
export function Loading({ what }: { what: string }) { return <div className="empty loading" role="status"><Logo size={40} animated /><p>טוען {what}…</p></div>; }
export function ErrorBox({ what, error }: { what: string; error: string }) {
  return <div className="empty err"><span className="icotile lg"><Icon name="x" /></span><b>לא ניתן לטעון {what}</b><p className="mono">{error}</p></div>;
}

export function copyText(text: string, done: (ok: boolean) => void) {
  try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch { done(false); }
}

/** Marks a CSM figure whose table total also contains the (non-CSM) future profit of pure savings policies. */
export function IncChip({ f }: { f: { inc?: number; cl?: number; v0?: number; m: string } | null | undefined }) {
  if (!f || !f.m.startsWith('csm')) return null;
  if (f.cl === 1) return <> <span className="chip est" title={`נגזר: הסכום שהודפס (${f.v0?.toLocaleString()}) פחות שורת פוליסות ההשקעה (חוזי השקעה, IFRS 9) באותה טבלה: רווח עתידי נוסף, שאינו CSM לפי התקן`}>ללא פוליסות השקעה</span></>;
  return f.inc === 1 ? <> <span className="chip est" title="הסכום בטבלת החברה כולל את שורת פוליסות ההשקעה (חוזי השקעה, IFRS 9): רווח עתידי נוסף, שאינו CSM לפי התקן">כולל פוליסות השקעה</span></> : null;
}

/* ---- one control grammar (design lane): tabs and toggles are a white tile in a paper track (.seg / .subnav), menus are a
   menu-button that shows its choice. The menu replaces the native <select> in toolbars: the same list, framed like the rest. ---- */
export interface MenuItem {
  key: string;
  label: ReactNode;
  /** a quiet second line or trailing note */
  hint?: ReactNode;
  /** items with the same group sit under one caption */
  group?: string;
  disabled?: boolean;
  /** an action item: runs and closes (no selected state) */
  run?: () => void;
  /** a link item */
  href?: string;
  to?: string;
}
/** A menu-button. `value` marks the selected item (listbox semantics); without it the items are actions. `cap` is a quiet caption before the choice. */
export function Menu({ label, cap, value, items, onPick, summary, className = '', align = 'start', icon, quiet }: {
  label: string; cap?: ReactNode; value?: string; items: MenuItem[]; onPick?: (key: string) => void; summary?: ReactNode; className?: string; align?: 'start' | 'end'; icon?: IconName | string; quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const cur = items.find((x) => x.key === value);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); (root.current?.querySelector('button') as HTMLButtonElement | null)?.focus(); } };
    addEventListener('pointerdown', down, true); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key); };
  }, [open]);
  useEffect(() => { if (open) { const i = items.findIndex((x) => x.key === value); setHi(i); const el = root.current?.querySelector<HTMLElement>(`[data-i="${i}"]`); el?.scrollIntoView({ block: 'nearest' }); } }, [open, items, value]);
  const pick = (it: MenuItem) => { if (it.disabled) return; setOpen(false); if (it.run) it.run(); else onPick?.(it.key); };
  const enabled = items.map((x, i) => (x.disabled ? -1 : i)).filter((i) => i >= 0);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!open) { setOpen(true); return; } const at = enabled.indexOf(hi), n = enabled.length; setHi(enabled[((at < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : at) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n]); }
    else if ((e.key === 'Enter' || e.key === ' ') && open) { e.preventDefault(); if (hi >= 0) pick(items[hi]); }
    else if (e.key === 'Home' && open) { e.preventDefault(); setHi(enabled[0]); } else if (e.key === 'End' && open) { e.preventDefault(); setHi(enabled[enabled.length - 1]); }
  };
  // groups keep the items' order; a caption is drawn when the group changes
  let lastGroup: string | undefined;
  const sel = value != null;
  return (
    <div ref={root} className={`menu${open ? ' open' : ''}${quiet ? ' quiet' : ''} ${className}`} onKeyDown={onKey}>
      <button type="button" className="menu-btn" aria-haspopup={sel ? 'listbox' : 'menu'} aria-expanded={open} aria-controls={id} aria-label={cap || summary ? undefined : label} title={label} onClick={() => setOpen((o) => !o)}>
        {icon && <Icon name={icon} />}
        {cap && <span className="cap">{cap}</span>}
        <span className="cur">{summary ?? cur?.label ?? label}</span>
        <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div id={id} className={`menu-pop ${align}`} role={sel ? 'listbox' : 'menu'} aria-label={label} aria-activedescendant={hi >= 0 ? `${id}-${hi}` : undefined}>
          {items.map((it, i) => {
            const capt = it.group && it.group !== lastGroup ? <div key={`g${i}`} className="menu-grp" role="presentation">{it.group}</div> : null;
            lastGroup = it.group;
            const on = sel && it.key === value;
            const inner = <><span className="ml">{it.label}</span>{it.hint && <span className="mh">{it.hint}</span>}</>;
            const props = { id: `${id}-${i}`, 'data-i': i, className: `menu-it${on ? ' on' : ''}${i === hi ? ' hi' : ''}`, role: sel ? 'option' : 'menuitem', 'aria-selected': sel ? on : undefined, 'aria-disabled': it.disabled || undefined, onPointerEnter: () => setHi(i) } as const;
            return <Fragment key={it.key}>{capt}{it.to ? <Link {...props} to={it.to} onClick={() => setOpen(false)}>{inner}</Link> : it.href ? <a {...props} href={it.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>{inner}</a> : <button type="button" {...props} disabled={it.disabled} onClick={() => pick(it)}>{inner}</button>}</Fragment>;
          })}
        </div>
      )}
    </div>
  );
}
/** A select-shaped menu: `[key, label][]` in, the chosen key out. */
export function Pick<T extends string>({ value, options, onChange, label, cap, className, groups, quiet }: { value: T; options: [T, ReactNode, ReactNode?][]; onChange: (v: T) => void; label: string; cap?: ReactNode; className?: string; groups?: (k: T) => string | undefined; quiet?: boolean }) {
  return <Menu label={label} cap={cap} value={value} className={className} quiet={quiet} onPick={(k) => onChange(k as T)} items={options.map(([k, l, h]) => ({ key: k, label: l, hint: h, group: groups?.(k) }))} />;
}
/** A toolbar: the one row of a screen's controls (menus, tabs, a "more" button); wraps only when it must. */
export function Toolbar({ children, className = '', lead }: { children: ReactNode; className?: string; lead?: ReactNode }) {
  return <div className={`tbar ${className}`}>{lead && <div className="tbar-lead">{lead}</div>}<div className="tbar-ctl">{children}</div></div>;
}
