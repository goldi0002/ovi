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
