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
  user: { name: string; email: string | null; provider: Provider } | null;
  /** True when the request carried the admin API key. */
  admin: boolean;
  /** Sign-in providers turned on for this server. */
  providers: Provider[];
  /** How long links made without signing in last. */
  anonymousLinkDays: number;
}

export interface CreateLinkInput {
  url: string;
  customCode?: string;
  expiresAt?: string;
}

/** An error from the API, with a readable message built from its problem-details body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
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
  const message =
    fieldMessages[0] ??
    problem.detail ??
    problem.title ??
    (res.status === 429 ? "Too many requests. Wait a minute and try again." : `Request failed (${res.status}).`);
  return new ApiError(res.status, message, fieldErrors);
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
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  session(): Promise<Session> {
    return this.request("/api/session");
  }

  logout(): Promise<void> {
    return this.request("/api/logout", { method: "POST" });
  }

  list(page = 1, pageSize = 20): Promise<Page<Link>> {
    return this.request(`/api/links?page=${page}&pageSize=${pageSize}`);
  }

  create(input: CreateLinkInput): Promise<Link> {
    return this.request("/api/links", { method: "POST", body: JSON.stringify(input) });
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
