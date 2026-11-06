/* W11 · the agent-book stress test (/clients/book, agent door): every client folder in this browser (lib/clients) and any clearing-house
   files the agent drops on the page (read in memory, not saved unless asked), taken together as one book.
   - totals; exposure by manager group and by product, ₪ and % of the book's balances; concentration (largest group's share, HHI)
   - pension balances in tracks whose last published actuarial balance (funds.json act_h, the last quarter) is negative
   - products whose own fee from savings is above the median of the published average fees of the track's category, and the ₪ a year
   - default-fund products whose tender price may end within 12 months (funds/default.json: the price holds `fee_years` from joining)
   - products in a closed generation (managers' insurance sold 1990-2003) or with a guaranteed annuity coefficient (coefGuaranteed)
   Every line carries the folders behind it, so the page can list them. Pure: no React, no storage, no fetch (the node test runs it).
   Nothing here leaves the browser; no figure is a recommendation. Lines are descriptions of the book, not a judgement of a product. */
import type { Folder, Held } from './clients';
import { heldCost } from './clients';
import { catKey, type FundX } from './funds';
import { isOldGen } from './decision';
import { median } from './fundsCalc';
import { priceOf, tendersOf, type DefaultFile, type Tender, type Winner } from './fundsTools';

export interface BookItem { folder: string; label: string; held: number; what: string; detail: string; amount: number | null }
export interface BookLine { id: string; title: string; value: string; sub: string; items: BookItem[]; folders: number }
export interface Slice { key: string; label: string; balance: number; share: number; n: number; folders: string[]; matched: boolean }
export interface BookOut {
  folders: number; extra: number; products: number; withBalance: number; balance: number; monthly: number; feeYear: number; noFee: number; matched: number;
  byGroup: Slice[]; byProduct: Slice[];
  top: Slice | null; hhi: number | null;
  /** pension: balance in tracks with a published actuarial balance, the part in negative ones */
  act: { base: number; neg: number; share: number | null; items: BookItem[]; asof: number | null };
  /** own fee above the category median: balances with a comparable fee, the part above, ₪ a year */
  fee: { base: number; above: number; share: number | null; gap: number; items: BookItem[]; noCat: number };
  dflt: { items: BookItem[]; unknown: number };
  coef: { items: BookItem[] };
  unmatched: { items: BookItem[] };
  lines: BookLine[];
}

