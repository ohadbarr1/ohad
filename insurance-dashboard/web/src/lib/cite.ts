/** Citations (lane 2H, ws1 W1-18): one format for every "copy citation", so a figure quoted in an article carries the site, the page,
 *  the data date and the original source. Any page or chart can link to the generator: `<a href={citeHref()}>ציטוט</a>`. */
import { pubLabel } from './format';

export interface Cite { title: string; figure?: string; asof?: string; source?: string; url: string; seen?: string }
export type CiteFormat = 'text' | 'md' | 'html';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "fox · הראל · CSM נטו · נתונים: Q2'26 · מקור: דוחות תקופתיים, MAYA · https://… · נצפה 22.10.26" */
export function citation(c: Cite, f: CiteFormat = 'text'): string {
  const seen = `נצפה ${pubLabel(c.seen ?? new Date().toISOString())}`;
  const parts = [c.figure, c.asof && `נתונים: ${c.asof}`, c.source && `מקור: ${c.source}`].filter(Boolean) as string[];
  if (f === 'md') return [`[fox · ${c.title}](${c.url})`, ...parts, seen].join(' · ');
  if (f === 'html') return [`<a href="${esc(c.url)}">fox · ${esc(c.title)}</a>`, ...parts.map(esc), seen].join(' · ');
  return [`fox · ${c.title}`, ...parts, c.url, seen].join(' · ');
}

/** A link to the citation generator, prefilled with a page (default: the current one) and optionally a figure. */
export function citeHref(path = typeof location !== 'undefined' ? location.pathname + location.search : '/', figure?: string): string {
  const q = new URLSearchParams({ cite: path });
  if (figure) q.set('f', figure);
  return `/data?${q.toString()}#cite`;
}
