import { ChartColumn, ChevronLeft, ChevronRight, Link2, Pencil, Plus, QrCode, RefreshCw, SearchX, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isExpired, type Link, type LinkSort, type LinkStatus, type OviApi, type Page } from "../api";
import { displayUrl, formatDateTime, formatRelative } from "../format";
import { AppLink, navigate, PAGES } from "../router";
import { button, card, errorBox, iconButton, input } from "../ui";
import { CopyButton } from "./CopyButton";
import { EditLinkDialog } from "./EditLinkDialog";
import { StatsDialog } from "./StatsDialog";
import { useConfirm } from "./ui/Confirm";
import { Badge, EmptyState, SearchField, SegmentedControl, Skeleton } from "./ui/primitives";
import { useToast } from "./ui/Toast";

const PAGE_SIZE = 20;

/** How long typing pauses before the search runs, so each key doesn't fire a request. */
export const SEARCH_DELAY_MS = 300;

const STATUSES: { value: LinkStatus; label: string; heading: string }[] = [
  { value: "all", label: "All", heading: "All links" },
  { value: "active", label: "Active", heading: "Active links" },
  { value: "expired", label: "Expired", heading: "Expired links" },
];

const SORTS: { value: LinkSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "clicks", label: "Most clicked" },
  { value: "expiring", label: "Expiring soon" },
];

/** The search, status and sort the address holds (?q=docs&status=active&sort=clicks); anything unknown means the default. */
function readUrlState(): { q: string; status: LinkStatus; sort: LinkSort } {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  const sort = params.get("sort");
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    status: STATUSES.find((s) => s.value === status)?.value ?? "all",
    sort: SORTS.find((s) => s.value === sort)?.value ?? "newest",
  };
}

interface Props {
  api: OviApi;
  onUnauthorized: () => void;
}

// A fixed-layout table from md up, so long URLs are cut off instead of widening the page.
// Below md each row becomes a small card: code and clicks, then the destination, then status and actions.
const th = "border-b border-line px-4 py-2.5 text-left text-xs font-medium text-muted first:pl-5 last:pr-5";
const td = "px-4 py-3 align-middle first:pl-5 last:pr-5 max-md:p-0 max-md:first:pl-0 max-md:last:pr-0";

/** Whether a link works, and until when. */
export function Status({ link }: { link: Link }) {
  if (isExpired(link)) return <Badge dot>Expired</Badge>;
  if (link.expiresAt)
    return (
      <Badge dot tone="warning" title={formatDateTime(link.expiresAt)}>
        Expires {formatRelative(link.expiresAt)}
      </Badge>
    );
  return (
    <Badge dot tone="success">
      Active
    </Badge>
  );
}

