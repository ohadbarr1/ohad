import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { nf } from '../lib/format';
import { useIfrsData, useIfrsFacts, useRegistry } from '../lib/useData';
import type { IfrsFact } from '../lib/types';
import { BASIS, endOf } from './IndustryIfrs';
import { periodName } from './CompanyIfrs';

type Col = { k: string; l: string; m?: string; inst?: boolean; pctv?: boolean; calc?: [string, string, 'ratio' | 'pct'] };
const COLS: Col[] = [
  { k: 'np', l: 'רווח נקי', m: 'profit_attributable' },
  { k: 'ci', l: 'רווח כולל לפני מס', m: 'comprehensive_income_before_tax' },
  { k: 'isr', l: 'תוצאות שירותי ביטוח', m: 'insurance_service_result' },
  { k: 'eq', l: 'הון לבעלי המניות', m: 'equity_attributable', inst: true },
  { k: 'roe', l: 'תשואה להון, כפי שדווחה', m: 'roe_reported', pctv: true },
  { k: 'csm', l: 'יתרת CSM', m: 'csm_closing', inst: true },
  { k: 'nb', l: 'CSM עסק חדש', m: 'csm_new_business' },
  { k: 'rel', l: 'שחרור CSM', m: 'csm_release' },
  { k: 'nbr', l: 'עסק חדש / שחרור', calc: ['nb', 'rel', 'pct'] },
  { k: 'cse', l: 'CSM / הון', calc: ['csm', 'eq', 'ratio'] },
  { k: 'fee', l: 'דמי ניהול', m: 'management_fees' },
];
const B_ORDER = ['net', 'na', 'gross', 'reinsurance'];

