import { Fragment, useMemo, type ReactNode } from 'react';
import { MonthGrid, plain, RowsSeg, signed } from '../../components/MonthGrid';
import { PeriodSeg } from '../../components/PeriodSeg';
import { Scoreboard, type ScoreRowData } from '../../components/Scoreboard';
import { Sourced } from '../../components/Source';
import { Takeaway } from '../../components/Takeaway';
import { idCss } from '../../lib/identity';
import type { Prov } from '../../lib/prov';
import { ctxOf, type BoardData } from './exportBoard';
import {
  basisShort, basisText, boardRows, chgKind, closeAt, fmtB, fmtRead, latestCsmBasis, medianProv, quarterGrid, quarterNamed, shOf, unitRead,
  type BMetric, type BoardOut, type GridRow,
} from '../../lib/peerBoard';
import { closeRuleWords, daggerNote, medWords, outHead, peersWords, rowTag, starNote, toneOf, type FigRef, type WPart } from '../../lib/peerWords';
import { dlab, isChg, qlab, readLabel, type QRead } from '../../lib/quarters';
import { Matrix } from './Matrix';
import '../../styles/p6.css';
import '../../styles/peerboard.css';

/* The board lens of /industry/peers (spec p6 §3.2, §3.5, §13.1–13.2, §14.1, §14.3): one metric for the whole group. The metric chip and
   the reading (PeriodSeg, quarter mode) are the whole state; the sentence above (lib/peerWords), the ranked track board (Scoreboard
   layout="track"), the partial-quarter line (the shell's), the quarters grid (MonthGrid kind="quarters") under it. Desktop (≥ 1000 px):
   two columns 2 : 1, the companies × metrics matrix with the grid under it at the start, the board at the end. Every figure is drawn
   through <Sourced> from the same lib/peerBoard call that computed it (board rows, the sentence, every median with its n and parts, grid
   cells with their quarter-end close); a company's name or place opens the company sheet. */

/** Everything the shell computes once and every lens reads: lane P6-2b's `BoardData` (pages/peers/exportBoard), and its `ctxOf` */
export type { BoardData };
export { ctxOf };

/* ---------- a sentence of parts (lib/peerWords): every figure one LTR unit, tappable to its source ---------- */
export type RefSrc = (r: FigRef, i: number) => (() => Prov) | null | undefined;
export function Words({ parts, src }: { parts: WPart[]; src: RefSrc }) {
  // the punctuation right after a figure stays on its line (a break between the isolate and its "." or "," is otherwise allowed)
  const glue = parts.map((p, i) => { const nx = parts[i + 1]; return p.k === 'n' && nx?.k === 't' ? /^[.,;:)]+/.exec(nx.s)?.[0] ?? '' : ''; });
  return (
    <>
      {parts.map((p, i) => {
        const pre = i > 0 ? glue[i - 1] : '';
        if (p.k === 't') { const s = pre ? p.s.slice(pre.length) : p.s; return s ? <Fragment key={i}>{s}</Fragment> : null; }
        if (p.k === 'b') return <b key={i}>{p.s}</b>;
        if (p.k === 'basis') return <span key={i} className="p6-basis-in">{p.s}</span>;
        if (p.k === 'tag') return <span key={i} className="p6-tag">{p.s}</span>;
        const s = p.ref ? src(p.ref, i) : null, tone = p.tone ? ` ${p.tone}` : '';
        const unit = (
          <bdi dir="ltr" className={`p6-u${tone}`}>
            {p.pre}{s ? <Sourced className={`num p6-wn${tone}`} src={s}>{p.s}</Sourced> : <span className="num">{p.s}</span>}{p.sup != null ? <sup className="p6-n">{p.sup}</sup> : null}{p.post}
          </bdi>
        );
        return glue[i] ? <span key={i} className="p6-nw">{unit}{glue[i]}</span> : <Fragment key={i}>{unit}</Fragment>;
      })}
    </>
  );
}
/** the source of a board figure in a sentence */
export const boardSrc = (b: BoardOut, name: (e: string) => string): RefSrc => (r) =>
  r.k === 'row' ? b.rows.find((x) => x.e === r.e)?.val.prov : r.k === 'med' ? () => medianProv(b, name) : null;

/** the median of a grid row as a source: its n components and the rule */
export function gridMedProv(m: BMetric, rd: QRead, row: GridRow, name: (e: string) => string): Prov {
  const pseudo = { m, rd, q: row.q, rows: row.cells.map((c) => ({ e: c.e, val: c.val })), med: row.med, strict: quarterNamed(m, rd), n: row.med.n } as unknown as BoardOut;
  return medianProv(pseudo, name);
}

