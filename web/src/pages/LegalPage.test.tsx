import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { fakeApi } from "../test/fakeApi";
import { PAGES } from "../router";
import { CONTACT_URL } from "./LegalPage";

async function open(path: string, user: Parameters<typeof fakeApi>[0] = { user: null }) {
  fakeApi(user);
  window.history.replaceState(null, "", path);
  render(<App />);
}

describe("Privacy policy and terms", () => {
  it("shows the privacy policy, with what is stored and how to reach us", async () => {
    await open(PAGES.privacy);
    expect(await screen.findByRole("heading", { level: 1, name: "Privacy policy" })).toBeInTheDocument();
    for (const name of ["What we store", "Cookies and your device", "How long we keep it", "Your choices"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText(/never IP addresses|do not store IP addresses/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "open an issue" })[0]).toHaveAttribute("href", CONTACT_URL);
    await waitFor(() => expect(document.title).toBe("Privacy policy · Ovi"));
  });

  it("shows the terms, and points to the report page", async () => {
    await open(PAGES.terms);
    expect(await screen.findByRole("heading", { level: 1, name: "Terms of use" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "report" })).toHaveAttribute("href", PAGES.report);
    expect(screen.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", PAGES.privacy);
  });

  it("links to both pages from the home page and the sign-in sheet", async () => {
    await open(PAGES.home);
    const legal = within(await screen.findByRole("navigation", { name: "Legal" }));
    expect(legal.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", PAGES.privacy);
    expect(legal.getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", PAGES.terms);

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Sign in" })[0]);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/By continuing you agree/)).toBeInTheDocument();
    expect(dialog.getByRole("link", { name: "Terms of use" })).toHaveAttribute("target", "_blank");
  });

  it("is reachable offline-shell wise: the service worker knows both pages", async () => {
    const sw = (await import("../../public/sw.js?raw")).default;
    expect(sw).toContain('"/privacy"');
    expect(sw).toContain('"/terms"');
  });
});
