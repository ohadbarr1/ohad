import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { nf, pubLabel } from '../lib/format';
import { METRIC_BY_KEY, WIN_LABEL, type Market } from '../lib/market';
import { liveCheck, loadTracks, parseRegKey, recompute, regKey, SourceCtx, useSource, type LiveResult, type Prov, type RegCol, type Track } from '../lib/prov';
import { ckanQuery, ckanResourcePage, DS_LABEL, mayaReport, pdfPage, resourceOf, type RegDs } from '../lib/sources';
import { useMarket } from '../lib/useData';
import { Recon } from './Recon';
import '../styles/prov.css';

type Reg = Extract<Prov, { k: 'reg' }>;

/** The plain text of a node tree, for deciding how it is laid out. */
function textOf(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (typeof n === 'object' && 'props' in n) return textOf((n as { props: { children?: ReactNode } }).props.children);
  return '';
}

/** A number that opens its source. With `href` it is also a real link: Cmd/Ctrl-click goes straight to the document.
 *  A figure with no Hebrew in it ("−5.5% YoY", "177.0%") is isolated left-to-right, so in a right-to-left line its sign stays in front. */
export function Sourced({ src, href, children, className: given = '', title }: { src: () => Prov; href?: string | null; children: ReactNode; className?: string; title?: string }) {
  const { open } = useSource();
  const t = textOf(children);
  const className = !/\bnum\b/.test(given) && /\d/.test(t) && !/[\u0590-\u05FF]/.test(t) ? `${given} num`.trim() : given;
  if (href) return <a className={`src ${className}`} href={href} target="_blank" rel="noreferrer" title={title ?? 'מקור הנתון'} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); open(src()); }}>{children}</a>;
  return <button type="button" className={`src ${className}`} title={title ?? 'מקור הנתון'} onClick={() => open(src())}>{children}</button>;
}

