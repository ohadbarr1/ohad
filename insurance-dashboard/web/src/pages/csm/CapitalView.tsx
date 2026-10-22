import { useMemo } from 'react';
import { Chart } from '../../components/Chart';
import { useSource, type Prov } from '../../lib/prov';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/ui';
import { DividendCapacity } from '../../components/DividendCapacity';
import { foxOption } from '../../lib/foxchart';
import { idColor } from '../../lib/identity';
import { usePhone } from '../../lib/useMedia';
import { nf } from '../../lib/format';
import { periodName } from '../../lib/csm';
import { INSURERS, MM, amt, useCapital, type CapCo, type CapPt, type Ledger } from '../../lib/csmData';
import { CapitalTable } from '../IndustryCapital';
import { ScrComposition } from './ScrComposition';
import { useParam } from './params';

type Key = keyof CapCo;
const pkey = (p: string) => p.slice(0, 4) + (p.endsWith('FY') ? '4' : p.slice(5));
const lab = (p: string) => periodName(p).replace('FY', 'Q4');
/** balances reported semi-annually: the line runs through the dates in between, the points mark what was printed */
const joined = <O,>(o: O): O => { ((o as { series: { connectNulls?: boolean }[] }).series).forEach((s) => { s.connectNulls = true; }); return o; };

