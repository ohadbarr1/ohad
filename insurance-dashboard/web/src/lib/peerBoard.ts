/** The comparison board of the peer table: the stock (market value, multiples, yield, total return) and the business (profitability,
 *  growth, CSM, capital) of a peer set side by side, with ranks, medians, a focus company, and the series the charts draw.
 *  Business figures are the peer table's own cells (lib/registry + lib/seriesCols), so every number opens the same source.
 *  Market figures are TASE closes: "spot" multiples use the latest close over the latest reported figures; history uses the close
 *  on the last trading day of each quarter (mkt:* in the registry), so P/E and P/B over time are formulas over printed figures. */
import { nf, pubLabel, sn } from './format';
import { placeGroups } from './pageMonths';
import type { Prov } from './prov';
import { chgLag, chgPct, chgPts, fmtBnDiff, fmtPct, fmtPts, isChg, qBack, qlab, readLabel, type QRead } from './quarters';
import { back, F_DER, plab, type Book, type Freq, type Unit, type Val } from './registry';
import { carriedVal, cellVal, formulaTok, parseCol, ROE_EXPR, type Col } from './seriesCols';
import type { TasePrice } from './valuation';
export type { QRead } from './quarters';

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
  /** computed for the charts (a denominator), not a table column */
  hide?: boolean;
  /* ---- phase 6, the board (spec 3.3, 13.2): set on every metric by SHAPE below ---- */
  /** spot: latest close ÷ latest report · ret: total return · flow: summed over quarters · bal: at the period end · ratio · half / fy: one
   *  semi-annual or annual reading with its period as a tag */
  type?: MType;
  /** the board's readings, the default first; absent = not a board metric (a change column of the tables, `of` its base) */
  reads?: QRead[];
  /** a flow that changes sign (net accumulation, net transfers): its change is a difference in ₪bn, never a percent */
  diff?: boolean;
  /** the changes are on the LTM figure (ROE, accumulation / assets): "LTM מול LTM" */
  cb?: 'ltm';
  /** a flow rate (a margin): reads a single quarter as well as LTM, and its single-quarter readings are quarter-named */
  fr?: boolean;
  /** a change column of the tables: the board reaches it as this base metric's YoY */
  of?: string;
  /** the table's change column that pairs with this level (npy beside np) */
  yk?: string;
  /** the board's short name when the table's differs ("רווח נקי" against "רווח LTM") */
  bsh?: string;
}
export type MType = 'spot' | 'ret' | 'flow' | 'bal' | 'ratio' | 'half' | 'fy';
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
    { key: 'opol', l: 'נכסים מנוהלים · ביטוחי מנהלים ופוליסות חיסכון (ביטוח-נט)', sh: 'ביטוח-נט', u: 'bn', dec: 1, better: null, t: 'reg:assets@insurance',
      note: 'ביטוח-נט: כל הנכסים בפוליסות ביטוח החיים המשתתפות ברווחים, ביטוחי מנהלים ופוליסות חיסכון; "פוליסות השקעה" במצגות החברות הן חוזי השקעה בלבד (IFRS 9), חלק מהסכום' },
    { key: 'oshare', l: 'נתח שוק בנכסים, כל המוצרים', sh: 'נתח שוק', u: 'pct', dec: 2, better: 'hi', t: 'reg:share@all', h: true },
    { key: 'oshd', l: 'שינוי נתח השוק, שנה', sh: 'Δ נתח, YoY', u: 'pp', dec: 2, better: 'hi', t: T('Δ נתח שוק', 'pct', 'reg_share__all - yago(reg_share__all)'), h: true },
    { key: 'odep', l: 'הפקדות, LTM', sh: 'הפקדות', u: 'bn', dec: 1, better: null, t: 'reg:deposits@all' },
    { key: 'odepy', l: 'צמיחת הפקדות, YoY', sh: 'הפקדות YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!reg:deposits@all' },
    { key: 'owd', l: 'משיכות ופדיונות, LTM', sh: 'משיכות', u: 'bn', dec: 1, better: null, t: 'reg:withdrawals@all' },
    { key: 'owdr', l: 'שיעור משיכות ופדיונות, מנכסים ממוצעים', sh: 'שיעור משיכות', u: 'pct', dec: 1, better: 'lo', h: true,
      t: T('שיעור משיכות', 'pct', 'reg_withdrawals__all / avg(reg_flowassets__all, yago(reg_flowassets__all)) * 100'), note: 'משיכות כוללות קצבאות ותשלומי פרישה, לא רק ביטולים; הבסיס: נכסי פנסיה וגמל (לפוליסות אין נתוני תזרים)' },
    { key: 'otr', l: 'ניוד נטו, LTM', sh: 'ניוד נטו', u: 'bn', dec: 1, better: 'hi', t: 'reg:transfers@all' },
    { key: 'onet', l: 'צבירה נטו כולל ניוד, LTM', sh: 'צבירה נטו', u: 'bn', dec: 1, better: 'hi', t: 'reg:netflow@all' },
    { key: 'onetr', l: 'צבירה נטו לנכסים בתחילת השנה', sh: 'צבירה / נכסים', u: 'pct', dec: 1, better: 'hi', h: true,
      t: T('צבירה נטו / נכסים', 'pct', 'reg_netflow__all / yago(reg_flowassets__all) * 100'), note: 'צבירה נטו: הפקדות פחות משיכות ועוד ניוד נטו (צבירה אורגנית, כמו בדף החברה, היא בלי ניוד), ביחס לנכסי פנסיה וגמל לפני שנה' },
    { key: 'ofee', l: 'דמי ניהול ממוצעים מנכסים', sh: 'דמי ניהול', u: 'pct', dec: 2, better: null, t: 'reg:fee@all', h: true },
    { key: 'oflowa', l: 'נכסים במוצרים עם נתוני תזרים (פנסיה, גמל והשתלמות)', sh: 'בסיס תזרים', u: 'bn', dec: 1, better: null, t: 'reg:flowassets@all', hide: true },
  ] as const).map((x) => ({ key: x.key, l: x.l, sh: x.sh, u: x.u, dec: x.dec, better: x.better, sec: 'ops' as Sec, grp: 'sav' as OpsGrp, ax: 'reg' as const,
    tok: { ins: x.t, fund: x.t }, ...('h' in x ? { hist: { ins: x.t, fund: x.t } } : {}), ...('note' in x ? { note: x.note } : {}), ...('hide' in x ? { hide: true } : {}) })),
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
    { key: 'gpcy', l: 'צמיחת פרמיות ברוטו · כללי, YoY (H1 או שנה)', sh: 'פרמיות כללי YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!sop:gross_written_premiums@pc', h1: 1 },
    { key: 'ghealthy', l: 'צמיחת פרמיות ברוטו · בריאות, YoY (H1 או שנה)', sh: 'פרמיות בריאות YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!sop:gross_written_premiums@health', h1: 1 },
    { key: 'glifey', l: 'צמיחת פרמיות ברוטו · חיים, YoY (H1 או שנה)', sh: 'פרמיות חיים YoY', u: 'pctx', dec: 1, better: 'hi', t: 'y!sop:gross_written_premiums@life', h1: 1 },
  ] as const).map((x) => ({ key: x.key, l: x.l, sh: x.sh, u: x.u, dec: x.dec, better: x.better, sec: 'ops' as Sec, grp: 'ins' as OpsGrp, tok: { ins: x.t },
    ...('note' in x ? { note: x.note } : {}), ...('g' in x ? { ltmh: true } : {}), ...('h1' in x ? { freq: 'H' as Freq } : {}) })),
];

