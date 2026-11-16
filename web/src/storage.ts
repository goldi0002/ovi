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
