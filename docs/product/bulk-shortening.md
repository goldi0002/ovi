# Bulk link shortening

Status: framed (pm); open questions 1-3 decided by the lead on 2026-11-18. Owner of this file: pm.

## Problem

Today a short link is made one at a time: `POST /api/links` takes one URL, and the home page form (`web/src/components/ShortenCard.tsx`) has one URL field. Someone with a list of URLs, such as a newsletter's links, a printed flyer's QR codes or a spreadsheet of product pages, has to paste, shorten and copy each one in turn. For 20 links that is 60 actions and easy to get wrong. A script can loop over the single endpoint, but it then has to handle each failure itself and quickly hits the create rate limit.

## Who it is for

What single create allows today (from `LinkEndpoints.CreateLink`, `RateLimits.cs`, README "Callers"):

| Caller | Single create today | Bulk create (this feature) |
|---|---|---|
| Anonymous visitor | Yes; random code only, expires in at most 30 days; 20 creates per hour per IP | **No.** 401 with "Sign in to shorten many links at once." |
| Signed-in user (cookie + `X-Ovi-Request`) | Yes; custom code, any expiry up to 10 years or none; 30 creates per minute per user | **Yes** |
| Admin (signed-in admin or `X-Api-Key`) | Yes; same as a user; API key budget is 30 per minute per IP | **Yes** |

Why not anonymous: anonymous links are the easiest abuse path (spam and phishing lists), their budget is 20 per hour, and an anonymous user can't see or delete links afterwards, so a bad batch can't be cleaned up. Signing in is free and one click. Decided by the lead (2026-11-18).

## User stories

1. As a signed-in user, I paste a list of long URLs, one per line, and get a short link for each, so I can shorten a whole newsletter at once.
2. As a signed-in user, I copy all the new short links in one click, in the same order as my input, so I can paste them back into my spreadsheet column.
3. As a signed-in user, I download the results as a CSV file (original URL, short URL), so I can keep or share the mapping.
4. As a signed-in user, when some lines are wrong, I see exactly which lines and why, and fix them without retyping the rest.
5. As a script author with the API key, I send one request with many URLs and get one response with every link in order.

## Decisions

The lead decided the first three on 2026-11-18. pm made the rest when framing.

- **Signed-in users and the API key only.** Anonymous callers get 401 (see "Who it is for").

- **One request, all or nothing.** The batch is validated in full first. If any item is invalid, nothing is created and the response lists every invalid item by its position. This avoids half-created batches, which would make a retry create duplicates. Rejected alternative: create the valid items and return a status for each item.
- **Random codes only.** Items have no custom code in this slice.
- **One optional expiry for the whole batch,** with the same rules as single create (`LinkRules.ExpiryProblem`).
- **Bulk and single create share one budget.** A batch of N URLs counts as N creates against the caller's existing create rate limit, so bulk can't be used to make more links per minute than single create allows.
- **Max batch size: 25 URLs.** This is below the default budget of 30 per minute, so a full batch fits in a fresh window, and keeps each request small (25 x 2048 characters is about 50 KB, inside the 64 KB body limit). If an operator sets `RateLimits:CreatePerMinute` below 25, the batch limit drops to that number, and a larger batch gets 400 under `urls` naming the lower limit, not a 429 that could never clear (see AC 7). The README config table must say so. architect's refinement of the lead's decision, recorded in `docs/decisions/0002-bulk-link-creation.md`.
- **Results are produced in the browser.** Copy and CSV download need no new endpoint.

## Acceptance criteria

Numbers are stable: new criteria get the next free number (40 on), placed in their section, so references from tests and reviews stay valid.

### API

Contract: `POST /api/links/bulk`, body `{ "urls": ["https://..."], "expiresAt": "optional" }`, response 201 `{ "items": LinkResponse[] }` (the single create shape), or 503 "Couldn't make short codes; try again.", which is safe to retry (AC 40). See `docs/decisions/0002-bulk-link-creation.md`.

**Auth and CSRF**

1. Given no session cookie and no API key, when a client calls bulk create, then it gets 401 with the title "Sign in to shorten many links at once." and no link is created.
2. Given a signed-in user's cookie without the `X-Ovi-Request` header, when they call bulk create, then they get 403 (the existing CSRF check) and no link is created.
3. Given a suspended user's cookie, when they call bulk create, then they get 403 "This account is suspended." and no link is created.
4. Given a wrong `X-Api-Key`, when a client calls bulk create, then it gets 401 and the wrong key counts towards the API key failure throttle, as on every other endpoint.
5. Given a signed-in user, when the batch succeeds, then every new link is owned by that user and appears in their `GET /api/links` list and on `/links`. Given the API key, the links are owned by no user and are not anonymous (same as single create with the key).

