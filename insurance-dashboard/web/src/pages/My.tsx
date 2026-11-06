import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { useFundCats, useFunds } from '../lib/useData';
import { useOptional } from '../lib/fundsLoad';
import { SALARY_KEY, useMine, useMy, useMyAge, useMyRetire, useMySalary, useMySex, useProfiles, useRetire, type MyProduct } from '../lib/mine';
import { writeStored } from '../lib/local';
import { PROFILE_ADD, PROFILE_LABEL, addProfile, removeProfile, setActive, type ProfileId } from '../lib/household';  // W7
import { useSaverDoor } from '../lib/door';
import { grossProv, netProv, useBasis, type CatX, type FundX, type FundsFile } from '../lib/funds';
import { deltaOf, markSeen, ymL, type WSnap } from '../lib/fundsTime';  // phase 0: the watchlist (was /funds/watch)
import { snapOf, useWatch } from '../lib/fundsTimeLoad';
import { WatchStar } from '../components/FundsTime';
import { nf } from '../lib/format';
import type { DefaultFile } from '../lib/fundsTools';
import type { Prov } from '../lib/prov';
import { AGE_DEFAULT, KZ_RETIRE, RET_FALLBACK, ageText, ilsRound } from '../lib/retire';
import { COEF_PATH, birthYearOf, coefFor, pct0, replacementOf, type CoefFile } from '../lib/coef';  // W6
import { cardCalc, summaryOf, type SumRow } from '../lib/myCalc';
import { pcf } from '../lib/verdict';
import { DECISION_PATH, type DecisionFile } from '../lib/decision';
import { Picker } from '../components/saver/Picker';
import { ProductCard } from '../components/saver/ProductCard';
import { GlossBar } from '../components/saver/Gloss';
import { MaslakaImport } from '../components/saver/MaslakaImport';
import { SinceVisit } from '../components/saver/SinceVisit';
import { MomentChips } from '../components/saver/MomentChips';  // W9: life moments
import { CK_STATUS_KEY, dueNegos, isoDay, normNegos, normStatus, statusLine } from '../lib/checkup';  // S1+S2: the check-up's 30-day reminder; its status line
import '../styles/moments.css';
import '../styles/saver.css';
import '../styles/my-watch.css';
import '../styles/checkup.css';

/* /my, "המוצרים שלי" (W1 saver door; W4 after the second red team, 02.11.26): the reader's age once, a strip that adds up what they
   pay and what the pension funds may pay, the one thing worth asking for, then a folded card per product. The list lives in this
   browser only (lib/mine). Descriptive, never advice: no "move", no "stay". With nothing saved yet: the picker, and one example card
   clearly marked "דוגמה". Entering /my with no door chosen is entering the saver door.
   W6: the pension estimate of each fund divides by that fund's own conversion coefficient from its bylaws (lib/coef, funds/coef.json)
   when the file has one, else by the site's assumption, and the strip says which; a salary (optional, this browser only) adds the
   replacement rate without and with the National Insurance old-age pension against the 70% benchmark. No headline pension figure is
   shown before a balance is entered.
   W7 (wave 2): household profiles ("אני", "+ בן/בת זוג", "+ הורה"; lib/household) in one chip row, each with its own products, age, sex,
   retirement age, salary and "what changed" snapshot; "אני" keeps the keys the page always used, so nothing is lost. The deposit
   watchdog, the coverage line and "חבר אמר לעבור ל…" live on the card (components/saver). /my#deposits opens the first pension or
   השתלמות card on its watchdog (the link from /my/statement).
   W9: a row of five chips, the life moments (/my/moment/<id>, pages/Moments), the labels only (the page's 400-word budget).
   Phase 0 (05.11.26): "במעקב", the tracks this browser follows (the ☆ on every track; formerly /funds/watch, which lands on /my#watch):
   one line per track, folded unless the address asks for it, so it costs the page's word budget nothing until opened. */
