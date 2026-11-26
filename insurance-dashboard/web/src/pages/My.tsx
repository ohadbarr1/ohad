import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { DeeperSheet } from '../components/DeeperSheet';
import { Takeaway } from '../components/Takeaway';
import { StampLine } from '../components/StampLine';
import { NumText } from '../components/NumText';
import { AmountsSheet } from '../components/AmountsSheet';
import { TypeMonthSheet } from '../components/TypeMonthSheet';
import { backThen } from '../components/Sheet';
import { CardMonthSheet, type CardCtx } from './fund/CardMonths';
import { WhySheet } from '../components/compare/WhySheet';
import { useFundCats, useFunds } from '../lib/useData';
import { useHists, useOptional } from '../lib/fundsLoad';
import { useActiveProfile, useMine, useProfiles, useMy, useMyAge, useMySex, useRetire, type MyProduct } from '../lib/mine';
import { PROFILE_LABEL } from '../lib/household';
import { useDoor, useSaverDoor } from '../lib/door';
import { catKey, grossProv, type CatX, type FundX, type FundsFile } from '../lib/funds';
import { deltaOf, markSeen, ymL, type WSnap } from '../lib/fundsTime';  // phase 0: the watchlist (was /funds/watch)
import { snapOf, useWatch } from '../lib/fundsTimeLoad';
import { WatchStar } from '../components/FundsTime';
import { nf } from '../lib/format';
import type { DefaultFile } from '../lib/fundsTools';
import { AGE_DEFAULT, RET_FALLBACK } from '../lib/retire';
import { COEF_PATH, birthYearOf, coefFor, type CoefFile } from '../lib/coef';  // W6
import { cardCalc, type SumRow } from '../lib/myCalc';
import { DECISION_PATH, type DecisionFile } from '../lib/decision';
import { compareKeys } from '../lib/saverCompare';
import { hasTypeAvg, oldGeneration, typeCount, typeMembers } from '../lib/pageMonths';
import {
  ME_BTN, MY_EMPTY_LINE, MY_EXAMPLE, MY_EXAMPLE_TAG, MY_FEES_NOTE, MY_FEES_TITLE, MY_FEES_TOTAL, MY_GONE, MY_IMPORT,
  MY_PRIVACY, MY_TITLE, fullLabel, ilsSym, monthYear, myFeeSum, myFeesRowTag, myFeesSub, myWords, todoAmounts, typeName,
} from '../lib/pageWords';
import { useSheetHost } from '../lib/sheetHost';
import type { SheetId } from './compare/contract';
import { Picker } from '../components/saver/Picker';
import { ProductCard } from '../components/saver/ProductCard';
import { MyProductRow, myRowFigures, type ProductFee } from '../components/saver/MyProductRow';
import { ProfileSheet } from '../components/saver/ProfileSheet';
import { MaslakaImport } from '../components/saver/MaslakaImport';
import { SinceVisit } from '../components/saver/SinceVisit';
import { MomentChips } from '../components/saver/MomentChips';  // W9: life moments
import { CK_STATUS_KEY, dueNegos, isoDay, normNegos, normStatus, statusLine } from '../lib/checkup';  // S1+S2: the check-up's 30-day reminder; its status line
import '../styles/moments.css';
import '../styles/rollout.css';
import '../styles/saver.css';
import '../styles/my-watch.css';
import '../styles/checkup.css';
import '../styles/compare-sheets.css';

