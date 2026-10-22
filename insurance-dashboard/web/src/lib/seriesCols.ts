/** Columns of the peer table: a metric or a formula, shown as its value or transformed (YoY, change on the previous period,
 *  share of the peer set's total, 3-year CAGR). A column is one token in the address (?c=…), so a view is a URL. */
import type { Prov } from './prov';
import { back, Book, F_DER, fmtChg, fmtV, plab, UNIT_HE, yearAgo, type Freq, type Unit, type Val } from './registry';
import { ALIASES, autoAlias, evaluate, ExprError, parse, refs, type Node } from './seriesExpr';

export type Tr = 'v' | 'y' | 'q' | 's' | 'c';
export const TR_HE: Record<Tr, string> = { v: 'ערך', y: 'YoY', q: 'מול תקופה קודמת', s: 'נתח מהקבוצה', c: 'CAGR 3 שנים' };
export interface Col { tok: string; tr: Tr; mid?: string; name: string; unit: Unit; expr?: string; tree?: Node; err?: string; ids: string[] }

const none = (title: string, why: string): Val => ({ v: null, fl: 0, why, prov: () => ({ k: 'none', title, why }) });

/** name → metric id: curated aliases, every metric's automatic alias, or a registry id */
export function resolver(book: Book): (n: string) => string | undefined {
  const auto = new Map(book.reg.metrics.map((m) => [autoAlias(m.id), m.id]));
  return (n) => ALIASES[n] ?? auto.get(n) ?? (book.byId.has(n) ? n : undefined);
}

export function parseCol(tok: string, book: Book | null): Col {
  let tr: Tr = 'v', body = tok;
  const m = /^([yqsc])!(.*)$/.exec(tok);
  if (m) { tr = m[1] as Tr; body = m[2]; }
  if (body.startsWith('=')) {
    const [name, unit, ...rest] = body.slice(1).split(';'), expr = rest.join(';');
    const col: Col = { tok, tr, name: name || 'נוסחה', unit: (['m', 'bn', 'pct', 'nis', 'x'].includes(unit) ? unit : 'x') as Unit, expr, ids: [] };
    if (!book) return col;
    try { col.tree = parse(expr, resolver(book)); col.ids = [...refs(col.tree)]; } catch (e) { col.err = e instanceof ExprError ? e.message : 'שגיאה בנוסחה'; }
    return col;
  }
  const def = book?.byId.get(body);
  return { tok, tr, mid: body, name: def?.l ?? body, unit: def?.u ?? 'm', ids: [body], err: book && !def ? 'מדד לא מוכר' : undefined };
}
export const formulaTok = (name: string, unit: Unit, expr: string, tr: Tr = 'v') => `${tr === 'v' ? '' : `${tr}!`}=${name.replace(/;/g, ',')};${unit};${expr}`;
export const withTr = (col: Col, tr: Tr) => (tr === 'v' ? '' : `${tr}!`) + col.tok.replace(/^[yqsc]!/, '');
export const colLabel = (c: Col) => (c.tr === 'v' ? c.name : `${c.name} · ${TR_HE[c.tr]}`);
/** the unit of what the column shows */
export const shownUnit = (c: Col): string => (c.tr === 'v' ? UNIT_HE[c.unit] : c.tr === 's' ? '%' : (c.tr === 'y' || c.tr === 'q') && (c.unit === 'pct' || c.unit === 'x') ? 'נק׳' : '%');
const pts = (c: Col) => c.unit === 'pct' || c.unit === 'x';
export function fmtCol(c: Col, v: number): string {
  if (c.tr === 'v') return fmtV(c.unit, v);
  if (c.tr === 's' || c.tr === 'c') return `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace('-', '−')}%`;
  return fmtChg(pts(c), v);
}

