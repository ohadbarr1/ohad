/* S3 → S4 · a meeting brief as a Doc (lib/doc.ts), so the Deliverable Factory's renderers export it to PPTX / DOCX / PDF. Pure: the same
   `buildBrief` model the page renders, every number a sourced figure (doc.figs, footnoted by the renderer). Figure ids are namespaced by
   their origin (q001_rg, ev3_a ...) so two answers that both call a figure {x} never collide in doc.figs. No fox branding: the author is
   left empty for the renderer to fill with the name kept in this browser. */
import type { Fig } from './answers';
import type { Block, Doc, Rich } from './doc';
import { buildBrief, CADENCE_HE, dmy, EVENT_RULE, Q_RULE, TEMPLATES, THREE_RULE, type Brief, type BriefData, type Flag, type Meeting } from './brief';

const TOKEN = /\{([a-z][a-z0-9_]*)\}/g;
/** a sentence and its figures with every token prefixed (`{x}` → `{p_x}`) */
export function ns(text: string, figs: Record<string, Fig>, p: string): Rich {
  const out: Record<string, Fig> = {};
  const t = text.replace(TOKEN, (all, id: string) => { if (!figs[id]) return all; out[`${p}_${id}`] = figs[id]; return `{${p}_${id}}`; });
  return { text: t, figs: out };
}
const pfx = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, '');
const rich = (text: string, figs?: Record<string, Fig>): Rich => (figs && Object.keys(figs).length ? { text, figs } : { text });

/** the brief as the page lays it out, block by block */
export function briefBlocks(b: Brief, d: BriefData): { blocks: Block[]; figs: Record<string, Fig> } {
  const figs: Record<string, Fig> = {};
  const take = (r: Rich) => { Object.assign(figs, r.figs ?? {}); return r; };
  const name = (c: string) => d.names[c] ?? d.feed?.cos[c] ?? c;
  const blocks: Block[] = [];
  const empty = (text: string) => blocks.push({ k: 'p', rich: { text } });

  // since the last meeting
  blocks.push({ k: 'h', level: 2, text: `מאז הפגישה הקודמת (${b.days} ימים)` });
  blocks.push({ k: 'p', rich: { text: `${b.sinceIsLast ? 'מהפגישה הקודמת' : 'מאז'} ${dmy(b.since)} עד ${dmy(b.today)}. ${EVENT_RULE}.` } });
  if (b.feedMissing) empty('יומן האירועים לא נטען, אין אירועים להציג.');
  else if (!b.events.length) empty('לא היה אירוע על החברות או הנושאים שבמוקד בתקופה הזו.');
  else blocks.push({ k: 'bullets', items: b.events.map((x, i) => {
    const p = `ev${i}`;
    const f: Record<string, Fig> = {};
    if (x.fig) f[`${p}_a`] = x.fig;
    if (x.dfig) f[`${p}_d`] = x.dfig;
    const num = x.fig ? ` · {${p}_a}${x.dfig ? ` (שינוי {${p}_d})` : ''}` : '';
    return take(rich(`${dmy(x.e.d)} · ${name(x.e.c)} · ${x.e.h}${num}`, f));
  }) });
  if (b.eventsMore) empty(`ועוד ${b.eventsMore} אירועים פחות מהותיים ביומן.`);
  if (b.watch === 'absent') empty('מעקב שינויי התשובות עדיין לא פורסם בבנייה הזו: אין השוואה של תשובות בין בניות.');
  else if (!b.changes.length) empty('אף תשובה על החברות או הנושאים שבמוקד לא השתנתה בתקופה.');
  else blocks.push({ k: 'bullets', items: b.changes.map(({ c, row }) => (row?.cs && row.cf
    ? take(ns(`התשובה ל-${c.id} השתנתה ב-${dmy(c.d)}: ${row.cs}`, row.cf, `ch${pfx(c.id)}`))
    : rich(`${c.id}: ${c.kind === 'finding' ? 'הממצא' : 'התשובה'} השתנה ב-${dmy(c.d)}.`))) });

  // the three numbers
  blocks.push({ k: 'h', level: 2, text: 'שלושת המספרים' });
  if (!b.three.length) empty(b.indexMissing ? 'אינדקס השאלות לא נטען, אין מספרים לבחור.' : 'אין שאלה עם תשובה שמתאימה למוקד הפגישה.');
  else {
    blocks.push({ k: 'table', head: ['נתון', 'ערך', 'נכון ל-', 'מתוך'], rows: b.three.map((x) => {
      const id = `n${pfx(x.row.id)}_${x.id}`;
      figs[id] = x.f;
      return [x.f.l, { text: `{${id}}`, figs: { [id]: x.f } }, x.f.asof, `${x.row.id} · ${x.row.q}`];
    }), foot: [THREE_RULE] });
  }

  // likely questions
  blocks.push({ k: 'h', level: 2, text: 'שאלות צפויות, עם תשובות' });
  if (!b.questions.length) empty(b.indexMissing ? 'אינדקס השאלות לא נטען.' : 'אין שאלה באינדקס שמתאימה למושבים, לנושאים ולחברות של הפגישה.');
  else {
    blocks.push({ k: 'bullets', items: b.questions.map((q) => {
      const r = ns(q.row.cs ?? '', q.row.cf ?? {}, `q${pfx(q.row.id)}`);
      return take(rich(`${q.row.q} ${r.text}${q.row.chg === 'tripped' ? ' (הסף נחצה: התשובה משתנה)' : ''}`, r.figs));
    }) });
    blocks.push({ k: 'p', rich: { text: `${Q_RULE}. ${b.qPool} שאלות מתאימות, ${b.questions.length} מוצגות.` } });
  }

  // lead with this
  blocks.push({ k: 'h', level: 2, text: 'לפתוח עם זה' });
  if (!b.lead) empty(b.findingsMissing ? 'מנוע הממצאים לא פרסם קובץ בבנייה הזו.' : 'אין ממצא עם תשובה בבנייה הזו.');
  else {
    const f = b.lead.f;
    if (b.lead.scope === 'industry' && b.m.cos.length) empty('אין ממצא על החברות שבמוקד; הממצא המוביל בענף:');
    blocks.push({ k: 'callout', tone: 'info', rich: take(ns(f.corr, f.figs, `f${pfx(f.id).slice(0, 24)}`)) });
  }

  // flag
  blocks.push({ k: 'h', level: 2, text: 'דגל' });
  if (!b.flags.length) empty('אין דגל: אף סף לא נחצה, אין אות שבריריות במעקב או בהתראה על החברות שבמוקד, אין פער אמירה–עשייה ואין דוח צפוי בחלון הפגישה.');
  else blocks.push({ k: 'bullets', items: b.flags.map((fl, i) => take(flagRich(fl, i, name))) });

  return { blocks, figs };
}

