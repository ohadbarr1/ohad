import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DeeperSheet } from '../components/DeeperSheet';
import { GuardLine } from '../components/GuardLine';
import { Loading } from '../components/ui';
import { idCss } from '../lib/identity';
import { nf } from '../lib/format';
import { useBook, type Registry } from '../lib/registry';
import { useAddressWrite, useSheetHost } from '../lib/sheetHost';
import { load, useLoad, useRegistry } from '../lib/useData';
import { useMedia } from '../lib/useMedia';
import type { TasePrice } from '../lib/valuation';
import {
  BBY, boardMetrics, bizVal, latestCsmBasis, metricsFor, needIds, pairRead, readOf, reportStatus, shOf, spotVal, statOf, TAX,
  type BMetric, type BVal, type Kind, type MktFile,
} from '../lib/peerBoard';
import { guardWords } from '../lib/peerWords';
import { dlab, qlab, type QRead } from '../lib/quarters';
import { BoardLens, FullGrid, Words } from './peers/BoardLens';
import { exportBoard, type BoardData } from './peers/exportBoard';
import { CompanySheet } from './peers/CompanySheet';
import { ContextSheet, WhySheet } from './peers/ContextSheet';
import { FocusLens } from './peers/FocusLens';
import { MetricSheet } from './peers/MetricSheet';
import { ViewStrip } from './peers/ViewStrip';
import { IndustryTools } from './Industry';
import '../styles/p6.css';
import '../styles/peerboard.css';

/* The peers board, "השוואה ענפית" (spec p6 §3, §13, §14; lane P6-2a): the shell of /industry/peers?v=board. One metric for the whole
   group: a metric chip and a reading are the whole state (`bm`, `rd`), with the focus company (`hl`), the basis (`base`: latest | common),
   the lens (`lens`: none = the board · focus · charts · table), the desktop matrix's section (`sec`), the grid's depth (`gq`) and the
   open sheet (`sheet`: co:<id> · metrics · ctx · why · grid) in the address. Old links keep their meaning: `bm` of a change column
   (npy, csmy, …) opens its base metric on the matching reading; `bx`, `by`, `bh`, `bs`, `bw`, `bf` are the charts lens's.
   The shell loads the peer files, the price files and mkt.json once, computes the tables' cells (the charts and table lenses and the
   workbook read them: `BoardData`), and lays out: the hub row's Excel and context chip (IndustryTools, phone and desktop), the one
   "תצוגה" strip, the metric chips, the lens, the partial-quarter line (#guard: under the board, above the tables) and the stamp. */

interface Props { reg: Registry; ents: string[]; setName: string }
const HK = ['bx', 'by', 'bm', 'bh', 'bw', 'bs', 'bf'];
type Lens = 'board' | 'focus' | 'charts' | 'table';

/* the charts and the comps tables (lane P6-2b, pages/peers/ChartsLens, TableLens) are lazy chunks: the board lens never loads ECharts */
const ChartsLens = lazy(() => import('./peers/ChartsLens').then((m) => ({ default: m.ChartsLens })));
const TableLens = lazy(() => import('./peers/TableLens').then((m) => ({ default: m.TableLens })));

/** the favourite chips of a set (spec 3.2 item 4): insurers / fund houses */
const FAV_INS = ['pbc', 'pb', 'pe', 'roe', 'np', 'csm', 'isrm', 'oshare', 'onet', 'tr'];
const FAV_FUND = ['pb', 'pe', 'maum', 'roe', 'np', 'nm', 'aum', 'oshare', 'onet', 'tr'];

/** `bm` / `rd` of the address against the set's board metrics: a change column of the tables (an old link) opens its base metric on the
 *  matching reading; the three return windows open total return on that window; otherwise the default metric (D2: P/(B+CSM) for an
 *  insurer set, P/B for a fund-house or mixed set) */
