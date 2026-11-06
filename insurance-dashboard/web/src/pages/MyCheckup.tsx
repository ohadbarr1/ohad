import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { useFunds } from '../lib/useData';
import { useOptional } from '../lib/fundsLoad';
import { useGlide } from '../lib/fundsTimeLoad';
import { useMine, useMy, useMyAge, useMySalary, useMySex, useRetire, type MyProduct } from '../lib/mine';
import { useSaverDoor } from '../lib/door';
import { refOf, type FundX, type FundsFile } from '../lib/funds';
import { fundP } from '../lib/market';
import type { DefaultFile } from '../lib/fundsTools';
import type { Prov } from '../lib/prov';
import { AGE_DEFAULT, KZ_RETIRE, RET_FALLBACK, ageText, ilsRound } from '../lib/retire';
import { COEF_PATH, birthYearOf, coefFor, type CoefFile } from '../lib/coef';
import { cardCalc } from '../lib/myCalc';
import { pcf } from '../lib/verdict';
import { DECISION_PATH, type DecisionFile } from '../lib/decision';
import { feeError, KZ_CAPS } from '../lib/feeCaps';
import { PENSION_RATES, SRC as DEP_SRC, kindOf, letterOf, rateTotal, ymHe } from '../lib/deposits';
import { dsName } from '../lib/script';
import { defaultFor, digitOf } from '../lib/momentsCalc';
import { winnerTrack } from '../lib/pensionPack';
import { S as MS } from '../lib/momentsContent';
import { track } from '../lib/track';
import { headTitle } from '../lib/seo';
import {
  CAPS_REG, CK_STATUS_KEY, MIN_GAP, ST_FAR, ageAsk, checkupOf, dueNegos, dueOf, feeLetter, feeShort, icsOf, isoDay, mailHref, mergeLetter, nextCheckOf, normNegos, normStatus,
  redCount, savingOf, startNego, waHref, yearSaving, type AgeRowOut, type CRow, type DepRowOut, type FeeRow, type Nego, type Tone,
} from '../lib/checkup';
import { SaverSafe } from '../components/saver/SaverSafe';
import { HomeHint } from '../components/saver/HomeHint';
import { figsOf, tenderProv, ymOf } from '../components/saver/figs';
import { MaslakaImport } from '../components/saver/MaslakaImport';
import { Script } from '../components/saver/Script';
import { SrcA } from '../components/saver/Moments';
import { ShareCard, saveBlob } from '../components/saver/ShareCard';
import '../styles/saver.css';
import '../styles/moments.css';
import '../styles/checkup.css';

/* S1 + S2 saver (fox 3.0 plan, 05.11.26) · /my/checkup, "הבדיקה השנתית": the saver's hero job. Import the clearing-house file (or use the
   products already on /my), then three red / amber / green lines, each with its anchor, its source and an action:
     1. fees against the default-fund price (comprehensive pension, the reader's own fees) or the median of the averages actually paid
        (everything else), in ₪ by retirement (lib/checkup states the hierarchy); the action is the letter to the agent or the company
        (copy, WhatsApp, e-mail) and a 30-day reminder (a calendar file and a note in this browser) that asks for the new fee;
     2. deposits against the statutory 18.5% (the deposit watchdog, lib/deposits) over the months the file carries; the letter to the
        employer;
     3. the track against the age (the age tracks of funds/glide.json); a question to the fund.
   When the new fee is entered: "חסכתם כ-X עד הפרישה" and a share card with no personal data. All in this browser; nothing is sent.
   The page keeps /my under its 400-word budget (tests/webkit.spec.ts): /my only links here. Descriptive, never advice. */

const NEGO_KEY = 'my:nego';
const DIGIT_KEY = 'my:iddigit';
const SITE = 'https://fox-research-il.web.app/my/checkup';
const today = () => isoDay(new Date());
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
const ST: Record<Tone, { word: string; mark: string }> = { red: { word: 'לטיפול', mark: '!' }, amber: { word: 'לבדיקה', mark: '?' }, green: { word: 'תקין', mark: '✓' } };
const num = (s: string): number | null => { const t = s.replace(/[,\s%]/g, ''); if (t === '') return null; const v = Number(t); return Number.isFinite(v) ? v : null; };
const when = (r: FeeRow, retire: number) => (r.horizon === 'liq' ? `בעוד ${r.years} שנים` : `עד גיל ${ageText(retire)}`);

