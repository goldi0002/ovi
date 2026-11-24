// Ovi's service worker. It makes the app installable and lets the shell open without a network.
// It caches only the app's own files: never API answers, sign-in pages or short-link redirects,
// so nothing private is stored and a short link always goes through the server.
// The page list must match WebUiSetup.Pages and PAGES in src/router.tsx (a test checks it).
const CACHE = "ovi-shell-v1";
const SHELL = "/shell";
const PAGES = ["/", "/links", "/links/analytics", "/links/qr-codes", "/admin", "/report", "/privacy", "/terms", "/qr-code-generator", "/self-host"];
const STATIC = ["/theme.js", "/favicon.svg", "/favicon.ico", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const home = await fetch("/", { cache: "reload" });
      if (home.ok) await cache.put(SHELL, home);
      await Promise.allSettled(STATIC.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A page of the app: the network first, so a deploy shows at once; the saved shell when offline.
  if (request.mode === "navigate" && PAGES.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(SHELL, response.clone());
          }
          return response;
        } catch {
          const shell = await caches.match(SHELL);
          if (shell) return shell;
          throw new Error("offline");
        }
      })(),
    );
    return;
  }

  // Built files have a hash in their name, so a saved copy never goes stale.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const saved = await caches.match(request);
        if (saved) return saved;
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  // Icons and the other fixed files: the saved copy now, refreshed in the background.
  if (url.pathname.startsWith("/icons/") || STATIC.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const saved = await cache.match(request);
        const refresh = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => saved);
        return saved ?? refresh;
      })(),
    );
  }
  // Everything else (/api, /auth, short codes) is left to the browser and the server.
});
