import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../Logo';
import { Sourced } from '../Source';
import { Ico } from './glyphs';
import { FundFacts, ProdFigs, screenHref, useFundFacts, useProducts } from './fundFacts';
import { useActiveDoor } from './doorState';
import { ClientsPanel } from './ClientsPanel';
import { ClientImport } from '../agent/ClientImport';  // P0 · A1: the agent's home opens on a new client
import { useState } from 'react';
import { useMine, type MyProduct } from '../../lib/mine';
import { nf } from '../../lib/format';
import { fundP } from '../../lib/market';
import { NET_LABEL, netProv, refOf, retOf, ym, type FundX } from '../../lib/funds';
import type { Door } from '../../lib/door';
import '../../styles/doors.css';

/* W1 shell, "three doors, one site" (plan 01.11.26, Exhibit 4): the picker a first visit lands on, and the saver's and the agent's
   homes. Pro keeps today's home (ProHome). The saver door speaks in plain Hebrew sentences; the figures are the same sourced data. */

const Go = ({ to, door, children, primary = false }: { to: string; door: Door; children: React.ReactNode; primary?: boolean }) => {
  const [, setDoor] = useActiveDoor();
  return <Link to={to} className={`door-go${primary ? ' primary' : ''}`} onClick={() => setDoor(door)}>{children}<Ico name="arrow" /></Link>;
};

/** a few of the Pro modules, as a taste of what is behind the door (every one of them stays where it is) */
const PRO_MODS: [string, string][] = [['/industry/peers', 'השוואה ענפית'], ['/industry/csm', 'IFRS 17 · CSM'], ['/valuation', 'שווי'], ['/scenarios', 'תרחישים'], ['/warroom', 'חדר מלחמה'], ['/questions', 'שאלות'], ['/savings', 'כלכלת המנהלים']];

/** `/` with no door chosen: who is this for, and where to start */
export function DoorPicker() {
  const { rows, asof } = useProducts();
  const [, setDoor] = useActiveDoor();
  const nav = useNavigate();
  const enter = (d: Door) => { setDoor(d); nav('/'); };
  return (
    <div className="doors">
      <header className="doors-hero">
        <span className="doors-mark"><Logo size={72} animated /></span>
        <div className="doors-t">
          <h1>כל מסלולי החיסכון בישראל, נטו ובמקור.</h1>
          <p>פנסיה, גמל, השתלמות ופוליסות: התשואה אחרי דמי ניהול ודמי הניהול בפועל של כל מסלול שהרשות מפרסמת. כל מספר נפתח למקור שלו. <b>חינם, בלי פרסומות ובלי עמלות.</b></p>
        </div>
      </header>
      <FundFacts className="doors-facts" />
      <h2 className="doors-q">למי האתר הזה היום?</h2>
      <div className="doors-grid">
        <article className="door door-saver" aria-labelledby="door-saver-t">
          <div className="door-hd"><span className="icotile lg"><Ico name="mine" /></span><span className="door-k">חוסך</span></div>
          <h3 id="door-saver-t">מה יש לך?</h3>
          <p>בוחרים מוצר, חברה ומסלול, ורואים במילים פשוטות כמה אתם משלמים ואיפה המסלול שלכם עומד מול מסלולים דומים.</p>
          <ol className="door-steps" aria-label="שלושה צעדים">
            <li><span className="num">1</span>מוצר</li><li><span className="num">2</span>חברה</li><li><span className="num">3</span>מסלול</li>
          </ol>
          <div className="door-act">
            <Go to="/my" door="saver" primary>מה יש לי</Go>
            <button type="button" className="door-alt" onClick={() => enter('saver')}>לבית של החוסך</button>
          </div>
        </article>
        <article className="door door-agent" aria-labelledby="door-agent-t">
          <div className="door-hd"><span className="icotile lg"><Ico name="briefcase" /></span><span className="door-k">סוכן</span></div>
          <h3 id="door-agent-t">בחירת מוצר ללקוח</h3>
          <p>פנסיה קודם. כל המסלולים של המוצר, נטו, עם דמי הניהול בפועל, להשוואה ולפגישה.</p>
          <ul className="door-prods" aria-label="מוצרים">
            {rows.slice(0, 5).map((r) => (
              <li key={r.prod}><Link to={screenHref(r.prod)} onClick={() => setDoor('agent')}>{r.label}</Link><span className="dim"><ProdFigs r={r} asof={asof} /></span></li>
            ))}
            {rows.length === 0 && <li className="door-prods-sk" aria-hidden="true" />}
          </ul>
          <div className="door-act"><button type="button" className="door-alt" onClick={() => enter('agent')}>לבית של הסוכן</button></div>
        </article>
        <article className="door door-pro" aria-labelledby="door-pro-t">
          <div className="door-hd"><span className="icotile lg"><Ico name="terminal" /></span><span className="door-k">Pro</span></div>
          <h3 id="door-pro-t">הטרמינל המלא</h3>
          <p>חברות הביטוח והגופים המנהלים: דוחות, IFRS 17, השוואה ענפית, שווי, תרחישים ושאלות.</p>
          <nav className="door-mods" aria-label="מודולים ב-Pro">
            {PRO_MODS.map(([to, l]) => <Link key={to} to={to} onClick={() => setDoor('pro')}>{l}</Link>)}
          </nav>
          <div className="door-act"><button type="button" className="door-go" onClick={() => enter('pro')}>כניסה ל-Pro<Ico name="arrow" /></button></div>
        </article>
      </div>
      <p className="doors-note">הבחירה נשמרת בדפדפן הזה בלבד. אפשר להחליף בכל רגע מהסרגל העליון.</p>
    </div>
  );
}