/** one flag as a sentence with its sourced figure */
export function flagRich(fl: Flag, i: number, name: (c: string) => string): Rich {
  switch (fl.k) {
    case 'tripped': return ns(`סף נחצה: ${fl.row.q} ${fl.row.cs ?? ''}`, fl.row.cf ?? {}, `t${pfx(fl.row.id)}`);
    case 'frag': { const id = `g${i}_${fl.sig}`; return rich(`${name(fl.c)}: ${fl.sigHe} ב${fl.st === 'alert' ? 'התראה' : 'מעקב'}${fl.fig ? ` ({${id}})` : ''}.`, fl.fig ? { [id]: fl.fig } : undefined); }
    case 'saydo': { const r = ns(fl.f.corr, fl.f.figs, `s${i}`); return rich(`פער אמירה–עשייה: ${r.text}`, r.figs); }
    case 'target': { const id = `y${i}_a`; return rich(`${name(fl.e.c)}: ${fl.e.h}${fl.fig ? `, בפועל {${id}}` : ''} (${dmy(fl.e.d)}).`, fl.fig ? { [id]: fl.fig } : undefined); }
    case 'report': return rich(`${fl.name}: דוח ${fl.period} צפוי ב-${dmy(fl.expected)}${fl.lo && fl.hi && fl.lo !== fl.hi ? ` (טווח ${dmy(fl.lo)}–${dmy(fl.hi)})` : ''}, ${fl.before ? 'לפני הפגישה' : 'עד הפגישה הבאה'}.`);
  }
}

/** the meeting brief as a one-page Doc. `author` empty: the deliver module fills the name kept in this browser */
export function briefDoc(m: Meeting, d: BriefData, opt: { author?: string; asof?: string } = {}): Doc {
  const b = buildBrief(m, d);
  const { blocks, figs } = briefBlocks(b, d);
  const head: Block[] = [];
  if (m.agenda.length) head.push({ k: 'h', level: 3, text: 'סדר היום הקבוע' }, { k: 'bullets', items: m.agenda.map((a) => ({ text: a })) });
  return {
    kind: 'onepager',
    title: m.name,
    subtitle: [dmy(m.date), m.audience, `${TEMPLATES[m.type]?.he ?? ''} · ${CADENCE_HE[m.cadence]}`].filter(Boolean).join(' · '),
    author: opt.author ?? '',
    date: dmy(d.today),
    asof: opt.asof,
    blocks: [...head, ...blocks],
    figs,
  };
}
