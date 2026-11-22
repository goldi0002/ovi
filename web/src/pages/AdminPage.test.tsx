import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { adminUser, fakeApi, link } from "../test/fakeApi";

const boss = { name: "Grace Hopper", email: "boss@example.com", provider: "google" as const, isAdmin: true };
const ada = { name: "Ada Lovelace", email: "ada@example.com", provider: "google" as const, isAdmin: false };

async function openAdmin() {
  window.history.replaceState(null, "", "/admin");
  render(<App />);
  await within(screen.getByRole("banner")).findByRole("button", { name: /^(Sign in|Account)$/ });
  return userEvent.setup();
}

describe("Admin page", () => {
  it("shows the Admin item only to admins", async () => {
    fakeApi({ user: ada });
    render(<App />);
    await within(screen.getByRole("banner")).findByRole("button", { name: "Account" });
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("turns away signed-in users who aren't admins, without calling the admin API", async () => {
    const { fetchMock } = fakeApi({ user: ada });
    await openAdmin();

    expect(screen.getByRole("heading", { name: "Admins only" })).toBeInTheDocument();
    expect(screen.getByText("Your account doesn't have admin access.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/admin"))).toBe(false);
  });

  it("asks visitors to sign in", async () => {
    fakeApi();
    await openAdmin();
    expect(screen.getByText("Sign in with an admin account to see this page.")).toBeInTheDocument();
  });

  it("shows totals, users and links to an admin", async () => {
    fakeApi({ user: boss, users: [adminUser(), adminUser({ id: 2, name: "Grace Hopper", isAdmin: true })], links: [link({ code: "adas" }), link({ code: "anon1" })] });
    const user = await openAdmin();

    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
    const overview = await screen.findByRole("region", { name: "Overview" });
    expect(within(overview).getByText("Total clicks").nextSibling).toHaveTextContent("42");
    expect(within(overview).getByRole("img", { name: /clicks between/ })).toBeInTheDocument();

    const users = await screen.findByRole("list", { name: "Users" });
    expect(within(users).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(users).getByText("Admin")).toBeInTheDocument();
    // Admins can't be suspended, so only Ada has the button.
    expect(within(users).getAllByRole("button", { name: /^Suspend/ })).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: "Links" }));
    const links = await screen.findByRole("list", { name: "All links" });
    expect(within(links).getByRole("link", { name: "/adas" })).toBeInTheDocument();
    expect(within(links).getByText(/^Ada Lovelace \(ada@example.com\)/)).toBeInTheDocument();
  });

  it("suspends and restores a user", async () => {
    const { accounts } = fakeApi({ user: boss, users: [adminUser()] });
    const user = await openAdmin();

    await user.click(await screen.findByRole("button", { name: "Suspend Ada Lovelace" }));
    await user.click(within(screen.getByRole("dialog", { name: "Suspend Ada Lovelace?" })).getByRole("button", { name: "Suspend account" }));
    expect(await screen.findByText("Suspended")).toBeInTheDocument();
    expect(accounts[0].blockedAt).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Restore Ada Lovelace" }));
    expect(await screen.findByRole("button", { name: "Suspend Ada Lovelace" })).toBeInTheDocument();
    expect(accounts[0].blockedAt).toBeNull();
  });

  it("filters links by owner and deletes one", async () => {
    const { store, fetchMock } = fakeApi({ user: boss, users: [adminUser()], links: [link({ code: "adas" }), link({ code: "anon1" })] });
    const user = await openAdmin();

    await user.click(await screen.findByRole("button", { name: "View links" }));
    expect(await screen.findByText("By Ada Lovelace")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/admin/links?page=1&pageSize=20&q=&owner=1"), expect.anything());
    const links = await screen.findByRole("list", { name: "All links" });
    expect(within(links).queryByRole("link", { name: "/anon1" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show links from everyone" }));
    await user.click(await screen.findByRole("button", { name: "Delete /anon1" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this link /anon1?" })).getByRole("button", { name: "Delete link" }));
    await screen.findByRole("list", { name: "All links" });
    expect(store.map((l) => l.code)).toEqual(["adas"]);
  });

  it("searches users", async () => {
    fakeApi({ user: boss, users: [adminUser(), adminUser({ id: 3, name: "Linus", email: "linus@example.com" })] });
    const user = await openAdmin();

    await user.type(await screen.findByRole("searchbox", { name: "Users" }), "linus");
    await user.click(screen.getByRole("button", { name: "Search users" }));
    const users = await screen.findByRole("list", { name: "Users" });
    expect(await within(users).findByText("Linus")).toBeInTheDocument();
    expect(within(users).queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });
});
