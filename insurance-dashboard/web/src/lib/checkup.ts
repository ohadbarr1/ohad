/* S1 + S2 saver (fox 3.0 plan, 05.11.26) · "הבדיקה השנתית": the annual check-up of /my/checkup in three red / amber / green lines, each
   with its anchor and its source, and the negotiation loop that follows it (the letter, the 30-day reminder, the saving). Pure: no React,
   no fetch, no storage, so tests/checkup.unit.ts runs it in node. It arranges the site's existing engines and adds no new model:
   lib/myCalc `cardCalc` (the card's fee arithmetic, so /my and the check-up never disagree), lib/deposits `auditDeposits` (the deposit
   watchdog), lib/coef AGE_TRACKS and funds/glide.json (the age tracks). Descriptive, never advice: it says where a number stands against
   a stated anchor and drafts a request; it never says "move" or "stay".

   The anchor hierarchy for the fee line, one rule for every product (stated on the page; the same order as lib/myCalc gapOf and the
   report card's verdict, so the two cannot contradict each other):
     1. The reader's OWN fees on a comprehensive pension fund → the default-fund tender price in force (funds/default.json): the price
        any member can get by joining through it, both parts, and the pair of the tender's conversion table that leaves the most money
        on the reader's balance and deposit (CardCalc.tBest).
     2. The reader's own fees on any other product (השתלמות, גמל, general pension, policies) → the median of the averages actually paid
        in the category (רשות שוק ההון, גמל-נט / פנסיה-נט / ביטוח-נט), with the cheapest quarter as the figure to ask for and the legal
        ceiling as the upper bound. A השתלמות is read at its 6-year liquidity horizon.
     3. No own fees entered → amber: the line computes on the track's average (labelled) and asks for the statement's figure.
   The track's own average actually paid is shown with every line as context only ("ממוצע, לא מחיר"): it is never the anchor of the
   reader's own fee (red team 3, 02.11.26: an own fee read against the others' averages contradicted the verdict).
   Red: the reader's fees cost at least MIN_GAP ₪ (today's money) by the horizon against the anchor. Amber: the figure is unknown (no
   own fees), or the report card calls a part of the fee above its anchor while the ₪ gap stays under MIN_GAP (so the check-up is never
   green where the card says "above"). Green: neither. */
import type { FeePair } from './fundsCalc';
import type { CardCalc } from './myCalc';
import type { VFund } from './verdict';
import type { DepositRow } from './clientTypes';
import type { Tender } from './fundsTools';
import type { GlideData } from './fundsTime';
import { capOf } from './feeCaps';
import { feeGap, project, type Plan } from './retire';
import { addMonths, auditDeposits, defaultRates, kindOf, validYm, type Audit, type DepKind, type Rates } from './deposits';
import { AGE_TRACKS } from './coef';

export type Tone = 'red' | 'amber' | 'green';
const RANK: Record<Tone, number> = { green: 0, amber: 1, red: 2 };
export const worst = (ts: Tone[]): Tone => ts.reduce<Tone>((w, t) => (RANK[t] > RANK[w] ? t : w), 'green');
/** a fee gap below this (₪, today's money, by the horizon) is too small to call: green */
export const MIN_GAP = 1000;

/** the parts of a saved product the check-up reads (lib/mine MyProduct) */
export interface CProd { k: string; balance?: number | null; monthly?: number | null; fee?: number | null; depfee?: number | null; deposits?: DepositRow[]; salary?: number | null; depRates?: Rates | null; imp?: string }
/** one product: the regulator's row, the reader's saved figures and the card's arithmetic */
export interface CRow { f: VFund; m: CProd; c: CardCalc }

/* ======================= line 1: fees ======================= */
export type Anchor = 'tender' | 'avg';
export interface FeeRow {
  k: string; name: string; prod: string; track: string; tone: Tone;
  /** what the reader's fees are read against (the hierarchy above); `own`: the reader's own fees (from the statement or the file) */
  anchor: Anchor; own: boolean;
  mine: FeePair;
  /** the anchor pair: the tender pair that leaves the most money (tender), or the category median pair (avg; 0% from deposits when the
   *  category publishes none) */
  ref: FeePair | null;
  /** the figure a letter asks for: the tender's base price (tender) or the cheapest quarter of the averages (avg) */
  ask: FeePair | null;
  /** ₪ in today's money at the horizon: positive = the reader ends with less than at the anchor */
  gap: number | null; years: number; horizon: 'retire' | 'liq';
  /** the balance or the deposit is an example (not entered) */
  ex: boolean;
  /** context, never the anchor: the track's own averages actually paid (the regulator's AVG_ANNUAL_MANAGEMENT_FEE / AVG_DEPOSIT_FEE) */
  avg: { fee: number | null; depfee: number | null };
  med: number | null; depMed: number | null; q1: number | null;
  cap: { fee: number; depfee: number } | null;
  tender: Tender | null;
  /** the part of an own pension fee above the tender's base price */
  lever: 'fee' | 'dep' | 'both' | null;
}

