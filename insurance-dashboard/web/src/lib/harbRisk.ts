/* fox 3.0 A6 · "צד הסיכון" of a client folder: the policies read from the client's הר הביטוח file (lib/harb, kept on the folder as
   cover-only held products with a risk record, lib/harbTypes), checked for the things an agent looks for in a meeting:
     • the same cover twice (two first-shekel surgery policies, two drug covers…), per insured person when the file tells them apart;
     • covers that partly overlap (first-shekel surgery next to a complement to the קופה's שב"ן);
     • private disability or life cover next to the disability / survivors cover of a pension fund in the same folder (from the
       clearing-house file);
     • policies ending soon, or already ended by the file's own dates.
   The circular that set up הר הביטוח names double insurance and over-collected premiums as the problem it is meant to expose
   ("ביטוחי כפל וגביה עודפת של פרמיות", דברי ההסבר לחוזר 2015-277). The flags are prompts to check the policy terms, never a
   finding: the file has no cover terms, sums or exclusions.
   Per company: the policies and their premium a month, and, where fox has the company's pension-fund bylaws price
   (funds/covers.json, lib/coverPrice), the price of the pension fund's disability + survivors cover per ₪1,000 of insured salary for
   the folder's age and sex: the benchmark for risk cover bought inside a pension fund. Pure (no React, no fetch). */
import type { Held } from './clients';
import type { RiskCat, RiskMeta } from './harbTypes';
import { cellOf, type CoverCell, type CoverFund, type CoversFile, type CSex } from './coverPrice';
import { monthlyOf } from './harb';

export const CAT_HE: Record<RiskCat, string> = {
  surg1: 'ניתוחים מהשקל הראשון', surgShaban: 'ניתוחים משלים שב"ן', surgAbroad: 'ניתוחים בחו"ל', transplant: 'השתלות', drugs: 'תרופות', ambul: 'ייעוץ ובדיקות',
  dental: 'שיניים', healthOther: 'בריאות (אחר)', ltc: 'סיעוד', ci: 'מחלות קשות', pa: 'תאונות אישיות', di: 'אובדן כושר עבודה', life: 'ריסק (ביטוח חיים)',
  lifeSave: 'ביטוח חיים עם חיסכון', travel: 'נסיעות לחו"ל', car: 'רכב רכוש', carMand: 'רכב חובה', home: 'דירה ובית עסק', foreign: 'עובדים זרים', other: 'אחר',
};
/** indemnity covers: the claim pays the expense, so a second policy for the same expense does not usually add to what is paid */
export const INDEMNITY: RiskCat[] = ['surg1', 'surgShaban', 'surgAbroad', 'transplant', 'drugs', 'ambul', 'dental'];
/** compensation covers: each policy pays on its own terms */
export const COMPENSATION: RiskCat[] = ['ltc', 'ci', 'pa', 'di', 'life'];
const ASSET: RiskCat[] = ['car', 'carMand', 'home'];

export interface RiskRow { i: number; h: Held; r: RiskMeta; monthly: number | null; active: boolean }
export type Sev = 'high' | 'mid' | 'info';
export interface RiskFlag { sev: Sev; title: string; text: string; rows: number[] }
export interface CompanyRow { name: string; grp: string | null; n: number; monthly: number | null; unknown: number; pension: boolean; fund: CoverFund | null; cell: CoverCell | null; cellF: CoverCell | null }
export interface RiskOut {
  rows: RiskRow[];
  /** Σ premium a month of the active risk policies whose period is known (lifeSave left out: its premium includes savings) */
  monthly: number; annual: number;
  /** active policies with a premium whose period the file does not give, and with no premium at all */
  unknownPer: number; noPremium: number;
  flags: RiskFlag[];
  companies: CompanyRow[];
  /** the age and sex the cover price is shown for, and whether they came from the folder */
  age: number; sex: CSex | null; ageFromFolder: boolean;
  people: number;
}