/* ---------- phase 6: the shape of every metric on the board (spec 3.3; readings 13.1 F2) ---------- */
const F5: QRead[] = ['ltm', 'ltmy', 'q', 'yoy', 'qoq'], B3: QRead[] = ['q', 'yoy', 'qoq'], NOW: QRead[] = ['now'], ONE: QRead[] = ['q'];
const SHAPE: Record<string, Partial<BMetric>> = {
  mcap: { type: 'spot', reads: NOW }, pe: { type: 'spot', reads: NOW }, pb: { type: 'spot', reads: NOW }, pbc: { type: 'spot', reads: NOW },
  maum: { type: 'spot', reads: NOW }, dy: { type: 'spot', reads: NOW },
  r3: { type: 'ret', of: 'tr' }, rytd: { type: 'ret', of: 'tr' }, r12: { type: 'ret', of: 'tr' },
  np: { type: 'flow', reads: F5, yk: 'npy', bsh: 'רווח נקי' }, npy: { type: 'flow', of: 'np' },
  roe: { type: 'ratio', reads: ['ltm', 'yoy', 'qoq'], cb: 'ltm' },
  revy: { type: 'flow', of: 'rev' },
  isrm: { type: 'ratio', fr: true, reads: F5 }, nm: { type: 'ratio', fr: true, reads: F5 },
  csm: { type: 'bal', reads: B3, yk: 'csmy' }, csmy: { type: 'bal', of: 'csm' },
  csmeq: { type: 'ratio', reads: B3 },
  nbrel: { type: 'fy', reads: ONE },
  aum: { type: 'bal', reads: B3, yk: 'aumy' }, aumy: { type: 'bal', of: 'aum' },
  eq: { type: 'bal', reads: B3, yk: 'eqy' }, eqy: { type: 'bal', of: 'eq' },
  sr: { type: 'half', reads: ONE },
  oaum: { type: 'bal', reads: B3 }, open: { type: 'bal', reads: B3 }, ogem: { type: 'bal', reads: B3 }, opol: { type: 'bal', reads: B3 },
  oshare: { type: 'ratio', reads: B3, yk: 'oshd' }, oshd: { type: 'ratio', of: 'oshare' },
  odep: { type: 'flow', reads: F5, yk: 'odepy' }, odepy: { type: 'flow', of: 'odep' },
  owd: { type: 'flow', reads: F5 },
  owdr: { type: 'ratio', reads: ['ltm'], cb: 'ltm' },
  otr: { type: 'flow', reads: F5, diff: true }, onet: { type: 'flow', reads: F5, diff: true },
  onetr: { type: 'ratio', reads: ['ltm', 'yoy'], cb: 'ltm' },
  ofee: { type: 'ratio', reads: B3 },
  oflowa: { type: 'bal', reads: B3 },
  pout: { type: 'half', reads: ONE }, gout: { type: 'half', reads: ONE }, pnb: { type: 'fy', reads: ONE },
  rlife: { type: 'flow', reads: F5, yk: 'rlifey' }, rhealth: { type: 'flow', reads: F5, yk: 'rhealthy' }, rpc: { type: 'flow', reads: F5, yk: 'rpcy' },
  rlifey: { type: 'flow', of: 'rlife' }, rhealthy: { type: 'flow', of: 'rhealth' }, rpcy: { type: 'flow', of: 'rpc' },
  mhealth: { type: 'ratio', fr: true, reads: F5 }, mpc: { type: 'ratio', fr: true, reads: F5 },
  // premiums are filed by halves and years at most companies: LTM only (LTM from halves where the quarterly chain is missing)
  gpc: { type: 'flow', reads: ['ltm'] }, ghealth: { type: 'flow', reads: ['ltm'] }, glife: { type: 'flow', reads: ['ltm'] },
  gpcy: { type: 'flow', of: 'gpc' }, ghealthy: { type: 'flow', of: 'ghealth' }, glifey: { type: 'flow', of: 'glife' },
};
METRICS.forEach((m) => Object.assign(m, SHAPE[m.key]));
/** board-only metrics: total return with its three windows as readings, and insurance revenue (the tables carry only its YoY) */
export const BOARD_EXTRA: BMetric[] = [
  { key: 'tr', l: 'תשואה כוללת', sh: 'תשואה כוללת', u: 'pctx', dec: 1, better: 'hi', sec: 'mkt', spot: true, type: 'ret', reads: ['r12', 'rytd', 'r3'] },
  { key: 'rev', l: 'הכנסות משירותי ביטוח', sh: 'הכנסות ביטוח', u: 'm', dec: 0, better: null, sec: 'biz', tok: { ins: 'ifrs:insurance_revenue' }, type: 'flow', reads: F5, yk: 'revy' },
];
export const MBY = new Map(METRICS.map((m) => [m.key, m]));
/** every metric by key, the board's extras included */
export const BBY = new Map([...METRICS, ...BOARD_EXTRA].map((m) => [m.key, m]));

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
  if (q === 4) { const fy = get('FY', `${y}FY`); if (fy) return { ...fy, p: `${y}Q4` }; }  // not filed yet: the Q2 figure below, marked earlier
  const fy = get('FY', `${y - 1}FY`);
  if (!fy) return null;
  if (q === 1) return { ...fy, p: `${y - 1}Q4`, stale: true };
  const h1 = get('H', `${y}H1`), h0 = get('H', `${y - 1}H1`);
  if (!h1 || !h0) return { ...fy, p: `${y - 1}Q4`, stale: true };
  const v = fy.v! + h1.v! - h0.v!, title = `${m.l} · ${book.name(ent)}`;
  return { v, fl: 0, p: `${y}Q2`, stale: q >= 3, prov: () => ({ k: 'calc', title, value: fmtB(m, v), unit: unitB(m), formula: `LTM = שנת ${y - 1} + H1 ${y} − H1 ${y - 1} (הנתון מתפרסם לחציונים ולשנים)`,
    inputs: [{ label: `FY${y - 1}`, v: mil(fy.v!), src: fy.prov }, { label: `H1 ${y}`, v: mil(h1.v!), src: h1.prov }, { label: `H1 ${y - 1}`, v: mil(h0.v!), src: h0.prov }] }) };
}
/** a metric on the LTM axis at quarter end (the history chart). `carry` (the board's quarter only): a company that has not reported the
 *  quarter yet is read by the board's rule (CARRY_RULE, seriesCols.carriedVal): its latest reported figures, the market at the quarter end. */
