// The built site served the way Firebase Hosting serves it (rules from firebase.json via scripts/hosting.mjs): an existing file as it is,
// a directory's own index.html, otherwise the first matching rewrite (extensionless paths -> /index.html), otherwise a real 404.
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
  '.ics': 'text/calendar; charset=utf-8', '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.gz': 'application/gzip' };
const isFile = (f) => stat(f).then((s) => s.isFile(), () => false);

async function resolve(path) {
  const file = join(dir, path);
  if (await isFile(file)) return file;
  if (await isFile(join(file, 'index.html'))) return join(file, 'index.html');
  const to = rewriteFor(HOSTING, path);
  return to ? join(dir, to) : null;
}

createServer(async (req, res) => {
  const path = '/' + normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const headers = headersFor(HOSTING, path);
  const file = await resolve(path);
  const body = file ? await readFile(file).catch(() => null) : null;
  if (!body) { res.writeHead(404, { ...headers, 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>404</title>Not Found'); return; }
  res.writeHead(200, { ...headers, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(+port, '127.0.0.1', () => console.log(`serving ${dir} on http://127.0.0.1:${port}`));
