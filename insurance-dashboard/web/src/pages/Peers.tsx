import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { ContextBar, Sheet } from '../components/Sheet';
import { BreakChip, Empty, ErrorBox, Loading, Seg } from '../components/ui';
import { foxOption } from '../lib/foxchart';
import { identify } from '../lib/idmarks';
import { pubLabel } from '../lib/format';
import { idColor, idCss } from '../lib/identity';
import { useStored } from '../lib/local';
import { mayaReport } from '../lib/sources';
import { usePhone } from '../lib/useMedia';
import { useSource, type Prov } from '../lib/prov';
import { back, F_CHART, F_DER, F_FIXED, F_OLD, F_RE, FREQS, fmtV, plab, pord, UNIT_HE, usePeerRegistry, useBook, warmLts, yearAgo, type Book, type Freq, type MetricDef, type PeerSet, type Registry, type Unit, type Val } from '../lib/registry';
import { cellVal, colLabel, fmtCol, formulaTok, lexOf, parseCol, resolver, ROE_EXPR, ROE_NAME, ROE_OLD_TOK, shownUnit, TEMPLATES, TR_HE, withTr, type Col, type Template, type Tr } from '../lib/seriesCols';
import { ALIASES, autoAlias, codeOf, ExprError, FUNCS, parse, toCode } from '../lib/seriesExpr';
import { fundRoster, monthOf, rosterDiff, rosterText, useRosterFile } from '../lib/roster';
import '../styles/peers.css';
import '../styles/restate.css';

const Deck = lazy(() => import('./IndustrySectors').then((m) => ({ default: m.IndustrySectors })));

type View = 'table' | 'series' | 'deck';
interface St { s: string; e: string[] | null; f: Freq; p: string; n: number; v: View; k: number; c: string[]; o: { c: number; i: number; d: 1 | -1 } | null; h: boolean; pin: number; hl: string; w: number }
interface SavedView { id: string; n: string; q: string }
const KEYS = ['s', 'e', 'f', 'p', 'n', 'v', 'k', 'c', 'o', 'h', 'pin', 'hl', 'w', 't'];
// a series opens on five years (20 quarters): the analyst's "7 insurers × one line × 5 years" in two taps
const DEF = { s: 'ins', f: 'LTM' as Freq, n: 1, v: 'table' as View, w: 20 };
const NOTE: Record<number, string> = { 1: 'נגזר מנתונים מדווחים (Q4 = FY פחות 9M, H מרבעונים, LTM); הנוסחה במקור', 2: 'לפי IFRS 4, כפי שדווח במקור', 3: 'נקרא מגרף או מטקסט בדוח', 4: 'בסיס שונה מרוב החברות בעמודה', 5: 'תג XBRL שתוקן מול הדוח המודפס',
  6: 'הרכב השתנה: החברות שיש להן נתון שונות בין התקופה לשנה שלפניה, ולכן הנתח אינו בר השוואה כמות שהוא', 7: 'כולל קופות חדשות במאגר הרגולטור: חלק מהשינוי הוא קופות שנכנסו לקבוצה, לא כסף שנכנס' };
