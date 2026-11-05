/* fox 3.0 phase 2 · A2, the new-client wizard (/clients/new): from the client's clearing-house file to a signed הנמקה document in
   three steps, one flow. Pure: no React, no storage, so tests/agentDesk.unit.ts runs it in node.
     1 import    the files read in the browser (lib/clientRead), every product kept, matched or not (lib/clients folderFromImport)
     2 ניוד      the agent picks candidate tracks; the before/after (lib/nyud) per product, with the "why" lines below, each sourced
     3 הנמקה     the folder saved with the candidates tagged "מומלץ", a snapshot of the figures, the meeting date and the doc settings,
                 then the client document (pages/FundsComparePrint) opens on it and prints to PDF
   Nothing here recommends a track: the candidate list is every open track of the product, the agent's pick decides. */
import type { Folder, FolderIn, Held, SnapRow, Tag } from './clients';
import { catKey, selfDirected, type FundX } from './funds';
import { familyOf, ilsSigned, type NyudRow } from './nyud';
import { companyOf, segOf, srcOf, svcOf, SEG_HE, SELF_REPORT, type DecisionFile } from './decision';
import { defaultKeys } from './pensionPack';
import type { DefaultFile } from './fundsTools';
import { MEET_KEY } from './agentDesk';

export const WIZ_STEPS = ['ייבוא הקובץ', 'ניוד: לפני ואחרי', 'מסמך הנמקה'] as const;
export const MAX_CANDS = 3, MAX_KEYS = 8;
/** the folder fields the wizard writes (lib/clients `fields`, saved in this browser only) */
export const F = { age: 'nyud:age', sex: 'nyud:sex', kind: 'doc:kind', client: 'doc:client', meet: MEET_KEY, wizAt: 'wiz:at', wizMs: 'wiz:ms' } as const;

/** the products a candidate may be for an existing product's family (a transfer stays within the family: lib/nyud familyOf) */
export const FAMILY_PRODS: Record<'kitzba' | 'hish' | 'invest', string[]> = {
  kitzba: ['פנסיה מקיפה', 'פנסיה כללית', 'גמל', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)'],
  hish: ['השתלמות'],
  invest: ['גמל להשקעה'],
};
/** the product a candidate list opens on, for one existing product: its own track's product when it is open to new money, else the
 *  family's first (an old managers' policy or a pension fund not in the data open on "פנסיה מקיפה") */
