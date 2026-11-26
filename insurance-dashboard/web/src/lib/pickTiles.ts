/* C6 / C7 · the guided picker's steps and the similar-track chips, as pure functions (compare page "איזה מסלול יש לך?", spec §4.1–4.2,
   §10A.2 C6/C7, mockup v3). Node-testable; the components (components/compare/PickerSheet, CompareEmpty, SimilarChips) only render.
   - six product tiles, all live: a tile stands for one or more of the regulator's products (managers' insurance and the savings policy
     share their investment tracks; the old 1990–2003 policies are the managers' tile's last chips);
   - step 2: the tracks of a product as chips, the default track first (כללי, then the age tracks), annuitants' tracks last;
   - step 3: the open tracks of one category as company tiles, alphabetical by the short company name ("לפי א-ב");
   - a company with two tracks in one category gets the word that tells them apart ("הראל · גילעד", "הראל · מנוף");
   - the door's cap: 4 saver / 6 agent / 8 Pro (O2), never above lib/funds TRAY_MAX;
   - similar chips: the open same-category tracks not on screen, largest first;
   - recents: the last three sets, newest first. */
import type { Door } from './door';
import { shortGrp, trackColor, trackLabels } from '../pages/compare/tracks';

/** the fields the picker reads from a funds.json row */
export interface PFund {
  k: string; name: string; prod: string; track: string; grp: string; id?: number | string | null;
  assets?: number | null; closed?: boolean | null; a5?: number | null;
}

/* ---------- products ---------- */
export const PRODS = {
  pensia: 'פנסיה מקיפה', klali: 'פנסיה כללית', hishtalmut: 'השתלמות', hash: 'גמל להשקעה', gemel: 'גמל', kid: 'חיסכון לילד',
  pitz: 'מרכזית לפיצויים', pol: 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)', mn04: 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים',
  mn92: 'ביטוחי מנהלים 1992-2003', mn90: 'ביטוחי מנהלים 1990-1991',
} as const;

/** a box of the isometric icon: height and material (the site's Icon3D palette) */
export type IsoMat = 'navy' | 'orange' | 'blue';
export interface Tile { id: string; label: string; prods: string[]; art: [number, IsoMat][]; note?: string }
/** the six product tiles of step 1 and of the entry screen, in reading order (three per row) */
export const TILES: Tile[] = [
  { id: 'pension', label: 'פנסיה', prods: [PRODS.pensia, PRODS.klali], art: [[18, 'blue'], [30, 'navy'], [44, 'orange']] },
  { id: 'hishtalmut', label: 'קרן השתלמות', prods: [PRODS.hishtalmut], art: [[30, 'navy'], [22, 'blue'], [38, 'orange']] },
  { id: 'hash', label: 'גמל להשקעה', prods: [PRODS.hash], art: [[14, 'orange'], [26, 'blue'], [36, 'navy']] },
  { id: 'gemel', label: 'קופת גמל', prods: [PRODS.gemel, PRODS.kid, PRODS.pitz], art: [[26, 'blue'], [34, 'navy'], [20, 'orange']] },
  { id: 'managers', label: 'ביטוח מנהלים', prods: [PRODS.pol, PRODS.mn04, PRODS.mn92, PRODS.mn90], art: [[36, 'navy'], [20, 'blue'], [28, 'orange']],
    note: 'לביטוח מנהלים ולפוליסת חיסכון אותם מסלולי השקעה, ולכן אותה תשואה.' },
  { id: 'policy', label: 'פוליסת חיסכון', prods: [PRODS.pol], art: [[20, 'blue'], [34, 'orange'], [24, 'navy']],
    note: 'לביטוח מנהלים ולפוליסת חיסכון אותם מסלולי השקעה, ולכן אותה תשואה.' },
];
/** the tile a product belongs to (its first tile: the savings-policy product opens under managers' insurance only when asked for) */
export const tileOf = (prod: string, prefer?: string): Tile | null =>
  (prefer ? TILES.find((t) => t.id === prefer && t.prods.includes(prod)) : null) ?? TILES.find((t) => t.prods.includes(prod)) ?? null;

/** a product in the picker's words (headings and the product switch of step 2) */
export const PROD_SHORT: Record<string, string> = {
  [PRODS.pensia]: 'פנסיה מקיפה', [PRODS.klali]: 'פנסיה כללית (משלימה)', [PRODS.hishtalmut]: 'קרן השתלמות', [PRODS.hash]: 'גמל להשקעה',
  [PRODS.gemel]: 'קופת גמל', [PRODS.kid]: 'חיסכון לכל ילד', [PRODS.pitz]: 'קופה מרכזית לפיצויים', [PRODS.pol]: 'ביטוח מנהלים ופוליסות חיסכון',
  [PRODS.mn04]: 'מסלולים ייעודיים (מ-2004)', [PRODS.mn92]: 'פוליסה ישנה, 1992–2003', [PRODS.mn90]: 'פוליסה ישנה, 1990–1991',
};
export const prodShort = (p: string) => PROD_SHORT[p] ?? p;

