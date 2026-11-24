import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

// A minimal client-side router. The server returns index.html for each page path (WebUiSetup.Pages),
// so deep links and reloads work. Keep this list and that one in step.
export const PAGES = {
  home: "/",
  links: "/links",
  analytics: "/links/analytics",
  qrCodes: "/links/qr-codes",
  admin: "/admin",
  report: "/report",
  privacy: "/privacy",
  terms: "/terms",
  qrCodeGenerator: "/qr-code-generator",
  selfHost: "/self-host",
} as const;

const NAVIGATE = "ovi:navigate";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATE, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATE, onChange);
  };
}

/** The current URL path, e.g. "/links". Re-renders when it changes. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** The current query string, e.g. "?code=docs". Re-renders when it changes. */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search);
}

/** Goes to an in-app URL ("/links", "/#pricing") without reloading the page. */
export function navigate(to: string, { replace = false } = {}) {
  const url = new URL(to, window.location.href);
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(NAVIGATE));
}

/** After an in-app page change, jump to the URL's #anchor (once the new page has rendered) or to the top. */
export function scrollAfterNavigation() {
  const id = window.location.hash.slice(1);
  const target = id ? document.getElementById(id) : null;
  if (target) target.scrollIntoView();
  else window.scrollTo(0, 0);
}

/** An <a> that navigates in-app on a plain click and behaves normally otherwise (new tab, copy link). */
export function AppLink({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(href, window.location.href);
    // A same-page anchor (#features on the home page) can use the browser's own scrolling.
    if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
    e.preventDefault();
    navigate(href);
  }
  return <a href={href} onClick={handleClick} {...rest} />;
}