export function histVal(book: Book, m: BMetric, ent: string, kind: Kind, p: string, peers: string[], carry = false): BVal | null {
  const tok = m.hist?.[kind];
  if (!tok) return null;
  const c = colOf(book, tok);
  let x: BVal = cellVal(book, c, ent, 'LTM', p, peers);
  if ((x.v == null || !Number.isFinite(x.v)) && carry) { const y = carriedVal(book, c, ent, 'LTM', p, peers); if (y) x = { ...y, p: y.from, stale: true }; }
  if (x.v == null || !Number.isFinite(x.v)) return x;
  if ((m.key === 'pe' || m.key === 'pb' || m.key === 'pbc') && x.v <= 0) return { ...x, v: null, why: 'רווח או הון שלילי: המכפיל אינו בעל משמעות' };
  return x;
}
/** the rule for a quarter not every company has reported (the board, the free table, the history chart and their medians; Methodology #peers) */
export const CARRY_RULE = 'חברה שטרם דיווחה על הרבעון: הנתון האחרון שדיווחה (רבעון אחד אחורה; כושר פירעון עד שלושה), מסומן * עם התקופה שלו, ונכלל בחציון, בממוצע ובדירוג. מכפיל לאורך זמן: שווי השוק בסוף הרבעון ÷ הנתון המדווח האחרון. סכום מוצג רק כשכל הרכיבים מאותה תקופה.';

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

