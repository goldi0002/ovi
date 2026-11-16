import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { ApiError, type Link, type LinkStats, type NamedCount, type OviApi } from "../api";
import { formatDay, niceMax } from "../format";
import { useModal } from "./useModal";

const RANGES = [7, 30, 90] as const;
const numbers = new Intl.NumberFormat();

interface Props {
  api: OviApi;
  link: Link;
  onClose: () => void;
  onUnauthorized: () => void;
}

/** Per-link analytics: daily clicks plus where visitors came from and what they used. */
export function StatsDialog({ api, link, onClose, onUnauthorized }: Props) {
  const [days, setDays] = useState<number>(30);
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useModal(onClose);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await api.stats(link.code, days));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onUnauthorized();
      setError(err instanceof ApiError ? err.message : "Couldn't load stats.");
    } finally {
      setLoading(false);
    }
  }, [api, link.code, days, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const topReferrer = stats?.referrers[0];

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="card dialog stats-dialog" role="dialog" aria-modal="true" aria-labelledby="stats-title">
        <header className="stats-head">
          <div>
            <h2 id="stats-title">Stats for /{link.code}</h2>
            <p className="muted stats-dest" title={link.url}>
              {link.url}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close stats" autoFocus>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="range" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className="range-btn"
              aria-pressed={days === r}
              onClick={() => setDays(r)}
            >
              Last {r} days
            </button>
          ))}
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {!stats && loading && <p className="muted">Loading stats…</p>}

        {stats && (
          // Keep the previous numbers on screen, dimmed, while a new range loads.
          <div className={loading ? "stats-body is-refreshing" : "stats-body"} aria-busy={loading}>
            <dl className="tiles">
              <div className="tile">
                <dt>Clicks, last {stats.days} days</dt>
                <dd>{numbers.format(stats.clicksInRange)}</dd>
              </div>
              <div className="tile">
                <dt>All-time clicks</dt>
                <dd>{numbers.format(stats.totalClicks)}</dd>
              </div>
              <div className="tile">
                <dt>Top referrer</dt>
                <dd className="tile-text" title={topReferrer?.name}>
                  {topReferrer ? topReferrer.name : "—"}
                </dd>
              </div>
            </dl>

            <ClicksChart daily={stats.daily} />

            <div className="breakdowns">
              <Breakdown title="Referrers" items={stats.referrers} total={stats.clicksInRange} />
              <Breakdown title="Devices" items={stats.devices} total={stats.clicksInRange} />
              <Breakdown title="Browsers" items={stats.browsers} total={stats.clicksInRange} />
            </div>

            <p className="muted small">
              Days are in UTC. Referrers show only the site, never the full page address. Clicks from before stats were
              added count toward the all-time total only.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ClicksChart({ daily }: { daily: LinkStats["daily"] }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(Math.max(0, ...daily.map((d) => d.clicks)));
  const total = daily.reduce((sum, d) => sum + d.clicks, 0);
  const peak = daily.reduce((best, d) => (d.clicks > best.clicks ? d : best), daily[0]);
  const summary =
    total === 0
      ? `No clicks between ${formatDay(daily[0].date)} and ${formatDay(daily[daily.length - 1].date)}.`
      : `${numbers.format(total)} clicks between ${formatDay(daily[0].date)} and ${formatDay(daily[daily.length - 1].date)}. ` +
        `Busiest day ${formatDay(peak.date, true)} with ${numbers.format(peak.clicks)}.`;
  const shown = active === null ? null : daily[active];
  const labelEvery = Math.ceil(daily.length / 6);

  // Arrow keys walk the days, so keyboard users get the same readout as hover.
  function onKeyDown(e: KeyboardEvent) {
    const last = daily.length - 1;
    const moves: Record<string, number> = {
      ArrowLeft: Math.max(0, (active ?? last + 1) - 1),
      ArrowRight: Math.min(last, (active ?? -1) + 1),
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]);
    }
  }

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <h3>Clicks per day</h3>
        <button type="button" className="btn btn-small" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show table"}
        </button>
      </figcaption>

      {asTable ? (
        <div className="chart-table">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.date}>
                  <td>{formatDay(d.date, true)}</td>
                  <td className="num">{numbers.format(d.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="chart-readout" aria-live="polite">
            {shown ? (
              <>
                <strong>{numbers.format(shown.clicks)}</strong> {shown.clicks === 1 ? "click" : "clicks"} on{" "}
                {formatDay(shown.date, true)}
              </>
            ) : (
              <span className="muted">{total === 0 ? "No clicks in this range yet." : "Hover a day to see its clicks."}</span>
            )}
          </div>
          <div className="plot">
            <div className="y-axis" aria-hidden="true">
              <span>{numbers.format(max)}</span>
              <span>{numbers.format(max / 2)}</span>
              <span>0</span>
            </div>
            <div
              className="columns"
              role="img"
              aria-label={summary}
              tabIndex={0}
              onKeyDown={onKeyDown}
              onMouseLeave={() => setActive(null)}
              onBlur={() => setActive(null)}
            >
              {daily.map((d, i) => (
                <div
                  key={d.date}
                  className={i === active ? "col is-active" : "col"}
                  onMouseEnter={() => setActive(i)}
                >
                  {d.clicks > 0 && <span className="bar" style={{ height: `${(d.clicks / max) * 100}%` }} />}
                </div>
              ))}
            </div>
            <div className="x-axis" aria-hidden="true">
              {daily.map((d, i) => (
                <span key={d.date}>{i % labelEvery === 0 || i === daily.length - 1 ? formatDay(d.date) : ""}</span>
              ))}
            </div>
          </div>
        </>
      )}
    </figure>
  );
}

function Breakdown({ title, items, total }: { title: string; items: NamedCount[]; total: number }) {
  return (
    <section className="breakdown" aria-label={title}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted small">No data yet.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const share = total > 0 ? Math.round((item.clicks / total) * 100) : 0;
            return (
              <li key={item.name}>
                <div className="breakdown-row">
                  <span className="breakdown-name" title={item.name}>
                    {item.name}
                  </span>
                  <span className="breakdown-value">
                    {numbers.format(item.clicks)} <span className="muted">· {share}%</span>
                  </span>
                </div>
                <span className="meter" aria-hidden="true">
                  <span style={{ width: `${share}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
