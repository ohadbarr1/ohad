/** The full-text index of every filed page (pipeline/build_search.py) and its query engine.
 *  docs.json lists the documents; ft/<n>.bin holds the postings of the words whose hash falls in shard n; text/<rid>/<b>.bin
 *  holds the page text of ten pages. All .bin files are gzip, inflated here. A query downloads one shard per word. */
import { findTerms, fnv, normalize, terms } from './hebrew';

export type DocType = 'annual' | 'quarterly' | 'presentation' | 'solvency';
export interface DocMeta { id: number; company: string; type: DocType; period: string; date: string; pages: number; en: boolean; title: string; url: string; empty: number; kb: number; base: number }
export interface Corpus { docs: DocMeta[]; byId: Map<number, DocMeta>; pages: number; block: number; built: string; source: string }
interface Meta { pages: number; shards: number; block: number; stop: string[]; built: string }
interface Shard { head: Record<string, [number, number, number, number]>; body: Uint8Array }

const BASE = `${import.meta.env.BASE_URL}data/search/`;
export const DOC_TYPE_HE: Record<DocType, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'כושר פירעון' };

async function json<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}
/** A gzip file of the index, inflated (DecompressionStream: every current browser). */
async function bin(path: string): Promise<ArrayBuffer> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const buf = await r.arrayBuffer();
  const h = new Uint8Array(buf, 0, 2);
  // a server that already inflated it (Content-Encoding) hands over the plain bytes
  if (h[0] !== 0x1f || h[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

let corpusP: Promise<Corpus> | null = null;
export function loadCorpus(): Promise<Corpus> {
  corpusP ??= json<{ built: string; source: string; files: string; pages: number; block: number; docs: [number, string, DocType, string, string, number, number, string, string, number, number][] }>('docs.json').then((d) => {
    let base = 0;
    const docs = d.docs.map(([id, company, type, period, date, pages, en, title, url, empty, kb]) => {
      const m: DocMeta = { id, company, type, period, date, pages, en: !!en, title, url: d.files + url, empty, kb: kb ?? 0, base };
      base += pages;
      return m;
    });
    return { docs, byId: new Map(docs.map((x) => [x.id, x])), pages: d.pages, block: d.block, built: d.built, source: d.source };
  });
  corpusP.catch(() => { corpusP = null; });
  return corpusP;
}
let metaP: Promise<Meta> | null = null;
const loadMeta = () => { metaP ??= json<Meta>('ft/meta.json'); metaP.catch(() => { metaP = null; }); return metaP; };

const shards = new Map<number, Promise<Shard>>();
function loadShard(k: number): Promise<Shard> {
  let p = shards.get(k);
  if (!p) {
    p = bin(`ft/${k}.bin`).then((buf) => {
      const len = new DataView(buf).getUint32(0, true);
      const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
      return { head, body: new Uint8Array(buf, 4 + len) };
    });
    p.catch(() => shards.delete(k));
    shards.set(k, p);
  }
  return p;
}

/** The pages of one key, with their term frequency (1-4; a bitmap list counts 1). */
function postings(s: Shard, key: string): { pages: number[]; tf: number[]; df: number } | null {
  const h = s.head[key];
  if (!h) return null;
  const [df, off, len, enc] = h;
  const b = s.body.subarray(off, off + len);
  const pages: number[] = [], tf: number[] = [];
  if (enc === 1) {
    for (let i = 0; i < b.length; i++) { const v = b[i]; if (v) for (let j = 0; j < 8; j++) if (v & (1 << j)) { pages.push(i * 8 + j); tf.push(1); } }
  } else {
    let prev = -1;
    for (let i = 0; i < b.length;) {
      let v = 0, sh = 0, c: number;
      do { c = b[i++]; v += (c & 0x7f) * 2 ** sh; sh += 7; } while (c & 0x80);
      prev += Math.floor(v / 4); pages.push(prev); tf.push((v % 4) + 1);
    }
  }
  return { pages, tf, df };
}

export interface FtHit { doc: DocMeta; page: number; score: number; g: number }
export interface FtQuery { q: string; terms: string[]; skipped: string[]; missing: string[]; mode: 'and' | 'or' | 'none'; hits: FtHit[]; ms: number }

/** Year of a period key ("2025FY", "2026Q2") */
export const yearOf = (p: string) => Number(p.slice(0, 4)) || 0;

/** Every page that carries all the words (or, when none does, any of them), best first.
 *  Score: BM25-style idf x saturated term frequency per word; a word printed behind prefix letters counts 0.85;
 *  documents of later years rank a little higher. */
export async function searchText(q: string): Promise<FtQuery> {
  const t0 = performance.now();
  const [corpus, meta] = await Promise.all([loadCorpus(), loadMeta()]);
  const stop = new Set(meta.stop);
  const all = [...new Set(terms(q))].slice(0, 8);
  const skipped = all.filter((t) => stop.has(t)), qt = all.filter((t) => !stop.has(t));
  const res: FtQuery = { q, terms: qt, skipped, missing: [], mode: 'none', hits: [], ms: 0 };
  if (!qt.length) return res;
  const N = meta.pages;
  const lists = await Promise.all(qt.map(async (t) => {
    const s = await loadShard(fnv(t) % meta.shards);
    return { t, exact: postings(s, t), pref: /^[א-ת]/.test(t) ? postings(s, '~' + t) : null };
  }));
  const score = new Float32Array(N), hit = new Uint8Array(N);
  lists.forEach(({ t, exact, pref }, i) => {
    const df = Math.min(N, (exact?.df ?? 0) + (pref?.df ?? 0));
    if (!df) { res.missing.push(t); return; }
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const add = (l: typeof exact, w: number) => l?.pages.forEach((g, k) => {
      const tf = l.tf[k], v = idf * w * (tf * 2.2) / (tf + 1.2);
      if (!(hit[g] & (1 << i))) { hit[g] |= 1 << i; score[g] += v; } else score[g] = score[g] + v * 0.3;
    });
    add(exact, 1); add(pref, 0.85);
  });
  const want = (1 << qt.length) - 1;
  let pages: number[] = [];
  for (let g = 0; g < N; g++) if (hit[g] === want) pages.push(g);
  res.mode = 'and';
  if (!pages.length && qt.length > 1 && res.missing.length < qt.length) {
    res.mode = 'or';
    for (let g = 0; g < N; g++) if (hit[g]) pages.push(g);
  }
  if (!pages.length) { res.mode = 'none'; res.ms = performance.now() - t0; return res; }
  // page → document by binary search over the bases
  const docs = corpus.docs;
  const docOf = (g: number) => { let lo = 0, hi = docs.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (docs[mid].base <= g) lo = mid; else hi = mid - 1; } return docs[lo]; };
  const pop = (v: number) => { let c = 0; while (v) { c += v & 1; v >>= 1; } return c; };
  res.hits = pages.map((g) => {
    const doc = docOf(g);
    const rec = 1 + 0.06 * Math.max(0, yearOf(doc.period) - 2018);
    return { doc, page: g - doc.base + 1, g, score: (score[g] + (res.mode === 'or' ? pop(hit[g]) * 2 : 0)) * rec };
  }).sort((a, b) => b.score - a.score || a.g - b.g);
  res.ms = performance.now() - t0;
  return res;
}

/* ---------- page text ---------- */
const blocks = new Map<string, Promise<string[]>>();
export async function pageText(rid: number, page: number): Promise<string> {
  const corpus = await loadCorpus();
  const b = Math.floor((page - 1) / corpus.block), key = `${rid}/${b}`;
  let p = blocks.get(key);
  if (!p) {
    p = bin(`text/${key}.bin`).then((buf) => JSON.parse(new TextDecoder().decode(buf)) as string[]);
    p.catch(() => blocks.delete(key));
    blocks.set(key, p);
    if (blocks.size > 300) blocks.delete(blocks.keys().next().value!);
  }
  return unmark((await p)[(page - 1) % corpus.block] ?? '');
}

const MARK = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]+/g;
/** Page text without the bidi embedding marks pdftotext writes (a mark between two words becomes a space). The page is then
 *  shown cell by cell (runs split by two or more spaces), each cell isolated with its own direction: see LayoutText. */
