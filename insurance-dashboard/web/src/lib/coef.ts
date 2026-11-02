/* W6 · the annuity conversion coefficient (מקדם המרה לקצבה) of each new comprehensive pension fund, as its bylaws print it
   (web/public/data/funds/coef.json, built by pipeline/build_coef.py from the tables pipeline/extract_coef.py read out of the PDFs).
   Monthly pension = balance at retirement ÷ coefficient. The coefficient depends on the fund, the member's sex, the retirement age,
   the birth year (a column per five years) and the annuity option (the survivors' share and the guarantee period).
   `coefFor` returns the fund's own cell when the file has it and the site's assumption (lib/retire coefOf: Bizportal, 22.07.26)
   when it does not, and always says which in `why`. Pure: no React, no fetch, so the unit test runs it in node. Never advice. */
import type { Prov } from './prov';
import { coefOf, type Sex } from './retire';

export const COEF_PATH = 'funds/coef.json';

export interface CoefSrc { id: string; kind: 'primary' | 'mirror'; publisher?: string; fund?: string; title: string; edition: string; url: string; page_url?: string; official_url?: string; official_edition?: string; retrieved: string; appendix?: string; note?: string; sha256: string; pages: number[] }
export interface CoefTable { opt: string; sex: Sex; pages: number[]; quote: string; years: number[]; ages: number[]; v: (number | null)[][]; sex_by_order?: boolean }
export interface CoefExcluded { opt: string; sex: Sex | null; pages: number[]; why: string; n: number }
export interface CoefFund { src: CoefSrc; tables: CoefTable[]; excluded: CoefExcluded[] }
export type Survivors = 0 | 30 | 60 | 100 | 'x';
export type Guarantee = 0 | 60 | 120 | 180 | 240 | 'to87';
export interface CoefOption { survivors: Survivors; guarantee: Guarantee; label: string }
export interface CoverageRow { grp: string; prod: string; mgr?: string; status: 'table' | 'missing'; n?: number; pages?: number[]; edition?: string; method?: string; options?: string[]; reason?: string }
export interface CoefFile {
  v: number; asof: string; method: string; basis_note?: string; ages: number[]; year_from?: number;
  options: Record<string, CoefOption>; funds: Record<string, CoefFund>; coverage: CoverageRow[]; missing?: { what: string; grp?: string; reason: string }[];
  assumption: { coef: number; m: number; f: number; title: string; url: string; note?: string };
  btl: { single: number; single_80: number; couple: number; from: string; title: string; url: string; retrieved: string; quote: string; note?: string };
  target: { rate: number; title: string; url: string; retrieved: string; pg?: number; quote?: string; note?: string };
}

/** the option the site uses when the reader chose none: 60% to the spouse with no guarantee (the basis every fund prints its
 *  tables on), else the fund's table whose spouse share is not stated (Infinity), else no survivors */
export const DEFAULT_OPTS = ['s60_g0', 'sx_g0', 's0_g0'];
export const ASSUMPTION_WHY = 'אין מקדם זמין לקרן זו; מוצג לפי הנחה';

export interface CoefPick {
  /** the coefficient used, and whether it is the fund's own cell (true) or the site's assumption (false) */
  v: number; real: boolean;
  /** one line: the fund and page when real, "הנחה" when not */
  why: string;
  /** the short label for a card: "לפי מקדם מהתקנון, עמ' X" / "לפי הנחה" */
  label: string;
  grp?: string; opt?: string; optLabel?: string; page?: number; pages?: number[]; age?: number;
  /** the birth year asked for and the table column used */
  year?: { asked: number | null; used: number };
  src?: CoefSrc;
  prov: () => Prov;
}

const fundName = (f: CoefFund, grp: string) => f.src.fund ?? grp;
const pagesHe = (ps: number[]) => (ps.length > 1 ? `עמ' ${ps[0]}–${ps[ps.length - 1]}` : `עמ' ${ps[0]}`);
const editionHe = (s: CoefSrc) => `${s.kind === 'mirror' ? 'עותק של ' : ''}מהדורת ${s.edition}`;