/* ======================= phase 6: readings, the board, the quarters grid (spec 3.3, 4, 13.2, 14.3) ======================= */
/** the board's metrics for a set: the table metrics with a reading (change columns and the three return windows fold into their base),
 *  plus total return and insurance revenue; the order is the order of the sections */
export function boardMetrics(kinds: Kind[]): BMetric[] {
  const ins = kinds.filter((k) => k === 'ins').length >= kinds.length / 2;
  const base = metricsFor(kinds).filter((m) => m.reads?.length && !m.of && !m.hide);
  const extra = BOARD_EXTRA.filter((m) => (m.key === 'rev' ? ins : base.some((b) => b.spot)));
  const secs: Sec[] = ['mkt', 'biz', 'ops'];
  return [...base, ...extra].sort((a, b) => secs.indexOf(a.sec) - secs.indexOf(b.sec));
}
/** the board's short name */
export const shOf = (m: BMetric) => m.bsh ?? m.sh;
/** the reading a metric opens on, and a requested reading checked against the metric's own */
export const defRead = (m: BMetric): QRead => m.reads?.[0] ?? 'now';
export const readOf = (m: BMetric, rd: QRead | null | undefined): QRead => (rd && m.reads?.includes(rd) ? rd : defRead(m));
/** the level a change is computed on: the LTM figure (LTM YoY; ROE, accumulation / assets) or the quarter's (flows, balances, margins) */
export const chgBase = (m: BMetric, rd: QRead): 'ltm' | 'q' => (rd === 'ltmy' || m.cb === 'ltm' ? 'ltm' : m.reads?.includes('q') || m.type !== 'ratio' ? 'q' : 'ltm');
/** a ratio changes in points (in "x" for CSM / equity), a sign-changing flow as a ₪bn difference, everything else in percent */
export const chgKind = (m: BMetric): 'pts' | 'diff' | 'pct' => (m.type === 'ratio' ? 'pts' : m.diff ? 'diff' : 'pct');
/** 13.2 rule 2: a reading named after the quarter (a flow's or a margin's single quarter; YoY / QoQ of a quarter's figure) is never
 *  carried: it ranks only the companies that reported the quarter. Regulator, market, half-year and annual readings never are. */
export function quarterNamed(m: BMetric, rd: QRead): boolean {
  if (m.ax === 'reg' || m.type === 'spot' || m.type === 'ret' || m.type === 'half' || m.type === 'fy') return false;
  if (rd === 'q') return m.type === 'flow' || !!m.fr;
  if (rd === 'yoy' || rd === 'qoq') return chgBase(m, rd) === 'q';
  return false;
}
/** written next to every change (13.1 F2): "Q3'26 מול Q2'26", "LTM Q3'26 מול LTM Q3'25"; '' for a level */
export function basisText(m: BMetric, rd: QRead, q: string): string {
  if (!isChg(rd)) return '';
  const p = chgBase(m, rd) === 'ltm' ? 'LTM ' : '';
  return `${p}${qlab(q)} מול ${p}${qlab(qBack(q, chgLag(rd)))}`;
}
/** the short form for a table head: "LTM מול LTM" (QoQ: "LTM מול LTM קודם"), or "מול Q3'25" */
export function basisShort(m: BMetric, rd: QRead, q: string): string {
  if (!isChg(rd)) return '';
  return chgBase(m, rd) === 'ltm' ? `LTM מול LTM${rd === 'qoq' ? ' קודם' : ''}` : `מול ${qlab(qBack(q, chgLag(rd)))}`;
}
/** 14.3 rule 2: the YoY that sits beside a level in a table takes the level's basis: LTM against LTM for flows and flow rates, quarter
 *  end against quarter end for balances and other ratios; null when the metric has no change */
export function pairRead(m: BMetric): QRead | null {
  if (m.type === 'flow' || m.fr) return m.reads?.includes('ltmy') ? 'ltmy' : null;
  if (m.type === 'bal' || m.type === 'ratio') return m.reads?.includes('yoy') ? 'yoy' : null;
  return null;
}
/** a figure of a reading: levels as the tables print them; changes signed with their unit ("+7.1%", "+0.34 נק׳", "+0.05x", "+8.7 מ׳ד") */
export function fmtRead(m: BMetric, rd: QRead, v: number): string {
  if (isChg(rd)) {
    const k = chgKind(m);
    if (k === 'pts') return m.u === 'x' ? `${sn(v, 2)}x` : fmtPts(v, m.dec >= 2 ? 2 : 1);
    return k === 'diff' ? fmtBnDiff(v, m.dec) : fmtPct(v, 1);
  }
  return m.diff ? sn(v, m.dec) : fmtB(m, v);
}
/** the unit line of a reading */
export const unitRead = (m: BMetric, rd: QRead) => (!isChg(rd) ? unitB(m) : chgKind(m) === 'pts' ? (m.u === 'x' ? 'שינוי במכפיל' : 'שינוי בנקודות') : chgKind(m) === 'diff' ? 'שינוי, מיליארדי ש"ח' : 'שינוי באחוזים');
/** the label of a level at a quarter: "LTM Q3'26" or "Q3'26" */
const levelLab = (base: 'ltm' | 'q', q: string) => (base === 'ltm' ? `LTM ${qlab(q)}` : qlab(q));

