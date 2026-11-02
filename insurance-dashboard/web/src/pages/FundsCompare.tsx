import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
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
import { usePhone } from '../lib/useMedia';
import { useOptional } from '../lib/fundsLoad';
import type { DefaultFile } from '../lib/fundsTools';
import { Icon } from '../components/Icon';
import { CROSS_HE, LEAD_HE, OLD_HE, compareSummary, type CmpSummary, type Lead } from '../lib/compareSummary';
import { bottomLines, docRow, snapOf, dmyIso } from '../lib/compareDoc';
import { useActiveDoor } from '../components/home/doorState';
import { defaultNow, isPension, periodText } from '../lib/pensionPack';
import { rulesOf, RULES_NOTE } from '../lib/productRules';
import { actProv, ruleProv, tenderProv, pc2 } from '../lib/agentProv';
import { TIE_NOTE } from '../lib/fundsTie';
import { BM_HREF, DECISION_PATH, OLD_FEE_HE, OLD_WARN, clmCell, isOldGen, svcCell, type DecisionFile } from '../lib/decision';  // W2
import { ClientSave } from '../components/agent/ClientSave';
import { folderOfState, useClients } from '../lib/clients';
import { fundHits, fundIdx, fundMeta } from '../lib/searchOmni';
import { today as todayIso } from '../lib/visits';
import '../components/agent/glossary';
import '../styles/lens.css';
import '../styles/market.css';
import '../styles/agent.css';