/** the site's assumption as a pick, with the reason the fund's table was not used */
export function assumptionPick(sex: Sex | null | undefined, reason: string, d?: CoefFile | null): CoefPick {
  const a = coefOf(sex);
  const src = d?.assumption;
  return {
    v: a.v, real: false, why: `הנחה (${a.why}): ${reason}`, label: 'לפי הנחה',
    prov: () => ({ k: 'calc', est: true, title: 'מקדם המרה לקצבה · הנחה', value: String(a.v), formula: 'הנחת האתר, לא המקדם של הקרן: ' + a.why,
      note: `${reason}. ${src ? `מקור ההנחה: ${src.title} (${src.url})` : ''}`, inputs: [] }),
  };
}

/** the fund's coefficient for a member of `sex` retiring at `retireAge`, born `birthYear` (null: the earliest column at or after
 *  1950 is not assumed; the latest column is used and the reason says so), under `opt` (null: DEFAULT_OPTS in order) */
export function coefFor(d: CoefFile | null | undefined, grp: string | null | undefined, sex: Sex | null | undefined, retireAge: number, birthYear?: number | null, opt?: string | null): CoefPick {
  if (!d) return assumptionPick(sex, 'קובץ המקדמים לא נטען', d);
  if (!grp || !d.funds[grp]) {
    const cov = grp ? d.coverage.find((c) => c.grp === grp) : undefined;
    return assumptionPick(sex, cov?.reason ?? ASSUMPTION_WHY, d);
  }
  const f = d.funds[grp];
  if (sex !== 'm' && sex !== 'f') return assumptionPick(sex, `ל${fundName(f, grp)} יש טבלה, אך המקדם תלוי במין: בחרו למעלה`, d);
  const age = Math.round(retireAge);
  if (age < d.ages[0] || age > d.ages[d.ages.length - 1]) return assumptionPick(sex, `הטבלה כאן מכסה פרישה בגיל ${d.ages[0]}–${d.ages[d.ages.length - 1]}; גיל ${retireAge} מחוצה לה`, d);
  const opts = opt ? [opt] : DEFAULT_OPTS;
  for (const o of opts) {
    const t = f.tables.find((x) => x.opt === o && x.sex === sex && x.ages.includes(age));
    if (!t) continue;
    const row = t.v[t.ages.indexOf(age)];
    const have = t.years.map((y, j) => ({ y, v: row[j] })).filter((x): x is { y: number; v: number } => x.v != null);
    if (!have.length) continue;
    const asked = birthYear ?? null;
    const cell = asked == null ? have[have.length - 1] : have.reduce((best, x) => (Math.abs(x.y - asked) < Math.abs(best.y - asked) || (Math.abs(x.y - asked) === Math.abs(best.y - asked) && x.y > best.y) ? x : best), have[0]);
    const option = d.options[o];
    const yearWhy = asked == null ? `עמודת ילידי ${cell.y} (שנת לידה לא ידועה)` : cell.y === asked ? `ילידי ${cell.y}` : `עמודת ילידי ${cell.y} (הקרובה ל-${asked})`;
    const why = `${fundName(f, grp)}: מקדם ${cell.v} מהתקנון (${editionHe(f.src)}, ${pagesHe(t.pages)}), ${sex === 'f' ? 'אישה' : 'גבר'}, פרישה בגיל ${age}, ${yearWhy}, ${option?.label ?? o}`;
    const label = `לפי מקדם מהתקנון, ${pagesHe(t.pages)}`;
    return {
      v: cell.v, real: true, why, label, grp, opt: o, optLabel: option?.label, page: t.pages[0], pages: t.pages, age, year: { asked, used: cell.y }, src: f.src,
      prov: () => ({ k: 'report', title: `מקדם המרה לקצבה · ${fundName(f, grp)}`, value: String(cell.v), url: f.src.url, pg: t.pages[0], doc: f.src.title, period: f.src.edition,
        note: [`${t.quote}.`, `${sex === 'f' ? 'אישה' : 'גבר'}, גיל פרישה ${age}, ${yearWhy}; ${option?.label ?? o}.`, d.basis_note, t.sex_by_order ? 'הטבלה אינה נושאת את המילה "נשים"; זוהתה כטבלת הנשים לפי הסדר הקבוע בתקנון (גברים תחילה).' : null,
          f.src.kind === 'mirror' ? `הטקסט נקרא מעותק של התקנון באתר צד שלישי (${f.src.url}); ${f.src.note ?? ''}` : null, `הקובץ נקרא ב-${f.src.retrieved}; sha256 ${f.src.sha256.slice(0, 12)}…`].filter(Boolean).join(' ') }),
    };
  }
  const ex = f.excluded.find((e) => opts.includes(e.opt));
  return assumptionPick(sex, ex ? `הטבלה של ${fundName(f, grp)} למסלול הזה (${pagesHe(ex.pages)}) נפסלה בבדיקה: ${ex.why}` : `ל${fundName(f, grp)} אין טבלה למסלול הקצבה הזה בגיל ${age}`, d);
}

