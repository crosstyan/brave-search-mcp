#!/usr/bin/env node

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FeatureConfig } from './config-loader.js';
import type { BraveApiKeyPoolConfig } from './server.js';
import * as http from 'node:http';
import process from 'node:process';
import { validateTransportAuthConfig } from './auth/startup-validation.js';
import { resolveRuntimeConfig } from './config-loader.js';
import { startServer } from './server-utils.js';
import { BraveMcpServer } from './server.js';

interface CliOptions {
  checkConfigPath?: string;
  isHttp: boolean;
  isUI: boolean;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const checkConfigIndex = argv.indexOf('--check-config');
  let checkConfigPath: string | undefined;

  if (checkConfigIndex !== -1) {
    checkConfigPath = argv[checkConfigIndex + 1];
    if (!checkConfigPath || checkConfigPath.startsWith('--'))
      throw new Error('Error: --check-config requires a file path');
  }

  return {
    checkConfigPath,
    isHttp: argv.includes('--http'),
    isUI: argv.includes('--ui'),
  };
}

function configureProxyFromEnv(): void {
  const hasProxyEnv = [
    process.env.HTTP_PROXY,
    process.env.HTTPS_PROXY,
    process.env.http_proxy,
    process.env.https_proxy,
  ].some(value => typeof value === 'string' && value.trim().length > 0);

  if (!hasProxyEnv)
    return;

  const setGlobalProxyFromEnv = (http as typeof http & {
    setGlobalProxyFromEnv?: () => void;
  }).setGlobalProxyFromEnv;

  if (typeof setGlobalProxyFromEnv === 'function') {
    setGlobalProxyFromEnv();
    return;
  }

  console.warn('Warning: HTTP_PROXY/HTTPS_PROXY is set, but this Node runtime does not support env-based global proxy configuration.');
}

function parseApiKeys(values: Array<string | undefined>): string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .flatMap(value => value.split(/[,\n]/))
    .map(value => value.trim())
    .filter(Boolean);
}

function getBraveApiKeyPools(): BraveApiKeyPoolConfig {
  const fullAccessKeys = [...new Set(parseApiKeys([process.env.BRAVE_API_KEY, process.env.BRAVE_API_KEYS]))];
  const webSearchKeys = [...new Set(parseApiKeys([
    process.env.BRAVE_WEB_SEARCH_API_KEY,
    process.env.BRAVE_WEB_SEARCH_API_KEYS,
  ]))];

  return {
    ...(fullAccessKeys.length ? { fullAccessKeys } : {}),
    ...(webSearchKeys.length ? { webSearchKeys } : {}),
  };
}

function createServerFactory(
  apiKeys: BraveApiKeyPoolConfig,
  isUI: boolean,
  featureConfig: FeatureConfig,
): () => McpServer {
  return () => {
    try {
      return new BraveMcpServer(apiKeys, isUI, undefined, featureConfig).serverInstance;
    }
    catch (error) {
      console.error(`Error: Failed to start server: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
      return undefined as never;
    }
  };
}

async function main(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const runtimeConfig = resolveRuntimeConfig({
    env: process.env,
    explicitConfigPath: cliOptions.checkConfigPath,
    warn: message => console.warn(message),
  });

  if (cliOptions.checkConfigPath) {
    console.log(JSON.stringify(runtimeConfig.maskedForDisplay, null, 2));
    return;
  }

  configureProxyFromEnv();

  const braveApiKeyPools = getBraveApiKeyPools();
  if ((braveApiKeyPools.fullAccessKeys?.length ?? 0) === 0 && (braveApiKeyPools.webSearchKeys?.length ?? 0) === 0) {
    console.error('Error: BRAVE_API_KEY, BRAVE_API_KEYS, BRAVE_WEB_SEARCH_API_KEY, or BRAVE_WEB_SEARCH_API_KEYS environment variable is required');
    process.exit(1);
    return;
  }

  if (runtimeConfig.mode === 'file' && runtimeConfig.configPath)
    console.error(`Loaded config file: ${runtimeConfig.configPath}`);

  validateTransportAuthConfig(
    runtimeConfig.featureConfig.auth,
    cliOptions.isHttp,
    message => console.warn(message),
  );

  await startServer(
    createServerFactory(braveApiKeyPools, cliOptions.isUI, runtimeConfig.featureConfig),
    cliOptions.isHttp,
    {
      allowedHosts: runtimeConfig.featureConfig.server.allowedHosts,
      auth: runtimeConfig.featureConfig.auth,
    },
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : `Failed to start MCP server: ${String(error)}`,
  );
  process.exit(1);
});
