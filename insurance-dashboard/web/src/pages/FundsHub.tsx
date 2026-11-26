import { useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { LensTabs } from '../components/LensTabs';
import { StampLine } from '../components/StampLine';
import { TypeMonthSheet } from '../components/TypeMonthSheet';
import { DeeperSheet } from '../components/DeeperSheet';
import { WhySheet } from '../components/compare/WhySheet';
import { ProdIcon } from '../components/compare/PickerSheet';
import { Facts } from '../components/compare/sheetKit';
import { Sourced } from '../components/Source';
import { ErrorBox, Loading } from '../components/ui';
import { backThen } from '../components/Sheet';
import { useActiveDoor } from '../components/home/doorState';
import { useFundCats, useFunds } from '../lib/useData';
import { useMine } from '../lib/mine';
import { useAddressWrite, useSheetHost } from '../lib/sheetHost';
import { countP, fundP, listP } from '../lib/market';
import { catKey, refOf, selfDirected, type CatX, type FundX, type FundsFile, type Per } from '../lib/funds';
import type { Prov } from '../lib/prov';
import { nf } from '../lib/format';
import { HUB_TITLE, hubLenses, monthYear, prodLabel, typeName } from '../lib/pageWords';
import { RISK_NOTE_TITLE } from '../lib/compareWords';
import { HubMonth, type HubCtx } from './hub/HubMonth';
import { HubLeaders, HUB_WINS } from './hub/HubLeaders';
import { HubChanges } from './hub/HubChanges';
import type { CmpCtx, SheetId } from './compare/contract';
import type { IsoMat } from '../lib/pickTiles';
import '../styles/rollout.css';
import '../styles/funds-hub.css';

/* /funds, "החודש בחיסכון" (rollout spec §6 as amended by §16–18, mockup v4 ?page=hub; tickets T-H1 … T-H4, B6).
   The question for every door: what happened this month in savings. Head, the product chips, the lens strip, one lens:
   - "החודש" (default): the sentence, then track types × six months (hub/HubMonth);
   - "ראשונים ואחרונים" / agent and Pro "מובילים ומאספים": a small board per type (hub/HubLeaders);
   - "שינויים": the gap inside each type; agent and Pro also the old hub's spread, movers and fee changes (hub/HubChanges);
   - "עוד": the six destinations with their isometric icons and the two totals (tracks open to the public, assets).
   Address (B6): ?prod= (the product), ?v= (the lens), ?win= (the agent's and Pro's leaders window), ?sheet= (the open sheet); all written
   with replace, so Back leaves the page and a reload keeps them (App.tsx FundsRoot keeps ?prod= alone on the hub). Default product (D5):
   the reader's first saved product, else pension. Pro keeps the section's tab row (FundsNav, inside FundsHead) above the head.
   Returns are the published gross; the page never reads or passes a basis. */

/** the product chips: the saver's five (6.2 #2); the agent and Pro also get every other product the old hub listed */
const PRODS5 = ['פנסיה מקיפה', 'השתלמות', 'גמל להשקעה', 'גמל', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)'];
const PRODS_MORE = ['פנסיה כללית', 'חיסכון לילד', 'מרכזית לפיצויים'];
const DEFAULT_PROD = 'פנסיה מקיפה';
const LENSES = ['month', 'lead', 'chg', 'tools'] as const;
type Lens = (typeof LENSES)[number];
/* the guard line's sheet (mockup v4 "risk") */
const RISK_TEXT = 'יותר מניות: עולה ויורד חזק יותר. סוגי מסלולים שונים הם רמות סיכון שונות, ולכן לא מסמנים ראשון ואחרון ביניהם.';
const RISK_MORE_TEXT = 'כדי לראות מי היה ראשון ומי אחרון, בוחרים סוג אחד: לחיצה על משבצת או על שם הסוג פותחת את כל המסלולים שלו באותו חודש.';

export function FundsHub() {
  const { data: raw, error } = useFunds();
  const file = raw as FundsFile | null;
  const cats = (useFundCats().data as Record<string, CatX> | null) ?? null;
  const [doorRaw] = useActiveDoor();
  const door = doorRaw === 'agent' || doorRaw === 'pro' ? doorRaw : 'saver';   // no door = the saver (B1, D3)
  const saver = door === 'saver';
  const [mine] = useMine();
  const [sp] = useSearchParams();
  const write = useAddressWrite();
  const nav = useNavigate();
  const { sheet, cmp, openSheet, closeSheet, own } = useSheetHost();

  const byK = useMemo(() => new Map((file?.funds ?? []).map((f) => [f.k, f as FundX])), [file]);
  const mineFunds = useMemo(() => (Array.isArray(mine) ? mine : []).map((m) => byK.get(m.k)).filter((f): f is FundX => !!f), [mine, byK]);
  const prods = useMemo(() => (saver ? PRODS5 : [...PRODS5, ...PRODS_MORE]).filter((p) => !file || file.funds.some((f) => f.prod === p && !f.closed && !(f as FundX).gone)), [saver, file]);
  const asked = sp.get('prod');
  const prod = asked && prods.includes(asked) ? asked : mineFunds.find((f) => prods.includes(f.prod))?.prod ?? DEFAULT_PROD;
  const vq = sp.get('v');
  const lens: Lens = (LENSES as readonly string[]).includes(vq ?? '') ? (vq as Lens) : 'month';
  const wq = sp.get('win') as Per | null;
  const win: Per = wq && HUB_WINS.includes(wq) ? wq : 'm1';
  // "שלי" and the tint are the saver's (§16.1 6d); the reader's type of this product: their first saved track of it (not self-managed)
  const mineKeys = useMemo(() => (saver ? mineFunds.map((f) => f.k) : []), [saver, mineFunds]);
  const mineF = saver ? mineFunds.find((f) => f.prod === prod && !selfDirected(f)) ?? null : null;
  const mineKey = mineF ? catKey(mineF) : null;

  const openType = useCallback((key: string, p: number) => openSheet(`type:${p}:${key}`), [openSheet]);
  // ?sheet=type:<yyyymm>:<catKey>
  const tSheet = own && own[0] === 'type' ? (() => { const i = own[1].indexOf(':'), p = Number(own[1].slice(0, i)), key = own[1].slice(i + 1); return i > 0 && p > 0 && key.includes(' | ') ? { p, key } : null; })() : null;

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!file || !cats) return <Loading what="קופות" />;
  const asof = file.asof;
  const ctx: HubCtx = { file, cats, asof, prod, door, saver, mineKeys, mineKey, openType, openSheet };
  const cmpCtx: CmpCtx = { keys: [], basis: 'gross', door, setKeys: (k) => nav(`/funds/compare?k=${k.join(',')}`), openSheet: openSheet as (s: SheetId) => void, asof };

  return (
    <div className="ro-page ro-hub">
      <FundsHead title={<>{HUB_TITLE} · <span className="hub-asof">{monthYear(asof)}</span></>} />
      <div className="hub-chips" id="prod-chips" role="group" aria-label="מוצר">
        {prods.map((p) => <button key={p} type="button" className={p === prod ? 'on' : undefined} aria-pressed={p === prod} onClick={() => p !== prod && write({ prod: p, sheet: null })}>{prodLabel(p)}</button>)}
      </div>
      <LensTabs tabs={hubLenses(door)} value={lens} onChange={(v) => write({ v: v === 'month' ? null : v, sheet: null })} />
      <div className="hub-body">
        {lens === 'month' ? <HubMonth ctx={ctx} />
          : lens === 'lead' ? <HubLeaders ctx={ctx} win={win} setWin={(w) => write({ win: w === 'm1' ? null : w })} />
            : lens === 'chg' ? <HubChanges ctx={ctx} />
              : <HubTools ctx={ctx} />}
        <StampLine asof={asof} onWhy={() => openSheet({ t: 'why' })} />
      </div>

      {tSheet ? (
        <TypeMonthSheet open onClose={closeSheet} typeKey={tSheet.key} p={tSheet.p} mineKeys={mineKeys} door={door} typeName={typeName(tSheet.key)}
          onTrack={(k) => backThen(() => nav(`/funds/${k}`))} />
      ) : null}
      {sheet === 'risk' ? (
        <DeeperSheet open onClose={closeSheet} id="risk-sheet" title={RISK_NOTE_TITLE}>
          <Facts items={[RISK_TEXT, RISK_MORE_TEXT]} />
        </DeeperSheet>
      ) : null}
      {cmp?.t === 'why' ? <WhySheet {...cmpCtx} open onClose={closeSheet} /> : null}
    </div>
  );
}