/** the column's own figure (before any transform) */
export function base(book: Book, c: Col, ent: string, freq: Freq, p: string): Val {
  const title = `${c.name} · ${book.name(ent)} · ${plab(freq, p)}`;
  if (c.err) return none(title, c.err);
  if (c.mid) return book.get(c.mid, ent, freq, p);
  if (!c.tree) return none(title, 'הנוסחה נטענת');
  const inputs: { label: string; v: string; src: () => Prov; fl: number }[] = [];
  const v = evaluate(c.tree, (id, lag, name) => {
    const pp = back(freq, p, lag), x = book.get(id, ent, freq, pp), def = book.byId.get(id);
    const label = `${name} · ${def?.l ?? id} · ${plab(freq, pp)}`;
    if (!inputs.some((q) => q.label === label)) inputs.push({ label, v: x.v == null ? '–' : fmtV(def?.u ?? 'm', x.v), src: x.prov, fl: x.fl });
    return x.v;
  });
  const fl = inputs.reduce((s, q) => s | q.fl, 0) | F_DER;
  if (v == null) {
    const miss = inputs.filter((q) => q.v === '–').map((q) => q.label.split(' · ')[1]);
    return { v: null, fl, why: miss.length ? `חסר: ${miss.join(', ')}` : 'חלוקה באפס', prov: () => ({ k: 'none', title, why: miss.length ? `חסר רכיב: ${miss.join(', ')}` : 'חלוקה באפס' }) };
  }
  return { v, fl, prov: () => ({ k: 'calc', title, value: fmtV(c.unit, v), unit: UNIT_HE[c.unit], formula: `${c.name} = ${c.expr}`, inputs: inputs.map(({ label, v: t, src }) => ({ label, v: t, src })) }) };
}

/** break across two periods for any metric the column reads */
function brk(book: Book, c: Col, freq: Freq, a: Val, b: Val, pa: string, pb: string): string | null {
  for (const id of c.ids) { const w = book.breakBetween(id, freq, a, b, pa, pb); if (w) return w; }
  return null;
}

/** what a cell shows: the figure, or its transform */
export function cellVal(book: Book, c: Col, ent: string, freq: Freq, p: string, peers: string[]): Val {
  const a = base(book, c, ent, freq, p);
  if (c.tr === 'v' || a.v == null) return c.tr === 'v' ? a : { ...a, v: null };
  const title = `${colLabel(c)} · ${book.name(ent)} · ${plab(freq, p)}`;
  if (c.tr === 's') {
    if (c.unit === 'pct' || c.unit === 'x' || c.unit === 'nis') return none(title, 'נתח מהקבוצה מחושב לסכומים בלבד');
    const all = peers.map((e) => [e, e === ent ? a : base(book, c, e, freq, p)] as [string, Val]).filter(([, x]) => x.v != null);
    const tot = all.reduce((s, [, x]) => s + x.v!, 0);
    if (!(tot > 0) || all.length < 2) return none(title, 'אין סכום קבוצה חיובי');
    const v = (a.v / tot) * 100;
    return { v, fl: a.fl | F_DER, prov: () => ({ k: 'calc', title, value: fmtCol(c, v), unit: '%', formula: `נתח = ${book.name(ent)} ÷ סך החברות בקבוצה שיש להן נתון (${all.length}) × 100`,
      inputs: all.map(([e, x]) => ({ label: book.name(e), v: fmtV(c.unit, x.v!), src: x.prov })) }) };
  }
  const pb = c.tr === 'y' ? yearAgo(freq, p) : c.tr === 'q' ? back(freq, p, 1) : back(freq, p, 3 * (freq === 'FY' ? 1 : freq === 'H' ? 2 : 4));
  const b = base(book, c, ent, freq, pb);
  if (b.v == null) return none(title, `אין ערך ל-${plab(freq, pb)}`);
  const w = brk(book, c, freq, a, b, p, pb);
  if (w) return { ...none(title, `שבר בהגדרה בין התקופות: ${w}`), fl: a.fl };
  let v: number | null;
  let formula: string;
  if (c.tr === 'c') {
    v = a.v > 0 && b.v > 0 ? (Math.pow(a.v / b.v, 1 / 3) - 1) * 100 : null;
    formula = `CAGR = (${plab(freq, p)} ÷ ${plab(freq, pb)})^(1/3) − 1`;
    if (v == null) return none(title, 'CAGR מחושב רק בין שני ערכים חיוביים');
  } else if (pts(c)) {
    v = a.v - b.v; formula = `שינוי = ${plab(freq, p)} − ${plab(freq, pb)}`;
  } else {
    v = b.v !== 0 && Math.sign(a.v) === Math.sign(b.v) ? ((a.v - b.v) / Math.abs(b.v)) * 100 : null;
    formula = `שינוי = (${plab(freq, p)} − ${plab(freq, pb)}) ÷ |${plab(freq, pb)}| × 100`;
    if (v == null) return none(title, 'שינוי באחוזים בין ערכים בסימנים שונים (או מאפס) אינו מוגדר');
  }
  const vv = v;
  return { v: vv, fl: (a.fl | b.fl) | F_DER, prov: () => ({ k: 'calc', title, value: fmtCol(c, vv), unit: shownUnit(c), formula,
    inputs: [{ label: plab(freq, p), v: fmtV(c.unit, a.v!), src: a.prov }, { label: plab(freq, pb), v: fmtV(c.unit, b.v!), src: b.prov }] }) };
}

