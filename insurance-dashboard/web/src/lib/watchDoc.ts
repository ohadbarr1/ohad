/** S10 · the morning brief as a Doc (lib/doc.ts, kind 'email'), for the S4 renderers. Every number in it is a figure: the current corridor
 *  figure with its full provenance when the published index still carries that answer (same signature h), else the figure as the
 *  snapshot kept it, sourced as "the answer as published on <date>"; the earlier side is always the latter. No digit is written into
 *  prose outside a token except dates, ids and counts. No site name. Pure (no React, no browser). */
import type { Block, Doc, Rich } from './doc';
import type { Fig, IndexFile } from './answers';
import type { ProvJ } from './fragility';
import { KIND_HE, SEV_HE, isFinding, type Brief, type PrepItem, type WChange, type WSide, type WatchFile } from './watch';

const TOKEN = /\{([a-z][a-z0-9_]*)\}/g;
const dlab = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : d ?? '');
const slug = (id: string) => id.toLowerCase().replace(/[^a-z0-9]+/g, '_');

/** a snapshot figure (no provenance kept) sourced as the answer as published on that date */
function pastFig(f: Omit<Fig, 'prov'>, id: string, date: string): Fig {
  const prov: ProvJ = { k: 'calc', title: `${f.l} · כפי שפורסם ב-${dlab(date)}`, value: f.t, unit: '', inputs: [],
    formula: `הנתון ב-${id} כפי שפורסם בבנייה של ${dlab(date)} (המקור המלא של הנתון בעמוד התשובה)` };
  return { ...f, prov };
}

/** one side's corridor as a Rich whose tokens are renamed into the doc's namespace; the figures are added to `figs` */
function sideRich(c: WChange, s: WSide, which: 'to' | 'from', date: string, figs: Record<string, Fig>, I?: IndexFile | null): Rich {
  if (!s.cs || !s.cf) return { text: s.corr ?? '' };
  const live = which === 'to' && !isFinding(c.id) ? I?.rows.find((r) => r.id === c.id && r.h && r.h === s.h && r.cf) : null;
  const text = s.cs.replace(TOKEN, (m, t: string) => {
    const base = s.cf?.[t];
    if (!base) return m;
    const nid = `${slug(c.id)}_${which}_${t}`;
    figs[nid] = live?.cf?.[t] ?? pastFig(base, c.id, date);
    return `{${nid}}`;
  });
  return { text };
}

const title = (c: WChange) => (c.q ? `${c.id} · ${c.q}` : c.id);

function item(c: WChange, figs: Record<string, Fig>, I?: IndexFile | null): Rich[] {
  const lab = c.sev ? SEV_HE[c.sev] : KIND_HE[c.kind];
  const head: Rich = { text: `${title(c)}: ${lab} (נראה ב-${dlab(c.d)})` };
  const out = [head];
  if (c.to) { const r = sideRich(c, c.to, 'to', c.d, figs, I); out.push({ text: `עכשיו: ${r.text}` }); }
  if (c.from) { const r = sideRich(c, c.from, 'from', c.pd, figs, I); out.push({ text: `קודם (${dlab(c.pd)}): ${r.text}` }); }
  return out;
}

/** the brief as one list per section: a bullet per change, its current and its earlier corridor as sub-lines (joined into one Rich) */
function section(h: string, cs: WChange[], figs: Record<string, Fig>, I?: IndexFile | null): Block[] {
  if (!cs.length) return [];
  return [{ k: 'h', level: 2, text: h }, { k: 'bullets', items: cs.map((c) => ({ text: item(c, figs, I).map((r) => r.text).join(' · ') })) }];
}

export interface WatchDocInput {
  w: WatchFile; b: Brief; prep: PrepItem[];
  /** the published index, so the current figures carry their full provenance */
  index?: IndexFile | null;
  /** the author's name as set in this browser (never the site's) */
  author: string;
  /** today, ISO */
  today: string;
  names?: Record<string, string>;
}

export function watchDoc({ w, b, prep, index, author, today, names = {} }: WatchDocInput): Doc {
  const figs: Record<string, Fig> = {};
  const blocks: Block[] = [];
  const since = b.first ? `מאז הבנייה הקודמת (${dlab(b.since)})` : `מאז ${dlab(b.since)}`;
  if (w.snaps.length < 2) blocks.push({ k: 'callout', tone: 'info', rich: { text: 'עד כה נשמרה תמונת מצב אחת של התשובות: השינויים יופיעו מהבנייה הבאה.' } });
  else if (!b.mine.length && !b.tripped.length && !b.newFindings.length && !b.mineFig.length && !b.rest.length)
    blocks.push({ k: 'p', rich: { text: `${since} אף תשובה לא השתנתה.` } });
  blocks.push(...section('במעקב: התשובה השתנתה', b.mine, figs, index));
  blocks.push(...section('ספים שנחצו', b.tripped.filter((c) => !b.mine.includes(c)), figs, index));
  blocks.push(...section('ממצאים חדשים', b.newFindings.filter((c) => !b.mine.includes(c)), figs, index));
  blocks.push(...section('במעקב: המספר זז, הפסיקה עומדת', b.mineFig, figs, index));
  const restLeft = b.rest.filter((c) => c.kind !== 'tripped' && !(c.kind === 'new' && isFinding(c.id)));
  if (restLeft.length) blocks.push({ k: 'p', rich: { text: `ועוד ${restLeft.length} שינויים בתשובות שלא במעקב.` } });
  if (prep.length) {
    blocks.push({ k: 'h', level: 2, text: 'לפני הבאים' });
    blocks.push({ k: 'table', head: ['תאריך', 'בעוד', 'מה', 'מקור'],
      rows: prep.map((p) => [dlab(p.d) + (p.lo && p.hi && p.lo !== p.hi ? ` (${dlab(p.lo)}–${dlab(p.hi)})` : ''), p.days === 0 ? 'היום' : p.days < 0 ? `לפני ${-p.days} ימים` : `${p.days} ימים`,
        [p.c ? names[p.c] ?? p.c : '', p.what].filter(Boolean).join(' · ') + (p.est ? ' (אומדן)' : ''), p.kind === 'meeting' ? 'פגישה ביומן שלך' : p.src ?? '']),
      foot: ['מועדי הדוחות: חציון ימי הפרסום של אותו דוח בשלוש השנים האחרונות; חודש הרשות: לפי מועדי ההגעה של החודשים הקודמים. שניהם אומדנים.'] });
  }
  blocks.push({ k: 'callout', tone: 'info', rich: { text: w.rule } });
  return {
    kind: 'email', title: 'מה השתנה בתשובות', subtitle: since, author, date: dlab(today), asof: w.asof ? `בנייה ${dlab(w.asof)}` : undefined,
    blocks, figs,
  };
}
