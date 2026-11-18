import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OviApi } from "../api";
import { fakeApi, link } from "../test/fakeApi";
import { LinksTable } from "./LinksTable";

const past = "2020-01-01T00:00:00Z";
const future = "2099-01-01T00:00:00Z";

/** Every /api/links list request the table made, as URLs. */
function listCalls(fetchMock: ReturnType<typeof fakeApi>["fetchMock"]) {
  return fetchMock.mock.calls
    .map(([u, init]) => ({ url: new URL(String(u), "http://localhost"), method: init?.method ?? "GET" }))
    .filter(({ url, method }) => method === "GET" && url.pathname === "/api/links");
}

async function renderTable() {
  const user = userEvent.setup();
  render(<LinksTable api={new OviApi("good-key")} onUnauthorized={() => {}} />);
  await screen.findByRole("heading", { name: /links/ });
  return user;
}

const rowCodes = () =>
  within(screen.getByRole("table"))
    .getAllByRole("link", { name: /^\// })
    .map((a) => a.textContent);

describe("LinksTable search and filter", () => {
  it("searches after a pause in typing, with one request for the whole term", async () => {
    const { fetchMock } = fakeApi({
      links: [link({ code: "docs", url: "https://docs.example.com" }), link({ code: "shop", url: "https://shop.example.com" })],
    });
    const user = await renderTable();
    await screen.findByRole("table");

    await user.type(screen.getByRole("searchbox", { name: "Search links" }), "DOC");

    await waitFor(() => expect(rowCodes()).toEqual(["/docs"]));
    const searches = listCalls(fetchMock).filter(({ url }) => url.searchParams.has("q"));
    expect(searches.map(({ url }) => url.searchParams.get("q"))).toEqual(["DOC"]);
    expect(searches[0].url.searchParams.get("page")).toBe("1");
  });

  it("filters by status with a segmented control", async () => {
    const { fetchMock } = fakeApi({
      links: [link({ code: "old", expiresAt: past }), link({ code: "live", expiresAt: future }), link({ code: "forever" })],
    });
    const user = await renderTable();
    await screen.findByRole("table");
    const group = screen.getByRole("group", { name: "Status" });
    expect(within(group).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(group).getByRole("button", { name: "Expired" }));
    await waitFor(() => expect(rowCodes()).toEqual(["/old"]));
    expect(screen.getByRole("heading", { name: /Expired links/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Expired" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(group).getByRole("button", { name: "Active" }));
    await waitFor(() => expect(rowCodes()).toEqual(["/live", "/forever"]));
    expect(listCalls(fetchMock).at(-1)!.url.searchParams.get("status")).toBe("active");

    await user.click(within(group).getByRole("button", { name: "All" }));
    await waitFor(() => expect(rowCodes()).toHaveLength(3));
    expect(listCalls(fetchMock).at(-1)!.url.searchParams.has("status")).toBe(false);
  });

  it("goes back to the first page when the search or filter changes", async () => {
    const links = Array.from({ length: 25 }, (_, i) => link({ code: `link${i}`, url: `https://example.com/${i}` }));
    const { fetchMock } = fakeApi({ links });
    const user = await renderTable();
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Active" }));
    await waitFor(() => expect(listCalls(fetchMock).at(-1)!.url.searchParams.get("status")).toBe("active"));
    expect(listCalls(fetchMock).at(-1)!.url.searchParams.get("page")).toBe("1");
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search links" }), "link1");
    await waitFor(() => expect(listCalls(fetchMock).at(-1)!.url.searchParams.get("q")).toBe("link1"));
    expect(listCalls(fetchMock).at(-1)!.url.searchParams.get("page")).toBe("1");
  });

  it("tells 'no matches' apart from 'no links yet', and can clear the search", async () => {
    fakeApi({ links: [link({ code: "docs" })] });
    const user = await renderTable();
    await screen.findByRole("table");

    await user.type(screen.getByRole("searchbox", { name: "Search links" }), "zzz");
    expect(await screen.findByText("No links match “zzz”.")).toBeInTheDocument();
    expect(screen.queryByText(/No links yet/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search and filter" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search links" })).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Expired" }));
    expect(await screen.findByText("No expired links.")).toBeInTheDocument();
  });

  it("still says 'no links yet' when there is nothing to search", async () => {
    fakeApi();
    await renderTable();
    expect(await screen.findByText(/No links yet/)).toBeInTheDocument();
  });
});

describe("Editing a link", () => {
  it("changes the destination and updates the row", async () => {
    const { fetchMock } = fakeApi({ links: [link({ code: "docs", url: "https://example.com/old", clicks: 4 })] });
    const user = await renderTable();

    await user.click(await screen.findByRole("button", { name: "Edit /docs" }));
    const dialog = screen.getByRole("dialog", { name: "Edit /docs" });
    const url = within(dialog).getByLabelText("Destination URL");
    expect(url).toHaveValue("https://example.com/old");
    expect(url).toHaveFocus();
    await user.clear(url);
    await user.type(url, "https://example.com/new");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(screen.getByRole("table")).getByText("https://example.com/new")).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe("/api/links/docs");
    // Only what changed is sent.
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ url: "https://example.com/new" });
  });

  it("shows the API's validation errors next to the fields and keeps the dialog open", async () => {
    fakeApi({ links: [link({ code: "docs" })] });
    const user = await renderTable();

    await user.click(await screen.findByRole("button", { name: "Edit /docs" }));
    const dialog = screen.getByRole("dialog", { name: "Edit /docs" });
    const url = within(dialog).getByLabelText("Destination URL");
    await user.clear(url);
    await user.type(url, "not a url");
    // jsdom can't type into a datetime-local field one key at a time.
    fireEvent.change(within(dialog).getByLabelText(/Expires/), { target: { value: "2020-01-01T10:00" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Enter a full web address starting with http:// or https://.")).toBeInTheDocument();
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(url).toHaveAccessibleDescription("Enter a full web address starting with http:// or https://.");
    expect(within(dialog).getByLabelText(/Expires/)).toHaveAccessibleDescription("The expiry date must be in the future.");
    expect(within(screen.getByRole("table")).getByText("https://example.com/some/long/path")).toBeInTheDocument();
  });

  it("removes the expiry with clearExpiry", async () => {
    const { fetchMock } = fakeApi({ links: [link({ code: "soon", expiresAt: future })] });
    const user = await renderTable();
    expect(await screen.findByText(/^Expires /)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit /soon" }));
    const dialog = screen.getByRole("dialog", { name: "Edit /soon" });
    expect(within(dialog).getByLabelText(/Expires/)).not.toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "Never expire" }));
    expect(within(dialog).getByLabelText(/Expires/)).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(screen.getByRole("table")).findByText("Active")).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ clearExpiry: true });
  });

  it("closes without saving on Cancel or Escape, and when nothing changed", async () => {
    const { fetchMock } = fakeApi({ links: [link({ code: "docs" })] });
    const user = await renderTable();

    await user.click(await screen.findByRole("button", { name: "Edit /docs" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit /docs" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit /docs" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Edit /docs" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
});
