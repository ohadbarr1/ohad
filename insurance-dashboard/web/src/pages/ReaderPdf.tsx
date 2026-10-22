/** The filed PDF page itself, drawn with pdf.js from MAYA (which allows cross-origin reads), the query words boxed.
 *  Loaded only when the reader asks for the original page: the whole file is downloaded (MAYA does not expose ranges to
 *  other origins). Needs `https://mayafiles.tase.co.il` in the site's connect-src; without it the reader keeps the text view. */
import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { findTerms } from '../lib/hebrew';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const docs = new Map<string, Promise<PDFDocumentProxy>>();
function open(url: string, onProgress: (f: number) => void): Promise<PDFDocumentProxy> {
  let p = docs.get(url);
  if (!p) {
    const task = pdfjs.getDocument({ url, isEvalSupported: false, disableFontFace: true, disableRange: true, disableAutoFetch: true, withCredentials: false });
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => total && onProgress(loaded / total);
    p = task.promise;
    p.catch(() => docs.delete(url));
    docs.set(url, p);
    if (docs.size > 3) docs.delete(docs.keys().next().value!);
  }
  return p;
}

export function PdfPage({ url, page, terms, onFail }: { url: string; page: number; terms: string[]; onFail: (why: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [boxes, setBoxes] = useState<{ l: number; t: number; w: number; h: number }[]>([]);
  const [state, setState] = useState<string>('טוען את קובץ ה-PDF…');
  useEffect(() => {
    let live = true;
    let task: { cancel: () => void } | null = null;
    setBoxes([]);
    open(url, (f) => live && setState(`טוען את קובץ ה-PDF… ${Math.round(f * 100)}%`)).then(async (doc) => {
      if (!live) return;
      const pg = await doc.getPage(page);
      const width = Math.min(box.current?.clientWidth ?? 800, 1100);
      const base = pg.getViewport({ scale: 1 });
      const scale = width / base.width, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = pg.getViewport({ scale });
      const c = canvas.current!;
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      c.style.width = `${Math.floor(vp.width)}px`; c.style.height = `${Math.floor(vp.height)}px`;
      const r = pg.render({ canvasContext: c.getContext('2d')!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = r;
      await r.promise;
      if (!live) return;
      setState('');
      if (!terms.length) return;
      const tc = await pg.getTextContent();
      const out: typeof boxes = [];
      for (const it of tc.items) {
        if (!('str' in it) || !it.str || !findTerms(it.str, terms).length) continue;
        const tx = pdfjs.Util.transform(vp.transform, it.transform);
        const h = Math.hypot(tx[2], tx[3]);
        out.push({ l: tx[4], t: tx[5] - h, w: it.width * scale, h: h * 1.15 });
      }
      if (live) setBoxes(out);
    }).catch((e: Error) => { if (live) { setState(''); onFail(e?.message ?? 'error'); } });
    return () => { live = false; task?.cancel(); };
  }, [url, page, terms, onFail]);
  // the first boxed word scrolls into view
  useEffect(() => { if (boxes.length) box.current?.querySelector('.hl')?.scrollIntoView({ block: 'center', inline: 'nearest' }); }, [boxes]);
  return (
    <div ref={box}>
      {state && <p className="none">{state}</p>}
      <div className="rd-canvas" style={{ width: 'fit-content' }}>
        <canvas ref={canvas} aria-label={`עמוד ${page} של הקובץ המקורי`} />
        {boxes.map((b, i) => <span key={i} className="hl" style={{ left: b.l, top: b.t, width: b.w, height: b.h }} />)}
      </div>
    </div>
  );
}