const SUP = ['', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷'];

function readSt(sp: URLSearchParams): St {
  const f = FREQS.map(([x]) => x).find((x) => x === sp.get('f')) ?? DEF.f;
  const o = /^(\d+)\.(\d+)\.(-?1)$/.exec(sp.get('o') ?? '');
  return {
    s: sp.get('s') ?? DEF.s, e: sp.get('e') ? sp.get('e')!.split(',').filter(Boolean) : null, f, p: sp.get('p') ?? '',
    n: Math.min(12, Math.max(1, Number(sp.get('n')) || DEF.n)), v: (['table', 'series', 'deck'] as View[]).find((x) => x === sp.get('v')) ?? DEF.v,
    k: Number(sp.get('k')) || 0, c: sp.getAll('c').map((t) => (t.replace(/^[a-z]!/, '') === ROE_OLD_TOK ? t.replace(ROE_OLD_TOK, formulaTok(ROE_NAME, 'pct', ROE_EXPR)) : t)), o: o ? { c: +o[1], i: +o[2], d: +o[3] as 1 | -1 } : null, h: sp.get('h') === '1',
    pin: sp.has('pin') ? Number(sp.get('pin')) : -1, hl: sp.get('hl') ?? '', w: Number(sp.get('w')) || DEF.w,
  };
}
function writeSt(prev: URLSearchParams, st: St): URLSearchParams {
  const n = new URLSearchParams(prev);
  KEYS.forEach((k) => n.delete(k));
  if (st.e) n.set('e', st.e.join(',')); else if (st.s !== DEF.s) n.set('s', st.s);
  if (st.f !== DEF.f) n.set('f', st.f);
  if (st.p) n.set('p', st.p);
  if (st.n !== DEF.n) n.set('n', String(st.n));
  if (st.v !== DEF.v) n.set('v', st.v);
  if (st.k) n.set('k', String(st.k));
  st.c.forEach((t) => n.append('c', t));
  if (st.o) n.set('o', `${st.o.c}.${st.o.i}.${st.o.d}`);
  if (st.h) n.set('h', '1');
  if (st.pin >= 0) n.set('pin', String(st.pin));
  if (st.hl) n.set('hl', st.hl);
  if (st.w !== DEF.w) n.set('w', String(st.w));
  return n;
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const typing = (t: EventTarget | null) => { const e = t as HTMLElement | null; return !!e && (e.tagName === 'INPUT' || e.tagName === 'SELECT' || e.tagName === 'TEXTAREA' || e.isContentEditable); };

/** The peer table: any metric of the registry for any peer set, Q / H / FY / LTM, formula columns, templates on 1–7; and the same columns as a series. */
export function Peers() {
  const { data: reg, error } = usePeerRegistry();
  const [sp, setSp] = useSearchParams();
  const st = useMemo(() => readSt(sp), [sp]);
  const set = (patch: Partial<St>) => setSp((prev) => writeSt(prev, { ...readSt(prev), ...patch }), { replace: true });
  // the series opens on quarters, 20 of them (five years): from an LTM table the same tap switches the frequency (job: 7 insurers × a line × 5 years)
  const toView = (v: View, extra: Partial<St> = {}) => set(v === 'series' && st.f === 'LTM' ? { v, f: 'Q', p: '', o: null, ...extra } : { v, ...extra });
  const [mySets, setMySets] = useStored<PeerSet[]>('peers.sets', []);
  const [views, setViews] = useStored<SavedView[]>('peers.views', []);
  const phone = usePhone();
  const [panel, setPanel] = useState<'' | 'add' | 'fx' | 'set' | 'views'>('');
  const [sheet, setSheet] = useState(false);
  const [cards, setCards] = useState(true);

  // a template in the address (?t=, from an old link or a hotkey) or an empty address opens a full view
  const apply = (t: Template, keep: Partial<St> = {}) => set({ c: t.c, s: t.s, e: null, f: t.f, n: 1, o: null, pin: -1, k: 0, p: '', ...keep });
  useEffect(() => {
    const t = sp.get('t');
    if (!sp.getAll('c').length) {
      const tpl = TEMPLATES.find((x) => x.id === t) ?? TEMPLATES[0];
      setSp((prev) => { const cur = readSt(prev); const n = writeSt(prev, { ...cur, c: tpl.c, s: prev.get('s') ?? (prev.get('e') ? cur.s : tpl.s), f: prev.get('f') ? cur.f : tpl.f }); return n; }, { replace: true });
    } else if (t) setSp((prev) => writeSt(prev, readSt(prev)), { replace: true });
  }, [sp, setSp]);

  // hotkeys: 1–7 templates, 8 9 0 the first saved views
  const live = useRef({ apply, views, setSp }); live.current = { apply, views, setSp };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('.sheetwrap')) return;
      const t = TEMPLATES.find((x) => x.key === e.key);
      if (t) { e.preventDefault(); live.current.apply(t); return; }
      const vi = ['8', '9', '0'].indexOf(e.key), v = live.current.views[vi];
      if (v) { e.preventDefault(); live.current.setSp((prev) => { const n = new URLSearchParams(v.q); const s = prev.get('src'); if (s) n.set('src', s); return n; }, { replace: true }); }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  const allSets = useMemo(() => [...(reg?.sets ?? []), ...mySets.map((x) => ({ ...x, own: true }))], [reg, mySets]);
  const ents = useMemo(() => {
    if (!reg) return [] as string[];
    const known = new Set(reg.entities.map((e) => e.id));
    return (st.e ?? allSets.find((x) => x.id === st.s)?.ids ?? reg.sets[0].ids).filter((id) => known.has(id));
  }, [reg, st.e, st.s, allSets]);
  const pre = useMemo(() => st.c.map((t) => parseCol(t, null)), [st.c]);
  const mids = useMemo(() => {
    const out = new Set<string>();
    pre.forEach((c) => { if (c.mid) out.add(c.mid); });
    // formula inputs are known once the registry has arrived
    if (reg) { const auto = new Map(reg.metrics.map((m) => [autoAlias(m.id), m.id])); pre.forEach((c) => c.expr?.replace(/\{([^}]+)\}|[A-Za-z_][A-Za-z0-9_]*/g, (w, br) => { const id = br ? br.trim() : ALIASES[w] ?? auto.get(w); if (id) out.add(id); return w; })); }
    return [...out];
  }, [pre, reg]);
  const { book, pending } = useBook(reg, mids);
  const cols = useMemo(() => (book ? st.c.map((t) => parseCol(t, book)) : []), [book, st.c]);
  useEffect(() => { if (mids.some((m) => m.startsWith('lts:'))) warmLts(ents.map((e) => (e === 'idi' ? 'direct' : e))); }, [mids, ents]);

  if (error) return <ErrorBox what="טבלת העמיתים" error={error} />;
  if (!reg || !book) return <Loading what="טבלת העמיתים" />;

  // the axis: the latest period any column has for the set, then n periods back
  const pend = st.p || cols.reduce<string | null>((best, c) => { const id = c.ids[0]; const l = id ? book.latest(id, st.f, ents) : null; return l && (!best || pord(l) > pord(best)) ? l : best; }, null) || '';
  const periods = pend ? Array.from({ length: st.n }, (_, i) => back(st.f, pend, i)) : [];
  const setName = st.e ? 'קבוצה מותאמת' : allSets.find((x) => x.id === st.s)?.n ?? '';
  const loading = pending > 0;
  const shareQ = () => { const n = writeSt(new URLSearchParams(), st); return n.toString(); };

  const controls = (
    <>
      <div className="pr-row">
        <div className="field"><span>קבוצת עמיתים</span>
          <div className="pr-sets">
            <select aria-label="קבוצת עמיתים" value={st.e ? '' : st.s} onChange={(e) => set({ s: e.target.value, e: null })}>
              {st.e && <option value="">מותאמת ({st.e.length})</option>}
              {allSets.map((x) => <option key={x.id} value={x.id}>{x.n}{x.own ? ' ·' : ''}</option>)}
            </select>
            <button type="button" className={`btn${panel === 'set' ? ' primary' : ''}`} aria-expanded={panel === 'set'} onClick={() => setPanel(panel === 'set' ? '' : 'set')}>עריכה</button>
          </div>
        </div>
        {st.v !== 'deck' && <><div className="field"><span>תדירות</span><Seg<Freq> label="תדירות" value={st.f} onChange={(f) => set({ f, p: '', o: null })} options={FREQS} /></div>
        <label className="field"><span>עד</span>
          <select value={st.p} onChange={(e) => set({ p: e.target.value })}>
            <option value="">האחרון{pend ? ` · ${plab(st.f, pend)}` : ''}</option>
            {pend && Array.from({ length: 24 }, (_, i) => back(st.f, pend, i + 1)).filter((p) => Number(p.slice(0, 4)) >= 2012).map((p) => <option key={p} value={p}>{plab(st.f, p)}</option>)}
          </select>
        </label>
        {st.v === 'table' && <div className="field"><span>תקופות</span><Seg<string> label="תקופות לכל מדד" value={String(st.n)} onChange={(n) => set({ n: Number(n), o: null })} options={[['1', '1'], ['3', '3'], ['5', '5'], ['8', '8']]} /></div>}
        {st.v === 'series' && <div className="field"><span>טווח</span><Seg<string> label="טווח הסדרה" value={String(st.w)} onChange={(w) => set({ w: Number(w) })} options={st.f === 'Q' ? [['8', '2 שנים'], ['12', '3 שנים'], ['20', '5 שנים'], ['40', '10 שנים']] : [['8', '8'], ['12', '12'], ['20', '20'], ['40', '40']]} /></div>}</>}
        <div className="field"><span>תצוגה</span><Seg<View> label="תצוגה" value={st.v} onChange={(v) => toView(v)} options={[['table', 'טבלה'], ['series', 'סדרה'], ['deck', 'מצגת חיסכון']]} /></div>
      </div>
      {st.v !== 'deck' && <div className="pr-row">
        <button type="button" className={`btn${panel === 'add' ? ' primary' : ''}`} aria-expanded={panel === 'add'} onClick={() => setPanel(panel === 'add' ? '' : 'add')}>+ מדד</button>
        <button type="button" className={`btn${panel === 'fx' ? ' primary' : ''}`} aria-expanded={panel === 'fx'} onClick={() => setPanel(panel === 'fx' ? '' : 'fx')}>+ נוסחה</button>
        <button type="button" className={`btn${panel === 'views' ? ' primary' : ''}`} aria-expanded={panel === 'views'} onClick={() => setPanel(panel === 'views' ? '' : 'views')}>תבניות ותצוגות</button>
        <span className="pr-tpl" role="group" aria-label="תבניות">{TEMPLATES.map((t) => <button key={t.id} type="button" className="chip" onClick={() => apply(t)} title={`מקש ${t.key}`}><kbd>{t.key}</kbd>{t.n}</button>)}</span>
        {st.v === 'table' && <button type="button" className="chip" aria-pressed={st.h} onClick={() => set({ h: !st.h })}>מפת חום</button>}
        <span className="pr-sp" />
        <button type="button" className="btn" onClick={() => void exportXlsx(book, cols, ents, st, periods, setName)}>Excel</button>
        <button type="button" className="btn" onClick={() => exportCsv(book, cols, ents, st, periods)}>CSV</button>
      </div>}
    </>
  );
  const panels = (
    <>
      {panel === 'add' && <Picker reg={reg} ents={ents} freq={st.f} p={pend} onAdd={(id) => set({ c: [...st.c, id] })} onClose={() => setPanel('')} />}
      {panel === 'fx' && <FormulaEditor book={book} ents={ents} freq={st.f} p={pend} onAdd={(tok) => { set({ c: [...st.c, tok] }); setPanel(''); setSheet(false); }} />}
      {panel === 'set' && <SetEditor reg={reg} ents={ents} onChange={(ids) => set({ e: ids })} onSave={(n) => { const id = `u${Date.now().toString(36)}`; setMySets([...mySets, { id, n, ids: ents }]); set({ s: id, e: null }); }}
        own={allSets.find((x) => x.id === st.s && x.own) ?? null} onDelete={(id) => { setMySets(mySets.filter((x) => x.id !== id)); set({ s: DEF.s, e: null }); }} />}
      {panel === 'views' && <Views views={views} onOpen={(q) => setSp(() => new URLSearchParams(q), { replace: true })} onApply={apply}
        onSave={(n) => setViews([...views, { id: Date.now().toString(36), n, q: shareQ() }])} onDelete={(id) => setViews(views.filter((v) => v.id !== id))} />}
    </>
  );

  return (
    <div className="pr">
      {phone ? (
        <>
          <ContextBar onOpen={() => setSheet(true)} label="עריכה"><b>{setName}</b> · {pend ? plab(st.f, pend) : st.f} · {cols.length} עמודות</ContextBar>
          {/* table or series without opening the sheet: one tap */}
          {st.v !== 'deck' && <div className="pr-phoneview"><Seg<View> label="תצוגה" value={st.v} onChange={(v) => toView(v)} options={[['table', 'טבלה'], ['series', 'סדרה']]} /></div>}
          <Sheet open={sheet} onClose={() => setSheet(false)} title="טבלת עמיתים">{controls}{panels}
            {st.v !== 'deck' && <div className="pr-collist"><h3>עמודות</h3>{cols.map((c, i) => (
              <div key={i} className="pr-ci"><span>{c.name}</span>
                <select aria-label={`תצוגת ${c.name}`} value={c.tr} onChange={(e) => { const n = [...st.c]; n[i] = withTr(c, e.target.value as Tr); set({ c: n }); }}>{(Object.keys(TR_HE) as Tr[]).map((t) => <option key={t} value={t}>{TR_HE[t]}</option>)}</select>
                <button type="button" className="btn" aria-label={`הסרת ${c.name}`} title={`הסרת ${c.name}`} onClick={() => set({ c: st.c.filter((_, j) => j !== i), o: null, pin: -1, k: 0 })}>×</button>
              </div>))}</div>}
          </Sheet>
        </>
      ) : <section className="controls pr-controls">{controls}</section>}
      {!phone && panels}

      {st.v === 'deck' ? <Suspense fallback={<Loading what="מצגת החיסכון" />}><Deck /></Suspense>
        : !cols.length ? <Empty title="אין עמודות"><button type="button" className="btn" onClick={() => apply(TEMPLATES[0])}>תבנית רווחיות</button></Empty>
        : st.v === 'series' ? <SeriesView book={book} cols={cols} st={st} set={set} ents={ents} pend={pend} loading={loading} />
        : <TableView book={book} cols={cols} st={st} set={set} ents={ents} periods={periods} loading={loading} phone={phone} cards={cards} setCards={setCards} setName={setName} />}
      <div className="src pr-foot">מקורות: {[...new Set(cols.flatMap((c) => c.ids.map((id) => book.byId.get(id)?.src)).filter(Boolean))].map((s) => reg.src[s!]).join(' · ')} · כל מספר נפתח במקור שלו · עדכון {pubLabel(reg.asof)}</div>
    </div>
  );
}

