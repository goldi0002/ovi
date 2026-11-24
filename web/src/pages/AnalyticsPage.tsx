import { ChartColumn, ChevronDown, ExternalLink, Link2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, isExpired, type Link, type OviApi } from "../api";
import { CopyButton } from "../components/CopyButton";
import { Status } from "../components/LinksTable";
import { LinkStatsView } from "../components/StatsDialog";
import { EmptyState, PageHeader, SearchField, Skeleton } from "../components/ui/primitives";
import { displayUrl, formatDateTime } from "../format";
import { AppLink, PAGES, navigate, useSearch } from "../router";
import { DEFAULT_RANGE, parseRange } from "../statsExport";
import { button, card, container, errorBox, focusRing, iconButton } from "../ui";
import { SEARCH_DELAY_MS } from "../components/LinksTable";
import { SignedOutPanel, usePageTitle } from "./common";

const numbers = new Intl.NumberFormat();
const LIST_SIZE = 50;

interface Props {
  api: OviApi;
  state: "loading" | "signedIn" | "signedOut";
  onLogIn: () => void;
  onUnauthorized: () => void;
}

/** Click stats for one link at a time, picked from a searchable list. The link is in the URL (?code=). */
export function AnalyticsPage({ api, state, onLogIn, onUnauthorized }: Props) {
  usePageTitle("Analytics");
  return (
    <main className={`${container} flex-1 py-8 sm:py-10`}>
      <PageHeader title="Analytics" description="Clicks over time, where they came from, and what people used." />
      {state === "loading" ? null : state === "signedIn" ? (
        <Analytics api={api} onUnauthorized={onUnauthorized} />
      ) : (
        <SignedOutPanel title="Sign in to see your analytics" onLogIn={onLogIn} />
      )}
    </main>
  );
}

