// The Firebase Hosting rules of firebase.json, evaluated the way Hosting evaluates them (superstatic: minimatch(path, source) with
// default options), so scripts/serve.mjs and scripts/hosting-check.mjs apply exactly the live headers and rewrites.
// Supported glob subset (all firebase.json uses): leading "!" negation, "**" segments, "*", "?", "@(a|b)"; like minimatch's default
// (dot: false), "*" and "**" do not match a segment that starts with a dot.
import { readFileSync } from 'node:fs';

const cache = new Map();
function toRegex(glob) {
  if (cache.has(glob)) return cache.get(glob);
  const segs = glob.split('/');
  let re = '^';
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    if (seg === '**') { re += last ? '(?:(?!\\.)[^/]*(?:/(?!\\.)[^/]*)*)?' : '(?:(?!\\.)[^/]*/)*'; return; }
    let s = seg.startsWith('*') || seg.startsWith('?') ? '(?!\\.)' : '';
    for (let j = 0; j < seg.length; j++) {
      const c = seg[j];
      if (c === '*') s += '[^/]*';
      else if (c === '?') s += '[^/]';
      else if (c === '@' && seg[j + 1] === '(') { const end = seg.indexOf(')', j); s += `(?:${seg.slice(j + 2, end).split('|').map(esc).join('|')})`; j = end; }
      else s += esc(c);
    }
    re += s + (last ? '' : '/');
  });
  const rx = new RegExp(re + '$');
  cache.set(glob, rx);
  return rx;
}
const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** minimatch(path, glob) for the subset above */
export function globMatch(path, glob) {
  if (glob.startsWith('!')) return !globMatch(path, glob.slice(1));
  return toRegex(glob).test(path);
}

export function loadHosting(file = new URL('../firebase.json', import.meta.url)) {
  return JSON.parse(readFileSync(file, 'utf8')).hosting;
}

/** the headers Hosting sends for a request path (every matching rule, later rules override the same key) */
export function headersFor(hosting, path) {
  const out = {};
  for (const rule of hosting.headers ?? []) if (globMatch(path, rule.source)) for (const h of rule.headers) out[h.key] = h.value;
  return out;
}

/** the rewrite destination for a path that is not a file, or null (a 404) */
export function rewriteFor(hosting, path) {
  return (hosting.rewrites ?? []).find((r) => globMatch(path, r.source))?.destination ?? null;
}
