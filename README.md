# ovi

[![CI](https://github.com/goldi0002/ovi/actions/workflows/ci.yml/badge.svg)](https://github.com/goldi0002/ovi/actions/workflows/ci.yml)

A small URL shortener API built with ASP.NET Core minimal APIs (.NET 10 LTS), EF Core and PostgreSQL (hosted on [Neon](https://neon.com) in production).

## Run locally

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

## Web UI

A React app in [`web/`](web) (Vite, TypeScript, Tailwind CSS, Lucide icons) is the UI for the API. It's served by the API itself at `/`, so there's one address and no CORS setup.

- A landing page with the shortener front and center, plus features, pricing and about sections, and a light/dark toggle (it follows the system until you pick one).
- Sign in with the API key from **Get Started**, or just paste a URL and press **Shorten URL**: you're asked for the key first. It's kept for the browser tab, or on the device if you tick **Remember on this device**.
- Shorten links with an optional custom code and expiry, then copy the result or download its QR code.
- See all links with clicks, creation time and status (active, expiring, expired), page through them and delete them.
- Open **Stats** on any link for its clicks per day over the last 7, 30 or 90 days, its top referrers, and the devices and browsers visitors used. Each click stores only the time, the referring site's name (no page path), and a device and browser category: no IP address or full user agent.

Develop it with hot reload while the API runs on `:5080` (see above). Vite proxies `/api` calls to it:

```bash
cd web
npm ci
npm run dev          # http://localhost:5173
npm test             # Vitest + Testing Library
npm run build        # type-checks, then builds into src/Ovi.Api/wwwroot
```

After `npm run build`, the API serves the UI at http://localhost:5080/. The Docker image builds it automatically. `index.html` is sent with a strict Content-Security-Policy and `no-cache`, and the hashed files in `/assets` are cached for a year.

## Run with Docker

```bash
docker build -t ovi .
docker run -d -p 8080:8080 \
  -e DATABASE_URL='postgresql://user:pass@host/db?sslmode=require' \
  -e Auth__ApiKey='a-long-random-secret' \
  -e App__PublicBaseUrl='https://your.domain' \
  ovi
```

The container runs as a non-root user. It keeps no local state: all data is in Postgres.

## Deploy to Render

[`render.yaml`](render.yaml) is a [Render Blueprint](https://render.com/docs/blueprint-spec) for one Docker web service:
- It builds from the `Dockerfile` and runs on Render's **free plan**.
- It uses the `/health` check, and stores data in Neon Postgres.
- It deploys new commits on `main` only after their GitHub checks (CI) pass.

One-time setup:

1. In the [Render dashboard](https://dashboard.render.com), choose **New → Blueprint** and connect this repository. Render reads `render.yaml` and creates the `ovi` service.
2. Render asks for `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Copy them from `neon env pull` (`.env.local`) or the Neon Console's **Connect** dialog: the pooled string (host ends in `-pooler`) for `DATABASE_URL`, the direct one for `DATABASE_URL_UNPOOLED`. For a service created before these were added, set them in the service's **Environment** tab.
3. Render generates a random `Auth__ApiKey`. Copy it from the service's **Environment** tab. This is the key for `/api/links`.
4. The service is live at its `https://<name>.onrender.com` URL. Short URLs use that address automatically through `RENDER_EXTERNAL_URL`. To use a custom domain, add it in Render and set `App__PublicBaseUrl`.

On the free plan a service sleeps after about 15 minutes without traffic, and the next request takes up to a minute to wake it. To avoid that, `render.yaml` turns on `KeepAlive__Enabled`: a background service pings the app's own public URL (`/health/live`) every 10 minutes, through Render's proxy, so it never goes idle. That keeps one instance up all month, about 744 of the workspace's 750 free instance hours, so turn it off if you run other free services. `/health/live` doesn't touch the database, so the pings don't keep Neon awake. Links are kept in Neon, so they survive restarts and deploys.

## Database (Neon)

The production database is the `production` branch of a Neon project. Neon's config lives in [`neon.ts`](neon.ts); `neon deploy` applies it and pulls the branch's variables into `.env.local`.

- `DATABASE_URL`: the **pooled** endpoint, used for app traffic.
- `DATABASE_URL_UNPOOLED`: the **direct** endpoint, used only to run EF Core migrations at startup, as Neon recommends for schema changes.

Both accept Neon's `postgresql://…?sslmode=require&channel_binding=require` URLs. To browse the data, use the Neon Console's **Tables** or **SQL Editor**, or any Postgres client with the connection string.

## Configuration

| Setting | Env var | Default | Notes |
|---|---|---|---|
| `Auth:ApiKey` | `Auth__ApiKey` | none (`dev-key-change-me` in Development) | **Required.** Protects `/api/links/*`. If unset, those endpoints reject every request. |
| `App:PublicBaseUrl` | `App__PublicBaseUrl` | none (`RENDER_EXTERNAL_URL` on Render) | **Set in production.** Base for short URLs and QR codes. If neither is set, they're built from the request's Host header, which clients control. |
| — | `DATABASE_URL` | none | **Required in production.** Postgres URL or Npgsql connection string for app traffic (Neon: pooled endpoint) |
| — | `DATABASE_URL_UNPOOLED` | `DATABASE_URL` | Connection used to run migrations (Neon: direct endpoint) |
| `ConnectionStrings:Default` | `ConnectionStrings__Default` | none (local Postgres in Development) | Fallback when `DATABASE_URL` isn't set |
| `RateLimits:CreatePerMinute` | `RateLimits__CreatePerMinute` | `30` | Per client IP |
| `RateLimits:RedirectPerMinute` | `RateLimits__RedirectPerMinute` | `300` | Per client IP, covers redirects and QR codes |
| `ReverseProxy:KnownProxies` | `ReverseProxy__KnownProxies__0` | none | IPs of your reverse proxy / load balancer. Needed so rate limits see real client IPs |
| `ReverseProxy:KnownNetworks` | `ReverseProxy__KnownNetworks__0` | none | Same, as CIDR ranges (e.g. `10.0.0.0/8`) |
| `ReverseProxy:TrustAllProxies` | `ReverseProxy__TrustAllProxies` | `false` | Trust forwarded headers from any sender. Only for platforms where the app is reachable solely through the platform's proxy (Render). |
| `ReverseProxy:ClientIpHeader` | `ReverseProxy__ClientIpHeader` | `X-Forwarded-For` | Header holding the client IP, if the platform uses a different one |
| `KeepAlive:Enabled` | `KeepAlive__Enabled` | `false` | Ping the app's own public URL on a timer so sleeping hosts (Render free) keep it awake |
| `KeepAlive:IntervalMinutes` | `KeepAlive__IntervalMinutes` | `10` | Time between pings; keep it under the host's idle timeout |
| `KeepAlive:Url` | `KeepAlive__Url` | public base URL + `/health/live` | URL to ping. It must go through the host's proxy, so not `localhost` |
| `Swagger:Enabled` | `Swagger__Enabled` | `true` in Development, else `false` | Serves `/openapi/v1.json` and `/swagger` |

### Deploying behind a reverse proxy

Terminate TLS at the proxy (nginx, Caddy, a cloud load balancer and so on). Set `ReverseProxy:KnownProxies` or `KnownNetworks` to the proxy's address.

`X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` are only trusted from those addresses. If you skip this, every client shares the proxy's rate limit. HSTS is sent outside Development.

The app keeps no local state, so you can run several instances against the same database.

## Endpoints

Management endpoints need the `X-Api-Key` header. Redirects and QR codes are public.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/links` | key | Create a link. Body: `{ "url": "https://...", "customCode": "optional", "expiresAt": "optional, e.g. 2030-01-01T00:00:00Z" }` |
| `GET` | `/api/links?page=1&pageSize=50` | key | List links, newest first. Returns `{ items, page, pageSize, total }`; `pageSize` max 100 |
| `GET` | `/api/links/{code}` | key | Show one link's details and click count |
| `GET` | `/api/links/{code}/stats?days=30` | key | Click analytics for the last 1–365 days (UTC): clicks per day, top referrers, devices and browsers |
| `DELETE` | `/api/links/{code}` | key | Delete a link (soft delete: the row is kept with `DeletedAt` set, and the link disappears from every endpoint) |
| `GET` | `/{code}` | public | 302 redirect and count the click. Returns 410 Gone if expired |
| `GET` | `/{code}/qr` | public | PNG QR code for the short URL |
| `GET` | `/health` | public | Health check, including the database connection (503 if the database is unavailable) |
| `GET` | `/health/live` | public | Liveness check that doesn't touch the database (used by keep-alive) |
| `GET` | `/` | public | The web UI, when it has been built into `wwwroot` |

Validation rules:
- URLs must be absolute `http` or `https`, at most 2048 characters, and can't point back at the shortener.
- A custom code is 3 to 32 characters of letters, digits, `-` or `_`. It can't be a reserved word (`api`, `swagger`, `openapi`, `health`, `qr`, `assets`).
- `expiresAt` must be in the future.
- A deleted link's code stays reserved, so an old short URL or printed QR code can never start pointing somewhere else.

Errors use RFC 7807 problem JSON:
- 400: validation failed.
- 401: the API key is missing or wrong.
- 409: the code is already taken.
- 429: the client is over its rate limit.

```bash
KEY=dev-key-change-me
curl -X POST localhost:5080/api/links -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"url":"https://learn.microsoft.com/dotnet","customCode":"dotnet","expiresAt":"2030-01-01T00:00:00Z"}'
curl -i localhost:5080/dotnet
curl -o dotnet.png localhost:5080/dotnet/qr
```

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

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes to `main`. It:

1. Builds in Release mode and runs the tests. Results are uploaded as a `test-results` artifact.
2. Checks every NuGet package, including transitive ones, for a disallowed license or a known vulnerability (`scripts/check-packages.py`).
3. Fails if the EF model has changed without a migration.
4. Type-checks, tests and builds the web UI, checks npm licenses, and runs `npm audit`.
5. Builds the Docker image. On pull requests it starts the container with a Postgres next to it and smoke-tests the API and UI. On `main` it pushes the image to GitHub Container Registry:

```bash
docker pull ghcr.io/goldi0002/ovi:latest   # or :sha-<short commit>
```

The package is private by default. To make it public, change its visibility in the package's settings on GitHub.

## Dependencies and licenses

All NuGet dependencies are free and open source: MIT, except Npgsql (the .NET Postgres driver) and its EF Core provider, which use the permissive, MIT-like [PostgreSQL License](https://opensource.org/license/postgresql). The web UI ships only MIT and ISC packages (React, and Lucide's icons, whose ISC licence is functionally the same as MIT); it's styled with Tailwind CSS (MIT), which runs at build time. Its build and test tools use other common open-source licenses (Apache-2.0, ISC, BSD, and MPL-2.0 for Vite's CSS minifier, lightningcss), none of which reach users. CI enforces both. Run the same checks locally:

```bash
python3 scripts/check-packages.py                              # NuGet, after dotnet restore
node scripts/check-npm-licenses.mjs web/package-lock.json     # npm
```

Allowed licenses are MIT, Apache-2.0 and PostgreSQL, set in `ALLOWED_LICENSES` in the script.
