# Deployment guide

## Current public deployment

- Service: `https://unipaper-bridge-mcp.kimmiso0821.chatgpt.site`
- MCP endpoint: `https://unipaper-bridge-mcp.kimmiso0821.chatgpt.site/api/mcp`
- Health check: `https://unipaper-bridge-mcp.kimmiso0821.chatgpt.site/healthz`
- Deployed Worker source: [`deploy/sites-worker.js`](../deploy/sites-worker.js)

The hosted Worker uses `/api/mcp` because the hosting platform reserves the exact `/mcp` route. This remains a stable Streamable HTTP MCP URL. The Node/Express and Docker variants continue to use `/mcp` by default.

After it is deployed, the 0.4 Worker can resolve Crossref metadata, perform
low-volume no-key OpenAlex citation/OA lookups, render checked multi-paper
evidence matrices, and construct KHU links. Set a free
`OPENALEX_API_KEY` through the host's secret manager to raise the OpenAlex usage
budget for shared deployments; do not commit the key.

## Required production shape

- Node.js 20 or later.
- A stable public HTTPS URL ending in `/mcp`.
- Streamable HTTP support with POST requests preserved by the reverse proxy.
- `OPENALEX_API_KEY` configured on shared production deployments for a higher
  usage budget, never entered by end users.
- Host-header protection, TLS, request-size limits, rate limiting, and logs that do not capture query-string secrets.

This project is stateless. It can run behind a managed container platform or ordinary reverse proxy.

## Environment variables

| Name | Required | Example | Purpose |
|---|---:|---|---|
| `OPENALEX_API_KEY` | Recommended | secret | Raises the OpenAlex budget for citation expansion and OA lookup |
| `CROSSREF_MAILTO` | Recommended | `team@example.org` | Crossref polite-pool contact |
| `HOST` | Production | `0.0.0.0` | Bind address |
| `PORT` | Production | `3000` | HTTP port |
| `ALLOWED_HOSTS` | Recommended | `mcp.example.org` | Comma-separated Host allowlist |
| `TRUST_PROXY` | Behind proxy | `1` | Number of trusted reverse-proxy hops |

Do not set `TRUST_PROXY=true` unless every path to the app passes through a trusted proxy that overwrites forwarding headers. Prefer an exact hop count.

## Docker

```bash
docker build -t unipaper-bridge:0.4.0 .
docker run --rm -p 3000:3000 \
  -e OPENALEX_API_KEY=replace-me \
  -e CROSSREF_MAILTO=team@example.org \
  -e ALLOWED_HOSTS=localhost,127.0.0.1 \
  unipaper-bridge:0.4.0
```

For a hosted service, set `ALLOWED_HOSTS` to the real public hostname and terminate TLS at the platform or reverse proxy.

## Verify before connecting ChatGPT

```bash
curl -fsS https://mcp.example.org/healthz
npx @modelcontextprotocol/inspector@latest
```

Use the Inspector to call all six tools with representative, empty, malformed,
and not-found inputs. For `build_evidence_matrix`, include valid full-text,
abstract-only, metadata-only, duplicate, missing-locator, and retracted rows.
Confirm that no result includes `OPENALEX_API_KEY` or infrastructure secrets.

## Connect in ChatGPT developer mode

1. Enable Developer mode under ChatGPT Settings → Security and login.
2. Open ChatGPT Plugins and add a connection.
3. Enter the full URL, such as `https://mcp.example.org/mcp`.
4. Review discovered tool names, schemas, descriptions, and annotations.
5. Copy the generated technical ID from the browser URL. It starts with `plugin_asdk_app`.
6. Map that ID in `.app.json`, update the plugin manifest, and test the installed plugin with `evals/cases.json`.

## Public submission gaps the operator must fill

Code alone cannot supply these identity and hosting requirements:

- A verified publisher identity and support contact.
- A stable production domain and MCP endpoint.
- Public website, privacy-policy, and terms-of-service URLs.
- A repository URL and final manifest metadata.
- Operational monitoring, abuse response, and a deployment-specific retention policy.

The included `PRIVACY.md` and `TERMS.md` are project templates; publish deployment-specific versions on the operator's domain.

## Authentication decision

The 0.4 hosted tools use public scholarly APIs, local adapter data, and transient
caller-supplied evidence summaries, with no stored user-specific server data,
so the service can remain anonymous and read-only. Do not add university login
to the MCP server. `audit_draft_claims` is deliberately absent from the hosted
Worker and is available only through the separately installed local stdio MCP.

If a future release reads a user's private Zotero library, cloud drive, or saved papers, protect those tools with OAuth 2.1 and enforce authorization for every request. Keep institutional publisher login in the user's browser even then.
