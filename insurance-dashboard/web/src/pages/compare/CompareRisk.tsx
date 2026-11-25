import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { CompareGrid, type CompareGridRow } from '../../components/CompareGrid';
import { Sourced } from '../../components/Source';
import { Tip } from '../../components/Explain';
import { Seg } from '../../components/ui';
import type { Prov } from '../../lib/prov';
import { useStored } from '../../lib/local';
import { usePhone } from '../../lib/useMedia';
import { expP, fundP } from '../../lib/market';
import { nf } from '../../lib/format';
import { pc, refOf, ym, useBasis, type Basis } from '../../lib/funds';
import { rulesOf } from '../../lib/productRules';
import {
  BottomLinePanel, GrowthPanel, KpiPanel, PairsPanel, RiskTable, RollingPanel, ROLL_EMPTY, UnderwaterPanel, WinSeg, YearsPanel, axisOf, exportPack,
  sharpeOf, TaxLiqPanel, useCompareData, useKpiRows, type CompareData, type Item, type Win,
} from './panels';
import { extremes } from './extremes';
import { trackColor, trackLabels } from './tracks';
import type { CmpCtx } from './contract';
import '../../styles/compare.css';
import '../../styles/compare-risk.css';

/* The Pro "סיכון" lens (D3; spec §8 Pro door, §10A.2 D2/D3, mockup v3 frame 30). Nothing the Pro compare page had before the redesign is
   lost (the list-diff test, scratchpad build/L3b/labels.cjs, against the snapshot L2a/pro_labels_before_full.json), and the phone stays calm:
   - Head: the Pro switch "להחלטה | סיכון" and the pill "תצוגה פשוטה: חוסך ›" (door saver, same tracks, back to the month table). The same
     markup as lane L3-a's LensHead (cmp-lhead, #lens-switch, #simple-hint.cmp-hintp), so the two lenses read as one.
   - At a glance (mockup v3): one CompareGrid card: sd and Sharpe as the regulator publishes them; the worst and the best month and the
     largest drop over the 60 months to the data month (computed here from the monthly returns, net or gross as the page shows; pure
     ./extremes); equity, abroad and FX exposure; the 5Y percentile in the category (computed by the data build, with the count of ranked
     tracks). Leads are marked only inside one category.
   - Below, every block of the old Pro page, each a collapsed section (a 44-px header with a one-line "what is inside"), mounted only when
     opened so a phone draws no hidden chart: risk 36M (Sortino, beta, tracking error, capture…), rolling 12M/36M, pair win rates, under
     the peak, growth of 100, by year, the bottom line with every KPI, tax and liquidity. The window ("1Y … הכול") and net / gross sit
     once above them. Which sections are open, and the window, are remembered in this browser only.
   - One export menu: the comparison pack for Excel (live formulas), per chart PNG / SVG / PPTX / CSV / "+ לספר", per table CSV / Excel.
     The menu drives each block's own exporter (components/Chart, components/DataTable; their toolbars are hidden in this lens), so every
     file keeps the site's title, source bar and stamp. A collapsed block is opened first, then exported.
   Every figure opens its source (Sourced / Chart onPoint), as everywhere on the site. */

type SecId = 'risk36' | 'roll' | 'pairs' | 'dd' | 'growth' | 'years' | 'kpi' | 'tax';
const mmyy = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WIN_SHORT: Record<Win, string> = { '12': '1Y', '36': '3Y', '60': '5Y', '120': '10Y', max: 'הכול' };

/** The head of the agent / Pro lenses: the Pro switch and the way back to the simple view (same markup as L3-a's LensHead). */
export function RiskLensHead({ door, view, setView, setDoor }: Pick<CmpCtx, 'door' | 'view' | 'setView' | 'setDoor'>) {
  return (
    <div className="cmp-lhead">
      {door === 'pro' ? (
        <div className="cmp-lsw" id="lens-switch" role="tablist" aria-label="מקצועי">
          <button type="button" role="tab" aria-selected={view === 'dec'} className={view === 'dec' ? 'on' : undefined} onClick={() => setView?.('dec')}>להחלטה</button>
          <button type="button" role="tab" aria-selected={view !== 'dec'} className={view !== 'dec' ? 'on' : undefined} onClick={() => setView?.('risk')}>סיכון</button>
        </div>
      ) : <span />}
      <button type="button" id="simple-hint" className="cmp-hintp" onClick={() => setDoor?.('saver')}>תצוגה פשוטה: חוסך ›</button>
    </div>
  );
}