/* /my, "המוצרים שלי" (W1 saver door; W4 after the second red team, 02.11.26; rollout phase 4, spec 5 as amended by 16–18, mockup v4
   frames 8–9, tickets T-M1 … T-M4). One page for every door: "מה שלום החיסכון שלי?".
   - Head: the title, the data month and one 44-px pill "הפרטים שלי" (#me-btn) that opens the profile sheet (household profiles, age,
     sex, retirement age, salary, and today's summary strip). No form above the content.
   - The sentence (#takeaway, lib/pageWords myWords): the month and the last year of the reader's tracks; never a sum, never a ₪ gain.
   - One row per product (components/saver/MyProductRow): six-month strip (each square opens that month's sheet for that product),
     against the type's average, the last year with its place, the yearly fee in ₪ on the reader's amounts for THAT product or "לדוגמה",
     "השוואה ›". The head row opens the product sheet: today's ProductCard, unchanged, inside a full-height sheet.
   - #fee-sum: the yearly fees of all products, with how many stand on the example; opens the breakdown per product, each row a button
     into that product's amounts. #todo-amt (amber): the first product still on the example → its amounts sheet.
   - Chips: "＋ מוצר נוסף" (the three-tap add flow in place of the list), "ייבוא מהמסלקה" (today's import, in a sheet), "הבדיקה השנתית";
     then the life moments, "since the last visit", the watch list, the stamp and the privacy line.
   - Empty: the add flow (six tiles first), the import row, and one example row marked "דוגמה · לא המוצר שלך".
   Sheets are in the address (?sheet=, lib/sheetHost, replace): "product:<k>", "mmonth:<k>:<yyyymm>" (the card's month sheet), "mtype:<k>:<yyyymm>" (the type-month sheet), "amounts:<k>", "myfees",
   "profile", "import", and compare's "why". The list lives in this browser only (lib/mine); amounts only through lib/myAmounts.
   Descriptive, never advice. Entering /my with no door chosen is entering the saver door. /my#<k> lands on that product's row,
   /my#deposits opens the first pension or השתלמות product on its deposit watchdog, /my#watch opens the watch list. */
const EXAMPLE = 'p2009';
const today = () => new Date().toISOString().slice(0, 10);
const who = (pid: string) => (pid === 'spouse' ? 'בן/בת הזוג' : pid === 'parent' ? 'ההורה' : null);

