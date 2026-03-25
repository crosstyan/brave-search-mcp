import { EvalTest, MCPClientManager, TestAgent } from '@mcpjam/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../../src/tool-catalog.js';

const EVAL_MODEL = process.env.EVAL_MODEL ?? 'openai/gpt-5-mini';
const EVAL_API_KEY = process.env.EVAL_API_KEY ?? process.env.OPENAI_API_KEY;
const EVAL_ITERATIONS = Number(process.env.EVAL_ITERATIONS ?? 5);
const EVAL_MULTI_TURN_ITERATIONS = Number(process.env.EVAL_MULTI_TURN_ITERATIONS ?? 5);
const EVAL_CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 2);
const EVAL_MIN_ACCURACY = Number(process.env.EVAL_MIN_ACCURACY ?? 0.8);
const EVAL_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 45_000);
const TEST_TIMEOUT_MS = Number(process.env.EVAL_TEST_TIMEOUT_MS ?? 120_000);
const TEST_SERVER_NAME = 'brave-search-mock';

describe('brave search mcp evals (vitest + openai)', () => {
  let manager: MCPClientManager;
  let agent: TestAgent;

  beforeAll(async () => {
    if (!EVAL_API_KEY) {
      throw new Error('OPENAI_API_KEY (or EVAL_API_KEY) is required for eval tests.');
    }

    manager = new MCPClientManager();
    await manager.connectToServer(TEST_SERVER_NAME, {
      command: 'node',
      args: ['.test-build/test-server.js'],
    });

    agent = new TestAgent({
      tools: await manager.getToolsForAiSdk([TEST_SERVER_NAME]),
      model: EVAL_MODEL,
      apiKey: EVAL_API_KEY,
      systemPrompt: 'You are a helpful assistant with access to Brave MCP tools. Use tools when needed to answer accurately and stay grounded in tool results.',
      maxSteps: 4,
    });
  }, 60_000);

  afterAll(async () => {
    if (manager) {
      await manager.disconnectServer(TEST_SERVER_NAME);
    }
  });

  it(`web search intent routes to ${TOOL_NAMES.web}`, async () => {
    const evalTest = new EvalTest({
      name: 'brave-web-search-routing',
      test: async (evalAgent) => {
        const result = await evalAgent.prompt('I want to see the latest TypeScript release notes and official docs. Can you find them?');
        return result.hasToolCall(TOOL_NAMES.web);
      },
    });

    await evalTest.run(agent, {
      iterations: EVAL_ITERATIONS,
      concurrency: EVAL_CONCURRENCY,
      timeoutMs: EVAL_TIMEOUT_MS,
      onFailure: report => console.error(report),
    });

    expect(evalTest.accuracy()).toBeGreaterThanOrEqual(EVAL_MIN_ACCURACY);
  }, TEST_TIMEOUT_MS);

  it('multi-turn context stays on web search', async () => {
    const evalTest = new EvalTest({
      name: 'brave-web-follow-up-routing',
      test: async (evalAgent) => {
        const r1 = await evalAgent.prompt('I am setting up a home espresso corner. Can you find a few beginner guides?');
        if (!r1.hasToolCall(TOOL_NAMES.web))
          return false;

        const r2 = await evalAgent.prompt('Now find a few official espresso machine cleaning guides from manufacturers.', { context: [r1] });
        return r2.hasToolCall(TOOL_NAMES.web);
      },
    });

    await evalTest.run(agent, {
      iterations: EVAL_MULTI_TURN_ITERATIONS,
      concurrency: EVAL_CONCURRENCY,
      timeoutMs: EVAL_TIMEOUT_MS,
      onFailure: report => console.error(report),
    });

    expect(evalTest.accuracy()).toBeGreaterThanOrEqual(EVAL_MIN_ACCURACY);
  }, TEST_TIMEOUT_MS);

  it('web search passes a string query argument', async () => {
    const evalTest = new EvalTest({
      name: 'brave-web-search-args',
      test: async (evalAgent) => {
        const result = await evalAgent.prompt('Find the official Node.js documentation for streams.');
        const args = result.getToolArguments(TOOL_NAMES.web);
        return result.hasToolCall(TOOL_NAMES.web) && typeof args?.query === 'string';
      },
    });

    await evalTest.run(agent, {
      iterations: EVAL_ITERATIONS,
      concurrency: EVAL_CONCURRENCY,
      timeoutMs: EVAL_TIMEOUT_MS,
      onFailure: report => console.error(report),
    });

    expect(evalTest.accuracy()).toBeGreaterThanOrEqual(EVAL_MIN_ACCURACY);
  }, TEST_TIMEOUT_MS);
});