export function MyCheckup() {
  useSaverDoor();
  useEffect(() => { document.title = headTitle('/my/checkup') ?? 'הבדיקה השנתית · fox'; }, []);
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);
  const coefF = useOptional<CoefFile>(COEF_PATH);
  const glide = useGlide();
  const [mine, setMine] = useMine();
  const [ageS] = useMyAge(), [sex] = useMySex(), [salary] = useMySalary();
  const R = useRetire();
  const [negosRaw, setNegos] = useMy<Nego[]>(NEGO_KEY, []);
  const negos = normNegos(negosRaw);
  const [msg, setMsg] = useState<string | null>(null);
  const list = (Array.isArray(mine) ? mine : []).filter((m) => m && typeof m.k === 'string');
  const age = ageS ?? AGE_DEFAULT;
  const byK = useMemo(() => new Map(((data?.funds ?? []) as FundX[]).map((f) => [f.k, f])), [data]);

  const rows: CRow[] = useMemo(() => (!data || dfile === undefined ? [] : list.flatMap((m) => {
    const f = byK.get(m.k); if (!f) return [];
    const pick = coefFor(coefF, f.grp, sex, R.v, birthYearOf(age));
    return [{ f, m, c: cardCalc(f, data.funds as FundX[], data.asof, dfile, m, dec, { age, coef: pick.v, ret: RET_FALLBACK, retire: R.v }) }];
  })), [data, dfile, dec, coefF, list, byK, age, sex, R.v]);  // eslint-disable-line react-hooks/exhaustive-deps
  const ck = useMemo(() => checkupOf(rows, { age, profileSalary: salary, glide: glide.data, nowYm: today().slice(0, 7) }), [rows, age, salary, glide.data]);

  // F2: one checkup counted per visit, once the three lines stand on at least one product
  const counted = useRef(false);
  useEffect(() => { if (!counted.current && rows.length && (ck.fee || ck.dep || ck.age)) { counted.current = true; track('checkup_done'); } }, [rows.length, ck]);
  // red team 06.11.26 (bring-back): the status the saver home and /my show after a check-up: the red items, the saving, the next date
  const [stRaw, setSt] = useMy<unknown>(CK_STATUS_KEY, null);
  const savedTotal = useMemo(() => negos.filter((n) => n.after).reduce((s, n) => { const r = rows.find((x) => x.f.k === n.k); const v = r ? savingOf(r.c.plan, n.before, n.after!) : 0; return s + (v >= 500 ? v : 0); }, 0), [negos, rows]);
  useEffect(() => {
    if (!rows.length || !(ck.fee || ck.dep || ck.age)) return;
    const next = { v: 1 as const, at: today(), red: redCount(ck), saved: Math.round(savedTotal) };
    const cur = normStatus(stRaw);
    if (!cur || cur.at !== next.at || cur.red !== next.red || cur.saved !== next.saved) setSt(next);
  }, [rows.length, ck, savedTotal]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data || dfile === undefined) return <Loading what="הבדיקה השנתית" />;
  const asof = ymOf(data.asof);
  const patch = (k: string, p: Partial<MyProduct>) => setMine(list.map((m) => (m.k === k ? { ...m, ...p } : m)));
  const begin = (k: string, mineFees: { fee: number; depfee: number }) => { if (!negos.some((n) => n.k === k && !n.after)) setNegos(startNego(negos, k, mineFees, today())); };
  const due = dueNegos(negos, today()).filter((n) => rows.some((r) => r.f.k === n.k));
  const done = negos.filter((n) => n.after && rows.some((r) => r.f.k === n.k));
  const ctx = { data, dec, retire: R.v, asof, negos, setNegos, patch, begin };

  return (
    <div className="sv-page ck-page">
      <div className="pagehead"><div>
        <span className="eyebrow"><Link to="/my">החיסכון שלי</Link> · הבדיקה השנתית</span>
        <h1><span className="icotile"><Icon name="check" /></span>הבדיקה השנתית</h1>
        <div className="sub sv-sub">שלוש שורות: דמי הניהול, ההפקדות ומסלול הגיל. לכל שורה העוגן והמקור שלה, וכל שורה נגמרת בפעולה. נתוני רשות שוק ההון עד {asof}.</div>
      </div></div>

      {msg && <p className="sv-done" role="status">{msg}</p>}
      {due.map((n) => { const r = rows.find((x) => x.f.k === n.k)!; return (
        <section key={n.k} className="panel ck-due" aria-labelledby={`ck-due-${n.k}`}>
          <h2 id={`ck-due-${n.k}`}><span className="icotile"><Icon name="calendar" /></span>עברו 30 יום: מה דמי הניהול עכשיו?</h2>
          <p>ב-{dmy(n.at)} ביקשתם להפחית את דמי הניהול ב<b>{r.f.name}</b> (היו {pcf(n.before.depfee)} מהפקדה ו-{pcf(n.before.fee)} מהצבירה). בודקים באזור האישי באתר החברה או בדוח, ומזינים כאן.</p>
          <NewFees r={r} n={n} {...ctx} />
        </section>); })}

      <Who />

      {rows.length === 0 ? <>
        <section className="panel ck-empty" aria-labelledby="ck-empty-h">
          <h2 id="ck-empty-h">מתחילים מהקובץ של המסלקה</h2>
          <p>הבדיקה רצה על המוצרים <b>שלכם</b>: היתרה, ההפקדות ודמי הניהול. הדרך המהירה: קובץ מהמסלקה הפנסיונית, עם כל המוצרים וההפקדות. או להוסיף מוצר ידנית ב<Link className="sv-u" to="/my#sv-add-h">המוצרים שלי</Link> ולהקליד את המספרים מהדוח השנתי.</p>
        </section>
        <MaslakaImport funds={data.funds as FundX[]} mine={list} today={today()} onSave={(next, m) => { setMine(next); setMsg(m); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }} />
      </> : <>
        {done.length > 0 && <Saved done={done} rows={rows} retire={R.v} />}
        <ol className="ck-lines" aria-label="שלוש השורות של הבדיקה">
          <FeeCard line={ck.fee} rows={rows} {...ctx} />
          <DepCard line={ck.dep} />
          <AgeCard line={ck.age} ageSet={ageS != null} />
        </ol>
        {!ck.fee?.rows.some((r) => r.tone !== 'green' && r.own && !r.dormant) && <YearNext />}
        <Anchors />
        <Link to="/my/statement" className="panel sv-stmt">
          <span className="icotile"><Icon name="statement" /></span>
          <span className="sv-stmt-t"><b>איך קוראים את הדוח השנתי?</b><span>שדה אחר שדה, ואיפה כל מספר מהבדיקה מופיע בדוח.</span></span>
          <span className="sv-stmt-go" aria-hidden="true">←</span>
        </Link>
        <MaslakaImport funds={data.funds as FundX[]} mine={list} today={today()} onSave={(next, m) => { setMine(next); setMsg(m); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }} />
      </>}

      <p className="sv-privacy"><Icon name="shield" /> הכול מחושב ונשמר רק בדפדפן הזה, בלי הרשמה; שום נתון לא נשלח. המכתבים נשלחים רק אם אתם שולחים אותם.</p>
      {rows.length > 0 && <HomeHint />}
      <SaverSafe />
      <p className="sv-legal">מידע תיאורי מנתוני רשות שוק ההון, עם מקור לכל מספר. לא ייעוץ השקעות, לא ייעוץ או שיווק פנסיוני, ואין המלצה לעבור או להישאר. האומדנים על הנחות שמוצגות לצדם. <Link to="/about">על האתר והמקורות</Link></p>
    </div>
  );
}

interface Ctx {
  data: FundsFile; dec: DecisionFile | null | undefined; retire: number; asof: string;
  negos: Nego[]; setNegos: (n: Nego[]) => void; patch: (k: string, p: Partial<MyProduct>) => void; begin: (k: string, f: { fee: number; depfee: number }) => void;
}

