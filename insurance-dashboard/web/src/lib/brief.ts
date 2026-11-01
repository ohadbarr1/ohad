/* S3 · the Briefing Builder, pure part (no React, no browser): the meeting registry's shape and templates, the cadence arithmetic, and
   the section builders of a one-page brief. The page (pages/Brief.tsx) and the document (lib/briefDoc.ts) both read `buildBrief`; the
   unit test (tests/brief.unit.ts) runs it in node on fixtures.
   PRIVATE: a meeting (its name, audience, agenda, focus) lives only in this browser (localStorage key 'meetings'); nothing here is
   ever written to web/public/data or sent anywhere. Every number a section quotes is a sourced figure (answer_core `fig` shape). */
import { isOk, topFirst, type Fig, type Finding, type FindingsFile, type IndexFile, type IndexRow, type OkBody } from './answers';
import { fmtFig, type FeedEvent, type FeedFig, type FeedFile, type FeedType } from './feed';
import { headline, SEG_HE, ST_HE, UNIT_OF, type FragFile, type ProvJ, type SegId, type SigId } from './fragility';

/* ---------------------------------------------------------------------------------------------------------- the registry */
export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'once';
export type MeetingType = 'exec' | 'board' | 'division' | 'pipeline' | 'earnings' | 'regulator' | 'dist';
/** one meeting as stored in this browser. S10 reads {id, name, type, date}; `n` (how many likely questions) is an optional extension */
export interface Meeting {
  id: string; name: string; type: MeetingType; date: string; cadence: Cadence; audience: string; agenda: string[];
  /** answer_core CHAIRS keys */ chairs: string[]; /** answer_core TOPICS keys */ topics: string[]; /** company ids */ cos: string[];
  /** YYYY-MM-DD of the last meeting held */ last?: string; n?: number;
}
export interface Template { he: string; chairs: string[]; topics: string[]; cos: string[]; n: number; cadence: Cadence; hint: string }
/** the pre-loaded meeting types: who asks, about what, how many likely questions, how often. Companies in focus are the user's pick
 *  (a template names none: an empty list is the whole industry) */
export const TEMPLATES: Record<MeetingType, Template> = {
  exec: { he: 'פורום הנהלה', chairs: ['ceo', 'cfo', 'strat'], topics: ['flows', 'fees', 'cost', 'comp'], cos: [], n: 5, cadence: 'weekly', hint: 'מה זז השבוע ומה עושים מולו' },
  board: { he: 'דירקטוריון', chairs: ['board', 'cfo'], topics: ['capital', 'targets', 'val', 'regx'], cos: [], n: 6, cadence: 'quarterly', hint: 'הון, יעדים, שווי וחשיפה רגולטורית' },
  division: { he: 'סקירה רבעונית של חטיבה', chairs: ['ceo', 'cfo'], topics: ['flows', 'fees', 'cost', 'mix', 'perf'], cos: [], n: 6, cadence: 'quarterly', hint: 'ניודים, דמי ניהול, עלויות, תמהיל ותשואות' },
  pipeline: { he: 'ישיבת פייפליין', chairs: ['strat', 'ceo', 'inv'], topics: ['comp', 'val', 'capital', 'flows'], cos: [], n: 5, cadence: 'monthly', hint: 'מהלכי מתחרים, שווי והון פנוי' },
  earnings: { he: 'הכנה לדוחות', chairs: ['inv', 'cfo', 'board'], topics: ['targets', 'capital', 'val', 'cost'], cos: [], n: 7, cadence: 'quarterly', hint: 'מה האנליסטים ישאלו על הרבעון' },
  regulator: { he: 'מפגש עם הרגולטור', chairs: ['reg'], topics: ['regx', 'fees', 'capital'], cos: [], n: 5, cadence: 'once', hint: 'דמי ניהול, כושר פירעון וחשיפה רגולטורית' },
  dist: { he: 'סקירת מפיצים', chairs: ['dist'], topics: ['channel', 'fees', 'flows', 'perf'], cos: [], n: 5, cadence: 'monthly', hint: 'ניודים, דמי ניהול ותשואות מול הסוכנים' },
};
export const TYPE_ORDER: MeetingType[] = ['exec', 'board', 'division', 'pipeline', 'earnings', 'regulator', 'dist'];
export const CADENCE_HE: Record<Cadence, string> = { weekly: 'שבועית', monthly: 'חודשית', quarterly: 'רבעונית', once: 'חד-פעמית' };
/** the look-back when no meeting has been marked as held: 7 / 30 / 90 days by cadence (a one-off meeting: 30) */
export const LOOKBACK: Record<Cadence, number> = { weekly: 7, monthly: 30, quarterly: 90, once: 30 };

