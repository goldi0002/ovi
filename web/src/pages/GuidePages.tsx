import { type ReactNode, useState } from "react";
import type { Link, OviApi } from "../api";
import { LinkResult } from "../components/LinkResult";
import { ShortenCard } from "../components/ShortenCard";
import { AppLink, PAGES } from "../router";
import { button, card, container, focusRing } from "../ui";
import { LegalLinks } from "./LegalPage";
import { usePageTitle } from "./common";

/** The project's home, for people who want the source code or to run their own copy. */
export const SOURCE_URL = "https://github.com/goldi0002/ovi";

const linkClass = `rounded font-medium text-accent-text underline-offset-2 hover:underline ${focusRing}`;

/** Links from the home page and the guides to each other, and to the source. */
export function MoreLinks({ className = "" }: { className?: string }) {
  const cls = `rounded hover:text-ink hover:underline underline-offset-2 ${focusRing}`;
  return (
    <nav aria-label="More" className={`flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-muted ${className}`}>
      <AppLink className={cls} href={PAGES.qrCodeGenerator}>
        QR code generator
      </AppLink>
      <AppLink className={cls} href={PAGES.selfHost}>
        Self-host Ovi
      </AppLink>
      <a className={cls} href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
        Source code
      </a>
    </nav>
  );
}

function Guide({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <main className={`${container} flex-1 py-8 sm:py-12`}>
      <article className="mx-auto max-w-2xl">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[2.25rem]">{title}</h1>
        <p className="mt-3 text-base leading-relaxed text-muted sm:text-[1.0625rem]">{intro}</p>
        {children}
        <MoreLinks className="mt-12 border-t border-line pt-5" />
        <LegalLinks className="mt-2" />
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="mt-2 grid gap-3 text-[0.9375rem] leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-ink">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-subtle p-4 text-[0.8125rem] leading-relaxed text-ink">
      <code>{children}</code>
    </pre>
  );
}

/* ---------- QR code generator ---------- */

interface QrProps {
  api: OviApi;
  signedIn: boolean;
  anonymousLinkDays: number;
  onLogIn: () => void;
  onUnauthorized: () => void;
}

/** A page that answers "free QR code generator", with the working tool on it. */
export function QrCodeGeneratorPage({ api, signedIn, anonymousLinkDays, onLogIn, onUnauthorized }: QrProps) {
  usePageTitle("Free QR code generator");
  const [created, setCreated] = useState<Link | null>(null);

  return (
    <Guide
      title="Free QR code generator"
      intro="Paste a URL and get a QR code you can download as a PNG, in a second, without an account. The code points to a short link, so it stays simple to scan."
    >
      <div className="mt-8 grid gap-4">
        <section className={`${card} p-4 sm:p-5`} aria-label="Make a QR code">
          <ShortenCard
            api={api}
            signedIn={signedIn}
            ready
            anonymousLinkDays={anonymousLinkDays}
            onLogIn={onLogIn}
            onCreated={setCreated}
            onBulkCreated={() => undefined}
            onUnauthorized={onUnauthorized}
          />
        </section>
        {created && <LinkResult link={created} signedIn={signedIn} onDismiss={() => setCreated(null)} />}
      </div>

      <Section title="How it works">
        <ol className="grid list-decimal gap-1.5 pl-5">
          <li>Paste the web address you want people to reach and press <strong>Shorten URL</strong>.</li>
          <li>Press <strong>QR code</strong> next to the new short link to see and download the PNG.</li>
          <li>Print it, put it on a slide, or share the image. Anyone who scans it lands on your page.</li>
        </ol>
      </Section>

      <Section title="Why the QR code points to a short link">
        <p>
          A long URL makes a dense QR code that is harder to scan from a distance or on small print. A short link makes a sparser code that scans reliably.
        </p>
        <p>
          It also gives you control later. After you <button type="button" className={linkClass} onClick={onLogIn}>sign in</button>, you can change where a link goes
          without reprinting the code, and see how many times it was opened. Every scan counts as a click.
        </p>
      </Section>

      <Section title="Before you print one">
        <p>
          Links made without an account expire after <strong>{anonymousLinkDays} days</strong>, and then so does the QR code. For anything printed, sign in
          with Google or GitHub and leave the expiry empty so the link keeps working.
        </p>
      </Section>

      <Section title="Free, and private">
        <p>
          No sign-up for a quick code, no watermark, no limit on scans. Click stats store only the time, the referring site, a device type and a browser type:
          no IP addresses. Ovi is open source, and you can <AppLink className={linkClass} href={PAGES.selfHost}>run your own copy</AppLink>.
        </p>
      </Section>
    </Guide>
  );
}

