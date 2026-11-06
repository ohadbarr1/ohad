/* fox 3.0 phase 2 · the agent desk, no server (A4, A5, the book's safety). Pure: no React, no storage, no fetch, so
   tests/agentDesk.unit.ts runs it in node.

   A4 · "למי להתקשר החודש": when a new regulator month lands, every client folder (lib/clients) against the published data, one line per
   trigger on the client's own tracks, each with its data source and a draft message:
     q4      the track's 12-month net return ranked in the bottom quartile of its category (percentile ≤ 25; 100 = best) for 3 months
             or more in a row, ending in the data month (funds/rank/<slug>.json, the site's own ranking of the regulator's returns)
     act     a pension fund's last published actuarial balance is negative (funds.json act_h, as the fund reported to pensia-net)
     fee     the track's published average fee from savings rose in the last 12 data months (flows/fees.json `log`: moves of 5 bp+)
     tender  the default-fund tender: the fund won the tender before the one in force but not this one, or the tender price the
             client's own fees equal may end within 12 months (funds/default.json; lib/agentBook tenderHits)
     svc     the company's score in the regulator's service index fell against the year before (funds/decision.json `chg`)
   A trigger's key carries the data it rests on (the quarter, the fee month, the tender, the index year, the month a bottom run began),
   so a line the agent marked "טופל" stays handled until the data says something new. Nothing is a recommendation: the lines describe
   published figures; the draft message says what changed and asks for a call. The message never carries the client's name, a balance
   or an ID, so it can travel through a share link.

   A5 · annual reviews: the folders whose meeting anniversary (`meet:date` in the folder's fields, typed in the wizard; else the
   folder's creation, i.e. the import) falls this month or fell earlier this year with no review since; each opens the client document
   in review mode and has a draft message.

   The book's safety: a cheap fingerprint of the stored folders, so the page can say "changed since the last backup". */
import type { Folder, Held } from './clients';
import { catKey, type FundX } from './funds';
import { isoYm, priceOf, tendersOf, type DefaultFile, type Tender } from './fundsTools';
import { defaultHits, isPension, periodText } from './pensionPack';
import { SEG_HE, segOf, srcOf, svcOf, type DecisionFile } from './decision';
import { addMonths, feeMedians, tenderHits } from './agentBook';
import { KIND_HE, kindOf, type Kind } from './nyud';
import type { FeesFile } from './flows';

