import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DeeperSheet, SheetSection } from '../components/DeeperSheet';
import { ErrorBox, Loading } from '../components/ui';
import { CompareEmpty } from '../components/compare/CompareEmpty';
import { PickerSheet } from '../components/compare/PickerSheet';
import { MonthSheet } from '../components/compare/MonthSheet';
import { FeeSheet } from '../components/compare/FeeSheet';
import { TrackSheet } from '../components/compare/TrackSheet';
import { RiskNoteSheet } from '../components/compare/RiskNoteSheet';
import { ShareSheet } from '../components/compare/ShareSheet';
import { DisplaySheet } from '../components/compare/DisplaySheet';
import { WhySheet } from '../components/compare/WhySheet';
import { CompareLong } from './compare/CompareLong';
import { CompareDecision } from './compare/CompareDecision';
import { CompareRisk } from './compare/CompareRisk';
import { CompareHeader, ViewStrip } from './compare/CompareHeader';
import { CompareMonths, type MonthsModel, type Range } from './compare/CompareMonths';
import { TaxLiqBody, useCompareData, type CompareData } from './compare/panels';
import { trackColor, trackLabels } from './compare/tracks';
import { DOOR_CAP, type CmpCtx, type SheetId, type View } from './compare/contract';
import { useActiveDoor } from '../components/home/doorState';
import { catKey, useBasis, useTray, ym, type FundX } from '../lib/funds';
import { useMine } from '../lib/mine';
import { useStored } from '../lib/local';
import { compareKeys } from '../lib/saverCompare';
import { BM_HREF, OLD_WARN, isOldGen } from '../lib/decision';
import { rulesOf } from '../lib/productRules';
import './compare/shell.css';

/* /funds/compare — the track comparison (redesign spec v3, lane L2-a: C1, C3, C5, C9, D1, D4). The page file is the shell:
   - State in the address: ?k= the tracks (column order), ?v= the lens (months | long | dec | risk), ?r= the range of the month table
     (6 | 12 | y), ?sheet= the open sheet (month:<yyyymm> | year:<yyyy> | fee | track:<k> | risknote | picker | share | display | why | rules),
     ?b= the basis (lib/funds useBasis), ?per= the long view's period (lane L2-d; kept on every rewrite), ?door= honoured (the layout stores
     it), ?focus=fee scrolls to the fee row and draws the eye to it once (the home page's fee card). Lens and range are remembered in this
     browser (cmp:lens, cmp:range) and written into the address only when they differ from the default (months, 6).
   - Doors set depth, never facts (D1): the same first screen in every door; the door sets the cap (4 / 6 / 8), the words of the lenses
     and the strip's fifth tab (none / "להחלטה" / "מקצועי"). Switching door keeps the tracks.
   - One sticky, opaque strip under the site's top bar; it sets --mg-top (its bottom edge) so the grid's head sticks under it.
   - Sheets are mounted from the address; Back / Escape close them (components/Sheet useSheetHistory), and the shell clears ?sheet= with
     replace. Lenses and sheets of other lanes load their own data through the cached hooks; the shell passes keys, not data.
   - C9: what the page used to show (bottom-line tiles, cards, tax and liquidity, rolling and drawdown charts, exports, footnotes, the
     pension estimate) is cut from the default render and kept, whole, in ./compare/panels.tsx for the agent and Pro lenses. */

const KEY_RE = /^[gip]\d+$/;
const CAP_TOAST = (cap: number) => `עד ${cap} מסלולים במסך אחד, כדי שיהיה אפשר לקרוא בלי לגלול הצידה`;

/** ?sheet= ↔ SheetId */
export function parseSheet(s: string | null): SheetId | null {
  if (!s) return null;
  const [t, a = ''] = s.split(':');
  if (t === 'month' && /^\d{6}$/.test(a)) return { t, p: a };
  if (t === 'year' && /^\d{4}$/.test(a)) return { t, y: a };
  if (t === 'track' && KEY_RE.test(a)) return { t, k: a };
  if (t === 'fee' || t === 'risknote' || t === 'picker' || t === 'share' || t === 'display' || t === 'why' || t === 'rules') return { t } as SheetId;
  return null;
}
export const sheetParam = (s: SheetId): string => (s.t === 'month' ? `month:${s.p}` : s.t === 'year' ? `year:${s.y}` : s.t === 'track' ? `track:${s.k}` : s.t);