**Input**

6. Given a body with a missing, null or empty `urls` list, then the response is 400 with an error under `urls` ("Add at least one URL.") and nothing is created.
7. Given more URLs than the batch limit, then the response is 400 with an error under `urls` naming the limit ("You can shorten at most 25 URLs at once.") and nothing is created. Exactly the limit succeeds. The batch limit is 25, or `RateLimits:CreatePerMinute` if that is lower: with `CreatePerMinute` = 10, 11 URLs give 400 "You can shorten at most 10 URLs at once." (not 429), and 10 URLs succeed in a fresh window.
8. Given a request body that is not valid JSON, then the response is 400, not 500.
9. Each URL is checked with `LinkRules.UrlProblem`, exactly as single create checks it (empty, too long, not http/https, user info, unsafe characters, already an Ovi link, blocked host). The rules are reused, not copied.
10. Given a batch where one or more URLs are invalid, then the response is 400, nothing is created, and the errors are keyed by zero-based position (for example `errors["urls[3]"] = ["Enter a full web address starting with http:// or https://."]`), with the same message single create would give for that URL. Every invalid item is reported, not only the first. The API does not skip blank items (skipping blank lines is UI only): `["https://a.test", "", null]` gives 400 with `errors["urls[1]"]` and `errors["urls[2]"]` both `["Enter a URL to shorten."]`, and a null element never causes a 500.
11. Given the same URL more than once in a batch, then each occurrence gets its own new link, so results line up one to one with the input.
12. Given a batch-wide `expiresAt` (top-level field, next to `urls`), it is checked with `LinkRules.ExpiryProblem` (future, at most 10 years) and an invalid one is a 400 under `expiresAt` with nothing created. A valid one is set on every link in the batch. Without it, the links never expire.
13. The body is `{ "urls": [string], "expiresAt"?: string }`. Unknown fields, for example `customCode`, are ignored: the request succeeds as if they were absent, and every link gets a random code.

**Success**

14. Given a valid batch of N URLs, then the response is 201 with body `{ "items": [...] }` holding N links in the same order as the input, each in the same shape as a single create response (`code`, `shortUrl`, `qrCodeUrl`, `url`, `clicks`, `createdAt`, `lastClickedAt`, `expiresAt`), and each short link redirects to its URL.
15. Stored URLs are normalised as in single create (`AbsoluteUri`: punycode hosts, percent-encoded paths), so a non-ASCII URL in a batch redirects without a 500.
16. Every code in the batch is unique, both within the batch and against every existing link, including deleted ones. Collisions with the database (live and deleted links) are tested directly. An in-batch collision is tested through an injectable code generator if backend adds one cheaply; otherwise reviewer signs off on the code path and the unique index on `Code` is the backstop.
17. The batch is created atomically: if the database write fails part way, no link from the batch remains.

**Rate limits**

18. A batch of N URLs costs exactly N permits in total from the caller's existing create budget (per user, or per IP for the API key), shared with single create. There is no extra permit for the request itself, so if the route keeps the standard per-request policy, that permit counts as one of the N. Example with the default 30 per minute: a 25 URL batch succeeds, then a 10 URL batch in the same minute gets 429, then a 5 URL batch in the same minute succeeds (25 + 0 + 5 = 30). qa asserts this example literally.
19. Given a valid batch larger than the remaining budget, then the response is 429, nothing is created, and nothing is taken from the budget (a rejected call costs 0). The response says to try again shortly (a `Retry-After` header if the limiter provides one).
20. The checks run in this order: auth (401/403), then body, size and per-item validation (400), then the budget (429). So an invalid 30 URL batch gets 400, not 429, and a 400 costs 0 permits.
21. No existing rate limit is weakened, and single create limits behave as before (existing tests stay green). Anonymous single create keeps its 20 per hour per IP budget, and single create and PATCH still cost 1 permit each, including when they return 400.
40. Given random codes can't be made for the batch, or the batch loses a unique-code race when it is saved, then the response is 503 with the title "Couldn't make short codes; try again.", no link from the batch exists, and the same request sent again can succeed. (Permits already taken are not refunded.)

### Web UI

Layout and copy are ux's call; these criteria fix the behaviour.