export function feeRow(r: CRow): FeeRow {
  const { f, c } = r, v = c.v;
  const tenderBasis = v.fee.basis === 'tender' || v.dep?.basis === 'tender';
  const own = c.ownAny;
  const cap = capOf(f.prod);
  const base = v.dflt && v.dflt.fee != null && v.dflt.depfee != null ? { fee: v.dflt.fee, depfee: v.dflt.depfee } : null;
  const ex = c.exBalance || c.exMonthly;
  const common = { k: f.k, name: f.name, prod: f.prod, track: f.track, own, mine: c.mine, ex, avg: { fee: f.fee, depfee: f.depfee },
    med: v.fee.med, depMed: v.dep?.med ?? null, q1: v.fee.q1, cap: cap.legal ? { fee: cap.fee, depfee: cap.depfee } : null, tender: v.dflt?.tender ?? null, lever: v.lever };
  if (own && tenderBasis && c.tBest) {
    // above the tender's terms only when an allowed pair is no higher on both parts (the verdict's `above`); a part above the base
    // price on a pair the tender allows (a row of its conversion table) is the verdict's `lever`: amber. At the price: green, no gap,
    // even when another row of the table would leave more on the reader's amounts (that is a choice of mix, not an overcharge).
    const above = !!v.dflt?.above, g = c.tBest.g.balReal;
    const tone: Tone = above ? (g >= MIN_GAP ? 'red' : 'amber') : v.lever ? 'amber' : 'green';
    return { ...common, tone, anchor: 'tender', ref: c.tBest.p, ask: base, gap: above || v.lever ? g : null, years: c.tBest.g.years, horizon: 'retire' };
  }
  const liq = c.liq;
  const g = liq ? liq.gMed : c.gMed;
  const gap = g ? g.balReal : null;
  const askFee = v.fee.q1 != null && v.fee.q1 < c.mine.fee - 0.005 ? v.fee.q1 : v.fee.med;
  const ask = c.med && askFee != null ? { fee: Math.min(askFee, c.mine.fee), depfee: Math.min(c.med.depfee, c.mine.depfee) } : null;
  const above = v.fee.word === 'high' || (v.dep?.own && v.dep.word === 'high' && !v.dep.quiet);
  const tone: Tone = !own ? 'amber' : gap != null && gap >= MIN_GAP ? 'red' : above ? 'amber' : 'green';
  return { ...common, tone, anchor: 'avg', ref: c.med, ask, gap, years: g ? g.years : liq ? liq.years : c.plan.retire - c.plan.age, horizon: liq ? 'liq' : 'retire' };
}

export interface FeeLine { tone: Tone; rows: FeeRow[]; top: FeeRow | null; total: number }
/** the fee line across the products: the worst tone; `top`: the product to act on first (the largest red gap, else amber, else the
 *  first); `total`: the red gaps added up (₪ today's money; each at its own horizon) */
export function feeLine(rows: CRow[]): FeeLine | null {
  if (!rows.length) return null;
  const fr = rows.map(feeRow);
  const by = (t: Tone) => fr.filter((x) => x.tone === t).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0))[0];
  const top = by('red') ?? by('amber') ?? fr[0];
  return { tone: worst(fr.map((x) => x.tone)), rows: fr, top, total: fr.filter((x) => x.tone === 'red').reduce((s, x) => s + (x.gap ?? 0), 0) };
}

/* ======================= line 2: deposits ======================= */
/** The months the check-up reads: from the first to the last salary month the rows carry, at most the last 12. A month before the
 *  first row is not "missing": the file (or the table the reader typed) may simply start later (a new job, a file of this year only);
 *  only a gap between rows is a month with no deposit. */
