/* F5 · the picker's search logic (compare page "איזה מסלול יש לך?", header search for a pair). Pure, node-testable.
   One matcher for words (fundQuery / fundMatch of lib/searchOmni, untouched); this file adds what a saver types around it:
   - stop-words ("קופת", "קרן", "מסלול"…) are dropped, order of the words does not matter;
   - a product named in words ("גמל להשקעה", "השתלמות", "פנסיה") becomes a filter on the product, not a word to match;
   - ranking: old-generation policies (1990–2003) and closed tracks last; then the better word match; then the product a saver most
     likely means (comprehensive pension, gemel, השתלמות…); then the default track (כללי, the age tracks); then size;
   - "A מול B" is split into two sides; a side without a product inherits it from the other, and the first product (in saver order)
     where both sides have a track gives ONE pair suggestion. */
import { normalize, terms } from './hebrew';
import { canon, fundIdx, fundMatch, fundQuery, isIdHit, type FundIdx, type FundQ } from './searchOmni';
import type { VFund } from './verdict';

/** a track as the picker sees it: the shared fund index entry plus what ranking needs */
export interface PickFund extends FundIdx { k: string; prod: string; track: string; name: string; assets: number; closed: boolean }
export interface PickPair { a: PickFund; b: PickFund; prod: string }
export interface PickResult {
  /** matching tracks, best first (for a pair query: side A's, then side B's, deduplicated) */
  hits: PickFund[];
  /** "A מול B" resolved to one pair of the same product, else null */
  pair: PickPair | null;
  /** the product(s) the words named, else null: the picker can show "בתוך: גמל להשקעה" */
  prods: string[] | null;
}

/** funds.json rows → the picker's index (one pass; keep the result, do not rebuild per keystroke) */
export const pickIndex = (funds: Pick<VFund, 'k' | 'name' | 'grp' | 'track' | 'prod' | 'assets' | 'closed'>[]): PickFund[] =>
  funds.map((f) => ({ ...fundIdx(f.name, f.grp, f.k, f.track, f.prod), k: f.k, prod: f.prod, track: f.track, name: f.name, assets: f.assets ?? 0, closed: !!f.closed }));

const P = {
  pensia: 'פנסיה מקיפה', klali: 'פנסיה כללית', gemel: 'גמל', hash: 'גמל להשקעה', gOther: 'גמל, מטרה אחרת', hishtalmut: 'השתלמות',
  kid: 'חיסכון לילד', pol: 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)', mn04: 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים',
  mn92: 'ביטוחי מנהלים 1992-2003', mn90: 'ביטוחי מנהלים 1990-1991', pitz: 'מרכזית לפיצויים',
};
/** the order a saver most likely means a product when none is named: pension first, old-generation policies last */
export const PRODUCT_ORDER: string[] = [P.pensia, P.gemel, P.hishtalmut, P.hash, P.klali, P.kid, P.pol, P.mn04, P.pitz, P.gOther, P.mn92, P.mn90];
/** the 1990–2003 policies: a saver rarely means them, and they never lead a result list */
export const isOldGen = (prod: string) => prod === P.mn92 || prod === P.mn90;
const prodRank = (prod: string) => { const i = PRODUCT_ORDER.indexOf(prod); return i < 0 ? PRODUCT_ORDER.length : i; };
/** the default track within a product comes first: the general track, then the age tracks, then the annuitants' (as lib/searchOmni) */
const TRACK_RANK: Record<string, number> = { 'כללי': 1.5, 'עד 50': 1.3, '50-60': 1.2, '60 ומעלה': 1.1, 'מקבלי קצבה': 0.6 };

const nz = (s: string) => normalize(s);
const STOP = new Set(['קופת', 'קופה', 'קופות', 'קרן', 'קרנות', 'מסלול', 'מסלולי', 'מסלולים', 'של', 'את', 'עם', 'חברת', 'חברה', 'בחברת', 'אצל', 'תכנית', 'תוכנית', 'מוצר', 'כמו', 'אני', 'רוצה', 'להשוות'].map(nz));
const SPLIT = /\s+(?:מול|נגד|לעומת|vs\.?|versus)\s+/i;
/** words that mean the same word once normalised: "בהשקעה", "להשקעות" → "השקעה" */
const SYN: Record<string, string> = { [nz('להשקעה')]: 'השקעה', [nz('בהשקעה')]: 'השקעה', [nz('השקעות')]: 'השקעה', [nz('להשקעות')]: 'השקעה', [nz('לילד')]: 'ילד', [nz('פוליסת')]: 'פוליסות', [nz('פוליסה')]: 'פוליסות', [nz('מנהלים')]: 'מנהלים' };
/** the product phrases, longest first; each names the products it stands for (a list: "פנסיה" is both pension products, the comprehensive first) */
const PHRASES: [string[], string[]][] = [
  [['גמל', 'השקעה'], [P.hash]],
  [['פנסיה', 'מקיפה'], [P.pensia]],
  [['פנסיה', 'כללית'], [P.klali]],
  [['חיסכון', 'ילד'], [P.kid]], [['חסכון', 'ילד'], [P.kid]],
  [['פוליסות', 'חיסכון'], [P.pol]], [['פוליסות', 'חסכון'], [P.pol]],
  [['ביטוח', 'מנהלים'], [P.pol, P.mn04, P.mn92, P.mn90]], [['ביטוחי', 'מנהלים'], [P.pol, P.mn04, P.mn92, P.mn90]],
  [['השתלמות'], [P.hishtalmut]],
  [['מקיפה'], [P.pensia]],
  [['פנסיה'], [P.pensia, P.klali]],
  [['גמל'], [P.gemel, P.hash, P.gOther]],
].map(([w, p]) => [(w as string[]).map(nz), p as string[]]);

