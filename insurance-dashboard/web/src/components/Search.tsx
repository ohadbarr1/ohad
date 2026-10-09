import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCompanyData, useMarketData, useRegistry } from '../lib/useData';
import { sheetName } from '../lib/company';

interface Item { kind: 'חברה' | 'קבוצה' | 'קופה' | 'שורה בדוח'; label: string; meta: string; to: string }

function useIndex(enabled: boolean): Item[] {
  const market = useMarketData();
  const reg = useRegistry();
  const phoenix = useCompanyData('phoenix', enabled);
  return useMemo(() => {
    if (!enabled) return [];
    const out: Item[] = [];
    reg.data?.forEach((c) => out.push({ kind: 'חברה', label: `${c.name_he} (${c.name_en})`, meta: c.has_financials ? 'דוחות כספיים + שוק' : 'נתוני שוק', to: `/company/${c.id}` }));
    market.data?.groups.forEach((g) => out.push({ kind: 'קבוצה', label: g, meta: 'פנסיה, גמל ופוליסות חיסכון', to: `/market/group/${encodeURIComponent(g)}` }));
    market.data?.funds.forEach((f) => out.push({ kind: 'קופה', label: f.name, meta: f.grp, to: `/market/funds?q=${encodeURIComponent(f.name)}` }));
    if (phoenix.data) {
      const seen = new Set<string>();
      phoenix.data.metrics.forEach((m, i) => {
        if (m.header || m.entity !== 'F') return;
        const key = m.sheet + m.label;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ kind: 'שורה בדוח', label: m.label, meta: 'הפניקס · ' + sheetName(m.sheet), to: `/company/phoenix/financials?sheet=${encodeURIComponent(m.sheet)}&m=${i}` });
      });
    }
    return out;
  }, [enabled, market.data, reg.data, phoenix.data]);
}

export function Search({ big = false }: { big?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const index = useIndex(open || q.length > 0);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const words = s.split(/\s+/);
    const score = (it: Item) => {
      const t = (it.label + ' ' + it.meta).toLowerCase();
      if (!words.every((w) => t.includes(w))) return -1;
      return (it.label.toLowerCase().startsWith(s) ? 3 : 0) + (it.kind === 'חברה' ? 2 : it.kind === 'קבוצה' ? 1 : 0);
    };
    return index.map((it) => [score(it), it] as const).filter(([sc]) => sc >= 0).sort((a, b) => b[0] - a[0]).slice(0, 14).map(([, it]) => it);
  }, [q, index]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => setHl(0), [q]);

  const go = (it: Item) => { setOpen(false); setQ(''); nav(it.to); };
  const kinds: Item['kind'][] = ['חברה', 'קבוצה', 'קופה', 'שורה בדוח'];

  return (
    <div className={`search ${big ? 'big' : ''}`} ref={box}>
      <input
        type="search" value={q} placeholder="חיפוש חברה, קבוצה, קופה או שורה בדוח כספי…" aria-label="חיפוש"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && hits[hl]) go(hits[hl]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="results" role="listbox">
          {hits.length === 0 && <div className="muted" style={{ padding: 10 }}>{index.length ? 'לא נמצאו תוצאות' : 'טוען אינדקס…'}</div>}
          {kinds.map((k) => {
            const items = hits.filter((h) => h.kind === k);
            return items.length ? (
              <div key={k}>
                <h4>{k}</h4>
                {items.map((it) => (
                  <Link key={it.to + it.label} to={it.to} className={hits[hl] === it ? 'on' : ''} onClick={() => { setOpen(false); setQ(''); }}>
                    <span>{it.label}</span><span className="meta">{it.meta}</span>
                  </Link>
                ))}
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
