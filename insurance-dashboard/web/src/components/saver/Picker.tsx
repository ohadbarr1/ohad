import { useMemo, useState } from 'react';
import type { FundX } from '../../lib/funds';
import { buildPool, rank, type FundEnt } from '../../lib/searchOmni';
import { pcf, selfDir } from '../../lib/verdict';

/* "מה יש לך?": product → manager → track in three taps, or type a name or a fund number. Picks only; the parent saves. */
export const MAIN_PRODS: [string, string][] = [
  ['פנסיה מקיפה', 'פנסיה מקיפה'], ['השתלמות', 'קרן השתלמות'], ['גמל', 'קופת גמל'], ['גמל להשקעה', 'גמל להשקעה'],
  ['פוליסות חיסכון וביטוחי מנהלים (מ-2004)', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)'],
];
const MORE_PRODS = ['פנסיה כללית', 'חיסכון לילד', 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים', 'ביטוחי מנהלים 1992-2003', 'ביטוחי מנהלים 1990-1991'];
/** within a manager, the tracks a saver usually lands in first (the search's order), then by size */
const TRACK_FIRST: Record<string, number> = { 'כללי': 5, 'עד 50': 4, '50-60': 3, '60 ומעלה': 2 };

export function Picker({ funds, have, onPick }: { funds: FundX[]; have: string[]; onPick: (k: string) => void }) {
  const open = useMemo(() => funds.filter((f) => !f.closed && f.assets && !selfDir(f)), [funds]);
  const [prod, setProd] = useState<string | null>(null);
  const [grp, setGrp] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    if (!prod) return [];
    const m = new Map<string, number>();
    open.filter((f) => f.prod === prod && f.grp !== 'קרנות ענפיות ואחרות').forEach((f) => m.set(f.grp, (m.get(f.grp) ?? 0) + (f.assets ?? 0)));
    return [...m].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [open, prod]);
  const tracks = useMemo(() => (prod && grp ? open.filter((f) => f.prod === prod && f.grp === grp).sort((a, b) => (TRACK_FIRST[b.track] ?? 0) - (TRACK_FIRST[a.track] ?? 0) || (b.assets ?? 0) - (a.assets ?? 0)) : []), [open, prod, grp]);

  // type-ahead: the site's own search ranking (lib/searchOmni), funds only
  const pool = useMemo(() => buildPool([], [], open.map((f): FundEnt => [f.name, f.grp, f.k, f.track]), []), [open]);
  const hits = useMemo(() => {
    const t = q.trim();
    if (t.length < 2) return [];
    return rank(t, pool, (s) => s).filter((x) => x.kind === 'קופה' && x.to.startsWith('/funds/')).slice(0, 6)
      .map((x) => open.find((f) => `/funds/${f.k}` === x.to)).filter((f): f is FundX => !!f);
  }, [q, pool, open]);

  const Row = ({ f, sub }: { f: FundX; sub: string }) => {
    const on = have.includes(f.k);
    return (
      <li><button type="button" className="sv-pick-row" disabled={on} onClick={() => onPick(f.k)}>
        <span className="sv-pick-n">{f.name}</span>
        <span className="sv-pick-m">{sub}</span>
        <span className="sv-pick-a" aria-hidden="true">{on ? '✓' : '+'}</span>
      </button></li>
    );
  };

  return (
    <div className="sv-picker">
      <div className="sv-step">
        <div className="sv-step-h"><span className="sv-num" aria-hidden="true">1</span>איזה מוצר?</div>
        <div className="sv-chips" role="group" aria-label="מוצר">
          {MAIN_PRODS.map(([p, l]) => <button key={p} type="button" className="sv-chip" aria-pressed={prod === p} onClick={() => { setProd(p); setGrp(null); }}>{l}</button>)}
          {more ? MORE_PRODS.filter((p) => open.some((f) => f.prod === p)).map((p) => <button key={p} type="button" className="sv-chip" aria-pressed={prod === p} onClick={() => { setProd(p); setGrp(null); }}>{p}</button>)
            : <button type="button" className="sv-chip ghost" onClick={() => setMore(true)}>עוד מוצרים</button>}
        </div>
      </div>
      {prod && <div className="sv-step">
        <div className="sv-step-h"><span className="sv-num" aria-hidden="true">2</span>איזו חברה מנהלת?</div>
        <div className="sv-chips" role="group" aria-label="חברה מנהלת">
          {groups.map((g) => <button key={g} type="button" className="sv-chip" aria-pressed={grp === g} onClick={() => setGrp(g)}>{g}</button>)}
        </div>
      </div>}
      {prod && grp && <div className="sv-step">
        <div className="sv-step-h"><span className="sv-num" aria-hidden="true">3</span>איזה מסלול? <span className="sv-step-note">שם המסלול ומספר הקופה כתובים בדוח השנתי</span></div>
        <ul className="sv-pick-list">{tracks.map((f) => <Row key={f.k} f={f} sub={`${f.track} · דמי ניהול ${pcf(f.fee)} · מספר קופה ${f.id}`} />)}</ul>
      </div>}
      <div className="sv-step sv-search">
        <label className="sv-step-h" htmlFor="sv-q"><span className="sv-num" aria-hidden="true">⌕</span>או חיפוש לפי שם או מספר קופה</label>
        <input id="sv-q" type="search" inputMode="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="למשל: הראל השתלמות, או 9757" />
        {hits.length > 0 && <ul className="sv-pick-list">{hits.map((f) => <Row key={f.k} f={f} sub={`${f.prod} · ${f.track} · מספר קופה ${f.id}`} />)}</ul>}
        {q.trim().length >= 2 && !hits.length && <p className="sv-muted">לא נמצא מסלול פתוח בשם הזה. אפשר לנסות את מספר הקופה מהדוח.</p>}
      </div>
    </div>
  );
}