type Card = [to: string, icon: string, title: string, line: string];
function Cards({ cards, label }: { cards: Card[]; label: string }) {
  return (
    <nav className="dcards" aria-label={label}>
      {cards.map(([to, icon, t, d]) => <Link key={to} to={to} className="dcard"><span className="icotile"><Ico name={icon} /></span><b>{t}</b><span>{d}</span></Link>)}
    </nav>
  );
}

/** P0 (fox 3.0 plan, 05.11.26): four cards under the annual check-up; the watchlist folds into /my, "רגעים" takes its card */
const SAVER_CARDS: Card[] = [
  ['/funds/tools/fees', 'fee', 'כמה עולים לי דמי הניהול?', 'הפער בשקלים עד הפרישה, לפי דמי הניהול שלכם ומול השוק.'],
  ['/funds/default', 'shield', 'קרן ברירת המחדל', 'הקרנות שנבחרו במכרז המדינה ודמי הניהול שנקבעו להן.'],
  ['/funds/compare', 'compare', 'השוואת מסלולים', 'כמה מסלולים זה לצד זה: תשואה נטו, סיכון ודמי ניהול.'],
  ['/my/moment', 'moment', 'רגעים', 'עבודה חדשה, העלאה, הצעה לעבור קרן או גיל 60: מה בודקים ומה שואלים.'],
];

/** the saver's home (P0, S1 entry): the annual check-up from the clearing-house file comes first; the products the reader already
 *  entered under it; then the four questions a saver asks */
export function SaverHome() {
  const [mine] = useMine();
  const has = mine.length > 0;
  return (
    <div className="dhome dhome-saver">
      <header className="dlead dcheck" aria-labelledby="dcheck-t">
        <span className="icotile lg"><Ico name="mine" /></span>
        <div className="dlead-t">
          <span className="eyebrow">חוסך · הבדיקה השנתית</span>
          <h1 id="dcheck-t">ייבוא מהמסלקה <span className="dbeta">בטא</span></h1>
          <p>מורידים את הדוח מהמסלקה הפנסיונית ופותחים אותו כאן: כל המוצרים, דמי הניהול שלכם מול השוק וההפקדות, בשקלים ובמילים. הקובץ נקרא בדפדפן ולא יוצא מהמכשיר.</p>
        </div>
        <div className="dcheck-go">
          <Link to="/my#mk-h" className="door-go primary">ייבוא מהמסלקה<Ico name="arrow" /></Link>
          <Link to={has ? '/my' : '/my#sv-add-h'} className="dcheck-alt">{has ? 'לבדיקה של המוצרים שלי' : 'או לבחור מוצר ידנית'}</Link>
        </div>
      </header>
      {has && <MineSummary mine={mine} />}
      <Cards cards={SAVER_CARDS} label="מה אפשר לבדוק" />
      <FundFacts />
      <p className="doors-note">מה שאתם מזינים נשמר בדפדפן הזה בלבד ולא נשלח לשום מקום. <Link className="sv-u" to="/about">מי אנחנו ומאיפה הנתונים</Link></p>
    </div>
  );
}

