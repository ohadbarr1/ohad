import { useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sourced } from '../components/Source';
import { IdDot } from '../components/MgrChip';
import { Empty, ErrorBox, Loading, Panel, Seg as SegCtl } from '../components/ui';
import { nf } from '../lib/format';
import { ql, spc, useLens, warmRep, type LensData } from '../lib/lens';
import { NAME, NcSrc, dmy, useNowcast, type NcBt, type NcEst, type NcStat, type NowcastData } from '../lib/nowcast';
import type { Prov } from '../lib/prov';
import '../styles/lens.css';
import '../styles/nowcast.css';

/** Module M1, UNPUBLISHED: estimates frozen before the print, scored against it. Not linked from the nav, home, search or any page. */
export function Nowcast() {
  useNoindex();
  const nc = useNowcast(), lens = useLens();
  if (nc.error || lens.error) return <ErrorBox what="האומדנים" error={nc.error ?? lens.error ?? ''} />;
  if (!nc.data || !lens.data) return <Loading what="האומדנים" />;
  return <Page d={nc.data} lens={lens.data} />;
}

/** <meta name="robots" content="noindex"> while this route is open */
function useNoindex() {
  useEffect(() => {
    const m = document.createElement('meta');
    m.name = 'robots'; m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, []);
}

const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const m1 = (x: number | null | undefined) => (x == null ? '–' : nf(x, 1));
const S = ({ src, children, className = '' }: { src: () => Prov; children: ReactNode; className?: string }) => <Sourced src={src}><span className={`num ${className}`}>{children}</span></Sourced>;
const Dash = ({ why }: { why: string }) => <span className="muted lens-dash" title={why}>–</span>;
const pp = (x: number | null | undefined) => (x == null ? '–' : `${x > 0 ? '+' : ''}${nf(x, 1)}`);
const stat = (s: NcStat | null | undefined) => (s == null ? '–' : `${nf(s.mape, 1)}% / ${s.bias > 0 ? '+' : ''}${nf(s.bias, 1)}%`);
const statPP = (s: NcStat | null | undefined) => (s == null ? '–' : `${nf(s.mape, 1)} / ${s.bias > 0 ? '+' : ''}${nf(s.bias, 1)}`);

function Page({ d, lens }: { d: NowcastData; lens: LensData }) {
  const [sp, setSp] = useSearchParams();
  const src = useMemo(() => new NcSrc(d, lens), [d, lens]);
  const quarters = [...new Set(d.ledger.map((l) => l.quarter))].sort((a, b) => (a.slice(3) + a[1]).localeCompare(b.slice(3) + b[1])).reverse();
  const q = quarters.includes(sp.get('q') ?? '') ? sp.get('q')! : quarters[0] ?? d.meta.live.q;
  const mgr = d.cover.includes(sp.get('m') ?? '') ? sp.get('m')! : d.cover[0];
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  return (
    <>
      <h2 className="band">אומדנים לפני הדוח<span className="muted"><span className="chip nc-draft">טיוטה, לא פורסם</span> פנסיה וגמל: הכנסות מדמי ניהול ורווח תפעולי מגזרי · רשות שוק ההון עד <span className="num">{lensMonth(d.meta.built_from.regulator_asof)}</span> · דוחות עד <span className="num">{ql(d.meta.built_from.last_rep)}</span> · שיטה {d.meta.method}</span></h2>
      {quarters.length > 1 && <div className="lens-views"><SegCtl<string> label="רבעון" value={q} onChange={(v) => set('q', v)} options={quarters.map((x) => [x, ql(x)])} /></div>}
      <Live d={d} src={src} q={q} />
      <Scorecard d={d} src={src} />
      <Summary d={d} />
      <Detail d={d} src={src} mgr={mgr} setMgr={(v) => set('m', v === d.cover[0] ? '' : v)} />
      <Panel title="הנחות" aside={<span className="chip est">אומדן</span>}>
        <ul className="nc-notes">
          <li>שלב 1: חודשים 1–2 בפועל, חודש 3 באומדן (A₃ = A₂ + ממוצע הצבירה נטו של חודשים 1–2, ללא תשואת שוק). יום נומינלי: <span className="num">{d.params.S1_DAYS}</span> יום לפני הדוח. שלב 2: שלושת החודשים בפועל, <span className="num">{d.params.S2_DAYS}</span> יום לפני הדוח.</li>
          <li>תשואת דמי ניהול: ממומשת ב-4 הרבעונים האחרונים שפורסמו (הכנסות מהדוח ÷ נכסים ממוצעים מהרשות) + סחף = <span className="num">{nf(d.params.DRIFT_DAMP, 1)}</span> × שיפוע OLS × <span className="num">{nf(d.params.DRIFT_H, 1)}</span> רבעונים.</li>
          <li>הוצאות: הכנסות × הוצאות להכנסות של 4 הרבעונים האחרונים, עם מקדם עונתיות ל-Q4 (k, בין <span className="num">{nf(d.params.K_LO, 1)}</span> ל-<span className="num">{nf(d.params.K_HI, 1)}</span>).</li>
          <li>נוסטרו (בתי השקעות בלבד, לא נמדד מול בפועל): נכסים פיננסיים × ריבית בנק ישראל ÷ 4, ללא שערוך.</li>
          <li>חודש רשות M נקרא ביום <span className="num">{d.params.PUB_DAY}</span> בחודש M+2. בבדיקה לאחור: קבצי הרשות בגרסתם הנוכחית (data.gov.il אינו שומר גרסאות), כך שתיקונים מאוחרים לחודשים ישנים כלולים.</li>
          <li>מבטחות: אומדן מגזרי של החברה המנהלת (פנסיה וגמל) בלבד, לא רווח הקבוצה. ביטוחי מנהלים ופוליסות חיסכון אינם כלולים.</li>
        </ul>
      </Panel>
    </>
  );
}
const lensMonth = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;

function Mgr({ c }: { c: string }) {
  const grp: Record<string, string> = { menora: 'מנורה מבטחים', altshuler: 'אלטשולר שחם', yelin: 'ילין לפידות' };
  return <span className="lens-mgr nc-mgr"><IdDot grp={grp[c] ?? NAME[c] ?? c} />{NAME[c] ?? c}</span>;
}
const Scope = ({ e }: { e: { scope: 'house' | 'segment' } }) => e.scope === 'house'
  ? <span className="chip nc-scope" title="בית השקעות: פנסיה וגמל הם רוב העסק; שורת הנוסטרו משלימה לאומדן העסק כולו">כמעט כל העסק</span>
  : <span className="chip nc-scope seg" title="מבטחת: אומדן מגזרי של החברה המנהלת בלבד, לא רווח הקבוצה ולא רווח למניה">מגזר בלבד</span>;

/* ---------- the live quarter: Stage 1, Stage 2, actual, error ---------- */
function Live({ d, src, q }: { d: NowcastData; src: NcSrc; q: string }) {
  const s1 = d.ledger.find((l) => l.quarter === q && l.stage === 1), s2 = d.ledger.find((l) => l.quarter === q && l.stage === 2);
  const any = s1 ?? s2;
  if (!any) return <Empty title={`אין אומדן קפוא ל-${ql(q)}`} />;
  const byC = (l: typeof s1, c: string) => l?.rows.find((r) => r.c === c);
  const score = (c: string) => d.score.find((x) => x.c === c && x.q === q);
  const base = d.meta.built_from.last_rep;
  const lastM = Math.max(...any.rows.flatMap((r) => Object.values(r.segs).flatMap((s) => s!.months.filter((m) => !m.est).map((m) => m.ym))));
  return (
    <Panel title={`${ql(q)} · שלב 1, שלב 2, בפועל`} aside={<span>מיליוני ש"ח, רבעון · קפוא {s1 ? dmy(s1.created_at) : ''}{s2 ? ` · ${dmy(s2.created_at)}` : ''}</span>}>
      <div className="lens-note est"><span className="chip est">אומדן</span> שלב 1 קפוא <span className="num">{s1 ? dmy(s1.created_at) : '–'}</span> מחודשי רשות עד <span className="num">{lensMonth(lastM)}</span> · שלב 2 {s2 ? <>קפוא <span className="num">{dmy(s2.created_at)}</span></> : <>ממתין לחודש <span className="num">{lensMonth(lastM + 1)}</span> (נקרא בערך ב-<span className="num">{d.params.PUB_DAY}</span> בחודש שאחריו)</>} · hash <span className="mono">{any.inputs_hash.slice(0, 12)}</span></div>
      <div className="scroll"><table className="lens-tbl nc-tbl">
        <thead><tr><th>מנהל</th><th className="wide-only">היקף</th><th className="wide-only">הכנסות {ql(base)}</th><th>הכנסות, שלב 1</th><th className="wide-only">שלב 2</th><th>בפועל</th><th className="wide-only">סטייה</th>
          <th className="wide-only">רווח {ql(base)}</th><th>רווח, שלב 1</th><th className="wide-only">שלב 2</th><th className="wide-only">בפועל</th><th className="wide-only">נוסטרו</th><th className="wide-only">דוח צפוי</th></tr></thead>
        <tbody>
          {d.cover.map((c) => {
            const a = byC(s1, c), b = byC(s2, c), e = (a ?? b) as NcEst | undefined, sc = score(c);
            if (!e) return <tr key={c}><td><Mgr c={c} /></td><td colSpan={12} className="muted">אין מספיק רבעונים שפורסמו</td></tr>;
            const segs = Object.keys(e.segs);
            const prev = src.row(e.g, 'pen', base) || src.row(e.g, 'gem', base) ? { rev: segs.reduce((t, s) => t + (src.row(e.g, s as 'pen', base)?.rep?.fees ?? 0), 0), op: segs.every((s) => src.row(e.g, s as 'pen', base)?.rep?.op != null) ? segs.reduce((t, s) => t + src.row(e.g, s as 'pen', base)!.rep!.op!, 0) : null } : null;
            const act = sc?.act ?? null, last = b ?? a!;
            return (
              <tr key={c} onPointerEnter={() => warmRep(c)} onFocus={() => warmRep(c)}>
                <td><Mgr c={c} /></td>
                <td className="wide-only"><Scope e={e} /></td>
                <td className="wide-only">{prev ? <S src={() => src.actual(c, e.g, base, segs, 'fees', prev.rev)}>{m1(prev.rev)}</S> : '–'}</td>
                <td>{a ? <S className="est-num" src={() => src.rev(a)}>{m1(a.rev)}</S> : <Dash why="לא נקפא אומדן בשלב 1" />}</td>
                <td className="wide-only">{b ? <S className="est-num" src={() => src.rev(b)}>{m1(b.rev)}</S> : <Dash why="שלב 2 נקפא כשחודש 3 של הרבעון מתפרסם ברשות" />}</td>
                <td>{act ? <S src={() => src.actual(c, e.g, q, segs, 'fees', act.rev)}>{m1(act.rev)}</S> : <Dash why={`הדוח צפוי ${dmy(e.T_expected)}`} />}</td>
                <td className="wide-only">{act ? <span className={`num ${tone(err(last.rev, act.rev))}`}>{spc(err(last.rev, act.rev), 1)}</span> : '–'}</td>
                <td className="wide-only">{prev?.op != null ? <S src={() => src.actual(c, e.g, base, segs, 'op', prev.op)}>{m1(prev.op)}</S> : '–'}</td>
                <td>{a?.op != null ? <S className="est-num" src={() => src.op(a)}>{m1(a.op)}</S> : <Dash why="הדוח אינו מפרסם הוצאות שיווק והנהלה למגזר" />}</td>
                <td className="wide-only">{b?.op != null ? <S className="est-num" src={() => src.op(b)}>{m1(b.op)}</S> : '–'}</td>
                <td className="wide-only">{act?.op != null ? <S src={() => src.actual(c, e.g, q, segs, 'op', act.op)}>{m1(act.op)}</S> : '–'}</td>
                <td className="wide-only">{last.nostro ? <S className="est-num" src={() => src.nostro(last)}>{m1(last.nostro.est)}</S> : '–'}</td>
                <td className="wide-only"><span className="num muted">{dmy(e.T_expected)}</span></td>
              </tr>);
          })}
          {Object.entries(d.abstain).map(([c, t]) => <tr key={c} className="nc-abstain"><td><Mgr c={c} /></td><td colSpan={12}>{t} <span className="muted">(הימנעות לפי מדיניות)</span></td></tr>)}
          {Object.entries(d.not_covered).map(([c, t]) => <tr key={c} className="nc-abstain"><td><Mgr c={c} /></td><td colSpan={12} className="muted">לא מכוסה: {t}</td></tr>)}
        </tbody>
      </table></div>
      <div className="fnote">הכנסות: דמי ניהול, פנסיה וגמל. רווח: רווח תפעולי מגזרי (דמי ניהול פחות שיווק ומכירה והנהלה וכלליות), אותה הגדרה כמו בדוח. מבטחות: אומדן מגזרי בלבד, לא רווח הקבוצה. מיטב: לפני דמי ניהול לחברה בעלת השליטה. נוסטרו: אומדן בלבד, לא נמדד.</div>
    </Panel>
  );
}
const err = (e: number | null | undefined, a: number | null | undefined) => (e == null || a == null || a === 0 ? null : (e - a) / Math.abs(a) * 100);

/* ---------- Stage 3: every frozen estimate against its print ---------- */
function Scorecard({ d, src }: { d: NowcastData; src: NcSrc }) {
  const done = d.score.filter((x) => x.act);
  return (
    <Panel title="כרטיס ציון · אומדנים קפואים מול הדוח" aside={<span>% מהבפועל</span>}>
      {!done.length ? <Empty title="עוד אין אומדן קפוא שהוכרע">{ql(d.meta.live.q)} יוכרע עם הדוחות, מ-{dmy(d.ledger.flatMap((l) => l.rows.map((r) => r.T_expected ?? '')).filter(Boolean).sort()[0])}.</Empty> : (
        <div className="scroll"><table className="lens-tbl nc-tbl">
          <thead><tr><th>מנהל</th><th>רבעון</th><th>שלב 1</th><th>שלב 2</th><th>בפועל</th><th>סטייה 1</th><th>סטייה 2</th><th className="wide-only">תיקון 1→2</th><th className="wide-only">רווח: סטייה 2, נק׳ מההכנסות</th></tr></thead>
          <tbody>{done.map((x) => { const g = d.ledger.flatMap((l) => l.rows).find((r) => r.c === x.c && r.q === x.q)!; return (
            <tr key={x.c + x.q} onPointerEnter={() => warmRep(x.c)}><td><Mgr c={x.c} /></td><td><span className="num">{ql(x.q)}</span></td><td><span className="num est-num">{m1(x.s1?.rev)}</span></td><td><span className="num est-num">{m1(x.s2?.rev)}</span></td>
              <td><S src={() => src.actual(x.c, g.g, x.q, Object.keys(g.segs), 'fees', x.act!.rev)}>{m1(x.act!.rev)}</S></td>
              <td><span className={`num ${tone(x.s1?.e_rev)}`}>{spc(x.s1?.e_rev, 1)}</span></td><td><span className={`num ${tone(x.s2?.e_rev)}`}>{spc(x.s2?.e_rev, 1)}</span></td>
              <td className="wide-only"><span className="num">{spc(x.rev_s1s2, 2)}</span></td><td className="wide-only"><span className="num">{pp(x.s2?.e_opm ?? x.s1?.e_opm)}</span></td></tr>); })}</tbody>
        </table></div>)}
    </Panel>
  );
}

/* ---------- backtest summary: error per manager ---------- */
function Summary({ d }: { d: NowcastData }) {
  const rows = [...d.cover, 'all'].filter((c) => d.summary[c]);
  return (
    <Panel title="בדיקה לאחור · סטייה לפי מנהל" aside={<span>MAPE / הטיה · {ql(d.backtest[0]?.q ?? '')}–{ql(d.backtest[d.backtest.length - 1]?.q ?? '')}</span>}>
      <div className="scroll"><table className="lens-tbl nc-tbl">
        <thead><tr><th>מנהל</th><th>רבעונים</th><th>הכנסות, שלב 1</th><th className="wide-only">הכנסות, שלב 2</th><th className="wide-only">תיקון 1→2 (ממוצע מוחלט)</th><th>רווח, שלב 2: נק׳ מההכנסות</th><th className="wide-only">רווח, שלב 2: % מהרווח</th><th className="wide-only">שיטת העדשה: הכנסות</th><th className="wide-only">שיטת העדשה: רווח, נק׳</th></tr></thead>
        <tbody>{rows.map((c) => { const s = d.summary[c]; return (
          <tr key={c} className={c === 'all' ? 'tot' : ''}><td>{c === 'all' ? 'כל המנהלים' : <Mgr c={c} />}</td><td><span className="num">{s.s1.rev?.n ?? '–'}</span></td>
            <td><span className="num">{stat(s.s1.rev)}</span></td><td className="wide-only"><span className="num">{stat(s.s2.rev)}</span></td><td className="wide-only"><span className="num">{s.rev_s1s2 ? `${nf(s.rev_s1s2.mape, 2)}%` : '–'}</span></td>
            <td><span className="num">{statPP(s.s2.opm)}</span></td><td className="wide-only"><span className="num">{stat(s.s2.op)}</span></td>
            <td className="wide-only"><span className="num">{stat(s.s1.lens_rev)}</span></td><td className="wide-only"><span className="num">{statPP(s.s1.lens_opm)}</span></td></tr>); })}</tbody>
      </table></div>
      <div className="fnote">MAPE: ממוצע הסטייה המוחלטת, % מהבפועל; הטיה: ממוצע הסטייה עם סימן (חיובי = האומדן גבוה). רווח בנקודות: (אומדן − בפועל) ÷ הכנסות בפועל × 100, כי במרווח דק סטייה באחוזי רווח מתנפחת. שיטת העדשה: תשואת הרבעון האחרון והוצאותיו, על אותם ימים (שלב 1). כל אומדן נבנה מהנתונים שפורסמו עד יום השלב בלבד.</div>
    </Panel>
  );
}

/* ---------- backtest detail of one manager ---------- */
function Detail({ d, src, mgr, setMgr }: { d: NowcastData; src: NcSrc; mgr: string; setMgr: (v: string) => void }) {
  const rows = d.backtest.filter((b) => b.c === mgr);
  const g = src.lens.groups.findIndex((x) => x.lts === mgr);
  const segs = (b: NcBt) => Object.keys(b.s1.segs);
  return (
    <Panel title={`בדיקה לאחור · ${NAME[mgr]} · כל רבעון`} aside={<span>מיליוני ש"ח</span>}>
      <section className="controls lens-ctl"><div className="field"><span>מנהל</span><SegCtl<string> label="מנהל" value={mgr} onChange={setMgr} options={d.cover.map((c) => [c, NAME[c]])} /></div></section>
      <div className="scroll" onPointerEnter={() => warmRep(mgr)} onFocus={() => warmRep(mgr)}><table className="lens-tbl nc-tbl">
        <thead><tr><th>רבעון</th><th className="wide-only">דוח</th><th>שלב 1</th><th className="wide-only">שלב 2</th><th>בפועל</th><th>סטייה 1</th><th className="wide-only">סטייה 2</th><th className="wide-only">תיקון 1→2</th><th className="wide-only">רווח, שלב 2</th><th className="wide-only">רווח בפועל</th><th>רווח: נק׳</th></tr></thead>
        <tbody>{rows.map((b) => (
          <tr key={b.q}>
            <td><span className="num">{ql(b.q)}</span></td><td className="wide-only"><span className="num muted">{dmy(b.T)}</span></td>
            <td><S className="est-num" src={() => src.bt(b, 's1')}>{m1(b.s1.rev)}</S>{!b.s1.lag_ok && <span className="nc-lag" title="ביום השלב הנומינלי החודש האחרון עוד לא פורסם ברשות">*</span>}</td>
            <td className="wide-only">{b.s2 ? <><S className="est-num" src={() => src.bt(b, 's2')}>{m1(b.s2.rev)}</S>{!b.s2.lag_ok && <span className="nc-lag" title="ביום השלב הנומינלי החודש האחרון עוד לא פורסם ברשות">*</span>}</> : '–'}</td>
            <td><S src={() => src.actual(b.c, g, b.q, segs(b), 'fees', b.act.rev)}>{m1(b.act.rev)}</S></td>
            <td><span className={`num ${tone(b.s1.e_rev)}`}>{spc(b.s1.e_rev, 1)}</span></td>
            <td className="wide-only"><span className={`num ${tone(b.s2?.e_rev)}`}>{spc(b.s2?.e_rev, 1)}</span></td>
            <td className="wide-only"><span className="num">{spc(b.rev_s1s2, 2)}</span></td>
            <td className="wide-only"><span className="num est-num">{m1(b.s2?.op)}</span></td>
            <td className="wide-only">{b.act.op == null ? '–' : <S src={() => src.actual(b.c, g, b.q, segs(b), 'op', b.act.op)}>{m1(b.act.op)}</S>}</td>
            <td><span className={`num ${tone(b.s2?.e_opm)}`}>{pp(b.s2?.e_opm)}</span></td>
          </tr>))}</tbody>
      </table></div>
      <div className="fnote">* ביום השלב הנומינלי חודש הרשות האחרון עוד לא פורסם (הנחת פרסום: היום ה-{d.params.PUB_DAY} בחודש M+2): בפועל השלב היה מתאחר. רווח בנקודות: מההכנסות בפועל.</div>
    </Panel>
  );
}
