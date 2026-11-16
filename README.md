# ovi

A small URL shortener API built with ASP.NET Core minimal APIs (.NET 8), EF Core and SQLite.

## Run

```bash
dotnet tool restore                      # installs dotnet-ef locally
ASPNETCORE_ENVIRONMENT=Development dotnet run --project src/Ovi.Api --urls http://localhost:5080
```

Swagger UI: http://localhost:5080/swagger. Click **Authorize** and enter the API key.

The database (`ovi.db`) is created and migrated automatically on startup.

## Configuration

| Setting | Env var | Default | Notes |
|---|---|---|---|
| `Auth:ApiKey` | `Auth__ApiKey` | none (`dev-key-change-me` in Development) | Required for `/api/links/*`. If unset, those endpoints reject every request. |
| `ConnectionStrings:Default` | `ConnectionStrings__Default` | `Data Source=ovi.db` | SQLite connection string |
| `RateLimits:CreatePerMinute` | `RateLimits__CreatePerMinute` | `30` | Per client IP |
| `RateLimits:RedirectPerMinute` | `RateLimits__RedirectPerMinute` | `300` | Per client IP, covers redirects and QR codes |

## Endpoints

Management endpoints need the `X-Api-Key` header. Redirects and QR codes are public.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/links` | key | Create a link. Body: `{ "url": "https://...", "customCode": "optional", "expiresAt": "optional UTC time" }` |
| `GET` | `/api/links` | key | List all links |
| `GET` | `/api/links/{code}` | key | Show one link's details and click count |
| `DELETE` | `/api/links/{code}` | key | Delete a link |
| `GET` | `/{code}` | public | 302 redirect and count the click. Returns 410 Gone if expired |
| `GET` | `/{code}/qr` | public | PNG QR code for the short URL |
| `GET` | `/health` | public | Health check |

Validation rules:
- URLs must be absolute `http` or `https`.
- A custom code is 3 to 32 characters of letters, digits, `-` or `_`. It can't be a reserved word (`api`, `swagger`, `health`, `qr`).
- `expiresAt` must be in the future.

Responses:
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

Integration tests use `WebApplicationFactory` with an in-memory SQLite database and a fake clock (`FakeTimeProvider`) for expiry tests.
