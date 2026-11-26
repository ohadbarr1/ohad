import { useMemo, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chart } from '../../components/Chart';
import { Takeaway } from '../../components/Takeaway';
import { StampLine } from '../../components/StampLine';
import { NumText } from '../../components/NumText';
import { foxOption } from '../../lib/foxchart';
import { nf } from '../../lib/format';
import { growth, onAxis, ym } from '../../lib/funds';
import { useAddressWrite } from '../../lib/sheetHost';
import { readoutTitle, riskOf, windowAxis, type LongPer } from '../../lib/compareLong';
import { MAX_DROP, WORST_MONTH, monthShortYear } from '../../lib/compareWords';
import { placeOf, typeWindowAvg } from '../../lib/pageMonths';
import { AVG_HEAD, cardLongWords, numIso, pctSigned, placeWords } from '../../lib/pageWords';
import { trackRgb } from '../compare/tracks';
import type { CardCtx } from './CardMonths';
import '../../styles/compare-long.css';
import '../../styles/fund-card.css';

/* Rollout T-C3, "לאורך זמן" (spec §3.2 lenses, §18.6 card long; mockup v4 frame card_long): the sentence (cardLongWords, the place from
   lib/pageMonths placeOf), three tiles (שנה אחרונה / 3 שנים / 5 שנים, each with its place) that switch the period (?per=, replace), the
   growth of 100 ₪ against the type's average over the period, and two facts (the worst month, the deepest fall before it rose again).
   Built on the compare long view's pieces (lib/compareLong windowAxis, readoutTitle, riskOf; styles/compare-long.css) for one track. */

type P = Extract<LongPer, 'y12' | 'a3' | 'a5'>;
const TILES: [P, string][] = [['y12', 'שנה אחרונה'], ['a3', '3 שנים, בשנה'], ['a5', '5 שנים, בשנה']];
const N_OF: Record<P, number> = { y12: 12, a3: 36, a5: 60 };

export function CardLong({ c }: { c: CardCtx }) {
  const { f, h, cat, tn, members, host } = c;
  const [sp] = useSearchParams();
  const write = useAddressWrite();
  const asked = sp.get('per') as P | null;
  const avail = TILES.filter(([p]) => f[p] != null).map(([p]) => p);
  const per: P = asked && avail.includes(asked) ? asked : avail.includes('a5') ? 'a5' : avail[avail.length - 1] ?? 'y12';
  const newest = useMemo(() => { for (let i = h.p.length - 1; i >= 0; i--) if (h.y[i] != null) return h.p[i]; return c.asof; }, [h, c.asof]);
  const place = (p: P) => (c.old ? null : placeOf(f, members, p, c.asof));
  const avg = typeWindowAvg(cat, per, newest);
  const sentence = cardLongWords(per, f[per], cat ? avg : null, { asof: c.asof, type: cat ? tn : null, place: place(per) });

  const axis = useMemo(() => windowAxis(per, newest), [per, newest]);
  const mine = useMemo(() => growth(axis, onAxis(axis, h.p, h.y)), [axis, h]);
  const theirs = useMemo(() => (cat ? growth(axis, onAxis(axis, cat.p, cat.y)) : null), [axis, cat]);
  const last = axis.length - 1;
  const risk = useMemo(() => riskOf(h, 'gross', newest, N_OF[per]), [h, newest, per]);
  const rgb = trackRgb(0);
  const build = () => {
    const o = foxOption({ x: axis.map(ym), unit: 'ש"ח', dense: true, full: true, scale: true, legend: false,
      series: [{ name: 'המסלול', data: mine, kind: 'line' as const, color: rgb, dec: 1 }, ...(theirs ? [{ name: AVG_HEAD, data: theirs, kind: 'line' as const, color: '#9aa1b3', dashed: true, dec: 1 }] : [])] });
    for (const a of ((o as { yAxis?: { name?: string }[] }).yAxis ?? [])) a.name = '';
    return o;
  };
  return (
    <div className="fc-lens">
      <Takeaway id="takeaway" text={sentence} />
      <div className="fc-tiles" role="group" aria-label="תקופה" id="long-per">
        {TILES.map(([p, l]) => { const pl = place(p); return (
          <button key={p} type="button" className="fc-tile-b" aria-pressed={p === per} data-per={p} disabled={f[p] == null} onClick={() => write({ per: p })}>
            <small>{l}</small>
            <b className={`n ${(f[p] ?? 0) >= 0 ? 'pos' : 'neg'}`}>{f[p] == null ? '–' : <NumText t={pctSigned(f[p]!, 1)} />}</b>
            <em>{pl ? <NumText t={placeWords(pl)} /> : ' '}</em>
          </button>
        ); })}
      </div>
      <div className="cl-card fc-chart" id="chart-card">
        <div className="cl-ro" id="readout">
          <div className="t">{readoutTitle('g', axis, last, ym)}</div>
          <div className="vals">
            <span className="v" style={{ '--c': rgb } as CSSProperties}><span><i aria-hidden="true" />המסלול</span><b>{mine[last] == null ? '–' : nf(mine[last]!, 1)}</b></span>
            {theirs ? <span className="v" style={{ '--c': '#9aa1b3' } as CSSProperties}><span><i aria-hidden="true" />{AVG_HEAD}</span><b>{theirs[last] == null ? '–' : nf(theirs[last]!, 1)}</b></span> : null}
          </div>
        </div>
        <div className="cl-plot">
          <Chart label='צמיחה של 100 ש"ח' height={220} tools={false} bookable={false} asof={ym(newest)} deps={[f.k, per, !!cat]} build={build} />
        </div>
      </div>
      {risk ? (
        <ul className="ro-facts" id="long-facts">
          <li>{WORST_MONTH} בתקופה: <NumText t={pctSigned(risk.worst, 2)} /> ({monthShortYear(risk.worstP)}).</li>
          <li>{MAX_DROP}: <NumText t={risk.dd < 0 ? pctSigned(risk.dd, 1) : numIso('0%')} />.</li>
        </ul>
      ) : null}
      <StampLine asof={c.asof} onWhy={() => host.openSheet({ t: 'why' })} />
    </div>
  );
}