/* ---------- small helpers ---------- */
/** yyyymm + n months */
export const addYm = (p: number, n: number) => { const t = Math.floor(p / 100) * 12 + (p % 100 - 1) + n; return Math.floor(t / 12) * 100 + (t % 12) + 1; };
/** yyyymm → "09/26" */
export const ymShort = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
/** ISO date → "05.11.2026" (never an ISO date on screen) */
export const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
/** ISO date → "11.2026" */
export const my = (iso: string) => `${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const pc2 = (v: number) => `${v.toFixed(2)}%`;
const isoOk = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && !Number.isNaN(Date.parse(s.slice(0, 10)));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
const heldName = (h: Held) => [h.typeHe, h.provider].filter(Boolean).join(' · ');

/* ---------- A4 · the call list ---------- */
/** Red team 06.11.26: the list leads with what the agent bills on, from the client's OWN file (level 'client'):
 *    depfee  the client's deposit fee above the tender price in force (pension) or above the category's median published average
 *    accfee  the client's fee from savings above the category's median published average
 *    merge   two or more accounts of the same kind (pension, provident, study fund) to consolidate
 *    coef    a policy with a guaranteed annuity coefficient (the cohort to handle with care)
 *  then the market-level lines about the client's tracks (level 'market': act, q4, fee, tender, svc), shown below. */
export type TrigId = 'depfee' | 'accfee' | 'merge' | 'coef' | 'q4' | 'act' | 'fee' | 'tender' | 'svc';
export const TRIG_HE: Record<TrigId, string> = {
  depfee: 'דמי ניהול מהפקדה גבוהים', accfee: 'דמי ניהול מצבירה גבוהים', merge: 'חשבונות לאיחוד', coef: 'מקדם קצבה מובטח',
  q4: 'רבע תחתון 3 חודשים ברצף', act: 'מאזן אקטוארי שלילי', fee: 'עליית דמי ניהול', tender: 'מכרז ברירת המחדל', svc: 'ירידה במדד השירות',
};
export const CLIENT_TRIGS: TrigId[] = ['depfee', 'accfee', 'merge', 'coef'];
export const TRIG_ORDER: TrigId[] = [...CLIENT_TRIGS, 'act', 'q4', 'fee', 'tender', 'svc'];
export const levelOf = (id: TrigId): 'client' | 'market' => (CLIENT_TRIGS.includes(id) ? 'client' : 'market');
export interface Trigger {
  id: TrigId;
  /** 'client': from the client's own file (fees, accounts, coefficient); 'market': published data about the client's track */
  level: 'client' | 'market';
  /** ₪ a year the line is about, when the file gives what it needs (fee gap × balance or deposits); never in the message */
  amount?: number | null;
  /** stable: the trigger, the track and the data it rests on */
  key: string;
  /** the client's product(s) it is about */
  what: string; k: string | null;
  title: string; detail: string;
  /** where the figure comes from, in words */
  src: string;
  /** the data month (yyyymm) or quarter it rests on */
  month: number | null;
  /** one sentence for the client message: descriptive, no name, no balance */
  msg: string;
}
export interface CallRow { folder: string; label: string; triggers: Trigger[] }
/** a category's monthly percentile series for one track: y12 net, aligned with `months` (funds/rank/<slug>.json, `sets`) */
export interface RankSeries { cat: string; months: number[]; v: (number | null)[]; n?: (number | null)[] }
export interface CallsIn {
  folders: Folder[]; funds: FundX[];
  /** the data month (funds.json asof) */
  asof: number;
  today: string;
  ranks?: Record<string, RankSeries> | null;
  fees?: Pick<FeesFile, 'rows' | 'asof'> | null;
  dfile?: DefaultFile | null;
  dec?: DecisionFile | null;
}
export const Q4_MAX = 25, Q4_RUN = 3;
export const SRC = {
  rank: 'הרשות לשוק ההון (גמל-נט, פנסיה-נט, ביטוח-נט, data.gov.il); אחוזון בקטגוריה (מוצר | מסלול) לפי תשואה נטו ל-12 חודשים, חישוב האתר (funds/rank)',
  act: 'פנסיה-נט: האיזון האקטוארי כפי שהקרן דיווחה, באחוזים מהעתודות, פעם ברבעון (funds.json)',
  fee: 'הרשות לשוק ההון: דמי ניהול מצבירה, ממוצע בפועל של המסלול (AVG_ANNUAL_MANAGEMENT_FEE), חודשים שבהם השיעור זז ב-5 נ"ב או יותר (flows/fees.json); לא בהכרח דמי הניהול של הלקוח',
  tender: 'רשות שוק ההון: הודעות התוצאות של הליכי קרנות ברירת המחדל (funds/default.json)',
  file: 'קובץ המסלקה של הלקוח (דמי הניהול, היתרות וההפקדות שלו)',
  med: 'הרשות לשוק ההון: חציון הממוצע בפועל שפורסם למסלולי אותה קטגוריה (מוצר | מסלול; 3 מסלולים לפחות, אחרת המוצר כולו), חישוב האתר',
} as const;
const ilsT = (v: number) => `₪${Math.round(v).toLocaleString('en-US')}`;
const KIND_PL: Partial<Record<Kind, string>> = { pension: 'קרנות פנסיה', gemel: 'קופות גמל', hish: 'קרנות השתלמות' };
/** materiality, so the list stays a call list (fox's thresholds, not a rule): a deposit fee 0.25 points or more above the reference;
 *  a fee from savings above the median worth ₪200 a year or more on the client's balance */
export const DEP_MIN_GAP = 0.25, ACC_MIN_ILS = 200;

/** red team 06.11.26 · the client-level money lines of one folder, from the client's own file against published references */
export function clientTriggers(f: Folder, inp: CallsIn, byK: Map<string, FundX>, meds = feeMedians(inp.funds)): Trigger[] {
  const out: Trigger[] = [];
  const ts = tendersOf(inp.dfile);
  const cur = ts.find((t) => isoYm(t.from) <= inp.asof && inp.asof <= isoYm(t.to)) ?? ts[0] ?? null;
  const tp = cur ? cur.winners.map((w) => priceOf(cur, w)) : [];
  const tDep = tp.map((p) => p.depfee).filter((v): v is number => v != null), tFee = tp.map((p) => p.fee).filter((v): v is number => v != null);
  const tender = cur && tDep.length ? { depfee: Math.max(...tDep), fee: tFee.length ? Math.max(...tFee) : null, label: cur.label ?? cur.id, src: cur.src_title ?? cur.src } : null;
  const asofT = ymShort(inp.asof);
  f.held.forEach((h, i) => {
    if (h.risk) return;
    const x = h.k ? byK.get(h.k) : undefined;
    const kind = kindOf(x ? x.prod : h.typeHe) === 'other' ? kindOf(h.typeHe) : kindOf(x ? x.prod : h.typeHe);
    const what = `${heldName(h)}${x ? ` · ${x.name}` : h.track ? ` · ${h.track}` : ''}`;
    const cm = x ? meds.cat.get(catKey(x)) : undefined, pm = x ? meds.prod.get(x.prod) : undefined;
    // the deposit fee: the tender price in force for a pension fund; else the category's (or product's) median
    if (h.depfee != null && h.depfee > 0) {
      const pen = kind === 'pension' && tender;
      // a managers' policy: its own track's published average (the category mixes in pure savings policies, whose deposit fee is ~0)
      const ref = pen ? { v: tender!.depfee, what: `המחיר הגבוה בהליך ברירת המחדל שבתוקף (${tender!.label})`, src: `${SRC.tender}; ${tender!.src}` }
        : kind === 'managers' && x && x.depfee != null ? { v: x.depfee, what: `הממוצע בפועל במסלול ${x.name} (${asofT})`, src: 'הרשות לשוק ההון: הממוצע בפועל של המסלול מהפקדות (AVG_DEPOSIT_FEE)' }
        : kind === 'managers' ? null
        : cm && cm.depfee != null && cm.nd >= 3 ? { v: cm.depfee, what: `חציון "${catKey(x!)}" (${cm.nd} מסלולים, ${asofT})`, src: SRC.med }
        : pm && pm.depfee != null && pm.nd >= 3 ? { v: pm.depfee, what: `חציון ${x!.prod} (${pm.nd} מסלולים, ${asofT})`, src: SRC.med } : null;
      if (ref && h.depfee >= ref.v + DEP_MIN_GAP) {
        const amt = h.monthly != null && h.monthly > 0 ? (h.monthly * 12 * (h.depfee - ref.v)) / 100 : null;
        out.push({ id: 'depfee', level: 'client', amount: amt, key: `depfee|${i}|${h.depfee}|${ref.v}`, what, k: h.k, month: null,
          title: `דמי ניהול מהפקדה ${pc2(h.depfee)} מול ${pc2(ref.v)}`,
          detail: `${ref.what}${amt != null ? `; על ההפקדה בקובץ: ${ilsT(amt)} בשנה` : '; אין הפקדה בקובץ (חשבון לא פעיל): משמעותי אם ההפקדות יחודשו'}`,
          src: `${SRC.file}; ${ref.src}`, msg: `דמי הניהול מהפקדה ב${KIND_HE[kind] === 'אחר' ? 'חשבון' : KIND_HE[kind]} שלך הם ${pc2(h.depfee)}, מעל ${pen ? 'מחיר המכרז של קרנות ברירת המחדל' : kind === 'managers' ? 'הממוצע במסלול שלך' : 'החציון של מסלולים דומים'} (${pc2(ref.v)}). כדאי לבדוק אם אפשר להוריד אותם.` });
      }
    }
    // the fee from savings against the category's median
    const m = cm && cm.fee != null && cm.n >= 3 ? { v: cm.fee, what: `חציון "${catKey(x!)}" (${cm.n} מסלולים, ${asofT})` } : null;
    const accAmt = m && h.fee != null ? ((h.fee - m.v) / 100) * (h.balance ?? 0) : 0;
    if (m && h.fee != null && (h.balance ?? 0) > 0 && h.fee > m.v + 0.005 && accAmt >= ACC_MIN_ILS) {
      const amt = accAmt;
      out.push({ id: 'accfee', level: 'client', amount: amt, key: `accfee|${i}|${h.fee}|${m.v}`, what, k: h.k, month: inp.asof,
        title: `דמי ניהול מצבירה ${pc2(h.fee)} מול ${pc2(m.v)}`, detail: `${m.what}; על היתרה בקובץ: ${ilsT(amt)} בשנה`,
        src: `${SRC.file}; ${SRC.med}`, msg: `דמי הניהול מהצבירה ב${KIND_HE[kind] === 'אחר' ? 'חשבון' : KIND_HE[kind]} שלך הם ${pc2(h.fee)}, מעל החציון של מסלולים דומים (${pc2(m.v)}). כדאי לבדוק אם אפשר להוריד אותם.` });
    }
    // the guaranteed-coefficient cohort
    const g = h.coefGuaranteed;
    if (g && g.v > 0) out.push({ id: 'coef', level: 'client', key: `coef|${i}|${g.v}`, what, k: h.k, month: null,
      title: `מקדם קצבה מובטח ${g.v}${g.at ? ` לגיל ${g.at}` : ''}`, detail: 'ניוד או הפסקת הפקדות מוותרים על המקדם; לבדוק את תנאי הפוליסה ואת כדאיות ההפקדות אליה (§5א(1)(ט)(6)(א) בחוזר מסמך הנמקה)',
      src: g.src === 'file' ? `${SRC.file} (מקדם מובטח לפרישה)` : 'המקדם כפי שבעל הרישיון הזין בתיק', msg: 'בפוליסה שלך רשום מקדם קצבה מובטח. לפני כל שינוי בה כדאי לעבור יחד על המשמעות.' });
  });
  // accounts of the same kind to consolidate
  const by = new Map<Kind, { h: Held; i: number }[]>();
  f.held.forEach((h, i) => { if (h.risk || !((h.balance ?? 0) > 0)) return; const x = h.k ? byK.get(h.k) : undefined; const k = kindOf(h.typeHe) !== 'other' ? kindOf(h.typeHe) : kindOf(x?.prod ?? ''); if (k === 'pension' || k === 'gemel' || k === 'hish') by.set(k, [...(by.get(k) ?? []), { h, i }]); });
  for (const [k, hs] of by) {
    if (hs.length < 2) continue;
    const idle = hs.filter((x) => x.h.monthly == null || x.h.monthly <= 0).length;
    out.push({ id: 'merge', level: 'client', key: `merge|${k}|${hs.map((x) => x.i).join(',')}`, what: hs.map((x) => heldName(x.h)).join('; '), k: null, month: null,
      title: `${hs.length} ${KIND_PL[k]}${idle ? `, ${idle === 1 ? 'אחת' : idle === hs.length ? 'כולן' : idle} בלי הפקדות` : ''}: לבדוק איחוד`,
      detail: hs.map((x) => `${x.h.provider ?? KIND_HE[k]}${x.h.track ? ` · ${x.h.track}` : ''}: ${ilsT(x.h.balance ?? 0)}${x.h.monthly ? `, הפקדה ${ilsT(x.h.monthly)}` : ', אין הפקדה בקובץ'}${x.h.fee != null ? `, ${pc2(x.h.fee)} מצבירה` : ''}${x.h.depfee != null ? ` / ${pc2(x.h.depfee)} מהפקדה` : ''}`).join(' · '),
      src: SRC.file, msg: `יש לך ${hs.length} ${KIND_PL[k]} נפרדות${idle === 1 ? ', ואחת מהן בלי הפקדות' : idle === hs.length ? ', ואין הפקדות לאף אחת מהן' : idle ? ', וחלקן בלי הפקדות' : ''}. כדאי לבדוק אם לאחד אותן.` });
  }
  return out.sort((a, b) => TRIG_ORDER.indexOf(a.id) - TRIG_ORDER.indexOf(b.id) || (b.amount ?? 0) - (a.amount ?? 0));
}

/** the trailing run of months in the bottom quartile, ending in `asof`: its length, its first month and the values */
export function bottomRun(s: RankSeries | null | undefined, asof: number): { run: number; from: number | null; vals: number[]; n: number | null } {
  if (!s) return { run: 0, from: null, vals: [], n: null };
  const i = s.months.lastIndexOf(asof);
  if (i < 0) return { run: 0, from: null, vals: [], n: null };
  const vals: number[] = [];
  let j = i;
  for (; j >= 0; j--) {
    const v = s.v[j];
    if (v == null || v > Q4_MAX) break;
    // a gap in the months breaks the run
    if (j < i && s.months[j] !== addYm(s.months[j + 1], -1)) break;
    vals.unshift(v);
  }
  return { run: vals.length, from: vals.length ? s.months[j + 1] : null, vals, n: s.n?.[i] ?? null };
}

/** every trigger on one folder's products: the client-level money lines first, then the market-level lines about its tracks */
export function folderTriggers(f: Folder, inp: CallsIn, byK: Map<string, FundX>, meds?: ReturnType<typeof feeMedians>): Trigger[] {
  const out: Trigger[] = [];
  const seen = new Set<string>();
  const push0 = (t: Omit<Trigger, 'level'>) => push({ ...t, level: levelOf(t.id) });
  const push = (t: Trigger) => { if (seen.has(t.key)) { const o = out.find((x) => x.key === t.key); if (o && !o.what.includes(t.what)) o.what += `; ${t.what}`; return; } seen.add(t.key); out.push(t); };
  const ts = tendersOf(inp.dfile);
  const cur = ts.find((t) => isoYm(t.from) <= inp.asof && inp.asof <= isoYm(t.to)) ?? null;
  const horizon = addMonths(inp.today, 12);
  const feeRows = new Map((inp.fees?.rows ?? []).map((r) => [r.k, r]));
  const feeFrom = addYm(inp.asof, -12);
  for (const h of f.held) {
    const x = h.k ? byK.get(h.k) : undefined;
    if (!x || !h.k) continue;
    const what = `${heldName(h)} · ${x.name}`;
    // q4: bottom quartile for 3 months or more, ending in the data month
    const br = bottomRun(inp.ranks?.[h.k], inp.asof);
    if (br.run >= Q4_RUN && br.from != null) {
      const ms = inp.ranks![h.k].months, i = ms.lastIndexOf(inp.asof);
      const shown = br.vals.slice(-6).map((v, j, a) => `${ymShort(ms[i - (a.length - 1 - j)])}: ${v}`).join(' · ');
      push0({ id: 'q4', key: `q4|${h.k}|${br.from}`, what, k: h.k, month: inp.asof,
        title: `${br.run} חודשים ברצף ברבע התחתון של "${catKey(x)}"`,
        detail: `אחוזון התשואה נטו ל-12 חודשים (100 = הגבוה בקטגוריה${br.n ? `, ${br.n} מסלולים` : ''}): ${shown}`,
        src: SRC.rank, msg: `המסלול "${x.name}" נמצא ${br.run} חודשים ברצף ברבע התחתון של המסלולים הדומים לו, לפי תשואה נטו ל-12 חודשים (נתוני ${ymShort(inp.asof)}).` });
    }
    // act: the last published quarter is negative
    if (isPension(x)) {
      const last = x.act_h?.length ? x.act_h[x.act_h.length - 1] : x.act != null && x.act_p ? [x.act_p, x.act] as [number, number] : null;
      if (last && last[1] < 0) {
        const q = `${String(last[0] % 100).padStart(2, '0')}/${Math.floor(last[0] / 100)}`;
        push0({ id: 'act', key: `act|${h.k}|${last[0]}`, what, k: h.k, month: last[0],
          title: `מאזן אקטוארי ${pc2(last[1])} ברבעון שהסתיים ב-${q}`,
          detail: `${x.name}: ${(x.act_h ?? []).slice(-4).map(([p, v]) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}: ${pc2(v)}`).join(' · ') || pc2(last[1])}`,
          src: SRC.act, msg: `בקרן "${x.name}" פורסם איזון אקטוארי שלילי (${pc2(last[1])}) לרבעון שהסתיים ב-${q}: הקרן הקטינה את הזכויות של העמיתים בשיעור הזה.` });
      }
    }
    // fee: a published rise in the last 12 data months
    const fr = feeRows.get(h.k);
    const up = (fr?.log ?? []).filter(([m, a, b]) => m > feeFrom && m <= inp.asof && b > a).sort((a, b) => b[0] - a[0])[0];
    if (up) {
      const [m, a, b] = up;
      push0({ id: 'fee', key: `fee|${h.k}|${m}`, what, k: h.k, month: m,
        title: `דמי הניהול הממוצעים מצבירה עלו מ-${pc2(a)} ל-${pc2(b)} (${ymShort(m)})`,
        detail: `${x.name}: הממוצע בפועל של המסלול${h.fee != null ? `; דמי הניהול של הלקוח בקובץ המסלקה: ${pc2(h.fee)}` : ''}`,
        src: SRC.fee, msg: `דמי הניהול הממוצעים מצבירה במסלול "${x.name}" עלו מ-${pc2(a)} ל-${pc2(b)} (נתוני ${ymShort(m)}). כדאי לבדוק מה משולם בפועל אצלך.` });
    }
    // tender: winner change; the price the client's fees equal may end within 12 months
    if (isPension(x) && ts.length) {
      const hits = defaultHits(h.k, inp.dfile, inp.asof);
      if (cur && hits.length && !hits.some((t) => t.current)) {
        const prevT = ts[ts.indexOf(cur) + 1] as Tender | undefined;
        const wonPrev = prevT && hits.some((t) => t.t.id === prevT.id);
        if (wonPrev) {
          const names = [...new Set(cur.winners.map((w) => w.grp))].join(', ');
          push0({ id: 'tender', key: `tender|${x.grp}|${cur.id}`, what, k: h.k, month: isoYm(cur.from),
            title: `${x.grp} זכתה בהליך ${prevT.label ?? prevT.id} ואינה בין הזוכות בהליך שבתוקף`,
            detail: `ההליך שבתוקף: ${cur.label ?? cur.id} (${periodText(cur)}), הזוכות: ${names}; ${x.grp}: ${prevT.label ?? prevT.id} (${periodText(prevT)})`,
            src: `${SRC.tender}; ${cur.src_title ?? cur.src}`, msg: `${x.grp} אינה עוד בין קרנות ברירת המחדל שנבחרו בהליך שבתוקף (${periodText(cur)}). כדאי לוודא אילו תנאי דמי ניהול חלים עליך.` });
        }
      }
      const th = tenderHits(h, ts).find((t) => t.byFee);
      if (th && th.end && th.end[0] <= horizon && th.end[1] >= inp.today) {
        const p = priceOf(th.t, th.w);
        push0({ id: 'tender', key: `tenderEnd|${h.k}|${th.t.id}`, what, k: h.k, month: null,
          title: `מחיר מכרז ${th.t.label ?? th.t.id} עשוי להסתיים בין ${my(th.end[0])} ל-${my(th.end[1])}`,
          detail: `דמי הניהול של הלקוח בקובץ (${pc2(h.depfee ?? 0)} מהפקדה, ${pc2(h.fee ?? 0)} מצבירה) שווים למחיר ההליך (${p.depfee != null ? pc2(p.depfee) : '–'} / ${p.fee != null ? pc2(p.fee) : '–'}); המחיר מובטח ${th.t.fee_years} שנים מההצטרפות, ומועד ההצטרפות אינו בקובץ`,
          src: `${SRC.tender}; ${th.t.src_title ?? th.t.src}`, msg: `דמי הניהול שלך שווים למחיר שנקבע בהליך קרן ברירת המחדל, והמחיר הזה מובטח ל-${th.t.fee_years} שנים מההצטרפות: הוא עשוי להסתיים בין ${my(th.end[0])} ל-${my(th.end[1])}.` });
      }
    }
    // svc: the service index fell against the year before
    const seg = segOf(x);
    const r = seg && inp.dec ? svcOf(inp.dec, x.grp, seg) : null;
    if (r && seg && r.prev != null && r.total < r.prev) {
      const s = srcOf(inp.dec, r.src), sg = inp.dec!.segments[seg];
      push0({ id: 'svc', key: `svc|${x.grp}|${seg}|${r.year}`, what, k: h.k, month: null,
        title: `מדד השירות של ${x.grp} (${SEG_HE[seg]}) ירד מ-${r.prev} ל-${r.total}`,
        detail: `${r.year}: ${r.total}, מקום ${r.rank} מתוך ${r.of}; ${sg?.prev_year ?? r.year - 1}: ${r.prev}${sg?.avg?.total != null ? `; ממוצע הענף ${sg.avg.total}` : ''}`,
        src: `${s?.title ?? 'רשות שוק ההון, מדד השירות'}, עמ' ${r.pg}${r.pg_prev ? ` (השנה הקודמת: עמ' ${r.pg_prev})` : ''}`,
        msg: `במדד השירות של רשות שוק ההון ל-${r.year}, הציון של ${x.grp} ב${SEG_HE[seg]} ירד מ-${r.prev} ל-${r.total} (מקום ${r.rank} מתוך ${r.of}).` });
    }
  }
  return [...clientTriggers(f, inp, byK, meds), ...out.sort((a, b) => TRIG_ORDER.indexOf(a.id) - TRIG_ORDER.indexOf(b.id))];
}