/** a grid figure: a level as printed (no unit; the unit is in the head), a change signed */
export function gridFmt(m: BMetric, rd: QRead): (v: number) => string {
  if (isChg(rd)) { const k = chgKind(m); return (v) => signed(v, k === 'pct' ? 1 : k === 'pts' ? (m.u === 'x' || m.dec >= 2 ? 2 : 1) : m.dec); }
  return (v) => (m.diff ? signed(v, m.dec) : plain(v, m.u === 'm' ? 0 : m.dec));
}

/** a board row's figure, sourced, toned when it is a change or a return */
function BoardVal({ b, e }: { b: BoardOut; e: string }) {
  const r = b.rows.find((x) => x.e === e)!;
  if (r.v == null || !Number.isFinite(r.v)) return <span className="num mut" title={r.val.why ?? 'אין נתון'}>–</span>;
  const tone = isChg(b.rd) || b.m.u === 'pctx' ? toneOf(r.v) : null;
  return <Sourced className={`num${tone ? ` ${tone}` : ''}`} src={r.val.prov}>{fmtRead(b.m, b.rd, r.v)}{r.dag ? '†' : ''}</Sourced>;
}

/** the robust span of the ranked figures (median ± 3 × MAD, as the positioning map): a figure outside it pins at the edge, tagged "חריג" */
function robust(b: BoardOut): { range?: [number, number]; out: Set<string> } {
  const xs = b.rows.filter((r) => !r.out && r.v != null && Number.isFinite(r.v)).map((r) => r.v!), md = b.med.v;
  if (xs.length < 4 || md == null) return { out: new Set() };
  const mad = xs.map((x) => Math.abs(x - md)).sort((a, c) => a - c)[Math.floor(xs.length / 2)] || 0;
  if (!mad) return { out: new Set() };
  const lo = Math.max(Math.min(...xs), md - 3 * mad), hi = Math.min(Math.max(...xs), md + 3 * mad);
  const out = new Set(b.rows.filter((r) => !r.out && r.v != null && (r.v < lo - 1e-9 || r.v > hi + 1e-9)).map((r) => r.e));
  return out.size ? { range: [lo, hi], out } : { out };
}

/* ---------- the board panel ---------- */
export function BoardPanel({ d, m, b, onCo }: { d: BoardData; m: BMetric; b: BoardOut; onCo: (e: string) => void }) {
  const { book } = d, rd = b.rd, name = (e: string) => book.short(e);
  const reads = m.reads ?? [];
  const rb = robust(b);
  const rows: ScoreRowData[] = b.rows.map((r) => {
    const t = rowTag(r, m), has = r.v != null && Number.isFinite(r.v);
    const tag = t ? (t.warn && !r.out ? <i className="p6-w">{t.s}</i> : t.s) : rb.out.has(r.e) ? 'חריג' : undefined;
    return { k: r.e, label: book.short(r.e), color: idCss(r.e), value: has ? r.v : null, place: r.place, tag, mine: r.e === d.focus, out: r.out };
  });
  const med = medWords(b);
  const unit = unitRead(m, rd);
  return (
    <section className="panel p6-bp" aria-label={`לוח: ${m.l}`}>
      <div className="p6-bp-hd">
        <h2>{m.l} <small>· {unit}</small></h2>
      </div>
      <div className="p6-bhead">
        {reads.length > 1
          ? <PeriodSeg mode="quarter" value={rd} onChange={(r) => d.put('rd', r === reads[0] ? null : r)} quarter={b.q} periods={reads} />
          : <span className="p6-tag" id="basis-tag">{m.type === 'spot' ? `סגירת ${dlab(d.pxAsof)}` : m.type === 'half' ? 'דוח כושר פירעון אחרון' : m.type === 'fy' ? 'שנתי' : qlab(b.q)} · {unit}</span>}
        <span className="p6-sp" />
        <span className="p6-medline" id="board-median">{med ? <Words parts={med} src={boardSrc(b, name)} /> : <span className="mut">חציון: פחות משתי חברות</span>}</span>
      </div>
      {isChg(rd)
        ? <p className="p6-basis" id="basis">{basisText(m, rd, b.q)} · {unit}{b.strict ? ` · בדירוג ובחציון: רק מי שדיווח ${qlab(b.q)}` : ''}</p>
        : reads.length > 1 ? <p className="p6-basis" id="basis">{m.l}{m.type === 'flow' || m.fr ? `, ${readLabel(rd, b.q)}` : ''} · {unit}</p> : null}
      <Scoreboard layout="track" id="board" rows={rows} benchmark={{ label: null, value: b.med.v, line: true }} onOpen={onCo} mineWord={null} range={rb.range}
        format={(v) => fmtRead(m, rd, v)} cell={(r) => <BoardVal b={b} e={r.k} />} outHead={outHead(b.q)}
        data={{ metric: m.key, reading: rd }} label={`${shOf(m)}: דירוג החברות`} />
    </section>
  );
}

