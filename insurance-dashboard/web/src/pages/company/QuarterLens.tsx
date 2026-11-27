import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../../components/Source';
import { Icon } from '../../components/Icon';
import { GuardLine } from '../../components/GuardLine';
import { MonthGrid, type MonthGridRow } from '../../components/MonthGrid';
import { PeriodSeg } from '../../components/PeriodSeg';
import { CompanyTear } from '../CompanyTear';
import { FundHouseStrip } from '../../components/FundHouseStrip';
import { DividendCapacity } from '../../components/DividendCapacity';
import { chgProv, figText, repName as chgRep, type ChgItem, type Changes, type ChgReport } from '../../lib/changes';
import { companyStamp, companyWords, coChgHead, filerWords, waitingWords, type CoWin } from '../../lib/companyWords';
import type { FigRef, WPart } from '../../lib/peerWords';
import { readerHref } from '../../lib/search';
import { idCss } from '../../lib/identity';
import { nf, pct as pctTxt, periodLabel } from '../../lib/format';
import { shiftYear, type CompanyStore } from '../../lib/company';
import type { Prov } from '../../lib/prov';
import type { BoardCtx, Kind, ReportStatus } from '../../lib/peerBoard';
import type { Book } from '../../lib/registry';
import type { Market } from '../../lib/market';
import type { Win } from '../../lib/period';
import type { RegistryCompany } from '../../lib/types';
import { qBack, qlab } from '../../lib/quarters';
import { ROLES, endOf, figAt, figProv, headline, resolve, type Fig } from '../ReportDay';
import { calc } from '../companyProv';
import { coBoard, coCell, coSeries, gridCell, gridKeys, gridNote, npPct, placeOf, rowDef, rowsFor, wordsChgProv, wordsIn, type CoFig, type CoKey, type GridRead } from './rows';
import { PeerStrip } from './PeerStrip';
import '../../styles/company-p6.css';

/** Everything a lens of the company overview reads (built once by the shell, CompanyOverview). */
export interface CoData {
  entry: RegistryCompany; kind: Kind; phone: boolean;
  /** the company's peer set (the board's "7 המבטחות" / "בתי השקעות") and its name */
  ents: string[]; setName: string;
  book: Book; status: ReportStatus; ctx: BoardCtx;
  /** the quarter on screen ("2026Q3"; an annual report is its Q4) and the report key ("2026Q3", "2025FY"; '' without statements) */
  q: string; P: string; win: Win;
  store: CompanyStore | null; market: Market | null;
  ch: Changes | null; chr: ChgReport | null;
  /** the company has not reported the quarter the set has (5.5) */
  waiting: boolean;
  /** calendar.json: the expected date of the missing report */
  expected: { date: string; est?: boolean } | null;
  filer: { name: string; stake: number; note?: string } | null;
  /** the address writers of the shell */
  setLens: (cl: string) => void; put: (patch: Record<string, string | null>) => void; openSheet: (s: string) => void;
}

