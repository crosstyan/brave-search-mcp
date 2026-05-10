import type { FeatureConfig } from './config-loader.js';
import type { LocalWebFallbackExecutor, ToolInterceptor, ToolLogger } from './tools/tool-helpers.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BraveSearch } from 'brave-search';
import packageJson from '../package.json' with { type: 'json' };
import { createDefaultFeatureConfig } from './config-loader.js';
import { loadPolicyRulesSync } from './policy-loader.js';
import { registerUiSearchTools } from './server-ui.js';
import { AuditLoggingInterceptor } from './tools/AuditLoggingInterceptor.js';
import { BraveImageSearchTool } from './tools/BraveImageSearchTool.js';
import { BraveLLMContextSearchTool } from './tools/BraveLLMContextSearchTool.js';
import { BraveLocalSearchTool } from './tools/BraveLocalSearchTool.js';
import { BraveNewsSearchTool } from './tools/BraveNewsSearchTool.js';
import { BraveVideoSearchTool } from './tools/BraveVideoSearchTool.js';
import { BraveWebSearchTool } from './tools/BraveWebSearchTool.js';
import { QueryPolicyInterceptor } from './tools/QueryPolicyInterceptor.js';
import { buildToolErrorResult, executeTool } from './tools/tool-helpers.js';
import { UsageGuardrailInterceptor } from './tools/UsageGuardrailInterceptor.js';

const DIST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const { version: SERVER_VERSION } = packageJson;

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

interface StandardToolRegistrationTarget {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (input: never) => Promise<unknown>;
}

interface ServerTools {
  image?: BraveImageSearchTool;
  web: BraveWebSearchTool;
  local?: BraveLocalSearchTool;
  news?: BraveNewsSearchTool;
  video?: BraveVideoSearchTool;
  llmContext?: BraveLLMContextSearchTool;
}

export interface BraveApiKeyPoolConfig {
  fullAccessKeys?: string[];
  webSearchKeys?: string[];
}

export interface BraveSearchInstanceConfig {
  fullAccess?: BraveSearch;
  webSearch?: BraveSearch;
}

function getBraveSearchApiKeyConfig(apiKeys: string[]): string | string[] {
  return apiKeys.length === 1 ? apiKeys[0]! : apiKeys;
}

export class BraveMcpServer {
  private server: McpServer;
  private tools: ServerTools;
  private featureConfig: FeatureConfig;

  /**
   * Creates a new BraveMcpServer instance.
   * @param apiKeys - Optional key pools for full-access tools and the public web-search tool
   * @param isUI - Whether to enable UI mode with widget resources
   * @param braveSearchInstances - Optional BraveSearch instances for dependency injection (useful for testing)
   * @param featureConfig - Runtime policy, guardrail, audit, auth, and server configuration
   */
  constructor(
    apiKeys: BraveApiKeyPoolConfig,
    isUI: boolean = false,
    braveSearchInstances?: BraveSearchInstanceConfig,
    featureConfig: FeatureConfig = createDefaultFeatureConfig(),
  ) {
    const hasFullAccessTools = (apiKeys.fullAccessKeys?.length ?? 0) > 0 || Boolean(braveSearchInstances?.fullAccess);
    this.server = new McpServer(
      {
        name: 'Brave Search MCP Server',
        description: hasFullAccessTools
          ? 'A server that provides tools for searching the web, images, videos, and local businesses using the Brave Search API.'
          : 'A server that provides a web search tool using the Brave Search API.',
        version: SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
          logging: {},
        },
      },
    );

    const fullAccessSearch = braveSearchInstances?.fullAccess
      ?? (apiKeys.fullAccessKeys?.length
        ? new BraveSearch(getBraveSearchApiKeyConfig(apiKeys.fullAccessKeys))
        : undefined);
    const webSearch = braveSearchInstances?.webSearch
      ?? (apiKeys.webSearchKeys?.length
        ? new BraveSearch(getBraveSearchApiKeyConfig(apiKeys.webSearchKeys))
        : fullAccessSearch);

    if (!webSearch)
      throw new Error('At least one Brave Search client must be configured');

