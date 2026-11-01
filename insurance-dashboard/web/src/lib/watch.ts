/** S10 · Watch & Wake. The data contract is pipeline/build_watch.py (web/public/data/watch.json): the build-to-build diff of what the
 *  answers and findings SAY, from the append-only ledger of daily snapshots, and the dated calendar of what comes next. The browser holds
 *  the private half: what this person follows (a question, a finding, a topic, a company), the date of their last look, their meetings
 *  (the S3 registry). Nothing of it is sent anywhere. This file is pure (no React, no browser): tests/watch.unit.ts runs it in node. */
import type { Fig } from './answers';

/** one side of a change: the verdict key, the corridor as text, the corridor with its token and its figure (no provenance), the signature */
export interface WSide { vk: string | null; corr: string | null; cs: string | null; cf: Record<string, Omit<Fig, 'prov'>> | null; h: string | null; chg: 'holds' | 'tripped' | null }
export type WKind = 'answer' | 'tripped' | 'finding' | 'new' | 'gone';
export type WSev = 'verdict' | 'figure' | 'falsifier' | 'top' | null;
export interface WChange { d: string; pd: string; id: string; kind: WKind; sev: WSev; from: WSide | null; to: WSide | null; topic: string | null; cos: string[]; q: string | null; det: string | null }
export interface WUp { d: string; lo: string; hi: string; c: string; kind: 'report' | 'regmonth' | 'qend'; per: string | null; what: string; src: string; est: boolean; n?: number }
export interface WatchFile { v: 1; asof: string | null; snaps: string[]; snapsrc: Record<string, string>; n: Record<WKind, number>; changes: WChange[]; upcoming: WUp[];
  latest_regmonth: { per: string; label: string; d: string | null; dk: string | null } | null; rule: string }

/* ---------- subscriptions (browser only) ---------- */
/** what this browser follows: question ids, finding ids, topics, companies */
export interface Subs { v: 1; q: string[]; f: string[]; t: string[]; c: string[] }
export const NO_SUBS: Subs = { v: 1, q: [], f: [], t: [], c: [] };
export type SubKind = 'q' | 'f' | 't' | 'c';
/** a stored value of any shape back to a Subs (an older or hand-edited value never breaks the page) */
export function normSubs(x: unknown): Subs {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 80))].sort() : []);
  return { v: 1, q: arr(o.q), f: arr(o.f), t: arr(o.t), c: arr(o.c) };
}
export const isFollowed = (s: Subs, k: SubKind, id: string) => s[k].includes(id);
export function toggleSub(s: Subs, k: SubKind, id: string): Subs {
  const n = normSubs(s);
  return { ...n, [k]: n[k].includes(id) ? n[k].filter((x) => x !== id) : [...n[k], id].sort() };
}
export const subCount = (s: Subs) => s.q.length + s.f.length + s.t.length + s.c.length;
export const isFinding = (id: string) => id.startsWith('F-');

/** why a change concerns this browser: the id itself, its topic, or one of its companies (null: it does not) */
export interface Why { k: SubKind; id: string }
export function matchSub(c: Pick<WChange, 'id' | 'topic' | 'cos'>, s: Subs): Why | null {
  if (isFinding(c.id) ? s.f.includes(c.id) : s.q.includes(c.id)) return { k: isFinding(c.id) ? 'f' : 'q', id: c.id };
  if (c.topic && s.t.includes(c.topic)) return { k: 't', id: c.topic };
  const co = c.cos.find((x) => s.c.includes(x));
  return co ? { k: 'c', id: co } : null;
}

/** a change that tells: the verdict moved, the falsifier tripped or reverted, a question or finding appeared or went. Not one where only
 *  the number in the corridor moved (the data updated, the answer held) and not a finding merely re-ranked */
export const tells = (c: WChange) => c.kind === 'tripped' || c.kind === 'new' || c.kind === 'gone' || c.sev === 'verdict' || c.sev === 'falsifier';

/** the changes first seen after `since` (an ISO date; null: those of the latest build only) */
export function sinceOf(w: Pick<WatchFile, 'changes' | 'snaps'>, since: string | null): WChange[] {
  const from = since ?? (w.snaps.length > 1 ? w.snaps[w.snaps.length - 2] : null);
  if (!from) return [];
  return w.changes.filter((c) => c.d > from);
}

/** one entry per id over a span of builds: from its state before the first change to its state after the last (a question that changed
 *  and changed back drops out; one that appeared and went drops out) */
export function collapse(cs: WChange[]): WChange[] {
  const by = new Map<string, WChange[]>();
  for (const c of [...cs].sort((a, b) => a.d.localeCompare(b.d))) by.set(c.id, [...(by.get(c.id) ?? []), c]);
  const out: WChange[] = [];
  for (const xs of by.values()) {
    const first = xs[0], last = xs[xs.length - 1];
    if (xs.length === 1) { out.push(first); continue; }
    const from = first.from, to = last.to;
    const base = { ...last, pd: first.pd, from, to };
    if (!from && !to) continue;
    if (!from) { out.push({ ...base, kind: 'new', sev: null }); continue; }
    if (!to) { out.push({ ...base, kind: 'gone', sev: null }); continue; }
    if (from.chg !== 'tripped' && to.chg === 'tripped') { out.push({ ...base, kind: 'tripped', sev: from.vk !== to.vk ? 'verdict' : null }); continue; }
    const kind: WKind = isFinding(last.id) ? 'finding' : 'answer';
    const sev: WSev = from.vk !== to.vk ? 'verdict' : from.chg === 'tripped' && to.chg !== 'tripped' ? 'falsifier' : from.corr !== to.corr ? 'figure'
      : xs.some((x) => x.sev === 'top') ? 'top' : null;
    if (sev) out.push({ ...base, kind, sev });
  }
  return out;
}

