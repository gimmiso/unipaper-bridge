# Privacy notice

UniPaper Bridge 0.5 is designed as an anonymous, read-only hosted service with
separate optional local-only components.

## Data the server receives

- A DOI or paper title when resolving scholarly metadata.
- A DOI when expanding its bounded citation network into references, citing
  works, and topic-similar works.
- A DOI when looking for a lawful open-access location.
- For evidence-matrix requests, bibliographic fields, caller-written
  paraphrased study summaries, explicit missing-field statuses, access labels,
  and source locators for up to thirty papers.
- A public publisher or article URL and an institution adapter identifier when building an institutional link.
- Ordinary server logs configured by the operator, such as timestamps and network addresses.

## Data the server does not request or store

- University usernames or passwords.
- MFA codes, cookies, proxy sessions, browser history, or library account data.
- PDF files, full article bodies, or long copied passages.
- Unpublished draft text submitted for sentence-level citation auditing. The
  hosted server does not expose `audit_draft_claims`.

Queries needed for metadata, citation-network expansion, and open-access lookup
are sent to Crossref and OpenAlex under their respective privacy terms. Evidence
matrices are validated and rendered in the service process without an upstream
paper-content call; the service does not persist them. The institutional access
link is generated locally and is not opened by this server. Each user signs in
directly with their institution in their own browser.

Operators should publish a deployment-specific privacy policy describing hosting logs, retention, contact details, and subprocessors before public plugin submission.

## Optional local helper

The optional local helper is not part of the hosted service. If the user chooses
to install it, the KHU ID and password are stored only in that user's operating-
system credential store: a non-synchronizing Keychain item on macOS, a DPAPI
`CurrentUser`-encrypted local blob on Windows, or the desktop Secret Service on
Linux. A dedicated local browser profile keeps its own website session. None of
these values are sent to the UniPaper cloud server, included in MCP responses,
passed in command-line arguments or environment variables, or written to
project configuration files.

When required full text is unavailable publicly, the local KHU helper may obtain
exactly one requested PDF under the user's own entitlement. It stores the file
in a random managed temporary directory, validates it locally, returns only the
managed path and file metadata to the local MCP workflow, and exposes bounded
page text rather than raw PDF bytes. The workflow deletes that directory after
analysis or an authorised Zotero attachment. The PDF and extracted page text
are never sent to the hosted UniPaper service.

Each person must run setup on their own computer with their own authorized KHU
account. The credential store and browser profile are per-user and must not be
copied, uploaded, or shared with another person.

The optional local Zotero MCP talks only to Zotero Desktop on loopback port
`23119`. After the user opts in, it may read bibliographic metadata for DOI-
first duplicate detection and write selected research records to the currently
selected editable library or collection. It asks Zotero to retrieve a PDF only
for verified open-access material. It may attach one local PDF when the user
lawfully supplied it or when the local KHU helper obtained that exact paper.
Local file paths, Zotero library contents, and attachments are not sent to the
hosted UniPaper server. A managed KHU path may be passed only between the local
KHU and Zotero MCPs for that attachment operation.

The optional local draft-audit MCP receives only the draft and structured
source-evidence packet supplied through the local stdio connection. It checks
exact character offsets, DOI and anchor references, access labels, retraction
status, and conservative status aggregation. It has no network client, file
reader/writer, Zotero access, credential access, or persistence layer. It does
not log or retain the draft after the tool process finishes the request. Draft
text is never forwarded to the hosted UniPaper server by this component.