/* ---------- table ---------- */
interface TVProps { book: Book; cols: Col[]; st: St; set: (p: Partial<St>) => void; ents: string[]; periods: string[]; loading: boolean; phone: boolean; cards: boolean; setCards: (v: boolean) => void; setName: string }
function TableView({ book, cols, st, set, ents, periods, loading, phone, cards, setCards, setName }: TVProps) {
  const order = cols.map((_, i) => i);
  if (st.pin >= 0 && st.pin < cols.length) { order.splice(order.indexOf(st.pin), 1); order.unshift(st.pin); }
  const sub = order.flatMap((ci) => periods.map((p, pi) => ({ ci, pi, p, col: cols[ci] })));
  const vals = new Map<string, Val>();
  const V = (ci: number, pi: number, e: string): Val => { const k = `${ci}|${pi}|${e}`; let v = vals.get(k); if (!v) { v = cellVal(book, cols[ci], e, st.f, periods[pi], ents); vals.set(k, v); } return v; };
  // majority basis per column: a figure on another basis carries note 4
  const usual = cols.map((c) => { if (!c.mid) return null; const n = new Map<string, number>(); ents.forEach((e) => { const b = book.meta(c.mid!, e)?.b; if (b) n.set(b, (n.get(b) ?? 0) + 1); }); return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; });
  const sorted = (() => {
    const o = st.o;
    if (!o || o.c >= cols.length || o.i >= periods.length) return ents;
    return [...ents].sort((a, b) => { const x = V(o.c, o.i, a).v, y = V(o.c, o.i, b).v; return x == null ? 1 : y == null ? -1 : (y - x) * o.d; });
  })();
  const press = (ci: number, pi: number) => set({ o: st.o?.c !== ci || st.o.i !== pi ? { c: ci, i: pi, d: 1 } : st.o.d === 1 ? { c: ci, i: pi, d: -1 } : null });
  const used = new Set<number>();
  let anyRe = false;
  // roster (W5-14): a share against a peer set whose members changed from a year earlier; a regulator change that includes fund ids new to the files
  const needFiles = cols.some((c) => c.mid?.startsWith('reg:') && (c.tr === 'y' || c.tr === 'q'));
  const { data: rf } = useRosterFile(needFiles);
  const detail = new Map<string, string>(), rosterLines = new Map<string, string>();
  const shareRoster = new Map<string, ReturnType<typeof rosterDiff>>();
  const shareDiff = (ci: number, pi: number) => {
    const k = `${ci}|${pi}`;
    if (!shareRoster.has(k)) {
      const yb = yearAgo(st.f, periods[pi]);
      shareRoster.set(k, rosterDiff(ents.filter((e) => V(ci, pi, e).v != null), ents.filter((e) => cellVal(book, cols[ci], e, st.f, yb, ents).v != null)));
    }
    return shareRoster.get(k) ?? null;
  };
  const rosterMarks = (ci: number, pi: number, e: string, m: number[]) => {
    const c = cols[ci], p = periods[pi];
    if (c.tr === 's') {
      const d = shareDiff(ci, pi);
      if (d) { m.push(6); const t = `${colLabel(c)} · ${plab(st.f, p)} מול ${plab(st.f, yearAgo(st.f, p))}: ${rosterText(d, book.name)}`; detail.set(`${ci}|${pi}|${e}`, t); rosterLines.set(t, t); }
    } else if (rf && c.mid?.startsWith('reg:') && (c.tr === 'y' || c.tr === 'q')) {
      const w = c.tr === 'y' || st.f === 'FY' ? 12 : st.f === 'H' ? null : 3;
      const g = book.ent.get(e)?.mg;
      const fr = w && g ? fundRoster(rf, g, c.mid.split('@')[1] ?? 'all', monthOf(p), w) : null;
      if (fr) {
        m.push(7);
        const lfl = fr.lfl != null && c.mid.startsWith('reg:assets@') ? ` · בבסיס זהה (אומדן): ${fr.lfl > 0 ? '+' : ''}${fr.lfl.toFixed(1)}%` : '';
        detail.set(`${ci}|${pi}|${e}`, `${book.name(e)}: ${fr.fresh ? 'התחילה לדווח בתקופה' : `${fr.nIn} קופות חדשות, ${fmtV('m', fr.inA)} מיליוני ש"ח ב-${String(fr.m1 % 100).padStart(2, '0')}/${String(fr.m1).slice(2, 4)}`}${fr.names.length ? ` (${fr.names.slice(0, 3).join(', ')}${fr.names.length > 3 ? '…' : ''})` : ''}${lfl}`);
      }
    }
  };
  const marks = (ci: number, e: string, x: Val, pi = 0): number[] => {
    if (x.fl & F_RE) anyRe = true;
    const c = cols[ci], m: number[] = [];
    if (c.tr === 'v' && !c.expr && st.f !== 'LTM' && x.fl & F_DER && book.byId.get(c.mid ?? '')?.src !== 'lts') m.push(1);
    if (x.fl & F_OLD) m.push(2);
    if (x.fl & F_CHART) m.push(3);
    if (c.mid && usual[ci] && book.meta(c.mid, e)?.b && book.meta(c.mid, e)?.b !== usual[ci]) m.push(4);
    if (x.fl & F_FIXED) m.push(5);
    rosterMarks(ci, pi, e, m);
    return m;
  };
  const stats = (ci: number, pi: number) => { const xs = ents.map((e) => [e, V(ci, pi, e)] as [string, Val]).filter(([, x]) => x.v != null); return xs; };
  /** members of a median / average against the same column a year earlier: a change of members moves the aggregate by itself */
  const aggRoster = (ci: number, pi: number, kind: 'med' | 'avg') => {
    if (cols[ci].tr !== 'v') return null;
    const yb = yearAgo(st.f, periods[pi]), now = stats(ci, pi).map(([e]) => e);
    const before = ents.map((e) => [e, cellVal(book, cols[ci], e, st.f, yb, ents)] as [string, Val]).filter(([, x]) => x.v != null);
    const d = rosterDiff(now, before.map(([e]) => e));
    if (!d) return null;
    const f = kind === 'med' ? median : (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const same = new Set(d.same), a = stats(ci, pi).filter(([e]) => same.has(e)).map(([, x]) => x.v!), b = before.filter(([e]) => same.has(e)).map(([, x]) => x.v!);
    const lfl = a.length >= (kind === 'med' ? 3 : 2) ? `על בסיס זהה (${a.length}): ${fmtCol(cols[ci], f(a))} מול ${fmtCol(cols[ci], f(b))}` : 'על בסיס זהה: פחות מדי חברות';
    return `הרכב השתנה מול ${plab(st.f, yb)}: ${rosterText(d, book.name)} · ${lfl}`;
  };
  const statProv = (ci: number, pi: number, kind: 'med' | 'avg', v: number): Prov => {
    const c = cols[ci], xs = stats(ci, pi).sort((a, b) => a[1].v! - b[1].v!);
    return { k: 'calc', title: `${kind === 'med' ? 'חציון' : 'ממוצע'} · ${colLabel(c)} · ${plab(st.f, periods[pi])}`, value: fmtCol(c, v),
      formula: kind === 'med' ? `חציון ${xs.length} החברות בקבוצה שיש להן נתון` : `ממוצע פשוט של ${xs.length} החברות בקבוצה שיש להן נתון`, note: aggRoster(ci, pi, kind) ?? undefined,
      inputs: xs.map(([e, x]) => ({ label: book.name(e), v: fmtCol(c, x.v!), src: x.prov })) };
  };
  const range = new Map<string, [number, number]>();
  if (st.h) sub.forEach(({ ci, pi }) => { const xs = stats(ci, pi).map(([, x]) => x.v!); if (xs.length > 1) range.set(`${ci}|${pi}`, [Math.min(...xs), Math.max(...xs)]); });
  // the first period on IFRS 17 after IFRS 4 figures, per column: the standard-break band
  const brkAt = new Set<string>();
  order.forEach((ci) => periods.forEach((_, pi) => { if (pi + 1 < periods.length && ents.some((e) => !(V(ci, pi, e).fl & F_OLD) && V(ci, pi, e).v != null) && ents.some((e) => V(ci, pi + 1, e).fl & F_OLD)) brkAt.add(`${ci}|${pi}`); }));
  const regBreak = (c: Col): string | null => {
    for (const id of c.ids) { const m = book.byId.get(id); const b = m?.br?.find((x) => periods.some((p) => { const lo = c.tr === 'y' ? pord(back(st.f, p, st.f === 'FY' ? 1 : st.f === 'H' ? 2 : 4)) : pord(back(st.f, p, 1)); return pord(x.p) > lo - 0.5 && pord(x.p) <= pord(p) + 0.9; })); if (b) return `${b.m}`; }
    return null;
  };
  // coverage: the companies of the set with no figure in any period shown, and why (the first reason)
  const cover = (ci: number) => !periods.length ? [] : ents.filter((e) => periods.every((_, pi) => V(ci, pi, e).v == null)).map((e) => ({ e, why: V(ci, 0, e).why }));
  const head = (ci: number) => <ColHead key={ci} book={book} col={cols[ci]} ci={ci} n={cols.length} st={st} set={set} span={periods.length} brk={regBreak(cols[ci])} pinned={st.pin === ci} miss={cover(ci)} total={ents.length} />;

  if (phone && cards && periods.length === 1) {
    return (
      <>
        <div className="pr-cardbar"><Seg<string> label="פריסה" value="cards" onChange={() => setCards(false)} options={[['cards', 'כרטיסים'], ['table', 'טבלה']]} />
          <label className="field"><span>מיון</span><select value={st.o ? String(st.o.c) : ''} onChange={(e) => set({ o: e.target.value === '' ? null : { c: Number(e.target.value), i: 0, d: 1 } })}><option value="">לפי הקבוצה</option>{cols.map((c, i) => <option key={i} value={i}>{colLabel(c)}</option>)}</select></label></div>
        <div className="pr-cards">{sorted.map((e, ri) => (
          <section key={e} className={`panel pr-card${st.hl === e ? ' lead' : ''}`}>
            <h3><i className="pdot" style={{ background: idCss(e) }} />{st.o && <span className="rk num">{ri + 1}</span>}<Link to={`/company/${e}`}>{book.name(e)}</Link></h3>
            <dl>{order.map((ci) => { const x = V(ci, 0, e); return <div key={ci}><dt>{colLabel(cols[ci])}</dt><dd>{x.v == null ? <span className="muted" title={x.why}>–</span> : <Sourced className={`num${x.v < 0 ? ' neg' : ''}${x.fl & F_RE ? ' re' : ''}`} href={cols[ci].tr === 'v' ? x.href : null} src={x.prov}>{fmtCol(cols[ci], x.v)}</Sourced>}</dd></div>; })}</dl>
          </section>
        ))}</div>
        <div className="src">{periods[0] ? plab(st.f, periods[0]) : ''} · {setName}</div>
      </>
    );
  }
  return (
    <section className="panel pr-panel">
      <div className="hd"><h2>טבלת עמיתים</h2><div className="aside">
        {phone && periods.length === 1 && <Seg<string> label="פריסה" value="table" onChange={() => setCards(true)} options={[['cards', 'כרטיסים'], ['table', 'טבלה']]} />}
        <span>{setName} · {periods[0] ? plab(st.f, periods[0]) : st.f}{st.f === 'LTM' ? ' (סכום ארבעה רבעונים, מחושב)' : ''}{loading ? ' · טוען…' : ''} · לחיצה על כותרת ממיינת</span></div></div>
      <div className="scroll pr-scroll"><table className="matrix pr-table">
        <thead>
          <tr><th rowSpan={periods.length > 1 ? 2 : 1} className="pr-ent">חברה</th>{order.map(head)}</tr>
          {periods.length > 1 && <tr>{sub.map(({ ci, pi, p }) => <th key={`${ci}|${pi}`} className={`pr-per${brkAt.has(`${ci}|${pi}`) ? ' brk' : ''}${pi === 0 ? ' g0' : ''}`} aria-sort={st.o?.c === ci && st.o.i === pi ? (st.o.d === 1 ? 'descending' : 'ascending') : 'none'}><button type="button" className="thsort" onClick={() => press(ci, pi)}>{plab(st.f, p).replace('LTM ', '')}<i>{st.o?.c === ci && st.o.i === pi ? (st.o.d === 1 ? '▼' : '▲') : ''}</i></button></th>)}</tr>}
        </thead>
        <tbody>{sorted.map((e, ri) => (
          <tr key={e} className={st.hl === e ? 'lead' : undefined}>
            <td className="pr-ent"><i className="pdot" style={{ background: idCss(e) }} />{st.o && <span className="rk num">{ri + 1}</span>}<Link to={`/company/${e}`}>{book.short(e)}</Link></td>
            {sub.map(({ ci, pi }) => {
              const x = V(ci, pi, e), c = cols[ci], cls = `${pi === 0 ? 'g0' : ''}${brkAt.has(`${ci}|${pi}`) ? ' brk' : ''}${st.pin === ci ? ' pin' : ''}`;
              if (x.v == null) return <td key={`${ci}|${pi}`} className={cls}><span className="muted" title={x.why}>–</span></td>;
              const ms = marks(ci, e, x, pi); ms.forEach((m) => used.add(m));
              const rg = range.get(`${ci}|${pi}`), heat = rg && rg[1] > rg[0] ? (x.v - rg[0]) / (rg[1] - rg[0]) : null;
              const tone = c.tr !== 'v' ? (x.v > 0 ? ' pos' : x.v < 0 ? ' neg' : '') : x.v < 0 ? ' neg' : '';
              return (
                <td key={`${ci}|${pi}`} className={`${cls}${heat != null ? ' heat' : ''}`} style={heat != null ? { ['--h' as string]: `${Math.round(4 + heat * 24)}%` } : undefined}>
                  <Sourced className={`num${tone}${x.fl & F_OLD ? ' old' : ''}${x.fl & F_RE ? ' re' : ''}`} href={c.tr === 'v' ? x.href : null} src={x.prov}>{fmtCol(c, x.v)}</Sourced>
                  {ms.length > 0 && <sup title={[...ms.map((m) => NOTE[m]), detail.get(`${ci}|${pi}|${e}`)].filter(Boolean).join(' · ')}>{ms.map((m) => SUP[m]).join('')}</sup>}
                </td>
              );
            })}
          </tr>
        ))}</tbody>
        <tfoot>
          {(['med', 'avg'] as const).map((kind) => {
            // one note per row: the row label says the set of companies changed somewhere; each affected cell carries a dagger with the detail
            const anyRo = sub.some(({ ci, pi }) => stats(ci, pi).length >= (kind === 'med' ? 3 : 2) && aggRoster(ci, pi, kind));
            return (
            <tr key={kind}><td className="pr-ent">{kind === 'med' ? 'חציון' : 'ממוצע'}{anyRo && <span className="chip est pr-roster" title="בעמודות המסומנות † החברות שיש להן נתון שונות מאשר שנה קודם; ריחוף על † מציג מי נכנס, מי יצא, והערך על בסיס זהה">הרכב השתנה †</span>}</td>{sub.map(({ ci, pi }) => {
              const xs = stats(ci, pi).map(([, x]) => x.v!);
              if (xs.length < (kind === 'med' ? 3 : 2)) return <td key={`${ci}|${pi}`} className={pi === 0 ? 'g0' : ''}><span className="muted">–</span></td>;
              const v = kind === 'med' ? median(xs) : xs.reduce((s, x) => s + x, 0) / xs.length;
              const ro = aggRoster(ci, pi, kind);
              return <td key={`${ci}|${pi}`} className={pi === 0 ? 'g0' : ''}><Sourced src={() => statProv(ci, pi, kind, v)}><span className="num">{fmtCol(cols[ci], v)}</span></Sourced>{ro && <sup className="pr-dag" title={ro} aria-label={ro}>†</sup>}</td>;
            })}</tr>
            );
          })}
        </tfoot>
      </table></div>
      {(used.size > 0 || brkAt.size > 0 || anyRe) && <ol className="fnotes">{[...used].sort().map((m) => <li key={m}><sup>{SUP[m]}</sup> {NOTE[m]}{m === 6 && rosterLines.size > 0 && <> · {[...rosterLines.keys()].slice(0, 4).join(' · ')}</>}</li>)}{brkAt.size > 0 && <li><span className="pr-brk" /> מעבר ל-IFRS 17: משמאל לקו המספרים כפי שדווחו לפי IFRS 4</li>}{anyRe && <li><span className="num re" /> הוצג מחדש</li>}</ol>}
    </section>
  );
}

function ColHead({ book, col, ci, n, st, set, span, brk, pinned, miss, total }: { book: Book; col: Col; ci: number; n: number; st: St; set: (p: Partial<St>) => void; span: number; brk: string | null; pinned: boolean; miss: { e: string; why?: string }[]; total: number }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // the menu floats above the table (fixed), so the table's scroll box never clips it
  const place = () => { const d = ref.current; if (!d?.open) { setPos(null); return; } const r = d.querySelector('summary')!.getBoundingClientRect(); setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(innerWidth - 308, r.right - 300)) }); };
  useEffect(() => { if (!pos) return; const off = (e: Event) => { if (ref.current?.contains(e.target as Node)) return; ref.current?.removeAttribute('open'); setPos(null); }; addEventListener('scroll', off, true); addEventListener('pointerdown', off); return () => { removeEventListener('scroll', off, true); removeEventListener('pointerdown', off); }; }, [pos]);
  const def = col.mid ? book.byId.get(col.mid) : undefined;
  const close = () => ref.current?.removeAttribute('open');
  const move = (d: number) => { const c = [...st.c], j = ci + d; if (j < 0 || j >= n) return; [c[ci], c[j]] = [c[j], c[ci]]; set({ c, o: null, pin: st.pin === ci ? j : st.pin === j ? ci : st.pin }); };
  const remove = () => set({ c: st.c.filter((_, i) => i !== ci), o: null, pin: st.pin === ci ? -1 : st.pin > ci ? st.pin - 1 : st.pin, k: 0 });
  const label = (
    <span className="pr-hl">
      <b>{col.name}</b>
      <span className="pr-hu">{col.tr !== 'v' && <em>{TR_HE[col.tr]} · </em>}{shownUnit(col)}{col.expr ? ' · ƒ נוסחה' : def ? ` · ${book.reg.src[def.src] ?? def.src}${def.src === 'lts' ? ', מחושב' : ''}` : ''}{brk && <span className="pr-bc"><BreakChip b={{ label: brk, note: 'שבר בהגדרת הסדרה אצל הרגולטור בטווח שבטבלה' }} /></span>}</span>
    </span>
  );
  const sortable = span === 1;
  return (
    <th colSpan={span} className={`pr-col${pinned ? ' pin' : ''}`} aria-sort={sortable && st.o?.c === ci ? (st.o.d === 1 ? 'descending' : 'ascending') : undefined}>
      <div className="pr-colin">
        {sortable ? <button type="button" className="thsort" onClick={() => set({ o: st.o?.c !== ci ? { c: ci, i: 0, d: 1 } : st.o.d === 1 ? { c: ci, i: 0, d: -1 } : null })}>{label}<i>{st.o?.c === ci ? (st.o.d === 1 ? '▼' : '▲') : ''}</i></button> : label}
        {miss.length > 0 && <Coverage book={book} name={col.name} miss={miss} total={total} />}
        <details ref={ref} className="pr-menu" onToggle={place}>
          <summary aria-label={`פעולות לעמודה ${col.name}`} title={`פעולות לעמודה: ${col.name}`}>⋯</summary>
          <div className="pr-pop" role="menu" style={pos ? { position: 'fixed', top: pos.top, left: pos.left, right: 'auto', width: 300 } : undefined}>
            {col.err && <p className="err">{col.err}</p>}
            {col.expr && <p><bdi>{col.he ?? col.expr}</bdi>{col.he && col.he !== col.expr && <span className="mono muted" dir="ltr"> · {col.expr}</span>}</p>}
            {def?.nt != null && <p className="muted">{book.reg.notes[def.nt]}</p>}
            <div className="pr-trs">{(['v', 'y', 'q', 's', 'c'] as Tr[]).map((t) => <button key={t} type="button" className="chip" aria-pressed={col.tr === t} onClick={() => { const c = [...st.c]; c[ci] = withTr(col, t); set({ c }); close(); }}>{TR_HE[t]}</button>)}</div>
            <button type="button" onClick={() => { set({ v: 'series', k: ci, ...(st.f === 'LTM' ? { f: 'Q' as Freq, p: '', o: null } : {}) }); close(); }}>סדרה לאורך זמן</button>
            <button type="button" onClick={() => { set({ pin: pinned ? -1 : ci }); close(); }}>{pinned ? 'ביטול הצמדה' : 'הצמדה לצד שם החברה'}</button>
            <button type="button" onClick={() => { move(-1); close(); }} disabled={ci === 0}>הזזה ימינה</button>
            <button type="button" onClick={() => { move(1); close(); }} disabled={ci === n - 1}>הזזה שמאלה</button>
            <button type="button" className="danger" onClick={() => { remove(); close(); }}>הסרה</button>
          </div>
        </details>
      </div>
    </th>
  );
}

