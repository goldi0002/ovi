import { useCallback, useSyncExternalStore } from "react";

/** Registers the service worker (public/sw.js), which makes Ovi installable and lets its shell open offline. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Not installable here (private window, blocked storage): the site works the same without it.
    });
  });
}

/** Whether the browser says it has a network. It can say yes with no real connection, but never no with one. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

// The browser offers installation once, possibly before React has mounted, so catch it at load.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Safari on iPhone and iPad can't be asked to install; the person has to use Share. */
const onIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);

export type InstallMode = "prompt" | "ios" | null;

function mode(): InstallMode {
  if (standalone()) return null;
  if (deferred) return "prompt";
  return onIos() ? "ios" : null;
}

/** How this device can install Ovi: "prompt" (the browser will ask), "ios" (use Share), or null (already installed, or can't). */
export function useInstall() {
  const current = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    mode,
    () => null,
  );
  const prompt = useCallback(async () => {
    const event = deferred;
    if (!event) return;
    deferred = null;
    emit();
    await event.prompt();
    await event.userChoice;
  }, []);
  return { mode: current, prompt };
}
