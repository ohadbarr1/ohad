import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Star } from '../components/Follow';
import { readStored, storedKeys, useStoreTick, useWatchlist, writeStored } from '../lib/local';
import { removeNote, useFactNotes } from '../lib/notes';
import { idCss } from '../lib/identity';
import { useTheme } from '../lib/theme';
import { useRegistry } from '../lib/useData';
import { pubLabel } from '../lib/format';
import { signIn, signOut, syncNow, useAuth, type AuthState } from '../lib/auth';
import { LOCAL_ONLY } from '../lib/syncConfig';
import '../styles/notes.css';
import '../styles/mine.css';

interface Item { key: string; label: ReactNode; meta?: ReactNode; to: string; text?: string; remove?: () => void; co?: string }

const KIND: Record<string, string> = { insurance_group: 'ביטוח', fund_house: 'בית השקעות' };
const AREA: Record<string, string> = { company: 'חברה', industry: 'ענף', doc: 'מסמך', valuation: 'הערכת שווי', funds: 'קופות', managers: 'קופות', book: 'ספר הגרפים', restatements: 'הצגות מחדש', presentations: 'מצגות', calendar: 'לוח דיווחים', data: 'נתונים ואיכות', search: 'חיפוש' };
const VAL: [RegExp, string, string][] = [
  [/^val\.ri\.(.+)$/, 'הכנסה שיורית', '/ri'], [/^val\.dcf\.(.+)$/, 'DCF', '/dcf'], [/^val\.sotp\.v3\.(.+)$/, 'סכום החלקים', '/sotp'],
  [/^val\.px\.(.+)$/, 'P/B · מחיר ידני', ''], [/^val\.roe\.(.+)$/, 'P/B · ROE ידני', ''],
];
const empty = (v: unknown) => v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.values(v as object).some((x) => x != null && x !== 0 && x !== 'ltm'));

/** "שלי": what the reader keeps — companies followed, saved views, recent pages, notes — one tap from each. Works from this browser's
 *  storage today; follows the reader between devices once sync is switched on. */
