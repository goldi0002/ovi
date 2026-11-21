import { ChartColumn, Flag, Link2, MousePointerClick, Search, ShieldOff, Trash2, TimerOff, UserRound, Users, UserX, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, type AdminLink, type AdminOverview, type AdminReport, type ReportReason, type ReportResolution, type AdminUser, type Link, type OviApi, type Page } from "../api";
import { Pager as PagerControls, Status } from "../components/LinksTable";
import { ClicksChart, StatsDialog } from "../components/StatsDialog";
import { useConfirm } from "../components/ui/Confirm";
import { Avatar, Badge, EmptyState, PageHeader, Skeleton, StatTile } from "../components/ui/primitives";
import { useToast } from "../components/ui/Toast";
import { formatDateTime, formatRelative } from "../format";
import { button, card, container, errorBox, iconButton, input, segment, segmentTrack } from "../ui";
import { usePageTitle } from "./common";

const numbers = new Intl.NumberFormat();
const PAGE_SIZE = 20;

interface Props {
  api: OviApi;
  state: "loading" | "admin" | "notAdmin" | "signedOut";
  onLogIn: () => void;
  onUnauthorized: () => void;
}

/** Admin dashboard: totals, every user, and every link. The server checks admin rights on each request. */
export function AdminPage({ api, state, onLogIn, onUnauthorized }: Props) {
  const isAdmin = state === "admin";
  const loadOverview = useCallback(() => (isAdmin ? api.adminOverview() : Promise.resolve(null)), [api, isAdmin]);
  const overview = useLoad<AdminOverview | null>(loadOverview, onUnauthorized);
  const openReports = overview.data?.openReports ?? 0;
  const [tab, setTab] = useState<"users" | "links" | "reports">("users");
  const [ownerFilter, setOwnerFilter] = useState<{ value: string; label: string } | null>(null);

  usePageTitle("Admin");

  function showLinksOf(user: AdminUser) {
    setOwnerFilter({ value: String(user.id), label: user.name });
    setTab("links");
  }

  return (
    <main className={`${container} flex-1 py-8 sm:py-10`}>
      <PageHeader title="Admin" description="Every account and every link on this server." />

      {state === "loading" ? null : state !== "admin" ? (
        <EmptyState
          heading
          icon={<ShieldOff />}
          title="Admins only"
          description={state === "signedOut" ? "Log in with an admin account to see this page." : "Your account doesn't have admin access."}
          action={
            state === "signedOut" && (
              <button type="button" className={button("primary", "md")} onClick={onLogIn}>
                Log in
              </button>
            )
          }
        />
      ) : (
        <div className="grid gap-8">
          <Overview data={overview.data} error={overview.error} />

          <section className="grid gap-4">
            <div className={`${segmentTrack} w-fit`} role="tablist" aria-label="Admin lists">
              {(["users", "links", "reports"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  aria-label={t === "reports" && openReports > 0 ? `Reports, ${openReports} open` : undefined}
                  className={segment(tab === t, "px-4")}
                  onClick={() => setTab(t)}
                >
                  {t === "users" ? "Users" : t === "links" ? "Links" : "Reports"}
                  {t === "reports" && openReports > 0 && (
                    <span className="ml-1.5 rounded-full bg-error-bg px-1.5 py-px text-xs font-medium text-danger tabular-nums" aria-hidden="true">
                      {numbers.format(openReports)}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {tab === "users" ? (
              <UsersList api={api} onUnauthorized={onUnauthorized} onShowLinks={showLinksOf} />
            ) : tab === "reports" ? (
              <ReportsList api={api} onUnauthorized={onUnauthorized} onChanged={() => void overview.reload()} />
            ) : (
              <LinksList
                api={api}
                onUnauthorized={onUnauthorized}
                ownerFilter={ownerFilter}
                onOwnerFilter={setOwnerFilter}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

/** Loads a value, handing 401/403 to the app (the session ended or admin rights were removed). */
function useLoad<T>(load: () => Promise<T>, onUnauthorized: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return onUnauthorized();
      setError(err instanceof ApiError ? err.message : "Couldn't load this. Try again.");
    } finally {
      setLoading(false);
    }
  }, [load, onUnauthorized]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

function Overview({ data, error }: { data: AdminOverview | null; error: string | null }) {
  if (error) return <p className={errorBox} role="alert">{error}</p>;
  if (!data)
    return (
      <div className="grid grid-cols-3 gap-4 max-md:grid-cols-2" role="status" aria-label="Loading overview">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );

  const tiles: [string, number, ReactNode][] = [
    ["Users", data.users, <Users key="u" />],
    ["Links", data.links, <Link2 key="l" />],
    ["Total clicks", data.totalClicks, <MousePointerClick key="c" />],
    ["Anonymous links", data.anonymousLinks, <UserRound key="a" />],
    ["Expired links", data.expiredLinks, <TimerOff key="e" />],
    ["Suspended users", data.blockedUsers, <UserX key="s" />],
  ];

  return (
    <section className="grid gap-4" aria-label="Overview">
      <dl className="grid grid-cols-3 gap-4 max-md:grid-cols-2 max-sm:gap-3">
        {tiles.map(([label, value, icon]) => (
          <StatTile key={label} label={label} icon={icon} value={numbers.format(value)} />
        ))}
      </dl>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <ClicksChart framed title="Clicks, last 14 days" daily={data.dailyClicks.map((d) => ({ date: d.date, clicks: d.count }))} />
        <div className={`${card} px-5 py-4`}>
          <h3 className="mb-3 text-sm font-semibold">Top links</h3>
          {data.topLinks.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">No links yet.</p>
          ) : (
            <ol className="grid gap-2.5">
              {data.topLinks.map((l) => (
                <li key={l.code} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <a href={l.shortUrl} target="_blank" rel="noreferrer" className="block truncate font-mono text-[0.8125rem] font-semibold text-accent-text hover:underline" title={l.shortUrl}>
                      /{l.code}
                    </a>
                    <span className="block truncate text-xs text-muted" title={l.url}>
                      {l.ownerName ?? "No account"} · {l.url}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{numbers.format(l.clicks)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

/** A search box that applies on submit, so typing doesn't fire a request per key. */
function SearchBox({ label, placeholder, onSearch }: { label: string; placeholder: string; onSearch: (q: string) => void }) {
  const [value, setValue] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    onSearch(value.trim());
  }
  return (
    <form role="search" onSubmit={submit} className="flex min-w-0 flex-1 gap-2 sm:max-w-sm">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-placeholder" aria-hidden="true" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          maxLength={100}
          className={`${input} pl-8`}
        />
      </label>
      <button type="submit" className={button("default", "md")} aria-label={`Search ${label.toLowerCase()}`}>
        Search
      </button>
    </form>
  );
}

function Pager({ page, data, onPage }: { page: number; data: Page<unknown> | null; onPage: (p: number) => void }) {
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  if (pages <= 1) return null;
  return <PagerControls page={page} totalPages={pages} onPage={onPage} range={data ? `${data.total} in all` : undefined} />;
}

/** One row of a list: a card on phones, a row with a hairline between on wider screens. */
function Row({ children }: { children: ReactNode }) {
  return (
    <li className="grid gap-2 px-5 py-3.5 transition-colors md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:border-b md:border-line md:last:border-b-0 md:hover:bg-hover/60 max-md:rounded-xl max-md:bg-surface max-md:px-4 max-md:shadow-card">
      {children}
    </li>
  );
}

function UsersList({
  api,
  onUnauthorized,
  onShowLinks,
}: {
  api: OviApi;
  onUnauthorized: () => void;
  onShowLinks: (user: AdminUser) => void;
}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const load = useCallback(() => api.adminUsers(page, q, PAGE_SIZE), [api, page, q]);
  const { data, error, loading, reload } = useLoad(load, onUnauthorized);
  const confirm = useConfirm();
  const notify = useToast();

  async function toggle(user: AdminUser) {
    const block = user.blockedAt === null;
    if (
      block &&
      !(await confirm({
        title: `Suspend ${user.name}?`,
        message: "They'll be signed out and their links will stop working. You can restore the account later.",
        confirmLabel: "Suspend account",
        destructive: true,
      }))
    )
      return;
    setBusy(user.id);
    setActionError(null);
    try {
      await api.setBlocked(user.id, block);
      notify(block ? `Suspended ${user.name}` : `Restored ${user.name}`);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't change the account.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[0.9375rem] font-semibold">
          Users {data && <span className="rounded-full bg-subtle px-2 py-px text-xs font-medium text-muted tabular-nums">{data.total}</span>}
        </p>
        <SearchBox
          label="Users"
          placeholder="Name or email"
          onSearch={(v) => {
            setPage(1);
            setQ(v);
          }}
        />
      </div>
      {(error || actionError) && (
        <p className={errorBox} role="alert">
          {error ?? actionError}
        </p>
      )}
      {data && data.items.length === 0 && !loading && (
        <EmptyState icon={<Users />} title="No users found." />
      )}
      {data && data.items.length > 0 && (
        <ul
          className={`${card} overflow-hidden text-sm max-md:grid max-md:gap-3 max-md:rounded-none max-md:bg-transparent max-md:shadow-none`}
          aria-label="Users"
        >
          {data.items.map((u) => (
            <Row key={u.id}>
              <div className="flex min-w-0 items-start gap-3">
                <Avatar name={u.name} className="mt-0.5 size-9 text-xs" />
                <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold" title={u.name}>
                    {u.name}
                  </span>
                  {u.isAdmin && <Badge tone="accent">Admin</Badge>}
                  {u.blockedAt && <Badge tone="danger">Suspended</Badge>}
                </p>
                <p className="truncate text-[0.8125rem] text-muted" title={u.email ?? undefined}>
                  {u.email ?? "No email"} · {u.provider === "google" ? "Google" : "GitHub"}
                </p>
                <p className="text-xs text-muted">
                  {numbers.format(u.links)} {u.links === 1 ? "link" : "links"} · {numbers.format(u.clicks)} clicks · joined{" "}
                  <span title={formatDateTime(u.createdAt)}>{formatRelative(u.createdAt)}</span> · last seen{" "}
                  <span title={formatDateTime(u.lastLoginAt)}>{formatRelative(u.lastLoginAt)}</span>
                </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <button type="button" className={button("default", "sm")} onClick={() => onShowLinks(u)}>
                  View links
                </button>
                {!u.isAdmin && (
                  <button
                    type="button"
                    className={button(u.blockedAt ? "default" : "danger", "sm")}
                    onClick={() => void toggle(u)}
                    disabled={busy === u.id}
                    aria-label={`${u.blockedAt ? "Restore" : "Suspend"} ${u.name}`}
                  >
                    {u.blockedAt ? "Restore" : "Suspend"}
                  </button>
                )}
              </div>
            </Row>
          ))}
        </ul>
      )}
      <Pager page={page} data={data} onPage={setPage} />
    </div>
  );
}

function LinksList({
  api,
  onUnauthorized,
  ownerFilter,
  onOwnerFilter,
}: {
  api: OviApi;
  onUnauthorized: () => void;
  ownerFilter: { value: string; label: string } | null;
  onOwnerFilter: (f: { value: string; label: string } | null) => void;
}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [statsFor, setStatsFor] = useState<Link | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const owner = ownerFilter?.value ?? "";
  const load = useCallback(() => api.adminLinks(page, q, owner, PAGE_SIZE), [api, page, q, owner]);
  const { data, error, loading, reload } = useLoad(load, onUnauthorized);
  const closeStats = useCallback(() => setStatsFor(null), []);
  const confirm = useConfirm();
  const notify = useToast();

  useEffect(() => setPage(1), [owner]);

  async function remove(row: AdminLink) {
    const who = row.owner ? `${row.owner.name}'s` : "this";
    const ok = await confirm({
      title: `Delete ${who} link /${row.link.code}?`,
      message: "It will stop working for everyone, and the code can't be used again.",
      confirmLabel: "Delete link",
      destructive: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      await api.remove(row.link.code);
      notify(`Deleted /${row.link.code}`);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't delete the link.");
    }
  }

  const presets = [
    { value: "", label: "All" },
    { value: "anonymous", label: "Anonymous" },
    { value: "apikey", label: "API key" },
  ];
  const isPreset = presets.some((p) => p.value === owner);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-2 text-[0.9375rem] font-semibold">
            Links {data && <span className="rounded-full bg-subtle px-2 py-px text-xs font-medium text-muted tabular-nums">{data.total}</span>}
          </p>
          <div className={segmentTrack} role="group" aria-label="Made by">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={isPreset && owner === p.value}
                className={segment(isPreset && owner === p.value, "px-2.5 py-0.5 text-xs")}
                onClick={() => onOwnerFilter(p.value ? p : null)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {!isPreset && ownerFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5 text-xs font-medium text-accent-text">
              By {ownerFilter.label}
              <button
                type="button"
                className={`${iconButton} size-5 [&_svg]:size-3`}
                onClick={() => onOwnerFilter(null)}
                aria-label="Show links from everyone"
              >
                <X />
              </button>
            </span>
          )}
        </div>
        <SearchBox
          label="Links"
          placeholder="Code or URL"
          onSearch={(v) => {
            setPage(1);
            setQ(v);
          }}
        />
      </div>
      {(error || actionError) && (
        <p className={errorBox} role="alert">
          {error ?? actionError}
        </p>
      )}
      {data && data.items.length === 0 && !loading && (
        <EmptyState icon={<Link2 />} title="No links found." />
      )}
      {data && data.items.length > 0 && (
        <ul
          className={`${card} overflow-hidden text-sm max-md:grid max-md:gap-3 max-md:rounded-none max-md:bg-transparent max-md:shadow-none`}
          aria-label="All links"
        >
          {data.items.map((row) => (
            <Row key={row.link.code}>
              <div className="min-w-0">
                <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <a
                    href={row.link.shortUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-full truncate font-mono text-[0.8125rem] font-semibold text-accent-text hover:underline"
                    title={row.link.shortUrl}
                  >
                    /{row.link.code}
                  </a>
                  <Status link={row.link} />
                </p>
                <p className="truncate text-[0.8125rem] text-muted" title={row.link.url}>
                  {row.link.url}
                </p>
                <p className="truncate text-xs text-muted">
                  {row.owner ? `${row.owner.name}${row.owner.email ? ` (${row.owner.email})` : ""}` : row.anonymous ? "Anonymous" : "API key"}
                  {" · "}
                  {numbers.format(row.link.clicks)} clicks · created{" "}
                  <span title={formatDateTime(row.link.createdAt)}>{formatRelative(row.link.createdAt)}</span>
                </p>
              </div>
              <div className="flex gap-1 md:justify-end">
                <button
                  type="button"
                  className={iconButton}
                  onClick={() => setStatsFor(row.link)}
                  aria-label={`Stats for /${row.link.code}`}
                  data-tip="Stats"
                >
                  <ChartColumn />
                </button>
                <button
                  type="button"
                  className={`${iconButton} hover:not-disabled:text-danger`}
                  onClick={() => void remove(row)}
                  aria-label={`Delete /${row.link.code}`}
                  data-tip="Delete"
                >
                  <Trash2 />
                </button>
              </div>
            </Row>
          ))}
        </ul>
      )}
      <Pager page={page} data={data} onPage={setPage} />
      {statsFor && <StatsDialog api={api} link={statsFor} onClose={closeStats} onUnauthorized={onUnauthorized} />}
    </div>
  );
}

const REASON_LABELS: Record<ReportReason, string> = { phishing: "Phishing", malware: "Malware", spam: "Spam", other: "Other" };

/** Links people have reported, worst first. Dismiss or mark actioned closes all of a link's open reports. */
function ReportsList({ api, onUnauthorized, onChanged }: { api: OviApi; onUnauthorized: () => void; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const load = useCallback(() => api.adminReports(page, PAGE_SIZE), [api, page]);
  const { data, error, loading, reload: reloadList } = useLoad(load, onUnauthorized);
  const confirm = useConfirm();
  const notify = useToast();
  const reload = async () => {
    onChanged();
    await reloadList();
  };

  async function resolve(row: AdminReport, resolution: ReportResolution) {
    setBusy(row.code);
    setActionError(null);
    try {
      await api.resolveReports(row.code, resolution);
      notify(resolution === "dismissed" ? `Dismissed reports of /${row.code}` : `Marked /${row.code} as actioned`);
      await reload();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return onUnauthorized();
      setActionError(err instanceof ApiError ? err.message : "Couldn't update the reports.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: AdminReport) {
    const ok = await confirm({
      title: `Delete /${row.code}?`,
      message: "It will stop working for everyone, and its reports are removed with it.",
      confirmLabel: "Delete link",
      destructive: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      await api.remove(row.code);
      notify(`Deleted /${row.code}`);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't delete the link.");
    }
  }

  async function suspend(row: AdminReport) {
    if (!row.owner) return;
    const who = row.owner.name || row.owner.email || `user ${row.owner.id}`;
    const ok = await confirm({
      title: `Suspend ${who}?`,
      message: "They'll be signed out and their links will stop working. You can restore the account later.",
      confirmLabel: "Suspend account",
      destructive: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      await api.setBlocked(row.owner.id, true);
      notify(`Suspended ${who}`);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't suspend the account.");
    }
  }

  return (
    <div className="grid gap-3">
      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold">
        Reported links {data && <span className="rounded-full bg-subtle px-2 py-px text-xs font-medium text-muted tabular-nums">{data.total}</span>}
      </p>
      {(error || actionError) && (
        <p className={errorBox} role="alert">
          {error ?? actionError}
        </p>
      )}
      {!data && !error && (
        <div role="status" aria-label="Loading reports" className="grid gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      )}
      {data && data.items.length === 0 && !loading && <EmptyState icon={<Flag />} title="No open reports." />}
      {data && data.items.length > 0 && (
        <ul
          className={`${card} overflow-hidden text-sm max-md:grid max-md:gap-3 max-md:rounded-none max-md:bg-transparent max-md:shadow-none`}
          aria-label="Reported links"
        >
          {data.items.map((row) => {
            const owner = row.owner ? `${row.owner.name ? `${row.owner.name} ` : ""}${row.owner.email ? `(${row.owner.email})` : `#${row.owner.id}`}`.trim() : row.anonymous ? "Anonymous" : "API key";
            return (
              <Row key={row.code}>
                <div className="min-w-0">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-[0.8125rem] font-semibold" title={row.shortUrl}>
                      /{row.code}
                    </span>
                    <Badge tone="danger">
                      {row.openReports} open {row.openReports === 1 ? "report" : "reports"}
                    </Badge>
                    {(Object.keys(REASON_LABELS) as ReportReason[])
                      .filter((r) => row.reasons[r] > 0)
                      .map((r) => (
                        <Badge key={r}>
                          {REASON_LABELS[r]} {row.reasons[r]}
                        </Badge>
                      ))}
                  </p>
                  {/* Shown as text on purpose: it may be dangerous, so nothing opens it by accident. */}
                  <p className="break-all text-[0.8125rem] text-muted" title="Destination (not a link, since it may be harmful)">
                    {row.url}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {owner} · latest <span title={formatDateTime(row.latestAt)}>{formatRelative(row.latestAt)}</span>
                  </p>
                  {row.details.length > 0 && (
                    <ul className="mt-1.5 grid gap-1 text-xs text-ink" aria-label={`Details for /${row.code}`}>
                      {row.details.map((d, i) => (
                        <li key={i} className="break-words rounded-md bg-subtle px-2 py-1">
                          {d}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 md:max-w-[15rem] md:justify-end">
                  <button type="button" className={button("default", "sm")} disabled={busy === row.code} onClick={() => void resolve(row, "dismissed")} aria-label={`Dismiss reports of /${row.code}`}>
                    Dismiss
                  </button>
                  <button type="button" className={button("default", "sm")} disabled={busy === row.code} onClick={() => void resolve(row, "actioned")} aria-label={`Mark /${row.code} as actioned`}>
                    Mark actioned
                  </button>
                  <button type="button" className={button("danger", "sm")} onClick={() => void remove(row)} aria-label={`Delete /${row.code}`}>
                    Delete link
                  </button>
                  {row.owner && (
                    <button type="button" className={button("danger", "sm")} onClick={() => void suspend(row)} aria-label={`Suspend owner of /${row.code}`}>
                      Suspend owner
                    </button>
                  )}
                </div>
              </Row>
            );
          })}
        </ul>
      )}
      <Pager page={page} data={data} onPage={setPage} />
    </div>
  );
}
