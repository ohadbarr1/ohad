import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { useMy, type MyProduct } from '../../lib/mine';
import type { Prov } from '../../lib/prov';
import { fundP } from '../../lib/market';
import { grossProv, netProv, refOf, ym, type FundX, type FundsFile } from '../../lib/funds';
import type { DefaultFile } from '../../lib/fundsTools';
import { verdictOf } from '../../lib/verdict';
import { EMPTY_SEEN, SEEN_KEY, baselineOf, changesOf, monthsBetween, y12Of, nextSeen, normSeen, snapOf, type Change, type MySnap, type SnapP } from '../../lib/mySince';

/* W3 · "מה השתנה מאז הביקור הקודם" on /my: rank, quarter, fees and the last 12 months per product (W5: no 1-month return), against the snapshot this browser kept
   (fox:my:seen). Fires only on a new data month (lib/mySince). The visit is recorded on arrival, and again on leaving. */

const today = () => new Date().toISOString().slice(0, 10);

export function SinceVisit({ data, dfile, list }: { data: FundsFile; dfile: DefaultFile | null | undefined; list: MyProduct[] }) {
  const [raw, setRaw] = useMy<unknown>(SEEN_KEY, EMPTY_SEEN);  // W7: per household profile
  const seen = normSeen(raw);
  const asof = data.asof;
  const funds = data.funds as FundX[];
  const rows = useMemo(() => {
    const byK = new Map(funds.map((f) => [f.k, f]));
    return list.map((m) => byK.get(m.k)).filter((f): f is FundX => !!f).map((f) => {
      const v = verdictOf(f, funds, asof, dfile, null);
      const s = snapOf(f, v);
      const catY = v.peers.map((x) => y12Of(x as FundX, s.basis ?? 'net')).filter((x): x is number => x != null);
      return { f, s, catY };
    });
  }, [funds, list, asof, dfile]);
  const now: MySnap = useMemo(() => ({ v: 1, asof, at: today(), p: Object.fromEntries(rows.map((r) => [r.f.k, r.s])) }), [rows, asof]);

  // W4: the visit is recorded on arrival (and again whenever the list changes), not only on leaving: iOS Safari often never fires
  // pagehide or the unmount, and then the baseline never started (red team 02.11.26). nextSeen keeps this month's baseline, so writing
  // early loses nothing: on a new month the old snapshot becomes `prev` and baselineOf still compares against it.
  const first = useRef(seen);  // what this browser had before this visit: the quiet line reads it, not the snapshot just written
  const ref = useRef({ raw, now }); ref.current = { raw, now };
  const mark = () => { const { raw: r, now: n } = ref.current; if (!Object.keys(n.p).length) return; const nx = nextSeen(normSeen(r), n); if (JSON.stringify(nx) !== JSON.stringify(normSeen(r))) setRaw(nx); };
  useEffect(() => { mark(); }, [now]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { addEventListener('pagehide', mark); return () => { removeEventListener('pagehide', mark); mark(); }; }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows.length) return null;
  const base = baselineOf(seen, asof);
  if (!base) {
    return <p className="sv-muted ms-quiet">{first.current.cur ? `מה השתנה: אין נתונים חדשים מאז הביקור הקודם (${ym(asof)}).` : 'מה השתנה: יופיע כאן בעדכון הנתונים הבא.'}</p>;
  }
  const gap = monthsBetween(base.asof, asof);
  return (
    <section className="panel sv-card ms" aria-labelledby="ms-h">
      <div className="hd"><h2 id="ms-h">מה השתנה מאז הביקור הקודם</h2><div className="aside"><span>נתוני {ym(asof)} מול {ym(base.asof)}{gap > 1 ? ` (${gap} חודשים)` : ''}</span></div></div>
      <ul className="ms-list">
        {rows.map(({ f, s, catY }) => {
          const b = base.p[f.k];
          const cs = changesOf(b, s, catY);
          return (
            <li key={f.k} className="ms-item">
              <a className="ms-name" href={`#${f.k}`}>{f.name}</a>
              {!b ? <p className="sv-muted">נוסף אחרי הביקור הקודם: ההשוואה תתחיל בחודש הבא.</p> : (
                <ul className="sv-lines ms-lines">
                  {cs.filter((c) => c.kind !== 'ltm').length === 0 && <li className="t-mid"><span className="sv-dot" aria-hidden="true" /><span>בלי שינוי במקום בקטגוריה ובדמי הניהול הממוצעים במסלול.</span></li>}
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
  if (c.kind === 'ltm') return s.basis === 'net' ? netProv(f, 'y12', asof, s.y12 ?? null, data.net_method) : grossProv(f, 'y12', asof);
  if (c.kind === 'fee') return { k: 'calc', title: `דמי ניהול מצבירה, ממוצע בפועל · ${f.name}`, value: `${s.fee?.toFixed(2)}%`, formula: 'דמי הניהול מצבירה הממוצעים בפועל היום, מול אלה שנראו בביקור הקודם',
    inputs: [{ label: ym(asof), v: `${s.fee?.toFixed(2)}%`, src: () => fundP(R, asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${s.fee?.toFixed(2)}%`) }, { label: `בביקור הקודם · ${ym(basAsof)}`, v: `${b.fee?.toFixed(2)}%`, src: () => fundP(R, basAsof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${b.fee?.toFixed(2)}%`) }] };
  if (c.kind === 'dep') return { k: 'calc', title: `דמי ניהול מהפקדה, ממוצע בפועל · ${f.name}`, value: `${s.depfee?.toFixed(2)}%`, formula: 'דמי הניהול מהפקדה הממוצעים בפועל היום, מול אלה שנראו בביקור הקודם',
    inputs: [{ label: ym(asof), v: `${s.depfee?.toFixed(2)}%`, src: () => fundP(R, asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה', `${s.depfee?.toFixed(2)}%`) }, { label: `בביקור הקודם · ${ym(basAsof)}`, v: `${b.depfee?.toFixed(2)}%` }] };
  return { k: 'calc', est: s.basis === 'net', title: `מקום בקטגוריה · ${f.name}`, value: `${s.lo === s.hi ? s.lo : `${s.lo}–${s.hi}`} מתוך ${s.n}`,
    formula: `מקום משותף בקטגוריה (${f.prod}, ${f.track}) על התשואה השנתית הממוצעת ל-5 שנים${s.basis === 'net' ? ' נטו (אומדן)' : ''}; פער של פחות מ-0.10 נ"א לשנה חולק מקום. רבע עליון / תחתון: כמו בכרטיס`,
    inputs: [{ label: `היום · ${ym(asof)}`, v: `${s.lo}–${s.hi} מתוך ${s.n}` }, { label: `בביקור הקודם · ${ym(basAsof)} (נשמר בדפדפן)`, v: `${b.lo}–${b.hi} מתוך ${b.n}` }] };
}