export function depWindow(rows: DepositRow[], max = 12): string[] {
  const yms = [...new Set(rows.map((r) => r?.ym).filter(validYm))].sort();
  if (!yms.length) return [];
  const toN = (ym: string) => +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1;
  const a = Math.max(toN(yms[0]), toN(yms[yms.length - 1]) - (max - 1)), b = toN(yms[yms.length - 1]);
  return Array.from({ length: b - a + 1 }, (_, i) => { const t = a + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; });
}
export type DepWhy = 'nodata' | 'nosalary' | 'inactive' | null;
export interface DepRowOut { k: string; name: string; prod: string; id?: number; kind: DepKind; tone: Tone; why: DepWhy; audit: Audit | null; salary: number | null; rates: Rates; months: string[];
  /** months left out of the audit because the file dates the next row by its payment, not its salary month (see below) */
  unsure: string[]; last: string | null }
/** a deposit row is dated by when it was paid, not by the salary month it is for, when the clearing-house file gives no salary month
 *  (lib/maslaka readDeposits falls back to the value date's month): its payment date then falls inside its own `ym` */
export const payDated = (r: DepositRow) => typeof r.paid === 'string' && r.paid.slice(0, 7) === r.ym;
/** an account with no deposit in the INACTIVE months before the reference month has no current deposits to check (a frozen account) */
export const INACTIVE = 6;
/** One product's deposits: the watchdog over the rows' own window. Pension: a missing or short month is red (the extension order sets
 *  a minimum); השתלמות: amber (no statutory duty, the rates are the agreed ones); late only: amber. A month with no row right before a
 *  payment-dated row is not called missing: that row is most likely the deposit for it, paid the month after (a false alarm the
 *  fixtures show); it is listed as unsure and the line is at least amber. `nowYm`: the reference month ('YYYY-MM', the file's as-of or
 *  today). */
export function depRow(f: VFund, m: CProd, profileSalary: number | null, nowYm?: string): DepRowOut | null {
  const kind = kindOf(f.prod);
  if (!kind) return null;
  const rows = Array.isArray(m.deposits) ? m.deposits.filter((r) => r && validYm(r.ym)) : [];
  const rates = m.depRates ?? defaultRates(kind);
  const rowSal = rows.map((r) => r.salary).filter((x): x is number => x != null && x > 0).pop() ?? null;
  const salary = m.salary ?? profileSalary ?? rowSal;
  const win = depWindow(rows);
  const last = win.length ? win[win.length - 1] : null;
  const base = { k: f.k, name: f.name, prod: f.prod, id: f.id, kind, rates, salary, last };
  if (!rows.length) return { ...base, months: [], unsure: [], tone: 'amber', why: 'nodata', audit: null };
  if (nowYm && validYm(nowYm) && last && last < addMonths(nowYm, -INACTIVE)) return { ...base, months: win, unsure: [], tone: 'green', why: 'inactive', audit: null };
  if (!salary) return { ...base, months: win, unsure: [], tone: 'amber', why: 'nosalary', audit: null };
  const has = new Set(rows.map((r) => r.ym));
  const unsure = win.filter((ym) => !has.has(ym) && rows.some((r) => r.ym === addMonths(ym, 1) && payDated(r)));
  const months = win.filter((ym) => !unsure.includes(ym));
  const audit = auditDeposits(rows, salary, rates, kind, { months });
  const gapN = audit.missing.length + audit.short.length;
  const tone: Tone = gapN ? (kind === 'pension' ? 'red' : 'amber') : audit.late.length || unsure.length ? 'amber' : 'green';
  return { ...base, months, unsure, tone, why: null, audit };
}
export interface DepLine { tone: Tone; rows: DepRowOut[]; total: number }
export function depLine(rows: CRow[], profileSalary: number | null, nowYm?: string): DepLine | null {
  const out = rows.map((r) => depRow(r.f, r.m, profileSalary, r.m.imp && validYm(r.m.imp.slice(0, 7)) ? r.m.imp.slice(0, 7) : nowYm)).filter((x): x is DepRowOut => !!x);
  if (!out.length) return null;
  return { tone: worst(out.map((x) => x.tone)), rows: out, total: out.reduce((s, x) => s + (x.audit?.totalGap ?? 0), 0) };
}

