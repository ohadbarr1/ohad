import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sourced } from '../Source';
import { Tip } from '../Explain';
import { MgrChip } from '../MgrChip';
import { Empty, Panel, Pick, Seg } from '../ui';
import { nf } from '../../lib/format';
import { listP, fundP } from '../../lib/market';
import { refOf, ym, type FundX } from '../../lib/funds';
import { BAND_HE, MIN_N, bandOf, categoriesOf, counted, feeDist, wmean, type FeeKey, type FeeUnit, type FeeSide } from '../../lib/feeDist';
import { feeLabel, obsProv, pc2, pctProv } from '../../lib/agentProv';
import { useOptional } from '../../lib/fundsLoad';
import { DECISION_PATH, segOf, svcOf, svcProv, type DecisionFile } from '../../lib/decision';  // W2
import './glossary';
import '../../styles/agent.css';

/* W1 · agent door: the fee benchmark for a negotiation, and the managers as cards instead of a 67-row wall.
   Per product and category: each managing group's average actual fee (accumulation, deposit), its place among the others, and
   p10 / p25 / median / p75 / p90, so an agent can say "the median manager charges X". lib/feeDist does the arithmetic. */

const PRODS = ['פנסיה מקיפה', 'פנסיה כללית', 'השתלמות', 'גמל', 'גמל להשקעה', 'חיסכון לילד', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)', 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים', 'ביטוחי מנהלים 1992-2003', 'מרכזית לפיצויים'];
const ALL = 'all';
const Q: [keyof Pick<NonNullable<FeeSide['pcts']>, 'p10' | 'p25' | 'p50' | 'p75' | 'p90'>, string][] = [['p10', 'P10'], ['p25', 'P25'], ['p50', 'חציון'], ['p75', 'P75'], ['p90', 'P90']];

function Side({ side, k, d, asof, funds, unit }: { side: FeeSide; k: FeeKey; d: ReturnType<typeof feeDist>; asof: number; funds: FundX[]; unit: FeeUnit }) {
  const [all, setAll] = useState(false);
  const p = side.pcts;
  if (!p) return <div className="fd-side"><h3>{feeLabel(k)}</h3><Empty title={`פחות מ-${MIN_N} ${unit === 'mgr' ? 'קבוצות' : 'מסלולים'} עם נתון`} /></div>;
  const lo = p.min, hi = p.max, span = hi - lo || 1, at = (v: number) => `${((v - lo) / span) * 100}%`;
  const rows = all ? side.obs : side.obs.slice(0, 12);
  return (
    <div className="fd-side">
      <h3>{feeLabel(k)} <Tip k={k} /></h3>
      <div className="fd-pcts">{Q.map(([q, l]) => <div key={q} className={q === 'p50' ? 'med' : undefined}><span className="l">{l}</span><Sourced className="v" src={() => pctProv(d, k, q, asof, funds)}><span className="num">{pc2(p[q], 2)}</span></Sourced></div>)}</div>
      <div className="fd-strip" aria-hidden="true">
        <span className="band w" style={{ insetInlineStart: at(p.p10), width: `calc(${at(p.p90)} - ${at(p.p10)})` }} />
        <span className="band" style={{ insetInlineStart: at(p.p25), width: `calc(${at(p.p75)} - ${at(p.p25)})` }} />
        <span className="med" style={{ insetInlineStart: at(p.p50) }} />
        {side.obs.map((o) => <span key={o.id} className="dot" style={{ insetInlineStart: at(o.v) }} title={`${o.label}: ${pc2(o.v)}`} />)}
      </div>
      <div className="fd-axis"><span className="num">{pc2(lo)}</span><span>{unit === 'mgr' ? 'קבוצה' : 'מסלול'} = נקודה · פס: P25–P75 · קו: חציון</span><span className="num">{pc2(hi)}</span></div>
      <table className="fd-list">
        <caption className="sr-only">{feeLabel(k)} לפי {unit === 'mgr' ? 'קבוצה' : 'מסלול'}</caption>
        <tbody>{rows.map((o) => { const b = bandOf(o.v, p); return (
          <tr key={o.id} className={b === '≤p10' || b === 'p10–p25' ? 'lo' : b === 'p75–p90' || b === '>p90' ? 'hi' : undefined}>
            <td>{unit === 'mgr' ? <MgrChip grp={o.grp} /> : <Link to={`/funds/${o.id}`}>{o.label}</Link>}{unit === 'mgr' && <span className="dim num"> · {o.tracks.length}</span>}</td>
            <td><Sourced src={() => obsProv(o, k, asof, funds)}><span className="num">{pc2(o.v)}</span></Sourced></td>
            <td className="barc"><div className="bar2"><i style={{ width: `${Math.max(3, ((o.v - lo) / span) * 100)}%` }} /></div></td>
            <td className="dim">{BAND_HE[b]}</td>
          </tr>); })}</tbody>
      </table>
      {side.obs.length > 12 && <button type="button" className="cmp-more" onClick={() => setAll(!all)}>{all ? 'פחות' : `כל ה-${side.obs.length}`}</button>}
    </div>
  );
}