export function CompareRisk(props: CmpCtx) {
  const { keys, basis } = props;
  const d = useCompareData(keys, basis);
  const head = <RiskLensHead door={props.door} view={props.view ?? 'risk'} setView={props.setView} setDoor={props.setDoor} />;
  const shell = (body: ReactNode, role?: 'status' | 'alert') => <div className="cr" id="lens-risk">{head}<div className="cr-empty" role={role}>{body}</div></div>;
  if (!d) return shell('טוען…', 'status');
  if ('error' in d) return shell('הנתונים לא נטענו. נסו לרענן את העמוד.', 'alert');
  if (!keys.length) return shell('בחרו מסלולים כדי לראות את הסיכון שלהם.');
  if (!d.items.length) return shell(d.loadingN > 0 ? 'טוען היסטוריות…' : 'המסלולים לא נמצאו בנתונים.', 'status');
  return <RiskBody d={d} ctx={props} head={head} />;
}

function RiskBody({ d, ctx, head }: { d: CompareData; ctx: CmpCtx; head: ReactNode }) {
  const phone = usePhone();
  const [, setBasis] = useBasis();
  const [win, setWin] = useStored<Win>('cmp:risk:win', '60');
  const [opened, setOpened] = useStored<Partial<Record<SecId, boolean>>>('cmp:risk:open', {});
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const kp = useKpiRows(d, 'pro', win);
  const { items, asof, netAsk, lbl, sameCat } = d;
  const labels = useMemo(() => trackLabels(items.map((it) => it.f)), [items]);
  const cols = items.map((it, i) => ({ k: it.f.k, label: labels[i] || it.f.grp, color: trackColor(i) }));
  const itemOf = (k: string) => items.find((it) => it.f.k === k)!;
  const isOpen = (s: SecId) => !!opened[s];
  const setOpen = (s: SecId, v: boolean) => setOpened({ ...opened, [s]: v });
  const axisLen = axisOf(items, win).length;
  const say = (t: string, ms = 2200) => { setBusy(t); setTimeout(() => setBusy((c) => (c === t ? null : c)), ms); };

  /* ---- at a glance: the mockup's rows ---- */
  const ext = useMemo(() => new Map(items.map((it) => { const end = Math.min(it.f.end ?? asof, asof); return [it.f.k, { end, ...extremes(it.h.p, it.y, end, 60) }] as const; })), [items, asof]);
  const extSrc = (it: Item, what: 'worst' | 'best' | 'mdd'): (() => Prov) => () => {
    const e = ext.get(it.f.k)!, x = e[what]!;
    const title = what === 'worst' ? 'החודש הגרוע' : what === 'best' ? 'החודש הטוב' : 'ירידה מרבית';
    const ms = it.h.p.filter((p, i) => p <= e.end && it.y[i] != null).slice(-60);
    return { k: 'calc', est: netAsk, title: `${title}, ${e.n} חודשים עד ${mmyy(e.end)} · ${it.f.name}`, value: pc(x.v, what === 'mdd' ? 1 : 2),
      formula: what === 'mdd' ? `הירידה הגדולה ביותר של מדד התשואה המצטברת (${lbl}) משיאו לשפל שאחריו, ב-${e.n} החודשים שמסתיימים ב-${mmyy(e.end)}; השפל ב-${mmyy(x.p)}`
        : `התשואה החודשית ה${what === 'worst' ? 'נמוכה' : 'גבוהה'} ביותר (${lbl}) ב-${e.n} החודשים שמסתיימים ב-${mmyy(e.end)}`,
      inputs: what === 'mdd' ? ms.map((p) => d.monthRow(it, p)) : [d.monthRow(it, x.p)] };
  };
  const pctOf = (it: Item) => ({ v: (netAsk ? it.f.pn : it.f.pr)?.a5 ?? null, n: (netAsk ? it.f.pnn : it.f.prn)?.a5 ?? null });
  const sgn = (v: number) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');
  const fig = (src: (() => Prov) | null, t: string, cls = '', sub?: string) => (
    src ? <Sourced src={src}><span className={`num ${cls}`.trim()}>{t}</span>{sub ? <small className="cr-sub">{sub}</small> : null}</Sourced> : <span className="muted">{t}</span>
  );
  const extCell = (k: string, what: 'worst' | 'best' | 'mdd') => { const x = ext.get(k)?.[what]; return x ? fig(extSrc(itemOf(k), what), pc(x.v, what === 'mdd' ? 1 : 2), sgn(x.v), mmyy(x.p)) : fig(null, '–'); };
  const expCell = (k: string, key: 'st' | 'fo' | 'fx') => {
    const f = itemOf(k).f, v = f[key];
    const [col, name] = key === 'st' ? ['STOCK_MARKET_EXPOSURE', 'חשיפה למניות'] : key === 'fo' ? ['FOREIGN_EXPOSURE', 'חשיפה לחו"ל'] : ['FOREIGN_CURRENCY_EXPOSURE', 'חשיפה למט"ח'];
    return v == null ? fig(null, '–') : fig(() => expP(refOf(f), f.end ?? asof, col, name, v, f.assets), nf(v, 1) + '%');
  };
  const few = [...ext.values()].some((e) => e.n > 0 && e.n < 60);
  const glance: CompareGridRow[] = [
    { key: 'sd', label: 'סטיית תקן (כפי שפורסם)', better: 'lo', value: (k) => itemOf(k).f.sd, cell: (k) => { const f = itemOf(k).f; return f.sd == null ? fig(null, '–') : fig(() => fundP(refOf(f), f.end ?? asof, 'STANDARD_DEVIATION', 'סטיית תקן', nf(f.sd!, 2)), nf(f.sd, 2)); } },
    { key: 'sharpe', label: 'שארפ (כפי שפורסם)', better: 'hi', value: (k) => sharpeOf(itemOf(k).f), cell: (k) => { const f = itemOf(k).f, v = sharpeOf(f); return v == null ? fig(null, '–') : fig(() => fundP(refOf(f), f.end ?? asof, 'SHARPE_RATIO', 'שארפ', nf(v, 2)), nf(v, 2)); } },
    { key: 'worst', label: 'החודש הגרוע, 60M', better: 'hi', value: (k) => ext.get(k)?.worst?.v ?? null, cell: (k) => extCell(k, 'worst') },
    { key: 'best', label: 'החודש הטוב, 60M', better: 'hi', value: (k) => ext.get(k)?.best?.v ?? null, cell: (k) => extCell(k, 'best') },
    { key: 'mdd', label: 'ירידה מרבית, 60M', better: 'hi', band: 0.05, value: (k) => ext.get(k)?.mdd?.v ?? null, cell: (k) => extCell(k, 'mdd') },
    { key: 'st', label: 'מניות', cell: (k) => expCell(k, 'st') },
    { key: 'fo', label: 'חו״ל', cell: (k) => expCell(k, 'fo') },
    { key: 'fx', label: 'מט״ח', cell: (k) => expCell(k, 'fx') },
    { key: 'pct5', label: 'אחוזון 5Y בקטגוריה', sub: '100 = הגבוה', better: 'hi', value: (k) => pctOf(itemOf(k)).v, cell: (k) => {
      const it = itemOf(k), p = pctOf(it);
      return p.v == null ? fig(null, '–') : fig(() => ({ k: 'calc', est: netAsk, title: `אחוזון 5Y${netAsk ? ', נטו' : ''} בקטגוריה · ${it.f.name}`, value: nf(p.v!, 0),
        formula: 'מחושב בבניית הנתונים: מקום התשואה השנתית הממוצעת של 5 השנים בין מסלולי הקטגוריה באותו חודש; 100 = הגבוהה בקטגוריה, 0 = הנמוכה',
        inputs: [{ label: 'מסלולים מדורגים', v: p.n == null ? '–' : nf(p.n, 0) }, { label: `תשואה 5Y, שנתי (${lbl})`, v: pc(d.kret(it, 'a5').v), src: d.kret(it, 'a5').src }] }), nf(p.v, 0), '', p.n != null ? `מתוך ${p.n}` : undefined); } },
  ];

  /* ---- the sections ---- */
  const pairsN = (items.length * (items.length - 1)) / 2;
  const hasRules = rulesOf(items.map((it) => it.f.prod)).length > 0;
  const noAxis = <div className="cr-none">{ROLL_EMPTY}</div>;
  const SECS: { id: SecId; title: string; tip?: string; sub: string; body: () => ReactNode; chart?: boolean; table?: boolean }[] = [
    { id: 'risk36', title: 'סיכון, 36 חודשים', tip: 'sd', sub: 'תנודתיות, ירידה מרבית, סורטינו, בטא, סטיית מעקב, לכידת עליות וירידות', body: () => <RiskTable d={d} /> },
    { id: 'roll', title: 'תשואה מתגלגלת', tip: 'rolling', sub: '12M · 36M, שנתי · גרף', chart: true, body: () => <RollingPanel d={d} win={win} /> },
    { id: 'pairs', title: 'מי ניצח בחלונות של 36 חודשים', tip: 'winrate', sub: pairsN ? `${pairsN} ${pairsN === 1 ? 'זוג' : 'זוגות'} · 36M · 12M` : 'הוסיפו מסלול שני', body: () => <PairsPanel d={d} mode="pro" /> },
    { id: 'dd', title: 'מתחת לשיא', tip: 'underwater', sub: 'כמה ירד כל מסלול מהשיא שלפניו · גרף', chart: true, body: () => (axisLen > 2 ? <UnderwaterPanel d={d} win={win} /> : noAxis) },
    { id: 'growth', title: 'צמיחה של 100 ש"ח', tip: 'growth', sub: 'בלי הפקדות · גרף', chart: true, body: () => (axisLen > 2 ? <GrowthPanel d={d} win={win} /> : noAxis) },
    { id: 'years', title: 'לפי שנה', sub: 'תשואה בכל שנה קלנדרית, עד 12 שנים', table: true, body: () => <YearsPanel d={d} /> },
    { id: 'kpi', title: 'השורה התחתונה וכל המדדים', sub: 'דמי ניהול, 5Y, 3Y, LTM, שארפ' + (kp.anyPension ? ', איזון אקטוארי, שירות, קצבה' : ''), table: !phone,
      body: () => <><BottomLinePanel d={d} kp={kp} mode="pro" /><KpiPanel d={d} kp={kp} mode="pro" phone={phone} /></> },
    ...(hasRules ? [{ id: 'tax' as const, title: 'מיסוי ונזילות', tip: 'taxliq', sub: 'כלל עיקרי לכל מוצר', body: () => <TaxLiqPanel d={d} /> }] : []),
  ];
  const winApplies = (s: SecId) => s === 'roll' || s === 'dd' || s === 'growth' || s === 'kpi';

  /* ---- one export menu: drives each block's own exporter ---- */
  const fire = async (sec: SecId, what: string, label: string) => {
    setBusy(`${label}…`);
    if (!isOpen(sec)) setOpen(sec, true);
    const chart = !!SECS.find((s) => s.id === sec)?.chart;
    for (let i = 0; i < 60; i++) {
      await wait(100);
      const root = document.querySelector(`#lens-risk [data-sec="${sec}"]`);
      if (!root || (chart && !root.querySelector('canvas, svg'))) continue;
      const btns = [...root.querySelectorAll<HTMLElement>(chart ? '.charttools button, .charttools a' : '.dt-export button')];
      const b = what === 'book' ? btns.find((x) => x.classList.contains('tobook') || x.classList.contains('booked')) : btns.find((x) => x.textContent?.trim() === what);
      if (!b) continue;
      if (b.classList.contains('booked')) { say(`${label}: כבר בספר הגרפים`); return; }
      if (chart) await wait(250);   // the chart draws one frame after it mounts
      b.click();
      say(`${label}: ${what === 'book' ? 'נוסף לספר הגרפים' : 'הקובץ הורד'}`);
      return;
    }
    say(`${label}: לא זמין כאן`);
  };
  const charts = axisLen > 2 ? SECS.filter((s) => s.chart) : [];
  const tables = SECS.filter((s) => s.table);

  return (
    <div className="cr" id="lens-risk">
      {head}

      <div className="cr-card" id="risk-glance">
        <div className={`cr-gw${cols.length > 4 ? ' many' : ''}`} style={{ '--n': cols.length } as CSSProperties}>
          <CompareGrid id="risk-grid" cols={cols} rows={glance} mark={sameCat} corner={<span className="cr-corner">{netAsk ? 'נטו' : 'ברוטו'}<br /><span className="num">{ym(asof)}</span></span>} onCol={(k) => ctx.openSheet({ t: 'track', k })} />
        </div>
        <p className="cr-note">
          סטיית תקן ושארפ: כפי שהרשות מפרסמת. 60M: 60 החודשים עד {mmyy(asof)}, {lbl}{few ? '; מסלול צעיר יותר: על החודשים שיש לו' : ''}. מניות, חו״ל ומט״ח: % מהנכסים. {sameCat ? 'מסומן: הטוב בשורה.' : 'מסלולים מקטגוריות שונות: בלי סימון.'}
        </p>
      </div>

      <div className="cr-ctl" id="risk-controls">
        <div className="cr-ctl-g"><span className="cr-ctl-l">חלון</span><WinSeg value={win} onChange={setWin} /></div>
        <Seg<Basis> label="נטו או ברוטו" value={ctx.basis} onChange={setBasis} options={[['net', 'נטו'], ['gross', 'ברוטו']]} />
        <button type="button" className={`cr-exp${menu ? ' on' : ''}`} id="risk-export-btn" aria-expanded={menu} aria-controls="risk-export" onClick={() => setMenu(!menu)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>ייצוא<small>Excel · PNG · SVG · PPTX · CSV</small>
        </button>
      </div>

      {menu && (
        <div className="cr-menu" id="risk-export" role="region" aria-label="ייצוא">
          <button type="button" className="cr-mbig" id="risk-pack" onClick={() => { setBusy('Excel…'); void exportPack(d).then(() => say('Excel: הקובץ הורד'), () => say('Excel: שגיאה')); }}>
            <b>Excel: חבילת השוואה (נוסחאות חיות)</b><small>לכל מסלול: ברוטו, דמי ניהול ונטו בכל חודש, מדדים וירידות, ומקורות</small>
          </button>
          {charts.map((s) => (
            <div className="cr-mrow" key={s.id}>
              <span className="cr-mt">{s.title}</span>
              <span className="cr-mb">{['PNG', 'SVG', 'PPTX', 'CSV'].map((w) => <button type="button" key={w} onClick={() => void fire(s.id, w, `${w} · ${s.title}`)}>{w}</button>)}
                <button type="button" onClick={() => void fire(s.id, 'book', s.title)}>+ לספר</button></span>
            </div>
          ))}
          {tables.map((s) => (
            <div className="cr-mrow" key={s.id}>
              <span className="cr-mt">{s.id === 'kpi' ? 'זה מול זה' : s.title}</span>
              <span className="cr-mb">{['CSV', 'Excel'].map((w) => <button type="button" key={w} onClick={() => void fire(s.id, w, `${w} · ${s.id === 'kpi' ? 'זה מול זה' : s.title}`)}>{w}</button>)}</span>
            </div>
          ))}
          <div className="cr-mrow"><span className="cr-mt">קישור לתצוגה הזו</span><span className="cr-mb"><button type="button" onClick={() => { void navigator.clipboard?.writeText(location.href).then(() => say('הקישור הועתק'), () => say('הקישור לא הועתק')); }}>העתקה</button></span></div>
          <p className="cr-mnote">כל קובץ נושא כותרת, שורת מקור ותאריך. חלק סגור נפתח ואז מיוצא.</p>
        </div>
      )}
      <div className="cr-busy" role="status" aria-live="polite">{busy}</div>

      <div className="cr-secs">
        {SECS.map((s) => {
          const on = isOpen(s.id);
          return (
            <section key={s.id} className={`cr-sec${on ? ' open' : ''}`} data-sec={s.id} aria-labelledby={`crh-${s.id}`}>
              <div className="cr-sh">
                <button type="button" className="cr-tg" id={`crh-${s.id}`} aria-expanded={on} aria-controls={`crb-${s.id}`} onClick={() => setOpen(s.id, !on)}>
                  <span className="cr-tt"><b>{s.title}</b><small>{s.sub}{winApplies(s.id) ? ` · חלון ${WIN_SHORT[win]}` : ''}</small></span>
                  <svg className="cr-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {s.tip ? <Tip k={s.tip} /> : null}
              </div>
              {on ? <div className="cr-sb" id={`crb-${s.id}`}>{s.body()}</div> : null}
            </section>
          );
        })}
      </div>

      <div className="cr-stamp">מקור: הרשות לשוק ההון, נכון ל-{ym(asof)}. {netAsk ? 'נטו: אומדן של האתר.' : 'ברוטו: לפני דמי ניהול.'} עובדות היסטוריות, לא תחזית ולא המלצה.</div>
    </div>
  );
}
