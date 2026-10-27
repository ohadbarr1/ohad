/** The omnibox: one query, ranked results grouped by kind. Entities (companies, market groups, funds) and statement lines
 *  are matched here, in the browser, with the Hebrew normaliser; filing text comes from the full-text index (lib/search.ts).
 *  A query may name a company ("הראל csm", "בהראל רכיב הפסד"), a period ("Q2'26", "FY'25", "2026Q2") and a kind of
 *  document ("מצגת"): they become filters and the rest is searched. */
import { matches, normalize, startsWord, stems, terms } from './hebrew';
import type { RegistryCompany } from './types';
import { DOC_TYPE_HE, type Corpus, type DocMeta, type DocType } from './search';

export type Kind = 'אחרונים' | 'חיפושים' | 'חברה' | 'פונקציה' | 'קופה' | 'שורה בדוח' | 'מסמך';
export interface Item { kind: Kind; label: string; meta: string; to: string; score: number; sub?: string }

/** Screens that exist for every company, with the short codes that reach them: "הראל csm", "phoenix dcf". */
export const FUNCS: { code: string; badge: string; label: string; keys: string[]; to: (id: string) => string }[] = [
  { code: 'ER', badge: 'סקירה', label: 'סקירת דוח', keys: ['er', 'review', 'סקירת', 'סקירה', 'yoy', 'qoq'], to: (id) => `/company/${id}/review` },
  { code: 'RANK', badge: 'דירוג', label: 'מול השוק, לפי מסלול', keys: ['rank', 'דירוג', 'מסלולים', 'יצרן', 'תשואות'], to: (id) => `/managers?v=makers&mk=${id}` },
  { code: 'SOP', badge: 'מקורות רווח', label: 'מקורות רווח וענפים', keys: ['sop', 'מקורות', 'ענפים', 'נוסטרו', 'combined', 'lob'], to: (id) => `/company/${id}/profit` },
  { code: 'CSM', badge: 'CSM', label: 'IFRS 17 · CSM', keys: ['csm', 'ifrs', 'ra', 'רגישויות', 'solvency', 'סולבנסי', 'כושר', 'פירעון'], to: (id) => `/company/${id}/ifrs17` },
  { code: 'FA', badge: 'דוחות', label: 'דוחות לאורך זמן', keys: ['fa', 'דוחות', 'financials'], to: (id) => `/company/${id}/financials` },
  { code: 'LTS', badge: 'חיסכון', label: 'חיסכון ארוך טווח', keys: ['lts', 'חיסכון', 'פנסיה', 'גמל', 'aum'], to: (id) => `/company/${id}/savings` },
  { code: 'DOC', badge: 'מסמכים', label: 'מסמכים', keys: ['doc', 'docs', 'מסמכים', 'filings'], to: (id) => `/company/${id}/filings` },
  { code: 'NEW', badge: 'מה השתנה', label: 'מה השתנה', keys: ['new', 'feed', 'פיד', 'מה', 'שינויים', 'השתנה', 'חדש', 'חדשות', 'עדכונים', 'delta'].map(normalize), to: (id) => `/feed?co=${id}` },
  { code: 'VAL', badge: 'שווי', label: 'הערכת שווי, P/B מוצדק', keys: ['val', 'valuation', 'שווי', 'הערכת', 'pb', 'p/b', 'מכפיל'], to: (id) => `/valuation/${id}` },
  { code: 'RI', badge: 'הכנסה שיורית', label: 'הערכת שווי, הכנסה שיורית', keys: ['ri', 'שיורית', 'residual'], to: (id) => `/valuation/${id}/ri` },
];
/** words that reach the delta feed (/feed) without a company */
const FEED_KEYS = ['feed', 'new', 'delta', 'פיד', 'שינויים', 'השתנה', 'מה', 'חדש', 'חדשות', 'עדכונים', 'עדכון'].map(normalize);
/** words that reach the scenario studio (/scenarios, module A2) without a company */
const SCN_KEYS = ['scenario', 'scenarios', 'stress', 'shock', 'war', 'תרחיש', 'תרחישים', 'זעזוע', 'סטרס', 'חדר', 'מלחמה', 'רגישות', 'ריבית', 'מפולת', 'סטגפלציה', '2008'].map(normalize);
/** other names a reader types for a company */
const ALIAS: Record<string, string[]> = { phoenix: ['פניקס', 'fnx'], harel: ['harel'], migdal: ['migdal'], hachshara: ['hachshara'], ayalon: ['ayalon'], meitav: ['meitav', 'מיטב דש'], analyst: ['analyst'], menora: ['מנורה'], altshuler: ['אלטשולר'], yelin: ['ילין'], idi: ['ישיר', 'direct'], more_gemel: [], clal: ['clal'], ibi: ['איביאי', 'אי בי אי'] };
const TYPE_WORDS: [DocType, string[]][] = [
  ['presentation', ['מצגת', 'מצגות', 'presentation', 'deck', 'מצגת משקיעים']], ['solvency', ['סולבנסי', 'סולבנצי', 'פירעון', 'solvency', 'כושר', 'sii', 'סולבנסי2']],
  ['annual', ['שנתי', 'תקופתי', 'annual']], ['quarterly', ['רבעוני', 'רבעון', 'quarterly']],
];

