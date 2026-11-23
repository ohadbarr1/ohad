/** The comparison board of the peer table: the stock (market value, multiples, yield, total return) and the business (profitability,
 *  growth, CSM, capital) of a peer set side by side, with ranks, medians, a focus company, and the series the charts draw.
 *  Business figures are the peer table's own cells (lib/registry + lib/seriesCols), so every number opens the same source.
 *  Market figures are TASE closes: "spot" multiples use the latest close over the latest reported figures; history uses the close
 *  on the last trading day of each quarter (mkt:* in the registry), so P/E and P/B over time are formulas over printed figures. */
import { nf, pubLabel } from './format';
import type { Prov } from './prov';
import { back, plab, type Book, type Freq, type Unit, type Val } from './registry';
import { cellVal, formulaTok, parseCol, ROE_EXPR, type Col } from './seriesCols';
import type { TasePrice } from './valuation';

export const TAX = 34.19;  // the valuation pages' tax assumption on CSM (corporate 23% + profit tax 17% at financial institutions)
export type Better = 'hi' | 'lo' | null;
export type Sec = 'mkt' | 'biz' | 'ops';
/** the operating section's two tables: long-term savings (regulator + presentations) and insurance (IFRS 17 segments, premiums) */
export type OpsGrp = 'sav' | 'ins';
export type Kind = 'ins' | 'fund';
export interface BMetric {
  key: string; l: string; sh: string; u: Unit | 'pctx' | 'pp'; dec: number; better: Better; sec: Sec;
  /** operating table; ax 'reg': read at the regulator's latest quarter (monthly files, ahead of the filings) */
  grp?: OpsGrp; ax?: 'reg';
  /** a token of the peer table per company kind (insurer / fund house); absent kind = not applicable */
  tok?: Partial<Record<Kind, string>>;
  /** spot market metric, computed from the price file */
  spot?: boolean;
  /** quarters a balance may reach back when the latest one is missing (solvency is semi-annual) */
  lb?: number;
  /** the formula on the LTM axis for the history chart (quarter-end close) */
  hist?: Partial<Record<Kind, string>>;
  note?: string;
  /** read on the annual axis (a disclosure made once a year): the last full year up to the board's quarter; 'H': the latest half or year */
  freq?: Freq;
  /** a flow published only for halves and years: LTM = last FY + this H1 − last H1 when the quarterly chain is missing */
  ltmh?: boolean;
}
export interface MktFile {
  asof: string; source: string;
  ents: Record<string, { ticker: string; name: string; url: string; q: Record<string, [number, number | null, string, number | null]>; div: [string, number][]; w: [string, number, number][]; dl?: [string, number][]; first: string; last: string }>;
}

const T = (name: string, u: Unit, expr: string) => formulaTok(name, u, expr);
const NP: Record<Kind, string> = { ins: 'np', fund: 'xnp' }, EQ: Record<Kind, string> = { ins: 'eq', fund: 'xeq' };
const PE = (k: Kind) => T('P/E', 'x', `mkt_mcap / ${NP[k]}`), PB = (k: Kind) => T('P/B', 'x', `mkt_mcap / ${EQ[k]}`);

