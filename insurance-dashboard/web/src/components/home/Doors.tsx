import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../Logo';
import { Sourced } from '../Source';
import { Ico } from './glyphs';
import { FundFacts, ProdFigs, screenHref, useFundFacts, useProducts } from './fundFacts';
import { useActiveDoor } from './doorState';
import { ClientsPanel } from './ClientsPanel';
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

/** a door home's head: the door's name in the ember eyebrow, a title, one line */
function Head({ k, title, line }: { k: string; title: string; line: string }) {
  return (
    <header className="pagehead dhome-hd">
      <div><span className="eyebrow">{k}</span><h1>{title}</h1><div className="sub">{line}</div></div>
    </header>
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

const SAVER_CARDS: Card[] = [
  ['/funds/tools/fees', 'fee', 'כמה עולים לי דמי הניהול?', 'הפער בשקלים עד הפרישה, לפי דמי הניהול שלכם ומול השוק.'],
  ['/funds/default', 'shield', 'קרנות ברירת המחדל', 'הקרנות שנבחרו במכרז המדינה ודמי הניהול שנקבעו להן.'],
  ['/funds/compare', 'compare', 'השוואת מסלולים', 'כמה מסלולים זה לצד זה: תשואה נטו, סיכון ודמי ניהול.'],
  ['/funds/watch', 'eye', 'המעקב שלי', 'המסלולים ששמרתם, ומה השתנה בהם מאז הפעם הקודמת.'],
  ['/about', 'spark', 'מי אנחנו ומאיפה הנתונים', 'אתר חינמי ועצמאי. הנתונים מהרשות לשוק ההון, וכל מספר נפתח למקור.'],
];

/** the saver's home: "what do you have" first, then the four questions a saver asks */
export function SaverHome() {
  const [mine] = useMine();
  return (
    <div className="dhome dhome-saver">
      <Head k="חוסך" title="החיסכון שלך, בשקלים ובמילים" line="כמה אתם משלמים, איך המסלול שלכם עומד מול מסלולים דומים, ומה לשאול את הסוכן או את החברה." />
      {mine.length > 0 ? <MineSummary mine={mine} /> : (
        <section className="dlead" aria-labelledby="dlead-t">
          <span className="icotile lg"><Ico name="mine" /></span>
          <div className="dlead-t">
            <h2 id="dlead-t">מה יש לך?</h2>
            <p>בוחרים את המוצר (פנסיה, השתלמות, גמל או פוליסה), את החברה ואת המסלול. אחר כך רואים כמה אתם משלמים ואיפה אתם עומדים.</p>
          </div>
          <Link to="/my" className="door-go primary">להתחיל<Ico name="arrow" /></Link>
        </section>
      )}
      <FundFacts />
      <Cards cards={SAVER_CARDS} label="מה אפשר לבדוק" />
      <p className="doors-note">מה שאתם מזינים נשמר בדפדפן הזה בלבד ולא נשלח לשום מקום.</p>
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
          const r5 = retOf(f, 'a5', 'net').v;
          return (
            <li key={p.k}>
              <span className="dmine-n"><Link to={`/funds/${f.k}`}>{f.name}</Link><span className="dim">{f.prod} · {f.track}</span></span>
              <span className="dmine-f">
                {f.fee != null && <span>דמי ניהול מצבירה <Sourced className="num" src={() => fundP(refOf(f), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', nf(f.fee!, 2) + '%')}>{nf(f.fee, 2)}%</Sourced> <span className="dim">ממוצע במסלול</span>{p.fee != null && <> · <span className="num">{nf(p.fee, 2)}%</span> <span className="dim">שלכם, כפי שהזנתם</span></>}</span>}
                {r5 != null && <span>{NET_LABEL}, 5Y בשנה <Sourced className="num" src={() => netProv(f, 'a5', asof, r5, data.net_method)}>{nf(r5, 1)}%</Sourced></span>}
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
];

/** the agent's home: a pension-first product picker with each product's sourced figures, then the tools for a client meeting */
export function AgentHome() {
  const { rows, asof, ready } = useProducts();
  return (
    <div className="dhome dhome-agent">
      <Head k="סוכן" title="מסלולים, השוואה ודמי ניהול" line="כל המסלולים שהרשות מפרסמת, נטו אחרי דמי ניהול, עם מקור לכל מספר." />
      <FundFacts />
      <section className="panel dprods" aria-labelledby="dprods-t">
        <div className="hd"><h2 id="dprods-t">בחירת מוצר</h2><div className="aside">דמי ניהול: ממוצע בפועל, חציון המסלולים</div></div>
        <ul className="dprods-l">
          {!ready && [0, 1, 2, 3].map((i) => <li key={i} className="dprods-sk" aria-hidden="true" />)}
          {rows.map((r, i) => (
            <li key={r.prod} className={i < 2 ? 'lead' : undefined}>
              <Link to={screenHref(r.prod)} className="dprods-n">{r.label}</Link>
              <span className="dprods-f"><ProdFigs r={r} asof={asof} full /></span>
              <Link to={screenHref(r.prod)} className="dprods-go" aria-label={`כל המסלולים · ${r.label}`}><Ico name="arrow" /></Link>
            </li>
          ))}
        </ul>
      </section>
      {/* W3 */}<ClientsPanel />
      <Cards cards={AGENT_CARDS} label="כלים לסוכן" />
    </div>
  );
}