22. Given a signed-in user on the home page, they can switch from single to bulk shortening by keyboard and pointer. Single create stays the default and works as before.
23. Given a signed-out visitor, the bulk option is not usable; they see "Shortening many links at once needs an account. It's free with Google or GitHub." with a Log in action. No bulk request is sent.
24. The bulk input is a multi-line text field, one URL per line. Leading and trailing spaces on a line are trimmed and blank lines are ignored. A live count shows how many URLs are entered, against the limit of 25.
25. Given more than 25 non-blank lines, the submit button is disabled and the count explains the limit. Given zero, submit is disabled.
26. Given the server returns per-item errors, then each error is shown next to or listed with its line number and the URL it refers to, the text stays in the field so the user can fix it, and focus moves to the error summary, which is announced to screen readers. The summary reads "N lines need fixing. Nothing was shortened." (N is the number of bad lines), followed by one item per bad line: "Line N: <url> — <server message>", where N is the 1-based line number in the field, blank lines included.
27. Given a 429, then the user sees "You've made a lot of links in the last minute. Try again in a minute." and the text stays in the field.
28. Given a 401 (session expired), then the user sees "You were signed out. Copy your list first, then log in again to shorten many links.", the text stays in the field (selectable and copyable) until the user leaves the page, and a Log in button replaces submit, on its own row with no text beside it, so the instruction appears only once (in the alert). Focus moves to that Log in button. The copy must not promise that the list survives sign-in: Google and GitHub sign-in leave the page, so the list is lost. (This differs from single create's message on purpose: bulk has no "without an account" option.) Keeping the list across sign-in is out of scope for this slice.
41. Given a 400 with an error under `urls` (for example the batch limit), or a 503 with a problem body, then the user sees the server's message (the `urls` error or the problem title), and the text stays in the field with submit enabled so they can retry. Any other failure (a 503 without a problem body, another 5xx, a 413 or a network error) shows "Couldn't shorten the links. Try again.", never a raw status such as "Request failed (503).".
29. While a batch is being created, the submit button shows a busy state and can't be pressed again.
30. Given a successful batch, then the results list every link in input order with its short URL (a link) and the original URL, and the input is cleared.
31. "Copy all" copies the short URLs, one per line, in input order, with no extra text, and confirms the copy in the same way as the existing copy button.
32. Each result row has its own copy button for its short URL.
33. "Download CSV" saves a file named like `ovi-links-YYYY-MM-DD.csv` with a header row `url,short_url,code,expires_at` and one row per link in input order. Values are quoted and escaped per RFC 4180, so commas and quotes in URLs survive, and the file opens correctly in Excel and Google Sheets. Every column is guarded against formula injection: a value starting with `=`, `+`, `-` or `@` gets a single quote `'` in front, inside the quoted cell (for example code `-abc123` is written as `"'-abc123"`). Random codes can't start with `-` (`CodeGenerator` has no `-` in its alphabet), but the builder guards every column anyway. The CSV builder is a pure exported function (file and name are frontend's call) so that qa can unit-test it.
34. The download works under the existing CSP (no inline script, `script-src 'self'`); the CSP is not changed.
35. After a successful batch, the new links appear on `/links` without a full reload being needed when the user goes there.
36. At phone width (360 px), the text field, the count, the buttons and the results fit with no horizontal page scroll; long URLs wrap or truncate with the full URL available.
37. Light and dark mode both use the colour tokens from `web/src/styles.css`; no hard-coded colours.
38. Every control has a visible label or accessible name, the whole flow works by keyboard only, and results are announced politely to screen readers.

### Docs

39. The README API table lists the bulk endpoint with who may call it, the body, the 25 URL limit, how it counts against the rate limit and the 503. The configuration table says that a `RateLimits:CreatePerMinute` below 25 also lowers the batch limit. `llms.txt` and the FAQ mention bulk shortening if they describe creating links.

## Out of scope (this slice)

- Anonymous bulk shortening.
- Custom codes per item, or a code prefix for a batch.
- A different expiry per item.
- Uploading a CSV or spreadsheet file (paste only). Import of extra columns.
- Partial success (creating the valid items and skipping the invalid ones). Rejected by the lead on 2026-11-18.
- Batches over 25, background jobs, or progress for long batches.
- Bulk QR code download (for example a ZIP of PNGs). Each result keeps its QR code URL in the API response; the UI only needs to show links.
- Bulk edit and bulk delete of existing links.
- Keeping the pasted list across a sign-in round trip, for example in `sessionStorage`. Candidate for a later slice.
- De-duplicating against links the user already has.
- Server-side CSV export.
- Tags, folders or campaigns for a batch.

## Later slices (in order)

1. **This slice:** paste up to 25 URLs, signed in or API key, all or nothing, copy and CSV.
2. CSV file upload with optional per-row custom code and expiry. (Built: `items` in the API, CSV header `url,code,expires_at` in the box or via Upload CSV. Quoted cells stay on one line.)
3. ZIP of QR codes for a batch.
4. Bulk delete from `/links`.

## Open questions

None open. The contract details (route, field names, whether an invalid batch uses 0 or 1 permits) are architect's.