/** the age and sex, asked once (the same keys as /my): the retirement age follows the law (women 62 to 65 by birth year, men 67) */
function Who() {
  const [age, setAge] = useMyAge();
  const [sex, setSex] = useMySex();
  const R = useRetire();
  const [raw, setRaw] = useState(age == null ? '' : String(age));
  const [was, setWas] = useState(age);
  if (was !== age) { setWas(age); setRaw(age == null ? '' : String(age)); }
  const bad = raw !== '' && !(Number(raw) >= 16 && Number(raw) <= 66);
  return (
    <div className="sv-who ck-who" role="group" aria-label="גיל ומין, לגיל הפרישה ולמסלול הגיל">
      <label className="sv-who-age"><span>גיל</span>
        <input type="number" inputMode="numeric" min={16} max={66} step={1} placeholder={String(AGE_DEFAULT)} value={raw} aria-invalid={bad}
          onChange={(e) => { const t = e.target.value; setRaw(t); const x = Number(t); if (t !== '' && Number.isInteger(x) && x >= 16 && x <= 66) setAge(x); }} />
      </label>
      {age == null ? <span className="sv-a sv-who-ex">{AGE_DEFAULT} לדוגמה, שנו</span> : bad ? <span className="sv-err">גיל בין 16 ל-66</span> : null}
      <span className="sv-rets" role="group" aria-label="מין, לגיל הפרישה בחוק">
        {([['f', 'אישה'], ['m', 'גבר']] as const).map(([k, l]) => <button key={k} type="button" className="sv-chip sm" aria-pressed={sex === k} onClick={() => setSex(sex === k ? null : k)}>{l}</button>)}
      </span>
      <span className="ck-ret">גיל פרישה: <b>{ageText(R.v)}</b> <span className="sv-a">{R.own ? 'שהזנתם ב"המוצרים שלי"' : sex == null ? <>67 עד שבוחרים; לאישה 62 עד 65 לפי שנת הלידה (<a className="sv-u" href={KZ_RETIRE} target="_blank" rel="noreferrer">החוק</a>)</> : <a className="sv-u" href={KZ_RETIRE} target="_blank" rel="noreferrer">{R.why}</a>}</span></span>
    </div>
  );
}

/** one line of the three: the status (word and mark, never color alone), the summary, the anchor and its source, the action */
function Line({ n, id, icon, title, tone, children }: { n: number; id: string; icon: string; title: string; tone: Tone | null; children: ReactNode }) {
  const t = tone ?? 'amber';
  return (
    <li className={`panel ck-line ck-${tone ?? 'none'}`} aria-labelledby={`${id}-h`}>
      <div className="ck-head">
        <span className="icotile lg ck-ico"><Icon name={icon} /></span>
        <h2 id={`${id}-h`}><span className="ck-n">{n}.</span> {title}</h2>
        {tone ? <span className={`ck-st ck-st-${t}`}><span aria-hidden="true">{ST[t].mark}</span> {ST[t].word}</span> : <span className="ck-st ck-st-none">לא רלוונטי</span>}
      </div>
      {children}
    </li>
  );
}
const Dot = ({ tone }: { tone: Tone }) => <span className={`ck-dot ck-dot-${tone}`} aria-label={ST[tone].word} role="img" />;

/* ======================= 1. fees ======================= */
function anchorText(r: FeeRow) {
  if (r.anchor === 'tender') return 'מחיר קרנות ברירת המחדל';
  return 'חציון הממוצע בפועל בקטגוריה';
}
function gapProv(r: FeeRow, c: CRow['c'], retire: number): () => Prov {
  return () => ({ k: 'calc', est: true, title: `הפער בחיסכון ${when(r, retire)} · ${r.name}`, value: ilsRound(r.gap ?? 0),
    formula: `אותה תוכנית פעמיים: פעם בדמי הניהול ${r.own ? 'שלכם' : 'הממוצעים במסלול'}, ופעם ב${r.anchor === 'tender' ? 'מחיר ההליך של קרנות ברירת המחדל, אותו מחיר שהמכתב מבקש' : 'חציון הממוצע בפועל בקטגוריה'}; ההפרש בחיסכון, בשקלי היום. הפקדה שעולה 2% בשנה, תשואה ${pcf(c.plan.ret)} ברוטו, אינפלציה 2%`,
    note: `אומדן על הנחות, לא תחזית. פער מתחת ל-${MIN_GAP.toLocaleString('en-US')} ש"ח לא נחשב "לטיפול".${r.ex ? ' חלק מהסכומים לדוגמה: הזינו יתרה והפקדה. לא נספר בסך הכול.' : ''}`,
    inputs: [{ label: r.own ? 'דמי הניהול שלכם (מהפקדה / מצבירה)' : 'הממוצע במסלול (מהפקדה / מצבירה)', v: `${pcf(r.mine.depfee)} / ${pcf(r.mine.fee)}` },
      ...(r.ref ? [{ label: `${anchorText(r)} (מהפקדה / מצבירה)`, v: `${pcf(r.ref.depfee)} / ${pcf(r.ref.fee)}` }] : []),
      { label: c.exBalance ? 'יתרה (לדוגמה)' : 'יתרה (שלכם)', v: ilsRound(c.plan.balance) }, { label: c.exMonthly ? 'הפקדה חודשית (לדוגמה)' : c.noDep ? 'הפקדה חודשית (אין הפקדה שוטפת בקובץ)' : 'הפקדה חודשית (שלכם)', v: ilsRound(c.plan.monthly) },
      { label: 'גיל היום', v: String(c.plan.age) }, { label: 'גיל הפרישה', v: ageText(retire) }] });
}

