import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { MigChip } from '../FlowDef';
import { actProv } from '../../lib/agentProv';
import { useOptional } from '../../lib/fundsLoad';
import { useDoor } from '../../lib/door';
import { fundP, monthsBack, type TrackRef } from '../../lib/market';
import { nf, sn } from '../../lib/format';
import type { Prov } from '../../lib/prov';
import type { FundX } from '../../lib/funds';
import { FEES_PATH, PROD_ID, SIG_PATH, bp, feeLog, signalOf, signalText, ym, type FeesFile, type SigFile } from '../../lib/flows';
import '../../styles/flows.css';

/* Wave 3 · the fund card's cash-flow panel: "אות זרימה" (the track's net flow over 3 and 12 months against the share of its category that
   grew, flows/sig.json) with the migration chip and, for pension, the last actuarial balance; and the fee change log (agent and Pro
   doors), from the track's own monthly history: every published month where the average fee moved 5bp or more. */

type H = { p: number[]; nd?: (number | null)[]; fee: (number | null)[]; df?: (number | null)[] };

/** the track's net flow over n months: the published NET_MONTHLY_DEPOSITS of each month */
function ndProv(R: TrackRef, f: FundX, h: H, asof: number, n: number, v: number): Prov {
  return { k: 'calc', title: `צבירה נטו, ${n} חודשים · ${f.name}`, value: nf(v, 1), unit: 'מיליוני ש"ח', formula: `סכום NET_MONTHLY_DEPOSITS של ${n} החודשים עד ${ym(asof)}`,
    inputs: monthsBack(asof, n).map((p) => { const i = h.p.indexOf(p), x = i < 0 ? null : h.nd?.[i] ?? null; return { label: ym(p), v: x == null ? '–' : nf(x, 1), src: () => fundP(R, p, 'NET_MONTHLY_DEPOSITS', 'צבירה נטו', x == null ? '–' : nf(x, 1), 'מיליוני ש"ח') }; }) };
}
/** the share of the category's tracks with a positive net flow over the window: the list, each with its sum */
function shareProv(sig: SigFile, f: FundX, funds: FundX[], n: 3 | 12, up: number, of: number): Prov {
  const cat = `${f.prod} | ${f.track}`, i = n === 3 ? 0 : 1;
  const peers = funds.filter((x) => `${x.prod} | ${x.track}` === cat && (x.assets ?? 0) > 0 && sig.t[x.k]?.[i] != null).sort((a, b) => sig.t[b.k][i]! - sig.t[a.k][i]!);
  return { k: 'calc', title: `מסלולים בקטגוריה שגדלו, ${n} חודשים · ${cat}`, value: `${nf(up / of * 100, 0)}%`, formula: `${sig.method}. אחוז = מסלולים בצבירה נטו חיובית ÷ מסלולים עם ערך`,
    inputs: [{ label: 'גדלו', v: nf(up, 0) }, { label: 'מסלולים', v: nf(of, 0) }, ...peers.map((x) => ({ label: x.name, v: sn(sig.t[x.k][i]!, 1) }))] };
}

export function FlowSignal({ f, h, R, asof, funds }: { f: FundX; h: H; R: TrackRef; asof: number; funds: FundX[] }) {
  const sig = useOptional<SigFile>(SIG_PATH);
  const s = signalOf(sig, f.k, `${f.prod} | ${f.track}`);
  const act = f.act != null && f.prod.startsWith('פנסיה');
  if (!s && !f.mig && !act) return null;
  const part = (n: 3 | 12) => {
    const v = n === 3 ? s?.nd3 : s?.nd12, up = n === 3 ? s!.up3 : s!.up12, of = n === 3 ? s!.n3 : s!.n12;
    if (v == null) return null;
    const share = of >= 5 ? up / of : null;
    const [a, b] = signalText(v, share, n).split('; ');
    return <span>
      <Sourced src={() => ndProv(R, f, h, asof, n, v)}>{a}</Sourced>
      {b && <>; <Sourced src={() => shareProv(sig!, f, funds, n, up, of)}>{b}</Sourced></>}
    </span>;
  };
  return (
    <div className="flowsig" data-testid="flow-signal">
      <span className="flowsig-k">אות זרימה</span>
      {s && part(3)}{s && part(12)}
      {f.mig && <MigChip f={f} />}
      {act && <span>איזון אקטוארי אחרון: <Sourced src={() => actProv(f)}><span className="num">{sn(f.act!, 2)}%</span></Sourced> ({ym(f.act_p ?? asof)})</span>}
      <Link to={`/flows?prod=${PROD_ID[f.prod] ?? 'pm'}`}>מי ניצח החודש</Link>
    </div>
  );
}