/** "5/7" on a column head when companies of the set have no figure; hover, tap or Enter lists them with the reason */
function Coverage({ book, name, miss, total }: { book: Book; name: string; miss: { e: string; why?: string }[]; total: number }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const place = () => { const d = ref.current; if (!d?.open) { setPos(null); return; } const r = d.querySelector('summary')!.getBoundingClientRect(); setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(innerWidth - 268, r.right - 260)) }); };
  useEffect(() => { if (!pos) return; const off = (e: Event) => { if (ref.current?.contains(e.target as Node)) return; ref.current?.removeAttribute('open'); setPos(null); }; addEventListener('scroll', off, true); addEventListener('pointerdown', off); return () => { removeEventListener('scroll', off, true); removeEventListener('pointerdown', off); }; }, [pos]);
  const names = miss.map((m) => book.short(m.e));
  const has = total - miss.length;
  return (
    <details ref={ref} className="pr-cov" onToggle={place}>
      <summary className="num" aria-label={`${name}: יש נתון ל-${has} מתוך ${total} חברות. חסרות: ${names.join(', ')}`} title={`חסר נתון: ${names.join(', ')}`}>{has}/{total}</summary>
      <div className="pr-pop pr-covpop" role="note" style={pos ? { position: 'fixed', top: pos.top, left: pos.left, right: 'auto', width: 260 } : undefined}>
        <p><b>חסר נתון ל-{miss.length} מתוך {total}</b></p>
        <ul>{miss.map((m) => <li key={m.e}><i className="pdot" style={{ background: idCss(m.e) }} />{book.short(m.e)}{m.why && <span className="muted"> · {m.why}</span>}</li>)}</ul>
      </div>
    </details>
  );
}

