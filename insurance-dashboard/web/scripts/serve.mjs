// The built site served the way Firebase Hosting serves it (rules from firebase.json via scripts/hosting.mjs): an existing file as it is,
// with cleanUrls the extensionless path's .html file (and a .html request redirected to its clean address), a directory's own index.html, otherwise the first matching rewrite (extensionless paths -> /index.html), otherwise a real 404.
// Every response carries the headers firebase.json gives its request path (CSP, Cache-Control), 404s included, as on Hosting.
// usage: node scripts/serve.mjs <dir> [port=4173]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { headersFor, loadHosting, rewriteFor } from './hosting.mjs';

const HOSTING = loadHosting();
const [dir = 'dist', port = '4173'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain',
  '.ics': 'text/calendar; charset=utf-8', '.xml': 'application/xml', '.atom': 'application/atom+xml', '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.gz': 'application/gzip' };
const isFile = (f) => stat(f).then((s) => s.isFile(), () => false);

async function resolve(path) {
  const file = join(dir, path);
  if (await isFile(file)) return file;
  // cleanUrls (D2 SEO): /funds/p2009 is served from funds/p2009.html, the prerendered head of that page
  if (HOSTING.cleanUrls && !extname(path) && await isFile(file + '.html')) return file + '.html';
  if (await isFile(join(file, 'index.html'))) return join(file, 'index.html');
  const to = rewriteFor(HOSTING, path);
  return to ? join(dir, to) : null;
}

createServer(async (req, res) => {
  const path = '/' + normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const headers = headersFor(HOSTING, path);
  // cleanUrls: a request for the .html file itself is redirected to its clean address, as on Hosting
  if (HOSTING.cleanUrls && path.endsWith('.html') && await isFile(join(dir, path))) {
    res.writeHead(301, { ...headers, location: path === '/index.html' ? '/' : path.slice(0, -5) }); res.end(); return;
  }
  const file = await resolve(path);
  const body = file ? await readFile(file).catch(() => null) : null;
  if (!body) { res.writeHead(404, { ...headers, 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>404</title>Not Found'); return; }
  // a Content-Type that firebase.json sets for the path (the RSS / Atom feeds) wins over the extension's default, as on Hosting
  const { 'Content-Type': ct, ...rest } = headers;
  res.writeHead(200, { ...rest, 'content-type': ct ?? TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(+port, '127.0.0.1', () => console.log(`serving ${dir} on http://127.0.0.1:${port}`));
