import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BasisToggle, FundsHead } from '../components/FundsNav';
import { MgrChip } from '../components/MgrChip';
import { CompareRisk } from '../components/FundsTime';
import { Sourced } from '../components/Source';
import { Chart } from '../components/Chart';
import { DataTable, type Column } from '../components/DataTable';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Loading, Panel, Pick, Seg } from '../components/ui';
import { expP, fundP, monthIn, monthsBack, seedHist } from '../lib/market';
import { useSource, type Prov } from '../lib/prov';
import { foxOption } from '../lib/foxchart';
import { chartBase, palette } from '../lib/theme';
import { useMacro } from '../lib/macro';
import { nf, pubLabel } from '../lib/format';
import { load, useFundCats, useFunds } from '../lib/useData';
import {
  GROSS_LABEL, NET_LABEL, NET_NOTE, PERIODS, PER_LABEL, TRAY_MAX, byYear, catKey, cpiFactor, growth, netMonthIn, netProv, netSeries, onAxis, pc, perMonths, refOf, rolling, stats,
  underwater, useBasis, useReal, useTray, winRate, winRet, ym, grossProv, type CatX, type FundX, type FundsFile, type HistX, type Per,
} from '../lib/funds';
import '../styles/lens.css';
import '../styles/market.css';

/* /funds/compare?k=p2009,g103 (funds plan #5, head-to-head v1): two to four tracks, one column each. KPI strip, growth of ₪100 net of
   fee, rolling 12/36-month returns, the fall from the peak, calendar years side by side, and how often one beat the other over every
   rolling 36-month window. All derived from the published monthly returns (net: minus each month's fee ÷ 12), every figure sourced. */

type Win = '12' | '36' | '60' | '120' | 'max';
const WINDOWS: [Win, string][] = [['12', '1Y'], ['36', '3Y'], ['60', '5Y'], ['120', '10Y'], ['max', 'הכול']];
/** a long regulator name cut for a table head (the full name in the tooltip and the KPI strip) */
const short = (n: string) => (n.length > 30 ? n.slice(0, 28).trimEnd() + '…' : n);
interface Item { f: FundX; h: HistX; y: (number | null)[]; ns: ReturnType<typeof netSeries> | null }

