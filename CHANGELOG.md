# Changelog

## 0.1.0-alpha.2

- Provide one stable DSH-native `web_search` tool backed by SearXNG, Wikipedia, Tavily, Brave, or Gemini.
- Add bilingual settings, credential-backed API-key editing, and real draft testing.
- Default new installations to keyless Chinese Wikipedia.
- Add a plugin-scoped `DSH_WEB_SEARCH_PROXY` transport without changing networking for other DSH services.
- Validate external JSON, reject redirects, cap responses at 2 MiB, and preserve caller cancellation.
- Target DSH 0.1.1-rc.2 on Node.js 22.19/24.
