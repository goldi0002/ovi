# ovi

[![CI](https://github.com/goldi0002/ovi/actions/workflows/ci.yml/badge.svg)](https://github.com/goldi0002/ovi/actions/workflows/ci.yml)

A small URL shortener API built with ASP.NET Core minimal APIs (.NET 10 LTS), EF Core and SQLite.

## Run locally

```bash
dotnet tool restore                      # installs dotnet-ef locally
ASPNETCORE_ENVIRONMENT=Development dotnet run --project src/Ovi.Api --urls http://localhost:5080
```

Swagger UI: http://localhost:5080/swagger. Click **Authorize** and enter `dev-key-change-me`.

The database (`ovi.db`) is created and migrated automatically on startup.

## Run with Docker

```bash
docker build -t ovi .
docker run -d -p 8080:8080 -v ovi-data:/data \
  -e Auth__ApiKey='a-long-random-secret' \
  -e App__PublicBaseUrl='https://your.domain' \
  ovi
```

The container runs as a non-root user and stores the database in the `/data` volume.

## Deploy to Fly.io

The `deploy` job in CI deploys every push to `main` to https://ovi-goldi0002.fly.dev. It uses [`fly.toml`](fly.toml): one small machine (512 MB) that stops when idle and starts on the next request, with a 1 GB volume for the SQLite database.

One-time setup:

1. Create a [Fly.io](https://fly.io) account. Fly asks for a payment card, and a small idle-stopping app like this costs a few dollars a month at most.
2. Create an **org token** in the Fly dashboard (**Tokens → Create token → Org token**), or run `fly tokens create org`. An org token is needed because the first deploy creates the app.
3. In GitHub, go to **Settings → Secrets and variables → Actions** and add two repository secrets:
   - `FLY_API_TOKEN`: the token from step 2.
   - `OVI_API_KEY`: a long random string, e.g. from `openssl rand -base64 32`. This becomes the API key for `/api/links`.
4. Push to `main` or re-run the latest CI run. The first deploy creates the app and the `ovi_data` volume, sets the API key as a Fly secret, deploys and checks `/health`.

Until both secrets exist, the deploy job is skipped with a notice and CI stays green.

The app name is global on Fly.io. If `ovi-goldi0002` is taken, change `app` and `App__PublicBaseUrl` in `fly.toml`, plus the URL in the deploy job.

## Configuration

| Setting | Env var | Default | Notes |
|---|---|---|---|
| `Auth:ApiKey` | `Auth__ApiKey` | none (`dev-key-change-me` in Development) | **Required.** Protects `/api/links/*`. If unset, those endpoints reject every request. |
| `App:PublicBaseUrl` | `App__PublicBaseUrl` | none | **Set in production.** Base for short URLs and QR codes. If unset, they're built from the request's Host header, which clients control. |
| `ConnectionStrings:Default` | `ConnectionStrings__Default` | `Data Source=ovi.db` (`/data/ovi.db` in Docker) | SQLite connection string |
| `RateLimits:CreatePerMinute` | `RateLimits__CreatePerMinute` | `30` | Per client IP |
| `RateLimits:RedirectPerMinute` | `RateLimits__RedirectPerMinute` | `300` | Per client IP, covers redirects and QR codes |
| `ReverseProxy:KnownProxies` | `ReverseProxy__KnownProxies__0` | none | IPs of your reverse proxy / load balancer. Needed so rate limits see real client IPs |
| `ReverseProxy:KnownNetworks` | `ReverseProxy__KnownNetworks__0` | none | Same, as CIDR ranges (e.g. `10.0.0.0/8`) |
| `ReverseProxy:TrustAllProxies` | `ReverseProxy__TrustAllProxies` | `false` | Trust forwarded headers from any sender. Only for platforms where the app is reachable solely through the platform's proxy (Fly.io). |
| `ReverseProxy:ClientIpHeader` | `ReverseProxy__ClientIpHeader` | `X-Forwarded-For` | Header holding the client IP, e.g. `Fly-Client-IP` |
| `Swagger:Enabled` | `Swagger__Enabled` | `true` in Development, else `false` | Serves `/openapi/v1.json` and `/swagger` |

### Deploying behind a reverse proxy

Terminate TLS at the proxy (nginx, Caddy, a cloud load balancer and so on). Set `ReverseProxy:KnownProxies` or `KnownNetworks` to the proxy's address.

`X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` are only trusted from those addresses. If you skip this, every client shares the proxy's rate limit. HSTS is sent outside Development.

SQLite is a single file, so run **one instance**. To scale out, switch to a server database such as PostgreSQL.

## Endpoints

Management endpoints need the `X-Api-Key` header. Redirects and QR codes are public.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/links` | key | Create a link. Body: `{ "url": "https://...", "customCode": "optional", "expiresAt": "optional, e.g. 2030-01-01T00:00:00Z" }` |
| `GET` | `/api/links?page=1&pageSize=50` | key | List links, newest first. Returns `{ items, page, pageSize, total }`; `pageSize` max 100 |
| `GET` | `/api/links/{code}` | key | Show one link's details and click count |
| `DELETE` | `/api/links/{code}` | key | Delete a link |
| `GET` | `/{code}` | public | 302 redirect and count the click. Returns 410 Gone if expired |
| `GET` | `/{code}/qr` | public | PNG QR code for the short URL |
| `GET` | `/health` | public | Health check, including the database connection (503 if the database is unavailable) |

Validation rules:
- URLs must be absolute `http` or `https`, at most 2048 characters, and can't point back at the shortener.
- A custom code is 3 to 32 characters of letters, digits, `-` or `_`. It can't be a reserved word (`api`, `swagger`, `openapi`, `health`, `qr`).
- `expiresAt` must be in the future.

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

Tests use MSTest and `WebApplicationFactory`, with an in-memory SQLite database and a fake clock (`FakeTimeProvider`).

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes to `main`. It:

1. Builds in Release mode and runs the tests. Results are uploaded as a `test-results` artifact.
2. Checks every NuGet package, including transitive ones, for a disallowed license or a known vulnerability (`scripts/check-packages.py`).
3. Fails if the EF model has changed without a migration.
4. Builds the Docker image. On pull requests it starts the container and smoke-tests it. On `main` it pushes the image to GitHub Container Registry:

```bash
docker pull ghcr.io/goldi0002/ovi:latest   # or :sha-<short commit>
```

The package is private by default. To make it public, change its visibility in the package's settings on GitHub.

## Dependencies and licenses

All NuGet dependencies are free and open source: MIT, except the SQLite native bindings (`SQLitePCLRaw.*`), which are Apache-2.0 and required by EF Core's SQLite provider. SQLite itself is public domain. CI enforces this. Run the same check locally after `dotnet restore`:

```bash
python3 scripts/check-packages.py
```

Allowed licenses are MIT and Apache-2.0, set in `ALLOWED_LICENSES` in the script.