    this.featureConfig = featureConfig;
    const log: ToolLogger = this.log.bind(this);
    const activeInterceptors = this.buildInterceptors();
    const web = new BraveWebSearchTool(log, webSearch, isUI, activeInterceptors);

    this.tools = { web };

    if (fullAccessSearch) {
      const image = new BraveImageSearchTool(log, fullAccessSearch, isUI, activeInterceptors);
      const fullAccessWeb = new BraveWebSearchTool(log, fullAccessSearch, isUI, activeInterceptors);
      const executeWebFallback: LocalWebFallbackExecutor = input =>
        executeTool({
          toolName: fullAccessWeb.name,
          input,
          executeCore: value => fullAccessWeb.executeCore(value),
          buildErrorResult: (_value, error) => buildToolErrorResult(fullAccessWeb.name, error),
          interceptors: activeInterceptors,
          isFallback: true,
        });
      const local = new BraveLocalSearchTool(log, fullAccessSearch, executeWebFallback, isUI, activeInterceptors);
      const news = new BraveNewsSearchTool(log, fullAccessSearch, isUI, activeInterceptors);
      const video = new BraveVideoSearchTool(log, fullAccessSearch, isUI, activeInterceptors);
      const llmContext = new BraveLLMContextSearchTool(log, fullAccessSearch, isUI, activeInterceptors);

      this.tools = { image, web, local, news, video, llmContext };
    }

    this.registerConfiguredTools(isUI);
  }

  private buildInterceptors(): readonly ToolInterceptor[] {
    const interceptors: ToolInterceptor[] = [];
    const policyFile = this.featureConfig.policy.file;
    if (policyFile) {
      const rules = loadPolicyRulesSync(policyFile);
      interceptors.push(new QueryPolicyInterceptor(rules, this.featureConfig.policy.redact));
    }
    const requestLimit = this.featureConfig.guardrail.requestLimit;
    if (requestLimit !== undefined) {
      interceptors.push(new UsageGuardrailInterceptor({
        requestLimit,
        windowMs: this.featureConfig.guardrail.windowSeconds * 1000,
        cooldownMs: this.featureConfig.guardrail.cooldownSeconds * 1000,
      }));
    }
    const auditLoggingEnabled = this.featureConfig.audit.enabled;
    const requireJustification = this.featureConfig.guardrail.requireJustification;
    if (auditLoggingEnabled || requireJustification) {
      interceptors.push(new AuditLoggingInterceptor({
        auditLoggingEnabled,
        logRawInputs: this.featureConfig.audit.logRaw,
        requireJustification,
      }));
    }
    return interceptors;
  }

  private registerConfiguredTools(isUI: boolean): void {
    if (isUI) {
      const uiTools = {
        web: this.tools.web,
        ...(this.tools.image ? { image: this.tools.image } : {}),
        ...(this.tools.local ? { local: this.tools.local } : {}),
        ...(this.tools.news ? { news: this.tools.news } : {}),
        ...(this.tools.video ? { video: this.tools.video } : {}),
      };
      registerUiSearchTools({
        server: this.server,
        distDir: DIST_DIR,
        log: this.log.bind(this),
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
        tools: uiTools,
      });
      if (this.tools.llmContext)
        this.registerStandardTool(this.tools.llmContext);
      return;
    }

    for (const tool of this.getStandardTools())
      this.registerStandardTool(tool);
  }

  private getStandardTools(): StandardToolRegistrationTarget[] {
    return [
      ...(this.tools.image ? [this.tools.image] : []),
      this.tools.web,
      ...(this.tools.local ? [this.tools.local] : []),
      ...(this.tools.news ? [this.tools.news] : []),
      ...(this.tools.video ? [this.tools.video] : []),
      ...(this.tools.llmContext ? [this.tools.llmContext] : []),
    ];
  }

  private registerStandardTool(tool: StandardToolRegistrationTarget): void {
    this.server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema as never,
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
      },
      tool.execute.bind(tool) as never,
    );
  }

  public get serverInstance(): McpServer {
    return this.server;
  }

  public log(
    message: string,
    level: 'error' | 'debug' | 'info' | 'notice' | 'warning' | 'critical' | 'alert' | 'emergency' = 'info',
  ): void {
    this.server.server.sendLoggingMessage({ level, data: message });
  }
}
