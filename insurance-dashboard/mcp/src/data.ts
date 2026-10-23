/* Where the published data is read from. The site's loaders (useData.load, search.ts, lens.ts…) fetch `<BASE_URL>data/<path>`; the bundle sets
   BASE_URL to the private origin below, and this module answers it: from the local `web/public/data` by default, or from the live site
   when FOX_DATA_URL is set (e.g. https://fox-research-il.web.app/data/). Nothing else is ever fetched. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGIN = 'http://fox.data/data/';
export const SITE = 'https://fox-research-il.web.app';

const here = dirname(fileURLToPath(import.meta.url));
/** dist/ sits in mcp/, so the site's data is ../../web/public/data from the bundle */
export const DATA_DIR = resolve(process.env.FOX_DATA_DIR ?? resolve(here, '../../web/public/data'));
export const DATA_URL = (process.env.FOX_DATA_URL ?? '').replace(/\/?$/, (process.env.FOX_DATA_URL ? '/' : ''));

const TYPES: Record<string, string> = { json: 'application/json', bin: 'application/octet-stream', ics: 'text/calendar' };
const real = globalThis.fetch.bind(globalThis);

async function serve(path: string): Promise<Response> {
  const clean = decodeURIComponent(path.split('?')[0]);
  if (DATA_URL) return real(DATA_URL + clean, { headers: { 'user-agent': 'fox-mcp (read-only research client)' } });
  const file = resolve(DATA_DIR, clean);
  if (!file.startsWith(DATA_DIR + sep)) return new Response('forbidden', { status: 403 });
  try {
    const buf = await readFile(file);
    return new Response(buf, { status: 200, headers: { 'content-type': TYPES[clean.split('.').pop() ?? ''] ?? 'application/octet-stream' } });
  } catch {
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
}

let installed = false;
/** Routes the site's data requests to the data source. Any other request is refused: the server makes no outside calls of its own. */
export function installFetch(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(ORIGIN)) return serve(url.slice(ORIGIN.length));
    throw new Error(`fox-mcp: outside request refused (${url.slice(0, 80)})`);
  }) as typeof fetch;
}

/** A data file as JSON, through the same route. */
export async function json<T>(path: string): Promise<T> {
  const r = await globalThis.fetch(ORIGIN + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}
