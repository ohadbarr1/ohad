import type { ReactNode } from 'react';

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

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <p>{children}</p>}</div>;
}

export function Loading({ what }: { what: string }) { return <div className="empty"><p>טוען {what}…</p></div>; }
export function ErrorBox({ what, error }: { what: string; error: string }) {
  return <div className="empty err"><b>לא ניתן לטעון {what}</b><p className="mono">{error}</p></div>;
}

export function copyText(text: string, done: (ok: boolean) => void) {
  try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch { done(false); }
}

/** Marks a CSM figure whose table total also contains the (non-CSM) future profit of pure savings policies. */
export function IncChip({ f }: { f: { inc?: number; m: string } | null | undefined }) {
  return f && f.inc === 1 && f.m.startsWith('csm') ? <> <span className="chip est" title="הסכום בטבלת החברה כולל רווח עתידי בפוליסות חיסכון, שאינו CSM לפי התקן">כולל פוליסות חיסכון</span></> : null;
}