/* ======================= line 3: age and track ======================= */
export type Band = 'עד 50' | '50-60' | '60 ומעלה';
export const bandOf = (age: number): Band => (age < 50 ? 'עד 50' : age < 60 ? '50-60' : '60 ומעלה');
/** a chosen track counts as far from the reader's age track when its equity exposure differs by this many percentage points or more
 *  (fox's threshold, not a rule of the regulator: about half the step between two age bands in funds/glide.json) */
export const ST_FAR = 15;
export type AgeKind = 'age-ok' | 'age-past' | 'age-edge' | 'age-young' | 'chosen-ok' | 'chosen-far';
export interface AgeRowOut {
  k: string; name: string; prod: string; track: string; tone: Tone; kind: AgeKind; age: number; band: Band;
  /** the track's equity exposure and the reference: the same manager's age track for the reader's band, else the median of that band */
  st: number | null; ref: number | null; refFrom: 'mgr' | 'med' | null; refK?: string; refName?: string;
}
/** the products that have age tracks (glide.json: comprehensive pension and gemel); null for any other product, for the pensioners'
 *  track, and for a chosen track with no equity figure to compare */
export function ageRow(f: VFund, age: number, glide: GlideData | null | undefined): AgeRowOut | null {
  const p = glide?.prods.find((x) => x.prod === f.prod);
  if (!p) return null;
  const band = bandOf(age);
  const own = AGE_TRACKS.find((b) => b.track === f.track);
  const g = p.groups.find((x) => x.grp === f.grp);
  const t = g?.tracks.find((x) => x.band === band);
  const ref = t?.st ?? p.med?.[band]?.st ?? null;
  const refFrom = t?.st != null ? 'mgr' as const : ref != null ? 'med' as const : null;
  const base = { k: f.k, name: f.name, prod: f.prod, track: f.track, age, band, st: f.st ?? null, ref, refFrom, refK: t?.k, refName: t?.name };
  if (own) {
    if (own.track === band) return { ...base, tone: 'green', kind: 'age-ok' };
    if (own.to != null && age >= own.to) return { ...base, tone: age === own.to ? 'amber' : 'red', kind: age === own.to ? 'age-edge' : 'age-past' };
    return { ...base, tone: 'amber', kind: 'age-young' };
  }
  if (/מקבלי קצבה/.test(f.track) || f.st == null || ref == null) return null;
  return { ...base, tone: Math.abs(f.st - ref) >= ST_FAR ? 'amber' : 'green', kind: Math.abs(f.st - ref) >= ST_FAR ? 'chosen-far' : 'chosen-ok' };
}
export interface AgeLine { tone: Tone; rows: AgeRowOut[] }
export function ageLine(rows: CRow[], age: number, glide: GlideData | null | undefined): AgeLine | null {
  const out = rows.map((r) => ageRow(r.f, age, glide)).filter((x): x is AgeRowOut => !!x);
  return out.length ? { tone: worst(out.map((x) => x.tone)), rows: out } : null;
}

export interface Checkup { fee: FeeLine | null; dep: DepLine | null; age: AgeLine | null }
export function checkupOf(rows: CRow[], o: { age: number; profileSalary: number | null; glide: GlideData | null | undefined; nowYm?: string }): Checkup {
  return { fee: feeLine(rows), dep: depLine(rows, o.profileSalary, o.nowYm), age: ageLine(rows, o.age, o.glide) };
}

/* ======================= S2: the letters ======================= */
const pc = (v: number | null | undefined) => (v == null ? '–' : `${(Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`);
const ils = (v: number) => { const a = Math.abs(v), r = a >= 100000 ? Math.round(a / 1000) * 1000 : a >= 10000 ? Math.round(a / 100) * 100 : Math.round(a / 10) * 10; return `${r.toLocaleString('en-US')} ש"ח`; };
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
export const CAPS_REG = 'תקנות הפיקוח על שירותים פיננסיים (קופות גמל) (דמי ניהול), התשע"ב-2012';

export interface LetterCtx {
  /** the fund's number (מספר קופה), when known */
  id?: number | null;
  /** the data set and month of the averages ("פנסיה-נט, 09/26") */
  src: string;
  /** the retirement age in words ("67", "64 ו-9 חודשים") */
  retire: string;
}
/** The fee letter to the agent or the managing company, first person (so it reads the same for anyone; no "חוסך/ת"): the reader's own
 *  fees, the anchor with its source, the track's average as context, the legal ceiling, the ₪ gap as an estimate, and the request.
 *  Facts and a request; no recommendation to move. */
