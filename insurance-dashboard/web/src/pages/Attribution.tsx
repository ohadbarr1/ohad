import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { BridgeView } from '../components/Attribution';
import { Sourced } from '../components/Source';
import { keepSrc } from '../lib/prov';
import { nf } from '../lib/format';
import { KIND_HE, bridgeProv, endId, factProv, ql, sgn, useAttrIndex, useAttribution, usePeersAttr, type AttrIndex, type Bridge, type PeersFile } from '../lib/attribution';
import '../styles/attribution.css';

const PERIOD = /^\d{4}Q[1-4]$/;

/** /attribution?a=<company>&b=<company|period>[&w=q|ltm]: why company a differs from company b (peer bridge, the latest quarter),
 *  or how company a moved from period b (a time bridge). Not a nav item: reached from the company home's attribution panel. */
export function AttributionPage() {
  const [sp, setSp] = useSearchParams();
  const idx = useAttrIndex();
  const I = idx.data;
  if (idx.error) return <ErrorBox what="נתוני הגשר" error={idx.error} />;
  if (!I) return <Loading what="נתוני הגשר" />;
  const a = I.companies.some((c) => c.id === sp.get('a')) ? sp.get('a')! : I.companies[0]?.id;
  const b = sp.get('b') ?? '';
  const set = (o: Record<string, string>) => setSp(keepSrc(Object.fromEntries(Object.entries({ a, b, w: sp.get('w') ?? '', ...o }).filter(([, v]) => v))), { replace: true });
  return PERIOD.test(b) ? <TimeView I={I} a={a} b={b} set={set} /> : <PeerView I={I} a={a} b={b} w={sp.get('w') === 'ltm' ? 'ltm' : 'q'} set={set} />;
}

function Head({ title, sub }: { title: string; sub: React.ReactNode }) {
  return <div className="pagehead"><div><h1>{title}</h1><div className="sub">{sub}</div></div></div>;
}

