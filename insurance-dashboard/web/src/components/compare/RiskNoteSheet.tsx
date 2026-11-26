/* C5 · the risk note (mockup v3 frame "risk note", 4.0b row 7): the "עוד ›" of the one-line banner over the grid when the tracks are at
   different risk levels. "למה אין כאן ״מי הגבוה״?" / "המסלולים שבחרת ברמות סיכון שונות"; three plain bullets (lib/compareWords
   riskNoteFacts: more equity rises and falls harder; each track's worst month in 5 years with its month; why nothing is marked) and a
   four-row table without marks: equity share, the worst and the best month in 5 years, last year. Every figure opens its source. */
import type { SheetProps } from '../../pages/compare/contract';
import { DeeperSheet } from '../DeeperSheet';
import { CompareGrid } from '../CompareGrid';
import { NumText } from '../NumText';
import { Sourced } from '../Source';
import { RISK_NOTE_SUB, RISK_NOTE_TITLE, riskNoteFacts, monthShortYear, WORST_MONTH, BEST_MONTH } from '../../lib/compareWords';
import { refOf, retOf } from '../../lib/funds';
import { fundP } from '../../lib/market';
import { nf } from '../../lib/format';
import { Facts, Fig, extremes, monthProv, useCmpData, winProv } from './sheetKit';

export function RiskNoteSheet({ keys, basis, open, onClose }: SheetProps) {
  const d = useCmpData(keys, open);
  const asof = d.asof ?? 0;
  const rows = d.cols.map((c) => ({ c, ex: extremes(c.h, basis, asof) }));
  const by = new Map(rows.map((r) => [r.c.k, r]));
  const facts = riskNoteFacts(rows.map(({ c, ex }) => ({ label: c.label, worst: ex?.worst.v ?? null, worstP: ex?.worst.p ?? null, equity: c.f.st })));
  const loading = !d.file || d.pending > 0;
  return (
    <DeeperSheet open={open} onClose={onClose} id="risk-note-dlg" title={RISK_NOTE_TITLE} sub={RISK_NOTE_SUB}>
      <div id="risk-note">
        {loading ? <div className="cs-skel" /> : <>
          <Facts items={facts.map((t, i) => <NumText key={i} t={t} />)} />
          <CompareGrid id="risk-note-table" mark={false} cols={d.cols.map((c) => ({ k: c.k, label: c.label, color: c.color }))}
            rows={[
              { key: 'st', label: 'מניות', cell: (k) => { const f = by.get(k)!.c.f; return f.st == null ? '–' : <Sourced src={() => fundP(refOf(f), asof, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', `${nf(f.st!, 0)}%`)}>{`${nf(f.st, 0)}%`}</Sourced>; } },
              { key: 'w', label: WORST_MONTH, sub: 'ב-5 שנים', cell: (k) => { const r = by.get(k)!; return r.ex ? <><Fig v={r.ex.worst.v} src={() => monthProv(r.c.f, r.c.h, r.ex!.worst.p, basis)} /><small>{monthShortYear(r.ex.worst.p)}</small></> : '–'; } },
              { key: 'b', label: BEST_MONTH, sub: 'ב-5 שנים', cell: (k) => { const r = by.get(k)!; return r.ex ? <><Fig v={r.ex.best.v} src={() => monthProv(r.c.f, r.c.h, r.ex!.best.p, basis)} /><small>{monthShortYear(r.ex.best.p)}</small></> : '–'; } },
              { key: 'y', label: 'שנה אחרונה', cell: (k) => { const f = by.get(k)!.c.f; return <Fig v={retOf(f, 'y12', basis).v} d={1} src={() => winProv(f, 'y12', basis, asof, d.file)} />; } },
            ]} />
          <p className="cs-note">{basis === 'net' ? 'אחרי דמי ניהול (אומדן)' : 'לפני דמי ניהול'}.</p>
        </>}
      </div>
    </DeeperSheet>
  );
}
