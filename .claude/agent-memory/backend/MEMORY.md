# backend memory

## Conventions
- Tests are MSTest ([TestClass]/[TestMethod]), not xUnit. WebApplicationFactory runs as Development.
- TestServer does not validate response headers; a non-ASCII Location header only 500s on real Kestrel. Check redirects with `dotnet run` + curl.
- `HttpContent` can be read once: read JSON into a variable, don't call ReadFromJsonAsync twice.
- `dotnet ef` needs `dotnet tool restore` first in a fresh container.
- Full test run takes ~1-2 min after build; Docker must be up (`dockerd > /tmp/dockerd.log 2>&1 &`).

## Decisions (bulk shortening, ADR 0002)
- Create/PATCH rate limiting is `Security/CreateBudget.cs` (endpoint filter `.RequireCreateBudget()`, runs after CallerFilter, partitions on Caller), not a middleware policy. Bulk takes N permits in the handler after validation.
- `FixedWindowRateLimiter.AttemptAcquire(n)` throws if n > PermitLimit; CreateBudget.TryAcquire guards it, and bulk caps the batch at min(25, CreatePerMinute) with a 400.
- Code generation: `LinkEndpoints.NewCodesAsync(db, count, generate?)` for single and bulk; giving up or losing the race in bulk = 503 "Couldn't make short codes; try again."
- `Uri.AbsoluteUri` keeps Unicode hosts on .NET 10. `LinkRules.WithAsciiHost` (in UrlProblem) stores punycode; `LinkRules.RedirectTarget` converts legacy rows at redirect time.
- Program.cs exception handler maps BadHttpRequestException to its own status (400/413) so behaviour doesn't depend on environment.
- `CodeSource` (Links/CodeGenerator.cs, singleton) is the DI seam for random codes; tests replace it to force collisions.
- Test split with qa: BulkLinkTests.cs = happy path + basic validation/auth; BulkLinkEdgeTests.cs (qa) = limits, budget, codes, edge cases. Don't duplicate across them.