/* ---------- the CSM basis (14.3 rule 4) ---------- */
export type CsmBasis = 'net' | 'gross';
export const CSM_BASIS_HE: Record<CsmBasis, string> = { net: 'נטו', gross: 'ברוטו' };
const CSM_ID = 'ifrs:csm_closing';
/** the basis a CSM figure was printed on (the cell's label: "נטו · קבוצה", "ברוטו · חיים ועוד בריאות"); null = not stated */
export function csmBasis(book: Book, ent: string, q: string): CsmBasis | null {
  const lab = (book.raw(CSM_ID, ent, q) as unknown[] | undefined)?.[5];
  return typeof lab === 'string' ? (lab.startsWith('ברוטו') ? 'gross' : lab.startsWith('נטו') ? 'net' : null) : null;
}
/** the basis of the company's latest CSM figure that states one */
export function latestCsmBasis(book: Book, ent: string): CsmBasis | null {
  const ps = book.periods(CSM_ID).filter((p) => /Q\d$/.test(p));
  for (let i = ps.length - 1; i >= 0; i--) { if (book.raw(CSM_ID, ent, ps[i])) { const b = csmBasis(book, ent, ps[i]); if (b) return b; } }
  return null;
}
export const usesCsm = (m: BMetric) => m.key === 'csm' || m.key === 'csmy' || m.key === 'csmeq' || m.key === 'pbc';
/** "†": a CSM figure (or a figure built on one) printed on another known basis than the company's latest; an unstated basis is not different */
export function csmDagger(book: Book, m: BMetric, ent: string, q: string): CsmBasis | null {
  if (!usesCsm(m)) return null;
  const a = csmBasis(book, ent, q), b = latestCsmBasis(book, ent);
  return a && b && a !== b ? a : null;
}
/** two quarters' CSM on two known, different bases: no change is computed across them */
export const csmBasesDiffer = (book: Book, ent: string, qa: string, qb: string) => { const a = csmBasis(book, ent, qa), b = csmBasis(book, ent, qb); return !!a && !!b && a !== b; };
export const CSM_CROSS = 'בסיס שונה בין התקופות (נטו / ברוטו)';

/* ---------- one reading of one company at one quarter ---------- */
const kindOfEnt = (book: Book, e: string): Kind => (book.ent.get(e)?.k === 'fund' ? 'fund' : 'ins');
const freqOf = (m: BMetric, base: 'ltm' | 'q'): Freq => (base === 'q' && (m.type === 'flow' || m.fr) ? 'Q' : 'LTM');
/** a level at a quarter, exactly there (no walking back): the peer table's own cell */
function levelAt(book: Book, m: BMetric, ent: string, kind: Kind, q: string, base: 'ltm' | 'q', peers: string[]): BVal {
  const tok = m.tok?.[kind];
  if (!tok) return none(m.l, kind === 'ins' ? 'לא רלוונטי למבטחת' : 'לא רלוונטי לבית השקעות');
  if (m.type === 'half' || m.type === 'fy') return bizVal(book, m, ent, kind, q, peers);
  const freq = freqOf(m, base), c = colOf(book, tok), x: BVal = { ...cellVal(book, c, ent, freq, q, peers), p: q };
  if ((x.v == null || !Number.isFinite(x.v)) && m.ltmh && freq === 'LTM') { const h = ltmFromHalves(book, c, m, ent, q, peers); if (h && h.p === q) return h; }
  return x.v != null && Number.isFinite(x.v) ? x : { ...x, v: null };
}
/** A metric's reading for a company at quarter `q`, exactly at `q` (the quarters grid, the history, the table's paired change). Spot
 *  metrics read the quarter-end close (`histVal`); a change computes from two levels of the same lib with the basis in its source. */
