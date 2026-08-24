# Agent installation guide

This guide is for an agent installing the plugin on a user's existing DSH profile. Preserve the profile's other dependencies and bundle order.

## Safety rules

- Do not clone or edit DeepSeek Harness source code.
- Do not read, print, or copy credential values. Configuration contains credential references only.
- Inspect the current profile before editing it, and verify that unrelated bundle entries remain unchanged afterward.
- Prefer a pinned release or commit for reproducible installations. `main` is suitable for development only.

## Install from GitHub

```sh
dsh plugin --profile web add github:lemoncat7/dsh-web-search
```

If pnpm reports that the Git dependency's build script was blocked, follow its `allowBuilds` instruction and repeat the command. Do not enable unrelated package build scripts.

The bundle selects `lemoncat7-search`; it does not start SearXNG. Start the included service from a checkout when a configured endpoint is not already available:

```sh
docker compose -f deploy/searxng/compose.yml up -d
```

## Configure a provider

Edit `$DSH_HOME/profiles/web/cordis.patch.yml` and use one complete configuration from `examples/`. Brave, Tavily, and Gemini use DSH credential references such as `GEMINI_API_KEY`; never insert a literal key into Cordis YAML.

## Verify

```sh
dsh --profile web --dump-config | grep -E 'lemoncat7-search|lemoncat7-web-search'
dsh web
```

Confirm that the selected provider returns results, then compare the profile dependency and bundle lists with their pre-install values. Only the `@lemoncat7/dsh-web-search` entries should be new.

## Remove

Remove profile overrides that target `lemoncat7-web-search`, then run:

```sh
dsh plugin --profile web remove @lemoncat7/dsh-web-search
```
