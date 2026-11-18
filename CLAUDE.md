# Ovi

Ovi is a self-hosted URL shortener with QR codes and click stats, live at https://getovi.link.

- **API:** `src/Ovi.Api`, .NET 10 minimal APIs with EF Core and Npgsql on Postgres (Neon in production). Areas: `Links`, `Accounts` (Google/GitHub OAuth, API key), `Admin`, `Security`, `Data`, `Infrastructure`.
- **Tests:** `tests/Ovi.Api.Tests`, xUnit integration tests against a real Postgres started with Testcontainers, so Docker must be running.
- **Web UI:** `web/`, React 19, Vite and Tailwind v4, tested with vitest. `npm run build` writes into `src/Ovi.Api/wwwroot`, which is gitignored. The API serves the UI.
- **Deploy:** `Dockerfile` (images pinned by digest) and `render.yaml`. CI (`.github/workflows/ci.yml`) builds, tests, checks licences and vulnerabilities, checks EF migrations, smoke-tests the image and publishes it to GHCR from `main`.

## Commands

```bash
dotnet build && dotnet test               # backend; needs Docker for the Postgres container
dotnet ef migrations has-pending-model-changes --project src/Ovi.Api   # must say "No changes"
cd web && npm ci && npm run typecheck && npm run build && npm test
python3 scripts/check-packages.py         # licences and known vulnerabilities, as CI runs it
```

If Docker isn't running in a cloud container, start it with `dockerd > /tmp/dockerd.log 2>&1 &`.

## Rules

- **Stay on .NET 10.** Moving to a new major version is a deliberate upgrade, not a Dependabot bump.
- **Security:** never commit secrets, and never weaken validation, authorization, the CSP (`script-src 'self'`, so no inline scripts), rate limits or the CSRF header check (`X-Ovi-Request`).
- **Shared rules:** URL and expiry validation lives in `Links/LinkRules.cs`. Reuse it; don't copy it.
- **UI colours** are tokens in `web/src/styles.css`, written with `light-dark()`. Use the tokens, never hard-coded colours, so light and dark mode both keep working.
- **Tests:** every behaviour change comes with tests. Never skip, delete or weaken a test to get green.
- **Git:** one topic per PR. Open PRs, merge and push only when the owner asks.

## The development team

This repo is developed by a team of Claude agents with a lead. The role definitions are in `.claude/agents/`, and the full working agreement is in [`docs/team.md`](docs/team.md).

- **Lead (the main session):** plans the work, assigns it, keeps the shared task list, settles disagreements and is the only one who talks to the owner, commits, pushes and opens PRs.
- **Teammates:** the roles listed in `docs/team.md`. They talk to each other directly with `SendMessage`, by name.

To start the team, ask the lead to "start the Ovi team for <goal>". Agent teams are an experimental feature, so set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` first, either under `env` in your Claude Code settings or as an environment variable.