export interface Brief {
  since: string | null; first: boolean;
  /** followed: the verdict changed / the falsifier tripped / new or gone; then followed changes where only the number moved */
  mine: WChange[]; mineFig: WChange[];
  tripped: WChange[]; newFindings: WChange[];
  /** everything else that changed (not followed) */
  rest: WChange[];
  /** count for the badge and the home line: followed changes that tell */
  count: number;
}
const ORDER: Record<WKind, number> = { tripped: 0, answer: 1, finding: 2, new: 3, gone: 4 };
const byWeight = (a: WChange, b: WChange) => ORDER[a.kind] - ORDER[b.kind] || b.d.localeCompare(a.d) || a.id.localeCompare(b.id);

/** the morning brief: what changed since `since` (null = never looked: the latest build's changes), split by what this browser follows */
export function brief(w: Pick<WatchFile, 'changes' | 'snaps'>, subs: Subs, since: string | null): Brief {
  const cs = collapse(sinceOf(w, since)).sort(byWeight);
  const followed = cs.filter((c) => matchSub(c, subs));
  const mine = followed.filter(tells), mineFig = followed.filter((c) => !tells(c));
  const others = cs.filter((c) => !matchSub(c, subs));
  return {
    since: since ?? (w.snaps.length > 1 ? w.snaps[w.snaps.length - 2] : null), first: since == null,
    mine, mineFig,
    tripped: cs.filter((c) => c.kind === 'tripped'),
    newFindings: cs.filter((c) => c.kind === 'new' && isFinding(c.id)),
    rest: others,
    count: mine.length,
  };
}
/** the badge: followed changes that tell, since the last look (0 when nothing is followed) */
export const newsCount = (w: Pick<WatchFile, 'changes' | 'snaps'> | null, subs: Subs, since: string | null): number =>
  !w || !subCount(subs) ? 0 : brief(w, subs, since).count;

/* ---------- the prep queue ---------- */
/** a meeting of the S3 registry (localStorage key 'meetings'): read defensively, any other shape is skipped */
export interface Meeting { id: string; name: string; type?: string; date: string }
export function readMeetings(x: unknown): Meeting[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((m) => {
    if (!m || typeof m !== 'object') return [];
    const o = m as Record<string, unknown>;
    const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(o.date) ? o.date.slice(0, 10) : null;
    const name = typeof o.name === 'string' ? o.name : null;
    if (!date || !name) return [];
    return [{ id: typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id) : `${date}|${name}`, name, type: typeof o.type === 'string' ? o.type : undefined, date }];
  });
}
/** whole days from `today` to `d` (both ISO dates, calendar days) */
export function daysTo(d: string, today: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)), b = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((b - a) / 86400000);
}
export interface PrepItem { d: string; days: number; kind: WUp['kind'] | 'meeting'; c: string | null; what: string; src: string | null; est: boolean; lo?: string; hi?: string; id: string }
/** the published upcoming events and this browser's meetings, from today on (an expected date that has passed but whose window has not
 *  stays, marked by its negative days), in date order, at most `horizon` days ahead */
export function prepQueue(up: WUp[], meetings: Meeting[], today: string, horizon = 75): PrepItem[] {
  const pub: PrepItem[] = up.filter((u) => u.hi >= today && daysTo(u.d, today) <= horizon)
    .map((u) => ({ d: u.d, days: daysTo(u.d, today), kind: u.kind, c: u.c === 'market' ? null : u.c, what: u.what, src: u.src, est: u.est, lo: u.lo, hi: u.hi, id: `${u.kind}|${u.c}|${u.per ?? u.d}` }));
  const own: PrepItem[] = meetings.filter((m) => m.date >= today && daysTo(m.date, today) <= horizon)
    .map((m) => ({ d: m.date, days: daysTo(m.date, today), kind: 'meeting', c: null, what: m.name, src: null, est: false, id: `m|${m.id}` }));
  return [...pub, ...own].sort((a, b) => a.d.localeCompare(b.d) || (a.kind === 'meeting' ? -1 : 0) - (b.kind === 'meeting' ? -1 : 0) || a.id.localeCompare(b.id));
}
export const KIND_HE: Record<WKind, string> = { answer: 'התשובה השתנתה', tripped: 'הסף נחצה', finding: 'הממצא השתנה', new: 'חדש', gone: 'ירד' };
export const SEV_HE: Record<Exclude<WSev, null>, string> = { verdict: 'הפסיקה השתנתה', figure: 'המספר זז, הפסיקה עומדת', falsifier: 'חזר מתחת לסף', top: 'נכנס למובילים או יצא מהם' };
