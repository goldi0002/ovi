import { BarChart3, Table2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, type Link, type LinkStats, type NamedCount, type OviApi } from "../api";
import { formatDay, niceMax } from "../format";
import { button, card, errorBox, focusRing } from "../ui";
import { Dialog } from "./ui/Dialog";
import { SegmentedControl, Skeleton } from "./ui/primitives";

const tile = "min-w-0 rounded-xl bg-subtle/70 px-4 py-3.5";
const tileLabel = "text-[0.8125rem] font-medium text-muted";
const tileValue = "mt-1.5 text-2xl leading-tight font-semibold tracking-[-0.02em] tabular-nums";
const subheading = "text-sm font-semibold";

export const RANGES = [7, 30, 90] as const;
const RANGE_OPTIONS = RANGES.map((r) => ({ value: r as number, label: `Last ${r} days` }));
const numbers = new Intl.NumberFormat();

interface Props {
  api: OviApi;
  link: Link;
  onClose: () => void;
  onUnauthorized: () => void;
}

/** Per-link analytics in a sheet, from the links table. */
export function StatsDialog({ api, link, onClose, onUnauthorized }: Props) {
  return (
    <Dialog
      size="lg"
      title={`Stats for /${link.code}`}
      description={
        <p className="truncate" title={link.url}>
          {link.url}
        </p>
      }
      onClose={onClose}
      closeLabel="Close stats"
      autoFocusClose
    >
      <LinkStatsView api={api} code={link.code} onUnauthorized={onUnauthorized} />
    </Dialog>
  );
}

