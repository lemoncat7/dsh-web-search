# Changelog

## 0.1.2

- Provide the standard DSH `web_fetch` capability alongside `web_search`.
- Add bounded `web_source` inspection for procedures that require raw HTML or script-embedded evidence removed by readable-page conversion.
- Reuse the plugin-scoped proxy for direct public-page retrieval.
- Block local, private, reserved, credential-bearing, non-HTTP, and binary fetch targets; revalidate bounded redirects and cap response bodies.

## 0.1.1

- Discover general-purpose engines from the configured SearXNG `/config` endpoint.
- Probe engines with bounded concurrency and sort usable engines by measured latency.
- Let each DSH client select the engines sent with every SearXNG search request.
- Add configurable retry count for failed or empty SearXNG searches.

## 0.1.0-alpha.3

- Provide one stable DSH-native `web_search` tool backed by SearXNG, Wikipedia, Tavily, Brave, or Gemini.
- Add bilingual settings, credential-backed API-key editing, and real draft testing.
- Default new installations to keyless Chinese Wikipedia.
- Add a plugin-scoped `DSH_WEB_SEARCH_PROXY` transport without changing networking for other DSH services.
- Support exact same-origin settings access through a protected remote DSH reverse proxy.
- Validate external JSON, reject redirects, cap responses at 2 MiB, and preserve caller cancellation.
- Target DSH 0.1.1-rc.2 on Node.js 22.19/24.