export { SALARY_KEY };
const EXAMPLE = 'p9757';
const today = () => new Date().toISOString().slice(0, 10);

export function My() {
  useSaverDoor();
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cats = useFundCats().data as Record<string, CatX> | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);
  const coefF = useOptional<CoefFile>(COEF_PATH);  // W6
  const [mine, setMine] = useMine();
  const [ageS] = useMyAge(), [sex] = useMySex();
  const R = useRetire();
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const loc = useLocation();
  const focusDep = loc.hash === '#deposits';
  const byK = useMemo(() => new Map(((data?.funds ?? []) as FundX[]).map((f) => [f.k, f])), [data]);
  const list = (Array.isArray(mine) ? mine : []).filter((m) => m && typeof m.k === 'string');

  // a link from the fund card (/my#p9757) lands on that product
  useEffect(() => { if (data && loc.hash && !focusDep) document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: 'start' }); }, [data, loc.hash, focusDep]);
  const firstDep = shownDepKey(list, byK);

  const rows: SumRow[] = useMemo(() => (!data || dfile === undefined ? [] : list.flatMap((m) => { const f = byK.get(m.k); if (!f) return [];
    // W6: the fund's own coefficient (its bylaws) for the reader's sex, retirement age and birth year; the assumption where there is none
    const pick = coefFor(coefF, f.grp, sex, R.v, birthYearOf(ageS ?? AGE_DEFAULT));
    return [{ k: f.k, name: f.name, prod: f.prod, coefReal: pick.real, c: cardCalc(f, data.funds as FundX[], data.asof, dfile, m, dec, { age: ageS ?? AGE_DEFAULT, coef: pick.v, ret: RET_FALLBACK, retire: R.v }) }]; })),
    [data, dfile, dec, coefF, list, byK, ageS, sex, R.v]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data || dfile === undefined) return <Loading what="המוצרים שלך" />;

  const add = (k: string) => { if (!list.some((m) => m.k === k)) setMine([...list, { k, added: today() }]); setAdding(false); requestAnimationFrame(() => document.getElementById(k)?.scrollIntoView({ block: 'start', behavior: 'smooth' })); };
  const patch = (k: string) => (p: Partial<MyProduct>) => setMine(list.map((m) => (m.k === k ? { ...m, ...p } : m)));
  const remove = (k: string) => setMine(list.filter((m) => m.k !== k));
  const ex = byK.get(EXAMPLE);
  const shown = list.map((m) => ({ m, f: byK.get(m.k) }));
  const asof = `${String(data.asof % 100).padStart(2, '0')}/${String(Math.floor(data.asof / 100)).slice(2)}`;

  return (
    <div className="sv-page">
      <div className="pagehead"><div>
        <span className="eyebrow">החיסכון שלי</span>
        <h1><span className="icotile"><Icon name="mine" /></span>המוצרים שלי</h1>
        <div className="sub sv-sub">{shown.length ? <>נתוני רשות שוק ההון עד {asof}.</> : <>כמה אתם משלמים ואיפה המסלול עומד, בשקלים. נתוני רשות שוק ההון עד {asof}.</>}</div>
      </div></div>

      <Household />
      <AgeRow />
      {msg && <p className="sv-done" role="status">{msg}</p>}
      {rows.length > 0 && <Strip rows={rows} retire={R.v} coefF={coefF} />}
      <CheckupLink has={shown.length > 0} />
      <MomentChips lead={false} />

      {shown.length > 0 && <SinceVisit data={data} dfile={dfile} list={list} />}
      <Watching data={data} />

      {shown.length > 0 && <div className="sv-list">
        {shown.map(({ m, f }) => f
          ? <ProductCard key={m.k} f={f} data={data} cats={cats} dfile={dfile} my={m} onChange={patch(m.k)} onRemove={() => remove(m.k)} focus={focusDep && m.k === firstDep ? 'deposits' : undefined} />
          : <div key={m.k} className="panel sv-card sv-gone"><p>המסלול {m.k} כבר לא מופיע בנתוני הרשות ({asof}). ייתכן שנסגר או מוזג.</p><button type="button" className="btn" onClick={() => remove(m.k)}>הסרה מהרשימה</button></div>)}
      </div>}

      <section className="panel sv-add" aria-labelledby="sv-add-h">
        <div className="hd"><h2 id="sv-add-h">{shown.length ? 'עוד מוצר' : 'מה יש לך?'}</h2>{!shown.length && <div className="aside"><span>פנסיה, השתלמות, גמל ופוליסות</span></div>}</div>
        {shown.length && !adding ? <button type="button" className="btn" onClick={() => setAdding(true)}>+ הוספת מוצר</button>
          : <Picker funds={data.funds as FundX[]} have={list.map((m) => m.k)} onPick={add} />}
      </section>

      <MaslakaImport compact={shown.length > 0} funds={data.funds as FundX[]} mine={list} today={today()} onSave={(next, m) => { setMine(next); setMsg(m); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }} />


      {shown.length === 0 && ex && <section className="sv-exwrap" aria-label="דוגמה">
        <p className="sv-exlead">כך נראה כרטיס של מוצר. <b>זו דוגמה, לא המוצר שלך:</b> קרן פנסיה אמיתית מהנתונים, עם דמי הניהול הממוצעים בה.</p>
        <ProductCard f={ex} data={data} cats={cats} dfile={dfile} example onAdd={() => add(EXAMPLE)} />
      </section>}

      <p className="sv-privacy"><Icon name="shield" /> הכול נשמר רק בדפדפן הזה, בלי הרשמה; שום נתון לא נשלח.</p>
      {shown.length === 0 && <GlossBar />}
      <p className="sv-legal">מידע תיאורי, לא ייעוץ השקעות או ייעוץ פנסיוני, ואין המלצה לעבור או להישאר. תשואות עבר אינן מבטיחות תשואות בעתיד. <Link to="/about">על האתר והמקורות</Link></p>
    </div>
  );
}

