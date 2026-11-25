import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DeeperSheet } from '../DeeperSheet';
import { backThen } from '../Sheet';
import type { SheetProps, CmpCtx } from '../../pages/compare/contract';
import { useLoad } from '../../lib/useData';
import { TRAY_MAX, useTray, type FundsFile } from '../../lib/funds';
import { useMine } from '../../lib/mine';
import { useStored } from '../../lib/local';
import { isOldGen, pickIndex, pickSearch, type PickFund } from '../../lib/pickSearch';
import { nf } from '../../lib/format';
import { count } from '../../lib/count';
import {
  RECENT_KEY, TILES, a5Of, capOf, capToast, companiesOf, house, labelsOf, prodShort, pushRecent, siblingWords, siblingsOf, tileOf, trackColor,
  trackLabels, tracksOf, twinNote, type IsoMat, type PFund, type Tile,
} from '../../lib/pickTiles';
import '../../styles/compare.css';
import './picker.css';

/* <PickerSheet> (C6, spec §4.2, §4.0 rows 4–8 and 21, §4.0b row 6, §10A.2 C6, mockup v3 frame 2): "איזה מסלול יש לך?".
   The search is fixed under the title (DeeperSheet `sticky`), outside the scrolling body, so it is there after every tap.
   Free text (lib/pickSearch: any order, stop-words, a product in words, a fund number; "X מול Y" → one pair card) or three steps with no
   typing: 1 product tiles (six, all live) → 2 track chips + "לא בטוח?" → 3 two-column company tiles, alphabetical. After the first pick
   the heading becomes "אותו מסלול בחברות אחרות" and "להשוות למסלול אחר של <חברה>" opens the house's other tracks as a checklist.
   Typed text ranks the category already chosen first. Pinned footer: the tray (a tap removes) and one button; "להשוואה · N מסלולים"
   commits through setKeys. The door caps the selection (4 / 6 / 8, TRAY_MAX the hard limit) with a toast. Recents: localStorage cmp:recent. */

/** how the picker opens: at a product's step 2 (an entry-screen tile), or with the keyboard up (the entry screen's search field).
 *  The contract's openSheet({t:'picker'}) carries no argument, so the caller leaves it here first (openPicker). */
export interface PickerIntent { tile?: string; focus?: boolean }
let intent: PickerIntent | null = null;
export function openPicker(ctx: Pick<CmpCtx, 'openSheet'>, i: PickerIntent = {}) { intent = i; ctx.openSheet({ t: 'picker' }); }

/** "השוואות אחרונות" (this browser only): the list, and a function that puts a set on top */
export function useRecents(): [string[][], (keys: string[]) => void] {
  const [raw, set] = useStored<string[][]>(RECENT_KEY, []);
  const list = Array.isArray(raw) ? raw.filter((x) => Array.isArray(x) && x.every((k) => typeof k === 'string')) : [];
  return [list, (keys) => set(pushRecent(list, keys))];
}

/** funds.json, once (lib/useData caches the request) */
export function useFundRows(): PFund[] | null {
  const { data } = useLoad<FundsFile>('funds.json');
  return useMemo(() => (data ? (data.funds as unknown as PFund[]) : null), [data]);
}

/* ---------- the isometric product icon (the site's Icon3D blocks and palette) ---------- */
const M3: Record<IsoMat, [string, string, string]> = { navy: ['#40507F', '#1E2B58', '#111C3F'], orange: ['#FF9A80', '#FF4E31', '#D6391E'], blue: ['#DCE5F2', '#8FA8CC', '#6F8DB9'] };
const ipt = (x: number, y: number, z: number) => `${(50 + (x - y) * 0.866).toFixed(1)},${(62 + (x + y) * 0.5 - z).toFixed(1)}`;
export function ProdIcon({ art, size = 46 }: { art: Tile['art']; size?: number }) {
  return (
    <svg className="pk-ico" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <ellipse className="sh" cx={50} cy={80} rx={30} ry={6} />
      {art.map(([h, m], i) => {
        const x = -24 + i * 17, y = -8, w = 13, d = 16, [t, l, r] = M3[m];
        return (
          <g key={i}>
            <polygon fill={l} points={[ipt(x, y + d, 0), ipt(x + w, y + d, 0), ipt(x + w, y + d, h), ipt(x, y + d, h)].join(' ')} />
            <polygon fill={r} points={[ipt(x + w, y, 0), ipt(x + w, y + d, 0), ipt(x + w, y + d, h), ipt(x + w, y, h)].join(' ')} />
            <polygon fill={t} points={[ipt(x, y, h), ipt(x + w, y, h), ipt(x + w, y + d, h), ipt(x, y + d, h)].join(' ')} />
          </g>
        );
      })}
    </svg>
  );
}