/* ---------- series: one column × companies × time ---------- */
function SeriesView({ book, cols, st, set, ents, pend, loading }: { book: Book; cols: Col[]; st: St; set: (p: Partial<St>) => void; ents: string[]; pend: string; loading: boolean }) {
  const k = Math.min(st.k, cols.length - 1), col = cols[k];
  const ps = pend ? Array.from({ length: st.w }, (_, i) => back(st.f, pend, st.w - 1 - i)) : [];
  const grid = ents.map((e) => ps.map((p) => cellVal(book, col, e, st.f, p, ents)));
  const has = ps.map((_, i) => grid.some((r) => r[i].v != null));
  const lo = has.indexOf(true), shown = lo < 0 ? [] : ps.slice(lo), g = grid.map((r) => r.slice(lo));
  // break band: IFRS 4 figures before IFRS 17 ones, or a regulator definition change
  let brkAt = -1, brkLabel = '';
  const oldAt = shown.map((_, i) => g.some((r) => r[i].v != null && r[i].fl & F_OLD)), newAt = shown.map((_, i) => g.some((r) => r[i].v != null && !(r[i].fl & F_OLD)));
  const firstNew = newAt.findIndex((x, i) => x && oldAt.slice(0, i).some(Boolean));
  if (firstNew > 0) { brkAt = firstNew; brkLabel = 'IFRS 17'; }
  else for (const id of col.ids) { const b = book.byId.get(id)?.br?.find((x) => shown.some((p) => pord(p) >= pord(x.p))); if (b) { const i = shown.findIndex((p) => pord(p) + 0.9 >= pord(b.p)); if (i > 0) { brkAt = i; brkLabel = `שבר · ${b.m}`; } break; } }
  const pct = col.tr !== 'v' || col.unit === 'pct';
  const { open } = useSource();
  return (
    <>
      <section className="panel">
        <div className="hd"><h2>{colLabel(col)}</h2><div className="aside">
          {cols.length > 1 && <select aria-label="עמודה בסדרה" value={k} onChange={(e) => set({ k: Number(e.target.value) })}>{cols.map((c, i) => <option key={i} value={i}>{colLabel(c)}</option>)}</select>}
          <span>{shownUnit(col)} · {st.f === 'LTM' ? 'LTM, סכום ארבעה רבעונים' : st.f}{loading ? ' · טוען…' : ''}</span></div></div>
        <div className="pr-legend" role="group" aria-label="מיקוד בחברה">{ents.map((e) => <button key={e} type="button" className="chip" aria-pressed={st.hl === e} onClick={() => set({ hl: st.hl === e ? '' : e })}><i className="sw" style={{ background: idCss(e) }} />{book.short(e)}</button>)}</div>
        {shown.length < 2 ? <Empty title="אין רצף לעמודה ולתדירות שנבחרו" /> : (
          <Chart label={`${colLabel(col)} · ${st.f}`} height={380} deps={[st.c.join('|'), k, st.f, st.w, pend, ents.join(), st.hl, book.files.size]}
            source={`${[...new Set(col.ids.map((id) => book.reg.src[book.byId.get(id)?.src ?? '']).filter(Boolean))].join(' · ')} · fox`}
            onPoint={(si, di) => { const x = g[si]?.[di]; if (x && x.v != null) open(x.prov()); }}
            build={() => identify(foxOption({ x: shown.map((p) => plab(st.f, p).replace('LTM ', '')), unit: shownUnit(col), legend: false, labels: false, scale: true, breakAt: brkAt > 0 ? brkAt : undefined, breakLabel: brkLabel,
              series: ents.map((e, i) => ({ name: book.short(e), kind: 'line' as const, color: idColor(e), pct, lead: st.hl === e, dim: !!st.hl && st.hl !== e, dec: col.unit === 'm' && col.tr === 'v' ? 0 : 2,
                faded: g[i].map((x) => !!(x.fl & F_OLD)), data: g[i].map((x) => (x.v == null ? null : +x.v.toFixed(4))) })) }), { height: 380 })} />
        )}
      </section>
      <section className="panel pr-panel">
        <div className="hd"><h2>טבלה</h2><div className="aside"><span>{shownUnit(col)} · כל מספר מקושר למקור</span></div></div>
        <div className="scroll pr-scroll"><table className="pr-table pr-series">
          <thead><tr><th className="pr-ent">חברה</th>{[...shown].reverse().map((p, j) => <th key={p} className={brkAt > 0 && shown.length - 1 - j === brkAt ? 'brk' : undefined}>{plab(st.f, p).replace('LTM ', '')}</th>)}</tr></thead>
          <tbody>{ents.map((e, i) => (
            <tr key={e} className={st.hl === e ? 'lead' : undefined}>
              <td className="pr-ent"><i className="pdot" style={{ background: idCss(e) }} /><Link to={`/company/${e}`}>{book.short(e)}</Link></td>
              {[...g[i]].reverse().map((x, j) => {
                const idx = shown.length - 1 - j, cls = brkAt > 0 && idx === brkAt ? 'brk' : undefined;
                return <td key={j} className={cls}>{x.v == null ? <span className="muted" title={x.why}>–</span> : <Sourced className={`num${x.v < 0 ? ' neg' : ''}${x.fl & F_OLD ? ' old' : ''}${x.fl & F_RE ? ' re' : ''}${col.tr === 'v' && !col.expr && st.f !== 'LTM' && x.fl & F_DER ? ' der' : ''}`} href={col.tr === 'v' ? x.href : null} src={x.prov}>{fmtCol(col, x.v)}</Sourced>}</td>;
              })}
            </tr>
          ))}</tbody>
        </table></div>
        <div className="src">אפור: לפי IFRS 4 כפי שדווח. נטוי: נגזר (Q4 מהשנתי, H מרבעונים, LTM). נקודה: הוצג מחדש.{brkAt > 0 ? ' הקו בגרף ובטבלה מסמן את שבר ההגדרה.' : ''}</div>
      </section>
    </>
  );
}

