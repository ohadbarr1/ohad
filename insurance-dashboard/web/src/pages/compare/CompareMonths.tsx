import { useMemo, useState } from 'react';
import { MonthGrid, HEM, signed, type MonthGridCol, type MonthGridRow, type MonthGridSum } from '../../components/MonthGrid';
import { CompareGrid, type CompareGridRow } from '../../components/CompareGrid';
import { GuardLine } from '../../components/GuardLine';
import { NumText } from '../../components/NumText';
import { SimilarChips } from '../../components/compare/SimilarChips';
import { halfYear, lastYear, monthRows, periodRow, rowBand, rowMarks, seriesOf, yearRows, yearsAvailable, type GridOpts } from '../../lib/compareMonths';
import { monthInsight, monthShortYear, ONE_TRACK, OLD_POLICY_LINE, PRODUCTS_LINE, RISK_BANNER, RISK_MORE, WORST_MONTH, BEST_MONTH, MAX_DROP } from '../../lib/compareWords';
import { feeRing } from '../../lib/feeExample';
import { useFeeCosts } from '../../components/compare/FeeSheet';
import { useShareLink } from '../../components/compare/ShareSheet';
import { count } from '../../lib/count';
import type { CatX, FundX, HistX } from '../../lib/funds';
import type { CmpCtx } from './contract';
import { extremes } from './extremes';
import './shell.css';

/* Track compare, the default lens "חודש מול חודש" (spec v3 §4.3, §4.0b, §10A.2 C1/C3/C5/D4). Top to bottom:
   - guard lines (C5), above the table: different risk levels → one-line banner "יותר מניות: עולה ויורד חזק יותר. עוד ›" (it replaces the
     sentence, opens the risk note); different products → "מוצרים שונים: כללי המס והמשיכה שונים. עוד ›" (tax and liquidity); an
     old-generation policy → its own line, the track stays in the grid, unmarked;
   - <MonthGrid>: six months (or 12, "עוד 6 חודשים ▾" to 60; or calendar years, five + "עוד שנים ▾" to twelve), newest first; summary rows
     "חצי שנה" and "שנה אחרונה" (years: "3 שנים, בשנה", "5 שנים, בשנה") and the fee row in shekels ("דמי ניהול · בשנה ›" → the fee sheet);
     marks: the row's highest inside the tie band (a month 0.05, a year or a window 0.10), never across risk levels, never an old-generation
     or closed track; Pro: the category-average column, on by default ("—" under it in the fee row, D4); one track: the average column too;
   - the sentence (#month-insight, lib/compareWords monthInsight), the hint line, similar-track chips, the collapsed extremes block,
     "שליחה בווטסאפ" + "קישור", the stamp line with "איך מחשבים?".
   No Latin abbreviations or jargon on this lens: the door changes the fifth tab and the cap, not this table (D1). */

export type Range = 'm6' | 'm12' | 'y';
/** what the shell has already worked out about the tracks on screen (one source for the head, the grid and the sheets) */
export interface MonthsModel {
  funds: (FundX | null)[];          // per key, in column order (null while unknown)
  hists: (HistX | null)[];          // per key (null while loading or failed)
  labels: string[]; colors: string[];
  cat: CatX | null;                 // the category's average (cat.json), same-category sets only
  asof: number;
  cross: boolean;                   // different categories among the comparable tracks (no marks, no ranking sentence)
  riskDiff?: boolean;               // …and their risk differs (lib/compareSummary riskDiffers): the risk banner; else the products line alone
  mixed: boolean;                   // different products
  old: boolean[];                   // an old-generation policy, per column
  closed: boolean[];                // a closed track, per column
  mine: boolean[];
  loading: boolean;
}

const Spark = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" /></svg>;
const Sliders = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4" /></svg>;