/* ---------- the quarters grid ---------- */
export function GridPanel({ d, m, rd, id = 'quarter-grid' }: { d: BoardData; m: BMetric; rd: QRead; id?: string }) {
  const { book } = d, name = (e: string) => book.short(e);
  const gq = d.get('gq') === '12' ? 12 : 6;
  const spot = m.type === 'spot', hasGrid = spot ? !!m.hist?.[d.major] : m.type !== 'ret' && m.type !== 'half' && m.type !== 'fy';
  const ctx = useMemo(() => ctxOf(d), [d]);
  const rows = useMemo(() => (hasGrid ? quarterGrid(ctx, m, rd, gq) : []), [ctx, m, rd, gq, hasGrid]);
  if (!hasGrid) {
    return (
      <section className="panel p6-gp">
        <p className="mut p6-none" id={`${id}-none`}>{m.type === 'ret' ? 'תשואה כוללת לאורך זמן: בעדשת "גרפים", בסיס 100.' : m.type === 'half' ? `${m.sh} מתפרסם פעמיים בשנה; הרצף בדף החברה, בעדשת "הון".`
          : m.type === 'fy' ? `${m.sh} מתפרסם פעם בשנה; הרצף בדף החברה.` : 'למדד אין רצף רבעוני.'}</p>
      </section>
    );
  }
  // sets above seven: the focus and the six largest by market value; the full grid in a sheet
  const many = d.ents.length > 7;
  const cols = many ? [d.focus, ...d.order.filter((e) => e !== d.focus).slice(0, 6)].sort((a, b) => d.order.indexOf(a) - d.order.indexOf(b)) : d.ents;
  const ci = cols.map((e) => d.ents.indexOf(e));
  const f = gridFmt(m, spot ? 'now' : rd), rr: QRead = spot ? 'now' : rd;
  const daggers = rows.flatMap((r) => r.cells.filter((c) => c.dag).map((c) => c.e));
  const anyStar = rows.some((r) => r.cells.some((c) => c.star));
  const byQ = new Map(rows.map((r) => [r.q, r]));
  const close = spot && rows[0] ? (() => {
    const q = rows[0].q, qc = closeAt(d.mk, d.focus, q) ?? d.ents.map((e) => closeAt(d.mk, e, q)).find(Boolean) ?? null;
    if (!qc) return null;
    const gc = rows[0].cells.find((c) => c.e === d.focus), bo = boardRows(ctx, m, 'now').rows.find((r) => r.e === d.focus);
    const parts = closeRuleWords({ q, qClose: qc, lastClose: d.pxAsof, e: d.focus, name: book.short(d.focus), grid: gc?.v != null ? fmtB(m, gc.v) : null, board: bo?.v != null ? fmtB(m, bo.v) : null });
    return <p className="p6-basis p6-close" id={`${id}-close`}><Words parts={parts} src={(r) => (r.k === 'grid' ? byQ.get(r.q)?.cells.find((c) => c.e === r.e)?.val.prov : r.k === 'row' ? bo?.val.prov : null)} /></p>;
  })() : null;
  const sub = spot ? 'סגירת סוף רבעון ÷ נתון מדווח' : isChg(rd) ? `${basisShort(m, rd, d.q)} · ${unitRead(m, rd)}` : unitRead(m, rd);
  const latest = m.key === 'csm' || m.key === 'csmeq' || m.key === 'pbc' ? daggers.map((e) => latestCsmBasis(book, e)).find(Boolean) : null;
  const dagCell = daggers.length ? rows.flatMap((r) => r.cells).find((c) => c.dag)?.dag ?? null : null;
  const unitCell: ReactNode = spot ? 'סוף רבעון' : isChg(rd) ? readLabel(rd, d.q) : rd === 'ltm' ? 'LTM' : 'רבעון';
  return (
    <section className="panel p6-gp">
      <div className="p6-gp-hd">
        <h2>{shOf(m)} לאורך רבעונים <small>· {sub}</small></h2>
        <RowsSeg value={gq} onChange={(n) => d.put('gq', n === 6 ? null : String(n))} id={id === 'quarter-grid' ? 'gq-seg' : `gq-seg-${id}`} />
      </div>
      <MonthGrid kind="quarters" id={id} cols={cols.map((e) => ({ k: e, label: book.short(e), color: idCss(e) }))}
        rows={rows.map((r) => ({ key: r.q, vals: ci.map((i) => r.cells[i].v), avg: r.med.v, n: r.med.n, star: ci.map((i) => r.cells[i].star), dagger: ci.map((i) => !!r.cells[i].dag), why: ci.map((i) => r.cells[i].why) }))}
        showAvg avgAt="auto" focus={d.focus} format={(v) => f(v)} heat={isChg(rr) ? 'sign' : 'none'} unit={unitCell} cur={d.q}
        data={{ reading: spot ? 'level' : rd, metric: m.key }}
        onCol={(e) => d.put('sheet', `co:${e}`)}
        renderCell={(q, k, text) => {
          const r = byQ.get(q)!;
          if (k == null) return <Sourced className="num" src={() => gridMedProv(m, rr, r, name)}>{text}</Sourced>;
          const c = r.cells.find((x) => x.e === k)!;
          return <Sourced className="num" src={c.val.prov} label={`${book.short(k)}, ${qlab(q)}: ${text}`}>{text}</Sourced>;
        }}
        more={many ? { label: `כל ה-${d.ents.length} ›`, onClick: () => d.put('sheet', 'grid'), id: `${id}-all` } : undefined} />
      {close}
      {anyStar ? <p className="p6-basis">{starNote(d.q)}</p> : null}
      {dagCell && latest ? <p className="p6-basis" id={`${id}-dagger`}>{daggerNote(dagCell, latest)}</p> : null}
    </section>
  );
}

