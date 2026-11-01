/* S4 · the producers: an answer (S1), a finding (S2), or several answers, as a Doc of one of the six kinds. Pure (node-tested).
   Nothing is invented: every sentence is the answer's own (corridor, email, falsifier) with its figures; the decision parts of a memo
   or a board paper (the options' open sides, the recommendation, the addressees) are editable placeholders ⟦…⟧ the author fills.
   Figures are namespaced by their answer (Q-001's {rg} becomes {q001_rg}) so several answers share one doc. A falsifier's threshold and
   a finding's two rank components (materiality, surprise: never combined) become figures too, each with its computation as provenance,
   so no digit reaches the text outside a sourced figure. */
import { BASIS_HE, CHG_HE, isOk, type Answer, type Exhibit, type Fig, type Finding, type OkBody } from '../answers';
import type { Block, Doc, DocKind, Rich } from '../doc';
import { ph, richOf, type Ctx } from './notes';
import { cites, mergeCites } from '../answers';

export interface ProduceCtx {
  author?: string;
  /** dd.mm.yy; default today */
  date?: string;
  /** the related answers' bodies (the memo's evidence, the talking points' extra lines, the one-pager's extra exhibits) */
  rel?: Answer[];
  /** labels of the index: chairs and topics */
  chairs?: Record<string, string>;
  topics?: Record<string, string>;
  /** detector labels (findings) */
  dets?: Record<string, { he: string; rule?: string }>;
  /** company names; the board paper's appendix names the source documents */
  names?: Record<string, string>;
  cite?: Ctx;
}