export function resolveMetric(bm: string | null, rd: string | null, avail: BMetric[], allIns: boolean): { m: BMetric; rd: QRead } {
  const has = (k: string) => avail.find((m) => m.key === k);
  const dm = (allIns && has('pbc')) || has('pb') || avail[0];
  let m = bm ? has(bm) : undefined, r = rd as QRead | null;
  if (!m && bm) {
    const x = BBY.get(bm);
    if (x?.type === 'ret' && has('tr')) { m = has('tr'); r = r ?? (bm as QRead); }
    else if (x?.of && has(x.of)) { m = has(x.of); const base = m!; r = r ?? (pairRead(base) ?? 'yoy'); }
  }
  m = m ?? dm;
  return { m: m!, rd: readOf(m!, r) };
}

export function PeersBoard({ reg, ents, setName }: Props) {
  const [sp] = useSearchParams();
  const write = useAddressWrite();
  const put = (k: string, v: string | null) => write({ [k]: v });
  const get = (k: string) => new URLSearchParams(window.location.search).get(k);
  const sheet = useSheetHost();
  const desk = useMedia('(min-width: 1000px)');
  const kindOf = (e: string): Kind => (reg.entities.find((x) => x.id === e)?.k === 'fund' ? 'fund' : 'ins');
  const kinds = ents.map(kindOf);
  const ms = useMemo(() => metricsFor(kinds), [kinds.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const bms = useMemo(() => boardMetrics(kinds), [kinds.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const major: Kind = kinds.filter((k) => k === 'ins').length >= kinds.length / 2 ? 'ins' : 'fund';
  const allIns = kinds.every((k) => k === 'ins');

  // the metric files the board reads: parse its tokens against an empty book, then load
  const { book: b0 } = useBook(reg, []);
  const ids = useMemo(() => needIds(b0, [...ms, ...bms.filter((m) => !ms.includes(m))], true), [b0, ms, bms]);
  const { book, pending } = useBook(reg, ids);
  const coReg = useRegistry().data;
  const mk = useLoad<MktFile>('mkt.json').data ?? null;
  const [px, setPx] = useState<Record<string, TasePrice | null>>({});
  useEffect(() => {
    if (!coReg) return;
    let live = true;
    ents.filter((e) => !(e in px)).forEach((e) => {
      if (!coReg.find((c) => c.id === e)?.has_price) { setPx((cur) => ({ ...cur, [e]: null })); return; }
      load<TasePrice>(`companies/${e}.price.json`).then((p) => live && setPx((cur) => ({ ...cur, [e]: p })), () => live && setPx((cur) => ({ ...cur, [e]: null })));
    });
    return () => { live = false; };
  }, [ents.join(), coReg]);  // eslint-disable-line react-hooks/exhaustive-deps
  const pxReady = ents.every((e) => e in px);

  const focus0 = sp.get('hl') ?? '';
  const focus = ents.includes(focus0) ? focus0 : ents[0] ?? '';
  const base: 'latest' | 'common' = sp.get('base') === 'common' ? 'common' : 'latest';
  const status = useMemo(() => (book && pending === 0 ? reportStatus(book, ents) : null), [book, pending, ents.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const npId = major === 'ins' ? 'ifrs:profit_attributable' : 'xbrl:profit';
  const pLatest = book ? book.latest(npId, 'LTM', ents) ?? '' : '';
  const q = status ? (base === 'common' && status.cq ? status.cq : status.bq || pLatest) : '';
  const p = base === 'common' && status?.cq ? status.cq : pLatest;
  // the regulator's files are monthly: the operating figures run to their own latest quarter, ahead of the filings (complete at it: 13.2 rule 3)
  const pOps = book ? book.latest('reg:assets@all', 'LTM', ents) ?? p : p;

  // the tables' grid: metric × company (the charts and table lenses, the workbook)
  const cells = useMemo(() => {
    const out = new Map<string, Map<string, BVal>>();
    if (!book || !p || pending > 0) return out;
    ms.forEach((m) => {
      const row = new Map<string, BVal>();
      ents.forEach((e) => row.set(e, m.spot ? spotVal(m, { book, ent: e, kind: kindOf(e), p, peers: ents, px: px[e] ?? null, mk }) : bizVal(book, m, e, kindOf(e), m.ax === 'reg' ? pOps : p, ents)));
      out.set(m.key, row);
    });
    return out;
  }, [book, pending, p, pOps, ms, ents.join(), px, mk]);  // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => new Map(ms.map((m) => [m.key, statOf(m, new Map(ents.map((e) => [e, cells.get(m.key)?.get(e)?.v ?? null])))])), [cells, ms]);  // eslint-disable-line react-hooks/exhaustive-deps

  const pxAsof = ents.map((e) => px[e]?.asof).filter((x): x is string => !!x).sort().pop() ?? '';
  const order = useMemo(() => [...ents].sort((a, b) => (cells.get('mcap')?.get(b)?.v ?? -1) - (cells.get('mcap')?.get(a)?.v ?? -1) || ents.indexOf(a) - ents.indexOf(b)), [cells, ents.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const { m, rd } = resolveMetric(sp.get('bm'), sp.get('rd'), bms, allIns);
  const lensP = sp.get('lens');
  const lens: Lens = lensP === 'focus' || lensP === 'charts' || lensP === 'table' ? lensP : 'board';

  const d: BoardData | null = useMemo(() => (!book || !status || !p || pending > 0 ? null : {
    reg, book, ents, order, ms, cells, stats, focus, kindOf, major, p, pOps, mk, px, pxAsof, setName, status, q, base, put, get, bm: m.key, rd,
  }), [book, status, p, pending, ents.join(), order, ms, cells, stats, focus, major, pOps, mk, px, pxAsof, setName, q, base, m.key, rd]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status) (window as unknown as { __p6?: unknown }).__p6 = { status, q, base, bm: m.key, rd }; }, [status, q, base, m.key, rd]);

  if (!d || !pxReady) return <Loading what="לוח ההשוואה" />;

  const name = (e: string) => book!.short(e);
  const gw = guardWords(status!, base, name);
  const guard = gw ? <GuardLine kind="risk" id="guard" wrap text={<Words parts={gw.parts} src={() => null} />} more={gw.action} onOpen={() => put('base', base === 'common' ? null : 'common')} /> : null;
  const tools = (
    <IndustryTools>
      <span className="p6-hubtools">
        <button type="button" className="p6-chipbtn" id="xlsx-top" onClick={() => void exportBoard(d)} aria-label="הורדת Excel של הלוח">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>Excel
        </button>
        <button type="button" className="p6-chipbtn dd" id="ctx" aria-haspopup="dialog" onClick={() => sheet.openSheet('ctx')}>
          <i className="sq" style={{ background: idCss(focus) }} /><span>{setName}<span className="p6-only-d"> · {name(focus)}</span></span>
        </button>
      </span>
    </IndustryTools>
  );
  const chips = lens === 'board' ? <Chips bms={bms} m={m} fav={allIns ? FAV_INS : FAV_FUND} onPick={(k) => write({ bm: k, rd: null })} onAll={() => sheet.openSheet('metrics')} desk={desk} /> : null;
  const csmMixed = m.key === 'csm' || m.key === 'csmeq' || m.key === 'pbc' ? new Set(ents.map((e) => latestCsmBasis(book!, e)).filter(Boolean)).size > 1 : false;
  const stamp = (
    <p className="ro-stamp p6-stamp" id="stamp">
      {setName} · דוחות החברות (IFRS 17, XBRL) · כספיים <bdi dir="ltr">{qlab(q)}</bdi>{pOps && pOps !== q ? <> · רגולטור <bdi dir="ltr">{qlab(pOps)}</bdi></> : null} · שוק: סגירה <bdi dir="ltr">{dlab(pxAsof)}</bdi>
      {' '}· מכפילים הם אומדן: שווי שוק ÷ נתון מדווח{ms.some((x) => x.key === 'pbc') ? ` · CSM נטו ממס ${nf(TAX, 2)}% (הנחה)` : ''}{csmMixed ? ' · כל חברה על הבסיס שהיא מדפיסה' : ''} · <sup className="p6-n">n</sup> ליד חציון: מספר החברות שבו
      {status!.waiting.length ? ' · * נתון מרבעון מוקדם יותר' : ''} · כל מספר נפתח במקור שלו ·{' '}
      <button type="button" onClick={() => sheet.openSheet('why')} aria-haspopup="dialog">איך מחשבים?</button>
    </p>
  );

  let body;
  if (lens === 'focus') body = <FocusLens d={d} />;
  else if (lens === 'charts') body = <Suspense fallback={<Loading what="הגרפים" />}><ChartsLens d={d} /></Suspense>;
  else if (lens === 'table') body = <>{guard}<Suspense fallback={<Loading what="הטבלאות" />}><TableLens d={d} /></Suspense></>;
  else body = <BoardLens d={d} m={m} desk={desk} guard={guard} chips={desk ? null : chips} />;

  const own = sheet.own;
  return (
    <div className={`pb p6-pb${desk ? ' desk' : ''}`} data-lens={lens}>
      {tools}
      {desk ? <div className="p6-toolrow"><ViewStrip />{chips}</div> : <ViewStrip />}
      {body}
      {stamp}
      {own?.[0] === 'co' && ents.includes(own[1]) ? <CompanySheet d={d} e={own[1]} onClose={sheet.closeSheet} /> : null}
      {own?.[0] === 'metrics' ? <MetricSheet ms={bms} bm={m.key} onClose={sheet.closeSheet} /> : null}
      {own?.[0] === 'ctx' ? <ContextSheet d={d} onClose={sheet.closeSheet} /> : null}
      {own?.[0] === 'why' ? <WhySheet onClose={sheet.closeSheet} /> : null}
      {own?.[0] === 'grid' ? <GridSheet d={d} m={m} rd={rd} onClose={sheet.closeSheet} /> : null}
    </div>
  );
}
export const BOARD_KEYS = HK;

/* ---------- the metric chips: "מדד ▾" pinned first, ten favourites; a metric picked from the sheet that is not one comes first ---------- */
function Chips({ bms, m, fav, onPick, onAll, desk }: { bms: BMetric[]; m: BMetric; fav: string[]; onPick: (k: string) => void; onAll: () => void; desk: boolean }) {
  const ks = [...new Set([...(fav.includes(m.key) ? [] : [m.key]), ...fav])].filter((k) => bms.some((x) => x.key === k));
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false), [end, setEnd] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const f = () => { setOver(el.scrollWidth > el.clientWidth + 2); setEnd(Math.abs(el.scrollLeft) + el.clientWidth >= el.scrollWidth - 2); };
    f(); const ro = new ResizeObserver(f); ro.observe(el); el.addEventListener('scroll', f, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', f); };
  }, [ks.join()]);
  // a phone: the chosen chip in view
  useLayoutEffect(() => {
    const el = ref.current, on = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !on) return;
    const a = el.getBoundingClientRect(), b = on.getBoundingClientRect();
    if (b.left < a.left) el.scrollLeft -= a.left - b.left + 12; else if (b.right > a.right) el.scrollLeft += b.right - a.right + 12;
  }, [m.key]);
  const cue = () => { const el = ref.current; if (!el) return; const rtl = getComputedStyle(el).direction === 'rtl'; el.scrollBy({ left: (end ? 1 : -1) * (rtl ? 1 : -1) * el.clientWidth, behavior: 'smooth' }); };
  return (
    <div className={`p6-chipwrap${over ? ' over' : ''}${end ? ' end' : ''}`}>
      <div className="p6-chips" id="metric-chips" role="group" aria-label="מדד" ref={ref}>
        <button type="button" className="all" id="all-metrics" aria-haspopup="dialog" onClick={onAll}>מדד ▾</button>
        {ks.map((k) => { const x = bms.find((y) => y.key === k)!; return <button key={k} type="button" data-m={k} aria-pressed={k === m.key} title={x.l} onClick={() => k !== m.key && onPick(k)}>{shOf(x)}</button>; })}
      </div>
      {desk && over ? <button type="button" className="p6-chips-more" id="chips-more" aria-label={end ? 'חזרה לתחילת המדדים' : 'עוד מדדים'} onClick={cue}>{end ? '›' : '‹'}</button> : null}
    </div>
  );
}

/* ---------- the full grid of a large set, in a sheet ---------- */
function GridSheet({ d, m, rd, onClose }: { d: BoardData; m: BMetric; rd: QRead; onClose: () => void }) {
  return <DeeperSheet open onClose={onClose} title={`${shOf(m)} לאורך רבעונים`} sub={`כל ${d.ents.length} החברות`} detent="full"><FullGrid d={d} m={m} rd={rd} /></DeeperSheet>;
}
