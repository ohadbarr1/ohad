import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { FeedItem } from '../components/FeedItem';
import { Empty, ErrorBox, Loading, Pick } from '../components/ui';
import { pubLabel } from '../lib/format';
import { DK_HE, eventSource, FEED_TYPES, rowText, TYPE_SHORT, useFeed, type FeedEvent, type FeedType } from '../lib/feed';
import { downloadXlsx, type XCell } from '../lib/xlsx';
import '../styles/feed.css';

const PAGE = 60;

/** The delta feed: every dated change the site's data carries, newest first, filterable by company and event type. */
export function Feed() {
  const { data: F, error } = useFeed();
  const [sp, setSp] = useSearchParams();
  const [n, setN] = useState(PAGE);
  const co = sp.get('co') ?? '', t = (sp.get('t') ?? '') as FeedType | '';
  const set = (k: string, v: string) => { setN(PAGE); setSp((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true }); };
  const byId = useMemo(() => new Map((F?.events ?? []).map((e) => [e.id, e])), [F]);
  const list = useMemo(() => (F?.events ?? []).filter((e) => (!co || e.c === co) && (!t || e.t === t)), [F, co, t]);

  if (error) return <ErrorBox what="פיד השינויים" error={error} />;
  if (!F) return <Loading what="פיד השינויים" />;
  const count = (f: (e: FeedEvent) => boolean) => F.events.reduce((s, e) => s + (f(e) ? 1 : 0), 0);
  const cos = Object.keys(F.cos).filter((c) => count((e) => e.c === c) > 0).sort((a, b) => (a === 'market' ? -1 : b === 'market' ? 1 : (F.cos[a] ?? a).localeCompare(F.cos[b] ?? b, 'he')));
  // grouped by month of the event date, newest first (the file is sorted)
  const shown = list.slice(0, n);
  const groups: [string, FeedEvent[]][] = [];
  for (const e of shown) { const k = e.d.slice(0, 7); if (!groups.length || groups[groups.length - 1][0] !== k) groups.push([k, []]); groups[groups.length - 1][1].push(e); }
  const monthHe = (k: string) => `${k.slice(5, 7)}/${k.slice(2, 4)}`;
  const slot = t === 'est';

  const exportXlsx = () => {
    const head = ['תאריך', 'סוג תאריך', 'סוג', 'חברה', 'אירוע', 'שורה', 'נוכחי', 'השוואה', 'שינוי', 'שינוי %', 'מקור'];
    const body: XCell[][] = list.flatMap((e) => {
      const s = eventSource(F, e), base: XCell[] = [pubLabel(e.d), DK_HE[e.dk], F.types[e.t].he, F.cos[e.c] ?? e.c, e.h];
      const rows = e.rows?.length ? e.rows : [null];
      return rows.map((r) => [...base, ...(r ? rowText(r) : ['', '', '', '', '']), s.href ? { v: s.text, link: s.href } : s.text]);
    });
    downloadXlsx('fox-feed', [{ name: 'מה השתנה', rows: [head.map((h) => ({ v: h, bold: true })), ...body], freeze: { rows: 1, cols: 4 }, widths: [10, 12, 14, 12, 40, 34, 11, 11, 11, 9, 36] }]);
  };

  return (
    <div className="fd">
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="spark" /></span>מה השתנה</h1>
        <div className="sub"><span><span className="num">{F.events.length}</span> שינויים מ-<span className="num">{pubLabel(F.from)}</span></span><span>·</span><span>כל מספר נפתח במקור</span></div></div>
        <div className="fd-actions"><button type="button" className="btn" onClick={exportXlsx}>Excel</button></div>
      </div>

      <section className="controls fd-controls" aria-label="סינון">
        <Pick label="חברה" cap="חברה" value={co} onChange={(v) => set('co', v)}
          options={[['', 'כל החברות', String(F.events.length)], ...cos.map((c) => [c, F.cos[c] ?? c, String(count((e) => e.c === c))] as [string, string, string])]} />
        <div className="fd-types" role="group" aria-label="סוג אירוע">
          <button type="button" className={`chip${!t ? ' on' : ''}`} aria-pressed={!t} onClick={() => set('t', '')}>הכול <span className="num">{count((e) => !co || e.c === co)}</span></button>
          {FEED_TYPES.map((x) => {
            const k = count((e) => e.t === x && (!co || e.c === co));
            const isSlot = !!F.types[x]?.slot;
            return <button key={x} type="button" className={`chip fd-t t-${x}${t === x ? ' on' : ''}`} aria-pressed={t === x} disabled={!isSlot && k === 0} title={isSlot ? 'משבצת ריקה: עדכוני אומדנים ואומדן מול בפועל ייכנסו עם מודול האומדנים' : F.types[x]?.he} onClick={() => set('t', t === x ? '' : x)}>{TYPE_SHORT[x]} <span className="num">{k}</span></button>;
          })}
        </div>
      </section>

      <section className="panel fd-panel">
        <div className="hd"><h2><span className="num">{list.length}</span> שינויים</h2><div className="aside"><span>מהחדש לישן · מיליוני ש"ח (נכסים וצבירה: מיליארד ש"ח) · ערך כפי שהאתר מציג היום, עם עמוד המקור</span></div></div>
        {slot ? <Empty title="אין אומדנים עדיין">משבצת ריקה עד שמודול האומדנים ייכנס</Empty>
          : list.length === 0 ? <Empty title="אין שינויים בסינון זה" />
          : groups.map(([k, es]) => (
            <div className="fd-month" key={k}>
              <h3 className="fd-mh"><span className="num">{monthHe(k)}</span> <span className="dim num">{es.length}</span></h3>
              <ul className="fd-list">{es.map((e) => <FeedItem key={e.id} F={F} e={e} byId={byId} />)}</ul>
            </div>
          ))}
        {list.length > n && <div className="fd-more"><button type="button" className="btn" onClick={() => setN(n + PAGE * 2)}>עוד <span className="num">{Math.min(PAGE * 2, list.length - n)}</span> מתוך <span className="num">{list.length - n}</span></button></div>}
        <p className="src">מקור: {F.source} · תאריך: יום הפרסום במאיה; נתוני הרשות: היום שבו התקבל הקובץ (החודש האחרון) או סוף חודש הנתונים · מעבר בצבירה: LTM, שני החודשים לפחות {F.rules.flow_min_bn * 1000} מיליוני ש"ח מאפס · דמי ניהול: שינוי של {F.rules.fee_min_pp} נק׳ ומעלה, מסלולים מעל {F.rules.fee_assets_m.toLocaleString()} מיליוני ש"ח, בלי חודשי שבר בסדרה · עדכון {pubLabel(F.built)}</p>
      </section>
    </div>
  );
}