/* ---------- metric picker ---------- */
function Picker({ reg, ents, freq, p, onAdd, onClose }: { reg: Registry; ents: string[]; freq: Freq; p: string; onAdd: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [g, setG] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const idx = new Map(reg.entities.map((e, i) => [e.id, i]));
  const mine = new Set(ents.map((e) => idx.get(e)));
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = reg.metrics.filter((m) => (!g || m.g === g) && words.every((w) => `${m.l} ${m.id} ${reg.src[m.src]}`.toLowerCase().includes(w)));
  const any = (m: MetricDef) => m.e.filter((i) => mine.has(i)).length;
  // coverage at the table's frequency and period (the figure a new column would show), read from the metric files of the rows on screen
  const [more, setMore] = useState(60);
  const shown = list.slice(0, more);
  const { book: cb } = useBook(reg, useMemo(() => shown.filter((m) => any(m) > 0).map((m) => m.id), [shown.map((m) => m.id).join('|')]));  // eslint-disable-line react-hooks/exhaustive-deps
  const cover = (m: MetricDef): number | null => (!any(m) ? 0 : !cb || !p || !cb.files.has(m.f) ? null : ents.filter((e) => cellVal(cb, parseCol(m.id, cb), e, freq, p, ents).v != null).length);
  return (
    <section className="panel pr-picker" aria-label="הוספת מדד">
      <div className="pr-row">
        <input type="search" placeholder="חיפוש מדד: CSM, דמי ניהול, ניוד, רכב חובה…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="חיפוש מדד" />
        <button type="button" className="btn" onClick={onClose}>סגירה</button>
      </div>
      <div className="pr-groups" role="group" aria-label="נושא"><button type="button" className="chip" aria-pressed={!g} onClick={() => setG('')}>הכול</button>{reg.groups.map(([k, n]) => <button key={k} type="button" className="chip" aria-pressed={g === k} onClick={() => setG(k)}>{n}</button>)}</div>
      <div className="src pr-pk-at">כיסוי: חברות עם נתון ב-<span className="num">{p ? plab(freq, p) : freq}</span></div>
      <ul className="pr-list">{shown.map((m) => { const n = cover(m), a = any(m); return (
        <li key={m.id}><button type="button" disabled={a === 0} onClick={() => { onAdd(m.id); setAdded([...added, m.id]); }} aria-pressed={added.includes(m.id)}
          title={n === 0 && a > 0 ? `אין נתון ב-${p ? plab(freq, p) : freq}; יש נתון בתקופות אחרות (${a}/${ents.length})` : undefined}>
          <span className="l">{m.l}</span><span className="m">{reg.src[m.src]} · {UNIT_HE[m.u]} · {m.k === 'f' ? 'מצטבר' : m.k === 's' ? 'נקודתי' : 'יחס'} · {pl(m.r[0])}–{pl(m.r[1])}</span><span className={`c num${n == null || n < ents.length ? ' part' : ''}`}>{n == null ? '…' : `${n}/${ents.length}`}</span>
        </button></li>); })}</ul>
      {list.length > more && <button type="button" className="btn pr-more" onClick={() => setMore(more + 60)}>עוד <span className="num">{Math.min(60, list.length - more)}</span> מתוך <span className="num">{list.length - more}</span></button>}
    </section>
  );
}
const pl = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);

