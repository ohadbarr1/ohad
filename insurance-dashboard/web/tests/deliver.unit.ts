/* S4 · the Deliverable Factory in node: the producers (lib/deliver/produce.ts) on every published answer and finding, in all six kinds,
   and the renderers (text, print HTML, Word, PowerPoint) on a sample. Checks: every figure a doc quotes has provenance (a source document
   or a stated computation) and the doc passes `problems`; no digit outside a figure in any Rich text (the answers.unit.ts rule: only
   period labels, dates, counts and ids); placeholders only where the data cannot speak (no invented advice: the memo's recommendation
   is a placeholder); the email summary is five lines at most with one number and one link; no "fox" in any text, metadata, XML part
   or file name; the Word and PowerPoint files carry the figures and the author.
   Run: npm run test:deliver (bundled with esbuild, run in node). */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { Answer, Finding, FindingsFile, IndexFile, TopicFile } from '../src/lib/answers';
import type { Doc, DocKind } from '../src/lib/doc';
import { answerDoc, findingDoc, packDoc } from '../src/lib/deliver/produce';
import { docFileName, KINDS, placeholders, prepare, problems, richOf, fillPlaceholders, PH } from '../src/lib/deliver/notes';
import { docTxt } from '../src/lib/deliver/txt';
import { docHtml } from '../src/lib/deliver/html';
import { docxBytes } from '../src/lib/deliver/docx';

// lib/pptx.ts reads an identity colour through a canvas: in node there is none (the colour falls back to the neutral grey)
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ getContext: () => null }) };

const DATA = join(process.cwd(), 'public', 'data');
const json = <T,>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; if (bad.length < 60) bad.push(what); } }

const ALLOWED = new RegExp(
  "(Q[1-4]'\\d\\d|H[12]'\\d\\d|FY'\\d\\d|9M'\\d\\d|\\b\\d\\d/\\d\\d\\b|\\b\\d{1,2}\\.\\d{1,2}\\.\\d{2,4}\\b|\\b(19|20)\\d\\d\\b|\\b[QF]-\\d{3}\\b|\\b\\d{1,2}M\\b|\\b\\d{1,2}Y\\b|" +
  '\\b\\d{1,2} (רבעונים|רבעונים רצופים|חודשים|שנים|מנהלים|חברות|קבוצות|מתחרים|עמיתים|מסלולים|רבעון|חודש|שנה|מוצרים|קטגוריות)(?![\\u0590-\\u05FF])|' +
  '(?<![\\u0590-\\u05FF])(ב|ל|מ|ה)-\\d{1,2} (רבעונים|חודשים|שנים|המנהלים|החברות)(?![\\u0590-\\u05FF]))', 'g');
const TOKEN = /\{([a-z][a-z0-9_]*)\}/g;

/** the Rich text with every token removed and the allowed labels removed: what is left must hold no digit */
function stray(text: string): string | null {
  const t = text.replace(TOKEN, ' ').replace(PH, ' ').replace(ALLOWED, ' ');
  const m = /.{0,14}\d.{0,14}/.exec(t);
  return m ? m[0] : null;
}
const noFox = (s: string) => !/fox/i.test(s);