/** the view from ?v= and ?r= (or the remembered ones), checked against the door's lenses */
function viewOf(v: string | null, r: string | null, door: CmpCtx['door']): View {
  if (v === 'long') return 'long';
  if (v === 'dec' && door !== 'saver') return 'dec';
  if (v === 'risk' && door === 'pro') return 'risk';
  return r === '12' ? 'm12' : r === 'y' ? 'y' : 'm6';
}

export function FundsCompare() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [doorRaw, setDoorStored] = useActiveDoor();
  const door = doorRaw ?? 'saver';
  const cap = DOOR_CAP[door];
  const [basis] = useBasis();
  const tray = useTray();
  const [myList] = useMine();
  const [lensMem, setLensMem] = useStored<string>('cmp:lens', 'months');
  const [rangeMem, setRangeMem] = useStored<string>('cmp:range', '6');

  /** write address params, read fresh from the address at call time (a sheet may have changed it), always with replace */
  const write = useCallback((patch: Record<string, string | null>) => {
    const n = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([k, v]) => (v == null ? n.delete(k) : n.set(k, v)));
    const s = n.toString();
    nav({ search: s ? `?${s}` : '' }, { replace: true, state: window.history.state?.usr });
  }, [nav]);

  const asked = useMemo(() => [...new Set((sp.get('k') ?? '').split(',').filter((k) => KEY_RE.test(k)))], [sp]);
  const d = useCompareData(asked, basis);
  const data = d && !('error' in d) ? d : null;

  // a bare /funds/compare: the tray; else the reader's own tracks of one category and the two largest peers (O3); else the entry screen
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    if (sp.get('k')) { seeded.current = true; return; }
    if (tray.keys.length) { seeded.current = true; write({ k: tray.keys.slice(0, cap).join(',') }); return; }
    const mine = (Array.isArray(myList) ? myList : []).filter((m) => typeof m?.k === 'string' && KEY_RE.test(m.k));
    if (!mine.length) { seeded.current = true; return; }
    if (!data) return;
    seeded.current = true;
    const ks = compareKeys(mine, data.data.funds, cap);
    if (ks.length) write({ k: ks.join(',') });
  }, [data, sp, tray.keys, myList, cap, write]);

  // the tracks on screen: known ones, up to the door's cap (the address keeps the rest, so switching door back restores them)
  const unknownKs = data?.unknown ?? [];
  const known = asked.filter((k) => !unknownKs.includes(k));
  const keys = useMemo(() => known.slice(0, cap), [known.join(), cap]);  // eslint-disable-line react-hooks/exhaustive-deps
  const over = known.length - keys.length;

  const view = viewOf(sp.get('v') ?? (lensMem === 'months' ? null : lensMem), sp.get('r') ?? rangeMem, door);
  const lensEl = useRef<HTMLDivElement>(null);
  const setView = useCallback((v: View) => {
    const lens = v === 'm6' || v === 'm12' || v === 'y' ? 'months' : v;
    // the strip is stuck and the lens scrolled under it: bring the new view's top back under the strip
    const el = lensEl.current;
    if (el) { const top = parseFloat(getComputedStyle(el).getPropertyValue('--mg-top')) || 0, y = el.getBoundingClientRect().top + window.scrollY - top;
      if (window.scrollY > y + 1) window.scrollTo({ top: y }); }
    setLensMem(lens);
    if (lens === 'months') { const r = v === 'm12' ? '12' : v === 'y' ? 'y' : '6'; setRangeMem(r); write({ v: null, r: r === '6' ? null : r }); }
    else write({ v: lens });
  }, [write, setLensMem, setRangeMem]);
  const setKeys = useCallback((ks: string[]) => { const v = [...new Set(ks)].filter((k) => KEY_RE.test(k)); write({ k: v.join(',') || null }); tray.set(v); }, [write, tray]);
  const openSheet = useCallback((s: SheetId) => write({ sheet: sheetParam(s) }), [write]);
  const closeSheet = useCallback(() => write({ sheet: null }), [write]);
  const setDoor = useCallback((dr: CmpCtx['door']) => { setDoorStored(dr); setLensMem('months'); write({ door: null, v: null }); }, [setDoorStored, write, setLensMem]);
  const sheet = parseSheet(sp.get('sheet'));

  // toasts: a key in the link that is not in the data; more tracks than the door shows
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (unknownKs.length) setToast(unknownKs.length === 1 ? 'מסלול אחד בקישור לא נמצא' : `${unknownKs.length} מסלולים בקישור לא נמצאו`); }, [unknownKs.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (over > 0) setToast(CAP_TOAST(cap)); }, [over, cap]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3800); return () => clearTimeout(t); }, [toast]);

  // the sticky strip: under the site's top bar; --mg-top = its bottom edge, so the grid's head sticks under it
  const root = useRef<HTMLDivElement>(null), strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const top = document.querySelector<HTMLElement>('header.top'), el = root.current, st = strip.current;
    if (!el) return;
    const set = () => { const th = top?.getBoundingClientRect().height ?? 0, sh = st?.getBoundingClientRect().height ?? 0;
      el.style.setProperty('--cmp-top', `${Math.round(th)}px`); el.style.setProperty('--mg-top', `${Math.round(th + sh)}px`); };
    set();
    const ro = new ResizeObserver(set); if (top) ro.observe(top); if (st) ro.observe(st);
    return () => ro.disconnect();
  }, [!!data, keys.length > 0]);  // eslint-disable-line react-hooks/exhaustive-deps

  const ctx: CmpCtx = { keys, basis, door, setKeys, openSheet, view, setView, setDoor, asof: data?.asof, cap };
  const model = useModel(data, keys, basis, myList);

  // ?focus=fee (the home page's fee card): scroll to the fee row and draw the eye to it once, then drop the parameter
  const focus = sp.get('focus');
  useEffect(() => {
    if (focus !== 'fee' || !model) return;
    if (!keys.length) { write({ focus: null }); return; }
    if (model.loading) return;
    if (view === 'long' || view === 'dec' || view === 'risk') setView('m6');
    const t = setTimeout(() => {
      const el = document.getElementById('fee-line');
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        el.classList.add('cmp-flash'); setTimeout(() => el.classList.remove('cmp-flash'), 2400);
      }
      write({ focus: null });
    }, 150);
    return () => clearTimeout(t);
  }, [focus, model?.loading, keys.length, view]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (d && 'error' in d) return <ErrorBox what="נתוני הקופות" error={d.error} />;
  if (!data) return <Loading what="השוואה" />;

  const sheets = (
    <>
      {sheet?.t === 'picker' && <PickerSheet {...ctx} open onClose={closeSheet} />}
      {(sheet?.t === 'month' || sheet?.t === 'year') && <MonthSheet {...ctx} open onClose={closeSheet} p={sheet.t === 'month' ? sheet.p : sheet.y} />}
      {sheet?.t === 'fee' && <FeeSheet {...ctx} open onClose={closeSheet} />}
      {sheet?.t === 'track' && <TrackSheet {...ctx} open onClose={closeSheet} k={sheet.k} />}
      {sheet?.t === 'risknote' && <RiskNoteSheet {...ctx} open onClose={closeSheet} />}
      {sheet?.t === 'share' && <ShareSheet {...ctx} open onClose={closeSheet} />}
      {sheet?.t === 'display' && <DisplaySheet {...ctx} open onClose={closeSheet} />}
      {sheet?.t === 'why' && <WhySheet {...ctx} open onClose={closeSheet} />}
      {sheet?.t === 'rules' && <RulesSheet d={data} open onClose={closeSheet} />}
      {toast && <div className="cmp-toast" role="status">{toast}</div>}
    </>
  );

  if (!keys.length || !model) return (
    <div className="cmpx" ref={root}>
      <CompareEmpty {...ctx} />
      {sheets}
    </div>
  );

  const m = model;
  const f0 = m.funds.find(Boolean);
  const title = !f0 ? 'השוואת מסלולים' : m.mixed ? 'מוצרים שונים' : m.cross ? `${f0.prod} · מסלולים שונים` : `${f0.prod} · ${f0.track}`;
  const months = view === 'm6' || view === 'm12' || view === 'y';
  const lens = view === 'long' ? <CompareLong {...ctx} />
    : view === 'dec' ? <CompareDecision {...ctx} />
    : view === 'risk' ? <CompareRisk {...ctx} />
    : <CompareMonths {...ctx} range={view as Range} setRange={(r) => setView(r)} m={m} />;
  return (
    <div className="cmpx" ref={root}>
      <CompareHeader title={title} items={keys.map((k, i) => ({ k, label: m.labels[i] || k, color: m.colors[i], mine: m.mine[i], closed: m.closed[i] }))}
        onOpen={(k) => openSheet({ t: 'track', k })} onAdd={keys.length < cap ? () => openSheet({ t: 'picker' }) : undefined} />
      <ViewStrip ref={strip} door={door} view={view} onChange={setView} />
      <div className="cmp-lens" ref={lensEl} key={months ? 'months' : view}>{lens}</div>
      {sheets}
    </div>
  );
}

