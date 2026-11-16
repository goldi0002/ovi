import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { fakeApi, link } from "./test/fakeApi";

async function signIn(key = "good-key", remember = false) {
  const user = userEvent.setup();
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
    await user.type(screen.getByLabelText(/Custom code/), "fresh");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

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
    await user.type(screen.getByLabelText(/Custom code/), "taken");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

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

    expect(await screen.findByLabelText("API key")).toBeInTheDocument();
    expect(sessionStorage.getItem("ovi.apiKey")).toBeNull();
  });
});