/* ---------- dates (YYYY-MM-DD, UTC arithmetic so a day is a day everywhere) ---------- */
const D = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => iso(D(s) + n * 86400000);
export const daysBetween = (a: string, b: string) => Math.round((D(b) - D(a)) / 86400000);
/** months forward, the day clamped to the month's last day (31.01 + 1 month = 28/29.02) */
export function addMonths(s: string, n: number): string {
  const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n, d = +s.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m, Math.min(d, last)));
}
/** the meeting after this one by cadence (a one-off meeting has none: its own date) */
export const nextDate = (date: string, c: Cadence) => (c === 'weekly' ? addDays(date, 7) : c === 'monthly' ? addMonths(date, 1) : c === 'quarterly' ? addMonths(date, 3) : date);
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(D(s)) && iso(D(s)) === s;
/** dd.mm.yy */
export const dmy = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(2, 4)}`;
/** today in the browser's own calendar, YYYY-MM-DD */
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** "mark as held": the last meeting is this one; the next date rolls forward by cadence (a one-off meeting keeps its date) */
export const markHeld = (m: Meeting): Meeting => ({ ...m, last: m.date, date: nextDate(m.date, m.cadence) });

/** a new meeting of a type, its preset filled in */
export function fromTemplate(type: MeetingType, today: string, id: string): Meeting {
  const t = TEMPLATES[type];
  return { id, name: t.he, type, date: nextDate(today, t.cadence === 'once' ? 'weekly' : t.cadence), cadence: t.cadence, audience: '', agenda: [], chairs: [...t.chairs], topics: [...t.topics], cos: [...t.cos], n: t.n };
}

/** a stored or imported meeting, checked field by field (a malformed one is dropped, never half-read) */
export function cleanMeeting(x: unknown): Meeting | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string' || !isDate(o.date)) return null;
  const type = (TYPE_ORDER as string[]).includes(o.type as string) ? (o.type as MeetingType) : 'exec';
  const cadence = (['weekly', 'monthly', 'quarterly', 'once'] as string[]).includes(o.cadence as string) ? (o.cadence as Cadence) : TEMPLATES[type].cadence;
  const n = typeof o.n === 'number' && o.n >= 1 && o.n <= 20 ? Math.round(o.n) : undefined;
  return { id: o.id, name: o.name.slice(0, 160), type, date: o.date, cadence, audience: typeof o.audience === 'string' ? o.audience.slice(0, 300) : '', agenda: strs(o.agenda).slice(0, 30),
    chairs: strs(o.chairs), topics: strs(o.topics), cos: strs(o.cos), ...(isDate(o.last) ? { last: o.last } : {}), ...(n ? { n } : {}) };
}
/** the export file of the registry (the user's own setup, kept by the user) */
export interface MeetingsFile { v: 1; kind: 'meetings'; exported: string; meetings: Meeting[] }
export function parseMeetingsFile(text: string): Meeting[] | null {
  try {
    const j = JSON.parse(text) as unknown;
    const list = Array.isArray(j) ? j : j && typeof j === 'object' && Array.isArray((j as MeetingsFile).meetings) ? (j as MeetingsFile).meetings : null;
    return list ? list.map(cleanMeeting).filter((m): m is Meeting => !!m) : null;
  } catch { return null; }
}
/** imported meetings replace the stored ones with the same id, the rest are added */
export const mergeMeetings = (have: Meeting[], add: Meeting[]): Meeting[] => [...have.filter((m) => !add.some((a) => a.id === m.id)), ...add];

/** the built-in demo meeting (/brief/demo): a board meeting two weeks out on two named insurers, so a first visit sees a real brief */
export const demoMeeting = (today: string): Meeting => ({
  id: 'demo', name: 'דירקטוריון · ישיבה רבעונית (דוגמה)', type: 'board', date: addDays(today, 14), cadence: 'quarterly', audience: 'חברי הדירקטוריון, מנכ״ל, סמנכ״ל כספים',
  agenda: ['תוצאות הרבעון מול היעדים', 'הון וכושר פירעון', 'מהלכי מתחרים'], chairs: ['board', 'cfo'], topics: ['capital', 'targets', 'val', 'regx', 'flows'], cos: ['migdal', 'clal'], n: 6,
});

/* ---------------------------------------------------------------------------------------------------------- inputs */
/** calendar.json: each company's next expected report */
export interface CalFile { built: string; basis: string; companies: { id: string; name: string; next?: { period: string; end?: string; expected: string; lo?: string; hi?: string; n?: number } | null }[] }
/** watch.json (S10's contract): answer changes seen build to build, and what is coming */
export interface WatchChange { d: string; id: string; kind: 'answer' | 'finding' | 'tripped' | 'new' | 'gone'; from: { vk: string; corr: string } | null; to: { vk: string; corr: string } | null; topic?: string; cos?: string[] }
export interface WatchFile { v: number; asof: string; snaps?: string[]; changes: WatchChange[]; upcoming?: { d: string; c: string; what: string; src?: string }[]; latest_regmonth?: string }
export interface BriefData {
  /** YYYY-MM-DD */ today: string;
  index: IndexFile | null; findings: FindingsFile | null; feed: FeedFile | null; frag: FragFile | null; cal: CalFile | null; watch: WatchFile | null;
  /** company id → Hebrew name */ names: Record<string, string>;
}

/* ---------------------------------------------------------------------------------------------------------- the model */
export interface EventLine { e: FeedEvent; /** the event's key number and its change, as sourced figures */ fig: Fig | null; dfig: Fig | null; focus: boolean }
export interface QLine { row: IndexRow; why: string[]; changed: string | null }
export type Flag =
  | { k: 'tripped'; row: IndexRow }
  | { k: 'frag'; c: string; sig: SigId; sigHe: string; seg: SegId | null; st: 'watch' | 'alert'; fig: Fig | null; to: string }
  | { k: 'saydo'; f: Finding & OkBody }
  | { k: 'target'; e: FeedEvent; fig: Fig | null }
  | { k: 'report'; c: string; name: string; period: string; expected: string; lo?: string; hi?: string; before: boolean };
export interface Brief {
  m: Meeting; today: string;
  /** the start of "since the last meeting": `last`, else today − LOOKBACK[cadence] */ since: string; days: number; sinceIsLast: boolean;
  /** the window for upcoming reports: today .. the meeting after this one */ until: string;
  events: EventLine[]; eventsMore: number; feedMissing: boolean;
  changes: { c: WatchChange; row: IndexRow | null }[]; watch: 'absent' | 'ok';
  three: { id: string; f: Fig; row: IndexRow }[];
  questions: QLine[]; qPool: number; indexMissing: boolean;
  lead: { f: Finding & OkBody; scope: 'focus' | 'industry' } | null; findingsMissing: boolean;
  flags: Flag[];
}

/* ---------- rules (each stated on the page) ---------- */
/** the order of "since the last meeting": the kind of event first (a missed target, a fragility alert, a restatement ... down to a
 *  regulator month), then an event on a focus company before one on another, then the newest */
export const EVENT_RANK: Record<string, number> = { 'target:missed': 0, 'target:partial': 1, 'fragility:alert': 2, restate: 3, solv: 4, flow: 5, filing: 6, 'fragility:watch': 7, 'target:met': 8, fee: 9, est: 10, pos: 11, regmonth: 12 };
export const EVENT_RULE = 'סדר: יעד שהוחמץ, יעד שהושג חלקית, התראת שבריריות, הצגה מחדש, כושר פירעון, מעבר בצבירה נטו, דוח חדש, מעקב שבריריות, יעד שהושג, דמי ניהול, חודש נתוני רשות; בתוך כל סוג, חברה במוקד לפני אחרת, והחדש לפני הישן';
export const THREE_RULE = 'הכלל: עוברים על השאלות הצפויות לפי הדירוג שלהן, ולוקחים מכל אחת את הנתון של משפט המסדרון שלה, עד שלושה נתונים שונים. בלי בחירה ידנית: אותה פגישה ואותם נתונים נותנים את אותם שלושה מספרים';
export const Q_RULE = 'דירוג: שאלה שהסף שלה נחצה קודם; אחר כך שאלה שמושב שיושב בפגישה שואל, שאלה ממוקדת בחברות שבמוקד (החלק של החברות שלה שבמוקד), מספר החברות שלה שבמוקד, מספר המושבים שלה בפגישה, נושא שבמוקד, והשאלה שהתשובה שלה השתנתה לאחרונה; בשוויון לפי המזהה. שאלה על חברה אחרת מזו שבמוקד אינה נכללת';
const evKey = (e: FeedEvent) => (e.t === 'target' ? `target:${e.st ?? 'met'}` : e.t === 'fragility' ? `fragility:${e.fs ?? 'watch'}` : e.t);

/** which feed event types and which fragility signals speak to a topic */
const TOPIC_TYPES: Record<string, FeedType[]> = {
  flows: ['flow', 'regmonth', 'fragility'], fees: ['fee', 'fragility'], cost: ['filing', 'fragility'], mix: ['filing', 'regmonth'], comp: ['flow', 'fee', 'filing'],
  regx: ['regmonth'], capital: ['solv', 'restate', 'fragility'], targets: ['target'], channel: ['flow'], perf: ['fragility', 'regmonth'], val: ['filing', 'restate'],
};
const TOPIC_SIGS: Record<string, SigId[]> = { flows: ['flow'], fees: ['fee'], perf: ['perf'], cost: ['cost'], capital: ['solv', 'csm', 'scen'], channel: ['flow'] };
/** calendar.json and feed.json list the managing company of a group under its own id: it is the group, for the focus */
export const canon = (c: string) => c.replace(/_gemel$/, '');
const inFocus = (m: Meeting, c: string) => m.cos.includes(canon(c));

/* ---------- figures ---------- */
const UNIT_FIG: Record<string, string> = { m: 'm', dm: 'm', bn: 'bn', dbn: 'bn', pct: 'pct', dpct: 'pct', pp: 'pp', r: 'r', n: 'n' };
/** a feed figure's display text with its unit, the way an answer figure reads ("₪60.9 מיליון", "+0.05 נק׳") */
export function feedText(f: Pick<FeedFig, 'v' | 'u'>): string {
  const s = fmtFig(f);
  switch (f.u) {
    case 'm': case 'dm': { const sign = /^[+−-]/.test(s) ? s[0] : ''; return `${sign}₪${s.replace(/^[+−-]/, '')} מיליון`; }
    case 'bn': case 'dbn': { const sign = /^[+−-]/.test(s) ? s[0] : ''; return `${sign}₪${s.replace(/^[+−-]/, '')} מיליארד`; }
    case 'pp': return `${s} נק׳`;
    case 'dpct': return s;
    default: return s;
  }
}
const ym = (x: number) => `${String(x % 100).padStart(2, '0')}/${String(Math.floor(x / 100)).slice(2)}`;
const perLabel = (p: string) => (!p ? '' : /^\d{6}$/.test(p) ? ym(Number(p)) : p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : /^\d{4}Q\d$/.test(p) ? `${p.slice(4)}'${p.slice(2, 4)}` : p);
const DOC_HE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'דוח כושר פירעון' };
/** a feed figure's source as a provenance node (the ProvJ shape answers carry), so the doc's renderers footnote it */
export function feedProv(F: FeedFile, f: FeedFig, title: string, depth = 0): ProvJ {
  const s = f.s, value = feedText(f);
  switch (s.k) {
    case 'pg': {
      const d = F.docs[String(s.rid)];
      return { k: 'report', title, value, url: d ? F.files + d[4] : null, pg: s.pg, doc: d ? `${F.cos[d[0]] ?? d[0]}, ${DOC_HE[d[1]] ?? 'דוח'}${d[2] ? ` ${perLabel(d[2])}` : ''}` : `דוח ${s.rid}`, period: d?.[2] ? perLabel(d[2]) : undefined, srcType: d ? DOC_HE[d[1]] : undefined };
    }
    case 'reg': return { k: 'reg', metric: s.metric, pi: s.pi, w: s.w, set: s.set, g: s.g };
    case 'fund': return { k: 'fund', title, value, ds: s.ds, id: s.id, period: s.ym, col: s.col };
    case 'calc': return { k: 'calc', title, value, formula: s.fx, inputs: depth > 4 ? [] : s.in.map((x) => ({ label: x.l ?? '', v: feedText(x), p: feedProv(F, x, `${x.l ?? ''} · ${title}`, depth + 1) })) };
    case 'count': return { k: 'calc', title, value, formula: s.fx, inputs: [] };
    case 'pos': return { k: 'calc', title, value, formula: `ערך המדד של העמדה ב-${perLabel(s.per)}; המקור המלא בדף העמדה /positions/${s.pid}`, inputs: [] };
    case 'frag': return { k: 'calc', title, value, formula: `ערך האות במוניטור השבריריות ב-${perLabel(s.per)}; המקורות המלאים ב-/fragility?c=${s.c}&s=${s.sig}`, inputs: [] };
  }
}
export function feedFig(F: FeedFile, f: FeedFig, label: string, asof: string): Fig {
  return { l: label, v: f.v, u: UNIT_FIG[f.u] ?? f.u, t: feedText(f), b: 'actual', asof, prov: feedProv(F, f, label) };
}
/** the key number of an event: its first row (a target: the outcome row, the last), and that row's change when it has one */
function eventFigs(F: FeedFile, e: FeedEvent): { fig: Fig | null; dfig: Fig | null } {
  const rows = e.rows ?? [];
  const r = e.t === 'target' ? rows[rows.length - 1] : rows[0];
  if (!r) return { fig: null, dfig: null };
  const who = F.cos[e.c] ?? e.c, asof = r.ab?.[0] ?? perLabel(e.per);
  return { fig: feedFig(F, r.a, `${r.l} · ${who}`, asof), dfig: r.d && !r.rng ? feedFig(F, r.d, `שינוי · ${r.l} · ${who}${r.ab ? ` · ${r.ab.join(' מול ')}` : ''}`, asof) : null };
}
/** a fragility signal's headline as a sourced figure (its own provenance node from fragility.json), or null when it has none */
function fragFig(sig: SigId, sigHe: string, name: string, segId: SegId | null, seg: { v?: number | null; asof?: string | null; prov?: ProvJ } | undefined): Fig | null {
  if (!seg || seg.v == null || !seg.prov) return null;
  const t = headline(sig, seg as never) + (sig === 'flow' ? ` ${UNIT_OF.flow}` : sig === 'perf' ? ' שארפ' : sig === 'csm' ? ' שנים' : sig === 'scen' ? ' נק׳' : '');
  return { l: `${sigHe}${segId && SEG_HE[segId] ? ` · ${SEG_HE[segId]}` : ''} · ${name}`, v: seg.v, u: sig === 'flow' ? 'm' : sig === 'perf' ? 'r' : sig === 'csm' ? 'yrs' : sig === 'scen' ? 'pp' : 'pct', t, b: 'actual', asof: seg.asof ?? '', prov: seg.prov };
}

