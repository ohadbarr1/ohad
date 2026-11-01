/* S4 · plain text. The email summary (kind 'email') keeps the plan's shape: five lines, one number, one link: the subject, the verdict
   with its number, that number's source line, the as-of and the author, one link to the source document. Several answers: one verdict
   line and one source line each. Any other kind: the whole doc as text, figures numbered [n], the notes and the documents at the end.
   No site name, no link to the site. Left-to-right figures are fenced by direction marks so a Hebrew mail client keeps their sign. */
import type { Doc, Rich } from '../doc';
import { BASIS_HE } from '../answers';
import { basisMix, citeText, citeUrl, exhibitRows, exhibitSourceLine, plainRich, prepare, type Ctx, type Prepared } from './notes';

const figsIn = (r: Rich, P: Prepared) => [...r.text.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((m) => m[1]).filter((id) => P.figs[id]);

function emailTxt(P: Prepared): string {
  const d = P.doc;
  const lines: string[] = [`נושא: ${d.title}`];
  const ps = d.blocks.filter((b): b is Extract<typeof b, { k: 'p' }> => b.k === 'p');
  // the verdicts are the one-number sentences (corridors); the email paragraph (two numbers or more) stays out of the five lines
  const one = ps.filter((p) => figsIn(p.rich, P).length <= 1);
  const verdicts = one.length ? one : ps.slice(0, 1);
  let link: string | null = null;
  for (const p of verdicts) {
    lines.push(plainRich(p.rich, P, { marks: true }));
    const cs = P.notes.filter((n) => figsIn(p.rich, P).includes(n.id)).flatMap((n) => n.cites);
    const docs = [...new Map(cs.map((c) => [citeText(c), c])).values()];
    lines.push(docs.length ? `מקור: ${docs.map(citeText).join('; ')}.` : 'מקור: חישוב, ראו המסמך המלא.');
    link ??= docs.map(citeUrl).find(Boolean) ?? null;
  }
  const mix = basisMix(P);
  lines.push([d.asof ? `נכון ל-${d.asof}` : '', mix, d.author].filter(Boolean).join(' · '));
  link ??= P.sources.map(citeUrl).find(Boolean) ?? null;
  if (link) lines.push(link);
  return lines.join('\n') + '\n';
}

export function docTxt(doc: Doc, ctx: Ctx = {}): string {
  const P = prepare(doc, ctx);
  if (doc.kind === 'email') return emailTxt(P);
  const t = (r: Rich) => plainRich(r, P, { marks: true, nums: true });
  const out: string[] = [doc.title, ...(doc.subtitle ? [doc.subtitle] : []), [doc.author, doc.date, doc.asof ? `נכון ל-${doc.asof}` : ''].filter(Boolean).join(' · '), ''];
  for (const b of doc.blocks) {
    switch (b.k) {
      case 'h': out.push('', b.level === 1 ? `■ ${b.text}` : `${b.text}:`); break;
      case 'p': out.push(t(b.rich)); break;
      case 'callout': out.push(`» ${t(b.rich)}`); break;
      case 'bullets': b.items.forEach((r) => out.push(`• ${t(r)}`)); break;
      case 'point': {
        out.push(`• ${t(b.line)}`);
        if (b.fig && P.figs[b.fig]) { const f = P.figs[b.fig]; out.push(`  המספר: ${f.t}${f.b !== 'actual' ? ` (${BASIS_HE[f.b]})` : ''} [${P.num.get(b.fig)}]`); }
        if (b.comeback) out.push(`  התשובה: ${t(b.comeback)}`);
        break;
      }
      case 'exhibit': {
        out.push('', `מוצג: ${b.ex.title}${b.ex.unit ? ` (${b.ex.unit})` : ''}${b.ex.span ? ` · ${b.ex.span}` : ''}`);
        exhibitRows(b.ex).forEach((r) => out.push(r.join('\t')));
        b.ex.foot.forEach((f, i) => out.push(`(${i + 1}) ${f}`));
        const s = exhibitSourceLine(b.ex, b.figs, ctx);
        if (s) out.push(s);
        if (b.note) out.push(b.note);
        out.push('');
        break;
      }
      case 'table': out.push(b.head.filter(Boolean).join(' | '), ...b.rows.map((r) => r.map((c) => (typeof c === 'string' ? c : t(c))).join(' | ')), ...(b.foot ?? [])); break;
      case 'options':
        b.items.forEach((o) => { out.push(`◆ ${o.name}`); o.pro.forEach((r) => out.push(`  בעד: ${t(r)}`)); o.con.forEach((r) => out.push(`  נגד: ${t(r)}`)); });
        if (b.rec) out.push(`המלצה: ${t(b.rec)}`);
        break;
      case 'pagebreak': out.push('', '———', ''); break;
    }
  }
  if (doc.assumptions?.length) out.push('', '■ יומן הנחות', ...doc.assumptions.map((a) => `• ${a}`));
  if (P.notes.length) out.push('', '■ הערות לנתונים', ...P.notes.map((n) => `[${n.n}] ${n.text}`));
  if (P.sources.length) out.push('', '■ מקורות', ...P.sources.map((c) => { const u = citeUrl(c); return `• ${citeText(c)}${u ? ` · ${u}` : ''}`; }));
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
