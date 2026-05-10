import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  return {
    startServerMock: vi.fn(),
    braveMcpServerMock: vi.fn(),
    setGlobalProxyFromEnvMock: vi.fn(),
  };
});

vi.mock('node:http', () => {
  return {
    setGlobalProxyFromEnv: mockState.setGlobalProxyFromEnvMock,
  };
});

vi.mock('../../src/server-utils.js', () => {
  return {
    startServer: mockState.startServerMock,
  };
});

vi.mock('../../src/server.js', () => {
  return {
    BraveMcpServer: mockState.braveMcpServerMock,
  };
});

async function importIndexModule() {
  await import('../../src/index.js');
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('index entrypoint', () => {
  const originalArgv = [...process.argv];
  const originalApiKey = process.env.BRAVE_API_KEY;
  const originalApiKeys = process.env.BRAVE_API_KEYS;
  const originalWebSearchApiKey = process.env.BRAVE_WEB_SEARCH_API_KEY;
  const originalWebSearchApiKeys = process.env.BRAVE_WEB_SEARCH_API_KEYS;
  const originalHttpProxy = process.env.HTTP_PROXY;
  const originalHttpsProxy = process.env.HTTPS_PROXY;
  const originalHttpProxyLower = process.env.http_proxy;
  const originalHttpsProxyLower = process.env.https_proxy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.argv = ['node', 'index.js'];
    process.env.BRAVE_API_KEY = 'test-api-key';
    delete process.env.BRAVE_API_KEYS;
    delete process.env.BRAVE_WEB_SEARCH_API_KEY;
    delete process.env.BRAVE_WEB_SEARCH_API_KEYS;
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;

    mockState.startServerMock.mockResolvedValue(undefined);
    mockState.braveMcpServerMock.mockImplementation(function (
      this: { serverInstance: McpServer },
      apiKeys: { fullAccessKeys?: string[]; webSearchKeys?: string[] },
      isUI: boolean,
    ) {
      this.serverInstance = { apiKeys, isUI } as unknown as McpServer;
    });
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env.BRAVE_API_KEY = originalApiKey;
    process.env.BRAVE_API_KEYS = originalApiKeys;
    process.env.BRAVE_WEB_SEARCH_API_KEY = originalWebSearchApiKey;
    process.env.BRAVE_WEB_SEARCH_API_KEYS = originalWebSearchApiKeys;
    process.env.HTTP_PROXY = originalHttpProxy;
    process.env.HTTPS_PROXY = originalHttpsProxy;
    process.env.http_proxy = originalHttpProxyLower;
    process.env.https_proxy = originalHttpsProxyLower;
    vi.restoreAllMocks();
  });

  it('passes createServer callback and http flag to startServer', async () => {
    let capturedCreateServer: (() => McpServer) | undefined;
    let capturedHttpFlag: boolean | undefined;
    mockState.startServerMock.mockImplementation((createServer: () => McpServer, isHttp: boolean) => {
      capturedCreateServer = createServer;
      capturedHttpFlag = isHttp;
      return Promise.resolve();
    });
    process.argv = ['node', 'index.js', '--http', '--ui'];

    await importIndexModule();

    expect(mockState.setGlobalProxyFromEnvMock).not.toHaveBeenCalled();
    expect(mockState.startServerMock).toHaveBeenCalledTimes(1);
    expect(capturedHttpFlag).toBe(true);
    expect(capturedCreateServer).toBeTypeOf('function');

    const serverInstance = capturedCreateServer!();
    expect(mockState.braveMcpServerMock).toHaveBeenCalledWith(
      { fullAccessKeys: ['test-api-key'] },
      true,
      undefined,
      expect.any(Object),
    );
    expect(serverInstance).toEqual({
      apiKeys: { fullAccessKeys: ['test-api-key'] },
      isUI: true,
    });
  });

  it('configures the global proxy when HTTP_PROXY is set', async () => {
    process.env.HTTP_PROXY = 'http://127.0.0.1:7890';

    await importIndexModule();

    expect(mockState.setGlobalProxyFromEnvMock).toHaveBeenCalledTimes(1);
  });

  it('passes multiple API keys to BraveMcpServer when configured', async () => {
    let capturedCreateServer: (() => McpServer) | undefined;
    mockState.startServerMock.mockImplementation((createServer: () => McpServer) => {
      capturedCreateServer = createServer;
      return Promise.resolve();
    });
    process.env.BRAVE_API_KEY = 'key-a, key-b';
    process.env.BRAVE_API_KEYS = 'key-b\nkey-c';

    await importIndexModule();

    expect(mockState.setGlobalProxyFromEnvMock).not.toHaveBeenCalled();
    const serverInstance = capturedCreateServer!();
    expect(mockState.braveMcpServerMock).toHaveBeenCalledWith(
      { fullAccessKeys: ['key-a', 'key-b', 'key-c'] },
      false,
      undefined,
      expect.any(Object),
    );
    expect(serverInstance).toEqual({
      apiKeys: { fullAccessKeys: ['key-a', 'key-b', 'key-c'] },
      isUI: false,
    });
  });

  it('passes web-only API keys to BraveMcpServer when configured', async () => {
    let capturedCreateServer: (() => McpServer) | undefined;
    mockState.startServerMock.mockImplementation((createServer: () => McpServer) => {
      capturedCreateServer = createServer;
      return Promise.resolve();
    });
    delete process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEYS;
    process.env.BRAVE_WEB_SEARCH_API_KEY = 'web-key-a, web-key-b';
    process.env.BRAVE_WEB_SEARCH_API_KEYS = 'web-key-b\nweb-key-c';

    await importIndexModule();

    expect(mockState.setGlobalProxyFromEnvMock).not.toHaveBeenCalled();
    const serverInstance = capturedCreateServer!();
    expect(mockState.braveMcpServerMock).toHaveBeenCalledWith(
      { webSearchKeys: ['web-key-a', 'web-key-b', 'web-key-c'] },
      false,
      undefined,
      expect.any(Object),
    );
    expect(serverInstance).toEqual({
      apiKeys: { webSearchKeys: ['web-key-a', 'web-key-b', 'web-key-c'] },
      isUI: false,
    });
  });

  it('passes both key pools to BraveMcpServer when mixed configuration is provided', async () => {
    let capturedCreateServer: (() => McpServer) | undefined;
    mockState.startServerMock.mockImplementation((createServer: () => McpServer) => {
      capturedCreateServer = createServer;
      return Promise.resolve();
    });
    process.env.BRAVE_API_KEY = 'full-key-a, full-key-b';
    process.env.BRAVE_WEB_SEARCH_API_KEY = 'web-key-a';

    await importIndexModule();

    const serverInstance = capturedCreateServer!();
    expect(mockState.braveMcpServerMock).toHaveBeenCalledWith(
      {
        fullAccessKeys: ['full-key-a', 'full-key-b'],
        webSearchKeys: ['web-key-a'],
      },
      false,
      undefined,
      expect.any(Object),
    );
    expect(serverInstance).toEqual({
      apiKeys: {
        fullAccessKeys: ['full-key-a', 'full-key-b'],
        webSearchKeys: ['web-key-a'],
      },
      isUI: false,
    });
  });

  it('logs and exits when no Brave API keys are configured', async () => {
    let capturedCreateServer: (() => McpServer) | undefined;
    mockState.startServerMock.mockImplementation((createServer: () => McpServer) => {
      capturedCreateServer = createServer;
      return Promise.resolve();
    });
    delete process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEYS;
    delete process.env.BRAVE_WEB_SEARCH_API_KEY;
    delete process.env.BRAVE_WEB_SEARCH_API_KEYS;

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await importIndexModule();

    expect(capturedCreateServer).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error: BRAVE_API_KEY, BRAVE_API_KEYS, BRAVE_WEB_SEARCH_API_KEY, or BRAVE_WEB_SEARCH_API_KEYS environment variable is required');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockState.startServerMock).not.toHaveBeenCalled();
    expect(mockState.braveMcpServerMock).not.toHaveBeenCalled();
  });

  it('logs and exits when startServer rejects', async () => {
    const startupError = new Error('startup failed');
    mockState.startServerMock.mockRejectedValue(startupError);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await importIndexModule();

    expect(consoleErrorSpy).toHaveBeenCalledWith(startupError.message);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
