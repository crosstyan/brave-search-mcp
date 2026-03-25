import type { BraveSearchError } from 'brave-search';
import { BraveSearch } from 'brave-search';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('braveSearch rate-limit retry', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries a web search after a 429 response and succeeds', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        expect((init?.headers as Record<string, string>)['X-Subscription-Token']).toBe('key-a');
        return new Response(JSON.stringify({ message: 'slow down' }), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '1',
          },
        });
      })
      .mockImplementationOnce(async (_url, init) => {
        expect((init?.headers as Record<string, string>)['X-Subscription-Token']).toBe('key-b');
        return new Response(JSON.stringify({
          type: 'search',
          web: {
            results: [],
          },
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      });

    vi.stubGlobal('fetch', fetchMock);

    const braveSearch = new BraveSearch(['key-a', 'key-b']);
    const responsePromise = braveSearch.webSearch('typescript');

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(responsePromise).resolves.toMatchObject({ type: 'search' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rotates API keys across independent requests', async () => {
    const usedApiKeys: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      usedApiKeys.push((init?.headers as Record<string, string>)['X-Subscription-Token']);
      return new Response(JSON.stringify({
        type: 'search',
        web: {
          results: [],
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const braveSearch = new BraveSearch(['key-a', 'key-b']);
    await braveSearch.webSearch('first');
    await braveSearch.webSearch('second');
    await braveSearch.webSearch('third');

    expect(usedApiKeys).toEqual(['key-a', 'key-b', 'key-a']);
  });

  it('fails after the configured number of 429 retries', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ message: 'limit hit' }), {
        status: 429,
        statusText: 'Too Many Requests',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const braveSearch = new BraveSearch('test-api-key', {
      maxRateLimitRetries: 2,
      rateLimitRetryDelayMs: 0,
    });

    await expect(braveSearch.webSearch('typescript')).rejects.toEqual(
      expect.objectContaining<Partial<BraveSearchError>>({
        name: 'BraveSearchError',
        message: 'Rate limit exceeded: limit hit',
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
