import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { nf, pct } from '../lib/format';
import { useIfrsData, useIfrsFacts } from '../lib/useData';
import type { IfrsFact } from '../lib/types';
import { BASIS, endOf } from './IndustryIfrs';
import { periodName } from './CompanyIfrs';

const B_ORDER = ['net', 'na', 'gross', 'reinsurance'];
const yearBack = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;

/** The latest report in eight numbers, each as printed and linked to its page. Opens first on a phone. */
export function CompanyTear({ id }: { id: string }) {
  const { data: d } = useIfrsData();
  const P = useMemo(() => (d?.files ?? []).filter((f) => f.company === id).map((f) => f.period).sort().reverse()[0] ?? '', [d, id]);
  const facts = useIfrsFacts(P || null);
  const items = useMemo(() => {
    if (!P || !facts.data) return [];
    const F = facts.data.filter((f) => f.c === id && !f.tr && !f.model && !f.bk);
    const end = endOf(P), W = P.endsWith('FY') ? 'fy' : 'q';
    const sort = (xs: IfrsFact[]) => xs.sort((a, b) => B_ORDER.indexOf(a.b) - B_ORDER.indexOf(b.b) || Number(b.s === b.g) - Number(a.s === a.g) || Number(b.dv != null) - Number(a.dv != null));
    const flow = (m: string, gs = ['group']) => { for (const g of gs) { const x = sort(F.filter((f) => f.m === m && f.g === g && f.w === W && f.d === end)); if (x.length) return x[0]; } return null; };
    const prior = (f: IfrsFact | null) => (f ? F.find((x) => x.m === f.m && x.s === f.s && x.b === f.b && x.w === f.w && x.d === yearBack(f.d)) ?? null : null);
    const bal = (re: RegExp, gs: string[]) => { for (const g of gs) { const x = F.filter((f) => re.test(f.m) && f.g === g && f.w === 'instant'); const dt = x.map((f) => f.d).sort().reverse()[0]; const y = sort(x.filter((f) => f.d === dt)); if (y.length) return y[0]; } return null; };
    const rel = flow('csm_release', ['group', 'life_health']);
    // release printed as several rows of one tied-out table adds up
    const relV = rel ? (rel.dv != null ? F.filter((x) => x.m === rel.m && x.s === rel.s && x.b === rel.b && x.w === rel.w && x.d === rel.d && x.dv != null).reduce((t, x) => t + x.dv!, 0) : rel.v) : null;
    const out: { l: string; f: IfrsFact | null; v?: number; pf?: IfrsFact | null; p?: boolean; tag?: string }[] = [
      { l: 'רווח נקי', f: flow('profit_attributable') },
      { l: 'רווח כולל לפני מס', f: flow('comprehensive_income_before_tax') },
      { l: 'תוצאות שירותי ביטוח', f: flow('insurance_service_result') },
      { l: 'הון לבעלי המניות', f: bal(/^equity_attributable$/, ['group']) },
      { l: 'יתרת CSM', f: bal(/^csm_closing$/, ['group', 'life_health']) },
      { l: 'CSM עסק חדש', f: flow('csm_new_business', ['group', 'life_health']) },
      { l: 'שחרור CSM', f: rel, v: relV == null ? undefined : Math.abs(relV) },
      { l: 'יחס כושר פירעון', f: bal(/^solvency_ratio_with_transitional$/, ['insurer']), p: true },
    ];
    return out.filter((x) => x.f).map((x) => ({ ...x, pf: prior(x.f) }));
  }, [facts.data, id, P]);

  if (!P || items.length === 0) return null;
  const url = (f: IfrsFact) => (f.u !== undefined ? f.u : d?.files.find((x) => x.company === id && x.period === P)?.url);
  const end = endOf(P);
  return (
    <section>
      <h2 className="band">{periodName(P)}<span className="muted">מיליוני ש"ח · כפי שדווח · <Link to="review">סקירת דוח</Link></span></h2>
      <div className="kpis">{items.map((x) => {
        const f = x.f!, v = x.v ?? f.dv ?? f.v, pv = x.pf ? (x.v != null ? Math.abs(x.pf.dv ?? x.pf.v) : x.pf.dv ?? x.pf.v) : null;
        const ch = pv != null && pv !== 0 && pv > 0 === v > 0 && x.v == null ? (v / pv - 1) * 100 : null;
        const txt = x.p ? nf(v, 1) + '%' : nf(v, Math.abs(v) < 100 ? 1 : 0);
        return (
          <div className="kpi" key={x.l}>
            <div className="l">{x.l}{f.b !== 'na' && ` · ${BASIS[f.b]}`}{f.g === 'life_health' && ' · חיים ובריאות'}</div>
            <div className="v num">{url(f) && f.pg != null ? <a href={`${url(f)}#page=${f.pg}`} target="_blank" rel="noreferrer" title={`${f.l} · עמ׳ ${f.pg}`}>{txt}</a> : txt}</div>
            <div className="s">{ch != null ? <span className={ch < 0 ? 'neg' : 'pos'}>{pct(ch, 1, true)} מול אשתקד</span> : f.d !== end ? <span className="num">{f.d}</span> : f.src === 'chart' ? 'מגרף' : ' '}</div>
          </div>
        );
      })}</div>
    </section>
  );
}
