import { Link as LinkIcon } from "lucide-react";
import { AppLink } from "../router";
import { button, container, focusRing } from "../ui";

const NAV = [
  { href: "/", label: "Shorten" },
  { href: "/links", label: "Links" },
  { href: "/admin", label: "Admin", adminOnly: true },
];

interface Props {
  /** The current page path, to mark the active nav item. */
  path: string;
  /** False until we know whether someone is signed in, so the button doesn't flicker. */
  ready: boolean;
  /** Shows the Admin item. Only a convenience: the server checks admin rights on every request. */
  isAdmin: boolean;
  /** The signed-in user's name ("Admin" for the API key), or null. */
  accountName: string | null;
  onLogIn: () => void;
  onSignOut: () => void;
}

/** A translucent toolbar, like a macOS window's: the app name, a segmented control for the pages, and sign-in. */
export function Header({ path, ready, isAdmin, accountName, onLogIn, onSignOut }: Props) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-white/75 backdrop-blur-xl backdrop-saturate-150">
      <div className={`${container} grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:gap-1.5`}>
        <Brand href="/" />
        <nav
          className="flex justify-self-center rounded-lg bg-black/[0.06] p-0.5"
          aria-label="Main"
        >
          {NAV.filter((item) => !item.adminOnly || isAdmin || path === item.href).map((item) => {
            const isActive = path === item.href;
            return (
              <AppLink
                key={item.href}
                href={item.href}
                className={`rounded-md px-4 py-1 text-[0.8125rem] font-medium transition-colors max-sm:px-2.5 max-[360px]:px-2 max-[360px]:text-xs ${focusRing} ${
                  isActive ? "bg-white text-ink shadow-control" : "text-muted hover:text-ink"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </AppLink>
            );
          })}
        </nav>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {!ready ? null : accountName ? (
            <>
              <span
                className="min-w-0 truncate text-[0.8125rem] text-muted max-md:hidden"
                title={accountName}
              >
                {accountName}
              </span>
              <button type="button" className={button("default", "sm", "max-[360px]:px-2")} onClick={onSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className={button("primary", "sm", "max-[360px]:px-2")} onClick={onLogIn}>
              Log in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/** The Ovi wordmark: an app-icon style tile and the name. */
export function Brand({ href }: { href?: string }) {
  const className = `inline-flex shrink-0 items-center gap-2 justify-self-start rounded-md text-[0.9375rem] font-semibold text-ink ${focusRing}`;
  const content = (
    <>
      <span className="grid size-7 place-items-center rounded-[7px] bg-linear-to-b from-[#48484a] to-ink text-white shadow-[0_0.5px_1.5px_rgb(0_0_0/30%)]">
        <LinkIcon className="size-4" strokeWidth={2.4} aria-hidden="true" />
      </span>
      <span className="max-[360px]:sr-only">Ovi</span>
    </>
  );
  return href ? (
    <AppLink className={className} href={href} aria-label="Ovi home">
      {content}
    </AppLink>
  ) : (
    <span className={className}>{content}</span>
  );
}
