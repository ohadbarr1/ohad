import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { findTerms, terms as toTerms } from '../lib/hebrew';
import { nf, periodLabel, pubLabel } from '../lib/format';
import { loadCorpus, mergeRanges, pageText, readerHref, searchText, type Corpus, type DocMeta } from '../lib/search';
import { docLabel } from '../lib/searchOmni';
import { mayaReport, pdfPage } from '../lib/sources';
import { useRegistry } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { LayoutText } from './SearchPage';
import '../styles/search.css';

const PdfPage = lazy(() => import('./ReaderPdf').then((m) => ({ default: m.PdfPage })));
const VIEW = 'fox:reader';
const readView = (): 'text' | 'pdf' => { try { return localStorage.getItem(VIEW) === 'pdf' ? 'pdf' : 'text'; } catch { return 'text'; } };

/** facts/<rid>.json: what the site extracted from each page of the document */
interface Facts { rid: number; n: number; labels: string[]; pages: Record<string, [number, number, string, string, string, 'fs' | 'ifrs' | 'lts', string, string][]> }
type Fact = { label: string; v: number; unit: string; period: string; to: string; src: 'fs' | 'ifrs' | 'lts' };
/** one printed line of the page and its figures, one per period */
type Line = { label: string; unit: string; to: string; src: Fact['src']; cells: Fact[] };
const SRC: Record<Fact['src'], string> = { fs: 'דוחות כספיים', ifrs: 'IFRS 17 וכושר פירעון', lts: 'חיסכון ארוך טווח' };
const UNIT: Record<string, string> = { k: 'אלפי ש"ח', m: 'מיליוני ש"ח', pct: '%', nis: 'ש"ח' };
const fmt = (v: number, unit: string) => (unit === 'pct' ? `${nf(v, 1)}%` : unit === 'nis' ? nf(v, 2) : unit === 'm' ? nf(v, Math.abs(v) < 100 && v % 1 ? 1 : 0) : nf(v, 0));

const factsCache = new Map<number, Promise<Facts | null>>();
function loadFacts(rid: number): Promise<Facts | null> {
  if (!factsCache.has(rid)) factsCache.set(rid, fetch(`${import.meta.env.BASE_URL}data/search/facts/${rid}.json`).then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null)).catch(() => null));
  return factsCache.get(rid)!;
}

/** The ways a figure may be printed on the page: as stored, and scaled to the page's unit. */
function printedForms(v: number, unit: string): string[] {
  const a = Math.abs(v), out = new Set<string>();
  const add = (x: number, d: number) => { const t = x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); if (t.replace(/[^0-9]/g, '').length >= 2) out.add(t); };
  [0, 1, 2].forEach((d) => { add(a, d); if (unit === 'k') add(a / 1000, d); if (unit === 'm') add(a * 1000, d); });
  return [...out];
}

