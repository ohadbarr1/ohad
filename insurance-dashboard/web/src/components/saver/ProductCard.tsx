import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { Tip } from '../Explain';
import { copyText } from '../ui';
import { WatchStar } from '../FundsTime';
import { useStored } from '../../lib/local';
import type { MyProduct } from '../../lib/mine';
import type { Prov } from '../../lib/prov';
import type { CatX, FundX, FundsFile } from '../../lib/funds';
import type { DefaultFile } from '../../lib/fundsTools';
import { isPension, pcf, pcr, verdictOf, type Verdict } from '../../lib/verdict';
import { AGE_DEFAULT, BALANCE_EX, COEF_DEFAULT, GROWTH_DEFAULT, INFL_DEFAULT, RETIRE_AGE, RET_FALLBACK, exampleMonthly, feeGap, ilsRound, project, refPair, type Plan } from '../../lib/retire';
import { dsName, scriptOf } from '../../lib/script';
import type { FeePair } from '../../lib/fundsCalc';
import { Est, cat10, cat10Prov, figsOf, tenderProv, ymOf } from './figs';
import { Report } from './Report';
import { useOptional } from '../../lib/fundsLoad';
import { DECISION_PATH, type DecisionFile } from '../../lib/decision';  // W2

/* One product of "המוצרים שלי": the report card, what the fees cost in ₪ by 67, a note to the agent, a rough pension estimate
   (pension only), the השתלמות facts, and the next pages. Everything that is not the reader's or the regulator's is labelled. */

export const KOLZCHUT_HISHTALMUT = 'https://www.kolzchut.org.il/he/%D7%A7%D7%A8%D7%9F_%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA';
export const COEF_SRC = 'https://www.bizportal.co.il/longtermsavings/news/article/20036400';
const num = (s: string): number | null => { const t = s.replace(/[,\s₪]/g, ''); if (t === '') return null; const x = Number(t); return Number.isFinite(x) && x >= 0 ? x : null; };