/** the benchmark panel: product, category, unit; both fees side by side */
export function FeeBench({ funds, asof }: { funds: FundX[]; asof: number }) {
  const [sp, setSp] = useSearchParams();
  const prods = PRODS.filter((p) => funds.some((f) => f.prod === p && counted(f)));
  const prod = prods.includes(sp.get('fd') ?? '') ? sp.get('fd')! : prods[0] ?? 'פנסיה מקיפה';
  const unit: FeeUnit = sp.get('fu') === 'track' ? 'track' : 'mgr';
  const cats = useMemo(() => categoriesOf(funds, prod, unit), [funds, prod, unit]);
  const trackQ = sp.get('ft') ?? ALL;
  const track = trackQ !== ALL && cats.some((c) => c.track === trackQ) ? trackQ : ALL;
  const d = useMemo(() => feeDist(funds, prod, track === ALL ? null : track, unit), [funds, prod, track, unit]);
  const set = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setSp(n, { replace: true }); };
  return (
    <Panel title={<>התפלגות דמי ניהול <Tip k="feedist" /></>} aside={<><span className="chip">ממוצע בפועל</span><span className="num">{ym(asof)}</span></>}>
      <div className="fd-head">
        <Pick label="מוצר" cap="מוצר" value={prod} onChange={(v) => set({ fd: v, ft: null })} options={prods.map((p) => [p, p] as [string, string])} />
        <Pick label="קטגוריה" cap="קטגוריה" value={track} onChange={(v) => set({ ft: v === ALL ? null : v })} options={[[ALL, 'כל המסלולים'], ...cats.map((c) => [c.track, c.track, nf(c.n, 0)] as [string, string, string])]} />
        <Seg<FeeUnit> label="יחידה" value={unit} onChange={(u) => set({ fu: u === 'mgr' ? null : u })} options={[['mgr', 'לפי קבוצה'], ['track', 'לפי מסלול']]} />
        <span className="dim">{nf(d.nGroups, 0)} קבוצות · {nf(d.nTracks, 0)} מסלולים</span>
      </div>
      <div className="fd-grid">
        <Side side={d.fee} k="fee" d={d} asof={asof} funds={funds} unit={unit} />
        <Side side={d.depfee} k="depfee" d={d} asof={asof} funds={funds} unit={unit} />
      </div>
      <div className="fnote fd-who"><b>ממוצע על כל העמיתים, גם הוותיקים:</b> אינו המחיר שמשלם מצטרף חדש. הרשות אינה מפרסמת דמי ניהול לפי מועד הצטרפות או לפי הפקדות חדשות; {/^פנסיה/.test(prod) ? <>המחיר לעמית חדש בקרן ברירת מחדל נקבע במכרז (<Link to="/funds/default">קרנות ברירת מחדל</Link>).</> : 'המחיר לעמית חדש נקבע מול הגוף המנהל.'}</div>
      <div className="fnote">דמי הניהול הממוצעים בפועל שגבו המנהלים מעמיתיהם, מצבירה ומהפקדה (רשות שוק ההון, {ym(asof)}), לא מחיר מחירון ולא דמי הניהול של חוסך מסוים. {unit === 'mgr' ? 'לפי קבוצה: כל קבוצה מנהלת נספרת פעם אחת, דמי הניהול של מסלוליה משוקללים בנכסיהם.' : 'לפי מסלול: כל מסלול נספר פעם אחת.'} מסלולים פתוחים עם נכסים, בלי ניהול אישי וקופות ענפיות. אחוזונים בשיטת האינטרפולציה הלינארית (השיטה הרגילה של אקסל), רק עם {MIN_N} תצפיות לפחות. P10 ו-P90: הערך ש-10% ו-90% מהתצפיות נמוכים ממנו. ירוק: עד P25; אדום: מעל P75.</div>
    </Panel>
  );
}

