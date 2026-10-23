/** A tiny, safe expression language for formula columns: numbers, metric names, + − × ÷ ^, parentheses and a few functions.
 *  Parsed into a tree and evaluated by walking it: no eval, no Function, nothing reaches the page's scope.
 *    רווח נקי לבעלי המניות / הון לבעלי המניות     any metric by its Hebrew label, as the registry prints it
 *    np / eq * 100          metric aliases (see ALIASES) or any metric written as its alias (fs_ins_res, lts_am_aum, reg_assets__all)
 *    {ifrs:csm_release}     any metric by its registry id (or {its Hebrew label})
 *    abs(x) min(a,b,…) max(a,b,…) avg(a,b,…) lag(x, k)    lag reads x k periods back on the table's axis
 *    yago(x)                x one year earlier, on any frequency (4 quarters, 2 halves, 1 year)
 *    ann(x)                 a flow at an annual rate: × 4 on quarters, × 2 on halves, × 1 on FY and LTM
 *  An expression is stored in the address in its code form (aliases), so a saved view survives a change of label. */
export type Fn = 'abs' | 'min' | 'max' | 'avg' | 'lag' | 'yago' | 'ann';
export type Node =
  | { t: 'n'; v: number }
  | { t: 'm'; id: string; name: string }
  | { t: 'b'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'u'; a: Node }
  | { t: 'f'; name: Fn; args: Node[] };

/** Short names for the metrics analysts reach for most (IFRS 17 group figures unless prefixed). */
export const ALIASES: Record<string, string> = {
  np: 'ifrs:profit_attributable', pbt: 'ifrs:profit_before_tax', ci: 'ifrs:comprehensive_income_before_tax', cia: 'ifrs:comprehensive_income_attributable',
  rev: 'ifrs:insurance_revenue', isr: 'ifrs:insurance_service_result', inv: 'ifrs:net_investment_and_finance_result', fin: 'ifrs:insurance_finance_result',
  fee: 'ifrs:management_fees', eq: 'ifrs:equity_attributable', ta: 'ifrs:total_assets', aum: 'ifrs:aum_total', roe: 'ifrs:roe_reported',
  csm: 'ifrs:csm_closing', csm0: 'ifrs:csm_opening', nb: 'ifrs:csm_new_business', rel: 'ifrs:csm_release', ra: 'ifrs:risk_adjustment', onerous: 'ifrs:losses_on_onerous_contracts',
  div: 'ifrs:dividend_paid', divd: 'ifrs:dividend_declared', sr: 'ifrs:solvency_ratio_without_transitional', srt: 'ifrs:solvency_ratio_with_transitional',
  scr: 'ifrs:scr', own: 'ifrs:own_funds',
  xnp: 'xbrl:profit', xci: 'xbrl:oci', xpbt: 'xbrl:pretax', xeq: 'xbrl:equity', xta: 'xbrl:assets', xeps: 'xbrl:eps', xcfo: 'xbrl:cfo',
};
const CODE_OF = new Map(Object.entries(ALIASES).map(([a, id]) => [id, a]));
/** the alias every metric has automatically: its id with : and . turned into _ and @ into __ */
export const autoAlias = (id: string) => id.replace('@', '__').replace(/[:.]/g, '_');
/** the shortest code a metric is written with: its curated alias, else its automatic one */
export const codeOf = (id: string) => CODE_OF.get(id) ?? autoAlias(id);
/** the functions, with what each does (the editor lists them) */
export const FUNCS: Record<Fn, string> = {
  ann: 'בקצב שנתי: × 4 ברבעון, × 2 בחציון', yago: 'אותו מדד שנה קודם', avg: 'ממוצע', abs: 'ערך מוחלט', min: 'הקטן מבין', max: 'הגדול מבין', lag: 'תקופות אחורה: lag(x, 4)',
};

/** a parse error, with where it happened (0-based offset into the source and its length) so the editor can point at it */
export class ExprError extends Error {
  constructor(message: string, public pos = -1, public len = 1) { super(message); }
}

