import { useMemo, type ReactNode } from 'react';
import { Sourced } from '../components/Source';
import { Spark } from '../components/Spark';
import { Empty, Panel, Seg as SegCtl } from '../components/ui';
import { nf } from '../lib/format';
import { SEG_LONG, ql, spc, warmRep, type LensData } from '../lib/lens';
import { NAME, dmy } from '../lib/nowcast';
import { F2eSrc, type F2eData, type FEst, type FSeg, type FStat } from '../lib/nowcastF2e';
import type { Prov } from '../lib/prov';

/** Wave 11: the flow-to-earnings nowcast on /nowcast. The regulator's track-level fee book, calibrated to each manager's reported fee line. */
const m1 = (x: number | null | undefined) => (x == null ? '–' : nf(x, 1));
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const S = ({ src, children, className = '' }: { src: () => Prov; children: ReactNode; className?: string }) => <Sourced src={src}><span className={`num ${className}`}>{children}</span></Sourced>;
const st = (s: FStat | null | undefined, k: 'mdae' | 'mape') => (s == null ? '–' : `${nf(s[k], 2)}%`);
const bias = (s: FStat | null | undefined) => (s == null ? '–' : `${s.bias > 0 ? '+' : ''}${nf(s.bias, 2)}%`);
const SEGS: FSeg[] = ['pen', 'gem'];

export function F2eBlock({ f, lens, Mgr, mgr, setMgr }: { f: F2eData; lens: LensData; Mgr: (p: { c: string }) => ReactNode; mgr: string; setMgr: (v: string) => void }) {
  const src = useMemo(() => new F2eSrc(f, lens), [f, lens]);
  return (
    <>
      <h2 className="band" id="f2e">זרימה לרווח: ספר דמי הניהול של הרשות, מכויל לדוח<span className="muted">שיטה {f.meta.method} · רשות עד <span className="num">{String(f.meta.built_from.regulator_asof % 100).padStart(2, '0')}/{String(f.meta.built_from.regulator_asof).slice(2, 4)}</span> · דוחות עד <span className="num">{ql(f.meta.built_from.last_rep)}</span> · דמי ניהול מהפקדה {dmy(f.meta.built_from.depfee)}</span></h2>
      <F2eLive f={f} src={src} Mgr={Mgr} />
      <F2eScore f={f} Mgr={Mgr} />
      <F2eRatios f={f} src={src} Mgr={Mgr} lens={lens} />
      <F2eLedger f={f} src={src} mgr={mgr} setMgr={setMgr} />
      <Panel title="הנחות · זרימה לרווח" aside={<span className="chip est">אומדן</span>}>
        <ul className="nc-notes">
          <li>הכנסות משתמעות = דמי ניהול מצבירה + דמי ניהול מהפקדה, מספרי הרשות ברמת המסלול. מצבירה: (R₀ ÷ 2 + R₁ + R₂ + R₃ ÷ 2) ÷ 12, R = Σ נכסים × דמי ניהול ÷ 100. מהפקדה: Σ הפקדות × דמי ניהול מהפקדה ÷ 100 בשלושת חודשי הרבעון.</li>
          <li>יחס מכויל = ממוצע <span className="num">{f.params.F2E_N}</span> היחסים האחרונים (מדווח ÷ משתמע) שפורסמו לפני יום האומדן. טווח = משתמע × (יחס ∓ <span className="num">{nf(f.params.F2E_Z, 1)}</span> × סטיית התקן של עד <span className="num">{f.params.F2E_SD}</span> יחסים). טווח המנהל = סכום טווחי המגזרים.</li>
          <li>יום האומדן בבדיקה לאחור: <span className="num">{f.params.S2_DAYS}</span> יום לפני הדוח (שלב 2 של M1): רק דוחות שפורסמו קודם לכן. קבצי הרשות בגרסתם הנוכחית (data.gov.il אינו שומר גרסאות).</li>
          <li>רווח: רק עם הוצאות מהדוחות (הוצאות להכנסות של 4 הרבעונים האחרונים, עונתיות Q4 כמו ב-M1). אין מודל הוצאות עצמאי, ולכן אין אומדן רווח כשהדוח אינו מפרסם הוצאות למגזר.</li>
          <li>מסלולים בלי שיעור דמי ניהול מפורסם: הנחה, ממוצע הקבוצה (הכיסוי מוצג בכל חודש). דמי ניהול מהפקדה חודשיים אינם בקבצי המסלולים שהאתר מפרסם: הם נקראים מקבצי הרשות לקובץ nowcast_depfee.json, וסכום ההפקדות בו נבדק מול market.json בכל חודש.</li>
        </ul>
      </Panel>
    </>
  );
}

