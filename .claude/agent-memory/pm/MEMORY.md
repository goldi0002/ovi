# pm memory

- Product specs live in docs/product/<feature>.md (problem, who, stories, numbered ACs, out of scope, open questions).
- Callers (src/Ovi.Api/Security/Caller.cs): Anonymous, User (cookie, needs X-Ovi-Request on writes), Admin (API key or admin email). Anonymous: random code only, max 30-day expiry, 20 creates/hour/IP. Signed-in and API key: 30 creates/min (RateLimits.cs).
- URL and expiry rules: Links/LinkRules.cs. ACs should say "reuse LinkRules", never restate the rules.
- Bulk shortening (2026-11): docs/product/bulk-shortening.md + docs/decisions/0002. Signed-in and API key only; batch limit min(25, CreatePerMinute); all or nothing; exactly N permits, 400/429 cost 0; 503 when codes fail. Body {urls, expiresAt?}, 201 {items}. AC numbers are stable; new ones are appended (40+).