/* ---------- Hebrew labels ---------- */
export interface Label { text: string; id: string }
export interface Lexicon { labels: Label[]; labelOf: Map<string, string> }
// a label shared by two sources resolves to the first source here; the others are written "label · source"
const SRC_RANK = ['ifrs', 'lts', 'econ', 'reg', 'fs', 'sop', 'xbrl'];
const rank = (s: string) => { const i = SRC_RANK.indexOf(s); return i < 0 ? 99 : i; };
/** labels for every metric, unique: a label two sources share keeps its plain form for the preferred source */
export function lexicon(metrics: { id: string; l: string; src: string }[], srcName: Record<string, string>): Lexicon {
  const by = new Map<string, { id: string; l: string; src: string }[]>();
  metrics.forEach((m) => by.set(m.l, [...(by.get(m.l) ?? []), m]));
  const labelOf = new Map<string, string>();
  by.forEach((ms, l) => [...ms].sort((a, b) => rank(a.src) - rank(b.src)).forEach((m, i) => labelOf.set(m.id, i === 0 ? l : `${l} · ${srcName[m.src] ?? m.src}`)));
  const labels = [...labelOf.entries()].map(([id, text]) => ({ id, text })).sort((a, b) => b.text.length - a.text.length);
  return { labels, labelOf };
}
/** one form for comparing typed text with a label: geresh and gershayim of either kind, dashes, Latin case */
const fold = (c: string) => (c === '׳' || c === '`' || c === '’' ? "'" : c === '״' || c === '”' || c === '“' ? '"' : c === '−' || c === '–' ? '-' : c.toLowerCase());
const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
/** the end of `label` if the source spells it at `i` (spaces are flexible), else -1 */
function spellAt(s: string, i: number, label: string): number {
  let j = i;
  for (let k = 0; k < label.length; k++) {
    const c = label[k];
    if (c === ' ') { while (/\s/.test(s[j] ?? '')) j++; continue; }
    if (fold(s[j] ?? '') !== fold(c)) return -1;
    j++;
  }
  return isWord(label[label.length - 1]) && isWord(s[j]) ? -1 : j;
}
/** the longest label spelled at `i` */
export function labelAt(s: string, i: number, lex: Lexicon | undefined): { id: string; end: number; text: string } | null {
  if (!lex) return null;
  let best: { id: string; end: number; text: string } | null = null;
  for (const L of lex.labels) {
    const end = spellAt(s, i, L.text);
    if (end > 0 && (!best || end > best.end)) best = { id: L.id, end, text: L.text };
  }
  return best;
}

/** Parses an expression; `known` maps a code or id to a metric id (or returns undefined); `lex` adds the Hebrew labels. */
export function parse(src: string, known: (name: string) => string | undefined, lex?: Lexicon): Node {
  let i = 0;
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = () => { ws(); return s[i]; };
  const eat = (c: string) => { if (peek() !== c) throw new ExprError(peek() === undefined ? `חסר "${c}" בסוף` : `חסר "${c}" במקום ${i + 1}`, Math.min(i, s.length), 1); i++; };
  const expr = (): Node => {
    let a = term();
    for (let c = peek(); c === '+' || c === '-'; c = peek()) { i++; a = { t: 'b', op: c, a, b: term() }; }
    return a;
  };
  const term = (): Node => {
    let a = unary();
    for (let c = peek(); c === '*' || c === '/'; c = peek()) { i++; a = { t: 'b', op: c, a, b: unary() }; }
    return a;
  };
  const unary = (): Node => {
    if (peek() === '-') { i++; return { t: 'u', a: unary() }; }
    if (peek() === '+') { i++; return unary(); }
    const a = atom();
    if (peek() === '^') { i++; return { t: 'b', op: '^', a, b: unary() }; }
    return a;
  };
  const atom = (): Node => {
    const c = peek();
    if (c === undefined) throw new ExprError('הביטוי נגמר באמצע: חסר מדד או מספר', s.length, 1);
    const at = i;
    if (c === '(') { i++; const e = expr(); eat(')'); return e; }
    if (c === '{') {
      const j = s.indexOf('}', i);
      if (j < 0) throw new ExprError('חסר "}"', at, s.length - at);
      const raw = s.slice(i + 1, j).trim(); i = j + 1;
      const hit = labelAt(raw, 0, lex);
      const id = known(raw) ?? (hit && hit.end >= raw.length ? hit.id : undefined);
      if (!id) throw new ExprError(`מדד לא מוכר: ${raw}`, at, j + 1 - at);
      return { t: 'm', id, name: raw };
    }
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; return { t: 'n', v: Number(num[0]) }; }
    // a Hebrew (or any) label, longest first, before the Latin codes: "רווח נקי לבעלי המניות"
    const lab = labelAt(s, i, lex);
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    const fnNext = id && /^\s*\(/.test(s.slice(i + id[0].length));
    if (lab && !fnNext && (!id || lab.end - i > id[0].length)) { i = lab.end; return { t: 'm', id: lab.id, name: lab.text }; }
    if (id) {
      i += id[0].length;
      const name = id[0];
      if (peek() === '(') {
        if (!(name in FUNCS)) throw new ExprError(`פונקציה לא מוכרת: ${name}`, at, name.length);
        i++;
        const args: Node[] = [];
        if (peek() !== ')') { args.push(expr()); while (peek() === ',') { i++; args.push(expr()); } }
        eat(')');
        if ((name === 'abs' || name === 'yago' || name === 'ann') && args.length !== 1) throw new ExprError(`${name} מקבלת ערך אחד`, at, i - at);
        if (name === 'lag' && (args.length !== 2 || args[1].t !== 'n')) throw new ExprError('lag(מדד, מספר תקופות)', at, i - at);
        if (!args.length) throw new ExprError(`${name} בלי ערכים`, at, i - at);
        return { t: 'f', name: name as Fn, args };
      }
      const mid = known(name) ?? known(name.toLowerCase());
      if (!mid) throw new ExprError(`שם לא מוכר: ${name}`, at, name.length);
      return { t: 'm', id: mid, name };
    }
    // a word that is no label: say which words, not which letter
    const word = /^[^\s+\-*/^(),{}]+(?:[ \t]+[^\s+\-*/^(),{}]+)*/.exec(s.slice(i))?.[0] ?? c;
    if (/\p{L}/u.test(c)) throw new ExprError(`מדד לא מוכר: ${word.length > 40 ? word.slice(0, 40) + '…' : word}`, at, word.length);
    throw new ExprError(`תו לא צפוי "${c}" במקום ${i + 1}`, at, 1);
  };
  const tree = expr();
  if (peek() !== undefined) throw new ExprError(`תו מיותר "${peek()}" במקום ${i + 1}: חסר סימן פעולה?`, i, 1);
  return tree;
}

