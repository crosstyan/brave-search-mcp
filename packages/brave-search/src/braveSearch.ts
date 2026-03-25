// Copyright (C) 2024 Erik Balfe
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import type {
  BraveSearchOptions,
  ImageSearchApiResponse,
  ImageSearchOptions,
  LLMContextApiResponse,
  LLMContextOptions,
  LocalDescriptionsSearchApiResponse,
  LocalPoiSearchApiResponse,
  NewsSearchApiResponse,
  NewsSearchOptions,
  PollingOptions,
  SummarizerOptions,
  SummarizerSearchApiResponse,
  VideoSearchApiResponse,
  VideoSearchOptions,
  WebSearchApiResponse,
} from './types.js';

const DEFAULT_POLLING_INTERVAL = 500;
const DEFAULT_MAX_POLL_ATTEMPTS = 20;
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_RATE_LIMIT_RETRY_DELAY_MS = 10000;

/**
 * An error class specific to BraveSearch API interactions.
 * It includes additional information about the response data that caused the error.
 */
export class BraveSearchError extends Error {
  public responseData: any;

  /**
   * Initializes a new instance of the BraveSearchError class.
   * @param message The error message.
   * @param responseData The response data that caused the error.
   */
  constructor(message: string, responseData?: any) {
    super(message);
    this.name = 'BraveSearchError';
    this.responseData = responseData;
  }
}

/**
 * The main class for interacting with the Brave Search API, holding API key for all the requests made with it.
 * It provides methods for web search, image search, local POI search, and summarization.
 */
export class BraveSearch {
  private apiKeys: string[];
  private baseUrl = 'https://api.search.brave.com/res/v1';
  private pollInterval: number;
  private maxPollAttempts: number;
  private maxRateLimitRetries: number;
  private rateLimitRetryDelayMs: number;
  private maxRateLimitRetryDelayMs: number;
  private nextApiKeyIndex = 0;

  /**
   * Initializes a new instance of the BraveSearch class.
   * @param apiKey One API key or a list of API keys for accessing the Brave Search API.
   * When multiple keys are provided, requests rotate across them.
   * @param options
   */
  constructor(apiKey: string | string[], options?: PollingOptions) {
    this.apiKeys = this.normalizeApiKeys(apiKey);
    this.pollInterval = options?.pollInterval ?? DEFAULT_POLLING_INTERVAL;
    this.maxPollAttempts = options?.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
    this.maxRateLimitRetries = options?.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES;
    this.rateLimitRetryDelayMs = options?.rateLimitRetryDelayMs ?? DEFAULT_RATE_LIMIT_RETRY_DELAY_MS;
    this.maxRateLimitRetryDelayMs = options?.maxRateLimitRetryDelayMs ?? DEFAULT_MAX_RATE_LIMIT_RETRY_DELAY_MS;
  }

  /**
   * Performs a web search using the provided query and options.
   * @param query The search query string.
   * @param options Optional settings to configure the search behavior.
   * @returns A promise that resolves to the search results.
   */
  async webSearch(
    query: string,
    options: BraveSearchOptions = {},
    signal?: AbortSignal,
  ): Promise<WebSearchApiResponse> {
    return this.getJson<WebSearchApiResponse>(
      `${this.baseUrl}/web/search`,
      { q: query, ...this.formatOptions(options) },
      signal,
    );
  }

  /**
   * Performs an image search using the provided query and options.
   * @param query The search query string.
   * @param options Optional settings to configure the search behavior.
   * @returns A promise that resolves to the image search results.
   */
  async imageSearch(
    query: string,
    options: ImageSearchOptions = {},
    signal?: AbortSignal,
  ): Promise<ImageSearchApiResponse> {
    return this.getJson<ImageSearchApiResponse>(
      `${this.baseUrl}/images/search`,
      { q: query, ...this.formatOptions(options) },
      signal,
    );
  }

  async newsSearch(
    query: string,
    options: NewsSearchOptions = {},
    signal?: AbortSignal,
  ): Promise<NewsSearchApiResponse> {
    return this.getJson<NewsSearchApiResponse>(
      `${this.baseUrl}/news/search`,
      { q: query, ...this.formatOptions(options) },
      signal,
    );
  }

  async videoSearch(
    query: string,
    options: VideoSearchOptions = {},
    signal?: AbortSignal,
  ): Promise<VideoSearchApiResponse> {
    return this.getJson<VideoSearchApiResponse>(
      `${this.baseUrl}/videos/search`,
      { q: query, ...this.formatOptions(options) },
      signal,
    );
  }

