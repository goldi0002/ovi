# Architect memory

## Conventions in the code
- Validation errors use `Results.ValidationProblem(dict)`. Keys are camelCase field names; indexed items use `urls[i]` (zero-based). A null body on single create goes under `body`.
- Auth: the `/api/links` group has `CallerFilter` (API key plus throttle, `X-Ovi-Request` on cookie writes, suspended accounts get 403). Signed-in-only endpoints return `SignInRequired()` 401. `VisibleTo(caller)` scopes reads.
- The global Kestrel body limit is 64 KB (Program.cs). Don't raise it per route without a reason.
- Code checks must use `IgnoreQueryFilters()`, because deleted links keep their codes.

## Decisions
- 0002 bulk create: `POST /api/links/bulk`, `{urls, expiresAt?}`, max min(25, CreatePerMinute), all or nothing, 201 `{items}`, 503 when codes can't be made. The create budget moved from the middleware policy to a `CreateBudget` singleton (partitioned on Caller), so a batch costs N permits.

## Pitfalls
- ASP.NET rate-limiting middleware takes 1 permit per request, and its limiters can't be reached from a handler. Don't hand it a shared limiter instance through `RateLimitPartition.Get`, because it disposes idle ones.
- `FixedWindowRateLimiter.AttemptAcquire(n)` throws when n > PermitLimit. Guard for it.
- Messages to teammates cross in flight. Keep the ADR as the single source of truth and point people to it.
