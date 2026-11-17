import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { fakeApi, link } from "./test/fakeApi";

const ada = { name: "Ada Lovelace", email: "ada@example.com", provider: "google" as const, isAdmin: false };

/** The header's Log in / Sign out button (the page can have other "Log in" buttons). */
const headerButton = (name: string) => within(screen.getByRole("banner")).getByRole("button", { name });
const findHeaderButton = async (name: string) => within(await screen.findByRole("banner")).findByRole("button", { name });

/** Renders the app and waits until it knows who is signed in. */
async function renderApp() {
  render(<App />);
  await within(screen.getByRole("banner")).findByRole("button", { name: /^(Log in|Sign out)$/ });
  return userEvent.setup();
}

/** Signs in as the admin with the API key from the Log in dialog. */
async function adminSignIn(key = "good-key", remember = false) {
  const user = await renderApp();
  await user.click(headerButton("Log in"));
  await user.click(screen.getByRole("button", { name: "Admin? Use an API key" }));
  await user.type(screen.getByLabelText("API key"), key);
  if (remember) await user.click(screen.getByLabelText("Remember on this device"));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return user;
}

/** Opens the Links page from the main navigation. */
async function openLinks(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("link", { name: "Links" }));
  return screen.findByRole("heading", { level: 1, name: "Your links" });
}

