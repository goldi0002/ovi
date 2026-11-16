import { ChartColumn, ChevronLeft, ChevronRight, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, isExpired, type Link, type OviApi, type Page } from "../api";
import { formatDateTime, formatRelative } from "../format";
import { CopyButton } from "./CopyButton";
import { StatsDialog } from "./StatsDialog";
import { button, card, errorBox } from "../ui";

const PAGE_SIZE = 20;

interface Props {
  api: OviApi;
  onUnauthorized: () => void;
}

const badge = "inline-block rounded-full px-2.5 py-0.5 text-[0.78rem] font-semibold whitespace-nowrap";

// On phones each row becomes a card: cells stack, each labelled from its data-label.
const th = "border-b border-line p-2.5 text-left text-xs font-semibold tracking-[0.04em] text-muted uppercase";
const td =
  "px-2.5 py-3 align-middle max-sm:flex max-sm:w-full max-sm:justify-between max-sm:gap-4 max-sm:px-0 max-sm:py-1 " +
  "max-sm:before:shrink-0 max-sm:before:text-[0.8rem] max-sm:before:text-muted max-sm:before:content-[attr(data-label)]";

function Status({ link }: { link: Link }) {
  if (isExpired(link)) return <span className={`${badge} bg-off-bg text-muted`}>Expired</span>;
  if (link.expiresAt)
    return (
      <span className={`${badge} bg-warn-bg text-warn-ink`} title={formatDateTime(link.expiresAt)}>
        Expires {formatRelative(link.expiresAt)}
      </span>
    );
  return <span className={`${badge} bg-ok-bg text-ok-ink`}>Active</span>;
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
    <section className={`${card} p-7 max-sm:p-5`} aria-label="Your links">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">
          All links {data && <span className="ml-1 font-medium text-muted">{data.total}</span>}
        </h2>
        <button type="button" className={button("default", "sm")} onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : undefined} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}

      {data && data.items.length === 0 && !loading && (
        <p className="py-8 text-center text-muted">No links yet. Create one on the home page.</p>
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.95rem] max-sm:block">
            <thead className="max-sm:hidden">
              <tr>
                <th className={th}>Short link</th>
                <th className={th}>Destination</th>
                <th className={`${th} text-right`}>Clicks</th>
                <th className={th}>Created</th>
                <th className={th}>Status</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {data.items.map((link) => {
                const dim = isExpired(link) ? "opacity-60" : "";
                return (
                  <tr key={link.code} className="border-b border-line last:border-b-0 max-sm:block max-sm:py-3">
                    <td data-label="Short link" className={td}>
                      <a
                        href={link.shortUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`font-mono font-semibold text-accent-ink hover:underline ${dim}`}
                      >
                        /{link.code}
                      </a>
                    </td>
                    <td
                      data-label="Destination"
                      className={`${td} max-w-80 truncate text-muted max-sm:max-w-none ${dim}`}
                      title={link.url}
                    >
                      {link.url}
                    </td>
                    <td data-label="Clicks" className={`${td} text-right tabular-nums`}>
                      {link.clicks}
                    </td>
                    <td data-label="Created" className={td} title={formatDateTime(link.createdAt)}>
                      {formatRelative(link.createdAt)}
                    </td>
                    <td data-label="Status" className={td}>
                      <Status link={link} />
                    </td>
                    <td className="w-[1%] px-2.5 py-3 align-middle max-sm:block max-sm:w-full max-sm:px-0 max-sm:pt-2 max-sm:pb-0">
                      <div className="flex justify-end gap-1.5 max-sm:flex-wrap max-sm:justify-start">
                        <CopyButton text={link.shortUrl} />
                        <button
                          type="button"
                          className={button("default", "sm")}
                          onClick={() => setStatsFor(link)}
                          aria-label={`Stats for /${link.code}`}
                        >
                          <ChartColumn />
                          Stats
                        </button>
                        <a
                          className={button("default", "sm")}
                          href={link.qrCodeUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`QR code for /${link.code}`}
                        >
                          <QrCode />
                          QR
                        </a>
                        <button
                          type="button"
                          className={button("danger", "sm")}
                          onClick={() => void remove(link.code)}
                          disabled={deleting === link.code}
                          aria-label={`Delete /${link.code}`}
                        >
                          <Trash2 />
                          {deleting === link.code ? "…" : "Delete"}
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