/* ---------------------------------------------------------------------------------------------------------- sections */
/** the questions that fit the meeting, ranked (Q_RULE); `pool` = how many fit before the cut */
export function rankQuestions(m: Meeting, I: IndexFile, watch: WatchFile | null): QLine[] {
  const changed = new Map<string, string>();
  for (const c of watch?.changes ?? []) if ((c.kind === 'answer' || c.kind === 'tripped') && (!changed.has(c.id) || c.d > changed.get(c.id)!)) changed.set(c.id, c.d);
  const open = !m.chairs.length && !m.topics.length && !m.cos.length;
  const out: (QLine & { s: number[] })[] = [];
  for (const row of I.rows) {
    if (row.st !== 'ok' || !row.cs || !row.cf) continue;
    const ch = row.chairs.filter((c) => m.chairs.includes(c)), co = row.cos.filter((c) => m.cos.includes(c)), tp = m.topics.includes(row.topic);
    if (m.cos.length && row.cos.length && !co.length) continue;  // a question about another company than the focus
    if (!open && !ch.length && !co.length && !tp) continue;
    const why = [...ch.map((c) => I.chairs[c] ?? c), ...(tp ? [I.topics[row.topic] ?? row.topic] : [])];
    const d = changed.get(row.id) ?? null;
    out.push({ row, why, changed: d, s: [row.chg === 'tripped' ? 1 : 0, ch.length ? 1 : 0, row.cos.length ? co.length / row.cos.length : 0, co.length, ch.length, tp ? 1 : 0, d ? D(d) : 0] });
  }
  out.sort((a, b) => { for (let i = 0; i < a.s.length; i++) if (a.s[i] !== b.s[i]) return b.s[i] - a.s[i]; return a.row.id.localeCompare(b.row.id); });
  return out.map(({ row, why, changed: c }) => ({ row, why, changed: c }));
}