/** the call list: folders with at least one trigger, the most triggers first */
export function callList(inp: CallsIn): CallRow[] {
  const byK = new Map(inp.funds.map((f) => [f.k, f]));
  const meds = feeMedians(inp.funds);
  const nC = (r: CallRow) => r.triggers.filter((t) => t.level === 'client').length;
  const amt = (r: CallRow) => r.triggers.reduce((t, x) => t + (x.amount ?? 0), 0);
  // red team 06.11.26: the clients with money lines from their own file first (most lines, then the most ₪ a year), market-only after
  return inp.folders.map((f) => ({ folder: f.id, label: f.label, triggers: folderTriggers(f, inp, byK, meds) })).filter((r) => r.triggers.length)
    .sort((a, b) => nC(b) - nC(a) || amt(b) - amt(a) || b.triggers.length - a.triggers.length || a.label.localeCompare(b.label, 'he'));
}

/** the categories whose rank files the call list needs: the held tracks' categories */
export const rankCats = (folders: Folder[], funds: FundX[]): string[] => {
  const byK = new Map(funds.map((f) => [f.k, f]));
  return [...new Set(folders.flatMap((f) => f.held.map((h) => (h.k ? byK.get(h.k) : undefined)).filter((x): x is FundX => !!x).map(catKey)))];
};