export function ProductCard({ f, data, cats, dfile, my, example, onChange, onRemove, onAdd }: {
  f: FundX; data: FundsFile; cats: Record<string, CatX> | undefined; dfile: DefaultFile | null | undefined;
  my?: MyProduct; example?: boolean; onChange?: (patch: Partial<MyProduct>) => void; onRemove?: () => void; onAdd?: () => void;
}) {
  const asof = data.asof;
  const dec = useOptional<DecisionFile>(DECISION_PATH);  // W2: the service-index line
  const v = useMemo(() => verdictOf(f, data.funds as FundX[], asof, dfile, my, dec), [f, data, asof, dfile, my, dec]);
  const figs = figsOf(f, v, asof, data, dec);
  const [age, setAge] = useStored<number>('my:age', AGE_DEFAULT);
  const cat = `${f.prod} | ${f.track}`, c = cats?.[cat], r10 = cat10(c);
  // the return assumption: a conservative 4% by default (the fees tool's fallback), the category's 10-year average on request, or the reader's own
  const [retQ, setRetQ] = useState<number | null>(null);
  const [coef, setCoef] = useState(COEF_DEFAULT);
  const ret = retQ ?? RET_FALLBACK;
  const ex = exampleMonthly(f.prod);
  const balance = my?.balance ?? BALANCE_EX, monthly = my?.monthly ?? ex.v;
  const plan: Plan = { age: Math.min(Math.max(age || AGE_DEFAULT, 16), RETIRE_AGE - 1), retire: RETIRE_AGE, balance, monthly, growth: GROWTH_DEFAULT, ret, infl: INFL_DEFAULT, coef };
  const mine: FeePair = { fee: v.fee.v ?? 0, depfee: v.dep?.v ?? f.depfee ?? 0 };
  const ownAny = v.fee.own || !!v.dep?.own;
  const med = refPair(mine, v.fee.med, v.dep?.med ?? null);
  const gMed = med ? feeGap(plan, mine, med) : null;
  // the default funds: the allowed pair (the price, or a row of the conversion table) that leaves the most money in these assumptions
  const tPairs: FeePair[] = v.dflt && v.dflt.fee != null && v.dflt.depfee != null ? [{ fee: v.dflt.fee, depfee: v.dflt.depfee }, ...(v.dflt.tender.fee_alt ?? [])] : [];
  const tBest = tPairs.length ? tPairs.map((p) => ({ p, g: feeGap(plan, mine, p) })).sort((a, b) => b.g.balReal - a.g.balReal)[0] : null;
  const out = project(plan, mine);

  /* ---- sources of the estimates ---- */
  const onCat = r10 != null && retQ != null && Math.abs(retQ - +r10.toFixed(2)) < 1e-9;
  const retSrc = onCat && c ? () => cat10Prov(cat, c, r10!) : undefined;
  const retWhy = retQ == null ? 'הנחה שמרנית' : onCat ? 'ממוצע הקטגוריה ב-10 השנים האחרונות: תשואת עבר, לא תחזית' : 'ההנחה שלך';
  const assumptions = () => [
    { label: 'גיל היום (שלך)', v: String(plan.age) }, { label: 'גיל פרישה (הנחה)', v: String(RETIRE_AGE) },
    { label: my?.balance != null ? 'יתרה היום (שלך)' : 'יתרה היום (הנחה לדוגמה)', v: ilsRound(balance) },
    { label: my?.monthly != null ? 'הפקדה חודשית (שלך)' : `הפקדה חודשית (הנחה: ${ex.why})`, v: ilsRound(monthly) },
    { label: 'עליית ההפקדה בשנה (הנחה)', v: pcf(GROWTH_DEFAULT) },
    { label: `תשואה שנתית ברוטו (${retWhy})`, v: pcr(ret), src: retSrc },
    { label: 'אינפלציה בשנה (הנחה, יעד בנק ישראל 1%–3%)', v: pcf(INFL_DEFAULT) },
  ];
  const F = 'כל חודש: ההפקדה פחות דמי הניהול מהפקדה נכנסת ליתרה; היתרה גדלה ב-(1 + תשואה שנתית)^(1/12) − 1; דמי הניהול מצבירה (שנתי ÷ 12) יורדים מהיתרה. ההפקדה עולה כל 12 חודשים. בשקלי היום: חלקי (1 + אינפלציה) בחזקת השנים. השיטה של מחשבון דמי הניהול (/funds/tools/fees)';
  const pairIn = (p: FeePair, who: string) => [{ label: `${who}: דמי ניהול מצבירה`, v: pcf(p.fee) }, { label: `${who}: דמי ניהול מהפקדה`, v: pcf(p.depfee) }];
  const gapProv = (ref: FeePair, who: string, g: ReturnType<typeof feeGap>, src?: () => Prov): Prov => ({ k: 'calc', est: true, title: `הפער בחיסכון בגיל ${RETIRE_AGE}, בשקלי היום · ${who}`, value: ilsRound(g.balReal),
    formula: `${F}. הפער = החיסכון עם דמי הניהול של ${who} פחות החיסכון עם דמי הניהול ${ownAny ? 'שלך' : 'הממוצעים במסלול'}`,
    note: 'אומדן על הנחות, לא תחזית. לא כולל מס, ובפנסיה לא כולל את עלות הכיסוי הביטוחי', inputs: [...assumptions(), ...pairIn(mine, ownAny ? 'שלך' : 'ממוצע המסלול'), ...pairIn(ref, who).map((x) => ({ ...x, src })), { label: 'חודשים עד הפרישה', v: String(g.mine.months) }] });
  const penProv = (what: 'bal' | 'pen'): Prov => ({ k: 'calc', est: true, title: what === 'bal' ? `חיסכון בגיל ${RETIRE_AGE}, בשקלי היום · אומדן` : 'קצבה חודשית, בשקלי היום · אומדן', value: ilsRound(what === 'bal' ? out.balReal : out.pensionReal),
    formula: `${F}.${what === 'pen' ? ' קצבה = החיסכון ÷ מקדם ההמרה.' : ''}`, note: 'אומדן גס על הנחות. לא מנכה את עלות הכיסוי הביטוחי (נכות ושארים) שהקרן גובה מההפקדות, ולכן נוטה להיות גבוה. המקדם בפועל נקבע בתקנון הקרן',
    inputs: [...assumptions(), ...pairIn(mine, ownAny ? 'שלך' : 'ממוצע המסלול'), ...(what === 'pen' ? [{ label: 'מקדם המרה (הנחה)', v: String(coef) }] : [])] });
  const medSrc = () => figs.feeMed();
  const tSrc = (p: FeePair) => () => tenderProv(v.dflt!.tender, 'צירוף דמי ניהול שההליך מתיר', `${pcf(p.depfee)} / ${pcf(p.fee)} (מהפקדה / מצבירה)`);

  const script = scriptOf({ name: f.name, id: f.id, prod: f.prod, track: f.track, src: `${dsName(f.fam)}, ${ymOf(asof)}`, v });
  const peersLink = useMemo(() => {
    const rk = [...(v.ret?.ranked ?? [])].filter((x) => x.k !== f.k);
    const top = rk[0], cheap = [...v.peers].filter((x) => x.k !== f.k && x.fee != null).sort((a, b) => a.fee! - b.fee!)[0];
    const ks = [f.k, top?.k, cheap?.k].filter((k, i, a): k is string => !!k && a.indexOf(k) === i).slice(0, 4);
    return ks.length > 1 ? `/funds/compare?k=${ks.join(',')}` : null;
  }, [v, f.k]);

  const showCost = (gMed && gMed.balReal > 0) || (tBest && tBest.g.balReal > 0);

  return (
    <article className={`panel sv-card${example ? ' sv-example' : ''}`} id={example ? undefined : f.k} aria-label={example ? `דוגמה: ${f.name}` : f.name}>
      {example && <div className="sv-ribbon">דוגמה · לא המוצר שלך</div>}
      <header className="sv-card-h">
        <div className="sv-card-t">
          <h2><Link to={`/funds/${f.k}`}>{f.name}</Link></h2>
          <p className="sv-card-s">{f.prod} · מסלול {f.track} · <span className="sv-nw">מספר קופה {f.id}</span></p>
        </div>
        {onRemove && <button type="button" className="sv-x" onClick={onRemove} aria-label={`הסרה: ${f.name}`}>הסרה</button>}
      </header>

      <Report v={v} figs={figs} />

      {!example && onChange && <Mine my={my} f={f} onChange={onChange} />}

      <Sec title="כמה זה עולה בשקלים" tag="אומדן">
        {showCost ? <>
          {gMed && gMed.balReal > 0 && <p className="sv-big">לעומת דמי הניהול החציוניים בקטגוריה (<Est src={medSrc}>{pcf(med!.fee)}</Est> מצבירה{v.dep?.med != null ? <>, <Est src={() => figs.depMed()}>{pcf(med!.depfee)}</Est> מהפקדה</> : null}), דמי הניהול {ownAny ? 'שלך' : 'הממוצעים במסלול'} משאירים <span className="sv-nw">כ-<Est src={() => gapProv(med!, 'החציון בקטגוריה', gMed, medSrc)}>{ilsRound(gMed.balReal)}</Est></span> פחות בגיל {RETIRE_AGE}, בשקלי היום.</p>}
          {tBest && tBest.g.balReal > 0 && <p className={gMed && gMed.balReal > 0 ? '' : 'sv-big'}>לעומת התנאים בקרנות ברירת המחדל: <span className="sv-nw">כ-<Est src={() => gapProv(tBest.p, 'תנאי ברירת המחדל', tBest.g, tSrc(tBest.p))}>{ilsRound(tBest.g.balReal)}</Est></span> פחות. זה הצירוף שההליך מתיר שמשאיר הכי הרבה בהנחות האלה: <Est src={tSrc(tBest.p)}>{`${pcf(tBest.p.depfee)} מהפקדה`}</Est> ו-<Est src={tSrc(tBest.p)}>{`${pcf(tBest.p.fee)} מצבירה`}</Est>. התנאים חלים על מי שמצטרף דרך ברירת המחדל{v.dflt!.years ? `, ל-${v.dflt!.years} שנים` : ''}.</p>}
        </> : <p>דמי הניהול {ownAny ? 'שלך' : 'הממוצעים במסלול'} אינם גבוהים מהחציון בקטגוריה{tPairs.length ? ' ומתנאי ברירת המחדל' : ''}, ולכן אין כאן פער לחשב.{med && gMed && gMed.balReal < 0 && <> בהנחות האלה הם משאירים <span className="sv-nw">כ-<Est src={() => gapProv(med, 'החציון בקטגוריה', gMed, medSrc)}>{ilsRound(-gMed.balReal)}</Est></span> יותר מהחציון.</>}</p>}
        {!ownAny && <p className="sv-note">החישוב לפי דמי הניהול <b>הממוצעים</b> במסלול. מה שאתם משלמים בפועל כתוב בדוח השנתי; {example ? 'אחרי הוספת המוצר שלכם אפשר להזין אותו.' : 'אפשר להזין אותו למעלה.'}</p>}
        <Assume plan={plan} my={my} ex={ex.why} retSrc={retSrc} retWhy={retWhy} r10={r10} retQ={retQ} setRetQ={setRetQ} age={age} setAge={setAge} />
      </Sec>

      <Sec title="מה לבקש מהסוכן או מהחברה" tag="להעתקה">
        <Script text={script} />
      </Sec>

      {isPension(f.prod) && <Sec title="כמה פנסיה זה יכול להיות" tag="אומדן גס">
        <p className="sv-big">בגיל {RETIRE_AGE}: <span className="sv-nw">כ-<Est src={() => penProv('bal')}>{ilsRound(out.balReal)}</Est></span> בחיסכון, וקצבה של <span className="sv-nw">כ-<Est src={() => penProv('pen')}>{ilsRound(out.pensionReal)}</Est></span> לחודש. בשקלי היום, לפני מס.</p>
        <p className="sv-note">רק מהמוצר הזה, על אותן הנחות (תשואה {pcf(ret)} ברוטו בשנה). האומדן לא מנכה את עלות הכיסוי הביטוחי (נכות ושארים) שהקרן גובה מההפקדות, ולכן הוא נוטה להיות גבוה.</p>
        <NumIn label="מקדם המרה (הנחה)" value={coef} min={100} max={400} step={5} onCommit={setCoef} />
        <p className="sv-note">הקצבה = החיסכון ÷ המקדם. המקדם נקבע בתקנון הקרן לפי גיל, מין ומסלול הקצבה. לפי <a href={COEF_SRC} target="_blank" rel="noreferrer">ביזפורטל (22.07.26)</a>, בגיל 67 הוא כ-180 לגבר בלי שארים, כ-188 עם פנסיית שארים, וכ-204 לאישה עם הבטחת תשלומים ושארים. 200 הוא הנחה עגולה.</p>
      </Sec>}

      {f.prod === 'השתלמות' && <Sec title="מה כדאי לדעת על השתלמות" tag="עובדות">
        <ul className="sv-facts">
          <li>הכסף נזיל אחרי 6 שנים מתחילת ההפקדות, בכל גיל ולכל מטרה. אחרי 3 שנים: למימון לימודים או השתלמות, או למי שהגיע לגיל פרישה. <a href={KOLZCHUT_HISHTALMUT} target="_blank" rel="noreferrer">כל זכות</a></li>
          <li>מסלולים שעוקבים אחרי אותו מדד מחזיקים בעיקר את אותם נכסים, ולכן ההבדל ביניהם הוא בעיקר בעלות: דמי הניהול ועלות המעקב. <Link to="/funds/trackers">השוואת המסלולים העוקבים</Link></li>
        </ul>
      </Sec>}

      <footer className="sv-links">
        <Link className="sv-go" to={`/funds/${f.k}`}>כרטיס המסלול</Link>
        {peersLink && <Link className="sv-go" to={peersLink}>השוואה למסלולים בקטגוריה</Link>}
        <span className="sv-follow"><WatchStar f={f} asof={asof} /> <Link to="/funds/watch">רשימת המעקב</Link></span>
        {example && onAdd && <button type="button" className="btn" onClick={onAdd}>זה המסלול שלי</button>}
      </footer>
    </article>
  );
}