/** the fee change log of the track (agent and Pro doors): months where the published average fee moved 5bp or more */
export function FeeLog({ f, h, R }: { f: FundX; h: H; R: TrackRef }) {
  const [door] = useDoor();
  const fees = useOptional<FeesFile>(FEES_PATH);
  if (door === 'saver') return null;
  const log = feeLog(h.p, h.fee).reverse().slice(0, 12);
  const dlog = h.df ? feeLog(h.p, h.df).reverse().slice(0, 6) : [];
  const row = fees?.rows.find((r) => r.k === f.k);
  const cell = (p: number, col: string, label: string, v: number) => <Sourced src={() => fundP(R, p, col, label, `${nf(v, 2)}%`)}><span className="num">{nf(v, 2)}%</span></Sourced>;
  return (
    <div className="feelog" data-testid="fee-log">
      <div className="flowsig"><span className="flowsig-k">שינויי דמי ניהול מצבירה, ממוצע בפועל</span>
        {row?.d12 != null && row.fee12 != null && <span>12 חודשים: <Sourced src={() => ({ k: 'calc', title: `שינוי דמי ניהול, 12 חודשים · ${f.name}`, value: `${sn(row.d12!, 1)} נ"ב`, formula: 'דמי הניהול הממוצעים בפועל ב-asof פחות 12 חודשים קודם, × 100', inputs: [
          { label: ym(fees!.asof), v: `${nf(row.fee, 2)}%`, src: () => fundP(R, fees!.asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${nf(row.fee, 2)}%`) },
          { label: '12 חודשים קודם', v: `${nf(row.fee12!, 2)}%` }] })}><span className="num">{sn(row.d12, 1)} נ"ב</span></Sourced></span>}
      </div>
      {log.length === 0 ? <div className="fnote">אין חודש שבו השיעור זז ב-5 נ"ב או יותר מהחודש שפורסם לפניו.</div> : (
        <div className="scroll"><table className="dt dense" aria-label="שינויי דמי ניהול">
          <thead><tr><th scope="col">חודש</th><th scope="col">לפני</th><th scope="col">אחרי</th><th scope="col">נ"ב</th></tr></thead>
          <tbody>{log.map(([p, a, b]) => <tr key={p}><td className="num">{ym(p)}</td><td>{cell(p, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה (החודש הקודם שפורסם)', a)}</td><td>{cell(p, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', b)}</td><td className={`num ${b > a ? 'neg' : 'pos'}`}>{sn(bp(a, b), 0)}</td></tr>)}</tbody>
        </table></div>
      )}
      {dlog.length > 0 && <div className="fnote">מהפקדה: {dlog.map(([p, a, b]) => `${ym(p)} ${nf(a, 2)}%→${nf(b, 2)}%`).join(' · ')}</div>}
      <div className="fnote">ממוצע בפועל של המסלול כפי שפורסם בכל חודש, לא מה שחוסך מסוים משלם. {h.df ? '' : 'דמי ניהול מהפקדה: אין סדרה חודשית בקבצי ההיסטוריה.'}</div>
    </div>
  );
}