  /**
   * Executes a web search for the provided query and polls for a summary
   * if the query is eligible for a summary and summarizer key is provided in the web search response.
   * The summary is usually ready within 2 seconds after the original web search response is received.
   * @param query The search query string.
   * @param options Optional settings to configure the search behavior.
   * @param summarizerOptions Optional settings specific to summarization.
   * @returns An object containing promises for the web search results and the summarized answer.
   */
  getSummarizedAnswer(
    query: string,
    options: Omit<BraveSearchOptions, 'summary'> = {},
    summarizerOptions: SummarizerOptions = {},
    signal?: AbortSignal,
  ): {
    summary: Promise<SummarizerSearchApiResponse | undefined>;
    webSearch: Promise<WebSearchApiResponse>;
  } {
    try {
      const webSearchResponse = this.webSearch(query, options, signal);
      const summaryPromise = webSearchResponse.then(async (webSearchResponse) => {
        const summarizerKey = webSearchResponse.summarizer?.key;

        if (summarizerKey) {
          return await this.pollForSummary(summarizerKey, summarizerOptions, signal);
        }

        return undefined;
      });

      return { webSearch: webSearchResponse, summary: summaryPromise };
    }
    catch (error) {
      throw this.handleApiError(error);
    }
  }

  /**
   * Retrieves pre-extracted web content optimized for AI agents, LLM grounding,
   * and RAG pipelines.
   * @param query The search query string. Maximum 400 characters and 50 words.
   * @param options Optional settings to configure the LLM context request.
   * @param signal Optional AbortSignal to cancel the request.
   * @returns A promise that resolves to the LLM context results.
   */
  async llmContextSearch(
    query: string,
    options: LLMContextOptions = {},
    signal?: AbortSignal,
  ): Promise<LLMContextApiResponse> {
    return this.getJson<LLMContextApiResponse>(
      `${this.baseUrl}/llm/context`,
      { q: query, ...this.formatOptions(options) },
      signal,
    );
  }

  /**
   * Searches for local points of interest using the provided IDs and options.
   * @param ids The IDs of the local points of interest.
   * @returns A promise that resolves to the search results.
   */
  async localPoiSearch(ids: string[], signal?: AbortSignal): Promise<LocalPoiSearchApiResponse> {
    const url = `${this.baseUrl}/local/pois?${this.formatIdsQuery(ids)}`;
    try {
      return await this.requestJson<LocalPoiSearchApiResponse>(url, signal);
    }
    catch (error) {
      throw this.handleApiError(error);
    }
  }

  /**
   * Retrieves descriptions for local points of interest using the provided IDs and options.
   * @param ids The IDs of the local points of interest.
   * @returns A promise that resolves to the search results.
   */
  async localDescriptionsSearch(
    ids: string[],
    signal?: AbortSignal,
  ): Promise<LocalDescriptionsSearchApiResponse> {
    const url = `${this.baseUrl}/local/descriptions?${this.formatIdsQuery(ids)}`;
    try {
      return await this.requestJson<LocalDescriptionsSearchApiResponse>(url, signal);
    }
    catch (error) {
      throw this.handleApiError(error);
    }
  }

  /**
   * Polls for a summary response after a web search request. This method is suggested by the Brave Search API documentation
   * as the way to retrieve a summary after initiating a web search.
   *
   * @param key The key identifying the summary request.
   * @param options Optional settings specific to summarization.
   * @param signal Optional AbortSignal to cancel the request.
   * @returns A promise that resolves to the summary response if available, or undefined if the summary is not ready.
   * @throws {BraveSearchError} If the summary generation fails or if the summary is not available after maximum polling attempts.
   *
   * **Polling Behavior:**
   * - The method will make up to 20 attempts to fetch the summary by default.
   * - Each attempt is spaced 500ms apart.
   * - If the summary is not ready after 20 attempts, a BraveSearchError is thrown.
   *
   * **Configuration:**
   * - The number of attempts and the interval between attempts can be configured through the class constructor options.
   */
  private async pollForSummary(
    key: string,
    options: SummarizerOptions,
    signal?: AbortSignal,
  ): Promise<SummarizerSearchApiResponse | undefined> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      const summaryResponse = await this.summarizerSearch(key, options, signal);