/* ---------- formula editor ---------- */
/** ready formulas, one tap each: the ratios analysts build first. Codes resolve through the registry; the Hebrew form is what the column shows. */
const PRESETS: { n: string; u: Unit; e: string; d: string }[] = [
  { n: ROE_NAME, u: 'pct', e: ROE_EXPR, d: 'רווח נקי בקצב שנתי (רבעון × 4, חצי שנה × 2) ÷ הון ממוצע (פתיחה וסגירה)' },
  { n: 'CSM להון', u: 'x', e: 'csm / eq', d: 'יתרת CSM ÷ הון לבעלי המניות' },
  { n: 'דמי ניהול לנכסים', u: 'pct', e: 'ann(fee) / avg(aum, yago(aum)) * 100', d: 'דמי ניהול בקצב שנתי ÷ נכסים מנוהלים ממוצעים' },
  { n: 'יחס הוצאות ביטוח', u: 'pct', e: 'abs(fs_ins_exp) / fs_ins_rev * 100', d: 'הוצאות שירותי ביטוח ÷ הכנסות שירותי ביטוח' },
  { n: 'רווח לכל מיליארד נכסים', u: 'm', e: 'ann(np) / ta * 1000', d: 'רווח נקי בקצב שנתי, מיליוני ש"ח, לכל מיליארד ש"ח נכסים' },
  { n: 'עסק חדש ÷ שחרור CSM', u: 'x', e: 'nb / abs(rel)', d: 'CSM מעסק חדש ÷ CSM ששוחרר לרווח' },
  { n: 'מרווח שירותי ביטוח', u: 'pct', e: 'isr / rev * 100', d: 'תוצאות שירותי ביטוח ÷ הכנסות שירותי ביטוח' },
  { n: 'נכסים להון', u: 'x', e: 'ta / eq', d: 'סך נכסים ÷ הון לבעלי המניות' },
];
const OPCH = /[+\-*/^(),{×÷−]/;
/** the word being typed: from the last operator before the caret to the caret */
function fragment(s: string, caret: number): [number, string] {
  let k = caret;
  while (k > 0 && !OPCH.test(s[k - 1])) k--;
  while (k < caret && /\s/.test(s[k])) k++;
  return [k, s.slice(k, caret)];
}
const foldTxt = (t: string) => t.toLowerCase().replace(/[׳’`]/g, "'").replace(/[״”“]/g, '"');
interface Opt { key: string; label: string; meta: string; insert: string; cover?: string; part?: boolean }

function FormulaEditor({ book, ents, freq, p, onAdd }: { book: Book; ents: string[]; freq: Freq; p: string; onAdd: (tok: string) => void }) {
  const [name, setName] = useState('');
  const [expr, setExpr] = useState('');
  const [unit, setUnit] = useState<Unit>('pct');
  const [caret, setCaret] = useState(0);
  const [hl, setHl] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const known = useMemo(() => resolver(book), [book]);
  const lex = useMemo(() => lexOf(book), [book]);
  const idx = useMemo(() => new Map(book.reg.entities.map((e, i) => [e.id, i])), [book]);
  const mine = useMemo(() => new Set(ents.map((e) => idx.get(e))), [ents, idx]);
  let err: ExprError | null = null, tree = null as ReturnType<typeof parse> | null;
  if (expr.trim()) { try { tree = parse(expr, known, lex); } catch (e) { err = e instanceof ExprError ? e : new ExprError('שגיאה'); } }
  // the combobox: metrics by Hebrew label (every word typed), by code, and the functions
  const [fStart, frag] = fragment(expr, caret);
  const opts: Opt[] = useMemo(() => {
    const q = foldTxt(frag.trim());
    if (!q) return [];
    const words = q.split(/\s+/);
    const ms = book.reg.metrics.map((m) => {
      const label = lex.labelOf.get(m.id) ?? m.l, hay = foldTxt(`${label} ${codeOf(m.id)} ${m.id}`);
      if (!words.every((w) => hay.includes(w))) return null;
      const n = m.e.filter((i) => mine.has(i)).length;
      const score = (foldTxt(label).startsWith(q) || codeOf(m.id).startsWith(q) ? 2 : 0) + n / Math.max(1, ents.length);
      return { o: { key: m.id, label, meta: `${book.reg.src[m.src]} · ${UNIT_HE[m.u]} · ${codeOf(m.id)}`, insert: label, cover: `${n}/${ents.length}`, part: n < ents.length }, score, n };
    }).filter((x): x is NonNullable<typeof x> => !!x && x.n > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.o);
    const fs = (Object.keys(FUNCS) as (keyof typeof FUNCS)[]).filter((f) => f.startsWith(q)).map((f) => ({ key: `fn:${f}`, label: `${f}( )`, meta: FUNCS[f], insert: `${f}(` }));
    return [...fs, ...ms];
  }, [frag, book, lex, mine, ents.length]);
  const show = listOpen && opts.length > 0;
  const choose = (o: Opt) => {
    const after = expr.slice(caret), pad = o.insert.endsWith('(') ? '' : ' ';
    const next = expr.slice(0, fStart) + o.insert + pad + after.replace(/^\s+/, '');
    const at = fStart + o.insert.length + pad.length;
    setExpr(next); setCaret(at); setHl(0); setListOpen(false);
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(at, at); } });
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (show && e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => (h + 1) % opts.length); }
    else if (show && e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => (h - 1 + opts.length) % opts.length); }
    else if (show && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); choose(opts[Math.min(hl, opts.length - 1)]); }
    else if (e.key === 'Escape' && show) { e.preventDefault(); setListOpen(false); }
    else if (e.key === 'Enter' && tree && !err) { e.preventDefault(); add(); }
    else if (e.key === 'ArrowDown') { setListOpen(true); }
  };
  const sync = (el: HTMLInputElement) => setCaret(el.selectionStart ?? el.value.length);
  const tok = tree ? formulaTok(name.trim() || 'נוסחה', unit, toCode(tree)) : null;
  const add = () => { if (tok) onAdd(tok); };
  const col: Col | null = tok ? parseCol(tok, book) : null;
  const { book: full } = useBook(book.reg, col?.ids ?? []);
  const prevCol = col && full ? parseCol(col.tok, full) : null;
  const errId = 'pr-fx-err', listId = 'pr-fx-list';
  const preset = (x: (typeof PRESETS)[number]) => onAdd(formulaTok(x.n, x.u, x.e));
  // each ready formula with how many companies of the set it covers at the table's period (a ratio of half-yearly figures is empty on LTM)
  const pcols = useMemo(() => PRESETS.map((x) => parseCol(formulaTok(x.n, x.u, x.e), book)), [book]);
  const { book: pbook } = useBook(book.reg, useMemo(() => [...new Set(pcols.flatMap((c) => c.ids))], [pcols]));
  const pcover = (i: number) => (pbook && p ? ents.filter((e) => cellVal(pbook, parseCol(pcols[i].tok, pbook), e, freq, p, ents).v != null).length : null);
  // an unknown word: the labels that hold all its words
  const near = err && /^מדד לא מוכר/.test(err.message) && err.pos >= 0 ? (() => {
    const words = foldTxt(expr.slice(err.pos, err.pos + err.len)).split(/\s+/).filter(Boolean);
    return book.reg.metrics.map((m) => lex.labelOf.get(m.id) ?? m.l).filter((l) => words.every((w) => foldTxt(l).includes(w))).sort((a, b) => a.length - b.length).slice(0, 4);
  })() : [];
  const fix = (l: string) => { if (!err) return; const next = expr.slice(0, err.pos) + l + expr.slice(err.pos + err.len); setExpr(next); setCaret(err.pos + l.length); };
  return (
    <section className="panel pr-fx" aria-label="עמודת נוסחה">
      <div className="pr-presets" role="group" aria-label="נוסחאות מוכנות"><span className="muted">מוכנות:</span>
        {PRESETS.map((x, i) => { const c = pcols[i], n = pcover(i); return <button key={x.n} type="button" className={`chip${n === 0 ? ' dim' : ''}`} disabled={!!c.err} title={`${x.d}\n${c.he ?? x.e}${n === 0 ? `\nאין נתון ב-${freq} ${p ? plab(freq, p) : ''}: נסו תדירות אחרת` : ''}`} onClick={() => preset(x)}>{x.n}{n != null && n < ents.length && <span className="num pr-pn">{n}/{ents.length}</span>}</button>; })}
      </div>
      <div className="pr-row">
        <label className="field"><span>שם העמודה</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="מרווח שירותי ביטוח" /></label>
        <div className="field pr-grow pr-combo"><label htmlFor="pr-fx-in">נוסחה</label>
          <input ref={input} id="pr-fx-in" type="text" dir="auto" value={expr} spellCheck={false} autoComplete="off" enterKeyHint="done"
            placeholder="תוצאות שירותי ביטוח / הכנסות משירותי ביטוח * 100"
            role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={show ? `${listId}-${hl}` : undefined}
            aria-invalid={!!err} aria-describedby={err ? errId : undefined}
            onChange={(e) => { setExpr(e.target.value); sync(e.target); setHl(0); setListOpen(true); }} onKeyDown={onKey}
            onKeyUp={(e) => sync(e.currentTarget)} onClick={(e) => { sync(e.currentTarget); setListOpen(true); }} onBlur={() => setTimeout(() => setListOpen(false), 150)} />
          {show && <ul className="pr-opts" role="listbox" id={listId} aria-label="מדדים ופונקציות">
            {opts.map((o, i) => <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === hl} className={i === hl ? 'on' : undefined}
              onPointerDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setHl(i)}>
              <span className="l">{o.label}</span><span className="m">{o.meta}</span>{o.cover && <span className={`c num${o.part ? ' part' : ''}`} title="חברות בקבוצה שיש להן נתון">{o.cover}</span>}
            </li>)}
          </ul>}
        </div>
        <label className="field"><span>יחידה</span><select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>{(Object.keys(UNIT_HE) as Unit[]).map((u) => <option key={u} value={u}>{UNIT_HE[u]}</option>)}</select></label>
        <button type="button" className="btn primary" disabled={!tree || !!err} onClick={add}>הוספה</button>
      </div>
      {err && !(show && err.pos >= fStart) ? (
        <div className="pr-fxerr" id={errId} role="alert"><p className="err">{err.message}{near.length > 0 && <span className="pr-near"> · אולי: {near.map((l) => <button key={l} type="button" className="chip" onClick={() => fix(l)}>{l}</button>)}</span>}</p>
          {err.pos >= 0 && <code dir="auto"><span>{expr.slice(0, err.pos)}</span><mark>{expr.slice(err.pos, err.pos + Math.max(1, err.len)) || ' '}</mark><span>{expr.slice(err.pos + Math.max(1, err.len))}</span></code>}
        </div>
      ) : !err && col && (
        <div className="pr-fxok">
          <span className="muted">נקרא כ:</span> <bdi>{col.he}</bdi>
          {prevCol && p && full && <div className="pr-prev">{ents.slice(0, 8).map((e) => { const x = cellVal(full, prevCol, e, freq, p, ents); return <span key={e}><i className="pdot" style={{ background: idCss(e) }} />{full.short(e)} <b className="num">{x.v == null ? '–' : fmtV(unit, x.v)}</b></span>; })}<span className="muted">{plab(freq, p)}</span></div>}
        </div>
      )}
      <details className="pr-help"><summary>מדדים נפוצים ופונקציות</summary>
        <div className="pr-alias">{Object.entries(ALIASES).filter(([, id]) => book.byId.has(id)).map(([a, id]) => <button key={a} type="button" onClick={() => { const l = lex.labelOf.get(id) ?? a; const at = expr.length + (expr && !/[\s(+\-*/]$/.test(expr) ? 1 : 0) + l.length + 1; setExpr(`${expr}${expr && !/[\s(+\-*/]$/.test(expr) ? ' ' : ''}${l} `); setCaret(at); }}>{lex.labelOf.get(id)}<span className="mono muted"> {a}</span></button>)}</div>
        <p className="muted">כותבים שם מדד בעברית כפי שהוא מופיע ברשימה, או קוד ({'{מזהה}'} לכל מדד). פונקציות: {(Object.keys(FUNCS) as (keyof typeof FUNCS)[]).map((f) => `${f} · ${FUNCS[f]}`).join(' · ')}.</p>
      </details>
    </section>
  );
}

/* ---------- peer sets ---------- */
function SetEditor({ reg, ents, onChange, onSave, own, onDelete }: { reg: Registry; ents: string[]; onChange: (ids: string[]) => void; onSave: (name: string) => void; own: PeerSet | null; onDelete: (id: string) => void }) {
  const [name, setName] = useState('');
  const groups: [string, string][] = [['ins', 'מבטחות'], ['fund', 'בתי השקעות']];
  return (
    <section className="panel pr-seted" aria-label="עריכת קבוצת עמיתים">
      {groups.map(([k, n]) => (
        <div key={k} className="pr-row"><span className="muted pr-gl">{n}</span>{reg.entities.filter((e) => e.k === k).map((e) => (
          <button key={e.id} type="button" className="chip" aria-pressed={ents.includes(e.id)} onClick={() => onChange(ents.includes(e.id) ? ents.filter((x) => x !== e.id) : reg.entities.map((x) => x.id).filter((x) => x === e.id || ents.includes(x)))}><i className="sw" style={{ background: idCss(e.id) }} />{e.sh ?? e.n}</button>
        ))}</div>
      ))}
      <div className="pr-row">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="שם הקבוצה" aria-label="שם הקבוצה" />
        <button type="button" className="btn" disabled={!name.trim() || !ents.length} onClick={() => { onSave(name.trim()); setName(''); }}>שמירה כקבוצה</button>
        {own && <button type="button" className="btn" onClick={() => onDelete(own.id)}>מחיקת “{own.n}”</button>}
        <span className="src">נשמר בדפדפן זה</span>
      </div>
    </section>
  );
}

/* ---------- templates and saved views ---------- */
function Views({ views, onOpen, onApply, onSave, onDelete }: { views: SavedView[]; onOpen: (q: string) => void; onApply: (t: Template) => void; onSave: (n: string) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  return (
    <section className="panel pr-views" aria-label="תבניות ותצוגות">
      <div className="pr-vcol">
        <h3>תבניות</h3>
        <ul>{TEMPLATES.map((t) => <li key={t.id}><button type="button" onClick={() => onApply(t)}><kbd>{t.key}</kbd> {t.n}<span className="muted"> · {t.c.length} עמודות · {t.f}</span></button></li>)}</ul>
      </div>
      <div className="pr-vcol">
        <h3>התצוגות שלי</h3>
        {views.length ? <ul>{views.map((v, i) => <li key={v.id}><button type="button" onClick={() => onOpen(v.q)}>{i < 3 && <kbd>{['8', '9', '0'][i]}</kbd>} {v.n}</button><button type="button" className="linkbtn" onClick={() => onDelete(v.id)} aria-label={`מחיקת ${v.n}`}>מחיקה</button></li>)}</ul> : <p className="muted">אין עדיין</p>}
        <div className="pr-row">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="שם התצוגה" aria-label="שם התצוגה" />
          <button type="button" className="btn" disabled={!name.trim()} onClick={() => { onSave(name.trim()); setName(''); }}>שמירה</button>
          <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'הועתק' : 'העתקת קישור'}</button>
        </div>
        <p className="src">התצוגה כולה בכתובת: קישור פותח אותה כמו שהיא. שמירה: בדפדפן זה.</p>
      </div>
    </section>
  );
}

/* ---------- export ---------- */
function describe(p: Prov): [string, string, number | string, string] {
  switch (p.k) {
    case 'report': return ['דוח', [p.doc, p.note].filter(Boolean).join(' · '), p.pg ?? '', p.url ? (p.pg ? `${p.url}#page=${p.pg}` : p.url) : ''];
    case 'xbrl': return ['XBRL', `${p.company} · ${p.concept}${p.status ? ` · ${p.status}` : ''}`, '', p.rid ? mayaReport(p.rid) : ''];
    case 'calc': return ['מחושב', `${p.formula} | ${p.inputs.map((i) => `${i.label}: ${i.v}`).join(' ; ')}`, '', ''];
    case 'reg': return ['רשות שוק ההון', `${p.metric} · ${p.set} · ${p.w}`, '', 'https://data.gov.il/dataset/gemelnet'];
    case 'none': return ['–', p.why, '', ''];
    default: return [p.k, '', '', ''];
  }
}
function grid(book: Book, cols: Col[], ents: string[], st: St, periods: string[]) {
  const sub = st.v === 'series' ? (() => { const c = cols[Math.min(st.k, cols.length - 1)], end = periods[0]; return end ? Array.from({ length: st.w }, (_, i) => ({ col: c, p: back(st.f, end, i) })) : []; })()
    : cols.flatMap((col) => periods.map((p) => ({ col, p })));
  return { sub, cell: (e: string, j: number) => cellVal(book, sub[j].col, e, st.f, sub[j].p, ents) };
}
async function exportXlsx(book: Book, cols: Col[], ents: string[], st: St, periods: string[], setName: string) {
  const { downloadXlsx } = await import('../lib/xlsx');
  const { sub, cell } = grid(book, cols, ents, st, periods);
  const fmt = (c: Col): 'n0' | 'n1' | 'n2' => (c.tr === 'v' && c.unit === 'm' ? 'n0' : c.tr === 'v' && (c.unit === 'bn' || c.unit === 'nis' || c.unit === 'x') ? 'n2' : 'n1');
  const rows: import('../lib/xlsx').XCell[][] = [
    [{ v: 'fox · טבלת עמיתים', bold: true }], [`${setName} · ${st.f} · ${location.href}`], [`נתונים נכון ל-${pubLabel(book.reg.asof)} · כל ערך מקושר לעמוד בדוח (כשיש) · גיליון "מקורות" מפרט כל תא`], [],
    [{ v: 'חברה', bold: true }, ...sub.map(({ col, p }) => ({ v: `${colLabel(col)} · ${plab(st.f, p)} (${shownUnit(col)})`, bold: true }))],
  ];
  const src: import('../lib/xlsx').XCell[][] = [['חברה', 'עמודה', 'תקופה', 'ערך', 'יחידה', 'סוג מקור', 'מסמך / נוסחה ורכיבים', 'עמוד', 'קישור'].map((v) => ({ v, bold: true }))];
  ents.forEach((e) => {
    rows.push([book.name(e), ...sub.map(({ col }, j) => { const x = cell(e, j); return x.v == null ? null : { v: +x.v.toFixed(4), link: col.tr === 'v' ? x.href : undefined, fmt: fmt(col) }; })]);
    sub.forEach(({ col, p }, j) => { const x = cell(e, j); if (x.v == null) return; const [k, d, pg, url] = describe(x.prov()); src.push([book.name(e), colLabel(col), plab(st.f, p), { v: +x.v.toFixed(4), fmt: fmt(col) }, shownUnit(col), k, d, pg, url ? { v: url, link: url } : '']); });
  });
  (['חציון', 'ממוצע'] as const).forEach((nm, kind) => rows.push([{ v: nm, bold: true }, ...sub.map((_, j) => { const xs = ents.map((e) => cell(e, j).v).filter((v): v is number => v != null); if (xs.length < (kind ? 2 : 3)) return null; return { v: +(kind ? xs.reduce((s, x) => s + x, 0) / xs.length : median(xs)).toFixed(4), bold: true, fmt: fmt(sub[j].col) }; })]));
  rows.push([], ['הערות: נגזר = מחושב מנתונים מדווחים (Q4 = FY פחות 9M, H מרבעונים, LTM = ארבעה רבעונים). לפני 2025 רוב השורות לפי IFRS 4 כפי שדווח. שינוי באחוזים בין ערכים בסימנים שונים אינו מחושב.']);
  downloadXlsx(`fox-peers-${st.f}-${periods[0] ?? ''}`, [{ name: 'טבלה', rows, freeze: { rows: 5, cols: 1 }, widths: [18, ...sub.map(() => 16)] }, { name: 'מקורות', rows: src, freeze: { rows: 1, cols: 0 }, widths: [14, 30, 10, 12, 12, 12, 70, 6, 50] }]);
}
function exportCsv(book: Book, cols: Col[], ents: string[], st: St, periods: string[]) {
  const { sub, cell } = grid(book, cols, ents, st, periods);
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [['company', ...sub.map(({ col, p }) => `${colLabel(col)} · ${plab(st.f, p)} (${shownUnit(col)})`)], ...ents.map((e) => [book.name(e), ...sub.map((_, j) => { const v = cell(e, j).v; return v == null ? '' : +v.toFixed(4); })]), [], [`fox · ${location.href}`]];
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + lines.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })), download: `fox-peers-${st.f}-${periods[0] ?? ''}.csv` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
