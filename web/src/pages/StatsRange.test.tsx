import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { fakeApi, link } from "../test/fakeApi";

const ada = { name: "Ada Lovelace", email: "ada@example.com", provider: "google" as const, isAdmin: false };

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  render(<App />);
  await within(screen.getByRole("banner")).findByRole("button", { name: /^(Sign in|Account)$/ });
  return userEvent.setup();
}

const detail = () => screen.getByRole("region", { name: "Link analytics" });

describe("Analytics date range", () => {
  it("keeps the range in the URL and picks it up again on load", async () => {
    const { fetchMock } = fakeApi({ user: ada, links: [link({ code: "docs" })] });
    const user = await renderAt("/links/analytics?code=docs");
    expect(await within(detail()).findByText("Clicks, last 30 days")).toBeInTheDocument();
    expect(within(detail()).getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(detail()).getByRole("button", { name: "Last 7 days" }));
    expect(await within(detail()).findByText("Clicks, last 7 days")).toBeInTheDocument();
    expect(window.location.search).toBe("?code=docs&days=7");
    expect(within(detail()).getByRole("button", { name: "Last 7 days" })).toHaveAttribute("aria-pressed", "true");

    // Back to the default: the URL drops the parameter.
    await user.click(within(detail()).getByRole("button", { name: "Last 30 days" }));
    await waitFor(() => expect(window.location.search).toBe("?code=docs"));

    // A reload: the page is torn down and loads again from the URL.
    cleanup();
    fetchMock.mockClear();
    await renderAt("/links/analytics?code=docs&days=90");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/links/docs/stats?days=90", expect.anything()));
  });

  it.each(["abc", "0", "-5", "366", "8", "7;drop"])("falls back to 30 days for ?days=%s", async (bad) => {
    const { fetchMock } = fakeApi({ user: ada, links: [link({ code: "docs" })] });
    await renderAt(`/links/analytics?code=docs&days=${encodeURIComponent(bad)}`);
    expect(await within(detail()).findByText("Clicks, last 30 days")).toBeInTheDocument();
    expect(within(detail()).getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toHaveBeenCalledWith("/api/links/docs/stats?days=30", expect.anything());
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`days=${bad}`))).toBe(false);
  });

  it("keeps the range when another link is chosen", async () => {
    const { fetchMock } = fakeApi({ user: ada, links: [link({ code: "docs" }), link({ code: "shop" })] });
    const user = await renderAt("/links/analytics?code=docs&days=7");
    await within(detail()).findByText("Clicks, last 7 days");
    await user.click(within(screen.getByRole("list", { name: "Links" })).getByRole("button", { name: /\/shop/ }));
    expect(window.location.search).toBe("?code=shop&days=7");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/links/shop/stats?days=7", expect.anything()));
  });
});

describe("Export CSV", () => {
  let blobs: Blob[];
  let names: string[];

  beforeEach(() => {
    blobs = [];
    names = [];
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("downloads the stats on screen as a CSV file", async () => {
    fakeApi({ user: ada, links: [link({ code: "docs" })] });
    const user = await renderAt("/links/analytics?code=docs&days=7");
    await within(detail()).findByText("Clicks, last 7 days");

    await user.click(within(detail()).getByRole("button", { name: "Export CSV" }));

    expect(names).toEqual(["ovi-docs-stats-7d-2026-11-16.csv"]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toContain("text/csv");
    const text = await blobs[0].text();
    expect(text).toContain("section,name,clicks");
    expect(text).toContain("daily,2026-11-16,3");
    expect(text).toContain("referrer,news.ycombinator.com,3");
    expect(text).toContain("browser,Chrome,4");
  });

  it("is off until there are stats to export", async () => {
    fakeApi({ user: ada, links: [link({ code: "docs" })] });
    // Hold the stats response back, so the disabled state is observed deterministically.
    const real = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/stats")) await gate;
      return real(input, init);
    }) as typeof fetch;
    await renderAt("/links/analytics?code=docs");
    expect(await within(detail()).findByRole("button", { name: "Export CSV" })).toBeDisabled();
    release();
    await within(detail()).findByText("Clicks, last 30 days");
    expect(within(detail()).getByRole("button", { name: "Export CSV" })).toBeEnabled();
  });

  it("stays off while a different range is loading, so it never exports data the picker is not showing", async () => {
    fakeApi({ user: ada, links: [link({ code: "docs" })] });
    const real = globalThis.fetch;
    let release!: () => void;
    let hold = false;
    const gate = new Promise<void>((resolve) => (release = resolve));
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (hold && String(input).includes("/stats")) await gate;
      return real(input, init);
    }) as typeof fetch;
    const user = await renderAt("/links/analytics?code=docs");
    await within(detail()).findByText("Clicks, last 30 days");
    hold = true;
    await user.click(within(detail()).getByRole("button", { name: "Last 7 days" }));
    expect(within(detail()).getByRole("button", { name: "Export CSV" })).toBeDisabled();
    release();
    await within(detail()).findByText("Clicks, last 7 days");
    expect(within(detail()).getByRole("button", { name: "Export CSV" })).toBeEnabled();
  });
});