/* ---------- Self-hosting ---------- */

const COMPOSE = `curl -O https://raw.githubusercontent.com/goldi0002/ovi/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/goldi0002/ovi/main/.env.example
# Edit .env: set OVI_PUBLIC_URL, OVI_API_KEY and POSTGRES_PASSWORD
docker compose up -d`;

const CADDY = `links.example.com {
    reverse_proxy localhost:8080
}`;

/** A page for people looking for a self-hosted URL shortener. */
export function SelfHostPage() {
  usePageTitle("Self-host a URL shortener");
  return (
    <Guide
      title="Self-host a URL shortener"
      intro="Ovi is free, open-source software. Run it on your own server with Docker Compose: the app and a Postgres database, with short links, QR codes and click stats that don't track people."
    >
      <div className="mt-8 flex flex-wrap gap-2">
        <a className={button("primary", "md")} href={`${SOURCE_URL}#self-host-with-docker-compose`} target="_blank" rel="noopener noreferrer">
          Read the setup guide
        </a>
        <a className={button("default", "md")} href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          View the source on GitHub
        </a>
      </div>

      <Section title="What you get">
        <ul className="grid list-disc gap-1.5 pl-5">
          <li>Short links with random or custom codes, and expiry dates.</li>
          <li>A QR code for every link.</li>
          <li>Click stats by day, referrer, device and browser. No IP addresses and no full user agents are stored.</li>
          <li>Bulk shortening, sign-in with Google or GitHub, an admin dashboard and abuse reporting.</li>
          <li>One stateless container. All data is in Postgres, and migrations run on start. It runs on amd64 and ARM64, including a Raspberry Pi 4 or 5.</li>
        </ul>
      </Section>

      <Section title="Run it in about two minutes">
        <p>You need Docker. Download the compose file and the example settings, fill in three values, and start it:</p>
        <Code>{COMPOSE}</Code>
        <p>
          Ovi is then on <strong>http://localhost:8080</strong>. Upgrading is <code>docker compose pull &amp;&amp; docker compose up -d</code>.
        </p>
      </Section>

      <Section title="Put it on your own domain">
        <p>
          For a public site, put a reverse proxy with TLS in front. With Caddy, which fetches the certificate for you, this is the whole config. Then set{" "}
          <code>OVI_PUBLIC_URL</code> to that address.
        </p>
        <Code>{CADDY}</Code>
      </Section>

      <Section title="Other ways to run it">
        <p>
          Ovi also deploys to Render on the free plan with a Neon Postgres database, or from the plain Docker image with your own database. Both are in the{" "}
          <a className={linkClass} href={`${SOURCE_URL}#readme`} target="_blank" rel="noopener noreferrer">
            README
          </a>
          .
        </p>
      </Section>

      <Section title="Licence">
        <p>
          Ovi is released under the AGPL-3.0. You can run, change and share it. If you run a changed version as a service for others, you must offer them its source
          code. Want to try it first? <AppLink className={linkClass} href={PAGES.home}>Shorten a link here</AppLink>.
        </p>
      </Section>
    </Guide>
  );
}