/** One sheet for the whole site. Lives in the layout; any number opens it through `useSource().open`. */
export function SourceProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Prov[]>([]);
  const [sp, setSp] = useSearchParams();
  const key = sp.get('src');
  const { market } = useMarket(stack.some((p) => p.k === 'reg') || !!key?.startsWith('reg~'));
  const marketRef = useRef<Market | null>(null); marketRef.current = market;

  const open = useCallback((p: Prov) => {
    setStack((s) => [...s, p]);
    setSp((q) => { const n = new URLSearchParams(q); if (!n.get('src')) n.set('src', p.k === 'reg' && marketRef.current ? regKey(p, marketRef.current) : '1'); return n; }, { replace: false });
  }, [setSp]);
  const close = useCallback(() => { setStack([]); setSp((q) => { const n = new URLSearchParams(q); n.delete('src'); return n; }, { replace: true }); }, [setSp]);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  // the address is the state: Back closes the sheet, a pasted link reopens a regulator figure
  useEffect(() => {
    if (!key) { if (stack.length) setStack([]); return; }
    if (stack.length) return;
    if (key.startsWith('reg~')) { if (market) { const p = parseRegKey(key, market); if (p) setStack([p]); else close(); } }
    else close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, market]);

  // a regulator figure opened before the fund file arrived gets its linkable key once it has
  useEffect(() => {
    if (key === '1' && market && stack.length === 1 && stack[0].k === 'reg') { const k = regKey(stack[0], market); setSp((q) => { const n = new URLSearchParams(q); n.set('src', k); return n; }, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, market, stack]);

  const api = useMemo(() => ({ open }), [open]);
  const top = stack[stack.length - 1];
  return (
    <SourceCtx.Provider value={api}>
      {children}
      {top && <Sheet prov={top} market={market} depth={stack.length} onBack={back} onClose={close} />}
    </SourceCtx.Provider>
  );
}

function Sheet({ prov, market, depth, onBack, onClose }: { prov: Prov; market: Market | null; depth: number; onBack: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button.x')?.focus();
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="srcwrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="srcsheet" role="dialog" aria-modal="true" aria-label="מקור הנתון" ref={ref}>
        <div className="srcbar">
          {depth > 1 && <button type="button" className="chip" onClick={onBack}>חזרה</button>}
          <span className="k">מקור הנתון</span>
          <button type="button" className="x iconbtn" onClick={onClose} aria-label="סגירה">×</button>
        </div>
        <div className="srcbody">
          {prov.k === 'reg' ? (market ? <RegSheet key={regKey(prov, market)} p={prov} m={market} /> : <p className="muted">טוען…</p>) : prov.k === 'fund' ? <FundSheet p={prov} /> : <PlainSheet p={prov} />}
        </div>
      </div>
    </div>
  );
}

const Head = ({ title, value, unit, sub }: { title: string; value: string; unit?: string; sub?: ReactNode }) => (
  <header className="srchead"><h2>{title}</h2><div className="mval"><span className="v num">{value}</span>{unit && <span className="u">{unit}</span>}</div>{sub && <div className="sub">{sub}</div>}</header>
);

function FundSheet({ p }: { p: Extract<Prov, { k: 'fund' }> }) {
  const { market } = useMarket();
  const res = resourceOf(market?.d.meta.resources?.[p.ds], p.period);
  return (
    <>
      <Head title={p.title} value={p.value} unit={p.unit} sub={<>{DS_LABEL[p.ds]} · קופה <span className="num">{p.id}</span> · <span className="num">{p.period}</span></>} />
      <dl className="srcfacts">
        <dt>סוג מקור</dt><dd>רשות שוק ההון, נתוני קופות פתוחים (data.gov.il)</dd>
        <dt>שדה</dt><dd className="mono ltr">{p.col}</dd>
        <dt>נמשך</dt><dd className="num">{market?.d.meta.fetched ?? '–'}</dd>
      </dl>
      {res && <a className="srcgo" href={ckanQuery(res.id, { REPORT_PERIOD: p.period, FUND_ID: p.id }, undefined, 5)} target="_blank" rel="noreferrer">הרשומה ב-data.gov.il</a>}
      {p.note && <p className="srcnote">{p.note}</p>}
    </>
  );
}

function PlainSheet({ p }: { p: Exclude<Prov, { k: 'reg' | 'fund' }> }) {
  const { open } = useSource();
  if (p.k === 'report') return (
    <>
      <Head title={p.title} value={p.value} unit={p.unit} sub={<>{p.doc}{p.period ? ` · ${p.period}` : ''}</>} />
      <dl className="srcfacts">
        <dt>סוג מקור</dt><dd>{p.srcType ?? 'דוח כספי שפורסם במאיה'}</dd>
        {p.doc && <><dt>מסמך</dt><dd>{p.doc}</dd></>}
        <dt>{p.srcType?.startsWith('מצגת') ? 'שקף' : 'עמוד'}</dt><dd className="num">{p.pg ?? 'לא סומן'}</dd>
      </dl>
      {p.url ? <a className="srcgo" href={pdfPage(p.url, p.pg)} target="_blank" rel="noreferrer">פתיחת הדוח{p.pg ? `, עמ׳ ${p.pg}` : ''}</a> : !p.srcType && <p className="muted">אין קישור למסמך.</p>}
      {p.der && <p className="srcnote"><span className="chip est">נגזר</span> לא הודפס בדוח: חושב מהפרש בין תקופות מצטברות של אותו דוח (Q4 = FY פחות 9M, H2 = FY פחות H1).</p>}
      {p.old && <p className="srcnote"><span className="chip est">IFRS 4</span> נתון לפי התקן הקודם, מוצג בשורה שנמשכת בין התקנים.</p>}
      {p.turned && <p className="srcnote"><span className="chip est">סימן</span> הסימן הותאם להצגה בדוח העדכני.</p>}
      {p.restated && <p className="srcnote"><span className="chip est">הוצג מחדש</span> דווח לראשונה {p.restated.firstHref ? <a href={p.restated.firstHref} target="_blank" rel="noreferrer" className="num">{p.restated.first}</a> : <span className="num">{p.restated.first}</span>}, הודפס מחדש {p.restated.lastHref ? <a href={p.restated.lastHref} target="_blank" rel="noreferrer" className="num">{p.restated.last}</a> : <span className="num">{p.restated.last}</span>} בדוח {p.restated.in}.</p>}
      {p.note && <p className="srcnote">{p.note}</p>}
    </>
  );
  if (p.k === 'xbrl') return (
    <>
      <Head title={p.title} value={p.value} unit={p.unit} sub={p.period} />
      <dl className="srcfacts">
        <dt>סוג מקור</dt><dd>דיווח XBRL במאיה</dd>
        <dt>מושג</dt><dd className="mono ltr">{p.concept}</dd>
        {p.status && <><dt>מצב</dt><dd>{p.status}</dd></>}
      </dl>
      {p.rid ? <a className="srcgo" href={mayaReport(p.rid)} target="_blank" rel="noreferrer">פתיחת הדיווח במאיה</a> : <p className="muted">אין מזהה דיווח.</p>}
      {p.note && <p className="srcnote">{p.note}</p>}
    </>
  );
  if (p.k === 'calc') return (
    <>
      <Head title={p.title} value={p.value} unit={p.unit} sub={<><span className={`chip${p.est ? ' est' : ''}`}>{p.est ? 'אומדן' : 'מחושב באתר'}</span></>} />
      <p className="srcformula">{p.formula}</p>
      <table className="srcin"><tbody>{p.inputs.map((i) => (
        <tr key={i.label}><td>{i.label}</td><td className="num">{i.src ? <button type="button" className="src" onClick={() => open(i.src!())}>{i.v}</button> : i.v}</td></tr>
      ))}</tbody></table>
      {p.note && <p className="srcnote">{p.note}</p>}
    </>
  );
  if (p.k === 'price') return (
    <>
      <Head title={p.title} value={p.value} sub={`${p.ticker} · ${pubLabel(p.date)}`} />
      <dl className="srcfacts"><dt>סוג מקור</dt><dd>נתוני מסחר</dd><dt>ספק</dt><dd>{p.vendor}</dd><dt>נכון ל</dt><dd className="num">{pubLabel(p.date)}</dd></dl>
    </>
  );
  return <><Head title={p.title} value="–" /><p className="srcnote">{p.why}</p></>;
}

const WINDOW = (m: Market, pi: number, w: Reg['w']) => (w === 'm' ? 1 : w === 'ltm' ? 12 : w === 'q' ? 3 : m.P[pi] % 100);
const FORMULA: Partial<Record<Reg['metric'], string>> = {
  assets: 'סכום TOTAL_ASSETS של כל המסלולים',
  share: 'נכסי הקבוצה חלקי נכסי כל השוק באותו מוצר',
  organic: 'סכום DEPOSITS פחות WITHDRAWLS, כל המסלולים וכל חודשי התקופה',
  transfers: 'סכום INTERNAL_TRANSFERS, כל המסלולים וכל חודשי התקופה',
  netflow: 'DEPOSITS פחות WITHDRAWLS ועוד INTERNAL_TRANSFERS',
  fee: 'ממוצע AVG_ANNUAL_MANAGEMENT_FEE משוקלל ב-TOTAL_ASSETS',
  ret: 'MONTHLY_YIELD משוקלל בנכסי תחילת החודש, בריבית דריבית על חודשי התקופה',
};
const COLS: Partial<Record<Reg['metric'], RegCol[]>> = { assets: ['a'], share: ['a'], organic: ['dep', 'wd'], transfers: ['tr'], netflow: ['dep', 'wd', 'tr'], fee: ['a', 'fee'], ret: ['y'] };
const tot = (xs: (number | null)[]) => xs.reduce<number>((s, v) => s + (v ?? 0), 0);
const comp = (ys: (number | null)[]) => (ys.some((v) => v == null) ? null : (ys.reduce<number>((f, v) => f * (1 + v! / 100), 1) - 1) * 100);

function RegSheet({ p, m }: { p: Reg; m: Market }) {
  const def = METRIC_BY_KEY[p.metric], n = def.win ? WINDOW(m, p.pi, p.w) : 1;
  const periods = useMemo(() => m.P.slice(p.pi - n + 1, p.pi + 1), [m, p.pi, n]);
  const [ts, setTs] = useState<Track[] | null>(null);
  const [base, setBase] = useState<Track[] | null>(null);
  const [live, setLive] = useState<LiveResult | 'run' | string | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let on = true;
    void loadTracks(m, p.g, p.set, periods).then((t) => { if (on) setTs(t); });
    if (p.metric === 'share') void loadTracks(m, -1, p.set, periods).then((t) => { if (on) setBase(t); });
    return () => { on = false; };
  }, [m, p.g, p.set, p.metric, periods]);

  const shown = m.value(p.metric, p.pi, p.w, p.set, p.g), dec = def.dec ?? (def.unit === '%' ? 2 : 1);
  const group = p.g < 0 ? 'כל השוק' : m.d.groups[p.g], set = m.sets.find((s) => s.id === p.set)!.label;
  const span = n > 1 ? `${m.plabel(p.pi - n + 1)} עד ${m.plabel(p.pi)} (${WIN_LABEL[p.w]})` : m.plabel(p.pi);
  const meta = m.d.meta, last = n - 1;
  const again = ts && (p.metric !== 'share' || base) ? recompute(p.metric, ts, n, base ?? undefined) : null;
  const same = again != null && shown != null && Math.abs(again - shown) <= 1e-6 * Math.max(1, Math.abs(shown));
  const pro = (meta.proforma ?? []).filter((x) => x.to === group && periods[0] <= x.until);
  const rows = useMemo(() => (ts ? [...ts].sort((a, b) => (b.a[last] ?? 0) - (a.a[last] ?? 0)) : []), [ts, last]);
  const byDs = (['pensia', 'gemel', 'insurance'] as RegDs[]).map((ds) => ({ ds, list: rows.filter((t) => t.ds === ds) })).filter((x) => x.list.length);
  const cols = COLS[p.metric] ?? ['a'];

  const check = () => {
    if (!ts) return;
    setLive('run');
    liveCheck(meta.resources ?? {}, ts, periods, cols).then(setLive, (e: Error) => setLive(`הבדיקה נכשלה: ${e.message}`));
  };
  const csv = () => {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['מאגר', 'FUND_ID', 'שם המסלול', 'מוצר', 'חברה מנהלת', 'REPORT_PERIOD', 'TOTAL_ASSETS', 'AVG_ANNUAL_MANAGEMENT_FEE', 'MONTHLY_YIELD', 'נכסי החודש הקודם', 'DEPOSITS', 'WITHDRAWLS', 'INTERNAL_TRANSFERS'];
    const body = rows.flatMap((t) => periods.map((per, k) => (t.a[k] == null ? null : [DS_LABEL[t.ds], t.id, t.name, t.prod, t.mgr, per, t.a[k], t.fee[k], t.y[k], t.prev[k], t.dep[k], t.wd[k], t.tr[k]])).filter(Boolean) as unknown[][]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...body].map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `fox-${p.metric}-${group}-${m.P[p.pi]}.csv`.replace(/\s+/g, '-'); a.click();
  };
  const val = (t: Track): ReactNode => {
    switch (p.metric) {
      case 'fee': return <><td className="num">{t.fee[last] == null ? '–' : nf(t.fee[last]!, 2)}</td><td className="num">{nf(t.a[last] ?? 0, 1)}</td></>;
      case 'ret': { const r = comp(t.y); return <><td className="num">{r == null ? '–' : nf(r, 2)}</td><td className="num">{t.prev[0] == null ? '–' : nf(t.prev[0], 1)}</td></>; }
      case 'organic': return <><td className="num">{nf(tot(t.dep), 1)}</td><td className="num">{nf(tot(t.wd), 1)}</td></>;
      case 'transfers': return <td className="num">{nf(tot(t.tr), 1)}</td>;
      case 'netflow': return <><td className="num">{nf(tot(t.dep) - tot(t.wd), 1)}</td><td className="num">{nf(tot(t.tr), 1)}</td></>;
      default: return <td className="num">{nf(t.a[last] ?? 0, 2)}</td>;
    }
  };
  const heads = p.metric === 'fee' ? ['דמי ניהול, %', 'נכסים'] : p.metric === 'ret' ? ['תשואה, %', 'נכסי פתיחה'] : p.metric === 'organic' ? ['הפקדות', 'משיכות'] : p.metric === 'transfers' ? ['העברות נטו'] : p.metric === 'netflow' ? ['צבירה', 'העברות'] : ['נכסים'];
  const sub = (list: Track[]) => (p.metric === 'fee' || p.metric === 'ret' ? recompute(p.metric, list, n) : p.metric === 'share' ? recompute('assets', list, n) : recompute(p.metric, list, n));
  const subUnit = def.unit === '%' && p.metric !== 'share' ? '%' : 'מיליארד ש"ח';
  const view = all ? rows : rows.slice(0, 12);

  return (
    <>
      <Head title={`${def.short} · ${group}`} value={shown == null ? '–' : nf(shown, dec)} unit={def.unit === '%' ? '%' : 'מיליארד ש"ח'} sub={<>{set} · {span}</>} />
      <dl className="srcfacts">
        <dt>סוג מקור</dt><dd>רשות שוק ההון, נתוני קופות פתוחים (data.gov.il)</dd>
        <dt>חישוב</dt><dd>{FORMULA[p.metric] ?? def.label}</dd>
        <dt>רכיבים</dt><dd>{ts ? <><span className="num">{rows.length}</span> מסלולים{n > 1 ? <>, <span className="num">{n}</span> חודשים</> : ''}</> : 'טוען…'}</dd>
        <dt>נמשך</dt><dd className="num">{meta.fetched ?? meta.generated}</dd>
      </dl>
      {ts && (
        <div className="srcchecks">
          <span className={`chip ${same ? 'pass' : 'review'}`}>{same ? `סכום הרכיבים זהה לתצוגה: ${nf(again!, p.metric === 'assets' ? 5 : 4)}` : again == null ? 'אין חישוב חוזר למדד זה' : `סכום הרכיבים ${nf(again, 4)} מול תצוגה ${shown == null ? '–' : nf(shown, 4)}`}</span>
          {live == null && <button type="button" className="chip" onClick={check}>בדיקה חיה מול data.gov.il</button>}
          {live === 'run' && <span className="chip">בודק מול המקור…</span>}
          {typeof live === 'string' && live !== 'run' && <span className="chip review">{live}</span>}
          {live && typeof live === 'object' && (
            <span className={`chip ${live.equal === live.checked ? 'pass' : 'review'}`}>
              {live.equal === live.checked ? `תואם למקור: ${nf(live.checked, 0)} מתוך ${nf(live.checked, 0)} ערכים` : `${nf(live.checked - live.equal, 0)} מתוך ${nf(live.checked, 0)} ערכים שונים מהמקור${live.worst ? ` (${live.worst.name}: ${nf(live.worst.ours, 2)} מול ${live.worst.theirs == null ? 'חסר' : nf(live.worst.theirs, 2)})` : ''}`} · {live.at}
            </span>
          )}
        </div>
      )}
      {pro.map((x) => <p className="srcnote" key={x.from}><span className="chip est">פרופורמה</span> מסלולי {x.from} מוצגים תחת {x.to} לכל התקופה, גם לפני המיזוג.</p>)}
      {p.metric === 'assets' && p.g >= 0 && ts && <Recon group={group} period={m.P[p.pi]} tracks={rows} />}
      {byDs.length > 0 && (
        <table className="srcin">
          <thead><tr><th>מאגר</th><th>מסלולים</th><th>{subUnit}</th><th>מקור</th></tr></thead>
          <tbody>{byDs.map(({ ds, list }) => {
            const res = resourceOf(meta.resources?.[ds], m.P[p.pi]), v = sub(list);
            return (
              <tr key={ds}><td>{DS_LABEL[ds]}</td><td className="num">{list.length}</td><td className="num">{v == null ? '–' : nf(v, p.metric === 'assets' || p.metric === 'share' ? 5 : 2)}</td>
                <td>{res ? <><a href={ckanResourcePage(meta.packages?.[ds] ?? '', res.id)} target="_blank" rel="noreferrer">הקובץ</a> · <a href={ckanQuery(res.id, { REPORT_PERIOD: m.P[p.pi] }, undefined, 1000)} target="_blank" rel="noreferrer">שאילתה</a></> : '–'}</td></tr>
            );
          })}</tbody>
        </table>
      )}
      {rows.length > 0 && (
        <>
          <div className="srctools"><b>המסלולים</b><span className="muted">מיליוני ש"ח, כפי שפורסם</span><button type="button" className="chip" onClick={csv}>CSV, {nf(rows.length * 1, 0)} מסלולים</button></div>
          <div className="scroll"><table className="srctracks">
            <thead><tr><th>מסלול</th><th>מוצר</th>{heads.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{view.map((t) => <tr key={`${t.ds}${t.id}`}><td>{t.name}<span className="id num">{t.id}</span></td><td>{t.prod}</td>{val(t)}</tr>)}</tbody>
          </table></div>
          {rows.length > 12 && <button type="button" className="chip more" onClick={() => setAll(!all)}>{all ? 'הצגת 12 הגדולים' : `כל ${rows.length} המסלולים`}</button>}
        </>
      )}
    </>
  );
}