/* ---------- templates: named views with hotkeys ---------- */
export interface Template { id: string; key: string; n: string; s: string; f: Freq; n2?: number; c: string[] }
export const TEMPLATES: Template[] = [
  { id: 'prof', key: '1', n: 'רווחיות', s: 'ins', f: 'LTM', c: ['ifrs:profit_attributable', 'ifrs:comprehensive_income_before_tax', 'ifrs:insurance_revenue', 'ifrs:insurance_service_result',
    formulaTok('מרווח שירותי ביטוח', 'pct', 'isr / rev * 100'), formulaTok('רווח נקי להון ממוצע', 'pct', 'np / avg(eq, lag(eq, 4)) * 100'), 'ifrs:equity_attributable', 'y!ifrs:equity_attributable'] },
  { id: 'csm', key: '2', n: 'IFRS 17 · CSM', s: 'ins', f: 'FY', c: ['ifrs:csm_closing', 'y!ifrs:csm_closing', formulaTok('CSM / הון', 'x', 'csm / eq'), 'ifrs:csm_closing@life', 'ifrs:csm_closing@health',
    'ifrs:csm_new_business@life', 'ifrs:csm_new_business@health', 'ifrs:csm_release@life', formulaTok('עסק חדש / שחרור, חיים', 'pct', 'ifrs_csm_new_business__life / ifrs_csm_release__life * 100'), 'ifrs:risk_adjustment'] },
  { id: 'lts', key: '3', n: 'חיסכון', s: 'lts', f: 'Q', c: ['lts:am.aum', 'y!lts:am.aum', 'lts:pen.aum.share', 'lts:gem.aum.share', 'lts:pen.tr_net', 'lts:gem.tr_net', 'lts:am.fees', 'lts:am.rev_rate'] },
  { id: 'cap', key: '4', n: 'הון', s: 'ins', f: 'Q', c: ['ifrs:equity_attributable', 'y!ifrs:equity_attributable', 'ifrs:total_assets', formulaTok('נכסים להון', 'x', 'ta / eq'),
    'ifrs:solvency_ratio_without_transitional', 'ifrs:solvency_ratio_with_transitional', 'ifrs:dividend_paid', 'ifrs:dividend_declared'] },
  { id: 'fs', key: '5', n: 'דוחות כספיים', s: 'ins', f: 'Q', c: ['fs:ins_rev', 'fs:ins_res', 'fs:inv_fin', 'fs:pbt', 'fs:np_attr', 'fs:equity_attr', 'fs:total_assets'] },
  { id: 'reg', key: '6', n: 'רגולטור', s: 'lts', f: 'Q', c: ['reg:assets@all', 'reg:share@all', 'y!reg:assets@all', 'reg:netflow@pension', 'reg:netflow@gemel', 'reg:transfers@all', 'reg:fee@pension', 'reg:fee@gemel'] },
  { id: 'seg', key: '7', n: 'מגזרים', s: 'ins', f: 'LTM', c: ['ifrs:comprehensive_income_before_tax@life', 'ifrs:comprehensive_income_before_tax@health', 'ifrs:comprehensive_income_before_tax@pc',
    'ifrs:insurance_service_result@life', 'ifrs:insurance_service_result@health', 'ifrs:insurance_service_result@pc', 'ifrs:csm_closing@life', 'ifrs:csm_closing@health'] },
];