const ils = (v: number) => `₪${Math.round(v).toLocaleString('en-US')}`;
const pc = (v: number | null, d = 1) => (v == null ? '–' : `${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
const nameOf = (h: Held) => [h.typeHe, h.provider, h.track ?? h.plan].filter(Boolean).join(' · ');
/** ISO date + n months (day kept, clamped to the month) */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const dmy = (iso: string) => `${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** the median of the published average fee from savings of each category's open tracks (prod | track) */
export function catMedians(funds: FundX[]): Map<string, { fee: number | null; n: number }> {
  const by = new Map<string, number[]>();
  for (const f of funds) if (!f.gone && f.fee != null) by.set(catKey(f), [...(by.get(catKey(f)) ?? []), f.fee]);
  return new Map([...by].map(([k, v]) => [k, { fee: median(v), n: v.length }]));
}
/** red team 06.11.26 · the median of the published average fees, from savings and from deposits, by category (prod | track) and by
 *  product (the fallback when a category has fewer than 3 tracks); `n` / `nd`: how many tracks each median rests on */
export interface FeeMed { fee: number | null; n: number; depfee: number | null; nd: number }
export function feeMedians(funds: FundX[]): { cat: Map<string, FeeMed>; prod: Map<string, FeeMed> } {
  const acc = (key: (f: FundX) => string) => {
    const a = new Map<string, { f: number[]; d: number[] }>();
    for (const f of funds) {
      if (f.gone) continue;
      const k = key(f), e = a.get(k) ?? { f: [], d: [] };
      if (f.fee != null) e.f.push(f.fee);
      if (f.depfee != null) e.d.push(f.depfee);
      a.set(k, e);
    }
    return new Map([...a].map(([k, e]) => [k, { fee: median(e.f), n: e.f.length, depfee: median(e.d), nd: e.d.length }]));
  };
  return { cat: acc(catKey), prod: acc((f) => f.prod) };
}

/** the default-fund tender a held product may be on: the tenders whose winner lists its track, the one whose price equals the
 *  product's own fees first (`byFee`), and the window in which that price's `fee_years` end for members who joined in the tender's period */
export interface TenderHit { t: Tender; w: Winner; byFee: boolean; end: [string, string] | null }
export function tenderHits(h: Held, ts: Tender[]): TenderHit[] {
  if (!h.k) return [];
  const hits: TenderHit[] = [];
  for (const t of ts) for (const w of t.winners) {
    if (!(w.ks ?? w.k ?? []).includes(h.k)) continue;
    const p = priceOf(t, w);
    const byFee = h.fee != null && h.depfee != null && p.fee != null && p.depfee != null && Math.abs(h.fee - p.fee) <= 0.005 && Math.abs(h.depfee - p.depfee) <= 0.005;
    const fy = t.fee_years;
    hits.push({ t, w, byFee, end: fy ? [addMonths(t.from, fy * 12), addMonths(t.to, fy * 12)] : null });
  }
  return hits.sort((a, b) => Number(b.byFee) - Number(a.byFee) || b.t.from.localeCompare(a.t.from));
}

function slices(rows: { key: string; label: string; balance: number; folder: string; matched: boolean }[], total: number): Slice[] {
  const by = new Map<string, Slice>();
  for (const r of rows) {
    const s = by.get(r.key) ?? { key: r.key, label: r.label, balance: 0, share: 0, n: 0, folders: [], matched: r.matched };
    s.balance += r.balance; s.n++;
    if (!s.folders.includes(r.folder)) s.folders.push(r.folder);
    by.set(r.key, s);
  }
  return [...by.values()].map((s) => ({ ...s, share: total > 0 ? (s.balance / total) * 100 : 0 })).sort((a, b) => b.balance - a.balance || a.label.localeCompare(b.label, 'he'));
}
const nFolders = (items: BookItem[]) => new Set(items.map((i) => i.folder)).size;
const nProd = (n: number) => (n === 1 ? 'מוצר אחד' : `${n.toLocaleString('en-US')} מוצרים`);

/** the book: `folders` are the saved folders and the dropped files' folders together; `extra` = how many of them are unsaved */
export function bookOf(folders: Folder[], funds: FundX[], dfile: DefaultFile | null | undefined, today: string, extra = 0): BookOut {
  const byK = new Map(funds.map((f) => [f.k, f]));
  const meds = catMedians(funds);
  const ts = tendersOf(dfile);
  const horizon = addMonths(today, 12);
  const all = folders.flatMap((f) => f.held.map((h, i) => ({ f, h, i, x: h.k ? byK.get(h.k) ?? null : null })));
  const out: BookOut = {
    folders: folders.length, extra, products: all.length, withBalance: 0, balance: 0, monthly: 0, feeYear: 0, noFee: 0, matched: 0,
    byGroup: [], byProduct: [], top: null, hhi: null,
    act: { base: 0, neg: 0, share: null, items: [], asof: null }, fee: { base: 0, above: 0, share: null, gap: 0, items: [], noCat: 0 },
    dflt: { items: [], unknown: 0 }, coef: { items: [] }, unmatched: { items: [] }, lines: [],
  };
  const gRows: Parameters<typeof slices>[0] = [], pRows: Parameters<typeof slices>[0] = [];
  const item = (f: Folder, i: number, h: Held, detail: string, amount: number | null, what = nameOf(h)): BookItem => ({ folder: f.id, label: f.label, held: i, what, detail, amount });
  for (const { f, h, i, x } of all) {
    const bal = h.balance ?? 0;
    if (h.balance != null && h.balance > 0) out.withBalance++;
    out.balance += bal; out.monthly += h.monthly ?? 0;
    const c = heldCost(h);
    out.feeYear += c.total ?? 0;
    if (h.balance != null && h.balance > 0 && h.fee == null) out.noFee++;
    if (x) out.matched++;
    if (bal > 0) {
      gRows.push(x ? { key: `g:${x.grp}`, label: x.grp, balance: bal, folder: f.id, matched: true } : { key: `p:${h.provider ?? '?'}`, label: h.provider ?? 'גוף לא ידוע', balance: bal, folder: f.id, matched: false });
      pRows.push({ key: x ? x.prod : h.typeHe, label: x ? x.prod : h.typeHe, balance: bal, folder: f.id, matched: !!x });
    }
    if (!x && (bal > 0 || (h.monthly ?? 0) > 0)) out.unmatched.items.push(item(f, i, h, 'לא הותאם למסלול שפורסם: בלי השוואה לממוצע, למאזן האקטוארי ולמכרז', bal || null));
    // actuarial balance, pension tracks, the last published quarter
    if (x && x.fam === 'pensia' && bal > 0) {
      const last = x.act_h?.length ? x.act_h[x.act_h.length - 1] : x.act != null && x.act_p ? [x.act_p, x.act] as [number, number] : null;
      if (last) {
        out.act.base += bal;
        out.act.asof = Math.max(out.act.asof ?? 0, last[0]);
        if (last[1] < 0) { out.act.neg += bal; out.act.items.push(item(f, i, h, `מאזן אקטוארי ${pc(last[1], 2)} ברבעון ${String(last[0]).slice(4)}/${String(last[0]).slice(0, 4)} · ${x.name}`, bal)); }
      }
    }
    // own fee from savings against the category median of the published average fees
    if (x && bal > 0 && h.fee != null) {
      const m = meds.get(catKey(x));
      if (!m || m.fee == null || m.n < 3) out.fee.noCat++;
      else {
        out.fee.base += bal;
        if (h.fee > m.fee + 0.005) {
          const gap = ((h.fee - m.fee) / 100) * bal;
          out.fee.above += bal; out.fee.gap += gap;
          out.fee.items.push(item(f, i, h, `דמי ניהול מצבירה ${pc(h.fee, 2)} מול חציון ${pc(m.fee, 2)} ב"${catKey(x)}" (${m.n} מסלולים): ${ils(gap)} בשנה`, gap));
        }
      }
    }
    // default-fund tender price
    const hits = tenderHits(h, ts);
    if (hits.length) {
      const pick = hits.find((t) => t.byFee) ?? null;
      const cands = pick ? [pick] : hits;
      const soon = cands.filter((t) => t.end && t.end[0] <= horizon && t.end[1] >= today);
      if (cands.every((t) => !t.end)) out.dflt.unknown++;
      for (const t of soon.slice(0, 1)) {
        const p = priceOf(t.t, t.w);
        out.dflt.items.push(item(f, i, h, `${pick ? 'דמי הניהול בקובץ שווים למחיר' : 'הקרן זכתה'} במכרז ברירת המחדל ${t.t.id} (${pc(p.depfee, 2)} מהפקדה, ${pc(p.fee, 2)} מצבירה). המחיר מובטח ${t.t.fee_years} שנים מההצטרפות; למי שהצטרף ${dmy(t.t.from)}–${dmy(t.t.to)} הוא מסתיים ${dmy(t.end![0])}–${dmy(t.end![1])}${pick ? '' : '. מועד ההצטרפות אינו בקובץ ודמי הניהול בו אינם מחיר המכרז: אפשרי בלבד'}`, bal || null));
      }
    }
    // closed generation / guaranteed coefficient
    const old = x ? isOldGen(x) : false;
    if (h.coefGuaranteed || old) {
      const cg = h.coefGuaranteed;
      out.coef.items.push(item(f, i, h, [old ? `דור סגור: ${x!.prod}` : null, cg ? `מקדם קצבה מובטח ${cg.v}${cg.at ? ` (גיל ${cg.at})` : ''}, ${cg.src === 'agent' ? 'הוקלד על ידי הסוכן' : 'מהקובץ'}` : 'מקדם מובטח לא צוין בקובץ'].filter(Boolean).join(' · '), bal || null));
    }
  }
  out.byGroup = slices(gRows, out.balance > 0 ? gRows.reduce((t, r) => t + r.balance, 0) : 0);
  out.byProduct = slices(pRows, out.balance > 0 ? pRows.reduce((t, r) => t + r.balance, 0) : 0);
  out.top = out.byGroup[0] ?? null;
  out.hhi = out.byGroup.length ? Math.round(out.byGroup.reduce((t, s) => t + s.share * s.share, 0)) : null;
  out.act.share = out.act.base > 0 ? (out.act.neg / out.act.base) * 100 : null;
  out.fee.share = out.fee.base > 0 ? (out.fee.above / out.fee.base) * 100 : null;
  const by = (a: BookItem, b: BookItem) => (b.amount ?? 0) - (a.amount ?? 0) || a.label.localeCompare(b.label, 'he');
  [out.act.items, out.fee.items, out.dflt.items, out.coef.items, out.unmatched.items].forEach((l) => l.sort(by));
  const L = (id: string, title: string, value: string, sub: string, items: BookItem[]): BookLine => ({ id, title, value, sub, items, folders: nFolders(items) });
  out.lines = [
    L('act', 'יתרות פנסיה במסלולים עם מאזן אקטוארי שלילי', out.act.share == null ? '–' : `${pc(out.act.share)} · ${ils(out.act.neg)}`,
      out.act.base ? `מתוך ${ils(out.act.base)} יתרות בקרנות פנסיה שפורסם להן מאזן אקטוארי; הרבעון האחרון שפורסם לכל מסלול` : 'אין בתיקים יתרות בקרנות פנסיה מותאמות', out.act.items),
    L('fee', 'משלמים דמי ניהול מצבירה מעל חציון הקטגוריה', out.fee.share == null ? '–' : `${pc(out.fee.share)} מהיתרות · ${ils(out.fee.gap)} בשנה`,
      `דמי הניהול של הלקוח בקובץ מול החציון של הממוצע שפורסם למסלולי אותה קטגוריה (מוצר | מסלול, 3 מסלולים לפחות); ₪ בשנה = ההפרש × היתרה${out.fee.noCat ? `; ${out.fee.noCat} מוצרים בקטגוריה קטנה מדי` : ''}`, out.fee.items),
    L('dflt', 'מחיר מכרז ברירת מחדל שעשוי להסתיים בתוך 12 חודשים', nProd(out.dflt.items.length),
      `לפי תקופות המכרזים ב-default.json: המחיר מובטח מספר שנים מההצטרפות${out.dflt.unknown ? `; ${out.dflt.unknown} מוצרים במכרז שתקופת המחיר שלו לא פורסמה` : ''}`, out.dflt.items),
    L('coef', 'דור סגור או מקדם קצבה מובטח', nProd(out.coef.items.length), 'ביטוח מנהלים שנמכר 1990–2003, או מקדם מובטח שבקובץ או שהסוכן הקליד: ניוד מוותר עליו', out.coef.items),
    L('unmatched', 'מוצרים שלא הותאמו למסלול שפורסם', nProd(out.unmatched.items.length), 'לא נכללים בבדיקות שלמעלה; ההתאמה נעשית בייבוא', out.unmatched.items),
  ];
  return out;
}

/** a one-line description of the concentration, never a verdict */
export const hhiText = (hhi: number | null, n: number) => hhi == null ? '–' : `HHI ${hhi.toLocaleString('en-US')} (סכום ריבועי הנתחים באחוזים; 10,000 = גוף אחד, ${n ? `${Math.round(10000 / n).toLocaleString('en-US')} = ${n} גופים בחלקים שווים` : ''})`;

/** the products behind one exposure row (`axis` 'g' = manager group, 'p' = product), largest balance first */
export function sliceItems(folders: Folder[], funds: FundX[], axis: 'g' | 'p', key: string): BookItem[] {
  const byK = new Map(funds.map((f) => [f.k, f]));
  const out: BookItem[] = [];
  for (const f of folders) f.held.forEach((h, i) => {
    const x = h.k ? byK.get(h.k) ?? null : null, bal = h.balance ?? 0;
    if (bal <= 0) return;
    const k = axis === 'g' ? (x ? `g:${x.grp}` : `p:${h.provider ?? '?'}`) : x ? x.prod : h.typeHe;
    if (k === key) out.push({ folder: f.id, label: f.label, held: i, what: nameOf(h), detail: x ? x.name : 'לא הותאם למסלול שפורסם', amount: bal });
  });
  return out.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || a.label.localeCompare(b.label, 'he'));
}
