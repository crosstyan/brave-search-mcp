#!/usr/bin/env node

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as http from 'node:http';
import process from 'node:process';
import { startServer } from './server-utils.js';
import { BraveMcpServer } from './server.js';

function configureProxyFromEnv(): void {
  const hasProxyEnv = [
    process.env.HTTP_PROXY,
    process.env.HTTPS_PROXY,
    process.env.http_proxy,
    process.env.https_proxy,
  ].some(value => typeof value === 'string' && value.trim().length > 0);

  if (!hasProxyEnv) {
    return;
  }

  const setGlobalProxyFromEnv = (http as typeof http & {
    setGlobalProxyFromEnv?: () => void;
  }).setGlobalProxyFromEnv;

  if (typeof setGlobalProxyFromEnv === 'function') {
    setGlobalProxyFromEnv();
    return;
  }

  console.warn('Warning: HTTP_PROXY/HTTPS_PROXY is set, but this Node runtime does not support env-based global proxy configuration.');
}

function getBraveApiKeys(): string[] {
  return [process.env.BRAVE_API_KEY, process.env.BRAVE_API_KEYS]
    .filter((value): value is string => typeof value === 'string')
    .flatMap(value => value.split(/[,\n]/))
    .map(value => value.trim())
    .filter(Boolean);
}

function createServer(): McpServer {
  const braveApiKeys = [...new Set(getBraveApiKeys())];
  if (braveApiKeys.length === 0) {
    console.error('Error: BRAVE_API_KEY or BRAVE_API_KEYS environment variable is required');
    process.exit(1);
  }
  const isUI = process.argv.includes('--ui');
  const braveApiKeyConfig = braveApiKeys.length === 1 ? braveApiKeys[0] : braveApiKeys;
  return new BraveMcpServer(braveApiKeyConfig, isUI).serverInstance;
}

const isHttp = process.argv.includes('--http');

configureProxyFromEnv();

startServer(createServer, isHttp).catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
