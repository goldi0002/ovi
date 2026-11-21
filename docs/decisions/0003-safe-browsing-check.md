# 0003: Check destinations with Google Safe Browsing, and fail open

- **Status:** accepted
- **Date:** 2026-11-21

## Context

Anyone can shorten a URL without signing in, so Ovi can be used to hide phishing and malware links behind a trusted-looking address. `Links:BlockedHosts` stops known bad sites, but an operator has to maintain it by hand. Google Safe Browsing keeps a large, current list and has a Lookup API (`threatMatches:find`) that answers for a batch of URLs in one request.

## Decision

- **Where:** `IUrlThreatCheck` (`Security/UrlThreatCheck.cs`), called from single create, bulk create and `PATCH` when the URL changes. It's off unless `SafeBrowsing:ApiKey` is set. `SafeBrowsing:TimeoutSeconds` (default 3, minimum 1, bad values fall back to 3) bounds each call.
- **Threat types:** malware, social engineering, unwanted software, potentially harmful applications.
- **Fail open:** if Google times out, errors or answers badly, the link is allowed and a warning is logged. A 429 (quota) or 403 (key refused) logs an error instead, because the owner has to act, and the link is still allowed. Ovi must keep working when Google doesn't.
- **Key in the query string:** the Lookup API takes `?key=`. The owner chose this over a header. To keep the key out of logs, the named `HttpClient` has its built-in logging removed, and our log lines carry only the status code or exception type.
- **Order:** the check runs after the normal URL rules and after the create rate limit has been taken, so it can't be used as a free lookup service by callers who would be refused anyway. Only a changed URL is checked on `PATCH`.
- **Bulk:** one Google request for the whole batch. Matches are placed on the URLs sent by exact match first (Google usually echoes what was sent). If that fails, compare on host and path, then on the host. A match that can't be placed on any sent URL flags every URL sent (fail closed), because Google did find something bad. Flagged lines get `urls[i]` or `items[i].url` errors and nothing is created.

## Alternatives considered

- **Fail closed (refuse links when Google can't answer):** safer, but a Google outage or an exhausted quota would stop all shortening. Rejected.
- **Web Risk API:** Google's commercial option. Safe Browsing's terms are for non-commercial use, which fits this self-hosted project. An operator who needs commercial use can switch later behind the same interface.
- **Sending the key in a header:** keeps it out of URLs. Rejected by the owner in favour of the documented query parameter, with logging removed to compensate.
- **Check before the rate limit:** would let anyone probe Google's list through Ovi. Rejected.
- **Local blocklist only:** needs manual upkeep and misses new threats.

## Consequences

- Unsafe links can be created while Google is down or the quota is used up. Operators should watch for the error log lines.
- Links that already exist aren't rescanned, so a site that turns bad later still redirects.
- A bulk batch refused by this check still costs its N permits, because the check runs after the budget is taken.
- Each checked create adds up to `SafeBrowsing:TimeoutSeconds` of latency in the worst case.
- The README's "Abuse protection" section documents setup and behaviour.
