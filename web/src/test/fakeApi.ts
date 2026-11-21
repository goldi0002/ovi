import { vi } from "vitest";
import type { AdminUser, Link, LinkStats, Provider, Session } from "../api";

export function link(overrides: Partial<Link> = {}): Link {
  const code = overrides.code ?? "abc1234";
  return {
    code,
    shortUrl: `https://ovi.test/${code}`,
    qrCodeUrl: `https://ovi.test/${code}/qr`,
    url: "https://example.com/some/long/path",
    clicks: 0,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    lastClickedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
  });

/** An in-memory fake of the Ovi API behind a mocked fetch. */
/** Stats for `code` over `days` days ending 2026-11-16, with clicks on the last two days. */
export function stats(code: string, days = 30, overrides: Partial<LinkStats> = {}): LinkStats {
  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(2026, 10, 16 - (days - 1 - i))).toISOString().slice(0, 10);
    return { date, clicks: i === days - 1 ? 3 : i === days - 2 ? 1 : 0 };
  });
  return {
    code,
    totalClicks: 9,
    days,
    clicksInRange: 4,
    daily,
    referrers: [
      { name: "news.ycombinator.com", clicks: 3 },
      { name: "Direct", clicks: 1 },
    ],
    devices: [
      { name: "Desktop", clicks: 3 },
      { name: "Mobile", clicks: 1 },
    ],
    browsers: [{ name: "Chrome", clicks: 4 }],
    ...overrides,
  };
}

interface FakeOptions {
  /** The admin API key the fake accepts. */
  apiKey?: string;
  links?: Link[];
  /** A signed-in user, as if the browser holds a session cookie (e.g. just back from Google). */
  user?: Session["user"];
  providers?: Provider[];
  /** Accounts listed in the admin dashboard. */
  users?: AdminUser[];
  /** Make POST /api/links/bulk answer 429, as when the create budget is used up. */
  bulkRateLimited?: boolean;
}

export function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 1,
    name: "Ada Lovelace",
    email: "ada@example.com",
    emailVerified: true,
    provider: "google",
    isAdmin: false,
    blockedAt: null,
    createdAt: "2026-11-01T10:00:00Z",
    lastLoginAt: "2026-11-16T10:00:00Z",
    links: 2,
    clicks: 7,
    ...overrides,
  };
}