/** the agent's sign-off for a message (name, phone), from the branding, or nothing */
export const signOff = (b: { name?: string; phone?: string } | null | undefined) => [b?.name?.trim(), b?.phone?.trim()].filter(Boolean).join(' · ');
/** the draft message of a call line: what changed, descriptive, and a request for a call; no name, no balance, no ID */
export function callMsg(ts: Trigger[], asof: number, sign = ''): string {
  return ['שלום,', `עדכון קצר על החיסכון שלך, לפי הנתונים שפורסמו (נתוני ${ymShort(asof)}):`, ...ts.map((t) => `• ${t.msg}`),
    'אשמח לקבוע שיחה קצרה כדי לעבור על זה יחד ולבדוק אם נדרש שינוי.', ...(sign ? [sign] : [])].join('\n');
}
/** a WhatsApp share link carrying the message (the person picks the chat in WhatsApp); the text holds no personal data by design */
export const waLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** the agent's look at the call list: the data month last opened, the one before it, and the lines marked handled (key → ISO date) */
export interface CallsState { v: 1; month: number | null; prev: number | null; at: string | null; handled: Record<string, string> }
export const CALLS_KEY = 'agent:calls';
export const EMPTY_CALLS: CallsState = { v: 1, month: null, prev: null, at: null, handled: {} };
export function normCalls(x: unknown): CallsState {
  const o = x as Partial<CallsState>;
  if (!o || typeof o !== 'object') return EMPTY_CALLS;
  const m = (v: unknown) => (Number.isInteger(v) && (v as number) >= 199001 && (v as number) <= 210012 ? (v as number) : null);
  const handled: Record<string, string> = {};
  if (o.handled && typeof o.handled === 'object') for (const [k, v] of Object.entries(o.handled).slice(-2000)) if (k.length <= 200 && isoOk(v)) handled[k] = (v as string).slice(0, 10);
  return { v: 1, month: m(o.month), prev: m(o.prev), at: isoOk(o.at) ? (o.at as string).slice(0, 10) : null, handled };
}
/** a new data month moves the look forward (the month before becomes `prev`); the handled marks stay, since their keys name the data */
export function rollCalls(s: CallsState, asof: number, today: string): CallsState {
  if (s.month == null) return { ...s, month: asof, prev: null, at: today };
  if (asof > s.month) return { ...s, month: asof, prev: s.month, at: today };
  return s;
}
/** whether the data month is new to the agent (the page opened it within the last 7 days, after an earlier month) */
export const isFreshMonth = (s: CallsState, asof: number, today: string) => s.month === asof && s.prev != null && s.at != null && daysBetween(s.at, today) <= 7;
export const markHandled = (s: CallsState, keys: string[], today: string, on = true): CallsState => {
  const handled = { ...s.handled };
  for (const k of keys) { if (on) handled[k] = today; else delete handled[k]; }
  return { ...s, handled };
};
/** the summary the agent's home shows without loading the data again: written by /clients whenever it computes the list */
export interface CallsSummary { asof: number; clients: number; open: number; at: string }
export const CALLS_SUM_KEY = 'agent:calls:sum';
export const normSummary = (x: unknown): CallsSummary | null => {
  const o = x as Partial<CallsSummary>;
  return o && typeof o === 'object' && Number.isInteger(o.asof) && Number.isInteger(o.clients) && Number.isInteger(o.open) && isoOk(o.at) ? { asof: o.asof!, clients: o.clients!, open: o.open!, at: o.at!.slice(0, 10) } : null;
};

