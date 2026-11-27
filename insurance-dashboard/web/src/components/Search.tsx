import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useFunds, useLoad, useRegistry } from '../lib/useData';
import { pairHref, pairLabel, pickIndex, pickSearch } from '../lib/pickSearch';
import { sheetName } from '../lib/company';
import { SinceDot } from './SinceBadge';
import { usePhone } from '../lib/useMedia';
import { loadCorpus, recentQueries, readerHref, rememberQuery, searchText, type Corpus } from '../lib/search';
import { askItems, buildPool, docLabel, forDoor, FUNCS, orderFor, ordered, parse, rank, SAVER_TO, tracksFirst, yearAsk, type AskCtx, type FundEnt, type Item, type Kind } from '../lib/searchOmni';
import { useMine } from '../lib/mine';
import { isOldGen } from '../lib/decision';
import { useViewDoor } from './home/doorState';
import '../styles/search.css';

/** Names the search needs from the regulator data, in a file a fraction of market.json: the shell loads it only when the search opens. */
interface Entities { groups: string[]; funds: FundEnt[] }

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
function useFullText(q: string, pool: ReturnType<typeof usePool>['pool'], corpus: Corpus | null, on = true): { q: string; items: Item[]; total: number | null; busy: boolean } {
  const [st, setSt] = useState<{ q: string; items: Item[]; total: number | null }>({ q: '', items: [], total: null });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const s = q.trim();
    if (!on || !pool || !corpus || s.length < 2) { setSt({ q: s, items: [], total: null }); return; }
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
  }, [q, pool, corpus, on]);
  return { ...st, busy };
}

/** the word to type after a company for a function: its Hebrew badge when it is a search key, else its first Hebrew key (CSM and DCF stay) */
const word = (f: (typeof FUNCS)[number]) => (/^[A-Z]+$/.test(f.badge) && !['CSM', 'DCF'].includes(f.badge) ? f.keys.find((k) => /[\u0590-\u05FF]/.test(k)) ?? f.badge : f.badge.split(' ')[0]);
/** W6 doors: the saver's four pages, offered when nothing is typed (SAVER_TO, lib/searchOmni) */
const SAVER_HINTS: [string, string][] = [['המוצרים שלי', '/my'], ['רגעים: עזבתי עבודה, פרישה…', '/my/moment'], ['איך קוראים את הדוח השנתי', '/my/statement'], ['דמי ניהול, בשקלים', '/funds/tools/fees'], ['קרנות ברירת מחדל', '/funds/default']].filter(([, to]) => SAVER_TO.has(to)) as [string, string][];
/** B10: with nothing typed, the saver is offered questions to ask (R3: each opens the page that answers it) */
const SAVER_ASKS = ['מי הכי טוב בפנסיה', 'מסלולים', 'מה קרה החודש', 'מגדל פנסיה'];
const HEAD: Record<Kind, string> = { 'חיפושים': 'חיפושים אחרונים', 'אחרונים': 'עמודים אחרונים', 'רגע': 'רגעים בשנה', 'חברה': 'חברות', 'פונקציה': 'מסכים', 'שאלה': 'שאלות', 'קופה': 'קופות וקבוצות', 'שורה בדוח': 'שורות דוח', 'מסמך': 'מסמכים' };

