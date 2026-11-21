# 0002: Bulk link creation shares the create budget, all or nothing

- **Status:** accepted
- **Date:** 2026-11-18
- **Spec:** `docs/product/bulk-shortening.md`

## Context

Signed-in users and API-key scripts want to shorten a list of URLs in one request. Single create (`POST /api/links`) is limited by the `create` rate-limit policy: 30 requests a minute per user (per IP for the API key), 20 an hour per IP for anonymous visitors, and `PATCH /api/links/{code}` shares that budget. ASP.NET Core's rate-limiting middleware takes exactly one permit per request, and its limiters can't be reached from a handler. A bulk route on the same policy would turn 30 links a minute into 30 x 25.

## Decision

- **Route:** `POST /api/links/bulk` in the existing `/api/links` group, so `CallerFilter` (API key check, `X-Ovi-Request` on cookie requests, suspended accounts) applies unchanged. Body `{ "urls": [string], "expiresAt"?: string }`, at most 25 URLs. Random codes only.
- **Who:** signed-in users and admins (cookie or API key). Anonymous callers get 401. Anonymous links can't be cleaned up by their maker and are the main abuse path.
- **All or nothing:** every URL is checked with `LinkRules.UrlProblem` and the expiry with `LinkRules.ExpiryProblem`. Any problem gives 400 with every error keyed `urls[i]`, and nothing is created. A valid batch is written with one `SaveChanges`, so it's one transaction.
- **One budget, counted in links:** the `create` middleware policy is replaced by a singleton `CreateBudget` (in `Security/`), a `PartitionedRateLimiter<HttpContext>` with the same limits as today. It runs after `CallerFilter`, so it partitions on the resolved `Caller` (API key per IP, account per user, anonymous per IP on the 1-hour window), not on raw headers. Single create and PATCH take 1 permit through an endpoint filter. Bulk takes N permits in the handler, after validation and before any database work. `FixedWindowRateLimiter.AttemptAcquire(n)` takes nothing when it can't grant all n, so a refused batch uses no budget. An invalid batch (400) uses none either.
- **Codes:** a shared helper generates codes for the whole batch, removes repeats within the batch, checks them against every row, deleted ones included, with one `Code IN (...)` query, and replaces any that are taken. It gives up after a fixed number of rounds. Single create uses the same helper with a count of 1. Giving up, or losing the unique-index race at `SaveChanges`, gives bulk a 503 "Couldn't make short codes; try again." (409 would mean a code the caller chose was taken, and here the caller chose none). Nothing was written, so a retry is safe. Permits already taken aren't refunded.

## Alternatives considered

- **Partial success (create the valid items, report the rest):** rejected. The UI flow is paste, fix, resubmit the same text, so a resubmit would silently duplicate every line that had already worked. It would also make "N permits for N links" inexact.
- **A separate `bulk` policy (for example 5 requests a minute):** simpler, but it adds a second budget on top of single create. It wouldn't bound links a minute to what single create allows, and the spec requires one shared budget (AC 18).
- **Keep the middleware policy for single create and add a second limiter for bulk:** two counters that drift apart, so not one budget.
- **Return the middleware's own limiter from `RateLimitPartition.Get`:** the middleware disposes idle limiters it believes it owns, so sharing an instance would break bulk after an idle period.
- **More than 25 items with a raised body limit for this route:** not needed for the user stories. 25 x 2048-character URLs fit the global 64 KB limit, and 25 is below the default 30 a minute, so a full batch fits in a fresh window.
- **Per-item objects (`items: [{ url, customCode?, expiresAt? }]`):** deferred to slice 2 (CSV upload with custom codes). That slice can add an `items` field next to `urls` without breaking slice 1 clients.

## Consequences

- Rate limiting for create and PATCH now runs after `CallerFilter`, not in the middleware. Requests refused for a wrong API key, a missing CSRF header or a suspended account no longer use create budget, which loosens nothing. Wrong API keys are still throttled by `ApiKeyThrottle`. A 429 now carries a problem body and `Retry-After`.
- Single create and PATCH still take their permit before validating, so a 400 there costs 1 permit, as before. A 400 or 429 batch costs none.
- If an operator sets `RateLimits:CreatePerMinute` below 25, the batch limit becomes that number. A larger batch gets 400 under `urls` naming the lower limit, not a 429 it could never get past. `FixedWindowRateLimiter` throws when asked for more permits than its limit, so `CreateBudget` also treats that case as refused and never throws. This is documented in the README configuration table.
- Links in a batch share one `CreatedAt`, so their order on `/links` (newest first, then by id) within the batch isn't promised. The API response is always in input order.
- Requests over 64 KB still get 413 from Kestrel. That only happens with unusually long or heavily escaped URLs.
- Found while building AC 15: on .NET 10, `Uri.AbsoluteUri` keeps a Unicode host as typed, so a link to an internationalised host was stored with non-ASCII characters and returned 500 on every visit (Kestrel won't send a non-ASCII `Location`). `LinkRules.UrlProblem` now stores the punycode host for single create, edit and bulk alike. The redirect converts rows stored the old way with `LinkRules.RedirectTarget`. One side effect: searching `/links` for the Unicode spelling of such a host no longer matches new rows; the punycode spelling does.
- `UseExceptionHandler` maps `BadHttpRequestException` to its own status (400 for malformed JSON, 413 for an oversized body). Before, in Development and tests these surfaced as 500. Production behaviour doesn't change, because there the framework already answers with those codes itself.