export interface Parsed { words: string[]; company: RegistryCompany | null; period: string | null; type: DocType | null; rest: string[]; restText: string }

/** "Q2'26" → 2026Q2, "FY'25" / "FY2025" / "2025FY" → 2025FY, "H1'26" → 2026Q2 (the half-year report is the Q2 report) */
export function parsePeriod(q: string): { period: string | null; text: string } {
  const pats: [RegExp, (m: RegExpExecArray) => string][] = [
    [/\b(q[1-4]|h[12]|fy|9m)\s*['׳’`]?\s*(20\d{2}|\d{2})\b/i, (m) => key(m[1], m[2])],
    [/\b(20\d{2})\s*(q[1-4]|fy|h[12])\b/i, (m) => key(m[2], m[1])],
  ];
  for (const [re, f] of pats) { const m = re.exec(q); if (m) return { period: f(m), text: (q.slice(0, m.index) + ' ' + q.slice(m.index + m[0].length)).trim() }; }
  return { period: null, text: q };
  function key(k: string, y: string) {
    const yr = y.length === 2 ? `20${y}` : y, u = k.toUpperCase();
    return u === 'FY' || u === 'H2' ? `${yr}FY` : u === 'H1' ? `${yr}Q2` : u === '9M' ? `${yr}Q3` : `${yr}${u}`;
  }
}
export const periodText = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);

/** the alias words of each company, normalised */
export function companyNames(reg: RegistryCompany[]): { c: RegistryCompany; names: string[][] }[] {
  return reg.map((c) => ({ c, names: [c.name_he, c.name_en, c.id, ...(ALIAS[c.id] ?? [])].filter(Boolean).map((n) => terms(n.replace(/_/g, ' '))).filter((w) => w.length) }));
}

/** The query split into a company, a period, a document kind and the words left to search. */
export function parse(q: string, names: ReturnType<typeof companyNames>): Parsed {
  const { period, text } = parsePeriod(q);
  const all = terms(text);
  // the longest company name found among the words, also behind prefix letters ("בהראל")
  let company: RegistryCompany | null = null, at = -1, len = 0;
  for (const { c, names: ns } of names) for (const n of ns) {
    for (let i = 0; i + n.length <= all.length; i++) {
      if (n.length > len && n.every((w, j) => matches(all[i + j], w))) { company = c; at = i; len = n.length; }
    }
  }
  const words = company ? [...all.slice(0, at), ...all.slice(at + len)] : all;
  let type: DocType | null = null;
  const rest = words.filter((w) => { const t = TYPE_WORDS.find(([, ks]) => ks.some((k) => matches(w, normalize(k)))); if (t && !type) { type = t[0]; return false; } return true; });
  return { words: all, company, period, type, rest, restText: rest.join(' ') };
}

export interface Pool { reg: RegistryCompany[]; names: ReturnType<typeof companyNames>; groups: { label: string; words: string[] }[]; funds: { label: string; grp: string; words: string[] }[]; rows: { c: string; sheet: string; label: string; i: number; words: string[] }[] }

export function buildPool(reg: RegistryCompany[], groups: string[], funds: [string, string][], rows: [string, string, string, number][]): Pool {
  return {
    reg, names: companyNames(reg),
    groups: groups.map((g) => ({ label: g, words: terms(g) })),
    funds: funds.map(([label, grp]) => ({ label, grp, words: terms(label) })),
    rows: rows.map(([c, sheet, label, i]) => ({ c, sheet, label, i, words: terms(label) })),
  };
}

/** every query word starts a word of the caption (directly or behind prefix letters); 0 when one does not */
function wordScore(caption: string[], qs: string[]): number {
  if (!qs.length) return 0;
  let s = 0;
  for (const q of qs) {
    const exact = caption.some((w) => w === q || stems(w).includes(q));
    const pre = exact ? 2 : startsWord(caption, q);
    if (!pre) return 0;
    s += exact ? 3 : pre;
  }
  return s / qs.length;
}

/** The entity, function and statement-line results of a query, best first within each kind. */
export function rank(q: string, pool: Pool, sheetName: (s: string) => string, docs?: Corpus | null): Item[] {
  const p = parse(q, pool.names);
  const out: Item[] = [];
  const name = (id: string) => pool.reg.find((c) => c.id === id)?.name_he ?? id;
  const words = p.words;
  // companies: a name typed in full ranks above one whose name only starts with the query
  for (const { c, names } of pool.names) {
    let s = 0;
    if (p.company?.id === c.id) s = 100;
    else if (words.length === 1) for (const n of names) { const w = wordScore(n, words); if (w) s = Math.max(s, 60 + w * 10); }
    if (s) out.push({ kind: 'חברה', label: c.name_he, sub: c.name_en, meta: c.kind === 'insurance_group' ? 'קבוצת ביטוח' : 'בית השקעות', to: `/company/${c.id}`, score: s });
  }
  // company + function code or word
  if (p.company) {
    const c = p.company, rest = p.rest;
    FUNCS.filter((f) => rest.length === 0 || rest.every((w) => f.keys.some((k) => k.startsWith(w)) || f.code.toLowerCase().startsWith(w)))
      .slice(0, rest.length ? 4 : 9).forEach((f, i) => out.push({ kind: 'פונקציה', label: `${c.name_he} · ${f.label}`, meta: f.badge, to: f.to(c.id) + (p.period && /\/company\//.test(f.to(c.id)) ? `?p=${p.period}` : ''), score: (rest.length ? 95 : 50) - i }));
  }
  // screens that are not per company: the delta feed (module M2)
  if (!p.company && words.length && words.every((w) => FEED_KEYS.some((k) => k.startsWith(w)))) {
    out.push({ kind: 'פונקציה', label: 'מה השתנה · כל השינויים', meta: 'דוחות, הצגות מחדש, כושר פירעון, יעדים, נתוני הרשות', to: '/feed', score: 96 });
  }
  // the scenario studio (module A2)
  if (!p.company && words.length && words.every((w) => SCN_KEYS.some((k) => k.startsWith(w)))) {
    out.push({ kind: 'פונקציה', label: 'חדר תרחישים · כל החברות תחת זעזוע', meta: 'ריבית, מניות, מדד, ניוד, דמי ניהול: דירוג פגיעות', to: '/scenarios', score: 97 });
  }
  // market groups and funds (no company filter: a fund's name carries its maker)
  if (words.length) {
    pool.groups.forEach((g) => { const s = wordScore(g.words, words); if (s) out.push({ kind: 'קופה', label: g.label, meta: 'קבוצה · פנסיה, גמל וביטוח', to: `/savings?g=${encodeURIComponent(g.label)}`, score: 70 + s }); });
    let n = 0;
    for (const f of pool.funds) {
      const s = wordScore(f.words, words);
      if (s) { out.push({ kind: 'קופה', label: f.label, meta: f.grp, to: `/funds?q=${encodeURIComponent(f.label)}`, score: 55 + s - f.label.length / 200 }); if (++n > 60) break; }
    }
  }
  // statement lines: the words left after the company, within that company when one was named
  const lw = p.company ? p.rest : words;
  if (lw.length) {
    for (const r of pool.rows) {
      if (p.company && r.c !== p.company.id) continue;
      const s = wordScore(r.words, lw);
      if (s) out.push({ kind: 'שורה בדוח', label: r.label, meta: `${name(r.c)} · ${sheetName(r.sheet)}`, to: `/company/${r.c}/financials?sheet=${encodeURIComponent(r.sheet)}&m=${r.i}`, score: 40 + s * 3 - Math.min(r.label.length, 120) / 30 });
    }
  }
  // documents by name: a company with a kind of document or a period ("מצגת הראל Q2'26")
  if (docs && p.company && (p.type || p.period) && p.rest.length === 0) {
    docs.docs.filter((d) => d.company === p.company!.id && (!p.type || d.type === p.type) && (!p.period || d.period === p.period))
      .slice(0, 5).forEach((d, i) => out.push({ kind: 'מסמך', label: docLabel(d, name), meta: `${d.pages} עמ׳`, to: `/doc/${d.id}`, score: 90 - i }));
  }
  const cap: Partial<Record<Kind, number>> = { 'חברה': 5, 'פונקציה': 9, 'קופה': 6, 'שורה בדוח': 7, 'מסמך': 5 };
  const by = new Map<Kind, Item[]>();
  out.sort((a, b) => b.score - a.score).forEach((it) => { const l = by.get(it.kind) ?? []; if (l.length < (cap[it.kind] ?? 6)) { l.push(it); by.set(it.kind, l); } });
  return [...by.values()].flat();
}

export const docLabel = (d: DocMeta, name: (id: string) => string) => `${name(d.company)} · ${DOC_TYPE_HE[d.type]}${d.en ? ' (EN)' : ''} ${periodText(d.period)}`;
