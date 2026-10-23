/* Smoke test over the real transport: spawns dist/server.mjs on stdio, lists the tools and calls one. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'fox-smoke', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, 'server.mjs')], stderr: 'ignore' }));
const { tools } = await client.listTools();
const r = await client.callTool({ name: 'figure', arguments: { entity: 'הראל', metric: 'csm', period: "Q2'26" } });
const out = JSON.parse((r.content as { text: string }[])[0].text);
const f = out.facts?.[0];
const ok = tools.length === 9 && f && f.value != null && f.source?.url;
console.log(`smoke: ${tools.length} tools (${tools.map((t) => t.name).join(', ')}) · figure(הראל, csm, Q2'26) = ${f?.display} ${f?.unit} · ${f?.source?.url ?? f?.calc?.formula}`);
await client.close();
process.exit(ok ? 0 : 1);
