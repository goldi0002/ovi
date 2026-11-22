import { ApiError, OviApi, isExpired } from "./api";
import { fakeApi, link } from "./test/fakeApi";

describe("OviApi", () => {
  it("sends the API key and returns parsed JSON", async () => {
    const { fetchMock } = fakeApi({ links: [link({ code: "one" })] });
    const page = await new OviApi("good-key").list(1, 10);

    expect(page.total).toBe(1);
    expect(page.items[0].code).toBe("one");
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("X-Api-Key")).toBe("good-key");
  });

  it("sends the session cookie and the X-Ovi-Request header, and no API key when there is none", async () => {
    const { fetchMock } = fakeApi({ user: { name: "Ada", email: null, provider: "github", isAdmin: false } });
    await new OviApi().create({ url: "https://example.com" });

    const init = fetchMock.mock.calls[0][1]!;
    expect(init.credentials).toBe("same-origin");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Ovi-Request")).toBe("1");
    expect(headers.has("X-Api-Key")).toBe(false);
  });

  it("turns validation problems into a readable ApiError", async () => {
    fakeApi();
    const err = await new OviApi("good-key").create({ url: "ftp://nope" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toBe("Url must be an absolute http or https URL.");
    expect((err as ApiError).fieldErrors.url).toHaveLength(1);
  });

  it("uses the problem title when there are no field errors", async () => {
    fakeApi({ links: [link({ code: "taken" })] });
    await expect(new OviApi("good-key").create({ url: "https://x.test", customCode: "taken" })).rejects.toMatchObject({
      status: 409,
      message: "Code 'taken' is already taken.",
    });
  });

  it("explains rate limiting even without a JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    await expect(new OviApi("k").list()).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/Too many/) });
  });

  it("sends search and status only when they narrow the list", async () => {
    const { fetchMock } = fakeApi();
    const api = new OviApi("good-key");
    await api.list(2, 10);
    await api.list(1, 20, { q: "  a&b%  ", status: "expired" });
    await api.list(1, 20, { q: " ", status: "all" });

    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      "/api/links?page=2&pageSize=10",
      "/api/links?page=1&pageSize=20&q=a%26b%25&status=expired",
      "/api/links?page=1&pageSize=20",
    ]);
  });

  it("edits a link with PATCH and returns the updated link", async () => {
    const { fetchMock } = fakeApi({ links: [link({ code: "a b" })] });
    const updated = await new OviApi("good-key").update("a b", { url: "https://example.com/new", clearExpiry: true });

    expect(updated.url).toBe("https://example.com/new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/links/a%20b");
    expect(init?.method).toBe("PATCH");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("handles 204 No Content on delete", async () => {
    fakeApi({ links: [link({ code: "bye" })] });
    await expect(new OviApi("good-key").remove("bye")).resolves.toBeUndefined();
  });
});

describe("isExpired", () => {
  it("is false without an expiry and true once it has passed", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    expect(isExpired(link({ expiresAt: null }), now)).toBe(false);
    expect(isExpired(link({ expiresAt: "2030-01-02T00:00:00Z" }), now)).toBe(false);
    expect(isExpired(link({ expiresAt: "2029-12-31T00:00:00Z" }), now)).toBe(true);
  });
});

describe("OviApi.createMany", () => {
  it("posts the URLs and expiry to /api/links/bulk and returns the links in order", async () => {
    const { fetchMock } = fakeApi({ user: { name: "Ada", email: null, provider: "github", isAdmin: false } });
    const links = await new OviApi().createMany({ urls: ["https://a.test", "https://b.test"], expiresAt: "2099-01-01T00:00:00.000Z" });

    expect(links.map((l) => l.url)).toEqual(["https://a.test", "https://b.test"]);
    expect(links.every((l) => l.expiresAt === "2099-01-01T00:00:00.000Z")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/links/bulk");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-Ovi-Request")).toBe("1");
    expect(JSON.parse(String(init?.body))).toEqual({ urls: ["https://a.test", "https://b.test"], expiresAt: "2099-01-01T00:00:00.000Z" });
  });

  it("rejects with the per-URL errors keyed by position", async () => {
    fakeApi({ user: { name: "Ada", email: null, provider: "github", isAdmin: false } });
    const err = (await new OviApi().createMany({ urls: ["https://ok.test", "nope"] }).catch((e: unknown) => e)) as ApiError;

    expect(err.status).toBe(400);
    expect(Object.keys(err.fieldErrors)).toEqual(["urls[1]"]);
  });

  it("is refused when signed out", async () => {
    fakeApi();
    await expect(new OviApi().createMany({ urls: ["https://a.test"] })).rejects.toMatchObject({
      status: 401,
      message: "Sign in to shorten many links at once.",
    });
  });
});

describe("ApiError.fromServer", () => {
  it("is true only when the message came from the problem body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ title: "Couldn't make short codes; try again." }), { status: 503 })));
    await expect(new OviApi().createMany({ urls: ["https://a.test"] })).rejects.toMatchObject({ status: 503, fromServer: true });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", { status: 503 })));
    await expect(new OviApi().createMany({ urls: ["https://a.test"] })).rejects.toMatchObject({
      status: 503,
      fromServer: false,
      message: "Ovi couldn't finish that (error 503). Try again in a moment.",
    });
  });
});
