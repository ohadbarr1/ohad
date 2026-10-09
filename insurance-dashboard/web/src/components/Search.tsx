import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCompanyData, useMarketData, useRegistry } from '../lib/useData';
import { sheetName } from '../lib/company';

interface Item { kind: 'חברה' | 'פונקציה' | 'קבוצה' | 'קופה' | 'שורה בדוח'; label: string; meta: string; to: string }

/** Screens that exist for every company, with the short codes that reach them: "הראל csm", "phoenix dcf". */
const FUNCS: { code: string; label: string; keys: string[]; to: (id: string) => string }[] = [
  { code: 'ER', label: 'סקירת דוח', keys: ['er', 'review', 'סקירת', 'סקירה', 'דוח', 'yoy', 'qoq'], to: (id) => `/company/${id}/review` },
  { code: 'CSM', label: 'IFRS 17 · CSM', keys: ['csm', 'ifrs', '17', 'ra', 'רגישויות', 'הון', 'solvency'], to: (id) => `/company/${id}/ifrs17` },
  { code: 'FA', label: 'דוחות לאורך זמן', keys: ['fa', 'דוחות', 'financials'], to: (id) => `/company/${id}/financials` },
  { code: 'LTS', label: 'חיסכון ארוך טווח', keys: ['lts', 'חיסכון', 'פנסיה', 'גמל', 'aum'], to: (id) => `/company/${id}/savings` },
  { code: 'DOC', label: 'מסמכים וחיפוש בדוחות', keys: ['doc', 'docs', 'מסמכים', 'חיפוש', 'filings'], to: (id) => `/company/${id}/filings` },
  { code: 'DCF', label: 'הערכת שווי, DCF', keys: ['dcf', 'שווי', 'valuation'], to: (id) => `/valuation/${id}/dcf` },
  { code: 'SOTP', label: 'סכום החלקים, SOTP', keys: ['sotp', 'חלקים'], to: (id) => `/valuation/${id}/sotp` },
];

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
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const index = useIndex(open || q.length > 0);

  const reg = useRegistry();
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const words = s.split(/\s+/);
    // a company name followed by a function code or word opens that screen directly
    const funcs: Item[] = [];
    (reg.data ?? []).forEach((c) => {
      const names = `${c.name_he} ${c.name_en} ${c.id}`.toLowerCase();
      const own = words.filter((w) => names.includes(w)), rest = words.filter((w) => !names.includes(w));
      if (!own.length) return;
      FUNCS.filter((f) => rest.every((w) => f.keys.some((k) => k.startsWith(w)) || f.code.toLowerCase().startsWith(w))).slice(0, rest.length ? 3 : 7)
        .forEach((f) => funcs.push({ kind: 'פונקציה', label: `${c.name_he} · ${f.label}`, meta: f.code, to: f.to(c.id) }));
    });
    if (funcs.length && words.length > 1) return funcs.slice(0, 10);
    const score = (it: Item) => {
      const t = (it.label + ' ' + it.meta).toLowerCase();
      if (!words.every((w) => t.includes(w))) return -1;
      return (it.label.toLowerCase().startsWith(s) ? 3 : 0) + (it.kind === 'חברה' ? 2 : it.kind === 'קבוצה' ? 1 : 0);
    };
    const found = index.map((it) => [score(it), it] as const).filter(([sc]) => sc >= 0).sort((a, b) => b[0] - a[0]).slice(0, 14).map(([, it]) => it);
    const companies = found.filter((it) => it.kind === 'חברה');
    return [...companies, ...(companies.length === 1 ? funcs.slice(0, 7) : []), ...found.filter((it) => it.kind !== 'חברה')];
  }, [q, index, reg.data]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => setHl(0), [q]);
  useEffect(() => {
    if (big) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [big]);

  const go = (it: Item) => { setOpen(false); setQ(''); nav(it.to); };
  const kinds: Item['kind'][] = ['חברה', 'פונקציה', 'קבוצה', 'קופה', 'שורה בדוח'];

  return (
    <div className={`search ${big ? 'big' : ''}`} ref={box}>
      <input ref={input}
        type="search" value={q} placeholder="חברה, קופה, או חברה + פונקציה: הראל csm" aria-label="חיפוש"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && hits[hl]) go(hits[hl]);
          if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }}
      />
      {!big && !q && <span className="hint"><kbd>/</kbd></span>}
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
