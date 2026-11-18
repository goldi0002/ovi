const KEY = "ovi.apiKey";

// Storage can throw (private mode, blocked site data); treat that as "nothing saved".
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Reads the API key: this tab first (sessionStorage), then "remember me" (localStorage). */
export function loadApiKey(): string | null {
  return safe(() => sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY), null);
}

export function saveApiKey(key: string, remember: boolean): void {
  safe(() => {
    sessionStorage.setItem(KEY, key);
    if (remember) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  }, undefined);
}

export function clearApiKey(): void {
  safe(() => {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  }, undefined);
}

const THEME_KEY = "ovi.theme";

/** The theme picked in the header: follow the system, or always light or dark. */
export type ThemeChoice = "system" | "light" | "dark";

/** The saved theme; "system" when none was picked or storage is unavailable. public/theme.js reads it too. */
export function loadTheme(): ThemeChoice {
  const saved = safe(() => localStorage.getItem(THEME_KEY), null);
  return saved === "light" || saved === "dark" ? saved : "system";
}

/** Saves the theme on this device; "system" forgets the choice. */
export function saveTheme(choice: ThemeChoice): void {
  safe(() => {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  }, undefined);
}
