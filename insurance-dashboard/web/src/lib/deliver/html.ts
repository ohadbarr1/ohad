/* S4 · the print document (PDF through the browser's print dialog) and the preview: one self-contained HTML page, A4, right to left,
   house style (navy ink, one ember rule, dense, footnoted), no site chrome, no mark, no site name. Figures carry superscript note
   numbers; the notes (each figure's provenance) and the documents follow the text; an exhibit is its picture (rendered by the chart
   engine) or, without one, its data table, with its own footnotes and source line. Pure: the pictures come in as data URLs. */
import type { Block, Doc, Rich } from '../doc';
import { BASIS_HE } from '../answers';
import { basisMix, citeText, citeUrl, exhibitRows, exhibitSourceLine, prepare, runs, type Ctx, type Prepared } from './notes';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function rich(r: Rich, P: Prepared): string {
  return runs(r, P).map((x) => {
    if (x.k === 't') return esc(x.s);
    if (x.k === 'ph') return `<mark class="ph">${esc(x.s)}</mark>`;
    if (x.k === 'miss') return '<span class="miss">?</span>';
    const v = x.ltr ? `<bdi dir="ltr" class="n">${esc(x.f.t)}</bdi>` : `<b>${esc(x.f.t)}</b>`;
    return `<span class="fig">${v}${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}<sup>${x.n}</sup></span>`;
  }).join('');
}
/** plain text with its placeholders highlighted */
const phHtml = (s: string) => esc(s).replace(/⟦([^⟧]*)⟧/g, '<mark class="ph">$1</mark>');
const cell = (c: string | Rich, P: Prepared) => (typeof c === 'string' ? esc(c) : rich(c, P));
const tableHtml = (head: string[], rows: string[][], cls = '') => `<table class="${cls}">${head.some(Boolean) ? `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</tbody></table>`;

function block(b: Block, i: number, P: Prepared, img: Record<number, string>, ctx: Ctx): string {
  switch (b.k) {
    case 'h': return `<h${b.level + 1}>${esc(b.text)}</h${b.level + 1}>`;
    case 'p': return `<p>${rich(b.rich, P)}</p>`;
    case 'callout': return `<div class="callout ${b.tone}">${rich(b.rich, P)}</div>`;
    case 'bullets': return `<ul>${b.items.map((r) => `<li>${rich(r, P)}</li>`).join('')}</ul>`;
    case 'point': {
      const f = b.fig ? P.figs[b.fig] : null;
      return `<div class="point">${f ? `<div class="pn"><bdi dir="${/[֐-׿]/.test(f.t) ? 'rtl' : 'ltr'}">${esc(f.t)}</bdi>${f.b !== 'actual' ? `<span class="tag">${BASIS_HE[f.b]}</span>` : ''}<sup>${P.num.get(b.fig!)}</sup></div>` : ''}<div class="pl"><p>${rich(b.line, P)}</p>${b.comeback ? `<p class="cb">${rich(b.comeback, P)}</p>` : ''}</div></div>`;
    }
    case 'exhibit': {
      const ex = b.ex, rows = exhibitRows(ex), src = exhibitSourceLine(ex, b.figs, ctx);
      const body = img[i] ? `<img src="${img[i]}" alt="${esc(ex.title)}">` : tableHtml(rows[0].map(esc), rows.slice(1).map((r) => r.map(esc)), 'ex-t');
      return `<figure class="ex"><figcaption><b>${esc(ex.title)}</b><span>${esc([ex.unit, ex.span].filter(Boolean).join(' · '))}</span></figcaption>${body}${ex.foot.length ? `<ol class="foot">${ex.foot.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>` : ''}${src ? `<p class="src">${esc(src)}</p>` : ''}${b.note ? `<p class="exn">${esc(b.note)}</p>` : ''}</figure>`;
    }
    case 'table': return tableHtml(b.head.map(esc), b.rows.map((r) => r.map((c) => cell(c, P))), b.head.some(Boolean) ? 'dt' : 'meta') + (b.foot?.length ? `<p class="src">${b.foot.map(esc).join(' · ')}</p>` : '');
    case 'options': return `<div class="opts">${b.items.map((o) => `<div class="opt"><h4>${phHtml(o.name)}</h4><div class="pc"><div><span class="pl2">בעד</span><ul>${o.pro.map((r) => `<li>${rich(r, P)}</li>`).join('')}</ul></div><div><span class="pl2">נגד</span><ul>${o.con.map((r) => `<li>${rich(r, P)}</li>`).join('')}</ul></div></div></div>`).join('')}${b.rec ? `<div class="callout rec"><b>המלצה: </b>${rich(b.rec, P)}</div>` : ''}</div>`;
    case 'pagebreak': return '<div class="pb"></div>';
  }
}

const CSS = `
@page{size:A4;margin:18mm 16mm 18mm 16mm;@bottom-left{content:counter(page);font:8pt Arial,sans-serif;color:#687086}@bottom-right{content:"__FOOT__";font:8pt Arial,sans-serif;color:#687086}}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:#111C3F;font:10pt/1.5 Arial,"Heebo","Segoe UI",sans-serif;direction:rtl;text-align:right}
.page{max-width:178mm;margin:0 auto;padding:6mm 0}
header.cover{border-bottom:1.2pt solid #111C3F;padding-bottom:4mm;margin-bottom:5mm;position:relative}
header.cover:after{content:"";position:absolute;right:0;bottom:-2.2pt;width:22mm;height:3pt;background:#FF4E31}
.kind{font-size:8pt;letter-spacing:.06em;color:#C2391C;font-weight:700;margin:0 0 1mm}
h1{font-size:19pt;line-height:1.2;margin:0 0 1.5mm}.sub{font-size:10.5pt;color:#4F5668;margin:0 0 2mm}.by{font-size:8.5pt;color:#687086;margin:0}
h2{font-size:12.5pt;margin:6mm 0 2mm;padding-bottom:1mm;border-bottom:.5pt solid #D3D7DF;break-after:avoid}
h3{font-size:10.5pt;margin:4mm 0 1.5mm;break-after:avoid}h4{font-size:10pt;margin:0 0 1mm}
p{margin:0 0 2mm}ul{margin:0 0 2mm;padding-inline-start:5mm}li{margin-bottom:1mm}
.fig b,.fig .n{font-weight:700}.n{unicode-bidi:isolate;direction:ltr;font-variant-numeric:tabular-nums}
sup{font-size:6.5pt;color:#C2391C;margin-inline-start:.4mm;font-weight:400}
.tag{font-size:7pt;border:.5pt solid #B07A0A;color:#7A5200;border-radius:2pt;padding:0 .8mm;margin-inline-start:.8mm;font-weight:700}
mark.ph{background:#FFF1A8;color:#5A4500;border-bottom:.8pt dashed #B07A0A;padding:0 .6mm}
.callout{border-inline-start:2.4pt solid #111C3F;background:#F1F2F6;padding:2.5mm 3.5mm;margin:0 0 3mm;font-size:11pt}
.callout.warn{border-color:#C2391C;background:#FFF3EF}.callout.rec{font-size:10pt;border-color:#B07A0A;background:#FFFBEA}
table{width:100%;border-collapse:collapse;margin:0 0 3mm;font-size:8.8pt;break-inside:auto}tr{break-inside:avoid}
th,td{border-bottom:.5pt solid #D3D7DF;padding:1.2mm 1.6mm;text-align:right;vertical-align:top}thead th{background:#F1F2F6;color:#4F5668;font-weight:700;border-bottom:.9pt solid #111C3F}
td{font-variant-numeric:tabular-nums}table.meta th{width:22mm;color:#4F5668}table.meta{width:auto;min-width:60%}
table.ex-t td{direction:ltr;text-align:left;unicode-bidi:isolate}
figure.ex{margin:2mm 0 5mm;break-inside:avoid}figure.ex figcaption{display:flex;justify-content:space-between;gap:4mm;border-bottom:.9pt solid #111C3F;padding-bottom:1mm;margin-bottom:2mm}
figure.ex figcaption b{font-size:10.5pt}figure.ex figcaption span{font-size:8.5pt;color:#4F5668}figure.ex img{width:100%;height:auto;display:block}
ol.foot{font-size:7.8pt;color:#4F5668;margin:1.5mm 0 0;padding-inline-start:4mm}.src{font-size:7.8pt;color:#4F5668;margin:1mm 0 0}.exn{font-size:8.5pt;font-style:italic}
.point{display:flex;gap:4mm;border-bottom:.5pt solid #D3D7DF;padding:2.5mm 0;break-inside:avoid}.pn{flex:0 0 32mm;font-size:16pt;font-weight:700;color:#111C3F;line-height:1.2}
.pn .tag{font-size:7pt;vertical-align:middle}.pl{flex:1}.pl p{margin:0 0 1mm}.cb{color:#4F5668;font-size:9.2pt}.cb:before{content:"התשובה: ";font-weight:700;color:#111C3F}
.opts{margin-bottom:3mm}.opt{border:.5pt solid #D3D7DF;padding:2.5mm 3mm;margin-bottom:2mm;break-inside:avoid}.pc{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.pl2{font-size:8pt;font-weight:700;color:#4F5668}
.pb{break-after:page}
section.notes{margin-top:7mm;border-top:.9pt solid #111C3F;padding-top:2mm;font-size:7.8pt;color:#333B52}
section.notes h2{font-size:10pt;border:0;margin:2mm 0 1mm}section.notes ol{padding-inline-start:5mm;margin:0}section.notes li{margin-bottom:.8mm}
section.notes a{color:#1F3E8A;text-decoration:underline;word-break:break-all}
.miss{color:#C2391C;font-weight:700}
@media screen{body{background:#E9EBF0}.page{background:#fff;padding:14mm 16mm;margin:6mm auto;box-shadow:0 1px 4px rgba(0,0,0,.15);max-width:210mm}}
`;

export interface HtmlOpt { images?: Record<number, string>; ctx?: Ctx; kindLabel?: string }
/** the whole doc as one HTML page (print or preview) */
export function docHtml(doc: Doc, opt: HtmlOpt = {}): string {
  const ctx = opt.ctx ?? {}, P = prepare(doc, ctx), img = opt.images ?? {};
  const mix = basisMix(P);
  const by = [doc.author, doc.date, doc.asof ? `נתונים נכון ל-${doc.asof}` : '', mix].filter((v): v is string => !!v).map(esc).join(' · ');
  const body = doc.blocks.map((b, i) => block(b, i, P, img, ctx)).join('\n');
  const assume = doc.assumptions?.length ? `<section class="notes"><h2>יומן הנחות</h2><ol>${doc.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ol></section>` : '';
  const notes = P.notes.length ? `<section class="notes"><h2>הערות לנתונים</h2><ol>${P.notes.map((n) => `<li value="${n.n}">${esc(n.text)}</li>`).join('')}</ol></section>` : '';
  const srcs = P.sources.length ? `<section class="notes"><h2>מקורות</h2><ol>${P.sources.map((c) => { const u = citeUrl(c); return `<li>${u ? `<a href="${esc(u)}">${esc(citeText(c))}</a>` : esc(citeText(c))}</li>`; }).join('')}</ol></section>` : '';
  const foot = [doc.author, doc.date].filter(Boolean).join(' · ').replace(/["\\<>]/g, '');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="author" content="${esc(doc.author)}"><title>${esc(doc.title)}</title><style>${CSS.replace('__FOOT__', foot)}</style></head><body><div class="page">
<header class="cover">${opt.kindLabel ? `<p class="kind">${esc(opt.kindLabel)}</p>` : ''}<h1>${phHtml(doc.title)}</h1>${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}<p class="by">${by}</p></header>
${body}
${assume}${notes}${srcs}
</div></body></html>`;
}
