import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../Logo';
import { Ico } from './glyphs';
import { FundFacts, ProdFigs, screenHref, useFundFacts, useProducts } from './fundFacts';
import { useActiveDoor } from './doorState';
import { ClientsPanel } from './ClientsPanel';
import { ClientImport } from '../agent/ClientImport';  // P0 · A1: the agent's home opens on a new client
import { useState, type ReactNode } from 'react';
import { useMine, useMy, type MyProduct } from '../../lib/mine';
import { homeLinks, homeMineLine, homeMoreLine } from '../../lib/saverLinks';
import { NumText } from '../NumText';
import { heMonth } from '../../lib/compareWords';
import { typeName } from '../../lib/pageWords';
import { catKey } from '../../lib/funds';
import { ProdIcon } from '../compare/PickerSheet';  // the isometric product icons the hub, the fees entry and the picker use
import { tileOf } from '../../lib/pickTiles';
import type { Tile } from '../../lib/pickTiles';
import { CK_STATUS_KEY, normStatus, statusLine } from '../../lib/ckStatus';  // red team 06.11.26: the status after a check-up
import { HomeHint } from '../saver/HomeHint';
import { compareKeys } from '../../lib/saverCompare';  // C13: the reader's track and its two largest peers
import { isPension, type VFund } from '../../lib/verdict';
import type { FundX } from '../../lib/funds';
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
          <h1>כל מסלולי החיסכון בישראל, כפי שפורסמו ובמקור.</h1>
          <p>פנסיה, גמל, השתלמות ופוליסות: התשואה ודמי הניהול בפועל של כל מסלול, כפי שהרשות מפרסמת. כל מספר נפתח למקור שלו. <b>חינם, בלי פרסומות ובלי עמלות.</b></p>
        </div>
      </header>
      <FundFacts className="doors-facts" />
      <h2 className="doors-q">למי האתר הזה היום?</h2>
      <div className="doors-grid">
        <article className="door door-saver" aria-labelledby="door-saver-t">
          <div className="door-hd"><span className="icotile lg"><Ico name="mine" /></span><span className="door-k">חוסך</span></div>
          <h3 id="door-saver-t">הבדיקה השנתית</h3>
          <p>פותחים כאן את הקובץ מהמסלקה הפנסיונית ומקבלים שלוש שורות: דמי הניהול שלכם מול המחיר שאפשר לקבל, ההפקדות מהמעסיק ומסלול הגיל. לכל שורה מכתב מוכן.</p>
          <ol className="door-steps" aria-label="שלושה צעדים">
            <li><span className="num">1</span>קובץ מהמסלקה</li><li><span className="num">2</span>שלוש שורות</li><li><span className="num">3</span>מכתב מוכן</li>
          </ol>
          <div className="door-act">
            <Go to="/my/checkup" door="saver" primary>לבדיקה השנתית</Go>
            <button type="button" className="door-alt" onClick={() => enter('saver')}>לבית של החוסך</button>
          </div>
        </article>
        <article className="door door-agent" aria-labelledby="door-agent-t">
          <div className="door-hd"><span className="icotile lg"><Ico name="briefcase" /></span><span className="door-k">סוכן</span></div>
          <h3 id="door-agent-t">בחירת מוצר ללקוח</h3>
          <p>פנסיה קודם. כל המסלולים של המוצר, התשואה ודמי הניהול בפועל, להשוואה ולפגישה.</p>
          <ul className="door-prods" aria-label="מוצרים">
            {rows.slice(0, 5).map((r) => (
              <li key={r.prod}><Link to={`${screenHref(r.prod)}&track=all`}>{r.label}</Link><span className="dim"><ProdFigs r={r} asof={asof} /></span></li>
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

/** isometric art for the two tiles: a podium (who was first) and rising bars (the month) */
const ART_RANK: Tile['art'] = [[24, 'navy'], [46, 'orange'], [34, 'blue']], ART_MONTH: Tile['art'] = [[16, 'blue'], [28, 'navy'], [42, 'orange']];

type Card = [to: string, icon: string, title: string, line: string];
function Cards({ cards, label, lead }: { cards: Card[]; label: string; lead?: ReactNode }) {
  return (
    <nav className="dcards" aria-label={label}>
      {lead}
      {cards.map(([to, icon, t, d]) => <Link key={to} to={to} className="dcard"><span className="icotile"><Ico name={icon} /></span><b>{t}</b><span>{d}</span></Link>)}
    </nav>
  );
}

/** P0 (fox 3.0 plan, 05.11.26): four cards under the annual check-up; the watchlist folds into /my, "רגעים" takes its card */
const SAVER_CARDS: Card[] = [
  ['/funds/default', 'shield', 'קרן ברירת המחדל', 'הקרנות שנבחרו במכרז המדינה ודמי הניהול שנקבעו להן.'],
  ['/funds/compare', 'compare', 'השוואת מסלולים', 'כמה מסלולים זה לצד זה: תשואה, סיכון ודמי ניהול.'],
  ['/my/moment', 'moment', 'רגעים', 'עבודה חדשה, העלאה, הצעה לעבור קרן או גיל 60: מה בודקים ומה שואלים.'],
];

/** C13 · the reader's own track (the comprehensive pension first) and the keys that open the comparison on it: the track and its two
 *  largest open peers (lib/saverCompare). Null until funds.json is in or when no saved track is in it. */
function useMineCompare(mine: MyProduct[]): { keys: string[]; label: string; lead: VFund } | null {
  const { data } = useFundFacts();
  if (!data || !mine.length) return null;
  const funds = data.funds as unknown as VFund[];
  const keys = compareKeys(mine, funds);
  const by = new Map(funds.map((f) => [f.k, f]));
  const own = mine.map((m) => by.get(m.k)).filter((f): f is VFund => !!f);
  const lead = own.find((f) => isPension(f.prod)) ?? own[0];
  return keys.length && lead ? { keys, label: `${lead.grp} · ${lead.prod} ${lead.track}`, lead } : null;
}

/** C13 · "כמה הרוויח המסלול שלי?": the saver home's one entry to the comparison, with a second row for the saved track */
function CompareEntry({ mine, after }: { mine: MyProduct[]; after?: ReactNode }) {
  const m = useMineCompare(mine);
  const { asof } = useFundFacts();
  const lead = m ? (m.lead as unknown as { k: string; prod: string; track: string; m1?: number | null; y12?: number | null }) : null;
  const L = homeLinks(lead);
  const line = lead ? homeMineLine(asof, lead.m1, lead.y12) : '';
  const type = lead ? typeName(catKey(lead)) : null;
  // build review B2 (H-1): the products panel left the home; the row says how many more products wait on /my
  const more = homeMoreLine(mine.length - 1);
  return (
    <section className="dentry-w" aria-labelledby="dentry-t">
      <Link to="/funds/compare?v=months" className="dentry" id="home-compare">
        <span className="icotile lg"><Ico name="compare" /></span>
        <span className="dentry-t"><b id="dentry-t">כמה הרוויח המסלול שלי?</b><small>חודש אחרי חודש, מול מסלולים דומים בחברות אחרות.</small></span>
        <span className="dentry-go">להשוואה ›</span>
      </Link>
      {m && L.card && (
        <Link to={L.card} className="dtile" id="home-mine">
          <ProdIcon art={(tileOf(lead!.prod) ?? { art: ART_MONTH }).art} size={42} />
          <span className="dtile-t"><b>המסלול שלי: {m.label}</b><small>{line ? <NumText t={line} /> : 'לכרטיס של המסלול'}{more ? ` · ${more}` : null}</small></span>
          <span className="dtile-go" aria-hidden="true">›</span>
        </Link>
      )}
      <Link to={L.screen} className="dtile" id="home-screen">
        <ProdIcon art={ART_RANK} size={42} />
        <span className="dtile-t"><b>{type ? 'המסלולים מהסוג שלי' : 'כל המסלולים'}</b><small>{type ? `${type}: מי היה ראשון החודש ובשנה` : 'מי היה ראשון החודש ובשנה, לפי סוג'}</small></span>
        <span className="dtile-go" aria-hidden="true">›</span>
      </Link>
      <Link to={L.hub} className="dtile" id="home-hub">
        <ProdIcon art={ART_MONTH} size={42} />
        <span className="dtile-t"><b>החודש בחיסכון</b><small>{asof ? `מה קרה ב${heMonth(asof)}, בכל סוג מסלול` : 'מה קרה החודש, בכל סוג מסלול'}</small></span>
        <span className="dtile-go" aria-hidden="true">›</span>
      </Link>
      {after}
    </section>
  );
}

/** C13 · the fees card: the comparison first (on the saved track when there is one), the career calculator as the quieter link */
function FeesCard({ mine }: { mine: MyProduct[] }) {
  const m = useMineCompare(mine);
  return (
    <div className="dcard dfee">
      <span className="icotile"><Ico name="fee" /></span>
      <b>כמה עולים לי דמי הניהול?</b>
      <div className="dfee-l">
        <Link to={m ? `/funds/compare?k=${m.keys.join(',')}&v=months&focus=fee` : '/funds/compare?v=months&focus=fee'} id="home-fees" className="dlink">להשוות דמי ניהול בין מסלולים ›</Link>
        <Link to="/funds/tools/fees" className="dlink q">מחשבון עד הפרישה ›</Link>
      </div>
    </div>
  );
}

/** the saver's home (P0, S1 entry): the annual check-up from the clearing-house file comes first; the products the reader already
 *  entered under it; then the four questions a saver asks */
export function SaverHome() {
  const [mine] = useMine();
  const has = mine.length > 0;
  // red team 06.11.26 (bring-back): after a check-up, its status and the next date in place of the import pitch (first visit keeps it)
  const [stRaw] = useMy<unknown>(CK_STATUS_KEY, null);
  const st = has ? normStatus(stRaw) : null;
  /* build review B2 (H-1, PM ruling B2.5): with a saved product the check-up lead folds into one tile row after the hub tile, and the
     "המוצרים שלי" panel leaves the home (the "my track" row and the bottom bar's "המוצרים שלי" carry it). With no saved product the full
     lead stays: it is that visitor's main action. The iPhone tip moves after the four cards. Order: entry · my track · screener · hub ·
     import · four cards · tip · facts · note. */
  const importRow = has ? (
    <Link to="/my/checkup" className="dtile dtile-imp" id="home-import">
      <span className="icotile" aria-hidden="true"><Ico name="mine" /></span>
      <span className="dtile-t"><b>ייבוא מהמסלקה <span className="dbeta">בטא</span></b><small>{st ? statusLine(st) : 'כל המוצרים ודמי הניהול שלכם, מהדוח של המסלקה'}</small></span>
      <span className="dtile-go" aria-hidden="true">›</span>
    </Link>
  ) : null;
  return (
    <div className="dhome dhome-saver">
      <CompareEntry mine={mine} after={importRow} />
      {has ? null : <header className="dlead dcheck" aria-labelledby="dcheck-t">
        <span className="icotile lg"><Ico name="mine" /></span>
        <div className="dlead-t">
          <span className="eyebrow">חוסך · הבדיקה השנתית</span>
          <h1 id="dcheck-t">ייבוא מהמסלקה <span className="dbeta">בטא</span></h1>
          <p>מורידים את הדוח מהמסלקה הפנסיונית ופותחים אותו כאן: כל המוצרים, דמי הניהול שלכם מול השוק וההפקדות, בשקלים ובמילים. הקובץ נקרא בדפדפן ולא יוצא מהמכשיר.</p>
        </div>
        <div className="dcheck-go">
          <Link to="/my/checkup" className="door-go primary">ייבוא מהמסלקה<Ico name="arrow" /></Link>
          <Link to="/my#sv-add-h" className="dcheck-alt">או לבחור מוצר ידנית</Link>
        </div>
      </header>}
      <Cards cards={SAVER_CARDS} label="מה אפשר לבדוק" lead={<FeesCard mine={mine} />} />
      <HomeHint />
      <FundFacts />
      <p className="doors-note">מה שאתם מזינים נשמר בדפדפן הזה בלבד ולא נשלח לשום מקום. <Link className="sv-u" to="/about">מי אנחנו ומאיפה הנתונים</Link></p>
    </div>
  );
}

const AGENT_CARDS: Card[] = [
  ['/funds/compare', 'compare', 'השוואה', 'מסלולים זה לצד זה: תשואה, סיכון, חלונות מתגלגלים ודמי ניהול.'],
  ['/funds/default', 'shield', 'קרנות ברירת מחדל', 'הקרנות שנבחרו במכרז והתנאים שלהן.'],
  ['/managers', 'companies', 'דמי הניהול של הגופים', 'הגופים המנהלים, נכסים ודמי ניהול בפועל לאורך זמן.'],
  ['/funds/trackers', 'market', 'עוקבי מדד', 'אותו מדד בעטיפות שונות: הפער בין המסלולים הוא מחיר העטיפה.'],
  ['/funds/tools', 'sliders', 'כלים', 'דמי ניהול בשקלים, מכרזי ברירת המחדל וחבילת השוואה ל-Excel.'],
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
      <Link to="/funds" className="dtile dtile-hub" id="ahome-hub">
        <ProdIcon art={ART_MONTH} size={42} />
        <span className="dtile-t"><b>החודש בחיסכון</b><small>{asof ? `מה קרה ב${heMonth(asof)}, בכל סוג מסלול` : 'מה קרה החודש, בכל סוג מסלול'}</small></span>
        <span className="dtile-go" aria-hidden="true">›</span>
      </Link>
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
