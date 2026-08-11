# Security policy

## Design guarantees

- No university credentials, MFA codes, cookies, browser profiles, or proxy sessions are accepted.
- No paywalled content is fetched or stored by the server.
- Institution links are generated from a reviewed adapter allowlist.
- Target URLs must be public HTTP(S) hostnames and cannot contain user information, literal IPs, local-only suffixes, or an existing KHU proxy host.
- Upstream API keys are never returned in structured or text tool results.
- MCP tools are read-only and non-destructive.

## Operator responsibilities

- Keep dependencies updated and run `npm audit` plus the full test suite before deployment.
- Store `OPENALEX_API_KEY` in the hosting platform's secret store.
- Set `ALLOWED_HOSTS`, TLS, and the correct `TRUST_PROXY` hop count.
- Avoid logging full upstream URLs because they may contain the OpenAlex API key.
- Monitor rate limits and abuse without retaining scholarly queries longer than needed.
- Re-verify institution adapters against official sources before each release.

## Reporting

Before public release, replace this section with the maintainer's private security contact or vulnerability-reporting URL. Do not include credentials, private library data, or copyrighted PDFs in reports.
