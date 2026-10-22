import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Seg } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { sheetName } from '../lib/company';
import { expandSynonyms, findTerms } from '../lib/hebrew';
import { DOC_TYPE_HE, loadCorpus, pageText, readerHref, rememberQuery, searchText, snippet, yearOf, type Corpus, type DocType, type FtHit, type FtQuery } from '../lib/search';
import { buildPool, docLabel, parse, periodText, rank, type Pool } from '../lib/searchOmni';
import { pubLabel } from '../lib/format';
import { useLoad, useRegistry } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import type { RegistryCompany } from '../lib/types';
import '../styles/search.css';

/** Text with the query words marked; `cls` per range overrides the mark's class. */
export function Marked({ text, ranges, offset = 0, cls }: { text: string; ranges: [number, number][]; offset?: number; cls?: string[] }) {
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s0, e0], i) => {
    const s = Math.max(0, s0 - offset), e = Math.min(text.length, e0 - offset);
    if (e <= 0 || s >= text.length || s < at) return;
    out.push(text.slice(at, s), <mark key={i} className={cls?.[i] ?? 'hit'}>{text.slice(s, e)}</mark>);
    at = e;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

/** Page text as pdftotext lays it out: lines in visual order, cells (runs split by two or more spaces) left to right, each
 *  cell isolated with the direction of its own first letter, so Hebrew reads right to left and (1,234) keeps its brackets. */
export function LayoutText({ text, ranges, cls }: { text: string; ranges: [number, number][]; cls?: string[] }) {
  const out: ReactNode[] = [];
  let pos = 0, k = 0;
  for (const line of text.split('\n')) {
    for (const part of line.split(/( {2,})/)) {
      if (!part) continue;
      if (/^ +$/.test(part)) out.push(part);
      else out.push(<bdi key={k++}><Marked text={part} ranges={ranges} offset={pos} cls={cls} /></bdi>);
      pos += part.length;
    }
    out.push('\n');
    pos += 1;
  }
  return <>{out}</>;
}

/** Runs `f` once the element scrolls near the screen. */
function useNear<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: '400px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [near]);
  return [ref, near];
}

/** The line of a page where the words are, marked; loaded when it nears the screen. */
export function Snip({ rid, page, terms }: { rid: number; page: number; terms: string[] }) {
  const [ref, near] = useNear<HTMLDivElement>();
  const [s, setS] = useState<ReturnType<typeof snippet> | 'none' | null>(null);
  useEffect(() => {
    if (!near) return;
    let live = true;
    pageText(rid, page).then((t) => live && setS(snippet(t, terms) ?? 'none'), () => live && setS('none'));
    return () => { live = false; };
  }, [near, rid, page, terms]);
  return <div ref={ref} dir="ltr" className={`snip${s ? '' : ' wait'}`}>{s == null ? '…' : s === 'none' ? '' : <LayoutText text={s.line} ranges={s.ranges} />}</div>;
}

const TYPES: DocType[] = ['annual', 'quarterly', 'presentation', 'solvency'];
const PAGE = 15;

interface Group { doc: FtHit['doc']; best: number; hits: FtHit[] }

