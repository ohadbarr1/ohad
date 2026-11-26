/* C2 · the month sheet (spec §4.4, mockup v3 frame "month sheet", 10A.3 C2): tap any cell of the grid. "אוקטובר 2026" / "כמה הרוויח כל
   מסלול בחודש הזה · לפני דמי ניהול"; ranked bars from a zero line (teal right, vermilion left; colour is never alone: every value is
   signed), a hatched bar for "ממוצע הסוג"; three plain facts (gap, the category average and how many are above it, "חודש אחד לא אומר
   הרבה"); older / newer month without closing (openSheet replaces the address). A year row opens the same sheet for the year (p = yyyy).
   Different categories: kept in the order chosen, no average, no gap. Pro adds the month's published fee beside the return (fees are their own row, never subtracted: owner 26.11.26). Every figure
   opens its source (the regulator's monthly return, the category file). */
import type { CSSProperties } from 'react';
import type { SheetProps } from '../../pages/compare/contract';
import { DeeperSheet, SheetSection } from '../DeeperSheet';
import { CompareGrid } from '../CompareGrid';
import { NumText } from '../NumText';
import { Sourced } from '../Source';
import { addMonths, fundP } from '../../lib/market';
import { pc, refOf, type Basis } from '../../lib/funds';
import { cum } from '../../lib/compareMonths';
import { ONE_MONTH_NOTE, avgWords, gapWords, monthShortYear, sheetTitle } from '../../lib/compareWords';
import { nf } from '../../lib/format';
import type { Prov } from '../../lib/prov';
import { Facts, Fig, catMonth, catMonthProv, monthProv, monthVal, useCmpData, type Col } from './sheetKit';

const ymL = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
/** the months of a calendar year up to asof */
const yearMonths = (yr: number, asof: number) => Array.from({ length: Math.floor(asof / 100) === yr ? asof % 100 : 12 }, (_, i) => yr * 100 + i + 1);