/** /doc/:id?page=N&q=… : one filed page, the words marked, and beside it what the site extracted from that page. */
export function Reader() {
  const { id = '' } = useParams();
  const rid = Number(id);
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const q = sp.get('q') ?? '';
  const reg = useRegistry();
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [err, setErr] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [facts, setFacts] = useState<Facts | null | undefined>(undefined);
  const [matchPages, setMatchPages] = useState<number[] | null>(null);
  const [focus, setFocus] = useState<Fact | null>(null);
  // a phone wraps lines by default: the laid-out page is wider than the screen and would clip; the toggle restores the layout
  const phone = usePhone();
  const [wrapPick, setWrap] = useState<boolean | null>(null);
  const wrap = wrapPick ?? phone;
  const [view, setView] = useState<'text' | 'pdf'>(readView);
  const [pdfErr, setPdfErr] = useState('');
  const pickView = (v: 'text' | 'pdf') => { setView(v); setPdfErr(''); try { localStorage.setItem(VIEW, v); } catch { /* storage may be blocked */ } };
  const onPdfFail = useCallback((why: string) => setPdfErr(why), []);
  useEffect(() => { loadCorpus().then(setCorpus, () => setErr('רשימת המסמכים לא נטענה')); }, []);
  const doc: DocMeta | undefined = corpus?.byId.get(rid);
  const pages = doc?.pages ?? 0;
  const page = Math.min(Math.max(1, Number(sp.get('page')) || 1), Math.max(1, pages));
  const qt = useMemo(() => toTerms(q), [q]);
  const name = (c: string) => reg.data?.find((x) => x.id === c)?.name_he ?? c;
  const go = (p: number, replace = false) => setSp((cur) => { const x = new URLSearchParams(cur); x.set('page', String(p)); return x; }, { replace });

  useEffect(() => {
    if (!doc) return;
    let live = true;
    setText(null);
    pageText(doc.id, page).then((t) => live && setText(t), () => live && setText(''));
    return () => { live = false; };
  }, [doc, page]);
  useEffect(() => { let live = true; setFacts(undefined); loadFacts(rid).then((f) => live && setFacts(f)); return () => { live = false; }; }, [rid]);
  useEffect(() => {
    if (!doc || !q.trim()) { setMatchPages(null); return; }
    let live = true;
    searchText(q).then((r) => live && setMatchPages(r.mode === 'and' ? r.hits.filter((h) => h.doc.id === doc.id).map((h) => h.page).sort((a, b) => a - b) : []), () => live && setMatchPages([]));
    return () => { live = false; };
  }, [doc, q]);
  useEffect(() => {
    if (doc) document.title = `${docLabel(doc, name)} · עמ׳ ${page} · fox`;
  }); // eslint-disable-line react-hooks/exhaustive-deps
  // ← → turn the page (the page is right-to-left: ← is the next page)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' && page < pages) { e.preventDefault(); go(page + 1); }
      if (e.key === 'ArrowRight' && page > 1) { e.preventDefault(); go(page - 1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const rows = useMemo<Fact[]>(() => (facts?.pages[String(page)] ?? []).map(([li, v, unit, pt, pe, src, a, b]) => {
    const [sheet, mi] = b.split('|');
    const to = src === 'fs' ? `/company/${a}/financials?sheet=${encodeURIComponent(sheet)}&m=${mi}` : src === 'ifrs' ? `/company/${a}/ifrs17?p=${b}` : `/company/${a}/savings`;
    return { label: facts!.labels[li], v, unit, period: pe ? periodLabel(pt, pe) : '', to, src };
  }), [facts, page]);
  const factPages = useMemo(() => (facts ? Object.keys(facts.pages).map(Number).sort((a, b) => a - b) : []), [facts]);
  const lines = useMemo<Line[]>(() => {
    const by = new Map<string, Line>();
    for (const f of rows) {
      const k = `${f.src}|${f.label}|${f.unit}`;
      let l = by.get(k);
      if (!l) { l = { label: f.label, unit: f.unit, to: f.to, src: f.src, cells: [] }; by.set(k, l); }
      if (!l.cells.some((c) => c.period === f.period && c.v === f.v)) l.cells.push(f);
    }
    return [...by.values()];
  }, [rows]);
  const { ranges, cls } = useMemo(() => {
    if (!text) return { ranges: [] as [number, number][], cls: [] as string[] };
    const q = mergeRanges(text, findTerms(text, qt)).map((r) => [r, 'hit'] as const);
    const f: (readonly [[number, number], string])[] = [];
    if (focus) {
      for (const form of printedForms(focus.v, focus.unit)) {
        let at = text.indexOf(form);
        while (at >= 0) {
          const before = text[at - 1] ?? ' ', after = text[at + form.length] ?? ' ';
          if (!/[\d.,]/.test(before) && !/\d/.test(after) && !(/[.,]/.test(after) && /\d/.test(text[at + form.length + 1] ?? ''))) f.push([[at, at + form.length], 'hit fact']);
          at = text.indexOf(form, at + 1);
        }
      }
    }
    const all = [...q, ...f].sort((a, b) => a[0][0] - b[0][0]).filter((x, i, arr) => i === 0 || x[0][0] >= arr[i - 1][0][1]);
    return { ranges: all.map((x) => x[0]), cls: all.map((x) => x[1]) };
  }, [text, qt, focus]);
  // the figure in focus scrolls into view on the page
  useEffect(() => { if (focus) document.querySelector('.rd-page mark.fact')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [focus, ranges]);

  if (err) return <ErrorBox what="המסמך" error={err} />;
  if (!corpus) return <Loading what="מסמך" />;
  if (!doc) return (
    <Empty title="המסמך אינו במאגר הטקסט">
      {Number.isFinite(rid) && rid > 0 && <a href={mayaReport(rid)} target="_blank" rel="noreferrer">הדיווח במאיה</a>}
    </Empty>
  );
  const mi = matchPages?.indexOf(page) ?? -1;
  const nextMatch = matchPages?.find((p) => p > page), prevMatch = matchPages ? [...matchPages].reverse().find((p) => p < page) : undefined;
  const bySrc = (['fs', 'ifrs', 'lts'] as const).map((s) => [s, lines.filter((r) => r.src === s)] as const).filter(([, l]) => l.length);
  return (
    <>
      <div className="rd-head">
        <h1>{docLabel(doc, name)}</h1>
        <span className="m">{doc.title} · פורסם <span className="num">{pubLabel(doc.date)}</span> · <span className="num">{doc.pages}</span> עמ׳ · מקור: MAYA</span>
      </div>
      <div className="rd-bar">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => go(page - 1)} aria-label="העמוד הקודם">→</button>
        <form onSubmit={(e) => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('pg')); if (v >= 1 && v <= pages) go(v); }} style={{ display: 'contents' }}>
          <input key={page} name="pg" className="pgin num" type="number" min={1} max={pages} defaultValue={page} aria-label="מספר עמוד" />
        </form>
        <span className="muted">מתוך <span className="num">{pages}</span></span>
        <button type="button" className="btn" disabled={page >= pages} onClick={() => go(page + 1)} aria-label="העמוד הבא">←</button>
        {q && matchPages && <span className="muted">· <bdi>{q}</bdi>: {matchPages.length ? <><span className="num">{mi >= 0 ? `${mi + 1}/` : ''}{matchPages.length}</span> עמודים</> : 'אין התאמה במסמך'}</span>}
        {q && matchPages && matchPages.length > 0 && <>
          <button type="button" className="chip" disabled={prevMatch == null} onClick={() => prevMatch && go(prevMatch)}>התאמה קודמת</button>
          <button type="button" className="chip" disabled={nextMatch == null} onClick={() => nextMatch && go(nextMatch)}>התאמה הבאה</button>
        </>}
        <span className="grow" />
        <Seg label="תצוגה" value={view} onChange={pickView} options={[['text', 'טקסט'], ['pdf', `PDF${doc.kb ? ` · ${doc.kb >= 1024 ? `${nf(doc.kb / 1024, 1)}MB` : `${doc.kb}KB`}` : ''}`]]} />
        {view === 'text' && <button type="button" className="chip" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>{wrap ? 'פריסת עמוד' : 'גלישת שורות'}</button>}
        <a className="btn" href={pdfPage(doc.url, page)} target="_blank" rel="noreferrer">פתח במקור, עמ׳ {page}</a>
      </div>
      <div className="rd-grid">
        <div className={`rd-page${wrap ? ' wrap' : ''}`} aria-label={`עמוד ${page}`}>
          {view === 'pdf' && !pdfErr ? <Suspense fallback={<p className="none">טוען…</p>}><PdfPage url={doc.url} page={page} terms={qt} onFail={onPdfFail} /></Suspense> : <>
          {pdfErr && <p className="none">הקובץ המקורי לא נטען לתוך האתר; מוצג הטקסט של העמוד. <a href={pdfPage(doc.url, page)} target="_blank" rel="noreferrer">פתח במקור, עמ׳ {page}</a></p>}
          {text == null ? <p className="none">טוען…</p> : text.trim() ? <pre dir="ltr"><LayoutText text={text} ranges={ranges} cls={cls} /></pre> : <p className="none">אין שכבת טקסט בעמוד זה (עמוד סרוק או גרפי). <a href={pdfPage(doc.url, page)} target="_blank" rel="noreferrer">פתח במקור</a></p>}
          </>}
        </div>
        <aside className="rd-side">
          <Panel title={<>מה חולץ מעמוד זה{rows.length > 0 && <> · <span className="num">{rows.length}</span> נתונים</>}</>}>
            {facts === undefined ? <p className="muted">טוען…</p> : rows.length === 0 ? <p className="muted">לא חולצו נתונים מעמוד זה.</p> : bySrc.map(([s, list]) => (
              <div key={s}>
                {bySrc.length > 1 && <h4 className="muted" style={{ margin: '8px 0 4px', fontSize: 'var(--t-1)', fontWeight: 500 }}>{SRC[s]}</h4>}
                <div className="rd-facts">{list.slice(0, 60).map((l, i) => (
                  <div className="rd-line" key={i}>
                    <div className="lb"><Link to={l.to}>{l.label}</Link><span className="p">{UNIT[l.unit] ?? l.unit}</span></div>
                    <div className="cells">{l.cells.slice(0, 8).map((c, j) => (
                      <button type="button" key={j} className="cell" onMouseEnter={() => setFocus(c)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(c)} onBlur={() => setFocus(null)} onClick={() => setFocus(focus === c ? null : c)} aria-pressed={focus === c} title="סימון בעמוד">
                        <span className="pp num">{c.period}</span> <span className="num">{fmt(c.v, c.unit)}</span>
                      </button>
                    ))}{l.cells.length > 8 && <span className="muted num">+{l.cells.length - 8}</span>}</div>
                  </div>
                ))}</div>
                {list.length > 60 && <p className="muted">ועוד {list.length - 60} שורות</p>}
              </div>
            ))}
            {factPages.length > 0 && <div style={{ marginTop: 10 }}><div className="muted" style={{ fontSize: 'var(--t-1)', marginBottom: 4 }}>עמודים עם נתונים שחולצו · <span className="num">{facts?.n.toLocaleString()}</span> נתונים</div><div className="rd-hits">{factPages.slice(0, 60).map((p) => <Link key={p} to={readerHref(rid, p, q)} replace className={`num${p === page ? ' on' : ''}`}>{p}</Link>)}</div></div>}
          </Panel>
          {q && matchPages && matchPages.length > 0 && (
            <Panel title={<>עמודים עם <bdi>{q}</bdi></>}>
              <div className="rd-hits">{matchPages.slice(0, 120).map((p) => <Link key={p} to={readerHref(rid, p, q)} replace className={`num${p === page ? ' on' : ''}`}>{p}</Link>)}</div>
            </Panel>
          )}
          <Panel title="המסמך">
            <div className="rd-hits">
              <Link to={`/company/${doc.company}/filings`}>מסמכי {name(doc.company)}</Link>
              {q && <Link to={`/search?q=${encodeURIComponent(q)}`}>חזרה לתוצאות</Link>}
              <button type="button" className="chip" onClick={() => nav(-1)}>חזרה</button>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
