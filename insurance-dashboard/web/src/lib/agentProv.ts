/* W1 · agent door: the sources of the agent's figures (the default-fund tender, the actuarial balance, a product rule, a fee
   benchmark), so every one opens the site's source sheet like any other number. */
import type { Prov } from './prov';
import type { Tender } from './fundsTools';
import { fundP } from './market';
import { nf } from './format';
import { refOf, ym, type FundX } from './funds';
import { ACT_F, actCompound, type ActPoint } from './pensionPack';
import { FEE_DIST_F, type FeeDist, type FeeKey, type Obs, type Pcts } from './feeDist';
import { RULES_NOTE, type ProductRule } from './productRules';

export const pc2 = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${nf(v, d)}%`);
const dateHe = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export const tenderProv = (t: Tender, what: string, v: string): Prov => ({ k: 'report', title: `${what} · ${t.label ?? 'הליך'} ${t.id}`, value: v, url: t.src, pg: null, doc: t.src_title ?? 'רשות שוק ההון, ביטוח וחיסכון',
  period: `${dateHe(t.from)}–${dateHe(t.to)}`, note: `${t.verified ? '' : 'לא אומת מול ההודעה הרשמית של הרשות. '}${t.note ?? ''} שיוך הזוכה למסלולי הקרן בפנסיה-נט: של האתר, לפי שם הקרן.`.trim() });

/** the latest actuarial balance of a track, as published */
export const actProv = (f: FundX) => fundP(refOf(f), f.act_p ?? 0, 'ACTUARIAL_ADJUSTMENT', 'איזון אקטוארי', pc2(f.act), '%', ACT_F);
/** one quarter of the history */
export const actQProv = (f: FundX, x: ActPoint) => fundP(refOf(f), x.p, 'ACTUARIAL_ADJUSTMENT', `איזון אקטוארי ${ym(x.p)}`, pc2(x.v), '%', ACT_F);
export const actSumProv = (f: FundX, xs: ActPoint[]): Prov => ({ k: 'calc', title: `איזון אקטוארי מצטבר, ${xs.length} רבעונים · ${f.name}`, value: pc2(actCompound(xs)),
  formula: '(1 + a₁) × … × (1 + aₙ) − 1 על האיזונים הרבעוניים שפורסמו', inputs: xs.map((x) => ({ label: `איזון אקטוארי · ${ym(x.p)}`, v: pc2(x.v), src: () => actQProv(f, x) })), note: ACT_F });

export const ruleProv = (r: ProductRule, which: 'liq' | 'tax'): Prov => ({ k: 'calc', title: `${which === 'liq' ? 'נזילות' : 'מיסוי'} · ${r.name}`, value: which === 'liq' ? r.liq : r.tax,
  formula: `טבלה סטטית של האתר, נבדקה מול המקורות ב-01.11.26; סכומים לשנת המס ${r.year}. ${RULES_NOTE}`,
  inputs: r.src.map((s) => ({ label: s.title, v: s.kind === 'primary' ? 'מקור ראשי' : s.kind === 'press' ? 'עיתונות' : 'כל זכות', src: (): Prov => ({ k: 'report', title: s.title, value: '', url: s.url, pg: null, doc: s.title }) })),
  note: r.watch });

const FEE_COL: Record<FeeKey, [string, string]> = { fee: ['AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל'], depfee: ['AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל'] };
export const feeLabel = (key: FeeKey) => FEE_COL[key][1];
/** one observation of a benchmark: a track as published, or a group's assets-weighted mean of its tracks */
export function obsProv(o: Obs, key: FeeKey, asof: number, funds: FundX[]): Prov {
  const fOf = (k: string) => funds.find((f) => f.k === k);
  const one = (t: Obs['tracks'][number]) => { const f = fOf(t.k); return f ? fundP(refOf(f), asof, FEE_COL[key][0], FEE_COL[key][1], pc2(t.v)) : ({ k: 'none', title: t.name, why: 'המסלול לא נמצא בקובץ' } as Prov); };
  if (o.tracks.length === 1 && o.id === o.tracks[0].k) return one(o.tracks[0]);
  return { k: 'calc', title: `${FEE_COL[key][1]} · ${o.label}`, value: pc2(o.v), formula: 'ממוצע משוקלל בנכסים (TOTAL_ASSETS) של דמי הניהול הממוצעים בפועל של מסלולי הקבוצה בפילוח',
    inputs: o.tracks.map((t) => ({ label: `${t.name} · נכסים ${nf(t.assets, 0)}`, v: pc2(t.v), src: () => one(t) })) };
}
/** a percentile of a benchmark */
export function pctProv(d: FeeDist, key: FeeKey, q: keyof Pick<Pcts, 'p10' | 'p25' | 'p50' | 'p75' | 'p90'>, asof: number, funds: FundX[]): Prov {
  const side = d[key], p = side.pcts!;
  return { k: 'calc', title: `${q === 'p50' ? 'חציון' : q.toUpperCase()} · ${FEE_COL[key][1]} · ${d.prod}${d.track ? ` | ${d.track}` : ''}`, value: pc2(p[q], 3),
    formula: `${FEE_DIST_F}. יחידה: ${d.unit === 'mgr' ? 'קבוצה מנהלת (ממוצע משוקלל בנכסים של מסלוליה)' : 'מסלול'}; מסלולים פתוחים עם נכסים, בלי ניהול אישי. n = ${p.n}`,
    inputs: side.obs.map((o) => ({ label: o.label, v: pc2(o.v), src: () => obsProv(o, key, asof, funds) })), note: 'דמי הניהול הממוצעים בפועל שגבו המנהלים מעמיתיהם; דמי הניהול של חוסך מסוים יכולים להיות שונים' };
}