/* ---------- step 2: tracks ---------- */
/** the default track first, then the age tracks, equity, the index trackers; annuitants' tracks last (rank, lower first) */
const TRACK_FIRST = ['כללי', 'עד 50', '50-60', '60 ומעלה', 'מניות', 'עוקב מדד S&P 500', 'עוקב מדדי מניות', 'משולב סחיר', 'אשראי ואג"ח', 'כספי (שקלי)', 'הלכה'];
const trackRank = (t: string) => (t === 'מקבלי קצבה' ? 999 : TRACK_FIRST.includes(t) ? TRACK_FIRST.indexOf(t) : 100);
export interface TrackChip { prod: string; track: string; n: number }
/** the tracks of one product, with the number of open tracks in each */
export function tracksOf(funds: PFund[], prod: string): TrackChip[] {
  const n = new Map<string, number>();
  for (const f of funds) if (f.prod === prod && !f.closed) n.set(f.track, (n.get(f.track) ?? 0) + 1);
  return [...n.entries()].map(([track, c]) => ({ prod, track, n: c }))
    .sort((a, b) => trackRank(a.track) - trackRank(b.track) || b.n - a.n || a.track.localeCompare(b.track, 'he'));
}

/* ---------- names ---------- */
/* One source with the page's columns (pages/compare/tracks.ts, lane L2-a): the picker's tray and the similar chips name and colour a
   track exactly as the grid's column chips, the long view and the sheets do. */
/** the company in a saver's words: "מנורה" for "מנורה מבטחים" (pages/compare/tracks.ts shortGrp) */
export const house = shortGrp;
export { trackColor, trackLabels };

const GENERIC = new Set(['מסלול', 'מסלולית', 'השקעה', 'להשקעה', 'חברה', 'לביטוח', 'בע"מ', 'בעמ', 'מנוהל', 'באמצעות', 'עי', 'ע"י', 'ניהול', 'תיקים', 'תיקי',
  'השקעות', 'בית', 'קופה', 'קופת', 'קרן', 'פנסיה', 'גמל', 'השתלמות', 'לתגמולים', 'לבני', 'ומטה', 'לגילאי', 'עד', 'ומעלה', 'ביטוח', 'מנהלים', 'חיסכון', 'פוליסת', 'פוליסות', 'של', 'ו']);