export function MonthSheet({ keys, basis, door, open, onClose, openSheet, p }: SheetProps & { p: string }) {
  const d = useCmpData(keys, open);
  const isYear = /^\d{4}$/.test(p), pv = Number(p), asof = d.asof ?? 0;
  const ok = Number.isFinite(pv) && pv > 0;
  const cross = !d.ck && d.cols.length > 1;
  const months = isYear && asof ? yearMonths(pv, asof) : [pv];

  // one value per column (a year compounds its months; a missing month makes it null)
  const valOf = (c: Col, b: Basis = basis) => (isYear ? cum(months.map((m) => monthVal(c.h, m, b))) : monthVal(c.h, pv, b));
  const avg = cross || !d.cat ? null : isYear ? cum(months.map((m) => catMonth(d.cat, m, basis))) : catMonth(d.cat, pv, basis);
  const avgN = !d.cat || isYear ? null : (() => { const i = d.cat!.p.indexOf(pv); return i < 0 ? null : d.cat!.n[i]; })();
  const items = d.cols.map((c) => ({ c, v: valOf(c) })).filter((x) => x.v != null) as { c: Col; v: number }[];
  if (!cross) items.sort((a, b) => b.v - a.v);
  const vals = items.map((x) => x.v);

  // the bar geometry: one zero line for the bars and the average
  const all = [...vals, ...(avg != null ? [avg] : [])], lo = Math.min(0, ...all), hi = Math.max(0, ...all), span = hi - lo || 1, z = ((0 - lo) / span) * 100;
  const bar = (v: number, i: number, avgBar = false) => (
    <span className="ms-t" style={{ '--z': `${z}%` } as CSSProperties} aria-hidden="true">
      <i className={`${v < 0 ? 'neg' : 'pos'}${avgBar ? ' avg' : ''}`} style={{ '--l': `${(v < 0 ? ((v - lo) / span) * 100 : z).toFixed(1)}%`, '--w': `${Math.max(1.5, (Math.abs(v) / span) * 100).toFixed(1)}%`, '--i': i } as CSSProperties} />
    </span>
  );

  // provenance: a month as published / estimated; a year compounded from its months
  const yearProv = (c: Col): Prov => ({ k: 'calc', title: `${sheetTitle(pv, asof)} · ${c.f.name} · לפני דמי ניהול`,
    value: pc(valOf(c)), formula: '(1 + r₁) × … × (1 + rₙ) − 1 על התשואות החודשיות של חודשי השנה. חסר חודש: לא מחושב', inputs: months.map((m) => ({ label: `תשואה חודשית · ${ymL(m)}`, v: pc(monthVal(c.h, m, basis)), src: () => monthProv(c.f, c.h, m, basis) })) });
  const srcOf = (c: Col) => () => (isYear ? yearProv(c) : monthProv(c.f, c.h, pv, basis));
  const avgSrc = (): Prov => (isYear || !d.cat || !d.ck
    ? { k: 'calc', title: `ממוצע הסוג · ${d.ck ?? ''} · ${sheetTitle(pv, asof)}`, value: pc(avg), formula: '(1 + ממוצע חודש₁) × … × (1 + ממוצע חודשₙ) − 1 על חודשי השנה', inputs: d.cat && d.ck ? months.map((m) => ({ label: `ממוצע הסוג · ${ymL(m)}`, v: pc(catMonth(d.cat, m, basis)), src: () => catMonthProv(d.ck!, d.cat!, m, basis) })) : [] }
    : catMonthProv(d.ck, d.cat, pv, basis));

  // older / newer, without closing
  const first = Math.min(...d.cols.map((c) => (c.h?.p.length ? c.h.p[0] : Infinity)));
  const older = !ok || !Number.isFinite(first) ? null : isYear ? (pv - 1 >= Math.floor(first / 100) ? pv - 1 : null) : addMonths(pv, -1) >= first ? addMonths(pv, -1) : null;
  const newer = !ok || !asof ? null : isYear ? (pv + 1 <= Math.floor(asof / 100) ? pv + 1 : null) : addMonths(pv, 1) <= asof ? addMonths(pv, 1) : null;
  const go = (x: number) => openSheet(isYear ? { t: 'year', y: String(x) } : { t: 'month', p: String(x) });
  const lab = (x: number) => (isYear ? String(x) : monthShortYear(x));

  const facts = [
    items.length > 1 && !cross ? <NumText t={gapWords(vals)} /> : null,
    avg != null && !cross ? <NumText t={avgWords(avg, avgN, vals)} /> : null,
    cross ? 'המסלולים שבחרת מסוגים שונים, ולכן הם מוצגים בסדר שבחרת. ההבדל ביניהם נובע בעיקר מכמות המניות בכל מסלול, לא מאיכות הניהול.' : null,
    isYear ? null : ONE_MONTH_NOTE,
  ];
  const loading = !d.file || (d.pending > 0 && !items.length);
  const title = ok && asof ? sheetTitle(pv, asof) : ok && !isYear ? sheetTitle(pv) : p;

  return (
    <DeeperSheet open={open} onClose={onClose} id="month-sheet-dlg" title={title}
      sub={`${isYear ? 'כמה הרוויח כל מסלול בשנה הזו' : 'כמה הרוויח כל מסלול בחודש הזה'} · לפני דמי ניהול`}
      footer={<div className="cs-nav">
        <button type="button" className="cs-btn" id="month-older" disabled={older == null} onClick={() => older != null && go(older)}>{older != null ? `→ ${lab(older)}` : '→'}</button>
        <button type="button" className="cs-btn" id="month-newer" disabled={newer == null} onClick={() => newer != null && go(newer)}>{newer != null ? `${lab(newer)} ←` : 'האחרון ←'}</button>
      </div>}>
      <div id="month-sheet" key={p}>
        {loading ? [0, 1, 2].map((i) => <div className="ms-bar skel" key={i}><span className="ms-l"><span className="mg-skel" /></span><span className="ms-t" /><span className="ms-v" /></div>) : null}
        {!loading && !items.length ? <p className="cs-note">אין נתונים {isYear ? 'לשנה הזו' : 'לחודש הזה'} במסלולים שבחרת.</p> : null}
        {items.map((x, i) => (
          <div className="ms-bar" key={x.c.k} style={{ '--c': x.c.color } as CSSProperties}>
            <span className="ms-l"><i aria-hidden="true" />{x.c.label}</span>
            {bar(x.v, i)}
            <span className="ms-v"><Fig v={x.v} d={2} src={srcOf(x.c)} /></span>
          </div>
        ))}
        {avg != null ? (
          <div className="ms-bar avg">
            <span className="ms-l">ממוצע הסוג</span>
            {bar(avg, items.length, true)}
            <span className="ms-v"><Fig v={avg} d={2} src={avgSrc} /></span>
          </div>
        ) : null}
        {items.length ? <Facts items={facts} /> : null}
        {door === 'pro' && !isYear && items.length ? (
          <SheetSection title="תשואה ודמי ניהול" open>
            <CompareGrid id="month-sheet-pro" mark={false} cols={d.cols.map((c) => ({ k: c.k, label: c.label, color: c.color }))}
              rows={[
                { key: 'g', label: 'ברוטו', cell: (k) => { const c = d.cols.find((x) => x.k === k)!; return <Fig v={monthVal(c.h, pv, 'gross')} src={() => monthProv(c.f, c.h, pv, 'gross')} />; } },
                { key: 'f', label: 'ד״נ מצבירה, שנתי', cell: (k) => {
                  const c = d.cols.find((x) => x.k === k)!, i = c.h ? c.h.p.indexOf(pv) : -1, fee = c.h && i >= 0 ? c.h.fee[i] ?? null : null;
                  return fee == null ? '–' : <Sourced src={() => fundP(refOf(c.f), pv, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${nf(fee, 2)}%`)}>{`${nf(fee, 2)}%`}</Sourced>;
                } },
              ]} />
          </SheetSection>
        ) : null}
      </div>
    </DeeperSheet>
  );
}