export function prodFor(h: Pick<Held, 'k' | 'typeHe'>, byK: Map<string, FundX>): string | null {
  const x = h.k ? byK.get(h.k) : undefined;
  const fam = familyOf(x ? x.prod : h.typeHe);
  if (fam === 'other') return null;
  const list = FAMILY_PRODS[fam];
  if (x && list.includes(x.prod)) return x.prod;
  if (/פנסיה כללית/.test(h.typeHe)) return 'פנסיה כללית';
  if (/גמל/.test(h.typeHe) && fam === 'kitzba') return 'גמל';
  return list[0];
}
/** the products the step-2 picker offers for this folder: the families of the products with money in them */
export function prodsFor(held: Held[], byK: Map<string, FundX>): string[] {
  const out: string[] = [];
  for (const h of held) {
    if (h.balance == null && h.monthly == null) continue;
    const x = h.k ? byK.get(h.k) : undefined, fam = familyOf(x ? x.prod : h.typeHe);
    if (fam === 'other') continue;
    const first = prodFor(h, byK);
    for (const p of [first, ...FAMILY_PRODS[fam]]) if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
export interface CandOpt { k: string; name: string; grp: string; prod: string; track: string; fee: number | null; depfee: number | null; a3: number | null; assets: number | null; dflt: boolean; same: boolean }
/** every open track of a product, for the picker: the existing products' own investment tracks first (same `track` name), then the
 *  default funds in force, then by assets; a search string filters by name. Closed, gone and self-directed tracks are left out. */
export function candOptions(funds: FundX[], prod: string, held: Held[], dfile: DefaultFile | null | undefined, asof: number, q = '', limit = 60): CandOpt[] {
  const byK = new Map(funds.map((f) => [f.k, f]));
  const own = new Set(held.map((h) => (h.k ? byK.get(h.k) : undefined)).filter((x): x is FundX => !!x && x.prod === prod).map((x) => x.track));
  const dk = defaultKeys(dfile, asof);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return funds.filter((f) => f.prod === prod && !f.closed && !f.gone && !selfDirected(f) && (f.assets ?? 0) > 0 && words.every((w) => f.name.toLowerCase().includes(w)))
    .map((f): CandOpt => ({ k: f.k, name: f.name, grp: f.grp, prod: f.prod, track: f.track, fee: f.fee ?? null, depfee: f.depfee ?? null, a3: f.net?.a3 ?? null, assets: f.assets ?? null, dflt: dk.has(f.k), same: own.has(f.track) }))
    .sort((a, b) => Number(b.same) - Number(a.same) || Number(b.dflt) - Number(a.dflt) || (b.assets ?? 0) - (a.assets ?? 0))
    .slice(0, limit);
}

/** The folder the wizard saves: the candidates tagged "מומלץ" first in the keys (so they always fit), then the existing tracks tagged
 *  "קיים" (the largest balances first, up to 8 keys in all). A product whose track does not fit stays in `held` and is listed in the
 *  document as an existing product from the file (lib/clients heldForDoc): nothing imported is dropped. */
export function wizardKeys(f: Pick<Folder, 'keys' | 'tags' | 'held'>, cands: string[]): { keys: string[]; tags: Record<string, Tag> } {
  const cs = [...new Set(cands)].slice(0, MAX_CANDS);
  const by = new Map<string, number>();
  f.held.forEach((h) => { if (h.k && !cs.includes(h.k)) by.set(h.k, (by.get(h.k) ?? 0) + (h.balance ?? 0)); });
  const exist = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, MAX_KEYS - cs.length);
  const keys = [...exist, ...cs];
  return { keys, tags: Object.fromEntries([...exist.map((k) => [k, 'קיים' as Tag]), ...cs.map((k) => [k, 'מומלץ' as Tag])]) };
}
/** the save of step 3: keys and tags, the snapshot, and the fields (the doc kind, the client's name for the document, the meeting
 *  date, the age and sex the ניוד table used, the time the flow took); fields the agent typed before are kept */
export function wizardSave(f: Folder, cands: string[], opts: { snap: Folder['snap']; kind: string; client: string; meet: string; age: number | null; sex: 'm' | 'f' | null; ms: number | null; today: string; why?: Record<string, string> }): FolderIn {
  const { keys, tags } = wizardKeys(f, cands);
  const fields: Record<string, string> = { ...f.fields };
  const set = (k: string, v: string | null | undefined) => { if (v && v.trim()) fields[k] = v.trim(); else delete fields[k]; };
  set(F.kind, opts.kind); set(F.client, opts.client); set(F.meet, opts.meet); set(F.age, opts.age != null ? String(opts.age) : null); set(F.sex, opts.sex);
  set(F.wizAt, opts.today); if (opts.ms != null) set(F.wizMs, String(Math.round(opts.ms)));
  // the "why" lines prefill the main-considerations field of each candidate only where the agent has typed nothing yet
  for (const [k, v] of Object.entries(opts.why ?? {})) if (!fields[`a1:${k}:why`]) set(`a1:${k}:why`, v);
  return { id: f.id, label: f.label, keys, b: 'net', tags, fields, snap: opts.snap ?? null };
}

/* ---------- the "why" lines of a before/after pair, each with its source ---------- */
export interface Why { text: string; src: string }
const pc = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${v.toFixed(d)}%`);
const ils = (v: number) => `₪${Math.round(v).toLocaleString('en-US')}`;
/** the service index and the disability claims of the two companies, as published, with their sources */
export function svcClaims(dec: DecisionFile | null | undefined, a: { grp: string; fam?: string; prod?: string } | null, b: { grp: string; fam?: string; prod?: string }): Why[] {
  if (!dec) return [];
  const out: Why[] = [];
  const seg = segOf(b);
  if (seg) {
    const ra = a ? svcOf(dec, a.grp, segOf(a) ?? seg) : null, rb = svcOf(dec, b.grp, seg);
    if (ra || rb) {
      const s = srcOf(dec, (rb ?? ra)!.src);
      out.push({ text: `מדד השירות (${SEG_HE[seg]}, ${(rb ?? ra)!.year}): ${a ? `${a.grp} ${ra ? `${ra.total}, מקום ${ra.rank} מתוך ${ra.of}` : 'לא במדד'} ← ` : ''}${b.grp} ${rb ? `${rb.total}, מקום ${rb.rank} מתוך ${rb.of}` : 'לא במדד'}`,
        src: `${s?.title ?? 'רשות שוק ההון, מדד השירות'}, עמ' ${(rb ?? ra)!.pg}` });
    }
  }
  if (seg === 'pension') {
    const ca = a ? companyOf(dec, a.grp)?.claims : null, cb = companyOf(dec, b.grp)?.claims;
    if (ca || cb) {
      const s = srcOf(dec, (cb ?? ca)!.src);
      out.push({ text: `תביעות נכות שאושרו (שולמו ושולמו חלקית, ${(cb ?? ca)!.year}): ${a ? `${a.grp} ${ca?.disability.approved != null ? pc(ca.disability.approved, 1) : 'לא פורסם'} ← ` : ''}${b.grp} ${cb?.disability.approved != null ? pc(cb.disability.approved, 1) : 'לא פורסם'}`,
        src: `${SELF_REPORT}, נספח ב3 לחוזר איסוף מידע סטטיסטי${s ? `: ${s.title}` : ''}${(cb ?? ca)!.pg != null ? `, עמ' ${(cb ?? ca)!.pg}` : ''}; לא נבדק על ידי הרשות` });
    }
  }
  return out;
}
/** the lines under one before/after pair: fees in ₪ to retirement, this year's fee cost, the cover cost, the guaranteed coefficient,
 *  the liquidity clock, and the service and claims of the two companies. Descriptions of arithmetic on stated figures. */
export function whyLines(r: NyudRow, exist: FundX | null | undefined, cand: FundX | null | undefined, dec: DecisionFile | null | undefined, asofText: string): Why[] {
  const out: Why[] = [];
  const f = r.fee;
  if (f) {
    out.push({ text: `דמי ניהול: ${pc(f.own.pair.depfee)} מהפקדה / ${pc(f.own.pair.fee)} מצבירה ← ${pc(f.cand.pair.depfee)} / ${pc(f.cand.pair.fee)}; ${ils(f.annualOwn)} ← ${ils(f.annualCand)} בשנה על היתרה וההפקדה של היום`,
      src: `${f.own.how}; ${f.cand.how} (${asofText})` });
    out.push({ text: `חיסכון צפוי בגיל הפרישה, מדמי הניהול בלבד: ${ils(f.balOwn)} ← ${ils(f.balCand)} (${ilsSigned(f.balRealDiff)}, ${Math.round(f.years)} שנים)`,
      src: 'חישוב האתר (lib/nyud, lib/retire) על היתרה וההפקדה מקובץ המסלקה, בשקלים של היום; תשואה זהה לשני הצדדים' });
  } else if (r.feeWhy) out.push({ text: `דמי ניהול: ${r.feeWhy}`, src: 'קובץ המסלקה; הרשות' });
  if (r.cover.diff != null) out.push({ text: `כיסוי נכות ושאירים: ${ils(r.cover.exist!)} ← ${ils(r.cover.cand!)} לחודש (${ilsSigned(r.cover.diff)})`, src: 'העלות החודשית בקובץ המסלקה, בשני הצדדים' });
  else out.push({ text: `כיסוי נכות ושאירים: ${r.cover.exist != null ? `${ils(r.cover.exist)} לחודש היום; ` : ''}${r.cover.why ?? ''}`, src: r.cover.exist != null ? 'קובץ המסלקה' : 'מאגרי הרשות אינם כוללים את מחיר הכיסוי ללקוח' });
  if (r.coef) out.push({ text: `מקדם מובטח שאובד: ${r.coef.text}`, src: r.coef.cand.real ? `קובץ המסלקה; תקנון ${r.cand.grp} (funds/coef.json)` : 'קובץ המסלקה; הנחת האתר למקדם (אין תקנון קרוא לקרן)' });
  else if (r.coefWhy) out.push({ text: r.coefWhy, src: 'קובץ המסלקה' });
  if (r.seniority) out.push({ text: `נזילות: ${r.seniority.text}`, src: r.seniority.src });
  out.push(...svcClaims(dec, exist ? { grp: exist.grp, fam: exist.fam, prod: exist.prod } : null, cand ? { grp: cand.grp, fam: cand.fam, prod: cand.prod } : { grp: r.cand.grp, prod: r.cand.prod }));
  return out;
}
/** the main-considerations text prefilled for a candidate (the agent edits it in the document): the pair's lines, one per line */
export const whyText = (lines: Why[]) => lines.map((w) => w.text).join('\n').slice(0, 3800);

/** the rows the document will show for a folder's keys (today's, built by the caller with lib/compareDoc docRow) */
export type RowsOf = (keys: string[]) => SnapRow[];

/* ---------- the clock: the agent's own times, kept in this browser ---------- */
export const TIMES_KEY = 'agent:wizard:times';
export const fmtDur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const medianMs = (xs: number[]) => { const s = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
export const pushTime = (xs: unknown, ms: number) => [...(Array.isArray(xs) ? xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0) : []), Math.round(ms)].slice(-20);

/** the category of a candidate, for the why lines and the picker's group label */
export const catOf = (f: Pick<FundX, 'prod' | 'track'>) => catKey(f);