      if (summaryResponse.status === 'complete' && summaryResponse.summary) {
        return summaryResponse;
      }
      else if (summaryResponse.status === 'failed') {
        throw new BraveSearchError('Summary generation failed');
      }

      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }

    throw new BraveSearchError('Summary not available after maximum polling attempts');
  }

  private async summarizerSearch(
    key: string,
    options: SummarizerOptions,
    signal?: AbortSignal,
  ): Promise<SummarizerSearchApiResponse> {
    return this.getJson<SummarizerSearchApiResponse>(
      `${this.baseUrl}/summarizer/search`,
      { key, ...this.formatOptions(options) },
      signal,
    );
  }

  /**
   * Performs a GET request to the given URL with query params and returns parsed JSON.
   */
  private async getJson<T>(
    url: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    const fullUrl = `${url}?${new URLSearchParams(params)}`;
    try {
      return await this.requestJson<T>(fullUrl, signal);
    }
    catch (error) {
      throw this.handleApiError(error);
    }
  }

  private async requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    const requestStartIndex = this.getNextApiKeyStartIndex();

    for (let attempt = 0; ; attempt++) {
      const apiKey = this.getApiKeyForAttempt(requestStartIndex, attempt);
      const response = await fetch(url, { headers: this.getHeaders(apiKey), signal });
      if (response.ok) {
        return response.json() as Promise<T>;
      }

      const data = await response.json().catch(() => undefined);
      if (response.status === 429 && attempt < this.maxRateLimitRetries) {
        const retryDelayMs = this.getRateLimitRetryDelayMs(
          response.headers.get('retry-after'),
          attempt,
        );
        await this.sleep(retryDelayMs, signal);
        continue;
      }

      throw this.buildApiError(response.status, response.statusText, data);
    }
  }

  private getHeaders(apiKey: string): Record<string, string> {
    return {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    };
  }

  private formatOptions(options: Record<string, any>): Record<string, string> {
    return Object.entries(options).reduce(
      (acc, [key, value]) => {
        if (value !== undefined) {
          acc[key] = value.toString();
        }
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  private formatIdsQuery(ids: string[]): string {
    return ids.map(id => `ids=${encodeURIComponent(id)}`).join('&');
  }

  private normalizeApiKeys(apiKey: string | string[]): string[] {
    const apiKeys = (Array.isArray(apiKey) ? apiKey : [apiKey])
      .flatMap(value => value.split(/[,\n]/))
      .map(value => value.trim())
      .filter(Boolean);

    if (apiKeys.length === 0) {
      throw new Error('At least one Brave Search API key is required');
    }

    return [...new Set(apiKeys)];
  }

  private getNextApiKeyStartIndex(): number {
    const index = this.nextApiKeyIndex;
    this.nextApiKeyIndex = (this.nextApiKeyIndex + 1) % this.apiKeys.length;
    return index;
  }

  private getApiKeyForAttempt(requestStartIndex: number, attempt: number): string {
    return this.apiKeys[(requestStartIndex + attempt) % this.apiKeys.length]!;
  }

  private getRateLimitRetryDelayMs(retryAfterHeader: string | null, attempt: number): number {
    const retryAfterMs = this.parseRetryAfterMs(retryAfterHeader);
    if (retryAfterMs !== null) {
      return Math.min(retryAfterMs, this.maxRateLimitRetryDelayMs);
    }

    return Math.min(
      this.rateLimitRetryDelayMs * (2 ** attempt),
      this.maxRateLimitRetryDelayMs,
    );
  }

  private parseRetryAfterMs(retryAfterHeader: string | null): number | null {
    if (!retryAfterHeader) {
      return null;
    }

    const retryAfterSeconds = Number(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds)) {
      return Math.max(0, retryAfterSeconds * 1000);
    }

    const retryAt = Date.parse(retryAfterHeader);
    if (Number.isNaN(retryAt)) {
      return null;
    }

    return Math.max(0, retryAt - Date.now());
  }

  private async sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (delayMs <= 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const onAbort = () => {
        if (timeout)
          clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason ?? new Error('Request aborted'));
      };

      timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Builds a BraveSearchError from an HTTP error response.
   */
  private buildApiError(status: number, statusText: string, responseData?: any): BraveSearchError {
    const message = responseData?.message || statusText;
    if (status === 429) {
      return new BraveSearchError(`Rate limit exceeded: ${message}`, responseData);
    }
    else if (status === 401) {
      return new BraveSearchError(`Authentication error: ${message}`, responseData);
    }
    else {
      return new BraveSearchError(`API error (${status}): ${message}`, responseData);
    }
  }

  private handleApiError(error: any): BraveSearchError {
    if (error instanceof BraveSearchError) {
      return error;
    }
    return new BraveSearchError(`Unexpected error: ${error?.message ?? String(error)}`);
  }
}
