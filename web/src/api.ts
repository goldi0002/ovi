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

export class OviApi {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "",
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": this.apiKey,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) throw await toError(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  list(page = 1, pageSize = 20): Promise<Page<Link>> {
    return this.request(`/api/links?page=${page}&pageSize=${pageSize}`);
  }

  create(input: CreateLinkInput): Promise<Link> {
    return this.request("/api/links", { method: "POST", body: JSON.stringify(input) });
  }

  remove(code: string): Promise<void> {
    return this.request(`/api/links/${encodeURIComponent(code)}`, { method: "DELETE" });
  }
}

export function isExpired(link: Link, now = new Date()): boolean {
  return link.expiresAt !== null && new Date(link.expiresAt) <= now;
}