export function My() {
  useSaverDoor();
  const [doorS] = useDoor();
  const door = doorS ?? 'saver';
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cats = useFundCats().data as Record<string, CatX> | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);
  const coefF = useOptional<CoefFile>(COEF_PATH);  // W6
  const [mine, setMine] = useMine();
  const [ageS] = useMyAge(), [sex] = useMySex();
  const R = useRetire();
  const pid = useActiveProfile();
  const [P] = useProfiles();
  const host = useSheetHost();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [fees, setFees] = useState<Record<string, ProductFee>>({});
  const onFee = useCallback((k: string, x: ProductFee) => setFees((o) => (o[k] === x ? o : { ...o, [k]: x })), []);
  const loc = useLocation();
  const byK = useMemo(() => new Map(((data?.funds ?? []) as FundX[]).map((f) => [f.k, f])), [data]);
  const list = (Array.isArray(mine) ? mine : []).filter((m) => m && typeof m.k === 'string');
  const keys = list.map((m) => m.k);
  const empty = list.length === 0;
  const histKeys = useMemo(() => (empty ? [EXAMPLE] : keys), [empty, keys.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const { hist } = useHists(histKeys);
  const firstDep = shownDepKey(list, byK);
  const [depFocus, setDepFocus] = useState(false);

  // a link from the fund card (/my#p9757) lands on that product's row; /my#deposits opens the first pension or השתלמות on its watchdog
  const did = useRef('');
  useEffect(() => {
    if (!data || !loc.hash || did.current === loc.hash) return;
    did.current = loc.hash;
    if (loc.hash === '#deposits') { if (firstDep) { setDepFocus(true); host.openSheet(`product:${firstDep}`); } return; }
    if (loc.hash !== '#watch') document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [data, loc.hash, firstDep]);  // eslint-disable-line react-hooks/exhaustive-deps

  const rows: SumRow[] = useMemo(() => (!data || dfile === undefined ? [] : list.flatMap((m) => { const f = byK.get(m.k); if (!f) return [];
    // W6: the fund's own coefficient (its bylaws) for the reader's sex, retirement age and birth year; the assumption where there is none
    const pick = coefFor(coefF, f.grp, sex, R.v, birthYearOf(ageS ?? AGE_DEFAULT));
    return [{ k: f.k, name: f.name, prod: f.prod, coefReal: pick.real, c: cardCalc(f, data.funds as FundX[], data.asof, dfile, m, dec, { age: ageS ?? AGE_DEFAULT, coef: pick.v, ret: RET_FALLBACK, retire: R.v }) }]; })),
    [data, dfile, dec, coefF, list, byK, ageS, sex, R.v]);  // eslint-disable-line react-hooks/exhaustive-deps

  const membersOf = useMemo(() => {
    const m = new Map<string, FundX[]>();
    return (f: FundX) => { const k = catKey(f); if (!m.has(k)) m.set(k, typeMembers((data?.funds ?? []) as FundX[], k)); return m.get(k)!; };
  }, [data]);

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data || dfile === undefined) return <Loading what="המוצרים שלך" />;

  const funds = data.funds as FundX[];
  const asof = data.asof;
  const add = (k: string) => {
    if (!list.some((m) => m.k === k)) setMine([...list, { k, added: today() }]);
    setAdding(false); setStep(1);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(k)?.scrollIntoView({ block: 'start' })));
  };
  const patch = (k: string) => (p: Partial<MyProduct>) => setMine(list.map((m) => (m.k === k ? { ...m, ...p } : m)));
  const remove = (k: string) => setMine(list.filter((m) => m.k !== k));
  const shown = list.map((m) => ({ m, f: byK.get(m.k) }));
  const live = shown.filter((x): x is { m: MyProduct; f: FundX } => !!x.f);
  const cmpHref = (k: string) => { const ks = compareKeys([{ k }], funds); return ks.length > 1 ? `/funds/compare?k=${ks.join(',')}` : null; };
  const figOf = (f: FundX) => myRowFigures(f, hist[f.k], membersOf(f), cats?.[catKey(f)], asof);

  // sheets (?sheet=): a page's own ids, and compare's "why"
  const [sid, sarg] = host.own ?? ['', ''];
  const close = host.closeSheet;
  const open = (s: string) => host.openSheet(s);
  const prodK = sid === 'product' ? sarg : null, prodF = prodK ? byK.get(prodK) : undefined, prodM = prodK ? list.find((m) => m.k === prodK) : undefined;
  const [mK, mP] = sid === 'mmonth' ? sarg.split(':') : [null, null];
  const amtK = sid === 'amounts' ? sarg : null, amtF = amtK ? byK.get(amtK) : undefined;
  const monthCtx = (k: string) => ({
    keys: [k], basis: 'gross' as const, door, asof,
    setKeys: (ks: string[]) => nav(`/funds/compare?k=${ks.join(',')}`),
    openSheet: (s: SheetId) => (s.t === 'month' ? open(`mmonth:${k}:${s.p}`) : host.openSheet(s)),
  });
  /* build review B1 (P2-2): a month square opens the CARD's month sheet for that one product (keys = [k]): "כמה עשה המסלול", the type
     named, "כל N המסלולים באוקטובר ›" to the type-month sheet ("mtype:<k>:<yyyymm>"); previous / next stay on this product. */
  const cardCtx = (k: string): CardCtx | null => {
    const f = byK.get(k), h = hist[k];
    if (!f || !h) return null;
    const members = membersOf(f), key = catKey(f), tc = typeCount(members, 'm1', { asof });
    const c = cats?.[key] ?? null;
    return {
      f, h, cat: c && hasTypeAvg(members) ? c : null, members, funds, typeKey: key, tn: typeName(key), avgN: tc.ranked, rankN: tc.ranked, selfN: tc.self,
      asof, door, saved: true, old: oldGeneration(f), setView: () => {}, onMine: () => {}, my: list.find((m) => m.k === k) ?? null,
      host: { ...host, openSheet: (s) => (typeof s === 'string' ? (s.startsWith('type:') ? open(`mtype:${k}:${s.slice(5)}`) : open(s)) : s.t === 'month' ? open(`mmonth:${k}:${s.p}`) : host.openSheet(s)) },
    };
  };
  const mCtx = mK && mP ? cardCtx(mK) : null;
  const [tK, tP] = sid === 'mtype' ? sarg.split(':') : [null, null], tF = tK ? byK.get(tK) : undefined;
  const feeItems = live.map(({ f }) => ({ f, x: fees[f.k] })).filter((r): r is { f: FundX; x: ProductFee } => !!r.x);
  const sum = myFeeSum(feeItems.map(({ x }) => ({ cost: x.cost, own: x.own })));
  const todo = feeItems.find(({ x }) => !x.own);
  const msgEl = msg && <p className="sv-done" role="status">{msg}</p>;
  const meBtn = <button type="button" className="my-me" id="me-btn" onClick={() => open('profile')} aria-haspopup="dialog">{ME_BTN}</button>;

  const sheets = (
    <>
      <ProfileSheet open={sid === 'profile'} onClose={close} rows={rows} coefF={coefF} onProduct={(k) => open(`product:${k}`)} onAmounts={(k) => open(`amounts:${k}`)} />
      {prodF && <DeeperSheet open onClose={() => { setDepFocus(false); close(); }} id="sheet-product" detent="full" title={fullLabel(prodF.grp, catKey(prodF))} sub={prodF.name}>
        <ProductCard sheet f={prodF} data={data} cats={cats} dfile={dfile} my={prodM} onChange={prodM ? patch(prodF.k) : undefined}
          onRemove={prodM ? () => { remove(prodF.k); close(); } : undefined} onAmounts={prodM ? () => open(`amounts:${prodF.k}`) : undefined}
          focus={depFocus && prodF.k === firstDep ? 'deposits' : undefined} />
      </DeeperSheet>}
      {mCtx && mP ? <CardMonthSheet key={`${mK}:${mP}`} c={mCtx} p={mP} onClose={close} /> : null}
      {tF && tP ? <TypeMonthSheet open onClose={close} typeKey={catKey(tF)} p={Number(tP)} mineKeys={door === 'saver' ? keys : []} door={door} typeName={typeName(catKey(tF))} onTrack={(x) => backThen(() => nav(`/funds/${x}`))} /> : null}
      {amtF && <AmountsSheet open onClose={close} target={{ k: amtF.k }} name={fullLabel(amtF.grp, catKey(amtF))} deposits={fees[amtF.k]?.deposits ?? true} />}
      <DeeperSheet open={sid === 'myfees'} onClose={close} id="sheet-myfees" title={MY_FEES_TITLE} sub={<NumText t={myFeesSub(feeItems.map(({ x }) => x))} />}>
        <dl className="my-fees" id="myfees">
          {feeItems.map(({ f, x }) => (
            <div key={f.k}>
              <dt>{fullLabel(f.grp, catKey(f))}
                <button type="button" className={`my-fees-tag ${x.own ? 'own' : 'ex'}`} onClick={() => open(`amounts:${f.k}`)}>{myFeesRowTag(x.own)}</button></dt>
              <dd><NumText t={x.cost == null ? '–' : ilsSym(x.cost)} /></dd>
            </div>
          ))}
          <div className="tot"><dt>{MY_FEES_TOTAL}</dt><dd><NumText t={ilsSym(feeItems.reduce((t, { x }) => t + (x.cost ?? 0), 0))} /></dd></div>
        </dl>
        <p className="cs-note">{MY_FEES_NOTE}</p>
      </DeeperSheet>
      <DeeperSheet open={sid === 'import'} onClose={close} id="sheet-import" title="ייבוא מהמסלקה" sub="הקובץ נקרא בדפדפן הזה בלבד" detent="full">
        <MaslakaImport funds={funds} mine={list} today={today()} onSave={(next, m) => { setMine(next); setMsg(m); close(); requestAnimationFrame(() => window.scrollTo({ top: 0 })); }} />
      </DeeperSheet>
      {host.cmp?.t === 'why' && <WhySheet {...monthCtx(keys[0] ?? EXAMPLE)} open onClose={close} />}
    </>
  );

  // ---------- empty, or adding: the three-tap flow in place of the list ----------
  if (empty || adding) {
    const ex = byK.get(EXAMPLE);
    return (
      <div className="sv-page ro-page my-page">
        <div className="my-hero">
          <div><h1>{empty ? MY_TITLE : 'מוצר נוסף'}</h1><p>{MY_EMPTY_LINE}</p></div>
          {empty ? (P.list.length > 1 ? meBtn : null) : <button type="button" className="my-me" onClick={() => { setAdding(false); setStep(1); }}>ביטול</button>}
        </div>
        {msgEl}
        <Picker funds={funds} have={keys} onPick={add} onStep={setStep} />
        {empty && step === 1 && <>
          <button type="button" className="my-line" onClick={() => open('import')}><span className="ic" aria-hidden="true">⇪</span><span>{MY_IMPORT}</span><u aria-hidden="true">›</u></button>
          {ex && <>
            <div className="my-exlab">{MY_EXAMPLE} <span className="my-demo">{MY_EXAMPLE_TAG}</span></div>
            <MyProductRow example f={ex} i={0} fig={figOf(ex)} members={membersOf(ex)} cmpHref={cmpHref(ex.k)} />
          </>}
        </>}
        {/* build review B1 (P3-5): the empty state ends on the stamp too (the budget is measured to it) */}
        {empty && step === 1 ? <StampLine asof={asof} onWhy={() => host.openSheet({ t: 'why' })} /> : null}
        <p className="sv-privacy"><Icon name="shield" /> {MY_PRIVACY} <Link to="/about">על האתר והמקורות</Link></p>
        {sheets}
      </div>
    );
  }

  // ---------- with products ----------
  const w = myWords(asof, live.map(({ f }) => ({ m: f.m1, y: f.y12 })), { who: who(pid) });
  return (
    <div className="sv-page ro-page my-page">
      <div className="my-head">
        <span className="icotile"><Icon name="mine" /></span>
        <h1>{MY_TITLE}<small>{monthYear(asof)}{pid !== 'me' ? ` · ${PROFILE_LABEL[pid]}` : ''}</small></h1>
        {meBtn}
      </div>
      {msgEl}
      <Takeaway text={w} />
      <div className="my-list">
        {shown.map(({ m, f }, i) => f
          ? <MyProductRow key={m.k} f={f} i={i} fig={figOf(f)} members={membersOf(f)} my={m} cmpHref={cmpHref(f.k)} onFee={onFee}
              onOpen={() => open(`product:${f.k}`)} onMonth={(p) => open(`mmonth:${f.k}:${p}`)} />
          : <div key={m.k} className="my-row my-gone" id={m.k}><p><b>{m.k}</b> · {MY_GONE} ({ymL(asof)}).</p><button type="button" className="sv-chip" onClick={() => remove(m.k)}>הסרה מהרשימה</button></div>)}
      </div>
      {feeItems.length > 0 && <button type="button" className="my-line" id="fee-sum" onClick={() => open('myfees')} aria-haspopup="dialog">
        <span className="ic" aria-hidden="true">₪</span><span><NumText t={sum.text} />{sum.sub && <small className="ex"><NumText t={sum.sub} /></small>}</span><u aria-hidden="true">›</u>
      </button>}
      {todo && <button type="button" className="my-line todo" id="todo-amt" onClick={() => open(`amounts:${todo.f.k}`)} aria-haspopup="dialog">
        <span className="ic" aria-hidden="true">!</span><span>{todoAmounts(fullLabel(todo.f.grp, catKey(todo.f)), todo.x.deposits)}</span><u aria-hidden="true">›</u>
      </button>}
      <div className="my-chips">
        <button type="button" className="sv-chip my-chip" id="add-more" onClick={() => { setAdding(true); setStep(1); requestAnimationFrame(() => window.scrollTo({ top: 0 })); }}>＋ מוצר נוסף</button>
        <button type="button" className="sv-chip my-chip" onClick={() => open('import')}>ייבוא מהמסלקה</button>
        <CheckupLink has chip />
      </div>
      <CheckupLink has />
      <MomentChips lead={false} />
      <SinceVisit data={data} dfile={dfile} list={list} />
      <Watching data={data} />
      <StampLine asof={asof} onWhy={() => host.openSheet({ t: 'why' })} />
      <p className="sv-privacy"><Icon name="shield" /> {MY_PRIVACY} <Link to="/about">על האתר והמקורות</Link></p>
      {sheets}
    </div>
  );
}

