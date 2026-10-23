import type { ReactNode } from 'react';
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