export function readVal(book: Book, m: BMetric, ent: string, kind: Kind, q: string, rd: QRead, peers: string[]): BVal {
  const title = `${shOf(m)}${isChg(rd) || rd === 'q' ? ` ${readLabel(rd, q)}` : ''} · ${book.name(ent)}`;
  if (m.type === 'spot') return histVal(book, m, ent, kind, q, peers) ?? none(title, 'אין רצף רבעוני למדד');
  if (m.type === 'ret') return none(title, 'תשואה כוללת נמדדת עד הסגירה האחרונה, לא לפי רבעון');
  if (!isChg(rd)) return levelAt(book, m, ent, kind, q, rd === 'ltm' ? 'ltm' : 'q', peers);
  if (m.type === 'half' || m.type === 'fy') return none(title, 'מתפרסם פעמיים בשנה או פעם בשנה: אין שינוי רבעוני');
  const b0 = chgBase(m, rd), q0 = qBack(q, chgLag(rd));
  const a = levelAt(book, m, ent, kind, q, b0, peers), b = levelAt(book, m, ent, kind, q0, b0, peers);
  if (a.v == null) return { ...none(title, a.why ?? `אין נתון ל-${levelLab(b0, q)}`), p: q };
  if (b.v == null) return { ...none(title, `אין ערך ל-${levelLab(b0, q0)}`), p: q };
  if (usesCsm(m) && csmBasesDiffer(book, ent, q, q0)) return { ...none(title, CSM_CROSS), p: q };
  const freq = freqOf(m, b0);
  for (const id of colOf(book, m.tok![kind]!).ids) { const w = book.breakBetween(id, freq, a, b, q, q0); if (w) return { ...none(title, `שבר בהגדרה בין התקופות: ${w}`), p: q }; }
  const k = chgKind(m);
  let v: number | null;
  if (k === 'pct') { const c = chgPct(a.v, b.v); if (c.v == null) return { ...none(title, c.why === 'בסיס שלילי' ? 'בסיס שלילי: שינוי באחוזים אינו מוגדר' : c.why!), p: q }; v = c.v; }
  else v = chgPts(a.v, b.v);
  const vv = v!, la = levelLab(b0, q), lb = levelLab(b0, q0);
  return { v: vv, fl: a.fl | b.fl | F_DER, p: q, prov: () => ({ k: 'calc', title, value: fmtRead(m, rd, vv), unit: unitRead(m, rd),
    formula: k === 'pct' ? `שינוי = ${la} ÷ ${lb} − 1` : k === 'diff' ? `שינוי = ${la} פחות ${lb} (מיליארדי ש"ח)` : `שינוי = ${la} פחות ${lb}${m.u === 'x' ? '' : ', בנקודות'}`,
    inputs: [{ label: `${shOf(m)}, ${la}`, v: fmtRead(m, b0 === 'ltm' ? 'ltm' : 'q', a.v!), src: a.prov }, { label: `${shOf(m)}, ${lb}`, v: fmtRead(m, b0 === 'ltm' ? 'ltm' : 'q', b.v!), src: b.prov }],
    note: basisText(m, rd, q) }) };
}

/* ---------- who reported which quarter (spec 4) ---------- */
export interface ReportStatus {
  /** the newest quarter any company of the set has reported (net profit as the marker) */
  bq: string;
  /** the newest quarter every company with statements has reported */
  cq: string;
  /** reported `bq`, in set order */
  reported: string[];
  /** has statements, has not reported `bq` yet, in set order */
  waiting: string[];
  /** no statements in the peer files at all (never ranked on business metrics) */
  none: string[];
  /** each company's own latest reported quarter */
  last: Record<string, string | null>;
  /** companies with statements (the "7" of "3 מתוך 7") */
  n: number;
}
export function reportStatus(book: Book, ents: string[]): ReportStatus {
  const mk = (e: string) => NP_ID[kindOfEnt(book, e)];
  const qs = [...new Set([...book.periods(NP_ID.ins), ...book.periods(NP_ID.fund)].filter((p) => /Q\d$/.test(p)))].sort().reverse();
  const last: Record<string, string | null> = {};
  ents.forEach((e) => { last[e] = qs.find((q) => { const x = book.get(mk(e), e, 'Q', q); return x.v != null && Number.isFinite(x.v); }) ?? null; });
  const have = ents.filter((e) => last[e]), ls = have.map((e) => last[e]!).sort();
  const bq = ls[ls.length - 1] ?? '', cq = ls[0] ?? '';
  return { bq, cq, reported: have.filter((e) => last[e] === bq), waiting: have.filter((e) => last[e] !== bq), none: ents.filter((e) => !last[e]), last, n: have.length };
}
const NP_ID: Record<Kind, string> = { ins: 'ifrs:profit_attributable', fund: 'xbrl:profit' };

/* ---------- the board ---------- */
export interface BoardCtx {
  book: Book; ents: string[];
  /** the board's quarter: `status.bq` (latest) or `status.cq` (base=common) */
  q: string;
  /** the regulator's quarter for `ax: 'reg'` metrics (its monthly files run ahead of the filings); default `q` */
  qReg?: string;
  px?: Record<string, TasePrice | null>; mk?: MktFile | null;
  status?: ReportStatus;
  kindOf?: (e: string) => Kind;
}
export interface BoardRow {
  e: string;
  v: number | null;
  /** the figure with its source (render through Sourced; `val.prov` is the sheet) */
  val: BVal;
  /** the quarter the figure is of (a carried or not-yet-reported company: its own last quarter); null for a close-dated market figure */
  q: string | null;
  /** read on its latest report, behind the board's quarter: starred, tagged with its quarter, ranked and counted (13.2 rule 1) */
  stale: boolean;
  /** a quarter-named reading and the company has not reported the quarter: listed under "לא בדירוג ולא בחציון", muted (13.2 rule 2) */
  out: boolean;
  /** a half-year or annual figure: its period key (the row's tag "H1'26" / "FY'25") */
  per: string | null;
  place: number | null; shared: boolean; chip: boolean;
  /** "†": the CSM behind the figure is on another basis than the company's latest */
  dag: CsmBasis | null;
  /** a stock reading and the company has no price file (no listed share) */
  noShare: boolean;
}
export interface MedianOf { v: number | null; n: number; parts: { e: string; v: number; stale: boolean; q: string | null }[] }
export interface BoardOut { m: BMetric; rd: QRead; q: string; rows: BoardRow[]; med: MedianOf; band: number; strict: boolean; n: number }