/** the full grid of a large set, in a sheet (company columns scroll sideways inside it) */
export function FullGrid({ d, m, rd }: { d: BoardData; m: BMetric; rd: QRead }) {
  const { book } = d, name = (e: string) => book.short(e), spot = m.type === 'spot', rr: QRead = spot ? 'now' : rd;
  const ctx = useMemo(() => ctxOf(d), [d]);
  const rows = useMemo(() => quarterGrid(ctx, m, rd, 12), [ctx, m, rd]);
  const f = gridFmt(m, rr), byQ = new Map(rows.map((r) => [r.q, r]));
  return (
    <MonthGrid kind="quarters" id="quarter-grid-all" cols={d.order.map((e) => ({ k: e, label: book.short(e), color: idCss(e) }))}
      rows={rows.map((r) => ({ key: r.q, vals: d.order.map((e) => r.cells.find((c) => c.e === e)!.v), avg: r.med.v, n: r.med.n, star: d.order.map((e) => r.cells.find((c) => c.e === e)!.star), why: d.order.map((e) => r.cells.find((c) => c.e === e)!.why) }))}
      showAvg avgAt="col" focus={d.focus} format={(v) => f(v)} heat={isChg(rr) ? 'sign' : 'none'}
      renderCell={(q, k, text) => { const r = byQ.get(q)!; return k == null ? <Sourced className="num" src={() => gridMedProv(m, rr, r, name)}>{text}</Sourced> : <Sourced className="num" src={r.cells.find((x) => x.e === k)!.val.prov}>{text}</Sourced>; }} />
  );
}

/* ---------- the lens ---------- */
export function BoardLens({ d, m, desk, guard, chips }: { d: BoardData; m: BMetric; desk: boolean; guard: ReactNode; chips?: ReactNode }) {
  const ctx = useMemo(() => ctxOf(d), [d]);
  const b = useMemo(() => boardRows(ctx, m, d.rd), [ctx, m, d.rd]);
  const name = (e: string) => d.book.short(e);
  const onCo = (e: string) => d.put('sheet', `co:${e}`);
  const words = peersWords(b, d.focus, name);
  const take = <Takeaway id="takeaway"><Words parts={words} src={boardSrc(b, name)} /></Takeaway>;
  // a regulator or market metric is complete at its own quarter: no partial-quarter line beside it (13.2 rule 3)
  const g = m.ax === 'reg' || m.type === 'ret' || m.key === 'mcap' || m.key === 'dy' ? null : guard;
  if (!desk) {
    return (
      <div className="p6-board">
        {chips}
        {take}
        <BoardPanel d={d} m={m} b={b} onCo={onCo} />
        {g}
        <GridPanel d={d} m={m} rd={b.rd} />
      </div>
    );
  }
  return (
    <div className="p6-board">
      {take}
      <div className="p6-g2">
        <div className="p6-g2a">
          <Matrix d={d} onCo={onCo} />
          <GridPanel d={d} m={m} rd={b.rd} />
        </div>
        <div className="p6-g2b">
          <BoardPanel d={d} m={m} b={b} onCo={onCo} />
          {g}
        </div>
      </div>
    </div>
  );
}

/** the board of any metric for a company (the company sheet, the focus list): same call, same sources */
export const boardOf = (d: BoardData, m: BMetric, rd?: QRead | null) => boardRows(ctxOf(d), m, rd);
