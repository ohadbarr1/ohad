/* The golden set: 20 analyst questions, each answered by tool calls over the MCP protocol (in-process transport), with the expected
   figures and pages checked. No model is involved: the questions document what an assistant should call; the checks pin the answers.
     node dist/eval.mjs                 run eval/golden.json
     node dist/eval.mjs --probe <tool> '<json args>'   print one tool result */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './registry';

console.log = (...a: unknown[]) => process.stdout.write(a.map(String).join(' ') + '\n');
const here = dirname(fileURLToPath(import.meta.url));

interface Check { call?: number; path: string; eq?: unknown; approx?: number; tol?: number; contains?: string; matches?: string; exists?: boolean; min_len?: number }
interface Golden { id: string; q: string; why?: string; calls: { tool: string; args: Record<string, unknown> }[]; checks: Check[] }

/** a.b[0].c · rows[entity=harel].fact.value · rows[0] · steps[metric=csm:nb] */
export function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.match(/[^.[\]]+|\[[^\]]*\]/g) ?? []) {
    if (cur == null) return undefined;
    if (part.startsWith('[')) {
      const inner = part.slice(1, -1);
      const m = /^([\w.]+)=(.*)$/.exec(inner);
      if (m) cur = (cur as unknown[]).find((x) => String(at(x, m[1])) === m[2]);
      else cur = (cur as unknown[])[Number(inner)];
    } else cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

async function connect() {
  const server = buildServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'fox-eval', version: '0.1.0' });
  await client.connect(b);
  return client;
}
async function call(client: Client, tool: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name: tool, arguments: args });
  const text = (r.content as { text: string }[])[0]?.text ?? '{}';
  const out = JSON.parse(text);
  if (r.isError) throw new Error(`${tool}: ${out.error}`);
  return out;
}

const argv = process.argv.slice(2);
const client = await connect();
if (argv[0] === '--probe') {
  const out = await call(client, argv[1], JSON.parse(argv[2] ?? '{}'));
  process.stdout.write(JSON.stringify(out, null, argv.includes('--compact') ? 0 : 1) + '\n', () => process.exit(0));
  await new Promise(() => {});
}

const golden: Golden[] = JSON.parse(readFileSync(join(here, '../eval/golden.json'), 'utf8')).questions;
let pass = 0;
const fails: string[] = [];
const t0 = Date.now();
for (const g of golden) {
  const errs: string[] = [];
  const outs: unknown[] = [];
  try { for (const c of g.calls) outs.push(await call(client, c.tool, c.args)); } catch (e) { errs.push((e as Error).message); }
  if (!errs.length) for (const c of g.checks) {
    const v = at(outs[c.call ?? 0], c.path);
    const show = JSON.stringify(v)?.slice(0, 120);
    if (c.exists !== undefined && (v != null) !== c.exists) errs.push(`${c.path}: exists=${v != null}`);
    if (c.eq !== undefined && JSON.stringify(v) !== JSON.stringify(c.eq)) errs.push(`${c.path} = ${show}, expected ${JSON.stringify(c.eq)}`);
    if (c.approx !== undefined && !(typeof v === 'number' && Math.abs(v - c.approx) <= (c.tol ?? Math.max(0.05, Math.abs(c.approx) * 1e-4)))) errs.push(`${c.path} = ${show}, expected ≈ ${c.approx}`);
    if (c.contains !== undefined && !(typeof v === 'string' && v.includes(c.contains))) errs.push(`${c.path} = ${show}, expected to contain ${c.contains}`);
    if (c.matches !== undefined && !(typeof v === 'string' && new RegExp(c.matches).test(v))) errs.push(`${c.path} = ${show}, expected /${c.matches}/`);
    if (c.min_len !== undefined && !(Array.isArray(v) && v.length >= c.min_len)) errs.push(`${c.path}: length ${Array.isArray(v) ? v.length : '–'} < ${c.min_len}`);
  }
  if (errs.length) { fails.push(`✗ ${g.id} ${g.q}\n    ${errs.join('\n    ')}`); console.log(`✗ ${g.id} ${g.q}`); }
  else { pass++; console.log(`✓ ${g.id} ${g.q}`); }
}
console.log(`\n${pass}/${golden.length} golden questions pass · ${golden.reduce((s, g) => s + g.checks.length, 0)} checks · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (fails.length) console.log('\n' + fails.join('\n'));
await client.close();
process.stdout.write('', () => process.exit(fails.length ? 1 : 0));
