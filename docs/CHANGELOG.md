# Changelog

User-facing changes to Ovi, newest first.

## Unreleased

### Shorten many links at once

- Signed-in users can switch the home page form to **Many links**, paste up to 25 URLs (one per line) and shorten them all in one go. One optional expiry applies to every link.
- If any line is wrong, nothing is shortened. Each bad line is listed with its line number and the reason, and your text stays in the field so you can fix it.
- Copy all the new short links at once, one per line in the same order, or download them as a CSV file (`url,short_url,code,expires_at`).
- New API endpoint: `POST /api/links/bulk` with `{ "urls": [...], "expiresAt": "optional" }`. It's for signed-in users and the API key. See the README's "Bulk create" section.
- A batch of N URLs counts as N links against the same rate limit as single create and edit (30 a minute by default). A refused or invalid batch costs nothing.
- A 429 from creating or editing a link now has a problem JSON body and a `Retry-After` header.

### Fixes

- Links to sites with non-ASCII domain names (for example `https://bücher.example/`) are now stored with the punycode host (`xn--bcher-kva.example`), so visiting them redirects. Before, every visit gave a server error. Links made before this fix redirect too.
- A request body that isn't valid JSON now gets 400, and a body over 64 KB gets 413, instead of a server error.
