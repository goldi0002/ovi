# qa memory

- Backend tests are MSTest ([TestClass]/[TestMethod]/[DataRow]) despite docs saying xUnit. Each test makes its own `OviApiFactory` (own DB in one shared Testcontainers Postgres).
- Factory sets all rate limits to 1000; pass `new() { ["RateLimits:CreatePerMinute"] = "2" }` to test 429. Limiters use real time (fixed 1 min window), not FakeTimeProvider; keep limit tests to a few fast requests.
- Clients: `CreateAuthedClient()` (API key = admin), `CreateUserClientAsync("key", csrfHeader:false)`, `CreateUnauthedClient()`. Blocked-user flow: see AdminTests "Suspending_a_user...".
- `web/src/test/fakeApi.ts` belongs to frontend (not a *.test.* file); ask frontend for fake endpoints.
- Baseline 2026-11-18: 196 backend tests green in ~40s; Docker started via `dockerd > /tmp/dockerd.log 2>&1 &`.
- Bulk shortening (2026-11): ACs in docs/product/bulk-shortening.md; backend writes BulkLinkTests.cs, qa writes BulkLinkEdgeTests.cs.
- Tests run in Development: minimal-API bad JSON used to 500 there (ThrowOnBadRequest); fixed by StatusCodeSelector in Program.cs. Keep Malformed_bodies_get_400_not_500.
- Uri.AbsoluteUri does NOT punycode hosts on .NET 10.0.115; TestServer doesn't validate headers, so a non-ASCII Location only 500s on real Kestrel. Verify IDN changes with `dotnet run` (launchSettings -> http://localhost:5027) + curl.
- Bulk budget (decision 0002): CreateBudget counts links; bulk = N permits after validation; single/PATCH = 1 before validation; max batch = min(25, CreatePerMinute).
