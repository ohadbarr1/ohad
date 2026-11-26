import { useEffect, useMemo, useRef, useState } from 'react';
import type { FundX } from '../../lib/funds';
import { buildPool, rank, type FundEnt } from '../../lib/searchOmni';
import { selfDir } from '../../lib/verdict';
import { useMyAge } from '../../lib/mine';
import { AGE_DEFAULT } from '../../lib/retire';
import { TILES, type Tile } from '../../lib/pickTiles';
import { typeLabel } from '../../lib/pageWords';
import { shortGrp } from '../../pages/compare/tracks';
import { ProdIcon } from '../compare/PickerSheet';

/* "מה יש לך?": product → manager → track in three taps, or type a name or a fund number. Picks only; the parent saves.
   Rollout T-M3 (spec 5.3, 16.1 5a, 18.2 #4): step 1 is six product tiles with the isometric icons (#my-pick); after a tap the tiles give
   way to breadcrumb chips ("פנסיה ✓ · מגדל ✓", each one goes back to its step) and the next step's heading (#step-cur) comes to the top
   of the view (B9). Step 3 lists every track of the company by its FULL name ("מיטב השתלמות כללי", "מיטב השתלמות בניהול אישי"); the
   second line is "בניהול אישי ·" where it applies, the type and the fund number. `onStep` tells the page which step is on screen. */