/** the board's metrics; the order is the order of the tables */
export const METRICS: BMetric[] = [
  // the stock
  { key: 'mcap', l: 'שווי שוק', sh: 'שווי שוק', u: 'm', dec: 0, better: null, sec: 'mkt', spot: true, hist: { ins: 'mkt:mcap', fund: 'mkt:mcap' } },
  { key: 'pe', l: 'מכפיל רווח (P/E), LTM', sh: 'P/E', u: 'x', dec: 1, better: 'lo', sec: 'mkt', spot: true, hist: { ins: PE('ins'), fund: PE('fund') } },
  { key: 'pb', l: 'מכפיל הון (P/B)', sh: 'P/B', u: 'x', dec: 2, better: 'lo', sec: 'mkt', spot: true, hist: { ins: PB('ins'), fund: PB('fund') } },
  { key: 'pbc', l: 'מחיר להון + CSM נטו ממס', sh: 'P/(B+CSM)', u: 'x', dec: 2, better: 'lo', sec: 'mkt', spot: true,
    hist: { ins: T('P/(B+CSM)', 'x', `mkt_mcap / (eq + csm * ${(1 - TAX / 100).toFixed(4)})`) }, note: `CSM נטו ממס בשיעור ${nf(TAX, 2)}% (הנחה)` },
  { key: 'maum', l: 'שווי שוק לנכסים מנוהלים', sh: 'שווי / AUM', u: 'pct', dec: 2, better: 'lo', sec: 'mkt', spot: true, hist: { fund: T('שווי / AUM', 'pct', 'mkt_mcap / (lts_am_aum * 1000) * 100') } },
  { key: 'dy', l: 'תשואת דיבידנד, LTM', sh: 'תשואת דיב׳', u: 'pct', dec: 1, better: 'hi', sec: 'mkt', spot: true,
    hist: { ins: T('תשואת דיבידנד', 'pct', 'mkt_dps / mkt_px * 100'), fund: T('תשואת דיבידנד', 'pct', 'mkt_dps / mkt_px * 100') } },
  { key: 'r3', l: 'תשואה כוללת, 3 חודשים', sh: '3M', u: 'pctx', dec: 1, better: 'hi', sec: 'mkt', spot: true },
  { key: 'rytd', l: 'תשואה כוללת, YTD', sh: 'YTD', u: 'pctx', dec: 1, better: 'hi', sec: 'mkt', spot: true },
  { key: 'r12', l: 'תשואה כוללת, 12 חודשים', sh: '12M', u: 'pctx', dec: 1, better: 'hi', sec: 'mkt', spot: true },
  // the business
  { key: 'np', l: 'רווח נקי לבעלי המניות, LTM', sh: 'רווח LTM', u: 'm', dec: 0, better: null, sec: 'biz', tok: { ins: 'ifrs:profit_attributable', fund: 'xbrl:profit' } },
  { key: 'npy', l: 'צמיחת רווח נקי, YoY', sh: 'רווח YoY', u: 'pctx', dec: 1, better: 'hi', sec: 'biz', tok: { ins: 'y!ifrs:profit_attributable', fund: 'y!xbrl:profit' } },
  { key: 'roe', l: 'תשואה להון (ROE), LTM', sh: 'ROE', u: 'pct', dec: 1, better: 'hi', sec: 'biz',
    tok: { ins: T('ROE', 'pct', ROE_EXPR), fund: T('ROE', 'pct', 'ann(xnp) / avg(xeq, yago(xeq)) * 100') },
    hist: { ins: T('ROE', 'pct', ROE_EXPR), fund: T('ROE', 'pct', 'ann(xnp) / avg(xeq, yago(xeq)) * 100') } },
  { key: 'revy', l: 'צמיחת הכנסות, YoY', sh: 'הכנסות YoY', u: 'pctx', dec: 1, better: 'hi', sec: 'biz', tok: { ins: 'y!ifrs:insurance_revenue', fund: 'y!xbrl:revenue' } },
  { key: 'isrm', l: 'מרווח שירותי ביטוח', sh: 'מרווח ביטוח', u: 'pct', dec: 1, better: 'hi', sec: 'biz', tok: { ins: T('מרווח שירותי ביטוח', 'pct', 'isr / rev * 100') } },
  { key: 'nm', l: 'שולי רווח נקי', sh: 'שולי רווח', u: 'pct', dec: 1, better: 'hi', sec: 'biz', tok: { fund: T('שולי רווח נקי', 'pct', 'xnp / xbrl_revenue * 100') } },
  { key: 'csm', l: 'CSM, יתרת סגירה', sh: 'CSM', u: 'm', dec: 0, better: null, sec: 'biz', tok: { ins: 'ifrs:csm_closing' } },
  { key: 'csmy', l: 'צמיחת CSM, YoY', sh: 'CSM YoY', u: 'pctx', dec: 1, better: 'hi', sec: 'biz', tok: { ins: 'y!ifrs:csm_closing' } },
  { key: 'csmeq', l: 'CSM להון', sh: 'CSM / הון', u: 'x', dec: 2, better: 'hi', sec: 'biz', tok: { ins: T('CSM / הון', 'x', 'csm / eq') }, hist: { ins: T('CSM / הון', 'x', 'csm / eq') } },
  { key: 'nbrel', l: 'CSM עסק חדש לשחרור, שנתי', sh: 'עסק חדש / שחרור', u: 'pct', dec: 0, better: 'hi', sec: 'biz', tok: { ins: T('עסק חדש / שחרור', 'pct', 'nb / rel * 100') }, freq: 'FY',
    note: 'CSM שנוצר מעסק חדש ÷ CSM ששוחרר לרווח; מעל 100% = יתרת ה-CSM נבנית מעסק חדש' },
  { key: 'aum', l: 'נכסים מנוהלים (AUM)', sh: 'AUM', u: 'bn', dec: 1, better: null, sec: 'biz', tok: { fund: 'lts:am.aum' } },
  { key: 'aumy', l: 'צמיחת נכסים מנוהלים, YoY', sh: 'AUM YoY', u: 'pctx', dec: 1, better: 'hi', sec: 'biz', tok: { ins: 'y!lts:am.aum', fund: 'y!lts:am.aum' } },
  { key: 'eq', l: 'הון לבעלי המניות', sh: 'הון', u: 'm', dec: 0, better: null, sec: 'biz', tok: { ins: 'ifrs:equity_attributable', fund: 'xbrl:equity' } },
  { key: 'eqy', l: 'צמיחת הון, YoY', sh: 'הון YoY', u: 'pctx', dec: 1, better: 'hi', sec: 'biz', tok: { ins: 'y!ifrs:equity_attributable', fund: 'y!xbrl:equity' } },
  { key: 'sr', l: 'יחס כושר פירעון, ללא הוראות מעבר', sh: 'כושר פירעון', u: 'pct', dec: 0, better: 'hi', sec: 'biz', tok: { ins: 'solv:sr_wo' }, lb: 3 },
  // operations: long-term savings (Capital Market Authority files: gemel-net, pensia-net, bituach-net; LTM to the latest quarter)
  ...([
    { key: 'oaum', l: 'נכסים מנוהלים, כל המוצרים', sh: 'נכסים', u: 'bn', dec: 1, better: null, t: 'reg:assets@all' },
    { key: 'open', l: 'נכסים מנוהלים · פנסיה', sh: 'פנסיה', u: 'bn', dec: 1, better: null, t: 'reg:assets@pension' },
    { key: 'ogem', l: 'נכסים מנוהלים · גמל והשתלמות', sh: 'גמל והשתלמות', u: 'bn', dec: 1, better: null, t: 'reg:assets@gemel' },
    { key: 'opol', l: 'נכסים מנוהלים · פוליסות חיסכון (ביטוח-נט)', sh: 'פוליסות', u: 'bn', dec: 1, better: null, t: 'reg:assets@insurance' },
    { key: 'oshare', l: 'נתח שוק בנכסים, כל המוצרים', sh: 'נתח שוק', u: 'pct', dec: 2, better: 'hi', t: 'reg:share@all', h: true },
    { key: 'oshd', l: 'שינוי נתח השוק, שנה', sh: 'Δ נתח, YoY', u: 'pp', dec: 2, better: 'hi', t: T('Δ נתח שוק', 'pct', 'reg_share__all - yago(reg_share__all)'), h: true },
    { key: 'odep', l: 'הפקדות, LTM', sh: 'הפקדות', u: 'bn', dec: 1, better: null, t: 'reg:deposits@all' },
    { key: 'odepy', l: 'צמיחת הפקדות, YoY', sh: 'הפקדות YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!reg:deposits@all' },
    { key: 'owd', l: 'משיכות ופדיונות, LTM', sh: 'משיכות', u: 'bn', dec: 1, better: null, t: 'reg:withdrawals@all' },
    { key: 'owdr', l: 'שיעור משיכות ופדיונות, מנכסים ממוצעים', sh: 'שיעור משיכות', u: 'pct', dec: 1, better: 'lo', h: true,
      t: T('שיעור משיכות', 'pct', 'reg_withdrawals__all / avg(reg_assets__all, yago(reg_assets__all)) * 100'), note: 'משיכות כוללות קצבאות ותשלומי פרישה, לא רק ביטולים' },
    { key: 'otr', l: 'ניוד נטו, LTM', sh: 'ניוד נטו', u: 'bn', dec: 1, better: 'hi', t: 'reg:transfers@all' },
    { key: 'onet', l: 'צבירה נטו כולל ניוד, LTM', sh: 'צבירה נטו', u: 'bn', dec: 1, better: 'hi', t: 'reg:netflow@all' },
    { key: 'onetr', l: 'צבירה נטו לנכסים בתחילת השנה', sh: 'צבירה / נכסים', u: 'pct', dec: 1, better: 'hi', h: true,
      t: T('צבירה נטו / נכסים', 'pct', 'reg_netflow__all / yago(reg_assets__all) * 100'), note: 'צמיחה אורגנית: הפקדות פחות משיכות ועוד ניוד נטו, ביחס לנכסים לפני שנה' },
    { key: 'ofee', l: 'דמי ניהול ממוצעים מנכסים', sh: 'דמי ניהול', u: 'pct', dec: 2, better: null, t: 'reg:fee@all', h: true },
  ] as const).map((x) => ({ key: x.key, l: x.l, sh: x.sh, u: x.u, dec: x.dec, better: x.better, sec: 'ops' as Sec, grp: 'sav' as OpsGrp, ax: 'reg' as const,
    tok: { ins: x.t, fund: x.t }, ...('h' in x ? { hist: { ins: x.t, fund: x.t } } : {}), ...('note' in x ? { note: x.note } : {}) })),
  // operations from the companies' presentations (half-yearly): outgoing transfers (the savings "cancellation" rate) and new pension business
  { key: 'pout', l: 'פנסיה: שיעור ניוד יוצא, שנתי (מצגת החברה)', sh: 'ניוד יוצא פנסיה', u: 'pct', dec: 1, better: 'lo', sec: 'ops', grp: 'sav', freq: 'H', tok: { ins: 'lts:pen.out_rate', fund: 'lts:pen.out_rate' } },
  { key: 'gout', l: 'גמל: שיעור ניוד יוצא, שנתי (מצגת החברה)', sh: 'ניוד יוצא גמל', u: 'pct', dec: 1, better: 'lo', sec: 'ops', grp: 'sav', freq: 'H', tok: { ins: 'lts:gem.out_rate', fund: 'lts:gem.out_rate' } },
  { key: 'pnb', l: 'פנסיה: פרמיה משונתת מעסק חדש (מצגת החברה)', sh: 'עסק חדש פנסיה', u: 'bn', dec: 2, better: 'hi', sec: 'ops', grp: 'sav', freq: 'FY', tok: { ins: 'lts:pen.nb', fund: 'lts:pen.nb' } },
  // operations: insurance (IFRS 17 segment note; premiums where the company reports them)
  ...([
    { key: 'rlife', l: 'הכנסות מביטוח · חיים וחיסכון, LTM', sh: 'חיים', u: 'm', dec: 0, better: null, t: 'ifrs:insurance_revenue@life' },
    { key: 'rhealth', l: 'הכנסות מביטוח · בריאות, LTM', sh: 'בריאות', u: 'm', dec: 0, better: null, t: 'ifrs:insurance_revenue@health' },
    { key: 'rpc', l: 'הכנסות מביטוח · ביטוח כללי, LTM', sh: 'כללי', u: 'm', dec: 0, better: null, t: 'ifrs:insurance_revenue@pc' },
    { key: 'rlifey', l: 'צמיחת הכנסות מביטוח · חיים, YoY', sh: 'חיים YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!ifrs:insurance_revenue@life' },
    { key: 'rhealthy', l: 'צמיחת הכנסות מביטוח · בריאות, YoY', sh: 'בריאות YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!ifrs:insurance_revenue@health' },
    { key: 'rpcy', l: 'צמיחת הכנסות מביטוח · כללי, YoY', sh: 'כללי YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!ifrs:insurance_revenue@pc' },
    { key: 'mhealth', l: 'מרווח שירותי ביטוח · בריאות', sh: 'מרווח בריאות', u: 'pct', dec: 1, better: 'hi',
      t: T('מרווח בריאות', 'pct', 'ifrs_insurance_service_result__health / ifrs_insurance_revenue__health * 100') },
    { key: 'mpc', l: 'מרווח שירותי ביטוח · כללי', sh: 'מרווח כללי', u: 'pct', dec: 1, better: 'hi',
      t: T('מרווח כללי', 'pct', 'ifrs_insurance_service_result__pc / ifrs_insurance_revenue__pc * 100') },
    { key: 'gpc', l: 'פרמיות ברוטו · ביטוח כללי, LTM', sh: 'פרמיות כללי', u: 'm', dec: 0, better: null, t: 'sop:gross_written_premiums@pc', g: 1, note: 'פרמיות ברוטו: מדווח בחלק מהחברות' },
    { key: 'ghealth', l: 'פרמיות ברוטו · בריאות, LTM', sh: 'פרמיות בריאות', u: 'm', dec: 0, better: null, t: 'sop:gross_written_premiums@health', g: 1 },
    { key: 'glife', l: 'פרמיות ברוטו · חיים וחיסכון, LTM', sh: 'פרמיות חיים', u: 'm', dec: 0, better: null, t: 'sop:gross_written_premiums@life', g: 1 },
    { key: 'gpcy', l: 'צמיחת פרמיות ברוטו · כללי, H1 מול H1', sh: 'פרמיות כללי YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!sop:gross_written_premiums@pc', h1: 1 },
    { key: 'ghealthy', l: 'צמיחת פרמיות ברוטו · בריאות, H1 מול H1', sh: 'פרמיות בריאות YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!sop:gross_written_premiums@health', h1: 1 },
    { key: 'glifey', l: 'צמיחת פרמיות ברוטו · חיים, H1 מול H1', sh: 'פרמיות חיים YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!sop:gross_written_premiums@life', h1: 1 },
  ] as const).map((x) => ({ key: x.key, l: x.l, sh: x.sh, u: x.u, dec: x.dec, better: x.better, sec: 'ops' as Sec, grp: 'ins' as OpsGrp, tok: { ins: x.t },
    ...('note' in x ? { note: x.note } : {}), ...('g' in x ? { ltmh: true } : {}), ...('h1' in x ? { freq: 'H' as Freq } : {}) })),
];
export const MBY = new Map(METRICS.map((m) => [m.key, m]));

