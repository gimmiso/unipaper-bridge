# Local KHU authentication, draft auditing, and Zotero capture

This directory is deliberately separate from the public UniPaper Bridge server.
It contains the only code allowed to read a KHU credential, and that code runs
inside the user's own computer.

## Security boundary

```text
local MCP: public paper URL
        -> isolated helper: KHU proxy URL
        -> dedicated browser session first
        -> OS vault only when the KHU login page appears
        -> status only; no credential response path

local draft MCP: unpublished draft + inspected evidence anchors
        -> exact offset and provenance validation
        -> conservative sentence verdicts
        -> no network, files, persistence, or Zotero access
```

- `khu-auth-mcp` exposes one action: `open_khu_paper`.
- `zotero-mcp` exposes Zotero readiness, persisted automatic-save consent, and
  DOI-first deduplicated saves to the currently selected Zotero destination.
- `draft-audit-mcp` exposes one read-only action: `audit_draft_claims`. It checks
  sentence offsets, atomic-claim evidence links, DOI and exact locators, access
  levels, retractions, and status aggregation without saving the draft.
- It has no credential getter and never starts the helper with an ID or password.
- Both KHU helper implementations accept a password only from a no-echo terminal prompt.
- macOS stores a non-synchronizing generic-password item under service
  `com.gimmiso.unipaper.khu`. Data Protection Keychain is preferred when the
  signature permits it; ad-hoc personal builds use the encrypted login Keychain.
- Windows encrypts one local blob with DPAPI `CurrentUser`, so only the same user
  profile on the same computer can decrypt it.
- Linux stores the complete credential in the desktop Secret Service through
  `secret-tool`; no plaintext credential file is created.
- macOS uses a persistent, isolated WebKit data store. Windows and Linux use a
  dedicated persistent Playwright Chromium profile. An existing KHU session is
  always tried before the OS vault is opened.
- The helper fills credentials only on the exact HTTPS origin and login path
  `https://lib.khu.ac.kr/login`.
- Passwords, IDs, cookies, session data, and target URLs are absent from MCP
  results and error messages.
- `local/` is excluded from the cloud Docker build.

The helper necessarily holds the password briefly in its own isolated process
and browser process while submitting the login form. It is not possible to log
in without presenting the credential to KHU, but there is no interface that
returns it to the MCP process, ChatGPT, or another model. Playwright diagnostic
logging is disabled before the browser library is loaded.

## Platform support

| Platform | Credential store | Local browser | Extra requirement |
|---|---|---|---|
| macOS 13+ | Keychain | WebKit | Apple Command Line Tools |
| Windows 10/11 | DPAPI, current user | Bundled Chromium | PowerShell 5.1+ |
| Linux desktop | Secret Service | Bundled Chromium | `secret-tool` and a Secret Service provider |

On Debian/Ubuntu, install the Linux vault client before setup:

```bash
sudo apt install libsecret-tools
```

GNOME Keyring works directly. KDE requires a wallet/provider exposing the
freedesktop Secret Service API. Headless Linux without a desktop keyring is not
supported because it cannot meet the no-plaintext-storage guarantee.

If Chromium reports missing Linux libraries, run this from
`local/khu-auth-helper-portable` and then repeat setup:

```bash
sudo npx playwright install-deps chromium
```

## Build and one-time setup

Requirements: Node.js 20 or newer, plus the platform requirement in the table.
Install Zotero Desktop if automatic research capture is desired. Zotero may be
closed during installation, but it must be open while saving papers.

From the repository root:

```bash
npm ci
npm run build
npm run build:khu-helper
npm run setup:khu
```

The build command also installs and compiles every local MCP's own dependencies,
so the KHU, Zotero, and draft-audit packages remain self-contained.

The setup command detects the operating system. On Windows and Linux it also
downloads the Playwright-managed Chromium build. The prompt asks for a KHU ID
and twice for the password. Password input is not echoed and `setup` refuses
redirected input. Nothing is written to `.env`.

On macOS, require Touch ID whenever the stored credential is read:

```bash
npm run setup:khu -- --touch-id
```

Touch ID mode requires enrolled Touch ID and Keychain support for biometric
access control. Windows and Linux rely on their signed-in OS vault session and
do not accept `--touch-id`. Running setup again replaces the existing item.

Check or remove the item without revealing its contents:

```bash
npm run status:khu
npm run remove:khu
```

## Install the complete UniPaper plugin

The root plugin manifest includes the ordinary UniPaper MCP, three research
skills, and the local KHU, draft-audit, and Zotero MCPs. After building, add the
repository root as a local marketplace and install one plugin:

```bash
codex plugin marketplace add /absolute/path/to/unipaper-bridge
codex plugin add unipaper-bridge@unipaper-local
```

Restart the desktop app and start a new conversation. The installed bundle
provides the normal paper-research workflow and all four MCP servers. The research
skill first uses ordinary discovery and lawful open full text. It invokes
`open_khu_paper` automatically only when required full text remains unreadable;
the user does not choose a separate KHU skill.

The local opener still returns only `browser_opened`, not licensed article text.
If the analysis requires licensed full text, the only unavoidable handoff is
for the user to privately attach the individually downloaded PDF from the opened
browser. The skill then resumes the original analysis without repeating
discovery.

When a user asks to verify a manuscript, thesis, proposal, or literature-review
draft, `draft-claim-auditor` keeps exact sentence offsets, splits compound
sentences into atomic claims, compares them with sources actually inspected,
and sends the structured packet only to the local `audit_draft_claims` tool.
The tool returns `SUPPORTED`, `PARTIAL`, `CONTRADICTED`, or `UNVERIFIED` with DOI
and exact page/section/table/figure locations. It does not read files or papers,
rewrite the draft, call the network, or write to Zotero.

When the user explicitly enables automatic Zotero capture, the preference is
stored locally without credentials. The workflow then saves only material
papers after DOI-first duplicate checks. Zotero may fetch verified OA files.
Licensed files remain a user-controlled handoff: the KHU browser opens the
paper, and only an individual PDF the user lawfully supplies or selects may be
attached. The Zotero MCP never scans Downloads or receives the KHU session.

## Sharing with other users

Share the source repository or release archive, never a configured helper,
browser profile, credential blob, Keychain item, or exported keyring. Every user
must build the helper and run `npm run setup:khu` on their own computer with
their own KHU account. University accounts are personal; do not reuse one
person's credentials for a group.

The source archive intentionally excludes build output, dependency folders,
browser profiles, and all credentials. After extracting it, each user follows
the build, setup, and local-plugin steps above.

## Verification

```bash
npm run check
npm run check:local
```

The test suite verifies allowlisted output, URL restrictions, process-argument
redaction, session-first behavior, and the MCP schema on every platform. The
local suite also verifies unpublished-draft non-reflection, exact UTF-16 offset
matching, atomic-claim aggregation, access-level downgrades, and
retracted/metadata evidence exclusion. On macOS, include a disposable real
Keychain write/read/delete round trip with:

```bash
KHU_KEYCHAIN_INTEGRATION=1 npm run test:khu-helper:mac
```

The integration test uses a random service name and deletes the temporary item.
It never touches `com.gimmiso.unipaper.khu`.

The GitHub Actions workflow builds and unit-tests the portable helper and local
MCP on macOS, Windows, and Ubuntu. OS-vault and interactive browser integration
tests still need a signed-in desktop session on the corresponding platform.