function Sec({ title, tag, children }: { title: string; tag?: string; children: ReactNode }) {
  return <section className="sv-sec"><h3>{title}{tag && <span className="sv-tag">{tag}</span>}</h3>{children}</section>;
}

/** the reader's own numbers, from the annual statement; optional, kept in this browser */
function Mine({ my, f, onChange }: { my?: MyProduct; f: FundX; onChange: (p: Partial<MyProduct>) => void }) {
  const has = [my?.balance, my?.monthly, my?.fee, my?.depfee].filter((x) => x != null).length;
  const [open, setOpen] = useState(has === 0);
  const field = (k: 'balance' | 'monthly' | 'fee' | 'depfee', label: ReactNode, ph: string, step: number) => (
    <label><span>{label}</span><input type="number" inputMode="decimal" min={0} step={step} placeholder={ph} defaultValue={my?.[k] ?? ''} onChange={(e) => { const x = num(e.target.value); if (x != null || e.target.value === '') onChange({ [k]: x }); }} /></label>
  );
  return (
    <details className="sv-mine" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{has ? `הנתונים שלך מהדוח (${has} מתוך 4)` : 'הוספת הנתונים שלך מהדוח השנתי (לא חובה)'}</summary>
      <div className="sv-form">
        {field('balance', 'יתרה היום, ש"ח', 'למשל 150000', 1000)}
        {field('monthly', 'הפקדה חודשית, ש"ח', 'למשל 2200', 100)}
        {field('fee', <>דמי ניהול מצבירה, % <Tip k="fee" /></>, `ממוצע במסלול: ${pcf(f.fee)}`, 0.01)}
        {field('depfee', <>דמי ניהול מהפקדה, % <Tip k="depfee" /></>, f.depfee != null ? `ממוצע במסלול: ${pcf(f.depfee)}` : 'אם יש', 0.05)}
      </div>
      <p className="sv-note">נשמר רק בדפדפן הזה. שום נתון לא נשלח.</p>
    </details>
  );
}

