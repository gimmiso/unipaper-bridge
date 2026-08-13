# Security policy

## Design guarantees

- No university credentials, MFA codes, cookies, browser profiles, or proxy sessions are accepted.
- No paywalled content is fetched or stored by the server.
- Institution links are generated from a reviewed adapter allowlist.
- Target URLs must be public HTTP(S) hostnames and cannot contain user information, literal IPs, local-only suffixes, or an existing KHU proxy host.
- Upstream API keys are never returned in structured or text tool results.
- Hosted MCP tools are read-only and non-destructive.

## Optional local KHU helper

The optional code under `local/` is a separate trust domain and is excluded from
the cloud Docker build. Its local MCP exposes only `open_khu_paper`; it has no
credential-returning tool. A helper retrieves a credential only after its
isolated browser reaches the exact KHU HTTPS login page, and passes it directly
to that page without stdout, stderr, logs, or MCP responses.

- macOS uses Keychain service `com.gimmiso.unipaper.khu` with synchronization
  disabled and an isolated persistent WebKit store. An optional Touch ID mode
  uses the currently enrolled biometric set. Data Protection Keychain is
  preferred when the app's signing identity supports it; unsigned/ad-hoc
  personal builds use the encrypted login Keychain because macOS does not grant
  them a Keychain access-group entitlement.
- Windows encrypts the local credential blob with DPAPI `CurrentUser` and uses a
  dedicated persistent Playwright Chromium profile under the current user's
  local application-data directory. The credential enters PowerShell over
  standard input, never through an argument or environment variable.
- Linux stores the credential in the desktop Secret Service through
  `secret-tool` and uses a dedicated persistent Playwright Chromium profile
  under the current user's data directory. No plaintext credential file is
  created. A working desktop keyring is required; headless fallback storage is
  deliberately unsupported.

Windows and Linux disable Playwright debug variables before loading the browser
library. All platforms try the dedicated browser session before opening the
credential vault and restrict automatic form filling to
`https://lib.khu.ac.kr/login`.

The helper is not a zero-knowledge authentication system: its process and the
browser content process must briefly hold the credential to submit it to KHU.
The enforced guarantee is that no credential-return path exists from the helper
to Node, MCP, the cloud bridge, or the model.

## Operator responsibilities

- Keep dependencies updated and run `npm audit` plus the full test suite before deployment.
- Store `OPENALEX_API_KEY` in the hosting platform's secret store.
- Set `ALLOWED_HOSTS`, TLS, and the correct `TRUST_PROXY` hop count.
- Avoid logging full upstream URLs because they may contain the OpenAlex API key.
- Monitor rate limits and abuse without retaining scholarly queries longer than needed.
- Re-verify institution adapters against official sources before each release.

## Reporting

Before public release, replace this section with the maintainer's private security contact or vulnerability-reporting URL. Do not include credentials, private library data, or copyrighted PDFs in reports.
