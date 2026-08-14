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
- Through a local-only MCP, obtain one individually requested licensed PDF into
  a random managed temporary directory, validate its signature and size, expose
  only bounded page text for analysis, and delete the temporary copy after
  analysis or Zotero attachment.
- Save verified bibliographic metadata to the user's local Zotero library after
  explicit or persisted user authorisation.
- Ask Zotero to retrieve an attachment only after lawful OA has been verified.
- Attach one local PDF when the user lawfully supplied it or the isolated helper
  obtained that exact individual paper through the user's own entitlement.

UniPaper Bridge must not:

- Let the hosted service, MCP process, or model log into a university, library
  proxy, publisher, or user account; only the isolated local helper may submit
  a credential to the exact allowlisted KHU login page.
- Request or receive credentials, MFA codes, cookies, browser profiles, or session tokens.
- Send licensed PDF bytes, page text, cookies, or sessions to the hosted
  UniPaper service, GitHub, logs, or another user.
- Run bulk, background, recursive, issue-level, or sustained licensed downloads,
  or bypass a publisher control, CAPTCHA, terms prompt, or access decision.
- Send a university proxy URL, credential, cookie, or browser session to Zotero.

Authentication and the one-paper download happen only on the user's computer
under the user's own entitlement. The isolated helper may automatically select
an obvious article-PDF control; if publisher interaction is required, the user
performs that action in the visible helper browser. Credentials and session
state never enter the MCP result. The raw PDF remains local and temporary.

Zotero storage is a separate local trust domain. DOI-first duplicate checks may
read bibliographic metadata from the local library. PDF paths and indexed full
text are accessed only for the individual attachment operation the user
authorised. A Zotero write never changes an evidence-access label by itself.

The local helper returning `browser_opened` is not evidence that the article
body was read. `downloaded` proves only that one PDF passed local file
validation. Treat it as full text only after `read_khu_paper_pages` confirms the
article identity and the relevant body pages were inspected. The local MCP may
return bounded page text to the active local research workflow, but never raw
licensed PDF bytes, credentials, cookies, or browser session data.

## Evidence labels

- `FULLTEXT-OA`: the article body or PDF was read from a lawful OA location.
- `FULLTEXT-LICENSED`: the correct article was read locally through the user's
  own institutional entitlement.
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
