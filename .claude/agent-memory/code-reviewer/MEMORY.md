# code-reviewer memory

- Create budget (ADR 0002): create, PATCH and bulk share `Security/CreateBudget` (a PartitionedRateLimiter keyed on the resolved `Caller`), not the rate-limit middleware. It must run after `CallerFilter`. Endpoint filters run after group filters, so `RequireCreateBudget()` goes on the endpoint.
- `FixedWindowRateLimiter.AttemptAcquire(n)` throws when n > PermitLimit, so a bulk batch is capped at min(25, CreatePerMinute) and anything over gets 400.
- `Uri.AbsoluteUri` keeps a Unicode host. `LinkRules.UrlProblem` now stores punycode via `WithAsciiHost`, and redirects use `RedirectTarget` for older rows. A UriBuilder probe showed no double encoding.
- Tests run in Development, where minimal APIs throw BadHttpRequestException. Program.cs maps it to its own status (400 or 413).
- Pitfall: backend and qa both write integration tests for the same feature, so look for duplicate cases across their files.
- Docker isn't running at session start in cloud containers: `dockerd > /tmp/dockerd.log 2>&1 &` before `dotnet test`.