/** Loads one link's stats for a range, keeping the last numbers on screen while a new range loads. */
export function useLinkStats(api: OviApi, code: string, days: number, onUnauthorized: () => void) {
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may update the view, so a slow answer for another link or range can't win.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.stats(code, days);
      if (id === latest.current) setStats(result);
    } catch (err) {
      if (id !== latest.current) return;
      if (err instanceof ApiError && err.status === 401) return onUnauthorized();
      setError(err instanceof ApiError ? err.message : "Couldn't load stats.");
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [api, code, days, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  return { stats, loading, error, reload: load };
}

/** The range picker, headline numbers, daily chart and breakdowns for one link. */
export function LinkStatsView({ api, code, onUnauthorized }: { api: OviApi; code: string; onUnauthorized: () => void }) {
  const [days, setDays] = useState<number>(30);
  const { stats, loading, error } = useLinkStats(api, code, days, onUnauthorized);
  // A different link: drop the old one's numbers rather than show them dimmed.
  const current = stats?.code === code ? stats : null;
  const topReferrer = current?.referrers[0];

  return (
    <div className="grid gap-5">
      <SegmentedControl label="Date range" options={RANGE_OPTIONS} value={days} onChange={setDays} className="w-fit max-w-full max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:px-1.5" />

      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}

      {!current && loading && <StatsSkeleton />}

      {current && (
        // Keep the previous numbers on screen, dimmed, while a new range loads.
        <div className={`grid gap-5 transition-opacity ${loading ? "opacity-55" : ""}`} aria-busy={loading}>
          <dl className="grid grid-cols-3 gap-3 max-sm:grid-cols-2">
            <div className={tile}>
              <dt className={tileLabel}>Clicks, last {current.days} days</dt>
              <dd className={tileValue}>{numbers.format(current.clicksInRange)}</dd>
            </div>
            <div className={tile}>
              <dt className={tileLabel}>All-time clicks</dt>
              <dd className={tileValue}>{numbers.format(current.totalClicks)}</dd>
            </div>
            <div className={`${tile} max-sm:col-span-2`}>
              <dt className={tileLabel}>Top referrer</dt>
              <dd className="mt-1.5 truncate text-lg leading-8 font-semibold" title={topReferrer?.name}>
                {topReferrer ? topReferrer.name : "—"}
              </dd>
            </div>
          </dl>

          <ClicksChart daily={current.daily} />

          <div className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
            <Breakdown title="Referrers" items={current.referrers} total={current.clicksInRange} />
            <Breakdown title="Devices" items={current.devices} total={current.clicksInRange} />
            <Breakdown title="Browsers" items={current.browsers} total={current.clicksInRange} />
          </div>

          <p className="text-xs leading-relaxed text-muted">
            Days are in UTC. Referrers show only the site, never the full page address. Bots, and repeat visits from the
            same person within 30 seconds, aren't counted. Clicks from before stats were added count toward the all-time
            total only.
          </p>
        </div>
      )}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-5" aria-label="Loading stats" role="status">
      <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${tile} grid gap-2.5 ${i === 2 ? "max-sm:col-span-2" : ""}`}>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-6 w-14" />
          </div>
        ))}
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}

export function ClicksChart({ daily, title = "Clicks per day", framed = false }: { daily: LinkStats["daily"]; title?: string; framed?: boolean }) {
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
    <figure className={`${framed ? card : "rounded-xl bg-subtle/70"} px-4 pt-4 pb-3.5 sm:px-5`}>
      <figcaption className="flex items-center justify-between gap-4">
        <h3 className={subheading}>{title}</h3>
        <button type="button" className={button("ghost", "sm", "-mr-2 text-muted")} onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          {asTable ? <BarChart3 /> : <Table2 />}
          {asTable ? "Show chart" : "Show table"}
        </button>
      </figcaption>

      {asTable ? (
        <div className="mt-3 max-h-64 overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-line p-2 text-left text-xs font-semibold text-muted">Day</th>
                <th className="border-b border-line p-2 text-right text-xs font-semibold text-muted">Clicks</th>
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
          <div className="mt-1 mb-3 min-h-6 text-[0.8125rem]" aria-live="polite">
            {shown ? (
              <>
                <strong className="font-semibold">{numbers.format(shown.clicks)}</strong> {shown.clicks === 1 ? "click" : "clicks"} on{" "}
                {formatDay(shown.date, true)}
              </>
            ) : (
              <span className="text-muted">{total === 0 ? "No clicks in this range yet." : "Hover or tap a day to see its clicks."}</span>
            )}
          </div>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5">
            {/* Ticks sit centred on the top, middle and bottom gridlines. */}
            <div className="flex h-44 flex-col justify-between text-right text-[0.6875rem] leading-none text-muted tabular-nums" aria-hidden="true">
              <span className="-translate-y-1/2">{numbers.format(max)}</span>
              <span>{numbers.format(max / 2)}</span>
              <span className="translate-y-1/2">0</span>
            </div>
            <div
              className={`flex h-44 items-end gap-[3px] rounded-xs border-b border-line-strong bg-[linear-gradient(var(--color-line)_0_0),linear-gradient(var(--color-line)_0_0)] bg-[length:100%_1px] bg-[position:top,center] bg-no-repeat ${focusRing}`}
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
                  className={`group flex h-full min-w-0 flex-1 items-end justify-center rounded-t-md transition-colors ${i === active ? "is-active bg-hover" : ""}`}
                  onMouseEnter={() => setActive(i)}
                >
                  {d.clicks > 0 && (
                    <span
                      className="w-full max-w-7 min-h-[3px] rounded-t-[4px] bg-accent/85 transition-colors group-[.is-active]:bg-accent"
                      style={{ height: `${(d.clicks / max) * 100}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
            {/* Labels can be wider than a column, so they spill evenly to both sides (the end ones inwards). */}
            <div className="col-start-2 mt-1.5 flex gap-[3px] text-[0.6875rem] text-muted" aria-hidden="true">
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

export function Breakdown({ title, items, total }: { title: string; items: NamedCount[]; total: number }) {
  return (
    <section aria-label={title}>
      <h3 className={`${subheading} mb-3`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-[0.8125rem] text-muted">No data yet.</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((item) => {
            const share = total > 0 ? Math.round((item.clicks / total) * 100) : 0;
            return (
              <li key={item.name}>
                <div className="flex justify-between gap-2 text-[0.8125rem]">
                  <span className="truncate" title={item.name}>
                    {item.name}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {numbers.format(item.clicks)} <span className="text-muted">· {share}%</span>
                  </span>
                </div>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-segment" aria-hidden="true">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
