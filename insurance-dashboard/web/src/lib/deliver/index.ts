/* S4 · the Deliverable Factory: `exportDoc(doc, format)` writes a Doc (lib/doc.ts) as PowerPoint, Word, a print-ready PDF (the browser's
   print dialog on an A4 page with no site chrome) or plain text (the email summary), and the producers turn an answer, a finding or
   several answers into a Doc. Loaded on demand (the page imports this module dynamically): the main bundle does not carry it.
   Before anything is written: the author's name (set once in this browser, asked for on the first export), the source documents of
   every figure (printed components loaded), and the check that refuses an unsourced figure. Nothing is sent anywhere. */
import type { Doc } from '../doc';
import { readStored, writeStored } from '../local';
import { load } from '../useData';
import { ltsCite } from '../answersLoad';
import { readyRep } from '../lens';
import { saveBlob } from '../pptx';
import { AUTHOR_PH, docFileName, fillPlaceholders, KIND_HE, problems, type Ctx, type Format } from './notes';

export { answerDoc, findingDoc, packDoc, type ProduceCtx } from './produce';
export { FORMAT_HE, KIND_HE, KINDS, placeholders, fillPlaceholders, problems, type Format } from './notes';
import { docHtml } from './html';
import { docTxt } from './txt';
import { exhibitPics } from './chartPng';
export { docHtml, docTxt, exhibitPics };

/** the key of the author's name in this browser (lib/local.ts namespace) */
export const AUTHOR_KEY = 'deliver:author';
export const storedAuthor = () => (readStored<string>(AUTHOR_KEY, '') ?? '').trim();

export interface ExportOpts {
  /** the file name without the extension (default: the title and the date) */
  filename?: string;
  /** false: no kind line above the title (Word, PDF) */
  kindLabel?: boolean;
}

/** the author: the doc's, else the name set in this browser, else asked for once (and kept in this browser) */
function author(doc: Doc): string {
  if (doc.author.trim()) return doc.author.trim();
  let a = storedAuthor();
  if (!a && typeof window !== 'undefined' && typeof window.prompt === 'function') {
    a = (window.prompt('שם המחבר, כפי שיופיע על המסמך (נשמר בדפדפן הזה בלבד)', '') ?? '').trim();
    if (a) writeStored(AUTHOR_KEY, a);
  }
  return a;
}

/** company names and the printed components the figures cite, so every source line names its document and page */
export async function citeCtx(doc: Doc): Promise<Ctx> {
  const cos = new Set<string>();
  const walk = (j: unknown) => {
    if (Array.isArray(j)) j.forEach(walk);
    else if (j && typeof j === 'object') { const o = j as Record<string, unknown>; if (o.k === 'lts' && typeof o.c === 'string') cos.add(o.c); else Object.values(o).forEach(walk); }
  };
  walk(doc.figs); walk(doc.blocks);
  const [reg] = await Promise.all([load<{ id: string; name_he: string }[]>('companies/index.json').catch(() => []), ...[...cos].map(readyRep)]);
  return { lts: ltsCite, names: Object.fromEntries(reg.map((c) => [c.id, c.name_he])) };
}

const isIOS = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** the print dialog on the page alone: an off-screen frame (its address is about:srcdoc, not the site's); on iOS, where a frame prints
 *  the page around it, the page itself shows only the document while the dialog is open */
function printHtml(html: string, title: string): Promise<void> {
  return new Promise((done) => {
    if (isIOS()) {
      const host = document.createElement('div');
      host.id = 'deliver-print';
      const shadow = host.attachShadow({ mode: 'open' });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      shadow.innerHTML = `<style>${doc.querySelector('style')?.textContent ?? ''}</style>${doc.body.innerHTML}`;
      const hide = document.createElement('style');
      hide.textContent = '@media print{body>*:not(#deliver-print){display:none!important}}@media screen{#deliver-print{display:none}}';
      const was = document.title;
      document.title = title;
      document.body.append(host, hide);
      const end = () => { host.remove(); hide.remove(); document.title = was; window.removeEventListener('afterprint', end); done(); };
      window.addEventListener('afterprint', end);
      setTimeout(() => { window.print(); setTimeout(end, 60000); }, 50);
      return;
    }
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0';
    f.srcdoc = html;
    f.onload = () => {
      const w = f.contentWindow!;
      const imgs = [...w.document.images].map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = r; })));
      void Promise.all(imgs).then(() => {
        w.addEventListener('afterprint', () => setTimeout(() => f.remove(), 500));
        w.focus();
        w.print();
        setTimeout(() => { if (f.isConnected) f.remove(); }, 120000);
        done();
      });
    };
    document.body.append(f);
  });
}

/** writes the doc in the format asked for: a file download (pptx, docx, txt) or the print dialog (pdf). Throws when a figure has no source. */
export async function exportDoc(doc: Doc, format: Format, opts: ExportOpts = {}): Promise<void> {
  const name = author(doc);
  const d = fillPlaceholders({ ...doc, author: name }, name ? { [AUTHOR_PH]: name } : {});
  const ctx = await citeCtx(d);
  const bad = problems(d, ctx);
  if (bad.length) throw new Error(`המסמך לא הופק: ${bad.slice(0, 3).join('; ')}`);
  const file = (ext: string) => (opts.filename ? `${opts.filename.replace(/fox/gi, '').replace(/[\\/:*?"<>|]+/g, '')}.${ext}` : docFileName(d, ext));
  const kindLabel = opts.kindLabel === false ? undefined : KIND_HE[d.kind];
  switch (format) {
    case 'txt': {
      saveBlob(file('txt'), new Blob(['﻿', docTxt(d, ctx)], { type: 'text/plain;charset=utf-8' }));
      return;
    }
    case 'docx': {
      const { docxBytes } = await import('./docx');
      const bytes = await docxBytes(d, { ctx, images: await exhibitPics(d), kindLabel });
      saveBlob(file('docx'), new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      return;
    }
    case 'pptx': {
      const { deckBytes } = await import('./pptx');
      saveBlob(file('pptx'), new Blob([await deckBytes(d, ctx)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
      return;
    }
    case 'pdf': {
      const pics = await exhibitPics(d);
      const html = docHtml(d, { ctx, kindLabel, images: Object.fromEntries(Object.entries(pics).map(([k, v]) => [k, v.url])) });
      await printHtml(html, file('pdf').replace(/\.pdf$/, ''));
      return;
    }
  }
}