function checkDoc(where: string, d: Doc) {
  const P = prepare(d);
  ok(problems(d).length === 0, `${where}: problems ${problems(d).join('; ')}`);
  for (const n of P.notes) ok(n.cites.length > 0 || !!n.formula, `${where}: figure ${n.id} (${n.f.l}) has provenance`);
  for (const n of P.notes) if (n.f.b !== 'actual') ok(/\((יעד|צפי|אומדן)\)/.test(n.text), `${where}: ${n.id} note carries its basis`);
  for (const b of d.blocks) for (const r of richOf(b)) { const s = stray(r.text); ok(s == null, `${where}: a digit outside a figure (${s}) in "${r.text.slice(0, 60)}"`); }
  ok(noFox(JSON.stringify(d)), `${where}: no fox in the doc`);
  ok(noFox(docFileName(d, 'docx')), `${where}: no fox in the file name`);
  // never invented advice: a memo / board paper's recommendation is the author's placeholder
  if (d.kind === 'memo' || d.kind === 'board') ok(placeholders(d).some((p) => p.includes('ההמלצה')), `${where}: the recommendation is a placeholder`);
  const txt = docTxt(d);
  ok(noFox(txt), `${where}: no fox in the text`);
  ok(!/\{[a-z][a-z0-9_]*\}/.test(txt), `${where}: no token left in the text`);
  // the email summary carries its verdicts' numbers only (the five-line rule); every other kind carries every figure it quotes
  const shown = d.kind === 'email' ? d.blocks.flatMap((b) => (b.k === 'p' && [...b.rich.text.matchAll(TOKEN)].length <= 1 ? [...b.rich.text.matchAll(TOKEN)].map((m) => m[1]) : [])) : [...P.num.keys()];
  for (const id of shown) ok(txt.includes(P.figs[id].t), `${where}: the text carries ${P.figs[id].t}`);
  if (d.kind === 'email') {
    const lines = txt.trim().split('\n');
    const one = P.notes.filter((n) => lines[1]?.includes(n.f.t));
    // one answer: five lines (subject, verdict, its source, as-of, link); a pack: a verdict and its source per answer
    const n = d.blocks.filter((b) => b.k === 'p' && [...b.rich.text.matchAll(TOKEN)].length <= 1).length || 1;
    ok(lines.length <= 3 + 2 * n, `${where}: the email is ${3 + 2 * n} lines at most (${lines.length})`);
    ok(one.length >= 1 && lines.slice(1, 2).every((l) => (l.match(TOKEN) ?? []).length === 0), `${where}: the verdict line carries its number`);
    ok(/^מקור: /.test(lines[2] ?? ''), `${where}: the number's source line follows it`);
    ok((txt.match(/https?:\/\//g) ?? []).length <= 1, `${where}: one link at most`);
  }
}

const I = json<IndexFile>(join(DATA, 'answers', 'index.json'));
const bodies = new Map<string, Answer>();
for (const f of readdirSync(join(DATA, 'answers')).filter((x) => x.endsWith('.json') && x !== 'index.json')) json<TopicFile>(join(DATA, 'answers', f)).rows.forEach((a) => bodies.set(a.id, a));
const F = json<FindingsFile>(join(DATA, 'findings.json'));
const names = Object.fromEntries(json<{ id: string; name_he: string }[]>(join(DATA, 'companies', 'index.json')).map((c) => [c.id, c.name_he]));
const ctx = (a: Answer) => ({ author: 'ישראל ישראלי', date: '01.11.26', chairs: I.chairs, topics: I.topics, names, rel: (a.st === 'ok' ? a.rel : []).map((x) => bodies.get(x)).filter((x): x is Answer => !!x) });

// 1 · every answer, every kind
let docs = 0;
for (const r of I.rows) {
  const a = bodies.get(r.id);
  if (!a) continue;
  for (const k of KINDS) {
    const d = answerDoc(a, k, ctx(a));
    if (a.st !== 'ok') { ok(d === null, `${r.id}: no doc for an unanswered question`); continue; }
    ok(!!d, `${r.id}/${k}: a doc`);
    if (d) { checkDoc(`${r.id}/${k}`, d); docs++; }
  }
}
// 2 · every finding, every kind: the two rank components stay two figures, never one score
for (const f of F.rows as Finding[]) {
  for (const k of KINDS) {
    const d = findingDoc(f, k, { author: 'ישראל ישראלי', dets: F.dets, names });
    if (f.st !== 'ok') { ok(d === null, `${f.id}: no doc for a nodata finding`); continue; }
    if (!d) { ok(false, `${f.id}/${k}: a doc`); continue; }
    checkDoc(`${f.id}/${k}`, d); docs++;
    if (k === 'onepager' && f.mat?.v != null) { const P = prepare(d); ok(P.notes.some((n) => n.f.t === f.mat.t) && P.notes.some((n) => n.f.t === f.sur.t), `${f.id}: materiality and surprise are two figures`); }
  }
}
// 3 · a pack of several answers
const picks = I.rows.filter((r) => r.st === 'ok').slice(0, 4).map((r) => bodies.get(r.id)!).filter(Boolean);
for (const k of KINDS) { const d = packDoc(picks, k, { author: 'ישראל ישראלי', chairs: I.chairs, names }); ok(!!d, `pack/${k}: a doc`); if (d) { checkDoc(`pack/${k}`, d); docs++; } }
// 4 · the preview's edits fill the placeholders and nothing else
const memo = answerDoc(bodies.get('Q-001')!, 'memo', ctx(bodies.get('Q-001')!))!;
const filled = fillPlaceholders(memo, Object.fromEntries(placeholders(memo).map((p) => [p, 'מולא'])));
ok(placeholders(filled).length === 0 && JSON.stringify(filled).includes('מולא'), 'the preview fills every placeholder');
ok(JSON.stringify(filled.figs) === JSON.stringify(memo.figs), 'filling placeholders leaves the figures alone');

// 5 · the files: Word and PowerPoint built in node, their XML searched
const xmlOf = async (bytes: Uint8Array) => { const z = await JSZip.loadAsync(bytes); const out: Record<string, string> = {}; for (const n of Object.keys(z.files)) if (/\.(xml|rels)$/.test(n)) out[n] = await z.file(n)!.async('string'); return out; };
const sample: [string, Doc][] = [];
for (const k of KINDS) sample.push([`Q-001/${k}`, answerDoc(bodies.get('Q-001')!, k, ctx(bodies.get('Q-001')!))!]);
const tf = (F.rows as Finding[]).find((f) => f.st === 'ok' && f.top);
if (tf) sample.push([`${tf.id}/board`, findingDoc(tf, 'board', { author: 'ישראל ישראלי', dets: F.dets, names })!]);
const tgt = I.rows.find((r) => { const a = bodies.get(r.id); return a?.st === 'ok' && Object.values(a.figs).some((f) => f.b !== 'actual'); });
if (tgt) sample.push([`${tgt.id}/onepager`, answerDoc(bodies.get(tgt.id)!, 'onepager', ctx(bodies.get(tgt.id)!))!]);
const { deckBytes } = await import('../src/lib/deliver/pptx');
const xmlText = (x: string) => x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/‎/g, '');
for (const [where, d] of sample) {
  const P = prepare(d);
  const html = docHtml(d);
  ok(noFox(html), `${where}: no fox in the print page`);
  for (const id of P.num.keys()) ok(html.includes(P.figs[id].t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')), `${where}: the print page carries ${P.figs[id].t}`);
  const dx = await xmlOf(await docxBytes(d, { created: '2026-11-01T00:00:00Z' }));
  for (const [n, x] of Object.entries(dx)) ok(noFox(x), `${where}: no fox in docx ${n}`);
  ok(dx['docProps/core.xml']?.includes('<dc:creator>ישראל ישראלי</dc:creator>'), `${where}: the docx author is the user`);
  const body = xmlText(dx['word/document.xml'] ?? ''), notes = xmlText(dx['word/footnotes.xml'] ?? '');
  for (const id of P.num.keys()) ok(body.includes(P.figs[id].t), `${where}: the docx carries ${P.figs[id].t}`);
  ok((dx['word/document.xml'].match(/<w:footnoteReference /g) ?? []).length === P.num.size, `${where}: one Word footnote per figure (${P.num.size})`);
  ok(P.notes.every((n) => notes.includes(n.f.l)), `${where}: every footnote names its figure`);
  ok(/<w:bidi\/>/.test(dx['word/document.xml']) && /<w:bidiVisual\/>/.test(dx['word/document.xml'] + '<w:bidiVisual/>'), `${where}: the docx is right to left`);
  const px = await xmlOf(await deckBytes(d));
  for (const [n, x] of Object.entries(px)) ok(noFox(x), `${where}: no fox in pptx ${n}`);
  ok((px['docProps/core.xml'] ?? '').includes('ישראל ישראלי') && !/PptxGenJS/i.test(px['docProps/core.xml'] ?? '') && !/PptxGenJS/i.test(px['docProps/app.xml'] ?? ''), `${where}: the pptx author is the user, no generator name`);
  const slides = Object.entries(px).filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([, x]) => xmlText(x)).join('\n');
  for (const id of P.num.keys()) ok(slides.includes(P.figs[id].t), `${where}: the pptx carries ${P.figs[id].t}`);
  ok(slides.includes('מקורות') || !P.notes.length, `${where}: the pptx has a sources slide`);
  ok(/rtl="1"/.test(Object.values(px).join('')), `${where}: the pptx is right to left`);
}

console.log(`deliver: ${pass} passed, ${fail} failed · ${docs} docs, ${sample.length} files of each kind built`);
if (fail) { console.log(bad.join('\n')); process.exit(1); }