/** Full-text results grouped by document, with facets. Shared by /search and the company's documents tab. */
export function TextResults({ q, company: fixedCo, compact = false }: { q: string; company?: string; compact?: boolean }) {
  const [sp, setSp] = useSearchParams();
  const reg = useRegistry();
  const phone = usePhone();
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [res, setRes] = useState<FtQuery | null>(null);
  const [err, setErr] = useState('');
  const [sheet, setSheet] = useState(false);
  useEffect(() => { loadCorpus().then(setCorpus, () => setErr('אינדקס החיפוש לא נטען')); }, []);
  const names = useMemo(() => (reg.data ? buildPool(reg.data, [], [], []).names : null), [reg.data]);
  const parsed = useMemo(() => (names ? parse(q, names) : null), [q, names]);
  // the words left after the company, period and kind of document, with the filers' Hebrew for a loan word (סולבנסי → כושר פירעון).
  // "solvency" alone also searches the words: the solvency reports stopped as separate filings, the ratio is in every report since.
  const rest = parsed ? (parsed.company || parsed.period || parsed.type ? parsed.rest.join(' ') : q) : '';
  const text = expandSynonyms(rest.trim() ? rest : parsed?.type === 'solvency' ? 'כושר פירעון' : '');
  useEffect(() => {
    if (!parsed) return;
    setRes(null); setErr('');
    if (!text.trim()) return;
    let live = true;
    searchText(text).then((r) => live && setRes(r), () => live && setErr('טעינת האינדקס נכשלה'));
    return () => { live = false; };
  }, [text, parsed]);

  const co = fixedCo ?? sp.get('co') ?? parsed?.company?.id ?? '';
  const type = (sp.get('type') ?? (parsed?.type === 'solvency' && !parsed.rest.length ? '' : parsed?.type) ?? '') as DocType | '';
  const docType = (sp.get('type') ?? parsed?.type ?? '') as DocType | '';
  const year = sp.get('y') ?? '';
  const period = parsed?.period ?? '';
  const lang = sp.get('lang') ?? '';
  const n = Number(sp.get('n') ?? PAGE) || PAGE;
  const sort = sp.get('sort') === 'new' ? 'new' : 'rel';
  const set = (k: string, v: string) => setSp((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); x.delete('n'); return x; }, { replace: true });

  const pass = (h: FtHit, skip?: string) => (skip === 'co' || !co || h.doc.company === co) && (skip === 'type' || !type || h.doc.type === type)
    && (skip === 'y' || !year || String(yearOf(h.doc.period)) === year) && (!period || h.doc.period === period) && (skip === 'lang' || !lang || (lang === 'en') === h.doc.en);
  const hits = useMemo(() => (res?.mode === 'none' ? [] : res?.hits.filter((h) => pass(h)) ?? []), [res, co, type, year, period, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const facet = (k: 'co' | 'type' | 'y' | 'lang', f: (h: FtHit) => string) => {
    const m = new Map<string, number>();
    res?.hits.forEach((h) => { if (pass(h, k)) { const v = f(h); m.set(v, (m.get(v) ?? 0) + 1); } });
    return m;
  };
  const fCo = useMemo(() => facet('co', (h) => h.doc.company), [res, type, year, period, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const fType = useMemo(() => facet('type', (h) => h.doc.type), [res, co, year, period, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const fYear = useMemo(() => facet('y', (h) => String(yearOf(h.doc.period))), [res, co, type, period, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const fLang = useMemo(() => facet('lang', (h) => (h.doc.en ? 'en' : 'he')), [res, co, type, year, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const by = new Map<number, Group>();
    for (const h of hits) { let g = by.get(h.doc.id); if (!g) { g = { doc: h.doc, best: h.score, hits: [] }; by.set(h.doc.id, g); } g.hits.push(h); }
    const out = [...by.values()];
    // newest first: by publication date, ties by relevance
    if (sort === 'new') out.sort((a, b) => b.doc.date.localeCompare(a.doc.date) || b.best - a.best);
    return out;
  }, [hits, sort]);
  const regIdx = (id: string) => Math.max(0, reg.data?.findIndex((c) => c.id === id) ?? 0);
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;

  // documents by name: a company, a period or a kind of document in the query lists the filings themselves, newest first
  const docs = useMemo(() => {
    if (!corpus || !parsed || !(co || parsed.period || parsed.type)) return [];
    return corpus.docs.filter((d) => (!co || d.company === co) && (!docType || d.type === docType) && (!period || d.period === period) && (!year || String(yearOf(d.period)) === year) && (!lang || (lang === 'en') === d.en))
      .sort((a, b) => b.date.localeCompare(a.date) || Number(a.en) - Number(b.en));
  }, [corpus, parsed, co, docType, period, year, lang]);
  const [nd, setNd] = useState(8);
  const docList = docs.length > 0 && (
    <section className="sp-docs" aria-label="מסמכים">
      <h3>מסמכים{co && !fixedCo ? ` · ${name(co)}` : ''}{docType ? ` · ${DOC_TYPE_HE[docType]}` : ''}{period ? ` · ${periodText(period)}` : ''}<span className="num">{docs.length}</span></h3>
      <ul>{docs.slice(0, nd).map((d) => (
        <li key={d.id}><span className="dot" style={{ background: `var(--s${(regIdx(d.company) % 11) + 1})` }} aria-hidden="true" /><Link to={`/doc/${d.id}`}>{docLabel(d, name)}</Link>
          <span className="m">פורסם <span className="num">{pubLabel(d.date)}</span> · <span className="num">{d.pages}</span> עמ׳{d.empty ? ' · סרוק, ללא טקסט' : ''}</span></li>))}</ul>
      {docs.length > nd && <button type="button" className="btn" onClick={() => setNd(nd + 16)}>עוד מסמכים ({docs.length - nd})</button>}
    </section>
  );

  if (err) return <ErrorBox what="החיפוש" error={err} />;
  if (!text.trim()) return docList || <Empty title="הקלידו מילה או ביטוי" />;
  if (!res || !corpus) return <>{docList}<div className="sp-note">מחפש ב-<span className="num">{corpus ? corpus.pages.toLocaleString() : '…'}</span> עמודים…</div></>;

  const facets = (
    <div className="sp-facets">
      {!fixedCo && <Facet title="חברה" value={co} onPick={(v) => set('co', v)} items={[...fCo.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => [k, name(k), c])} />}
      <Facet title="סוג מסמך" value={type} onPick={(v) => set('type', v)} items={TYPES.filter((t) => fType.has(t)).map((t) => [t, DOC_TYPE_HE[t], fType.get(t)!])} />
      <Facet title="שנה" value={year} onPick={(v) => set('y', v)} items={[...fYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, c]) => [k, k, c])} />
      {fLang.size > 1 && <Facet title="שפה" value={lang} onPick={(v) => set('lang', v)} items={[['he', 'עברית', fLang.get('he') ?? 0], ['en', 'English', fLang.get('en') ?? 0]]} />}
    </div>
  );
  const active = [co && !fixedCo && name(co), type && DOC_TYPE_HE[type], year, period && periodText(period), lang && (lang === 'en' ? 'English' : 'עברית')].filter(Boolean);
  return (
    <>
      {docList}
      <div className="sp-row">
      <div className="sp-stats" role="status">
        <span className="num">{hits.length.toLocaleString()}</span> עמודים · <span className="num">{groups.length.toLocaleString()}</span> מסמכים
        {res.mode === 'or' && <> · אין עמוד עם כל המילים, מוצגים עמודים עם חלקן</>}
        {res.skipped.length > 0 && <> · לא נחפש: {res.skipped.join(', ')}</>}
        {res.missing.length > 0 && res.mode !== 'none' && <> · לא נמצא: {res.missing.join(', ')}</>}
      </div>
        <span className="grow" />
        {phone && !compact && <button type="button" className="chip sp-fbtn" onClick={() => setSheet(true)}>סינון{active.length ? ` · ${active.join(' · ')}` : ''}</button>}
        <Seg label="סדר" value={sort} options={[['rel', 'רלוונטיות'], ['new', 'חדש קודם']]} onChange={(v) => set('sort', v === 'new' ? 'new' : '')} />
      </div>
      <div className={compact ? '' : 'sp-grid'} style={{ marginTop: 10 }}>
        {!compact && facets}
        <div>
          {groups.length === 0 && <Empty title="לא נמצא" />}
          {groups.slice(0, n).map((g) => (
            <section className="sp-doc" key={g.doc.id}>
              <header>
                <span className="dot" style={{ background: `var(--s${(regIdx(g.doc.company) % 11) + 1})` }} aria-hidden="true" />
                <Link className="t" to={readerHref(g.doc.id, g.hits[0].page, text)}>{docLabel(g.doc, name)}</Link>
                <span className="m">פורסם <span className="num">{pubLabel(g.doc.date)}</span> · <span className="num">{g.doc.pages}</span> עמ׳ · <span className="num">{g.hits.length}</span> עמודים עם התאמה</span>
              </header>
              {g.hits.slice(0, 3).map((h) => (
                <Link className="sp-page" key={h.page} to={readerHref(g.doc.id, h.page, text)}>
                  <span className="pg num">עמ׳ {h.page}</span>
                  <Snip rid={g.doc.id} page={h.page} terms={res.terms} />
                </Link>
              ))}
              {g.hits.length > 3 && <div className="sp-more">ועוד {g.hits.length - 3} עמודים: {g.hits.slice(3, 15).map((h) => <Link key={h.page} to={readerHref(g.doc.id, h.page, text)} className="num" style={{ marginInlineEnd: 8 }}>{h.page}</Link>)}{g.hits.length > 15 && '…'}</div>}
            </section>
          ))}
          {groups.length > n && <div className="sp-pager"><button type="button" className="btn" onClick={() => setSp((p) => { const x = new URLSearchParams(p); x.set('n', String(n + PAGE)); return x; }, { replace: true })}>עוד מסמכים ({groups.length - n})</button></div>}
        </div>
      </div>
      {phone && !compact && <Sheet open={sheet} onClose={() => setSheet(false)} title="סינון"><div className="sp-sheet">{facets}</div></Sheet>}
    </>
  );
}

function Facet({ title, items, value, onPick }: { title: string; items: [string, string, number][]; value: string; onPick: (v: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="sp-facet" role="group" aria-label={title}>
      <h4>{title}</h4>
      {value && <button type="button" onClick={() => onPick('')}>הכול</button>}
      {items.map(([k, label, c]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onPick(value === k ? '' : k)}><span>{label}</span><span className="num">{c.toLocaleString()}</span></button>)}
    </div>
  );
}

/** Companies, screens and statement lines of the query, as one row of links above the filing hits. */
function Quick({ q, reg }: { q: string; reg: RegistryCompany[] }) {
  const ent = useLoad<{ groups: string[]; funds: [string, string][] }>('search/entities.json');
  const rows = useLoad<[string, string, string, number][]>('search/rows.json');
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  useEffect(() => { loadCorpus().then(setCorpus, () => {}); }, []);
  const pool = useMemo<Pool | null>(() => (ent.data && rows.data ? buildPool(reg, ent.data.groups, ent.data.funds, rows.data) : null), [reg, ent.data, rows.data]);
  const items = useMemo(() => {
    if (!pool) return [];
    const seen = new Set<string>();
    // one chip per line and company: the same caption on two sheets of one company is one chip
    return rank(q, pool, sheetName, corpus).filter((x) => { const k = `${x.kind}|${x.label}|${x.meta.split(' · ')[0]}`; if (x.kind === 'מסמך' || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
  }, [pool, q, corpus]);
  if (!items.length) return null;
  return <div className="sp-quick">{items.map((it) => <Link key={it.to + it.label} to={it.to} title={it.meta}><span className="k">{it.kind}</span><span>{it.label}</span>{it.kind === 'שורה בדוח' && <span className="k">{it.meta.split(' · ')[0]}</span>}</Link>)}</div>;
}

/** /search?q= : one query over companies, funds, statement lines and the text of every filed page. */
export function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const reg = useRegistry();
  useEffect(() => setDraft(q), [q]);
  useEffect(() => { if (q.trim().length >= 2) rememberQuery(q); }, [q]);
  useEffect(() => { document.title = q ? `${q} · חיפוש · fox` : 'חיפוש · fox'; }, [q]);
  return (
    <>
      <div className="sp-head">
        <form role="search" onSubmit={(e) => { e.preventDefault(); setSp((p) => { const x = new URLSearchParams(); x.set('q', draft.trim()); ['co', 'type', 'y', 'lang'].forEach((k) => { const v = p.get(k); if (v) x.set(k, v); }); return x; }); }}>
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="רכיב הפסד · 17,717 · הראל דיבידנד · מצגת כלל Q2'26" aria-label="חיפוש בדוחות" autoComplete="off" enterKeyHint="search" />
          <button type="submit" className="btn">חיפוש</button>
        </form>
      </div>
      {q && reg.data && <Quick q={q} reg={reg.data} />}
      {q ? <TextResults q={q} /> : <Empty title="חיפוש בכל הדוחות, המצגות ודוחות כושר הפירעון">שם חברה, שורה בדוח, מילה, ביטוי או מספר.</Empty>}
    </>
  );
}

/** Highlights for a whole page of text. */
export const pageMarks = (text: string, terms: string[]) => findTerms(text, terms);