/** a value with the period it is of (a balance may come from an earlier quarter) */
export type BVal = Val & { p?: string; stale?: boolean };
const none = (title: string, why: string): BVal => ({ v: null, fl: 0, why, prov: () => ({ k: 'none', title, why }) });

export const fmtB = (m: BMetric, v: number): string => {
  if (m.u === 'x') return `${nf(v, m.dec)}x`;
  if (m.u === 'pct') return `${nf(v, m.dec)}%`;
  if (m.u === 'pctx') return `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), m.dec)}%`;
  if (m.u === 'pp') return `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), m.dec)} נק׳`;
  return nf(v, m.dec);
};
export const unitB = (m: BMetric) => (m.u === 'm' ? 'מיליוני ש"ח' : m.u === 'bn' ? 'מיליארדי ש"ח' : m.u === 'x' ? 'מכפיל' : m.u === 'pp' ? 'נק׳ אחוז' : '%');
const mil = (v: number) => `${nf(v, 0)} מיליוני ש"ח`;

/** which metrics a set shows: insurers see CSM and solvency, fund houses AUM and margin; a mixed set shows what applies to its majority */
export function metricsFor(kinds: Kind[]): BMetric[] {
  const ins = kinds.filter((k) => k === 'ins').length >= kinds.length / 2;
  const k: Kind = ins ? 'ins' : 'fund';
  return METRICS.filter((m) => (m.spot ? (m.key === 'pbc' ? ins : m.key === 'maum' ? !ins : true) : !!m.tok?.[k]));
}

