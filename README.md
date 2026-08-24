# @lemoncat7/dsh-web-search

Configurable web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The plugin keeps DSH's native `web_search` tool stable while administrators select the actual backend in Settings.

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

## Security

- External JSON is schema-validated and capped at 2 MiB.
- HTTP redirects are rejected.
- API keys are resolved through DSH Credential Store and sent only in provider-defined authorization headers.
- Browser settings routes enforce exact same-origin writes, cap request bodies, and never return secret values.
- The plugin implements search only, not arbitrary URL fetching.

## Proxy

Set `DSH_WEB_SEARCH_PROXY` to an absolute HTTP(S) proxy URL. This dispatcher is scoped to the plugin and does not change networking for model providers or other DSH plugins. Loopback and private IPv4 destinations bypass it; add custom direct hosts to the comma-separated `DSH_WEB_SEARCH_NO_PROXY` variable.

## Development

```bash
npm install
npm run check
```

## Attribution

Maintained as an MIT-licensed derivative of [zmh2000829/dsh-web-search-multi](https://github.com/zmh2000829/dsh-web-search-multi). The original license notice is retained.
