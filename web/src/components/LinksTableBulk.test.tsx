import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { OviApi } from "../api";
import * as exporter from "../linksExport";
import { fakeApi, link } from "../test/fakeApi";
import { LinksTable } from "./LinksTable";

beforeEach(() => window.history.replaceState(null, "", "/links"));

async function renderTable(codes: string[]) {
  const api = fakeApi({ links: codes.map((code) => link({ code })) });
  const user = userEvent.setup();
  render(<LinksTable api={new OviApi("good-key")} onUnauthorized={() => {}} />);
  await screen.findByRole("table");
  return { user, ...api };
}

const pick = (user: ReturnType<typeof userEvent.setup>, code: string) =>
  user.click(screen.getByRole("checkbox", { name: `Select /${code}` }));

describe("LinksTable bulk actions", () => {
  it("shows the actions only once something is selected", async () => {
    const { user } = await renderTable(["a", "b"]);
    expect(screen.queryByRole("region", { name: "Selected links" })).toBeNull();

    await pick(user, "a");
    const bar = screen.getByRole("region", { name: "Selected links" });
    expect(within(bar).getByText("1 selected")).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Selected links" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select /a" })).not.toBeChecked();
  });

  it("selects every link on the page from the header checkbox", async () => {
    const { user } = await renderTable(["a", "b", "c"]);
    const all = screen.getByRole("checkbox", { name: "Select all links on this page" });

    await pick(user, "a");
    expect((all as HTMLInputElement).indeterminate).toBe(true);

    await user.click(all);
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(all).toBeChecked();

    await user.click(all);
    expect(screen.queryByRole("region", { name: "Selected links" })).toBeNull();
  });

  it("copies the selected short links, one per line", async () => {
    const { user } = await renderTable(["a", "b", "c"]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await pick(user, "a");
    await pick(user, "c");
    await user.click(screen.getByRole("button", { name: "Copy links" }));

    expect(writeText).toHaveBeenCalledWith("https://ovi.test/a\nhttps://ovi.test/c");
  });

  it("exports the selected links as CSV", async () => {
    const { user } = await renderTable(["a", "b"]);
    const save = vi.spyOn(exporter, "downloadLinksCsv").mockImplementation(() => {});

    await pick(user, "b");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].map((l) => l.code)).toEqual(["b"]);
  });

  it("deletes the selection after confirming", async () => {
    const { user, store } = await renderTable(["a", "b", "c"]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await pick(user, "a");
    await pick(user, "b");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Delete 2 links?"));
    await waitFor(() => expect(store.map((l) => l.code)).toEqual(["c"]));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Select /a" })).toBeNull());
    expect(screen.queryByRole("region", { name: "Selected links" })).toBeNull();
  });

  it("deletes nothing when the confirmation is declined", async () => {
    const { user, store } = await renderTable(["a", "b"]);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await pick(user, "a");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(store).toHaveLength(2);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("reports links that couldn't be deleted and keeps them selected", async () => {
    const { user, store } = await renderTable(["a", "b"]);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await pick(user, "a");
    await pick(user, "b");
    // "a" disappears behind the table's back, so its DELETE answers 404.
    store.splice(store.findIndex((l) => l.code === "a"), 1);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Deleted 1 of 2 links. Couldn't delete /a.");
    await waitFor(() => expect(screen.getByText("1 selected")).toBeInTheDocument());
  });
});