export function feeLetter(r: FeeRow, x: LetterCtx): string {
  const out: string[] = ['שלום,'];
  out.push(`החיסכון שלי ב${r.name}${x.id ? ` (מספר קופה ${x.id})` : ''} מנוהל אצלכם. לפי ${r.own ? 'הדוח השנתי שלי' : 'נתוני הרשות'}, דמי הניהול ${r.own ? 'שלי' : 'הממוצעים במסלול'} הם ${pc(r.mine.fee)} מהצבירה ו-${pc(r.mine.depfee)} מכל הפקדה.`);
  if (r.anchor === 'tender' && r.tender && r.ask) {
    const t = r.tender;
    out.push(`בהליך קרנות ברירת המחדל של רשות שוק ההון (${t.label ?? `הליך ${t.id}`}, ${dmy(t.from)}–${dmy(t.to)}) נקבע מחיר של ${pc(r.ask.fee)} מהצבירה ו-${pc(r.ask.depfee)} מכל הפקדה למצטרפים דרך ברירת המחדל${t.fee_years ? `, ל-${t.fee_years} שנים` : ''}${t.fee_alt?.length ? ', עם טבלת המרה בין שני החלקים' : ''}.`);
  } else if (r.med != null) {
    out.push(`בקטגוריה (${r.prod}, ${r.track}) חציון הממוצע שמשלמים בפועל העמיתים הוא ${pc(r.med)} מהצבירה${r.q1 != null && r.q1 < r.med - 0.005 ? `, וברבע המסלולים הזולים עד ${pc(r.q1)}` : ''} (${x.src}).`);
  }
  if (r.avg.fee != null) out.push(`הממוצע שמשלמים בפועל העמיתים במסלול שלי: ${pc(r.avg.fee)} מהצבירה${r.avg.depfee != null ? ` ו-${pc(r.avg.depfee)} מהפקדה` : ''} (${x.src}).`);
  if (r.cap) out.push(`התקרה בחוק: ${pc(r.cap.fee)} מהצבירה ו-${pc(r.cap.depfee)} מהפקדה (${CAPS_REG}).`);
  const vs = r.ref ? (r.anchor === 'tender' ? `לעומת הצירוף מבין מחירי ההליך שמשאיר הכי הרבה כסף על הסכומים שלי (${pc(r.ref.fee)} מהצבירה ו-${pc(r.ref.depfee)} מהפקדה)` : `לעומת החציון בקטגוריה`) : '';
  if (r.gap != null && r.gap >= MIN_GAP) out.push(`לפי חישוב על ${r.ex ? 'סכומים לדוגמה' : 'היתרה וההפקדה שלי'}${vs ? `, ${vs}` : ''}, ההפרש מסתכם בכ-${ils(r.gap)} ${r.horizon === 'liq' ? `בעוד ${r.years} שנים` : `עד גיל ${x.retire}`} (אומדן, בשקלי היום).`);
  if (r.ask) out.push(r.anchor === 'tender'
    ? `אבקש להפחית את דמי הניהול שלי ל-${pc(r.ask.fee)} מהצבירה ו-${pc(r.ask.depfee)} מהפקדה, או לצירוף שווה ערך מטבלת ההמרה של ההליך, ולשלוח לי אישור בכתב.`
    : `אבקש להפחית את דמי הניהול שלי ל-${pc(r.ask.fee)} מהצבירה${r.ask.depfee < r.mine.depfee - 0.005 ? ` ו-${pc(r.ask.depfee)} מהפקדה` : ''}, ולשלוח לי אישור בכתב.`);
  out.push('תודה,');
  return out.join('\n');
}
/** the same request in three lines, for a WhatsApp message */
export function feeShort(r: FeeRow): string {
  const a = r.ask;
  const anchor = r.anchor === 'tender' && a ? `בקרנות ברירת המחדל המחיר ${pc(a.fee)} מהצבירה ו-${pc(a.depfee)} מהפקדה.` : r.med != null ? `חציון הממוצע בפועל בקטגוריה: ${pc(r.med)} מהצבירה.` : '';
  return [`שלום, דמי הניהול שלי ב${r.name}: ${pc(r.mine.fee)} מהצבירה ו-${pc(r.mine.depfee)} מהפקדה.`, anchor, a ? `אבקש להפחית ל-${pc(a.fee)} מהצבירה${r.anchor === 'tender' || a.depfee < r.mine.depfee - 0.005 ? ` ו-${pc(a.depfee)} מהפקדה` : ''}. תודה.` : 'אבקש הצעה מעודכנת. תודה.'].filter(Boolean).join('\n');
}
/** a WhatsApp share link (no recipient: the reader picks one) and a mail draft (no address: the reader fills it) */
export const waHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const mailHref = (subject: string, body: string) => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** A one-line message to the fund when the track does not fit the age (line 3): a question, not a request to move. */
export function ageAsk(a: AgeRowOut): string {
  if (a.kind === 'age-past' || a.kind === 'age-edge') return `שלום, לפי הדוח החיסכון שלי ב${a.name} נמצא במסלול "${a.track}", ואני בגיל ${a.age}. האם הכסף יועבר למסלול "${a.band}" לפי המודל התלוי גיל, ומתי? תודה.`;
  if (a.kind === 'age-young') return `שלום, לפי הדוח החיסכון שלי ב${a.name} נמצא במסלול "${a.track}", ואני בגיל ${a.age}. האם המסלול נבחר על ידי, ומה המסלול התלוי גיל שמתאים לגיל שלי? תודה.`;
  return `שלום, החיסכון שלי ב${a.name} נמצא במסלול "${a.track}" עם חשיפה של כ-${pc(a.st)} למניות, ובמסלול הגיל "${a.band}" החשיפה כ-${pc(a.ref)}. אשמח לדעת מתי נבחר המסלול ואיך עוברים בין מסלולים אם ארצה. תודה.`;
}