/* ---------- business cells ---------- */
const colCache = new WeakMap<Book, Map<string, Col>>();
function colOf(book: Book, tok: string): Col {
  let m = colCache.get(book); if (!m) { m = new Map(); colCache.set(book, m); }
  let c = m.get(tok); if (!c) { c = parseCol(tok, book); m.set(tok, c); }
  return c;
}
/** token ids a metric list needs loaded (the peer table's useBook) */
export function needIds(book: Book | null, ms: BMetric[], hist: boolean): string[] {
  if (!book) return [];
  const out = new Set<string>(['mkt:mcap', 'mkt:px', 'mkt:dps']);
  ms.forEach((m) => [...Object.values(m.tok ?? {}), ...(hist ? Object.values(m.hist ?? {}) : [])].forEach((t) => colOf(book, t).ids.forEach((id) => out.add(id))));
  return [...out];
}
export function bizVal(book: Book, m: BMetric, ent: string, kind: Kind, p: string, peers: string[]): BVal {
  const tok = m.tok?.[kind];
  if (!tok) return none(m.l, kind === 'ins' ? 'לא רלוונטי למבטחת' : 'לא רלוונטי לבית השקעות');
  const c = colOf(book, tok);
  if (m.freq === 'H') {
    // a half-yearly disclosure: the latest half or full year up to the board's quarter
    const y = Number(p.slice(0, 4)), q = Number(p.slice(-1));
    const cand: [Freq, string][] = [...(q >= 4 ? [['FY', `${y}FY`] as [Freq, string]] : []), ...(q >= 2 ? [['H', `${y}H1`] as [Freq, string]] : []), ['FY', `${y - 1}FY`], ['H', `${y - 1}H1`]];
    for (const [i, [f, pp]] of cand.entries()) { const x = cellVal(book, c, ent, f, pp, peers); if (x.v != null && Number.isFinite(x.v)) return { ...x, p: pp, stale: i > 0 }; }
    return none(m.l, 'אין נתון מהמצגת');
  }
  if (m.freq === 'FY') {
    const y = Number(p.slice(0, 4)) - (p.endsWith('Q4') ? 0 : 1);
    for (const fy of [`${y}FY`, `${y - 1}FY`]) { const x = cellVal(book, c, ent, 'FY', fy, peers); if (x.v != null && Number.isFinite(x.v)) return { ...x, p: fy, stale: fy !== `${y}FY` }; }
    return none(m.l, 'אין נתון שנתי');
  }
  let last: BVal | null = null;
  for (let i = 0; i <= (m.lb ?? 1); i++) {
    const q = back('LTM', p, i), x = cellVal(book, c, ent, 'LTM', q, peers);
    if (x.v != null && Number.isFinite(x.v)) return { ...x, p: q, stale: i > 0 };
    if (i === (m.lb ?? 1)) last = { ...x, p: q };
  }
  if (m.ltmh) { const h = ltmFromHalves(book, c, m, ent, p, peers); if (h) return h; }
  return last ?? none(m.l, 'אין נתון');
}
/** LTM from halves and years: at Q4 the year itself; at Q2/Q3 last FY + this H1 − last H1; at Q1 last FY (marked earlier) */
function ltmFromHalves(book: Book, c: Col, m: BMetric, ent: string, p: string, peers: string[]): BVal | null {
  const y = Number(p.slice(0, 4)), q = Number(p.slice(-1));
  const get = (f: Freq, pp: string) => { const x = cellVal(book, c, ent, f, pp, peers); return x.v != null && Number.isFinite(x.v) ? x : null; };
  if (q === 4) { const fy = get('FY', `${y}FY`); return fy ? { ...fy, p: `${y}Q4` } : null; }
  const fy = get('FY', `${y - 1}FY`);
  if (!fy) return null;
  if (q === 1) return { ...fy, p: `${y - 1}Q4`, stale: true };
  const h1 = get('H', `${y}H1`), h0 = get('H', `${y - 1}H1`);
  if (!h1 || !h0) return { ...fy, p: `${y - 1}Q4`, stale: true };
  const v = fy.v! + h1.v! - h0.v!, title = `${m.l} · ${book.name(ent)}`;
  return { v, fl: 0, p: `${y}Q2`, stale: q === 3, prov: () => ({ k: 'calc', title, value: fmtB(m, v), unit: unitB(m), formula: `LTM = שנת ${y - 1} + H1 ${y} − H1 ${y - 1} (הנתון מתפרסם לחציונים ולשנים)`,
    inputs: [{ label: `FY${y - 1}`, v: mil(fy.v!), src: fy.prov }, { label: `H1 ${y}`, v: mil(h1.v!), src: h1.prov }, { label: `H1 ${y - 1}`, v: mil(h0.v!), src: h0.prov }] }) };
}
/** a metric on the LTM axis at quarter end (the history chart) */
export function histVal(book: Book, m: BMetric, ent: string, kind: Kind, p: string, peers: string[]): Val | null {
  const tok = m.hist?.[kind];
  if (!tok) return null;
  const x = cellVal(book, colOf(book, tok), ent, 'LTM', p, peers);
  if (x.v == null || !Number.isFinite(x.v)) return x;
  if ((m.key === 'pe' || m.key === 'pb' || m.key === 'pbc') && x.v <= 0) return { ...x, v: null, why: 'רווח או הון שלילי: המכפיל אינו בעל משמעות' };
  return x;
}

