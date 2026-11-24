import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { PAGES } from "./router";
import { fakeApi } from "./test/fakeApi";
import indexHtml from "../index.html?raw";
import manifestJson from "../public/manifest.webmanifest?raw";
import serviceWorker from "../public/sw.js?raw";
import llms from "../public/llms.txt?raw";
import { FAQ_ITEMS } from "./components/Faq";
import { sharedUrl } from "./components/ShortenCard";

const icons = Object.keys(import.meta.glob("../public/icons/*.png", { query: "?url" })).map((path) => path.replace("../public", ""));

const ada = { name: "Ada Lovelace", email: "ada@example.com", provider: "google" as const, isAdmin: false };

async function renderSignedIn() {
  fakeApi({ user: ada });
  window.history.replaceState(null, "", "/");
  render(<App />);
  await within(screen.getByRole("banner")).findByRole("button", { name: "Account" });
  return userEvent.setup();
}

describe("App shell", () => {
  it("has no footer", async () => {
    await renderSignedIn();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(screen.queryByText("Self-hosted URL shortener")).not.toBeInTheDocument();
  });

  it("says so when the device is offline, and stops when it is back", async () => {
    await renderSignedIn();
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event("offline")));
    // jsdom's navigator.onLine stays true, so fake it.
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event("offline")));
    // Other "status" regions (such as a loading placeholder) can be on screen too, so find the banner by its text.
    expect(screen.getByText(/You're offline/)).toHaveAttribute("role", "status");
    online.mockReturnValue(true);
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
    online.mockRestore();
  });
});

describe("Install", () => {
  async function openSettings() {
    const user = await renderSignedIn();
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Settings" }));
    return { user, dialog: screen.getByRole("dialog", { name: "Settings" }) };
  }

  it("links to the source code from Settings, as the AGPL asks", async () => {
    const { dialog } = await openSettings();
    const link = within(dialog).getByRole("link", { name: "Source code" });
    expect(link).toHaveAttribute("href", "https://github.com/goldi0002/ovi");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dialog).getByText(/AGPL-3\.0/)).toBeInTheDocument();
  });

  it("offers nothing where installing isn't possible", async () => {
    const { dialog } = await openSettings();
    expect(within(dialog).queryByRole("button", { name: "Install Ovi" })).not.toBeInTheDocument();
  });

  it("offers the browser's install prompt once it has been announced", async () => {
    const user = await renderSignedIn();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Install Ovi" }));
    expect(prompt).toHaveBeenCalledOnce();
    expect(within(dialog).queryByRole("button", { name: "Install Ovi" })).not.toBeInTheDocument();
  });
});

describe("Install banner", () => {
  afterEach(() => localStorage.clear());

  it("invites visitors to install once the browser allows it, and remembers when they say not now", async () => {
    fakeApi({ user: null });
    window.history.replaceState(null, "", "/");
    const { unmount } = render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("region", { name: "Install Ovi" })).not.toBeInTheDocument();

    const prompt = vi.fn().mockResolvedValue(undefined);
    act(() => void window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) })));
    const banner = screen.getByRole("region", { name: "Install Ovi" });
    await user.click(within(banner).getByRole("button", { name: "Install" }));
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Install Ovi" })).not.toBeInTheDocument();

    // Offered again (the browser can announce it again); closing it sticks across visits.
    act(() => void window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) })));
    await user.click(within(screen.getByRole("region", { name: "Install Ovi" })).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region", { name: "Install Ovi" })).not.toBeInTheDocument();
    unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("region", { name: "Install Ovi" })).not.toBeInTheDocument();
  });
});

describe("Installable app files", () => {
  const manifest = JSON.parse(manifestJson);

  it("has a manifest that opens Ovi as a standalone app with maskable icons", () => {
    expect(manifest).toMatchObject({ name: "Ovi", start_url: "/", scope: "/", display: "standalone" });
    const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const icon of manifest.icons) expect(icons).toContain(icon.src);
  });

  it("accepts links shared from other apps, and the page puts them in the box", () => {
    expect(manifest.share_target).toEqual({ action: "/", method: "GET", params: { title: "title", text: "text", url: "url" } });
    expect(Object.values(PAGES)).toContain(manifest.share_target.action);
    expect(sharedUrl("?url=https%3A%2F%2Fexample.com%2Fa")).toBe("https://example.com/a");
    // Android apps often put the link inside the shared text.
    expect(sharedUrl("?title=Hi&text=Look%20at%20https%3A%2F%2Fexample.com%2Fb%20now")).toBe("https://example.com/b");
    expect(sharedUrl("?text=no%20link%20here")).toBe("");
    expect(sharedUrl("")).toBe("");
  });

  it("only offers shortcuts to pages that exist", () => {
    const pages = Object.values(PAGES) as string[];
    for (const shortcut of manifest.shortcuts) expect(pages).toContain(shortcut.url.split("#")[0]);
  });

  it("is linked from the page, along with the iOS icon", () => {
    expect(indexHtml).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(indexHtml).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(icons).toContain("/icons/apple-touch-icon.png");
  });

  it("has a service worker that knows the same pages as the router, and never caches the API", () => {
    const sw = serviceWorker;
    const listed = JSON.parse(/const PAGES = (\[.*?\]);/.exec(sw)![1]);
    expect(listed).toEqual(Object.values(PAGES));
    const code = sw.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\/api|\/auth/);
    expect(sw).toContain('request.method !== "GET"');
  });
});

describe("Public copy", () => {
  it("says where the source code is, in the FAQ, its structured data and llms.txt", () => {
    const item = FAQ_ITEMS.find((i) => i.q === "Is Ovi open source?")!;
    expect(item.a).toContain("AGPL-3.0");
    expect(item.a).toContain("github.com/goldi0002/ovi");
    expect(indexHtml).toContain(`"name": "${item.q}"`);
    expect(indexHtml).toContain(`"text": "${item.a}"`);
    expect(llms).toContain("https://github.com/goldi0002/ovi");
  });

  it("doesn't name the technology behind the site", () => {
    const stack = /asp\.?net|\.net\b|react|postgres|entity framework|ef core|swagger|openapi|self-hosted/i;
    const copy = [indexHtml.replace(/<script type="module".*?<\/script>/s, ""), llms, ...FAQ_ITEMS.flatMap((i) => [i.q, i.a])].join("\n");
    expect(copy).not.toMatch(stack);
  });
});