export function CompareMonths(props: CmpCtx & { range: Range; m: MonthsModel; setRange: (r: Range) => void }) {
  const { range, m, door, openSheet, basis, keys, cap = 4 } = props;
  const yrs = range === 'y';
  const [extra, setExtra] = useState(0);           // "עוד 6 חודשים ▾": months beyond 12
  const [allYears, setAllYears] = useState(false);
  const [avgOn, setAvgOn] = useState(door === 'pro');
  const n = m.funds.length;
  const one = m.funds.filter(Boolean).length === 1;
  const showAvg = !m.cross && !!m.cat && (one || (door === 'pro' && avgOn));
  const o: GridOpts = { cat: m.cat, asof: m.asof };
  // tracks left out of every mark and of the sentence: old-generation policies and closed tracks
  const out = m.funds.map((_, i) => m.old[i] || m.closed[i]);
  const mask = (vals: (number | null)[]) => vals.map((v, i) => (out[i] ? null : v));
  // the fee row: the fee sheet's own costs (lane L2-b useFeeCosts: the deposits switch, and the reader's own fees from their report, O9),
  // ringed among the comparable tracks only (old-generation and closed tracks are left out of the ring)
  const fee = useFeeCosts(m.funds);
  const ownFee = m.funds.map((_, i) => i).filter((i) => fee.own[i]).map((i) => m.labels[i]).filter(Boolean);
  const nMonths = range === 'm6' ? 6 : Math.min(60, 12 + extra);
  const nYearsAll = useMemo(() => (yrs ? Math.min(12, yearsAvailable(m.hists, basis, o)) : 0), [yrs, m.hists, basis, m.asof]);  // eslint-disable-line react-hooks/exhaustive-deps
  const nYears = allYears ? Math.max(5, nYearsAll) : 5;

  const cols: MonthGridCol[] = m.funds.map((f, i) => ({ k: keys[i], label: m.labels[i] || keys[i], color: m.colors[i], closed: m.closed[i] || undefined,
    sub: m.cross && f?.st != null ? `${Math.round(f.st)}% מניות` : undefined }));

  let rows: MonthGridRow[] = [], footer: MonthGridSum[] = [];
  if (!m.loading) {
    if (yrs) {
      rows = yearRows(m.hists, basis, nYears, o).map((r) => ({ key: String(r.yr), label: String(r.yr), sub: r.part ? `עד ${HEM[(r.last % 100) - 1]}` : undefined, vals: r.vals, avg: r.avg,
        lead: m.cross ? [] : rowMarks(mask(r.vals), rowBand('year'), 1) }));
      footer = [periodRow(m.funds, basis, 'a3', o), periodRow(m.funds, basis, 'a5', o)].map((s, i) => ({ key: s.key, label: i ? '5 שנים, בשנה' : '3 שנים, בשנה', vals: s.vals, avg: s.avg,
        lead: m.cross ? [] : rowMarks(mask(s.vals), rowBand(s.key as 'a3'), 1) }));
    } else {
      rows = monthRows(m.hists, basis, nMonths, o).map((r) => ({ key: String(r.p), p: r.p, vals: r.vals, avg: r.avg, lead: m.cross ? [] : rowMarks(mask(r.vals), rowBand('month'), 2) }));
      footer = [halfYear(m.hists, basis, o), lastYear(m.funds, basis, o)].map((s, i) => ({ key: s.key, label: i ? 'שנה אחרונה' : 'חצי שנה', vals: s.vals, avg: s.avg,
        lead: m.cross ? [] : rowMarks(mask(s.vals), rowBand(i ? 'y12' : 'half'), 1) }));
    }
    footer.push({ key: 'fee', id: 'fee-line', label: 'דמי ניהול', sub: fee.deposits ? 'בשנה ›' : 'בלי הפקדות ›', unit: 'ils', vals: fee.costs, avg: null,
      lead: m.cross ? [] : feeRing(mask(fee.costs)), onOpen: () => openSheet({ t: 'fee' }) });
  }

  // the sentence: the newest row (and, under a month, the last year), comparable tracks only
  const first = rows[0];
  const live = m.funds.map((_, i) => i).filter((i) => !out[i]);
  const insight = !first ? '' : live.length < 2 ? (one ? ONE_TRACK : '') : monthInsight({
    p: yrs ? Number(first.key) : first.p!, asof: m.asof,
    row: live.map((i) => ({ label: m.labels[i], v: first.vals[i] })),
    lastYear: yrs ? undefined : live.map((i) => ({ label: m.labels[i], v: footer[1]?.vals[i] ?? null })),
  });

  // the collapsed block: worst and best month in 5 years, the largest drop
  const ext = useMemo(() => m.hists.map((h) => (h ? extremes(h.p, seriesOf(h, basis), m.asof, 60) : null)), [m.hists, basis, m.asof]);
  const extN = Math.min(...ext.map((e) => e?.n ?? 0));
  const cell = (e: { v: number; p: number } | null, dec: number, until = false) => (e ? <><span className="num">{signed(e.v, dec, true)}</span><small>{until ? `עד ${monthShortYear(e.p)}` : monthShortYear(e.p)}</small></> : <span className="muted">–</span>);
  const extRows: CompareGridRow[] = [
    { key: 'worst', label: WORST_MONTH, cell: (k) => cell(ext[keys.indexOf(k)]?.worst ?? null, 2), value: (k) => ext[keys.indexOf(k)]?.worst?.v ?? null, better: 'hi', band: 0.05 },
    { key: 'best', label: BEST_MONTH, cell: (k) => cell(ext[keys.indexOf(k)]?.best ?? null, 2), value: (k) => ext[keys.indexOf(k)]?.best?.v ?? null, better: 'hi', band: 0.05 },
    { key: 'mdd', label: MAX_DROP, cell: (k) => cell(ext[keys.indexOf(k)]?.mdd ?? null, 1, true), value: (k) => ext[keys.indexOf(k)]?.mdd?.v ?? null, better: 'hi', band: 0.1 },
  ];
  const at = HEM[(m.asof % 100) - 1] + ' ' + String(Math.floor(m.asof / 100)).slice(2);

  const more = yrs ? (!allYears && nYearsAll > 5 ? { id: 'more-years', label: 'עוד שנים ▾', onClick: () => setAllYears(true) } : undefined)
    : range === 'm12' && nMonths < 60 ? { id: 'more-months', label: 'עוד 6 חודשים ▾', onClick: () => setExtra((x) => x + 6) } : undefined;
  const anyOld = m.old.some(Boolean);

  return (
    <div className="cmp-body" id="lens-months">
      {m.cross && m.riskDiff && <GuardLine kind="risk" id="cross-line" textId="month-insight" text={RISK_BANNER} more={RISK_MORE} onOpen={() => openSheet({ t: 'risknote' })} />}
      {m.mixed && <GuardLine kind="product" id="product-line" text={PRODUCTS_LINE} onOpen={() => openSheet({ t: 'rules' })} />}
      {anyOld && <GuardLine kind="oldgen" id="old-line" text={OLD_POLICY_LINE} onOpen={() => openSheet({ t: 'rules' })} wrap />}
      <MonthGrid id="month-grid" cols={cols} rows={rows} footer={footer} kind={yrs ? 'years' : 'months'} mark={m.cross ? 'none' : 'row-max'} basis={basis} showAvg={showAvg}
        loading={m.loading} skeletonRows={yrs ? 5 : 6} more={more}
        onCell={(rk) => openSheet(yrs ? { t: 'year', y: rk } : { t: 'month', p: rk })} onCol={(k) => openSheet({ t: 'track', k })} />
      {!m.cross && insight && (
        <div className="cmp-insight"><span className="cmp-spark"><Spark /></span><span id="month-insight"><NumText t={insight} /></span></div>
      )}
      <div className="cmp-legend">
        {!m.cross && n > 1 && <span><i />הגבוה בשורה (בדמי ניהול: הזול)</span>}
        <span>הקשה על מספר פותחת פירוט</span>
        {ownFee.length > 0 && <span id="fee-own">דמי ניהול ב{ownFee.join(', ')}: לפי הדוח שלך</span>}
      </div>
      {!m.cross && keys.length < cap && <SimilarChips {...props} />}
      {door !== 'saver' && (
        <div className="cmp-tools">
          {door === 'pro' && !m.cross && !one && !!m.cat && <button type="button" className="cmp-chip" id="avg-toggle" aria-pressed={avgOn} onClick={() => setAvgOn(!avgOn)}>{avgOn ? '✓ ' : '＋ '}ממוצע הקטגוריה</button>}
          <button type="button" className="cmp-dpill" id="display-pill" onClick={() => openSheet({ t: 'display' })} aria-haspopup="dialog" aria-label={`תצוגה: ${basis === 'net' ? 'נטו' : 'ברוטו'}`}><Sliders />{basis === 'net' ? 'נטו' : 'ברוטו'}</button>
        </div>
      )}
      {!m.loading && (
        <details className="cmp-x" id="extremes">
          <summary>החודש הכי גרוע והכי טוב ב-5 שנים</summary>
          <div className="in">
            <CompareGrid cols={cols.map((c) => ({ k: c.k, label: c.label, color: c.color }))} rows={extRows} mark={!m.cross} onCol={(k) => openSheet({ t: 'track', k })} />
            {extN > 0 && <div className="cmp-note">לפי התשואות החודשיות ב-{extN} החודשים שעד {at}.</div>}
          </div>
        </details>
      )}
      <ShareRow ctx={props} />
      <Stamp asof={m.asof} basis={basis} onWhy={() => openSheet({ t: 'why' })} />
    </div>
  );
}

