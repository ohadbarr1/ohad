import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import type { Prov } from '../../lib/prov';
import { grossProv, netProv, refOf, ym, type FundX, type FundsFile } from '../../lib/funds';
import type { DefaultFile } from '../../lib/fundsTools';
import { fundP } from '../../lib/market';
import { fundHits, fundIdx, fundMeta } from '../../lib/searchOmni';
import { PER_HE, isPension, pcf, pcr, peersOf, rankLabel, selfDir, verdictOf, type Verdict } from '../../lib/verdict';
import { TIE_NOTE } from '../../lib/fundsTie';
import { LIQ_YEARS, ageText, horizon, ilsRound, project, type Plan } from '../../lib/retire';
import type { FeePair } from '../../lib/fundsCalc';
import { actProv, pc2 } from '../../lib/agentProv';
import { rankHe, svcOf, svcProv, type DecisionFile } from '../../lib/decision';
import type { CardCalc } from '../../lib/myCalc';
import { RULE } from '../../lib/productRules';

/* W7 saver · "חבר אמר לעבור ל-X": the saver pastes a fund's name or number and gets one card, my track against that one, same
   category only, in ₪ at retirement (השתלמות: at the 6-year liquidity date), the fees, the shared 5Y net place with the tie rule, the
   actuarial balance (pension) and the service index, each figure with its source; then a short factual block on what a transfer does.
   The arithmetic is the card's own (lib/myCalc plan, lib/retire project, lib/verdict verdictOf on lib/fundsTie ranks): no new maths.
   Descriptive: it never says "move" or "stay". */

/** the transfer facts, each with its source (verified 02.11.26) */
const KZ_MOVE = 'https://www.kolzchut.org.il/he/%D7%9E%D7%A2%D7%91%D7%A8_%D7%91%D7%99%D7%9F_%D7%92%D7%95%D7%A4%D7%99%D7%9D_%D7%A4%D7%A0%D7%A1%D7%99%D7%95%D7%A0%D7%99%D7%99%D7%9D_%D7%95%D7%91%D7%99%D7%9F_%D7%9E%D7%9B%D7%A9%D7%99%D7%A8%D7%99%D7%9D_%D7%A4%D7%A0%D7%A1%D7%99%D7%95%D7%A0%D7%99%D7%99%D7%9D';
const KZ_HISH = 'https://www.kolzchut.org.il/he/%D7%A7%D7%A8%D7%9F_%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA';
const REG_MOVE = 'https://www.gov.il/BlobFolder/news/news_0031/he/Regulation_13_02_2025_pdf.pdf';
const KZ_GEMEL_INVEST = RULE.gemelInvest.src[2]?.url ?? KZ_MOVE;

export function FriendSays({ f, data, dfile, dec, C, sex, startOpen = false }: { f: FundX; data: FundsFile; dfile: DefaultFile | null | undefined; dec: DecisionFile | null | undefined; C: CardCalc; sex: 'm' | 'f' | null;
  /** W9: open on arrival (the `switch` moment page lists one per product) */ startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const funds = data.funds as FundX[], asof = data.asof;
  const live = useMemo(() => funds.filter((x) => x.k !== f.k && x.assets && !selfDir(x)).map((x) => ({ f: x, x: fundIdx(x.name, x.grp, x.k, x.track, x.prod) })), [funds, f.k]);
  const sameCat = useMemo(() => new Set(peersOf(f, funds).map((x) => x.k)), [f, funds]);
  const hits = useMemo(() => fundHits(q, live, 5), [q, live]);
  const other = pick ? funds.find((x) => x.k === pick) ?? null : hits.length === 1 || (hits.length && hits[0].s >= 1000) ? hits[0].f : null;
  if (!open) return <button type="button" className="sv-go sv-friend-b" onClick={() => setOpen(true)}>חבר אמר לעבור ל…</button>;
  return (
    <section className="sv-sec sv-friend" aria-labelledby={`${f.k}-fr-h`}>
      <h3 id={`${f.k}-fr-h`}>חבר אמר לעבור ל…<span className="sv-tag">השוואה</span></h3>
      <p>הדביקו שם של מסלול או מספר קופה, ותראו את המסלול שלכם מולו, באותה קטגוריה, במספרים. תיאור, לא המלצה.</p>
      <div className="sv-friend-q">
        <input type="search" inputMode="search" placeholder="למשל: מנורה פנסיה מקיפה כללי, או 1425" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} aria-label="שם מסלול או מספר קופה" />
        <button type="button" className="linkbtn" onClick={() => setOpen(false)}>סגירה</button>
      </div>
      {q.trim().length >= 2 && !other && hits.length > 0 && <ul className="sv-pick-list" aria-label="מסלולים שנמצאו">
        {hits.map((h) => <li key={h.f.k}><button type="button" className="sv-pick-row" onClick={() => setPick(h.f.k)}><span className="sv-pick-n">{h.f.name}</span><span className="sv-pick-m">{fundMeta(h.x)}{sameCat.has(h.f.k) ? '' : ' · קטגוריה אחרת'}</span><span className="sv-pick-a" aria-hidden="true">←</span></button></li>)}
      </ul>}
      {q.trim().length >= 2 && !other && hits.length === 0 && <p className="sv-muted">לא נמצא מסלול כזה בנתוני הרשות. אפשר לנסות את מספר הקופה מהדוח של החבר.</p>}
      {other && !sameCat.has(other.k) && <p className="sv-note sv-friend-no"><b>{other.name}</b> ({other.prod}, {other.track}) הוא מקטגוריה אחרת מ{f.prod}, {f.track}. השוואה הוגנת היא רק בין מסלולים מאותו מוצר ומאותו סוג מסלול: תשואה של מסלול מניות מול מסלול כללי אומרת על הסיכון, לא על המנהל. <Link to={`/funds/${other.k}`}>כרטיס המסלול</Link>.</p>}
      {other && sameCat.has(other.k) && <Compare f={f} o={other} funds={funds} asof={asof} dfile={dfile} dec={dec} C={C} data={data} sex={sex} startOpen={startOpen} />}
    </section>
  );
}

