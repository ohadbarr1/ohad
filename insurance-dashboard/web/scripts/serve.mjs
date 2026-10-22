// The built site served the way Firebase Hosting serves it: files as they are, any other path falls back to index.html.
// usage: node scripts/serve.mjs <dir> [port=4173]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { readFileSync } from 'node:fs';

// the headers firebase.json gives every path (CSP and the rest), so a local check runs under the live policy
const HEADERS = Object.fromEntries((JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url))).hosting.headers.find((h) => h.source === '**')?.headers ?? []).map((h) => [h.key, h.value]));

const [dir = 'dist', port = '4173'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.ics': 'text/calendar; charset=utf-8' };
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(dir, path);
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(dir, 'index.html'); }
  try { const body = await readFile(file); res.writeHead(200, { ...HEADERS, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(+port, '127.0.0.1', () => console.log(`serving ${dir} on http://127.0.0.1:${port}`));
