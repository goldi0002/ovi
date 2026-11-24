# Launch posts (drafts for the owner to review and post)

Nothing here has been posted. Read each one, edit it in your own voice, and check that the claims are still true when you post. Don't post the same text in several places on the same day: spread them over a week and answer every comment.

Link to use: https://getovi.link · Source: https://github.com/goldi0002/ovi

## X / Twitter thread

1. I built Ovi: a URL shortener you can run yourself. Short links, QR codes and click stats that don't track your visitors. Open source (AGPL).
   Try it, no account needed: https://getovi.link

2. Why another shortener? Most track a lot about whoever clicks. Ovi stores only the time, the referring site, a device type and a browser type. No IP addresses, no full user agents.

3. Self-hosting is three commands: download the compose file, set three values, `docker compose up -d`. One container plus Postgres. Runs on amd64 and ARM64, so a Raspberry Pi works too.
   https://getovi.link/self-host

4. Also: free QR code generator with no sign-up: https://getovi.link/qr-code-generator
   Bulk shortening from a CSV, custom codes, expiry dates, an admin dashboard and abuse reporting.

5. Source and docs: https://github.com/goldi0002/ovi
   A star helps others find it. Feedback and bug reports very welcome.

Hashtags (use one or two, not all): #selfhosted #opensource #dotnet #privacy

## Show HN

**Title:** Show HN: Ovi – self-hosted URL shortener with QR codes and click stats that don't track people

**Text:**

I wanted a short-link service I could run myself that gave me click counts without keeping a log of who clicked. Ovi is that: paste a URL and get a short link and a QR code. Each click stores only the time, the referring site's name, a device category and a browser category, not IP addresses or full user agents.

It's one container plus Postgres (Docker Compose file included, amd64 and ARM64), a .NET 10 minimal API with a React UI served from the same process. Sign-in is optional (Google or GitHub): without an account you get a random code and the link expires after 30 days; with one you get custom codes, no expiry, bulk creation from a CSV and a stats page. There's an admin dashboard, rate limits, a blocklist, an optional Google Safe Browsing check and a public report page.

Live: https://getovi.link · Self-hosting: https://getovi.link/self-host · Source (AGPL-3.0): https://github.com/goldi0002/ovi

I'd like to hear what's missing for you to switch from Shlink or YOURLS, and what you'd want from the stats. I'll be around to answer questions.

Tips: post on a weekday morning (US Eastern), make sure the demo works first, and stay in the thread for the first few hours.

## r/selfhosted

**Title:** Ovi: a small self-hosted URL shortener with QR codes and privacy-friendly click stats (one container + Postgres)

**Body:**

Hi all. I've been building Ovi, a URL shortener meant to be easy to run and kind to the people who click the links.

- One container plus Postgres, with a `docker-compose.yml` and an `.env.example`. amd64 and ARM64 images (a Pi 4/5 works).
- Web UI in the same container, light and dark mode, installable as an app.
- QR code for every link, bulk shortening from a CSV, custom codes, expiry dates.
- Click stats (per day, referrers, devices, browsers) without storing IP addresses or full user agents.
- Optional Google/GitHub sign-in, an admin dashboard, rate limits and an abuse report page.
- AGPL-3.0. Images are published to GHCR and tagged by version, so `docker compose pull` stays within 1.x.

Try it without installing anything: https://getovi.link
Setup in about two minutes: https://getovi.link/self-host
Code: https://github.com/goldi0002/ovi

I'm looking for feedback on setup, on what you'd want that isn't there (for example other databases or SSO), and on anything that broke for you. Happy to answer questions.

Check r/selfhosted's current rules on self-promotion before posting, and read the sidebar. If new accounts or links are restricted, ask the moderators first.

## Where else to submit (each is a one-off task)

- awesome-selfhosted (pull request to the list, under "URL Shorteners"; needs a licence, a demo and Docker instructions, which Ovi has)
- selfh.st apps directory and AlternativeTo (as an alternative to Bitly, Shlink and YOURLS)
- Unraid / CasaOS / Coolify / Portainer app templates (each has its own format)
- Product Hunt, Lobsters, dev.to and Hashnode (an article such as "Building a privacy-friendly URL shortener on .NET 10")
- GitHub: add the repository topics `url-shortener`, `self-hosted`, `qr-code`, `dotnet`, `postgres`, `privacy`, a one-line description and the social preview image `web/public/og.png` (Settings → Social preview). Only you can do these on GitHub.
