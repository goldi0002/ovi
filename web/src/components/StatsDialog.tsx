import { BarChart3, Table2, X } from "lucide-react";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { ApiError, type Link, type LinkStats, type NamedCount, type OviApi } from "../api";
import { formatDay, niceMax } from "../format";
import { backdrop, button, errorBox, focusRing, iconButton, sheet } from "../ui";
import { useModal } from "./useModal";

const tile = "min-w-0 rounded-lg bg-subtle px-4 py-3.5";
const tileLabel = "text-[0.8rem] text-muted";
const tileValue = "mt-1 text-2xl leading-tight font-semibold tabular-nums";
const subheading = "text-sm font-semibold";

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
    <div className={backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        className={`${sheet} grid grid-cols-[minmax(0,1fr)] max-h-[calc(100dvh-10vh-16px)] w-full max-w-3xl gap-5 overflow-y-auto p-6 max-sm:max-h-[calc(100dvh-32px)] max-sm:p-4`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-title"
      >
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="stats-title" className="text-lg font-semibold">
              Stats for /{link.code}
            </h2>
            <p className="truncate text-sm text-muted" title={link.url}>
              {link.url}
            </p>
          </div>
          <button
            type="button"
            className={`${iconButton} -mt-1 -mr-1`}
            onClick={onClose}
            aria-label="Close stats"
            autoFocus
          >
            <X className="size-5" />
          </button>
        </header>

        <div
          className="flex w-fit max-w-full rounded-lg bg-segment p-0.5 max-sm:w-full"
          role="group"
          aria-label="Date range"
        >
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={`cursor-pointer rounded-md px-3 py-1 text-[0.8125rem] font-medium whitespace-nowrap max-sm:flex-1 max-sm:px-2 ${focusRing} ${
                days === r ? "bg-segment-on text-ink shadow-control" : "text-muted hover:text-ink"
              }`}
              aria-pressed={days === r}
              onClick={() => setDays(r)}
            >
              Last {r} days
            </button>
          ))}
        </div>

        {error && (
          <p className={errorBox} role="alert">
            {error}
          </p>
        )}

        {!stats && loading && <p className="text-muted">Loading stats…</p>}

        {stats && (
          // Keep the previous numbers on screen, dimmed, while a new range loads.
          <div className={`grid gap-5 transition-opacity ${loading ? "opacity-55" : ""}`} aria-busy={loading}>
            <dl className="grid grid-cols-3 gap-3 max-sm:grid-cols-2">
              <div className={tile}>
                <dt className={tileLabel}>Clicks, last {stats.days} days</dt>
                <dd className={tileValue}>{numbers.format(stats.clicksInRange)}</dd>
              </div>
              <div className={tile}>
                <dt className={tileLabel}>All-time clicks</dt>
                <dd className={tileValue}>{numbers.format(stats.totalClicks)}</dd>
              </div>
              <div className={`${tile} max-sm:col-span-2`}>
                <dt className={tileLabel}>Top referrer</dt>
                <dd className="mt-1 truncate text-lg leading-[2.2rem] font-semibold" title={topReferrer?.name}>
                  {topReferrer ? topReferrer.name : "—"}
                </dd>
              </div>
            </dl>

            <ClicksChart daily={stats.daily} />

            <div className="grid grid-cols-3 gap-6 max-sm:grid-cols-1">
              <Breakdown title="Referrers" items={stats.referrers} total={stats.clicksInRange} />
              <Breakdown title="Devices" items={stats.devices} total={stats.clicksInRange} />
              <Breakdown title="Browsers" items={stats.browsers} total={stats.clicksInRange} />
            </div>

            <p className="text-[0.8rem] text-muted">
              Days are in UTC. Referrers show only the site, never the full page address. Bots, and repeat visits from
              the same person within 30 seconds, aren't counted. Clicks from before stats were added count toward the
              all-time total only.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export function ClicksChart({ daily, title = "Clicks per day" }: { daily: LinkStats["daily"]; title?: string }) {
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
    <figure className="rounded-lg bg-subtle px-[1.1rem] pt-4 pb-3.5">
      <figcaption className="flex items-center justify-between gap-4">
        <h3 className={subheading}>{title}</h3>
        <button
          type="button"
          className={button("default", "sm")}
          onClick={() => setAsTable(!asTable)}
          aria-pressed={asTable}
        >
          {asTable ? <BarChart3 /> : <Table2 />}
          {asTable ? "Show chart" : "Show table"}
        </button>
      </figcaption>

      {asTable ? (
        <div className="mt-3 max-h-64 overflow-y-auto">
          <table className="w-full border-collapse text-[0.95rem]">
            <thead>
              <tr>
                <th className="border-b border-line p-2 text-left text-xs font-semibold tracking-[0.04em] text-muted uppercase">
                  Day
                </th>
                <th className="border-b border-line p-2 text-right text-xs font-semibold tracking-[0.04em] text-muted uppercase">
                  Clicks
                </th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.date} className="border-b border-line last:border-b-0">
                  <td className="p-2">{formatDay(d.date, true)}</td>
                  <td className="p-2 text-right tabular-nums">{numbers.format(d.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="mt-2 mb-3 min-h-6 text-sm" aria-live="polite">
            {shown ? (
              <>
                <strong>{numbers.format(shown.clicks)}</strong> {shown.clicks === 1 ? "click" : "clicks"} on{" "}
                {formatDay(shown.date, true)}
              </>
            ) : (
              <span className="text-muted">{total === 0 ? "No clicks in this range yet." : "Hover or tap a day to see its clicks."}</span>
            )}
          </div>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5">
            {/* Ticks sit centred on the top, middle and bottom gridlines. */}
            <div
              className="flex h-40 flex-col justify-between text-right text-xs leading-none text-muted tabular-nums"
              aria-hidden="true"
            >
              <span className="-translate-y-1/2">{numbers.format(max)}</span>
              <span>{numbers.format(max / 2)}</span>
              <span className="translate-y-1/2">0</span>
            </div>
            <div
              className={`flex h-40 items-end gap-0.5 rounded-xs border-b border-line-strong bg-[linear-gradient(var(--color-line)_0_0),linear-gradient(var(--color-line)_0_0)] bg-[length:100%_1px] bg-[position:top,center] bg-no-repeat ${focusRing}`}
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
                  className={`group flex h-full min-w-0 flex-1 items-end justify-center rounded-t ${
                    i === active ? "is-active bg-hover" : ""
                  }`}
                  onMouseEnter={() => setActive(i)}
                >
                  {d.clicks > 0 && (
                    <span
                      className="w-full max-w-6 min-h-[3px] rounded-t bg-ink group-[.is-active]:bg-ink-hover"
                      style={{ height: `${(d.clicks / max) * 100}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
            {/* Labels can be wider than a column, so they spill evenly to both sides (the end ones inwards). */}
            <div className="col-start-2 mt-1.5 flex gap-0.5 text-xs text-muted" aria-hidden="true">
              {daily.map((d, i) => {
                const last = daily.length - 1;
                // Every few days, but not so close to the last label that they collide.
                const labelled = i === last || (i % labelEvery === 0 && last - i >= labelEvery / 2);
                // Phones only have room for the first, middle and last dates.
                const onPhone = i === 0 || i === last || i === Math.floor(last / 2);
                return (
                  <span
                    key={d.date}
                    className={`flex min-w-0 flex-1 justify-center whitespace-nowrap first:justify-start last:justify-end ${
                      onPhone ? (labelled ? "" : "sm:invisible") : "max-sm:invisible"
                    }`}
                  >
                    {labelled || onPhone ? formatDay(d.date) : ""}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </figure>
  );
}

function Breakdown({ title, items, total }: { title: string; items: NamedCount[]; total: number }) {
  return (
    <section aria-label={title}>
      <h3 className={`${subheading} mb-3`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-[0.8rem] text-muted">No data yet.</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((item) => {
            const share = total > 0 ? Math.round((item.clicks / total) * 100) : 0;
            return (
              <li key={item.name}>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="truncate" title={item.name}>
                    {item.name}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {numbers.format(item.clicks)} <span className="text-muted">· {share}%</span>
                  </span>
                </div>
                <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                  <span className="block h-full rounded-full bg-ink" style={{ width: `${share}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