export function LinksTable({ api, onUnauthorized }: Props) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Link> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [statsFor, setStatsFor] = useState<Link | null>(null);
  const closeStats = useCallback(() => setStatsFor(null), []);
  const [editing, setEditing] = useState<Link | null>(null);
  const closeEdit = useCallback(() => setEditing(null), []);
  /** What's typed in the search box; `q` follows it after a pause. */
  const [initial] = useState(readUrlState);
  const [search, setSearch] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState<LinkStatus>(initial.status);
  const [sort, setSort] = useState<LinkSort>(initial.sort);
  // Only the latest request may update the table, so a slow earlier search can't overwrite a newer one.
  const latest = useRef(0);
  const confirm = useConfirm();
  const notify = useToast();

  const load = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.list(page, PAGE_SIZE, { q, status, sort });
      if (id === latest.current) setData(result);
    } catch (err) {
      if (id !== latest.current) return;
      if (err instanceof ApiError && err.status === 401) return onUnauthorized();
      setError(err instanceof ApiError ? err.message : "Couldn't load links.");
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [api, page, q, status, sort, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const term = search.trim();
    if (term === q) return;
    const timer = setTimeout(() => {
      setQ(term);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, q]);

  // Keep the address in step with the search, status and sort (defaults leave no trace), so a reload or a shared link
  // shows the same list. Replacing, not pushing, so Back doesn't step through every keystroke.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = [["q", q], ["status", status === "all" ? "" : status], ["sort", sort === "newest" ? "" : sort]];
    for (const [key] of state) params.delete(key);
    for (const [key, value] of state) if (value) params.set(key, value); // a fixed order, so the address is stable
    const query = params.toString();
    if (query !== window.location.search.slice(1)) navigate(`${window.location.pathname}${query && `?${query}`}${window.location.hash}`, { replace: true });
  }, [q, status, sort]);

  function changeSort(next: LinkSort) {
    setSort(next);
    setPage(1);
  }

  function changeStatus(next: LinkStatus) {
    setStatus(next);
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setQ("");
    setStatus("all");
    setPage(1);
  }

  const saved = useCallback((updated: Link) => {
    setData((d) => d && { ...d, items: d.items.map((l) => (l.code === updated.code ? updated : l)) });
    setEditing(null);
  }, []);

  const filtered = q !== "" || status !== "all";

  async function remove(code: string) {
    const ok = await confirm({
      title: `Delete /${code}?`,
      message: "Anyone using it will get “not found”, and the code can't be used again.",
      confirmLabel: "Delete link",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(code);
    try {
      await api.remove(code);
      notify(`Deleted /${code}`);
      // Step back a page if this removed the last item on it.
      if (data && data.items.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onUnauthorized();
      setError(err instanceof ApiError ? err.message : "Couldn't delete the link.");
    } finally {
      setDeleting(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const first = data ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastShown = data ? Math.min(data.total, (page - 1) * PAGE_SIZE + data.items.length) : 0;

  return (
    <section aria-label="Your links" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={search}
          onChange={setSearch}
          label="Search links"
          placeholder="Search by code or destination"
          className="min-w-48 flex-1 sm:max-w-sm"
        />
        <SegmentedControl
          label="Status"
          options={STATUSES}
          value={status}
          onChange={changeStatus}
          className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1"
        />
        <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted max-sm:w-full">
          Sort by
          <select
            className={`${input} w-auto max-sm:flex-1`}
            value={sort}
            onChange={(e) => changeSort(e.target.value as LinkSort)}
          >
            {SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}

      <div className={`${card} overflow-hidden max-md:rounded-none max-md:bg-transparent max-md:shadow-none`}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 max-md:px-0 max-md:pt-0">
          <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
            {STATUSES.find((s) => s.value === status)!.heading}
            {data && (
              <span className="rounded-full bg-subtle px-2 py-px text-xs font-medium text-muted tabular-nums">{data.total}</span>
            )}
          </h2>
          <button
            type="button"
            className={iconButton}
            onClick={() => void load()}
            disabled={loading}
            aria-label={loading ? "Loading…" : "Refresh"}
            data-tip="Refresh"
          >
            <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : undefined} />
          </button>
        </div>

        {!data && loading && <TableSkeleton />}

        {data &&
          data.items.length === 0 &&
          !loading &&
          (filtered ? (
            <EmptyState
              plain
              icon={<SearchX />}
              title={q ? `No ${status === "all" ? "" : `${status} `}links match “${q}”.` : `No ${status} links.`}
              description="Try another search, or show every link."
              action={
                <button type="button" className={button("default", "md")} onClick={clearFilters}>
                  Clear search and filter
                </button>
              }
            />
          ) : (
            <EmptyState
              plain
              icon={<Link2 />}
              title="No links yet"
              description="Shorten your first link from the dashboard. It will show up here with its clicks."
              action={
                <AppLink href={`${PAGES.home}#shorten`} className={button("primary", "md")}>
                  <Plus />
                  Create a link
                </AppLink>
              }
            />
          ))}

        {data && data.items.length > 0 && (
          <table className="w-full table-fixed border-collapse text-sm max-md:block">
            <thead className="max-md:hidden">
              <tr>
                <th className={`${th} w-44`}>Short link</th>
                <th className={th}>Destination</th>
                <th className={`${th} w-20 text-right`}>Clicks</th>
                <th className={`${th} w-32 max-lg:hidden`}>Created</th>
                <th className={`${th} w-44`}>Status</th>
                <th className={`${th} w-46`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="max-md:grid max-md:gap-3">
              {data.items.map((link) => {
                const expired = isExpired(link);
                return (
                  <tr
                    key={link.code}
                    className={`transition-colors md:border-b md:border-line md:last:border-b-0 md:hover:bg-hover/60 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-2 max-md:rounded-xl max-md:bg-surface max-md:px-4 max-md:pt-3.5 max-md:pb-2.5 max-md:shadow-card ${
                      deleting === link.code ? "opacity-50" : ""
                    }`}
                  >
                    <td className={`${td} truncate max-md:col-start-1 max-md:row-start-1`}>
                      <a
                        href={link.shortUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`font-mono text-[0.8125rem] font-semibold underline-offset-4 hover:underline ${expired ? "text-muted" : "text-accent-text"}`}
                        title={link.shortUrl}
                      >
                        /{link.code}
                      </a>
                    </td>
                    <td className={`${td} truncate text-muted max-md:col-span-2 max-md:row-start-2 max-md:text-[0.8125rem]`} title={link.url}>
                      {link.url}
                    </td>
                    <td className={`${td} text-right font-medium tabular-nums max-md:col-start-2 max-md:row-start-1 max-md:text-[0.8125rem] max-md:font-normal max-md:text-muted`}>
                      <span>{link.clicks}</span>
                      <span className="md:hidden"> {link.clicks === 1 ? "click" : "clicks"}</span>
                    </td>
                    <td className={`${td} whitespace-nowrap text-muted max-lg:hidden`} title={formatDateTime(link.createdAt)}>
                      {formatRelative(link.createdAt)}
                    </td>
                    <td className={`${td} max-md:col-start-1 max-md:row-start-3 max-md:self-center`}>
                      <Status link={link} />
                    </td>
                    <td className={`${td} max-md:col-start-2 max-md:row-start-3`}>
                      <div className="flex justify-end gap-0.5">
                        <CopyButton text={link.shortUrl} iconOnly label="Copy link" ariaLabel={`Copy ${displayUrl(link.shortUrl)}`} />
                        <button
                          type="button"
                          className={iconButton}
                          onClick={() => setStatsFor(link)}
                          aria-label={`Stats for /${link.code}`}
                          data-tip="Stats"
                        >
                          <ChartColumn />
                        </button>
                        {expired ? (
                          // The server no longer serves an expired link's QR code.
                          <button type="button" className={iconButton} disabled aria-label={`QR code for /${link.code} (expired)`}>
                            <QrCode />
                          </button>
                        ) : (
                          <a
                            className={iconButton}
                            href={link.qrCodeUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`QR code for /${link.code}`}
                            data-tip="QR code"
                          >
                            <QrCode />
                          </a>
                        )}
                        <button
                          type="button"
                          className={iconButton}
                          onClick={() => setEditing(link)}
                          aria-label={`Edit /${link.code}`}
                          data-tip="Edit"
                        >
                          <Pencil />
                        </button>
                        <button
                          type="button"
                          className={`${iconButton} hover:not-disabled:text-danger`}
                          onClick={() => void remove(link.code)}
                          disabled={deleting === link.code}
                          aria-label={`Delete /${link.code}`}
                          data-tip="Delete"
                        >
                          <Trash2 />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {statsFor && <StatsDialog api={api} link={statsFor} onClose={closeStats} onUnauthorized={onUnauthorized} />}
      {editing && <EditLinkDialog api={api} link={editing} onClose={closeEdit} onSaved={saved} onUnauthorized={onUnauthorized} />}

      {data && totalPages > 1 && (
        <Pager page={page} totalPages={totalPages} onPage={setPage} range={`${first}–${lastShown} of ${data.total}`} />
      )}
    </section>
  );
}

/** Previous / Next with where you are. */
export function Pager({ page, totalPages, onPage, range }: { page: number; totalPages: number; onPage: (page: number) => void; range?: string }) {
  return (
    <nav className="flex items-center justify-between gap-3 text-[0.8125rem]" aria-label="Pages">
      <span className="text-muted tabular-nums max-sm:hidden">{range}</span>
      <div className="flex items-center gap-3 max-sm:w-full max-sm:justify-between">
        <button type="button" className={button("default", "sm")} onClick={() => onPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft />
          Previous
        </button>
        <span className="text-muted tabular-nums">
          Page {page} of {totalPages}
        </span>
        <button type="button" className={button("default", "sm")} onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          Next
          <ChevronRight />
        </button>
      </div>
    </nav>
  );
}

function TableSkeleton() {
  return (
    <div className="grid divide-y divide-line border-t border-line max-md:gap-3 max-md:divide-y-0 max-md:border-0" role="status" aria-label="Loading links">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-6 px-5 py-4 max-md:rounded-xl max-md:bg-surface max-md:shadow-card">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-10 max-md:hidden" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