interface Side { raw: string; fq: FundQ; prods: string[] | null; empty: boolean }
/** one side of a query: stop-words out, the product phrase lifted into a filter, the rest as the fund matcher's words */
function readSide(raw: string): Side {
  const t = raw.trim();
  const fq0 = fundQuery(t);
  if (fq0.num || fq0.key) return { raw: t, fq: fq0, prods: null, empty: false };
  let w = terms(canon(t)).map((x) => SYN[x] ?? x).filter((x) => !STOP.has(x));
  let prods: string[] | null = null;
  for (const [ph, ps] of PHRASES) {
    for (let i = 0; i + ph.length <= w.length; i++) {
      if (ph.every((x, j) => w[i + j] === x)) { prods = [...new Set([...(prods ?? []), ...ps])]; w = [...w.slice(0, i), ...w.slice(i + ph.length)]; i--; }
    }
  }
  return { raw: t, fq: { words: w, num: null, key: null }, prods, empty: !w.length && !prods };
}

/** the tracks of one side, best first. `prods` overrides the side's own product filter (a pair's inherited product). */
function sideHits(s: Side, idx: PickFund[], prods: string[] | null, cat?: Cat, n = 8): PickFund[] {
  if (s.empty) return [];
  const pf = prods ?? s.prods;
  const scored: { f: PickFund; sc: number; ok: boolean }[] = [];
  for (const f of idx) {
    const sc = s.fq.words.length || s.fq.num || s.fq.key ? fundMatch(s.fq, f) : 1;
    if (sc > 0) scored.push({ f, sc, ok: !pf || pf.includes(f.prod) });
  }
  // a product named in the words is a filter; when it leaves nothing, the words alone speak (a soft filter)
  const filtered = pf && scored.some((x) => x.ok) ? scored.filter((x) => x.ok) : scored;
  return filtered.sort((a, b) => cmp(a, b, cat)).slice(0, n).map((x) => x.f);
}
function cmp(a: { f: PickFund; sc: number }, b: { f: PickFund; sc: number }, cat?: Cat): number {
  const d = (f: PickFund) => (isOldGen(f.prod) || f.closed ? 1 : 0);
  const idA = isIdHit(a.sc), idB = isIdHit(b.sc);
  if (idA !== idB) return idA ? -1 : 1;
  if (!idA && d(a.f) !== d(b.f)) return d(a.f) - d(b.f);
  const inC = (f: PickFund) => (cat && (!cat.prod || f.prod === cat.prod) && (!cat.track || f.track === cat.track) ? 0 : 1);
  return inC(a.f) - inC(b.f) || b.sc - a.sc || prodRank(a.f.prod) - prodRank(b.f.prod)
    || (TRACK_RANK[b.f.track] ?? 0) - (TRACK_RANK[a.f.track] ?? 0) || b.f.assets - a.f.assets || a.f.k.localeCompare(b.f.k);
}

/** the category the picker is already inside (steps 1–2): typed words filter inside it first */
export interface Cat { prod?: string; track?: string }

/** The picker's search. `q` shorter than two characters (and not a fund number/key) finds nothing. */
export function pickSearch(q: string, idx: PickFund[], opts: { n?: number; cat?: Cat } = {}): PickResult {
  const n = opts.n ?? 8, cat = opts.cat;
  const none: PickResult = { hits: [], pair: null, prods: null };
  const text = q.trim();
  if (!text) return none;
  const parts = text.split(SPLIT).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const A = readSide(parts[0]), B = readSide(parts[1]);
    if (A.empty || B.empty) return { ...none, hits: sideHits(A.empty ? B : A, idx, null, cat, n) };
    const own = A.prods ?? B.prods;                       // a product named on one side stands for both
    const cands = (own ?? PRODUCT_ORDER).filter((p) => !isOldGen(p) || own);
    for (const p of cands) {
      const a = sideHits(A, idx, [p], cat, 1)[0], b = sideHits(B, idx, [p], cat, 1)[0];
      if (a && b && a.prod === p && b.prod === p && a.k !== b.k) {
        const rest = [...sideHits(A, idx, [p], cat, n), ...sideHits(B, idx, [p], cat, n)];
        return { hits: dedupe([a, b, ...rest]).slice(0, n), pair: { a, b, prod: p }, prods: [p] };
      }
    }
    // no product holds both sides: the sides' own best tracks, no pair
    return { hits: dedupe([...sideHits(A, idx, null, cat, n), ...sideHits(B, idx, null, cat, n)]).slice(0, n), pair: null, prods: own };
  }
  const s = readSide(text);
  if (!s.fq.num && !s.fq.key && text.length < 2) return none;
  return { hits: sideHits(s, idx, null, cat, n), pair: null, prods: s.prods };
}
const dedupe = (l: PickFund[]) => l.filter((f, i) => l.findIndex((g) => g.k === f.k) === i);

/** the label of a pair suggestion, as the header search and the picker print it: "להשוואה: מגדל מקפת אישית כללי מול הראל פנסיה - גילעד כללי" */
export const pairLabel = (p: PickPair) => `להשוואה: ${p.a.name} מול ${p.b.name}`;
/** its link: the compare page with both keys */
export const pairHref = (p: PickPair) => `/funds/compare?k=${p.a.k},${p.b.k}`;