/* ---------- small parts ---------- */
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const toneCls = (v: number | null | undefined) => (!fin(v) || Math.abs(v) < 1e-9 ? '' : v > 0 ? ' pos' : ' neg');
/** a figure of the company table or grid: its source in one tap; a dash with its reason */
export function Num({ f, className = '' }: { f: CoFig; className?: string }) {
  if (!fin(f.v)) return <span className="muted co6-na" title={f.why}>–</span>;
  return <Sourced src={f.prov} className={`co6-n${f.tone ? toneCls(f.v) : ''} ${className}`.trim()}>{f.text}</Sourced>;
}
/** the eight quarters as a line (desktop table and the row sheet) */
export function Spark({ vals, color, w = 64, h = 20 }: { vals: (number | null)[]; color: string; w?: number; h?: number }) {
  const ok = vals.filter(fin);
  if (ok.length < 2) return null;
  const lo = Math.min(...ok), hi = Math.max(...ok), dx = (w - 2) / Math.max(1, vals.length - 1);
  const d = vals.map((y, i) => (fin(y) ? `${i && fin(vals[i - 1]) ? 'L' : 'M'}${(1 + i * dx).toFixed(1)} ${(h - 2 - ((y - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}` : '')).join('');
  return <svg className="co6-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}
/** a sentence of parts: every figure one LTR unit (N4), tappable to its source; a median's n as a superscript */
export function Words({ parts, src, ids }: { parts: WPart[]; src: (r: FigRef) => (() => Prov) | null; ids?: Partial<Record<string, string>> }) {
  return <>{parts.map((p, i) => {
    if (p.k === 't') return <span key={i}>{p.s}</span>;
    if (p.k === 'b') return <b key={i}>{p.s}</b>;
    if (p.k === 'basis') return <span key={i} className="co6-basis">{p.s}</span>;
    if (p.k === 'tag') return <span key={i}>{' '}<span className="chip est co6-tag">{p.s}</span></span>;
    const s = p.ref ? src(p.ref) : null, id = p.ref && p.ref.k === 'co' ? ids?.[p.ref.f] : undefined;
    const fig = s ? <Sourced src={s} className={`co6-wn${p.tone ? ` ${p.tone}` : ''}`}>{p.s}</Sourced> : <span className="num">{p.s}</span>;
    return <span key={i} className="co6-u" dir="ltr" id={id}>{p.pre}{fig}{p.sup != null ? <sup className="p6-n">{p.sup}</sup> : null}{p.post}</span>;
  })}</>;
}

/** "Excel" (13.1 F4, 14.1 N10): the company workbook to the report on screen, built in the browser (quarters with LTM = SUM and YoY
 *  formulas, the ranked changes, solvency, then the shipped statements), named after the report: fox-harel-2026Q3.xlsx. One tap. */
export function XlsxChip({ id, report, company = 'xlsx-co', className = 'co6-chip', label = 'Excel' }: { id: string; report: string; company?: string; className?: string; label?: string }) {
  const [st, setSt] = useState<string | null>(null);
  const run = async () => {
    if (st) return;
    setSt('מכין…');
    try { const { exportCompany } = await import('../../lib/exportCompany'); await exportCompany(id, (s) => setSt(`${s}…`), { report: report || undefined }); setSt(null); }
    catch { setSt('שגיאה'); setTimeout(() => setSt(null), 2000); }
  };
  return <button type="button" className={`${className} co6-xl`} id={company} onClick={() => void run()} aria-busy={!!st} title="חוברת Excel: הרבעונים עם נוסחאות LTM ו-YoY, השינויים, כושר פירעון והדוחות, כל ערך מקושר לעמוד שלו"><Icon name="download" size={14} />{st ?? label}</button>;
}

/* ---------- the sentence (5.3) ---------- */
/** the window of the report sheet (?w=) as the sentence's window: LTM; 9M for a third-quarter report read on its year to date
 *  (other cumulative windows, H1 and FY, keep the quarter's sentence: companyWords names only 9M and LTM) */
function sentenceWin(co: CoData): CoWin {
  if (co.win === 'ltm') return 'ltm';
  return co.win === 'ytd' && co.P.endsWith('Q3') && co.store ? '9m' : 'q';
}
/** the figure of a statement line, as the sentence reads it (ReportDay's resolver; millions) */
const figFig = (f: Fig | null, t: string, p: string): CoFig => (f ? { v: kv(f), text: nf(kv(f), 0), prov: () => figProv(f, t, p) } : { v: null, text: '–', prov: () => ({ k: 'none', title: t, why: 'אין נתון' }) });
function Sentence({ co, noTop = false }: { co: CoData; noTop?: boolean }) {
  const { book, kind, entry, q, ents, chr, ch } = co;
  const win = sentenceWin(co);
  const w = useMemo(() => {
    const base = wordsIn(book, kind, entry.id, q, ents);
    if (win === 'ltm') {
      const r = rowDef(kind, 'np');
      return { ...base, np: coCell(book, r, entry.id, kind, q, 'ltm', ents), npY: coCell(book, r, entry.id, kind, qBack(q, 4), 'ltm', ents), la: `LTM ${qlab(q)}`, lb: `LTM ${qlab(qBack(q, 4))}` };
    }
    if (win === '9m' && co.store) {
      const rows = resolve(co.store, ROLES.find((x) => x.key === 'net')!).rows, end = endOf(co.P);
      const la = `9M'${q.slice(2, 4)}`, lb = `9M'${String(Number(q.slice(0, 4)) - 1).slice(2)}`;
      return { ...base, np: figFig(figAt(co.store, rows, '9M', end), 'רווח נקי לבעלי המניות', la), npY: figFig(figAt(co.store, rows, '9M', shiftYear(end, -1)), 'רווח נקי לבעלי המניות', lb), la, lb };
    }
    return { ...base, la: qlab(q), lb: qlab(qBack(q, 4)) };
  }, [book, kind, entry.id, q, ents, win, co.store, co.P]);
  const top: ChgItem | null = !noTop && win === 'q' && chr && chr.p === co.P ? chr.items[0] ?? null : null;
  const parts = companyWords({ q, win, np: w.np.v, npY: w.npY.v, npQ: w.npQ.v, roe: w.roe.v,
    top: top ? { l: top.l, d: top.d.v, cmp: top.cmp, u: top.d.u === 'pp' ? 'pp' : undefined } : null });
  if (!parts) return null;
  const text = (f: string) => (parts.find((p) => p.k === 'n' && p.ref?.k === 'co' && p.ref.f === f) as { s: string } | undefined)?.s ?? '';
  const src = (r: FigRef): (() => Prov) | null => {
    if (r.k !== 'co') return null;
    if (r.f === 'np') return w.np.prov;
    if (r.f === 'roe') return w.roe.prov;
    if (r.f === 'top') return top && ch ? () => chgProv(ch, top.d, top.l, `${top.la} מול ${top.lb}`) : null;
    const y = r.f === 'npy', b = y ? w.npY : w.npQ, la = y ? w.la : qlab(q), lb = y ? w.lb : qlab(qBack(q, 1));
    return () => wordsChgProv(`רווח נקי ${y ? 'YoY' : 'QoQ'} · ${book.name(entry.id)}`, text(r.f), w.np, b, la, lb, npPct(w.np.v, b.v) != null);
  };
  return <Words parts={parts} src={src} ids={{ npy: 'pair-yoy', npq: 'pair-qoq', roe: 'pair-roe' }} />;
}

/* ---------- the company table (5.2 item 6, 5.4, 13.1 F6) ---------- */
function QuarterTable({ co }: { co: CoData }) {
  const { book, kind, entry, q, ents, ctx, phone } = co, e = entry.id;
  const rows = rowsFor(kind);
  return (
    <table className="co6-qt" id="quarter-table">
      <thead><tr>
        <th scope="col" className="l">מיליוני ש"ח</th>
        <th scope="col">{qlab(q)}</th>
        <th scope="col">YoY<small>{coChgHead(q, 'yoy')}</small></th>
        <th scope="col">QoQ<small>{coChgHead(q, 'qoq')}</small></th>
        <th scope="col">LTM</th>
        {!phone && <th scope="col" className="wide">8 רבעונים</th>}
        {!phone && <th scope="col" className="wide">מקום ב-{ents.length}</th>}
      </tr></thead>
      <tbody>{rows.map((r) => {
        const v = coCell(book, r, e, kind, q, 'v', ents);
        const raw = r.k === 'csm' ? (book.raw('ifrs:csm_closing', e, q) as unknown[] | undefined)?.[5] : undefined;
        const tag = r.k === 'csm' && typeof raw === 'string' ? raw.split('; ')[0] : r.k === 'sr' && v.p ? qlab(v.p).replace(/^Q2/, 'H1').replace(/^Q4/, 'FY') : null;
        const pl = !phone && r.board ? placeOf(coBoard(ctx, r.board), e) : null;
        return (
          <tr key={r.k} data-k={r.k}>
            <th scope="row" className="l">
              <button type="button" className="co6-rowbtn" onClick={() => co.openSheet(`row:${r.k}`)} aria-haspopup="dialog">{r.l} <span aria-hidden="true">›</span></button>
              {tag ? <span className={`chip co6-tag${r.k === 'sr' ? ' est' : ''}`} title={r.k === 'sr' ? 'יחס כושר פירעון, ללא הוראות מעבר: מתפרסם לחציונים ולשנים' : 'בסיס ה-CSM כפי שהודפס'}>{tag}</span> : null}
            </th>
            <td className="v"><Num f={v} /></td>
            <td><Num f={coCell(book, r, e, kind, q, 'yoy', ents)} /></td>
            <td><Num f={coCell(book, r, e, kind, q, 'qoq', ents)} /></td>
            <td><Num f={coCell(book, r, e, kind, q, 'ltm', ents)} /></td>
            {!phone && <td className="wide"><Spark vals={coSeries(book, r, e, kind, q, ents).map((x) => x.v.v)} color={idCss(e)} /></td>}
            {!phone && <td className="wide co6-pl" title={pl?.star ? `טרם דווח על ${qlab(ctx.q)}: לפי הדוח האחרון, מסומן ונספר` : undefined}>{pl?.text ?? ''}</td>}
          </tr>
        );
      })}</tbody>
    </table>
  );
}

/* ---------- the ranked changes (lens שינויים, and the top five on the desktop first screen) ---------- */
const shown = (f: { u: string; v: number }, t: string) => (f.u === 'm' || f.u === 'dm' ? t.replace(/\.0$/, '') : t);
export function ChangeList({ d, r, n, id = 'changes' }: { d: Changes; r: ChgReport; n?: number; id?: string }) {
  const items = n ? r.items.slice(0, n) : r.items;
  if (!items.length) return <p className="muted co6-none">אין בדוח שינוי מעל סף המהותיות.</p>;
  const stock = (it: ChgItem) => it.g === 'ifrs' && it.k === 'csm';
  const page = (it: ChgItem) => { const s = it.a.s; if (s.k === 'pg' && s.rid && s.pg) return <Link className="co6-pg" to={readerHref(s.rid, s.pg)}>עמ׳ <span className="num">{s.pg}</span></Link>;
    const f = s.in?.find((x) => x.s.k === 'pg'); return f?.s.rid && f.s.pg ? <Link className="co6-pg" to={readerHref(f.s.rid, f.s.pg)}>נגזר · עמ׳ <span className="num">{f.s.pg}</span></Link> : <span className="muted">{s.k === 'xbrl' ? 'XBRL' : 'נגזר'}</span>; };
  return (
    <ol className="co6-chg" id={id}>{items.map((it, i) => (
      <li key={it.k} className="chg" data-i={i}>
        <span className="place num" aria-hidden="true">{i + 1}</span>
        <span className="l">
          <span className="t">{it.l}</span>
          {it.rest && <Sourced src={() => chgProv(d, it.rest!, it.l, it.lb, 'כפי שדווח לראשונה')} className="chip est rst" title={`הוצג מחדש: במקור ${figText(it.rest)}`}>הוצג מחדש</Sourced>}
          <small className="meta"><span className="num" dir="ltr">{it.pl}</span> · <Sourced src={() => chgProv(d, it.b, it.l, it.lb, undefined, stock(it))}>{shown(it.b, figText(it.b))}</Sourced>
            <span aria-hidden="true"> ← </span><Sourced src={() => chgProv(d, it.a, it.l, it.la, undefined, stock(it))}>{shown(it.a, figText(it.a))}</Sourced> · {page(it)}</small>
        </span>
        <span className={`d${it.gd > 0 ? ' pos' : it.gd < 0 ? ' neg' : ''}`}>
          <Sourced src={() => chgProv(d, it.d, it.l, `${it.la} מול ${it.lb}`)} className="co6-n">{shown(it.d, figText(it.d))}</Sourced>
          {it.dp && <Sourced src={() => chgProv(d, it.dp!, it.l, `${it.la} מול ${it.lb}`)} className="dp">{figText(it.dp)}</Sourced>}
        </span>
      </li>
    ))}</ol>
  );
}

/* ---------- the quarters grid (lens רבעונים; desktop second row) ---------- */
const CP_ROWS: GridRead[] = ['q', 'yoy', 'qoq', 'ltm'];
export const parseCp = (s: string | null): GridRead => (CP_ROWS.includes(s as GridRead) ? (s as GridRead) : 'q');
const COLS_HE: Partial<Record<CoKey, string>> = { np: 'רווח נקי', isr: 'רווח משירותי ביטוח', comp: 'רווח כולל', csm: 'CSM', eq: 'הון', rev: 'הכנסות', nm: 'שולי רווח', aum: 'נכסים מנוהלים' };
export function QuarterGridPanel({ co, cp, id = 'quarter-grid', segId = 'period-seg', n = 8 }: { co: CoData; cp: GridRead; id?: string; segId?: string; n?: number }) {
  const { book, kind, entry, q, ents } = co, e = entry.id, keys = gridKeys(kind);
  const qs = Array.from({ length: n }, (_, i) => qBack(q, i));
  const cells = useMemo(() => qs.map((x) => keys.map((k) => gridCell(book, kind, k, e, x, cp, ents))), [book, kind, e, cp, ents, q]);  // eslint-disable-line react-hooks/exhaustive-deps
  const rows: MonthGridRow[] = qs.map((x, i) => ({ key: x, vals: cells[i].map((f) => (fin(f.v) ? f.v : null)), why: cells[i].map((f) => f.why ?? null) }));
  const at = (rk: string, k: string | null) => { const i = qs.indexOf(rk), j = keys.indexOf(k as CoKey); return i >= 0 && j >= 0 ? cells[i][j] : null; };
  return (
    <section className="panel co6-panel co6-grid" aria-labelledby={`${id}-h`}>
      <div className="co6-ph"><h2 id={`${id}-h`}>{n} רבעונים <small className="co6-gn">· {gridNote(cp)}</small></h2><PeriodSeg mode="quarter" value={cp} onChange={(r) => co.put({ cp: r === 'q' ? null : r })} quarter={q} periods={CP_ROWS} id={segId} /></div>
      <MonthGrid kind="quarters" id={id} cols={keys.map((k) => ({ k, label: COLS_HE[k] ?? k, color: 'var(--line)' }))} rows={rows}
        heat={cp === 'yoy' || cp === 'qoq' ? 'sign' : 'none'} format={(v, i) => (i < 0 ? '' : fmtGrid(v, keys[i], cp, kind))}
        unit={cp === 'ltm' ? 'LTM' : 'רבעון'} cur={q} data={{ reading: cp }}
        renderCell={(rk, k) => { const f = at(rk, k); return f && fin(f.v) ? <Sourced src={f.prov}>{f.text}</Sourced> : null; }} />
    </section>
  );
}
function fmtGrid(v: number, k: CoKey, cp: GridRead, kind: Kind): string {
  const r = rowDef(kind, k);
  if (cp === 'yoy' || cp === 'qoq') return r.m.u === 'pct' ? `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), 1)} נק׳` : `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), 1)}%`;
  return r.m.u === 'pct' ? `${nf(v, 1)}%` : nf(v, r.m.u === 'bn' ? 1 : 0);
}

/* ---------- all the report's lines, with LTM (folded under "כל השורות ›") ---------- */
const kv = (f: Fig) => (f.unit === 'k' ? f.v / 1e3 : f.v);
function Delta({ a, b, t, la, lb }: { a: Fig | null; b: Fig | null; t: string; la: string; lb: string }) {
  if (!a || !b) return <span className="muted">–</span>;
  if (a.std && b.std && a.std !== b.std) return <span className="muted" title="IFRS 17 מול IFRS 4: אינם בני השוואה">תקן שונה</span>;
  const pos = a.v > 0 && b.v > 0, x = pos ? (a.v / b.v - 1) * 100 : kv(a) - kv(b);
  const txt = pos ? pctTxt(Number(x.toFixed(1)) || 0, 1, true) : `${x > 0 ? '+' : x < 0 ? '−' : ''}${nf(Math.abs(x), 0)} מ׳`;
  return <Sourced src={() => calc(`${t} · ${la} מול ${lb}`, txt, pos ? `${la} ÷ ${lb} − 1` : `${la} − ${lb}`, [[a, la], [b, lb]].map(([f, l]) => ({ label: l as string, v: nf(kv(f as Fig), 1), src: () => figProv(f as Fig, t, l as string) })), pos ? '%' : 'מיליוני ש"ח')}
    className={`co6-n${toneCls(x)}`}>{txt}</Sourced>;
}
function FigV({ f, t, p }: { f: Fig | null; t: string; p: string }) {
  if (!f) return <span className="muted">–</span>;
  return <Sourced src={() => figProv(f, t, p)} className={f.der ? 'der' : undefined}>{f.unit === 'pct' ? `${nf(f.v, 1)}%` : nf(kv(f), f.unit === 'nis' ? 2 : 0)}</Sourced>;
}
function AllLines({ co }: { co: CoData }) {
  const { store, P } = co;
  const end = P ? endOf(P) : '';
  const W: Win = P.endsWith('Q1') ? 'q' : co.win === 'ltm' ? 'ltm' : co.win === 'ytd' ? 'ytd' : 'q';
  const head = useMemo(() => (store && end ? headline(store, end, W) : null), [store, end, W]);
  if (!head || !head.rows.length) return null;
  const T = W === 'ytd' ? ({ '03-31': 'Q', '06-30': 'H', '09-30': '9M', '12-31': 'FY' } as Record<string, string>)[end.slice(5)] : 'Q', L = W === 'ltm' ? 'LTM ' : '';
  const cur = L + periodLabel(T, end), yo = L + periodLabel(T, shiftYear(end, -1)), qo = `${L}${periodLabel('Q', endOf(qBack(co.q, 1)))}`;
  return (
    <div className="scroll"><table className="co6-all">
      <thead><tr><th scope="col">שורה</th><th scope="col">{cur}</th><th scope="col">YoY<small>מול {yo}</small></th><th scope="col">QoQ<small>מול {qo}</small></th>{W !== 'ltm' && <th scope="col">LTM<small>YoY</small></th>}</tr></thead>
      <tbody>{head.rows.map((r) => (
        <tr key={r.key}><th scope="row">{r.label}{r.note ? <span className="chip est co6-tag" title={r.note[1]}>{r.note[0]}</span> : null}</th>
          <td><FigV f={r.cur} t={r.label} p={cur} /></td><td><Delta a={r.cur} b={r.yoy} t={r.label} la={cur} lb={yo} /></td><td><Delta a={r.cur} b={r.qoq} t={r.label} la={cur} lb={qo} /></td>
          {W !== 'ltm' && <td><FigV f={r.ltm} t={r.label} p={`LTM ${qlab(co.q)}`} /> <small><Delta a={r.ltm} b={r.ltmPrev} t={r.label} la={`LTM ${qlab(co.q)}`} lb={`LTM ${qlab(qBack(co.q, 4))}`} /></small></td>}
        </tr>
      ))}</tbody>
    </table>
    {head.missing.length > 0 && <p className="co6-note">לא אותרו בדוח לתקופה זו: {head.missing.join(', ')}.</p>}</div>
  );
}

/** the stamp under the table (5.2 item 7) */
export function CoStamp({ co }: { co: CoData }) {
  const pub = co.chr?.pub ?? null, pages = co.chr?.pages ?? null;
  // each part isolated right-to-left, so "YoY מול Q3'25, QoQ מול Q2'26" never runs into its neighbours
  return <p className="co6-stamp" id="stamp">{companyStamp({ name: co.entry.name_he, q: co.q, pub, pages }).split(' · ').map((x, i) => <span key={i}><bdi dir="rtl">{x}</bdi> · </span>)}<Link to="/methodology#peers">איך מחשבים?</Link></p>;
}

/** Lens הרבעון (default, `cl=q`): the sentence and the seven rows on the first screen; on the desktop, the top five changes, the eight
 *  quarters and the place among peers beside them (5.4); every other line of the report folded under "כל השורות ›". */
export function QuarterLens({ co, cp }: { co: CoData; cp: GridRead }) {
  const { entry, kind, phone, chr, ch } = co;
  const [all, setAll] = useState(false);
  const fund = kind === 'fund';
  const hasRows = rowsFor(kind).some((r) => fin(coCell(co.book, r, entry.id, kind, co.q, 'v', co.ents).v));
  // B1 item 5: on a phone the waiting notice is the sentence's lead ("Q3'26 טרם פורסם, צפוי 28.11.26 (אומדן) · Q2'26: …"), not a block of
  // its own: the block took 75 px and pushed the seventh row (solvency) under the bottom bar. The sentence goes on with the quarter shown
  const waitParts = co.waiting ? waitingWords({ bq: co.status.bq, q: co.q, pub: chr?.p === co.P ? chr?.pub : null, reported: co.status.reported.length, total: co.status.n,
    setWord: fund ? 'בתי ההשקעות' : 'המבטחות', expected: co.expected }) : null;
  const [wopen, setWopen] = useState(false);
  // B1 item 5: on a phone the waiting notice is one line at the foot of the sentence card (the whole text, cut with "…"; a tap shows it all),
  // not a block of its own: the block took 75 px and pushed the seventh row (solvency) under the bottom bar
  const lead = waitParts && phone && hasRows ? (
    <button type="button" className={`co6-wait1${wopen ? ' open' : ''}`} id="guard" aria-expanded={wopen} onClick={() => setWopen(!wopen)}>
      <Words parts={waitParts} src={() => null} />
    </button>
  ) : null;
  const guard: ReactNode = co.waiting && !lead ? (
    <GuardLine kind="risk" id="guard" wrap text={<Words parts={waitParts!} src={() => null} />} />
  ) : null;
  return (
    <div className="co6-lens" data-lens="q">
      {co.filer && <p className="co6-filer" title={co.filer.note}>{filerWords(co.filer.name, co.filer.stake)}</p>}
      {/* a waiting company on a phone: the notice's line takes the place of the top-change clause (it stays one tap away in שינויים), so
          the card keeps its three lines and the seven rows stay above the bottom bar */}
      {hasRows && <div className="co6-take" id="takeaway"><div className="co6-sent"><Sentence co={co} noTop={!!lead} /></div>{lead ? <> {lead}</> : null}</div>}
      {guard}
      {hasRows ? (
        <div className="co6-g2">
          <section className="panel co6-panel" aria-labelledby="qt-h">
            <div className="co6-ph"><h2 id="qt-h">עיקרי הדוח · <span className="num">{qlab(co.q)}</span></h2>
              <Link className="co6-chip" to={`/industry/peers?hl=${entry.id}&lens=focus`}>מול העמיתים ›</Link></div>
            <QuarterTable co={co} />
          </section>
          {!phone && ch && chr && (
            <section className="panel co6-panel" aria-labelledby="top-h">
              <div className="co6-ph"><h2 id="top-h"><span className="num">{chr.n}</span> שינויים <small>· מדורג לפי מהותיות</small></h2>
                <button type="button" className="co6-chip" onClick={() => co.setLens('chg')}>הכול ›</button></div>
              <ChangeList d={ch} r={chr} n={5} id="changes-top" />
            </section>
          )}
        </div>
      ) : entry.has_financials ? <p className="muted co6-none">הנתונים מהדוחות טרם חולצו.</p> : null}
      {hasRows && !phone && (
        <div className="co6-g2">
          <QuarterGridPanel co={co} cp={cp} id="quarter-grid-d" segId="period-seg-d" />
          <PeerStrip co={co} />
        </div>
      )}
      {fund && <FundHouseStrip id={entry.id} name={entry.name_he} market={co.market} group={entry.market_group} />}
      {!entry.has_financials && !fund && <><CompanyTear id={entry.id} /><DividendCapacity id={entry.id} /></>}
      {(hasRows || (co.store && co.P)) && (
        <section className="co6-fold">
          <div className="co6-foot">
            {co.store && co.P && <button type="button" className="co6-more" aria-expanded={all} onClick={() => setAll((x) => !x)}>{all ? 'פחות ‹' : <>כל השורות של הדוח <span className="num">{chgRep(co.P)}</span> ›</>}</button>}
            {hasRows && <CoStamp co={co} />}
          </div>
          {all && <AllLines co={co} />}
        </section>
      )}
    </div>
  );
}
