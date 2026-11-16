import { vi } from "vitest";
import type { Link, LinkStats } from "../api";

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

export function fakeApi({ apiKey = "good-key", links = [] as Link[] } = {}) {
  const store = [...links];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const headers = new Headers(init.headers);
    if (headers.get("X-Api-Key") !== apiKey) return json(401, { title: "Missing or invalid API key." });

    const method = init.method ?? "GET";
    if (method === "GET" && url.pathname === "/api/links") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("pageSize") ?? 50);
      return json(200, { items: store.slice((page - 1) * size, page * size), page, pageSize: size, total: store.length });
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
  return { fetchMock, store };
}
