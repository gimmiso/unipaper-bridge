# Access and licence boundaries

## System boundary

UniPaper Bridge may:

- Query public scholarly metadata.
- Query an open-access index using the server operator's API key.
- Construct a public institutional proxy or library link from an approved adapter.

UniPaper Bridge must not:

- Log into a university, library proxy, publisher, or user account.
- Request or receive credentials, MFA codes, cookies, browser profiles, or session tokens.
- Fetch, cache, store, or redistribute paywalled full text.
- Automate licensed downloads or bypass technical controls.

Authentication and any licensed download happen only in the user's browser under the user's own entitlement. The user may then privately attach an individually obtained PDF when the product and licence permit analysis.

## Evidence labels

- `open full text`: the article body or PDF was read from a lawful OA location.
- `user-provided full text`: the user attached a lawfully obtained article and it was read.
- `abstract/metadata only`: no complete article body was available.

Never upgrade an evidence label based on a proxy link alone.

## Kyung Hee University snapshot

The current KHU official guidance is authoritative if it changes:

- Remote access: https://lib.khu.ac.kr/webcontent/info/1
- Fair use: https://lib.khu.ac.kr/webcontent/info/2
- Seoul prefix: `https://openlink.khu.ac.kr/link.n2s?url=`
- Global prefix: `https://webgate.khu.ac.kr/link.n2s?url=`

KHU states that subscribed material is for reasonable personal research, caps downloads from the same publisher at 30 per day on the same PC/IP, and prohibits whole-issue/book downloads, continuous programmatic downloading, credential sharing, and redistribution. Use a stricter working ceiling of 20 items per publisher per day and stop earlier if another limit applies.
