// Runs tests/search.unit.ts: bundles it with esbuild (Vite's own copy) into a temp file and runs it in node.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'searchtest-')), out = join(dir, 'search.unit.mjs');
try {
  await build({ entryPoints: [new URL('../tests/search.unit.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } });
  await import(pathToFileURL(out).href);
  // R3 / B11: questions in words open the page that answers them (the saver's door lists them)
  const out2 = join(dir, 'ask.mjs'), so = new URL('../src/lib/searchOmni.ts', import.meta.url).pathname;
  await build({ stdin: { contents: `export { askItems, buildPool, forDoor, rank, yearAsk } from '${so}';`, resolveDir: dir }, bundle: true, format: 'esm', platform: 'node', outfile: out2, logLevel: 'error', define: { 'import.meta.env.BASE_URL': '"/"' } });
  const { buildPool, forDoor, rank, yearAsk } = await import(pathToFileURL(out2).href);
  const pool = buildPool([], ['מגדל'], [['מגדל מקפת אישית כללי', 'מגדל', 'p2102', 'כללי', 'פנסיה מקיפה'], ['מגדל מקפת אישית מניות', 'מגדל', 'p2142', 'מניות', 'פנסיה מקיפה'], ['מגדל השתלמות כללי', 'מגדל', 'g4001', 'כללי', 'השתלמות']], [], []);
  const ctx = { asof: 202610, mine: [] };
  const firstFn = (q, c = ctx) => forDoor(rank(q, pool, (x) => x, null, c), 'saver').find((x) => x.kind === 'פונקציה');
  let bad = 0;
  const eq = (what, got, want) => { if (got !== want) { bad++; console.error(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
  let f = firstFn('מי הכי טוב בפנסיה'); const u = new URL(f.to, 'http://x');
  eq('who-best path', u.pathname, '/funds/screen'); eq('who-best prod', u.searchParams.get('prod'), 'פנסיה מקיפה'); eq('who-best per', u.searchParams.get('per'), 'm1'); eq('who-best label', f.label, 'דירוג המסלולים: פנסיה כללי');
  eq('who-best hishtalmut prod', new URL(firstFn('מי הכי טוב בהשתלמות').to, 'http://x').searchParams.get('prod'), 'השתלמות');
  eq('who-best is first of all items', forDoor(rank('מי הכי טוב בפנסיה', pool, (x) => x, null, ctx), 'saver')[0].to.startsWith('/funds/screen?prod='), true);
  for (const q of ['מסלולים', 'כל המסלולים', 'דירוג']) { const g = firstFn(q); eq(`"${q}" opens the screener first`, g && g.to.split('?')[0], '/funds/screen'); eq(`"${q}" has no per`, new URL(g.to, 'http://x').searchParams.has('per'), false); }
  eq('mine decides the product of "מסלולים"', new URL(firstFn('מסלולים', { ...ctx, mine: [{ prod: 'השתלמות', track: 'כללי' }] }).to, 'http://x').searchParams.get('prod'), 'השתלמות');
  for (const q of ['מה קרה החודש', 'החודש']) eq(`"${q}" → the hub`, firstFn(q) && firstFn(q).to, '/funds');
  eq('hub line names the month', firstFn('החודש').sub, 'מה קרה באוקטובר');
  for (const q of ['כמה אני משלם', 'כמה אנחנו משלמים', 'כמה עולה לי', 'משלם בשנה', 'דמי ניהול']) eq(`"${q}" → the fees tool`, firstFn(q) && firstFn(q).to, '/funds/tools/fees');
  eq('the fees tool is listed once', rank('דמי ניהול', pool, (x) => x, null, ctx).filter((x) => x.to === '/funds/tools/fees').length, 1);
  eq('no question, no answer item', rank('מגדל', pool, (x) => x, null, ctx).some((x) => x.saver), false);
  eq('year words', JSON.stringify(yearAsk('מגדל פנסיה בשנה האחרונה')), JSON.stringify({ q: 'מגדל פנסיה', year: true }));
  eq('12 months', yearAsk('מגדל פנסיה 12 חודשים').q, 'מגדל פנסיה'); eq('no year words', yearAsk('מגדל פנסיה').year, false);
  eq('number typed in full leads', rank('2102', pool, (x) => x, null, ctx)[0].to, '/funds/p2102');
  eq('number typed in part finds the tracks', rank('210', pool, (x) => x, null, ctx).some((x) => x.to === '/funds/p2102'), true);
  if (bad) process.exit(1);
  console.log('ask intents: ok');
} finally { rmSync(dir, { recursive: true, force: true }); }