/** the median of the ranked rows that have a figure, with its n and its parts (a median always declares its basis: 13.2 rule 3) */
export function medianOf(rows: Pick<BoardRow, 'e' | 'v' | 'out' | 'stale' | 'q'>[]): MedianOf {
  const parts = rows.filter((r) => !r.out && r.v != null && Number.isFinite(r.v)).map((r) => ({ e: r.e, v: r.v!, stale: r.stale, q: r.q }));
  return { v: median(parts.map((p) => p.v)), n: parts.length, parts };
}
/** the band inside which two companies share a place (spec 2.3): a ratio or multiple two displayed units, a percent change 0.2 points,
 *  a points change two displayed units, a ₪bn difference 0.05, an amount 0.5% of the group's median */
export function bandOf(m: BMetric, rd: QRead, vals: (number | null)[]): number {
  if (isChg(rd)) { const k = chgKind(m); return k === 'pts' ? 2 * 10 ** -(m.u === 'x' || m.dec >= 2 ? 2 : 1) : k === 'diff' ? 0.05 : 0.2; }
  if (m.u === 'pctx') return 0.2;
  if (m.u === 'm' || m.u === 'bn') { const md = median(vals.filter((v): v is number => v != null && Number.isFinite(v))); return md ? Math.abs(md) * 0.005 : 0; }
  return 2 * 10 ** -m.dec;
}
/** the note a carried figure opens with (the words of seriesCols.carriedVal) */
const carryProv = (x: BVal, q: string, from: string): BVal => ({ ...x, prov: () => { const pr = x.prov(), why = `טרם דווח על ${qlab(q)}: הנתון המדווח האחרון (${qlab(from)})`;
  return pr.k === 'calc' || pr.k === 'report' ? { ...pr, note: [why, pr.note].filter(Boolean).join(' · ') } : pr; } });
/** one company's board figure under the rule of 13.2 */
function rowOf(c: BoardCtx, m: BMetric, rd: QRead, e: string, strict: boolean): Omit<BoardRow, 'place' | 'shared' | 'chip'> {
  const { book, ents } = c, kind = c.kindOf?.(e) ?? kindOfEnt(book, e), q = m.ax === 'reg' ? c.qReg ?? c.q : c.q;
  const base = { e, out: false, per: null as string | null, dag: null as CsmBasis | null, noShare: false };
  if (m.type === 'spot' || m.type === 'ret') {
    const mm = m.type === 'ret' ? MBY.get(rd) ?? MBY.get('r12')! : m, px = c.px?.[e] ?? null;
    const x = spotVal(mm, { book, ent: e, kind, p: q, peers: ents, px, mk: c.mk ?? null }), pq = x.p && /Q\d$/.test(x.p) ? x.p : null;
    return { ...base, v: x.v, val: x, q: pq, stale: !!x.stale, noShare: !px, dag: pq ? csmDagger(book, m, e, pq) : null };
  }
  if (m.type === 'half' || m.type === 'fy') { const x = bizVal(book, m, e, kind, q, ents); return { ...base, v: x.v, val: x, q: x.p ?? null, stale: false, per: x.v != null ? x.p ?? null : null }; }
  const last = c.status?.last[e];
  if (strict && last && last < q) { const x = readVal(book, m, e, kind, last, rd, ents); return { ...base, v: x.v, val: x, q: last, stale: false, out: true }; }
  let x = readVal(book, m, e, kind, q, rd, ents), from: string | null = null;
  if (x.v == null && !strict && m.ax !== 'reg' && m.tok?.[kind]) {
    // 13.2 rule 1: carried exactly as seriesCols.carriedVal (one period back, starred, counted); an LTM-based change follows its level
    const b0 = isChg(rd) ? chgBase(m, rd) : rd === 'ltm' ? 'ltm' : 'q', cv = carriedVal(book, colOf(book, m.tok[kind]!), e, freqOf(m, b0), q, ents);
    if (cv) { from = cv.from; x = isChg(rd) ? carryProv(readVal(book, m, e, kind, cv.from, rd, ents), q, cv.from) : { ...cv, p: cv.from }; if (x.v == null) from = null; }
  }
  const at = from ?? q;
  return { ...base, v: x.v, val: x, q: at, stale: !!from, dag: !isChg(rd) ? csmDagger(book, m, e, at) : null };
}
/** The board (spec 3.2, 13.2): one row per company, places from `placeGroups` (values oriented best first, multiples negated), the
 *  median and its n over the ranked rows. Rows: ranked by place, then ranked without a figure, then the not-yet-reported (quarter-named). */