/** what the head, the month lens and the share link need about the tracks on screen */
function useModel(d: CompareData | null, keys: string[], basis: 'net' | 'gross', myList: unknown): MonthsModel | null {
  return useMemo(() => {
    if (!d) return null;
    const funds: (FundX | null)[] = keys.map((k) => d.fundOf(k) ?? null);
    const hists = keys.map((k) => d.items.find((it) => it.f.k === k)?.h ?? null);
    const labels = trackLabels(funds), colors = keys.map((_, i) => trackColor(i));
    const old = funds.map((f) => !!f && isOldGen(f)), closed = funds.map((f) => !!f?.gone);
    const live = funds.filter((f, i): f is FundX => !!f && !old[i]);
    const cross = new Set(live.map(catKey)).size > 1;
    const mixed = new Set(funds.filter((f): f is FundX => !!f).map((f) => f.prod)).size > 1;
    const sameCat = live.length > 0 && !cross && funds.every((f) => !f || catKey(f) === catKey(live[0]));
    const cat = sameCat && d.cats ? d.cats[catKey(live[0])] ?? null : null;
    const mineKs = new Set((Array.isArray(myList) ? myList : []).map((x: { k?: string }) => x?.k));
    const f0 = funds.find(Boolean);
    const per = new URLSearchParams(window.location.search).get('per');
    const url = `${window.location.origin}/funds/compare?k=${keys.join(',')}&v=months&r=6${basis === 'gross' ? '&b=gross' : ''}${per ? `&per=${per}` : ''}`;
    const text = `השוואת מסלולים ב-fox: ${labels.filter(Boolean).join(', ')}${f0 ? ` · ${cross ? f0.prod : `${f0.prod} ${f0.track}`}` : ''} · עד ${ym(d.asof)}\n${url}`;
    return {
      funds, hists, labels, colors, cat, asof: d.asof, cross, mixed, old, closed, mine: keys.map((k) => mineKs.has(k)),
      shareHref: `https://wa.me/?text=${encodeURIComponent(text)}`,
      loading: keys.some((k, i) => !hists[i] && !d.unknown.includes(k)) || funds.some((f) => !f),
    };
  }, [d, keys, basis, myList]);
}

/** Different products: the tax and liquidity rule of each (lib/productRules); an old-generation policy: what the comparison cannot show. */
function RulesSheet({ d, open, onClose }: { d: CompareData; open: boolean; onClose: () => void }) {
  const old = d.items.some((it) => isOldGen(it.f)), rules = rulesOf(d.items.map((it) => it.f.prod));
  return (
    <DeeperSheet open={open} onClose={onClose} id="rules-sheet" title={rules.length ? 'כללי המס והמשיכה' : 'פוליסה ישנה'} sub={rules.length ? 'לכל מוצר, הכלל העיקרי · כללי, לא ייעוץ מס' : undefined}>
      {old && <SheetSection title="פוליסה ישנה (1990–2003)" open><p>{OLD_WARN}.</p><p><Link to={BM_HREF}>רשימת הבדיקה לביטוחי מנהלים ישנים ›</Link></p></SheetSection>}
      {rules.length > 0 && <TaxLiqBody d={d} />}
    </DeeperSheet>
  );
}
