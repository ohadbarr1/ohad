/* Original vs restated per cell (ws5 W5-1/18, docs/FACTS.md).
   VintageToggle: "מעודכן / כפי שדווח לראשונה" for a statement grid, with the count of cells whose first print differs.
   VintageMark: the dot on a cell whose first print differs from the figure shown; it opens the source sheet with both prints, each
   linked to its own page. useVintage: the policy lives in the URL (?vin=o, ?vin=2025-08-31) and the company's fact table is fetched
   only when the reader asks for it (toggle or a dot). */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmtCell, MINUS, nf, pubLabel, type Scale } from '../lib/format';
import { FL, parsePolicy, policyLabel, policyParam, useFacts, type Fact, type Facts, type Line, type Policy } from '../lib/facts';
import { useSource, type Prov } from '../lib/prov';
import '../styles/vintage.css';

const UNIT: Record<string, string> = { k: 'אלפי ש"ח', nis: 'ש"ח', pct: '%', shares: 'מניות' };

/** the vintage policy of a page, kept in ?vin= (absent = latest), and the company's fact table once the policy or a mark needs it */
export function useVintage(companyId: string | null, opts: { want?: boolean } = {}) {
  const [sp, setSp] = useSearchParams();
  const policy = parsePolicy(sp.get('vin'));
  const setPolicy = useCallback((p: Policy) => setSp((prev) => { const n = new URLSearchParams(prev); const v = policyParam(p); if (v) n.set('vin', v); else n.delete('vin'); return n; }, { replace: true }), [setSp]);
  const { facts, error } = useFacts(companyId, policy !== 'latest' || !!opts.want);
  return { policy, setPolicy, facts, error, loading: (policy !== 'latest' || !!opts.want) && !facts && !error };
}

export function VintageToggle({ value, onChange, changed, vintages, busy }: {
  value: Policy; onChange: (p: Policy) => void;
  /** cells on screen whose first print differs from the current figure */
  changed?: number | null;
  /** reports to offer as an as-of point ([date, label], newest first); omitted = the two-way toggle only */
  vintages?: [string, string][];
  busy?: boolean;
}) {
  const asof = value.startsWith('asof:') ? value.slice(5) : '';
  return (
    <div className="vin" role="group" aria-label="גרסת הנתונים">
      <div className="seg">
        <button type="button" aria-pressed={value === 'latest'} onClick={() => onChange('latest')} title="הערך העדכני: ההדפסה האחרונה של כל תקופה, לרבות מספרי השוואה שהוצגו מחדש">מעודכן</button>
        <button type="button" aria-pressed={value === 'original'} onClick={() => onChange('original')} title="כל תקופה כפי שהודפסה לראשונה, בדוח שלה">כפי שדווח לראשונה</button>
      </div>
      {vintages && vintages.length > 0 && (
        <label className="vin-asof"><span>נכון לדוח</span>
          <select value={asof} onChange={(e) => onChange(e.target.value ? (`asof:${e.target.value}` as Policy) : 'latest')} aria-label="נכון לדוח">
            <option value="">—</option>
            {asof && !vintages.some(([d]) => d === asof) && <option value={asof}>{pubLabel(asof)}</option>}
            {vintages.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
          </select>
        </label>
      )}
      {busy ? <span className="vin-n muted">טוען…</span> : changed != null && <span className="vin-n" title="תאים שההדפסה הראשונה שלהם שונה מהערך המעודכן"><span className="vin-dot-key" aria-hidden />{changed > 0 ? <><span className="num">{nf(changed, 0)}</span> הוצגו מחדש</> : 'אין הצגות מחדש'}</span>}
    </div>
  );
}

const fmtV = (v: number, unit: string, scale: Scale) => fmtCell(v, unit, scale).replace(/^-/, MINUS);

/** the source sheet of a cell with both prints: the figure under the policy, the first print and the latest, each with its page */
export function vintageProv(facts: Facts, line: Line, p: number, policy: Policy, scale: Scale = 'm'): Prov | null {
  const c = facts.cell(line, p, policy);
  if (!c) return null;
  const d = facts.diff(line, p);
  const unit = line.unit === 'k' ? (scale === 'k' ? 'אלפי ש"ח' : scale === 'b' ? 'מיליארדי ש"ח' : 'מיליוני ש"ח') : UNIT[line.unit] ?? '';
  const v = facts.vint[c.t];
  const prints = facts.prints(line, p);
  const note = prints.length > 1 ? `הודפס ב-${prints.length} דוחות: ${prints.map((r) => `${facts.vlabel(r.t)} ${fmtV(r.v, line.unit, scale)}`).join(' · ')}` : undefined;
  return {
    k: 'report', title: `${line.label}${line.dim ? ` · ${line.dim}` : ''} · ${facts.plabel(p)}`, value: fmtV(c.v, line.unit, scale), unit,
    url: v?.url ?? null, pg: c.pg, doc: facts.vlabel(c.t), period: policyLabel(policy), der: !!(c.f & FL.DER), old: !!(c.f & FL.IFRS4), turned: !!(c.f & FL.TURNED),
    restated: d ? { first: fmtV(d.first.v, line.unit, scale), last: fmtV(d.cur.v, line.unit, scale), firstHref: facts.pdf(d.first) ?? undefined, lastHref: facts.pdf(d.cur) ?? undefined, in: facts.vlabel(d.cur.t) } : undefined,
    note: [note, c.f & FL.CMP && policy === 'original' ? 'ההדפסה הראשונה בטבלה היא מספר השוואה של דוח מאוחר (הדוח של התקופה עצמה לא נקרא).' : ''].filter(Boolean).join(' ') || undefined,
  };
}

/** the dot on a cell whose first print differs from the current figure; opens both prints */
export function VintageMark({ facts, line, p, policy, scale = 'm' }: { facts: Facts; line: Line; p: number; policy: Policy; scale?: Scale }) {
  const { open } = useSource();
  const d = useMemo(() => facts.diff(line, p), [facts, line, p]);
  if (!d) return null;
  const other = policy === 'original' ? d.cur : d.first;
  const label = `${policy === 'original' ? 'מעודכן' : 'דווח לראשונה'}: ${fmtV(other.v, line.unit, scale)} (${facts.vlabel(other.t)}, עמ׳ ${other.pg ?? '–'})`;
  return <button type="button" className="vin-dot" title={label} aria-label={`הוצג מחדש. ${label}`} onClick={(e) => { e.stopPropagation(); const pr = vintageProv(facts, line, p, policy, scale); if (pr) open(pr); }} />;
}

/** cells of a set of lines over a set of periods whose first print differs from the current figure */
export function countChanged(facts: Facts, lines: Line[], periods: number[]): number {
  let n = 0;
  for (const l of lines) for (const p of periods) if (facts.diff(l, p)) n++;
  return n;
}
export type { Fact };