export function fakeApi({
  apiKey = "good-key",
  links = [],
  user = null,
  providers = ["google", "github"],
  users = [],
  bulkRateLimited = false,
}: FakeOptions = {}) {
  const store = [...links];
  const accounts = [...users];
  const state = { user, bulkRateLimited };
  let bulkCount = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const headers = new Headers(init.headers);
    const key = headers.get("X-Api-Key");
    if (key !== null && key !== apiKey) return json(401, { title: "Missing or invalid API key." });
    const admin = key !== null || state.user?.isAdmin === true;
    const signedIn = admin || state.user !== null;

    const method = init.method ?? "GET";
    if (url.pathname === "/api/session")
      return json(200, { user: state.user, admin, providers, anonymousLinkDays: 30 } satisfies Session);
    if (method === "POST" && url.pathname === "/api/logout") {
      state.user = null;
      return json(204, undefined);
    }
    if (method === "POST" && url.pathname === "/api/links" && !signedIn) {
      const body = JSON.parse(String(init.body)) as { url: string; customCode?: string };
      if (body.customCode) return json(400, { errors: { customCode: ["Sign in to choose a custom code."] } });
      const created = link({ code: "anon123", url: body.url, expiresAt: "2026-12-17T12:00:00Z" });
      store.unshift(created);
      return json(201, created);
    }
    if (method === "POST" && url.pathname === "/api/links/bulk") {
      if (!signedIn) return json(401, { title: "Sign in to shorten many links at once." });
      if (state.bulkRateLimited) return json(429, { title: "You've made too many links in the last minute; try again shortly." });
      const body = JSON.parse(String(init.body)) as {
        urls?: string[];
        expiresAt?: string;
        items?: { url: string; customCode?: string; expiresAt?: string }[];
      };
      if (body.items) {
        const errors: Record<string, string[]> = {};
        body.items.forEach((it, i) => {
          if (it.customCode === "taken") errors[`items[${i}].customCode`] = ["Code 'taken' is already taken."];
        });
        if (Object.keys(errors).length > 0) return json(400, { title: "One or more validation errors occurred.", errors });
        const made = body.items.map((it) =>
          link({ code: it.customCode ?? `bulk${++bulkCount}`, url: it.url, expiresAt: it.expiresAt ?? body.expiresAt ?? null }),
        );
        store.unshift(...[...made].reverse());
        return json(201, { items: made });
      }
      const urls = body.urls ?? [];
      if (urls.length === 0) return json(400, { title: "One or more validation errors occurred.", errors: { urls: ["Add at least one URL."] } });
      if (urls.length > 25)
        return json(400, { title: "One or more validation errors occurred.", errors: { urls: ["You can shorten at most 25 URLs at once."] } });
      const errors: Record<string, string[]> = {};
      urls.forEach((u, i) => {
        if (!/^https?:\/\/\S+$/.test(u)) errors[`urls[${i}]`] = ["Enter a full web address starting with http:// or https://."];
      });
      if (body.expiresAt !== undefined && new Date(body.expiresAt) <= new Date())
        errors.expiresAt = ["The expiry date must be in the future."];
      if (Object.keys(errors).length > 0) return json(400, { title: "One or more validation errors occurred.", errors });
      const items = urls.map((u) => link({ code: `bulk${++bulkCount}`, url: u, expiresAt: body.expiresAt ?? null }));
      store.unshift(...[...items].reverse());
      return json(201, { items });
    }
    if (!signedIn) return json(401, { title: "Sign in to see and manage your links." });

    if (url.pathname.startsWith("/api/admin/")) {
      if (!admin) return json(403, { title: "Admins only." });
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const page = (items: unknown[]) => json(200, { items, page: 1, pageSize: 20, total: items.length });
      if (url.pathname === "/api/admin/overview")
        return json(200, {
          users: accounts.length,
          blockedUsers: accounts.filter((a) => a.blockedAt).length,
          links: store.length,
          anonymousLinks: 1,
          expiredLinks: 0,
          deletedLinks: 3,
          totalClicks: 42,
          dailyClicks: stats("x", 14).daily.map((d) => ({ date: d.date, count: d.clicks })),
          dailySignups: stats("x", 14).daily.map((d) => ({ date: d.date, count: 0 })),
          topLinks: store.slice(0, 5).map((l) => ({ code: l.code, shortUrl: l.shortUrl, url: l.url, clicks: l.clicks, ownerName: "Ada Lovelace" })),
        });
      if (url.pathname === "/api/admin/users")
        return page(accounts.filter((a) => !q || a.name.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q)));
      if (url.pathname === "/api/admin/links") {
        const owner = url.searchParams.get("owner") ?? "";
        const rows = store
          .filter((l) => !q || l.code.toLowerCase().includes(q) || l.url.toLowerCase().includes(q))
          .map((l, i) => ({ link: l, owner: i === 0 ? { id: 1, name: "Ada Lovelace", email: "ada@example.com" } : null, anonymous: i !== 0 }))
          .filter((r) => !owner || (owner === "anonymous" ? r.anonymous : owner === "apikey" ? false : r.owner?.id === Number(owner)));
        return page(rows);
      }
      const block = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/(block|unblock)$/);
      if (method === "POST" && block) {
        const account = accounts.find((a) => a.id === Number(block[1]));
        if (!account) return json(404, { title: "Not Found" });
        account.blockedAt = block[2] === "block" ? "2026-11-17T12:00:00Z" : null;
        return json(204, undefined);
      }
    }

    if (method === "GET" && url.pathname === "/api/links") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("pageSize") ?? 50);
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const status = url.searchParams.get("status") ?? "all";
      const expired = (l: Link) => l.expiresAt !== null && new Date(l.expiresAt) <= new Date();
      const matches = store
        .filter((l) => !q || l.code.toLowerCase().includes(q) || l.url.toLowerCase().includes(q))
        .filter((l) => status === "all" || (status === "expired") === expired(l));
      return json(200, { items: matches.slice((page - 1) * size, page * size), page, pageSize: size, total: matches.length });
    }
    const patch = url.pathname.match(/^\/api\/links\/([^/]+)$/);
    if (method === "PATCH" && patch) {
      const existing = store.find((l) => l.code === decodeURIComponent(patch[1]));
      if (!existing) return json(404, { title: "Not Found" });
      const body = JSON.parse(String(init.body)) as { url?: string; expiresAt?: string; clearExpiry?: boolean };
      const errors: Record<string, string[]> = {};
      if (body.url !== undefined && !/^https?:\/\/\S+$/.test(body.url))
        errors.url = ["Enter a full web address starting with http:// or https://."];
      if (body.expiresAt !== undefined && new Date(body.expiresAt) <= new Date())
        errors.expiresAt = ["The expiry date must be in the future."];
      if (Object.keys(errors).length > 0) return json(400, { title: "One or more validation errors occurred.", errors });
      if (body.url !== undefined) existing.url = body.url;
      if (body.clearExpiry) existing.expiresAt = null;
      else if (body.expiresAt !== undefined) existing.expiresAt = body.expiresAt;
      return json(200, existing);
    }
    if (method === "POST" && url.pathname === "/api/links") {
      const body = JSON.parse(String(init.body)) as { url: string; customCode?: string; expiresAt?: string };
      if (!/^https?:\/\//.test(body.url))
        return json(400, { title: "Validation failed", errors: { url: ["Url must be an absolute http or https URL."] } });
      if (body.customCode && store.some((l) => l.code === body.customCode))
        return json(409, { title: `Code '${body.customCode}' is already taken.` });
      const created = link({ code: body.customCode ?? "gen1234", url: body.url, expiresAt: body.expiresAt ?? null });
      store.unshift(created);
      return json(201, created);
    }
    const st = url.pathname.match(/^\/api\/links\/(.+)\/stats$/);
    if (method === "GET" && st) {
      const code = decodeURIComponent(st[1]);
      if (!store.some((l) => l.code === code)) return json(404, { title: "Not Found" });
      return json(200, stats(code, Number(url.searchParams.get("days") ?? 30)));
    }
    const del = url.pathname.match(/^\/api\/links\/(.+)$/);
    if (method === "DELETE" && del) {
      const i = store.findIndex((l) => l.code === decodeURIComponent(del[1]));
      if (i < 0) return json(404, { title: "Not Found" });
      store.splice(i, 1);
      return json(204, undefined);
    }
    return json(404, { title: "Not Found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, store, state, accounts };
}
