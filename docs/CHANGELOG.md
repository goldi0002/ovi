# Changelog

User-facing changes to Ovi, newest first.

## Unreleased

### ARM64 image

- The published image now runs on ARM64 as well as amd64, so Ovi works on a Raspberry Pi 4 or 5 (64-bit OS) and ARM cloud servers. `docker pull` picks the right one automatically.
- CI builds the ARM64 image on every change and runs it under emulation against the compose stack.

### Docker Compose

- New `docker-compose.yml` and `.env.example`: run Ovi with its own Postgres database with `docker compose up -d`. Only three values are required: the public URL, the admin API key and the database password.
- CI now smoke-tests the image through the compose file, including a restart, so the self-hosting path is checked on every change.

### Open source under the AGPL-3.0

- Ovi is now licensed under the [GNU Affero General Public License v3.0](../LICENSE). You can run, change and share it. If you run a changed version as a service for others, you must offer them its source code.
- Settings has a new **About** section linking to the source code, and the FAQ answers "Is Ovi open source?".

### Report a link

- New **Report a link** page (`/report`, linked in the header). Anyone can report a short link as phishing, malware, spam or something else, with optional details of up to 500 characters. No account is needed, and a report stores no IP address, user agent or account.
- Admins get a **Reports** tab in the Admin page, with a badge showing the number of open reports. It lists links with open reports, most reported first, with a count per reason and the latest details. Dismiss or mark as actioned closes a link's reports; delete the link or suspend its owner from the same row.
- New API: `POST /api/reports` (public, needs the `X-Ovi-Request` header, 202 on success), `GET /api/admin/reports` and `POST /api/admin/reports/{code}/resolve`. `GET /api/admin/overview` now includes `openReports`.
- Each client can send 10 reports an hour (`RateLimits__ReportPerHour`). A link keeps at most 50 open reports.
- `report` is now a reserved code and can't be used as a custom code.

### Unsafe sites are refused

- Ovi can now check destination URLs with Google Safe Browsing when you set `SafeBrowsing__ApiKey`. A site flagged for malware, phishing, unwanted software or harmful apps gets 400 with "This site is flagged as unsafe by Google Safe Browsing, so it can't be shortened."
- It applies to making a link, making many links (nothing is created if any line is flagged) and editing a link's URL. Existing links aren't re-checked.
- If Google is slow or down, the link is allowed. See the README's "Abuse protection" section.

### Custom codes and expiries for many links

- In **Many links**, upload a CSV file or paste CSV text whose first line is `url,code,expires_at`. Each row can have its own custom code and expiry; leave a cell empty for a random code or the batch expiry. The downloaded results file works too.
- The API takes `items` (`{ "url", "customCode", "expiresAt" }` each) instead of `urls` on `POST /api/links/bulk`. Errors are listed per row and nothing is created if any row is wrong.

### Shorten many links at once

- Signed-in users can switch the home page form to **Many links**, paste up to 25 URLs (one per line) and shorten them all in one go. One optional expiry applies to every link.
- If any line is wrong, nothing is shortened. Each bad line is listed with its line number and the reason, and your text stays in the field so you can fix it.
- Copy all the new short links at once, one per line in the same order, or download them as a CSV file (`url,short_url,code,expires_at`).
- New API endpoint: `POST /api/links/bulk` with `{ "urls": [...], "expiresAt": "optional" }`. It's for signed-in users and the API key. See the README's "Bulk create" section.
- A batch of N URLs counts as N links against the same rate limit as single create and edit (30 a minute by default). A refused or invalid batch costs nothing.
- A 429 from creating or editing a link now has a problem JSON body and a `Retry-After` header.

### Fixes

- Deleting a link now counts against the same per-minute limit as making and editing links (30 a minute by default). A burst of deletes gets 429 with a `Retry-After` header.
- Links to sites with non-ASCII domain names (for example `https://bücher.example/`) are now stored with the punycode host (`xn--bcher-kva.example`), so visiting them redirects. Before, every visit gave a server error. Links made before this fix redirect too.
- A request body that isn't valid JSON now gets 400, and a body over 64 KB gets 413, instead of a server error.
