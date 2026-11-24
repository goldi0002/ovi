import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { fakeApi } from "../test/fakeApi";
import { PAGES } from "../router";
import { SOURCE_URL } from "./GuidePages";

async function open(path: string) {
  fakeApi({ user: null });
  window.history.replaceState(null, "", path);
  render(<App />);
  await within(screen.getByRole("banner")).findByRole("button", { name: /^(Sign in|Account)$/ });
  return userEvent.setup();
}

describe("QR code generator page", () => {
  it("explains itself and makes a link with a QR code without an account", async () => {
    const user = await open(PAGES.qrCodeGenerator);
    expect(screen.getByRole("heading", { level: 1, name: "Free QR code generator" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Free QR code generator · Ovi"));
    expect(screen.getByText(/expire after/)).toHaveTextContent("30 days");

    await user.type(screen.getByLabelText("Long URL"), "https://example.com/menu");
    await user.click(screen.getByRole("button", { name: "Shorten URL" }));

    const result = await screen.findByRole("region", { name: "New short link" });
    expect(within(result).getByRole("img", { name: /QR code for/ })).toBeInTheDocument();
  });

  it("lets a visitor open the sign-in dialog from the advice about printing", async () => {
    const user = await open(PAGES.qrCodeGenerator);
    await user.click(screen.getByRole("button", { name: "sign in" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Self-hosting page", () => {
  it("shows the commands and links to the source", async () => {
    await open(PAGES.selfHost);
    expect(screen.getByRole("heading", { level: 1, name: "Self-host a URL shortener" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Self-host a URL shortener · Ovi"));
    expect(screen.getByText(/^curl -O .*docker compose up -d$/s, { selector: "code" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the source on GitHub" })).toHaveAttribute("href", SOURCE_URL);
  });
});

describe("Links between the pages", () => {
  it("reaches both guides and the source from the home page", async () => {
    await open(PAGES.home);
    const more = within(await screen.findByRole("navigation", { name: "More" }));
    expect(more.getByRole("link", { name: "QR code generator" })).toHaveAttribute("href", PAGES.qrCodeGenerator);
    expect(more.getByRole("link", { name: "Self-host Ovi" })).toHaveAttribute("href", PAGES.selfHost);
    expect(more.getByRole("link", { name: "Source code" })).toHaveAttribute("href", SOURCE_URL);
  });

  it("is known to the service worker", async () => {
    const sw = (await import("../../public/sw.js?raw")).default;
    expect(sw).toContain('"/qr-code-generator"');
    expect(sw).toContain('"/self-host"');
  });
});