function FeeCard({ line, rows, ...x }: Ctx & { line: ReturnType<typeof checkupOf>['fee']; rows: CRow[] }) {
  // a dormant account gets the consolidation request, never a fee letter (red team 06.11.26)
  const actRows = line ? line.rows.filter((r) => r.tone !== 'green' && r.own && !r.dormant) : [];
  const dormRows = line ? line.rows.filter((r) => r.dormant) : [];
  const [pickK, setPickK] = useState<string | null>(null);
  if (!line) return <Line n={1} id="ck-fee" icon="savings" title="דמי ניהול" tone={null}><p className="ck-sum">אין מוצרים לבדוק.</p></Line>;
  const top = line.top!;
  const act = actRows.find((r) => r.k === pickK) ?? actRows.find((r) => r.k === top.k) ?? actRows[0] ?? null;
  const rowOf = (k: string) => rows.find((r) => r.f.k === k)!;
  const T = rowOf(top.k);
  const figs = figsOf(T.f as FundX, T.c.v, x.data.asof, x.data, x.dec);
  const sumAmt = <Sourced src={gapProv(top, T.c, x.retire)}><b className="ck-ils">{ilsRound(top.gap ?? 0)}</b></Sourced>;
  return (
    <Line n={1} id="ck-fee" icon="savings" title="דמי ניהול" tone={line.tone}>
      <p className="ck-sum">
        {line.tone === 'red' ? <><b>{top.name}:</b> דמי הניהול שלכם עולים כ-{sumAmt} {when(top, x.retire)} לעומת {anchorText(top)}{top.ex ? ' (על סכומים לדוגמה)' : ''}.{line.rows.filter((r) => r.tone === 'red' && !r.ex).length > 1 ? <> בכל המוצרים יחד: כ-{ilsRound(line.total)}.</> : null}{line.exN > 0 && !top.ex ? <> {line.exN === 1 ? 'מוצר אחד על סכומים לדוגמה לא נספר.' : `${line.exN} מוצרים על סכומים לדוגמה לא נספרו.`}</> : null}</>
          : line.tone === 'amber' && !top.own ? <>החישוב לפי <b>הממוצע במסלול</b>, לא לפי דמי הניהול שלכם{top.gap != null && top.gap >= MIN_GAP ? <> (לפיו, כ-{sumAmt} {when(top, x.retire)} לעומת {anchorText(top)})</> : null}. את דמי הניהול שלכם מייבאים מהמסלקה או מקלידים מהדוח השנתי.</>
          : line.tone === 'amber' ? <><b>{top.name}:</b> חלק מדמי הניהול מעל {anchorText(top)}, אבל על הסכומים שלכם הפער {top.gap != null && top.gap > 0 ? <>כ-{sumAmt}</> : 'זניח'} {when(top, x.retire)}.</>
          : <>דמי הניהול שלכם לא עולים יותר מ{anchorText(top)} באף מוצר{line.rows.length > 1 ? ` (${line.rows.length} מוצרים)` : ''}.</>}
      </p>
      <ul className="ck-rows">{line.rows.map((r) => <FeeRowLi key={r.k} r={r} C={rowOf(r.k)} retire={x.retire} data={x.data} dec={x.dec} />)}</ul>
      <p className="ck-src"><b>העוגן:</b> {top.anchor === 'tender'
        ? <>בקרן פנסיה מקיפה, מול המחיר שכל אחד יכול לקבל בקרנות ברירת המחדל (<Sourced src={figs.tender}><span>{top.tender?.label ?? 'ההליך'}</span></Sourced>). הממוצע במסלול מוצג להקשר בלבד: ממוצע, לא מחיר.</>
        : <>חציון הממוצע שמשלמים בפועל העמיתים בקטגוריה (<Sourced src={figs.feeMed}><span className="num">{pcf(top.med)}</span></Sourced> מצבירה, {dsName((T.f as FundX).fam)} {x.asof}){top.q1 != null && top.med != null && top.q1 < top.med - 0.005 ? <>; ברבע הזול עד <Sourced src={figs.feeQ1}><span className="num">{pcf(top.q1)}</span></Sourced></> : null}.</>}
        {top.cap && <> התקרה בחוק: {pcf(top.cap.depfee)} מהפקדה ו-{pcf(top.cap.fee)} מצבירה (<a className="sv-u" href={KZ_CAPS} target="_blank" rel="noreferrer" title={CAPS_REG}>כל זכות</a>).</>}</p>
      {top.anchor === 'tender' && <MyDefault data={x.data} />}
      {act ? <Nego key={act.k} r={act} C={rowOf(act.k)} choose={actRows.length > 1 ? actRows : null} onPick={setPickK} {...x} />
        : line.tone === 'amber' && !top.own ? <div className="ck-act"><a className="btn primary" href="#mk-h">ייבוא מהמסלקה</a> <Link className="btn" to={`/my#${top.k}`}>להקליד את דמי הניהול</Link></div>
        : dormRows.length ? null
        : <div className="ck-act"><p className="sv-note">אין מה לבקש כרגע. כדאי לבדוק שוב כשמגיע הדוח השנתי הבא (עד 31.3).</p></div>}
      {dormRows.length > 0 && <Merge rows={dormRows} all={line.rows} C={rows} />}
    </Line>
  );
}

function FeeRowLi({ r, C, retire, data, dec }: { r: FeeRow; C: CRow; retire: number; data: FundsFile; dec: DecisionFile | null | undefined }) {
  const f = C.f as FundX;
  const figs = figsOf(f, C.c.v, data.asof, data, dec);
  const avgP = (w: 'fee' | 'depfee') => () => fundP(refOf(f), data.asof, w === 'fee' ? 'AVG_ANNUAL_MANAGEMENT_FEE' : 'AVG_DEPOSIT_FEE', w === 'fee' ? 'דמי ניהול מצבירה, ממוצע בפועל' : 'דמי ניהול מהפקדה, ממוצע בפועל', pcf(f[w]));
  return (
    <li>
      <Dot tone={r.tone} />
      <span className="ck-r">
        <Link className="sv-u" to={`/my#${r.k}`}>{r.name}</Link>{' '}
        <span className="ck-kv">{r.own ? 'שלכם' : 'ממוצע במסלול'}: <span className="num">{pcf(r.mine.depfee)}</span> מהפקדה, <span className="num">{pcf(r.mine.fee)}</span> מצבירה</span>
        {r.anchor === 'tender' && r.ask && r.tender ? <span className="ck-kv">ברירת המחדל: <Sourced src={() => tenderProv(r.tender!, 'דמי ניהול מהפקדה, מחיר ההליך', pcf(r.ask!.depfee))}><span className="num">{pcf(r.ask.depfee)}</span></Sourced> מהפקדה, <Sourced src={() => tenderProv(r.tender!, 'דמי ניהול מצבירה, מחיר ההליך', pcf(r.ask!.fee))}><span className="num">{pcf(r.ask.fee)}</span></Sourced> מצבירה</span>
          : r.med != null ? <span className="ck-kv">חציון בקטגוריה: <Sourced src={figs.feeMed}><span className="num">{pcf(r.med)}</span></Sourced> מצבירה{r.ref && r.ref.depfee > 0 ? <>, <Sourced src={figs.depMed}><span className="num">{pcf(r.ref.depfee)}</span></Sourced> מהפקדה</> : null}</span> : null}
        {r.own && r.avg.fee != null && <span className="ck-kv ck-ctx">להקשר, הממוצע במסלול: <Sourced src={avgP('fee')}><span className="num">{pcf(r.avg.fee)}</span></Sourced> מצבירה{r.avg.depfee != null ? <>, <Sourced src={avgP('depfee')}><span className="num">{pcf(r.avg.depfee)}</span></Sourced> מהפקדה</> : null}</span>}
        {/^ביטוח/.test(r.prod) && <span className="ck-kv ck-ctx">בביטוח מנהלים ייתכן מקדם קצבה מובטח: הבקשה היא להפחתה באותה פוליסה.</span>}
        <span className="ck-kv"><b>{r.gap == null ? (r.anchor === 'tender' && r.own ? 'במחיר קרנות ברירת המחדל' : '–') : r.gap >= MIN_GAP ? <>כ-<Sourced src={gapProv(r, C.c, retire)}><span>{ilsRound(r.gap)}</span></Sourced> פחות {when(r, retire)}</> : r.gap > 0 ? `פער קטן מ-${MIN_GAP.toLocaleString('en-US')} ש"ח` : 'לא יקר מהעוגן'}</b>{r.ex ? <> · <span className="chip est">לדוגמה</span> לא נספר בסך הכול</> : ''}{r.dormant ? ` · אין הפקדות${r.last ? ` מאז ${ymHe(r.last)}` : ''}: על היתרה בלבד` : ''}{r.gap != null ? ' · אומדן' : ''}</span>
      </span>
    </li>
  );
}

