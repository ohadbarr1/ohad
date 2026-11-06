/* D2 SEO (fox 3.0 wave 3): the head of the page in the browser agrees with the head the server sent.
   scripts/prerender-seo.mjs writes, after the build, a copy of the shell for every saver entry point (a fund track, a company, a moment,
   a question, the letter, ...) with its own <title>, description, canonical and og:*, marked <meta name="fox:route" content="<path>">.
   Here: the head of the page the visitor landed on is kept as sent (so Layout's tab title does not replace it), and after an in-app
   navigation the same head is read from that page's prerendered file (one small request per address, production only), so the title,
   description and canonical never depend on how the visitor arrived. Every address gets its canonical (without the query) and the
   private ones (the visitor's own products, client folders, drafts, utilities) a noindex, as firebase.json's X-Robots-Tag rules do. */

export const SITE = 'https://fox-research-il.web.app';
/** index.html's description: the shell serves every address that has no prerendered file */
export const DEFAULT_DESC = 'תשואה נטו ודמי ניהול של כל מסלולי הפנסיה, הגמל, ההשתלמות והפוליסות בישראל, ונתוני המבטחות ומנהלי החיסכון. כל מספר עם המקור שלו.';

/** the private, draft and utility routes: noindex here and in firebase.json (scripts/hosting-check.mjs checks the header side) */
const PRIVATE = /^\/(?:my|book|feebook|search|nowcast|fragility|data\/autopilot|(?:clients|brief|positions|consolidation)(?:\/.*)?|doc\/.+)$/;
/** the addresses scripts/prerender-seo.mjs writes a file for (anything else is the shell: no request) */
const PRERENDERED = /^\/(?:funds\/[gip]\d+|funds\/(?:default|compare|tools\/fees)|company\/[a-z_]+|my\/(?:moment(?:\/[a-z]+)?|statement|checkup)|savings|about|methodology|questions(?:\/Q-\d+)?|flows\/letter\/\d{6}|funds\/under|feed|card\/[a-z_]+\/\d{4}(?:Q[1-4]|FY))$/;

interface Head { title: string; desc: string }
const norm = (p: string) => p.replace(/\/+$/, '') || '/';
export const isPrivatePath = (p: string) => PRIVATE.test(norm(p));

const cache = new Map<string, Head | null>();
// the page the server sent (read once, before React renders and Layout sets the tab title)
if (typeof document !== 'undefined') {
  const sent = document.querySelector('meta[name="fox:route"]')?.getAttribute('content');
  if (sent && norm(sent) === norm(location.pathname))
    cache.set(norm(sent), { title: document.title, desc: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? DEFAULT_DESC });
}

/** the prerendered title of an address, once known (the landing page at once; another page after its file was read) */
export const headTitle = (path: string): string | undefined => cache.get(norm(path))?.title;

function tag(sel: string, make: () => HTMLElement): HTMLElement {
  return document.head.querySelector<HTMLElement>(sel) ?? document.head.appendChild(make());
}
const meta = (attr: 'name' | 'property', key: string, content: string) =>
  tag(`meta[${attr}="${key}"]`, () => { const m = document.createElement('meta'); m.setAttribute(attr, key); return m; }).setAttribute('content', content);

function apply(p: string, h: Head | null | undefined) {
  const desc = h?.desc ?? DEFAULT_DESC;
  meta('name', 'description', desc);
  meta('property', 'og:title', h?.title ?? document.title);
  meta('property', 'og:description', desc);
  meta('property', 'og:url', SITE + p);
  tag('link[rel="canonical"]', () => { const l = document.createElement('link'); l.rel = 'canonical'; return l; }).setAttribute('href', SITE + p);
  const robots = document.head.querySelector('meta[name="robots"]');
  if (isPrivatePath(p)) meta('name', 'robots', 'noindex, nofollow');
  else robots?.remove();
}

/** Layout calls this after it sets the tab title, on every address change */
export function syncHead(pathname: string) {
  const p = norm(pathname);
  const h = cache.get(p);
  apply(p, h);
  if (h !== undefined || !import.meta.env.PROD || !PRERENDERED.test(p)) return;
  cache.set(p, null);  // one request per address
  fetch(p, { headers: { accept: 'text/html' } })
    .then((r) => (r.ok ? r.text() : ''))
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (doc.querySelector('meta[name="fox:route"]')?.getAttribute('content') !== p) return;  // the plain shell: nothing prerendered here
      const head = { title: doc.title, desc: doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? DEFAULT_DESC };
      cache.set(p, head);
      if (norm(location.pathname) === p) { document.title = head.title; apply(p, head); }
    })
    .catch(() => {});
}
