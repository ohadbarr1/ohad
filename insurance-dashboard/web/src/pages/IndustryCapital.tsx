import { DividendCapacity } from '../components/DividendCapacity';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Field, Loading, Panel } from '../components/ui';
import { nf, byPeriodDesc, dateLabel } from '../lib/format';
import { useIfrsData, useIfrsFacts, useRegistry } from '../lib/useData';
import type { IfrsFact } from '../lib/types';
import { periodName } from './CompanyIfrs';
import { endOf, lineHe } from './IndustryIfrs';
import { Sourced } from '../components/Source';
import { factProv } from '../lib/csm';
import '../styles/ifrs.css';

/** Column = one family of reported rows. Names differ between filers, so each is matched by pattern; `pctv` marks ratios. */
const COLS: { k: string; l: string; re: RegExp; pctv?: boolean; flow?: boolean; tgt?: boolean }[] = [
  { k: 'r1', l: 'יחס כושר פירעון, עם הוראות מעבר', re: /^solvency_ratio_with_transitional$/, pctv: true },
  { k: 'r0', l: 'ללא הוראות מעבר', re: /^solvency_ratio_without_transitional$/, pctv: true },
  { k: 'tg', l: 'יעד הדירקטוריון', re: /^target_solvency_ratio(_board|_min(imum)?(_with(out)?_transitional)?|_with_transitional_minimum)?$/, pctv: true, tgt: true },
  { k: 'th', l: 'סף לחלוקת דיבידנד', re: /^target_(solvency_ratio_dividend_threshold|dividend_threshold_solvency)/, pctv: true, tgt: true },
  { k: 'of', l: 'הון עצמי לעניין SCR', re: /^own_funds(_with_transitional)?$/ },
  { k: 'scr', l: 'SCR', re: /^scr(_with_transitional)?$/ },
  { k: 'su', l: 'עודף הון', re: /^solvency_surplus(_with_transitional)?$/ },
  { k: 'dv', l: 'דיבידנד שהוכרז', re: /^dividend_declared$/, flow: true },
  { k: 'po', l: 'מדיניות חלוקה, % מהרווח', re: /^target_dividend_payout/, pctv: true, tgt: true },
];

/** Capital and distribution capacity as each insurer reports it. Where a filer prints several values for one row, all are shown, each with its page. */
export function IndustryCapital() {
  const { data: d, error } = useIfrsData();
  const reg = useRegistry();
  const periods = useMemo(() => [...new Set((d?.files ?? []).map((f) => f.period))].sort(byPeriodDesc), [d]);
  const [period, setPeriod] = useState('');
  const P = periods.includes(period) ? period : periods[0] ?? '';
  const facts = useIfrsFacts(P || null);
  const end = P ? endOf(P) : '';
  // per company and measure: the latest fact dated up to the chosen report, whichever report page printed it; targets also list what is set for a later year
  const rows = useMemo(() => {
    const F = facts.data ?? [];
    const uniq = (l: IfrsFact[]) => { const seen = new Set<number>(); return l.filter((f) => !seen.has(f.v) && seen.add(f.v)); };
    return [...new Set(F.map((f) => f.c))].map((id) => ({ id, cells: COLS.map((col) => {
      const mine = F.filter((f) => f.c === id && col.re.test(f.m) && (!col.flow || f.w !== 'q'));
      const past = mine.filter((f) => f.d <= end), date = past.map((f) => f.d).sort().reverse()[0];
      const items = uniq(past.filter((f) => f.d === date)).slice(0, 4).map((f) => ({ f, tag: col.tgt ? `בתוקף ${dateLabel(f.d)}` : '', est: false }));
      if (col.tgt) mine.filter((f) => f.d > end).sort((a, b) => a.d.localeCompare(b.d)).forEach((f) => { if (items.length < 5) items.push({ f, tag: `יעד ל-${f.d.slice(0, 4)}`, est: true }); });
      return { date, items, tag: !col.tgt && date ? `${dateLabel(date)}${items[0]?.f.w === 'ytd' ? ' · YTD' : ''}` : '', stale: !!date && date !== end };
    }) }));
  }, [facts.data, end]);

  if (error) return <ErrorBox what="נתוני הון" error={error} />;
  if (!d || !reg.data || (P && !facts.data && !facts.error)) return <Loading what="הון ודיבידנד" />;
  if (!P) return <Empty title="אין דוחות מחולצים" />;
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const url = (f: IfrsFact) => f.u !== undefined ? f.u : d.files.find((x) => x.company === f.c && x.period === P)?.url;
  const show = (f: IfrsFact, p?: boolean) => nf(f.m === 'dividend_declared' ? Math.abs(f.v) : f.v, p || Math.abs(f.v) < 100 ? (Number.isInteger(f.v) ? 0 : 1) : 0) + (p ? '%' : '');

  return (
    <>
      <section className="controls">
        <Field label="דוח"><select value={P} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{periodName(p)}</option>)}</select></Field>
        <span className="chip">מיליוני ש"ח · כפי שדווח · חברת הביטוח</span>
        <span className="chip est" style={{ whiteSpace: 'normal', borderRadius: 12, lineHeight: 1.4 }}>כמה ערכים בתא: עם וללא הוראות מעבר, לפני ואחרי פעולות הון, או כמה חברות בנות</span>
      </section>
      <Panel title="כושר פירעון, הון ודיבידנד">
        <div className="scroll"><table>
          <thead><tr><th>חברה</th>{COLS.map((c) => <th key={c.k}>{c.l}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/company/${r.id}/ifrs17`}>{name(r.id)}</Link></td>
              {r.cells.map((c, i) => (
                <td key={COLS[i].k}>{c.items.length === 0 ? <span className="muted">–</span> : (
                  <>{c.items.map(({ f, tag, est }, j) => <span key={j} className="cv">{j > 0 && <span className="muted"> · </span>}<Sourced className="num" href={url(f) && f.pg != null ? `${url(f)}#page=${f.pg}` : null} title={`${lineHe(f) || 'עמ׳'} · עמ׳ ${f.pg ?? '–'}`} src={() => factProv({ ...f, rp: P }, d, `${COLS[i].l} · ${name(r.id)} · ${periodName(P)}`, show(f, COLS[i].pctv), COLS[i].pctv ? '%' : undefined)}>{show(f, COLS[i].pctv)}</Sourced>{tag && <span className={`chip ${est ? 'est' : ''}`}>{tag}</span>}</span>)}
                    {c.tag && <span className={`chip ${c.stale ? 'est' : ''}`} title={c.stale ? `הערך האחרון בדוח ${periodName(P)} הוא מ-${c.tag}` : undefined}>{c.tag}</span>}</>
                )}</td>
              ))}
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <DividendCapacity />
    </>
  );
}
