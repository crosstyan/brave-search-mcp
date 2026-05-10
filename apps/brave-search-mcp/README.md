# Brave Search MCP Server

An MCP Server implementation that integrates the [Brave Search API](https://brave.com/search/api/) and exposes Brave web search, LLM context, image, news, local, and video tools.

<a href="https://glama.ai/mcp/servers/@mikechao/brave-search-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@mikechao/brave-search-mcp/badge" alt="Brave Search MCP server" />
</a>

## Features

- **Full Brave Tool Set**: Web search, LLM context, image, news, local, and video search
- **Automatic 429 Retry**: Retries rate-limited Brave API requests automatically
- **Multi-Key Rotation**: Rotates across multiple Brave API keys when configured
- **Split Key Pools**: Optionally dedicate a separate web-only key pool to `brave_web_search`

## Tools

- **brave_web_search**: Execute standard web searches using Brave's API
- **brave_llm_context_search**: Retrieve ranked page snippets formatted for LLM consumption
- **brave_image_search**: Search the web for images
- **brave_news_search**: Search the web for news
- **brave_local_search**: Search for local businesses, services and places
- **brave_video_search**: Search the web for videos

## OpenAI Apps & MCP Apps Support

<p align="center">
  <a href="https://www.youtube.com/watch?v=Z5KiC00gBVE">
    <img src="https://img.youtube.com/vi/Z5KiC00gBVE/maxresdefault.jpg" alt="Watch the demo" width="80%">
  </a>
  <br>
  <a href="https://www.youtube.com/watch?v=Z5KiC00gBVE"><em>▶️ Click to watch the demo video</em></a>
</p>

There is now support for [OpenAI Apps](https://developers.openai.com/apps-sdk/) and [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) in this MCP Server. When UI mode is enabled for each tool there is a corresponding UI widget that let's you control what gets added to the model's context. See the directions in [usage with ChatGPT section](#usage-with-chatgpt).

## Configuration

### Getting an API Key

1. Sign up for a [Brave Search API account](https://brave.com/search/api/)
2. Choose a plan
3. Generate your API key [from the developer dashboard](https://api.search.brave.com/app/keys)

### Runtime modes

By default the MCP server runs in stdio mode.

```bash
BRAVE_API_KEY="your_full_access_key" npx -y brave-search-mcp
```

To enable Streamable HTTP mode:

```bash
BRAVE_API_KEY="your_full_access_key" npx -y brave-search-mcp --http
```

By default the server listens on port 3001.
The URL is:

```
http://0.0.0.0:3001/mcp
```

There are two configuration modes:

- Env mode: `BRAVE_MCP_CONFIG` is unset. Feature toggles come from environment variables exactly as in previous releases.
- File mode: `BRAVE_MCP_CONFIG=/path/to/config.toml` is set. The TOML file becomes the single source of truth for feature settings, and overlapping feature env vars are ignored with warnings.

### Environment-only settings

These settings are always read from the process environment, regardless of mode:

- `BRAVE_API_KEY` / `BRAVE_API_KEYS` (optional, but at least one Brave key pool is required): Full-access Brave Search API key or key list for all tools.
- `BRAVE_WEB_SEARCH_API_KEY` / `BRAVE_WEB_SEARCH_API_KEYS` (optional): Dedicated Brave Web Search key or key list for `brave_web_search` only.
- When multiple keys are configured in either pool, requests rotate across them and 429 retries advance to the next key in that pool.
- If both pools are configured:
  - `brave_web_search` uses `BRAVE_WEB_SEARCH_API_KEY(S)`.
  - `brave_image_search`, `brave_news_search`, `brave_local_search`, `brave_video_search`, and `brave_llm_context_search` use `BRAVE_API_KEY(S)`.
- If only `BRAVE_WEB_SEARCH_API_KEY(S)` is configured, the server starts in web-only mode and registers only `brave_web_search`.
- `HTTP_PROXY` / `HTTPS_PROXY` (optional): Proxy URL used for outbound Brave API requests.
  - The server applies these env vars at startup, so launching via something like `source ~/proxy.sh && npx -y brave-search-mcp --http` works.
- `PORT` (optional): HTTP port (default: `3001`).
- `HOST` (optional): Interface to bind to (default: `0.0.0.0`).
- `BRAVE_MCP_CONFIG` (optional): Absolute or relative path to a TOML config file for feature settings.

### Env mode feature settings

When `BRAVE_MCP_CONFIG` is not set, these feature env vars are supported:

- `ALLOWED_HOSTS` (HTTP mode only): Comma-separated list of allowed hostnames for Host header validation.
  - Example: `ALLOWED_HOSTS=localhost,127.0.0.1,my-app.ngrok-free.app`
  - Use hostnames only (no scheme/path), e.g. `my-app.ngrok-free.app` not `https://my-app.ngrok-free.app/mcp`
- `BRAVE_MCP_POLICY_FILE`: JSON policy file path.
- `BRAVE_MCP_POLICY_REDACT`: `true` to redact matched text instead of blocking it.
- `BRAVE_MCP_REQUEST_LIMIT`: Positive integer request cap.
- `BRAVE_MCP_WINDOW_SECONDS`: Non-negative integer rolling window size.
- `BRAVE_MCP_COOLDOWN_SECONDS`: Non-negative integer cooldown after the limit is exceeded.
- `BRAVE_MCP_AUDIT_LOG`: `true` to emit audit logs.
- `BRAVE_MCP_AUDIT_LOG_RAW`: `true` to include raw query text in audit logs.
- `BRAVE_MCP_REQUIRE_JUSTIFICATION`: `true` to reject tool calls without a `justification` string.

Examples:

```bash
# Local only with full-access keys
HOST=127.0.0.1 ALLOWED_HOSTS=localhost,127.0.0.1 BRAVE_API_KEY="your_full_access_key" npx -y brave-search-mcp --http
```

```bash
# Web-only mode with a dedicated legacy or capped web-search key
BRAVE_WEB_SEARCH_API_KEY="your_web_only_key" npx -y brave-search-mcp --http
```

```bash
# Full-access pool with multiple Brave API keys
BRAVE_API_KEY="key_one,key_two,key_three" npx -y brave-search-mcp --http
```

```bash
# Mixed mode: web tool uses the dedicated web-only pool, all other tools use the full-access pool
BRAVE_API_KEY="full_key_one,full_key_two" BRAVE_WEB_SEARCH_API_KEY="web_key_one,web_key_two" npx -y brave-search-mcp --http
```

```bash
# Local with ngrok tunnel
HOST=127.0.0.1 ALLOWED_HOSTS=localhost,127.0.0.1,my-app.ngrok-free.app BRAVE_API_KEY="your_full_access_key" npx -y brave-search-mcp --http --ui
```

### File mode (`BRAVE_MCP_CONFIG`)

When `BRAVE_MCP_CONFIG` is set, the file controls feature configuration, including the HTTP host allowlist.

```toml
[auth]
httpApiKey = "sk-..."
requireAuth = true
callerId = "team-a"

[auth.jwt]
jwksUri = "https://idp.example.com/.well-known/jwks.json"
audience = "brave-search-mcp"
clockSkewSeconds = 30

[auth.oauth]
issuer = "https://idp.example.com"
audience = "brave-search-mcp"
clientId = "client-123"
clientSecret = "super-secret"
verifyStrategy = "jwks"

[audit]
enabled = true
logRaw = false
hmacSecret = "audit-secret"

[policy]
file = "/etc/brave-mcp/policy.json"
redact = false

[guardrail]
requestLimit = 100
windowSeconds = 60
cooldownSeconds = 10
requireJustification = false

[server]
allowedHosts = [
  "localhost",
  "127.0.0.1",
  "my-app.ngrok-free.app",
]
```

Notes:

- `BRAVE_API_KEY`, `PORT`, and `HOST` remain environment-only even in file mode.
- If you set overlapping feature env vars such as `BRAVE_MCP_REQUEST_LIMIT` or `ALLOWED_HOSTS` alongside `BRAVE_MCP_CONFIG`, startup warns that they are being ignored.
- Unknown TOML keys also emit warnings so typos like `[guardrails]` are visible before you debug runtime behavior.

To validate a config file without starting the server, use the packaged entrypoint after building the app workspace:

```bash
pnpm -C apps/brave-search-mcp run build
node apps/brave-search-mcp/dist/index.js --check-config ./apps/brave-search-mcp/test/fixtures/config.valid.toml
```

To run the built local entrypoint in file mode:

```bash
pnpm -C apps/brave-search-mcp run build
BRAVE_API_KEY="your_key_here" BRAVE_MCP_CONFIG="$PWD/apps/brave-search-mcp/test/fixtures/config.valid.toml" node apps/brave-search-mcp/dist/index.js --http
```

### Usage with ChatGPT

The Brave Search MCP Server can be used with the web UI of ChatGPT. It takes a few steps.

#### 1. Enable Developer Mode in ChatGPT

Settings → Apps → Advanced settings → Developer mode

Additional instructions [here](https://platform.openai.com/docs/guides/developer-mode)

#### 2. Run the Brave Search MCP in HTTP mode and UI mode

```bash
BRAVE_API_KEY="your_full_access_key" npx -y brave-search-mcp --http --ui
```

#### 3. Create a local tunnel to expose the MCP Server to ChatGPT

Sign up and configure [ngrok](https://ngrok.com/), the free plan works.

```bash
ngrok http 3001
```

Take note of the forwarding URL.

```bash
...
Forwarding                    https://john-joe-asdf.ngrok-free.dev -> http://localhost:3001
...
```

#### 4. Add Brave Search MCP as a Connector to ChatGPT

Open [ChatGPT Apps settings](https://chatgpt.com/#settings/Connectors)

Click Apps

Click Create Apps

Fill out the form using the URL from step 3 as the MCP Server URL, but add `/mcp`.

```
https://john-joe-asdf.ngrok-free.dev/mcp
```

For Authentication, select 'No Auth'

Tick the checkbox for 'I understand and want to continue'

Then click Create.

#### 5. Using the Brave Search MCP Server

In the ChatGPT UI, click the '+' button, scroll to '...more', select the newly created Brave Search app, and enter your query.

### Usage with Claude Code

For [Claude Code](https://claude.ai/code) users, run this command:

**Windows:**

```bash
claude mcp add-json brave-search '{"command":"cmd","args":["/c","npx","-y","brave-search-mcp"],"env":{"BRAVE_API_KEY":"YOUR_API_KEY_HERE"}}'
```

**Linux/macOS:**

```bash
claude mcp add-json brave-search '{"command":"npx","args":["-y","brave-search-mcp"],"env":{"BRAVE_API_KEY":"YOUR_API_KEY_HERE"}}'
```

Replace `YOUR_API_KEY_HERE` with your actual Brave Search API key.

### Usage with Claude Desktop

#### MCP Bundle (MCPB)

1. Download the `mcpb` file from the [Releases](https://github.com/mikechao/brave-search-mcp/releases)
2. Open it with Claude Desktop
   or
   Go to File -> Settings -> Extensions and drag the .mcpb file to the window to install it

#### Docker

1. Clone the repo
2. Build the image from the repo root

```bash
docker build -t brave-search-mcp:latest -f apps/brave-search-mcp/Dockerfile .
```

3. Run it directly if you want HTTP mode:

```bash
docker run --rm -p 3001:3001 -e BRAVE_API_KEY="YOUR_API_KEY_HERE" brave-search-mcp:latest --http
```

4. Add this to your `claude_desktop_config.json` for stdio mode:

```json
{
  "mcp-servers": {
    "brave-search": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "BRAVE_API_KEY",
        "brave-search-mcp"
      ],
      "env": {
        "BRAVE_API_KEY": "YOUR API KEY HERE"
      }
    }
  }
}
```

#### NPX

Add this to your `claude_desktop_config.json`:

```json
{
  "mcp-servers": {
    "brave-search": {
      "command": "npx",
      "args": [
        "-y",
        "brave-search-mcp"
      ],
      "env": {
        "BRAVE_API_KEY": "YOUR API KEY HERE"
      }
    }
  }
}
```

### Usage with LibreChat

Add this to librechat.yaml

```yaml
brave-search:
  command: sh
  args:
    - -c
    - BRAVE_API_KEY=API KEY npx -y brave-search-mcp
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, monorepo structure, and release instructions.
For UI build workflow details, including the entrypoint orchestrator, see [UI Build Orchestrator](CONTRIBUTING.md#ui-build-orchestrator).

## Disclaimer

This library is not officially associated with Brave Software. It is a third-party implementation of the Brave Search API with a MCP Server.

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.