/* ---------- spot market cells ---------- */
const vendor = (p: TasePrice) => `${p.source}${p.ticker ? ` · נייר ${p.ticker}` : ''}`;
function pxProv(p: TasePrice): Prov { return { k: 'price', title: 'מחיר סגירה', value: `${nf(p.last / 100, 2)} ש"ח`, ticker: p.name ?? p.ticker, vendor: vendor(p), date: p.asof }; }
function mcapProv(p: TasePrice): Prov { return { k: 'price', title: 'שווי שוק כפי שמפרסמת הבורסה', value: mil(p.mcap!), ticker: p.name ?? p.ticker, vendor: vendor(p), date: p.asof }; }
/** the total-return index on or before a date (weekly closes, dividends reinvested) */
function trAt(pts: [string, number][], d: string): [string, number] | null {
  let hit: [string, number] | null = null;
  for (const [dd, tr] of pts) { if (dd <= d) hit = [dd, tr]; else break; }
  return hit;
}
/** the same day `months` earlier, clamped to the month's last day (31.05 − 3 months = 28/29.02, not 03.03) */
export const minus = (d: string, months: number) => {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 - months, day = Number(d.slice(8, 10));
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
};

export interface SpotIn { book: Book; ent: string; kind: Kind; p: string; peers: string[]; px: TasePrice | null; mk: MktFile | null }
export function spotVal(m: BMetric, a: SpotIn): BVal {
  const { px, book, ent, kind, p, peers } = a, nm = book.name(ent), title = `${m.l} · ${nm}`;
  if (!px) return none(title, 'לחברה אין מניה רשומה או קובץ מחיר');
  if (m.key === 'mcap') return px.mcap != null ? { v: px.mcap, fl: 0, p: px.asof, prov: () => mcapProv(px) } : none(title, 'הבורסה לא פרסמה שווי שוק');
  if (m.key === 'r3' || m.key === 'r12' || m.key === 'rytd') {
    const e0 = a.mk?.ents[ent];
    // daily index points for the last ~13 months (exact window ends); weekly before that
    const pts: [string, number][] = e0?.dl?.length ? e0.dl : (e0?.w ?? []).map(([d, , tr]) => [d, tr] as [string, number]);
    if (!pts.length) return none(title, 'אין היסטוריית מחירים');
    const [d1, tr1] = pts[pts.length - 1];
    const from = m.key === 'r3' ? minus(d1, 3) : m.key === 'r12' ? minus(d1, 12) : `${Number(d1.slice(0, 4)) - 1}-12-31`;
    const s = trAt(pts, from);
    if (!s || s[0] < minus(from, 1) || pts[0][0] > from) return none(title, 'ההיסטוריה קצרה מהחלון');
    const v = (tr1 / s[1] - 1) * 100, e = a.mk!.ents[ent];
    return { v, fl: 0, p: d1, prov: () => ({ k: 'calc', title, value: fmtB(m, v), unit: '%', formula: 'תשואה כוללת = מדד סוף ÷ מדד התחלה − 1; דיבידנד מושקע מחדש בשער הסגירה ביום האקס',
      inputs: [{ label: `מדד, ${pubLabel(s[0])}`, v: nf(s[1], 4) }, { label: `מדד, ${pubLabel(d1)}`, v: nf(tr1, 4) },
        { label: 'מקור השערים', v: `TASE · נייר ${e.ticker}`, src: () => ({ k: 'price', title: 'שערי סגירה יומיים', value: `${pts.length} ימי מסחר`, ticker: e.name, vendor: `TASE · נייר ${e.ticker}`, date: d1 }) }] }) };
  }
  if (m.key === 'dy') {
    if (!px.dates?.length || px.dates[0] > minus(px.asof, 12)) return none(title, 'קובץ המחיר קצר מ-12 חודשים');
    const lo = minus(px.asof, 12), dps = px.dividends.filter(([d]) => d > lo).reduce((s, [, v]) => s + v, 0) / 100, last = px.last / 100;
    const v = (dps / last) * 100;
    return { v, fl: 0, p: px.asof, prov: () => ({ k: 'calc', title, value: fmtB(m, v), unit: '%', est: true, formula: 'תשואת דיבידנד = דיבידנד למניה ב-12 החודשים האחרונים (לפי יום האקס) ÷ מחיר',
      inputs: [{ label: 'דיבידנד למניה, 12 חודשים', v: `${nf(dps, 2)} ש"ח`, src: () => ({ k: 'price', title: 'דיבידנד למניה לפי יום האקס (נגזר משער הבסיס)', value: `${nf(dps, 2)} ש"ח`, ticker: px.name ?? px.ticker, vendor: vendor(px), date: px.asof }) },
        { label: 'מחיר', v: `${nf(last, 2)} ש"ח`, src: () => pxProv(px) }] }) };
  }
  if (px.mcap == null) return none(title, 'אין שווי שוק');
  const mc = px.mcap;
  const fund = (key: string) => bizVal(book, MBY.get(key)!, ent, kind, p, peers);
  const ratio = (den: BVal, denLabel: string, formula: string, scale = 1): BVal => {
    if (den.v == null) return none(title, den.why ?? `חסר ${denLabel}`);
    if (den.v <= 0) return none(title, `${denLabel} שלילי: המכפיל אינו בעל משמעות`);
    const v = (mc / den.v) * scale;
    return { v, fl: 0, p: den.p, stale: den.stale, prov: () => ({ k: 'calc', title, value: fmtB(m, v), unit: unitB(m), est: true, formula,
      inputs: [{ label: `שווי שוק, ${pubLabel(px.asof)}`, v: mil(mc), src: () => mcapProv(px) }, { label: `${denLabel}, ${plab('LTM', den.p ?? p).replace('LTM ', '')}`, v: mil(den.v!), src: den.prov }] }) };
  };
  if (m.key === 'pe') return ratio(fund('np'), 'רווח נקי LTM', 'P/E = שווי שוק (סגירה אחרונה) ÷ רווח נקי לבעלי המניות, LTM');
  if (m.key === 'pb') return ratio(fund('eq'), 'הון לבעלי המניות', 'P/B = שווי שוק (סגירה אחרונה) ÷ הון לבעלי המניות');
  if (m.key === 'maum') {
    // AUM is stored in NIS billions: to millions before the ratio
    const a = bizVal(book, { ...MBY.get('aum')!, tok: { ins: 'lts:am.aum', fund: 'lts:am.aum' } }, ent, kind, p, peers);
    const scale = book.byId.get('lts:am.aum')?.u === 'bn' ? 1000 : 1;
    return ratio(a.v == null ? a : { ...a, v: a.v * scale }, 'נכסים מנוהלים (מיליוני ש"ח)', 'שווי שוק ÷ נכסים מנוהלים', 100);
  }
  if (m.key === 'pbc') {
    const eq = fund('eq'), csm = fund('csm');
    if (eq.v == null || csm.v == null) return none(title, eq.v == null ? 'חסר הון' : 'חסר CSM');
    if (eq.p !== csm.p) return none(title, 'ההון וה-CSM אינם מאותו רבעון');
    if (eq.v <= 0) return none(title, 'הון שלילי: המכפיל אינו בעל משמעות');
    const net = csm.v * (1 - TAX / 100), den = eq.v + net, v = mc / den;
    if (den <= 0) return none(title, 'מכנה שלילי');
    return { v, fl: 0, p: eq.p, stale: eq.stale || csm.stale, prov: () => ({ k: 'calc', title, value: fmtB(m, v), unit: 'מכפיל', est: true, formula: `מחיר להון + CSM = שווי שוק ÷ (הון + CSM × (1 − ${nf(TAX, 2)}%)); שיעור המס הנחה`,
      inputs: [{ label: `שווי שוק, ${pubLabel(px.asof)}`, v: mil(mc), src: () => mcapProv(px) }, { label: 'הון לבעלי המניות', v: mil(eq.v!), src: eq.prov },
        { label: 'CSM, יתרת סגירה', v: mil(csm.v!), src: csm.prov }, { label: 'CSM נטו ממס (הנחה)', v: mil(net) }] }) };
  }
  return none(title, 'מדד לא מוכר');
}

