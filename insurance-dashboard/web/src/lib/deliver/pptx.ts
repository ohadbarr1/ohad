/* S4 · the deck of a Doc, on the chart book's PowerPoint path (lib/pptx.ts: pptxgenjs, native editable charts, the house tones), as the
   user's own material: no mark, no site name, no "fox" in the file or its properties; the author set in this browser on the title slide.
   16:9, right to left. A title slide (title, subtitle, author, date, as-of); a slide per section (a level-1 heading starts one; a long
   section continues on the next slide); a slide per exhibit (a real chart or table, its footnotes and source line); the options of a
   memo as a table; then the assumptions and a sources slide (every figure's note, every document with its link). Every figure carries
   its note number; the notes of the figures a slide quotes are printed at its foot. */
import type PptxGenJS from 'pptxgenjs';
import type { Doc, Rich } from '../doc';
import { BASIS_HE } from '../answers';
import { addChart, addTable, finish, FONT, H, HE, M, TONES, W } from '../pptx';
import { basisMix, citeText, citeUrl, exSpec, exhibitSourceLine, KIND_HE, ltrText, prepare, runs, type Ctx, type Prepared } from './notes';

const t = TONES.phoenix;
type TP = PptxGenJS.TextProps;
const o = (x: PptxGenJS.TextPropsOptions = {}): PptxGenJS.TextPropsOptions => ({ fontFace: FONT, color: t.ink, ...HE, align: 'right', ...x });

/** a Rich text as runs; the figures it quotes are reported to `seen` (the slide's notes) */
function richRuns(r: Rich, P: Prepared, base: PptxGenJS.TextPropsOptions, seen: Set<string>): TP[] {
  const out: TP[] = [];
  for (const x of runs(r, P)) {
    if (x.k === 't') out.push({ text: x.s, options: o(base) });
    else if (x.k === 'ph') out.push({ text: `⟦${x.s}⟧`, options: o({ ...base, bold: true, highlight: 'FFF1A8' }) });
    else if (x.k === 'miss') out.push({ text: '?', options: o({ ...base, bold: true, color: t.accentText }) });
    else {
      seen.add(x.id);
      out.push({ text: ltrText(x.f.t), options: o({ ...base, bold: true }) });
      if (x.tag) out.push({ text: ` (${x.tag})`, options: o({ ...base, bold: true, color: '7A5200', fontSize: Math.max(8, (base.fontSize ?? 14) - 4) }) });
      if (x.n) out.push({ text: String(x.n), options: o({ ...base, superscript: true, color: t.accentText }) });
    }
  }
  return out;
}
const textLen = (rs: TP[]) => rs.reduce((n, x) => n + String(x.text ?? '').length, 0);

interface Para { runs: TP[]; lines: number }
interface Slide { title: string; sub?: string; paras: Para[]; seen: Set<string>; special?: (s: PptxGenJS.Slide, top: number) => void; pre?: string[] }