/** every metric a tree reads */
export function refs(n: Node, out = new Set<string>()): Set<string> {
  if (n.t === 'm') out.add(n.id);
  else if (n.t === 'b') { refs(n.a, out); refs(n.b, out); }
  else if (n.t === 'u') refs(n.a, out);
  else if (n.t === 'f') n.args.forEach((a) => refs(a, out));
  return out;
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
const OPS: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^' };
/** writes a tree back as text: `name` gives each metric's form (its code for the address, its Hebrew label for people) */
export function print(n: Node, name: (id: string) => string, outer = 0): string {
  switch (n.t) {
    case 'n': return String(n.v);
    case 'm': return name(n.id);
    case 'u': return `-${print(n.a, name, 3)}`;
    case 'f': return `${n.name}(${n.args.map((a) => print(a, name)).join(', ')})`;
    case 'b': { const p = PREC[n.op], t = `${print(n.a, name, p)} ${OPS[n.op]} ${print(n.b, name, p + (n.op === '-' || n.op === '/' ? 1 : 0))}`; return p < outer ? `(${t})` : t; }
  }
}
/** the code form stored in the address: aliases and ASCII operators */
export const toCode = (n: Node): string => print(n, codeOf).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
/** the form people read: Hebrew labels */
export const toHebrew = (n: Node, lex: Lexicon): string => print(n, (id) => lex.labelOf.get(id) ?? id);

/** the frequency facts a formula needs: periods of the axis in a year, and the factor that annualises a flow on it */
export interface Ctx { year: number; ann: number }
/** Evaluates a tree; `ref(id, lag)` returns a metric's value `lag` periods back, or null. Any missing input makes the result null. */
export function evaluate(n: Node, ref: (id: string, lag: number, name: string) => number | null, lag = 0, ctx: Ctx = { year: 4, ann: 1 }): number | null {
  switch (n.t) {
    case 'n': return n.v;
    case 'm': return ref(n.id, lag, n.name);
    case 'u': { const a = evaluate(n.a, ref, lag, ctx); return a == null ? null : -a; }
    case 'b': {
      const a = evaluate(n.a, ref, lag, ctx), b = evaluate(n.b, ref, lag, ctx);
      if (a == null || b == null) return null;
      if (n.op === '/') return b === 0 ? null : a / b;
      const r = n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : Math.pow(a, b);
      return Number.isFinite(r) ? r : null;
    }
    case 'f': {
      if (n.name === 'lag') return evaluate(n.args[0], ref, lag + (n.args[1] as { v: number }).v, ctx);
      if (n.name === 'yago') return evaluate(n.args[0], ref, lag + ctx.year, ctx);
      if (n.name === 'ann') { const x = evaluate(n.args[0], ref, lag, ctx); return x == null ? null : x * ctx.ann; }
      const xs = n.args.map((a) => evaluate(a, ref, lag, ctx));
      if (xs.some((x) => x == null)) return null;
      const v = xs as number[];
      return n.name === 'abs' ? Math.abs(v[0]) : n.name === 'min' ? Math.min(...v) : n.name === 'max' ? Math.max(...v) : v.reduce((s, x) => s + x, 0) / v.length;
    }
  }
}
