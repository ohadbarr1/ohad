import { useMemo, useState } from 'react';
import { MonthGrid, HEM } from '../../components/MonthGrid';
import { Takeaway } from '../../components/Takeaway';
import { StampLine } from '../../components/StampLine';
import { yearsAvailable } from '../../lib/compareMonths';
import { trackYears } from '../../lib/pageMonths';
import { AVG_HEAD, avgHeadSub, cardYearWords } from '../../lib/pageWords';
import { trackColor } from '../compare/tracks';
import type { CardCtx } from './CardMonths';
import '../../styles/fund-card.css';

/* Rollout T-C3, "שנים" (spec §3.2 lenses, §18.6 card years; mockup v4 frame card_y): calendar years newest first, five rows ("2026 · עד
   אוק׳" first) and "עוד שנים ▾" to every year on file; the footer "3 שנים, בשנה" / "5 שנים, בשנה" (the published a3 / a5 against the
   type's months compounded and annualised); the sentence about the last full year (lib/pageWords cardYearWords). A cell opens the card's
   year sheet; the average head opens the type-month sheet of the newest month. */

export function CardYears({ c }: { c: CardCtx }) {
  const { f, h, cat, tn, host } = c;
  const [all, setAll] = useState(false);
  const avail = useMemo(() => yearsAvailable([h], 'gross'), [h]);
  const ty = useMemo(() => trackYears(h, f, cat, all ? Math.max(5, avail) : 5), [h, f, cat, all, avail]);
  const rows = ty.rows.filter((r) => r.v != null || r.avg != null);
  const full = rows.find((r) => !r.part && r.v != null) ?? rows[0];
  const newest = rows[0]?.last ?? c.asof;
  const sentence = full ? cardYearWords(full.yr, full.v, cat ? full.avg : null, { type: cat ? tn : null, asof: c.asof }) : '';
  const monthsIn = (yr: number) => h.p.filter((p, i) => Math.floor(p / 100) === yr && h.y[i] != null).length;
  return (
    <div className="fc-lens">
      <Takeaway id="takeaway" text={sentence} />
      <MonthGrid id="month-grid" kind="years" decimals={1} mark="none" cols={[{ k: f.k, label: 'המסלול', color: trackColor(0) }]} showAvg={!!cat}
        avgLabel={[AVG_HEAD, avgHeadSub(tn, c.avgN)]} onAvg={cat ? () => host.openSheet(`type:${newest}`) : undefined}
        rows={rows.map((r) => ({ key: String(r.yr), label: String(r.yr), sub: r.part ? (r.last === newest && r.yr === Math.floor(newest / 100) ? `עד ${HEM[(r.last % 100) - 1]}` : `${monthsIn(r.yr)} חודשים`) : undefined, vals: [r.v], avg: r.avg }))}
        footer={[
          { key: 'a3', label: '3 שנים, בשנה', vals: [ty.a3.v], avg: ty.a3.avg },
          { key: 'a5', label: '5 שנים, בשנה', vals: [ty.a5.v], avg: ty.a5.avg },
        ]}
        onCell={(rk) => host.openSheet({ t: 'year', y: rk })}
        more={!all && avail > 5 ? { label: 'עוד שנים ▾', onClick: () => setAll(true), id: 'more-years' } : undefined} />
      <StampLine asof={c.asof} onWhy={() => host.openSheet({ t: 'why' })} />
    </div>
  );
}