/** the managers as cards (agent door): the groups of a product, largest first, with their fees against the median */
export function ManagerCards({ funds, asof }: { funds: FundX[]; asof: number }) {
  const [sp] = useSearchParams();
  const prods = PRODS.filter((p) => funds.some((f) => f.prod === p && counted(f)));
  const prod = prods.includes(sp.get('fd') ?? '') ? sp.get('fd')! : prods[0] ?? 'פנסיה מקיפה';
  const d = useMemo(() => feeDist(funds, prod, null, 'mgr'), [funds, prod]);
  const groups = useMemo(() => {
    const by = new Map<string, FundX[]>();
    funds.filter((f) => counted(f) && f.prod === prod).forEach((f) => by.set(f.grp, [...(by.get(f.grp) ?? []), f]));
    return [...by].map(([grp, l]) => ({ grp, l, assets: l.reduce((t, f) => t + (f.assets ?? 0), 0), r5: wmean(l.filter((f) => f.net?.a5 != null).map((f) => ({ v: f.net!.a5!, w: f.assets ?? 0 }))) })).sort((a, b) => b.assets - a.assets);
  }, [funds, prod]);
  const obsOf = (k: FeeKey, grp: string) => d[k].obs.find((o) => o.grp === grp);
  // W2: the company's place in the regulator's service index for the product's segment
  const dec = useOptional<DecisionFile>(DECISION_PATH);
  const seg = segOf(funds.find((f) => f.prod === prod) ?? { prod });
  return (
    <Panel title={`המנהלים ב${prod}`} aside={<span>לפי נכסים · דמי ניהול ממוצע בפועל · 5Y נטו, אומדן, משוקלל בנכסים</span>}>
      <div className="mg-digest">
        {groups.map((g) => { const fo = obsOf('fee', g.grp), dob = obsOf('depfee', g.grp); return (
          <article className="mg-card" key={g.grp}>
            <h3><MgrChip grp={g.grp} /><Link className="dim" to={`/funds/screen?prod=${encodeURIComponent(prod)}&track=all&mk=${encodeURIComponent(g.grp)}`}>{g.l.length} מסלולים</Link></h3>
            <dl>
              <div><dt>נכסים, מיליארד ש"ח</dt><dd><Sourced src={() => listP(`נכסים · ${g.grp} · ${prod}`, nf(g.assets / 1000, 1), 'מיליארד ש"ח', 'סכום TOTAL_ASSETS של מסלולי הקבוצה במוצר, חלקי 1,000', g.l.map((f) => ({ label: f.name, v: nf(f.assets ?? 0, 1), src: () => fundP(refOf(f), asof, 'TOTAL_ASSETS', 'נכסים', nf(f.assets ?? 0, 1), 'מיליוני ש"ח') })))}><span className="num">{nf(g.assets / 1000, 1)}</span></Sourced></dd></div>
              <div><dt>ד"נ מצבירה</dt><dd>{fo ? <Sourced src={() => obsProv(fo, 'fee', asof, funds)}><span className="num">{pc2(fo.v)}</span></Sourced> : '–'}</dd></div>
              <div><dt>ד"נ מהפקדה</dt><dd>{dob ? <Sourced src={() => obsProv(dob, 'depfee', asof, funds)}><span className="num">{pc2(dob.v)}</span></Sourced> : '–'}</dd></div>
            </dl>
            <div className="dim">{fo && d.fee.pcts ? `מצבירה: ${BAND_HE[bandOf(fo.v, d.fee.pcts)]}` : ''}{dob && d.depfee.pcts ? ` · מהפקדה: ${BAND_HE[bandOf(dob.v, d.depfee.pcts)]}` : ''}{g.r5 != null ? ` · 5Y ${nf(g.r5, 1)}%` : ''}</div>
            {dec && seg && (() => { const r = svcOf(dec, g.grp, seg); return r ? <div className="dim">מדד השירות {r.year}: <Sourced src={() => svcProv(dec, g.grp, seg, 'rank')}>מקום {r.rank}/{r.of}</Sourced>, ציון <Sourced src={() => svcProv(dec, g.grp, seg, 'total')}><span className="num">{r.total}</span></Sourced></div> : null; })()}
          </article>); })}
      </div>
      <div className="fnote">כל קבוצה: מסלוליה הפתוחים במוצר. דמי ניהול: ממוצע בפועל משוקלל בנכסים, מול חציון הקבוצות במוצר. 5Y: ממוצע שנתי נטו (אומדן) משוקלל בנכסים, לא דירוג. הטבלה המלאה של כל החברות המנהלות: "כל החברות".</div>
    </Panel>
  );
}