/** a number input that keeps what is typed and commits a valid value (an empty box does not snap back while typing) */
function NumIn({ label, value, min, max, step, onCommit, small }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void; small?: boolean }) {
  const [raw, setRaw] = useState(String(value));
  const [was, setWas] = useState(value);
  if (was !== value) { setWas(value); setRaw(String(value)); }
  const go = (t: string) => { setRaw(t); const x = Number(t); if (t !== '' && Number.isFinite(x) && x >= min && x <= max) onCommit(x); };
  return <label className={small ? 'sv-num-in sm' : 'sv-num-in'}><span>{label}</span><input type="number" inputMode="decimal" min={min} max={max} step={step} value={raw} onChange={(e) => go(e.target.value)} onBlur={() => setRaw(String(value))} /></label>;
}

function Assume({ plan, my, ex, retSrc, retWhy, r10, retQ, setRetQ, age, setAge }: { plan: Plan; my?: MyProduct; ex: string; retSrc?: () => Prov; retWhy: string; r10: number | null; retQ: number | null; setRetQ: (v: number | null) => void; age: number; setAge: (v: number) => void }) {
  const r10v = r10 != null ? +r10.toFixed(2) : null;
  return (
    <div className="sv-assume">
      <div className="sv-assume-h">ההנחות <span className="sv-muted">· אפשר לשנות</span></div>
      <dl>
        <div><dt>גיל היום</dt><dd><NumIn label="הגיל שלך" small value={age} min={16} max={66} step={1} onCommit={setAge} /> <span>פרישה ב-{RETIRE_AGE}</span></dd></div>
        <div><dt>יתרה היום</dt><dd>{ilsRound(plan.balance)}{my?.balance == null && <span className="sv-a">לדוגמה</span>}</dd></div>
        <div><dt>הפקדה לחודש</dt><dd>{ilsRound(plan.monthly)}{my?.monthly == null && <span className="sv-a">לדוגמה: {ex}</span>}</dd></div>
        <div><dt>עליית ההפקדה</dt><dd>{pcf(GROWTH_DEFAULT)} בשנה<span className="sv-a">הנחה</span></dd></div>
        <div><dt>תשואה ברוטו</dt><dd>{retSrc ? <Sourced src={retSrc}><b className="num">{pcf(plan.ret)}</b></Sourced> : <b className="num">{pcf(plan.ret)}</b>} בשנה<span className="sv-a">{retWhy}</span>
          <span className="sv-rets" role="group" aria-label="הנחת התשואה">
            <button type="button" className="sv-chip sm" aria-pressed={retQ == null} onClick={() => setRetQ(null)}>שמרני {pcf(RET_FALLBACK)}</button>
            {r10v != null && <button type="button" className="sv-chip sm" aria-pressed={retQ != null && Math.abs(retQ - r10v) < 1e-9} onClick={() => setRetQ(r10v)}>ממוצע 10 שנים {pcr(r10v)}</button>}
            <NumIn label="אחר, %" small value={plan.ret} min={-5} max={20} step={0.25} onCommit={setRetQ} />
          </span></dd></div>
        <div><dt>אינפלציה</dt><dd>{pcf(INFL_DEFAULT)} בשנה<span className="sv-a">הנחה, יעד בנק ישראל 1%–3%</span></dd></div>
      </dl>
    </div>
  );
}

/** the note, with a copy button and a fallback for browsers that block the clipboard (select the text, execCommand, else ask to copy by hand) */
function Script({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<'idle' | 'ok' | 'manual'>('idle');
  const fallback = () => {
    const el = ref.current, sel = window.getSelection();
    if (!el || !sel) return setSt('manual');
    const r = document.createRange(); r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    setSt(ok ? 'ok' : 'manual');
  };
  return (
    <div className="sv-script">
      <div ref={ref} className="sv-script-t" role="textbox" aria-readonly="true" aria-multiline="true" aria-label="הודעה לסוכן או לחברה המנהלת" tabIndex={0}>{text}</div>
      <div className="sv-script-a">
        <button type="button" className="btn primary" onClick={() => copyText(text, (ok) => (ok ? setSt('ok') : fallback()))}>{st === 'ok' ? 'הועתק ✓' : 'העתקת ההודעה'}</button>
        <span className="sv-muted" role="status">{st === 'manual' ? 'הדפדפן חסם העתקה: הטקסט מסומן, אפשר להעתיק ידנית.' : 'עובדות ומספרים בלבד, בלי המלצה. כדאי לבדוק מול הדוח לפני השליחה.'}</span>
      </div>
    </div>
  );
}

export type { Verdict };