function frame(pptx: PptxGenJS, s: PptxGenJS.Slide, n: number, title: string, sub?: string) {
  s.background = { color: t.bg };
  s.addText(title, { x: M, y: 0.24, w: W - 2 * M, h: 0.62, fontFace: FONT, fontSize: 22, bold: true, color: t.ink, align: 'right', valign: 'middle', margin: 0, fit: 'shrink', ...HE });
  if (sub) s.addText(sub, { x: M, y: 0.86, w: W - 2 * M, h: 0.34, fontFace: FONT, fontSize: 12, color: t.muted, align: 'right', margin: 0, ...HE });
  s.addShape(pptx.ShapeType.rect, { x: M, y: 1.27, w: W - 2 * M, h: 0.012, fill: { color: t.line }, line: { color: t.line, width: 0 } });
  s.addShape(pptx.ShapeType.rect, { x: W - M - 0.9, y: 1.255, w: 0.9, h: 0.04, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
  s.addText(String(n), { x: M - 0.05, y: H - 0.42, w: 0.8, h: 0.3, fontFace: FONT, fontSize: 9, color: t.faint, align: 'left', margin: 0 });
}
/** the foot of a slide: an exhibit's own lines, then the notes of the figures it quotes (the rest on the sources slide) */
function foot(pptx: PptxGenJS, s: PptxGenJS.Slide, P: Prepared, seen: Set<string>, pre: string[] = []) {
  const notes = P.notes.filter((n) => seen.has(n.id));
  const lines = [...pre, ...notes.slice(0, 4).map((n) => `[${n.n}] ${n.text}`)];
  if (notes.length > 4) lines.push(`הערות ${notes.slice(4).map((n) => n.n).join(', ')}: בשקף המקורות`);
  if (!lines.length) return;
  s.addShape(pptx.ShapeType.rect, { x: M, y: 6.2, w: W - 2 * M, h: 0.008, fill: { color: t.line }, line: { color: t.line, width: 0 } });
  s.addText(lines.map((l, i) => ({ text: l, options: o({ fontSize: 7.5, color: t.muted, breakLine: i < lines.length - 1 }) })), { x: M + 0.7, y: 6.24, w: W - 2 * M - 0.7, h: 0.98, valign: 'top', margin: 0, fit: 'shrink', paraSpaceAfter: 1, ...HE });
}

const CAP = 15;  // lines of 14pt text a slide body holds
const LINE = 118;  // characters of 14pt Hebrew per line across the body

/** the deck as bytes (node) */
export async function deckBytes(doc: Doc, ctx: Ctx = {}): Promise<Uint8Array> {
  const { default: Pptx } = await import('pptxgenjs');
  const pptx = new Pptx();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.rtlMode = true;
  pptx.author = doc.author || ' ';
  pptx.company = ' ';
  pptx.subject = KIND_HE[doc.kind];
  pptx.title = doc.title;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  const P = prepare(doc, ctx);

  // the title slide
  const c = pptx.addSlide();
  c.background = { color: t.cover };
  c.addText(KIND_HE[doc.kind], { x: M, y: 1.7, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: t.accent, align: 'right', margin: 0, ...HE });
  c.addShape(pptx.ShapeType.rect, { x: W - M - 1.2, y: 2.2, w: 1.2, h: 0.06, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
  c.addText(doc.title, { x: M, y: 2.4, w: W - 2 * M, h: 1.5, fontFace: FONT, fontSize: 34, bold: true, color: t.coverInk, align: 'right', valign: 'top', margin: 0, fit: 'shrink', ...HE });
  if (doc.subtitle) c.addText(doc.subtitle, { x: M, y: 4.0, w: W - 2 * M, h: 0.5, fontFace: FONT, fontSize: 16, color: t.coverInk, transparency: 20, align: 'right', margin: 0, ...HE });
  const mix = basisMix(P);
  c.addText([doc.author, doc.date, doc.asof ? `נתונים נכון ל-${doc.asof}` : '', mix].filter(Boolean).join(' · '), { x: M, y: 6.3, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 13, color: t.coverInk, align: 'right', margin: 0, ...HE });

  // the body, slide by slide
  const slides: Slide[] = [];
  let cur: Slide | null = null, section = doc.title;
  const open = (title: string, sub?: string): Slide => { cur = { title, sub, paras: [], seen: new Set() }; slides.push(cur); return cur; };
  const need = (lines: number): Slide => {
    const s = cur && !cur.special ? cur : open(section);
    const used = s.paras.reduce((n, q) => n + q.lines, 0);
    return used + lines > CAP && s.paras.length ? open(`${section} (המשך)`) : s;
  };
  const add = (rs: TP[], lines?: number, para: PptxGenJS.TextPropsOptions = {}) => {
    const n = lines ?? Math.max(1, Math.ceil(textLen(rs) / LINE)) + 0.3;
    const s = need(n);
    if (rs.length) rs[0] = { ...rs[0], options: { ...rs[0].options, ...para } };
    s.paras.push({ runs: rs, lines: n });
    return s;
  };
  const rr = (r: Rich, base: PptxGenJS.TextPropsOptions) => { const seen = new Set<string>(); const out = richRuns(r, P, base, seen); return { out, seen }; };
  const put = (r: Rich, base: PptxGenJS.TextPropsOptions, para: PptxGenJS.TextPropsOptions = {}, lines?: number) => { const { out, seen } = rr(r, base); const s = add(out, lines, para); seen.forEach((x) => s.seen.add(x)); };
  const special = (title: string, sub: string | undefined, fn: Slide['special'], seen = new Set<string>(), pre?: string[]) => { slides.push({ title, sub, paras: [], seen, special: fn, pre }); cur = null; };

  for (const b of doc.blocks) {
    switch (b.k) {
      case 'h':
        if (b.level === 1) { section = b.text; open(b.text); }
        else add([{ text: b.text, options: o({ fontSize: 15, bold: true, color: t.ink }) }], 1.2, { paraSpaceBefore: 6 });
        break;
      case 'p': put(b.rich, { fontSize: 14 }, { paraSpaceAfter: 6 }); break;
      case 'callout': put(b.rich, { fontSize: 16, color: b.tone === 'warn' ? t.accentText : t.ink }, { paraSpaceAfter: 8 }, Math.ceil(textLen(rr(b.rich, {}).out) / 100) * 1.2 + 0.4); break;
      case 'bullets': b.items.forEach((r) => put(r, { fontSize: 14 }, { bullet: { indent: 16 }, paraSpaceAfter: 4 })); break;
      case 'point': {
        const f = b.fig ? P.figs[b.fig] : null, seen = new Set<string>();
        const rs: TP[] = [];
        if (f && b.fig) { seen.add(b.fig); rs.push({ text: ltrText(f.t), options: o({ fontSize: 24, bold: true, color: t.ink }) }); if (f.b !== 'actual') rs.push({ text: ` (${BASIS_HE[f.b]})`, options: o({ fontSize: 12, bold: true, color: '7A5200' }) }); rs.push({ text: String(P.num.get(b.fig) ?? ''), options: o({ fontSize: 12, superscript: true, color: t.accentText, breakLine: true }) }); }
        rs.push(...richRuns(b.line, P, { fontSize: 14, bold: true }, seen));
        if (b.comeback) { rs[rs.length - 1] = { ...rs[rs.length - 1], options: { ...rs[rs.length - 1].options, breakLine: true } }; rs.push({ text: 'התשובה: ', options: o({ fontSize: 12, bold: true, color: t.muted }) }, ...richRuns(b.comeback, P, { fontSize: 12, color: t.muted }, seen)); }
        const s = add(rs, 2 + Math.ceil(textLen(rs) / LINE) * 1.1, { paraSpaceAfter: 12 });
        seen.forEach((x) => s.seen.add(x));
        break;
      }
      case 'table': {
        const per = 11;
        for (let k = 0; k < Math.max(1, Math.ceil(b.rows.length / per)); k++) {
          const seen = new Set<string>();
          const head = b.head.some(Boolean) ? [b.head.map((h) => ({ text: h, options: o({ fontSize: 10, bold: true, color: t.muted, fill: { color: t.panel } }) }))] : [];
          const body = b.rows.slice(k * per, (k + 1) * per).map((row) => row.map((cell, i) => ({ text: typeof cell === 'string' ? [{ text: ltrText(cell), options: o({ fontSize: 10, bold: i === 0 && !head.length }) }] : richRuns(cell, P, { fontSize: 10 }, seen), options: o({ fontSize: 10, valign: 'middle' }) })));
          const rows = [...head, ...body] as PptxGenJS.TableRow[];
          special(section, k ? 'המשך' : undefined, (s, top) => {
            const n = Math.max(...rows.map((q) => q.length));
            const first = n === 2 ? 2.2 : (W - 2 * M) * 0.3, rest = (W - 2 * M - first) / Math.max(1, n - 1);
            s.addTable(rows.map((q) => [...q].reverse()), { x: M, y: top, w: W - 2 * M, colW: [first, ...Array(n - 1).fill(rest)].reverse() as number[], border: { type: 'solid', pt: 0.5, color: t.line }, fill: { color: t.bg }, margin: 0.05, autoPage: false });
          }, seen);
        }
        break;
      }
      case 'options': {
        const seen = new Set<string>();
        const cellOf = (rs: Rich[]) => rs.flatMap((r, i) => { const x = richRuns(r, P, { fontSize: 10.5 }, seen); if (x.length) x[x.length - 1] = { ...x[x.length - 1], options: { ...x[x.length - 1].options, breakLine: i < rs.length - 1 } }; return [{ text: '• ', options: o({ fontSize: 10.5 }) }, ...x]; });
        const head = ['אפשרות', 'בעד', 'נגד'].map((h) => ({ text: h, options: o({ fontSize: 10.5, bold: true, color: t.muted, fill: { color: t.panel } }) }));
        const rows = [head, ...b.items.map((it) => [{ text: it.name, options: o({ fontSize: 11, bold: true, highlight: it.name.includes('⟦') ? 'FFF1A8' : undefined }) }, { text: cellOf(it.pro), options: o({ valign: 'top' }) }, { text: cellOf(it.con), options: o({ valign: 'top' }) }])] as PptxGenJS.TableRow[];
        const rec = b.rec ? richRuns(b.rec, P, { fontSize: 13 }, seen) : null;
        special(section, undefined, (s, top) => {
          s.addTable(rows.map((q) => [...q].reverse()), { x: M, y: top, w: W - 2 * M, colW: [3.0, 4.66, 4.67].reverse(), border: { type: 'solid', pt: 0.5, color: t.line }, fill: { color: t.bg }, margin: 0.06, autoPage: false });
          if (rec) s.addText([{ text: 'המלצה: ', options: o({ fontSize: 13, bold: true }) }, ...rec], { x: M, y: 5.25, w: W - 2 * M, h: 0.85, fill: { color: 'FFFBEA' }, line: { color: 'B07A0A', width: 0.75 }, margin: 0.1, valign: 'middle', fit: 'shrink', ...HE });
        }, seen);
        break;
      }
      case 'exhibit': {
        const ex = b.ex, src = exhibitSourceLine(ex, b.figs, ctx);
        const pre = [...ex.foot.map((f, i) => `(${i + 1}) ${f}`), ...(src ? [src] : [])];
        special(ex.title, [ex.unit, ex.span].filter(Boolean).join(' · ') || undefined, (s, top) => {
          const box: [number, number, number, number] = [M, top, W - 2 * M, 6.12 - top];
          if (ex.kind === 'table' && ex.rows && ex.rows.length > 1) addTable(s, ex.rows, t, box);
          else addChart(pptx, s, exSpec(ex), t, 'phoenix', box);
          if (b.note) s.addNotes(b.note);
        }, new Set(), pre);
        break;
      }
      case 'pagebreak': cur = null; break;
    }
  }

  let n = 2;
  for (const sl of slides) {
    if (!sl.special && !sl.paras.length) continue;
    const s = pptx.addSlide();
    frame(pptx, s, n++, sl.title, sl.sub);
    if (sl.special) sl.special(s, 1.42);
    else {
      const all: TP[] = [];
      sl.paras.forEach((q) => { const rs = q.runs.map((x) => ({ ...x, options: { ...x.options } })); rs[rs.length - 1].options!.breakLine = true; all.push(...rs); });
      all[all.length - 1].options!.breakLine = false;
      s.addText(all, { x: M, y: 1.42, w: W - 2 * M, h: 4.7, valign: 'top', margin: 0, fit: 'shrink', ...HE });
    }
    foot(pptx, s, P, sl.seen, sl.pre ?? []);
  }

  // the assumptions, then the sources: every figure's note and every document (a link to its first page)
  const listSlides = (title: string, lines: TP[][], per: number) => {
    for (let k = 0; k < Math.ceil(lines.length / per); k++) {
      const s = pptx.addSlide();
      const pages = Math.ceil(lines.length / per);
      frame(pptx, s, n++, pages > 1 ? `${title} (${k + 1}/${pages})` : title);
      const chunk = lines.slice(k * per, (k + 1) * per).flatMap((l, i, a) => l.map((x, j) => (j === l.length - 1 && i < a.length - 1 ? { ...x, options: { ...x.options, breakLine: true } } : x)));
      s.addText(chunk, { x: M, y: 1.42, w: W - 2 * M, h: 5.6, valign: 'top', margin: 0, fit: 'shrink', paraSpaceAfter: 3, ...HE });
    }
  };
  if (doc.assumptions?.length) listSlides('יומן הנחות', doc.assumptions.map((a) => [{ text: a, options: o({ fontSize: 11, bullet: { indent: 14 } }) }]), 14);
  const srcLines: TP[][] = [
    ...(P.notes.length ? [[{ text: 'הערות לנתונים', options: o({ fontSize: 12, bold: true }) }]] : []),
    ...P.notes.map((q) => [{ text: `[${q.n}] ${q.text}`, options: o({ fontSize: 9.5, color: t.muted }) }]),
    ...(P.sources.length ? [[{ text: 'מסמכים', options: o({ fontSize: 12, bold: true, paraSpaceBefore: 6 }) }]] : []),
    ...P.sources.map((cte) => { const u = citeUrl(cte); return [{ text: citeText(cte), options: o({ fontSize: 9.5, ...(u ? { hyperlink: { url: u, tooltip: 'פתיחת המקור' }, color: t.accentText } : { color: t.muted }) }) }]; }),
  ];
  if (srcLines.length) listSlides('מקורות', srcLines, 16);
  const buf = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
  return finish(buf, 'uint8array');
}