/** "המוצרים שלי": the products the reader entered on /my, each with its track's own published figures */
function MineSummary({ mine }: { mine: MyProduct[] }) {
  const { data, asof } = useFundFacts();
  const by = new Map((data?.funds ?? []).map((f) => [f.k, f]));
  return (
    <section className="panel dmine" aria-labelledby="dmine-t">
      <div className="hd"><h2 id="dmine-t">המוצרים שלי</h2><div className="aside"><Link to="/my">לתמונה המלאה</Link></div></div>
      <ul className="dmine-l">
        {mine.map((p) => { const f = by.get(p.k) as FundX | undefined;
          if (!data) return <li key={p.k} className="dmine-sk" aria-hidden="true" />;
          if (!f) return <li key={p.k}><span className="dmine-n">מסלול {p.k}</span><span className="dim">לא נמצא בנתוני {asof ? ym(asof) : 'החודש'}</span></li>;
          // W4: the 5Y net, else the 3Y with the reason (a השתלמות S&P track has 5 years gross but no 5-year net)
          const r5 = retOf(f, 'a5', 'net').v, r3 = r5 == null ? retOf(f, 'a3', 'net').v : null;
          const avg = f.fee != null ? <Sourced className="num" src={() => fundP(refOf(f), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', nf(f.fee!, 2) + '%')}>{nf(f.fee, 2)}%</Sourced> : null;
          return (
            <li key={p.k}>
              <span className="dmine-n"><Link to={`/my#${f.k}`}>{f.name}</Link><span className="dim">{f.prod} · {f.track}</span></span>
              <span className="dmine-f">
                {p.fee != null
                  ? <span>דמי הניהול שלכם מצבירה <b className="num dmine-own">{nf(p.fee, 2)}%</b>{avg && <span className="dim"> · ממוצע במסלול {avg}</span>}</span>
                  : avg && <span>דמי ניהול מצבירה <b className="dmine-own">{avg}</b> <span className="dim">ממוצע במסלול · <Link to={`/my#${f.k}`}>להזין את שלכם</Link></span></span>}
                {r5 != null && <span>{NET_LABEL}, 5Y בשנה <Sourced className="num" src={() => netProv(f, 'a5', asof, r5, data.net_method)}>{nf(r5, 1)}%</Sourced></span>}
                {r3 != null && <span>{NET_LABEL}, 3Y בשנה <Sourced className="num" src={() => netProv(f, 'a3', asof, r3, data.net_method)}>{nf(r3, 1)}%</Sourced> <span className="dim">({f.a5 != null ? 'אין נתון נטו ל-5 שנים' : 'אין 5 שנות היסטוריה'})</span></span>}
              </span>
            </li>
          ); })}
      </ul>
    </section>
  );
}

const AGENT_CARDS: Card[] = [
  ['/funds/compare', 'compare', 'השוואה', 'מסלולים זה לצד זה: נטו, סיכון, חלונות מתגלגלים ודמי ניהול.'],
  ['/funds/default', 'shield', 'קרנות ברירת מחדל', 'הקרנות שנבחרו במכרז והתנאים שלהן.'],
  ['/managers', 'companies', 'דמי הניהול של הגופים', 'הגופים המנהלים, נכסים ודמי ניהול בפועל לאורך זמן.'],
  ['/funds/trackers', 'market', 'עוקבי מדד', 'אותו מדד בעטיפות שונות: הפער בין המסלולים הוא מחיר העטיפה.'],
  ['/funds/tools', 'sliders', 'כלים', 'דמי ניהול לאורך קריירה, מכרזי ברירת המחדל וחבילת השוואה ל-Excel.'],
  // W4: the old managers' insurance policies (1990-2003): what a move would lose, before any comparison
  ['/funds/bm', 'statement', 'ביטוחי מנהלים ישנים', 'פוליסות 1990-2003: מקדם מובטח, הסדר ריסק ומה נבדק לפני מעבר.'],
];

/** the agent's home (P0, A1): a new client from a clearing-house file first, the latest client folders beside it; the product picker
 *  and the meeting tools below the fold */
export function AgentHome() {
  const { rows, asof, ready } = useProducts();
  const { data } = useFundFacts();
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="dhome dhome-agent">
      <div className="dnew-grid">
        <section className="dlead dnew" aria-labelledby="dnew-t">
          <div className="dnew-hd">
            <span className="icotile lg"><Ico name="clients" /></span>
            <div className="dlead-t">
              <span className="eyebrow">סוכן</span>
              <h1 id="dnew-t">לקוח חדש: גררו קובץ מסלקה</h1>
              <p>קובצי ה-XML של הלקוח נקראים בדפדפן הזה ונשמרים כתיק: מוצרים, יתרות, דמי הניהול של הלקוח וכיסויים. משם להשוואה, לניוד ולמסמך ללקוח.</p>
            </div>
          </div>
          {data ? <ClientImport funds={data.funds as FundX[]} startOpen onDone={(_, m) => setDone(m)} /> : <p className="muted" aria-busy="true">טוען את נתוני המסלולים…</p>}
          {done && <p role="status" className="csave-msg">{done} <Link className="sv-u" to="/clients">לתיק בלקוחות</Link></p>}
        </section>
        {/* W3 */}<ClientsPanel />
      </div>
      <Cards cards={AGENT_CARDS} label="כלים לסוכן" />
      <section className="panel dprods" aria-labelledby="dprods-t">
        <div className="hd"><h2 id="dprods-t">בחירת מוצר</h2><div className="aside"><span>דמי ניהול: ממוצע בפועל, חציון המסלולים</span><Link to="/funds/screen">לכל המסלולים</Link></div></div>
        <ul className="dprods-l">
          {!ready && [0, 1, 2, 3].map((i) => <li key={i} className="dprods-sk" aria-hidden="true" />)}
          {rows.map((r, i) => (
            <li key={r.prod} className={i < 2 ? 'lead' : undefined}>
              <Link to={screenHref(r.prod)} className="dprods-n">{r.label}{r.note && <span className="dprods-note">{r.note}</span>}</Link>
              <span className="dprods-f"><ProdFigs r={r} asof={asof} full /></span>
              <Link to={screenHref(r.prod)} className="dprods-go" aria-label={`כל המסלולים · ${r.label}`}><Ico name="arrow" /></Link>
            </li>
          ))}
        </ul>
      </section>
      <FundFacts />
    </div>
  );
}
