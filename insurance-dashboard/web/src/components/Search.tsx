import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useLoad, useRegistry } from '../lib/useData';
import { sheetName } from '../lib/company';
import { SinceDot } from './SinceBadge';
import { usePhone } from '../lib/useMedia';
import { loadCorpus, recentQueries, readerHref, rememberQuery, searchText, type Corpus } from '../lib/search';
import { buildPool, docLabel, FUNCS, parse, rank, type Item, type Kind } from '../lib/searchOmni';
import '../styles/search.css';

/** Names the search needs from the regulator data, in a file a fraction of market.json: the shell loads it only when the search opens. */
interface Entities { groups: string[]; funds: [string, string][] }

/** The entity and line pool, loaded the first time the search opens. */
function usePool(enabled: boolean) {
  const ent = useLoad<Entities>(enabled ? 'search/entities.json' : null);
  const reg = useRegistry();
  const rows = useLoad<[string, string, string, number][]>(enabled ? 'search/rows.json' : null);
  const qi = useLoad<{ rows: { id: string; q: string; cos: string[] }[] }>(enabled ? 'answers/index.json' : null);  // S1: the Question Index
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  useEffect(() => { if (enabled && !corpus) loadCorpus().then(setCorpus, () => {}); }, [enabled, corpus]);
  const pool = useMemo(() => (enabled && reg.data ? buildPool(reg.data, ent.data?.groups ?? [], ent.data?.funds ?? [], rows.data ?? [], qi.data?.rows ?? []) : null), [enabled, reg.data, ent.data, rows.data, qi.data]);
  return { pool, corpus, ready: !!(pool && ent.data && rows.data) };
}

/** Pages of the filings that carry the words, after the company / period / kind the query names. Debounced; one shard per word. */
function useFullText(q: string, pool: ReturnType<typeof usePool>['pool'], corpus: Corpus | null): { q: string; items: Item[]; total: number | null; busy: boolean } {
  const [st, setSt] = useState<{ q: string; items: Item[]; total: number | null }>({ q: '', items: [], total: null });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const s = q.trim();
    if (!pool || !corpus || s.length < 2) { setSt({ q: s, items: [], total: null }); return; }
    const p = parse(s, pool.names);
    const text = p.rest.join(' ');
    if (!p.rest.some((w) => w.length >= 3 || /^\d/.test(w))) { setSt({ q: s, items: [], total: null }); return; }
    let live = true;
    setBusy(true);
    const id = setTimeout(() => {
      searchText(text).then((r) => {
        if (!live) return;
        const name = (id: string) => pool.reg.find((c) => c.id === id)?.name_he ?? id;
        const hits = r.mode === 'and' ? r.hits.filter((h) => (!p.company || h.doc.company === p.company.id) && (!p.period || h.doc.period === p.period) && (!p.type || h.doc.type === p.type)) : [];
        // the best page of each company first: four companies say more than four pages of one report
        const seen = new Set<string>(), top = hits.filter((h) => !seen.has(h.doc.company) && !!seen.add(h.doc.company)).slice(0, 4);
        setSt({ q: s, total: hits.length, items: top.map((h, i) => ({ kind: 'מסמך' as Kind, label: docLabel(h.doc, name), meta: `עמ׳ ${h.page}`, to: readerHref(h.doc.id, h.page, text), score: 10 - i })) });
        setBusy(false);
      }, () => { if (live) { setBusy(false); setSt({ q: s, items: [], total: 0 }); } });
    }, 220);
    return () => { live = false; clearTimeout(id); };
  }, [q, pool, corpus]);
  return { ...st, busy };
}

/** the word to type after a company for a function: its Hebrew badge when it is a search key, else its first Hebrew key (CSM and DCF stay) */
const word = (f: (typeof FUNCS)[number]) => (/^[A-Z]+$/.test(f.badge) && !['CSM', 'DCF'].includes(f.badge) ? f.keys.find((k) => /[\u0590-\u05FF]/.test(k)) ?? f.badge : f.badge.split(' ')[0]);
const ORDER: Kind[] = ['חיפושים', 'אחרונים', 'חברה', 'פונקציה', 'שאלה', 'קופה', 'שורה בדוח', 'מסמך'];
/** a company with a screen code ("הראל csm"): the screen leads */
const orderFor = (list: Item[]): Kind[] => (list.some((x) => x.kind === 'פונקציה' && x.score >= 90) ? ['פונקציה', ...ORDER.filter((k) => k !== 'פונקציה')] : ORDER);
const HEAD: Record<Kind, string> = { 'חיפושים': 'חיפושים אחרונים', 'אחרונים': 'עמודים אחרונים', 'חברה': 'חברות', 'פונקציה': 'מסכים', 'שאלה': 'שאלות', 'קופה': 'קופות וקבוצות', 'שורה בדוח': 'שורות דוח', 'מסמך': 'מסמכים' };