export const SearchSvg = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>;
const Check = () => <span className="pk-cb" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>;
/** "5 שנים ‎+8.6%": the 5-year average on the page's basis, signed, one decimal */
export function Five({ v, br }: { v: number | null; br?: boolean }) {
  return <>5 שנים{br ? <br /> : ' '}{v == null ? <span className="num">–</span> : <span className={`num ${v > 0 ? 'pk-up' : v < 0 ? 'pk-down' : ''}`}>{v > 0 ? '+' : ''}{nf(v, 1)}%</span>}</>;
}
export const SEARCH_PH = 'למשל: מגדל פנסיה כללי';
const TRACKS_SHOWN = 6;
const UNSURE = 'לא בטוח? זה כתוב בדוח השנתי. לרוב זה ״כללי״, או מסלול לפי הגיל שלך.';

interface St { tile: string | null; prod: string | null; track: string | null; sel: string[]; q: string; sib: string | null; focus: boolean; all: boolean }
const EMPTY: St = { tile: null, prod: null, track: null, sel: [], q: '', sib: null, focus: false, all: false };

export function PickerSheet({ open, onClose, keys, basis, door, setKeys }: SheetProps) {
  const funds = useFundRows();
  const by = useMemo(() => new Map((funds ?? []).map((f) => [f.k, f])), [funds]);
  const idx = useMemo<PickFund[]>(() => (funds ? pickIndex(funds as never) : []), [funds]);
  const [mine] = useMine();
  const mineKs = useMemo(() => new Set(mine.map((m) => m.k)), [mine]);
  const tray = useTray();
  const [, remember] = useRecents();
  const cap = capOf(door, TRAY_MAX);
  const [st, setSt] = useState<St>(EMPTY);
  const [toast, setToast] = useState<{ m: string; n: number } | null>(null);
  const scrollTo = useRef<{ sel: string; smooth: boolean } | null>(null);
  const bodyId = 'pk-body';

  // every opening starts fresh: the tracks on screen are the selection, their category is step 3; an entry-screen tile opens at step 2
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      const i = intent; intent = null;
      typed.current = new Set();
      const sel = keys.filter((k) => !funds || by.has(k)).slice(0, cap);
      const f0 = sel.length ? by.get(sel[0]) : undefined;
      const t = i?.tile ? TILES.find((x) => x.id === i.tile) ?? null : f0 ? tileOf(f0.prod) : null;
      const fromTile = !!i?.tile && !!t;
      setSt({ ...EMPTY, sel, focus: !!i?.focus, tile: t?.id ?? null, prod: fromTile ? t!.prods[0] : f0?.prod ?? null, track: fromTile ? null : f0?.track ?? null });
      if (fromTile) scrollTo.current = { sel: '#pk-step2', smooth: false };
      else if (f0) scrollTo.current = { sel: '#pk-step3', smooth: false };
    }
    if (!open) setToast(null);
    wasOpen.current = open;
  }, [open, keys, by, funds, cap]);
  // funds arriving after the sheet opened on tracks: open their category
  useEffect(() => {
    if (!open || !funds || st.prod || st.sel.length === 0) return;
    const f0 = by.get(st.sel[0]); if (!f0) return;
    setSt((s) => ({ ...s, tile: tileOf(f0.prod)?.id ?? null, prod: f0.prod, track: f0.track }));
    scrollTo.current = { sel: '#pk-step3', smooth: false };
  }, [open, funds, by, st.prod, st.sel]);
  // scroll the body to the step just opened. Step 3 lands on its own top edge: the hint above it is either whole or gone (round 3)
  useEffect(() => {
    const t = scrollTo.current; if (!t || !open) return;
    const body = document.getElementById(bodyId), el = body?.querySelector<HTMLElement>(t.sel);
    if (!body || !el) return;
    scrollTo.current = null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ top: Math.max(0, el.offsetTop - (t.sel === '#pk-step3' ? 4 : 8)), behavior: t.smooth && !reduce ? 'smooth' : 'auto' });
  });
  // step 3 is at least one body-height tall: scrolling to it always reaches its top edge, so the hint above it is gone, not half-cut
  useLayoutEffect(() => {
    const body = document.getElementById(bodyId), s3 = body?.querySelector<HTMLElement>('#pk-step3');
    if (body && s3) s3.style.minHeight = `${body.clientHeight - 16}px`;
  });
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2800); return () => clearTimeout(id); }, [toast]);
  const say = (m: string) => setToast({ m, n: Date.now() });

  const set = (p: Partial<St>, scroll?: string) => { setSt((s) => ({ ...s, ...p })); if (scroll) scrollTo.current = { sel: scroll, smooth: true }; };
  const searchingRef = useRef(false);
  const typed = useRef(new Set<string>());   // keys picked from typed words (M1 route "text"); the rest came by the three steps
  const toggle = (k: string) => {
    const f = by.get(k); if (!f) return;
    if (st.sel.includes(k)) { set({ sel: st.sel.filter((x) => x !== k) }); return; }
    if (st.sel.length >= cap) { say(capToast(cap)); return; }
    const sel = [...st.sel, k];
    if (searchingRef.current) typed.current.add(k); else typed.current.delete(k);
    // a row chosen from typed words: the words go, and step 3 of its category opens ("אותו מסלול בחברות אחרות", one tap per company)
    if (searchingRef.current) set({ sel, q: '', sib: null, prod: f.prod, track: f.track, tile: tileOf(f.prod, st.tile ?? undefined)?.id ?? null }, '#pk-step3');
    else set({ sel });
  };
  const commit = (ks: string[], text = false) => {
    const v = ks.slice(0, cap);
    count('cmp_picker_done', { n: v.length, route: text || v.some((k) => typed.current.has(k)) ? 'text' : 'guided' });
    remember(v);
    // close first (back over the sheet's entry), then write the tracks on the page's own entry: one entry, and Back from the comparison
    // returns to the page the reader came from, never to a reopened picker
    backThen(() => { setKeys(v); tray.set(v); });
  };
  const go = () => { if (st.sel.length < 2) { say('צריך לפחות שני מסלולים כדי להשוות.'); return; } commit(st.sel); };

  const labIn = useMemo(() => {
    // a track's label among its category (tiles, rows): "הראל · גילעד"
    const cache = new Map<string, Map<string, string>>();
    return (f: PFund) => {
      const ck = `${f.prod} | ${f.track}`;
      if (!cache.has(ck)) cache.set(ck, labelsOf((funds ?? []).filter((x) => x.prod === f.prod && x.track === f.track)));
      return cache.get(ck)!.get(f.k) ?? house(f.grp);
    };
  }, [funds]);
  const selFunds = st.sel.map((k) => by.get(k));
  const trayLabels = trackLabels(selFunds);

  const tile = TILES.find((t) => t.id === st.tile) ?? null;
  const q = st.q.trim();
  const res = useMemo(() => (q && idx.length ? pickSearch(q, idx, { n: 12, cat: st.prod ? { prod: st.prod, track: st.track ?? undefined } : undefined }) : null), [q, idx, st.prod, st.track]);
  const searching = !!res && (res.hits.length > 0 || res.pair != null || q.length >= 2);
  searchingRef.current = searching;

  const row = (f: PFund, title?: ReactNode, sub?: ReactNode) => {
    const on = st.sel.includes(f.k);
    return (
      <button key={f.k} type="button" className={`pk-row${on ? ' on' : ''}`} onClick={() => toggle(f.k)} aria-pressed={on}>
        <Check />
        <span>
          <b>{title ?? labIn(f)}{mineKs.has(f.k) ? <> <span className="pk-mine">שלי</span></> : null}{f.closed ? <> <span className="pk-tag">נסגר</span></> : null}{isOldGen(f.prod) ? <> <span className="pk-tag">פוליסה ישנה</span></> : null}</b>
          <small>{sub ?? f.name}</small>
        </span>
        <span className="a"><Five v={a5Of(f, basis)} br /></span>
      </button>
    );
  };

  let body: ReactNode;
  if (!funds) body = <p className="pk-note">טוען את רשימת המסלולים…</p>;
  else if (searching && res) {
    // results grouped by product, in the order the search ranked them (the category already chosen first). A row reads company and
    // track ("מגדל · כללי"), with the word that tells two funds of one company apart; the formal name below it, and the fund number
    // there only when that word is missing (review B1 P11: no "מגדל · מס׳ 12145" titles, no heading per category)
    const groups: { prod: string; fs: PFund[] }[] = [];
    for (const h of res.hits) { const f = by.get(h.k); if (!f) continue; const g = groups.find((x) => x.prod === f.prod); if (g) g.fs.push(f); else groups.push({ prod: f.prod, fs: [f] }); }
    const hitTitle = (f: PFund) => { const l = labIn(f), alt = l.includes(' · ') ? l.split(' · ').slice(1).join(' · ') : '';
      return alt && !alt.startsWith('מס׳') ? `${house(f.grp)} · ${f.track} · ${alt}` : `${house(f.grp)} · ${f.track}`; };
    const hitSub = (f: PFund) => { const l = labIn(f); return /· מס׳/.test(l) ? `${f.name} · מס׳ ${f.id ?? f.k.replace(/^\D+/, '')}` : f.name; };
    const pa = res.pair ? by.get(res.pair.a.k) : undefined, pb = res.pair ? by.get(res.pair.b.k) : undefined;
    body = (
      <div id="pkres">
        {pa && pb ? (
          <div className="pk-understood" id="pk-pair">
            <b>הבנתי: {q.split(/\s+(?:מול|נגד|לעומת|vs\.?|versus)\s+/i).join(' מול ')}</b>
            <button type="button" className="pk-sg" onClick={() => commit([pa.k, pb.k], true)}>
              <span><b>{trackLabels([pa, pb]).join(' מול ')}</b><small>{prodShort(pa.prod)} · {pa.track === pb.track ? pa.track : `${pa.track} / ${pb.track}`}</small></span>
              <span className="go">השוואה ›</span>
            </button>
            {pa.track !== pb.track ? <p className="pk-note">רמות סיכון שונות: ההשוואה תציג התנהגות, לא דירוג.</p> : null}
          </div>
        ) : null}
        {groups.map((g) => (
          <div key={g.prod}>
            <div className="pk-h"><span>{prodShort(g.prod)}</span></div>
            {g.fs.map((f) => row(f, hitTitle(f), hitSub(f)))}
          </div>
        ))}
        {!groups.length && !(pa && pb) ? (
          <div className="pk-empty">
            <p className="pk-note">לא מצאתי. אפשר לנסות שם חברה לבד (״מגדל״), או מספר קופה.</p>
            <button type="button" className="pk-chip" onClick={() => set({ q: '' })}>לבחירה לפי סוג החיסכון</button>
          </div>
        ) : null}
      </div>
    );
  } else if (st.sib && by.get(st.sib)) {
    const f = by.get(st.sib)!, sibs = siblingsOf(funds, f);
    body = (
      <div id="pkres">
        <button type="button" className="pk-chip pk-back" onClick={() => set({ sib: null }, '#pk-step3')}>‹ חזרה</button>
        <div className="pk-h" id="pk-sibs"><span>כל המסלולים של {house(f.grp)} · {prodShort(f.prod)}</span></div>
        <div>{sibs.map((x) => { const l = labIn(x); return row(x, <>{x.track}{l.includes(' · ') ? ` · ${l.split(' · ')[1]}` : ''}</>); })}</div>
        <p className="pk-note">מסלול עם יותר מניות עולה ויורד חזק יותר; ההשוואה תציג את המספרים זה לצד זה.</p>
      </div>
    );
  } else {
    const prods = tile ? tile.prods.filter((p) => tracksOf(funds, p).length) : [];
    // the six most common tracks first (the default, the age tracks, equity…); the rest one tap away, so the hint stays in view
    const allTracks = st.prod ? tracksOf(funds, st.prod) : [];
    const tracks = st.all || allTracks.length <= TRACKS_SHOWN + 1 ? allTracks : allTracks.filter((c, i) => i < TRACKS_SHOWN || c.track === st.track);
    const hidden = allTracks.length - tracks.length;
    const cos = st.prod && st.track ? companiesOf(funds, st.prod, st.track, basis) : [];
    const first = selFunds[0];
    const sibs = first ? siblingWords(funds, first) : '';
    const otherCat = !!first && !!st.prod && !!st.track && (first.prod !== st.prod || first.track !== st.track);
    const twin = twinNote(cos);
    body = (
      <div id="pkres">
        <div className="pk-h"><span>1 · איזה מוצר?</span></div>
        <div className="pk-prods">
          {TILES.map((t) => (
            <button key={t.id} type="button" className={`pk-prod${st.tile === t.id ? ' on' : ''}`} aria-pressed={st.tile === t.id}
              onClick={() => set({ tile: t.id, prod: t.prods[0], track: null, all: false }, '#pk-step2')}>
              <ProdIcon art={t.art} /><span>{t.label}</span>
            </button>
          ))}
        </div>
        {tile && st.prod ? (
          <>
            <div className="pk-h" id="pk-step2"><span>2 · איזה מסלול השקעה?</span>{prods.length > 1 ? <span className="end">{prodShort(st.prod)}</span> : null}</div>
            {prods.length > 1 ? (
              <div className="pk-chips pk-prodsw" role="group" aria-label="המוצר">
                {prods.map((p) => <button key={p} type="button" className={`pk-chip alt${st.prod === p ? ' on' : ''}`} aria-pressed={st.prod === p} onClick={() => set({ prod: p, track: null, all: false })}>{prodShort(p)}</button>)}
              </div>
            ) : null}
            <div className="pk-chips" role="group" aria-label="מסלול השקעה">
              {tracks.map((c) => (
                <button key={c.track} type="button" className={`pk-chip${st.track === c.track ? ' on' : ''}`} aria-pressed={st.track === c.track}
                  onClick={() => set({ track: c.track }, '#pk-step3')}>{c.track}<small className="num">{c.n}</small></button>
              ))}
              {hidden > 0 ? <button type="button" className="pk-chip alt" id="pk-more" aria-expanded={false} onClick={() => set({ all: true })}>עוד {hidden} מסלולים ▾</button> : null}
            </div>
            <p className="pk-note" id="pk-unsure">{UNSURE}{tile.note ? ` ${tile.note}` : ''}</p>
          </>
        ) : null}
        {st.prod && st.track ? (
          <div id="pk-step3">
            {first && sibs ? (
              <button type="button" className="pk-sib" id="pk-sib" onClick={() => set({ sib: first.k }, '#pk-sibs')}>
                <span><b>להשוות למסלול אחר של {house(first.grp)}</b><small>{sibs}</small></span><span className="go" aria-hidden="true">›</span>
              </button>
            ) : null}
            <div className="pk-h"><span>{st.sel.length ? 'אותו מסלול בחברות אחרות' : '3 · אילו חברות?'} <small>(עד {cap})</small></span><span className="end">לפי א-ב</span></div>
            <div className="pk-grid" id="pk-companies">
              {cos.map((c) => {
                const on = st.sel.includes(c.k);
                return (
                  <button key={c.k} type="button" className={`pk-co${on ? ' on' : ''}`} onClick={() => toggle(c.k)} aria-pressed={on}>
                    <Check /><span><b>{c.label}</b><small><Five v={c.a5} /></small></span>{mineKs.has(c.k) ? <span className="pk-mine">שלי</span> : null}
                  </button>
                );
              })}
            </div>
            {twin ? <p className="pk-note">{twin}</p> : null}
            {otherCat && first ? <div className="guard" style={{ marginTop: 10 }}><span>כבר נבחר מסלול מסוג אחר ({prodShort(first.prod)} · {first.track}). אפשר לשלב: המספרים יוצגו זה לצד זה, בלי דירוג.</span></div> : null}
          </div>
        ) : null}
      </div>
    );
  }

  const n = st.sel.length;
  // the entry screen's search field opens the sheet with the cursor in the search (#pkq, the first control of the sticky strip). Read
  // on the very first render too (the intent is consumed in the layout effect), so DeeperSheet focuses once, on open
  const focusFirst = st.focus || (open && !wasOpen.current && !!intent?.focus);
  return (
    <DeeperSheet open={open} onClose={onClose} id="picker" bodyId={bodyId} detent="full" initialFocus={focusFirst ? 'first' : 'dialog'}
      title="איזה מסלול יש לך?" sub="כותבים שם חברה, או בוחרים בשלושה צעדים"
      sticky={
        <label className="pk-search">
          <SearchSvg />
          <input id="pkq" type="search" inputMode="search" enterKeyHint="search" autoComplete="off" spellCheck={false} placeholder={SEARCH_PH} aria-label="חיפוש מסלול: קופה, חברה או מספר"
            value={st.q} onChange={(e) => { const v = e.target.value; setSt((s) => ({ ...s, q: v })); }} />
          {st.q ? <button type="button" className="pk-clear" onClick={() => setSt((s) => ({ ...s, q: '' }))} aria-label="ניקוי החיפוש"><i>×</i></button> : null}
        </label>
      }
      footer={
        <div className="pk-foot">
          {toast ? <div className="pk-toast" role="status" key={toast.n}>{toast.m}</div> : null}
          {n ? (
            <div className="pk-tray" role="group" aria-label="המסלולים שנבחרו">
              {st.sel.map((k, i) => (
                <button key={k} type="button" className="tchip" style={{ '--c': trackColor(i) } as CSSProperties} onClick={() => toggle(k)} aria-label={`הסרה: ${trayLabels[i] || k}`}>
                  <i className="dot" aria-hidden="true" />{trayLabels[i] || k} <span className="x" aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" id="pk-go" className={`pk-go${n > 1 ? ' ember' : ''}`} disabled={!n} onClick={go}>
            {n === 0 ? 'עדיין לא נבחרו מסלולים' : n === 1 ? 'עוד מסלול אחד לפחות' : `להשוואה · ${n} מסלולים`}
          </button>
        </div>
      }>
      {body}
    </DeeperSheet>
  );
}
