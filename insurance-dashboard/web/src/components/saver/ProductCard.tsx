import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { Tip } from '../Explain';
import { copyText } from '../ui';
import { track } from '../../lib/track';
import { WatchStar } from '../FundsTime';
import { useActiveProfile, useMyAge, useMySalary, useMySex, useRetire, type MyProduct } from '../../lib/mine';
import { thirdPerson } from '../../lib/household';  // W7
import type { Prov } from '../../lib/prov';
import { refOf, type CatX, type FundX, type FundsFile } from '../../lib/funds';
import type { DefaultFile } from '../../lib/fundsTools';
import { brief, isPension, pcf, pcr, singleIndex, type Verdict } from '../../lib/verdict';
import { AGE_DEFAULT, GROWTH_DEFAULT, INFL_DEFAULT, KZ_RETIRE, RETIRE_AGE, RET_FALLBACK, ageText, ilsRound, type FeeGap, type Plan } from '../../lib/retire';
import { COEF_PATH, birthYearOf, coefFor, coverageOf, trackAgeNote, type CoefFile } from '../../lib/coef';  // W6
import { cardCalc } from '../../lib/myCalc';
import { dormantOf, isoDay, mergeLetter } from '../../lib/checkup';  // red team 06.11.26: a dormant account → consolidation
import { capOf, feeError, KZ_CAPS } from '../../lib/feeCaps';
import { RULE } from '../../lib/productRules';
import { dsName, scriptOf } from '../../lib/script';
import type { FeePair } from '../../lib/fundsCalc';
import { Est, Parts, cat10, cat10Prov, figsOf, tenderProv, ymOf } from './figs';
import { Report } from './Report';
import { useOptional } from '../../lib/fundsLoad';
import { DECISION_PATH, type DecisionFile } from '../../lib/decision';  // W2
import { Script } from './Script';
import { DepLine, Deposits, useDepAudit } from './Deposits';  // W7
import { FriendSays } from './FriendSays';  // W7
import type { MCover } from '../../lib/maslaka';
import { FlowLine } from '../flows/FlowLine';  // W8 flows: the one flow line, only when it fires
import { NewsForFund } from '../NewsForFund';  // W8 feeds: one line per event that concerns this fund, 90 days
import { UnderLine } from './UnderLine';  // W11 under: the gap to the category median, only bottom-quartile and ≥25bp

/* One product of "המוצרים שלי" (W4, red team 02.11.26). Folded: the verdict in at most three lines, what the fees cost this year and
   by the horizon in ₪, the reader's own numbers, and the note to the agent. "עוד פרטים" opens the rest: every line of the report card,
   the ₪ figures with their assumptions, the note's text, the pension estimate (pension only), the השתלמות facts, and the next pages.
   Everything that is not the reader's or the regulator's is labelled. The numbers come from lib/myCalc, as the strip at the top does.
   W6: the pension estimate divides by the fund's own conversion coefficient from its bylaws (lib/coef) when the file has one, labelled
   "לפי מקדם מהתקנון, עמ' X", else by the site's assumption, labelled "לפי הנחה"; an age-track mismatch (a reader of 60 in "עד 50") is one
   line under the title.
   W7 (wave 2): the deposit watchdog (components/saver/Deposits) and "חבר אמר לעבור ל…" (components/saver/FriendSays) open from the card;
   a pension card with imported covers shows one plain coverage line; the note to the agent says "החוסך/ת" for a household profile
   other than "אני". */

export const KOLZCHUT_HISHTALMUT = 'https://www.kolzchut.org.il/he/%D7%A7%D7%A8%D7%9F_%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA';
export const COEF_SRC = 'https://www.bizportal.co.il/longtermsavings/news/article/20036400';
const num = (s: string): number | null => { const t = s.replace(/[,\s₪%]/g, ''); if (t === '') return null; const x = Number(t); return Number.isFinite(x) ? x : null; };

