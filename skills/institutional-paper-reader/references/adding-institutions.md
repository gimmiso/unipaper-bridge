# Adding an institution adapter

Add an adapter only when the institution publicly documents a deterministic off-campus access link pattern.

## Required evidence

Verify on the institution's current official website:

1. The institution and campus name.
2. The exact public link or proxy prefix.
3. Who is eligible for remote access.
4. The official access guide URL.
5. The fair-use, licence, or acceptable-use URL.
6. Any download limits stricter than the project default.

Do not infer proxy formats from a user's cookie, browser history, developer tools, or a private session URL.

## Implementation checklist

1. Add one entry to `src/institutions.ts` with a stable kebab-case ID.
2. Keep authentication mode as `user_browser`.
3. Ensure the adapter only prepends or formats a user-visible link; it must not fetch the target.
4. Add positive tests for an HTTPS publisher URL.
5. Add negative tests for credentials, localhost, literal IPs, and an already-proxied URL.
6. Update the skill reference only with policy facts supported by official sources.
7. Submit the adapter without real usernames, screenshots of private accounts, cookies, or licensed PDFs.
