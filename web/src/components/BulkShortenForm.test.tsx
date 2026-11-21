import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { fakeApi, link } from "../test/fakeApi";

const ada = { name: "Ada Lovelace", email: "ada@example.com", provider: "google" as const, isAdmin: false };

/** Renders the app, waits for the session, and switches the home page to "Many links". */
async function openBulk() {
  render(<App />);
  await within(screen.getByRole("banner")).findByRole("button", { name: /^(Log in|Account)$/ });
  const user = userEvent.setup();
  const toggle = screen.getByRole("group", { name: "How many links" });
  await waitFor(() => expect(within(toggle).getByRole("button", { name: "Many links" })).toBeEnabled());
  await user.click(within(toggle).getByRole("button", { name: "Many links" }));
  return user;
}

const textarea = () => screen.getByRole("textbox", { name: "Long URLs (one per line)" });

/** The bulk requests the app sent. */
function bulkCalls(fetchMock: ReturnType<typeof fakeApi>["fetchMock"]) {
  return fetchMock.mock.calls.filter(([u]) => String(u) === "/api/links/bulk");
}

describe("Bulk shortening", () => {
  it("asks signed-out visitors to log in and sends nothing", async () => {
    const { fetchMock } = fakeApi();
    const user = await openBulk();

    expect(screen.getByText(/Shortening many links at once needs an account/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Long URLs/ })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: "Log in" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(bulkCalls(fetchMock)).toHaveLength(0);
  });

  it("counts non-blank lines and only allows 1 to 25", async () => {
    fakeApi({ user: ada });
    const user = await openBulk();
    expect(screen.getByText("0 of 25")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shorten URLs" })).toBeDisabled();

    await user.click(textarea());
    await user.paste("https://a.test\n\n   https://b.test  \n");
    expect(screen.getByText("2 of 25")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shorten 2 URLs" })).toBeEnabled();

    await user.clear(textarea());
    await user.paste(Array.from({ length: 27 }, (_, i) => `https://x.test/${i}`).join("\n"));
    expect(screen.getByRole("status")).toHaveTextContent("27 of 25. Remove 2 to continue.");
    expect(screen.getByRole("button", { name: "Shorten URLs" })).toBeDisabled();
  });

  it("shortens the trimmed lines in order, lists the results and focuses their heading", async () => {
    const { fetchMock } = fakeApi({ user: ada });
    const user = await openBulk();

    await user.click(textarea());
    await user.paste("  https://one.test  \n\nhttps://two.test\nhttps://one.test");
    await user.click(screen.getByRole("button", { name: "Shorten 3 URLs" }));

    const heading = await screen.findByRole("heading", { name: "3 links shortened" });
    await waitFor(() => expect(heading).toHaveFocus());
    const [, init] = bulkCalls(fetchMock)[0];
    expect(JSON.parse(String(init?.body))).toEqual({ urls: ["https://one.test", "https://two.test", "https://one.test"] });
    expect(new Headers(init?.headers).get("X-Ovi-Request")).toBe("1");

    const results = screen.getByRole("region", { name: "3 links shortened" });
    const rows = within(results).getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByRole("link").getAttribute("href"))).toEqual([
      "https://ovi.test/bulk1",
      "https://ovi.test/bulk2",
      "https://ovi.test/bulk3",
    ]);
    expect(within(rows[1]).getByText("https://two.test")).toBeInTheDocument();
    expect(textarea()).toHaveValue("");

    await user.click(within(results).getByRole("button", { name: "Copy all 3 short links" }));
    expect(await navigator.clipboard.readText()).toBe("https://ovi.test/bulk1\nhttps://ovi.test/bulk2\nhttps://ovi.test/bulk3");

    // Tab order: Copy all, Download CSV, then Dismiss (the row copy buttons come after).
    const order = within(results)
      .getAllByRole("button")
      .slice(0, 3)
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(order).toEqual(["Copy all 3 short links", "Download CSV", "Dismiss results"]);

    await user.click(within(results).getByRole("button", { name: "Dismiss results" }));
    expect(screen.queryByRole("region", { name: /links shortened/ })).not.toBeInTheDocument();
    expect(textarea()).toHaveFocus();
  });

  it("sends one expiry for the batch and shows its error next to the field", async () => {
    const { fetchMock } = fakeApi({ user: ada });
    const user = await openBulk();

    await user.click(textarea());
    await user.paste("https://a.test");
    await user.click(screen.getByRole("button", { name: "Expiry" }));
    await user.type(screen.getByLabelText(/Expires/), "2020-01-01T10:00");
    await user.click(screen.getByRole("button", { name: "Shorten 1 URL" }));

    const expiry = screen.getByLabelText(/Expires/);
    expect(await screen.findByText("The expiry date must be in the future.")).toHaveAttribute("id", "bulk-expires-error");
    expect(expiry).toHaveAttribute("aria-invalid", "true");
    expect(expiry).toHaveAttribute("aria-describedby", "bulk-expires-error");
    // Focus moves to the field, so its inline error is read.
    await waitFor(() => expect(expiry).toHaveFocus());
    expect(JSON.parse(String(bulkCalls(fetchMock)[0][1]?.body)).expiresAt).toBe(new Date("2020-01-01T10:00").toISOString());
    expect(textarea()).toHaveValue("https://a.test");
  });

  it("maps per-URL errors to the textarea's line numbers, counting blank lines, and focuses the summary", async () => {
    const { store } = fakeApi({ user: ada });
    const user = await openBulk();
    const text = "https://ok.test\n\nhtp://bad.test\nhttps://fine.test\n\nnot a url";

    await user.click(textarea());
    await user.paste(text);
    await user.click(screen.getByRole("button", { name: "Shorten 4 URLs" }));

    const summary = await screen.findByRole("group", { name: "2 lines need fixing. Nothing was shortened." });
    await waitFor(() => expect(summary).toHaveFocus());
    const items = within(summary).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Line 3: htp://bad.test — Enter a full web address starting with http:// or https://.",
      "Line 6: not a url — Enter a full web address starting with http:// or https://.",
    ]);
    expect(textarea()).toHaveValue(text);
    expect(textarea()).toHaveAttribute("aria-describedby", "bulk-count bulk-errors");
    expect(store).toHaveLength(0);

    await user.click(within(summary).getByRole("button", { name: "Line 6: not a url" }));
    const ta = textarea() as HTMLTextAreaElement;
    expect(ta).toHaveFocus();
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("not a url");
  });

  it("shows a batch-level error from the server as is", async () => {
    fakeApi({ user: ada });
    const user = await openBulk();
    // A lower limit set by the operator only shows up as the server's message.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ errors: { urls: ["You can shorten at most 10 URLs at once."] } }), { status: 400 })),
    );

    await user.click(textarea());
    await user.paste("https://a.test");
    await user.click(screen.getByRole("button", { name: "Shorten 1 URL" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You can shorten at most 10 URLs at once.");
  });

  it("keeps the text after a rate limit", async () => {
    fakeApi({ user: ada, bulkRateLimited: true });
    const user = await openBulk();

    await user.click(textarea());
    await user.paste("https://a.test");
    await user.click(screen.getByRole("button", { name: "Shorten 1 URL" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You've made a lot of links in the last minute. Try again in a minute.");
    expect(textarea()).toHaveValue("https://a.test");
  });

  it("shows the server's message after a 503 from the API, and keeps the text for a retry", async () => {
    fakeApi({ user: ada });
    const user = await openBulk();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ title: "Couldn't make short codes; try again." }), { status: 503 })));

    await user.click(textarea());
    await user.paste("https://a.test");
    await user.click(screen.getByRole("button", { name: "Shorten 1 URL" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't make short codes; try again.");
    expect(textarea()).toHaveValue("https://a.test");
    expect(screen.getByRole("button", { name: "Shorten 1 URL" })).toBeEnabled();
  });

  it("keeps focus on the submit button through sending and an error, and ignores repeat presses", async () => {
    fakeApi({ user: ada });
    const user = await openBulk();
    await user.click(textarea());
    await user.paste("https://a.test");
    // Hold the request open, so the second press happens while the batch is in flight.
    let answer: (r: Response) => void = () => {};
    const pending = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    vi.stubGlobal("fetch", pending);
    const submit = screen.getByRole("button", { name: "Shorten 1 URL" });
    submit.focus();

    await user.keyboard("{Enter}");
    const busy = await screen.findByRole("button", { name: "Shortening 1 URL…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(pending).toHaveBeenCalledTimes(1);

    answer(new Response(JSON.stringify({ title: "Too many" }), { status: 429 }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Shorten 1 URL" })).toHaveFocus();
    expect(pending).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a 503 page from a proxy", () => new Response("<html>Service Unavailable</html>", { status: 503 })],
    ["a 500", () => new Response(JSON.stringify({ title: "An error occurred while processing your request." }), { status: 500 })],
    ["a 413", () => new Response("", { status: 413 })],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("shows a generic error and keeps the text after %s", async (_, response) => {
    fakeApi({ user: ada });
    const user = await openBulk();
    vi.stubGlobal("fetch", vi.fn(async () => response() as Response | Promise<Response>));

    await user.click(textarea());
    await user.paste("https://a.test");
    await user.click(screen.getByRole("button", { name: "Shorten 1 URL" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't shorten the links. Try again.");
    expect(textarea()).toHaveValue("https://a.test");
  });

  it("keeps the text on screen when the session has expired, with a Log in button instead of submit", async () => {
    const { state } = fakeApi({ user: ada });
    const user = await openBulk();
    await user.click(textarea());
    await user.paste("https://a.test");
    state.user = null; // signed out in another tab

    await user.click(screen.getByRole("button", { name: "Shorten 1 URL" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You were signed out. Copy your list first, then log in again to shorten many links.");
    const form = screen.getByRole("form", { name: "Shorten many links" });
    await waitFor(() => expect(within(form).getByRole("button", { name: "Log in" })).toHaveFocus());
    // The instruction appears once, in the alert; no note repeats it beside the button.
    expect(screen.queryByText(/Your list stays here/)).not.toBeInTheDocument();
    expect(within(form).getAllByText(/Copy your list first/)).toHaveLength(1);
    await within(screen.getByRole("banner")).findByRole("button", { name: "Log in" });
    expect(textarea()).toHaveValue("https://a.test");
    expect(screen.queryByRole("button", { name: /^Shorten/ })).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Shorten many links" })).toContainElement(screen.getAllByRole("button", { name: "Log in" })[1]);
  });

  it("submits with Ctrl+Enter, while Enter alone adds a line", async () => {
    const { fetchMock } = fakeApi({ user: ada });
    const user = await openBulk();

    await user.click(textarea());
    await user.keyboard("https://a.test{Enter}https://b.test");
    expect(bulkCalls(fetchMock)).toHaveLength(0);
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(await screen.findByRole("heading", { name: "2 links shortened" })).toBeInTheDocument();
  });

  it("downloads a CSV of the results through an object URL", async () => {
    fakeApi({ user: ada });
    const createObjectURL = vi.fn(() => "blob:ovi-test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    const user = await openBulk();

    await user.click(textarea());
    await user.paste("https://a.test/x,y");
    await user.click(screen.getByRole("button", { name: "Shorten 1 URL" }));
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toMatch(/^ovi-links-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(clicked[0].href).toBe("blob:ovi-test");
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(await blob.text()).toContain('"https://a.test/x,y",https://ovi.test/bulk1,bulk1,');
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:ovi-test");
  });

  it("keeps each mode's text, and a bulk result replaces a single one", async () => {
    fakeApi({ user: ada, links: [link({ code: "old" })] });
    const user = await openBulk();
    const toggle = screen.getByRole("group", { name: "How many links" });

    await user.click(within(toggle).getByRole("button", { name: "One link" }));
    expect(within(toggle).getByRole("button", { name: "One link" })).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByLabelText("Long URL"), "https://single.test");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));
    expect(await screen.findByRole("region", { name: "New short link" })).toBeInTheDocument();

    await user.click(within(toggle).getByRole("button", { name: "Many links" }));
    await user.click(textarea());
    await user.paste("https://many.test");
    await user.click(within(toggle).getByRole("button", { name: "One link" }));
    await user.click(within(toggle).getByRole("button", { name: "Many links" }));
    expect(textarea()).toHaveValue("https://many.test");

    await user.click(screen.getByRole("button", { name: "Shorten 1 URL" }));
    expect(await screen.findByRole("heading", { name: "1 link shortened" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "New short link" })).not.toBeInTheDocument();
  });

  it("sends a CSV's codes and expiries as items, and lists a taken code on its line", async () => {
    const { fetchMock } = fakeApi({ user: ada });
    const user = await openBulk();
    await user.click(textarea());
    await user.paste("url,code,expires_at\nhttps://a.test,taken,\nhttps://b.test,menu,2031-01-31T09:00:00Z");

    await user.click(screen.getByRole("button", { name: "Shorten 2 URLs" }));
    const summary = await screen.findByRole("group", { name: /needs fixing/ });
    expect(within(summary).getByText(/Line 2:/)).toBeInTheDocument();
    expect(within(summary).getByText(/already taken/)).toBeInTheDocument();

    await user.clear(textarea());
    await user.paste("url,code,expires_at\nhttps://b.test,menu,2031-01-31T09:00:00Z");
    await user.click(screen.getByRole("button", { name: "Shorten 1 URL" }));
    await waitFor(() => expect(bulkCalls(fetchMock)).toHaveLength(2));
    expect(JSON.parse(String(bulkCalls(fetchMock)[1][1]?.body))).toEqual({
      items: [{ url: "https://b.test", customCode: "menu", expiresAt: "2031-01-31T09:00:00.000Z" }],
    });
  });

  it("fills the box from an uploaded CSV file", async () => {
    fakeApi({ user: ada });
    const user = await openBulk();
    const file = new File(["url,code\nhttps://a.test,menu"], "links.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("Upload CSV"), file);
    await waitFor(() => expect(textarea()).toHaveValue("url,code\nhttps://a.test,menu"));
    expect(screen.getByRole("button", { name: "Shorten 1 URL" })).toBeEnabled();
  });

  it("doesn't claim every link expires together when a CSV gave them different expiries", async () => {
    fakeApi({ user: ada });
    const user = await openBulk();
    await user.click(textarea());
    await user.paste("url,expires_at\nhttps://a.test,2031-03-01T09:00:00Z\nhttps://b.test,\n");
    await user.click(screen.getByRole("button", { name: "Shorten 2 URLs" }));
    expect(await screen.findByText(/Expiry differs by link/)).toBeInTheDocument();
    expect(screen.queryByText(/All expire/)).not.toBeInTheDocument();
  });
});
