# Ovi

[![CI](https://github.com/goldi0002/ovi/actions/workflows/ci.yml/badge.svg)](https://github.com/goldi0002/ovi/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Image](https://img.shields.io/badge/image-ghcr.io%2Fgoldi0002%2Fovi-blue)](https://github.com/goldi0002/ovi/pkgs/container/ovi)

**A URL shortener you can run yourself**, with QR codes and click stats that don't track people. One container and a Postgres database, on amd64 or ARM64.

Try it at **[getovi.link](https://getovi.link)**, or [run your own in two minutes](#self-host-with-docker-compose).

[![Try it live](https://img.shields.io/badge/try%20it-getovi.link-black)](https://getovi.link)
[![Run with Docker Compose](https://img.shields.io/badge/run%20it-docker%20compose-2496ED?logo=docker&logoColor=white)](#self-host-with-docker-compose)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/goldi0002/ovi)

![Shortening a link on Ovi: the short link, its QR code, and Copy, Open and QR code buttons](docs/screenshots/home.png)

| Your links | Click stats, in dark mode |
|---|---|
| ![The My Links page: short links with their destination, clicks, age and status](docs/screenshots/links.png) | ![Stats for one link: clicks per day over 30 days, and the top referrers, devices and browsers](docs/screenshots/stats-dark.png) |

The admin dashboard: totals, clicks over the last 14 days, top links, and tabs for users, links and reported links.

![The admin dashboard: totals for users, links and clicks, a clicks-per-day chart, top links, and tabs for users, links and reports](docs/screenshots/admin.png)

## Features

- **Short links without an account.** Paste a URL and get a short link and a QR code. Anonymous links expire after 30 days.
- **Accounts with Google or GitHub** (optional): custom codes, your own expiry dates or none, and a list of every link you've made.
- **Many links at once**: paste up to 25 URLs, or upload a CSV with a custom code and expiry per link.
- **Click stats that respect visitors**: clicks per day, referring sites, devices and browsers. No IP addresses or full user agents are stored.
- **A QR code for every link**, as a crisp PNG.
- **An admin dashboard**: every user and link, totals, suspending accounts, and a queue of links people reported.
- **Abuse protection**: rate limits, a blocklist, an optional Google Safe Browsing check on new links, and a public **Report a link** page.
- **An HTTP API** with an admin API key, documented below.
- **Installable** as an app on phones and desktops, with light and dark mode.
- **Small and stateless**: one container, all data in Postgres, migrations on start. Several instances can share one database.

## Why Ovi

Ovi is for people who want a short-link service they can run in a couple of minutes, with stats that don't follow visitors around. How it compares with the usual self-hosted choices, going by their public documentation (check them for the details that matter to you):

| | **Ovi** | [Shlink](https://shlink.io) | [YOURLS](https://yourls.org) | [Dub](https://dub.co) |
|---|---|---|---|---|
| Runs as | One container plus Postgres | A server, with a separate web client or its own UI | A PHP app on a web server | A larger stack of separate services |
| Web UI included | Yes, in the same container | Separate project | Yes | Yes |
| QR code for every link | Yes, built in | Yes | Via plugin | Yes |
| Click stats that never store IP addresses or full user agents | Yes, by design | See its docs | See its docs | See its docs |
| Licence | AGPL-3.0 | MIT | MIT | AGPL-3.0 core |

Choose Shlink if you want a mature, API-first service with many integrations, YOURLS for its plugin ecosystem, and Dub for a full link-management product. Choose Ovi if you want something small, with a UI and QR codes out of the box, and privacy-respecting stats from the first click. If something in the table is out of date, [open an issue](https://github.com/goldi0002/ovi/issues).

## Self-host with Docker Compose

The quickest way to run your own Ovi: the app and a Postgres database, from the published image. It runs on amd64 and ARM64 (a Raspberry Pi 4 or 5 with a 64-bit OS, or an ARM cloud server).

```bash
curl -O https://raw.githubusercontent.com/goldi0002/ovi/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/goldi0002/ovi/main/.env.example
# Edit .env: set OVI_PUBLIC_URL, OVI_API_KEY (openssl rand -hex 32) and POSTGRES_PASSWORD (openssl rand -hex 24)
docker compose up -d
```

Ovi is then on http://localhost:8080. Sign in as the admin with **Sign in → Admin? Use an API key** and the `OVI_API_KEY` value. The database lives in the `ovi-db` volume, and migrations run on start, so upgrading is `docker compose pull && docker compose up -d`. The compose file uses the `1` image tag, so that picks up every 1.x release but never a 2.0 that could need changes on your side (see [Image tags](#image-tags)).

For a public site, put a reverse proxy with TLS in front of it. With [Caddy](https://caddyserver.com), which gets the certificate for you, a `Caddyfile` of

```
links.example.com {
    reverse_proxy localhost:8080
}
```

is enough. Set `OVI_PUBLIC_URL` to that address, and see [Deploying behind a reverse proxy](#deploying-behind-a-reverse-proxy) so rate limits see real client IPs. Sign-in with Google or GitHub, admin emails and the Safe Browsing check are commented out in `docker-compose.yml`: uncomment the lines you need and set the values in `.env`.

## Run with Docker

To use your own Postgres instead, build or pull the image and pass the settings yourself:

```bash
docker build -t ovi .
docker run -d -p 8080:8080 \
  -e DATABASE_URL='postgresql://user:pass@host/db?sslmode=require' \
  -e Auth__ApiKey='a-long-random-secret' \
  -e App__PublicBaseUrl='https://your.domain' \
  ovi
```

The container runs as a non-root user. It keeps no local state: all data is in Postgres.

## Using Ovi

The web app is served by the API itself at `/`, so there's one address and no CORS setup.

- A simple design after macOS: black text on white, the system font, a translucent toolbar with a Shorten / Links segmented control, and sheet-style dialogs. It works from 320px phones up, and long URLs and codes are cut off or wrapped instead of stretching the page.
- The home page is just the shortener.
- Anyone can paste a URL and press **Shorten URL**, no account needed. Those links get a random code and expire after 30 days.
- **Sign in** with Google or GitHub. The first sign-in creates the account, so there's no separate sign-up. Signed-in users can pick a custom code and expiry (or none), and see their links and stats.
- The admin can choose **Admin? Use an API key** in the Sign in dialog. The key is kept for the browser tab, or on the device with **Remember on this device**, and gives access to every link.
- Copy the result or download its QR code.
- Signed-in users can switch the form to **Many links** and paste up to 25 URLs, one per line, with one optional expiry for all of them. Blank lines are skipped. To choose a custom code and expiry per link, upload a CSV (or paste one) whose first line is `url,code,expires_at`. If any line is wrong, nothing is shortened and each bad line is listed with its line number. The results can be copied all at once (one short URL per line, in input order) or downloaded as a CSV file (`url,short_url,code,expires_at`).
- The **Links** page (`/links`) lists your links (every link for the admin) (a table on wide screens, cards on phones) with clicks, creation time and status (active, expiring, expired); search them, filter by status (all, active, expired), sort them (newest, most clicked, expiring soon), page through them and delete them. The search, filter and sort are kept in the address (`/links?q=docs&status=active&sort=clicks`), so you can bookmark or share a view.
- Anyone, signed in or not, can open **Report a link** (`/report`, linked in the header) to tell the admin about a short link that scams, infects or spams people. Paste the short link or its code, choose phishing, malware, spam or other, and add optional details (up to 500 characters). A report stores only the link, the reason, the details and the time: no IP address, user agent or account. The page can be pre-filled with `/report?link=abc123`.
- Admins get an **Admin** page (`/admin`):
  - totals and clicks over the last 14 days
  - the top links
  - every user, with their links and clicks; an admin can suspend or restore a user
  - every link, with its owner; filter by owner (anonymous, API key or one user), search, open its stats, or delete it
  - a **Reports** tab, with a badge showing the number of open reports, listing links with open reports, most reported first: the number of reports, a count per reason, the latest details people wrote (up to 5), and the link's owner. Dismiss or mark as actioned closes all of a link's open reports; you can also delete the link or suspend its owner from there
- Open **Stats** on any link for its clicks per day over the last 7, 30 or 90 days, its top referrers, and the devices and browsers visitors used. Each click stores only the time, the referring site's name (no page path), and a device and browser category: no IP address or full user agent.

## Deploy to Render

[`render.yaml`](render.yaml) is a [Render Blueprint](https://render.com/docs/blueprint-spec) for one Docker web service:
- It builds from the `Dockerfile` and runs on Render's **free plan**.
- It uses the `/health` check, and stores data in Neon Postgres.
- It deploys new commits on `main` only after their GitHub checks (CI) pass.

One-time setup:

1. In the [Render dashboard](https://dashboard.render.com), choose **New → Blueprint** and connect this repository. Render reads `render.yaml` and creates the `ovi` service.
2. Render asks for `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Copy them from `neon env pull` (`.env.local`) or the Neon Console's **Connect** dialog: the pooled string (host ends in `-pooler`) for `DATABASE_URL`, the direct one for `DATABASE_URL_UNPOOLED`. For a service created before these were added, set them in the service's **Environment** tab.
3. Render generates a random `Auth__ApiKey`. Copy it from the service's **Environment** tab. This is the admin key: it sees and manages every link.
4. Turn on sign-in (see [Sign-in with Google and GitHub](#sign-in-with-google-and-github)). Without it, the site still works, but only for anonymous links and the admin.
5. The service is live at its `https://<name>.onrender.com` URL. Short URLs use that address automatically through `RENDER_EXTERNAL_URL`. To use a custom domain, add it in Render and set `App__PublicBaseUrl`.

On the free plan a service sleeps after about 15 minutes without traffic, and the next request takes up to a minute to wake it. To avoid that, `render.yaml` turns on `KeepAlive__Enabled`: a background service pings the app's own public URL (`/health/live`) every 10 minutes, through Render's proxy, so it never goes idle. That keeps one instance up all month, about 744 of the workspace's 750 free instance hours, so turn it off if you run other free services. `/health/live` doesn't touch the database, so the pings don't keep Neon awake. Links are kept in Neon, so they survive restarts and deploys.

## Sign-in with Google and GitHub

Each provider turns on when both its client id and secret are set. Use the site's public address (e.g. `https://ovi.onrender.com`) in place of `<site>` below.

**Google**
1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create a project, set up the **OAuth consent screen** (External, app name "Ovi", scopes `openid`, `email`, `profile`), then **Create credentials → OAuth client ID → Web application**.
2. Add the authorized redirect URI `<site>/auth/callback/google`.
3. In Render, set `Auth__Google__ClientId` and `Auth__Google__ClientSecret`.
4. Publish the consent screen (**Publishing status → In production**); until then only test users you list can sign in.

**GitHub**
1. Go to **GitHub → Settings → Developer settings → [OAuth Apps](https://github.com/settings/developers) → New OAuth App**.
2. Set the homepage URL to `<site>` and the authorization callback URL to `<site>/auth/callback/github`.
3. Generate a client secret, then set `Auth__GitHub__ClientId` and `Auth__GitHub__ClientSecret` in Render.

For local development, register separate apps with `http://localhost:5080` as the site, and put their values in [user secrets](https://learn.microsoft.com/aspnet/core/security/app-secrets) (`dotnet user-secrets set Auth:GitHub:ClientId …` in `src/Ovi.Api`).

How it works:
- After the provider sends the person back, Ovi creates or updates their account. It stores only the provider, the provider's id, a name and an email.
- Ovi then sets an HttpOnly, `SameSite=Lax`, `Secure` session cookie that lasts 30 days and renews while in use.
- The cookie carries a security stamp that is checked against the account on every request. Logging out changes it, so a copied cookie stops working too (that ends every session for the account, on every device).
- The keys that encrypt the cookie are stored in Postgres, so deploys and restarts don't sign anyone out. Set `DataProtection:CertificatePath` to encrypt that key ring with a certificate: without it, anyone who can read the database can read the keys.
- Requests that change data with the cookie must carry `X-Ovi-Request: 1`, which other sites can't add, so they can't act as a signed-in user (CSRF).
- A cancelled or failed sign-in returns to `/?login=failed`, and the UI shows a message.

## Admins

There are two ways to be an admin:
- **The API key** (`Auth__ApiKey`): for scripts, and as a fallback.
- **Your own account:** sign in with Google or GitHub using an email listed in `Auth__AdminEmails` (comma-separated, e.g. `you@gmail.com`). The **Admin** item then appears in the header.

How the role checks work:
- **Server-side only.** The browser can't grant or claim it: a role header, a guessed key or a changed page gets nothing. The Admin item in the UI is only a shortcut.
- **Verified emails only.** Admin rights need an email the provider confirmed. That's Google's `email_verified`, or GitHub's primary verified address. An account showing an unverified copy of an admin's email gets nothing.
- **Checked on every request.** The session holds just an account id. Each `/api` request loads the account and checks it against the current `Auth__AdminEmails`, so removing an email (and redeploying) or suspending a user takes effect on their next request, not when their cookie expires.
- **Guarded by one group.** Every `/api/admin` route is in a single route group behind an admin-only filter: 401 without credentials, 403 for signed-in non-admins. A test fails if any admin route is missing it.
- **Suspended users:**
  - They are signed out and refused on every API call, and can't sign in again.
  - Their links return 410 until an admin restores them.
  - Admins can't suspend themselves or another admin; take the email off the list first.

## Abuse protection

Ovi can check destination URLs against [Google Safe Browsing](https://developers.google.com/safe-browsing) before it shortens them. It's off until you set `SafeBrowsing__ApiKey`.

What it does:
- It checks a new link (`POST /api/links`), a bulk request (`POST /api/links/bulk`) and an edit (`PATCH /api/links/{code}`) when the edit changes the URL.
- It looks for malware, social engineering (phishing), unwanted software and potentially harmful applications.
- It runs after the normal URL rules and after the create rate limit, so it isn't a free lookup service.
- A flagged URL gets 400 with `"This site is flagged as unsafe by Google Safe Browsing, so it can't be shortened."` under `url` (bulk: `urls[i]` or `items[i].url`).
- A bulk request is one request to Google. If any line is flagged, every flagged line is listed and nothing is created.
- Links that already exist are not checked again.

If Google can't answer, Ovi allows the link (it fails open), so a Google outage doesn't stop shortening:
- A timeout, network error, bad answer or other error status logs a warning.
- Google answering 429 (quota used up) or 403 (key refused) logs an error, and the link is still allowed. Watch for these in your logs.
- This means unsafe links can be made while Google is down or your quota is used up.

To get a key:
1. In the [Google Cloud Console](https://console.cloud.google.com), create or pick a project and enable the **Safe Browsing API**.
2. Under **APIs & Services → Credentials**, create an API key and restrict it to the Safe Browsing API.
3. Set it as `SafeBrowsing__ApiKey` (on Render, in the service's **Environment** tab).

Notes:
- Ovi sends the key as the `key` query parameter, which is how the Lookup API takes it. The HTTP client's request logging is removed and Ovi's own log lines never include the URL, so the key isn't logged.
- Google's Safe Browsing API terms allow non-commercial use only. For commercial use, Google offers the Web Risk API, which Ovi doesn't use.

## Database (Neon)

The production database is the `production` branch of a Neon project. Neon's config lives in [`neon.ts`](neon.ts); `neon deploy` applies it and pulls the branch's variables into `.env.local`.

- `DATABASE_URL`: the **pooled** endpoint, used for app traffic.
- `DATABASE_URL_UNPOOLED`: the **direct** endpoint, used only to run EF Core migrations at startup, as Neon recommends for schema changes.

Both accept Neon's `postgresql://…?sslmode=require&channel_binding=require` URLs. To browse the data, use the Neon Console's **Tables** or **SQL Editor**, or any Postgres client with the connection string.

## Configuration

| Setting | Env var | Default | Notes |
|---|---|---|---|
| `Auth:ApiKey` | `Auth__ApiKey` | none (`dev-key-change-me` in Development) | The admin key: full access to every link. If unset, admin access is off. |
| `Auth:Google:ClientId` / `ClientSecret` | `Auth__Google__ClientId` / `Auth__Google__ClientSecret` | none | Turns on **Continue with Google** |
| `Auth:GitHub:ClientId` / `ClientSecret` | `Auth__GitHub__ClientId` / `Auth__GitHub__ClientSecret` | none | Turns on **Continue with GitHub** |
| `Auth:AdminEmails` | `Auth__AdminEmails` | none | Comma-separated verified emails that are admins when signed in (case-insensitive) |
| `Links:BlockedHosts` | `Links__BlockedHosts` | none | Comma-separated sites that can't be shortened (their subdomains too), e.g. to stop spam |
| `SafeBrowsing:ApiKey` | `SafeBrowsing__ApiKey` | none | Google Safe Browsing API key. When it's missing or blank, the check is off. See [Abuse protection](#abuse-protection) |
| `SafeBrowsing:TimeoutSeconds` | `SafeBrowsing__TimeoutSeconds` | `3` | How long to wait for Google before allowing the link. Minimum `1`; a value that isn't a whole number falls back to `3` |
| `App:PublicBaseUrl` | `App__PublicBaseUrl` | none (`RENDER_EXTERNAL_URL` on Render) | **Set in production.** Base for short URLs and QR codes. If neither is set, they're built from the request's Host header, which clients control. |
| — | `DATABASE_URL` | none | **Required in production.** Postgres URL or Npgsql connection string for app traffic (Neon: pooled endpoint) |
| — | `DATABASE_URL_UNPOOLED` | `DATABASE_URL` | Connection used to run migrations (Neon: direct endpoint) |
| `ConnectionStrings:Default` | `ConnectionStrings__Default` | none (local Postgres in Development) | Fallback when `DATABASE_URL` isn't set |
| `RateLimits:CreatePerMinute` | `RateLimits__CreatePerMinute` | `30` | Links made or edited per minute per signed-in user (and per IP for the API key). A bulk request of N URLs counts as N. It also caps the bulk batch size: below `25`, a bulk request can hold at most this many URLs, and a larger one gets 400 |
| `RateLimits:AnonymousCreatePerHour` | `RateLimits__AnonymousCreatePerHour` | `20` | Links made per IP without signing in |
| `RateLimits:AuthPerMinute` | `RateLimits__AuthPerMinute` | `20` | Sign-in starts per IP |
| `RateLimits:StatsPerMinute` | `RateLimits__StatsPerMinute` | `60` | Stats requests per user (or per IP) |
| `RateLimits:ReadsPerMinute` | `RateLimits__ReadsPerMinute` | `120` | Link list, link lookup and session requests per user (or per IP) |
| `RateLimits:HealthPerMinute` | `RateLimits__HealthPerMinute` | `30` | `/health` (the database check) requests per IP; `/health/live` is not limited |
| `RateLimits:ReportPerHour` | `RateLimits__ReportPerHour` | `10` | Reports sent per client IP per hour |
| `RateLimits:ApiKeyFailuresPerMinute` | `RateLimits__ApiKeyFailuresPerMinute` | `10` | Wrong `X-Api-Key` attempts per client per minute before 429, so a key can't be guessed online |
| `Clicks:DedupeSeconds` | `Clicks__DedupeSeconds` | `30` | Repeat visits from the same client to the same link within this window count once |
| `Clicks:MaxRecordedPerMinute` | `Clicks__MaxRecordedPerMinute` | `1000` | Clicks recorded per minute across the whole site; beyond it, visitors are still redirected but not counted |
| `Links:RedirectCacheSeconds` | `Links__RedirectCacheSeconds` | `15` | How long a followed link is remembered in memory before the database is asked again. Edits, deletes and suspensions clear it at once; if the database is unreachable, a remembered link keeps working for up to an hour. `0` turns it off |
| `Clicks:MaxRecordedPerLinkPerMinute` | `Clicks__MaxRecordedPerLinkPerMinute` | `60` | Clicks recorded per link per minute, so one busy or attacked link can't use up the site's budget; `0` turns it off |
| `Clicks:MaxRecordedPerDay` | `Clicks__MaxRecordedPerDay` | `50000` | Clicks recorded per day across the whole site, which bounds how fast the Clicks table grows; `0` turns it off |
| `Clicks:RetentionDays` | `Clicks__RetentionDays` | `400` | Click rows older than this are deleted every 6 hours (never below 366, so stats stay complete); `0` keeps them forever. All-time counts are kept on each link |
| `RateLimits:RedirectPerMinute` | `RateLimits__RedirectPerMinute` | `300` | Per client IP, covers redirects and QR codes |
| `ReverseProxy:KnownProxies` | `ReverseProxy__KnownProxies__0` | none | IPs of your reverse proxy / load balancer. Needed so rate limits see real client IPs |
| `ReverseProxy:KnownNetworks` | `ReverseProxy__KnownNetworks__0` | none | Same, as CIDR ranges (e.g. `10.0.0.0/8`) |
| `ReverseProxy:TrustAllProxies` | `ReverseProxy__TrustAllProxies` | `false` | Trust forwarded headers from any sender. Only for platforms where the app is reachable solely through the platform's proxy (Render). |
| `ReverseProxy:ClientIpHeader` | `ReverseProxy__ClientIpHeader` | `X-Forwarded-For` | Header holding the client IP, if the platform uses a different one |
| `KeepAlive:Enabled` | `KeepAlive__Enabled` | `false` | Ping the app's own public URL on a timer so sleeping hosts (Render free) keep it awake |
| `KeepAlive:IntervalMinutes` | `KeepAlive__IntervalMinutes` | `10` | Time between pings; keep it under the host's idle timeout |
| `KeepAlive:Url` | `KeepAlive__Url` | public base URL + `/health/live` | URL to ping. It must go through the host's proxy, so not `localhost` |
| `Swagger:Enabled` | `Swagger__Enabled` | `true` in Development, else `false` | Serves `/openapi/v1.json` and `/swagger` |
| `DataProtection:CertificatePath` | `DataProtection__CertificatePath` | none | PFX file whose certificate encrypts the sign-in key ring stored in the database. **Set in production** |
| `DataProtection:CertificatePassword` | `DataProtection__CertificatePassword` | none | Password for that PFX file |

In production `Auth:ApiKey` must be at least 32 characters and can't be the development key (`dev-key-change-me`); the app refuses to start otherwise. `appsettings.Development.json` is left out of published images.

### Encrypting the sign-in key ring

The keys that encrypt session cookies live in the `DataProtectionKeys` table, so whoever can read the database could forge a session. Encrypt them with a certificate kept outside the database, e.g. a Render secret file:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout dp-key.pem -out dp-cert.pem -subj "/CN=ovi-dataprotection"
openssl pkcs12 -export -out dp.pfx -inkey dp-key.pem -in dp-cert.pem -passout pass:"$DP_PASSWORD"
```

Set `DataProtection__CertificatePath` to the PFX file's path and `DataProtection__CertificatePassword` to its password. Keep the file for the life of the deployment: the stored keys are encrypted with it, and replacing it makes them unreadable, so everyone signs in again.

### Deploying behind a reverse proxy

Terminate TLS at the proxy (nginx, Caddy, a cloud load balancer and so on). Set `ReverseProxy:KnownProxies` or `KnownNetworks` to the proxy's address.

`X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` are only trusted from those addresses. If you skip this, every client shares the proxy's rate limit. HSTS is sent outside Development.

The app keeps no local state, so you can run several instances against the same database.

## Endpoints

Each `/api` request acts as one of three callers:
- **Admin:** sends the `X-Api-Key` header. A wrong key is always a 401, with no fallback to the cookie. The admin sees every link.
- **User:** has the session cookie from signing in, and sees only their own links.
- **Anonymous:** neither. Can only create links one at a time, with no custom code, and they expire within 30 days.

Redirects and QR codes are public.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/links` | anyone | Create a link. Body: `{ "url": "https://...", "customCode": "optional", "expiresAt": "optional, e.g. 2030-01-01T00:00:00Z" }` |
| `POST` | `/api/reports` | anyone | Report a link as abusive. Body: `{ "link": "abc123" or "https://getovi.link/abc123", "reason": "phishing" \| "malware" \| "spam" \| "other", "details": "optional, up to 500 characters" }`. Needs the `X-Ovi-Request` header. Returns 202 with no body. 400 for a link that isn't an Ovi short link or code, a missing or unknown reason, or details that are too long or contain characters that can't be saved; 403 without the header; 404 if the link doesn't exist (a deleted link counts as missing); 429 over the rate limit. See [Report a link](#report-a-link) |
| `POST` | `/api/links/bulk` | user, key | Shorten 1 to 25 URLs in one request, all or nothing. Body: `{ "urls": ["https://...", "https://..."], "expiresAt": "optional, set on every link" }`, or `{ "items": [{ "url": "...", "customCode": "optional", "expiresAt": "optional" }] }` for a code and expiry per link. Without `customCode` codes are random; without `expiresAt` the links never expire. Returns 201 `{ "items": [link, ...] }` in input order, each in the same shape as `POST /api/links`. Any bad URL or expiry gives 400 and creates nothing. Counts as N links against the create rate limit (a 400 or 429 costs nothing, except a 400 from the Safe Browsing check). 503 "Couldn't make short codes; try again." means nothing was created and a retry is safe. See [Bulk create](#bulk-create) |
| `GET` | `/api/links?page=1&pageSize=50&q=&status=all&sort=newest` | user, key | List links, newest first by default. Returns `{ items, page, pageSize, total }`; `pageSize` max 100, `page` max 100000. Optional `q` searches code and URL (case-insensitive, max 100 characters); `status` is `all` (default), `active` or `expired`; `sort` is `newest` (default), `clicks` (most clicked first) or `expiring` (soonest to expire first, then links that never expire, then expired ones); anything else is a 400 |
| `GET` | `/api/links/{code}` | user, key | Show one link's details and click count |
| `GET` | `/api/links/{code}/stats?days=30` | user, key | Click analytics for the last 1–365 days (UTC): clicks per day, top referrers, devices and browsers |
| `PATCH` | `/api/links/{code}` | user, key | Edit a link's destination or expiry; the code, clicks and stats stay. Body (every field optional): `{ "url": "https://...", "expiresAt": "2030-01-01T00:00:00Z" }`, or `{ "clearExpiry": true }` to make it never expire. A missing or `null` field is left as it is. Checked like a new link; returns the updated link |
| `DELETE` | `/api/links/{code}` | user, key | Delete a link (soft delete: the row is kept with `DeletedAt` set, and the link disappears from every endpoint). Counts as 1 link against the create rate limit, so a 429 with `Retry-After` follows a burst of deletes |
| `GET` | `/api/admin/overview` | admin | Totals, clicks and sign-ups per day for 14 days, top links, and `openReports` (open reports on links that still exist) |
| `GET` | `/api/admin/reports?page=1&pageSize=20` | admin | Links with open reports (not deleted links), most reports first. Each item has `code`, `shortUrl`, `url`, `owner`, `anonymous`, `openReports`, `reasons` (`phishing`, `malware`, `spam`, `other` counts), `latestAt` and `details` (the latest 5 non-empty texts). Returns `{ items, page, pageSize, total }` |
| `POST` | `/api/admin/reports/{code}/resolve` | admin | Close every open report on a link. Body: `{ "resolution": "dismissed" }` or `{ "resolution": "actioned" }`. Returns 204; 400 for any other resolution; 404 if the link doesn't exist |
| `GET` | `/api/admin/users?page=1&pageSize=20&q=` | admin | Every user with link and click counts; `q` searches name and email |
| `GET` | `/api/admin/links?page=1&pageSize=20&q=&owner=` | admin | Every link with its owner; `owner` is `anonymous`, `apikey` or a user id; `q` searches code and URL |
| `POST` | `/api/admin/users/{id}/block` / `unblock` | admin | Suspend or restore a user (not yourself or another admin) |
| `GET` | `/api/session` | anyone | Who's signed in, which sign-in providers are on, and how long anonymous links last |
| `POST` | `/api/logout` | user | End every session for the account, on every device (a copied cookie stops working) |
| `GET` | `/auth/login/{google\|github}?returnUrl=/links` | public | Start signing in; comes back to `returnUrl` (a path on this site only) |
| `GET` | `/{code}` | public | 302 redirect and count the click. Returns 410 Gone if expired |
| `GET` | `/{code}/qr` | public | PNG QR code for the short URL |
| `GET` | `/health` | public | Health check, including the database connection (503 if the database is unavailable) |
| `GET` | `/health/live` | public | Liveness check that doesn't touch the database (used by keep-alive) |
| `GET` | `/` | public | The web UI, when it has been built into `wwwroot` |

Validation rules:
- URLs are trimmed, then must be absolute `http` or `https` with a host and no spaces, at most 2048 characters (also after encoding).
- The stored URL is the ASCII form: punycode host, percent-encoded path, so it is always safe to send in a `Location` header. Control characters and bidi overrides are refused.
- A URL can't contain a user name or password (`https://bank.example@evil.example` is a phishing trick).
- A URL can't point back at the shortener, or at a site in `Links:BlockedHosts`.
- When `SafeBrowsing:ApiKey` is set, a URL that Google Safe Browsing flags as unsafe is refused with 400 under `url` (see [Abuse protection](#abuse-protection)).
- A custom code is 3 to 32 characters of letters, digits, `-` or `_`, and only for signed-in users and the admin. It can't be a reserved word (`api`, `auth`, `swagger`, `openapi`, `health`, `qr`, `assets`, `links`, `admin`, `report`).
- `expiresAt` must be in the future and at most 10 years away. Anonymous links expire after 30 days by default, and can't be set to last longer.
- Request bodies over 64 KB are refused.
- Hosts are compared in one normal form (punycode, lowercase, no trailing dot), so `Evil.COM.` matches a block on `evil.com`. The blocklist also applies when a link is visited: links made before a site was blocked return 410.

Click counting:
- Bots are redirected but not counted.
- A visitor hitting the same link again within 30 seconds counts once.
- There's an overall cap on recorded clicks per minute.
- A failed click write never stops the redirect.
- Rate limits group IPv6 clients by their /64, so rotating addresses doesn't get around them.
- A deleted link's code stays reserved, so an old short URL or printed QR code can never start pointing somewhere else.

Rate limits for making links:
- Single create, edit (`PATCH`) and bulk create share one budget, counted in links: 30 a minute per signed-in user, or per IP for the API key (`RateLimits:CreatePerMinute`). Anonymous visitors get 20 links an hour per IP.
- Single create and edit each cost 1, even when they fail validation. A bulk request of N URLs costs N.
- A bulk request that fails validation (400) or is over the remaining budget (429) costs nothing. The exception is a batch refused by the Safe Browsing check: that check runs after the budget is taken, so the batch still costs N.

Rate limit for reports: `POST /api/reports` allows 10 an hour per client IP (`RateLimits:ReportPerHour`), then returns 429.

Errors use RFC 7807 problem JSON:
- 400: validation failed.
- 401: the API key is wrong, or the endpoint needs you to sign in.
- 403: a cookie request that changes data is missing `X-Ovi-Request`, or the account is suspended.
- 409: the code is already taken.
- 413: the request body is over 64 KB.
- 429: the client is over its rate limit. Link creation, edits and deletes also send a `Retry-After` header (in seconds).
- 503: no free random code could be found. Nothing was created, so it's safe to retry.

```bash
KEY=dev-key-change-me
curl -X POST localhost:5080/api/links -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"url":"https://learn.microsoft.com/dotnet","customCode":"dotnet","expiresAt":"2030-01-01T00:00:00Z"}'
curl -i localhost:5080/dotnet
curl -o dotnet.png localhost:5080/dotnet/qr
```

### Report a link

Anyone can report a short link. No sign-in is needed, but the request must send `X-Ovi-Request: 1`.

```bash
curl -X POST localhost:5080/api/reports -H 'X-Ovi-Request: 1' -H 'content-type: application/json' \
  -d '{"link":"https://getovi.link/abc123","reason":"phishing","details":"Fake bank login page"}'
# 202 Accepted, empty body
```

- `link` is an Ovi code or a short URL on this site's own host. Anything else gets 400 ("Enter an Ovi short link or its code.").
- `reason` is `phishing`, `malware`, `spam` or `other`.
- `details` is optional, trimmed, at most 500 characters. Line breaks (`\n`, `\r\n` or `\r`, all saved as `\n`) and tabs are fine; any other control or direction-override character gets 400 ("The details contain characters that can't be saved."). More than 500 characters after that gives 400 ("Keep the details under 500 characters.").
- Expired and disabled links can be reported. A deleted link gets 404.
- Each link keeps at most 50 open reports. Later ones get 202 but are dropped, so one link can't flood the list.
- A report stores the link, reason, details and time. It never stores the reporter's IP address, user agent or account.

An admin then closes a link's reports from the **Reports** tab, or with `POST /api/admin/reports/{code}/resolve`. Closing marks all of the link's open reports `dismissed` or `actioned`; it doesn't delete or disable the link, so do that separately if needed.

### Bulk create

`POST /api/links/bulk` shortens up to 25 URLs at once for signed-in users and the API key. Anonymous callers get 401 ("Sign in to shorten many links at once."). With a cookie, send `X-Ovi-Request: 1` as for any other change.

```bash
curl -X POST localhost:5080/api/links/bulk -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"urls":["https://example.com/a","https://example.com/b"],"expiresAt":"2030-01-01T00:00:00Z"}'
```

```http
HTTP/1.1 201 Created

{
  "items": [
    { "code": "aB3xK9q", "shortUrl": "http://localhost:5080/aB3xK9q", "qrCodeUrl": "http://localhost:5080/aB3xK9q/qr",
      "url": "https://example.com/a", "clicks": 0, "createdAt": "2026-11-18T10:00:00Z", "lastClickedAt": null,
      "expiresAt": "2030-01-01T00:00:00Z" },
    { "code": "Tz7mQ2w", "shortUrl": "http://localhost:5080/Tz7mQ2w", "qrCodeUrl": "http://localhost:5080/Tz7mQ2w/qr",
      "url": "https://example.com/b", "clicks": 0, "createdAt": "2026-11-18T10:00:00Z", "lastClickedAt": null,
      "expiresAt": "2030-01-01T00:00:00Z" }
  ]
}
```

- Instead of `urls` you can send `items`, each `{ "url": "...", "customCode": "optional", "expiresAt": "optional" }`, to choose a code and an expiry per link. An item's `expiresAt` wins over the top-level one, and an item without `customCode` gets a random code. Send `urls` or `items`, not both. Custom codes follow the single-create rules and must be free (deleted links keep their codes); a bad, repeated or taken code is a 400 keyed `items[i].customCode`, and URL and expiry problems are keyed `items[i].url` and `items[i].expiresAt`. A 400 still creates nothing and costs nothing.
- `items` in the response is in the same order as `urls` (or `items`). The same URL twice gets two links.
- Each URL is checked by the same rules as single create. Leading and trailing spaces are trimmed, but empty items aren't skipped: they're errors.
- It's all or nothing. If any URL or the expiry is invalid, the response is 400, nothing is created, and every problem is listed. URL errors are keyed by zero-based position:

```json
{
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "urls[1]": ["Enter a full web address starting with http:// or https://."],
    "expiresAt": ["The expiry date must be in the future."]
  }
}
```

- A missing or empty `urls` list gives `errors.urls` = `["Add at least one URL."]`. More than 25 gives `["You can shorten at most 25 URLs at once."]` before any URL is checked.
- Custom codes and per-URL expiry dates aren't supported. Other fields, such as `customCode`, are never used.

## Development

### Run locally

```bash
dotnet tool restore                      # installs dotnet-ef locally
docker run -d --name ovi-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ovi postgres:17-alpine
ASPNETCORE_ENVIRONMENT=Development dotnet run --project src/Ovi.Api --urls http://localhost:5080
```

Development connects to that local Postgres by default (`ConnectionStrings:Default` in `appsettings.Development.json`). To use a Neon branch instead, export its variables first:

```bash
neon env pull                            # writes DATABASE_URL etc. to .env.local (git-ignored)
set -a; source .env.local; set +a
```

Swagger UI: http://localhost:5080/swagger. Click **Authorize** and enter `dev-key-change-me`.

The schema is created and migrated automatically on startup.

### Web UI

A React app in [`web/`](web) (Vite, TypeScript, Tailwind CSS, Lucide icons). Develop it with hot reload while the API runs on `:5080` (see above). Vite proxies `/api` calls to it:

```bash
cd web
npm ci
npm run dev          # http://localhost:5173
npm test             # Vitest + Testing Library
npm run build        # type-checks, then builds into src/Ovi.Api/wwwroot
```

After `npm run build`, the API serves the UI at http://localhost:5080/. The Docker image builds it automatically. `index.html` is sent with a strict Content-Security-Policy and `no-cache`, and the hashed files in `/assets` are cached for a year.

## Database migrations

The schema is managed with EF Core migrations in `src/Ovi.Api/Data/Migrations`. After changing the model:

```bash
dotnet ef migrations add <Name> --project src/Ovi.Api -o Data/Migrations
```

## Test

```bash
dotnet test
```

Tests use MSTest and `WebApplicationFactory` with a fake clock (`FakeTimeProvider`). They run against a real Postgres started with [Testcontainers](https://dotnet.testcontainers.org), so **Docker must be running**. Each test gets its own database.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request, on pushes to `main` and on version tags. It:

1. Builds in Release mode and runs the tests. Results are uploaded as a `test-results` artifact.
2. Checks every NuGet package, including transitive ones, for a disallowed license or a known vulnerability (`scripts/check-packages.py`), and tests the scripts in `scripts/`.
3. Fails if the EF model has changed without a migration.
4. Type-checks, tests and builds the web UI, checks npm licenses, and fails on high or critical npm advisories (`scripts/check-npm-audit.mjs`, which prints any advisory it accepts because it has no fix and can't reach shipped code).
5. Builds the Docker image for every change and smoke-tests it through `docker-compose.yml`. It also builds the ARM64 image and runs it under emulation against the same database.
6. Pushes the image to GitHub Container Registry for amd64 and ARM64, only from `main` and version tags, and only after the smoke tests pass. The build and smoke-test jobs never hold push permission. Actions are pinned to commit SHAs and the Docker base images to digests, so a moved tag can't change what runs or ships.

### Image tags

| Tag | Points at |
|---|---|
| `1`, `1.2`, `1.2.3` | Releases. `1` follows every 1.x release; `docker-compose.yml` uses it |
| `latest` | The newest release (never a pre-release) |
| `edge` | The newest commit on `main`, untested by a release |
| `sha-<short commit>` | One exact build |

```bash
docker pull ghcr.io/goldi0002/ovi:1
```

### Making a release

1. In `docs/CHANGELOG.md`, rename `## Unreleased` to `## 1.2.3 — YYYY-MM-DD` and start a new, empty `## Unreleased` above it. Use [semantic versioning](https://semver.org): a major version for changes self-hosters must act on.
2. Merge that, then tag the commit on `main` and push the tag:

   ```bash
   git tag v1.2.3 && git push origin v1.2.3
   ```

   Or create the release on GitHub's **Releases** page with a new `v1.2.3` tag on `main`: that creates the tag too, and CI fills in the release's title and notes.

CI then runs every check, publishes the image tags above, and creates the GitHub Release with that version's changelog section as its notes. If the changelog has no section for the version, CI fails before anything is published. A tag with a suffix, such as `v1.3.0-rc.1`, becomes a pre-release: it gets its own tag but doesn't move `1`, `1.3` or `latest`.

## Dependencies and licenses

All NuGet dependencies are free and open source: MIT, except Npgsql (the .NET Postgres driver) and its EF Core provider, which use the permissive, MIT-like [PostgreSQL License](https://opensource.org/license/postgresql). The web UI ships only MIT and ISC packages (React, and Lucide's icons, whose ISC licence is functionally the same as MIT); it's styled with Tailwind CSS (MIT), which runs at build time. Its build and test tools use other common open-source licenses (Apache-2.0, ISC, BSD, and MPL-2.0 for Vite's CSS minifier, lightningcss), none of which reach users. CI enforces both. Run the same checks locally:

```bash
python3 scripts/check-packages.py                              # NuGet, after dotnet restore
node scripts/check-npm-licenses.mjs web/package-lock.json     # npm
```

Allowed licenses are MIT, Apache-2.0 and PostgreSQL, set in `ALLOWED_LICENSES` in the script.

## License

Ovi is free software under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

You can use, change and share it. If you run a modified Ovi as a network service, the AGPL requires you to offer its users the source of your version. Ovi links to its source from Settings → About and the FAQ, so point those links (`web/src/components/SettingsDialog.tsx`, `web/src/components/Faq.tsx`, `web/index.html`, `web/public/llms.txt`) at your own repository.

All of Ovi's dependencies use permissive licences (MIT, Apache-2.0, ISC, PostgreSQL), which are compatible with the AGPL.