/** the reader's default fund by the ID's check digit (the 2024 tender's allocation): the price is the same in every winner */
function MyDefault({ data }: { data: FundsFile }) {
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const [saved] = useMy<number | null>(DIGIT_KEY, null);
  const [raw, setRaw] = useState(saved != null ? String(saved) : '');
  const digit = digitOf(raw);
  const pick = defaultFor(dfile, data.asof, digit, true);
  if (!pick?.rule) return null;
  const w = pick.winners[0], tr = w ? winnerTrack(w, data.funds as FundX[]) : null;
  return (
    <div className="ck-digit">
      <label><span>הספרה האחרונה בתעודת הזהות</span>
        <input type="text" inputMode="numeric" maxLength={1} pattern="[0-9]" placeholder="0–9" value={raw} autoComplete="off" onChange={(e) => setRaw(e.target.value.replace(/\D/g, '').slice(-1))} />
      </label>
      <span>{w ? <>קרן ברירת המחדל שלכם (מעסיק של 50 עובדים ומעלה): <b>{w.grp}</b>{tr ? <> · <Link className="sv-u" to={`/funds/${tr.k}`}>הקרן</Link></> : null}. המחיר זהה בכל הזוכות.</> : 'לא חובה: רק הספרה, לא נשמרת.'} <Link className="sv-u" to="/my/moment/default">איך השיבוץ עובד</Link></span>
    </div>
  );
}

/** S2: the request: the letter (copy), WhatsApp, e-mail, the 30-day reminder, and the new fees when they come */
function Nego({ r, C, choose, onPick, ...x }: Ctx & { r: FeeRow; C: CRow; choose: FeeRow[] | null; onPick: (k: string) => void }) {
  const f = C.f as FundX;
  const letter = feeLetter(r, { id: f.id, src: `${dsName(f.fam)}, ${x.asof}`, retire: ageText(x.retire) });
  const open = x.negos.find((n) => n.k === r.k && !n.after);
  const [rem, setRem] = useState<string | null>(null);
  const start = () => x.begin(r.k, r.mine);
  const remind = () => {
    const at = open?.at ?? today();
    if (!open) start();
    const due = dueOf({ k: r.k, at, before: r.mine });
    saveBlob('fox-tizkoret.ics', new Blob([icsOf(due, SITE)], { type: 'text/calendar;charset=utf-8' }));
    setRem(due);
  };
  const [showNew, setShowNew] = useState(false);
  return (
    <div className="ck-act ck-nego">
      <h3>{r.tone === 'red' ? 'לבקש הפחתה' : 'לבקש הצעה מעודכנת'}: מכתב לסוכן או לחברה המנהלת</h3>
      {choose && <div className="sv-chips" role="group" aria-label="על איזה מוצר המכתב">{choose.map((c) => <button key={c.k} type="button" className="sv-chip sm" aria-pressed={c.k === r.k} onClick={() => onPick(c.k)}>{c.name}</button>)}</div>}
      <Script text={letter} label={`מכתב בעניין דמי הניהול ב${r.name}`} note="עובדות, עוגנים עם מקור ובקשה. כדאי לבדוק מול הדוח לפני השליחה." onCopied={start} />
      <div className="ck-send">
        <a className="btn" href={waHref(feeShort(r))} target="_blank" rel="noreferrer" onClick={() => { track('letter_copied'); start(); }}>WhatsApp</a>
        <a className="btn" href={mailHref(`דמי ניהול ב${r.name}`, letter)} onClick={() => { track('letter_copied'); start(); }}>דוא"ל</a>
        <button type="button" className="btn" onClick={remind}><Icon name="calendar" /> תזכורת בעוד 30 יום</button>
        <YearIcs />
      </div>
      <p className="sv-note" role="status">{rem ? <>נשמר קובץ ליומן לתאריך {dmy(rem)}. גם כאן, בדפדפן הזה, נשאל אחרי התאריך מה דמי הניהול עכשיו.</> : open ? <>הבקשה נרשמה ב-{dmy(open.at)}; ב-{dmy(dueOf(open))} נשאל כאן מה דמי הניהול עכשיו.</> : 'WhatsApp ודוא"ל פותחים טיוטה; אתם בוחרים למי לשלוח. שום דבר לא נשלח מכאן.'}</p>
      {!showNew ? <button type="button" className="linkbtn sv-u" onClick={() => setShowNew(true)}>כבר קיבלתם תשובה? הזינו את דמי הניהול החדשים</button>
        : <NewFees r={C} n={open ?? { k: r.k, at: today(), before: r.mine }} {...x} />}
    </div>
  );
}

