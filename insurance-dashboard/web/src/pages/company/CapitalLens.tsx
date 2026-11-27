import { Suspense, lazy } from 'react';
import { Sourced } from '../../components/Source';
import { Panel } from '../../components/ui';
import { nf, pubLabel } from '../../lib/format';
import { useLoad } from '../../lib/useData';
import { useSolvency, solvProv } from '../../lib/solvency';
import type { Prov } from '../../lib/prov';
import type { DebtFile } from '../Debt';
import type { CompanyLensProps } from './AnalysisLens';
import { halfLabel, solvencyByReport } from './lensLogic';
import '../../styles/company-lenses.css';

/* P6-2e, lens הון וחוב (`cl=cap`; spec p6 §5.2, §14.1 G4, §14.4 T-C7; tester round 3 P6): solvency by report on both bases (with the
   change from the previous report and the page), then the shipped ScrComposition (SCR by module against the previous report, own funds
   by tier against SCR, and the solvency sensitivities, brought back), the maturity ladder (DebtStrip, form ת126) and the traded series,
   folded on the phone under its total. The shipped panels are unchanged inside. */

const ScrComposition = lazy(() => import('../csm/ScrComposition').then((m) => ({ default: m.ScrComposition })));
const DebtStrip = lazy(() => import('../Debt').then((m) => ({ default: m.DebtStrip })));
const MM = 'מיליוני ש"ח';
type SRow = NonNullable<DebtFile['series']>['rows'][number];
const pp = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), Number.isInteger(v) ? 0 : 1)} נק׳`;
const pct = (v: number) => `${nf(v, Number.isInteger(v) ? 0 : 1)}%`;

/** Solvency ratio by report, without and with the transitional measures, each figure opening its report page. */
function SolvencyByReport({ id, name }: { id: string; name: string }) {
  const { data: S } = useSolvency();
  const by = S?.companies[id];
  if (!S || !by) return null;
  const rows = solvencyByReport(by, 8);
  if (!rows.length) return null;
  const cell = (d: string, k: 'sr_wo' | 'sr_w') => by[d]?.[k];
  const fig = (d: string, k: 'sr_wo' | 'sr_w') => {
    const c = cell(d, k);
    if (!c) return <span className="muted" title="לא הודפס בדוח לתאריך זה">–</span>;
    const basis = k === 'sr_wo' ? 'ללא הוראות מעבר' : 'עם הוראות מעבר';
    return <Sourced src={() => solvProv(S, c, `יחס כושר פירעון, ${basis} · ${name} · ${halfLabel(d)}`, d, '%', pct(c.v), basis)}>{pct(c.v)}</Sourced>;
  };
  const chg = (d: string, prev: string | null, dv: number | null, k: 'sr_wo' | 'sr_w') => {
    if (dv == null || !prev) return <span className="muted" title={prev ? 'חסר אחד משני הדוחות' : 'הדוח הראשון בקובץ'}>–</span>;
    const a = cell(d, k)!, b = cell(prev, k)!, basis = k === 'sr_wo' ? 'ללא הוראות מעבר' : 'עם הוראות מעבר';
    const src = (): Prov => ({ k: 'calc', title: `שינוי ביחס כושר הפירעון, ${basis} · ${name} · ${halfLabel(d)} מול ${halfLabel(prev)}`, value: pp(dv), unit: 'נקודות אחוז', formula: 'היחס בדוח פחות היחס בדוח הקודם, באותו בסיס',
      inputs: [{ label: halfLabel(d), v: pct(a.v), src: () => solvProv(S, a, `יחס כושר פירעון, ${basis} · ${name} · ${halfLabel(d)}`, d, '%', pct(a.v), basis) },
        { label: halfLabel(prev), v: pct(b.v), src: () => solvProv(S, b, `יחס כושר פירעון, ${basis} · ${name} · ${halfLabel(prev)}`, prev, '%', pct(b.v), basis) }] });
    // the signed figure is one left-to-right unit, its unit after it (N4): "+10 נק׳", never "10+"
    return <Sourced src={src} className={dv > 0 ? 'pos' : dv < 0 ? 'neg' : ''}><span dir="ltr" className="p6-ltr">{pp(dv).replace(/ נק׳$/, '')}</span> נק׳</Sourced>;
  };
  const page = (d: string) => { const c = cell(d, 'sr_wo') ?? cell(d, 'sr_w'); const rep = c ? S.reports[String(c.r)] : undefined;
    return rep?.f && c ? <a href={`${S.files}${rep.f}${c.pg ? `#page=${c.pg}` : ''}`} target="_blank" rel="noreferrer">עמ׳ <span className="num">{c.pg ?? '–'}</span></a> : <span className="muted">–</span>; };
  return (
    <section className="panel p6-solv" id="solv" aria-labelledby="solv-h">
      <div className="hd"><h2 id="solv-h">יחס כושר פירעון<span className="muted p6-sub"> · לפי דוח · ללא ועם הוראות מעבר</span></h2></div>
      <div className="scroll"><table className="tight p6-solv-t">
        <thead><tr><th scope="col">דוח</th><th scope="col">ללא<small>הוראות מעבר</small></th><th scope="col">שינוי<small>מהדוח הקודם</small></th><th scope="col">עם<small>הוראות מעבר</small></th><th scope="col">מקור</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.d} data-d={r.d}>
            <th scope="row"><span className="num">{halfLabel(r.d)}</span></th>
            <td className="v">{fig(r.d, 'sr_wo')}</td>
            <td>{chg(r.d, r.prev, r.dwo, 'sr_wo')}</td>
            <td>{fig(r.d, 'sr_w')}</td>
            <td>{page(r.d)}</td>
          </tr>))}</tbody>
      </table></div>
      <p className="src">דוחות יחס כושר פירעון כלכלי, חברת הביטוח · השינוי על הבסיס ללא הוראות מעבר; כל ספי היעד והחלוקה מושווים ליחס על אותו בסיס (עדשת יעדים) · {S.source}</p>
    </section>
  );
}

/** The traded series (par outstanding, MAYA): a list of up to ~20 lines, folded on the phone under its count and total. */
function BondSeries({ id, name, phone }: { id: string; name: string; phone?: boolean }) {
  const { data: d } = useLoad<DebtFile>(`debt/${id}.json`);
  const s = d?.series;
  if (!d || !s || !s.rows.length) return null;
  const ent = (mid: number) => d.entities.find((e) => e.maya_id === mid);
  const rows = [...s.rows].filter((r) => r[5] != null).sort((a, b) => (b[5] ?? 0) - (a[5] ?? 0));
  const tot = rows.reduce((t, r) => t + (r[5] ?? 0), 0) / 1e6;
  const one = (r: SRow): Prov => ({ k: 'report', title: `ערך נקוב במחזור · ${r[1]}`, value: nf((r[5] ?? 0) / 1e6, 0), unit: MM,
    url: `https://maya.tase.co.il/he/companies/${r[0]}`, pg: null, doc: `${ent(r[0])?.name ?? name}, רשימת ניירות ערך (MAYA)`, period: pubLabel(s.asof), note: `נשלף ${pubLabel(s.asof)} · ${r[2]} · מס׳ נייר ${r[3]} · ${r[4]}` });
  const total = (): Prov => ({ k: 'calc', title: `סדרות האג"ח · ${name} · סך הכול`, value: nf(tot, 0), unit: MM, formula: 'סכום הערך הנקוב במחזור של כל הסדרות', note: `נכון ל-${pubLabel(s.asof)}`,
    inputs: rows.map((r) => ({ label: r[1], v: nf((r[5] ?? 0) / 1e6, 0), src: () => one(r) })) });
  const list = (
    <div className="p6-kvs p6-bonds">{rows.map((r) => (
      <div className="p6-kv" key={r[3]}><span className="p6-kv-l">{r[1]}<small className="muted">{ent(r[0])?.name ?? ''} · {r[2]}</small></span>
        <span className="p6-kv-v"><Sourced src={() => one(r)}>{nf((r[5] ?? 0) / 1e6, 0)}</Sourced></span></div>))}</div>
  );
  const head = <><span>חוב סחיר · <span className="num">{rows.length}</span> סדרות</span><span className="p6-kv-v">סך הכול <Sourced src={total}>{nf(tot, 0)}</Sourced> <small className="muted">{MM} ע.נ.</small></span></>;
  return (
    <section className="panel p6-bondsp" id="bonds" aria-label="חוב סחיר לפי סדרה">
      {phone ? (
        <details className="p6-fold">
          <summary className="p6-bonds-sum">{head}<small className="muted">ע.נ. במחזור נכון ל-{pubLabel(s.asof)} · הצגת הסדרות ›</small></summary>
          {list}
        </details>
      ) : (<>
        <div className="hd"><h2>חוב סחיר<span className="muted p6-sub"> · <span className="num">{rows.length}</span> סדרות · ע.נ. במחזור, {MM} · נכון ל-{pubLabel(s.asof)}</span></h2></div>
        {list}
        <div className="p6-kv p6-tot"><span className="p6-kv-l"><b>סך הכול</b></span><span className="p6-kv-v"><Sourced src={total}>{nf(tot, 0)}</Sourced></span></div>
      </>)}
      <p className="src">רשימת ניירות הערך של כל מנפיקה (MAYA), תמונת מצב ולא לתאריך המצבת; ערך נקוב בש"ח (סדרה צמודה: לפני הצמדה)</p>
    </section>
  );
}

export default function CapitalLens({ entry, phone }: CompanyLensProps) {
  const ins = entry.kind !== 'fund_house';
  return (
    <div className="p6-lens" id="capital" data-lens="cap">
      {ins && <SolvencyByReport id={entry.id} name={entry.name_he} />}
      <Suspense fallback={<p className="muted p6-wait">טוען…</p>}>
        {ins && entry.has_financials && <div className="p6-scr"><ScrComposition ids={[entry.id]} name={() => entry.name_he} company={entry.id} /></div>}
        <div className="p6-lens-g p6-debt">
          <div className="p6-lens-cell"><DebtStrip id={entry.id} /></div>
          <div className="p6-lens-cell"><BondSeries id={entry.id} name={entry.name_he} phone={phone} /></div>
        </div>
      </Suspense>
      {!ins && <Panel title="כושר פירעון"><p className="muted">בית השקעות: אין דוח יחס כושר פירעון כלכלי.</p></Panel>}
    </div>
  );
}