export function boardRows(c: BoardCtx, m: BMetric, rd0?: QRead | null): BoardOut {
  const rd = readOf(m, rd0), strict = quarterNamed(m, rd), q = m.ax === 'reg' ? c.qReg ?? c.q : c.q;
  const raw = c.ents.map((e) => rowOf(c, m, rd, e, strict));
  const inn = raw.filter((r) => !r.out), vals = inn.map((r) => r.v), band = bandOf(m, rd, vals);
  const pl = placeGroups(vals.map((v) => (v == null || !Number.isFinite(v) ? null : m.better === 'lo' ? -v : v)), band);
  const rows: BoardRow[] = raw.map((r) => { const i = inn.indexOf(r), p = i >= 0 ? pl[i] : null; return { ...r, place: p?.place ?? null, shared: !!p?.shared, chip: !!p?.chip }; });
  const has = (r: BoardRow) => (r.v != null && Number.isFinite(r.v) ? 1 : 0);
  const ov = (r: BoardRow) => (r.v == null || !Number.isFinite(r.v) ? 0 : m.better === 'lo' ? -r.v : r.v);
  // a shared place keeps the value order inside it (the higher, or the cheaper, first); the not-yet-reported keep set order
  rows.sort((a, b) => Number(a.out) - Number(b.out) || has(b) - has(a) || (a.place ?? 99) - (b.place ?? 99) || (a.out ? 0 : ov(b) - ov(a)) || c.ents.indexOf(a.e) - c.ents.indexOf(b.e));
  const med = medianOf(rows);
  return { m, rd, q, rows, med, band, strict, n: med.n };
}
/** the source of a median: its n components (carried ones starred) and the rule it stands on */
export function medianProv(b: BoardOut, name: (e: string) => string): Prov {
  const { m, rd, q, med } = b;
  if (med.v == null) return { k: 'none', title: `חציון · ${shOf(m)}`, why: 'פחות משתי חברות עם נתון' };
  return { k: 'calc', title: `חציון · ${shOf(m)}${isChg(rd) || rd === 'q' ? ` ${readLabel(rd, q)}` : ''}`, value: fmtRead(m, rd, med.v), unit: unitRead(m, rd),
    formula: `חציון של ${med.n} חברות${b.strict ? ` שדיווחו ${qlab(q)}` : ''}${isChg(rd) ? ` · ${basisText(m, rd, q)}` : ''}`,
    inputs: med.parts.map((p) => ({ label: `${name(p.e)}${p.stale ? `* (${qlab(p.q)})` : ''}`, v: fmtRead(m, rd, p.v), src: b.rows.find((r) => r.e === p.e)?.val.prov })),
    note: b.strict ? `רבעון בודד, YoY ו-QoQ של הרבעון: רק החברות שדיווחו ${qlab(q)} מדורגות ונספרות בחציון` : CARRY_RULE };
}

/* ---------- the quarters grid (spec 3.2 item 7, 13.2: the grid carries like the board at the board's quarter only) ---------- */
export interface GridCell { e: string; v: number | null; val: BVal; star: boolean; dag: CsmBasis | null; why: string | null; from: string | null }
export interface GridRow { q: string; cells: GridCell[]; med: MedianOf }
/** one quarter of the grid; `carry` (default: q is the board's quarter) applies 13.2 rule 1 to non-quarter-named readings */
export function gridRow(c: BoardCtx, m: BMetric, rd0: QRead | null | undefined, q: string, carry = q === c.q): GridRow {
  const { book, ents } = c, rd = readOf(m, rd0), strict = quarterNamed(m, rd);
  const cells: GridCell[] = ents.map((e) => {
    const kind = c.kindOf?.(e) ?? kindOfEnt(book, e);
    let x: BVal, from: string | null = null;
    if (m.type === 'spot') {
      const h = histVal(book, m, e, kind, q, ents, carry && !strict);
      x = h ?? none(shOf(m), 'אין רצף רבעוני למדד');
      if (h?.stale && h.p) from = h.p;
    } else {
      x = readVal(book, m, e, kind, q, rd, ents);
      if (x.v == null && carry && !strict && m.ax !== 'reg' && m.tok?.[kind] && m.type !== 'ret') {
        const b0 = isChg(rd) ? chgBase(m, rd) : rd === 'ltm' ? 'ltm' : 'q', cv = m.type === 'half' || m.type === 'fy' ? null : carriedVal(book, colOf(book, m.tok[kind]!), e, freqOf(m, b0), q, ents);
        if (cv) { const y = isChg(rd) ? carryProv(readVal(book, m, e, kind, cv.from, rd, ents), q, cv.from) : { ...cv, p: cv.from }; if (y.v != null) { x = y; from = cv.from; } }
      }
    }
    const ok = x.v != null && Number.isFinite(x.v), last = c.status?.last[e];
    const why = ok ? null : last && last < q && m.ax !== 'reg' && m.type !== 'spot' ? 'טרם דיווחה' : x.why ?? 'אין נתון';
    return { e, v: ok ? x.v : null, val: x, star: !!from, dag: ok && !isChg(rd) ? csmDagger(book, m, e, from ?? q) : null, why, from };
  });
  return { q, cells, med: medianOf(cells.map((x) => ({ e: x.e, v: x.v, out: false, stale: x.star, q: x.from ?? q }))) };
}
/** the grid: `n` quarters newest first from the board's quarter (6 or 12: `gq`) */
export function quarterGrid(c: BoardCtx, m: BMetric, rd: QRead | null | undefined, n = 6): GridRow[] {
  const q0 = m.ax === 'reg' ? c.qReg ?? c.q : c.q;
  return Array.from({ length: n }, (_, i) => gridRow(c, m, rd, qBack(q0, i), i === 0));
}
/** the close a quarter-end multiple uses: the last trading day on or before the quarter end (mkt.json) */
export const closeAt = (mk: MktFile | null | undefined, e: string, q: string): string | null => mk?.ents[e]?.q[q]?.[2] ?? null;
