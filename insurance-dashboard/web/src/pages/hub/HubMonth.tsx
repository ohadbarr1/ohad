import { useMemo } from 'react';
import { MonthGrid, type MonthGridCol, type MonthGridRow, type MonthGridSum } from '../../components/MonthGrid';
import { Takeaway } from '../../components/Takeaway';
import { GuardLine } from '../../components/GuardLine';
import { Empty } from '../../components/ui';
import { typeCount, typeGrid, typeMembers } from '../../lib/pageMonths';
import { HUB_RISK_GUARD, hubColSub, hubWhoBest, hubWords, typeLabel, typeName } from '../../lib/pageWords';
import { trackColor } from '../compare/tracks';
import type { CatX, FundsFile } from '../../lib/funds';
import type { Door } from '../../lib/door';
import type { SheetId } from '../compare/contract';

/* The hub's "החודש" lens (rollout spec §6.2 #4 as amended by §16.1 3b–3d, §17.1 2a–2b, §18.6; mockup v4 ?page=hub, T-H2):
   the sentence first, then the product's track types × the last six months (the type's average: funds/cat.json `y`, asset-weighted,
   through lib/pageMonths typeGrid), "חצי שנה" and "שנה אחרונה" in the footer, no lead marks (different risk levels). In the saver door
   the reader's type of this product is the first column, its head says "שלי", and the other columns step back (funds-hub.css). A cell
   opens the type-month sheet of that type and month; a column head opens it on the data month; "מי היה ראשון…" opens the reader's
   type. One guard line explains why nothing is marked. */

/** what every hub lens gets from the shell (pages/FundsHub.tsx) */
export interface HubCtx {
  file: FundsFile;
  cats: Record<string, CatX>;
  asof: number;
  prod: string;
  door: Door;
  saver: boolean;
  /** the reader's saved tracks (saver door only; [] elsewhere: "שלי" and the tint are the saver's) */
  mineKeys: string[];
  /** the reader's type of this product (catKey), saver door only */
  mineKey: string | null;
  /** open the type-month sheet: every track of `key` in month `p` */
  openType: (key: string, p: number) => void;
  openSheet: (s: SheetId | string) => void;
}

export function HubMonth({ ctx }: { ctx: HubCtx }) {
  const { file, cats, asof, prod, mineKey, openType, openSheet } = ctx;
  const g = useMemo(() => typeGrid(file.funds, cats, prod, { asof, mineKey }), [file, cats, prod, asof, mineKey]);
  if (!g.cols.length) return <Empty title="אין במוצר הזה סוגי מסלולים עם שלושה מסלולים לפחות" />;
  const mineI = g.cols[0].mine ? 0 : null;
  const words = hubWords(asof, prod, g.cols.map((c, i) => ({ label: typeLabel(c.track), v: g.rows[0]?.vals[i] ?? null })), mineI);
  // build review B1 (P2-1): a column head counts the tracks ranked on the data month (pageMonths typeCount), as the card and the sheets
  const nOf = (key: string) => typeCount(typeMembers(file.funds, key), 'm1', { asof }).ranked;
  const cols: MonthGridCol[] = g.cols.map((c, i) => ({ k: c.key, label: typeLabel(c.track), color: trackColor(i), sub: c.mine ? `שלי · ${hubColSub(nOf(c.key), true)}` : hubColSub(nOf(c.key), false) }));
  const rows: MonthGridRow[] = g.rows.map((r) => ({ p: r.p, vals: r.vals }));
  const footer: MonthGridSum[] = [{ key: 'half', label: 'חצי שנה', vals: g.half }, { key: 'y12', label: 'שנה אחרונה', vals: g.y12 }];
  return (
    <div className="hub-month">
      <Takeaway text={words} id="month-insight" />
      <div className={`hub-grid${mineI != null ? ' has-mine' : ''}`}>
        <MonthGrid cols={cols} rows={rows} footer={footer} mark="none"
          onCell={(rk, k) => { if (k) openType(k, Number(rk)); }} onCol={(k) => openType(k, asof)} />
      </div>
      {mineI != null ? (
        <button type="button" className="ro-rowlink" id="who-best" aria-haspopup="dialog" onClick={() => openType(g.cols[0].key, asof)}>
          <span>{hubWhoBest(asof, typeName(g.cols[0].key))}</span><span aria-hidden="true">›</span>
        </button>
      ) : null}
      <div className="hub-guard"><GuardLine kind="risk" id="risk-line" wrap text={HUB_RISK_GUARD} onOpen={() => openSheet('risk')} /></div>
    </div>
  );
}