const ils = (v: number) => `\u2066₪${Math.round(v).toLocaleString('en-US')}\u2069`;  // an LTR isolate: the shekel sign stays before the figure inside Hebrew text
const dmy = (iso: string) => iso.split('-').reverse().join('.');
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
/** a company's short name: the insurer's legal name without "חברה לביטוח בע"מ" and the like */
export const shortIns = (s: string | null) => (s ?? 'לא צוינה חברה').replace(/["״]/g, '"').replace(/\s*(חברה|חברת)\s+(ל)?ביטוח.*$|\s*(קרנות|קרן) פנסיה.*$|\s*(קופות|קופת) גמל.*$|\s*(ביטוח|חברה)\s*בע"מ.*$|\s*בע"מ.*$/, '').trim() || (s ?? '');
const insList = (rs: RiskRow[]) => [...new Set(rs.map((x) => shortIns(x.h.provider)))].join(', ');
const PENSION_RE = /פנסיה/;

/** the covers.json fund of a company group whose name the insurer's or provider's name carries ("הראל חברה לביטוח" → הראל) */
export function fundOfName(cov: CoversFile | null | undefined, name: string | null): CoverFund | null {
  if (!cov || !name) return null;
  const n = ` ${name.replace(/["״'׳]/g, '')} `;
  const hit = Object.values(cov.funds).filter((f) => n.includes(` ${f.grp.replace(/["״'׳]/g, '')} `) || n.includes(` ${f.grp.replace(/["״'׳]/g, '')}-`)).sort((a, b) => b.grp.length - a.grp.length);
  return hit[0] ?? null;
}
/** the bylaws ages fox has (30/40/50): the nearest one to the folder's age */
export const nearAge = (age: number | null, ages: number[]) => (age == null || !ages.length ? 40 : ages.reduce((b, a) => (Math.abs(a - age) < Math.abs(b - age) ? a : b), ages[0]));

export function riskOf(held: Held[], today: string, opts: { cov?: CoversFile | null; age?: number | null; sex?: CSex | null } = {}): RiskOut {
  const rows: RiskRow[] = held.flatMap((h, i) => (h.risk?.src === 'harb' ? [{ i, h, r: h.risk, monthly: monthlyOf(h.risk.premium, h.risk.per), active: !h.risk.end || h.risk.end >= today }] : []));
  const act = rows.filter((x) => x.active);
  const risky = act.filter((x) => !x.r.cats.includes('lifeSave'));
  const monthly = risky.reduce((t, x) => t + (x.monthly ?? 0), 0);
  const flags: RiskFlag[] = [];
  const people = new Set(rows.map((x) => x.r.who).filter((w) => w != null)).size;
  const perWho = people > 1 ? [...new Set(act.map((x) => x.r.who))] : [null];
  const whoNote = (w: number | null) => (people > 1 ? (w == null ? ' (מבוטח לא מזוהה)' : ` · מבוטח ${w}`) : '');
  const grpNote = (rs: RiskRow[]) => (rs.some((x) => x.r.group) && rs.some((x) => x.r.group === false) ? ' אחת הפוליסות קבוצתית, ייתכן דרך מקום העבודה.' : '');
  const sumNote = (rs: RiskRow[]) => { const m = rs.reduce((t, x) => t + (x.monthly ?? 0), 0); return m > 0 ? ` הפרמיה של כולן יחד: ${ils(m)} לחודש.` : ''; };

  for (const w of perWho) {
    const mine = act.filter((x) => people <= 1 || x.r.who === w);
    const byCat = new Map<RiskCat, RiskRow[]>();
    for (const x of mine) for (const c of x.r.cats) byCat.set(c, [...(byCat.get(c) ?? []), x]);
    for (const [c, rs] of byCat) {
      if (rs.length < 2) continue;
      const ids = rs.map((x) => x.i), lab = CAT_HE[c];
      if (INDEMNITY.includes(c)) flags.push({ sev: 'high', rows: ids, title: `כפל אפשרי: ${lab} ב-${rs.length} פוליסות${whoNote(w)}`,
        text: `${insList(rs)}. בכיסוי שיפוי ההחזר מוגבל להוצאה בפועל, ולכן פוליסה נוספת לאותו כיסוי בדרך כלל אינה מגדילה את ההחזר. לבדוק בתנאי הפוליסות אם אחת מהן מיותרת.${grpNote(rs)}${sumNote(rs)}` });
      else if (COMPENSATION.includes(c)) flags.push({ sev: c === 'di' ? 'mid' : 'info', rows: ids, title: `${lab}: ${rs.length} פוליסות${whoNote(w)}`,
        text: `${insList(rs)}. בכיסוי פיצוי כל פוליסה משלמת לפי תנאיה; לבדוק שהסכום הכולל מכוון ולא נרכש פעמיים בטעות.${c === 'di' ? ' בפוליסות רבות לאובדן כושר עבודה יש תקרת פיצוי ביחס להכנסה וקיזוז תגמולים ממקור אחר, ואז פוליסה שנייה לא מגדילה את הפיצוי.' : ''}${grpNote(rs)}${sumNote(rs)}` });
      else if (ASSET.includes(c)) flags.push({ sev: 'info', rows: ids, title: `${lab}: ${rs.length} פוליסות${whoNote(w)}`, text: `${insList(rs)}. ייתכן שאלה נכסים שונים (שני רכבים, שתי דירות); אם זה אותו נכס, זה כפל.` });
    }
    const s1 = byCat.get('surg1'), sh = byCat.get('surgShaban');
    if (s1?.length && sh?.length && s1.some((a) => sh.some((b) => b.i !== a.i))) flags.push({ sev: 'mid', rows: [...new Set([...s1, ...sh].map((x) => x.i))], title: `ניתוחים: שקל ראשון לצד משלים שב"ן${whoNote(w)}`,
      text: `${insList([...s1, ...sh])}. משלים שב"ן משלם מעל מה שהשב"ן של הקופה משלם, ושקל ראשון משלם גם בלי השב"ן, ולכן יש ביניהם חפיפה חלקית. לבדוק את תנאי שתי הפוליסות.` });
  }
  // private risk next to the cover on the clearing-house side of the same folder: a pension fund's disability / survivors cover, and
  // the risk covers of managers' insurance or of a risk policy the clearing house reported (which may be the same policy as a הר
  // הביטוח row: the clearing house carries life-insurance products too)
  const side = held.filter((h) => !h.risk);
  const pens = side.filter((h) => PENSION_RE.test(h.typeHe));
  const diSide = side.filter((h) => PENSION_RE.test(h.typeHe) || h.covers.some((c) => /נכות|כושר|אכ["״]?ע/.test(c.name)));
  const lifeSide = side.filter((h) => PENSION_RE.test(h.typeHe) || h.covers.some((c) => /שאירים|ריסק|מוות|חיים/.test(c.name)));
  const di = act.filter((x) => x.r.cats.includes('di')), life = act.filter((x) => x.r.cats.includes('life'));
  const names = (hs: Held[]) => [...new Set(hs.map((h) => `${h.typeHe}${h.provider ? ` (${shortIns(h.provider)})` : ''}`))].join(', ');
  const same = (rs: RiskRow[], hs: Held[]) => rs.some((x) => hs.some((h) => !PENSION_RE.test(h.typeHe) && shortIns(h.provider) === shortIns(x.h.provider)))
    ? ' ייתכן שחלק מהן אותה פוליסה, שמופיעה בשני הקבצים: להשוות מספר פוליסה ופרמיה לפני שסוכמים עלות.' : '';
  if (diSide.length && di.length) flags.push({ sev: 'mid', rows: di.map((x) => x.i), title: `אובדן כושר עבודה פרטי לצד כיסוי נכות מהמסלקה`,
    text: `${insList(di)}, לצד ${names(diSide)}. לבדוק אם הפוליסה מקזזת תגמולים ממקור אחר (קצבת נכות מהקרן או אובדן כושר בביטוח המנהלים), ואם הכיסוי בצד החיסכון מוגדר נכון, לפני שמשלמים פעמיים על אותו סיכון.${same(di, diSide)}` });
  if (lifeSide.length && life.length) flags.push({ sev: 'info', rows: life.map((x) => x.i), title: `ריסק פרטי לצד כיסוי שאירים או ריסק מהמסלקה`,
    text: `${insList(life)}, לצד ${names(lifeSide)}.${pens.length ? ' כיסוי השאירים בקרן הפנסיה משלם קצבה לבן או בת הזוג ולילדים, וריסק פרטי משלם סכום חד-פעמי.' : ''} לבחון את הצורך ואת העלות יחד.${same(life, lifeSide)}` });
  // savings inside the risk list
  const sv = act.filter((x) => x.r.cats.includes('lifeSave'));
  if (sv.length) flags.push({ sev: 'info', rows: sv.map((x) => x.i), title: `ביטוח חיים עם רכיב חיסכון: ${sv.length === 1 ? 'פוליסה אחת' : `${sv.length} פוליסות`}`,
    text: `${insList(sv)}. החיסכון שבפוליסה מופיע בצד המסלקה; כאן היא לבדיקת הכיסוי בלבד, והפרמיה שלה לא נכנסת לסכום החודשי של צד הסיכון.` });
  // dates
  const soon = act.filter((x) => x.r.end && x.r.end <= addDays(today, 60));
  if (soon.length) flags.push({ sev: 'mid', rows: soon.map((x) => x.i), title: `מסתיימות בחודשיים הקרובים: ${soon.length}`, text: soon.map((x) => `${shortIns(x.h.provider)} · ${x.h.covers[0]?.name ?? x.h.typeHe}: ${dmy(x.r.end!)}`).join('; ') + '. לבדוק חידוש או חלופה לפני שהכיסוי נגמר.' });
  const ended = rows.filter((x) => !x.active);
  if (ended.length) flags.push({ sev: 'info', rows: ended.map((x) => x.i), title: `לפי התאריכים בקובץ, ${ended.length === 1 ? 'פוליסה אחת כבר הסתיימה' : `${ended.length} פוליסות כבר הסתיימו`}`, text: 'הקובץ מהר הביטוח משקף את המצב בתאריך ההורדה: כדאי להוריד קובץ עדכני.' });
  const vague = act.filter((x) => x.r.cats.every((c) => c === 'healthOther' || c === 'other'));
  if (vague.length) flags.push({ sev: 'info', rows: vague.map((x) => x.i), title: `${vague.length === 1 ? 'פוליסה אחת' : `${vague.length} פוליסות`} בלי כיסוי מזוהה`, text: 'בקובץ אין ענף משני או שם מוצר שמזהים את הכיסוי, ולכן לא נבדק להן כפל. לבדוק מול דוח הפוליסה של החברה.' });
  const rank: Record<Sev, number> = { high: 0, mid: 1, info: 2 };
  flags.sort((a, b) => rank[a.sev] - rank[b.sev]);

  // per company: harb policies, and the pension funds of the folder, with the bylaws cover price where covers.json has the group
  const cov = opts.cov ?? null;
  const ages = cov?.standard.ages ?? [30, 40, 50];
  const age = nearAge(opts.age ?? null, ages), sex = opts.sex ?? null;
  const by = new Map<string, CompanyRow>();
  const keyOf = (name: string | null) => fundOfName(cov, name)?.grp ?? shortIns(name);
  const touch = (name: string | null) => {
    const k = keyOf(name);
    if (!by.has(k)) { const fund = fundOfName(cov, name); by.set(k, { name: fund?.grp ?? shortIns(name), grp: fund?.grp ?? null, n: 0, monthly: null, unknown: 0, pension: false, fund, cell: fund ? cellOf(fund, sex ?? 'm', age) : null, cellF: fund && !sex ? cellOf(fund, 'f', age) : null }); }
    return by.get(k)!;
  };
  for (const x of act) { const c = touch(x.h.provider); c.n++; if (x.monthly != null && !x.r.cats.includes('lifeSave')) c.monthly = (c.monthly ?? 0) + x.monthly; else if (x.r.premium != null && x.r.per == null) c.unknown++; }
  for (const h of pens) touch(h.provider).pension = true;
  const companies = [...by.values()].sort((a, b) => (b.monthly ?? 0) - (a.monthly ?? 0) || b.n - a.n || a.name.localeCompare(b.name, 'he'));

  return {
    rows, monthly, annual: monthly * 12, flags, companies, age, sex, ageFromFolder: opts.age != null, people,
    unknownPer: risky.filter((x) => x.r.premium != null && x.r.per == null).length, noPremium: risky.filter((x) => x.r.premium == null).length,
  };
}

/** the folder after a new הר הביטוח read: the policies of an earlier read are replaced, everything else is kept */
export const withHarb = (held: Held[], fresh: Held[]): Held[] => [...held.filter((h) => h.risk?.src !== 'harb'), ...fresh];