function Compare({ f, o, funds, asof, dfile, dec, C, data, sex, startOpen }: { f: FundX; o: FundX; funds: FundX[]; asof: number; dfile: DefaultFile | null | undefined; dec: DecisionFile | null | undefined; C: CardCalc; data: FundsFile; sex: 'm' | 'f' | null; startOpen?: boolean }) {
  const pen = isPension(f.prod), hish = f.prod === 'השתלמות';
  const vO: Verdict = useMemo(() => verdictOf(o, funds, asof, dfile, null, dec), [o, funds, asof, dfile, dec]);
  const vM = C.v;
  const plan: Plan = hish ? horizon(C.plan, LIQ_YEARS) : C.plan;
  const pairO: FeePair = { fee: o.fee ?? 0, depfee: o.depfee ?? 0 };
  const outM = project(plan, C.mine), outO = project(plan, pairO);
  const when = hish ? `בעוד ${LIQ_YEARS} שנים, כשהכסף נזיל` : `בגיל הפרישה (${ageText(plan.retire)})`;
  const who = C.ownAny ? 'שלך' : 'ממוצע המסלול';
  const balProv = (x: FundX, out: typeof outM, pair: FeePair, w: string): Prov => ({ k: 'calc', est: true, title: `חיסכון ${when}, בשקלי היום · ${x.name}`, value: ilsRound(out.balReal),
    formula: 'אותה תוכנית לשני המסלולים: היתרה, ההפקדה החודשית (עולה 2% בשנה), תשואה ברוטו זהה, אינפלציה 2%; רק דמי הניהול שונים. השיטה של מחשבון דמי הניהול (/funds/tools/fees)',
    note: 'אומדן על הנחות, לא תחזית: התשואה בעתיד אינה ידועה ומונחת זהה בשני המסלולים; ההבדל כאן הוא דמי הניהול בלבד. לא כולל מס ועלות כיסוי ביטוחי',
    inputs: [{ label: 'גיל היום', v: String(plan.age) }, { label: hish ? 'אופק (שנים)' : 'גיל פרישה', v: hish ? String(LIQ_YEARS) : ageText(plan.retire) }, { label: 'יתרה היום', v: ilsRound(plan.balance) }, { label: 'הפקדה חודשית', v: ilsRound(plan.monthly) }, { label: 'תשואה ברוטו בשנה (הנחה)', v: pcf(plan.ret) },
      { label: `דמי ניהול מצבירה (${w})`, v: pcf(pair.fee), src: w === 'שלך' ? undefined : () => fundP(refOf(x), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', pcf(pair.fee)) }, { label: `דמי ניהול מהפקדה (${w})`, v: pcf(pair.depfee) }] });
  const rankProv = (x: FundX, v: Verdict): Prov => {
    const r = v.ret;
    if (!r?.rank) return { k: 'none', title: `מקום בקטגוריה · ${x.name}`, why: 'אין למסלול תשואה לחלון' };
    return { k: 'calc', est: r.basis === 'net', title: `מקום בקטגוריה (${PER_HE[r.per]}${r.basis === 'net' ? ', נטו' : ''}) · ${x.name}`, value: `${rankLabel(r.rank)}`,
      formula: `דירוג התשואה השנתית הממוצעת${r.basis === 'net' ? ' נטו (אומדן)' : ''} בין ${r.rank.n} המסלולים בקטגוריה ${v.cat}. ${TIE_NOTE}`,
      inputs: [{ label: 'התשואה', v: pcr(r.v), src: () => (r.basis === 'net' ? netProv(x, r.per, asof, r.v, data.net_method) : grossProv(x, r.per, asof)) }, { label: 'חציון הקטגוריה', v: pcr(r.med) }] };
  };
  const feeSrc = (x: FundX) => () => fundP(refOf(x), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', pcf(x.fee));
  const depSrc = (x: FundX) => () => fundP(refOf(x), asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', pcf(x.depfee));
  const rank = (v: Verdict) => (v.ret?.rank ? rankLabel(v.ret.rank) : 'אין');
  const svcM = dec ? svcOf(dec, f.grp, 'pension') : null, svcO = dec ? svcOf(dec, o.grp, 'pension') : null;
  const diff = outO.balReal - outM.balReal;
  const g = (fm: string, m: string, n: string) => (sex === 'f' ? fm : sex === 'm' ? m : n);
  return (
    <div className="sv-friend-out">
      <div className="scroll"><table className="sv-friend-t">
        <thead><tr><th scope="col"></th><th scope="col">שלי: {f.name}</th><th scope="col">המסלול שהוצע: <Link to={`/funds/${o.k}`}>{o.name}</Link></th></tr></thead>
        <tbody>
          <tr><th scope="row">חיסכון {when}, בשקלי היום <span className="sv-a">אומדן</span></th>
            <td className="num"><Sourced src={() => balProv(f, outM, C.mine, who)}><b>{ilsRound(outM.balReal)}</b></Sourced></td>
            <td className="num"><Sourced src={() => balProv(o, outO, pairO, 'ממוצע המסלול')}><b>{ilsRound(outO.balReal)}</b></Sourced></td></tr>
          {pen && <tr><th scope="row">קצבה לחודש, אומדן <span className="sv-a">אותו מקדם</span></th><td className="num">{ilsRound(outM.pensionReal)}</td><td className="num">{ilsRound(outO.pensionReal)}</td></tr>}
          <tr><th scope="row">דמי ניהול מצבירה</th><td className="num"><Sourced src={C.ownAny ? () => balProv(f, outM, C.mine, who) : feeSrc(f)}>{pcf(C.mine.fee)}</Sourced> <span className="sv-a">{who}</span></td><td className="num"><Sourced src={feeSrc(o)}>{pcf(o.fee)}</Sourced> <span className="sv-a">ממוצע</span></td></tr>
          <tr><th scope="row">דמי ניהול מהפקדה</th><td className="num">{pcf(C.mine.depfee)}</td><td className="num">{o.depfee != null ? <Sourced src={depSrc(o)}>{pcf(o.depfee)}</Sourced> : 'לא מתפרסם'}</td></tr>
          <tr><th scope="row">מקום בקטגוריה{vM.ret ? ` (${PER_HE[vM.ret.per]}${vM.ret.basis === 'net' ? ', נטו' : ''})` : ''}</th>
            <td><Sourced src={() => rankProv(f, vM)}>{rank(vM)}</Sourced></td>
            <td><Sourced src={() => rankProv(o, vO)}>{rank(vO)}</Sourced>{vO.ret && vM.ret && vO.ret.per !== vM.ret.per ? <span className="sv-a">חלון אחר: {PER_HE[vO.ret.per]}</span> : null}</td></tr>
          {pen && <tr><th scope="row">איזון אקטוארי, רבעון אחרון</th>
            <td className="num">{f.act != null ? <Sourced src={() => actProv(f)}>{pc2(f.act)}</Sourced> : 'לא דווח'}</td>
            <td className="num">{o.act != null ? <Sourced src={() => actProv(o)}>{pc2(o.act)}</Sourced> : 'לא דווח'}{o.act_p ? <span className="sv-a">{ym(o.act_p)}</span> : null}</td></tr>}
          {pen && dec && <tr><th scope="row">מדד השירות של הרשות (החברה)</th>
            <td>{svcM ? <Sourced src={() => svcProv(dec, f.grp, 'pension', 'total')}>{`${svcM.total} · מקום ${rankHe(svcM)}`}</Sourced> : 'לא במדד'}</td>
            <td>{svcO ? <Sourced src={() => svcProv(dec, o.grp, 'pension', 'total')}>{`${svcO.total} · מקום ${rankHe(svcO)}`}</Sourced> : 'לא במדד'}</td></tr>}
        </tbody>
      </table></div>
      <p>{Math.abs(diff) < 500 ? <>בהנחות האלה דמי הניהול כמעט לא משנים את החיסכון {when} (פחות מ-500 ש"ח).</> : <>בהנחות האלה, רק מדמי הניהול, {g('יהיו לך', 'יהיו לך', 'יהיו לכם')} <span className="sv-nw">כ-<Sourced src={() => balProv(o, outO, pairO, 'ממוצע המסלול')}><b className="sv-ils num">{ilsRound(Math.abs(diff))}</b></Sourced></span> {diff > 0 ? 'יותר' : 'פחות'} במסלול שהוצע, {when}.</>} <span className="sv-a">אומדן; התשואה בעתיד אינה ידועה ומונחת זהה</span></p>
      <p className="sv-note">דמי הניהול של המסלול שהוצע הם הממוצע שהוא גובה מכל העמיתים; מה שיציעו לכם בפועל יכול להיות שונה, וכדאי לבקש אותו בכתב. {TIE_NOTE}. <Link to={`/funds/compare?k=${f.k},${o.k}`}>ההשוואה המלאה</Link>.</p>

      <h4 className="sv-dep-h4">מה קורה בניוד</h4>
      <ul className="sv-facts">
        <li>הכסף עובר במלואו, והקופה הקודמת מעבירה אותו בתוך 10 ימי עסקים מקבלת בקשה מלאה וחתומה; הממונה רשאי לאשר דחייה של עד 20 ימי עסקים נוספים (תקנה 5(א) לתקנות העברת כספים בין קופות גמל, התשס"ח-2008). <a href={REG_MOVE} target="_blank" rel="noreferrer">מכתב הממונה, 13.02.2025</a></li>
        <li>ניוד אינו משיכה ואינו אירוע מס: הכסף נשאר באותו מעמד. {hish ? <>בהשתלמות הוותק נשמר, ומועד הנזילות (6 שנים מההפקדה הראשונה) לא מתאפס. <a href={KZ_HISH} target="_blank" rel="noreferrer">כל זכות</a></> : <>בקופת גמל להשקעה הדבר נאמר במפורש בכל זכות; בפנסיה ובגמל הוותק נשמר במעבר בין קרנות פנסיה. <a href={KZ_GEMEL_INVEST} target="_blank" rel="noreferrer">כל זכות</a></>}</li>
        {pen && <li>הכיסוי הביטוחי מתאפס לעניין הקרן החדשה: היא רשאית לדרוש חיתום רפואי ולהחריג מחלות קיימות; במעבר בין קרנות פנסיה הוותק לעניין מחלות קודמות נשמר. <a href={KZ_MOVE} target="_blank" rel="noreferrer">כל זכות</a></li>}
        <li>דמי הניהול והתקנון הם של הקרן החדשה, לא של הישנה; הנחה בדמי ניהול שקיבלתם בקרן הנוכחית לא עוברת איתכם. <a href={KZ_MOVE} target="_blank" rel="noreferrer">כל זכות</a></li>
        {!hish && <li>מי שיש לו פוליסת מנהלים ישנה עם מקדם קצבה מובטח מאבד אותו בניוד; אי אפשר לחזור. <a href={KZ_MOVE} target="_blank" rel="noreferrer">כל זכות</a></li>}
        <li>לא ניתן לנייד כשיש הלוואה מהקרן שלא הוחזרה, כשהכסף משועבד או מעוקל, או כשכבר מקבלים קצבה. <a href={KZ_MOVE} target="_blank" rel="noreferrer">כל זכות</a></li>
      </ul>
      <p className="sv-note">עובדות על ההליך, לא המלצה לעבור או להישאר. מה שחבר קיבל במסלול שלו תלוי בדמי הניהול שסוכמו איתו ובשנים שבהן היה שם.{!startOpen && <> <Link to="/my/moment/switch">מה עוד לבדוק ולשאול לפני מעבר</Link>.</>}</p>
    </div>
  );
}