export function Mine() {
  const tick = useStoreTick();
  const reg = useRegistry();
  const { theme } = useTheme();
  const watch = useWatchlist();
  const facts = useFactNotes();
  const names = useMemo(() => new Map(reg.data?.map((c) => [c.id, c])), [reg.data]);
  const nm = (id: string) => names.get(id)?.name_he ?? id;

  const { views, recent, notes } = useMemo(() => {
    const views: Item[] = [];
    readStored<{ id: string; n: string; q: string }[]>('peers.views', []).forEach((v) => views.push({
      key: `pv:${v.id}`, label: v.n, meta: 'טבלת עמיתים', to: `/industry/peers?${v.q}`,
      remove: () => writeStored('peers.views', readStored<{ id: string }[]>('peers.views', []).filter((x) => x.id !== v.id)),
    }));
    readStored<{ id: string; n: string; ids: string[] }[]>('peers.sets', []).forEach((s) => views.push({
      key: `ps:${s.id}`, label: s.n, meta: <>קבוצת עמיתים · <span className="num">{s.ids.length}</span> חברות</>, to: `/industry/peers?s=${encodeURIComponent(s.id)}`,
      remove: () => writeStored('peers.sets', readStored<{ id: string }[]>('peers.sets', []).filter((x) => x.id !== s.id)),
    }));
    storedKeys('fin.views.').forEach((k) => {
      const co = k.slice('fin.views.'.length);
      readStored<{ n: string; q: string }[]>(k, []).forEach((v) => views.push({
        key: `fv:${co}:${v.n}`, label: v.n, meta: `${nm(co)} · דוחות כספיים`, to: `/company/${co}/financials?${v.q}`, co,
        remove: () => writeStored(k, readStored<{ n: string }[]>(k, []).filter((x) => x.n !== v.n)),
      }));
    });
    const book = readStored<{ title?: string; items?: unknown[] }>('book', {});
    if (book.items?.length) views.push({ key: 'book', label: book.title || 'ספר הגרפים', meta: <>ספר הגרפים · <span className="num">{book.items.length}</span> גרפים</>, to: '/book' });
    storedKeys('val.').forEach((k) => {
      if (k.includes('.ok.')) return;
      const hit = VAL.find(([re]) => re.test(k));
      if (!hit || empty(readStored<unknown>(k, null))) return;
      const co = k.match(hit[0])![1];
      views.push({ key: k, label: `${nm(co)} · ${hit[1]}`, meta: 'הערכת שווי · הנחות שלי', to: `/valuation/${co}${hit[2]}`, co, remove: () => writeStored(k, undefined) });
    });
    if (!empty(readStored<unknown>('val.assume', null))) views.push({ key: 'val.assume', label: 'הנחות P/B מוצדק', meta: 'הערכת שווי · לכל החברות', to: '/valuation', remove: () => writeStored('val.assume', undefined) });

    const recent: Item[] = readStored<{ p: string; t: string }[]>('recent', []).slice(0, 8).map((r) => {
      const seg = r.p.split('/'), co = seg[1] === 'company' || seg[1] === 'valuation' ? seg[2] : undefined;
      return { key: `r:${r.p}`, label: r.t, meta: AREA[seg[1]] ?? 'עמוד', to: r.p, co };
    });
    const qs: Item[] = readStored<string[]>('recentq', []).slice(0, 6).map((q) => ({ key: `q:${q}`, label: q, meta: 'חיפוש', to: `/search?q=${encodeURIComponent(q)}` }));

    const notes: Item[] = storedKeys('notes:').map((k) => ({ k, t: readStored<string>(k, '') })).filter((x) => x.t.trim()).map(({ k, t }) => {
      const co = k.slice('notes:'.length);
      return { key: k, co, label: nm(co), meta: 'הערות על החברה', text: t.trim(), to: `/company/${co}`, remove: () => writeStored(k, undefined) };
    });
    return { views, recent: [...recent, ...qs], notes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, names]);

  const factItems: Item[] = facts.map((n) => ({
    key: `n:${n.key}`, co: n.co, label: <>{nm(n.co)} · {n.l ?? n.m} · <span className="num">{n.p}</span></>, meta: pubLabel(new Date(n.at).toISOString()), text: n.t,
    to: n.href ?? `/company/${n.co}`, remove: () => removeNote(n.key),
  }));
  const allNotes = [...factItems, ...notes];
  const dot = (co?: string) => (co && names.has(co) ? <i className="mi-dot" style={{ background: idCss(co, theme) }} aria-hidden="true" /> : null);

  return (
    <div className="mine">
      <div className="pagehead">
        <div>
          <h1>שלי</h1>
          <div className="sub">
            <span><span className="num">{watch.ids.length}</span> במעקב</span>·<span><span className="num">{views.length}</span> תצוגות</span>·<span><span className="num">{allNotes.length}</span> הערות</span>
          </div>
        </div>
      </div>

      <SyncCard />

      <div className="mine-grid">
        <Section title="במעקב" n={watch.ids.length} hint={<>★ ליד חברה <Link to="/">בדף הבית</Link> או בעמוד החברה</>}>
          {watch.ids.length > 0 && (
            <ul className="mine-co">
              {watch.ids.map((id) => {
                const c = names.get(id);
                return (
                  <li key={id}>
                    <Link to={`/company/${id}`} className="mi-row">{dot(id)}<span className="mi-l">{nm(id)}</span>{c && <span className="mi-m">{KIND[c.kind]}</span>}</Link>
                    <Star id={id} name={nm(id)} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="תצוגות שמורות" n={views.length} hint={<>שמירה מ<Link to="/industry/peers">טבלת העמיתים</Link>, מדוחות כספיים, מספר הגרפים ומהערכת השווי</>}>
          <Rows items={views} dot={dot} />
        </Section>

        <Section title="הערות" n={allNotes.length} hint={<>+ ליד מספר בטבלת המדדים של חברה, או הערות חופשיות בעמוד החברה</>}>
          <Rows items={allNotes} dot={dot} />
        </Section>

        <Section title="אחרונים" n={recent.length} hint="עמודים, דוחות ומסמכים שנפתחו לאחרונה">
          <Rows items={recent} dot={dot} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, n, hint, children }: { title: string; n: number; hint: ReactNode; children: ReactNode }) {
  return (
    <section className="panel mine-sec" aria-label={title}>
      <div className="hd"><h2>{title}</h2>{n > 0 && <span className="num mine-n">{n}</span>}</div>
      {n > 0 ? children : <p className="mine-empty">{hint}</p>}
    </section>
  );
}

function Rows({ items, dot }: { items: Item[]; dot: (co?: string) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  return (
    <>
      <ul className="mine-rows">
        {shown.map((it) => (
          <li key={it.key}>
            <Link to={it.to} className="mi-row">
              {dot(it.co)}
              <span className="mi-body">
                <span className="mi-l">{it.label}</span>
                {it.text && <span className="mi-t">{it.text}</span>}
                {it.meta && <span className="mi-m">{it.meta}</span>}
              </span>
            </Link>
            {it.remove && <button type="button" className="mi-x" onClick={it.remove} aria-label={`הסרה: ${typeof it.label === 'string' ? it.label : 'פריט'}`} title="הסרה">×</button>}
          </li>
        ))}
      </ul>
      {items.length > 8 && <button type="button" className="linkbtn mine-more" onClick={() => setAll((v) => !v)}>{all ? 'פחות' : <>עוד <span className="num">{items.length - 8}</span></>}</button>}
    </>
  );
}

const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function syncLine(a: AuthState): string {
  const s = a.sync;
  if (!s) return 'מתחבר לשמירה…';
  if (s.state === 'syncing') return 'מסנכרן…';
  if (s.state === 'offline') return `לא מקוון${s.queued ? ` · ${s.queued} ממתינים` : ''}`;
  if (s.state === 'error') return `שגיאת סנכרון${s.error ? ` · ${s.error}` : ''}`;
  return s.last ? `מסונכרן · ${hhmm(s.last)}` : 'מסונכרן';
}

/** Who is signed in and the state of the sync; while sync is off, a backup file moves everything to another device by hand. */
function SyncCard() {
  const a = useAuth();
  return (
    <section className="panel mine-sync" aria-label="סנכרון בין מכשירים">
      <div className="ms-main">
        {a.state === 'off' && <><b>סנכרון בין מכשירים: יופעל בקרוב</b><span className="ms-sub">הכול נשמר בדפדפן הזה. להעברה ידנית: גיבוי לקובץ ושחזור במכשיר השני.</span></>}
        {a.state === 'out' && <><b>סנכרון בין מכשירים</b><span className="ms-sub">התחברות עם Google: המעקב, התצוגות וההערות עוברים בין הטלפון למחשב.</span></>}
        {a.state === 'loading' && <><b>מתחבר…</b><span className="ms-sub">חלון ההתחברות של Google</span></>}
        {a.state === 'error' && <><b>ההתחברות לא הושלמה</b><span className="ms-sub">{a.error}</span></>}
        {a.state === 'in' && <><b>{a.name}</b><span className="ms-sub"><span dir="ltr">{a.email}</span> · {syncLine(a)}</span></>}
      </div>
      <div className="ms-act">
        {(a.state === 'out' || a.state === 'error') && <button type="button" className="btn primary" onClick={() => void signIn()}>התחבר עם Google</button>}
        {a.state === 'in' && <><button type="button" className="btn" onClick={() => void syncNow()}>סנכרון עכשיו</button><button type="button" className="btn ghost" onClick={() => void signOut()}>התנתקות</button></>}
        <Backup />
      </div>
    </section>
  );
}

/** everything kept here as one JSON file, and back */
function Backup() {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const save = () => {
    const data: Record<string, unknown> = {};
    storedKeys().filter((k) => !LOCAL_ONLY.has(k)).forEach((k) => { data[k] = readStored<unknown>(k, null); });
    const blob = new Blob([JSON.stringify({ fox: 1, at: new Date().toISOString(), data }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `fox-mine-${pubLabel(new Date().toISOString()).replace(/\./g, '')}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const load = async (f: File) => {
    try {
      const j = JSON.parse(await f.text()) as { fox?: number; data?: Record<string, unknown> };
      if (j.fox !== 1 || !j.data) throw new Error();
      const ks = Object.keys(j.data).filter((k) => !LOCAL_ONLY.has(k) && /^[\w.:|%~\-֐-׿' ]{1,300}$/.test(k));
      ks.forEach((k) => writeStored(k, j.data![k]));
      setMsg(`שוחזרו ${ks.length} פריטים`);
    } catch { setMsg('הקובץ אינו גיבוי של fox'); }
  };
  return (
    <>
      <button type="button" className="btn ghost" onClick={save}>גיבוי לקובץ</button>
      <button type="button" className="btn ghost" onClick={() => file.current?.click()}>שחזור</button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
      {msg && <span className="ms-msg" role="status">{msg}</span>}
    </>
  );
}
