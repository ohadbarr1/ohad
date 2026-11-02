import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { FeedItem, perText } from '../components/FeedItem';
import { Empty, ErrorBox, Loading, Pick } from '../components/ui';
import { pubLabel } from '../lib/format';
import { DK_HE, eventSource, FEED_TYPES, rowText, TYPE_SHORT, useFeed, type FeedEvent, type FeedType } from '../lib/feed';
import { downloadXlsx, type XCell } from '../lib/xlsx';
import { feedPath, useFeedAlternate, type SeenFile } from '../lib/news';
import { useLoad } from '../lib/useData';
import '../styles/alerts.css';
import { Subscriptions } from '../components/Subscriptions';
import '../styles/feed.css';

const PAGE = 60;

/** The delta feed: every dated change the site's data carries, newest first, filterable by company and event type. */
export function Feed() {
  const { data: F, error } = useFeed();
  const { data: S } = useLoad<SeenFile>('feed_seen.json');
  const [sp, setSp] = useSearchParams();
  const [n, setN] = useState(PAGE);
  const co = sp.get('co') ?? '', t = (sp.get('t') ?? '') as FeedType | '';
  const set = (k: string, v: string) => { setN(PAGE); setSp((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true }); };
  const byId = useMemo(() => new Map((F?.events ?? []).map((e) => [e.id, e])), [F]);
  const list = useMemo(() => (F?.events ?? []).filter((e) => (!co || e.c === co) && (!t || e.t === t)), [F, co, t]);
  // the RSS of the filter in view: a company's feed, the regulator's months, the fee changes, else everything (pipeline/build_rss.py)
  const rss = feedPath(co ? { co } : { t });
  useFeedAlternate(co || t === 'regmonth' || t === 'fee' ? rss.rss : null, `fox · ${co ? F?.cos[co] ?? co : rss.label}`);

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
    const head = ['התקבל ב-fox', 'תאריך', 'סוג תאריך', 'תקופה', 'סוג', 'חברה', 'אירוע', 'שורה', 'נוכחי', 'השוואה', 'שינוי', 'שינוי %', 'מקור'];
    const body: XCell[][] = list.flatMap((e) => {
      const g = S?.seen[e.id], s = eventSource(F, e), base: XCell[] = [g?.[1] === 'r' ? pubLabel(g[0]) : '', pubLabel(e.d), DK_HE[e.dk], perText(e), F.types[e.t].he, F.cos[e.c] ?? e.c, e.h];
      const rows = e.rows?.length ? e.rows : [null];
      return rows.map((r) => [...base, ...(r ? rowText(r) : ['', '', '', '', '']), s.href ? { v: s.text, link: s.href } : s.text]);
    });
    downloadXlsx('fox-feed', [{ name: 'מה השתנה', rows: [head.map((h) => ({ v: h, bold: true })), ...body], freeze: { rows: 1, cols: 6 }, widths: [10, 10, 12, 9, 14, 12, 40, 34, 11, 11, 11, 9, 36] }]);
  };

  return (
    <div className="fd">
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="spark" /></span>מה השתנה</h1>
        <div className="sub"><span><span className="num">{F.events.length}</span> שינויים מ-<span className="num">{pubLabel(F.from)}</span></span><span>·</span><span>כל מספר נפתח במקור</span></div></div>
        <div className="fd-actions"><a className="btn fd-rss-btn" href={rss.rss} type="application/rss+xml" title={`פיד RSS: ${co ? F.cos[co] ?? co : rss.label}`}>RSS</a><button type="button" className="btn" onClick={exportXlsx}>Excel</button></div>
      </div>

      <section className="controls fd-controls" aria-label="סינון">
        <Pick label="חברה" cap="חברה" value={co} onChange={(v) => set('co', v)}
          options={[['', 'כל החברות', String(F.events.length)], ...cos.map((c) => [c, F.cos[c] ?? c, String(count((e) => e.c === c))] as [string, string, string])]} />
        <a className="fd-rss" href={co ? `/feed/${co}.xml` : '/feed.xml'} type="application/rss+xml">RSS {co ? F.cos[co] ?? co : 'כל השינויים'}</a>
        <div className="fd-types" role="group" aria-label="סוג אירוע">
          <button type="button" className={`chip${!t ? ' on' : ''}`} aria-pressed={!t} onClick={() => set('t', '')}>הכול <span className="num">{count((e) => !co || e.c === co)}</span></button>
          {FEED_TYPES.map((x) => {
            const k = count((e) => e.t === x && (!co || e.c === co));
            const isSlot = !!F.types[x]?.slot;
            const chip = <button key={x} type="button" className={`chip fd-t t-${x}${t === x ? ' on' : ''}`} aria-pressed={t === x} disabled={!isSlot && k === 0} title={isSlot ? 'משבצת ריקה: עדכוני אומדנים ואומדן מול בפועל ייכנסו עם מודול האומדנים' : F.types[x]?.he} onClick={() => set('t', t === x ? '' : x)}>{TYPE_SHORT[x]} <span className="num">{k}</span></button>;
            // the two types with a feed of their own carry its link next to the chip
            const own = x === 'regmonth' ? '/feed/months.xml' : x === 'fee' ? '/feed/funds.xml' : null;
            return own ? <span key={x} className="fd-tw">{chip}<a className="fd-rss" href={own} type="application/rss+xml" aria-label={`RSS: ${F.types[x]?.he}`}>RSS</a></span> : chip;
          })}
        </div>
      </section>

      <section className="panel fd-panel">
        <div className="hd"><h2><span className="num">{list.length}</span> שינויים</h2><div className="aside"><span>מהחדש לישן · מיליוני ש"ח (נכסים וצבירה: מיליארד ש"ח) · ערך כפי שהאתר מציג היום, עם עמוד המקור</span></div></div>
        <p className="fd-legend"><b>התקבל</b>: היום שבו fox קלטה את השינוי, מ-<span className="num">{S ? pubLabel(S.since) : '…'}</span> ואילך. לפני כן מוצג תאריך האירוע עצמו: <b>פורסם</b> במאיה, או <b>חודש נתונים</b> · <b>תקופה</b>: התקופה שהנתון מתאר</p>
        {slot ? <Empty title="אין אומדנים עדיין">משבצת ריקה עד שמודול האומדנים ייכנס</Empty>
          : list.length === 0 ? <Empty title="אין שינויים בסינון זה" />
          : groups.map(([k, es]) => (
            <div className="fd-month" key={k}>
              <h3 className="fd-mh"><span className="num">{monthHe(k)}</span> <span className="dim num">{es.length}</span></h3>
              <ul className="fd-list">{es.map((e) => <FeedItem key={e.id} F={F} e={e} byId={byId} got={S?.seen[e.id] ?? ['', 'b']} />)}</ul>
            </div>
          ))}
        {list.length > n && <div className="fd-more"><button type="button" className="btn" onClick={() => setN(n + PAGE * 2)}>עוד <span className="num">{Math.min(PAGE * 2, list.length - n)}</span> מתוך <span className="num">{list.length - n}</span></button></div>}
        <p className="src">מקור: {F.source} · תאריך: יום הפרסום במאיה; נתוני הרשות: היום שבו התקבל הקובץ (החודש האחרון) או סוף חודש הנתונים · מעבר בצבירה: LTM, שני החודשים לפחות {F.rules.flow_min_bn * 1000} מיליוני ש"ח מאפס · דמי ניהול: שינוי של {F.rules.fee_min_pp} נק׳ ומעלה, מסלולים מעל {F.rules.fee_assets_m.toLocaleString()} מיליוני ש"ח, בלי חודשי שבר בסדרה · עדכון {pubLabel(F.built)}</p>
      </section>
      <Subscriptions />
    </div>
  );
}
