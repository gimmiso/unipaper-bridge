# Privacy notice

UniPaper Bridge 0.1 is designed as an anonymous, read-only service.

## Data the server receives

- A DOI or paper title when resolving scholarly metadata.
- A DOI when looking for a lawful open-access location.
- A public publisher or article URL and an institution adapter identifier when building an institutional link.
- Ordinary server logs configured by the operator, such as timestamps and network addresses.

## Data the server does not request or store

- University usernames or passwords.
- MFA codes, cookies, proxy sessions, browser history, or library account data.
- Paywalled PDFs or their contents.

Queries needed for metadata and open-access lookup are sent to Crossref and OpenAlex under their respective privacy terms. The institutional access link is generated locally and is not opened by this server. Each user signs in directly with their institution in their own browser.

Operators should publish a deployment-specific privacy policy describing hosting logs, retention, contact details, and subprocessors before public plugin submission.