/** red team 06.11.26 (bring-back): the annual reminder as a calendar file, 11 months from today (before the statement's anniversary) */
function YearIcs() {
  const [got, setGot] = useState<string | null>(null);
  const save = () => { const due = nextCheckOf(today()); saveBlob('fox-bdika-shnatit.ics', new Blob([icsOf(due, SITE, new Date(), 'year')], { type: 'text/calendar;charset=utf-8' })); setGot(due); };
  return <button type="button" className="btn" onClick={save} title={got ? `נשמר ליומן: ${dmy(got)}` : undefined}><Icon name="calendar" /> {got ? `תזכורת שנתית ל-${dmy(got)} ✓` : 'תזכורת שנתית'}</button>;
}
/** the next check-up and its reminder, when the fee line has no letter to send (the letter block carries the same button) */
function YearNext() {
  const n = nextCheckOf(today());
  return (
    <div className="panel ck-year">
      <p><b>הבדיקה הבאה: {n.slice(5, 7)}/{n.slice(2, 4)}.</b> קובץ חדש מהמסלקה, אותן שלוש שורות.</p>
      <div className="ck-send"><YearIcs /></div>
    </div>
  );
}

/** red team 06.11.26: a dormant account (no deposits for INACTIVE months) gets a consolidation request to the active fund, not a fee
 *  letter. Under the transfer regulations the request goes to the receiving fund, which handles the old one. Questions first: what the
 *  old account would lose. A request, never advice. */
function Merge({ rows, all, C }: { rows: FeeRow[]; all: FeeRow[]; C: CRow[] }) {
  const [pickK, setPickK] = useState(rows[0].k);
  const r = rows.find((x) => x.k === pickK) ?? rows[0];
  const f = C.find((x) => x.f.k === r.k)!.f;
  const fam = (p: string) => kindOf(p) ?? p;
  const into = all.filter((x) => !x.dormant && fam(x.prod) === fam(r.prod)).map((x) => C.find((c) => c.f.k === x.k)!).sort((a, b) => (b.m.balance ?? 0) - (a.m.balance ?? 0))[0] ?? null;
  const letter = mergeLetter({ name: r.name, id: f.id, last: r.last }, into ? { name: into.f.name, id: into.f.id } : null);
  return (
    <div className="ck-act ck-merge">
      <h3>איחוד חשבונות{rows.length > 1 ? '' : `: ${r.name}`}</h3>
      <p className="sv-note">אין הפקדות לחשבון הזה{r.last ? ` מאז ${ymHe(r.last)}` : ''}. במקום מכתב על דמי ניהול: בקשה לאחד אותו עם {into ? <b>{into.f.name}</b> : 'החשבון הפעיל'}, כך שהחיסכון מנוהל בחשבון אחד. את הבקשה שולחים לקרן הפעילה, והיא מטפלת מול הקרן הישנה (<SrcA s={MS.move} />). כדאי לשאול קודם מה יאבד באיחוד.</p>
      {rows.length > 1 && <div className="sv-chips" role="group" aria-label="איזה חשבון לאחד">{rows.map((c) => <button key={c.k} type="button" className="sv-chip sm" aria-pressed={c.k === r.k} onClick={() => setPickK(c.k)}>{c.name}</button>)}</div>}
      <Script text={letter} label={`בקשה לאיחוד החשבון ב${r.name}`} note="בקשה ושאלות, לא המלצה. כדאי לבדוק מול הדוח לפני השליחה." />
      <div className="ck-send">
        <a className="btn" href={waHref(letter)} target="_blank" rel="noreferrer" onClick={() => track('letter_copied')}>WhatsApp</a>
        <a className="btn" href={mailHref(`איחוד חשבונות: ${r.name}`, letter)} onClick={() => track('letter_copied')}>דוא"ל</a>
      </div>
    </div>
  );
}

/** the new fees, the saving by retirement and the share card */
function NewFees({ r, n, ...x }: Ctx & { r: CRow; n: Nego }) {
  const f = r.f as FundX;
  const [dep, setDep] = useState(String(n.after?.depfee ?? n.before.depfee));
  const [acc, setAcc] = useState(String(n.after?.fee ?? n.before.fee));
  const [res, setRes] = useState<{ v: number; yr: number } | null>(null);
  const d = num(dep), a = num(acc);
  const eD = feeError(f.prod, 'depfee', d), eA = feeError(f.prod, 'fee', a);
  const ok = d != null && a != null && !eD && !eA;
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); if (!ok) return;
    const after = { fee: a!, depfee: d! };
    const v = savingOf(r.c.plan, n.before, after), yr = yearSaving(r.c.plan, n.before, after);
    setRes({ v, yr });
    x.setNegos([...x.negos.filter((z) => z.k !== n.k), { ...n, after, done: today() }]);
    x.patch(n.k, { fee: a!, depfee: d! });
    // the line may turn green and this form close: the saving stays at the top of the page (Saved)
    if (v >= 500) requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('ck-saved-h')?.scrollIntoView({ block: 'center', behavior: 'smooth' })));
  };
  const horizon = f.prod === 'השתלמות' ? 'בעוד 6 שנים' : 'עד הפרישה';  // the card's horizon for this product (lib/myCalc liq)
  return (
    <form className="ck-new" onSubmit={submit} aria-label={`דמי הניהול החדשים ב${f.name}`}>
      <div className="sv-form mo-form">
        <label><span>מהפקדה, %</span><input type="number" inputMode="decimal" min={0} step={0.01} value={dep} onChange={(e) => setDep(e.target.value)} aria-invalid={!!eD} /></label>
        <label><span>מצבירה, %</span><input type="number" inputMode="decimal" min={0} step={0.01} value={acc} onChange={(e) => setAcc(e.target.value)} aria-invalid={!!eA} /></label>
        <button type="submit" className="btn primary" disabled={!ok}>חישוב החיסכון</button>
      </div>
      {(eD || eA) && <p className="sv-err" role="alert">{eD ?? eA}</p>}
      {res && (res.v >= 500
        ? <div className="ck-win" role="status">
            <p className="ck-win-t">חסכתם כ-<b className="ck-ils">{ilsRound(res.v)}</b> {horizon}</p>
            <p className="sv-note">אומדן בשקלי היום על אותן הנחות (תשואה {pcf(r.c.plan.ret)} ברוטו, הפקדה שעולה 2% בשנה, אינפלציה 2%){res.yr >= 10 ? <>; השנה כ-{ilsRound(res.yr)} פחות דמי ניהול</> : null}. דמי הניהול החדשים נשמרו ב"המוצרים שלי".</p>
            <ShareCard amount={ilsRound(res.v)} when={horizon} />
          </div>
        : <p className="sv-note" role="status">{res.v > 0 ? 'דמי הניהול ירדו מעט: הפער קטן מ-500 ש"ח.' : 'דמי הניהול לא ירדו.'} נשמר ב"המוצרים שלי". אפשר לשלוח שוב את המכתב, או לשאול את הסוכן על הצעה מחברה אחרת.</p>)}
    </form>
  );
}

