import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CompareTray, FundsNav } from '../components/FundsNav';
import { ErrorBox, Loading, Toolbar } from '../components/ui';
import { DeeperSheet } from '../components/DeeperSheet';
import { LensTabs } from '../components/LensTabs';
import { AmountsSheet } from '../components/AmountsSheet';
import { NumText } from '../components/NumText';
import { ProdIcon } from '../components/compare/PickerSheet';
import { Ico } from '../components/home/glyphs';
import { useFundCats, useFunds } from '../lib/useData';
import { catKey, selfDirected, type CatX, type FundX, type FundsFile } from '../lib/funds';
import type { DefaultFile } from '../lib/fundsTools';
import { useOptional } from '../lib/fundsLoad';
import { ToolLinks } from './FundsTools';
import { useActiveDoor } from '../components/home/doorState';
import { useMine, useMyAge, useMySex, useRetire } from '../lib/mine';
import { useMyAmounts } from '../lib/myAmounts';
import { useAddressWrite, useSheetHost } from '../lib/sheetHost';
import { backThen } from '../components/Sheet';
import { prodHasDeposit, typeHasDepositFee, typeMembers } from '../lib/pageMonths';
import { FEES_SUB, FEES_TITLE, amountsBtn, feesLenses, fullLabel, ilsNum, prodLabel, typeLabel, typeName } from '../lib/pageWords';
import { TILES, prodShort, tracksOf, type PFund } from '../lib/pickTiles';
import { shortGrp } from './compare/tracks';
import { BALANCE_EX, exampleMonthly } from '../lib/retire';
import { FeesBoard } from './fees/FeesBoard';
import { FeesEntry } from './fees/FeesEntry';
import { FeesTrackSheet } from './fees/FeesTrackSheet';
import { AGE_EX, AfterRetire, AgeStep, AssumeSheet, RetFig, RetLens, SensLens, feeModel, feesLensOf, useCareerOut } from './fees/FeesCareer';
import '../styles/lens.css';
import '../styles/fundsTools.css';
import '../styles/rollout.css';
import '../styles/fees-board.css';
import '../components/compare/picker.css';

/* /funds/tools/fees, "דמי ניהול, בשקלים" (rollout spec §7 as amended by §16–18, owner decision D4; mockup v4 `?page=fees`; T-F1…T-F4,
   page side). The first screen answers "כמה אני משלם דמי ניהול, בשקלים?": one sentence that leads with the reader's own figure, then
   every track of the reader's type ranked by its yearly cost in ₪ (fees/FeesBoard). It never opens on a track the reader did not pick:
   with a saved product, that product's type with its row marked; without one, the entry (fees/FeesEntry); agent and Pro open on
   pension · up to 50, as today.
   - Pickers: product ▾, type ▾ (only the types that exist, with their track counts), "הסכומים שלי" (components/AmountsSheet; the amounts
     are read through lib/myAmounts only).
   - Lenses (`?v=`): "בשנה" · "עד הפרישה" (age first in the saver door); agent and Pro add "רגישות" and "בפרישה" (today's panels,
     fees/FeesCareer). Every input of today's calculator stays in the address (age, ra, sal, g, rate, r, inf, b0, coef, da, fa, db, fb,
     k), so shared links open the same state; a link with any of them and no lens opens on "בפרישה" (agent, Pro) or "עד הפרישה" (saver).
   - Address state is written with replace (lenses, pickers, sheets); the sheets: amounts, prod, trk, assume, track:<k>. */

type DoorK = 'saver' | 'agent' | 'pro';
const AGENT_DEFAULT = 'פנסיה מקיפה | עד 50';
const CLEAR_PAIRS = { k: null, da: null, fa: null, db: null, fb: null } as const;

