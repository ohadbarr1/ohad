/* The saver's report card (W1 saver door, plan 01.11.26 Exhibit 4): one track against its category, in plain Hebrew.
   Pure: no React, no fetch, no runtime import of the page libs (only types and the pure funds helpers), so the unit test runs it in node.
   Descriptive, never prescriptive: it says where the track stands and what the default-fund terms are; it never says "move" or "stay".
   The parts of a line are text or a figure key; the page wraps each figure in its source (Sourced), the test joins them to text.

   Rules (the same as the fund card, so the two never disagree):
   - Peers: the track's product and track ("קטגוריה"), open to everyone (unless the track itself is a closed fund), with assets, not
     personally managed (IRA). Ranked on 5Y annualised net of the accumulation fee (DEFAULT_PER), the shared place inside the 10bp tie
     band (lib/fundsTie). A track with no 5Y falls back to 3Y, then LTM, and the line says which.
   - Return vs the category: the track's figure minus the median of the ranked peers; inside the tie band it reads "קרובה לחציון".
   - Fee: the reader's own accumulation fee from their statement when entered, else the track's average actually paid (labelled).
     Its place: the share of the other tracks with a higher fee ("נמוכים מ-X%") or a lower one ("גבוהים מ-X%"); within 0.005pp of the
     median it reads "כמו החציון".
   - Default funds (comprehensive pension only): the tender in force in the data month (funds/default.json), whether this track's fund is
     one of its winners, and the price the tender set for members who join through it.
   - Equity exposure vs the label: |track − category median| > 1.5 standard deviations of the category (n ≥ 5), as on the card. */
import type { Per } from './funds';
import { median } from './fundsCalc';
import { DEFAULT_PER, rankText, tieBand, tieRanks, type TieRank } from './fundsTie';
import { isoYm, priceOf, tenderAt, tendersOf, type DefaultFile, type Tender } from './fundsTools';
import { BM_CUTOFF, BM_HREF, bmKind, segOf, svcOf, type DecisionFile, type SvcRow } from './decision';  // W2

/** the fields of a funds.json row the report card reads */
export interface VFund {
  k: string; name: string; prod: string; track: string; grp: string; fam?: string; id?: number;
  fee: number | null; depfee: number | null; assets: number | null; closed?: boolean; st?: number | null;
  a5: number | null; a3: number | null; y12: number | null;
  net?: Partial<Record<string, number | null>> | null;
}
export interface MyFees { fee?: number | null; depfee?: number | null }

export type Fig = 'ret' | 'rank' | 'med' | 'fee' | 'feeMed' | 'feePct' | 'dep' | 'depMed' | 'tender' | 'tfee' | 'tdep' | 'eq' | 'eqMed' | 'svc' | 'svcTot';
export type Part = string | { t: string; fig: Fig };
export type Tone = 'good' | 'bad' | 'mid' | 'info';
export interface Line { key: 'rank' | 'ret' | 'fee' | 'dep' | 'dflt' | 'dfltRet' | 'eq' | 'self' | 'none' | 'svc' | 'bm'; tone: Tone; parts: Part[];
  /** W2: a page the line points to (the managers'-insurance checklist), and the link's words */
  href?: string; link?: string }
/** one tile of the card: a plain word and its figure */
export interface Tile { key: 'ret' | 'rank' | 'fee' | 'dflt' | 'dep'; label: string; value: Part; word: string; tone: Tone }

export interface Verdict {
  cat: string; prod: string; track: string;
  peers: VFund[];
  self: boolean;
  ret: { per: Per; basis: 'net' | 'gross'; v: number | null; rank: TieRank | null; med: number | null; gap: number | null; band: number; ranked: VFund[];
    /** why the window is not 5Y, in a few words (null on 5Y) */
    why: string | null } | null;
  fee: { own: boolean; v: number | null; med: number | null; higher: number; lower: number; n: number; word: 'low' | 'high' | 'same' | null; pct: number | null };
  dep: { own: boolean; v: number | null; med: number | null } | null;
  dflt: { tender: Tender; winner: boolean; fee: number | null; depfee: number | null; years: number | null; above: boolean } | null;
  eq: { st: number; med: number; z: number; n: number } | null;
  /** W2: the company's place in the regulator's service index 2025 (pension products), when the decision file is given */
  svc: { row: SvcRow; label: string } | null;
  /** W2: a managers'-insurance product of bituach-net: an old generation (1990-2003), or the 2004+ products */
  bm: 'old' | 'new' | null;
  tiles: Tile[];
  lines: Line[];
}