export function Search({ big = false }: { big?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  // the highlighted item, by identity: the list grows while the index and the filings answer, and the highlight stays on its item
  // (none chosen: the first, so Enter opens the first item listed)
  const [hlKey, setHlKey] = useState<string | null>(null);
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

  // W6 doors: the saver's search lists funds, companies and the saver's pages only (no filing pages, lines or Pro questions)
  const door = useViewDoor();  // P6-B2: a Pro page without a chosen door searches as Pro
  const saver = door == null || door === 'saver';  // B10 / D3: no door chosen = the saver's search (as the shell, the card and the fees tool)
  const [mine] = useMine();
  const yr = useMemo(() => yearAsk(s), [s]);  // R3: "… בשנה האחרונה" is a question about the year, not part of a fund's name
  const qq = yr.year && yr.q.length >= 2 && !askItems(s).length ? yr.q : s;  // ("כמה משלם בשנה" is a question about fees, not the year)
  const yearOn = qq !== s;
  // C11: "X מול Y" between two funds of one product offers the comparison first (lib/pickSearch: the picker's parser, one pair of one product)
  // C14: the saver's tracks are ordered by the same index, so the funds file loads for every saver query
  const fundsFile = useFunds(open && (saver || /\s(?:מול|נגד|לעומת|vs\.?|versus)\s/i.test(q)));
  const pickIdx = useMemo(() => (fundsFile.data ? pickIndex(fundsFile.data.funds) : null), [fundsFile.data]);
  // what the reader's own products are (their type is the default of "מסלולים" and "דירוג"), and the data month ("באוקטובר")
  const byK = useMemo(() => new Map((fundsFile.data?.funds ?? []).map((f) => [f.k, f] as const)), [fundsFile.data]);
  const ask = useMemo<AskCtx>(() => ({ asof: fundsFile.data?.asof, mine: mine.map((m) => byK.get(m.k)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ prod: f.prod, track: f.track })) }), [fundsFile.data, mine, byK]);
  const ranked = useMemo(() => (pool && s.length >= 2 ? forDoor(rank(qq, pool, sheetName, corpus, ask), saver ? 'saver' : door) : []), [qq, s, pool, corpus, door, saver, ask]);
  const ft = useFullText(s, pool, corpus, !saver);
  const pairItem = useMemo<Item | null>(() => {
    if (!pickIdx || s.length < 5) return null;
    const pair = pickSearch(qq, pickIdx, { n: 2 }).pair;
    return pair ? { kind: 'פונקציה', label: pairLabel(pair), meta: 'השוואה', to: pairHref(pair), score: 100 } : null;
  }, [pickIdx, qq, s]);
  const all: Item = { kind: 'מסמך', label: `חיפוש בכל הדוחות: ${s}`, meta: ft.total != null ? `${ft.total.toLocaleString()} עמ׳` : ft.busy ? '…' : '', to: `/search?q=${encodeURIComponent(s)}`, score: -1 };
  // R3: the saver's tracks: the reader's own first ("שלי ·"), old-generation policies last, and on 12 months when the question was about the year
  const forSaver = (list: Item[]): Item[] => {
    const mineK = new Set(mine.map((m) => m.k));
    const kOf = (x: Item) => (x.kind === 'קופה' ? /^\/funds\/([gip]\d+)(?:[?#].*)?$/.exec(x.to)?.[1] ?? null : null);
    const rankOf = (x: Item) => { const k = kOf(x); return k == null ? 1 : mineK.has(k) ? 0 : isOldGen(byK.get(k) ?? {}) ? 2 : 1; };
    const dec = list.map((x) => { const k = kOf(x); return k == null ? x : { ...x, ...(mineK.has(k) ? { meta: `שלי · ${x.meta}` } : {}), ...(yearOn ? { to: `${x.to.split(/[?#]/)[0]}?v=m12`, meta: `${mineK.has(k) ? 'שלי · ' : ''}${x.meta.replace(/^שלי · /, '')} · 12 חודשים` } : {}) }; });
    // the track items keep their slots; only their own order changes (stable)
    const slots = dec.map((x, i) => (x.kind === 'קופה' ? i : -1)).filter((i) => i >= 0);
    const sorted = slots.map((i) => [dec[i], i] as const).sort(([a, i], [b, j]) => rankOf(a) - rankOf(b) || i - j).map(([x]) => x);
    return dec.map((x, i) => { const at = slots.indexOf(i); return at < 0 ? x : sorted[at]; });
  };
  const hits = useMemo(() => {
    if (s.length < 2) return [];
    const docs = ranked.filter((x) => x.kind === 'מסמך');
    const out = ranked.filter((x) => x.kind !== 'מסמך');
    const lead = pairItem ? [pairItem] : [];
    // C14: in the saver door the tracks come before the groups, best-ranked first (old-generation policies last); Pro keeps companies first
    if (saver) return [...lead, ...forSaver(tracksFirst(out, pickIdx && !pairItem ? pickSearch(qq, pickIdx, { n: 6 }).hits : []))];
    return [...lead, ...out, ...docs, ...(ft.q === s ? ft.items : []), all];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, ft, s, saver, pairItem, pickIdx, mine, byK, yearOn]);
  const fundsFirst = saver || door === 'agent';  // W4: savers and agents look for funds, not report pages
  const shown = useMemo(() => ordered(s.length >= 2 ? hits : recent, fundsFirst), [hits, recent, s, fundsFirst]);
  const order = useMemo(() => orderFor(shown, fundsFirst), [shown, fundsFirst]);
  const keyOf = (it: Item) => `${it.to}|${it.label}`;
  const hl = Math.max(0, hlKey ? shown.findIndex((x) => keyOf(x) === hlKey) : 0);
  const setHl = (i: number) => { const it = shown[i]; if (it) setHlKey(keyOf(it)); };

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!full && !box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [full]);
  useEffect(() => setHlKey(null), [q]);
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
    // the phone's full-screen layer has a history entry of its own: the result takes its place (replace), so Back from the result returns
    // to the page the search was opened on. (Going back first and pushing after raced: WebKit's popstate landed after the push and undid
    // it, and the effect's cleanup above, still seeing the layer's entry, went back a second time.) Navigating before closing also clears
    // the entry's `search` flag before that cleanup runs, so it does not go back.
    const over = full && !!history.state?.search;
    nav(it.to, over ? { replace: true } : undefined);
    setOpen(false); setQ(''); input.current?.blur();
  };
  const optId = (i: number) => `sr-opt-${i}`;
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(Math.min(hl + 1, shown.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHl(Math.max(hl - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); if (shown[hl]) go(shown[hl]); else if (s.length >= 2 && !saver) go(all); }
    if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  };

  const field = (auto: boolean) => (
    <input ref={input} autoFocus={auto}
      type="search" value={q} placeholder={phone && !auto ? (saver ? 'חיפוש קופה' : 'חיפוש') /* build review B2 (novice #1): the header field on a phone shows its whole hint; the open search keeps the long one */
        : saver ? (phone ? 'קופה, מספר או שאלה' : 'קופה, מספר קופה, או "עזבתי עבודה"') : phone ? 'חברה, קופה או מילה' : 'חברה, מספר קופה, שורה בדוח או מילה בדוחות · למשל 2155'} aria-label="חיפוש"
      role="combobox" aria-expanded={open && shown.length > 0} aria-controls="search-results" aria-autocomplete="list" aria-activedescendant={open && shown[hl] ? optId(hl) : undefined}
      enterKeyHint="search" autoComplete="off" spellCheck={false}
      onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
    />
  );
  const list = open && (s.length >= 2 || !s) && (
    <div className="results omni" role="listbox" id="search-results" aria-label="תוצאות חיפוש">
      {s.length >= 2 && !ready && <div className="muted omni-empty">טוען אינדקס…</div>}
      {saver && s.length >= 2 && ready && shown.length === 0 && <div className="omni-empty omni-none" role="status"><b>לא נמצא.</b> נסו את מספר הקופה מהדוח השנתי, את שם החברה המנהלת, או מה קרה: "עזבתי עבודה", "פרישה", "ניוד".</div>}
      {order.map((k) => {
        const items = shown.filter((h) => h.kind === k);
        return items.length ? (
          <div key={k} role="group" aria-label={HEAD[k]}>
            <h4>{HEAD[k]}</h4>
            {items.map((it) => {
              const i = shown.indexOf(it);
              return (
                <Link key={it.to + it.label} to={it.to} id={optId(i)} role="option" aria-selected={hl === i} className={hl === i ? 'on' : ''} onMouseMove={() => { if (hl !== i) setHl(i); }}
                  onClick={(e) => { e.preventDefault(); go(it); }}>
                  <span className="lbl">{it.score === -1 ? <><span className="muted">חיפוש בכל הדוחות: </span><bdi>{s}</bdi></> : it.label}{it.sub && <span className="sub">{it.sub}</span>}{it.kind === 'חברה' && <SinceDot id={it.to.split('/')[2]} n />}</span><span className="meta num">{it.meta}</span>
                </Link>
              );
            })}
          </div>
        ) : null;
      })}
      {!s && saver && <div className="codes"><h4>אפשר לשאול</h4><div>{SAVER_ASKS.map((t) => <button key={t} type="button" className="chip" onClick={() => { setQ(t); input.current?.focus(); }}>{t}</button>)}</div><h4>מה אפשר לחפש</h4><div>{SAVER_HINTS.map(([l, to]) => <Link key={to} to={to} className="chip" onClick={(e) => { e.preventDefault(); go({ kind: 'פונקציה', label: l, meta: '', to, score: 0 }); }}>{l}</Link>)}</div><div className="muted omni-tip">לדוגמה: <bdi>2155</bdi> · <bdi>הראל השתלמות</bdi> · <bdi>עזבתי עבודה</bdi> · <bdi>פיצויים</bdi></div></div>}
      {!s && !saver && <div className="codes"><h4>חברה + נושא · לדוגמה: הראל סקירה</h4><div>{FUNCS.map((f) => <span key={f.code} className="chip" title={`${f.label} · גם באנגלית: ${f.code}`}><b>{word(f)}</b> {f.label !== word(f) && <span className="muted">{f.label}</span>}</span>)}</div><div className="muted omni-tip">לדוגמה: <bdi>הראל CSM</bdi> · <bdi>כלל מצגת Q2'26</bdi> · <bdi>רכיב הפסד</bdi> · <bdi>17,717</bdi>{!phone && <> · מקש <kbd>?</kbd> לכל הקיצורים</>}</div></div>}
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