/** the negotiations that ended with new fees: what they are worth now, on today's plan */
function Saved({ done, rows, retire }: { done: Nego[]; rows: CRow[]; retire: number }) {
  const items = done.map((n) => { const r = rows.find((x) => x.f.k === n.k)!; return { n, r, v: savingOf(r.c.plan, n.before, n.after!) }; }).filter((x) => x.v >= 500);
  if (!items.length) return null;
  const total = items.reduce((s, x) => s + x.v, 0);
  const hor = items.every((x) => x.r.f.prod === 'השתלמות') ? 'בעוד 6 שנים' : 'עד הפרישה';
  return (
    <section className="panel ck-win ck-saved" aria-labelledby="ck-saved-h">
      <h2 id="ck-saved-h" className="ck-win-t">חסכתם כ-<b className="ck-ils">{ilsRound(total)}</b> {hor}</h2>
      <p className="sv-note">{items.map((x) => `${x.r.f.name}: מצבירה מ-${pcf(x.n.before.fee)} ל-${pcf(x.n.after!.fee)}, מהפקדה מ-${pcf(x.n.before.depfee)} ל-${pcf(x.n.after!.depfee)}`).join(' · ')}. אומדן בשקלי היום, עד גיל {ageText(retire)}.</p>
      <ShareCard amount={ilsRound(total)} when={hor} />
    </section>
  );
}

