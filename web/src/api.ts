export interface Link {
  code: string;
  shortUrl: string;
  qrCodeUrl: string;
  url: string;
  clicks: number;
  createdAt: string;
  lastClickedAt: string | null;
  expiresAt: string | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface NamedCount {
  name: string;
  clicks: number;
}

export interface LinkStats {
  code: string;
  /** Every click since the link was created. */
  totalClicks: number;
  days: number;
  clicksInRange: number;
  /** One entry per day (UTC, "YYYY-MM-DD"), oldest first. */
  daily: { date: string; clicks: number }[];
  referrers: NamedCount[];
  devices: NamedCount[];
  browsers: NamedCount[];
}

export type Provider = "google" | "github";

export interface Session {
  /** The signed-in account, or null. */
  user: { name: string; email: string | null; provider: Provider; isAdmin: boolean } | null;
  /** True for admins: the API key, or a signed-in user on the server's admin list. */
  admin: boolean;
  /** Sign-in providers turned on for this server. */
  providers: Provider[];
  /** How long links made without signing in last. */
  anonymousLinkDays: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface AdminOverview {
  users: number;
  blockedUsers: number;
  links: number;
  anonymousLinks: number;
  expiredLinks: number;
  deletedLinks: number;
  totalClicks: number;
  dailyClicks: DailyCount[];
  dailySignups: DailyCount[];
  /** Links with unresolved reports; absent from older servers. */
  openReports?: number;
  topLinks: { code: string; shortUrl: string; url: string; clicks: number; ownerName: string | null }[];
}

export interface AdminUser {
  id: number;
  name: string;
  email: string | null;
  emailVerified: boolean;
  provider: Provider;
  isAdmin: boolean;
  blockedAt: string | null;
  createdAt: string;
  lastLoginAt: string;
  links: number;
  clicks: number;
}

export interface AdminLink {
  link: Link;
  /** The account that made it; null for anonymous and API-key links. */
  owner: { id: number; name: string; email: string | null } | null;
  anonymous: boolean;
}

export type ReportReason = "phishing" | "malware" | "spam" | "other";
export type ReportResolution = "dismissed" | "actioned";

/** POST /api/reports (no sign-in needed). `link` is an Ovi code or a full short URL. */
export interface ReportLinkInput {
  link: string;
  reason: ReportReason;
  details?: string;
}

/** One link with open reports, as GET /api/admin/reports lists them. */
export interface AdminReport {
  code: string;
  shortUrl: string;
  url: string;
  owner: { id: number; name?: string | null; email: string | null } | null;
  anonymous: boolean;
  openReports: number;
  reasons: Record<ReportReason, number>;
  latestAt: string;
  /** The latest few non-empty details the reporters wrote. */
  details: string[];
}

/** "anonymous", "apikey", a user id, or "" for every link. */
export type OwnerFilter = string;

export interface CreateLinkInput {
  url: string;
  customCode?: string;
  expiresAt?: string;
}

/** POST /api/links/bulk: many links with random codes, all or nothing (signed-in users and the API key only). */
export interface BulkCreateLinksInput {
  /** At most 25 (fewer if the server's create budget is lower), in the order the results should come back. Send this or `items`. */
  urls?: string[];
  /** Like `urls`, with an optional custom code and expiry per link; errors come back as items[i].url, .customCode, .expiresAt. */
  items?: { url: string; customCode?: string; expiresAt?: string }[];
  /** One expiry for every link in the batch; leave out for links that never expire. */
  expiresAt?: string;
}

/** The 201 body of POST /api/links/bulk: one link per URL sent, in the same order. */
export interface BulkCreateLinksResponse {
  items: Link[];
}

/** Changes to a link; leave a field out to keep it. The code, clicks and stats never change. */
export interface UpdateLinkInput {
  url?: string;
  expiresAt?: string;
  /** Remove the expiry so the link never expires (can't be sent together with expiresAt). */
  clearExpiry?: boolean;
}

/** Which links to list: every one, those still working, or those past their expiry. */
export type LinkStatus = "all" | "active" | "expired";

export interface LinkFilter {
  /** Matches the code or destination, ignoring case. */
  q?: string;
  status?: LinkStatus;
}

/** An error from the API, with a readable message built from its problem-details body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
    /** True when the message is the server's own words (from the problem body), not a fallback. */
    public readonly fromServer = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ProblemDetails {
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
}

async function toError(res: Response): Promise<ApiError> {
  let problem: ProblemDetails = {};
  try {
    problem = (await res.json()) as ProblemDetails;
  } catch {
    // Not JSON (e.g. a proxy error page); fall back to the status text.
  }
  const fieldErrors = problem.errors ?? {};
  const fieldMessages = Object.values(fieldErrors).flat();
  const serverMessage = fieldMessages[0] ?? problem.detail ?? problem.title;
  const message =
    serverMessage ?? (res.status === 429 ? "Too many requests. Wait a minute and try again." : `Request failed (${res.status}).`);
  return new ApiError(res.status, message, fieldErrors, serverMessage !== undefined);
}

/**
 * The Ovi API. Requests carry the session cookie (signed-in users) and, for the admin, the API key.
 * X-Ovi-Request tells the server the request came from this app, not a form on another site.
 */
export class OviApi {
  constructor(
    private readonly apiKey: string | null = null,
    private readonly baseUrl = "",
  ) {}

  /** Whether this client acts as the admin. */
  get isAdmin(): boolean {
    return this.apiKey !== null;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        "X-Ovi-Request": "1",
        ...(this.apiKey ? { "X-Api-Key": this.apiKey } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) throw await toError(res);
    // 204 and 202 (a report was accepted) have no body.
    return (res.status === 204 || res.status === 202 ? undefined : await res.json()) as T;
  }

  session(): Promise<Session> {
    return this.request("/api/session");
  }

  logout(): Promise<void> {
    return this.request("/api/logout", { method: "POST" });
  }

  adminOverview(): Promise<AdminOverview> {
    return this.request("/api/admin/overview");
  }

  adminUsers(page = 1, q = "", pageSize = 20): Promise<Page<AdminUser>> {
    return this.request(`/api/admin/users?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`);
  }

  adminLinks(page = 1, q = "", owner: OwnerFilter = "", pageSize = 20): Promise<Page<AdminLink>> {
    return this.request(
      `/api/admin/links?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}&owner=${encodeURIComponent(owner)}`,
    );
  }

  adminReports(page = 1, pageSize = 20): Promise<Page<AdminReport>> {
    return this.request(`/api/admin/reports?page=${page}&pageSize=${pageSize}`);
  }

  /** Closes every open report of a link. */
  resolveReports(code: string, resolution: ReportResolution): Promise<void> {
    return this.request(`/api/admin/reports/${encodeURIComponent(code)}/resolve`, { method: "POST", body: JSON.stringify({ resolution }) });
  }

  /** Reports a link to the admin. Answers 202 with no body; 400 errors come back per field (link, reason, details). */
  reportLink(input: ReportLinkInput): Promise<void> {
    return this.request("/api/reports", { method: "POST", body: JSON.stringify(input) });
  }

  setBlocked(userId: number, blocked: boolean): Promise<void> {
    return this.request(`/api/admin/users/${userId}/${blocked ? "block" : "unblock"}`, { method: "POST" });
  }

  list(page = 1, pageSize = 20, { q = "", status = "all" }: LinkFilter = {}): Promise<Page<Link>> {
    const search = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "";
    const filter = status !== "all" ? `&status=${status}` : "";
    return this.request(`/api/links?page=${page}&pageSize=${pageSize}${search}${filter}`);
  }

  create(input: CreateLinkInput): Promise<Link> {
    return this.request("/api/links", { method: "POST", body: JSON.stringify(input) });
  }

  /**
   * Shortens many URLs in one request. Nothing is created if any URL is invalid: the 400 lists each one under
   * errors["urls[i]"], where i is its position in `urls`.
   */
  async createMany(input: BulkCreateLinksInput): Promise<Link[]> {
    const res = await this.request<BulkCreateLinksResponse>("/api/links/bulk", { method: "POST", body: JSON.stringify(input) });
    return res.items;
  }

  update(code: string, input: UpdateLinkInput): Promise<Link> {
    return this.request(`/api/links/${encodeURIComponent(code)}`, { method: "PATCH", body: JSON.stringify(input) });
  }

  stats(code: string, days = 30): Promise<LinkStats> {
    return this.request(`/api/links/${encodeURIComponent(code)}/stats?days=${days}`);
  }

  remove(code: string): Promise<void> {
    return this.request(`/api/links/${encodeURIComponent(code)}`, { method: "DELETE" });
  }
}

/** Where the browser goes to sign in with a provider; it comes back to `returnTo` afterwards. */
export function loginUrl(provider: Provider, returnTo: string): string {
  return `/auth/login/${provider}?returnUrl=${encodeURIComponent(returnTo)}`;
}

export function isExpired(link: Link, now = new Date()): boolean {
  return link.expiresAt !== null && new Date(link.expiresAt) <= now;
}