export const unmark = (t: string) => t.replace(/([\p{L}\p{N}])[\u200E\u200F\u202A-\u202E\u2066-\u2069]+(?=[\p{L}\p{N}])/gu, '$1 ').replace(MARK, '')
  // a bracketed (negative) figure comes out of a right-to-left table as "()8,132": put the brackets back around it
  .replace(/\(\)(\d[\d.,]*%?)/g, '($1)');

/** Ranges that touch or are split only by spaces become one (a phrase is marked as one). */
export function mergeRanges(text: string, r: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of [...r].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s >= last[0] && /^[ \-־]*$/.test(text.slice(last[1], s))) last[1] = Math.max(last[1], e);
    else if (!last || s >= last[1]) out.push([s, e]);
  }
  return out;
}

/** The line of the page where the words appear (the first line that carries most of them), trimmed around the first match.
 *  Kept with its bidi marks and in the visual column order pdftotext prints, so it is shown left-to-right. */
export function snippet(text: string, qt: string[], width = 220): { line: string; ranges: [number, number][] } | null {
  const lines = text.split('\n').map((l) => l.replace(/ {3,}/g, '   ').trim());
  let best = -1, bestN = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = findTerms(lines[i], qt);
    if (!r.length) continue;
    const n = new Set(r.map(([s, e]) => normalize(lines[i].slice(s, e)))).size;
    if (n > bestN) { best = i; bestN = n; }
    if (n >= qt.length) break;
  }
  if (best < 0) return null;
  // a short line is shown with its neighbours, so the words have their sentence
  let line = lines[best];
  for (let k = 1; line.length < 110 && k <= 2; k++) {
    const nx = lines[best + k];
    if (nx) line = `${line}   ${nx}`;
  }
  let ranges = mergeRanges(line, findTerms(line, qt));
  if (line.length > width) {
    const c = ranges[0][0], from = Math.max(0, Math.min(c - width / 3, line.length - width)), to = Math.min(line.length, from + width);
    const s = from > 0 ? line.indexOf(' ', from) + 1 || from : 0, e = to < line.length ? line.lastIndexOf(' ', to) : to;
    const end = e > s ? e : to;
    ranges = ranges.filter(([a, z]) => a >= s && z <= end).map(([a, z]) => [a - s, z - s] as [number, number]);
    line = line.slice(s, end);
  }
  return { line, ranges };
}

/* ---------- recent searches ---------- */
const RECENT = 'fox:recentq';
export function recentQueries(): string[] { try { return (JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[]).slice(0, 6); } catch { return []; } }
export function rememberQuery(q: string) {
  const s = q.trim();
  if (s.length < 2) return;
  try { localStorage.setItem(RECENT, JSON.stringify([s, ...recentQueries().filter((x) => x !== s)].slice(0, 8))); } catch { /* storage may be blocked */ }
}

/** "?page=N&q=…" link of the in-app reader */
export const readerHref = (rid: number | string, page?: number | null, q?: string) => {
  const sp = new URLSearchParams();
  if (page) sp.set('page', String(page));
  if (q) sp.set('q', q);
  const s = sp.toString();
  return `/doc/${rid}${s ? `?${s}` : ''}`;
};
/** The MAYA report number of a filed PDF's address (…/P1766813-00.pdf), the reader's document id. */
export const ridOf = (url: string | null | undefined): number | null => { const m = url ? /P(\d{6,8})-\d+\.pdf/i.exec(url) ?? /maya\.tase\.co\.il\/(?:he\/)?reports\/(\d{6,8})/.exec(url) : null; return m ? Number(m[1]) : null; };