/** three distinct corridor figures from the ranked questions (THREE_RULE) */
export function threeNumbers(ranked: QLine[]): Brief['three'] {
  const out: Brief['three'] = [];
  const seen = new Set<string>();
  for (const { row } of ranked) {
    const [id, f] = Object.entries(row.cf ?? {})[0] ?? [];
    if (!id || !f || f.v == null) continue;
    const k = `${f.l}|${f.t}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id, f, row });
    if (out.length === 3) break;
  }
  return out;
}

/** feed events since `since`, on the meeting's companies or topics, most material first (EVENT_RULE) */
export function sinceEvents(m: Meeting, F: FeedFile, since: string, today: string): EventLine[] {
  const types = new Set(m.topics.flatMap((t) => TOPIC_TYPES[t] ?? []));
  const sigs = new Set(m.topics.flatMap((t) => TOPIC_SIGS[t] ?? []));
  const topicOk = (e: FeedEvent) => {
    if (!m.topics.length) return true;
    if (!types.has(e.t)) return false;
    return e.t !== 'fragility' || (e.src.k === 'frag' && sigs.has(e.src.sig as SigId));
  };
  const rows = F.events.filter((e) => e.d >= since && e.d <= today).filter((e) => {
    if (inFocus(m, e.c)) return true;
    if (m.cos.length && e.c !== 'market') return false;
    return topicOk(e);
  });
  return rows.map((e) => ({ e, ...eventFigs(F, e), focus: inFocus(m, e.c) }))
    .sort((a, b) => (EVENT_RANK[evKey(a.e)] ?? 20) - (EVENT_RANK[evKey(b.e)] ?? 20) || Number(b.focus) - Number(a.focus) || b.e.d.localeCompare(a.e.d) || a.e.id.localeCompare(b.e.id));
}

/** S10's answer changes since `since` on the meeting's companies or topics (none when watch.json is absent) */
export function changedAnswers(m: Meeting, W: WatchFile, I: IndexFile | null, since: string): Brief['changes'] {
  const rows = new Map((I?.rows ?? []).map((r) => [r.id, r]));
  return W.changes.filter((c) => c.d >= since && (c.kind === 'answer' || c.kind === 'tripped' || c.kind === 'finding'))
    .map((c) => { const row = rows.get(c.id) ?? null; return { c, row, cos: c.cos ?? row?.cos ?? [], topic: c.topic ?? row?.topic ?? '' }; })
    .filter((x) => (!m.cos.length && !m.topics.length) || x.cos.some((k) => m.cos.includes(canon(k))) || (m.topics.includes(x.topic) && (!m.cos.length || !x.cos.length)))
    .sort((a, b) => b.c.d.localeCompare(a.c.d) || a.c.id.localeCompare(b.c.id))
    .map(({ c, row }) => ({ c, row }));
}

/** the finding to open with: the top finding on a focus company, else the industry's top finding (said so) */
export function leadFinding(m: Meeting, F: FindingsFile): Brief['lead'] {
  const ok = topFirst(F.rows).filter((r): r is Finding & OkBody => isOk(r));
  if (!ok.length) return null;
  if (!m.cos.length) return { f: ok[0], scope: 'industry' };
  const f = ok.find((r) => r.c && inFocus(m, r.c));
  return f ? { f, scope: 'focus' } : { f: ok[0], scope: 'industry' };
}

/** the risks nobody has raised: tripped falsifiers among the meeting's questions, fragility watch / alert on the focus (no focus: alerts
 *  only), say–do gaps (the say–do detector and missed or partly met targets), and reports expected before the meeting after this one */
export function flags(m: Meeting, d: BriefData, ranked: QLine[], lead: Brief['lead'], until: string): Flag[] {
  const out: Flag[] = [];
  for (const q of ranked) if (q.row.chg === 'tripped') out.push({ k: 'tripped', row: q.row });
  if (d.frag) {
    const sigHe = Object.fromEntries(d.frag.sigs.map((s) => [s.id, s.he]));
    for (const r of d.frag.rows) {
      if (m.cos.length ? !inFocus(m, r.c) : false) continue;
      for (const fl of r.flags) {
        if (!m.cos.length && fl.st !== 'alert') continue;
        const cell = r.sig[fl.sig];
        const seg = cell?.seg ? cell.segs[cell.seg] : undefined;
        out.push({ k: 'frag', c: r.c, sig: fl.sig, sigHe: sigHe[fl.sig] ?? fl.sig, seg: cell?.seg ?? null, st: fl.st, fig: fragFig(fl.sig, sigHe[fl.sig] ?? fl.sig, r.name, cell?.seg ?? null, seg), to: `/fragility?c=${r.c}&s=${fl.sig}` });
      }
    }
  }
  if (d.findings) for (const f of topFirst(d.findings.rows)) {
    if (f.det !== 'sd' || !isOk(f) || f.id === lead?.f.id) continue;
    if (m.cos.length && !(f.c && inFocus(m, f.c))) continue;
    out.push({ k: 'saydo', f: f as Finding & OkBody });
  }
  if (d.feed) {
    const F = d.feed;
    const misses = F.events.filter((e) => e.t === 'target' && (e.st === 'missed' || e.st === 'partial') && (m.cos.length ? inFocus(m, e.c) : true))
      .sort((a, b) => b.d.localeCompare(a.d) || a.id.localeCompare(b.id)).slice(0, 3);
    for (const e of misses) out.push({ k: 'target', e, fig: eventFigs(F, e).fig });
  }
  if (d.cal) {
    const reps = d.cal.companies.filter((c) => c.next && c.next.expected >= d.today && c.next.expected <= until && (m.cos.length ? inFocus(m, c.id) : true))
      .sort((a, b) => a.next!.expected.localeCompare(b.next!.expected) || a.id.localeCompare(b.id));
    for (const c of reps) out.push({ k: 'report', c: c.id, name: c.name, period: perLabel(c.next!.period), expected: c.next!.expected, lo: c.next!.lo, hi: c.next!.hi, before: c.next!.expected <= m.date });
  }
  return out;
}

/** the whole brief: every section from the same inputs, each honest when its input is missing or empty */
export function buildBrief(m: Meeting, d: BriefData, opt: { maxEvents?: number } = {}): Brief {
  const today = d.today;
  const since = m.last && m.last <= today ? m.last : addDays(today, -LOOKBACK[m.cadence]);
  const until = nextDate(m.date < today ? today : m.date, m.cadence === 'once' ? 'monthly' : m.cadence);
  const all = d.feed ? sinceEvents(m, d.feed, since, today) : [];
  const max = opt.maxEvents ?? 8;
  const ranked = d.index ? rankQuestions(m, d.index, d.watch) : [];
  const n = m.n ?? TEMPLATES[m.type]?.n ?? 5;
  const lead = d.findings ? leadFinding(m, d.findings) : null;
  return {
    m, today, since, days: Math.max(0, daysBetween(since, today)), sinceIsLast: !!m.last && m.last <= today, until,
    events: all.slice(0, max), eventsMore: Math.max(0, all.length - max), feedMissing: !d.feed,
    changes: d.watch ? changedAnswers(m, d.watch, d.index, since) : [], watch: d.watch ? 'ok' : 'absent',
    three: threeNumbers(ranked),
    questions: ranked.slice(0, n), qPool: ranked.length, indexMissing: !d.index,
    lead, findingsMissing: !d.findings,
    flags: flags(m, d, ranked, lead, until),
  };
}

/** the label of a fragility flag's state */
export const fragSt = (st: 'watch' | 'alert') => ST_HE[st];