export function FundsFees() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cats = useFundCats().data as Record<string, CatX> | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const [sp] = useSearchParams();
  const write = useAddressWrite();
  const host = useSheetHost();
  const [door] = useActiveDoor();
  const saver = door !== 'agent' && door !== 'pro';
  const doorK: DoorK = saver ? 'saver' : (door as DoorK);
  const [myList] = useMine(), [ageS, setAge] = useMyAge(), [sex] = useMySex();
  const RT = useRetire();
  const asof = data?.asof ?? 0;

  const funds = useMemo(() => ((data?.funds ?? []) as FundX[]), [data]);
  const byK = useMemo(() => new Map(funds.map((f) => [f.k, f])), [funds]);
  // the reader's saved products (saver door only: an agent's or a Pro's own products are not a client's)
  const myFunds = useMemo(() => (saver ? myList.map((m) => byK.get(m.k)).filter((f): f is FundX => !!f) : []), [saver, myList, byK]);
  const typeCount = useMemo(() => { const m = new Map<string, number>(); for (const f of funds) if (!f.closed && !f.gone && (f.assets ?? 0) > 0) m.set(catKey(f), (m.get(catKey(f)) ?? 0) + 1); return m; }, [funds]);
  /** the type a product opens on: the reader's saved product of that product, else "כללי", else its largest type */
  const typeFor = (prod: string) => {
    const mf = myFunds.find((f) => f.prod === prod && !f.closed);
    if (mf) return catKey(mf);
    if (typeCount.get(`${prod} | כללי`)) return `${prod} | כללי`;
    const best = [...typeCount.entries()].filter(([k]) => k.startsWith(prod + ' | ') && !/מקבלי קצבה/.test(k)).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : `${prod} | כללי`;
  };

  // product and type on screen: the address (`cat`, or `prod` [+ `track`]), else the reader's first saved product, else the entry
  const prodQ = sp.get('prod'), catQ = sp.get('cat') ?? (prodQ ? (sp.get('track') ? `${prodQ} | ${sp.get('track')}` : null) : null);
  const first = myFunds.find((f) => !f.closed && !f.gone) ?? myFunds[0];
  const cat = catQ ?? (prodQ && data ? typeFor(prodQ) : saver ? (first ? catKey(first) : null) : AGENT_DEFAULT);
  const entry = saver && !cat;
  const key = cat ?? AGENT_DEFAULT;
  const [prod, track] = key.split(' | ');

  const members = useMemo(() => typeMembers(funds, key), [funds, key]);
  /** today's calculator rows: open tracks with a published fee, not self-managed, cheapest first */
  const calcRows = useMemo(() => members.filter((f) => !selfDirected(f) && f.fee != null).sort((a, b) => (a.fee! - b.fee!) || ((a.depfee ?? 0) - (b.depfee ?? 0))), [members]);
  // the reader's own track of this type (saver): the one in the address when it is saved, else the first saved product of the type
  const mineIn = myFunds.filter((f) => catKey(f) === key);
  const mineF = mineIn.find((f) => f.k === sp.get('k')) ?? mineIn[0] ?? null;
  const mineK = mineF?.k ?? null;
  const mineP = mineK ? myList.find((m) => m.k === mineK) : undefined;
  const amounts = useMyAmounts({ prod, cat: key, funds });
  const depFee = typeHasDepositFee(members), prodDep = prodHasDeposit(prod);

  // the lens: the address; a link with today's calculator inputs and no lens opens on "בפרישה" (agent, Pro) / "עד הפרישה" (saver)
  const tabs = feesLenses(doorK), ids = tabs.map(([t]) => t);
  const lens = feesLensOf(sp, ids, saver);
  const career = lens === 'career';
  const deposits = prodDep && (career || depFee);

  const model = feeModel({ sp, saver, cat: key, prod, asof, members: calcRows, cats, dfile, own: mineP, ageS, sex, retire: RT, balance: amounts.balance, monthly: amounts.monthly });
  const out = useCareerOut(model, lens === 'sens');
  const ageKnown = !saver || sp.get('age') != null || ageS != null;

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="דמי ניהול" />;

  const set = (patch: Record<string, string | null>) => write(patch);
  const pickProd = (p: string) => set({ cat: typeFor(p), prod: null, track: null, ...CLEAR_PAIRS, sheet: null });
  /** a choice made inside a sheet: back over the sheet's history entry first, then write the page's address (components/Sheet backThen) */
  const fromSheet = (patch: Record<string, string | null>) => backThen(() => set({ prod: null, track: null, ...CLEAR_PAIRS, ...patch, sheet: null }));
  const sheet = host.own?.[0] ?? null;
  const trackK = host.cmp?.t === 'track' ? host.cmp.k : null;
  const openAmounts = () => host.openSheet('amounts');
  const openAssume = () => host.openSheet('assume');

  if (entry) {
    return (
      <div className="ro-page fb-page">
        <FeesEntry onPick={pickProd} />
      </div>
    );
  }

  const amountsName = amounts.where === 'mine' && mineF ? fullLabel(shortGrp(mineF.grp), key) : prodLabel(prod);
  const boardAmounts = { own: amounts.own, depositOwn: amounts.depositOwn, base: amounts.base, balance: amounts.balance, monthly: amounts.monthly };
  const typeChips = tracksOf(funds as unknown as PFund[], prod).filter((t) => typeCount.get(`${prod} | ${t.track}`));
  const prodsOther = [...new Set(funds.filter((f) => !f.closed && !f.gone && (f.assets ?? 0) > 0 && f.fee != null).map((f) => f.prod))]
    .filter((p) => !TILES.some((t) => t.prods[0] === p));
  const amountsLine = career ? (
    <NumText t={`${amounts.own ? 'הסכומים שלך' : 'לדוגמה'}: חיסכון ${ilsNum(amounts.balance ?? BALANCE_EX)} ש״ח, הפקדה ${ilsNum(amounts.depositOwn && amounts.monthly != null ? amounts.monthly : exampleMonthly(prod).v)} ש״ח בחודש`} />
  ) : null;

  let body;
  if (lens === 'sens') body = <SensLens m={model} out={out} nominal={sp.get('nom') === '1'} setNominal={(v) => set({ nom: v ? '1' : null })} onAssume={openAssume} />;
  else if (lens === 'ret') body = <RetLens m={model} out={out} sp={sp} set={set} asof={asof} cat={key} onAssume={openAssume} />;
  else if (career && !ageKnown) body = <AgeStep onAge={(a) => { setAge(a); set({ age: null }); }} onOther={openAmounts} onExample={() => set({ age: AGE_EX })} />;
  else if (career && model.C.age >= model.C.retire) body = <AfterRetire />;
  else body = (
    <FeesBoard members={members} typeKey={key} prod={prod} mineK={saver ? mineK : null} ownFee={saver && mineP && mineP.fee != null && Number.isFinite(mineP.fee) ? { fee: mineP.fee, depfee: mineP.depfee } : null}  /* one own-fee rule (myFeeCost): only a typed own fee counts */
      amounts={boardAmounts} deposits={deposits} mode={career ? 'career' : 'yr'} career={career ? model.assume : undefined} ageOwn={model.ageOwn} retNote={<>התשואה: <RetFig m={model} /></>}
      saver={saver} asof={asof} onRow={(k) => host.openSheet({ t: 'track', k })} onAmounts={openAmounts} onAssume={openAssume} />
  );

  return (
    <div className="ro-page fb-page">
      <div className="fb-head">
        <span className="icotile" aria-hidden="true"><Ico name="fee" /></span>
        <div><h1>{FEES_TITLE}</h1><div className="sub">{FEES_SUB}</div></div>
      </div>
      {door === 'pro' ? <Toolbar lead={<FundsNav />}>{null}</Toolbar> : null}
      <CompareTray />
      <div className="fb-picks">
        <button type="button" className="fb-pill" id="fee-prod" onClick={() => host.openSheet('prod')} aria-haspopup="dialog"><span>{prodLabel(prod)}</span><Caret /></button>
        <button type="button" className="fb-pill" id="fee-type" onClick={() => host.openSheet('trk')} aria-haspopup="dialog"><span>{typeLabel(track)}</span><Caret /></button>
        <button type="button" className={`fb-pill amt${amounts.own ? ' on' : ''}`} id="amounts-btn" onClick={openAmounts} aria-haspopup="dialog"><span>{amountsBtn(amounts.own)}</span></button>
      </div>
      <LensTabs tabs={tabs} value={lens} onChange={(v) => set({ v })} />
      <div className="fb-body">{body}</div>
      {!saver ? <div className="fb-tools"><ToolLinks /></div> : null}

      <AmountsSheet open={sheet === 'amounts'} onClose={host.closeSheet} target={{ prod, cat: key, funds }} name={amountsName}
        deposits={prodDep && depFee} withAge={career && saver} />
      <AssumeSheet open={sheet === 'assume'} onClose={host.closeSheet} m={model} prod={prod} cat={key} set={set}
        amountsLine={amountsLine} onAmounts={career ? () => set({ sheet: 'amounts' }) : undefined} />
      <DeeperSheet open={sheet === 'prod'} onClose={host.closeSheet} id="sheet-prod" title="איזה מוצר?">
        <div className="pk-prods" id="prod-tiles">
          {TILES.map((t) => (
            <button key={t.id} type="button" className={`pk-prod${t.prods.includes(prod) ? ' on' : ''}`} onClick={() => fromSheet({ cat: typeFor(t.prods[0]) })}>
              <ProdIcon art={t.art} /><span>{t.label}</span>
            </button>
          ))}
        </div>
        {prodsOther.length ? (
          <>
            <p className="fb-sheeth">עוד מוצרים</p>
            <div className="pk-chips">{prodsOther.map((p) => <button key={p} type="button" className={`pk-chip${p === prod ? ' on' : ''}`} onClick={() => fromSheet({ cat: typeFor(p) })}>{prodShort(p)}</button>)}</div>
          </>
        ) : null}
      </DeeperSheet>
      <DeeperSheet open={sheet === 'trk'} onClose={host.closeSheet} id="sheet-trk" title="איזה סוג מסלול?" sub={prodShort(prod)}>
        <div className="pk-chips" id="trk-chips">
          {typeChips.map((t) => (
            <button key={t.track} type="button" className={`pk-chip${t.track === track ? ' on' : ''}`} onClick={() => fromSheet({ cat: `${prod} | ${t.track}` })}>
              {typeLabel(t.track)} <small className="fb-n"><bdi dir="ltr">{typeCount.get(`${prod} | ${t.track}`)}</bdi></small>
            </button>
          ))}
        </div>
        <p className="cs-note">{typeName(key)}: {members.length} מסלולים פתוחים.</p>
      </DeeperSheet>
      {trackK ? (
        <FeesTrackSheet k={trackK} file={data} cats={cats} door={doorK} own={saver ? myList.find((m) => m.k === trackK) : null} onClose={host.closeSheet} />
      ) : null}
    </div>
  );
}

const Caret = () => <svg className="fb-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;