export function ProductCard({ f, data, cats, dfile, my, example, onChange, onRemove, onAdd, focus }: {
  f: FundX; data: FundsFile; cats: Record<string, CatX> | undefined; dfile: DefaultFile | null | undefined;
  my?: MyProduct; example?: boolean; onChange?: (patch: Partial<MyProduct>) => void; onRemove?: () => void; onAdd?: () => void;
  /** W7: open the card on its deposit watchdog (a link from /my/statement) */
  focus?: 'deposits';
}) {
  const asof = data.asof;
  const dec = useOptional<DecisionFile>(DECISION_PATH);  // W2: the service-index line
  const coefF = useOptional<CoefFile>(COEF_PATH);  // W6: the funds' conversion coefficients
  const [ageS] = useMyAge(), [sex] = useMySex();
  const age = ageS ?? AGE_DEFAULT;
  const R = useRetire();
  /** a word by the reader's sex: she, he, or the plural when not given */
  const g = (fm: string, m: string, n: string) => (sex === 'f' ? fm : sex === 'm' ? m : n);
  const cat = `${f.prod} | ${f.track}`, c = cats?.[cat];
  const r10 = singleIndex(f) ? null : cat10(c);
  // the return: a conservative 4% by default; the category's 10-year past on request (not for single-index tracks); or the reader's own
  const [retQ, setRetQ] = useState<number | null>(null);
  // W6: the fund's own coefficient for this reader (sex, retirement age, birth year), else the assumption; the reader may type their own
  const pick = useMemo(() => coefFor(coefF, f.grp, sex, R.v, birthYearOf(age)), [coefF, f.grp, sex, R.v, age]);
  const cf = { v: pick.v, why: pick.real ? pick.label : 'הנחה' };
  const [coefQ, setCoefQ] = useState<number | null>(null);
  const coef = coefQ ?? cf.v;
  const ageNote = isPension(f.prod) ? trackAgeNote(f.track, ageS) : null;
  const cov = isPension(f.prod) ? coverageOf(coefF, f.grp, f.prod) : null;
  const ret = retQ ?? RET_FALLBACK;
  const C = useMemo(() => cardCalc(f, data.funds as FundX[], asof, dfile, my, dec, { age, coef, ret, retire: R.v }), [f, data, asof, dfile, my, dec, age, coef, ret, R.v]);
  const { v, plan, mine, ownAny, med, gMed, tBase, out, annual, liq } = C;
  const dorm = my && !example ? dormantOf(my, isoDay(new Date()).slice(0, 7)) : { dormant: false, last: null };
  const monLabel = my?.monthly != null ? 'הפקדה חודשית (שלך)' : C.noDep ? 'הפקדה חודשית (אין הפקדה שוטפת בקובץ)' : `הפקדה חודשית (הנחה: ${C.exWhy})`;
  const figs = figsOf(f, v, asof, data, dec);
  const [open, setOpen] = useState(!!focus);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'manual'>('idle');
  // W7: the household profile (the note names anyone but "אני" as "החוסך/ת"), the profile's salary for the watchdog, the deposit audit
  const third = thirdPerson(useActiveProfile());
  const [profSalary] = useMySalary();
  const dep = useDepAudit(f, my, profSalary);
  const moreId = useId();

  /* ---- sources of the estimates ---- */
  const onCat = r10 != null && retQ != null && Math.abs(retQ - +r10.toFixed(2)) < 1e-9;
  const retSrc = onCat && c ? () => cat10Prov(cat, c, r10!) : undefined;
  const retWhy = retQ == null ? 'הנחה שמרנית' : onCat ? 'תשואת עבר של הקטגוריה ב-10 שנים, לא תחזית' : 'ההנחה שלך';
  const who = ownAny ? 'שלך' : 'ממוצע המסלול';
  const assumptions = (p: Plan = plan) => [
    { label: ageS != null ? 'גיל היום (שלך)' : 'גיל היום (לדוגמה)', v: String(p.age) }, { label: p === plan ? `גיל פרישה (${R.own ? 'שלך' : R.why})` : 'אופק (שנים מהיום)', v: p === plan ? ageText(p.retire) : String(p.retire - p.age) },
    { label: my?.balance != null ? 'יתרה היום (שלך)' : 'יתרה היום (הנחה לדוגמה)', v: ilsRound(p.balance) },
    { label: monLabel, v: ilsRound(p.monthly) },
    { label: 'עליית ההפקדה בשנה (הנחה)', v: pcf(GROWTH_DEFAULT) },
    { label: `תשואה שנתית ברוטו (${retWhy})`, v: pcr(ret), src: retSrc },
    { label: 'אינפלציה בשנה (הנחה, יעד בנק ישראל 1%–3%)', v: pcf(INFL_DEFAULT) },
  ];
  const F = 'כל חודש: ההפקדה פחות דמי הניהול מהפקדה נכנסת ליתרה; היתרה גדלה ב-(1 + תשואה שנתית)^(1/12) − 1; דמי הניהול מצבירה (שנתי ÷ 12) יורדים מהיתרה. ההפקדה עולה כל 12 חודשים. בשקלי היום: חלקי (1 + אינפלציה) בחזקת השנים. השיטה של מחשבון דמי הניהול (/funds/tools/fees)';
  const pairIn = (p: FeePair, w: string) => [{ label: `${w}: דמי ניהול מצבירה`, v: pcf(p.fee) }, { label: `${w}: דמי ניהול מהפקדה`, v: pcf(p.depfee) }];
  const gapProv = (ref: FeePair, w: string, g: FeeGap, src?: () => Prov, p: Plan = plan): Prov => ({ k: 'calc', est: true, title: `כמה פחות בחיסכון ${p === plan ? `בגיל הפרישה (${ageText(p.retire)})` : `בעוד ${p.retire - p.age} שנים`}, בשקלי היום · מול ${w}`, value: ilsRound(Math.abs(g.balReal)),
    formula: `${F}. הפער = החיסכון עם דמי הניהול של ${w} פחות החיסכון עם דמי הניהול ${ownAny ? 'שלך' : 'הממוצעים במסלול'}${g.balReal < 0 ? ' (שלילי: דמי הניהול שלך משאירים יותר)' : ''}`,
    note: `אומדן על הנחות, לא תחזית. לא כולל מס, ובפנסיה לא כולל את עלות הכיסוי הביטוחי${C.med0 && ref === med ? '. בקטגוריה לא מתפרסמים דמי ניהול מהפקדה: ההשוואה מניחה 0% מהפקדה (הנחה)' : ''}`,
    inputs: [...assumptions(p), ...pairIn(mine, who), ...pairIn(ref, w).map((x) => ({ ...x, src })), { label: 'חודשים', v: String(g.mine.months) }] });
  const annualProv = (): Prov => ({ k: 'calc', est: true, title: `דמי הניהול בשנה, בשקלים · ${f.name}`, value: ilsRound(annual.total),
    formula: 'היתרה × דמי הניהול מצבירה, ועוד 12 הפקדות חודשיות × דמי הניהול מהפקדה. אומדן לשנה הקרובה, לפני תשואה',
    note: ownAny ? undefined : 'לפי דמי הניהול הממוצעים במסלול; מה שאתם משלמים בפועל כתוב בדוח השנתי',
    inputs: [{ label: my?.balance != null ? 'יתרה (שלך)' : 'יתרה (לדוגמה)', v: ilsRound(plan.balance) }, { label: monLabel, v: ilsRound(plan.monthly) },
      ...pairIn(mine, who), { label: 'מצבירה בשנה', v: ilsRound(annual.acc) }, { label: 'מהפקדה בשנה', v: ilsRound(annual.dep) }] });
  const penProv = (what: 'bal' | 'pen'): Prov => ({ k: 'calc', est: true, title: what === 'bal' ? `חיסכון בגיל ${ageText(plan.retire)}, בשקלי היום · אומדן` : 'קצבה חודשית, בשקלי היום · אומדן', value: ilsRound(what === 'bal' ? out.balReal : out.pensionReal),
    formula: `${F}.${what === 'pen' ? ' קצבה = החיסכון ÷ מקדם ההמרה.' : ''}`, note: 'אומדן גס על הנחות. לא מנכה את עלות הכיסוי הביטוחי (נכות ושארים) שהקרן גובה מההפקדות, ולכן נוטה להיות גבוה. המקדם בפועל נקבע בתקנון הקרן',
    inputs: [...assumptions(), ...pairIn(mine, who), ...(what === 'pen' ? [{ label: coefQ != null ? 'מקדם המרה (שלך)' : pick.real ? `מקדם המרה (${pick.label})` : 'מקדם המרה (הנחה)', v: String(coef), src: coefQ != null ? undefined : pick.prov }] : [])] });
  const medSrc = () => figs.feeMed();
  const tSrc = (p: FeePair) => () => tenderProv(v.dflt!.tender, 'צירוף דמי ניהול שההליך מתיר', `${pcf(p.depfee)} / ${pcf(p.fee)} (מהפקדה / מצבירה)`);

  const script = dorm.dormant ? mergeLetter({ name: f.name, id: f.id, last: dorm.last }, null) : scriptOf({ name: f.name, id: f.id, prod: f.prod, track: f.track, src: `${dsName(f.fam)}, ${ymOf(asof)}`, v, sex, third });
  const peersLink = useMemo(() => {
    const rk = [...(v.ret?.ranked ?? [])].filter((x) => x.k !== f.k);
    const top = rk[0], cheap = [...v.peers].filter((x) => x.k !== f.k && x.fee != null).sort((a, b) => a.fee! - b.fee!)[0];
    const ks = [f.k, top?.k, cheap?.k].filter((k, i, a): k is string => !!k && a.indexOf(k) === i).slice(0, 4);
    return ks.length > 1 ? `/funds/compare?k=${ks.join(',')}` : null;
  }, [v, f.k]);

  /** one sentence on a gap, its sign read the right way round: money the reader will HAVE less (or more) of, never "no gap" next to a
   *  figure (W5, red team 3: "~2,050 ₪ פחות בגיל 67" read as money paid). `vs`: what it is against; `when`: the horizon in words */
  const gapLine = (gp: FeeGap | null, vs: string, when: string, src: () => Prov) => {
    if (!gp) return null;
    if (Math.abs(gp.balReal) < 500) return <>{vs}: דמי הניהול {ownAny ? 'שלך' : 'במסלול'} כמעט לא משנים את החיסכון {when} (פחות מ-500 ש"ח).</>;
    return <>{vs}: יהיו לך <span className="sv-nw">כ-<Est src={src}>{ilsRound(Math.abs(gp.balReal))}</Est></span> {gp.balReal > 0 ? 'פחות' : 'יותר'} בחיסכון {when}.</>;
  };
  const medLine = (gp: FeeGap | null, when: string, src: () => Prov) => (med ? gapLine(gp, ownAny ? 'לעומת חציון הממוצע בפועל בקטגוריה' : 'לעומת החציון בקטגוריה', when, src) : null);
  const atRet = `בגיל הפרישה (${ageText(plan.retire)})`;
  const liqPlan = liq ? { ...plan, retire: plan.age + liq.years } : plan;
  // W5: the reader's own pension fees are read against the default-fund price (what a member can get), not the others' averages
  const vsT = isPension(f.prod) && (v.fee.basis === 'tender' || v.dep?.basis === 'tender');
  // red team 06.11.26: one anchor per product, the tender's base price (the pair the letter asks for and the check-up reads)
  const tLine = tBase && v.dflt ? gapLine(tBase.g, 'לעומת מחיר קרנות ברירת המחדל', atRet, () => gapProv(tBase.p, 'מחיר ברירת המחדל', tBase.g, tSrc(tBase.p))) : null;
  const fold = liq
    ? medLine(liq.gMed, `בעוד ${liq.years} שנים, כשהכסף נזיל`, () => gapProv(med!, 'החציון בקטגוריה', liq.gMed!, medSrc, liqPlan))
    : vsT ? null : medLine(gMed, atRet, () => gapProv(med!, 'החציון בקטגוריה', gMed!, medSrc));
  const paid = tBase && tBase.g.feesReal > 500 ? <> {g('תשלמי', 'תשלם', 'תשלמו')} <span className="sv-nw">כ-<Est src={() => gapProv(tBase.p, 'מחיר ברירת המחדל', tBase.g, tSrc(tBase.p))}>{ilsRound(tBase.g.feesReal)}</Est></span> יותר בדמי ניהול עד הפרישה.</> : null;

  const copy = () => copyText(script, (ok) => { if (ok) { setCopied('ok'); track('letter_copied'); } else { setCopied('manual'); setOpen(true); } });
  const B = brief(v, C.lever);

  return (
    <article className={`panel sv-card${example ? ' sv-example' : ''}`} id={example ? undefined : f.k} aria-label={example ? `דוגמה: ${f.name}` : f.name}>
      {example && <div className="sv-ribbon">דוגמה · לא המוצר שלך</div>}
      <header className="sv-card-h">
        <div className="sv-card-t">
          <h2><Link to={`/funds/${f.k}`}>{f.name}</Link></h2>
          <p className="sv-card-s">{f.prod} · <span className="sv-nw">קופה {f.id}</span></p>
          {ageNote && <p className="sv-card-s sv-agenote">{ageNote.text}{pick.src && <> <a className="sv-u" href={pick.src.url} target="_blank" rel="noreferrer">תקנון הקרן</a></>} <Link className="sv-u" to="/my/moment/sixty">מתקרבים ל-60</Link></p>}
        </div>
        {onRemove && <button type="button" className="sv-x" onClick={onRemove} aria-label={`הסרה: ${f.name}`}>הסרה</button>}
      </header>

      <ul className="sv-lines sv-brief">
        {/* red team 06.11.26 (/my word budget): two lines folded; every line of the report card is under "עוד פרטים" */}
        {B.slice(0, 2).map((l, i) => <li key={`${l.key}${i}`} className={`t-${l.tone}`}><span className="sv-dot" aria-hidden="true" /><span><Parts parts={l.parts} figs={figs} /></span></li>)}
      </ul>

      <div className="sv-money">
        <p className="sv-big">דמי הניהול {ownAny ? 'שלך' : 'במסלול'}: <span className="sv-nw">כ-<Est src={annualProv}>{ilsRound(annual.total)}</Est> בשנה</span>{(C.exBalance || C.exMonthly) && <span className="sv-a">על {C.exBalance && C.exMonthly ? 'יתרה והפקדה' : C.exBalance ? 'יתרה' : 'הפקדה'} לדוגמה</span>}</p>
        {fold && <p>{fold}{liq && gMed && Math.abs(gMed.balReal) >= 500 && <> עד הפרישה: <span className="sv-nw">כ-<Est src={() => gapProv(med!, 'החציון בקטגוריה', gMed, medSrc)}>{ilsRound(Math.abs(gMed.balReal))}</Est></span> {gMed.balReal > 0 ? 'פחות' : 'יותר'} בחיסכון.</>} <span className="sv-a">אומדן, בשקלי היום</span></p>}
        {tLine && <p>{tLine} <span className="sv-a">אומדן, בשקלי היום</span></p>}
        {dorm.dormant && <p className="sv-note">אין הפקדות{dorm.last ? ` מאז ${dorm.last.slice(5, 7)}/${dorm.last.slice(2, 4)}` : ''}: החישוב על היתרה בלבד. בקשה לאיחוד עם הקרן הפעילה בכפתור.</p>}
      </div>

      {!example && <FlowLine f={f} R={refOf(f)} />}
      <NewsForFund k={f.k} grp={f.grp} door="saver" />
      {!example && isPension(f.prod) && my?.covers?.length ? <CoverLine covers={my.covers} insTrack={my.insTrack} salary={my.salary ?? profSalary} /> : null}
      {!example && <DepLine audit={dep.audit} onOpen={() => { setOpen(true); requestAnimationFrame(() => document.getElementById(`${f.k}-deposits`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }} />}
      {!example && onChange && <Mine my={my} f={f} onChange={onChange} />}

      <div className="sv-acts">
        <button type="button" className="btn primary" onClick={copy}>{copied === 'ok' ? 'ההודעה הועתקה ✓' : dorm.dormant ? 'העתקת בקשה לאיחוד' : 'העתקת הודעה לסוכן'}</button>
        <button type="button" className="btn sv-more-b" aria-expanded={open} aria-controls={moreId} onClick={() => setOpen((o) => !o)}>{open ? 'פחות פרטים' : 'עוד פרטים'}</button>
        {example && onAdd && <button type="button" className="btn" onClick={onAdd}>זה המסלול שלי</button>}
      </div>
      {copied === 'manual' && <p className="sv-muted" role="status">הדפדפן חסם העתקה: ההודעה מופיעה למטה, אפשר לסמן ולהעתיק.</p>}

      <div id={moreId} className="sv-more" hidden={!open}>{open && <>
        {!example && <UnderLine f={f} balance={my?.balance} />}
        <Report v={v} figs={figs} />

        <Sec title="כמה זה עולה בשקלים" tag="אומדן">
          <p>בשנה: <Est src={annualProv}>{ilsRound(annual.acc)}</Est> מצבירה (היתרה × {pcf(mine.fee)}){mine.depfee > 0 && <>, ועוד <Est src={annualProv}>{ilsRound(annual.dep)}</Est> מהפקדות (12 הפקדות × {pcf(mine.depfee)})</>}.</p>
          {med && gMed && <p>{liq ? <>{medLine(liq.gMed, `בעוד ${liq.years} שנים`, () => gapProv(med, 'החציון בקטגוריה', liq.gMed!, medSrc, liqPlan))} {medLine(gMed, 'אם הכסף נשאר עד גיל הפרישה', () => gapProv(med, 'החציון בקטגוריה', gMed, medSrc))}</> : medLine(gMed, atRet, () => gapProv(med, 'החציון בקטגוריה', gMed, medSrc))}
            {' '}החציון: <Est src={medSrc}>{pcf(med.fee)}</Est> מצבירה{v.dep?.med != null ? <>, <Est src={() => figs.depMed()}>{pcf(med.depfee)}</Est> מהפקדה</> : null}.</p>}
          {C.med0 && mine.depfee > 0 && <p className="sv-note">בקטגוריה לא מתפרסמים דמי ניהול מהפקדה, ולכן ההשוואה מניחה 0% מהפקדה (הנחה).</p>}
          {tBase && v.dflt && <p>{tBase.g.balReal > 0 ? <>{tLine}{paid}</> : 'לעומת מחיר קרנות ברירת המחדל: דמי הניהול שלך לא יקרים ממנו בהנחות האלה.'}
            {' '}מחיר הבסיס של ההליך הוא <Est src={tSrc({ fee: v.dflt.fee!, depfee: v.dflt.depfee! })}>{pcf(v.dflt.depfee)}</Est> מהפקדה ו-<Est src={tSrc({ fee: v.dflt.fee!, depfee: v.dflt.depfee! })}>{pcf(v.dflt.fee)}</Est> מצבירה{C.tPairs.length > 1 ? ', ואפשר להמיר אותו לצירוף שווה ערך מטבלת ההמרה' : ''}.
            {tBase.g.balReal > 0 && <> החישוב לפי מחיר הבסיס, הצירוף שהבדיקה השנתית והמכתב מבקשים.</>}
            {' '}התנאים חלים על מי שמצטרף דרך ברירת המחדל{v.dflt.years ? `, ל-${v.dflt.years} שנים` : ''}.</p>}
          {!ownAny && <p className="sv-note">החישוב לפי דמי הניהול <b>הממוצעים</b> במסלול. מה שאתם משלמים בפועל כתוב בדוח השנתי; {example ? 'אחרי הוספת המוצר שלכם אפשר להזין אותו.' : 'אפשר להזין אותו למעלה.'}</p>}
          <Assume plan={plan} rWhy={R.own ? 'שלך, מראש העמוד' : R.why} my={my} ex={C.exWhy} ageSet={ageS != null} retSrc={retSrc} retWhy={retWhy} r10={r10} idx={singleIndex(f)} retQ={retQ} setRetQ={setRetQ} />
        </Sec>

        <Sec title={dorm.dormant ? 'איחוד חשבונות: בקשה לקרן הפעילה' : 'ההודעה לסוכן או לחברה'} tag="להעתקה">
          <Script text={script} />
        </Sec>

        {isPension(f.prod) && <Sec title="כמה פנסיה זה יכול להיות" tag="אומדן גס">
          <p className="sv-big">בגיל {ageText(plan.retire)}: <span className="sv-nw">כ-<Est src={() => penProv('bal')}>{ilsRound(out.balReal)}</Est></span> בחיסכון, וקצבה של <span className="sv-nw">כ-<Est src={() => penProv('pen')}>{ilsRound(out.pensionReal)}</Est></span> לחודש. בשקלי היום, לפני מס.</p>
          <p className="sv-note">רק מהמוצר הזה, על אותן הנחות (תשואה {pcf(ret)} ברוטו בשנה). האומדן לא מנכה את עלות הכיסוי הביטוחי (נכות ושארים) שהקרן גובה מההפקדות, ולכן הוא נוטה להיות גבוה.</p>
          <p className="sv-coef">קצבה חודשית, אומדן: <Est src={() => penProv('pen')}>{ilsRound(out.pensionReal)}</Est> · מקדם <Sourced src={coefQ != null ? () => penProv('pen') : pick.prov}><b className="num">{coef}</b></Sourced> <span className={pick.real && coefQ == null ? 'chip pass' : 'chip est'}>{coefQ != null ? 'מקדם שלך' : pick.label}</span></p>
          <NumIn label={`מקדם המרה (${coefQ != null ? 'שלך' : cf.why})`} value={coef} min={100} max={400} step={1} onCommit={setCoefQ} />
          {pick.real
            ? <p className="sv-note">{pick.why}. הקצבה = החיסכון ÷ המקדם. {pick.src?.kind === 'mirror' ? 'הטקסט נקרא מעותק של התקנון באתר צד שלישי; ' : ''}המקדם בפועל נקבע בפרישה לפי התקנון שבתוקף אז ולפי מסלול הקצבה שתבחרו (שיעור לבן/בת הזוג, תקופת הבטחה); הטבלאות מחושבות לדמי ניהול של 0.3%.</p>
            : <p className="sv-note">{cov?.status === 'missing' ? `אין מקדם זמין לקרן זו; מוצג לפי הנחה (${cov.reason}). ` : `${pick.why}. `}הקצבה = החיסכון ÷ המקדם. לפי <a href={COEF_SRC} target="_blank" rel="noreferrer">ביזפורטל (22.07.26)</a>, בגיל 67 הוא כ-188 לגבר עם פנסיית שארים וכ-204 לאישה עם הבטחת תשלומים ושארים. {plan.retire < RETIRE_AGE ? `בפרישה בגיל ${ageText(plan.retire)} המקדם בדרך כלל גבוה יותר, ולכן הקצבה בפועל נמוכה מהאומדן הזה. ` : ''}{sex == null ? '200 הוא הנחה עגולה; בחירת מין למעלה מאפשרת לקרוא את המקדם מהתקנון של הקרן.' : ''}</p>}
        </Sec>}

        {!example && onChange && dep.kind && <Deposits f={f} my={my} onChange={onChange} profileSalary={profSalary} third={third} focus={focus === 'deposits'} />}

        {f.prod === 'השתלמות' && <Sec title="מה כדאי לדעת על השתלמות" tag="עובדות">
          <ul className="sv-facts">
            <li>הכסף נזיל אחרי 6 שנים מתחילת ההפקדות, בכל גיל ולכל מטרה. אחרי 3 שנים: למימון לימודים או השתלמות, או למי שהגיע לגיל פרישה. לכן הפער בשקלים מוצג גם לאופק של 6 שנים. <a href={KOLZCHUT_HISHTALMUT} target="_blank" rel="noreferrer">כל זכות</a></li>
            <li>תקרת ההפקדה הפטורה ({RULE.hishtalmut.year}): {HISH_CEIL} <a href={RULE.hishtalmut.src[1]?.url ?? RULE.hishtalmut.src[0].url} target="_blank" rel="noreferrer">רשות המסים</a></li>
            <li>מתי למשוך, מה המס, ומה עולה המשיכה בשקלים: <Link to="/my/moment/hishtalmut">משיכת השתלמות</Link></li>
            <li>מסלולים שעוקבים אחרי אותו מדד מחזיקים בעיקר את אותם נכסים, ולכן ההבדל ביניהם הוא בעיקר בעלות: דמי הניהול ועלות המעקב. <Link to="/funds/trackers">השוואת המסלולים העוקבים</Link></li>
          </ul>
        </Sec>}

        {!example && <FriendSays f={f} data={data} dfile={dfile} dec={dec} C={C} sex={sex} />}

        <footer className="sv-links">
          <Link className="sv-go" to={`/funds/${f.k}`}>כרטיס המסלול</Link>
          {peersLink && <Link className="sv-go" to={peersLink}>השוואה למסלולים בקטגוריה</Link>}
          <span className="sv-follow"><WatchStar f={f} asof={asof} /> <Link to="/funds/watch">רשימת המעקב</Link></span>
        </footer>
      </>}</div>
    </article>
  );
}

/** the tax-exempt deposit of a השתלמות, from the verified rules table (lib/productRules: the Income Tax Ordinance and the 2026 tables) */
const HISH_CEIL = `${RULE.hishtalmut.ceil}. על הפקדות מעל התקרה, הרווח חייב במס רווחי הון.`;

function Sec({ title, tag, children }: { title: string; tag?: string; children: ReactNode }) {
  return <section className="sv-sec"><h3>{title}{tag && <span className="sv-tag">{tag}</span>}</h3>{children}</section>;
}

/** the reader's own numbers, from the annual statement; optional, kept in this browser. A fee above the legal ceiling is not saved. */
function Mine({ my, f, onChange }: { my?: MyProduct; f: FundX; onChange: (p: Partial<MyProduct>) => void }) {
  const has = [my?.balance, my?.monthly, my?.fee, my?.depfee].filter((x) => x != null).length;
  const [open, setOpen] = useState(has === 0);
  const [err, setErr] = useState<Partial<Record<'balance' | 'monthly' | 'fee' | 'depfee', string>>>({});
  const cap = capOf(f.prod);
  const field = (k: 'balance' | 'monthly' | 'fee' | 'depfee', label: ReactNode, ph: string, step: number, max?: number) => {
    const id = `${f.k}-${k}`;
    return (
      <label className={err[k] ? 'bad' : undefined}><span>{label}</span>
        <input type="number" inputMode="decimal" min={0} max={max} step={step} placeholder={ph} defaultValue={my?.[k] ?? ''} aria-invalid={!!err[k]} aria-describedby={err[k] ? id : undefined}
          onChange={(e) => {
            const t = e.target.value, x = num(t);
            const bad = k === 'fee' || k === 'depfee' ? feeError(f.prod, k, x) : x != null && x < 0 ? 'סכום לא יכול להיות שלילי.' : null;
            setErr((o) => ({ ...o, [k]: bad ?? undefined }));
            if (bad) return;
            if (x != null || t === '') onChange({ [k]: x });
          }} />
        {err[k] && <span className="sv-err" id={id} role="alert">{err[k]}</span>}
      </label>
    );
  };
  return (
    <details className="sv-mine" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{has ? `הנתונים שלך (${has}/4)` : 'הנתונים שלך מהדוח השנתי (לא חובה)'}</summary>
      <div className="sv-form">
        {field('balance', 'יתרה היום, ש"ח', 'למשל 150000', 1000)}
        {field('monthly', 'הפקדה חודשית, ש"ח', 'למשל 2200', 100)}
        {field('fee', <>מצבירה, % <Tip k="fee" /></>, `ממוצע במסלול: ${pcf(f.fee)}`, 0.01, cap.fee)}
        {field('depfee', <>מהפקדה, % <Tip k="depfee" /></>, f.depfee != null ? `ממוצע במסלול: ${pcf(f.depfee)}` : 'אם יש', 0.05, cap.depfee)}
      </div>
      <p className="sv-note">נשמר רק בדפדפן הזה. {cap.legal ? <>התקרה בחוק: {cap.depfee}% מהפקדה ו-{cap.fee}% מצבירה (<a href={KZ_CAPS} target="_blank" rel="noreferrer">כל זכות</a>).</> : null}</p>
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

function Assume({ plan, rWhy, my, ex, ageSet, retSrc, retWhy, r10, idx, retQ, setRetQ }: { plan: Plan; rWhy: string; my?: MyProduct; ex: string; ageSet: boolean; retSrc?: () => Prov; retWhy: string; r10: number | null; idx: boolean; retQ: number | null; setRetQ: (v: number | null) => void }) {
  const r10v = r10 != null ? +r10.toFixed(2) : null;
  return (
    <div className="sv-assume">
      <div className="sv-assume-h">ההנחות <span className="sv-muted">· אפשר לשנות</span></div>
      <dl>
        <div><dt>גיל היום</dt><dd>{plan.age}<span className="sv-a">{ageSet ? 'שלך, מראש העמוד' : 'לדוגמה: אפשר לשנות בראש העמוד'}</span> <span>פרישה בגיל {ageText(plan.retire)}</span><span className="sv-a">{rWhy}{!rWhy.startsWith('שלך') && <> · <a className="sv-u" href={KZ_RETIRE} target="_blank" rel="noreferrer">כל זכות</a></>}</span></dd></div>
        <div><dt>יתרה היום</dt><dd>{ilsRound(plan.balance)}{my?.balance == null && <span className="sv-a">לדוגמה</span>}</dd></div>
        <div><dt>הפקדה לחודש</dt><dd>{ilsRound(plan.monthly)}{my?.monthly == null && <span className="sv-a">לדוגמה: {ex}</span>}</dd></div>
        <div><dt>עליית ההפקדה</dt><dd>{pcf(GROWTH_DEFAULT)} בשנה<span className="sv-a">הנחה</span></dd></div>
        <div><dt>תשואה ברוטו</dt><dd>{retSrc ? <Sourced src={retSrc}><b className="num">{pcf(plan.ret)}</b></Sourced> : <b className="num">{pcf(plan.ret)}</b>} בשנה<span className="sv-a">{retWhy}</span>
          <span className="sv-rets" role="group" aria-label="הנחת התשואה">
            <button type="button" className="sv-chip sm" aria-pressed={retQ == null} onClick={() => setRetQ(null)}>שמרני {pcf(RET_FALLBACK)}</button>
            {r10v != null && <button type="button" className="sv-chip sm" aria-pressed={retQ != null && Math.abs(retQ - r10v) < 1e-9} onClick={() => setRetQ(r10v)}>תשואת עבר 10 שנים, לא תחזית: {pcr(r10v)}</button>}
            <NumIn label="אחר, %" small value={plan.ret} min={-5} max={10} step={0.25} onCommit={setRetQ} />
          </span>
          {idx && <span className="sv-a">במסלול שעוקב אחרי מדד אחד לא מוצעת תשואת העבר שלו כהנחה: עשר שנים של שוק אחד אינן תחזית.</span>}</dd></div>
        <div><dt>אינפלציה</dt><dd>{pcf(INFL_DEFAULT)} בשנה<span className="sv-a">הנחה, יעד בנק ישראל 1%–3%</span></dd></div>
      </dl>
    </div>
  );
}

/** W7: one plain line on the pension fund's insurance covers from the clearing-house file (lib/maslaka readCovers): disability as a
 *  share of the salary and ₪ a month, survivors in ₪ a month, and what the covers cost a month out of the deposit. Nothing judgmental:
 *  whether the covers fit is the saver's and the agent's question; the "?" says what each is. */
function CoverLine({ covers, insTrack, salary }: { covers: MCover[]; insTrack?: string | null; salary: number | null }) {
  const dis = covers.find((c) => /נכות/.test(`${c.name} ${c.kind ?? ''}`));
  const sur = covers.find((c) => /שא[י]?רים/.test(`${c.name} ${c.kind ?? ''}`));
  const cost = covers.reduce((s, c) => s + (c.cost ?? 0), 0);
  const disRate = dis?.rate ?? (dis?.sum != null && salary ? Math.round((dis.sum / salary) * 100) : null);
  const bits: ReactNode[] = [];
  if (dis && (dis.sum != null || disRate != null)) bits.push(<span key="d">ביטוח נכות: {disRate != null ? `${disRate}% מהשכר` : ''}{disRate != null && dis.sum != null ? ', ' : ''}{dis.sum != null ? <>כ-<span className="num">{ilsRound(dis.sum)}</span> לחודש</> : null}</span>);
  if (sur?.sum != null) bits.push(<span key="s">שארים: <span className="num">{ilsRound(sur.sum)}</span> לחודש</span>);
  if (cost > 0) bits.push(<span key="c">עלות הכיסויים כ-<span className="num">{ilsRound(cost)}</span> בחודש (מתוך ההפקדה)</span>);
  if (!bits.length) return null;
  return <p className="sv-cov" title={insTrack ? `מסלול ביטוח: ${insTrack}` : undefined}>{bits.map((b, i) => <span key={i}>{i ? '; ' : ''}{b}</span>)}<Tip k="covers" /><span className="sv-a">מקובץ המסלקה</span></p>;
}

export type { Verdict };
