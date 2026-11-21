import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { ThemeToggle } from "./components/Header";
import { fakeApi } from "./test/fakeApi";

const root = document.documentElement;

/** A stand-in for matchMedia("(prefers-color-scheme: dark)") whose answer the test can flip. */
function systemScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  window.matchMedia = vi.fn().mockReturnValue(query) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      dark = next;
      act(() => listeners.forEach((fn) => fn()));
    },
  };
}

/** The theme-color metas index.html has, one per scheme. */
function addThemeColorMetas() {
  for (const [media, content] of [
    ["(prefers-color-scheme: light)", "#f5f5f7"],
    ["(prefers-color-scheme: dark)", "#141416"],
  ]) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.media = media;
    meta.content = content;
    document.head.append(meta);
  }
}
const themeColors = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);

const toggle = () => screen.getByRole("button", { name: /^Theme: / });

describe("Theme toggle", () => {
  const realMatchMedia = window.matchMedia;
  beforeEach(addThemeColorMetas);
  afterEach(() => {
    window.matchMedia = realMatchMedia;
    delete root.dataset.theme;
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  });

  it("sits in the header", async () => {
    fakeApi();
    render(<App />);
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Theme: System" })).toBeInTheDocument();
  });

  it("follows the system by default, including when it changes", () => {
    const system = systemScheme(true);
    render(<ThemeToggle />);

    expect(toggle()).toHaveAccessibleName("Theme: System");
    expect(root.dataset.theme).toBe("dark");
    expect(themeColors()).toEqual(["#f5f5f7", "#141416"]);

    system.set(false);
    expect(root.dataset.theme).toBe("light");
  });

  it("cycles System, Light, Dark and back, saving the choice", async () => {
    systemScheme(true);
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(toggle());
    expect(toggle()).toHaveAccessibleName("Theme: Light");
    expect(root.dataset.theme).toBe("light");
    expect(localStorage.getItem("ovi.theme")).toBe("light");
    expect(themeColors()).toEqual(["#f5f5f7", "#f5f5f7"]);

    await user.click(toggle());
    expect(toggle()).toHaveAccessibleName("Theme: Dark");
    expect(root.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ovi.theme")).toBe("dark");
    expect(themeColors()).toEqual(["#141416", "#141416"]);

    await user.click(toggle());
    expect(toggle()).toHaveAccessibleName("Theme: System");
    expect(root.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ovi.theme")).toBeNull();
    expect(themeColors()).toEqual(["#f5f5f7", "#141416"]);
  });

  it("restores the saved choice and ignores the system while one is picked", () => {
    localStorage.setItem("ovi.theme", "light");
    const system = systemScheme(true);
    render(<ThemeToggle />);

    expect(toggle()).toHaveAccessibleName("Theme: Light");
    expect(root.dataset.theme).toBe("light");
    system.set(false);
    system.set(true);
    expect(root.dataset.theme).toBe("light");
  });

  it("ignores an unknown saved value", () => {
    localStorage.setItem("ovi.theme", "sepia");
    systemScheme(false);
    render(<ThemeToggle />);
    expect(toggle()).toHaveAccessibleName("Theme: System");
    expect(root.dataset.theme).toBe("light");
  });

  it("still switches when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    systemScheme(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);

    expect(toggle()).toHaveAccessibleName("Theme: System");
    await user.click(toggle());
    await user.click(toggle());
    expect(toggle()).toHaveAccessibleName("Theme: Dark");
    expect(root.dataset.theme).toBe("dark");
  });
});