const TOKEN = /\{([a-z][a-z0-9_]*)\}/g;
const nsOf = (id: string) => { const s = id.toLowerCase().replace(/[^a-z0-9]/g, ''); return /^[a-z]/.test(s) ? s : `x${s}`; };
const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`; };
const R = (text: string): Rich => ({ text });

/** one answer or finding, its figures namespaced, ready to be laid out */
interface Src {
  id: string; ns: string; head: string; q: string | null; who: string | null; what: 'שאלה' | 'ממצא';
  b: OkBody; figs: Record<string, Fig>;
  corr: string; email: string; ex: Exhibit | null; corrFig: string | null;
  chg: { line: string; now: string; st: 'holds' | 'tripped' } | null;
  rank: string | null; asof: string | null; note: string | null;
}

function src(id: string, head: string, q: string | null, who: string | null, what: Src['what'], b: OkBody, extra: Record<string, Fig> = {}): Src {
  const ns = nsOf(id);
  const rw = (t: string) => t.replace(TOKEN, (_m, x: string) => `{${ns}_${x}}`);
  const figs: Record<string, Fig> = {};
  for (const [k, f] of Object.entries({ ...b.figs, ...extra })) figs[`${ns}_${k}`] = f;
  let chg: Src['chg'] = null;
  if (b.chg && b.figs[b.chg.fig]) {
    const w = b.figs[b.chg.fig], c = b.chg;
    figs[`${ns}_thr`] = { l: `הסף שמשנה את התשובה: ${w.l}`, v: c.v, u: w.u, t: c.thr, b: 'actual', asof: w.asof,
      prov: { k: 'calc', title: `סף ההחלטה · ${w.l}`, value: c.thr, unit: w.u, formula: `סף שנקבע בשאלה עצמה (פרמטר החלטה, לא נתון מדווח): התשובה משתנה כשהנתון ${c.op} הסף`, inputs: [{ label: w.l, v: w.t, p: w.prov }] } };
    chg = { line: rw(c.text), now: `עכשיו: {${ns}_${c.fig}} · הסף: {${ns}_thr}`, st: c.st };
  }
  const corrIds = [...b.corr.matchAll(TOKEN)].map((m) => m[1]);
  return { id, ns, head, q, who, what, b, figs, corr: rw(b.corr), email: rw(b.email), ex: b.ex, corrFig: corrIds[0] ? `${ns}_${corrIds[0]}` : null,
    chg, rank: extra.mat || extra.sur ? `מהותיות {${ns}_mat} · הפתעה {${ns}_sur}` : null, asof: b.asof ?? null, note: b.note ?? null };
}

const fromAnswer = (a: Answer, c: ProduceCtx): Src | null => (isOk(a) ? src(a.id, a.q, a.q, a.chairs.map((x) => c.chairs?.[x] ?? x).join(' · ') || null, 'שאלה', a) : null);
function fromFinding(f: Finding, c: ProduceCtx): Src | null {
  if (!isOk(f)) return null;
  const det = c.dets?.[f.det]?.he ?? f.det, co = f.c ? c.names?.[f.c] ?? f.c : null;
  const extra: Record<string, Fig> = {};
  const comp = (k: 'mat' | 'sur', l: string, b: Fig['b']) => {
    const x = f[k];
    if (!x || x.v == null) return;
    extra[k] = { l: `${l} · ${det}${co ? ` · ${co}` : ''}`, v: x.v, u: x.u, t: x.t, b, asof: f.asof ?? '', prov: { k: 'calc', title: `${l} של הממצא ${f.id}`, value: x.t, formula: x.why, inputs: [] } };
  };
  comp('mat', 'מהותיות', 'estimate');
  comp('sur', 'הפתעה', 'actual');
  return src(f.id, f.q ?? [det, co].filter(Boolean).join(' · '), f.q ?? null, null, 'ממצא', f, extra);
}

/* ---------- pieces ---------- */
const figTable = (s: Src[], withSrc: Ctx | null): Block => {
  const head = ['נתון', 'ערך', 'בסיס', 'נכון ל-', ...(withSrc ? ['מקור'] : [])];
  const rows = s.flatMap((x) => Object.entries(x.figs).filter(([k]) => !k.endsWith('_thr')).map(([k, f]) => [f.l, R(`{${k}}`), BASIS_HE[f.b] ?? f.b, f.asof || '–',
    ...(withSrc ? [mergeCites(cites(f.prov, withSrc.lts, withSrc.names)).slice(0, 2).map((c) => `${c.doc}${c.pages.length ? `, עמ׳ ${c.pages.join(', ')}` : ''}`).join('; ') || (f.prov.k === 'calc' ? 'חישוב (ראו הערה)' : '–')] : [])]));
  return { k: 'table', head, rows };
};
/** the answer's exhibit, or (none drawn) a table of its figures as the exhibit */
const exOf = (x: Src): Block => {
  const figs = Object.fromEntries(Object.entries(x.figs).filter(([k]) => !k.endsWith('_thr')));
  if (x.ex) return { k: 'exhibit', ex: x.ex, figs };
  const ex: Exhibit = { kind: 'table', title: x.head, unit: '', cats: [], series: [], foot: [], rows: [['נתון', 'ערך', 'בסיס', 'נכון ל-'], ...Object.values(figs).map((f) => [f.l, f.t, BASIS_HE[f.b] ?? f.b, f.asof])] };
  return { k: 'exhibit', ex, figs };
};
const chgCallout = (x: Src): Block[] => (x.chg ? [{ k: 'callout', tone: x.chg.st === 'tripped' ? 'warn' : 'info', rich: R(`משתנה אם ${x.chg.line} (${CHG_HE[x.chg.st]}). ${x.chg.now}.`) }] : []);
const asofLine = (s: Src[]) => [...new Set(s.map((x) => x.asof).filter(Boolean))].join(' · ') || undefined;
const relSrcs = (c: ProduceCtx, own: Src[]) => (own.length === 1 ? (c.rel ?? []).map((a) => fromAnswer(a, c)).filter((x): x is Src => !!x && x.id !== own[0].id) : []);

/** the options of a memo / board paper: the line the answers take, waiting for the signal that would change them, and the author's own;
 *  every side the data cannot argue is a placeholder */
function options(s: Src[], rel: Src[]): Block[] {
  const withChg = s.filter((x) => x.chg);
  const blocks: Block[] = [{ k: 'options', items: [
    { name: 'אפשרות א׳: לפעול לפי התשובה', pro: s.map((x) => R(x.corr)), con: withChg.length ? withChg.map((x) => R(`התשובה משתנה אם ${x.chg!.line}`)) : [R(ph('להשלמה: הסיכון שבפעולה עכשיו'))] },
    { name: 'אפשרות ב׳: להמתין לנתון שמשנה את התשובה', pro: withChg.length ? withChg.map((x) => R(`${x.chg!.now}; ${CHG_HE[x.chg!.st]}`)) : [R(ph('להשלמה: מה ייוודע בנתון הבא'))], con: [R(ph('להשלמה: מחיר ההמתנה'))] },
    { name: ph('אפשרות ג׳: להשלמה'), pro: [R(ph('להשלמה: בעד אפשרות ג׳'))], con: [R(ph('להשלמה: נגד אפשרות ג׳'))] },
  ], rec: R(`${ph('להשלמה על ידי המחבר: ההמלצה, ובאיזו אפשרות היא בוחרת')}. הממצא שעליו היא נשענת: ${s[0].corr}`) }];
  if (rel.length) blocks.push({ k: 'h', level: 3, text: 'ראיות מתשובות קשורות (לסיווג המחבר: בעד או נגד)' }, { k: 'bullets', items: rel.map((r) => R(`${ph(`בעד / נגד: ${r.id}`)} ${r.id}: ${r.corr}`)) });
  return blocks;
}

function assumptions(s: Src[]): string[] {
  const all = s.flatMap((x) => Object.entries(x.figs).map(([k, f]) => ({ k, f })));
  const bases = [...new Set(all.map((x) => x.f.b))];
  const asofs = [...new Set(all.map((x) => x.f.asof).filter(Boolean))];
  const out = [`בסיס הנתונים: ${bases.map((b) => BASIS_HE[b] ?? b).join(', ')}${bases.length > 1 ? ' (בסיסים מעורבים: כל נתון מסומן בבסיס שלו, ואין חיבור בין יעד, צפי ובפועל)' : ''}.`,
    `נכון ל-: ${asofs.join(', ') || '–'}.`];
  for (const { f } of all) {
    if (f.b !== 'actual') out.push(`${f.l}: ${BASIS_HE[f.b] ?? f.b}, לא נתון בפועל.`);
    if (f.prov.k === 'calc') out.push(`${f.l}: ${f.prov.est ? 'נגזר בהנחה' : 'מחושב'}: ${f.prov.formula}`);
  }
  s.forEach((x) => { if (x.note) out.push(`${x.id}: ${x.note}`); });
  return [...new Set(out)];
}

/* ---------- the six kinds ---------- */
function build(s: Src[], kind: DocKind, c: ProduceCtx, packTitle?: string): Doc {
  const one = s.length === 1, x0 = s[0], rel = relSrcs(c, s);
  const title = packTitle ?? x0.head;
  const subtitle = one ? [x0.what === 'שאלה' ? `שאלה ${x0.id}` : `ממצא ${x0.id}`, x0.who ? `שואלים: ${x0.who}` : null].filter(Boolean).join(' · ') : s.map((x) => x.id).join(' · ');
  const blocks: Block[] = [];
  const head = (x: Src, level: 2 | 3 = 2) => { if (!one) blocks.push({ k: 'h', level, text: `${x.id} · ${x.head}` }); };
  const rank = (x: Src) => { if (x.rank) blocks.push({ k: 'p', rich: R(`דירוג הממצא, שני רכיבים נפרדים: ${x.rank}`) }); };
  let assume: string[] | undefined;
  switch (kind) {
    case 'onepager': {
      blocks.push({ k: 'h', level: 1, text: 'השורה התחתונה' });
      s.forEach((x) => { head(x, 3); blocks.push({ k: 'callout', tone: 'info', rich: R(x.corr) }); rank(x); });
      if (one) blocks.push({ k: 'p', rich: R(x0.email) });
      blocks.push({ k: 'h', level: 1, text: 'מוצגים' });
      [...s, ...rel].filter((x) => x.ex).slice(0, 3).forEach((x) => blocks.push(exOf(x)));
      if (![...s, ...rel].some((x) => x.ex)) blocks.push(exOf(x0));
      blocks.push({ k: 'h', level: 1, text: 'מה ישנה את התשובה' });
      s.forEach((x) => { head(x, 3); blocks.push(...chgCallout(x)); if (!x.chg) blocks.push({ k: 'p', rich: R('לתשובה אין סף שנקבע מראש') }); });
      break;
    }
    case 'memo': case 'board': {
      const board = kind === 'board';
      if (!board) blocks.push({ k: 'table', head: ['', ''], rows: [['אל', R(ph('להשלמה: הנמענים'))], ['מאת', c.author || R(ph('שם המחבר'))], ['תאריך', c.date ?? today()], ['הנדון', title]] });
      blocks.push({ k: 'h', level: 1, text: board ? 'תקציר מנהלים' : 'המצב' });
      s.forEach((x) => { head(x, 3); blocks.push({ k: 'callout', tone: 'info', rich: R(x.corr) }); rank(x); });
      if (board) {
        blocks.push({ k: 'h', level: 1, text: 'ההחלטה המבוקשת' }, { k: 'p', rich: R(ph('להשלמה על ידי המחבר: מה הדירקטוריון מתבקש להחליט או לאשר')) });
        blocks.push({ k: 'h', level: 1, text: 'השאלה והרקע' });
        // the question is a label, not a claim: a heading (plain text), its chairs and as-of under it
        s.forEach((x) => blocks.push({ k: 'h', level: 3, text: `${x.what === 'שאלה' ? `${x.id}: ` : ''}${x.q ?? x.head}` }, { k: 'p', rich: R([x.who ? `שואלים: ${x.who}` : '', x.asof ? `נכון ל-${x.asof}` : ''].filter(Boolean).join(' · ') || x.what) }));
      }
      blocks.push({ k: 'h', level: 1, text: 'הניתוח' });
      s.forEach((x) => { head(x); blocks.push({ k: 'p', rich: R(x.email) }, exOf(x)); });
      if (rel.length && !board) blocks.push({ k: 'h', level: 3, text: 'בהקשר: תשובות קשורות' }, { k: 'bullets', items: rel.map((r) => R(`${r.id}: ${r.corr}`)) });
      blocks.push({ k: 'h', level: 1, text: 'מה ישנה את המסקנה' });
      s.forEach((x) => { head(x, 3); blocks.push(...chgCallout(x)); if (!x.chg) blocks.push({ k: 'p', rich: R('לתשובה אין סף שנקבע מראש') }); });
      blocks.push({ k: 'h', level: 1, text: 'אפשרויות' }, ...options(s, rel));
      blocks.push({ k: 'h', level: 1, text: 'המלצה' }, { k: 'p', rich: R(ph('להשלמה על ידי המחבר: ההמלצה ונימוקה. המסמך אינו ממליץ בעצמו')) });
      if (board) {
        blocks.push({ k: 'pagebreak' }, { k: 'h', level: 1, text: 'נספח א׳: הנתונים ומקורותיהם' }, figTable([...s], c.cite ?? {}));
        if (rel.length) blocks.push({ k: 'h', level: 1, text: 'נספח ב׳: תשובות קשורות' }, ...rel.flatMap((r): Block[] => [{ k: 'h', level: 3, text: `${r.id} · ${r.head}` }, { k: 'p', rich: R(r.corr) }]));
        assume = assumptions(s);
      }
      break;
    }
    case 'talking': {
      blocks.push({ k: 'h', level: 1, text: 'נקודות לשיחה' });
      for (const x of [...s, ...rel]) {
        const back = x.chg ? R(`אם ישאלו מה ישנה את זה: ${x.chg.line}. ${x.chg.now}.`) : R(ph('להשלמה: התשובה להתנגדות הצפויה'));
        blocks.push({ k: 'point', line: R(x.corr), fig: x.corrFig ?? undefined, comeback: back });
      }
      break;
    }
    case 'exhibits': {
      s.forEach((x) => blocks.push(exOf(x)));
      rel.filter((x) => x.ex).forEach((x) => blocks.push(exOf(x)));
      break;
    }
    case 'email': {
      s.forEach((x) => { blocks.push({ k: 'p', rich: R(x.corr) }); });
      if (one) blocks.push({ k: 'p', rich: R(x0.email) });
      break;
    }
  }
  // the doc quotes only what its blocks quote; every figure of every answer stays reachable through the blocks' own maps
  const all: Record<string, Fig> = Object.assign({}, ...s.map((x) => x.figs), ...rel.map((x) => x.figs));
  const quoted: Record<string, Fig> = {};
  for (const b of blocks) {
    for (const r of richOf(b)) for (const m of r.text.matchAll(TOKEN)) if (all[m[1]]) quoted[m[1]] = all[m[1]];
    if (b.k === 'point' && b.fig && all[b.fig]) quoted[b.fig] = all[b.fig];
  }
  return { kind, title, subtitle, author: c.author ?? '', date: c.date ?? today(), asof: asofLine(s), blocks, figs: quoted, ...(assume ? { assumptions: assume } : {}) };
}

/** an answered question as a deliverable of the kind asked; null when the question has no answer */
export function answerDoc(answer: Answer, kind: DocKind, ctx: ProduceCtx = {}): Doc | null {
  const s = fromAnswer(answer, ctx);
  return s ? build([s], kind, ctx) : null;
}
/** a finding as a deliverable (its two rank components stay two figures) */
export function findingDoc(finding: Finding, kind: DocKind, ctx: ProduceCtx = {}): Doc | null {
  const s = fromFinding(finding, ctx);
  return s ? build([s], kind, ctx) : null;
}
/** several answers (and findings) as one deliverable; the unanswered are left out */
export function packDoc(items: (Answer | Finding)[], kind: DocKind, ctx: ProduceCtx = {}, title = 'תשובות נבחרות'): Doc | null {
  const s = items.map((a) => ('det' in a ? fromFinding(a as Finding, ctx) : fromAnswer(a as Answer, ctx))).filter((x): x is Src => !!x);
  if (!s.length) return null;
  return s.length === 1 ? build(s, kind, { ...ctx, rel: [] }) : build(s, kind, { ...ctx, rel: [] }, title);
}
