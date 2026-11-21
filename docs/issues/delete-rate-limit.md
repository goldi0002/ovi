# DELETE /api/links/{code} has no rate limit

**Severity:** low (found during the bulk shortening security review; not part of that PR)

## Details

`src/Ovi.Api/Links/LinkEndpoints.cs:62-69` maps `DELETE /api/links/{code}` without a rate limit. Create, PATCH and stats are limited. Each DELETE runs CallerFilter's Users lookup plus an `UPDATE ... WHERE code = @code`; soft deletes cost one write per call.

## Scenario

1. A signed-in user, or a script with a stolen session cookie or the API key, sends DELETEs as fast as it can. With a stolen session it can wipe that user's links with no throttle. Codes are random 7-character strings, so guessing others' codes is impractical, but anyone with the link list has every code.
2. As DoS: an unthrottled loop of DELETEs on non-existent codes costs one Users read and one indexed UPDATE per request. Cheap, but unbounded, and it can wake Neon from suspend.

## Suggested fix

Put DELETE under a per-caller budget applied after CallerFilter: either reuse the create budget filter (as PATCH does, treating "changing links" as one budget), or add a modest "modify" policy (for example 60 a minute per user or API-key client).

## Tests

- N+1 deletes within a minute give 429 with `Retry-After`.
- The budget is per account.
