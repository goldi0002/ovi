# security memory

- Create rate limit (Security/RateLimits.cs): fixed window, 1 permit per request; user 30/min, anon 20/h per IP, API key keyed by IP. Any multi-item endpoint must consume one permit per item from the same partition.
- Global Kestrel body limit 64 KB (Program.cs). Raise per endpoint only.
- CSRF: CallerFilter on the /api/links group enforces X-Ovi-Request for cookie callers on non-GET. New routes must sit in that group.
- URL checks: LinkRules.UrlProblem (userinfo, self, blocked host, unsafe chars, store AbsoluteUri). Never copy.
- Since bulk (ADR 0002): create/PATCH limits are CreateBudget (Security/CreateBudget.cs), an endpoint filter after CallerFilter, counted per link. The middleware "create" policy is gone. Bulk = POST /api/links/bulk, signed-in or API key, max min(25, CreatePerMinute), all or nothing.
- UrlProblem now stores punycode hosts (WithAsciiHost keeps userinfo/port/query, so later checks still see them); redirect uses LinkRules.RedirectTarget for legacy Unicode rows.
- Known open (lead has draft issue): DELETE /api/links/{code} has no rate limit.