/* ---------- "עוד": the six destinations and the two totals (6.2 #7, T-H3, T-H4) ---------- */
type Art = [number, IsoMat][];
function HubTools({ ctx }: { ctx: HubCtx }) {
  const { file, asof, prod, saver } = ctx;
  const live = file.funds.filter((f) => f.assets && !f.closed && !f.gone && !selfDirected(f));
  const totalA = live.reduce((t, f) => t + (f.assets ?? 0), 0);
  const tiles: [string, string, string, Art, string][] = [
    [`/funds/screen?${new URLSearchParams({ prod }).toString()}`, 'כל המסלולים', 'דירוג וסינון לפי סוג', [[18, 'blue'], [30, 'navy'], [44, 'orange']], 'hub-t-screen'],
    ['/funds/compare', 'השוואה', 'חודש מול חודש, עד 4 מסלולים', [[22, 'navy'], [40, 'orange'], [30, 'blue']], 'hub-t-compare'],
    saver ? ['/funds/tools/fees', 'דמי ניהול', 'כמה זה עולה בשנה, בשקלים', [[14, 'blue'], [24, 'blue'], [36, 'orange']], 'hub-t-fees']
      : ['/funds/tools', 'כלים', 'דמי ניהול לאורך קריירה, ברירת מחדל, עוקבי מדד', [[14, 'blue'], [24, 'blue'], [36, 'orange']], 'hub-t-tools'],
    ['/savings', 'הענף', 'נכסים, צבירה וניוד', [[30, 'blue'], [38, 'navy'], [26, 'blue']], 'hub-t-savings'],
    ['/managers', 'מנהלים', 'החברות המנהלות לאורך זמן', [[40, 'navy'], [20, 'blue'], [32, 'navy']], 'hub-t-managers'],
    ['/holdings', 'הרכב נכסים', 'מה הגופים מחזיקים', [[38, 'orange'], [18, 'blue'], [28, 'navy']], 'hub-t-holdings'],
  ];
  const byCat = [...live.reduce((m, f) => m.set(catKey(f), [...(m.get(catKey(f)) ?? []), f]), new Map<string, FundX[]>()).entries()]
    .map(([k, fs]) => ({ k, fs, a: fs.reduce((t, f) => t + (f.assets ?? 0), 0) })).sort((x, y) => y.a - x.a).slice(0, 40);
  const assetsProv = (): Prov => ({ k: 'calc', title: 'נכסים, כל המסלולים הפתוחים לציבור', value: nf(totalA / 1000, 0), unit: 'מיליארד ש"ח', formula: 'סכום TOTAL_ASSETS של המסלולים הפתוחים לציבור, חלקי 1,000', note: 'מוצגות 40 הקטגוריות הגדולות',
    inputs: byCat.map((x) => ({ label: x.k, v: nf(x.a / 1000, 1), src: () => listP(`נכסים · ${x.k}`, nf(x.a, 0), 'מיליוני ש"ח', 'סכום TOTAL_ASSETS של המסלולים בקטגוריה', x.fs.map((f) => ({ label: f.name, v: nf(f.assets ?? 0, 1), src: () => fundP(refOf(f), asof, 'TOTAL_ASSETS', 'נכסים', nf(f.assets ?? 0, 1), 'מיליוני ש"ח') }))) })) });
  return (
    <div className="hub-tools-w">
      <nav className="hub-tools" id="hub-tools" aria-label="עוד בחיסכון">
        {tiles.map(([to, t, s, art, id]) => (
          <Link key={id} id={id} to={to} className="hub-tile"><ProdIcon art={art} size={50} /><b>{t}</b><small>{s}</small></Link>
        ))}
      </nav>
      <p className="hub-totals" id="hub-totals">
        <Sourced src={() => countP('מסלולים פתוחים לציבור', live.length, 'המסלולים הפתוחים לציבור שפורסמו בחודש האחרון, עם נכסים, בלי מסלולים בניהול אישי')}><bdi dir="ltr" className="sgnum">{nf(live.length, 0)}</bdi></Sourced> מסלולים פתוחים לציבור · נכסים{' '}
        <Sourced src={assetsProv}><bdi dir="ltr" className="sgnum">{nf(totalA / 1000, 0)}</bdi></Sourced> מיליארד ש״ח
      </p>
    </div>
  );
}
