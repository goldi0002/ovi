import { ArrowRight, ChartColumn, ChevronDown, Clock3, Link2, MousePointerClick, QrCode, ShieldCheck, TimerOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, isExpired, type Link, type OviApi } from "../api";
import { BulkResult } from "../components/BulkResult";
import { BULK_TEXTAREA_ID } from "../components/BulkShortenForm";
import { CopyButton } from "../components/CopyButton";
import { InstallBanner } from "../components/InstallBanner";
import { FAQ_ITEMS } from "../components/Faq";
import { LinkResult } from "../components/LinkResult";
import { ShortenCard } from "../components/ShortenCard";
import { EmptyState, Skeleton, StatTile } from "../components/ui/primitives";
import { displayUrl, formatDateTime, formatRelative } from "../format";
import { AppLink, PAGES } from "../router";
import { button, card, container, errorBox, focusRing } from "../ui";
import { LegalLinks } from "./LegalPage";
import { usePageTitle } from "./common";

const numbers = new Intl.NumberFormat();

interface Props {
  api: OviApi;
  signedIn: boolean;
  /** First name or "Admin", for the greeting. */
  greetingName: string | null;
  anonymousLinkDays: number;
  onLogIn: () => void;
  onUnauthorized: () => void;
}

/**
 * The home page. Visitors get the shortener front and centre with a short explanation; signed-in users
 * get the dashboard, with the same shortener at the top. The shortener stays mounted when the session
 * changes, so a draft (or a bulk list after a sign-out) is never lost.
 */
export function HomePage({ api, signedIn, greetingName, anonymousLinkDays, onLogIn, onUnauthorized }: Props) {
  usePageTitle(signedIn ? "Dashboard" : null);
  // Bumped after every create, so the dashboard's numbers include the new links.
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <main className={signedIn ? `${container} flex-1 py-8 sm:py-10` : "flex-1"}>
      {signedIn ? <DashboardHeader name={greetingName} /> : <Hero />}
      <div className={signedIn ? "" : "mx-auto w-full max-w-2xl px-4 sm:px-6"}>
        <CreatePanel
          api={api}
          signedIn={signedIn}
          anonymousLinkDays={anonymousLinkDays}
          onLogIn={onLogIn}
          onUnauthorized={onUnauthorized}
          onChanged={changed}
        />
      </div>
      {signedIn ? <Dashboard api={api} version={version} onUnauthorized={onUnauthorized} /> : <LandingDetails />}
    </main>
  );
}

/** The shortener and, below it, the latest result: one link or a bulk batch. Showing one clears the other. */
function CreatePanel({
  api,
  signedIn,
  anonymousLinkDays,
  onLogIn,
  onUnauthorized,
  onChanged,
}: Omit<Props, "greetingName"> & { onChanged: () => void }) {
  const [created, setCreated] = useState<Link | null>(null);
  const [bulk, setBulk] = useState<Link[] | null>(null);
  const showCreated = useCallback(
    (link: Link) => {
      setBulk(null);
      setCreated(link);
      onChanged();
    },
    [onChanged],
  );
  const showBulk = useCallback(
    (links: Link[]) => {
      setCreated(null);
      setBulk(links);
      onChanged();
    },
    [onChanged],
  );
  const dismissBulk = useCallback(() => {
    setBulk(null);
    document.getElementById(BULK_TEXTAREA_ID)?.focus();
  }, []);

  // Signing out hides the dashboard; drop results that belonged to the account.
  useEffect(() => {
    if (!signedIn) {
      setCreated(null);
      setBulk(null);
    }
  }, [signedIn]);

  return (
    <div className="grid gap-4">
      <section className={`${card} p-4 sm:p-5`} aria-label="Shorten a link" id="create">
        <ShortenCard
          api={api}
          signedIn={signedIn}
          ready
          anonymousLinkDays={anonymousLinkDays}
          onLogIn={onLogIn}
          onCreated={showCreated}
          onBulkCreated={showBulk}
          onUnauthorized={onUnauthorized}
        />
      </section>
      {!created && !bulk && <InstallBanner />}
      {created && <LinkResult link={created} signedIn={signedIn} onDismiss={() => setCreated(null)} />}
      {bulk && <BulkResult links={bulk} onDismiss={dismissBulk} />}
    </div>
  );
}

/* ---------- Visitors ---------- */

function Hero() {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-8 pb-6 text-center sm:px-6 sm:pt-20 sm:pb-10">
      <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[3rem]">
        Make any link short enough to share.
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-pretty text-muted sm:mt-4 sm:text-[1.0625rem]">
        Get a short link and a QR code in a second. No account needed.
      </p>
    </div>
  );
}

const BENEFITS = [
  { icon: QrCode, title: "A QR code with every link", text: "Download a sharp PNG for print, slides or packaging. It always points to your short link." },
  { icon: ChartColumn, title: "Clicks, without tracking people", text: "See clicks per day, where they came from, and which devices and browsers. Never IP addresses." },
  { icon: Clock3, title: "Your code, your expiry", text: "Pick a code you can say out loud, like /launch, and set the day the link stops working." },
];