/* ---------- A5 · annual reviews ---------- */
export const MEET_KEY = 'meet:date';
export const REVIEW_KEY = 'review:last';
export interface ReviewDue { folder: Folder; anchor: string; by: 'meet' | 'import'; due: string; late: boolean; last: string | null }
/** the anniversary of an ISO date in a given year (29.02 → 28.02 in a common year) */
export function anniversary(iso: string, year: number): string {
  const m = iso.slice(5, 7), d = +iso.slice(8, 10);
  const last = new Date(Date.UTC(year, +m, 0)).getUTCDate();
  return `${year}-${m}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
/** The folders due for an annual review this month: the meeting date the agent typed (else the folder's creation, the import), a
 *  year or more ago, whose anniversary falls this month, or fell earlier this year (up to `lateMonths` back) with no review since.
 *  A review marked within 45 days before the anniversary counts for it. Late ones first, then by day of the month. */
export function reviewsDue(folders: Folder[], today: string, lateMonths = 2): ReviewDue[] {
  const y = +today.slice(0, 4), ymT = today.slice(0, 7);
  const lateFrom = addMonths(`${ymT}-01`, -lateMonths);
  const out: ReviewDue[] = [];
  for (const f of folders) {
    const meet = f.fields[MEET_KEY];
    const anchor = isoOk(meet) ? meet.slice(0, 10) : f.created;
    if (!isoOk(anchor) || daysBetween(anchor, today) < 300) continue;
    const due = anniversary(anchor, y);
    const last = isoOk(f.fields[REVIEW_KEY]) ? f.fields[REVIEW_KEY].slice(0, 10) : null;
    if (last && daysBetween(last, due) <= 45) continue;
    const thisMonth = due.slice(0, 7) === ymT;
    const late = !thisMonth && due < today && due >= lateFrom;
    if (!thisMonth && !late) continue;
    out.push({ folder: f, anchor, by: isoOk(meet) ? 'meet' : 'import', due, late, last });
  }
  return out.sort((a, b) => Number(b.late) - Number(a.late) || a.due.localeCompare(b.due) || a.folder.label.localeCompare(b.folder.label, 'he'));
}
/** the draft message of an annual review */
export function reviewMsg(r: Pick<ReviewDue, 'anchor' | 'by'>, asof: number, sign = ''): string {
  return ['שלום,', `הגיע מועד הסקירה השנתית של החיסכון הפנסיוני שלך (${r.by === 'meet' ? 'הפגישה הקודמת' : 'הבדיקה הקודמת'}: ${my(r.anchor)}).`,
    `הכנתי מסמך סקירה עם הנתונים העדכניים שפרסמה רשות שוק ההון (נתוני ${ymShort(asof)}): דמי הניהול, התשואות והכיסויים.`,
    'אשמח לקבוע פגישה קצרה כדי לעבור עליו יחד ולעדכן את מה שהשתנה אצלך.', ...(sign ? [sign] : [])].join('\n');
}

/* ---------- the book's safety: a fingerprint of the stored folders ---------- */
/** FNV-1a over the folders' JSON: equal books give the same 8 hex digits (a change detector, not a security measure) */
export function bookHash(x: unknown): string {
  const s = JSON.stringify(x ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** the last encrypted backup: when (ISO date-time), of what (the fingerprint), how many folders */
export interface BackupMark { at: string; hash: string; n: number }
export const BACKUP2_KEY = 'clients:backup2';
export const normMark = (x: unknown): BackupMark | null => {
  const o = x as Partial<BackupMark>;
  return o && typeof o === 'object' && typeof o.at === 'string' && isoOk(o.at) && typeof o.hash === 'string' && /^[0-9a-f]{8}$/.test(o.hash) && Number.isInteger(o.n) ? { at: o.at.slice(0, 19), hash: o.hash, n: o.n! } : null;
};
/** "היום 23:10" / "אתמול 09:05" / "03.11.2026" (no ISO on screen) */
export function whenText(at: string, today: string): string {
  const d = daysBetween(at.slice(0, 10), today), t = at.length >= 16 ? at.slice(11, 16) : '';
  return d === 0 ? `היום${t ? ` ${t}` : ''}` : d === 1 ? `אתמול${t ? ` ${t}` : ''}` : dmy(at.slice(0, 10));
}

/* ---------- red team 06.11.26 · the book to the agent's CRM: one CSV row per folder ---------- */
/** the next annual review of a folder (ISO): the anniversary of the meeting date (else the import) still open this year, an overdue one
 *  within the late window, else next year's */
export function nextReview(f: Folder, today: string, lateMonths = 2): string | null {
  const meet = f.fields[MEET_KEY];
  const anchor = isoOk(meet) ? meet.slice(0, 10) : f.created;
  if (!isoOk(anchor)) return null;
  const y = +today.slice(0, 4);
  const first = anniversary(anchor, +anchor.slice(0, 4) + 1);
  if (first > today) return first;
  const due = anniversary(anchor, y);
  const last = isoOk(f.fields[REVIEW_KEY]) ? f.fields[REVIEW_KEY].slice(0, 10) : null;
  const done = !!last && daysBetween(last, due) <= 45;
  const lateFrom = addMonths(`${today.slice(0, 7)}-01`, -lateMonths);
  if (!done && (due >= today || due >= lateFrom)) return due;
  return anniversary(anchor, y + 1);
}
export const CSV_HEAD = ['מזהה תיק', 'שם הלקוח (כפי שנשמר)', 'שם הלקוח במסמך', 'מוצרים', 'נושאים פתוחים', 'מועד הסקירה הבא', 'עודכן'] as const;
/** one CSV cell: quoted when needed; a leading = + - @ is neutralised so a spreadsheet does not run it as a formula */
export const csvCell = (v: string | number | null | undefined) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dmyCsv = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
/** The book as a CSV for a CRM: UTF-8 with a BOM (Excel opens Hebrew correctly), Hebrew headers, one row per folder: its id and label as
 *  stored, the client's name for the document, the products (type · provider · track · balance), the open call-list lines (those not
 *  marked handled), the next review date and the last update. Built in the browser; nothing is sent. */
export function bookCsv(folders: Folder[], opts: { today: string; calls?: CallRow[]; handled?: Record<string, string> }): string {
  const byF = new Map((opts.calls ?? []).map((r) => [r.folder, r.triggers]));
  const rows = folders.map((f) => {
    const prods = f.held.map((h) => [h.typeHe, h.provider, h.track ?? h.plan, h.balance != null ? `₪${Math.round(h.balance).toLocaleString('en-US')}` : null].filter(Boolean).join(' · ')).join(' | ');
    const open = (byF.get(f.id) ?? []).filter((t) => !opts.handled?.[t.key]).map((t) => `${TRIG_HE[t.id]}: ${t.title}`).join(' | ');
    return [f.id, f.label, f.fields['doc:client'] ?? '', prods, open, dmyCsv(nextReview(f, opts.today)), dmyCsv(f.updated?.slice(0, 10) ?? null)];
  });
  return '﻿' + [CSV_HEAD as readonly string[], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