/* ---------- statistics ---------- */
export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
export interface Stat { med: number | null; avg: number | null; min: number; max: number; n: number; rank: Map<string, number>; pct: Map<string, number> }
/** rank 1 = best (or largest when the metric has no direction); pct 0..1 where 1 = best (or largest) */
export function statOf(m: BMetric, vals: Map<string, number | null>): Stat {
  const xs = [...vals].filter((x): x is [string, number] => x[1] != null && Number.isFinite(x[1]));
  const ord = [...xs].sort((a, b) => (m.better === 'lo' ? a[1] - b[1] : b[1] - a[1]));
  const rank = new Map(ord.map(([e], i) => [e, i + 1]));
  const pct = new Map(ord.map(([e], i) => [e, ord.length > 1 ? 1 - i / (ord.length - 1) : 0.5]));
  const vs = xs.map((x) => x[1]);
  return { med: median(vs), avg: mean(vs), min: Math.min(...vs), max: Math.max(...vs), n: vs.length, rank, pct };
}
/** the sum of market values over the sum of the denominators: the set's own multiple, weighted by size */
export function aggMultiple(mc: (number | null)[], den: (number | null)[]): number | null {
  let a = 0, b = 0;
  mc.forEach((x, i) => { const d = den[i]; if (x != null && d != null && d > 0) { a += x; b += d; } });
  return b > 0 ? a / b : null;
}
/** least squares y = a + b·x, with R² */
export function ols(pts: [number, number][]): { a: number; b: number; r2: number } | null {
  if (pts.length < 3) return null;
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0), syy = pts.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  if (!sxx || !syy) return null;
  const b = sxy / sxx, a = my - b * mx;
  return { a, b, r2: (sxy * sxy) / (sxx * syy) };
}
export const FREQ_LTM: Freq = 'LTM';