/** Capital and dividend capacity: five years of solvency, equity and payout per insurer, the latest report's capital lines, the distribution capacity, and the slot for SCR by risk module. */
export function CapitalView({ L, name }: { L: Ledger; name: (id: string) => string }) {
  const { open } = useSource();
  const phone = usePhone();
  const C = useCapital();
  const [tb, setTb] = useParam<'w' | 'wo'>('sr', 'w', ['w', 'wo']);
  const cos = C.data?.companies ?? {};
  const ids = INSURERS.filter((id) => cos[id]);

  const pt = (id: string, k: Key, p: string): CapPt | null => cos[id]?.[k]?.[p] ?? null;
  const ptProv = (id: string, k: Key, p: string, title: string, unit: string, text: string): Prov => {
    const x = pt(id, k, p)!;
    return { k: 'report', title: `${title} · ${name(id)} · ${lab(p)}`, value: text, unit, url: x.u ?? null, pg: x.pg ?? null, doc: 'דוח כספי', period: lab(p), old: x.std === 'IFRS 4' || undefined, der: !!x.der || undefined,
      note: [x.cmp ? 'מעמודת ההשוואה של דוח מאוחר' : '', x.s && x.s !== 'group' ? `ישות: ${x.s}` : ''].filter(Boolean).join(' · ') || undefined };
  };
  /** the periods of a line across the insurers, oldest first; `fy` keeps the annual figures only */
  const axis = (k: Key, fy: boolean) => [...new Set(ids.flatMap((id) => Object.keys(cos[id]?.[k] ?? {})))].filter((p) => !fy || p.endsWith('FY')).filter((p) => !/Q4$/.test(p)).sort((a, b) => pkey(a).localeCompare(pkey(b)));
  const breakOf = (k: Key, xs: string[]) => { const i = xs.findIndex((p) => ids.some((id) => pt(id, k, p)?.std === 'IFRS 17')); return i > 0 && ids.some((id) => pt(id, k, xs[0])?.std === 'IFRS 4') ? i : undefined; };

  const solv = useMemo(() => axis(tb === 'w' ? 'sr_w' : 'sr_wo', false), [cos, tb]); // eslint-disable-line react-hooks/exhaustive-deps
  const eqx = useMemo(() => axis('equity_attributable', false).filter((p) => pkey(p) >= '20214'), [cos]); // eslint-disable-line react-hooks/exhaustive-deps
  const fyx = useMemo(() => axis('dividend_paid', true).filter((p) => Number(p.slice(0, 4)) >= 2021), [cos]); // eslint-disable-line react-hooks/exhaustive-deps
  const payout = (id: string, p: string) => { const dv = pt(id, 'dividend_paid', p), pr = pt(id, 'profit_attributable', p); return dv && pr && pr.v > 0 ? (Math.abs(dv.v) / pr.v) * 100 : null; };

  if (C.error) return <ErrorBox what="היסטוריית הון" error={C.error} />;
  if (!C.data) return <Loading what="הון ודיבידנד" />;
  const sk: Key = tb === 'w' ? 'sr_w' : 'sr_wo', sl = tb === 'w' ? 'יחס כושר פירעון, עם הוראות מעבר' : 'יחס כושר פירעון, ללא הוראות מעבר';
  const h = phone ? 250 : 280;
  return (
    <>
      <div className="csm-grid">
        <Panel title="יחס כושר פירעון" aside={<Seg<'w' | 'wo'> label="הוראות מעבר" value={tb} onChange={setTb} options={[['w', 'עם הוראות מעבר'], ['wo', 'ללא']]} />}>
          {solv.length < 2 ? <Empty title="אין רצף" /> : <Chart label={sl} height={h} deps={[tb, solv.length]} build={() => joined(foxOption({ x: solv.map(lab), unit: '%', legend: true, labels: false, full: true, scale: true,
            series: ids.map((id) => ({ name: name(id), kind: 'line' as const, pct: true, color: idColor(id), dec: 0, faded: solv.map((p) => pt(id, sk, p)?.std === 'IFRS 4'), data: solv.map((p) => pt(id, sk, p)?.v ?? null) })) }))}
            onPoint={(si, di) => { const id = ids[si], p = solv[di], x = id && p ? pt(id, sk, p) : null; if (x) open(ptProv(id, sk, p, sl, '%', `${nf(x.v, x.v % 1 ? 1 : 0)}%`)); }} />}
          <div className="src">חברת הביטוח העיקרית בכל קבוצה, כפי שהודפס בדוח הכספי; דוח כושר הפירעון המלא מתפרסם בפיגור. בהיר: לפני IFRS 17.</div>
        </Panel>
        <Panel title="הון לבעלי המניות" aside={<span>מיליארדי ש"ח · סוף רבעון</span>}>
          {eqx.length < 2 ? <Empty title="אין רצף" /> : <Chart label="הון לבעלי המניות" height={h} deps={[eqx.length]} build={() => joined(foxOption({ x: eqx.map(lab), unit: 'מיליארדי ש"ח', legend: true, labels: false, full: true, scale: true, breakAt: breakOf('equity_attributable', eqx), breakLabel: 'IFRS 17',
            series: ids.map((id) => ({ name: name(id), kind: 'line' as const, color: idColor(id), dec: 1, faded: eqx.map((p) => pt(id, 'equity_attributable', p)?.std === 'IFRS 4'), data: eqx.map((p) => { const x = pt(id, 'equity_attributable', p); return x ? +(x.v / 1000).toFixed(2) : null; }) })) }))}
            onPoint={(si, di) => { const id = ids[si], p = eqx[di], x = id && p ? pt(id, 'equity_attributable', p) : null; if (x) open(ptProv(id, 'equity_attributable', p, 'הון לבעלי המניות', MM, amt(x.v))); }} />}
          <div className="src">IFRS 4 עד 2023 (בהיר); מ-2024 IFRS 17, כולל עמודות ההשוואה שהוצגו מחדש.</div>
        </Panel>
        <Panel title="דיבידנד ששולם" aside={<span>מיליוני ש"ח · שנתי · לבעלי המניות</span>}>
          {fyx.length < 2 ? <Empty title="אין רצף" /> : <Chart label="דיבידנד ששולם, שנתי" height={h} deps={[fyx.length]} build={() => foxOption({ x: fyx.map((p) => periodName(p)), unit: 'מיליוני ש"ח', legend: true, labels: false, full: true,
            series: ids.map((id) => ({ name: name(id), kind: 'bar' as const, color: idColor(id), dec: 0, faded: fyx.map((p) => pt(id, 'dividend_paid', p)?.std === 'IFRS 4'), data: fyx.map((p) => { const x = pt(id, 'dividend_paid', p); return x ? Math.abs(x.v) : null; }) })) })}
            onPoint={(si, di) => { const id = ids[si], p = fyx[di], x = id && p ? pt(id, 'dividend_paid', p) : null; if (x) open(ptProv(id, 'dividend_paid', p, 'דיבידנד ששולם', MM, amt(Math.abs(x.v)))); }} />}
          <div className="src">מדוח תזרים המזומנים; ללא דיבידנד לבעלי זכויות שאינן מקנות שליטה. חברה בלי עמודה: לא שילמה או שהשורה לא הודפסה.</div>
        </Panel>
        <Panel title="שיעור חלוקה" aside={<span>% · דיבידנד ששולם ÷ רווח לבעלי המניות · נגזר</span>}>
          {fyx.length < 2 ? <Empty title="אין רצף" /> : <Chart label="שיעור חלוקה, שנתי" height={h} deps={[fyx.length]} build={() => foxOption({ x: fyx.map((p) => periodName(p)), unit: '%', legend: true, labels: false, full: true,
            series: ids.map((id) => ({ name: name(id), kind: 'bar' as const, pct: true, color: idColor(id), dec: 0, faded: fyx.map((p) => pt(id, 'profit_attributable', p)?.std === 'IFRS 4'), data: fyx.map((p) => { const v = payout(id, p); return v == null ? null : +v.toFixed(1); }) })) })}
            onPoint={(si, di) => { const id = ids[si], p = fyx[di], v = id && p ? payout(id, p) : null; if (v == null) return; const dv = pt(id, 'dividend_paid', p)!, pr = pt(id, 'profit_attributable', p)!;
              open({ k: 'calc', title: `שיעור חלוקה · ${name(id)} · ${periodName(p)}`, value: `${nf(v, 1)}%`, formula: 'דיבידנד ששולם בשנה ÷ רווח לבעלי המניות באותה שנה × 100', note: 'דיבידנד ששולם בשנה מתייחס לרוב לרווחי השנה הקודמת; מדד מזומן, לא מדיניות',
                inputs: [{ label: 'דיבידנד ששולם', v: amt(Math.abs(dv.v)), src: () => ptProv(id, 'dividend_paid', p, 'דיבידנד ששולם', MM, amt(Math.abs(dv.v))) }, { label: 'רווח לבעלי המניות', v: amt(pr.v), src: () => ptProv(id, 'profit_attributable', p, 'רווח לבעלי המניות', MM, amt(pr.v)) }] }); }} />}
          <div className="src">נגזר: מזומן ששולם בשנה ÷ רווח השנה; שנה ללא רווח חיובי לא מוצגת. בהיר: רווח לפי IFRS 4.</div>
        </Panel>
      </div>
      <DividendCapacity ledger={L} />
      <CapitalTable L={L} name={name} />
      <ScrComposition ids={ids} name={name} />
    </>
  );
}