/* ======================= S2: the reminder and the saving ======================= */
/** a negotiation the reader started: the product, the day, the fees before; `after` once the new fees are entered */
export interface Nego { k: string; at: string; before: FeePair; after?: FeePair | null; done?: string | null }
export const REMIND_DAYS = 30;
const DAY = 86400000;
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(`${iso}T12:00:00`) + n * DAY));
export const dueOf = (n: Nego) => addDays(n.at, REMIND_DAYS);
/** the open negotiations whose 30 days are up (no new fees entered yet) */
export const dueNegos = (list: Nego[], today: string) => list.filter((n) => n && !n.after && typeof n.at === 'string' && dueOf(n) <= today);
export const normNegos = (x: unknown): Nego[] => (Array.isArray(x) ? x.filter((n): n is Nego => !!n && typeof n.k === 'string' && typeof n.at === 'string' && !!n.before && Number.isFinite(n.before.fee) && Number.isFinite(n.before.depfee)) : []);
/** Start (or restart) the negotiation of a product: one open record per product. */
export function startNego(list: Nego[], k: string, before: FeePair, today: string): Nego[] {
  return [...list.filter((n) => n.k !== k), { k, at: today, before, after: null }];
}

/** What the new fees are worth by the horizon: the plan run on the old fees and on the new ones, today's ₪ (positive = more money with
 *  the new fees). The plan is the card's (the reader's balance, deposit, age and retirement age; the stated return and inflation). */
export function savingOf(plan: Plan, before: FeePair, after: FeePair): number {
  return feeGap(plan, before, after).balReal;
}
/** this year's fees on the old and the new pair, ₪ */
export function yearSaving(plan: Plan, before: FeePair, after: FeePair): number {
  const y = (f: FeePair) => plan.balance * f.fee / 100 + plan.monthly * 12 * f.depfee / 100;
  return y(before) - y(after);
}
export { project };

/** The 30-day reminder as a calendar file: one all-day event, a 09:00 alert, the page's address. No figure and no name in it. */
export function icsOf(due: string, url: string, stamp: Date = new Date()): string {
  const d = due.replace(/-/g, ''), d2 = addDays(due, 1).replace(/-/g, '');
  const ts = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fox//checkup//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:fox-checkup-${d}-${Math.random().toString(36).slice(2, 10)}@fox-research-il.web.app`, `DTSTAMP:${ts}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`,
    `SUMMARY:${esc('fox · מה דמי הניהול עכשיו?')}`, `DESCRIPTION:${esc(`עברו 30 יום מהבקשה להפחית את דמי הניהול. בודקים בדוח או באזור האישי מה דמי הניהול עכשיו ומזינים אותם כאן: ${url}`)}`,
    `URL:${url}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('fox · מה דמי הניהול עכשיו?')}`, 'TRIGGER;RELATED=START:PT9H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
  return lines.join('\r\n') + '\r\n';
}
