#!/usr/bin/env node
/* fox · Ask fox over MCP (stdio). Read-only tools over the published fox data; no model is called here and nothing is written. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './registry';

// stdout carries the protocol: anything the site's code logs goes to stderr
console.log = (...a: unknown[]) => console.error(...a);
console.info = console.log;

const server: McpServer = buildServer();
await server.connect(new StdioServerTransport());
console.error(`fox-mcp ready · data: ${process.env.FOX_DATA_URL || process.env.FOX_DATA_DIR || 'web/public/data (local)'}`);