/** Peer matrix: one row per insurer, reported group figures side by side, with derived ratios marked and a CSV export. */
export function IndustryMatrix() {
  const { data: d, error } = useIfrsData();
  const reg = useRegistry();
  const periods = useMemo(() => [...new Set((d?.files ?? []).map((f) => f.period))].sort().reverse(), [d]);
  const [period, setPeriod] = useState('');
  const [win, setWin] = useState<'q' | 'ytd'>('q');
  const P = periods.includes(period) ? period : periods[0] ?? '';
  const facts = useIfrsFacts(P || null);
  const annual = P.endsWith('FY'), end = P ? endOf(P) : '', W = annual ? 'fy' : win;

  const rows = useMemo(() => {
    const F = (facts.data ?? []).filter((f) => !f.tr && !f.model && !f.bk);
    return [...new Set(F.map((f) => f.c))].map((id) => {
      const pickOne = (c: Col): { f: IfrsFact; alt: boolean } | null => {
        const mine = F.filter((f) => f.c === id && f.m === c.m && f.d === end && (c.inst ? f.w === 'instant' : f.w === W || (c.pctv && f.w !== 'instant')));
        const sort = (xs: IfrsFact[]) => xs.sort((a, b) => B_ORDER.indexOf(a.b) - B_ORDER.indexOf(b.b) || Number(b.s === b.g) - Number(a.s === a.g) || Number(b.dv != null) - Number(a.dv != null));
        const g = sort(mine.filter((f) => f.g === 'group'));
        if (g.length) return { f: g[0], alt: false };
        // a filer that reports life and health together has no separate group line for CSM
        const lh = c.m?.startsWith('csm') ? sort(mine.filter((f) => f.g === 'life_health')) : [];
        return lh.length ? { f: lh[0], alt: true } : null;
      };
      const cells: Record<string, { v: number; f?: IfrsFact; alt?: boolean; calc?: boolean; n?: number; sum?: boolean } | null> = {};
      COLS.filter((c) => c.m).forEach((c) => {
        const p = pickOne(c);
        if (!p) {
          // no group or combined line: life and health are added when both are printed on one basis, and the cell is marked as derived
          const part = (g: string) => F.filter((f) => f.c === id && f.m === c.m && f.g === g && f.s === g && f.d === end && (c.inst ? f.w === 'instant' : f.w === W)).sort((a, b) => B_ORDER.indexOf(a.b) - B_ORDER.indexOf(b.b));
          const l = part('life'), h = c.m?.startsWith('csm') ? part('health').find((x) => l[0] && x.b === l[0].b) : undefined;
          cells[c.k] = l[0] && h ? { v: c.k === 'rel' ? Math.abs(l[0].v) + Math.abs(h.v) : l[0].v + h.v, f: l[0], sum: true } : null;
          return;
        }
        // one movement printed as several rows of the same tied-out table adds up
        const parts = !c.inst && p.f.dv != null ? F.filter((x) => x.c === id && x.m === p.f.m && x.s === p.f.s && x.b === p.f.b && x.w === p.f.w && x.d === p.f.d && x.dv != null && x.l !== p.f.l) : [];
        const v = (p.f.dv ?? p.f.v) + parts.reduce((t, x) => t + x.dv!, 0);
        cells[c.k] = { v: c.k === 'rel' ? Math.abs(v) : v, f: p.f, alt: p.alt, n: parts.length + 1 };
      });
      COLS.filter((c) => c.calc).forEach((c) => {
        const [a, b, how] = c.calc!, x = cells[a], y = cells[b];
        // a ratio is shown only when both sides exist and, for CSM flows, share a basis
        const ok = x && y && y.v !== 0 && (how === 'ratio' || x.f!.b === y.f!.b);
        cells[c.k] = ok ? { v: how === 'pct' ? (x!.v / y!.v) * 100 : x!.v / y!.v, calc: true } : null;
      });
      return { id, cells };
    });
  }, [facts.data, end, W]);

  if (error) return <ErrorBox what="מטריצת עמיתים" error={error} />;
  if (!d || !reg.data || (P && !facts.data && !facts.error)) return <Loading what="מטריצת עמיתים" />;
  if (!P) return <Empty title="אין דוחות מחולצים" />;
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const url = (f: IfrsFact) => (f.u !== undefined ? f.u : d.files.find((x) => x.company === f.c && x.period === P)?.url);
  const show = (c: Col, v: number) => (c.calc?.[2] === 'ratio' ? nf(v, 2) + '×' : c.calc || c.pctv ? nf(v, 1) + '%' : nf(v, Math.abs(v) < 100 ? 1 : 0));
  const csv = () => {
    const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
    const head = ['company', ...COLS.flatMap((c) => [c.l, `${c.l} · basis`, `${c.l} · page`])];
    const body = rows.map((r) => [name(r.id), ...COLS.flatMap((c) => { const x = r.cells[c.k]; return x ? [Number(x.v.toFixed(3)), x.calc ? 'derived' : x.f!.b, x.f?.pg ?? ''] : ['', '', '']; })]);
    const blob = new Blob(['﻿' + [head, ...body].map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `fox_peers_${P}_${W}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <section className="controls">
        <Field label="דוח"><select value={P} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{periodName(p)}</option>)}</select></Field>
        {!annual && <div className="field"><span>חלון</span><Seg label="חלון" value={win} onChange={setWin} options={[['q', 'QTD'], ['ytd', 'YTD']]} /></div>}
        <span className="chip">מיליוני ש"ח · קבוצה · כפי שדווח</span>
        <button type="button" className="chip" onClick={csv}>ייצוא CSV</button>
      </section>
      <Panel title="מטריצת עמיתים" aside={<span>{periodName(P)} · {annual ? 'FY' : win === 'q' ? 'QTD' : 'YTD'}</span>}>
        <div className="scroll"><table>
          <thead><tr><th>חברה</th>{COLS.map((c) => <th key={c.k}>{c.l}{c.calc && <span className="chip est">נגזר</span>}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/company/${r.id}/review`}>{name(r.id)}</Link></td>
              {COLS.map((c) => { const x = r.cells[c.k]; return (
                <td key={c.k}>{!x ? <span className="muted">–</span> : x.calc ? <span className="num">{show(c, x.v)}</span> : (
                  <>{url(x.f!) && x.f!.pg != null ? <a className={`num ${x.v < 0 ? 'neg' : ''}`} href={`${url(x.f!)}#page=${x.f!.pg}`} target="_blank" rel="noreferrer" title={`${x.f!.l} · עמ׳ ${x.f!.pg}`}>{show(c, x.v)}</a> : <span className="num">{show(c, x.v)}</span>}
                    {(x.f!.b !== 'na' || x.alt || x.f!.src === 'chart') && <span className="dim">{x.f!.b !== 'na' && BASIS[x.f!.b]}{x.alt && ' · חיים ובריאות'}{x.f!.src === 'chart' && ' · מגרף'}</span>}{x.sum && <span className="chip est" title="חיים + בריאות, אותו בסיס">נגזר: חיים + בריאות</span>}{(x.n ?? 1) > 1 && <span className="chip est" title="סכום של כמה שורות באותה טבלה">{x.n} שורות</span>}</>
                )}</td>
              ); })}
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