describe("App", () => {
  it("rejects a wrong API key", async () => {
    fakeApi();
    await adminSignIn("wrong-key");

    expect(await screen.findByRole("alert")).toHaveTextContent("That API key was rejected.");
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("signs the admin in, lists links and keeps the key for this tab only by default", async () => {
    fakeApi({ links: [link({ code: "docs", clicks: 3 })] });
    const user = await adminSignIn();
    expect(await findHeaderButton("Sign out")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument(); // the home page has no list
    await openLinks(user);

    expect(window.location.pathname).toBe("/links");
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "/docs" })).toHaveAttribute("href", "https://ovi.test/docs");
    expect(within(table).getByText("3")).toBeInTheDocument();
    expect(sessionStorage.getItem("ovi.apiKey")).toBe("good-key");
    expect(localStorage.getItem("ovi.apiKey")).toBeNull();
  });

  it("remembers the key on this device when asked", async () => {
    fakeApi();
    const user = await adminSignIn("good-key", true);
    await openLinks(user);

    await screen.findByText(/No links yet/);
    expect(localStorage.getItem("ovi.apiKey")).toBe("good-key");
  });

  it("creates a link with a custom code when signed in, and finds it on the Links page", async () => {
    fakeApi({ user: ada });
    const user = await renderApp();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Long URL"), "https://example.com/new");
    await user.click(screen.getByRole("button", { name: "Custom code and expiry" }));
    await user.type(screen.getByLabelText(/Custom code/), "fresh");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));

    const result = await screen.findByRole("region", { name: "New short link" });
    expect(within(result).getByRole("link", { name: "ovi.test/fresh" })).toBeInTheDocument();
    expect(within(result).getByRole("img")).toHaveAttribute("src", "https://ovi.test/fresh/qr");
    expect(screen.getByLabelText("Long URL")).toHaveValue("");

    await user.click(within(result).getByRole("link", { name: "All links" }));
    expect(await within(await screen.findByRole("table")).findByRole("link", { name: "/fresh" })).toBeInTheDocument();
  });

  it("shows the API's error when a code is taken", async () => {
    fakeApi({ links: [link({ code: "taken" })], user: ada });
    const user = await renderApp();

    await user.type(screen.getByLabelText("Long URL"), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Custom code and expiry" }));
    await user.type(screen.getByLabelText(/Custom code/), "taken");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Code 'taken' is already taken.");
  });

  it("deletes a link after confirming", async () => {
    const { store } = fakeApi({ links: [link({ code: "gone" })], user: ada });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = await renderApp();
    await openLinks(user);

    await user.click(await screen.findByRole("button", { name: "Delete /gone" }));

    await screen.findByText(/No links yet/);
    expect(store).toHaveLength(0);
  });

  it("shows a link's stats and switches the date range", async () => {
    const { fetchMock } = fakeApi({ links: [link({ code: "docs" })], user: ada });
    const user = await renderApp();
    await openLinks(user);

    await user.click(await screen.findByRole("button", { name: "Stats for /docs" }));
    const dialog = await screen.findByRole("dialog", { name: "Stats for /docs" });
    expect(await within(dialog).findByText("Clicks, last 30 days")).toBeInTheDocument();
    expect(within(dialog).getByText("All-time clicks").nextSibling).toHaveTextContent("9");
    expect(within(dialog).getByText("Top referrer").nextSibling).toHaveTextContent("news.ycombinator.com");
    expect(within(dialog).getByRole("img", { name: /4 clicks between .* Busiest day .* with 3/ })).toBeInTheDocument();
    const devices = within(dialog).getByRole("region", { name: "Devices" });
    expect(within(devices).getByText("Desktop")).toBeInTheDocument();
    expect(within(devices).getByText(/75%/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Last 7 days" }));
    expect(await within(dialog).findByText("Clicks, last 7 days")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Last 7 days" })).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toHaveBeenCalledWith("/api/links/docs/stats?days=7", expect.anything());

    // The table view lists every day, so nothing depends on hovering the chart.
    await user.click(within(dialog).getByRole("button", { name: "Show table" }));
    expect(within(within(dialog).getByRole("table")).getAllByRole("row")).toHaveLength(8);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stats for /docs" })).toHaveFocus();
  });

  it("reads out a day's clicks from the keyboard", async () => {
    fakeApi({ links: [link({ code: "docs" })], user: ada });
    const user = await renderApp();
    await openLinks(user);

    await user.click(await screen.findByRole("button", { name: "Stats for /docs" }));
    const chart = await screen.findByRole("img", { name: /clicks between/ });
    chart.focus();
    await user.keyboard("{End}");
    expect(screen.getByText(/on .*Nov 16/)).toHaveTextContent("3 clicks on");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText(/on .*Nov 15/)).toHaveTextContent("1 click on");
  });

  it("marks expired links", async () => {
    fakeApi({ links: [link({ code: "old", expiresAt: "2020-01-01T00:00:00Z" })], user: ada });
    await openLinks(await renderApp());

    expect(await screen.findByText("Expired")).toBeInTheDocument();
  });

  it("forgets a saved API key that stops working", async () => {
    sessionStorage.setItem("ovi.apiKey", "revoked-key");
    window.history.replaceState(null, "", "/links");
    fakeApi();
    await renderApp();

    expect(headerButton("Log in")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Log in to see your links" })).toBeInTheDocument();
    expect(sessionStorage.getItem("ovi.apiKey")).toBeNull();
  });

  it("shortens without an account: random code, 30-day expiry, no custom code", async () => {
    const { fetchMock } = fakeApi();
    const user = await renderApp();

    await user.click(screen.getByRole("button", { name: "Custom code and expiry" }));
    expect(screen.getByLabelText(/Custom code/)).toBeDisabled();
    expect(screen.getByText("Log in to choose your own code.")).toBeInTheDocument();
    expect(screen.getByText(/Without an account, links expire after 30 days/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Long URL"), "https://example.com/later");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));

    const result = await screen.findByRole("region", { name: "New short link" });
    expect(within(result).getByRole("link", { name: "ovi.test/anon123" })).toBeInTheDocument();
    expect(within(result).getByText(/^Expires /)).toBeInTheDocument();
    expect(within(result).queryByRole("link", { name: "All links" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const body = JSON.parse(String(fetchMock.mock.calls.find(([u]) => u === "/api/links")![1]!.body));
    expect(body.customCode).toBeUndefined();
  });

  it("offers Google and GitHub sign-in that comes back to the current page", async () => {
    window.history.replaceState(null, "", "/links");
    fakeApi();
    const user = await renderApp();

    await user.click(headerButton("Log in"));
    const dialog = screen.getByRole("dialog", { name: "Log in or sign up" });
    expect(within(dialog).getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
      "href",
      "/auth/login/google?returnUrl=%2Flinks",
    );
    expect(within(dialog).getByRole("link", { name: "Continue with GitHub" })).toHaveAttribute(
      "href",
      "/auth/login/github?returnUrl=%2Flinks",
    );
  });

  it("only shows the providers the server has turned on", async () => {
    fakeApi({ providers: [] });
    const user = await renderApp();

    await user.click(headerButton("Log in"));
    expect(screen.getByText("Sign-in isn't set up on this server yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Continue with/ })).not.toBeInTheDocument();
  });

  it("signs a user out", async () => {
    const { state } = fakeApi({ user: ada });
    const user = await renderApp();

    await user.click(headerButton("Sign out"));
    expect(await findHeaderButton("Log in")).toBeInTheDocument();
    expect(state.user).toBeNull();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("says so when a sign-in didn't finish", async () => {
    window.history.replaceState(null, "", "/?login=failed");
    fakeApi();
    const user = await renderApp();

    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in didn't finish. Try again.");
    expect(window.location.search).toBe("");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens the Links page from a direct URL and lists the user's links", async () => {
    window.history.replaceState(null, "", "/links");
    fakeApi({ links: [link({ code: "deep" })], user: ada });
    await renderApp();

    expect(screen.getByRole("heading", { level: 1, name: "Your links" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Links" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByLabelText("Long URL")).not.toBeInTheDocument();
    expect(await within(await screen.findByRole("table")).findByRole("link", { name: "/deep" })).toBeInTheDocument();
  });

  it("goes back to the home page with the browser's back button", async () => {
    fakeApi({ user: ada });
    const user = await renderApp();
    await openLinks(user);

    window.history.back();
    expect(await screen.findByLabelText("Long URL")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");

    await user.click(screen.getByRole("link", { name: "Links" }));
    await user.click(screen.getByRole("link", { name: "New link" }));
    expect(await screen.findByLabelText("Long URL")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