/* ======================= 2. deposits ======================= */
function DepCard({ line }: { line: ReturnType<typeof checkupOf>['dep'] }) {
  if (!line) return <Line n={2} id="ck-dep" icon="calendar" title="הפקדות מהמעסיק" tone={null}><p className="ck-sum">ההפקדות נבדקות בקרן פנסיה ובקרן השתלמות; אין כאלה ברשימה.</p></Line>;
  const bad = line.rows.filter((r) => r.audit && (r.audit.missing.length || r.audit.short.length || r.audit.late.length));
  const first = bad.find((r) => r.tone === 'red') ?? bad[0] ?? null;
  return (
    <Line n={2} id="ck-dep" icon="calendar" title="הפקדות מהמעסיק" tone={line.tone}>
      <p className="ck-sum">{line.total > 0 ? <>חסרים כ-<b className="ck-ils">{ilsRound(line.total)}</b> בהפקדות, בחודשים שהקובץ מכסה.</>
        : line.rows.every((r) => r.why === 'inactive') ? <>אין הפקדות שוטפות לבדוק.</>
        : line.tone === 'green' ? <>כל החודשים שבקובץ הופקדו בסכום הצפוי.</>
        : bad.length ? <>הפקדות הגיעו באיחור.</> : line.rows.some((r) => r.unsure.length) ? <>לא נמצא חוסר, אבל חודש אחד או יותר לא ברור מהקובץ.</> : <>חסר מידע כדי לבדוק: פירוט ההפקדות או השכר המבוטח.</>}</p>
      <ul className="ck-rows">{line.rows.map((r) => <DepRowLi key={r.k} r={r} />)}</ul>
      <p className="ck-src"><b>העוגן:</b> בפנסיה, המינימום בחוק: {PENSION_RATES.employee}% עובד, {PENSION_RATES.employer}% מעסיק ו-{PENSION_RATES.severance}% פיצויים, {rateTotal(PENSION_RATES)}% מהשכר המבוטח (<a className="sv-u" href={DEP_SRC.order.url} target="_blank" rel="noreferrer" title={DEP_SRC.order.title}>צו ההרחבה, כל זכות</a>); בהשתלמות, השיעורים שסוכמו (בדרך כלל 10%). נבדקים החודשים שבין הראשון לאחרון בקובץ; חודש לפני הראשון לא נחשב חסר.</p>
      <div className="ck-act">
        {first?.audit ? <>
          <h3>מכתב למעסיק{bad.length > 1 ? `: ${first.name}` : ''}</h3>
          <Script text={letterOf(first.audit, { fund: first.name, prod: first.prod, id: first.id })} label="מכתב למעסיק" note="עובדות ומספרים מהקובץ; כדאי לבדוק מול התלושים לפני השליחה." />
          <div className="ck-send"><a className="btn" href={mailHref(`הפקדות לקרן: ${first.name}`, letterOf(first.audit, { fund: first.name, prod: first.prod, id: first.id }))} onClick={() => track('letter_copied')}>דוא"ל למעסיק</a></div>
          <p className="sv-note">אם ההפקדות לא מושלמות: <a className="sv-u" href={DEP_SRC.complain.url} target="_blank" rel="noreferrer">תלונה על המעסיק במשרד העבודה</a> (1-800-354-354). <Link className="sv-u" to="/my#deposits">כל החודשים, בכרטיס</Link></p>
        </> : <p className="sv-note">{line.tone === 'green' ? <>אין מה לשלוח. כדאי לבדוק שוב אחרי העלאה בשכר (<Link className="sv-u" to="/my/moment/raise">העלאה</Link>).</> : <><a className="sv-u" href="#mk-h">ייבוא מהמסלקה</a> מביא את חודשי ההפקדה, או <Link className="sv-u" to="/my#deposits">להקליד את טבלה ה' מהדוח השנתי</Link>.</>}</p>}
      </div>
    </Line>
  );
}
function DepRowLi({ r }: { r: DepRowOut }) {
  const a = r.audit;
  return (
    <li><Dot tone={r.tone} /><span className="ck-r"><b>{r.name}</b>{' '}
      <span className="ck-kv">{r.why === 'nodata' ? 'אין פירוט הפקדות' : r.why === 'nosalary' ? 'חסר השכר המבוטח' : r.why === 'inactive' ? `אין הפקדות שוטפות (האחרונה ב-${ymHe(r.last!)}): אין מה לבדוק` : a ? <>
        {a.months.length === 1 ? 'חודש אחד' : `${a.months.length} חודשים`} ({ymHe(a.months[0].ym)}{a.months.length > 1 ? `–${ymHe(a.months[a.months.length - 1].ym)}` : ''}), צפוי כ-{ilsRound(a.months[0].exp.total)} לחודש על שכר של {ilsRound(a.months[0].salary)}
        {a.missing.length ? <>; בלי הפקדה: {a.missing.map((m) => ymHe(m.ym)).join(', ')}</> : null}
        {a.short.length ? <>; חלקית: {a.short.map((m) => `${ymHe(m.ym)} (חסרים כ-${ilsRound(m.gap)})`).join(', ')}</> : null}
        {a.late.length ? <>; באיחור: {a.late.map((m) => ymHe(m.ym)).join(', ')}</> : null}
        {!a.missing.length && !a.short.length && !a.late.length ? '; הכול הופקד' : ''}</> : null}</span>
      {r.unsure.length > 0 && <span className="ck-kv ck-ctx">{r.unsure.map(ymHe).join(', ')}: בקובץ אין שורה לחודש הזה, אבל השורה של החודש שאחריו מתוארכת לפי יום התשלום, ולכן היא כנראה ההפקדה שלו. כדאי לוודא בתלוש או בדוח.</span>}
      {r.kind === 'hishtalmut' && <span className="ck-kv">השתלמות: אין חובה בחוק; לפי השיעורים שסוכמו</span>}
    </span></li>
  );
}

/* ======================= 3. age and track ======================= */
function AgeCard({ line, ageSet }: { line: ReturnType<typeof checkupOf>['age']; ageSet: boolean }) {
  if (!line) return <Line n={3} id="ck-age" icon="sliders" title="מסלול מול הגיל" tone={null}><p className="ck-sum">מסלולי גיל יש בקרן פנסיה ובקופת גמל; אין כאלה ברשימה (בהשתלמות אין מסלולי גיל).</p></Line>;
  const off = line.rows.filter((r) => r.tone !== 'green');
  return (
    <Line n={3} id="ck-age" icon="sliders" title="מסלול מול הגיל" tone={line.tone}>
      <p className="ck-sum">{off.length ? <>{off.length === 1 ? 'מסלול אחד לא תואם' : `${off.length} מסלולים לא תואמים`} את מסלול הגיל לגיל {line.rows[0].age}.</> : <>המסלולים מתאימים לגיל {line.rows[0].age}{line.rows.some((r) => r.kind === 'chosen-ok') ? ', או קרובים אליו בחשיפה למניות' : ''}.</>}
        {!ageSet && <> <span className="sv-a">לפי גיל {AGE_DEFAULT} לדוגמה: הזינו גיל למעלה</span></>}</p>
      <ul className="ck-rows">{line.rows.map((r) => <AgeRowLi key={r.k} r={r} />)}</ul>
      <p className="ck-src"><b>העוגן:</b> מודל ההשקעה התלוי גיל של הרשות: עד 50, 50–60 ו-60 ומעלה; הקרן מעבירה סמוך לגיל, ועמית רשאי לבחור להישאר (<SrcA s={MS.ageModel} />). במסלול שנבחר, החשיפה למניות מול מסלול הגיל של אותה חברה (<Link className="sv-u" to={`/funds/glide?prod=${encodeURIComponent(line.rows[0].prod)}`}>מסלולי גיל</Link>); הבדל של {ST_FAR} נקודות אחוז ומעלה מסומן לבדיקה (סף של fox, לא כלל של הרשות).</p>
      <div className="ck-act">{off.length ? <><h3>שאלה לקרן{off.length > 1 ? `: ${off[0].name}` : ''}</h3><Script text={ageAsk(off[0])} label="שאלה לקרן על מסלול הגיל" note="שאלה, לא בקשה לעבור. מסלול הוא בחירה שלכם." /></>
        : <p className="sv-note">אין מה לשאול. סמוך לגיל 50 ול-60 כדאי לבדוק שהמעבר קרה (<Link className="sv-u" to="/my/moment/sixty">מתקרבים ל-60</Link>).</p>}</div>
    </Line>
  );
}
function AgeRowLi({ r }: { r: AgeRowOut }) {
  const words = r.kind === 'age-ok' ? `מסלול "${r.track}", מסלול הגיל שלכם`
    : r.kind === 'age-past' ? `מסלול "${r.track}"; בגיל ${r.age} מסלול הגיל הוא "${r.band}"`
    : r.kind === 'age-edge' ? `מסלול "${r.track}"; בגיל ${r.age} המעבר ל"${r.band}" אמור לקרות בקרוב`
    : r.kind === 'age-young' ? `מסלול "${r.track}", מסלול של גיל מבוגר יותר; בגיל ${r.age} מסלול הגיל הוא "${r.band}"`
    : `מסלול "${r.track}" שנבחר: חשיפה למניות ${pcf(r.st)}, מול ${pcf(r.ref)} במסלול הגיל "${r.band}"${r.refFrom === 'mgr' ? ' של אותה חברה' : ' (חציון)'}`;
  return <li><Dot tone={r.tone} /><span className="ck-r"><Link className="sv-u" to={`/funds/${r.k}`}>{r.name}</Link> <span className="ck-kv">{words}.</span>{r.refK && (r.kind === 'chosen-far' || r.kind === 'age-past') ? <span className="ck-kv"><Link className="sv-u" to={`/funds/${r.refK}`}>מסלול הגיל באותה חברה</Link></span> : null}</span></li>;
}

/** the anchor hierarchy, in one paragraph (the same rule the three lines use) */
function Anchors() {
  return (
    <details className="panel ck-how">
      <summary><h2>איך נקבע אדום, צהוב וירוק</h2></summary>
      <p>דמי ניהול: בקרן פנסיה מקיפה, דמי הניהול <b>שלכם</b> מול מחיר קרנות ברירת המחדל, המחיר שכל אחד יכול לקבל. בשאר המוצרים, מול חציון הממוצע שמשלמים בפועל העמיתים בקטגוריה, עם הרבע הזול כיעד והתקרה בחוק כגבול. הממוצע במסלול שלכם מוצג להקשר בלבד: ממוצע, לא מחיר. "לטיפול": פער של {MIN_GAP.toLocaleString('en-US')} ש"ח ומעלה עד הפרישה (בהשתלמות: בעוד 6 שנים), בשקלי היום. "לבדיקה": דמי הניהול שלכם לא ידועים, או שחלק מהם מעל העוגן והפער קטן.</p>
      <p>הפקדות: בפנסיה, חודש בלי הפקדה או עם פחות מ-18.5% מהשכר המבוטח "לטיפול"; איחור, או השתלמות, "לבדיקה". מסלול הגיל: מסלול גיל צעיר מהגיל "לטיפול"; מסלול שנבחר רחוק בחשיפה למניות "לבדיקה". תיאור, לא המלצה.</p>
    </details>
  );
}
