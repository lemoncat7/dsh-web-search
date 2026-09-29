# @lemoncat7/dsh-web-search

> 当前正式版 **0.3.2**，面向 **DSH 0.1.7-rc.2**。修复 Desktop 设置接口来源校验，已通过自动化测试，尚未实测真实 Desktop 客户端。Node.js **^22.19.0 或 >=24.0.0**。详见 [0.3.2 发布说明](docs/releases/0.3.2.md)。

Configurable web access for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The plugin provides DSH's native `web_search` and `web_fetch` tools: administrators select the search backend, while direct public-page retrieval uses the same plugin-scoped proxy and security boundary. A constrained `web_source` tool is also available when an agent must verify raw HTML markers or script-embedded data under an explicit source procedure; normal page reading remains the job of `web_fetch`.

## Compatibility

Stable plugin release `0.3.2` targets DeepSeek Harness `0.1.7-rc.2` on Node.js `^22.19.0` or `>=24.0.0`. The Desktop origin fix is covered by automated HTTP tests, not a real Desktop client run. The host is still a release candidate. Older hosts should retain `0.2.1`; this release does not claim compatibility with untested future hosts.

Supported providers:

- SearXNG — self-hosted, keyless general web search
- Wikipedia — keyless encyclopedia search; Simplified Chinese by default
- Tavily — agent-oriented API search
- Brave Search — traditional web and news search
- Gemini Grounded Search — Google Search grounding and URL Context for queries containing a URL

Only the selected provider receives each query. The plugin does not silently fan out requests or spend quota on fallback services.

## Install

```bash
dsh plugin --profile web add @lemoncat7/dsh-web-search
```

Open **Settings → Plugins → Plugin configuration → Web search** to choose a provider, store API credentials, test the draft configuration, and save it without restarting DSH.

The default backend is keyless Chinese Wikipedia so a new installation can be verified immediately. Use SearXNG, Tavily, Brave, or Gemini for general web coverage.

## Local SearXNG

```bash
docker compose -f deploy/searxng/compose.yml up -d
curl -fsS -X POST http://127.0.0.1:8080/search -d 'q=DeepSeek&format=json'
```

The included deployment binds to loopback only. Do not expose it publicly without authentication, rate limiting, and the controls recommended by SearXNG.

The settings card can read general-purpose engines from the configured instance, probe them with bounded concurrency, sort successful engines by latency, and save a per-client engine selection. Failed or empty searches can be retried from zero to three times.

## Security

- Search JSON and fetched text are capped at 2 MiB; search responses are schema-validated.
- `web_fetch` accepts credential-free public HTTP(S) URLs only and blocks loopback, private, link-local, and reserved destinations.
- Fetch redirects are capped at five and every hop is revalidated. Binary bodies are rejected.
- `web_source` applies the same fetch policy and supports only bounded range reads or a bounded set of exact source markers, with at most 120,000 returned characters.
- API keys are resolved through DSH Credential Store and sent only in provider-defined authorization headers.
- Browser settings routes enforce exact same-origin writes, cap request bodies, and never return secret values.
- Fetch and source inspection are constrained read-only public-web capabilities, not internal-network access or arbitrary command execution.

## Proxy

Set `DSH_WEB_SEARCH_PROXY` to an absolute HTTP(S) proxy URL. Search and fetch share this dispatcher; it remains scoped to the plugin and does not change networking for model providers or other DSH plugins. Loopback and private IPv4 destinations bypass it for local search backends, while `web_fetch` independently rejects non-public destinations. Add custom direct hosts to the comma-separated `DSH_WEB_SEARCH_NO_PROXY` variable.

## Development

```bash
npm install
npm run check
```

## Attribution

Maintained as an MIT-licensed derivative of [zmh2000829/dsh-web-search-multi](https://github.com/zmh2000829/dsh-web-search-multi). The original license notice is retained.
