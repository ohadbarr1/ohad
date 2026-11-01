import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { useFundCats, useFunds } from '../lib/useData';
import { useOptional } from '../lib/fundsLoad';
import { useMine, type MyProduct } from '../lib/mine';
import type { CatX, FundX, FundsFile } from '../lib/funds';
import type { DefaultFile } from '../lib/fundsTools';
import { Picker } from '../components/saver/Picker';
import { ProductCard } from '../components/saver/ProductCard';
import { GlossBar } from '../components/saver/Gloss';
import '../styles/saver.css';

/* /my, "המוצרים שלי" (W1 saver door, plan 01.11.26 Exhibit 4): what you have → a report card per product, in plain Hebrew and in ₪.
   The list lives in this browser only (lib/mine). Descriptive, never advice: no "move", no "stay". With nothing saved yet: the picker,
   and one example card clearly marked "דוגמה" (the red team's story: a default pension fund last on 5Y). */
const EXAMPLE = 'p9757';
const today = () => new Date().toISOString().slice(0, 10);

export function My() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cats = useFundCats().data as Record<string, CatX> | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const [mine, setMine] = useMine();
  const [adding, setAdding] = useState(false);
  const loc = useLocation();
  const byK = useMemo(() => new Map(((data?.funds ?? []) as FundX[]).map((f) => [f.k, f])), [data]);
  const list = (Array.isArray(mine) ? mine : []).filter((m) => m && typeof m.k === 'string');

  // a link from the fund card (/my#p9757) lands on that product
  useEffect(() => { if (data && loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: 'start' }); }, [data, loc.hash]);

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
        <div className="sub sv-sub">כמה אתם משלמים, איפה המסלול שלכם עומד מול דומיו, ומה לבקש. במילים ובשקלים. נתוני הרשות לשוק ההון עד {asof}.</div>
      </div></div>

      <p className="sv-privacy"><Icon name="shield" /> הרשימה נשמרת רק בדפדפן הזה. שום נתון לא נשלח, ואין צורך בהרשמה.</p>

      {shown.length > 0 && <div className="sv-list">
        {shown.map(({ m, f }) => f
          ? <ProductCard key={m.k} f={f} data={data} cats={cats} dfile={dfile} my={m} onChange={patch(m.k)} onRemove={() => remove(m.k)} />
          : <div key={m.k} className="panel sv-card sv-gone"><p>המסלול {m.k} כבר לא מופיע בנתוני הרשות ({asof}). ייתכן שנסגר או מוזג.</p><button type="button" className="btn" onClick={() => remove(m.k)}>הסרה מהרשימה</button></div>)}
      </div>}

      <section className="panel sv-add" aria-labelledby="sv-add-h">
        <div className="hd"><h2 id="sv-add-h">{shown.length ? 'עוד מוצר' : 'מה יש לך?'}</h2><div className="aside"><span>פנסיה, השתלמות, גמל ופוליסות</span></div></div>
        {shown.length && !adding ? <button type="button" className="btn" onClick={() => setAdding(true)}>+ הוספת מוצר</button>
          : <Picker funds={data.funds as FundX[]} have={list.map((m) => m.k)} onPick={add} />}
      </section>

      {shown.length === 0 && ex && <section className="sv-exwrap" aria-label="דוגמה">
        <p className="sv-exlead">כך נראה כרטיס של מוצר. <b>זו דוגמה, לא המוצר שלך:</b> קרן פנסיה אמיתית מהנתונים, עם דמי הניהול הממוצעים בה.</p>
        <ProductCard f={ex} data={data} cats={cats} dfile={dfile} example onAdd={() => add(EXAMPLE)} />
      </section>}

      <GlossBar />
      <p className="sv-legal">המידע כאן תיאורי: מקום, דמי ניהול ותנאים, מתוך נתוני רשות שוק ההון ומקורות שמסומנים לצד כל מספר. אין כאן ייעוץ השקעות, ייעוץ פנסיוני או שיווק פנסיוני, ואין המלצה לעבור או להישאר. האומדנים מבוססים על הנחות שמוצגות לצדם. <Link to="/about">על האתר והמקורות</Link></p>
    </div>
  );
}