function F2eLive({ f, src, Mgr }: { f: F2eData; src: F2eSrc; Mgr: (p: { c: string }) => ReactNode }) {
  const L = f.ledger[f.ledger.length - 1];
  if (!L) return <Panel title="זרימה לרווח · הרבעון החי"><Empty title="עוד לא נקפא אומדן זרימה-לרווח">נקפא כשחודש 3 של הרבעון מתפרסם ברשות.</Empty></Panel>;
  const sc = (c: string) => f.score.find((x) => x.c === c && x.q === L.quarter);
  return (
    <Panel title={`${ql(L.quarter)} · אומדן זרימה-לרווח, קפוא ${dmy(L.created_at)}`} aside={<span>מיליוני ש"ח, רבעון · hash <span className="mono">{L.inputs_hash.slice(0, 12)}</span></span>}>
      <div className="scroll"><table className="lens-tbl nc-tbl">
        <thead><tr><th>מנהל</th><th className="wide-only">משתמע מהרשות</th><th className="wide-only">יחס מכויל</th><th>אומדן</th><th>טווח</th><th className="wide-only">M1 שלב 2</th><th className="wide-only">פער מ-M1</th><th>בפועל</th><th className="wide-only">סטייה</th><th className="wide-only">רווח מגזרי (הוצאות מהדוח)</th><th className="wide-only">דוח צפוי</th></tr></thead>
        <tbody>{L.rows.map((e: FEst) => { const s = sc(e.c), segs = Object.keys(e.segs) as FSeg[]; return (
          <tr key={e.c} onPointerEnter={() => warmRep(e.c)} onFocus={() => warmRep(e.c)}>
            <td><Mgr c={e.c} /></td>
            <td className="wide-only"><S src={() => ({ k: 'calc', title: `הכנסות משתמעות מהרשות · ${NAME[e.c]} · ${ql(e.q)}`, value: m1(e.imp), unit: 'מיליוני ש"ח', formula: 'סכום המגזרים',
              inputs: segs.map((x) => ({ label: SEG_LONG[x], v: m1(e.segs[x]!.imp), src: () => src.implied(e, x) })) })}>{m1(e.imp)}</S></td>
            <td className="wide-only"><span className="num">{segs.map((x) => nf(e.segs[x]!.ratio, 3)).join(' · ')}</span></td>
            <td><S className="est-num" src={() => src.rev(e)}>{m1(e.rev)}</S></td>
            <td><S className="est-num" src={() => src.range(e)}>{m1(e.lo)}–{m1(e.hi)}</S></td>
            <td className="wide-only"><span className="num est-num">{m1(e.m1_rev)}</span></td>
            <td className="wide-only"><span className="num">{e.m1_rev ? spc((e.rev - e.m1_rev) / e.m1_rev * 100, 1) : '–'}</span></td>
            <td>{s?.act ? <S src={() => src.actual(e.c, e.g, e.q, segs, s.act!.rev)}>{m1(s.act.rev)}</S> : <span className="muted lens-dash" title={`הדוח צפוי ${dmy(e.T_expected)}`}>–</span>}</td>
            <td className="wide-only">{s?.act ? <span className={`num ${tone(s.e_rev)}`}>{spc(s.e_rev, 1)}{s.in ? '' : ' · מחוץ לטווח'}</span> : '–'}</td>
            <td className="wide-only">{e.op != null ? <S className="est-num" src={() => src.op(e)}>{m1(e.op)}</S> : <span className="muted lens-dash" title="הדוח אינו מפרסם הוצאות למגזר: אין אומדן רווח">–</span>}</td>
            <td className="wide-only"><span className="num muted">{dmy(e.T_expected)}</span></td>
          </tr>); })}</tbody>
      </table></div>
      <div className="fnote">אומדן הכנסות מדמי ניהול של המגזר (פנסיה וגמל), לא רווח הקבוצה. M1: האומדן הקיים בדף (תשואה ממומשת × נכסים ממוצעים), לאותו רבעון, להשוואה. הרווח מוצג רק עם יחס הוצאות שפורסם בדוחות.</div>
    </Panel>
  );
}

function F2eScore({ f, Mgr }: { f: F2eData; Mgr: (p: { c: string }) => ReactNode }) {
  const rows = [...f.cover, 'all'].filter((c) => f.summary[c]);
  const bt = f.backtest;
  return (
    <Panel title="כרטיס פגיעה · כל רבעון שעבר, מהנתונים שהיו לפני הדוח" aside={<span>{ql(bt[0]?.q ?? '')}–{ql(bt[bt.length - 1]?.q ?? '')} · % מהבפועל</span>}>
      <div className="scroll"><table className="lens-tbl nc-tbl">
        <thead><tr><th>מנהל</th><th>רבעונים</th><th>חציון סטייה מוחלטת</th><th className="wide-only">MAPE</th><th className="wide-only">הטיה</th><th className="wide-only">סטייה מרבית</th><th>בתוך הטווח</th><th className="wide-only">M1, אותם רבעונים: חציון / MAPE</th><th className="wide-only">רווח: נק׳ מההכנסות (MAPE)</th></tr></thead>
        <tbody>{rows.map((c) => { const s = f.summary[c]; return (
          <tr key={c} className={c === 'all' ? 'tot' : ''}><td>{c === 'all' ? 'כל המנהלים' : <Mgr c={c} />}</td><td><span className="num">{s.rev?.n ?? '–'}</span></td>
            <td><span className="num">{st(s.rev, 'mdae')}</span></td><td className="wide-only"><span className="num">{st(s.rev, 'mape')}</span></td>
            <td className="wide-only"><span className="num">{bias(s.rev)}</span></td><td className="wide-only"><span className="num">{s.rev ? spc(s.rev.max, 1) : '–'}</span></td>
            <td><span className="num">{s.rev?.cover == null ? '–' : `${nf(s.rev.cover, 0)}%`}</span></td>
            <td className="wide-only"><span className="num">{st(s.m1, 'mdae')} / {st(s.m1, 'mape')}</span></td>
            <td className="wide-only"><span className="num">{s.opm ? nf(s.opm.mape, 2) : '–'}</span></td></tr>); })}</tbody>
      </table></div>
      <div className="fnote">כל שורה היא בדיקה לאחור: האומדן נבנה ביום שלב 2 (<span className="num">{f.params.S2_DAYS}</span> יום לפני הדוח) מהדוחות שפורסמו קודם לכן ומחודשי הרבעון ברשות, ונמדד מול הכנסות מדמי ניהול בדוח. הטיה חיובית = האומדן גבוה. בתוך הטווח: חלק הרבעונים שבהם הבפועל נפל בטווח ±{nf(f.params.F2E_Z, 1)}σ. רווח בנקודות: (אומדן − בפועל) ÷ הכנסות בפועל × 100.</div>
    </Panel>
  );
}

function F2eRatios({ f, src, Mgr, lens }: { f: F2eData; src: F2eSrc; Mgr: (p: { c: string }) => ReactNode; lens: LensData }) {
  const qs = [...new Set(Object.values(f.hist).flatMap((h) => Object.values(h).flatMap((x) => x!.map((b) => b.q))))]
    .sort((a, b) => (a.slice(3) + a[1]).localeCompare(b.slice(3) + b[1]));
  const show = qs.slice(-8);
  return (
    <Panel title="היחס המכויל: הכנסות בדוח ÷ הכנסות משתמעות מהרשות" aside={<span>לכל רבעון שפורסם · ממוצע וסטיית תקן על כל הרבעונים</span>}>
      <div className="scroll"><table className="lens-tbl nc-tbl">
        <thead><tr><th>מנהל</th><th>מגזר</th><th>מגמה</th>{show.map((q) => <th key={q} className="wide-only">{ql(q)}</th>)}<th>ממוצע</th><th>סטיית תקן</th></tr></thead>
        <tbody>{f.cover.flatMap((c) => SEGS.filter((s) => f.hist[c]?.[s]?.length).map((s) => { const h = f.hist[c][s]!, by = new Map(h.map((b) => [b.q, b])), rs = h.map((b) => b.ratio);
          const mu = rs.reduce((a, b) => a + b, 0) / rs.length, sd = rs.length > 1 ? Math.sqrt(rs.reduce((a, b) => a + (b - mu) ** 2, 0) / (rs.length - 1)) : null;
          const g = lens.groups.findIndex((x) => x.lts === c);
          return (
            <tr key={c + s}><td><Mgr c={c} /></td><td>{SEG_LONG[s]}</td><td><Spark data={rs} w={88} h={22} /></td>
              {show.map((q) => { const b = by.get(q); return <td key={q} className="wide-only">{b ? <S src={() => src.histRatio(c, g, s, b)}>{nf(b.ratio, 3)}</S> : '–'}</td>; })}
              <td><span className="num">{nf(mu, 3)}</span></td><td><span className="num">{sd == null ? '–' : nf(sd, 3)}</span></td></tr>); }))}</tbody>
      </table></div>
      <div className="fnote">יחס קרוב ל-1: ספר דמי הניהול של הרשות מסביר את שורת ההכנסות בדוח. סטייה קבועה מ-1: הבדלי היקף (קרנות ותיקות, חברה מנהלת מחוץ לקבוצת הרשות, הכנסות אחרות בשורה) שהכיול סופג. יחס שזז: שינוי תמהיל או שורת הכנסה שהאומדן אינו רואה.</div>
    </Panel>
  );
}

function F2eLedger({ f, src, mgr, setMgr }: { f: F2eData; src: F2eSrc; mgr: string; setMgr: (v: string) => void }) {
  const rows = f.backtest.filter((b) => b.c === mgr), g = src.lens.groups.findIndex((x) => x.lts === mgr);
  return (
    <Panel title={`יומן פגיעות · ${NAME[mgr] ?? mgr}`} aside={<span>מיליוני ש"ח</span>}>
      <section className="controls lens-ctl"><div className="field"><span>מנהל</span><SegCtl<string> label="מנהל" value={mgr} onChange={setMgr} options={f.cover.map((c) => [c, NAME[c] ?? c])} /></div></section>
      <div className="scroll"><table className="lens-tbl nc-tbl">
        <thead><tr><th>רבעון</th><th className="wide-only">יום האומדן</th><th className="wide-only">דוח</th><th className="wide-only">משתמע</th><th>אומדן</th><th className="wide-only">טווח</th><th>בפועל</th><th>סטייה</th><th>בטווח</th><th className="wide-only">M1: סטייה</th><th className="wide-only">רווח: נק׳</th></tr></thead>
        <tbody>{rows.map((b) => (
          <tr key={b.q}><td><span className="num">{ql(b.q)}</span></td><td className="wide-only"><span className="num muted">{dmy(b.day)}</span></td><td className="wide-only"><span className="num muted">{dmy(b.T)}</span></td>
            <td className="wide-only"><span className="num">{m1(b.imp)}</span></td>
            <td><S className="est-num" src={() => src.bt(b)}>{m1(b.rev)}</S>{!b.lag_ok && <span className="nc-lag" title="ביום השלב הנומינלי החודש האחרון עוד לא פורסם ברשות">*</span>}</td>
            <td className="wide-only"><span className="num">{m1(b.lo)}–{m1(b.hi)}</span></td>
            <td><S src={() => src.actual(b.c, g, b.q, Object.keys(b.segs), b.act.rev)}>{m1(b.act.rev)}</S></td>
            <td><span className={`num ${tone(b.e_rev)}`}>{spc(b.e_rev, 1)}</span></td>
            <td>{b.in ? <span className="num">✓</span> : <span className="num neg">✗</span>}</td>
            <td className="wide-only"><span className={`num ${tone(b.e_m1)}`}>{spc(b.e_m1, 1)}</span></td>
            <td className="wide-only"><span className={`num ${tone(b.e_opm)}`}>{b.e_opm == null ? '–' : `${b.e_opm > 0 ? '+' : ''}${nf(b.e_opm, 1)}`}</span></td></tr>))}</tbody>
      </table></div>
      <div className="fnote">* ביום השלב הנומינלי חודש הרשות האחרון עוד לא פורסם (הנחת פרסום: היום ה-{f.params.PUB_DAY} בחודש M+2). הבפועל: הכנסות מדמי ניהול בדוח, אותם מגזרים; כל מספר נפתח לעמוד בדוח.</div>
    </Panel>
  );
}