export function Search({ big = false }: { big?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const phone = usePhone();
  const full = phone && open && !big;
  const { pool, corpus, ready } = usePool(open || q.length > 0);
  const s = q.trim();

  // with nothing typed: the searches and pages of last time, and the codes that open a screen of any company
  const recent = useMemo<Item[]>(() => {
    if (!open || s) return [];
    const qs = recentQueries().slice(0, 4).map<Item>((r) => ({ kind: 'חיפושים', label: r, meta: '', to: `/search?q=${encodeURIComponent(r)}`, score: 0 }));
    let ps: Item[] = [];
    try { ps = (JSON.parse(localStorage.getItem('fox:recent') ?? '[]') as { p: string; t: string }[]).slice(0, 5).map((r) => ({ kind: 'אחרונים', label: r.t, meta: '', to: r.p, score: 0 })); } catch { /* storage may be blocked */ }
    return [...qs, ...ps];
  }, [open, s]);

  const ranked = useMemo(() => (pool && s.length >= 2 ? rank(s, pool, sheetName, corpus) : []), [s, pool, corpus]);
  const ft = useFullText(s, pool, corpus);
  const all: Item = { kind: 'מסמך', label: `חיפוש בכל הדוחות: ${s}`, meta: ft.total != null ? `${ft.total.toLocaleString()} עמ׳` : ft.busy ? '…' : '', to: `/search?q=${encodeURIComponent(s)}`, score: -1 };
  const hits = useMemo(() => {
    if (s.length < 2) return [];
    const docs = ranked.filter((x) => x.kind === 'מסמך');
    const out = ranked.filter((x) => x.kind !== 'מסמך');
    return [...out, ...docs, ...(ft.q === s ? ft.items : []), all];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, ft, s]);
  const shown = useMemo(() => {
    const list = s.length >= 2 ? hits : recent;
    return orderFor(list).flatMap((k) => list.filter((h) => h.kind === k));
  }, [hits, recent, s]);
  const order = useMemo(() => orderFor(shown), [shown]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!full && !box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [full]);
  useEffect(() => setHl(0), [q]);
  useEffect(() => {
    if (big) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); setOpen(true); input.current?.focus(); input.current?.select(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [big]);
  // the phone's full-screen search: Back closes it
  useEffect(() => {
    if (!full) return;
    history.pushState({ ...(history.state ?? {}), search: true }, '');
    const pop = () => setOpen(false);
    addEventListener('popstate', pop);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('popstate', pop); document.body.style.overflow = ''; if (history.state?.search) history.back(); };
  }, [full]);

  const go = (it: Item) => {
    if (s.length >= 2) rememberQuery(s);
    setOpen(false); setQ(''); input.current?.blur();
    // leave the full-screen layer's history entry before moving on
    if (full && history.state?.search) { history.back(); setTimeout(() => nav(it.to), 0); } else nav(it.to);
  };
  const optId = (i: number) => `sr-opt-${i}`;
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, shown.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); if (shown[hl]) go(shown[hl]); else if (s.length >= 2) go(all); }
    if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  };

  const field = (auto: boolean) => (
    <input ref={input} autoFocus={auto}
      type="search" value={q} placeholder={phone ? 'חברה, שורה או מילה' : 'חברה, קופה, שורה בדוח או מילה בדוחות · הראל csm'} aria-label="חיפוש"
      role="combobox" aria-expanded={open && shown.length > 0} aria-controls="search-results" aria-autocomplete="list" aria-activedescendant={open && shown[hl] ? optId(hl) : undefined}
      enterKeyHint="search" autoComplete="off" spellCheck={false}
      onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
    />
  );
  const list = open && (s.length >= 2 || !s) && (
    <div className="results omni" role="listbox" id="search-results" aria-label="תוצאות חיפוש">
      {s.length >= 2 && !ready && <div className="muted omni-empty">טוען אינדקס…</div>}
      {order.map((k) => {
        const items = shown.filter((h) => h.kind === k);
        return items.length ? (
          <div key={k} role="group" aria-label={HEAD[k]}>
            <h4>{HEAD[k]}</h4>
            {items.map((it) => {
              const i = shown.indexOf(it);
              return (
                <Link key={it.to + it.label} to={it.to} id={optId(i)} role="option" aria-selected={hl === i} className={hl === i ? 'on' : ''} onMouseEnter={() => setHl(i)}
                  onClick={(e) => { e.preventDefault(); go(it); }}>
                  <span className="lbl">{it.score === -1 ? <><span className="muted">חיפוש בכל הדוחות: </span><bdi>{s}</bdi></> : it.label}{it.sub && <span className="sub">{it.sub}</span>}{it.kind === 'חברה' && <SinceDot id={it.to.split('/')[2]} n />}</span><span className="meta num">{it.meta}</span>
                </Link>
              );
            })}
          </div>
        ) : null;
      })}
      {!s && <div className="codes"><h4>חברה + נושא · לדוגמה: הראל סקירה</h4><div>{FUNCS.map((f) => <span key={f.code} className="chip" title={`${f.label} · גם באנגלית: ${f.code}`}><b>{word(f)}</b> {f.label !== word(f) && <span className="muted">{f.label}</span>}</span>)}</div><div className="muted omni-tip">לדוגמה: <bdi>הראל CSM</bdi> · <bdi>כלל מצגת Q2'26</bdi> · <bdi>רכיב הפסד</bdi> · <bdi>17,717</bdi>{!phone && <> · מקש <kbd>?</kbd> לכל הקיצורים</>}</div></div>}
    </div>
  );

  if (full) return (
    <div className="search">
      <input type="search" value={q} placeholder="חיפוש" aria-label="חיפוש" readOnly onFocus={() => setOpen(true)} />
      {createPortal(
        <div className="omni-full" role="dialog" aria-modal="true" aria-label="חיפוש">
          <div className="omni-bar">{field(true)}<button type="button" className="btn" onClick={() => history.back()}>ביטול</button></div>
          {list}
        </div>, document.body)}
    </div>
  );
  return (
    <div className={`search ${big ? 'big' : ''}`} ref={box}>
      {field(false)}
      {!big && !q && <span className="hint"><kbd>/</kbd></span>}
      {list}
    </div>
  );
}
