/** A tiny, safe expression language for formula columns: numbers, metric names, + − × ÷ ^, parentheses and a few functions.
 *  Parsed into a tree and evaluated by walking it: no eval, no Function, nothing reaches the page's scope.
 *    np / eq * 100          metric aliases (see ALIASES) or any metric written as its alias (fs_ins_res, lts_am_aum, reg_assets__all)
 *    {ifrs:csm_release}     any metric by its registry id
 *    abs(x) min(a,b,…) max(a,b,…) avg(a,b,…) lag(x, k)    lag reads x k periods back on the table's axis */
export type Node =
  | { t: 'n'; v: number }
  | { t: 'm'; id: string; name: string }
  | { t: 'b'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'u'; a: Node }
  | { t: 'f'; name: 'abs' | 'min' | 'max' | 'avg' | 'lag'; args: Node[] };

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
/** the alias every metric has automatically: its id with : and . turned into _ and @ into __ */
export const autoAlias = (id: string) => id.replace('@', '__').replace(/[:.]/g, '_');
const FUNCS = new Set(['abs', 'min', 'max', 'avg', 'lag']);

export class ExprError extends Error {}

/** Parses an expression; `known` maps a name to a metric id (or returns undefined). */
export function parse(src: string, known: (name: string) => string | undefined): Node {
  let i = 0;
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = () => { ws(); return s[i]; };
  const eat = (c: string) => { if (peek() !== c) throw new ExprError(`חסר "${c}" במקום ${i + 1}`); i++; };
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
    if (c === undefined) throw new ExprError('הביטוי נגמר באמצע');
    if (c === '(') { i++; const e = expr(); eat(')'); return e; }
    if (c === '{') {
      const j = s.indexOf('}', i);
      if (j < 0) throw new ExprError('חסר "}"');
      const raw = s.slice(i + 1, j).trim(); i = j + 1;
      const id = known(raw);
      if (!id) throw new ExprError(`מדד לא מוכר: ${raw}`);
      return { t: 'm', id, name: raw };
    }
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; return { t: 'n', v: Number(num[0]) }; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const name = id[0];
      if (peek() === '(') {
        if (!FUNCS.has(name)) throw new ExprError(`פונקציה לא מוכרת: ${name}`);
        i++;
        const args: Node[] = [];
        if (peek() !== ')') { args.push(expr()); while (peek() === ',') { i++; args.push(expr()); } }
        eat(')');
        if (name === 'abs' && args.length !== 1) throw new ExprError('abs מקבלת ערך אחד');
        if (name === 'lag' && (args.length !== 2 || args[1].t !== 'n')) throw new ExprError('lag(מדד, מספר תקופות)');
        if (!args.length) throw new ExprError(`${name} בלי ערכים`);
        return { t: 'f', name: name as 'abs', args };
      }
      const mid = known(name);
      if (!mid) throw new ExprError(`שם לא מוכר: ${name}`);
      return { t: 'm', id: mid, name };
    }
    throw new ExprError(`תו לא צפוי "${c}" במקום ${i + 1}`);
  };
  const tree = expr();
  if (peek() !== undefined) throw new ExprError(`תו מיותר "${peek()}" במקום ${i + 1}`);
  return tree;
}

/** every metric a tree reads, with the furthest lag it needs */
export function refs(n: Node, out = new Set<string>()): Set<string> {
  if (n.t === 'm') out.add(n.id);
  else if (n.t === 'b') { refs(n.a, out); refs(n.b, out); }
  else if (n.t === 'u') refs(n.a, out);
  else if (n.t === 'f') n.args.forEach((a) => refs(a, out));
  return out;
}

/** Evaluates a tree; `ref(id, lag)` returns a metric's value `lag` periods back, or null. Any missing input makes the result null. */
export function evaluate(n: Node, ref: (id: string, lag: number, name: string) => number | null, lag = 0): number | null {
  switch (n.t) {
    case 'n': return n.v;
    case 'm': return ref(n.id, lag, n.name);
    case 'u': { const a = evaluate(n.a, ref, lag); return a == null ? null : -a; }
    case 'b': {
      const a = evaluate(n.a, ref, lag), b = evaluate(n.b, ref, lag);
      if (a == null || b == null) return null;
      if (n.op === '/') return b === 0 ? null : a / b;
      const r = n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : Math.pow(a, b);
      return Number.isFinite(r) ? r : null;
    }
    case 'f': {
      if (n.name === 'lag') return evaluate(n.args[0], ref, lag + (n.args[1] as { v: number }).v);
      const xs = n.args.map((a) => evaluate(a, ref, lag));
      if (xs.some((x) => x == null)) return null;
      const v = xs as number[];
      return n.name === 'abs' ? Math.abs(v[0]) : n.name === 'min' ? Math.min(...v) : n.name === 'max' ? Math.max(...v) : v.reduce((s, x) => s + x, 0) / v.length;
    }
  }
}