/** Phase 0: the tracks this browser follows (the ☆ on every track card, lib/fundsTime watch store), one line each: the last 12 months,
 *  the fee and a "new month" chip against the last look. The look is recorded when the reader leaves, only if the list was opened. */
function Watching({ data }: { data: FundsFile }) {
  const [w, setW] = useWatch();
  const { hash } = useLocation();
  const asof = data.asof;
  const byK = useMemo(() => new Map(((data.funds ?? []) as FundX[]).map((f) => [f.k, f])), [data]);
  const now = useMemo(() => { const m = new Map<string, WSnap>(); w.items.forEach((i) => { const f = byK.get(i.k); if (f) m.set(i.k, snapOf(f, asof)); }); return m; }, [w, byK, asof]);
  const [open, setOpen] = useState(hash === '#watch');
  // /my#watch (where /funds/watch lands) opens the list and brings it into view once the cards above it have taken their height
  useEffect(() => { if (hash !== '#watch') return; setOpen(true); const t = setTimeout(() => document.getElementById('watch')?.scrollIntoView({ block: 'start' }), 250); return () => clearTimeout(t); }, [hash]);
  const ref = useRef({ w, now, opened: open }); ref.current = { w, now, opened: ref.current.opened || open };
  useEffect(() => {
    const mark = () => { const r = ref.current; if (r.opened && r.w.items.length) setW(markSeen(r.w, r.now, asof)); };
    addEventListener('pagehide', mark);
    return () => { removeEventListener('pagehide', mark); mark(); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!w.items.length) return hash === '#watch' ? <p id="watch" className="sv-muted mw-empty">במעקב: עוד אין מסלולים. ☆ בכרטיס של כל מסלול מוסיף אותו לכאן.</p> : null;
  const y12 = (f: FundX) => f.y12;
  const fresh = w.items.filter((i) => deltaOf(i, now.get(i.k) ?? null)?.fresh).length;
  return (
    <details id="watch" className="panel mw" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><h2>במעקב</h2><span><span className="num">{w.items.length}</span> מסלולים{fresh > 0 && <> · <span className="num">{fresh}</span> עם חודש חדש</>}</span></summary>
      <ul className="mw-list">{w.items.map((i) => {
        const f = byK.get(i.k), d = deltaOf(i, now.get(i.k) ?? null);
        if (!f) return <li key={i.k}><b>{i.name}</b><span>לא בנתוני הרשות ({ymL(asof)}): ייתכן שנסגר או מוזג</span></li>;
        const r = y12(f);
        return (
          <li key={i.k} className={d?.fresh ? 'fresh' : undefined}>
            <Link className="sv-u" to={`/funds/${f.k}`}>{f.name}</Link>
            <span className="mw-kv">12 חודשים {r == null ? '–' : <Sourced src={() => grossProv(f, 'y12', asof)}><span className="num">{nf(r, 2)}%</span></Sourced>}</span>
            <span className="mw-kv">דמי ניהול {f.fee == null ? '–' : <span className="num">{nf(f.fee, 2)}%</span>}{d?.dFee ? <span> (<span className="num">{d.dFee > 0 ? '▲' : '▼'} {nf(Math.abs(d.dFee), 2)}</span> נ"א מאז)</span> : null}</span>
            {d?.fresh && <span className="chip est">{d.months === 1 ? 'חודש חדש' : `${d.months} חודשים חדשים`}</span>}
            <WatchStar f={f} asof={asof} small />
          </li>
        );
      })}</ul>
      <p className="sv-muted mw-note">נתוני {ymL(asof)}, ברוטו · "חודש חדש": מאז הביקור הקודם ברשימה · נשמר רק בדפדפן הזה</p>
    </details>
  );
}

/** S1 (fox 3.0): the way into the annual check-up (/my/checkup), and its 30-day reminder when one is due (S2). It takes the place of
 *  the "איך קוראים את הדוח השנתי?" card (the plan merges the statement guide into "רגעים" as "הדוח השנתי הגיע"; the check-up links
 *  to it), so the page stays inside its 400-word budget */
function CheckupLink({ has, chip }: { has: boolean; chip?: boolean }) {
  const [raw] = useMy<unknown>('my:nego', []);
  const due = dueNegos(normNegos(raw), isoDay(new Date())).length > 0;
  // red team 06.11.26: after a check-up, its status ("2 לטיפול · חסכתם כ-… · הבדיקה הבאה 10/27") in place of the generic line
  const [stRaw] = useMy<unknown>(CK_STATUS_KEY, null);
  const st = has ? normStatus(stRaw) : null;
  // rollout 5.2 #6: a chip ("הבדיקה השנתית") in the row under the products; the full row only when there is something to say
  if (chip && !due && !st) return <Link to="/my/checkup" className="sv-chip my-chip sv-ck">הבדיקה השנתית</Link>;
  if (chip) return null;
  if (!due && !st && has) return null;
  return (
    <Link to="/my/checkup" className={`panel sv-stmt sv-ck${due ? ' due' : ''}`}>
      <span className="icotile"><Icon name={due ? 'calendar' : 'check'} /></span>
      <span className="sv-stmt-t"><b>{due ? 'עברו 30 יום: מה דמי הניהול עכשיו?' : 'הבדיקה השנתית'}</b><span>{due ? 'הזינו ונחשב כמה חסכתם.' : st ? statusLine(st) : has ? 'דמי ניהול, הפקדות ומסלול גיל.' : 'מקובץ המסלקה, בשלוש שורות.'}</span></span>
      <span className="sv-stmt-go" aria-hidden="true">←</span>
    </Link>
  );
}

/** W7: the first product the deposit watchdog reads (pension or השתלמות), for the link from /my/statement */
function shownDepKey(list: MyProduct[], byK: Map<string, FundX>): string | null {
  const pen = list.find((m) => { const p = byK.get(m.k)?.prod; return p === 'פנסיה מקיפה' || p === 'פנסיה כללית'; });
  return (pen ?? list.find((m) => byK.get(m.k)?.prod === 'השתלמות'))?.k ?? null;
}