/** The page's end: "שליחה בווטסאפ" (the same link and text as the share sheet, lib ShareSheet useShareLink) and "קישור" (the sheet).
 *  The month views and "לאורך זמן" end with it alike (review B1 P8). */
export function ShareRow({ ctx }: { ctx: CmpCtx }) {
  const share = useShareLink(ctx.keys, ctx.basis, true, ctx.view);
  return (
    <div className="cmp-share">
      <a className="cmp-btn wa" id="wa" href={share.wa} target="_blank" rel="noopener noreferrer" onClick={() => count('cmp_share', { channel: 'wa_page' })}>שליחה בווטסאפ</a>
      <button type="button" className="cmp-btn" id="share" onClick={() => ctx.openSheet({ t: 'share' })} aria-haspopup="dialog">קישור</button>
    </div>
  );
}

/** One line: source, month, basis, the five words on the past, and "איך מחשבים?" (spec §5.3 StampLine). `onSrc` (the long view, agent
 *  and Pro doors) adds "מקור המספרים ›", the list of the figures with their sources. */
export function Stamp({ asof, basis, onWhy, onSrc }: { asof: number; basis: 'net' | 'gross'; onWhy: () => void; onSrc?: () => void }) {
  const at = `${HEM[(asof % 100) - 1]} ${String(Math.floor(asof / 100)).slice(2)}`;
  return (
    <div className="cmp-stamp" id="stamp">
      רשות שוק ההון, עד {at} · {basis === 'net' ? 'אומדן אחרי דמי ניהול' : 'לפני דמי ניהול'} · העבר אינו מבטיח עתיד
      <button type="button" onClick={onWhy} aria-haspopup="dialog">איך מחשבים?</button>
      {onSrc ? <button type="button" onClick={onSrc}>מקור המספרים ›</button> : null}
    </div>
  );
}
