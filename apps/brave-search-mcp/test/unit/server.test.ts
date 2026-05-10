import type { BraveSearch } from 'brave-search';
import type { MockBraveSearch } from '../mocks/index.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { BraveMcpServer } from '../../src/server.js';
import { ENABLED_TOOL_NAMES, TOOL_NAMES } from '../../src/tool-catalog.js';
import { createMockBraveSearch } from '../mocks/index.js';

const ALL_UI_RESOURCE_URIS = [
  'ui://brave-image-search/mcp-app.html',
  'ui://brave-image-search/chatgpt-widget.html',
  'ui://brave-news-search/mcp-app.html',
  'ui://brave-news-search/chatgpt-widget.html',
  'ui://brave-video-search/mcp-app.html',
  'ui://brave-video-search/chatgpt-widget.html',
  'ui://brave-web-search/mcp-app.html',
  'ui://brave-web-search/chatgpt-widget.html',
  'ui://brave-local-search/mcp-app.html',
  'ui://brave-local-search/chatgpt-widget.html',
];
const UI_RESOURCES = {
  image: { mcpApp: ALL_UI_RESOURCE_URIS[0], chatgpt: ALL_UI_RESOURCE_URIS[1] },
  news: { mcpApp: ALL_UI_RESOURCE_URIS[2], chatgpt: ALL_UI_RESOURCE_URIS[3] },
  video: { mcpApp: ALL_UI_RESOURCE_URIS[4], chatgpt: ALL_UI_RESOURCE_URIS[5] },
  web: { mcpApp: ALL_UI_RESOURCE_URIS[6], chatgpt: ALL_UI_RESOURCE_URIS[7] },
  local: { mcpApp: ALL_UI_RESOURCE_URIS[8], chatgpt: ALL_UI_RESOURCE_URIS[9] },
};

const { version: SERVER_VERSION } = packageJson;
const allToolNames = ENABLED_TOOL_NAMES;
const UI_TOOL_METADATA_EXPECTATIONS = {
  [TOOL_NAMES.image]: {
    invoking: 'Searching for images…',
    invoked: 'Images found.',
    widgetAccessible: false,
  },
  [TOOL_NAMES.news]: {
    invoking: 'Searching for news…',
    invoked: 'News articles found.',
    widgetAccessible: true,
  },
  [TOOL_NAMES.video]: {
    invoking: 'Searching for videos…',
    invoked: 'Videos found.',
    widgetAccessible: true,
  },
  [TOOL_NAMES.web]: {
    invoking: 'Searching the web…',
    invoked: 'Search complete.',
    widgetAccessible: true,
  },
  [TOOL_NAMES.local]: {
    invoking: 'Searching local businesses…',
    invoked: 'Places found.',
    widgetAccessible: true,
  },
} as const;