const toks = (s: string) => s.replace(/״/g, '"').replace(/[׳']/g, '').split(/[\s\-–,.()/]+/).filter(Boolean);
/** the words of a fund's name that tell it apart from its company's other track of the same category ('' for none) */
export function altWord(f: PFund): string {
  const drop = new Set([...toks(f.grp), ...toks(house(f.grp)), ...toks(f.prod), ...toks(f.track)].map((x) => x.toLowerCase()));
  const w = toks(f.name).filter((x) => !drop.has(x.toLowerCase()) && !GENERIC.has(x) && !/^\d+$/.test(x));
  return w.slice(0, 2).join(' ');
}
/** labels for the tracks of one category: the company, and when it has two tracks there the word that tells them apart.
 *  `sep` joins them: " · " on the picker's tiles, " " on chips ("הראל מנוף"). A word shared by two is replaced by the fund number. */
export function labelsOf(cat: PFund[], sep = ' · '): Map<string, string> {
  const by = new Map<string, PFund[]>();
  for (const f of cat) by.set(f.grp, [...(by.get(f.grp) ?? []), f]);
  const out = new Map<string, string>();
  for (const [grp, fs] of by) {
    if (fs.length === 1) { out.set(fs[0].k, house(grp)); continue; }
    const alts = fs.map(altWord);
    fs.forEach((f, i) => {
      const a = alts[i], dup = a && alts.filter((x) => x === a).length > 1;
      out.set(f.k, `${house(grp)}${a && !dup ? sep + a : !a ? '' : `${sep}מס׳ ${f.id ?? f.k}`}`);
    });
  }
  return out;
}
const catOf = (funds: PFund[], f: Pick<PFund, 'prod' | 'track'>) => funds.filter((x) => x.prod === f.prod && x.track === f.track);
/** one track's label among its category (the tray chips, the similar chips) */
export const labelOf = (funds: PFund[], f: PFund, sep = ' · ') => labelsOf(catOf(funds, f), sep).get(f.k) ?? house(f.grp);

/* ---------- step 3: companies ---------- */
export interface CoTile { k: string; label: string; a5: number | null; f: PFund }
/** the open tracks of one category as tiles, alphabetical by label ("לפי א-ב") */
export function companiesOf(funds: PFund[], prod: string, track: string, basis: 'gross' = 'gross'): CoTile[] {
  const cat = funds.filter((f) => f.prod === prod && f.track === track && !f.closed);
  const lab = labelsOf(cat);
  return cat.map((f) => ({ k: f.k, label: lab.get(f.k) ?? house(f.grp), a5: a5Of(f, basis), f }))
    .sort((a, b) => a.label.localeCompare(b.label, 'he') || (b.f.assets ?? 0) - (a.f.assets ?? 0));
}
/** the 5-year average return: the published gross (owner 26.11.26: never net of fees) */
export const a5Of = (f: PFund, _basis: 'gross' = 'gross'): number | null => f.a5 ?? null;

/** "להראל שתי קרנות פנסיה…": the note under the pension tiles when one fund house runs two pension funds in the category (else null).
 *  Other products tell a company's tracks apart by their labels alone ("מגדל · בניהול אישי"): a note per company would be a wall of text. */
export function twinNote(tiles: CoTile[]): string | null {
  const by = new Map<string, CoTile[]>();
  for (const t of tiles) by.set(t.f.grp, [...(by.get(t.f.grp) ?? []), t]);
  const notes: string[] = [];
  for (const [grp, ts] of by) {
    if (ts.length < 2 || (ts[0].f.prod !== PRODS.pensia && ts[0].f.prod !== PRODS.klali)) continue;
    const big = [...ts].sort((a, b) => (b.f.assets ?? 0) - (a.f.assets ?? 0))[0];
    if (!big.label.includes(' · ')) continue;
    notes.push(`ל${house(grp)} ${ts.length === 2 ? 'שתי' : ts.length} קרנות פנסיה. השם של הקרן שלך כתוב בדוח השנתי; ברוב המקרים זו הגדולה (${big.label.split(' · ')[1]}).`);
  }
  return notes.length ? notes.join(' ') : null;
}

/** the company's other tracks of the same product ("להשוות למסלול אחר של מגדל"): open, the reader's track first, annuitants' last, then by size */
export function siblingsOf(funds: PFund[], f: PFund): PFund[] {
  return funds.filter((x) => x.grp === f.grp && x.prod === f.prod && !x.closed)
    .sort((a, b) => Number(b.k === f.k) - Number(a.k === f.k) || Number(a.track === 'מקבלי קצבה') - Number(b.track === 'מקבלי קצבה') || (b.assets ?? 0) - (a.assets ?? 0));
}
/** the button's sub-line: up to four other tracks, equity and the age tracks first ("מניות, עד 50, 50-60, 60 ומעלה") */
export function siblingWords(funds: PFund[], f: PFund, n = 4): string {
  const SIB = ['מניות', 'עד 50', '50-60', '60 ומעלה'];
  const r = (t: string) => (SIB.includes(t) ? SIB.indexOf(t) : t === 'מקבלי קצבה' ? 99 : 10);
  const ts = [...new Set(siblingsOf(funds, f).filter((x) => x.track !== f.track).map((x) => x.track))];
  return ts.sort((a, b) => r(a) - r(b)).slice(0, n).join(', ');
}

/* ---------- caps, similar, recents ---------- */
/** approved caps (O2): saver 4, agent 6, Pro 8; never above the tray's hard limit */
export const DOOR_CAP: Record<Door, number> = { saver: 4, agent: 6, pro: 8 };
export const capOf = (door: Door | null | undefined, hard = 8) => Math.min(DOOR_CAP[door ?? 'saver'] ?? 4, hard);
export const capToast = (cap: number) => `עד ${cap} מסלולים במסך אחד, כדי שיהיה אפשר לקרוא בלי לגלול הצידה`;

/** at least this many similar chips when any room is left (mockup v3: "＋ כלל ＋ הראל מנוף" at three of four); one tap adds one, and
 *  at the cap the row goes, so a choice of two never adds past the cap */
export const SIMILAR_MIN = 2;
/** "אותו מסלול בחברה אחרת": open tracks of the first track's category not on screen, largest first; none when the tracks on screen
 *  span categories (different risk levels or products) or the cap is reached */
export function similarOf(funds: PFund[], keys: string[], cap: number, max = 4): PFund[] {
  const by = new Map(funds.map((f) => [f.k, f]));
  const on = keys.map((k) => by.get(k)).filter((f): f is PFund => !!f);
  if (!on.length || keys.length >= cap) return [];
  const f0 = on[0];
  if (on.some((f) => f.prod !== f0.prod || f.track !== f0.track)) return [];
  return funds.filter((f) => f.prod === f0.prod && f.track === f0.track && !f.closed && !keys.includes(f.k) && (f.assets ?? 0) > 0)
    .sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0) || a.k.localeCompare(b.k)).slice(0, Math.min(max, Math.max(SIMILAR_MIN, cap - keys.length)));
}

/** recents ("השוואות אחרונות", this browser only): newest first, a set seen again moves to the top, at most three */
export const RECENT_KEY = 'cmp:recent';
export function pushRecent(list: string[][], keys: string[], n = 3): string[][] {
  if (keys.length < 2) return list;
  const sig = (ks: string[]) => [...ks].sort().join(',');
  return [keys, ...list.filter((x) => Array.isArray(x) && sig(x) !== sig(keys))].slice(0, n);
}
