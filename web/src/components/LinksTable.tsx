import { ChartColumn, ChevronLeft, ChevronRight, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, isExpired, type Link, type OviApi, type Page } from "../api";
import { formatDateTime, formatRelative } from "../format";
import { CopyButton } from "./CopyButton";
import { StatsDialog } from "./StatsDialog";
import { button, card, errorBox, iconButton } from "../ui";

const PAGE_SIZE = 20;

interface Props {
  api: OviApi;
  onUnauthorized: () => void;
}

const badge = "inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap before:size-2 before:rounded-full";

// A fixed-layout table from md up, so long URLs are cut off instead of widening the page.
// Below md each row becomes a small card: code and clicks, then the destination, then status and actions.
const th = "border-b border-line px-3 py-2 text-left text-[0.6875rem] font-semibold text-muted";
const td = "px-3 py-2 align-middle max-md:p-0";

function Status({ link }: { link: Link }) {
  if (isExpired(link)) return <span className={`${badge} text-muted before:bg-[#c7c7cc]`}>Expired</span>;
  if (link.expiresAt)
    return (
      <span className={`${badge} text-ink before:border-[1.5px] before:border-ink`} title={formatDateTime(link.expiresAt)}>
        Expires {formatRelative(link.expiresAt)}
      </span>
    );
  return <span className={`${badge} text-ink before:bg-ink`}>Active</span>;
}

export function LinksTable({ api, onUnauthorized }: Props) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Link> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [statsFor, setStatsFor] = useState<Link | null>(null);
  const closeStats = useCallback(() => setStatsFor(null), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.list(page, PAGE_SIZE));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onUnauthorized();
      setError(err instanceof ApiError ? err.message : "Couldn't load links.");
    } finally {
      setLoading(false);
    }
  }, [api, page, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(code: string) {
    if (!window.confirm(`Delete /${code}? Anyone using it will get "not found", and the code can't be used again.`)) return;
    setDeleting(code);
    try {
      await api.remove(code);
      // Step back a page if this removed the last item on it.
      if (data && data.items.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the link.");
    } finally {
      setDeleting(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section aria-label="Your links">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[0.9375rem] font-semibold">
          All links {data && <span className="ml-1 font-normal text-muted">{data.total}</span>}
        </h2>
        <button type="button" className={button("ghost", "sm")} onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : undefined} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className={`${errorBox} mb-3`} role="alert">
          {error}
        </p>
      )}

      {data && data.items.length === 0 && !loading && (
        <p className={`${card} px-6 py-12 text-center text-[0.8125rem] text-muted`}>No links yet. Create one on the home page.</p>
      )}

      {data && data.items.length > 0 && (
        <div className={`${card} overflow-hidden max-md:rounded-none max-md:bg-transparent max-md:shadow-none`}>
          <table className="w-full table-fixed border-collapse text-sm max-md:block">
            <thead className="max-md:hidden">
              <tr>
                <th className={`${th} w-40`}>Short link</th>
                <th className={th}>Destination</th>
                <th className={`${th} w-16 text-right`}>Clicks</th>
                <th className={`${th} w-36 max-lg:hidden`}>Created</th>
                <th className={`${th} w-32`}>Status</th>
                <th className={`${th} w-40`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="max-md:grid max-md:gap-3">
              {data.items.map((link) => {
                const dim = isExpired(link) ? "text-muted" : "";
                return (
                  <tr
                    key={link.code}
                    className="md:even:bg-subtle max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1.5 max-md:rounded-xl max-md:bg-surface max-md:px-4 max-md:pt-3.5 max-md:pb-2.5 max-md:shadow-window"
                  >
                    <td className={`${td} truncate max-md:col-start-1 max-md:row-start-1`}>
                      <a
                        href={link.shortUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`font-mono font-semibold underline-offset-4 hover:underline ${dim}`}
                        title={link.shortUrl}
                      >
                        /{link.code}
                      </a>
                    </td>
                    <td
                      className={`${td} truncate text-muted max-md:col-span-2 max-md:row-start-2`}
                      title={link.url}
                    >
                      {link.url}
                    </td>
                    <td
                      className={`${td} text-right tabular-nums max-md:col-start-2 max-md:row-start-1 max-md:text-muted`}
                    >
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
                      <div className="flex justify-end gap-1">
                        <CopyButton text={link.shortUrl} iconOnly />
                        <button
                          type="button"
                          className={iconButton}
                          onClick={() => setStatsFor(link)}
                          aria-label={`Stats for /${link.code}`}
                          title="Stats"
                        >
                          <ChartColumn />
                        </button>
                        <a
                          className={iconButton}
                          href={link.qrCodeUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`QR code for /${link.code}`}
                          title="QR code"
                        >
                          <QrCode />
                        </a>
                        <button
                          type="button"
                          className={`${iconButton} text-danger disabled:opacity-45`}
                          onClick={() => void remove(link.code)}
                          disabled={deleting === link.code}
                          aria-label={`Delete /${link.code}`}
                          title="Delete"
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
        </div>
      )}

      {statsFor && <StatsDialog api={api} link={statsFor} onClose={closeStats} onUnauthorized={onUnauthorized} />}

      {data && totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-4 text-sm" aria-label="Pages">
          <button
            type="button"
            className={button("default", "sm")}
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft />
            Previous
          </button>
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className={button("default", "sm")}
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
          >
            Next
            <ChevronRight />
          </button>
        </nav>
      )}
    </section>
  );
}