describe('braveMcpServer', () => {
  let fullAccessMock: MockBraveSearch;
  let server: BraveMcpServer;
  const CHATGPT_MIME_TYPE = 'text/html+skybridge';
  const UI_RESOURCE_EXPECTATIONS = [
    { uri: UI_RESOURCES.image.mcpApp, mimeType: RESOURCE_MIME_TYPE },
    { uri: UI_RESOURCES.image.chatgpt, mimeType: CHATGPT_MIME_TYPE },
    { uri: UI_RESOURCES.news.mcpApp, mimeType: RESOURCE_MIME_TYPE },
    { uri: UI_RESOURCES.news.chatgpt, mimeType: CHATGPT_MIME_TYPE },
    { uri: UI_RESOURCES.video.mcpApp, mimeType: RESOURCE_MIME_TYPE },
    { uri: UI_RESOURCES.video.chatgpt, mimeType: CHATGPT_MIME_TYPE },
    { uri: UI_RESOURCES.web.mcpApp, mimeType: RESOURCE_MIME_TYPE },
    { uri: UI_RESOURCES.web.chatgpt, mimeType: CHATGPT_MIME_TYPE },
    { uri: UI_RESOURCES.local.mcpApp, mimeType: RESOURCE_MIME_TYPE },
    { uri: UI_RESOURCES.local.chatgpt, mimeType: CHATGPT_MIME_TYPE },
  ] as const;

  beforeEach(() => {
    fullAccessMock = createMockBraveSearch();
    server = new BraveMcpServer(
      { fullAccessKeys: ['fake-api-key'] },
      false,
      { fullAccess: fullAccessMock as unknown as BraveSearch },
    );
  });

  async function createConnectedClient(targetServer: BraveMcpServer): Promise<{
    client: Client;
    close: () => Promise<void>;
  }> {
    const client = new Client({
      name: 'brave-search-mcp-test-client',
      version: '1.0.0',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      targetServer.serverInstance.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    return {
      client,
      close: async () => {
        await Promise.all([
          client.close(),
          targetServer.serverInstance.close(),
        ]);
      },
    };
  }

  describe('full-access configuration', () => {
    it('uses the injected full-access BraveSearch instance when executing tools', async () => {
      const { client, close } = await createConnectedClient(server);

      try {
        await client.callTool({
          name: TOOL_NAMES.web,
          arguments: { query: 'dependency injection query' },
        });
      }
      finally {
        await close();
      }

      expect(fullAccessMock.webSearch).toHaveBeenCalledTimes(1);
      expect(fullAccessMock.webSearch).toHaveBeenCalledWith(
        'dependency injection query',
        expect.objectContaining({ count: 10 }),
      );
    });

    it('registers the full tool set without UI metadata when isUI=false', async () => {
      const { client, close } = await createConnectedClient(server);

      try {
        const toolList = await client.listTools();
        const toolNames = toolList.tools.map(tool => tool.name);

        expect(toolNames).toEqual(expect.arrayContaining(allToolNames));
        expect(toolList.tools).toHaveLength(allToolNames.length);

        for (const tool of toolList.tools) {
          const meta = tool._meta as Record<string, unknown> | undefined;
          const uiMeta = meta?.ui as { resourceUri?: string } | undefined;

          expect(uiMeta?.resourceUri).toBeUndefined();
          expect(meta?.['openai/outputTemplate']).toBeUndefined();
        }
      }
      finally {
        await close();
      }
    });

    it('registers UI resources and UI tool metadata when isUI=true', async () => {
      const uiServer = new BraveMcpServer(
        { fullAccessKeys: ['fake-api-key'] },
        true,
        { fullAccess: fullAccessMock as unknown as BraveSearch },
      );
      const { client, close } = await createConnectedClient(uiServer);

      try {
        const [resourceList, toolList] = await Promise.all([
          client.listResources(),
          client.listTools(),
        ]);
        const resourceUris = resourceList.resources.map(resource => resource.uri);
        const tools = toolList.tools;

        expect(resourceUris).toHaveLength(ALL_UI_RESOURCE_URIS.length);
        expect(resourceUris).toEqual(expect.arrayContaining(ALL_UI_RESOURCE_URIS));
        expect(tools).toHaveLength(allToolNames.length);

        const uiTools = tools.filter((tool) => {
          const meta = tool._meta as Record<string, unknown> | undefined;
          const uiMeta = meta?.ui as { resourceUri?: string } | undefined;
          return typeof uiMeta?.resourceUri === 'string' && typeof meta?.['openai/outputTemplate'] === 'string';
        });
        expect(uiTools).toHaveLength(5);
        expect(uiTools.map(tool => tool.name).sort()).toEqual(
          Object.keys(UI_TOOL_METADATA_EXPECTATIONS).sort(),
        );

        const resourceUriSet = new Set(resourceUris);
        for (const tool of uiTools) {
          const meta = tool._meta as Record<string, unknown> | undefined;
          const ui = meta?.ui as { resourceUri?: string } | undefined;
          const mcpAppUri = ui?.resourceUri;
          const chatgptUri = meta?.['openai/outputTemplate'];
          const expectedMeta = UI_TOOL_METADATA_EXPECTATIONS[
            tool.name as keyof typeof UI_TOOL_METADATA_EXPECTATIONS
          ];

          expect(mcpAppUri).toBeTypeOf('string');
          expect(chatgptUri).toBeTypeOf('string');
          expect(expectedMeta).toBeDefined();
          if (typeof mcpAppUri !== 'string' || typeof chatgptUri !== 'string') {
            throw new TypeError('Expected UI metadata to include tool resource URIs');
          }

          expect(mcpAppUri).toMatch(/^ui:\/\/.+\/mcp-app\.html$/);
          expect(chatgptUri).toMatch(/^ui:\/\/.+\/chatgpt-widget\.html$/);
          expect(resourceUriSet.has(mcpAppUri)).toBe(true);
          expect(resourceUriSet.has(chatgptUri)).toBe(true);
          expect(mcpAppUri.replace(/\/mcp-app\.html$/, '')).toBe(
            chatgptUri.replace(/\/chatgpt-widget\.html$/, ''),
          );
          expect(meta?.['openai/toolInvocation/invoking']).toBe(expectedMeta.invoking);
          expect(meta?.['openai/toolInvocation/invoked']).toBe(expectedMeta.invoked);

          if (expectedMeta.widgetAccessible)
            expect(meta?.['openai/widgetAccessible']).toBe(true);
          else
            expect(meta?.['openai/widgetAccessible']).toBeUndefined();
        }
      }
      finally {
        await close();
      }
    });

    it('returns UI resources for each widget-backed tool', async () => {
      const uiServer = new BraveMcpServer(
        { fullAccessKeys: ['fake-api-key'] },
        true,
        { fullAccess: fullAccessMock as unknown as BraveSearch },
      );
      const { client, close } = await createConnectedClient(uiServer);

      try {
        for (const { uri, mimeType } of UI_RESOURCE_EXPECTATIONS) {
          const result = await client.readResource({ uri });
          const content = result.contents[0];

          expect(result.contents).toHaveLength(1);
          expect(content).toEqual(expect.objectContaining({
            uri,
            mimeType,
            text: expect.any(String),
          }));
          if (!content || !('text' in content)) {
            throw new TypeError(`Expected text resource content for URI "${uri}"`);
          }
          expect(content.text).not.toContain('Missing UI bundle at');
        }
      }
      finally {
        await close();
      }
    });

    it('reports the full server description when full-access tools are available', async () => {
      const { client, close } = await createConnectedClient(server);

      try {
        expect(client.getServerVersion()).toEqual({
          name: 'Brave Search MCP Server',
          description: 'A server that provides tools for searching the web, images, videos, and local businesses using the Brave Search API.',
          version: SERVER_VERSION,
        });
      }
      finally {
        await close();
      }
    });
  });

  describe('web-only configuration', () => {
    it('registers only the web tool when only web-search keys are available', async () => {
      const webOnlyMock = createMockBraveSearch();
      const webOnlyServer = new BraveMcpServer(
        { webSearchKeys: ['web-only-key'] },
        false,
        { webSearch: webOnlyMock as unknown as BraveSearch },
      );
      const { client, close } = await createConnectedClient(webOnlyServer);

      try {
        const toolList = await client.listTools();
        expect(toolList.tools.map(tool => tool.name)).toEqual([TOOL_NAMES.web]);
      }
      finally {
        await close();
      }
    });

    it('registers only the web UI resources in UI mode when full-access tools are unavailable', async () => {
      const webOnlyMock = createMockBraveSearch();
      const webOnlyServer = new BraveMcpServer(
        { webSearchKeys: ['web-only-key'] },
        true,
        { webSearch: webOnlyMock as unknown as BraveSearch },
      );
      const { client, close } = await createConnectedClient(webOnlyServer);

      try {
        const [resourceList, toolList] = await Promise.all([
          client.listResources(),
          client.listTools(),
        ]);

        expect(resourceList.resources.map(resource => resource.uri)).toEqual([
          UI_RESOURCES.web.mcpApp,
          UI_RESOURCES.web.chatgpt,
        ]);
        expect(toolList.tools.map(tool => tool.name)).toEqual([TOOL_NAMES.web]);
      }
      finally {
        await close();
      }
    });

    it('reports the web-only server description when full-access tools are unavailable', async () => {
      const webOnlyMock = createMockBraveSearch();
      const webOnlyServer = new BraveMcpServer(
        { webSearchKeys: ['web-only-key'] },
        false,
        { webSearch: webOnlyMock as unknown as BraveSearch },
      );
      const { client, close } = await createConnectedClient(webOnlyServer);

      try {
        expect(client.getServerVersion()).toEqual({
          name: 'Brave Search MCP Server',
          description: 'A server that provides a web search tool using the Brave Search API.',
          version: SERVER_VERSION,
        });
      }
      finally {
        await close();
      }
    });
  });

  describe('mixed key-pool routing', () => {
    it('routes the public web tool to the web-only client while local fallback stays on the full-access client', async () => {
      const webOnlyMock = createMockBraveSearch();
      const mixedServer = new BraveMcpServer(
        {
          fullAccessKeys: ['full-access-key'],
          webSearchKeys: ['web-only-key'],
        },
        false,
        {
          fullAccess: fullAccessMock as unknown as BraveSearch,
          webSearch: webOnlyMock as unknown as BraveSearch,
        },
      );

      fullAccessMock.webSearch
        .mockResolvedValueOnce({
          query: { original: 'pizza in shanghai', more_results_available: false },
          locations: { results: [] },
          web: { results: [] },
        } as Awaited<ReturnType<MockBraveSearch['webSearch']>>)
        .mockResolvedValueOnce({
          query: { original: 'pizza in shanghai', more_results_available: false },
          web: {
            results: [
              {
                title: 'Fallback result',
                url: 'https://example.com/fallback',
                description: 'Fallback description',
                meta_url: {
                  netloc: 'example.com',
                  hostname: 'example.com',
                },
              },
            ],
          },
        } as Awaited<ReturnType<MockBraveSearch['webSearch']>>);

      const { client, close } = await createConnectedClient(mixedServer);

      try {
        await client.callTool({
          name: TOOL_NAMES.web,
          arguments: { query: 'web-only route check' },
        });
        await client.callTool({
          name: TOOL_NAMES.local,
          arguments: { query: 'pizza in shanghai' },
        });
      }
      finally {
        await close();
      }

      expect(webOnlyMock.webSearch).toHaveBeenCalledTimes(1);
      expect(webOnlyMock.webSearch).toHaveBeenCalledWith(
        'web-only route check',
        expect.objectContaining({ count: 10 }),
      );
      expect(fullAccessMock.webSearch).toHaveBeenCalledTimes(2);
      expect(fullAccessMock.webSearch).toHaveBeenNthCalledWith(
        1,
        'pizza in shanghai',
        expect.objectContaining({ result_filter: 'locations' }),
      );
      expect(fullAccessMock.webSearch).toHaveBeenNthCalledWith(
        2,
        'pizza in shanghai',
        expect.objectContaining({ count: 10 }),
      );
    });
  });
});
