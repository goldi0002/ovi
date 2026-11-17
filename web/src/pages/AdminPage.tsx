import { ChartColumn, ChevronLeft, ChevronRight, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, type AdminLink, type AdminOverview, type AdminUser, type Link, type OviApi, type Page } from "../api";
import { Status } from "../components/LinksTable";
import { ClicksChart, StatsDialog } from "../components/StatsDialog";
import { formatDateTime, formatRelative } from "../format";
import { button, card, container, errorBox, focusRing, iconButton, input } from "../ui";

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
  const [tab, setTab] = useState<"users" | "links">("users");
  const [ownerFilter, setOwnerFilter] = useState<{ value: string; label: string } | null>(null);

  useEffect(() => {
    document.title = "Admin · Ovi";
    return () => {
      document.title = "Ovi · URL shortener";
    };
  }, []);

  function showLinksOf(user: AdminUser) {
    setOwnerFilter({ value: String(user.id), label: user.name });
    setTab("links");
  }

  return (
    <main className={`${container} flex-1 py-8 sm:py-12`}>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">Admin</h1>

      {state === "loading" ? (
        <p className="text-[0.8125rem] text-muted">Loading…</p>
      ) : state !== "admin" ? (
        <section className={`${card} grid justify-items-center gap-2 px-6 py-12 text-center`}>
          <h2 className="text-[0.9375rem] font-semibold">Admins only</h2>
          <p className="max-w-sm text-[0.8125rem] text-muted">
            {state === "signedOut"
              ? "Log in with an admin account to see this page."
              : "Your account doesn't have admin access."}
          </p>
          {state === "signedOut" && (
            <button type="button" className={button("primary", "md", "mt-3")} onClick={onLogIn}>
              Log in
            </button>
          )}
        </section>
      ) : (
        <div className="grid gap-8">
          <Overview api={api} onUnauthorized={onUnauthorized} />

          <section className="grid gap-4">
            <div className="flex w-fit rounded-lg bg-black/[0.06] p-0.5" role="tablist" aria-label="Admin lists">
              {(["users", "links"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={`cursor-pointer rounded-md px-4 py-1 text-[0.8125rem] font-medium ${focusRing} ${
                    tab === t ? "bg-white text-ink shadow-control" : "text-muted hover:text-ink"
                  }`}
                  onClick={() => setTab(t)}
                >
                  {t === "users" ? "Users" : "Links"}
                </button>
              ))}
            </div>
            {tab === "users" ? (
              <UsersList api={api} onUnauthorized={onUnauthorized} onShowLinks={showLinksOf} />
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

function Overview({ api, onUnauthorized }: { api: OviApi; onUnauthorized: () => void }) {
  const load = useCallback(() => api.adminOverview(), [api]);
  const { data, error } = useLoad<AdminOverview>(load, onUnauthorized);

  if (error) return <p className={errorBox} role="alert">{error}</p>;
  if (!data) return <p className="text-[0.8125rem] text-muted">Loading overview…</p>;

  const tiles: [string, number][] = [
    ["Users", data.users],
    ["Links", data.links],
    ["Total clicks", data.totalClicks],
    ["Anonymous links", data.anonymousLinks],
    ["Expired links", data.expiredLinks],
    ["Suspended users", data.blockedUsers],
  ];

  return (
    <section className="grid gap-4" aria-label="Overview">
      <dl className="grid grid-cols-3 gap-3 max-md:grid-cols-2">
        {tiles.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-lg bg-subtle px-4 py-3">
            <dt className="text-[0.8125rem] text-muted">{label}</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{numbers.format(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <ClicksChart
          title="Clicks, last 14 days"
          daily={data.dailyClicks.map((d) => ({ date: d.date, clicks: d.count }))}
        />
        <div className="rounded-lg bg-subtle px-[1.1rem] py-4">
          <h3 className="mb-3 text-sm font-semibold">Top links</h3>
          {data.topLinks.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">No links yet.</p>
          ) : (
            <ol className="grid gap-2.5">
              {data.topLinks.map((l) => (
                <li key={l.code} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <a href={l.shortUrl} target="_blank" rel="noreferrer" className="block truncate font-mono font-semibold hover:underline" title={l.shortUrl}>
                      /{l.code}
                    </a>
                    <span className="block truncate text-xs text-muted" title={l.url}>
                      {l.ownerName ?? "No account"} · {l.url}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{numbers.format(l.clicks)}</span>
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
      <label className="min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          maxLength={100}
          className={`${input} h-8 text-[0.8125rem]`}
        />
      </label>
      <button type="submit" className={button("default", "sm")} aria-label={`Search ${label.toLowerCase()}`}>
        <Search />
      </button>
    </form>
  );
}

function Pager({ page, data, onPage }: { page: number; data: Page<unknown> | null; onPage: (p: number) => void }) {
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-center gap-3 text-[0.8125rem]" aria-label="Pages">
      <button type="button" className={button("default", "sm")} onClick={() => onPage(page - 1)} disabled={page <= 1}>
        <ChevronLeft />
        Previous
      </button>
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      <button type="button" className={button("default", "sm")} onClick={() => onPage(page + 1)} disabled={page >= pages}>
        Next
        <ChevronRight />
      </button>
    </nav>
  );
}

/** One row of a list: a card on phones, a striped row on wider screens. */
function Row({ children }: { children: ReactNode }) {
  return (
    <li className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:even:bg-subtle max-md:rounded-xl max-md:bg-surface max-md:shadow-window">
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

  async function toggle(user: AdminUser) {
    const block = user.blockedAt === null;
    if (block && !window.confirm(`Suspend ${user.name}? They'll be signed out and their links will stop working.`)) return;
    setBusy(user.id);
    setActionError(null);
    try {
      await api.setBlocked(user.id, block);
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
        <p className="text-[0.9375rem] font-semibold">
          Users {data && <span className="ml-1 font-normal text-muted">{data.total}</span>}
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
        <p className={`${card} px-6 py-10 text-center text-[0.8125rem] text-muted`}>No users found.</p>
      )}
      {data && data.items.length > 0 && (
        <ul
          className={`${card} overflow-hidden text-sm max-md:grid max-md:gap-3 max-md:rounded-none max-md:bg-transparent max-md:shadow-none`}
          aria-label="Users"
        >
          {data.items.map((u) => (
            <Row key={u.id}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold" title={u.name}>
                    {u.name}
                  </span>
                  {u.isAdmin && <Badge>Admin</Badge>}
                  {u.blockedAt && <Badge muted>Suspended</Badge>}
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

  useEffect(() => setPage(1), [owner]);

  async function remove(row: AdminLink) {
    const who = row.owner ? `${row.owner.name}'s` : "this";
    if (!window.confirm(`Delete ${who} link /${row.link.code}? It will stop working for everyone.`)) return;
    setActionError(null);
    try {
      await api.remove(row.link.code);
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
          <p className="text-[0.9375rem] font-semibold">
            Links {data && <span className="ml-1 font-normal text-muted">{data.total}</span>}
          </p>
          <div className="flex rounded-lg bg-black/[0.06] p-0.5" role="group" aria-label="Made by">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={isPreset && owner === p.value}
                className={`cursor-pointer rounded-md px-2.5 py-0.5 text-xs font-medium ${focusRing} ${
                  isPreset && owner === p.value ? "bg-white text-ink shadow-control" : "text-muted hover:text-ink"
                }`}
                onClick={() => onOwnerFilter(p.value ? p : null)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {!isPreset && ownerFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-subtle py-0.5 pr-1 pl-2.5 text-xs">
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
        <p className={`${card} px-6 py-10 text-center text-[0.8125rem] text-muted`}>No links found.</p>
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
                    className="max-w-full truncate font-mono font-semibold hover:underline"
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
                  title="Stats"
                >
                  <ChartColumn />
                </button>
                <button
                  type="button"
                  className={`${iconButton} text-danger`}
                  onClick={() => void remove(row)}
                  aria-label={`Delete /${row.link.code}`}
                  title="Delete"
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

function Badge({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-px text-[0.6875rem] font-semibold ${muted ? "bg-subtle text-muted" : "bg-ink text-white"}`}
    >
      {children}
    </span>
  );
}