function LandingDetails() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
      <ul className="mt-12 grid gap-5 sm:mt-20 sm:grid-cols-3 sm:gap-8">
        {BENEFITS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3.5 sm:grid sm:content-start sm:gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text" aria-hidden="true">
              <Icon className="size-[18px]" />
            </span>
            <div>
              <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">{text}</p>
            </div>
          </li>
        ))}
      </ul>
      <Faq />
      <LegalLinks className="mt-12 justify-center" />
    </div>
  );
}

// The answers here are repeated in the FAQPage structured data in index.html; see Faq.tsx.
function Faq() {
  return (
    <section aria-labelledby="faq-title" className="mx-auto mt-16 max-w-2xl sm:mt-20">
      <h2 id="faq-title" className="text-center text-xl font-semibold tracking-[-0.01em]">
        Good to know
      </h2>
      <div className={`${card} mt-6 divide-y divide-line`}>
        {FAQ_ITEMS.map(({ q, a }) => (
          <details key={q} className="group">
            <summary
              className={`flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 text-[0.9375rem] font-medium hover:bg-hover/50 ${focusRing}`}
            >
              {q}
              <ChevronDown className="chevron size-4 shrink-0 text-muted transition-[rotate] duration-200" aria-hidden="true" />
            </summary>
            <p className="-mt-1 px-5 pb-4 text-sm leading-relaxed text-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ---------- Signed in ---------- */

function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function DashboardHeader({ name }: { name: string | null }) {
  return (
    <div className="mb-6 sm:mb-8">
      <h1 className="text-[1.625rem] leading-tight font-semibold tracking-[-0.02em] sm:text-[1.875rem]">
        {greeting()}
        {name ? `, ${name}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted">Make a new link, or check how your links are doing.</p>
    </div>
  );
}

/** The most links the dashboard reads to add up clicks (10 requests of 100). */
export const DASHBOARD_MAX_LINKS = 1000;
const BATCH = 100;

interface Summary {
  total: number;
  active: number;
  expired: number;
  clicks: number;
  /** How many links the click total covers; less than total for very large accounts. */
  counted: number;
  madeThisWeek: number;
  expiringSoon: number;
  lastClick: string | null;
  recent: Link[];
  top: Link[];
}

function summarise(links: Link[], total: number, active: number, expired: number, now = new Date()): Summary {
  const week = 7 * 86_400_000;
  const lastClick = links.reduce<string | null>((latest, l) => (l.lastClickedAt && (!latest || l.lastClickedAt > latest) ? l.lastClickedAt : latest), null);
  return {
    total,
    active,
    expired,
    clicks: links.reduce((sum, l) => sum + l.clicks, 0),
    counted: links.length,
    madeThisWeek: links.filter((l) => now.getTime() - new Date(l.createdAt).getTime() < week).length,
    expiringSoon: links.filter((l) => l.expiresAt && !isExpired(l, now) && new Date(l.expiresAt).getTime() - now.getTime() < week).length,
    lastClick,
    recent: links.slice(0, 5),
    top: [...links].filter((l) => l.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 5),
  };
}

/** Reads the account's links (newest first, up to DASHBOARD_MAX_LINKS) and the active and expired counts. */
function useSummary(api: OviApi, version: number, onUnauthorized: () => void) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [firstPage, active, expired] = await Promise.all([
          api.list(1, BATCH),
          api.list(1, 1, { status: "active" }),
          api.list(1, 1, { status: "expired" }),
        ]);
        const links = [...firstPage.items];
        const pages = Math.min(Math.ceil(firstPage.total / BATCH), DASHBOARD_MAX_LINKS / BATCH);
        for (let page = 2; page <= pages && live; page++) links.push(...(await api.list(page, BATCH)).items);
        if (live) {
          setSummary(summarise(links, firstPage.total, active.total, expired.total));
          setError(null);
        }
      } catch (err) {
        if (!live) return;
        if (err instanceof ApiError && err.status === 401) return onUnauthorized();
        setError(err instanceof ApiError ? err.message : "Couldn't load your dashboard.");
      }
    })();
    return () => {
      live = false;
    };
  }, [api, version, onUnauthorized]);

  return { summary, error };
}

function Dashboard({ api, version, onUnauthorized }: { api: OviApi; version: number; onUnauthorized: () => void }) {
  const { summary, error } = useSummary(api, version, onUnauthorized);
  const loading = summary === null && error === null;

  return (
    <div className="mt-8 grid gap-6">
      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}

      <section aria-label="Overview">
        <dl className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:-mx-4 max-sm:flex max-sm:snap-x max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 max-sm:[&>*]:min-w-[10rem] max-sm:[&>*]:shrink-0 max-sm:[&>*]:snap-start sm:gap-4">
          <StatTile
            icon={<Link2 />}
            label="Total links"
            loading={loading}
            value={summary && numbers.format(summary.total)}
            note={summary && (summary.madeThisWeek > 0 ? `${numbers.format(summary.madeThisWeek)} made this week` : "None made this week")}
          />
          <StatTile
            icon={<MousePointerClick />}
            label="Total clicks"
            loading={loading}
            value={summary && numbers.format(summary.clicks)}
            note={
              summary &&
              (summary.counted < summary.total
                ? `Across your newest ${numbers.format(summary.counted)} links`
                : summary.lastClick
                  ? `Last click ${formatRelative(summary.lastClick)}`
                  : "No clicks yet")
            }
          />
          <StatTile
            icon={<ShieldCheck />}
            label="Active links"
            loading={loading}
            value={summary && numbers.format(summary.active)}
            note={summary && (summary.expiringSoon > 0 ? `${numbers.format(summary.expiringSoon)} expire within a week` : "Working right now")}
          />
          <StatTile
            icon={<TimerOff />}
            label="Expired links"
            loading={loading}
            value={summary && numbers.format(summary.expired)}
            note="No longer redirect"
          />
        </dl>
      </section>

      {summary && summary.total === 0 ? (
        <EmptyState
          icon={<Link2 />}
          title="Your links will show up here"
          description="Shorten your first link above. You'll see its clicks, where they came from and its QR code."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel title="Recent links" action={{ href: PAGES.links, label: "View all" }}>
            {loading ? (
              <ListSkeleton />
            ) : (
              <ul className="divide-y divide-line">
                {summary?.recent.map((link) => (
                  <li key={link.code} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={link.shortUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`block truncate font-mono text-[0.8125rem] font-semibold underline-offset-4 hover:underline ${
                          isExpired(link) ? "text-muted" : "text-accent-text"
                        }`}
                        title={link.shortUrl}
                      >
                        {displayUrl(link.shortUrl)}
                      </a>
                      <p className="truncate text-xs text-muted" title={link.url}>
                        {link.url}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted tabular-nums max-sm:hidden">
                      <p className="font-medium text-ink">
                        {numbers.format(link.clicks)} {link.clicks === 1 ? "click" : "clicks"}
                      </p>
                      <p title={formatDateTime(link.createdAt)}>{formatRelative(link.createdAt)}</p>
                    </div>
                    <CopyButton text={link.shortUrl} iconOnly label="Copy link" ariaLabel={`Copy ${displayUrl(link.shortUrl)}`} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Top links" action={{ href: PAGES.analytics, label: "Analytics" }}>
            {loading ? (
              <ListSkeleton />
            ) : summary && summary.top.length > 0 ? (
              <ol className="grid gap-1 px-2 py-2">
                {summary.top.map((link) => (
                  <li key={link.code}>
                    <AppLink
                      href={`${PAGES.analytics}?code=${encodeURIComponent(link.code)}`}
                      className={`grid gap-1.5 rounded-lg px-3 py-2.5 hover:bg-hover ${focusRing}`}
                      aria-label={`Analytics for /${link.code}, ${numbers.format(link.clicks)} clicks`}
                    >
                      <span className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
                        <span className="truncate font-mono font-semibold">/{link.code}</span>
                        <span className="shrink-0 font-medium tabular-nums">{numbers.format(link.clicks)}</span>
                      </span>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-segment" aria-hidden="true">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${Math.max(4, (link.clicks / summary.top[0].clicks) * 100)}%` }}
                        />
                      </span>
                    </AppLink>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState plain icon={<MousePointerClick />} title="No clicks yet" description="Share a link and its clicks will show up here." />
            )}
          </Panel>
        </div>
      )}

      <nav aria-label="Shortcuts" className="grid gap-3 max-sm:hidden sm:grid-cols-3">
        {[
          { href: PAGES.links, icon: Link2, title: "Manage links", text: "Search, edit and delete" },
          { href: PAGES.analytics, icon: ChartColumn, title: "See analytics", text: "Clicks, referrers, devices" },
          { href: PAGES.qrCodes, icon: QrCode, title: "Get QR codes", text: "Download a PNG for any link" },
        ].map(({ href, icon: Icon, title, text }) => (
          <AppLink
            key={href}
            href={href}
            className={`${card} group flex items-center gap-3 px-4 py-3.5 transition-shadow hover:shadow-card-hover ${focusRing}`}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text" aria-hidden="true">
              <Icon className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block truncate text-xs text-muted">{text}</span>
            </span>
            <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </AppLink>
        ))}
      </nav>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className={`${card} overflow-hidden`} aria-label={title}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
        <AppLink href={action.href} className={button("ghost", "sm", "-mr-2 text-accent-text")}>
          {action.label}
          <ArrowRight />
        </AppLink>
      </div>
      {children}
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 px-5 py-4" role="status" aria-label="Loading">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid gap-2">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