/** the monthly annuity a balance buys: balance ÷ coefficient */
export const annuityOf = (balance: number, pick: Pick<CoefPick, 'v'>) => balance / pick.v;

/** the birth year a reader of `age` was born in, this year (an assumption that can be a year off) */
export const birthYearOf = (age: number, year = new Date().getFullYear()) => year - age;

/** the funds that have a coefficient for `sex` at `age` under the default option: for a select, with the cell and the page */
export function fundChoices(d: CoefFile | null | undefined, sex: Sex | null | undefined, age: number, birthYear?: number | null): { grp: string; name: string; pick: CoefPick }[] {
  if (!d || !sex) return [];
  return Object.keys(d.funds).map((grp) => ({ grp, name: fundName(d.funds[grp], grp), pick: coefFor(d, grp, sex, age, birthYear) })).filter((x) => x.pick.real).sort((a, b) => a.name.localeCompare(b.name, 'he'));  // by name, never by size: a list, not a ranking
}

/** the coverage row of a group and product, for "אין מקדם זמין לקרן זו" */
export const coverageOf = (d: CoefFile | null | undefined, grp: string, prod: string) => d?.coverage.find((c) => c.grp === grp && c.prod === prod) ?? null;

/* ---------- the replacement rate (saver) ---------- */
export interface Replacement { noBtl: number; withBtl: number; target: number; btl: number }
/** pension ÷ last salary, without and with the National Insurance old-age pension (the basic amount for an individual) */
export function replacementOf(pension: number, salary: number, d: Pick<CoefFile, 'btl' | 'target'>): Replacement | null {
  if (!(salary > 0) || !(pension >= 0)) return null;
  return { noBtl: pension / salary, withBtl: (pension + d.btl.single) / salary, target: d.target.rate / 100, btl: d.btl.single };
}
export const pct0 = (x: number) => `${Math.round(x * 100)}%`;

/* ---------- the age–track mismatch (the regulator's age-dependent default model) ---------- */
/** the regulator's age-dependent tracks (מודל חכ"ם): a member is placed by age and moved up at 50 and at 60 */
export const AGE_TRACKS: { track: string; from: number; to: number | null }[] = [{ track: 'עד 50', from: 0, to: 50 }, { track: '50-60', from: 50, to: 60 }, { track: '60 ומעלה', from: 60, to: null }];
export interface TrackAgeNote { track: string; age: number; to: string; text: string }
/** one line when the reader's age is past the track's band: "המסלול מיועד לבני X; בגיל Y הקרן מעבירה בדרך כלל למסלול Z". Null when the
 *  track is not an age track or the age fits (a younger reader in an older band is not flagged: the model moves members up, not down) */
export function trackAgeNote(track: string, age: number | null | undefined): TrackAgeNote | null {
  if (age == null) return null;
  const band = AGE_TRACKS.find((b) => b.track === track);
  if (!band || band.to == null || age < band.to) return null;
  const to = AGE_TRACKS.find((b) => b.from <= age && (b.to == null || age < b.to))?.track ?? '60 ומעלה';
  const who = band.track === 'עד 50' ? 'בני 50 ומטה' : `בני ${band.track}`;
  return { track, age, to, text: `המסלול מיועד ל${who}; בגיל ${age} הקרן מעבירה בדרך כלל למסלול "${to}", לפי המודל התלוי גיל של הרשות, אלא אם העמית ביקש אחרת.` };
}