function PeerView({ I, a, b, w, set }: { I: AttrIndex; a: string; b: string; w: 'q' | 'ltm'; set: (o: Record<string, string>) => void }) {
  const P = usePeersAttr(I.peers);
  const d = P.data;
  const kindOf = (c: string) => I.companies.find((x) => x.id === c)?.kind;
  const same = I.companies.filter((c) => c.kind === kindOf(a) && c.id !== a);
  const B = same.some((c) => c.id === b) ? b : same[0]?.id;
  const by = useMemo(() => new Map((d?.bridges ?? []).map((x) => [x.id, x])), [d]);
  if (P.error) return <ErrorBox what="גשרי העמיתים" error={P.error} />;
  if (!d) return <Loading what="גשרי העמיתים" />;
  const name = (c: string) => d.companies[c]?.name ?? I.companies.find((x) => x.id === c)?.name ?? c;
  const pb = B ? by.get(`${w}:${B}:${a}`) : undefined;
  const label = w === 'ltm' ? `LTM ${d.label}` : d.label;
  return (
    <div className="attr-page">
      <Head title={`גשר ROE · ${name(a)} מול ${B ? name(B) : 'עמיתים'}`} sub={<><span className="num">{label}</span><span>·</span><span>{w === 'q' ? 'רבעון, שנתי' : 'ארבעה רבעונים'}</span><span>·</span><Link to={`/company/${a}`}>{name(a)}</Link></>} />
      <section className="controls attr-pick" aria-label="בחירה">
        <label className="field"><span>חברה</span>
          <select aria-label="החברה המוסברת" value={a} onChange={(e) => set({ a: e.target.value, b: '' })}>{I.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>מול</span>
          <select aria-label="חברת הבסיס" value={B ?? ''} onChange={(e) => set({ b: e.target.value })}>{same.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <Seg label="חלון" value={w} options={[['q', d.label], ['ltm', `LTM ${d.label}`]]} onChange={(v) => set({ w: v })} />
        <label className="field"><span>לאורך זמן</span>
          <select aria-label="גשר לאורך זמן מתקופה" value="" onChange={(e) => e.target.value && set({ b: e.target.value, w: '' })}>
            <option value="">מתקופה…</option>
            {[1, 4].map((k) => { const q = back(d.period, k); return <option key={q} value={q}>{`${ql(q)} → ${d.label} (${k === 1 ? 'QoQ' : 'YoY'})`}</option>; })}
          </select></label>
      </section>
      {pb && B ? (
        <Panel title={<>למה ROE של {name(a)} {pb.roe.total >= 0 ? 'גבוה' : 'נמוך'} מזה של {name(B)}</>}>
          <BridgeView F={d.facts} b={pb.roe} title={`גשר ROE · ${name(B)} → ${name(a)} · ${label}`} la={name(B)} lb={name(a)}
            fromId={endId(d.facts, `${B}:`, 'roe', w, d.period, pb.chk.a)} toId={endId(d.facts, `${a}:`, 'roe', w, d.period, pb.chk.b)} method={`${d.method} ${d.def}`} />
        </Panel>
      ) : <div className="empty"><p>אין גשר ל-{name(a)} מול {B ? name(B) : 'עמיתים'} ב-{label}</p></div>}
      <Matrix d={d} a={a} B={B} w={w} name={name} set={set} label={label} />
      {d.gaps.length > 0 && <p className="attr-note muted">חסרים: {d.gaps.map((g) => g.why.replace(/[⁦-⁩]/g, '')).join(' · ')}</p>}
    </div>
  );
}

function back(qk: string, k: number) {
  const i = Number(qk.slice(0, 4)) * 4 + Number(qk[5]) - 1 - k;
  return `${Math.floor(i / 4)}Q${(i % 4) + 1}`;
}

/** a against every peer of its kind: both ROEs, the gap and its largest driver */
function Matrix({ d, a, B, w, name, set, label }: { d: PeersFile; a: string; B?: string; w: 'q' | 'ltm'; name: (c: string) => string; set: (o: Record<string, string>) => void; label: string }) {
  const rows = d.bridges.filter((x) => x.win === w && x.b === a).sort((x, y) => y.roe.total - x.roe.total);
  if (!rows.length) return null;
  return (
    <Panel title={<>{name(a)} מול כל העמיתים<span className="muted attr-sub">ROE · {label} · {name(a)} <Sourced src={() => factProv(d.facts, endId(d.facts, `${a}:`, 'roe', w, d.period, rows[0].chk.b) ?? '')}>{nf(rows[0].roe.to, 1)}%</Sourced></span></>}>
      <div className="scroll"><table className="attr-mx">
        <thead><tr><th scope="col">מול</th><th scope="col">ROE שלהם</th><th scope="col">פער, נק׳</th><th scope="col" className="wide">הגורם הגדול</th></tr></thead>
        <tbody>{rows.map((x) => {
          const big = x.roe.drivers.reduce((m, y) => (Math.abs(y.v) > Math.abs(m.v) ? y : m), x.roe.drivers[0]);
          const t = `גשר ROE · ${name(x.a)} → ${name(a)} · ${label}`;
          const src = () => bridgeProv(d.facts, x.roe, t, endId(d.facts, `${x.a}:`, 'roe', w, d.period, x.chk.a), endId(d.facts, `${a}:`, 'roe', w, d.period, x.chk.b), name(x.a), name(a), d.method);
          return (
            <tr key={x.id} aria-current={x.a === B ? 'true' : undefined}>
              <th scope="row"><a href={`?a=${a}&b=${x.a}${w === 'ltm' ? '&w=ltm' : ''}`} onClick={(e) => { e.preventDefault(); set({ b: x.a }); }}>{name(x.a)}</a></th>
              <td className="n"><Sourced src={src}>{nf(x.roe.from, 1)}%</Sourced></td>
              <td className="n"><Sourced src={src} className={x.roe.total > 0 ? 'pos' : x.roe.total < 0 ? 'neg' : ''}>{sgn(x.roe.total, 1)}</Sourced></td>
              <td className="wide">{big.l} <Sourced src={src}>{sgn(big.v, 1)}</Sourced></td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </Panel>
  );
}

function TimeView({ I, a, b, set }: { I: AttrIndex; a: string; b: string; set: (o: Record<string, string>) => void }) {
  const { data, error } = useAttribution(a);
  if (error) return <ErrorBox what="נתוני הגשר" error={error} />;
  if (!data) return <Loading what="נתוני הגשר" />;
  // the bridge from period b to the latest quarter; otherwise the bridges that end at b
  const pick: Bridge | undefined = data.bridges.find((x) => x.a === b && x.b === data.last && x.win === 'q') ?? data.bridges.find((x) => x.b === b && x.kind === 'yoy') ?? data.bridges.find((x) => x.b === b);
  return (
    <div className="attr-page">
      <Head title={`גשר ROE · ${data.name}`} sub={<>{pick ? <><span className="num">{pick.la}</span><span>→</span><span className="num">{pick.lb}</span><span>·</span><span>{KIND_HE[pick.kind]}</span></> : <span>אין גשר ל-{ql(b)}</span>}<span>·</span><Link to={`/company/${a}`}>{data.name}</Link></>} />
      <section className="controls attr-pick" aria-label="בחירה">
        <label className="field"><span>חברה</span>
          <select aria-label="החברה" value={a} onChange={(e) => set({ a: e.target.value })}>{I.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>מתקופה</span>
          <select aria-label="תקופת הבסיס" value={b} onChange={(e) => set({ b: e.target.value })}>{[...new Set(data.bridges.filter((x) => x.win === 'q').map((x) => x.a))].sort().reverse().map((q) => <option key={q} value={q}>{ql(q)}</option>)}</select></label>
        <button type="button" className="btn" onClick={() => set({ b: '' })}>מול עמיתים</button>
      </section>
      {pick ? (['roe', 'np'] as const).map((m) => (
        <Panel key={m} title={m === 'roe' ? 'ROE' : 'רווח לבעלי המניות'}>
          <BridgeView F={data.facts} b={pick[m]} title={`גשר ${m === 'roe' ? 'ROE' : 'רווח'} · ${data.name} · ${pick.la} → ${pick.lb}`} la={pick.la} lb={pick.lb}
            fromId={endId(data.facts, '', m, pick.win, pick.a, pick.chk.a)} toId={endId(data.facts, '', m, pick.win, pick.b, pick.chk.b)} method={data.method} notes={m === 'roe' ? [...(pick.notes ?? []), data.roe_def] : pick.notes} />
        </Panel>
      )) : <div className="empty"><p>{data.gaps.filter((g) => g.id.endsWith(b)).map((g) => g.why.replace(/[⁦-⁩]/g, '')).join(' · ') || `אין גשר מ-${ql(b)}`}</p></div>}
    </div>
  );
}
