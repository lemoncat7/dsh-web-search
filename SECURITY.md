# Security policy

## Supported version

Security fixes are applied to the latest published version. The current plugin targets DSH 0.1.7-rc.2.

## Reporting a vulnerability

Do not open a public issue for credentials exposure, request forgery, or another exploitable vulnerability. Use GitHub's **Security → Report a vulnerability** form in this repository. Include the affected plugin version, DSH version, provider, reproduction steps, and impact. Remove API keys, tokens, and private URLs from logs and screenshots.

You should receive an acknowledgement within seven days. A fix and disclosure timeline will be coordinated after the report is reproduced.

## Deployment notes

Settings requests accept HTTP(S) same-host browser origins. The official Desktop origin `dsh-app://app` is additionally accepted only when the HTTP Host is `127.0.0.1`, `localhost`, or `[::1]` (with an optional port). Desktop fetch metadata may report `cross-site` because the local bridge uses HTTP rather than the application's custom scheme. This exception does not accept `null`, arbitrary custom schemes, origin lookalikes, or non-loopback hosts. Host authentication remains required; an Origin header is not an authentication credential.

The bundled SearXNG Compose file binds to `127.0.0.1`. Do not expose it publicly without authentication, rate limiting, a unique secret, and the protections required by the SearXNG deployment guide. Queries and explicit URLs are sent only to the provider selected in plugin settings.
