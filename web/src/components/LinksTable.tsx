import { ChartColumn, ChevronLeft, ChevronRight, Link2, QrCode, RefreshCw, Trash2 } from "lucide-react";
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

const badge = "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold whitespace-nowrap";

const th = "px-3 pb-2.5 text-left text-[0.68rem] font-bold tracking-[0.08em] text-muted uppercase";

// Below xl (1280px) each row becomes a card: cells stack and every cell is labelled from its data-label.
// The table only appears where all six columns plus the actions genuinely fit without clipping.
const td =
  "px-3 py-3 align-middle max-xl:flex max-xl:w-full max-xl:items-center max-xl:justify-between max-xl:gap-4 " +
  "max-xl:px-0 max-xl:py-1 max-xl:before:shrink-0 max-xl:before:text-[0.68rem] max-xl:before:font-bold " +
  "max-xl:before:tracking-[0.06em] max-xl:before:text-muted max-xl:before:uppercase " +
  "max-xl:before:content-[attr(data-label)]";

const row =
  "border-b border-line last:border-b-0 max-xl:mb-3 max-xl:block max-xl:rounded-2xl max-xl:border max-xl:px-4 max-xl:py-3 " +
  "max-xl:last:mb-0";

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
    <section className={`${card} min-w-0 p-5 sm:p-7`} aria-label="Your links">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
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
        <div className="grid justify-items-center gap-3 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Link2 className="size-6" />
          </span>
          <p className="text-muted">No links yet. Create one on the home page.</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="min-w-0">
          <table className="w-full border-collapse text-[0.92rem] max-xl:block">
            <thead className="max-xl:hidden">
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
            <tbody className="max-xl:block">
              {data.items.map((link) => {
                const dim = isExpired(link) ? "opacity-60" : "";
                return (
                  <tr key={link.code} className={row}>
                    <td data-label="Short link" className={`${td} max-xl:before:hidden`}>
                      <a
                        href={link.shortUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`font-mono text-[1rem] font-semibold text-accent-ink hover:underline ${dim}`}
                      >
                        /{link.code}
                      </a>
                    </td>
                    <td data-label="Destination" className={`${td} min-w-0`} title={link.url}>
                      {/* min-w-0 + flex-1 lets a long URL truncate inside the card instead of widening the row. */}
                      <span
                        className={`block min-w-0 max-w-full truncate text-muted xl:max-w-[15rem] max-xl:flex-1 max-xl:text-right ${dim}`}
                      >
                        {link.url}
                      </span>
                    </td>
                    <td data-label="Clicks" className={`${td} text-right tabular-nums`}>
                      <span className="font-semibold">{link.clicks}</span>
                    </td>
                    <td
                      data-label="Created"
                      className={`${td} whitespace-nowrap`}
                      title={formatDateTime(link.createdAt)}
                    >
                      <span>{formatRelative(link.createdAt)}</span>
                    </td>
                    <td data-label="Status" className={`${td} whitespace-nowrap`}>
                      <Status link={link} />
                    </td>
                    <td className="w-[1%] px-3 py-3 align-middle max-xl:mt-2 max-xl:block max-xl:w-full max-xl:px-0 max-xl:pt-3 max-xl:pb-0">
                      <div className="flex justify-end gap-1.5 max-xl:flex-wrap max-xl:justify-start max-sm:grid max-sm:grid-cols-2">
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
        <nav className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm" aria-label="Pages">
          <button
            type="button"
            className={button("default", "sm")}
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft />
            Previous
          </button>
          <span className="text-muted tabular-nums">
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
