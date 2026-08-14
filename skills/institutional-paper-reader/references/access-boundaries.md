# Access and licence boundaries

## System boundary

UniPaper Bridge may:

- Query public scholarly metadata.
- Query an open-access index using the server operator's API key.
- Validate, deduplicate, and format caller-supplied paraphrased evidence fields
  and exact source locators for up to thirty papers. This operation does not
  fetch or verify paper content.
- Construct a public institutional proxy or library link from an approved adapter.
- Launch the optional local KHU browser helper with one approved paper URL when
  public full text is unavailable and full text is needed.
- Save verified bibliographic metadata to the user's local Zotero library after
  explicit or persisted user authorisation.
- Ask Zotero to retrieve an attachment only after lawful OA has been verified.
- Attach one local PDF only when the user lawfully supplied or selected that
  individual file.

UniPaper Bridge must not:

- Log into a university, library proxy, publisher, or user account.
- Request or receive credentials, MFA codes, cookies, browser profiles, or session tokens.
- Fetch, cache, store, or redistribute paywalled full text.
- Automate licensed downloads or bypass technical controls.
- Send a university proxy URL, credential, cookie, or browser session to Zotero.

Authentication and any licensed download happen only in the user's browser under the user's own entitlement. The user may then privately attach an individually obtained PDF when the product and licence permit analysis.

Zotero storage is a separate local trust domain. DOI-first duplicate checks may
read bibliographic metadata from the local library. PDF paths and indexed full
text are accessed only for the individual attachment operation the user
authorised. A Zotero write never changes an evidence-access label by itself.

The local helper returning `browser_opened` is not evidence that the article
body was read. The helper does not return credentials, cookies, browser session
data, or licensed full text through MCP. Treat the paper as abstract/metadata
only until Codex can inspect a lawful full-text source or a privately attached
individual PDF.

## Evidence labels

- `FULLTEXT-OA`: the article body or PDF was read from a lawful OA location.
- `FULLTEXT-USER`: the user attached a lawfully obtained article and it was read.
- `ABSTRACT-ONLY`: the abstract, but not the complete article body, was inspected.
- `METADATA-ONLY`: only bibliographic metadata was inspected.

Never upgrade an evidence label based on a proxy link alone.

## Kyung Hee University snapshot

The current KHU official guidance is authoritative if it changes:

- Remote access: https://lib.khu.ac.kr/webcontent/info/1
- Fair use: https://lib.khu.ac.kr/webcontent/info/2
- Seoul prefix: `https://openlink.khu.ac.kr/link.n2s?url=`
- Global prefix: `https://webgate.khu.ac.kr/link.n2s?url=`

KHU states that subscribed material is for reasonable personal research, caps downloads from the same publisher at 30 per day on the same PC/IP, and prohibits whole-issue/book downloads, continuous programmatic downloading, credential sharing, and redistribution. Use a stricter working ceiling of 20 items per publisher per day and stop earlier if another limit applies.
