import { useCallback, useEffect, useSyncExternalStore } from "react";
import { loadTheme, saveTheme, type ThemeChoice } from "./storage";

// public/theme.js does the same before first paint; keep the two in step.
const DARK_QUERY = "(prefers-color-scheme: dark)";
/** The browser chrome's colour (meta theme-color): each scheme's page background in styles.css. */
export const THEME_COLORS = { light: "#f5f5f7", dark: "#141416" } as const;

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return systemPrefersDark() ? "dark" : "light";
}

/** Sets data-theme on <html> (styles.css sets color-scheme from it) and the browser chrome colour. */
export function applyTheme(choice: ThemeChoice): void {
  const theme = resolveTheme(choice);
  document.documentElement.dataset.theme = theme;
  // One theme-color meta per scheme, each with a media query; a picked theme sets both to its colour.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = choice === "system" ? (meta.media.includes("dark") ? "dark" : "light") : theme;
    meta.content = THEME_COLORS[scheme];
  }
}

// One choice shared by every control that shows it (the toolbar toggle, Settings). It is kept in
// memory as well as in storage, so switching still works when storage is blocked.
let current: ThemeChoice | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab picked a theme: follow it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === "ovi.theme") {
      current = loadTheme();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
    // With nobody showing it, read storage afresh next time.
    if (listeners.size === 0) current = null;
  };
}

function getSnapshot(): ThemeChoice {
  current ??= loadTheme();
  return current;
}

/** The theme choice, applied to the page and saved when changed. "system" follows the OS as it changes. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, getSnapshot, () => "system" as const);

  useEffect(() => {
    applyTheme(choice);
    if (choice !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  const update = useCallback((next: ThemeChoice) => {
    saveTheme(next);
    current = next;
    emit();
  }, []);

  return [choice, update];
}
