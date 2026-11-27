import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel, Seg } from './ui';
import { Sourced } from './Source';
import { WaterfallChart, MiniFall, type FallPt } from './CsmWaterfall';
import { useSource } from '../lib/prov';
import { nf } from '../lib/format';
import { usePhone } from '../lib/useMedia';
import { KIND_HE, SHORT, bridgeProv, driverProv, endId, factProv, ql, sentenceParts, sgn, useAttribution, type AttrFact, type Bridge, type Decomp } from '../lib/attribution';
import { bridgeBehind, noDotZero } from '../pages/company/lensLogic';
import '../styles/attribution.css';
import '../styles/company-lenses.css';

const MN = 'מיליוני ש"ח';

/** One decomposition: the generated sentence, the waterfall (a strip on the phone) and the table of contributions, every figure sourced. */
export function BridgeView({ F, b, title, la, lb, fromId, toId, method, notes, compact, view }: { F: Record<string, AttrFact>; b: Decomp; title: string; la: string; lb: string;
  fromId: string | null; toId: string | null; method: string; notes?: string[]; compact?: boolean;
  /** one view at a time (company page, spec 5.2): 'list' = the drivers with two-direction bars, 'chart' = the waterfall; unset = both, as on /attribution */
  view?: 'list' | 'chart' }) {
  const phone = usePhone();
  const { open } = useSource();
  const pp = b.unit === 'נק׳', d = pp ? 2 : 1, unit = pp ? 'נק׳ ROE' : MN;
  const whole = () => bridgeProv(F, b, title, fromId, toId, la, lb, method);
  const pts: FallPt[] = [{ l: la, v: b.from, total: true }, ...b.drivers.map((x) => ({ l: SHORT[x.k] ?? x.l, v: x.v })), { l: lb, v: b.to, total: true }];
  // an endpoint opens its own calculation (profit, equity: report pages); a base that starts from its first print opens the bridge
  const endSrc = (id: string | null, first: boolean) => (id && F[id] && !first ? factProv(F, id) : whole());
  const srcAt = (i: number) => (i === 0 ? endSrc(fromId, b.from_latest != null) : i === pts.length - 1 ? endSrc(toId, false) : driverProv(F, drv[i - 1], title, b.unit));
  const parts = sentenceParts(b.sentence);
  // a driver's context line without ".0" on millions (P6-B6, tester N9); its source sheet reads the same text
  const drv = b.drivers.map((x) => (x.ctx ? { ...x, ctx: noDotZero(x.ctx) } : x));
  const mx = Math.max(1e-9, ...drv.map((x) => Math.abs(x.v)));
  const end = (id: string | null, v: number, first: boolean) => <Sourced src={() => endSrc(id, first)}>{nf(v, pp ? 1 : 0)}{pp ? '%' : ''}</Sourced>;
  return (
    <div className="attr-b">
      <p className="attr-sent">{parts.map((p, i) => (p.n ? <Sourced key={i} src={whole}>{p.t}</Sourced> : <span key={i}>{p.t}</span>))}</p>
      <div className="attr-ends" aria-label="נקודות קצה">
        <span className="muted">{la}{b.from_latest != null ? ', הדפסה ראשונה' : ''}</span> {end(fromId, b.from, b.from_latest != null)}
        <span className="muted" aria-hidden="true">→</span>
        <span className="muted">{lb}</span> {end(toId, b.to, false)}
        <span className="muted">· שינוי</span> <Sourced src={whole}><b className={b.total > 0 ? 'pos' : b.total < 0 ? 'neg' : ''}>{sgn(b.total, pp ? 1 : 0)}</b></Sourced> <span className="muted">{pp ? 'נק׳' : MN}</span>
        <span className="muted">· שארית</span> <Sourced src={whole}>{nf(Math.abs(b.residual) < 5e-7 ? 0 : b.residual, 2)}</Sourced>
      </div>
      {view === 'list' ? (
        <div className="p6-brl" role="table" aria-label={`${title}: תרומת כל גורם`}>
          {drv.map((x) => (
            <div key={x.k} className={`p6-brr${x.seg ? ' sv' : ''}`} role="row">
              <span className="p6-brl-l" role="rowheader">{x.l}{x.seg ? <span className="chip" title="מגזר החיסכון ארוך הטווח: חלק משורת דמי הניהול של הקבוצה, מדוחות החברות המנהלות; אינו רווח הקבוצה">מגזר חיסכון</span> : null}
                {x.ctx && <small className="p6-brl-c">{x.ctx}</small>}</span>
              <span className="p6-brl-b" aria-hidden="true"><s /><i className={x.v >= 0 ? 'up' : 'dn'} style={{ width: `${(Math.abs(x.v) / mx) * 50}%` }} /></span>
              <span className="p6-brl-v" role="cell"><Sourced src={() => driverProv(F, x, title, b.unit)} className={`num ${x.v > 0 ? 'pos' : x.v < 0 ? 'neg' : ''}`}>{sgn(x.v, d)}</Sourced></span>
            </div>
          ))}
        </div>
      ) : (phone || compact ? <MiniFall pts={pts.map((p) => ({ ...p, v: Number(p.v.toFixed(d)) }))} />
        : <WaterfallChart label={title} pts={pts} unit={unit} dec={pp ? 1 : 0} height={290} deps={[title, b.total, b.drivers.length]} onPoint={(i) => open(srcAt(i))} source="דוחות כספיים של החברות, MAYA; חישוב fox" />)}
      {view !== 'list' && view !== 'chart' && <div className="scroll attr-tw">
        <table className="attr-t">
          <caption className="sr-only">{title}: תרומת כל גורם</caption>
          <thead><tr><th scope="col">גורם</th><th scope="col">{pp ? 'נק׳ ROE' : MN}</th><th scope="col" className="ctx">מה זז</th></tr></thead>
          <tbody>
            {drv.map((x) => (
              <tr key={x.k} className={x.seg ? 'sv' : undefined}>
                <th scope="row">{x.l}{x.seg ? <span className="chip" title="מגזר החיסכון ארוך הטווח: חלק משורת דמי הניהול של הקבוצה, מדוחות החברות המנהלות; אינו רווח הקבוצה">מגזר חיסכון</span> : null}</th>
                <td><Sourced src={() => driverProv(F, x, title, b.unit)} className={`num ${x.v > 0 ? 'pos' : x.v < 0 ? 'neg' : ''}`}>{sgn(x.v, d)}</Sourced></td>
                <td className="ctx">{x.ctx ? <Sourced src={() => driverProv(F, x, title, b.unit)} className="ctxb">{x.ctx}</Sourced> : <span className="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {notes && notes.length > 0 && <p className="attr-note muted">{notes.join(' · ')}</p>}
    </div>
  );
}

const ORDER: Bridge['kind'][] = ['yoy', 'qoq', 'ltm'];

/** The company home's "why" panel: the bridge of the selected quarter (YoY, QoQ or LTM), for ROE or for attributable profit. */
export function AttributionPanel({ id, report }: { id: string;
  /** the report on screen ('2026Q3'): when the bridge stops earlier, a line says so (the bridge always prints its own period) */
  report?: string }) {
  const { data } = useAttribution(id);
  const [view, setView] = useState<'list' | 'chart'>('list');
  const [end, setEnd] = useState<string | null>(null);
  const [kind, setKind] = useState<Bridge['kind'] | null>(null);
  const [metric, setMetric] = useState<'roe' | 'np'>('roe');
  const by = useMemo(() => new Map((data?.bridges ?? []).map((b) => [b.id, b])), [data]);
  if (!data || !data.bridges.length) return null;
  const ends = data.ends.filter((e) => ORDER.some((k) => by.has(`${k}:${e}`)));
  const E = end && ends.includes(end) ? end : ends[ends.length - 1];
  const kinds = ORDER.filter((k) => by.has(`${k}:${E}`));
  const K = kind && kinds.includes(kind) ? kind : kinds[0];
  const b = by.get(`${K}:${E}`)!;
  const dec = b[metric];
  const title = `גשר ${metric === 'roe' ? 'ROE' : 'רווח לבעלי המניות'} · ${data.name} · ${b.la} → ${b.lb}`;
  const fromId = endId(data.facts, '', metric, b.win, b.a, b.chk.a), toId = endId(data.facts, '', metric, b.win, b.b, b.chk.b);
  const missing = data.gaps.filter((g) => g.id.endsWith(`:${E}`));
  const last = ends[ends.length - 1], behind = bridgeBehind(last, report);
  return (
    <Panel className="attr p6-attr" title={<>גשר {metric === 'roe' ? 'ROE' : 'רווח'}<span className="muted attr-sub"><span className="num">{b.la} → {b.lb}</span> · {metric === 'roe' ? 'נק׳ ROE' : MN}</span></>}
      aside={<Link to={`/attribution?a=${id}`}>מול עמיתים</Link>}>
      <div className="controls attr-c">
        <label className="field"><span>רבעון</span>
          <select aria-label="רבעון הגשר" value={E} onChange={(e) => setEnd(e.target.value)}>{[...ends].reverse().map((e) => <option key={e} value={e}>{ql(e)}</option>)}</select>
        </label>
        <Seg label="סוג ההשוואה" value={K} options={kinds.map((k) => [k, KIND_HE[k]] as [Bridge['kind'], string])} onChange={setKind} />
        <Seg label="מדד" value={metric} options={[['roe', 'ROE'], ['np', 'רווח']]} onChange={setMetric} />
        <Seg label="תצוגה" value={view} options={[['list', 'רשימה'], ['chart', 'גרף']]} onChange={setView} />
      </div>
      {behind && <p className="p6-behind" id="bridge-late">הגשר מחושב עד <b className="num">{ql(last)}</b>; הדוח המוצג בדף הוא <b className="num">{ql(report!.endsWith('FY') ? `${report!.slice(0, 4)}Q4` : report!)}</b>.</p>}
      <BridgeView F={data.facts} b={dec} title={title} la={b.la} lb={b.lb} fromId={fromId} toId={toId} method={data.method} view={view} notes={[...(b.notes ?? []), ...(metric === 'roe' ? [data.roe_def] : []), 'פירוק Shapley: התרומות מסתכמות בדיוק לשינוי']} />
      {missing.length > 0 && <p className="attr-note muted">לא זמין ל-<span className="num">{ql(E)}</span>: {missing.map((g) => `${KIND_HE[g.id.split(':')[0] as Bridge['kind']]} (${g.why.replace(/[⁦-⁩]/g, '')})`).join(' · ')}</p>}
    </Panel>
  );
}
