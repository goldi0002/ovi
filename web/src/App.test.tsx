import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { fakeApi, link } from "./test/fakeApi";

async function signIn(key = "good-key", remember = false) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Get Started" }));
  await user.type(screen.getByLabelText("API key"), key);
  if (remember) await user.click(screen.getByLabelText("Remember on this device"));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return user;
}

describe("App", () => {
  it("rejects a wrong API key", async () => {
    fakeApi();
    render(<App />);
    await signIn("wrong-key");

    expect(await screen.findByRole("alert")).toHaveTextContent("That API key was rejected.");
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("signs in, lists links and keeps the key for this tab only by default", async () => {
    fakeApi({ links: [link({ code: "docs", clicks: 3 })] });
    render(<App />);
    await signIn();

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "/docs" })).toHaveAttribute("href", "https://ovi.test/docs");
    expect(within(table).getByText("3")).toBeInTheDocument();
    expect(sessionStorage.getItem("ovi.apiKey")).toBe("good-key");
    expect(localStorage.getItem("ovi.apiKey")).toBeNull();
  });

  it("remembers the key on this device when asked", async () => {
    fakeApi();
    render(<App />);
    await signIn("good-key", true);

    await screen.findByText(/No links yet/);
    expect(localStorage.getItem("ovi.apiKey")).toBe("good-key");
  });

  it("creates a link, shows the result and adds it to the list", async () => {
    fakeApi();
    render(<App />);
    const user = await signIn();
    await screen.findByText(/No links yet/);

    await user.type(screen.getByLabelText("Long URL"), "https://example.com/new");
    await user.click(screen.getByRole("button", { name: "+ Custom code and expiry" }));
    await user.type(screen.getByLabelText(/Custom code/), "fresh");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));

    const result = await screen.findByRole("region", { name: "New short link" });
    expect(within(result).getByRole("link", { name: "https://ovi.test/fresh" })).toBeInTheDocument();
    expect(within(result).getByRole("img")).toHaveAttribute("src", "https://ovi.test/fresh/qr");
    expect(await within(await screen.findByRole("table")).findByRole("link", { name: "/fresh" })).toBeInTheDocument();
    expect(screen.getByLabelText("Long URL")).toHaveValue("");
  });

  it("shows the API's error when a code is taken", async () => {
    fakeApi({ links: [link({ code: "taken" })] });
    render(<App />);
    const user = await signIn();
    await screen.findByRole("table");

    await user.type(screen.getByLabelText("Long URL"), "https://example.com");
    await user.click(screen.getByRole("button", { name: "+ Custom code and expiry" }));
    await user.type(screen.getByLabelText(/Custom code/), "taken");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Code 'taken' is already taken.");
  });

  it("deletes a link after confirming", async () => {
    const { store } = fakeApi({ links: [link({ code: "gone" })] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    const user = await signIn();

    await user.click(await screen.findByRole("button", { name: "Delete /gone" }));

    await screen.findByText(/No links yet/);
    expect(store).toHaveLength(0);
  });

  it("shows a link's stats and switches the date range", async () => {
    const { fetchMock } = fakeApi({ links: [link({ code: "docs" })] });
    render(<App />);
    const user = await signIn();

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
    fakeApi({ links: [link({ code: "docs" })] });
    render(<App />);
    const user = await signIn();

    await user.click(await screen.findByRole("button", { name: "Stats for /docs" }));
    const chart = await screen.findByRole("img", { name: /clicks between/ });
    chart.focus();
    await user.keyboard("{End}");
    expect(screen.getByText(/on .*Nov 16/)).toHaveTextContent("3 clicks on");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText(/on .*Nov 15/)).toHaveTextContent("1 click on");
  });

  it("marks expired links", async () => {
    fakeApi({ links: [link({ code: "old", expiresAt: "2020-01-01T00:00:00Z" })] });
    render(<App />);
    await signIn();

    expect(await screen.findByText("Expired")).toBeInTheDocument();
  });

  it("signs out when the saved key stops working", async () => {
    sessionStorage.setItem("ovi.apiKey", "revoked-key");
    fakeApi();
    render(<App />);

    expect(await screen.findByRole("button", { name: "Get Started" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("ovi.apiKey")).toBeNull();
  });

  it("asks for the API key when shortening while signed out, then creates the link", async () => {
    fakeApi();
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Long URL"), "https://example.com/later");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));
    const dialog = screen.getByRole("dialog", { name: "Sign in to Ovi" });
    await user.type(within(dialog).getByLabelText("API key"), "good-key");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    const result = await screen.findByRole("region", { name: "New short link" });
    expect(within(result).getByRole("link", { name: "https://ovi.test/gen1234" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("does nothing when sign-in is cancelled", async () => {
    const { fetchMock } = fakeApi();
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Long URL"), "https://example.com/later");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Long URL")).toHaveValue("https://example.com/later");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toggles dark mode and remembers it", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ovi.theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });
});