/* /funds/compare?k=p2009,g103 (funds plan #5, head-to-head v1; W1-agent: compare 2.0): two to eight tracks, one column each. KPI strip, growth of ₪100 net of
   fee, rolling 12/36-month returns, the fall from the peak, calendar years side by side, and how often one beat the other over every
   rolling 36-month window. All derived from the published monthly returns (net: minus each month's fee ÷ 12), every figure sourced.
   W1-agent (compare 2.0): a descriptive bottom line first (cheapest fee, the shared best 5Y place inside the tie band, the highest
   Sharpe), the tax and liquidity rule of each product (lib/productRules), the pension decision rows (actuarial balance, default
   fund), the client document with its הנמקה annex (/funds/compare/print), and on a phone one card per track instead of the table.
   W4 (doors): the bottom line compares within a category only (lib/compareSummary), an old-generation managers' insurance track opens a
   warning and stays out of every comparison line; the agent door keeps the pairwise windows behind a disclosure, in neutral words; the
   saver door gets a plain bottom line without the agent's tools (client document, Excel pack, client folder, Sharpe, LTM, pairs). Pro
   keeps the rest as it was. Saving to a client folder freezes the figures shown (lib/compareDoc). */

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
  const phone = usePhone();
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);  // W2: the service index and the claims rows
  const [edit, setEdit] = useState(false);
  // W4: the door in force: Pro as it was; the agent's tools; the saver's plain page (no door chosen yet reads as the saver's, as the nav does)
  const [door] = useActiveDoor();
  const mode: 'pro' | 'agent' | 'saver' = door === 'pro' ? 'pro' : door === 'agent' ? 'agent' : 'saver';
  const saver = mode === 'saver';
  // W3: opened from a client folder (the router's state carries its id, never the URL)
  const loc = useLocation();
  const [clients] = useClients();
  const [folderId, setFolderId] = useState<string | null>(() => folderOfState(loc.state));
  const folder = folderId ? clients.folders.find((f) => f.id === folderId) ?? null : null;
  const [more, setMore] = useState(false);
  const askedKeys = useMemo(() => [...new Set((sp.get('k') ?? '').split(',').filter((k) => /^[gip]\d+$/.test(k)))], [sp]);
  const keys = useMemo(() => askedKeys.slice(0, TRAY_MAX), [askedKeys]);
  const dropped = askedKeys.length - keys.length;  // W4: a ninth key is not dropped in silence
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
  // W5 (red team 3): each caveat only when its product is on the page
  const mixedWhy = [items.some((it) => isPension(it.f)) && 'פנסיה כוללת אג"ח מיועדות', items.some((it) => it.f.prod === 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)') && 'פוליסות חיסכון חולקות מסלול עם ביטוחי מנהלים'].filter(Boolean);
  const mixedNote = mixedWhy.length ? `מוצרים שונים: ${mixedWhy.join('; ')}` : 'מוצרים שונים';
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

  const anyPension = items.some((it) => isPension(it.f));
  /** a left-to-right figure inside a Hebrew line, isolated so its order holds (LRI … PDI) */
  const iso = (x: string) => `\u2066${x}\u2069`;
  // a Sharpe ratio over a series with no volatility (personally managed tracks report sd 0) says nothing
  const sharpeOf = (f: FundX) => (f.sd != null && f.sd > 0 ? f.sharpe : null);
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
  type KRow = { key: string; label: string; tip?: string; cells: (it: Item) => { v: number | null; t: string; src?: () => Prov; txt?: boolean; sub?: string } };
  const KROWS: KRow[] = [
    ...PERIODS.map(([per, l]): KRow => ({ key: per, label: `${l}${per === 'a3' || per === 'a5' ? ', שנתי' : ''}`, tip: netAsk ? 'net' : 'gross', cells: (it) => { const r = kret(it, per); return { v: r.v, t: pc(r.v, per === 'm1' ? 2 : 1), src: r.src }; } })),
    { key: 'fee', label: 'ד"נ מצבירה, ממוצע בפועל', tip: 'fee', cells: (it) => ({ v: it.f.fee, t: it.f.fee == null ? '–' : nf(it.f.fee, 2) + '%' + (isOldGen(it.f) ? ` · ${OLD_FEE_HE}` : ''), txt: isOldGen(it.f) || undefined, src: () => fundP(refOf(it.f), it.f.end ?? asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', nf(it.f.fee ?? 0, 2) + '%') }) },
    { key: 'depfee', label: 'ד"נ מהפקדה, ממוצע בפועל', tip: 'depfee', cells: (it) => ({ v: it.f.depfee, t: it.f.depfee == null ? '–' : nf(it.f.depfee, 2) + '%', src: () => fundP(refOf(it.f), it.f.end ?? asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', nf(it.f.depfee ?? 0, 2) + '%') }) },
    { key: 'assets', label: 'נכסים, מ׳ ש"ח', cells: (it) => ({ v: it.f.assets, t: it.f.assets == null ? '–' : nf(it.f.assets, 0), src: () => fundP(refOf(it.f), it.f.end ?? asof, 'TOTAL_ASSETS', 'נכסים', nf(it.f.assets ?? 0, 1), 'מיליוני ש"ח') }) },
    { key: 'st', label: 'חשיפה למניות', tip: 'equity', cells: (it) => ({ v: it.f.st, t: it.f.st == null ? '–' : nf(it.f.st, 0) + '%', src: () => expP(refOf(it.f), it.f.end ?? asof, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', it.f.st, it.f.assets) }) },
    { key: 'vol', label: 'תנודתיות בחלון', tip: 'vol', cells: (it) => { const s = stats(ser(it), axis.length - 1); return { v: s?.vol ?? null, t: s ? nf(s.vol, 1) + '%' : '–', src: s ? () => ({ k: 'calc', title: `תנודתיות שנתית · ${it.f.name}`, value: nf(s.vol, 1) + '%', formula: 'סטיית תקן של התשואות החודשיות בחלון כפול שורש 12', inputs: axis.slice(1).map((p) => monthRow(it, p)) }) : undefined }; } },
    { key: 'dd', label: 'ירידה מרבית בחלון', tip: 'dd', cells: (it) => { const s = stats(ser(it), axis.length - 1); return { v: s?.dd ?? null, t: pc(s?.dd, 1), src: s ? () => ({ k: 'calc', est: netAsk, title: `ירידה מרבית · ${it.f.name}`, value: pc(s.dd), formula: 'הירידה הגדולה ביותר ממדד התשואה המצטברת, משיאו לשפל שאחריו', inputs: axis.slice(1).map((p) => monthRow(it, p)) }) : undefined }; } },
    { key: 'age', label: 'מועד הקמה', cells: (it) => ({ v: null, t: it.f.since ? pubLabel(it.f.since) : '–' }) },
    // W1-agent: the regulator's own risk figures, and the pension decision rows
    { key: 'sharpe', label: 'שארפ (הרשות, כפי שפורסם)', tip: 'sharpe', cells: (it) => { const v = sharpeOf(it.f); return { v, t: v == null ? '–' : nf(v, 2), src: () => fundP(refOf(it.f), it.f.end ?? asof, 'SHARPE_RATIO', 'שארפ', nf(v ?? 0, 2)) }; } },
    { key: 'sd', label: 'סטיית תקן (הרשות)', tip: 'sd', cells: (it) => ({ v: it.f.sd, t: it.f.sd == null ? '–' : nf(it.f.sd, 2), src: () => fundP(refOf(it.f), it.f.end ?? asof, 'STANDARD_DEVIATION', 'סטיית תקן', nf(it.f.sd ?? 0, 2)) }) },
    ...(anyPension ? [
      { key: 'act', label: 'איזון אקטוארי, רבעון אחרון', tip: 'actuarial', cells: (it: Item) => (isPension(it.f) && it.f.act != null ? { v: it.f.act, t: `${iso(pc2(it.f.act))} · ${iso(ym(it.f.act_p ?? asof))}`, src: () => actProv(it.f), txt: true } : { v: null, t: isPension(it.f) ? 'לא דווח' : '–' }) },
      { key: 'dflt', label: 'קרן ברירת מחדל', tip: 'default', cells: (it: Item) => { if (!isPension(it.f)) return { v: null, t: '–' }; const d = defaultNow(it.f.k, dfile, asof); return d ? { v: null, t: `כן · ${iso(periodText(d.t))}`, sub: `${iso(pc2(d.depfee))} / ${iso(pc2(d.fee))}`, src: () => tenderProv(d.t, 'קרן ברירת מחדל', `${pc2(d.depfee)} / ${pc2(d.fee)}`), txt: true } : { v: null, t: dfile ? 'לא' : '–' }; } },
      // W2: the company's service index (the regulator's, 2025) and its own claims report
      { key: 'svc', label: 'מדד השירות 2025 (החברה)', tip: 'svcidx', cells: (it: Item) => (isPension(it.f) ? svcCell(dec, it.f) : { v: null, t: '–' }) },
      { key: 'clm', label: 'תביעות נכות שאושרו, דיווח החברה 2025', tip: 'claims', cells: (it: Item) => (isPension(it.f) ? clmCell(dec, it.f.grp) : { v: null, t: '–' }) },
    ] as KRow[] : []),
  ];
  // W4: the saver's table leaves out the agent's and the analyst's rows (LTM, the regulator's Sharpe and standard deviation)
  const SAVER_OUT = new Set(['y12', 'sharpe', 'sd', 'age']);
  const rowsShown = saver ? KROWS.filter((r) => !SAVER_OUT.has(r.key)) : KROWS;
  /* ---- the bottom line (descriptive): within a category only (W4), on the basis shown, the regulator's Sharpe, fees average actual ---- */
  const summary: CmpSummary = compareSummary(items.map((it) => ({ k: it.f.k, name: it.f.name, prod: it.f.prod, track: it.f.track, cat: catKey(it.f), fee: it.f.fee, depfee: it.f.depfee, r5: kret(it, 'a5').v, sharpe: sharpeOf(it.f), st: it.f.st, old: isOldGen(it.f) })));
  const ROW_LEAD: Record<string, 'fee' | 'depfee' | 'r5' | 'sharpe'> = { fee: 'fee', depfee: 'depfee', a5: 'r5', sharpe: 'sharpe' };
  /** marked in its row: the lowest fee or the highest 5Y / Sharpe within the track's own category, never across categories */
  const isLead = (row: string, k: string) => { const m = ROW_LEAD[row]; if (!m) return false; const c = summary.cats.find((x) => x.ks.includes(k)); const l = c?.[m]; return !!l && !l.all && l.ks.includes(k); };
  // W4: the figures a client folder freezes (the client document's rows, from the histories on this page)
  const snapNow = () => { const rows = items.map((it) => docRow(it.f, { net: netAsk, asof, hist: it.h, dfile, dec })); return snapOf(rows, bottomLines(rows, netAsk), todayIso(), asof, netAsk ? 'net' : 'gross'); };
  const colorOf = (k: string) => pal()[Math.max(0, items.findIndex((it) => it.f.k === k)) % pal().length];
  const nameOf = (k: string) => items.find((it) => it.f.k === k)?.f.name ?? k;
  const rules = rulesOf(items.map((it) => it.f.prod));
  const printHref = `/funds/compare/print?k=${keys.join(',')}&b=${basis}${real ? '&real=1' : ''}`;

  /* ---- calendar years and win-rate ---- */
  const yrs = items.map((it) => byYear(it.h.p, it.y));
  const years = [...new Set(yrs.flatMap((m) => [...m.keys()]))].sort((a, b) => b - a).slice(0, 12);
  type YRow = { y: number };
  const pairs = items.flatMap((a, i) => items.slice(i + 1).map((b) => ({ a, b })));
  const align = (it: Item, ax: number[]) => onAxis(ax, it.h.p, it.y);
  const wrSrc = (a: Item, b: Item, n: number, w: ReturnType<typeof winRate>, ax: number[]): Prov => ({ k: 'calc', est: netAsk, title: `${mode === 'pro' ? 'שיעור ניצחון' : 'חלונות שבהם הראשון גבוה יותר'} ${n} חודשים · ${a.f.name} מול ${b.f.name}`, value: w.of ? `${nf(w.won / w.of * 100, 0)}%` : '–',
    formula: `בכמה מחלונות ${n} החודשים המתגלגלים, שבהם לשני המסלולים יש כל התשואות החודשיות (${lbl}), התשואה המצטברת של הראשון הייתה גבוהה יותר`,
    inputs: [{ label: 'חלונות שבהם הראשון גבוה יותר', v: nf(w.won, 0) }, { label: 'חלונות משותפים', v: nf(w.of, 0) }, ...(w.first != null ? [{ label: 'החלון הראשון מסתיים', v: ym(ax[w.first]) }, { label: 'החלון האחרון מסתיים', v: ym(ax[w.last!]) }] : [])] });

  /* ---- the pairwise windows (Pro: "who won"; agent: neutral, behind a disclosure; saver: not shown) ---- */
  const pairHead = mode === 'pro' ? ['מסלול', 'מול', '36M', '12M'] : ['מסלול א', 'מסלול ב', 'א גבוה מ-ב, 36M', '12M'];
  const Pairs = pairs.length === 0 ? <Empty title="הוסיפו מסלול שני" /> : (
    <div className="scroll"><table className="fsimple">
      <thead><tr>{pairHead.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{pairs.map(({ a, b }) => { const ax = [...new Set([...a.h.p, ...b.h.p])].sort((x, y) => x - y), ya = align(a, ax), yb = align(b, ax), w36 = winRate(ya, yb, 36), w12 = winRate(ya, yb, 12);
        const show = (w: typeof w36, n: number) => (w.of ? <Sourced src={() => wrSrc(a, b, n, w, ax)}><span className="num">{nf(w.won / w.of * 100, 0)}%</span></Sourced> : <span className="muted">–</span>);
        return <tr key={a.f.k + b.f.k}><td title={a.f.name}>{short(a.f.name)}</td><td className="muted" title={b.f.name}>{short(b.f.name)}</td><td>{show(w36, 36)}<span className="dim num"> מתוך {w36.of}</span></td><td>{show(w12, 12)}</td></tr>; })}</tbody>
    </table></div>
  );

  /* ---- export: the compare pack (plan #22): per track the monthly gross, fee and net as a live formula, indices and drawdowns;
     a summary of formulas over them; the months side by side; sources. The reader's own workbook: no site mark (lib/fundsPack). ---- */
  const exportPack = async () => {
    const [{ downloadXlsxAsync }, { comparePack, fillFee }] = await Promise.all([import('../lib/xlsx'), import('../lib/fundsPack')]);
    const ts = items.map((it) => { const ff = fillFee(it.h.fee);
      return { k: it.f.k, name: it.f.name, mgr: it.f.mgr, grp: it.f.grp, prod: it.f.prod, track: it.f.track, p: it.h.p, y: it.h.y, fee: ff.fee, filled: ff.filled, feeNow: it.f.fee, depfee: it.f.depfee, assets: it.f.assets, gone: it.f.gone, end: it.f.end }; });
    await downloadXlsxAsync(`השוואת-מסלולים-${ym(asof).replace('/', '-')}.xlsx`, comparePack(ts, asof), { title: 'השוואת מסלולים', author: '' });
  };

  /* ---- the bottom line: one tile per measure, inside one category; ties shared, never crowned ---- */
  const who = (l: Lead) => l.ks.map((k) => <span key={k} className="cmpn"><i className="sw" style={{ background: colorOf(k) }} aria-hidden="true" />{nameOf(k)}</span>);
  const outOf = (l: Lead) => `${l.of} מסלולים${l.missing.length ? `; ${l.missing.length} בלי נתון` : ''}`;
  const tile = (key: string, label: string, l: Lead | null, val: (l: Lead) => ReactNode, src?: (l: Lead) => () => Prov) => (
    <div className={`cmp-bl-i${l && l.ks.length > 1 ? ' tie' : ''}`} key={key}>
      <span className="l">{label}</span>
      {!l ? <span className="s">אין נתון לשני מסלולים לפחות</span> : l.all ? <><span className="w">אין הבדל: כל {l.of} המסלולים</span><span className="s">{val(l)}</span></> : <>
        <span className="w">{l.ks.length > 1 && <span className="chip">צמודים</span>}{who(l)}</span>
        <span className="s">{src ? <Sourced src={src(l)}>{val(l)}</Sourced> : val(l)} · מתוך {outOf(l)}</span>
      </>}
    </div>
  );
  const itemOf = (k: string) => items.find((it) => it.f.k === k)!;
  const catTiles = (c: CmpSummary['cats'][number]) => [
    tile(`fee:${c.cat}`, LEAD_HE.fee, c.fee, (l) => <span className="num">{pc2(l.v)}</span>, (l) => () => fundP(refOf(itemOf(l.ks[0]).f), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', pc2(l.v))),
    tile(`depfee:${c.cat}`, LEAD_HE.depfee, c.depfee, (l) => <span className="num">{pc2(l.v)}</span>, (l) => () => fundP(refOf(itemOf(l.ks[0]).f), asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', pc2(l.v))),
    tile(`a5:${c.cat}`, `${LEAD_HE.r5} (${lbl})`, c.r5, (l) => <><span className="num">{pc(l.v, 1)}</span>{c.r5?.gap != null && <> · פער מהתשואה הבאה: <span className="num">{nf(c.r5.gap * 100, 0)}</span> נ"ב לשנה</>}</>, (l) => kret(itemOf(l.ks[0]), 'a5').src),
    ...(saver ? [] : [tile(`sharpe:${c.cat}`, LEAD_HE.sharpe, c.sharpe, (l) => <span className="num">{nf(l.v, 2)}</span>, (l) => () => fundP(refOf(itemOf(l.ks[0]).f), asof, 'SHARPE_RATIO', 'שארפ', nf(l.v, 2)))]),
  ];
  const BottomLine = (
    <Panel title="השורה התחתונה" aside={<><span className={`chip${netAsk || real ? ' est' : ''}`}>{lbl}</span><span className="num">{ym(asof)}</span></>}>
      {summary.old && <div className="cmp-old" role="note"><b>ביטוח מנהלים מדור ישן.</b> {OLD_WARN}. <Link to={BM_HREF}>רשימת הבדיקה לביטוחי מנהלים ישנים</Link></div>}
      {summary.cross && <div className="cmp-cross" role="note">
        <p>{CROSS_HE}.</p>
        <ul className="cmp-cross-l">{items.map((it) => <li key={it.f.k}><i className="sw" style={{ background: colorOf(it.f.k) }} aria-hidden="true" /><b>{it.f.name}</b><span className="muted">{it.f.prod} · {it.f.track}</span><span>מניות <Sourced src={() => expP(refOf(it.f), it.f.end ?? asof, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', it.f.st, it.f.assets)}><span className="num">{it.f.st == null ? '–' : nf(it.f.st, 0) + '%'}</span></Sourced></span><span>5Y <span className="num">{pc(kret(it, 'a5').v, 1)}</span></span><span>ד"נ <span className="num">{pc2(it.f.fee)}</span>{isOldGen(it.f) ? ` (${OLD_FEE_HE})` : ""}</span></li>)}</ul>
      </div>}
      {summary.cats.map((c) => (
        <div key={c.cat} className="cmp-bl-cat">
          {(summary.cross || summary.old) && <div className="cmp-bl-cath">באותה קטגוריה: <b>{c.label}</b> · <span className="num">{c.ks.length}</span> מסלולים</div>}
          <div className="cmp-bl">{catTiles(c)}</div>
        </div>
      ))}
      {!summary.cats.length && !summary.cross && !summary.old && <div className="cmp-bl-note">אין שני מסלולים עם נתון להשוואה.</div>}
      <div className="cmp-bl-note">תיאור עובדתי של הנתונים, לא המלצה. השוואה רק בין מסלולים מאותה קטגוריה (אותו מוצר ואותו מסלול השקעה). {TIE_NOTE}. דמי ניהול: הממוצע בפועל של המסלול, לא של חוסך מסוים. {summary.mixed ? 'מוצרים שונים: המיסוי והנזילות שונים (בטבלה למטה). ' : ''}{summary.old ? `${OLD_HE}. ` : ''}</div>
      {!saver && <div className="cmp-actions">
        <Link className="cmp-doc" to={printHref} state={folder ? { folder: folder.id } : undefined}><Icon name="statement" />{folder?.snap ? 'מסמך ללקוח (הצילום)' : 'הפק מסמך ללקוח'}</Link>
        <button type="button" className="chip fpack" onClick={() => void exportPack()}><Icon name="download" /> Excel: חבילת השוואה (נוסחאות חיות)</button>
        <span className="cmp-bl-note">מסמך A4 עם נספח הנמקה; שם הלקוח והסוכן נשארים בדפדפן הזה.</span>
      </div>}
      {/* W3 */}{!saver && <div className="cmp-actions">
        {folder && <span className="cmp-folder">תיק: <b>{folder.label}</b>{folder.snap && <span className="muted"> · צילום מ-{dmyIso(folder.snap.at)}, נתונים עד {ym(folder.snap.asof)}. כאן: נתוני היום</span>}</span>}
        <ClientSave keys={keys} b={basis} folder={folder} onSaved={(f) => setFolderId(f.id)} busy={items.length < keys.length - unknown.length} collect={() => ({ snap: snapNow() })} />
      </div>}
    </Panel>
  );
  const Cards = (
    <div className="cmp-cards">
      {items.map((it) => { const d = isPension(it.f) ? defaultNow(it.f.k, dfile, asof) : null; const fig = (row: string, label: string, c: ReturnType<KRow['cells']>) => (
        <div key={row}><dt>{label}</dt><dd className={isLead(row, it.f.k) ? 'lead' : undefined}>{c.src && (c.v != null || c.txt) ? <Sourced src={c.src}><span className="num">{c.t}</span></Sourced> : <span className="muted">{c.t}</span>}{c.sub && <span className="dim num"> {c.sub}</span>}</dd></div>);
        const K = (key: string) => KROWS.find((r) => r.key === key)!.cells(it);
        return (
          <article className="cmp-card" key={it.f.k}>
            <div className="cmp-card-h"><i className="sw" style={{ background: colorOf(it.f.k) }} aria-hidden="true" /><Link to={`/funds/${it.f.k}`} style={{ flex: 1 }}>{it.f.name}</Link><button type="button" className="cmp-card-x" aria-label={`הסרה: ${it.f.name}`} onClick={() => setKeys(keys.filter((k) => k !== it.f.k))}>×</button></div>
            <div className="cmp-card-sub"><MgrChip grp={it.f.grp} mgr={it.f.mgr} short /><span>{it.f.prod} · {it.f.track}</span>{d && <Sourced className="chip pass" src={() => tenderProv(d.t, 'קרן ברירת מחדל', periodText(d.t))}>ברירת מחדל</Sourced>}{it.f.gone && <span className="chip est">נסגר</span>}</div>
            <dl>
              {fig('a5', '5Y שנתי', K('a5'))}{fig('a3', '3Y שנתי', K('a3'))}{!saver && fig('y12', 'LTM', K('y12'))}
              {fig('fee', 'ד"נ מצבירה*', K('fee'))}{fig('depfee', 'ד"נ מהפקדה*', K('depfee'))}{saver ? fig('st', 'מניות', K('st')) : fig('sharpe', 'שארפ', K('sharpe'))}
              {isPension(it.f) && fig('act', 'איזון אקטוארי', { ...K('act'), t: it.f.act == null ? 'לא דווח' : pc2(it.f.act) })}
              {isPension(it.f) && <>{fig('svc', 'מדד השירות', K('svc'))}{fig('clm', 'נכות אושרו', K('clm'))}</>}{/* W2 */}
            </dl>
          </article>
        ); })}
      <div className="fnote">* ממוצע בפועל של המסלול. תשואות: {lbl}; 3Y ו-5Y שנתי ממוצע. מסומן: הנמוך או הגבוה בשורה, רק בין מסלולים מאותה קטגוריה (צמודים מסומנים יחד).</div>
    </div>
  );
  const TaxLiq = rules.length > 0 && (
    <Panel title={<>מיסוי ונזילות <Tip k="taxliq" /></>} aside={<><span className="chip est">כללי, לא ייעוץ מס</span><span>כלל עיקרי לכל מוצר</span></>}>
      <div className="taxliq">
        {rules.map((r) => (
          <div className="taxliq-r" key={r.key}>
            <div className="n">{r.name}<span className="k">{items.filter((it) => rulesOf([it.f.prod]).some((x) => x.key === r.key)).map((it) => it.f.grp).filter((g, i, a) => a.indexOf(g) === i).join(' · ')}</span></div>
            <div><span className="k">נזילות</span><Sourced src={() => ruleProv(r, 'liq')}>{r.liq}</Sourced></div>
            <div><span className="k">מיסוי · {r.year}</span><Sourced src={() => ruleProv(r, 'tax')}>{r.tax}</Sourced>{r.watch && <span className="chip est" title={r.watch}>שינוי מוצע</span>}</div>
          </div>
        ))}
      </div>
      <div className="fnote">{RULES_NOTE}. כל שורה פותחת את מקורותיה. {items.some((it) => !rulesOf([it.f.prod]).length) ? `ל${[...new Set(items.filter((it) => !rulesOf([it.f.prod]).length).map((it) => it.f.prod))].join(', ')} אין כאן שורה מאומתת.` : ''}</div>
    </Panel>
  );

  /* ---- picker ---- */
  const pickerOpen = !phone || edit || keys.length === 0;
  return (
    <>
      <FundsHead title="השוואת מסלולים" sub={<>השוואה ראש בראש · עד {TRAY_MAX} מסלולים · {ym(asof)}</>} tools={<BasisToggle />} />
      {pickerOpen ? <Picker data={data} keys={keys} setKeys={setKeys} win={<Seg label="חלון" value={win} onChange={(w) => set({ win: w })} options={WINDOWS} />} />
        : null}
      {pickerOpen && phone && keys.length > 0 && <div className="cmp-actions"><button type="button" className="chip" onClick={() => setEdit(false)}>סיום הבחירה</button></div>}
      {!pickerOpen && <div className="cmp-actions"><button type="button" className="chip" onClick={() => setEdit(true)} aria-expanded={false}>עריכת הבחירה · <span className="num">{keys.length}</span> מסלולים</button><Seg label="חלון" value={win} onChange={(w) => set({ win: w })} options={WINDOWS} /></div>}
      {keys.length === 0 ? <Empty title="בחרו מסלולים להשוואה" icon="compare">הוסיפו מסלולים בחיפוש למעלה, או בכפתור "+" בטבלת המסלולים ובכרטיס המסלול.</Empty> : items.length === 0 && unknown.length < keys.length ? <Loading what="היסטוריות" /> : (
        <>
          {(mixedProd || !sameCat || loadingN > 0 || unknown.length > 0 || real || dropped > 0) && <div className="fwarn">
            {dropped > 0 && <span className="chip est" role="status">עד {TRAY_MAX} מסלולים; {dropped === 1 ? 'מסלול אחד הושמט' : `${dropped} מסלולים הושמטו`} ({askedKeys.slice(TRAY_MAX).map((k) => fundOf(k)?.name ?? k).join(', ')})</span>}
            {unknown.map((k) => <span key={k} className="chip est">המסלול {k} לא נמצא בנתונים</span>)}
            {mixedProd && <span className="chip est">{mixedNote}. ההשוואה עובדתית, לא דירוג</span>}
            {!mixedProd && !sameCat && <span className="chip">מסלולים מקטגוריות שונות: אין השוואה ביניהם בשורה התחתונה</span>}
            {loadingN > 0 && <span className="chip">טוען {loadingN}…</span>}
            {real && <span className="chip est">ריאלי: מדד המחירים בקובץ מכסה {cpi?.points.length ?? 0} חודשים, והחלון מתקצר בהתאם</span>}
          </div>}

          {BottomLine}
          {phone ? Cards : (
            <Panel title="זה מול זה" aside={<><span className={`chip${netAsk || real ? ' est' : ''}`}>{lbl}</span><span>● הנמוך או הגבוה בשורה, באותה קטגוריה</span></>}>
            <DataTable<KRow> caption="מדדים זה מול זה" className={`fcmp${items.length >= 5 ? ' many' : ''}`} rows={rowsShown} rowKey={(r) => r.key} export={{ name: `השוואת-מסלולים-${ym(asof).replace('/', '-')}`, title: 'השוואת מסלולים', note: `${lbl} · ${ym(asof)} · רשות שוק ההון` }}
              columns={[{ key: 'm', head: 'מדד', sortable: false, value: (r) => r.label, cell: (r) => <>{r.label}{r.tip && <Tip k={r.tip} />}</> },
                ...items.map((it, i): Column<KRow> => ({ key: it.f.k, sortable: false, label: it.f.name, value: (r) => r.cells(it).v ?? r.cells(it).t, text: (r) => r.cells(it).t,
                  head: <><span className="fcmp-sw" style={{ background: pal()[i % pal().length] }} aria-hidden="true" /><Link to={`/funds/${it.f.k}`} className="fcmp-n" title={it.f.name}>{it.f.name}</Link><span className="fcmp-sub"><MgrChip grp={it.f.grp} mgr={it.f.mgr} short /> {it.f.prod} · {it.f.track}{it.f.gone && <span className="chip est">נסגר{it.f.end ? ` ${ym(it.f.end)}` : ''}</span>}</span></>,
                  tdClass: (r) => (isLead(r.key, it.f.k) ? 'cmp-best' : undefined), cell: (r) => { const c = r.cells(it); return <>{c.src && (c.v != null || c.txt) ? <Sourced src={c.src}><span className={c.txt ? undefined : 'num'}>{c.t}</span></Sourced> : <span className={c.t === '–' || c.txt === undefined && /[א-ת]/.test(c.t) ? 'muted' : 'num'}>{c.t}</span>}{c.sub && <span className="fcmp-q num" title="דמי הניהול בהליך: מהפקדה / מצבירה">{c.sub}</span>}</>; } }))]} />
              <div className="fnote">{netAsk ? 'נטו: ' + (items.some((it) => it.f.net) ? 'מהקובץ כשפורסם, אחרת ' : '') + 'אומדן מההיסטוריה (תשואה חודשית פחות דמי ניהול מצבירה ÷ 12). ' : 'ברוטו: לפני דמי ניהול, כפי שפורסם. '}תנודתיות וירידה מרבית: בחלון המשותף {axis.length > 1 ? `${ym(axis[1])}–${ym(axis[axis.length - 1])}` : ''}{saver ? '.' : '; שארפ וסטיית תקן: כפי שהרשות מפרסמת, לא על החלון כאן.'}</div>
            </Panel>
          )}
          {TaxLiq}

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

          {phone && !more ? <button type="button" className="cmp-more" onClick={() => setMore(true)}>{saver ? 'פירוט: לפי שנה ▾' : mode === 'agent' ? 'פירוט: לפי שנה, חלונות מתגלגלים, סיכון ▾' : 'פירוט: לפי שנה, מי ניצח בחלונות, סיכון ▾'}</button> : <>
          <div className={saver ? undefined : 'grid2'}>
            <Panel title="לפי שנה" aside={<span className={`chip${netAsk ? ' est' : ''}`}>{lbl} · ריבית דריבית</span>}>
              <DataTable<YRow> caption="תשואה לפי שנה" rows={years.map((y) => ({ y }))} rowKey={(r) => String(r.y)} export={{ name: `השוואה-לפי-שנה-${ym(asof).replace('/', '-')}`, title: 'תשואה לפי שנה', note: `${lbl} · רשות שוק ההון` }}
                columns={[{ key: 'y', head: 'שנה', value: (r) => r.y, cell: (r) => <span className="num">{r.y}</span> }, ...items.map((it, i): Column<YRow> => ({ key: it.f.k, label: it.f.name, title: it.f.name, head: <><span className="fcmp-sw" style={{ background: pal()[i % pal().length] }} aria-hidden="true" />{short(it.f.name)}</>, value: (r) => yrs[i].get(r.y)?.r ?? null, unit: 'pct', signed: true, d: 1,
                  cell: (r) => { const e = yrs[i].get(r.y); if (!e) return <span className="muted">–</span>; return <><Sourced src={() => ({ k: 'calc', est: netAsk, title: `תשואה ${r.y} · ${it.f.name}`, value: pc(e.r), formula: `ריבית דריבית על התשואות החודשיות של השנה (${lbl})`, inputs: e.ps.map((p) => monthRow(it, p)) })}><span className="num">{pc(e.r, 1)}</span></Sourced>{e.n < 12 && <span className="dim num">{e.n} ח׳</span>}</>; } }))]} />
            </Panel>
            {mode === 'pro' && <Panel title={<>מי ניצח בחלונות של 36 חודשים <Tip k="winrate" /></>} aside={<span>{lbl} · כל ההיסטוריה המשותפת</span>}>
              {Pairs}
              <div className="fnote">"61%": המסלול הראשון השיג יותר מהשני ב-61% מחלונות 36 החודשים המשותפים. עובדה היסטורית, לא תחזית.</div>
            </Panel>}
            {mode === 'agent' && <Panel title="חלונות מתגלגלים, זוג מול זוג" aside={<span>{lbl} · כל ההיסטוריה המשותפת</span>}>
              <details className="cmp-pairs">
                <summary>פער בתשואה בחלונות 36 חודשים: {pairs.length} זוגות <span className="muted">(הצגה)</span></summary>
                {Pairs}
              </details>
              <div className="fnote">בכמה מחלונות 36 (ו-12) החודשים המתגלגלים המשותפים התשואה המצטברת של המסלול הראשון בזוג הייתה גבוהה מזו של השני. עובדה היסטורית, לא תחזית ולא דירוג; {sameCat ? 'כל המסלולים מאותה קטגוריה.' : 'מסלולים מקטגוריות שונות נושאים סיכון שונה, והפער ביניהם אינו השוואה.'}</div>
            </Panel>}
          </div>
          {!saver && <CompareRisk items={items} cats={cats} />}{/* F2 TIME: drawdown, Sortino, beta, capture */}
          </>}
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
  // W5: the omnibox's matcher (lib/searchOmni): the fund number, the name, the company, the product type and the track
  const idx = useMemo(() => live.map((f) => ({ f, x: fundIdx(f.name, f.grp, f.k, f.track, f.prod) })), [live]);
  const hits = useMemo(() => fundHits(q, idx), [q, idx]);
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
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש מסלול: מספר קופה, שם, חברה או מוצר (למשל 2155, הראל השתלמות מניות)" aria-label="חיפוש מסלול להוספה" disabled={keys.length >= TRAY_MAX} />
          {hits.length > 0 && <ul className="fpick-hits">{hits.map(({ f, x }) => <li key={f.k}><button type="button" disabled={keys.includes(f.k) || keys.length >= TRAY_MAX} onClick={() => { setKeys([...keys, f.k]); setQ(''); }}><span>+ {f.name}</span><span className="muted">{fundMeta(x)} · {f.track} · {nf(f.assets ?? 0, 0)} מ׳ ש"ח</span></button></li>)}</ul>}
          {q.trim().length >= 2 && !hits.length && <p className="muted fpick-none" role="status">לא נמצא מסלול פעיל ל"{q.trim()}"</p>}
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
