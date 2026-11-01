import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { useStored } from '../../lib/local';
import type { MyProduct } from '../../lib/mine';
import type { Prov } from '../../lib/prov';
import { fundP } from '../../lib/market';
import { netProv, refOf, ym, type FundX, type FundsFile } from '../../lib/funds';
import type { DefaultFile } from '../../lib/fundsTools';
import { verdictOf } from '../../lib/verdict';
import { EMPTY_SEEN, SEEN_KEY, baselineOf, changesOf, m1Of, monthsBetween, nextSeen, normSeen, snapOf, type Change, type MySnap, type SnapP } from '../../lib/mySince';

/* W3 · "מה השתנה מאז הביקור הקודם" on /my: rank, quarter, fees and the latest month per product, against the snapshot this browser kept
   (fox:my:seen). Fires only on a new data month (lib/mySince). The visit is recorded when the reader leaves the page. */

const today = () => new Date().toISOString().slice(0, 10);

export function SinceVisit({ data, dfile, list }: { data: FundsFile; dfile: DefaultFile | null | undefined; list: MyProduct[] }) {
  const [raw, setRaw] = useStored<unknown>(SEEN_KEY, EMPTY_SEEN);
  const seen = normSeen(raw);
  const asof = data.asof;
  const funds = data.funds as FundX[];
  const rows = useMemo(() => {
    const byK = new Map(funds.map((f) => [f.k, f]));
    return list.map((m) => byK.get(m.k)).filter((f): f is FundX => !!f).map((f) => {
      const v = verdictOf(f, funds, asof, dfile, null);
      const s = snapOf(f, v);
      const catM1 = v.peers.map((x) => m1Of(x as FundX, s.basis ?? 'net')).filter((x): x is number => x != null);
      return { f, s, catM1 };
    });
  }, [funds, list, asof, dfile]);
  const now: MySnap = useMemo(() => ({ v: 1, asof, at: today(), p: Object.fromEntries(rows.map((r) => [r.f.k, r.s])) }), [rows, asof]);

  // the visit ends when the reader leaves: what was shown is stored (the baseline of this month stays, lib/mySince.nextSeen)
  const ref = useRef({ raw, now }); ref.current = { raw, now };
  useEffect(() => {
    const mark = () => { const { raw: r, now: n } = ref.current; if (Object.keys(n.p).length) setRaw(nextSeen(normSeen(r), n)); };
    addEventListener('pagehide', mark);
    return () => { removeEventListener('pagehide', mark); mark(); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows.length) return null;
  const base = baselineOf(seen, asof);
  if (!base) {
    return <p className="sv-muted ms-quiet">{seen.cur ? `מה השתנה: אין נתונים חדשים מאז הביקור הקודם (נתוני ${ym(asof)}). כשהרשות תפרסם חודש חדש, יופיע כאן מה זז במוצרים שלך.` : 'מהביקור הבא: כשהרשות תפרסם חודש חדש, יופיע כאן מה השתנה במוצרים שלך (מקום, דמי ניהול ותשואת החודש). נשמר בדפדפן הזה בלבד.'}</p>;
  }
  const gap = monthsBetween(base.asof, asof);
  return (
    <section className="panel sv-card ms" aria-labelledby="ms-h">
      <div className="hd"><h2 id="ms-h">מה השתנה מאז הביקור הקודם</h2><div className="aside"><span>נתוני {ym(asof)} מול {ym(base.asof)}{gap > 1 ? ` (${gap} חודשים)` : ''}</span></div></div>
      <ul className="ms-list">
        {rows.map(({ f, s, catM1 }) => {
          const b = base.p[f.k];
          const cs = changesOf(b, s, catM1);
          return (
            <li key={f.k} className="ms-item">
              <a className="ms-name" href={`#${f.k}`}>{f.name}</a>
              {!b ? <p className="sv-muted">נוסף אחרי הביקור הקודם: ההשוואה תתחיל בחודש הבא.</p> : (
                <ul className="sv-lines ms-lines">
                  {cs.filter((c) => c.kind !== 'month').length === 0 && <li className="t-mid"><span className="sv-dot" aria-hidden="true" /><span>בלי שינוי במקום בקטגוריה ובדמי הניהול הממוצעים במסלול.</span></li>}
                  {cs.map((c) => <li key={c.kind} className={`t-${c.tone}`}><span className="sv-dot" aria-hidden="true" /><span><Sourced src={() => provOf(c, f, s, b, asof, base.asof, data)}>{c.text}</Sourced></span></li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="sv-note">המקום והרבעים: כמו בכרטיס (5Y נטו, צמודים חולקים מקום). דמי הניהול: הממוצע בפועל במסלול, לא דמי הניהול שלך. המצב בביקור הקודם נשמר בדפדפן הזה בלבד. לעוד מעקב חודשי: <Link to="/funds/watch">המעקב שלי</Link>. אין כאן המלצה.</p>
    </section>
  );
}

/** the source of one change: the regulator's column for the figures, the two snapshots for a move */
function provOf(c: Change, f: FundX, s: SnapP, b: SnapP, asof: number, basAsof: number, data: FundsFile): Prov {
  const R = refOf(f);
  if (c.kind === 'month') return s.basis === 'net' ? netProv(f, 'm1', asof, s.m1, data.net_method) : fundP(R, asof, 'MONTHLY_YIELD', 'תשואה חודשית', `${s.m1?.toFixed(2)}%`);
  if (c.kind === 'fee') return { k: 'calc', title: `דמי ניהול מצבירה, ממוצע בפועל · ${f.name}`, value: `${s.fee?.toFixed(2)}%`, formula: 'דמי הניהול הממוצעים היום מול אלה שנראו בביקור הקודם (AVG_ANNUAL_MANAGEMENT_FEE)',
    inputs: [{ label: ym(asof), v: `${s.fee?.toFixed(2)}%`, src: () => fundP(R, asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${s.fee?.toFixed(2)}%`) }, { label: `בביקור הקודם · ${ym(basAsof)}`, v: `${b.fee?.toFixed(2)}%`, src: () => fundP(R, basAsof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${b.fee?.toFixed(2)}%`) }] };
  if (c.kind === 'dep') return { k: 'calc', title: `דמי ניהול מהפקדה, ממוצע בפועל · ${f.name}`, value: `${s.depfee?.toFixed(2)}%`, formula: 'דמי הניהול מהפקדה הממוצעים היום מול אלה שנראו בביקור הקודם (AVG_DEPOSIT_FEE)',
    inputs: [{ label: ym(asof), v: `${s.depfee?.toFixed(2)}%`, src: () => fundP(R, asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה', `${s.depfee?.toFixed(2)}%`) }, { label: `בביקור הקודם · ${ym(basAsof)}`, v: `${b.depfee?.toFixed(2)}%` }] };
  return { k: 'calc', est: s.basis === 'net', title: `מקום בקטגוריה · ${f.name}`, value: `${s.lo === s.hi ? s.lo : `${s.lo}–${s.hi}`} מתוך ${s.n}`,
    formula: `מקום משותף בקטגוריה (${f.prod}, ${f.track}) על התשואה השנתית הממוצעת ל-5 שנים${s.basis === 'net' ? ' נטו (אומדן)' : ''}; פער של פחות מ-0.10 נ"א לשנה חולק מקום. רבע עליון / תחתון: כמו בכרטיס`,
    inputs: [{ label: `היום · ${ym(asof)}`, v: `${s.lo}–${s.hi} מתוך ${s.n}` }, { label: `בביקור הקודם · ${ym(basAsof)} (נשמר בדפדפן)`, v: `${b.lo}–${b.hi} מתוך ${b.n}` }] };
}
