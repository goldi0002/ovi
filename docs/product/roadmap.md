# Ovi roadmap

A simple, proposed plan after 1.0.0. Order and scope can change; each item ships as its own PR with tests.

## 1.1 Manage links better (now)

- **Search, sort and filter** links on the dashboard (by tag, status, expiry).
- **Tags or folders** to group links, plus bulk actions (delete, change expiry, tag).
- **QR options**: SVG download, size and colour choices.
- **Export your data**: all links and stats as CSV or JSON.

## 1.2 Smarter redirects (next)

- **Password-protected links**.
- **One-time and click-limited links** (for example "expires after 100 clicks").
- **Scheduled activation**: a start date as well as an expiry.
- **Device targeting**: a different URL for mobile visitors. Country targeting only if it can be done without storing IP addresses.
- **Custom expired and 404 page**.

## 1.3 Teams and integrations (later)

- **Multiple, scoped, revocable API keys** per user.
- **Webhooks** on link creation, expiry and click milestones.
- **Custom domains**.
- **Workspaces or teams** with roles (owner, editor, viewer).

## Ongoing: quality and operations

- Stats upgrades: period comparison, referrer grouping, optional digest.
- Prometheus `/metrics` endpoint and structured logs.
- OpenAPI spec and Swagger page.
- Safe Browsing re-checks of existing links.
- Backup and restore guide for self-hosters.
- Browser extension.

## Suggested order

1. Search and tags (cheap, visible).
2. Data export and an OpenAPI spec.
3. Click-limited and password links.
4. Multiple API keys, then webhooks.
5. Custom domains last (most infrastructure and security risk).

## Rules for every item

- Tests with every behaviour change; URL and expiry validation stays in `Links/LinkRules.cs`.
- Never weaken the CSP, rate limits or the `X-Ovi-Request` check.
- Anything that stores new visitor data needs a privacy review first: "no IP addresses" is a selling point.
- One topic per PR.
