import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { fakeApi, link } from "../test/fakeApi";

const ada = { name: "Ada Lovelace", email: "ada@example.com", provider: "google" as const, isAdmin: false };
const past = "2020-01-01T00:00:00Z";
const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  render(<App />);
  await within(screen.getByRole("banner")).findByRole("button", { name: /^(Sign in|Account)$/ });
  return userEvent.setup();
}

/** The number a stat tile shows, found by its label. */
const tile = (region: HTMLElement, label: string) => within(region).getByText(label).nextSibling;

describe("Dashboard", () => {
  it("greets the user and adds up their links and clicks", async () => {
    fakeApi({
      user: ada,
      links: [
        link({ code: "docs", clicks: 12 }),
        link({ code: "shop", clicks: 30, expiresAt: soon }),
        link({ code: "old", clicks: 3, expiresAt: past }),
      ],
    });
    await renderAt("/");

    expect(screen.getByRole("heading", { level: 1, name: /, Ada$/ })).toBeInTheDocument();
    const overview = screen.getByRole("region", { name: "Overview" });
    await waitFor(() => expect(tile(overview, "Total links")).toHaveTextContent("3"));
    expect(tile(overview, "Total clicks")).toHaveTextContent("45");
    expect(tile(overview, "Active links")).toHaveTextContent("2");
    expect(tile(overview, "Expired links")).toHaveTextContent("1");
    expect(within(overview).getByText("1 expire within a week")).toBeInTheDocument();

    // Recent: newest first, as the server lists them. Top: most clicked first.
    const recent = screen.getByRole("region", { name: "Recent links" });
    expect(within(recent).getAllByRole("link", { name: /^ovi\.test/ }).map((a) => a.textContent)).toEqual(["ovi.test/docs", "ovi.test/shop", "ovi.test/old"]);
    const top = screen.getByRole("region", { name: "Top links" });
    const ranked = within(top).getAllByRole("link", { name: /^Analytics for/ });
    expect(ranked.map((a) => a.getAttribute("href"))).toEqual([
      "/links/analytics?code=shop",
      "/links/analytics?code=docs",
      "/links/analytics?code=old",
    ]);
  });

  it("counts a new link straight away", async () => {
    fakeApi({ user: ada, links: [link({ code: "docs" })] });
    const user = await renderAt("/");
    const overview = screen.getByRole("region", { name: "Overview" });
    await waitFor(() => expect(tile(overview, "Total links")).toHaveTextContent("1"));

    await user.type(screen.getByLabelText("Long URL"), "https://example.com/new");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));

    await screen.findByRole("region", { name: "New short link" });
    await waitFor(() => expect(tile(overview, "Total links")).toHaveTextContent("2"));
  });

  it("invites a first link when there are none", async () => {
    fakeApi({ user: ada });
    await renderAt("/");
    expect(await screen.findByText("Your links will show up here")).toBeInTheDocument();
  });

  it("shows visitors the shortener, the features and the FAQ instead", async () => {
    fakeApi();
    await renderAt("/");
    expect(screen.getByRole("heading", { level: 1, name: "Make any link short enough to share." })).toBeInTheDocument();
    expect(screen.getByLabelText("Long URL")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Good to know" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });
});

describe("Analytics page", () => {
  it("opens on the newest link and switches to another from the list", async () => {
    const { fetchMock } = fakeApi({ user: ada, links: [link({ code: "docs" }), link({ code: "shop" })] });
    const user = await renderAt("/links/analytics");

    const detail = screen.getByRole("region", { name: "Link analytics" });
    expect(await within(detail).findByRole("heading", { name: /\/docs/ })).toBeInTheDocument();
    expect(window.location.search).toBe("?code=docs");
    expect(await within(detail).findByText("Clicks, last 30 days")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute("aria-current", "page");

    await user.click(within(screen.getByRole("list", { name: "Links" })).getByRole("button", { name: /\/shop/ }));
    expect(await within(detail).findByRole("heading", { name: /\/shop/ })).toBeInTheDocument();
    expect(window.location.search).toBe("?code=shop");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/links/shop/stats?days=30", expect.anything()));

    await user.click(within(detail).getByRole("button", { name: "Last 90 days" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/links/shop/stats?days=90", expect.anything()));
  });

  it("opens the link named in the URL, and says so when there is no such link", async () => {
    fakeApi({ user: ada, links: [link({ code: "docs" }), link({ code: "shop" })] });
    await renderAt("/links/analytics?code=shop");
    const detail = screen.getByRole("region", { name: "Link analytics" });
    expect(await within(detail).findByRole("heading", { name: /\/shop/ })).toBeInTheDocument();

    screen.getByRole("link", { name: "Dashboard" }).click();
    window.history.replaceState(null, "", "/links/analytics?code=nope");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByText("That link isn't here")).toBeInTheDocument();
  });

  it("asks visitors to sign in", async () => {
    const { fetchMock } = fakeApi();
    await renderAt("/links/analytics");
    expect(screen.getByRole("heading", { name: "Sign in to see your analytics" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/links"))).toBe(false);
  });
});

describe("QR Codes page", () => {
  it("shows each link's QR code with a download", async () => {
    fakeApi({ user: ada, links: [link({ code: "docs" }), link({ code: "shop" })] });
    await renderAt("/links/qr-codes");

    const grid = await screen.findByRole("list", { name: "QR codes" });
    const download = await within(grid).findByRole("link", { name: "Download the QR code for /docs" });
    expect(download).toHaveAttribute("href", "https://ovi.test/docs/qr");
    expect(download).toHaveAttribute("download", "docs-qr.png");
    expect(within(grid).getByRole("link", { name: "Download the QR code for /shop" })).toBeInTheDocument();
  });

  it("styles a link's QR code in the browser, and not an expired one's", async () => {
    fakeApi({ user: ada, links: [link({ code: "docs" }), link({ code: "old", expiresAt: past })] });
    const user = await renderAt("/links/qr-codes");
    await screen.findByRole("list", { name: "QR codes" });
    expect(await screen.findByRole("button", { name: "Style the QR code for /old" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Style the QR code for /docs" }));
    expect(screen.getByRole("dialog", { name: "Style the QR code for /docs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SVG" })).toBeEnabled();
  });

  it("doesn't offer an expired link's QR code, which the server no longer serves", async () => {
    fakeApi({ user: ada, links: [link({ code: "old", expiresAt: past })] });
    await renderAt("/links/qr-codes");

    expect(await screen.findByText(/its QR code no longer works/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /QR code for \/old/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PNG" })).toBeDisabled();
  });

  it("searches, and can clear a search that finds nothing", async () => {
    fakeApi({ user: ada, links: [link({ code: "docs" }), link({ code: "shop", url: "https://shop.example.com" })] });
    const user = await renderAt("/links/qr-codes");
    await screen.findByRole("link", { name: "Download the QR code for /docs" });

    await user.type(screen.getByRole("searchbox", { name: "Search QR codes" }), "shop");
    await waitFor(() => expect(screen.queryByRole("link", { name: "Download the QR code for /docs" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Download the QR code for /shop" })).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Search QR codes" }));
    await user.type(screen.getByRole("searchbox", { name: "Search QR codes" }), "zzz");
    expect(await screen.findByText("No links match “zzz”.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all QR codes" }));
    expect(await screen.findByRole("link", { name: "Download the QR code for /docs" })).toBeInTheDocument();
  });

  it("invites a first link when there are none", async () => {
    fakeApi({ user: ada });
    await renderAt("/links/qr-codes");
    expect(await screen.findByText("No QR codes yet")).toBeInTheDocument();
  });
});

describe("Account menu and Settings", () => {
  it("opens with the keyboard, moves with the arrows and closes on Escape", async () => {
    fakeApi({ user: ada });
    const user = await renderAt("/");
    const trigger = within(screen.getByRole("banner")).getByRole("button", { name: "Account" });

    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(within(menu).getByRole("menuitem", { name: "Settings" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Settings" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows the account and changes the theme everywhere at once", async () => {
    fakeApi({ user: ada });
    const user = await renderAt("/");

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByText("ada@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText(/come from Google/)).toBeInTheDocument();

    const themes = within(dialog).getByRole("group", { name: "Theme" });
    expect(within(themes).getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(themes).getByRole("button", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ovi.theme")).toBe("dark");
    // The toolbar's toggle shows the same choice.
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Theme: Dark" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    delete document.documentElement.dataset.theme;
  });

  it("signs out from Settings", async () => {
    const { state } = fakeApi({ user: ada });
    const user = await renderAt("/");

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Settings" }));
    await user.click(within(screen.getByRole("dialog", { name: "Settings" })).getByRole("button", { name: "Sign out" }));
    expect(await within(screen.getByRole("banner")).findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(state.user).toBeNull();
  });

  it("confirms with a toast when a link is saved", async () => {
    fakeApi({ user: ada, links: [link({ code: "docs" })] });
    const user = await renderAt("/links");
    await user.click(await screen.findByRole("button", { name: "Edit /docs" }));
    const dialog = screen.getByRole("dialog", { name: "Edit /docs" });
    await user.clear(within(dialog).getByLabelText("Destination URL"));
    await user.type(within(dialog).getByLabelText("Destination URL"), "https://example.com/next");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved /docs")).toBeInTheDocument();
  });
});