export const MAIN_PRODS: [string, string][] = [
  ['פנסיה מקיפה', 'פנסיה מקיפה'], ['השתלמות', 'קרן השתלמות'], ['גמל', 'קופת גמל'], ['גמל להשקעה', 'גמל להשקעה'],
  ['פוליסות חיסכון וביטוחי מנהלים (מ-2004)', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)'],
];
const MORE_PRODS = ['פנסיה כללית', 'חיסכון לילד', 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים', 'ביטוחי מנהלים 1992-2003', 'ביטוחי מנהלים 1990-1991'];
const art = (id: string) => (TILES.find((t) => t.id === id) as Tile).art;
/** the six tiles of step 1 (mockup v4 frame 9): product, the tile's word, the isometric icon; the sixth opens the other products */
const STEP1: { prod: string | null; label: string; art: Tile['art'] }[] = [
  { prod: 'פנסיה מקיפה', label: 'פנסיה', art: art('pension') },
  { prod: 'השתלמות', label: 'השתלמות', art: art('hishtalmut') },
  { prod: 'גמל להשקעה', label: 'גמל להשקעה', art: art('hash') },
  { prod: 'גמל', label: 'קופת גמל', art: art('gemel') },
  { prod: 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)', label: 'פוליסות', art: art('policy') },
  { prod: null, label: 'עוד מוצרים', art: [[18, 'blue'], [26, 'blue'], [20, 'navy']] },
];
const prodWord = (p: string) => STEP1.find((t) => t.prod === p)?.label ?? p;
/** within a manager, the tracks a saver usually lands in first (the search's order), then by size */
const TRACK_FIRST: Record<string, number> = { 'כללי': 5, 'עד 50': 4, '50-60': 3, '60 ומעלה': 2 };
/** W5 (red team 3): the tracks for members already drawing a pension, hidden from a reader under 60 unless they ask for every track */
export const PAYOUT = (f: Pick<FundX, 'track'>) => f.track === 'מקבלי קצבה';
const PAYOUT_AGE = 60;

/** W6 doors (saver red team 02.11.26): employer-only and special-purpose funds are no saver's product. The regulator marks central
 *  severance funds and "other purpose" funds by class and product; sick-pay and holiday funds hide inside גמל and are known by name
 *  (e.g. "הראל דקל גמל לדמי מחלה", classed תגמולים · כללי); sectoral funds carry `closed`. Offered only when typed for explicitly. */
const SPECIAL_CLS = new Set(['מרכזית לפיצויים', 'מטרה אחרת']);
const SPECIAL_PROD = new Set(['מרכזית לפיצויים', 'גמל, מטרה אחרת']);
const SPECIAL_NAME = /דמי מחלה|למחלה|לדמי מחלה|חופשה|הבראה|מטרה אחרת|מרכזית לפיצויים|קופה מרכזית|מרכזית ל|פנסיה תקציבית|פיצויים בלבד/;
export const isSpecial = (f: Pick<FundX, 'cls' | 'prod' | 'name' | 'closed' | 'grp'>) => !!f.closed || SPECIAL_CLS.has(f.cls ?? '') || SPECIAL_PROD.has(f.prod) || SPECIAL_NAME.test(f.name) || f.grp === 'קרנות ענפיות ואחרות';
/** the query names such a fund on purpose: one of its words, or a fund number / key */
const ASKS_SPECIAL = /מחלה|חופשה|הבראה|פיצויים|מרכזית|מטרה אחרת|תקציבית|ענפי|מפעלי|^\s*\d{3,6}\s*$|^\s*[gpi]\d{1,6}\s*$/i;

export function Picker({ funds, have, onPick, onStep }: { funds: FundX[]; have: string[]; onPick: (k: string) => void; onStep?: (step: 1 | 2 | 3) => void }) {
  // T-M3: a self-managed account is a product a saver can hold: step 3 lists it after the company's other tracks (its row on /my shows
  // the guard line instead of the months). The type-ahead keeps them out, as before.
  const held = useMemo(() => funds.filter((f) => f.assets), [funds]);
  const live = useMemo(() => held.filter((f) => !selfDir(f)), [held]);
  const open = useMemo(() => live.filter((f) => !isSpecial(f)), [live]);
  const [prod, setProd] = useState<string | null>(null);
  const [grp, setGrp] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');
  const [ageS] = useMyAge();
  const [all, setAll] = useState(false);
  const hidePay = !all && (ageS ?? AGE_DEFAULT) < PAYOUT_AGE;
  const shownT = (f: FundX) => !hidePay || !PAYOUT(f);
  const step: 1 | 2 | 3 = !prod ? 1 : !grp ? 2 : 3;
  useEffect(() => { onStep?.(step); }, [step]);  // eslint-disable-line react-hooks/exhaustive-deps

  // B9: a step that replaces the one before it comes to the top (below the sticky header) and its heading takes focus
  const cur = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = cur.current;
    if (!h) return;
    // the breadcrumb chips sit right above the heading: bring them along, so the reader sees what was chosen and how to go back
    const top = h.closest('.my-picker')?.querySelector<HTMLElement>('.my-crumb') ?? h;
    const bar = document.querySelector<HTMLElement>('header.top');
    top.style.scrollMarginTop = `${Math.max(0, bar?.getBoundingClientRect().bottom ?? 0) + 8}px`;
    top.scrollIntoView({ block: 'start' });
    h.focus({ preventScroll: true });
  }, [step]);

  const groups = useMemo(() => {
    if (!prod) return [];
    const m = new Map<string, number>();
    open.filter((f) => f.prod === prod && f.grp !== 'קרנות ענפיות ואחרות').forEach((f) => m.set(f.grp, (m.get(f.grp) ?? 0) + (f.assets ?? 0)));
    return [...m].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [open, prod]);
  const tracksAll = useMemo(() => (prod && grp
    ? held.filter((f) => f.prod === prod && f.grp === grp && !isSpecial(f))
      .sort((a, b) => Number(selfDir(a)) - Number(selfDir(b)) || (TRACK_FIRST[b.track] ?? 0) - (TRACK_FIRST[a.track] ?? 0) || (b.assets ?? 0) - (a.assets ?? 0))
    : []), [held, prod, grp]);
  const tracks = tracksAll.filter(shownT), hiddenN = tracksAll.length - tracks.length;

  // type-ahead: the site's own search ranking (lib/searchOmni), funds only; a special-purpose fund only when asked for by name or number
  const pool = useMemo(() => buildPool([], [], live.map((f): FundEnt => [f.name, f.grp, f.k, f.track, f.prod]), []), [live]);
  const hits = useMemo(() => {
    const t = q.trim();
    if (t.length < 2) return [];
    const explicit = ASKS_SPECIAL.test(t);
    return rank(t, pool, (s) => s).filter((x) => x.kind === 'קופה' && x.to.startsWith('/funds/'))
      .map((x) => live.find((f) => `/funds/${f.k}` === x.to)).filter((f): f is FundX => !!f && shownT(f) && (explicit || !isSpecial(f))).slice(0, 6);
  }, [q, pool, live, hidePay]);  // eslint-disable-line react-hooks/exhaustive-deps

  const Row = ({ f, sub }: { f: FundX; sub: string }) => {
    const on = have.includes(f.k);
    return (
      <li><button type="button" className="sv-pick-row" disabled={on} onClick={() => onPick(f.k)}>
        <span className="sv-pick-n">{f.name}</span>
        <span className="sv-pick-m">{sub}</span>
        <span className="sv-pick-a" aria-hidden="true">{on ? '✓' : '+'}</span>
      </button></li>
    );
  };
  const pickProd = (p: string) => { setProd(p); setGrp(null); };
  const crumbs = prod ? (
    <div className="my-crumb" role="group" aria-label="מה נבחר עד עכשיו">
      <button type="button" className="sv-chip" onClick={() => { setProd(null); setGrp(null); }} aria-label={`${prodWord(prod)}: לבחור מוצר אחר`}>{prodWord(prod)} ✓</button>
      {grp && <button type="button" className="sv-chip" onClick={() => setGrp(null)} aria-label={`${shortGrp(grp)}: לבחור חברה אחרת`}>{shortGrp(grp)} ✓</button>}
    </div>
  ) : null;

  return (
    <div className="sv-picker my-picker">
      {crumbs}
      {step === 1 && <div className="sv-step">
        <div className="sv-step-h" id="step-cur" ref={cur} tabIndex={-1}><span className="sv-num" aria-hidden="true">1</span>איזה מוצר?</div>
        <div className="my-tiles" id="my-pick" role="group" aria-label="מוצר">
          {STEP1.map((t) => (
            <button key={t.label} type="button" className="my-tile" aria-expanded={t.prod ? undefined : more}
              onClick={() => (t.prod ? pickProd(t.prod) : setMore((m) => !m))}>
              <ProdIcon art={t.art} size={44} /><span>{t.label}</span>
            </button>
          ))}
        </div>
        {more && <div className="sv-chips" role="group" aria-label="עוד מוצרים">
          {MORE_PRODS.filter((p) => open.some((f) => f.prod === p)).map((p) => <button key={p} type="button" className="sv-chip" onClick={() => pickProd(p)}>{p}</button>)}
        </div>}
      </div>}
      {step === 2 && <div className="sv-step">
        <div className="sv-step-h" id="step-cur" ref={cur} tabIndex={-1}><span className="sv-num" aria-hidden="true">2</span>איזו חברה מנהלת?</div>
        <div className="sv-chips my-grps" id="my-grp" role="group" aria-label="חברה מנהלת">
          {groups.map((g) => <button key={g} type="button" className="sv-chip" onClick={() => setGrp(g)}>{g}</button>)}
        </div>
      </div>}
      {step === 3 && <div className="sv-step">
        <div className="sv-step-h" id="step-cur" ref={cur} tabIndex={-1}><span className="sv-num" aria-hidden="true">3</span>איזה מסלול? <span className="sv-step-note">שם המסלול ומספר הקופה כתובים בדוח השנתי</span></div>
        <ul className="sv-pick-list" id="my-trk">{tracks.map((f) => <Row key={f.k} f={f} sub={`${selfDir(f) ? 'בניהול אישי · ' : ''}${typeLabel(f.track)} · קופה ${f.id}`} />)}</ul>
        {hiddenN > 0 && <p className="sv-muted">{hiddenN === 1 ? 'מסלול אחד למקבלי קצבה מוסתר' : `${hiddenN} מסלולים למקבלי קצבה מוסתרים`} (למי שכבר מקבל פנסיה). <button type="button" className="linkbtn" onClick={() => setAll(true)}>הצגת כל המסלולים</button></p>}
      </div>}
      {step === 1 && <div className="sv-step sv-search my-q">
        <input id="sv-q" type="search" inputMode="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="או חיפוש לפי שם או מספר קופה" aria-label="חיפוש לפי שם או מספר קופה" />
        {hits.length > 0 && <ul className="sv-pick-list">{hits.map((f) => <Row key={f.k} f={f} sub={`${f.prod} · ${f.track} · מספר קופה ${f.id}${isSpecial(f) ? (f.closed ? ' · קופה ענפית או מפעלית' : ' · קופה למטרה מיוחדת') : ''}`} />)}</ul>}
        {q.trim().length >= 2 && !hits.length && <p className="sv-muted">לא נמצא מסלול פתוח בשם הזה. אפשר לנסות את מספר הקופה מהדוח.</p>}
      </div>}
    </div>
  );
}
