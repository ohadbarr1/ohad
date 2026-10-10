import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Field, Loading, Panel } from '../components/ui';
import { nf, byPeriodDesc, dateLabel } from '../lib/format';
import { useIfrsData, useIfrsFacts, useRegistry } from '../lib/useData';
import type { IfrsFact } from '../lib/types';
import { periodName } from './CompanyIfrs';

/** Column = one family of reported rows. Names differ between filers, so each is matched by pattern; `pctv` marks ratios. */
const COLS: { k: string; l: string; re: RegExp; pctv?: boolean; flow?: boolean }[] = [
  { k: 'r1', l: 'יחס כושר פירעון, עם הוראות מעבר', re: /^solvency_ratio_with_transitional$/, pctv: true },
  { k: 'r0', l: 'ללא הוראות מעבר', re: /^solvency_ratio_without_transitional$/, pctv: true },
  { k: 'tg', l: 'יעד הדירקטוריון', re: /^target_solvency_ratio(_minimum|_with_transitional_minimum)?$/, pctv: true },
  { k: 'th', l: 'סף לחלוקת דיבידנד', re: /^target_(solvency_ratio_dividend_threshold|dividend_threshold_solvency)/, pctv: true },
  { k: 'of', l: 'הון עצמי לעניין SCR', re: /^own_funds(_with_transitional)?$/ },
  { k: 'scr', l: 'SCR', re: /^scr(_with_transitional)?$/ },
  { k: 'su', l: 'עודף הון', re: /^solvency_surplus(_with_transitional)?$/ },
  { k: 'dv', l: 'דיבידנד שהוכרז', re: /^dividend_declared$/, flow: true },
  { k: 'po', l: 'מדיניות חלוקה, % מהרווח', re: /^target_dividend_payout/, pctv: true },
];

/** Capital and distribution capacity as each insurer reports it. Where a filer prints several values for one row, all are shown, each with its page. */
export function IndustryCapital() {
  const { data: d, error } = useIfrsData();
  const reg = useRegistry();
  const periods = useMemo(() => [...new Set((d?.files ?? []).map((f) => f.period))].sort(byPeriodDesc), [d]);
  const [period, setPeriod] = useState('');
  const P = periods.includes(period) ? period : periods.find((p) => p.endsWith('FY')) ?? periods[0] ?? '';
  const facts = useIfrsFacts(P || null);
  const rows = useMemo(() => {
    const F = facts.data ?? [];
    return [...new Set(F.map((f) => f.c))].map((id) => ({ id, cells: COLS.map((col) => {
      const mine = F.filter((f) => f.c === id && col.re.test(f.m) && (!col.flow || f.w !== 'q'));
      const date = mine.map((f) => f.d).sort().reverse()[0];
      const seen = new Set<number>();
      return { date, list: mine.filter((f) => f.d === date && !seen.has(f.v) && seen.add(f.v)).slice(0, 4) };
    }) }));
  }, [facts.data]);

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
                <td key={COLS[i].k}>{c.list.length === 0 ? <span className="muted">–</span> : (
                  <>{c.list.map((f, j) => <span key={j}>{j > 0 && <span className="muted"> · </span>}{url(f) && f.pg != null ? <a className="num" href={`${url(f)}#page=${f.pg}`} target="_blank" rel="noreferrer" title={`${f.l} · עמ׳ ${f.pg}`}>{show(f, COLS[i].pctv)}</a> : <span className="num" title={f.l}>{show(f, COLS[i].pctv)}</span>}</span>)}
                    <span className="dim num">{dateLabel(c.date)}{c.list[0].w === 'ytd' ? ' · YTD' : ''}</span></>
                )}</td>
              ))}
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