/** Phase 0: the tracks this browser follows (the ☆ on every track card, lib/fundsTime watch store), one line each: the last 12 months,
 *  the fee and a "new month" chip against the last look. The look is recorded when the reader leaves, only if the list was opened. */
function Watching({ data }: { data: FundsFile }) {
  const [w, setW] = useWatch();
  const [b] = useBasis();
  const { hash } = useLocation();
  const asof = data.asof;
  const byK = useMemo(() => new Map(((data.funds ?? []) as FundX[]).map((f) => [f.k, f])), [data]);
  const now = useMemo(() => { const m = new Map<string, WSnap>(); w.items.forEach((i) => { const f = byK.get(i.k); if (f) m.set(i.k, snapOf(f, asof, b)); }); return m; }, [w, byK, asof, b]);
  const [open, setOpen] = useState(hash === '#watch');
  // /my#watch (where /funds/watch lands) opens the list and brings it into view once the cards above it have taken their height
  useEffect(() => { if (hash !== '#watch') return; setOpen(true); const t = setTimeout(() => document.getElementById('watch')?.scrollIntoView({ block: 'start' }), 250); return () => clearTimeout(t); }, [hash]);
  const ref = useRef({ w, now, opened: open }); ref.current = { w, now, opened: ref.current.opened || open };
  useEffect(() => {
    const mark = () => { const r = ref.current; if (r.opened && r.w.items.length) setW(markSeen(r.w, r.now, asof)); };
    addEventListener('pagehide', mark);
    return () => { removeEventListener('pagehide', mark); mark(); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!w.items.length) return hash === '#watch' ? <p id="watch" className="sv-muted mw-empty">במעקב: עוד אין מסלולים. ☆ בכרטיס של כל מסלול מוסיף אותו לכאן.</p> : null;
  const y12 = (f: FundX) => (b === 'net' ? f.net?.y12 ?? null : f.y12);
  const fresh = w.items.filter((i) => deltaOf(i, now.get(i.k) ?? null)?.fresh).length;
  return (
    <details id="watch" className="panel mw" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><h2>במעקב</h2><span><span className="num">{w.items.length}</span> מסלולים{fresh > 0 && <> · <span className="num">{fresh}</span> עם חודש חדש</>}</span></summary>
      <ul className="mw-list">{w.items.map((i) => {
        const f = byK.get(i.k), d = deltaOf(i, now.get(i.k) ?? null);
        if (!f) return <li key={i.k}><b>{i.name}</b><span>לא בנתוני הרשות ({ymL(asof)}): ייתכן שנסגר או מוזג</span></li>;
        const r = y12(f);
        return (
          <li key={i.k} className={d?.fresh ? 'fresh' : undefined}>
            <Link className="sv-u" to={`/funds/${f.k}`}>{f.name}</Link>
            <span className="mw-kv">12 חודשים {r == null ? '–' : <Sourced src={() => (b === 'net' ? netProv(f, 'y12', asof, r) : grossProv(f, 'y12', asof))}><span className="num">{nf(r, 2)}%</span></Sourced>}</span>
            <span className="mw-kv">דמי ניהול {f.fee == null ? '–' : <span className="num">{nf(f.fee, 2)}%</span>}{d?.dFee ? <span> (<span className="num">{d.dFee > 0 ? '▲' : '▼'} {nf(Math.abs(d.dFee), 2)}</span> נ"א מאז)</span> : null}</span>
            {d?.fresh && <span className="chip est">{d.months === 1 ? 'חודש חדש' : `${d.months} חודשים חדשים`}</span>}
            <WatchStar f={f} asof={asof} small />
          </li>
        );
      })}</ul>
      <p className="sv-muted mw-note">נתוני {ymL(asof)}, {b === 'net' ? 'נטו (אומדן)' : 'ברוטו'} · "חודש חדש": מאז הביקור הקודם ברשימה · נשמר רק בדפדפן הזה</p>
    </details>
  );
}

/** S1 (fox 3.0): the way into the annual check-up (/my/checkup), and its 30-day reminder when one is due (S2). It takes the place of
 *  the "איך קוראים את הדוח השנתי?" card (the plan merges the statement guide into "רגעים" as "הדוח השנתי הגיע"; the check-up links
 *  to it), so the page stays inside its 400-word budget */
function CheckupLink({ has }: { has: boolean }) {
  const [raw] = useMy<unknown>('my:nego', []);
  const due = dueNegos(normNegos(raw), isoDay(new Date())).length > 0;
  // red team 06.11.26: after a check-up, its status ("2 לטיפול · חסכתם כ-… · הבדיקה הבאה 10/27") in place of the generic line
  const [stRaw] = useMy<unknown>(CK_STATUS_KEY, null);
  const st = has ? normStatus(stRaw) : null;
  return (
    <Link to="/my/checkup" className={`panel sv-stmt sv-ck${due ? ' due' : ''}`}>
      <span className="icotile"><Icon name={due ? 'calendar' : 'check'} /></span>
      <span className="sv-stmt-t"><b>{due ? 'עברו 30 יום: מה דמי הניהול עכשיו?' : 'הבדיקה השנתית'}</b><span>{due ? 'הזינו ונחשב כמה חסכתם.' : st ? statusLine(st) : has ? 'דמי ניהול, הפקדות ומסלול גיל.' : 'מקובץ המסלקה, בשלוש שורות.'}</span></span>
      <span className="sv-stmt-go" aria-hidden="true">←</span>
    </Link>
  );
}

/** W7: the first product the deposit watchdog reads (pension or השתלמות), for the link from /my/statement */
function shownDepKey(list: MyProduct[], byK: Map<string, FundX>): string | null {
  const pen = list.find((m) => { const p = byK.get(m.k)?.prod; return p === 'פנסיה מקיפה' || p === 'פנסיה כללית'; });
  return (pen ?? list.find((m) => byK.get(m.k)?.prod === 'השתלמות'))?.k ?? null;
}

/** W7: the household's profiles in one chip row. Each profile keeps its own products, age, sex, retirement age, salary and snapshot
 *  in this browser; no names are stored, and the note to the agent calls anyone but "אני" simply "החוסך/ת". */
function Household() {
  const [P, setP] = useProfiles();
  const others = (['spouse', 'parent'] as const).filter((id) => !P.list.includes(id));
  const drop = (id: ProfileId) => {
    if (!confirm(`להסיר את הפרופיל "${PROFILE_LABEL[id]}" ומה שנשמר בו בדפדפן הזה?`)) return;
    const r = removeProfile(P, id); r.drop.forEach((k) => writeStored(k, undefined)); setP(r.profiles);
  };
  return (
    <div className="sv-hh" role="group" aria-label="של מי המוצרים: כל פרופיל עם המוצרים והגיל שלו, בדפדפן הזה בלבד" title="כל פרופיל עם המוצרים והגיל שלו, בדפדפן הזה בלבד">
      {P.list.map((id) => <button key={id} type="button" className="sv-chip sm" aria-pressed={P.active === id} onClick={() => setP(setActive(P, id))}>{PROFILE_LABEL[id]}</button>)}
      {others.map((id) => <button key={id} type="button" className="sv-chip sm ghost" onClick={() => setP(addProfile(P, id))} aria-label={`הוספת פרופיל: ${PROFILE_LABEL[id]}`}>{PROFILE_ADD[id]}</button>)}
      {P.active !== 'me' && <button type="button" className="linkbtn" onClick={() => drop(P.active)}>הסרת הפרופיל</button>}
    </div>
  );
}

/** the reader's age (and, for the conversion coefficient, sex), asked once and used on every card and in the fee tool */
function AgeRow() {
  const [age, setAge] = useMyAge();
  const [sex, setSex] = useMySex();
  const [raw, setRaw] = useState(age == null ? '' : String(age));
  const [was, setWas] = useState(age);
  if (was !== age) { setWas(age); setRaw(age == null ? '' : String(age)); }
  const bad = raw !== '' && !(Number(raw) >= 16 && Number(raw) <= 66);
  return (
    <div className="sv-who" role="group" aria-label="הגיל שלך">
      <label className="sv-who-age"><span>גיל</span>
        <input type="number" inputMode="numeric" min={16} max={66} step={1} placeholder={String(AGE_DEFAULT)} value={raw} aria-invalid={bad}
          onChange={(e) => { const t = e.target.value; setRaw(t); const x = Number(t); if (t !== '' && Number.isInteger(x) && x >= 16 && x <= 66) setAge(x); }} />
      </label>
      {age == null ? <span className="sv-a sv-who-ex">{AGE_DEFAULT} לדוגמה, שנו</span> : bad ? <span className="sv-err">גיל בין 16 ל-66</span> : null}
      <span className="sv-rets" role="group" aria-label="מין, למקדם הקצבה">
        {([['f', 'אישה'], ['m', 'גבר']] as const).map(([k, l]) => <button key={k} type="button" className="sv-chip sm" aria-pressed={sex === k} onClick={() => setSex(sex === k ? null : k)}>{l}</button>)}
      </span>
      <span className="sv-a">לא חובה</span>
      <RetireIn />
      <SalaryIn />
    </div>
  );
}

/** W5: the retirement age, statutory by sex and age (lib/retire), and the reader's own when typed */
function RetireIn() {
  const R = useRetire();
  const [own, setOwn] = useMyRetire();
  const [raw, setRaw] = useState(own == null ? '' : String(own));
  const [was, setWas] = useState(own);
  if (was !== own) { setWas(own); setRaw(own == null ? '' : String(own)); }
  const bad = raw !== '' && !(Number(raw) >= 50 && Number(raw) <= 75);
  return (
    <span className="sv-who-ret">
      <label className="sv-who-age"><span>גיל פרישה</span>
        <input type="number" inputMode="decimal" min={50} max={75} step={1} placeholder={ageText(R.v)} value={raw} aria-invalid={bad}
          onChange={(e) => { const t = e.target.value; setRaw(t); const x = Number(t); if (t === '') setOwn(null); else if (Number.isFinite(x) && x >= 50 && x <= 75) setOwn(x); }} />
      </label>
      {bad ? <span className="sv-err">גיל בין 50 ל-75</span> : <span className="sv-a">{own != null ? <>שלך · <button type="button" className="linkbtn" onClick={() => setOwn(null)}>לגיל בחוק</button></> : <a className="sv-u" href={KZ_RETIRE} target="_blank" rel="noreferrer" title={R.why}>לפי החוק</a>}</span>}
    </span>
  );
}

/** W6: the reader's gross monthly salary, for the replacement rate (optional; this browser only) */
function SalaryIn() {
  const [sal, setSal] = useMySalary();
  const [raw, setRaw] = useState(sal == null ? '' : String(sal));
  const [was, setWas] = useState(sal);
  if (was !== sal) { setWas(sal); setRaw(sal == null ? '' : String(sal)); }
  const bad = raw !== '' && !(Number(raw) >= 1000 && Number(raw) <= 200000);
  return (
    <span className="sv-who-ret">
      <label className="sv-who-age"><span>שכר ברוטו לחודש</span>
        <input type="number" inputMode="numeric" min={1000} max={200000} step={100} placeholder="למשל 15000" value={raw} aria-invalid={bad} style={{ width: 124 }}
          onChange={(e) => { const t = e.target.value; setRaw(t); const x = Number(t); if (t === '') setSal(null); else if (Number.isFinite(x) && x >= 1000 && x <= 200000) setSal(Math.round(x)); }} />
      </label>
      {bad ? <span className="sv-err">סכום בין 1,000 ל-200,000</span> : <span className="sv-a">לא חובה</span>}
    </span>
  );
}

/** the strip at the top: what the reader pays this year, the pension estimate, and the one thing worth asking for */
function Strip({ rows, retire, coefF }: { rows: SumRow[]; retire: number; coefF: CoefFile | null | undefined }) {
  const at = `בגיל ${ageText(retire)}`;
  const s = summaryOf(rows);
  const [salary] = useMySalary();
  const nReal = rows.filter((r) => r.prod.startsWith('פנסיה') && r.coefReal).length, nPen = rows.filter((r) => r.prod.startsWith('פנסיה')).length;
  const coefWhy = nPen === 0 ? '' : nReal === nPen ? 'מקדם מהתקנון' : nReal === 0 ? 'מקדם לפי הנחה' : `מקדם מהתקנון ב-${nReal} מתוך ${nPen}`;
  const rep = salary != null && s.pension != null && s.penBal > 0 && coefF ? replacementOf(s.pension, salary, coefF) : null;
  const firstPen = rows.find((r) => r.prod.startsWith('פנסיה'));
  const feesProv = (): Prov => ({ k: 'calc', est: true, title: 'דמי ניהול בשנה, כל המוצרים', value: ilsRound(s.fees), formula: 'לכל מוצר: היתרה × דמי הניהול מצבירה, ועוד 12 הפקדות × דמי הניהול מהפקדה. דמי הניהול שלך כשהזנת, אחרת הממוצע במסלול',
    note: [s.feesAvg ? 'בחלק מהמוצרים: דמי הניהול הממוצעים במסלול, לא שלך' : null, s.feesEx ? 'בחלק מהמוצרים: יתרה או הפקדה לדוגמה' : null].filter(Boolean).join('. ') || undefined,
    inputs: rows.map((r) => ({ label: `${r.name} (${r.c.v.fee.own ? 'שלך' : 'ממוצע'}: ${pcf(r.c.mine.fee)} / ${pcf(r.c.mine.depfee)})`, v: ilsRound(r.c.annual.total) })) });
  const penProv = (): Prov => ({ k: 'calc', est: true, title: `קצבה חודשית מקרנות הפנסיה ${at}, בשקלי היום · אומדן`, value: ilsRound(s.pension ?? 0),
    formula: `סכום האומדנים של כל קרן פנסיה ברשימה: החיסכון ${at} ÷ מקדם ההמרה של הקרן. ${coefWhy}. תשואה שמרנית של 4% ברוטו, הפקדה שעולה 2% בשנה, אינפלציה 2%`,
    note: 'אומדן גס. לא מנכה את עלות הכיסוי הביטוחי, לא כולל מוצרים שאינם קרן פנסיה, קצבת זקנה מביטוח לאומי או מס. המקדם של כל קרן: בכרטיס שלה, עם העמוד בתקנון',
    inputs: rows.filter((r) => r.prod.startsWith('פנסיה')).map((r) => ({ label: r.name, v: ilsRound(r.c.out.pensionReal) })) });
  const a = s.act;
  return (
    <section className="panel sv-sum" aria-label="התמונה בקצרה">
      <dl className="sv-kpis">
        <div><dt>דמי ניהול בשנה</dt><dd><Sourced src={feesProv}><b className="num">{ilsRound(s.fees)}</b></Sourced></dd><dd className="sv-a">{rows.length > 1 ? `כל ${rows.length} המוצרים` : 'המוצר'}{s.feesAvg ? ', חלקם לפי הממוצע במסלול' : ', לפי דמי הניהול שלך'}{s.feesEx ? ', עם נתונים לדוגמה' : ''}</dd></div>
        {s.pension != null && (s.penBal > 0
          ? <div><dt>קצבה מהפנסיה, אומדן</dt><dd><Sourced src={penProv}><b className="num">{ilsRound(s.pension)}</b></Sourced> לחודש</dd><dd className="sv-a">{at}, בשקלי היום, תשואה 4%; {coefWhy}</dd></div>
          : <div><dt>קצבה מהפנסיה, אומדן</dt><dd><a href={firstPen ? `#${firstPen.k}` : '#'} className="sv-u">הזינו יתרה</a></dd><dd className="sv-a">בלי היתרה שלך מהדוח אין מה לאמוד; {coefWhy}</dd></div>)}
      </dl>
      {rep && coefF && <ReplaceLines rep={rep} coefF={coefF} salary={salary!} pension={s.pension!} />}
      <p className="sv-one"><b>דבר אחד לעשות:</b>{' '}
        {a.kind === 'fee' ? <>לבקש הפחתת דמי ניהול ב<a href={`#${a.k}`}>{rows.filter((r) => r.prod === a.prod).length === 1 ? shortName(a.name, a.prod) : a.name}</a>: כ-{ilsRound(a.v)} פחות בחיסכון {a.prod === 'השתלמות' ? `בעוד ${a.years} שנים` : 'בגיל הפרישה'}, {a.ref === 'med' ? (a.own ? 'לעומת חציון הממוצע בפועל בקטגוריה' : 'לעומת החציון בקטגוריה') : 'לעומת מחיר קרנות ברירת המחדל'}{a.own ? '' : ' (לפי הממוצע במסלול)'}. ההודעה בכרטיס.</>
          : a.kind === 'enter' ? <>להזין את דמי הניהול מהדוח השנתי ב<a href={`#${a.k}`}>{a.name}</a>: בלי זה החישוב לפי הממוצע במסלול.</>
          : <>לבדוק בדוח השנתי שהמוטבים מעודכנים (<Link to="/my/statement#st-ben">איפה זה בדוח</Link>). דמי הניהול שלך לא גבוהים מהחציון באף מוצר.</>}
      </p>
    </section>
  );
}
/** W6: the replacement rate in three lines: pension ÷ last salary, the same with the National Insurance basic old-age pension, and the
 *  benchmark the literature uses (70%). Facts of the arithmetic on the estimate above, not a recommendation. */
function ReplaceLines({ rep, coefF, salary, pension }: { rep: NonNullable<ReturnType<typeof replacementOf>>; coefF: CoefFile; salary: number; pension: number }) {
  const b = coefF.btl, t = coefF.target;
  const from = `${b.from.slice(8, 10)}.${b.from.slice(5, 7)}.${b.from.slice(0, 4)}`;
  const btlProv = (): Prov => ({ k: 'report', title: 'קצבת אזרח ותיק (זקנה) בסיסית ליחיד', value: `${b.single.toLocaleString('en-US')} ש"ח לחודש`, url: b.url, pg: null, doc: b.title, period: `מ-${from}`, note: `${b.quote}. ${b.note ?? ''} נקרא ${b.retrieved}` });
  const tgtProv = (): Prov => ({ k: 'report', title: 'יחס תחלופה מקובל', value: `${t.rate}%`, url: t.url, pg: t.pg ?? null, doc: t.title, note: `${t.quote ? `"${t.quote}". ` : ''}${t.note ?? ''}` });
  const rateProv = (withBtl: boolean) => (): Prov => ({ k: 'calc', est: true, title: `יחס תחלופה ${withBtl ? 'עם' : 'בלי'} קצבת זקנה מביטוח לאומי`, value: pct0(withBtl ? rep.withBtl : rep.noBtl),
    formula: withBtl ? '(אומדן הקצבה מהפנסיה + קצבת אזרח ותיק בסיסית ליחיד) ÷ השכר ברוטו לחודש' : 'אומדן הקצבה מהפנסיה ÷ השכר ברוטו לחודש שהזנת',
    note: 'הקצבה באומדן לפני מס ובשקלי היום; השכר ברוטו. יחס התחלופה במאמר האוצר הוא נטו, מול ההכנסה הפנויה, ולכן אינו זהה',
    inputs: [{ label: 'קצבה מהפנסיה, אומדן', v: ilsRound(pension) }, ...(withBtl ? [{ label: `קצבת אזרח ותיק בסיסית ליחיד (מ-${from})`, v: ilsRound(rep.btl), src: btlProv }] : []), { label: 'שכר ברוטו לחודש (שלך)', v: ilsRound(salary) }] });
  return (
    <ul className="sv-lines sv-rep" aria-label="יחס תחלופה">
      <li><span className="sv-dot" aria-hidden="true" /><span>יחס תחלופה בלי ביטוח לאומי: <Sourced src={rateProv(false)}><b className="num">{pct0(rep.noBtl)}</b></Sourced> מהשכר ברוטו.</span></li>
      <li><span className="sv-dot" aria-hidden="true" /><span>עם קצבת אזרח ותיק בסיסית ליחיד (<Sourced src={btlProv}><span className="num">{b.single.toLocaleString('en-US')} ש"ח</span></Sourced>, מ-{from}): <Sourced src={rateProv(true)}><b className="num">{pct0(rep.withBtl)}</b></Sourced>.</span></li>
      <li><span className="sv-dot" aria-hidden="true" /><span>יעד מקובל: <Sourced src={tgtProv}><span className="num">{t.rate}%</span></Sourced> ומעלה (משרד האוצר, 2016: "המינימום המקובל"; יחס נטו, לא יעד רשמי). תיאור, לא המלצה.</span></li>
    </ul>
  );
}
/** "קרן הפנסיה" / "קרן ההשתלמות" when the reader has one of each; the full name otherwise */
function shortName(name: string, prod: string) {
  return prod === 'פנסיה מקיפה' || prod === 'פנסיה כללית' ? 'קרן הפנסיה' : prod === 'השתלמות' ? 'קרן ההשתלמות' : name;
}
