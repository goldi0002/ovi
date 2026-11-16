# ovi

A small URL shortener API built with ASP.NET Core minimal APIs (.NET 8), EF Core and SQLite.

## Run

```bash
dotnet run --project src/Ovi.Api --urls http://localhost:5080
```

Swagger UI: http://localhost:5080/swagger. The database is `ovi.db`, created on first run. Set `ConnectionStrings:Default` to change it.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/links` | Create a link. Body: `{ "url": "https://...", "customCode": "optional" }` |
| `GET` | `/api/links` | List all links |
| `GET` | `/api/links/{code}` | Show one link's details and click count |
| `DELETE` | `/api/links/{code}` | Delete a link |
| `GET` | `/{code}` | 302 redirect to the target, counting the click |
| `GET` | `/health` | Health check |

URLs must be absolute `http` or `https`. A custom code is 3 to 32 characters of letters, digits, `-` or `_`, and can't be a reserved word (`api`, `swagger`, `health`).

```bash
curl -X POST localhost:5080/api/links -H 'content-type: application/json' \
  -d '{"url":"https://learn.microsoft.com/dotnet","customCode":"dotnet"}'
curl -i localhost:5080/dotnet
```

## Test

```bash
dotnet test
```

Integration tests use `WebApplicationFactory` with an in-memory SQLite database.