export function FundsCompare() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cats = useFundCats().data as Record<string, CatX> | undefined;
  const cpi = useMacro().data?.series.cpi;
  const [sp, setSp] = useSearchParams();
  const tray = useTray();
  const [basis] = useBasis();
  const [real] = useReal();
  const { open } = useSource();
  const keys = useMemo(() => (sp.get('k') ?? '').split(',').filter((k) => /^[gip]\d+$/.test(k)).slice(0, TRAY_MAX), [sp]);
  const winQ = sp.get('win') as Win | null;
  const win: Win = WINDOWS.some(([w]) => w === winQ) ? winQ! : '60';
  const [roll, setRoll] = useState<'12' | '36'>('36');
  const set = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setSp(n, { replace: true }); };
  const setKeys = (ks: string[]) => { const v = [...new Set(ks)].slice(0, TRAY_MAX); set({ k: v.join(',') || null }); tray.set(v); };
  // a bare /funds/compare opens what the tray holds
  useEffect(() => { if (!sp.get('k') && tray.keys.length) set({ k: tray.keys.join(',') }); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // closed tracks are not in funds.json: look them up in funds/closed.json when a key is unknown
  const [gone, setGone] = useState<FundX[]>([]);
  const missing = data ? keys.filter((k) => !data.funds.some((f) => f.k === k)) : [];
  useEffect(() => { if (missing.length && !gone.length) load<{ funds: FundX[] }>('funds/closed.json').then((d) => setGone((d.funds ?? []).map((f) => ({ ...f, gone: true }))), () => {}); }, [missing.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [hist, setHist] = useState<Record<string, HistX>>({});
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => { keys.filter((k) => !hist[k] && !failed.includes(k)).forEach((k) => load<HistX>(`funds/${k}.json`).then((h) => setHist((c) => ({ ...c, [k]: h })), () => setFailed((c) => [...c, k]))); }, [keys, hist, failed]);

  const fundOf = (k: string) => data?.funds.find((f) => f.k === k) ?? gone.find((f) => f.k === k);
  const netAsk = basis === 'net';
  const items: Item[] = useMemo(() => keys.map((k) => { const f = fundOf(k), h = hist[k]; if (!f || !h) return null; seedHist(refOf(f), h); const ns = netAsk ? netSeries(h) : null;
    let y = ns ? ns.y : h.y;
    // real: each month deflated by that month's CPI change; months the CPI file does not cover drop out
    if (real) { const at = new Map((cpi?.points ?? []).filter((x) => x.mom != null).map((x) => [Number(x.m.replace('-', '')), x.mom as number])); y = y.map((r, i) => { const c = at.get(h.p[i]); return r == null || c == null ? null : ((1 + r / 100) / (1 + c / 100) - 1) * 100; }); }
    return { f, h, y, ns }; }).filter((x): x is Item => !!x), [keys, hist, data, gone, netAsk, real, cpi]);  // eslint-disable-line react-hooks/exhaustive-deps

  // the common axis: from the latest first month among the tracks (within the window) to the earliest last month
  const axis = useMemo(() => {
    if (!items.length) return [] as number[];
    const firstOk = (it: Item) => it.h.p.find((_, i) => it.y[i] != null) ?? it.h.p[0];
    const end = Math.min(...items.map((it) => { const ix = it.y.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0); return it.h.p[ix[ix.length - 1] ?? it.h.p.length - 1]; }));
    const start = Math.max(...items.map(firstOk));
    const base = items[0].h.p.filter((p) => p >= start && p <= end);
    const n = win === 'max' ? base.length - 1 : Math.min(Number(win), base.length - 1);
    // index 0 is the base month (its return is not counted)
    const from = items[0].h.p.indexOf(base[base.length - 1 - n]);
    return items[0].h.p.slice(Math.max(0, from), items[0].h.p.indexOf(base[base.length - 1]) + 1);
  }, [items, win]);
  const sameCat = items.length > 0 && items.every((it) => catKey(it.f) === catKey(items[0].f));
  const mixedProd = new Set(items.map((it) => it.f.prod)).size > 1;
  const cat = sameCat && cats ? cats[catKey(items[0].f)] : undefined;
  // the category line: net only when the build publishes the category's net (yn); never a gross average against net tracks
  const catY = cat ? (netAsk ? (cat.yn && cat.yn.length === cat.p.length ? cat.yn : null) : cat.y) : null;

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="השוואה" />;
  const asof = data.asof;
  const lbl = real ? `ריאלי${netAsk ? ', נטו' : ''}` : netAsk ? NET_LABEL : GROSS_LABEL;
  const ser = (it: Item) => onAxis(axis, it.h.p, it.y);
  const catSer = catY && cat ? onAxis(axis, cat.p, catY) : null;
  const pal = () => palette();
  const unknown = keys.filter((k) => failed.includes(k) || (data.funds.length > 0 && !fundOf(k) && gone.length > 0));
  const loadingN = keys.length - items.length - unknown.length;

  /* ---- sources ---- */
  const monthRow = (it: Item, p: number) => (netAsk && it.ns ? netMonthIn(refOf(it.f), it.h, p, it.ns) : monthIn(refOf(it.f), 'y', p, it.h.y[it.h.p.indexOf(p)]));
  const realNote = real ? ' Real: כל חודש מנוכה בשינוי החודשי של מדד המחירים לצרכן (הלמ"ס).' : '';
  const idxSrc = (it: Item | null, di: number, v: number): Prov => ({ k: 'calc', est: netAsk, title: `צמיחה של 100 ש"ח · ${it ? it.f.name : `ממוצע ${items[0].f.track}`} · ${ym(axis[di])}`, value: nf(v, 1),
    formula: `100 × (1 + r₁) × … × (1 + rₙ) על התשואות החודשיות (${lbl}) מ-${ym(axis[1])} עד ${ym(axis[di])}. בסיס: סוף ${ym(axis[0])}.${realNote}`, note: netAsk ? NET_NOTE : undefined,
    inputs: axis.slice(1, di + 1).map((p) => (it ? monthRow(it, p) : { label: `ממוצע הקטגוריה · ${ym(p)}`, v: pc(catY![cat!.p.indexOf(p)]) })) });
  const rollSrc = (it: Item, di: number, v: number, n: number): Prov => ({ k: 'calc', est: netAsk, title: `תשואה מתגלגלת ${n} חודשים · ${it.f.name} · ${ym(axis[di])}`, value: pc(v), formula: `${n > 12 ? '((1 + r₁) × … × (1 + rₙ)) בחזקת 12 ÷ n, פחות 1 (שנתי)' : '(1 + r₁) × … × (1 + r₁₂) − 1'} על ${n} החודשים שמסתיימים ב-${ym(axis[di])} (${lbl})`,
    inputs: monthsBack(axis[di], n).map((p) => monthRow(it, p)) });
  const ddSrc = (it: Item, di: number, v: number): Prov => ({ k: 'calc', est: netAsk, title: `מתחת לשיא · ${it.f.name} · ${ym(axis[di])}`, value: pc(v), formula: `מדד התשואה המצטברת (${lbl}) חלקי השיא שלפניו בחלון, פחות 1`, inputs: axis.slice(1, di + 1).map((p) => monthRow(it, p)) });

  /* ---- KPI strip: the published figures, or (net, no published net) the same windows built from the track's net months ---- */
  const kret = (it: Item, per: Per): { v: number | null; src: () => Prov } => {
    if (real) { const nom = netAsk ? winRet(it.h, it.ns!.y, per, asof) : it.f[per], c = cpiFactor(cpi, asof, perMonths(per, asof));
      const v = nom == null || !c ? null : per === 'a3' || per === 'a5' ? (((1 + nom / 100) ** (perMonths(per, asof) / 12) / c.f) ** (12 / perMonths(per, asof)) - 1) * 100 : ((1 + nom / 100) / c.f - 1) * 100;
      return { v, src: () => ({ k: 'calc', est: netAsk, title: `${PER_LABEL[per]}, ${lbl} · ${it.f.name}`, value: pc(v), formula: 'התשואה הנומינלית מנוכה במדד המחירים לצרכן של חודשי החלון', inputs: [{ label: 'נומינלי', v: pc(nom), src: () => (netAsk ? netProv(it.f, per, asof, nom) : grossProv(it.f, per, asof)) }, ...(c ? [{ label: 'מדד המחירים בחלון', v: pc((c.f - 1) * 100) }] : [])] }) };
    }
    if (!netAsk) return { v: it.f[per], src: () => grossProv(it.f, per, asof) };
    const pub = it.f.net?.[per];
    if (pub != null) return { v: pub, src: () => netProv(it.f, per, asof, pub, data.net_method) };
    const v = winRet(it.h, it.ns!.y, per, asof);
    return { v, src: () => ({ k: 'calc', est: true, title: `${PER_LABEL[per]}, ${NET_LABEL} · ${it.f.name}`, value: pc(v), formula: `${per === 'a3' || per === 'a5' ? 'שנתי: ' : ''}ריבית דריבית על התשואות החודשיות נטו של החלון`, note: NET_NOTE, inputs: monthsBack(asof, perMonths(per, asof)).map((p) => monthRow(it, p)) }) };
  };
  type KRow = { key: string; label: string; tip?: string; cells: (it: Item) => { v: number | null; t: string; src?: () => Prov } };
  const KROWS: KRow[] = [
    ...PERIODS.map(([per, l]): KRow => ({ key: per, label: `${l}${per === 'a3' || per === 'a5' ? ', שנתי' : ''}`, tip: netAsk ? 'net' : 'gross', cells: (it) => { const r = kret(it, per); return { v: r.v, t: pc(r.v, per === 'm1' ? 2 : 1), src: r.src }; } })),
    { key: 'fee', label: 'ד"נ מצבירה, ממוצע בפועל', tip: 'fee', cells: (it) => ({ v: it.f.fee, t: it.f.fee == null ? '–' : nf(it.f.fee, 2) + '%', src: () => fundP(refOf(it.f), it.f.end ?? asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', nf(it.f.fee ?? 0, 2) + '%') }) },
    { key: 'depfee', label: 'ד"נ מהפקדה, ממוצע בפועל', tip: 'depfee', cells: (it) => ({ v: it.f.depfee, t: it.f.depfee == null ? '–' : nf(it.f.depfee, 2) + '%', src: () => fundP(refOf(it.f), it.f.end ?? asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', nf(it.f.depfee ?? 0, 2) + '%') }) },
    { key: 'assets', label: 'נכסים, מ׳ ש"ח', cells: (it) => ({ v: it.f.assets, t: it.f.assets == null ? '–' : nf(it.f.assets, 0), src: () => fundP(refOf(it.f), it.f.end ?? asof, 'TOTAL_ASSETS', 'נכסים', nf(it.f.assets ?? 0, 1), 'מיליוני ש"ח') }) },
    { key: 'st', label: 'חשיפה למניות', tip: 'equity', cells: (it) => ({ v: it.f.st, t: it.f.st == null ? '–' : nf(it.f.st, 0) + '%', src: () => expP(refOf(it.f), it.f.end ?? asof, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', it.f.st, it.f.assets) }) },
    { key: 'vol', label: 'תנודתיות בחלון', tip: 'vol', cells: (it) => { const s = stats(ser(it), axis.length - 1); return { v: s?.vol ?? null, t: s ? nf(s.vol, 1) + '%' : '–', src: s ? () => ({ k: 'calc', title: `תנודתיות שנתית · ${it.f.name}`, value: nf(s.vol, 1) + '%', formula: 'סטיית תקן של התשואות החודשיות בחלון כפול שורש 12', inputs: axis.slice(1).map((p) => monthRow(it, p)) }) : undefined }; } },
    { key: 'dd', label: 'ירידה מרבית בחלון', tip: 'dd', cells: (it) => { const s = stats(ser(it), axis.length - 1); return { v: s?.dd ?? null, t: pc(s?.dd, 1), src: s ? () => ({ k: 'calc', est: netAsk, title: `ירידה מרבית · ${it.f.name}`, value: pc(s.dd), formula: 'הירידה הגדולה ביותר ממדד התשואה המצטברת, משיאו לשפל שאחריו', inputs: axis.slice(1).map((p) => monthRow(it, p)) }) : undefined }; } },
    { key: 'age', label: 'מועד הקמה', cells: (it) => ({ v: null, t: it.f.since ? pubLabel(it.f.since) : '–' }) },
  ];

  /* ---- calendar years and win-rate ---- */
  const yrs = items.map((it) => byYear(it.h.p, it.y));
  const years = [...new Set(yrs.flatMap((m) => [...m.keys()]))].sort((a, b) => b - a).slice(0, 12);
  type YRow = { y: number };
  const pairs = items.flatMap((a, i) => items.slice(i + 1).map((b) => ({ a, b })));
  const align = (it: Item, ax: number[]) => onAxis(ax, it.h.p, it.y);
  const wrSrc = (a: Item, b: Item, n: number, w: ReturnType<typeof winRate>, ax: number[]): Prov => ({ k: 'calc', est: netAsk, title: `שיעור ניצחון ${n} חודשים · ${a.f.name} מול ${b.f.name}`, value: w.of ? `${nf(w.won / w.of * 100, 0)}%` : '–',
    formula: `בכמה מחלונות ${n} החודשים המתגלגלים, שבהם לשני המסלולים יש כל התשואות החודשיות (${lbl}), התשואה המצטברת של הראשון הייתה גבוהה יותר`,
    inputs: [{ label: 'חלונות שבהם הראשון ניצח', v: nf(w.won, 0) }, { label: 'חלונות משותפים', v: nf(w.of, 0) }, ...(w.first != null ? [{ label: 'החלון הראשון מסתיים', v: ym(ax[w.first]) }, { label: 'החלון האחרון מסתיים', v: ym(ax[w.last!]) }] : [])] });

  /* ---- export: the compare pack (plan #22): per track the monthly gross, fee and net as a live formula, indices and drawdowns;
     a summary of formulas over them; the months side by side; sources. The reader's own workbook: no site mark (lib/fundsPack). ---- */
  const exportPack = async () => {
    const [{ downloadXlsxAsync }, { comparePack, fillFee }] = await Promise.all([import('../lib/xlsx'), import('../lib/fundsPack')]);
    const ts = items.map((it) => { const ff = fillFee(it.h.fee);
      return { k: it.f.k, name: it.f.name, mgr: it.f.mgr, grp: it.f.grp, prod: it.f.prod, track: it.f.track, p: it.h.p, y: it.h.y, fee: ff.fee, filled: ff.filled, feeNow: it.f.fee, depfee: it.f.depfee, assets: it.f.assets, gone: it.f.gone, end: it.f.end }; });
    await downloadXlsxAsync(`השוואת-מסלולים-${ym(asof).replace('/', '-')}.xlsx`, comparePack(ts, asof), { title: 'השוואת מסלולים', author: '' });
  };

  /* ---- picker ---- */
  return (
    <>
      <FundsHead sub={<>השוואה ראש בראש · עד {TRAY_MAX} מסלולים · {ym(asof)}</>} tools={<BasisToggle />} />
      <Picker data={data} keys={keys} setKeys={setKeys} win={<Seg label="חלון" value={win} onChange={(w) => set({ win: w })} options={WINDOWS} />} />
      {keys.length === 0 ? <Empty title="בחרו מסלולים להשוואה" icon="compare">הוסיפו מסלולים בחיפוש למעלה, או בכפתור "+" בטבלת המסלולים ובכרטיס המסלול.</Empty> : items.length === 0 && unknown.length < keys.length ? <Loading what="היסטוריות" /> : (
        <>
          {(mixedProd || !sameCat || loadingN > 0 || unknown.length > 0 || real) && <div className="fwarn">
            {unknown.map((k) => <span key={k} className="chip est">המסלול {k} לא נמצא בנתונים</span>)}
            {mixedProd && <span className="chip est">מוצרים שונים: פנסיה כוללת אג"ח מיועדות, ופוליסות חולקות מסלול עם ביטוחי מנהלים. ההשוואה עובדתית, לא דירוג</span>}
            {!mixedProd && !sameCat && <span className="chip">מסלולים מקטגוריות שונות</span>}
            {loadingN > 0 && <span className="chip">טוען {loadingN}…</span>}
            {real && <span className="chip est">ריאלי: מדד המחירים בקובץ מכסה {cpi?.points.length ?? 0} חודשים, והחלון מתקצר בהתאם</span>}
          </div>}

          <Panel title="השורה התחתונה" aside={<><span className={`chip${netAsk || real ? ' est' : ''}`}>{lbl}</span><span>{ym(asof)}</span></>}>
            <DataTable<KRow> caption="השורה התחתונה" className="fcmp" rows={KROWS} rowKey={(r) => r.key} export={{ name: `השוואת-מסלולים-${ym(asof).replace('/', '-')}`, title: 'השוואת מסלולים', note: `${lbl} · ${ym(asof)} · רשות שוק ההון` }}
              columns={[{ key: 'm', head: 'מדד', sortable: false, value: (r) => r.label, cell: (r) => <>{r.label}{r.tip && <Tip k={r.tip} />}</> },
                ...items.map((it, i): Column<KRow> => ({ key: it.f.k, sortable: false, label: it.f.name, value: (r) => r.cells(it).v ?? r.cells(it).t, text: (r) => r.cells(it).t,
                  head: <><span className="fcmp-sw" style={{ background: pal()[i % pal().length] }} aria-hidden="true" /><Link to={`/funds/${it.f.k}`}>{it.f.name}</Link><span className="fcmp-sub"><MgrChip grp={it.f.grp} mgr={it.f.mgr} short /> {it.f.prod} · {it.f.track}{it.f.gone && <span className="chip est">נסגר{it.f.end ? ` ${ym(it.f.end)}` : ''}</span>}</span></>,
                  cell: (r) => { const c = r.cells(it); return c.src && c.v != null ? <Sourced src={c.src}><span className="num">{c.t}</span></Sourced> : <span className={c.t === '–' ? 'muted' : 'num'}>{c.t}</span>; } }))]} />
            <div className="fnote">{netAsk ? 'נטו: ' + (items.some((it) => it.f.net) ? 'מהקובץ כשפורסם, אחרת ' : '') + 'אומדן מההיסטוריה (תשואה חודשית פחות דמי ניהול מצבירה ÷ 12). ' : 'ברוטו: לפני דמי ניהול, כפי שפורסם. '}תנודתיות וירידה מרבית: בחלון המשותף {axis.length > 1 ? `${ym(axis[1])}–${ym(axis[axis.length - 1])}` : ''}.<button type="button" className="chip fpack" onClick={() => void exportPack()}>Excel: חבילת השוואה (נוסחאות חיות)</button></div>
          </Panel>

          {axis.length > 2 && <>
            <Panel title={<>צמיחה של 100 ש"ח <Tip k="growth" /></>} aside={<><span>{ym(axis[0])}–{ym(axis[axis.length - 1])}</span><span className={`chip${netAsk ? ' est' : ''}`}>{lbl}</span></>}>
              <Chart label="צמיחה של 100 שח" exportName={`השוואה-צמיחה-${ym(asof).replace('/', '-')}`} height={320} deps={[keys.join(), win, netAsk, real, items.length, !!catSer]}
                onPoint={(si, di) => { if (di < 1) return; if (si < items.length) { const v = growth(axis, ser(items[si]))[di]; if (v != null) open(idxSrc(items[si], di, v)); } else if (catSer) { const v = growth(axis, catSer)[di]; if (v != null) open(idxSrc(null, di, v)); } }}
                build={() => { const b = chartBase(), p = palette(); return foxOption({ x: axis.map(ym), unit: 'ש"ח', dense: true, scale: true, legend: true,
                  series: [...items.map((it, i) => ({ name: it.f.name, data: growth(axis, ser(it)), kind: 'line' as const, color: p[i % p.length], dec: 1 })), ...(catSer ? [{ name: `ממוצע ${items[0].f.track}`, data: growth(axis, catSer), kind: 'line' as const, dashed: true, color: b.mu, dec: 1 }] : [])] }); }} />
              <div className="fnote">{sameCat ? (catSer ? 'קו מקווקו: ממוצע הקטגוריה, משוקלל נכסים.' : netAsk ? 'ממוצע הקטגוריה נטו טרם פורסם, ולכן אינו מוצג מול מסלולים נטו.' : '') : ''} בלי הפקדות נוספות; לחיצה על נקודה פותחת את החישוב.</div>
            </Panel>
            <div className="grid2">
              <Panel title={<>תשואה מתגלגלת <Tip k="rolling" /></>} aside={<Seg label="חלון מתגלגל" value={roll} onChange={setRoll} options={[['12', '12M'], ['36', '36M, שנתי']]} />}>
                <Chart label={`תשואה מתגלגלת ${roll} חודשים`} exportName={`השוואה-מתגלגלת-${roll}`} height={260} deps={[keys.join(), win, roll, netAsk, real, items.length]}
                  onPoint={(si, di) => { const it = items[si]; if (!it) return; const v = rolling(ser(it), Number(roll))[di]; if (v != null) open(rollSrc(it, di, v, Number(roll))); }}
                  build={() => { const p = palette(); return foxOption({ x: axis.map(ym), unit: '%', dense: true, full: true, legend: true, series: items.map((it, i) => ({ name: it.f.name, data: rolling(ser(it), Number(roll)), kind: 'line' as const, pct: true, color: p[i % p.length], dec: 1 })) }); }} />
              </Panel>
              <Panel title={<>מתחת לשיא <Tip k="underwater" /></>} aside={<span>% מהשיא הקודם בחלון</span>}>
                <Chart label="מתחת לשיא" exportName="השוואה-ירידה-מהשיא" height={260} deps={[keys.join(), win, netAsk, real, items.length]}
                  onPoint={(si, di) => { const it = items[si]; if (!it) return; const v = underwater(ser(it).slice(1))[di - 1]; if (v != null && di > 0) open(ddSrc(it, di, v)); }}
                  build={() => { const p = palette(); return foxOption({ x: axis.map(ym), unit: '%', dense: true, full: true, legend: true, series: items.map((it, i) => ({ name: it.f.name, data: [0, ...underwater(ser(it).slice(1))], kind: 'line' as const, pct: true, area: items.length === 1, color: p[i % p.length], dec: 1 })) }); }} />
              </Panel>
            </div>
          </>}

          <div className="grid2">
            <Panel title="לפי שנה" aside={<span className={`chip${netAsk ? ' est' : ''}`}>{lbl} · ריבית דריבית</span>}>
              <DataTable<YRow> caption="תשואה לפי שנה" rows={years.map((y) => ({ y }))} rowKey={(r) => String(r.y)} export={{ name: `השוואה-לפי-שנה-${ym(asof).replace('/', '-')}`, title: 'תשואה לפי שנה', note: `${lbl} · רשות שוק ההון` }}
                columns={[{ key: 'y', head: 'שנה', value: (r) => r.y, cell: (r) => <span className="num">{r.y}</span> }, ...items.map((it, i): Column<YRow> => ({ key: it.f.k, label: it.f.name, title: it.f.name, head: <><span className="fcmp-sw" style={{ background: pal()[i % pal().length] }} aria-hidden="true" />{short(it.f.name)}</>, value: (r) => yrs[i].get(r.y)?.r ?? null, unit: 'pct', signed: true, d: 1,
                  cell: (r) => { const e = yrs[i].get(r.y); if (!e) return <span className="muted">–</span>; return <><Sourced src={() => ({ k: 'calc', est: netAsk, title: `תשואה ${r.y} · ${it.f.name}`, value: pc(e.r), formula: `ריבית דריבית על התשואות החודשיות של השנה (${lbl})`, inputs: e.ps.map((p) => monthRow(it, p)) })}><span className="num">{pc(e.r, 1)}</span></Sourced>{e.n < 12 && <span className="dim num">{e.n} ח׳</span>}</>; } }))]} />
            </Panel>
            <Panel title={<>מי ניצח בחלונות של 36 חודשים <Tip k="winrate" /></>} aside={<span>{lbl} · כל ההיסטוריה המשותפת</span>}>
              {pairs.length === 0 ? <Empty title="הוסיפו מסלול שני" /> : (
                <div className="scroll"><table className="fsimple">
                  <thead><tr><th>מסלול</th><th>מול</th><th>36M</th><th>12M</th></tr></thead>
                  <tbody>{pairs.map(({ a, b }) => { const ax = [...new Set([...a.h.p, ...b.h.p])].sort((x, y) => x - y), ya = align(a, ax), yb = align(b, ax), w36 = winRate(ya, yb, 36), w12 = winRate(ya, yb, 12);
                    const show = (w: typeof w36, n: number) => (w.of ? <Sourced src={() => wrSrc(a, b, n, w, ax)}><span className="num">{nf(w.won / w.of * 100, 0)}%</span></Sourced> : <span className="muted">–</span>);
                    return <tr key={a.f.k + b.f.k}><td title={a.f.name}>{short(a.f.name)}</td><td className="muted" title={b.f.name}>{short(b.f.name)}</td><td>{show(w36, 36)}<span className="dim num"> מתוך {w36.of}</span></td><td>{show(w12, 12)}</td></tr>; })}</tbody>
                </table></div>
              )}
              <div className="fnote">"61%": המסלול הראשון השיג יותר מהשני ב-61% מחלונות 36 החודשים המשותפים. עובדה היסטורית, לא תחזית.</div>
            </Panel>
          </div>
          <CompareRisk items={items} cats={cats} />{/* F2 TIME: drawdown, Sortino, beta, capture */}
        </>
      )}
    </>
  );
}

/** Search to add a track; or compare managers: a product and a track, then each chosen group's largest track in it. */
function Picker({ data, keys, setKeys, win }: { data: FundsFile; keys: string[]; setKeys: (k: string[]) => void; win: ReactNode }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'track' | 'mgr'>('track');
  const live = useMemo(() => data.funds.filter((f) => f.assets), [data]);
  const hits = useMemo(() => { const t = q.trim(); if (t.length < 2) return []; const ws = t.split(/\s+/); return live.filter((f) => ws.every((w) => `${f.name} ${f.grp} ${f.prod} ${f.track}`.includes(w))).sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0)).slice(0, 8); }, [q, live]);
  const prods = useMemo(() => [...new Set(live.map((f) => f.prod))], [live]);
  const [prod, setProd] = useState('השתלמות');
  const tracks = useMemo(() => { const m = new Map<string, number>(); live.filter((f) => f.prod === prod && !f.closed).forEach((f) => m.set(f.track, (m.get(f.track) ?? 0) + (f.assets ?? 0))); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t); }, [live, prod]);
  const [track, setTrack] = useState('כללי');
  const T = tracks.includes(track) ? track : tracks[0] ?? '';
  const biggest = useMemo(() => { const m = new Map<string, FundX>(); live.filter((f) => f.prod === prod && f.track === T && !f.closed).forEach((f) => { const c = m.get(f.grp); if (!c || (f.assets ?? 0) > (c.assets ?? 0)) m.set(f.grp, f); }); return [...m.values()].sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0)); }, [live, prod, T]);
  const chosen = keys.map((k) => data.funds.find((f) => f.k === k)).filter((f): f is FundX => !!f);
  return (
    <section className="panel fpick">
      <div className="fpick-hd"><Seg label="מה משווים" value={mode} onChange={setMode} options={[['track', 'מסלולים'], ['mgr', 'מנהלים']]} />{win}
        <div className="fpick-chosen">{chosen.map((f) => <span key={f.k} className="chip fpick-c">{f.name}<button type="button" aria-label={`הסרה: ${f.name}`} onClick={() => setKeys(keys.filter((k) => k !== f.k))}>×</button></span>)}{keys.length > 0 && <button type="button" className="linkbtn" onClick={() => setKeys([])}>ניקוי</button>}</div></div>
      {mode === 'track' ? (
        <div className="fpick-s">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש מסלול: למשל הראל השתלמות מניות" aria-label="חיפוש מסלול להוספה" disabled={keys.length >= TRAY_MAX} />
          {hits.length > 0 && <ul className="fpick-hits">{hits.map((f) => <li key={f.k}><button type="button" disabled={keys.includes(f.k) || keys.length >= TRAY_MAX} onClick={() => { setKeys([...keys, f.k]); setQ(''); }}><span>+ {f.name}</span><span className="muted">{f.prod} · {f.track} · {nf(f.assets ?? 0, 0)} מ׳ ש"ח</span></button></li>)}</ul>}
        </div>
      ) : (
        <div className="fpick-m">
          <Pick label="מוצר" value={prod} onChange={setProd} options={prods.map((p) => [p, p] as [string, string])} />
          <Pick label="מסלול" value={T} onChange={setTrack} options={tracks.map((t) => [t, t] as [string, string])} />
          <div className="fchips">{biggest.slice(0, 16).map((f) => <button key={f.k} type="button" className="chip" aria-pressed={keys.includes(f.k)} disabled={!keys.includes(f.k) && keys.length >= TRAY_MAX} onClick={() => setKeys(keys.includes(f.k) ? keys.filter((k) => k !== f.k) : [...keys, f.k])} title={f.name}>{f.grp}</button>)}</div>
          <div className="fnote">לכל גוף: המסלול הגדול שלו (לפי נכסים) ב{prod} · {T}.</div>
        </div>
      )}
    </section>
  );
}
