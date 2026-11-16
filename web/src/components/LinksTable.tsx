import { useCallback, useEffect, useState } from "react";
import { ApiError, isExpired, type Link, type OviApi, type Page } from "../api";
import { formatDateTime, formatRelative } from "../format";
import { CopyButton } from "./CopyButton";

const PAGE_SIZE = 20;

interface Props {
  api: OviApi;
  /** Changes whenever the list should reload (e.g. after creating a link). */
  refreshKey: number;
  onUnauthorized: () => void;
}

function Status({ link }: { link: Link }) {
  if (isExpired(link)) return <span className="badge badge-expired">Expired</span>;
  if (link.expiresAt)
    return (
      <span className="badge badge-warn" title={formatDateTime(link.expiresAt)}>
        Expires {formatRelative(link.expiresAt)}
      </span>
    );
  return <span className="badge badge-ok">Active</span>;
}

export function LinksTable({ api, refreshKey, onUnauthorized }: Props) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Link> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

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
  }, [load, refreshKey]);

  async function remove(code: string) {
    if (!window.confirm(`Delete /${code}? Anyone using it will get "not found".`)) return;
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
    <section className="card links" aria-label="Your links">
      <div className="links-head">
        <h2>
          Your links {data && <span className="muted count">{data.total}</span>}
        </h2>
        <button type="button" className="btn btn-small" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {data && data.items.length === 0 && !loading && <p className="empty muted">No links yet. Shorten one above.</p>}

      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Short link</th>
                <th>Destination</th>
                <th className="num">Clicks</th>
                <th>Created</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((link) => (
                <tr key={link.code} className={isExpired(link) ? "is-expired" : undefined}>
                  <td data-label="Short link">
                    <a href={link.shortUrl} target="_blank" rel="noreferrer" className="code">
                      /{link.code}
                    </a>
                  </td>
                  <td data-label="Destination" className="dest-cell" title={link.url}>
                    {link.url}
                  </td>
                  <td data-label="Clicks" className="num">
                    {link.clicks}
                  </td>
                  <td data-label="Created" title={formatDateTime(link.createdAt)}>
                    {formatRelative(link.createdAt)}
                  </td>
                  <td data-label="Status">
                    <Status link={link} />
                  </td>
                  <td className="row-actions">
                    <CopyButton text={link.shortUrl} />
                    <a className="btn btn-small" href={link.qrCodeUrl} target="_blank" rel="noreferrer">
                      QR
                    </a>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => void remove(link.code)}
                      disabled={deleting === link.code}
                      aria-label={`Delete /${link.code}`}
                    >
                      {deleting === link.code ? "…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && totalPages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button type="button" className="btn btn-small" onClick={() => setPage(page - 1)} disabled={page <= 1}>
            ← Previous
          </button>
          <span className="muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
          >
            Next →
          </button>
        </nav>
      )}
    </section>
  );
}