function Analytics({ api, onUnauthorized }: { api: OviApi; onUnauthorized: () => void }) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const selectedCode = params.get("code");
  const days = parseRange(params.get("days"));
  // The range stays in the URL (?days=), so it survives a reload; the default isn't written out.
  const analyticsUrl = (code: string, range = days) =>
    `${PAGES.analytics}?code=${encodeURIComponent(code)}${range === DEFAULT_RANGE ? "" : `&days=${range}`}`;
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [links, setLinks] = useState<Link[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // A link named in the URL that isn't in the list (an older one, or outside the search) is looked up on its own.
  const [lookup, setLookup] = useState<{ code: string; link: Link | null } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const term = typed.trim();
    if (term === q) return;
    const timer = setTimeout(() => setQ(term), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, q]);

  useEffect(() => {
    const id = ++latest.current;
    api
      .list(1, LIST_SIZE, { q })
      .then((page) => {
        if (id !== latest.current) return;
        setLinks(page.items);
        setTotal(page.total);
        setError(null);
      })
      .catch((err) => {
        if (id !== latest.current) return;
        if (err instanceof ApiError && err.status === 401) return onUnauthorized();
        setError(err instanceof ApiError ? err.message : "Couldn't load your links.");
      });
  }, [api, q, onUnauthorized]);

  // Without ?code=, show the newest link.
  useEffect(() => {
    if (!selectedCode && !q && links && links.length > 0) navigate(analyticsUrl(links[0].code), { replace: true });
  }, [selectedCode, q, links]);

  const inList = links?.find((l) => l.code === selectedCode) ?? null;
  useEffect(() => {
    if (!selectedCode || !links || inList || lookup?.code === selectedCode) return;
    let live = true;
    const done = (link: Link | null) => live && setLookup({ code: selectedCode, link });
    api
      .list(1, 10, { q: selectedCode })
      .then((page) => done(page.items.find((l) => l.code === selectedCode) ?? null))
      .catch(() => done(null));
    return () => {
      live = false;
    };
  }, [selectedCode, links, inList, lookup, api]);
  const selected = inList ?? (lookup?.code === selectedCode ? lookup.link : null);
  const notFound = !!selectedCode && !!links && !inList && lookup?.code === selectedCode && lookup.link === null;

  function choose(link: Link) {
    navigate(analyticsUrl(link.code), { replace: true });
    setPickerOpen(false);
  }

  if (error) return <p className={errorBox} role="alert">{error}</p>;

  if (links && links.length === 0 && !q) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="No links to measure yet"
        description="Create a short link and share it. Its clicks, referrers, devices and browsers show up here."
        action={
          <AppLink href={`${PAGES.home}#shorten`} className={button("primary", "md")}>
            <Plus />
            Create a link
          </AppLink>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className={`${card} overflow-hidden lg:sticky lg:top-6`} aria-label="Choose a link">
        {/* On smaller screens the list folds away behind the chosen link. */}
        <button
          type="button"
          className={`flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left lg:hidden ${focusRing}`}
          aria-expanded={pickerOpen}
          aria-controls="analytics-links"
          onClick={() => setPickerOpen((v) => !v)}
        >
          <span className="min-w-0">
            <span className="block text-xs text-muted">Showing</span>
            <span className="block truncate font-mono text-sm font-semibold">{selected ? `/${selected.code}` : "Choose a link"}</span>
          </span>
          <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${pickerOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <div id="analytics-links" className={`${pickerOpen ? "" : "max-lg:hidden"} max-lg:border-t max-lg:border-line`}>
          <div className="p-3 pb-2">
            <SearchField value={typed} onChange={setTyped} label="Search links" placeholder="Search links" />
          </div>
          {links === null ? (
            <div className="grid gap-3 px-4 py-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : links.length === 0 ? (
            <p className="px-4 pt-2 pb-5 text-center text-[0.8125rem] text-muted">No links match “{q}”.</p>
          ) : (
            <ul className="max-h-[min(60vh,36rem)] overflow-y-auto px-2 pb-2" aria-label="Links">
              {links.map((link) => {
                const on = link.code === selectedCode;
                return (
                  <li key={link.code}>
                    <button
                      type="button"
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${focusRing} ${
                        on ? "bg-accent-soft" : "hover:bg-hover"
                      }`}
                      aria-current={on ? "true" : undefined}
                      onClick={() => choose(link)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-mono text-[0.8125rem] font-semibold ${on ? "text-accent-text" : isExpired(link) ? "text-muted" : ""}`}>
                          /{link.code}
                        </span>
                        <span className="block truncate text-xs text-muted">{displayUrl(link.url)}</span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-muted tabular-nums" aria-label={`${link.clicks} clicks`}>
                        {numbers.format(link.clicks)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {links && total > links.length && (
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
              Showing the newest {links.length} of {numbers.format(total)}. Search to find others.
            </p>
          )}
        </div>
      </aside>

      <section className={`${card} min-w-0 p-5 sm:p-6`} aria-label="Link analytics">
        {selected ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-semibold tracking-[-0.01em]">
                  <span className="truncate font-mono">/{selected.code}</span>
                  <Status link={selected} />
                </h2>
                <p className="mt-1 truncate text-[0.8125rem] text-muted" title={selected.url}>
                  {selected.url}
                </p>
                <p className="mt-0.5 text-xs text-muted">Created {formatDateTime(selected.createdAt)}</p>
              </div>
              <div className="flex gap-1">
                <CopyButton text={selected.shortUrl} iconOnly label="Copy link" ariaLabel={`Copy ${displayUrl(selected.shortUrl)}`} />
                <a className={iconButton} href={selected.shortUrl} target="_blank" rel="noreferrer" aria-label={`Open /${selected.code}`} data-tip="Open">
                  <ExternalLink />
                </a>
              </div>
            </div>
            <LinkStatsView
              key={selected.code}
              api={api}
              code={selected.code}
              onUnauthorized={onUnauthorized}
              days={days}
              onDaysChange={(range) => navigate(analyticsUrl(selected.code, range), { replace: true })}
            />
          </div>
        ) : notFound ? (
          <EmptyState plain icon={<Link2 />} title="That link isn't here" description={`There's no link /${selectedCode} in your account. Pick one from the list.`} />
        ) : (
          <div className="grid gap-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="mt-4 h-56 w-full rounded-xl" />
          </div>
        )}
      </section>
    </div>
  );
}