export const PER_HE: Record<Per, string> = { a5: 'ב-5 השנים האחרונות', a3: 'ב-3 השנים האחרונות', y12: 'ב-12 החודשים האחרונים', ytd: 'מתחילת השנה', m1: 'בחודש האחרון' };
const FALLBACK: Per[] = [DEFAULT_PER, 'a3', 'y12'];
export const isPension = (prod: string) => prod === 'פנסיה מקיפה';
export const catOf = (f: Pick<VFund, 'prod' | 'track'>) => `${f.prod} | ${f.track}`;
/** W4: a single-index track: its 10-year past is one market's, and offering it as a return assumption invites chasing it */
export const singleIndex = (f: Pick<VFund, 'track' | 'name'>) => /עוקב|מחקה|S&P|נאסד"?ק|ת"?א[- ]?\d/i.test(`${f.track} ${f.name}`);
export const selfDir = (f: Pick<VFund, 'name'>) => /בניהול אישי|\bIRA\b/.test(f.name);
/** a number with fixed decimals, en-US digits (the site's figures), no sign on a figure that rounds to zero */
export const fx = (v: number, d = 2) => { const t = v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); return /^-[0.]+$/.test(t) ? t.slice(1) : t; };
/** a fee: two decimals, trailing zeros trimmed past the first ("1%", "0.22%", "1.5%" → "1.50%" kept at 2) */
export const pcf = (v: number | null | undefined) => (v == null ? '–' : `${fx(v, v === Math.round(v) ? 0 : 2)}%`);
export const pcr = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${fx(v, d)}%`);
const ymOf = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
export const tenderSpan = (t: Pick<Tender, 'from' | 'to'>) => `מ-${ymOf(t.from)} עד ${ymOf(t.to)}`;

/** the track's peers, as the fund card ranks them */
export function peersOf<T extends VFund>(f: VFund, all: T[]): T[] {
  return all.filter((x) => catOf(x) === catOf(f) && (f.closed || !x.closed) && x.assets !== 0 && !selfDir(x));
}
/** net when the file publishes net returns (the site's default basis), else gross */
const valOf = (x: VFund, per: Per, net: boolean) => (net ? x.net?.[per] ?? null : (x[per as 'a5' | 'a3' | 'y12'] ?? null));
/** the reason a track is read on a shorter window: no 5 years at all, or 5 years gross with a gap in the monthly history the net needs */
export function whyNot5(f: VFund, _per: Per, net: boolean): string {
  return net && f.a5 != null ? 'אין נתון נטו ל-5 שנים' : 'אין למסלול 5 שנות היסטוריה';
}

/** W2: the parts of the decision file the verdict reads */
export type DecLite = Pick<DecisionFile, 'companies' | 'segments'>;
/** The report card of one track. `mine`: the reader's own fees (from their statement), when entered. `dec` (W2): the decision file. */
export function verdictOf(f: VFund, all: VFund[], asof: number, dfile: DefaultFile | null | undefined, mine?: MyFees | null, dec?: DecLite | null): Verdict {
  const peers = peersOf(f, all);
  const self = selfDir(f);
  const net = all.some((x) => x.net && Object.values(x.net).some((v) => v != null));

  /* ---- return and place ---- */
  let ret: Verdict['ret'] = null;
  if (!self) for (const per of FALLBACK) {
    const v = valOf(f, per, net);
    if (v == null) continue;
    const band = tieBand(per, asof);
    const ranked = peers.filter((x) => valOf(x, per, net) != null).sort((a, b) => valOf(b, per, net)! - valOf(a, per, net)!);
    const rank = tieRanks(ranked, (x) => valOf(x, per, net), band).get(f.k) ?? null;
    const med = median(ranked.map((x) => valOf(x, per, net)!));
    ret = { per, basis: net ? 'net' : 'gross', v, rank, med, gap: med == null ? null : v - med, band, ranked, why: per === DEFAULT_PER ? null : whyNot5(f, per, net) };
    break;
  }

  /* ---- fees ---- */
  const ownFee = mine?.fee != null && Number.isFinite(mine.fee), ownDep = mine?.depfee != null && Number.isFinite(mine.depfee);
  const feeV = ownFee ? mine!.fee! : f.fee;
  const others = peers.filter((x) => x.k !== f.k && x.fee != null);
  const feeMed = median(peers.filter((x) => x.fee != null).map((x) => x.fee!));
  const higher = feeV == null ? 0 : others.filter((x) => x.fee! > feeV + 1e-9).length, lower = feeV == null ? 0 : others.filter((x) => x.fee! < feeV - 1e-9).length;
  const word: Verdict['fee']['word'] = feeV == null || feeMed == null ? null : Math.abs(feeV - feeMed) < 0.005 ? 'same' : feeV < feeMed ? 'low' : 'high';
  const pct = !others.length || word == null ? null : Math.round(((word === 'high' ? lower : higher) / others.length) * 100);
  const fee: Verdict['fee'] = { own: ownFee, v: feeV, med: feeMed, higher, lower, n: others.length, word, pct };
  const depPeers = peers.filter((x) => x.depfee != null && x.depfee > 0);
  const depV = ownDep ? mine!.depfee! : f.depfee;
  const dep: Verdict['dep'] = depPeers.length >= 3 || ownDep ? { own: ownDep, v: depV, med: median(depPeers.map((x) => x.depfee!)) } : null;

  /* ---- default funds ---- */
  let dflt: Verdict['dflt'] = null;
  if (isPension(f.prod)) {
    const t = tenderAt(tendersOf(dfile), asof);
    if (t && isoYm(t.from) <= asof) {
      const w = t.winners.find((x) => x.k?.includes(f.k) || (x as { ks?: string[] }).ks?.includes(f.k));
      const p = priceOf(t, w);
      // above the terms only when one allowed pair (the price, or a row of the tender's conversion table) is no higher on both parts
      const pairs = [...(p.fee != null && p.depfee != null ? [{ fee: p.fee, depfee: p.depfee }] : []), ...(t.fee_alt ?? [])];
      const above = feeV != null && depV != null && pairs.some((q) => q.fee <= feeV + 1e-9 && q.depfee <= depV + 1e-9 && (q.fee < feeV - 1e-9 || q.depfee < depV - 1e-9));
      dflt = { tender: t, winner: !!w, fee: p.fee, depfee: p.depfee, years: t.fee_years ?? null, above };
    }
  }

  /* ---- equity exposure vs the label ---- */
  let eq: Verdict['eq'] = null;
  const sts = all.filter((x) => catOf(x) === catOf(f) && !x.closed && x.assets && x.st != null).map((x) => x.st!);
  if (f.st != null && sts.length >= 5) {
    const m = median(sts)!, mean = sts.reduce((s, x) => s + x, 0) / sts.length, sd = Math.sqrt(sts.reduce((s, x) => s + (x - mean) ** 2, 0) / (sts.length - 1));
    const z = sd > 0 ? (f.st - m) / sd : 0;
    if (Math.abs(z) > 1.5) eq = { st: f.st, med: m, z, n: sts.length };
  }

  /* ---- W2: the service index (pension products) and the managers'-insurance checklist ---- */
  const seg = segOf(f), row = seg === 'pension' ? svcOf(dec, f.grp, 'pension') : null;
  const svc: Verdict['svc'] = row ? { row, label: dec?.segments.pension?.label ?? 'קרנות פנסיה' } : null;
  const bm = f.fam === 'insurance' || /ביטוח|פוליסות/.test(f.prod) ? bmKind(f.prod) : null;

  const v: Verdict = { cat: catOf(f), prod: f.prod, track: f.track, peers, self, ret, fee, dep, dflt, eq, svc, bm, tiles: [], lines: [] };
  v.tiles = tilesOf(v);
  v.lines = linesOf(v);
  return v;
}

/* ---------- words ---------- */

/** top quarter / bottom quarter of the shared place. A tie range counts by its best place (tracks that share a place share it in
 *  full: "2–3 of 7" is as good as 2), and the quarter is the same size at both ends, ⌈n/4⌉ places: of 7, places 1–2 and 6–7. */
export function placeTone(r: TieRank | null): Tone {
  if (!r || r.n < 4) return 'mid';
  const q = Math.ceil(r.n / 4);
  if (r.lo <= q) return 'good';
  if (r.lo > r.n - q) return 'bad';
  return 'mid';
}
const placeWord = (t: Tone) => (t === 'good' ? 'ברבע העליון' : t === 'bad' ? 'ברבע התחתון' : 'באמצע הקטגוריה');
export const rankLabel = (r: TieRank) => `${rankText(r)} מתוך ${r.n}`;

function tilesOf(v: Verdict): Tile[] {
  const out: Tile[] = [];
  if (v.ret) {
    const t = placeTone(v.ret.rank);
    out.push({ key: 'ret', label: `תשואה, ${v.ret.per === 'a5' ? '5Y' : v.ret.per === 'a3' ? '3Y' : 'LTM'}${v.ret.basis === 'net' ? ' נטו' : ''}`, value: { t: pcr(v.ret.v), fig: 'ret' },
      word: v.ret.gap == null ? '' : Math.abs(v.ret.gap) < v.ret.band ? 'כמו החציון' : v.ret.gap > 0 ? `מעל החציון (${pcr(v.ret.med)})` : `מתחת לחציון (${pcr(v.ret.med)})`, tone: v.ret.gap == null || Math.abs(v.ret.gap) < v.ret.band ? 'mid' : v.ret.gap > 0 ? 'good' : 'bad' });
    if (v.ret.rank) out.push({ key: 'rank', label: 'מקום בקטגוריה', value: { t: rankLabel(v.ret.rank), fig: 'rank' }, word: placeWord(t), tone: t });
  }
  if (v.fee.v != null) out.push({ key: 'fee', label: v.fee.own ? 'דמי ניהול מצבירה, שלך' : 'דמי ניהול מצבירה', value: { t: pcf(v.fee.v), fig: 'fee' },
    word: (v.fee.own ? '' : 'ממוצע במסלול, ') + (v.fee.word === 'low' ? `זולים מהחציון (${pcf(v.fee.med)})` : v.fee.word === 'high' ? `יקרים מהחציון (${pcf(v.fee.med)})` : v.fee.word === 'same' ? 'כמו החציון' : ''),
    tone: v.fee.word === 'low' ? 'good' : v.fee.word === 'high' ? 'bad' : 'mid' });
  if (v.dflt) out.push({ key: 'dflt', label: 'קרן ברירת מחדל', value: v.dflt.winner ? 'כן' : 'לא', word: v.dflt.winner ? `${v.dflt.tender.label ?? v.dflt.tender.id}, ${tenderSpan(v.dflt.tender)}` : `לא בין הזוכות ב${v.dflt.tender.label ?? 'הליך'}`, tone: 'info' });
  else if (v.dep && v.dep.v != null) out.push({ key: 'dep', label: v.dep.own ? 'מהפקדה, שלך' : 'מהפקדה, ממוצע', value: { t: pcf(v.dep.v), fig: 'dep' },
    word: v.dep.med == null ? '' : Math.abs(v.dep.v - v.dep.med) < 0.005 ? 'כמו החציון' : v.dep.v < v.dep.med ? `זולים מהחציון (${pcf(v.dep.med)})` : `יקרים מהחציון (${pcf(v.dep.med)})`,
    tone: v.dep.med == null || Math.abs(v.dep.v - v.dep.med) < 0.005 ? 'mid' : v.dep.v < v.dep.med ? 'good' : 'bad' });
  return out;
}

function linesOf(v: Verdict): Line[] {
  const L: Line[] = [];
  if (v.self) L.push({ key: 'self', tone: 'info', parts: ['זה מסלול בניהול אישי (IRA): את ההשקעות בוחר החוסך, ולכן התשואה המפורסמת אינה תוצאה של מנהל ואינה מדורגת.'] });
  if (v.ret) {
    const { per, rank, gap, med, band } = v.ret, ann = per === 'a5' || per === 'a3';
    if (rank) L.push({ key: 'rank', tone: placeTone(rank), parts: [`${PER_HE[per]} המסלול שלך במקום `, { t: rankLabel(rank), fig: 'rank' }, ` בקטגוריה (${v.prod}, ${v.track})${v.ret.basis === 'net' ? ', אחרי דמי ניהול' : ''}${v.ret.why ? ` (${v.ret.why})` : ''}${rank.lo !== rank.hi ? '. הפער בינו לבין הצמודים לו קטן מ-0.1% בשנה' : ''}.`] });
    if (gap != null && med != null) L.push({ key: 'ret', tone: Math.abs(gap) < band ? 'mid' : gap > 0 ? 'good' : 'bad',
      parts: [ann ? 'התשואה השנתית הממוצעת שלו, ' : 'התשואה שלו, ', { t: pcr(v.ret.v), fig: 'ret' },
        Math.abs(gap) < band ? ', קרובה לחציון בקטגוריה (' : `, ${gap > 0 ? 'גבוהה' : 'נמוכה'} ב-${fx(Math.abs(gap))} נקודות אחוז ${ann ? 'בשנה ' : ''}מהחציון בקטגוריה (`, { t: pcr(med), fig: 'med' }, ').'] });
  } else if (!v.self) L.push({ key: 'none', tone: 'info', parts: ['למסלול אין עדיין תשואה מפורסמת ל-12 חודשים, ולכן אין לו מקום בקטגוריה.'] });

  const fe = v.fee;
  if (fe.v != null) {
    const who = fe.own ? 'דמי הניהול שלך מצבירה (' : 'דמי הניהול מצבירה במסלול (';
    const tail = fe.own ? ', מהדוח שלך)' : ', הממוצע שמשלמים העמיתים)';
    const cmp: Part[] = fe.word === 'same' ? [' כמו החציון בקטגוריה (']
      : fe.word && fe.pct === 100 ? [` הם ${fe.word === 'low' ? 'הנמוכים' : 'הגבוהים'} בקטגוריה: `, { t: `${fe.word === 'low' ? 'אף מסלול אחר לא זול מהם' : 'אף מסלול אחר לא יקר מהם'}`, fig: 'feePct' }, `. החציון: `]
      : fe.word && fe.pct != null && fe.pct > 0 ? [` ${fe.word === 'low' ? 'נמוכים' : 'גבוהים'} מ-`, { t: `${fe.pct}%`, fig: 'feePct' }, ` מהמסלולים בקטגוריה. החציון: `]
      : fe.word ? [` ${fe.word === 'low' ? 'נמוכים' : 'גבוהים'} מהחציון בקטגוריה: `] : [' · חציון הקטגוריה: '];
    const depP: Part[] = v.dep && v.dep.v != null && v.dep.med != null ? [` מהפקדה: `, { t: pcf(v.dep.v), fig: 'dep' }, `${v.dep.own ? ' (שלך)' : ''}, מול חציון של `, { t: pcf(v.dep.med), fig: 'depMed' }, '.'] : [];
    L.push({ key: 'fee', tone: fe.word === 'low' ? 'good' : fe.word === 'high' ? 'bad' : 'mid', parts: [who, { t: pcf(fe.v), fig: 'fee' }, tail, ...cmp, { t: pcf(fe.med), fig: 'feeMed' }, fe.word === 'same' ? ').' : '.', ...depP] });
  }

  if (v.dflt) {
    const d = v.dflt, t = d.tender, nm = t.label ?? `הליך ${t.id}`;
    const alt = t.fee_alt?.length ? [...t.fee_alt].sort((a, b) => b.depfee - a.depfee)[0] : null;
    const terms: Part[] = d.depfee != null && d.fee != null ? [{ t: pcf(d.depfee), fig: 'tdep' }, ' מהפקדה ו-', { t: pcf(d.fee), fig: 'tfee' }, ` מצבירה${d.years ? `, ל-${d.years} שנים מההצטרפות` : ''}.`,
      alt ? ` במקום מחיר הבסיס אפשר לבחור צירוף שווה ערך מטבלת ההמרה של ההליך (למשל ${pcf(alt.depfee)} מהפקדה ו-${pcf(alt.fee)} מצבירה).` : ''] : ['המחיר שכל זוכה הציע.'];
    const above = d.above ? ` דמי הניהול ${v.fee.own ? 'שלך' : 'הממוצעים במסלול'} גבוהים בשני הרכיבים מצירוף שההליך מתיר.` : '';
    if (d.winner) L.push({ key: 'dflt', tone: 'info', parts: ['זו אחת מקרנות ברירת המחדל שבחרה הרשות (', { t: `${nm}, ${tenderSpan(t)}`, fig: 'tender' }, '). מחיר הבסיס בהליך למי שמצטרף אליה דרך ברירת המחדל: ', ...terms, above] });
    else L.push({ key: 'dflt', tone: 'info', parts: ['הקרן אינה אחת מקרנות ברירת המחדל של ', { t: `${nm}, ${tenderSpan(t)}`, fig: 'tender' }, '. בקרנות האלה מחיר הבסיס למי שמצטרף דרך ברירת המחדל: ', ...terms, above] });
    if (d.winner && v.ret?.rank && placeTone(v.ret.rank) === 'bad') L.push({ key: 'dfltRet', tone: 'bad', parts: ['המחיר של קרן ברירת מחדל נקבע במכרז ואינו אומר דבר על התשואה: ', PER_HE[v.ret.per], ' המסלול הזה במקום ', { t: rankLabel(v.ret.rank), fig: 'rank' }, ' בקטגוריה.'] });
  }

  // W2: the company's service, in its own words: a description of the regulator's index, not a judgement of the track
  if (v.svc) { const r = v.svc.row; L.push({ key: 'svc', tone: 'info', parts: [`במדד השירות של רשות שוק ההון ל-${r.year}, ${r.name ?? 'החברה המנהלת'} במקום `, { t: `${r.rank} מתוך ${r.of}`, fig: 'svc' }, ' בקרנות הפנסיה (ציון ', { t: String(r.total), fig: 'svcTot' }, ' מ-100). המדד בודק שירות: שביעות רצון, תלונות, מענה טלפוני, שיוך כספים ושירות דיגיטלי, ולא תשואה או דמי ניהול.'] }); }

  if (v.eq) L.push({ key: 'eq', tone: 'info', parts: ['החשיפה למניות של המסלול (', { t: pcr(v.eq.st, 1), fig: 'eq' }, `) ${v.eq.z > 0 ? 'גבוהה' : 'נמוכה'} בהרבה מהמקובל בקטגוריה (חציון `, { t: pcr(v.eq.med, 1), fig: 'eqMed' }, '). שם המסלול לא מספר את כל הסיפור.'] });
  // W2: an old managers'-insurance policy may carry terms a move does not keep
  if (v.bm === 'old') L.push({ key: 'bm', tone: 'info', href: BM_HREF, link: 'מה בודקים לפני שעוזבים', parts: ['פוליסת ביטוח מנהלים מהדור הזה עשויה לכלול מקדם קצבה מובטח ותנאים נוספים שלא נשמרים אחרי מעבר, ומעבר אינו הפיך.'] });
  else if (v.bm === 'new') L.push({ key: 'bm', tone: 'info', href: BM_HREF, link: 'מה בודקים לפני שעוזבים', parts: [`אם המוצר שלך הוא ביטוח מנהלים (ולא פוליסת חיסכון) שהתחיל ${BM_CUTOFF}, ייתכן שיש בו מקדם קצבה מובטח שלא נשמר אחרי מעבר.`] });
  return L;
}

/** a line as plain text (the test, the script, a screen reader summary) */
export const textOf = (parts: Part[]) => parts.map((p) => (typeof p === 'string' ? p : p.t)).join('').replace(/\s+/g, ' ').replace(/ \./g, '.').trim();
/** the one-sentence headline of the card */
export function headline(v: Verdict): string {
  const bits: string[] = [];
  if (v.ret?.rank) bits.push(`${PER_HE[v.ret.per]}: מקום ${rankLabel(v.ret.rank)}`);
  if (v.fee.word) bits.push(`דמי ניהול ${v.fee.word === 'low' ? 'זולים מהחציון' : v.fee.word === 'high' ? 'יקרים מהחציון' : 'כמו החציון'}`);
  if (v.dflt?.winner) bits.push('קרן ברירת מחדל');
  return bits.join(' · ');
}

export const WIN_SHORT: Partial<Record<Per, string>> = { a5: '5Y', a3: '3Y', y12: 'LTM' };
/** The card folded (the saver's /my): at most three short lines, each with its figures, in this order: the place, the fee, and the
 *  default-fund price (comprehensive pension) or the deposit fee or the equity flag. The full lines (linesOf) stay behind "עוד פרטים". */
export function brief(v: Verdict): Line[] {
  const L: Line[] = [];
  if (v.self) L.push({ key: 'self', tone: 'info', parts: ['מסלול בניהול אישי (IRA): התשואה אינה של מנהל ואינה מדורגת.'] });
  else if (v.ret?.rank) {
    const t = placeTone(v.ret.rank);
    L.push({ key: 'rank', tone: t, parts: [`${PER_HE[v.ret.per]}: מקום `, { t: rankLabel(v.ret.rank), fig: 'rank' }, ` בקטגוריה, ${placeWord(t)}${v.ret.basis === 'net' ? ' (נטו)' : ''}${v.ret.why ? `. ${WIN_SHORT[v.ret.per]}, כי ${v.ret.why}` : ''}.`] });
  } else if (!v.ret) L.push({ key: 'none', tone: 'info', parts: ['אין עדיין תשואה ל-12 חודשים, ולכן אין מקום בקטגוריה.'] });
  const fe = v.fee;
  if (fe.v != null) {
    const w = fe.word === 'low' ? (fe.pct === 100 ? 'הזולים בקטגוריה' : 'זולים מהחציון') : fe.word === 'high' ? (fe.pct === 100 ? 'היקרים בקטגוריה' : 'יקרים מהחציון') : fe.word === 'same' ? 'כמו החציון' : '';
    L.push({ key: 'fee', tone: fe.word === 'low' ? 'good' : fe.word === 'high' ? 'bad' : 'mid',
      parts: [fe.own ? 'דמי הניהול שלך מצבירה: ' : 'דמי הניהול מצבירה (ממוצע במסלול): ', { t: pcf(fe.v), fig: 'fee' }, w ? `, ${w}` : '', fe.med != null && fe.word !== 'same' ? ' (' : '', ...(fe.med != null && fe.word !== 'same' ? [{ t: pcf(fe.med), fig: 'feeMed' as Fig }, ')'] : []), '.'] });
  }
  const d = v.dflt;
  if (d && d.fee != null && d.depfee != null) {
    L.push({ key: 'dflt', tone: 'info', parts: [d.winner ? 'קרן ברירת מחדל: מחיר הבסיס למצטרפים דרכה ' : 'לא קרן ברירת מחדל. בקרנות ברירת המחדל מחיר הבסיס ', { t: pcf(d.depfee), fig: 'tdep' }, ' מהפקדה ו-', { t: pcf(d.fee), fig: 'tfee' }, ' מצבירה.'] });
  } else if (v.dep && v.dep.v != null && v.dep.med != null && Math.abs(v.dep.v - v.dep.med) >= 0.005) {
    L.push({ key: 'dep', tone: v.dep.v < v.dep.med ? 'good' : 'bad', parts: [v.dep.own ? 'מהפקדה, שלך: ' : 'מהפקדה, ממוצע במסלול: ', { t: pcf(v.dep.v), fig: 'dep' }, ', מול חציון ', { t: pcf(v.dep.med), fig: 'depMed' }, '.'] });
  } else if (v.eq) L.push({ key: 'eq', tone: 'info', parts: ['החשיפה למניות (', { t: pcr(v.eq.st, 1), fig: 'eq' }, `) ${v.eq.z > 0 ? 'גבוהה' : 'נמוכה'} בהרבה מהמקובל בקטגוריה.`] });
  return L.slice(0, 3);
}
