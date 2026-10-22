/* Data contracts at the network boundary (lane 2H, ws6 W6-15). The contracts live in ./schemas.json, shared with the deploy gate
   (pipeline/check_schemas.py validates every built file in full). Here, every file the site fetches is checked once, as it arrives:
   in development in full, in production on a sample (first, middle and last element of each list, three entries of each map), which
   costs well under a millisecond and still turns a renamed key or a changed type into a friendly "data does not match" message
   instead of a blank cell, a NaN or a crashed page. */
import spec from './schemas.json';

type S = { [k: string]: unknown; $ref?: string; type?: string | string[]; enum?: unknown[]; pattern?: string; properties?: Record<string, S>; required?: string[];
  additionalProperties?: S | boolean; items?: S; prefixItems?: S[]; minItems?: number; allOf?: S[] };
const DEFS = (spec as unknown as { $defs: Record<string, S> }).$defs;
const RULES = (spec as unknown as { files: { pattern: string; schema: string }[] }).files.map((f) => ({ re: new RegExp(`^${f.pattern.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`), schema: f.schema }));
const MAX = 8;
const rx = new Map<string, RegExp>();

/** The contract name of a data path ("companies/harel.json" → "workbook"), or null when the file has none. */
export function contractOf(path: string): string | null { return RULES.find((r) => r.re.test(path))?.schema ?? null; }

function typeOk(v: unknown, t: string): boolean {
  switch (t) {
    case 'null': return v === null;
    case 'boolean': return typeof v === 'boolean';
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'array': return Array.isArray(v);
    case 'object': return typeof v === 'object' && v !== null && !Array.isArray(v);
    default: return false;
  }
}
const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const pick = (n: number, full: boolean): number[] => (full || n <= 3 ? [...Array(n).keys()] : [0, n >> 1, n - 1]);

function check(v: unknown, s: S, path: string, errs: string[], full: boolean): void {
  if (errs.length >= MAX) return;
  if (s.$ref) {
    const { $ref, ...rest } = s;
    check(v, DEFS[$ref.split('/').pop()!], path, errs, full);
    if (!Object.keys(rest).length) return;
    s = rest;
  }
  s.allOf?.forEach((x) => check(v, x, path, errs, full));
  const at = path || '/';
  if (s.type != null) {
    const ts = Array.isArray(s.type) ? s.type : [s.type];
    if (!ts.some((t) => typeOk(v, t))) { errs.push(`${at}: expected ${ts.join('|')}, got ${kind(v)}`); return; }
  }
  if (s.enum && !s.enum.includes(v)) { errs.push(`${at}: ${JSON.stringify(v)?.slice(0, 40)} not in [${s.enum.join(', ')}]`); return; }
  if (s.pattern && typeof v === 'string') {
    let r = rx.get(s.pattern); if (!r) { r = new RegExp(s.pattern); rx.set(s.pattern, r); }
    if (!r.test(v)) errs.push(`${at}: "${v.slice(0, 40)}" does not match ${s.pattern}`);
  }
  if (typeOk(v, 'object')) {
    const o = v as Record<string, unknown>;
    s.required?.forEach((k) => { if (!(k in o)) errs.push(`${at}: missing key "${k}"`); });
    const props = s.properties ?? {};
    for (const k of Object.keys(props)) if (k in o) check(o[k], props[k], `${path}/${k}`, errs, full);
    const ap = s.additionalProperties;
    if (ap === false) Object.keys(o).forEach((k) => { if (!(k in props)) errs.push(`${at}: unexpected key "${k}"`); });
    else if (ap && typeof ap === 'object') {
      const keys = Object.keys(o).filter((k) => !(k in props));
      for (const i of pick(keys.length, full)) { check(o[keys[i]], ap, `${path}/${keys[i]}`, errs, full); if (errs.length >= MAX) return; }
    }
  } else if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) errs.push(`${at}: ${v.length} items, at least ${s.minItems} expected`);
    const pre = s.prefixItems ?? [];
    pre.slice(0, v.length).forEach((x, i) => check(v[i], x, `${path}/${i}`, errs, full));
    if (s.items) {
      const rest = v.length - pre.length;
      for (const i of pick(Math.max(0, rest), full)) { check(v[pre.length + i], s.items, `${path}/${pre.length + i}`, errs, full); if (errs.length >= MAX) return; }
    }
  }
}

/** The contract violations of one fetched file (empty when it matches, or has no contract). */
export function violations(path: string, data: unknown, full: boolean = import.meta.env.DEV): string[] {
  const name = contractOf(path);
  if (!name) return [];
  const errs: string[] = [];
  check(data, { $ref: `#/$defs/${name}` }, '', errs, full);
  return errs;
}

/** An error the pages show as "לא ניתן לטעון …" with this message, instead of rendering a file that no longer matches its contract. */
export class ContractError extends Error {
  constructor(path: string, public errs: string[]) {
    super(`${path}: מבנה הנתונים אינו תואם את החוזה (${errs[0]}${errs.length > 1 ? ` ועוד ${errs.length - 1}` : ''})`);
    this.name = 'ContractError';
  }
}

/** Checks a fetched file against its contract; throws ContractError on a mismatch, returns the data unchanged otherwise. */
export function checked<T>(path: string, data: T): T {
  const errs = violations(path, data);
  if (errs.length) {
    console.error(`fox data contract: ${path}`, errs);
    throw new ContractError(path, errs);
  }
  return data;
}
