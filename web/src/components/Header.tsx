import { ChartColumn, Flag, LayoutDashboard, Link2, LogOut, Monitor, Moon, QrCode, Settings, Shield, Sun } from "lucide-react";
import type { Provider } from "../api";
import { AppLink, PAGES } from "../router";
import type { ThemeChoice } from "../storage";
import { useTheme } from "../theme";
import { button, eyebrow, focusRing, iconButton } from "../ui";
import { Avatar } from "./ui/primitives";
import { Menu } from "./ui/Menu";

const THEMES: Record<ThemeChoice, { label: string; icon: typeof Sun; next: ThemeChoice }> = {
  system: { label: "System", icon: Monitor, next: "light" },
  light: { label: "Light", icon: Sun, next: "dark" },
  dark: { label: "Dark", icon: Moon, next: "system" },
};

const NAV = [
  { href: PAGES.home, label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { href: PAGES.links, label: "My Links", short: "Links", icon: Link2 },
  { href: PAGES.analytics, label: "Analytics", short: "Analytics", icon: ChartColumn },
  { href: PAGES.qrCodes, label: "QR Codes", short: "QR", icon: QrCode },
  { href: PAGES.report, label: "Report a link", short: "Report", icon: Flag, desktopOnly: true },
  { href: PAGES.admin, label: "Admin", short: "Admin", icon: Shield, adminOnly: true },
];

export interface Account {
  name: string;
  email: string | null;
  /** How they signed in; null for the admin API key. */
  provider: Provider | null;
}

interface Props {
  /** The current page path, to mark the active nav item. */
  path: string;
  /** False until we know whether someone is signed in, so the buttons don't flicker. */
  ready: boolean;
  /** Shows the Admin item. Only a convenience: the server checks admin rights on every request. */
  isAdmin: boolean;
  /** Who is signed in (the API key counts as "Admin"), or null. */
  account: Account | null;
  onLogIn: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
}

/**
 * The window chrome. Signed in: a translucent sidebar with the pages and the account (on phones, a top bar
 * plus a tab bar along the bottom). Signed out: a slim top bar with the name, the theme and Log in.
 */
export function Header({ path, ready, isAdmin, account, onLogIn, onSignOut, onOpenSettings }: Props) {
  if (!account) {
    return (
      <header className="sticky top-0 z-20 border-b border-line bg-toolbar pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Brand href={PAGES.home} />
          <div className="flex items-center gap-1.5">
            <AppLink
              href={PAGES.report}
              aria-current={path === PAGES.report ? "page" : undefined}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] font-medium text-muted hover:bg-hover hover:text-ink ${focusRing}`}
            >
              <Flag className="size-3.5" aria-hidden="true" />
              Report a link
            </AppLink>
            <ThemeToggle />
            {ready && (
              <button type="button" className={button("primary", "sm")} onClick={onLogIn}>
                Log in
              </button>
            )}
          </div>
        </div>
      </header>
    );
  }

  const items = NAV.filter((item) => !item.adminOnly || isAdmin || path === item.href);

  return (
    // On phones the blur sits on a pseudo-element: a backdrop-filter on the header itself would make it the
    // containing block of the fixed tab bar inside it, pinning the bar to the header instead of the screen.
    <header className="z-20 flex items-center justify-between gap-3 border-line max-lg:sticky max-lg:top-0 max-lg:h-[calc(3.5rem+env(safe-area-inset-top))] max-lg:pt-[env(safe-area-inset-top)] max-lg:border-b max-lg:px-4 max-lg:before:absolute max-lg:before:inset-0 max-lg:before:-z-10 max-lg:before:bg-toolbar max-lg:before:backdrop-blur-xl max-lg:before:backdrop-saturate-150 lg:fixed lg:inset-y-0 lg:left-0 lg:w-60 lg:flex-col lg:items-stretch lg:gap-0 lg:border-r lg:bg-sidebar lg:backdrop-blur-xl lg:backdrop-saturate-150">
      <div className="flex items-center lg:h-16 lg:px-5">
        <Brand href={PAGES.home} />
      </div>

      <nav
        aria-label="Main"
        className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:border-t max-lg:border-line max-lg:bg-toolbar max-lg:pb-[env(safe-area-inset-bottom)] max-lg:backdrop-blur-xl lg:flex-1 lg:overflow-y-auto lg:px-3 lg:py-1"
      >
        <p className={`${eyebrow} px-2.5 pt-2 pb-1.5 max-lg:hidden`} aria-hidden="true">
          Workspace
        </p>
        <ul className="flex lg:grid lg:gap-0.5">
          {items.map(({ href, label, short, icon: Icon, ...rest }) => {
            const active = path === href;
            return (
              <li key={href} className={`max-lg:flex-1 ${"desktopOnly" in rest && rest.desktopOnly ? "max-lg:hidden" : ""}`}>
                <AppLink
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-label={label}
                  className={`group flex items-center gap-2.5 rounded-lg text-[0.8125rem] font-medium transition-colors ${focusRing} max-lg:h-14 max-lg:flex-col max-lg:justify-center max-lg:gap-1 max-lg:text-[0.6875rem] lg:h-8 lg:px-2.5 ${
                    active ? "text-ink lg:bg-pressed" : "text-muted hover:text-ink lg:hover:bg-hover"
                  }`}
                >
                  <Icon
                    className={`size-[18px] shrink-0 lg:size-4 ${active ? "text-accent-text" : "text-muted group-hover:text-ink"}`}
                    strokeWidth={active ? 2.25 : 2}
                    aria-hidden="true"
                  />
                  <span className="max-lg:hidden">{label}</span>
                  <span className="lg:hidden" aria-hidden="true">
                    {short}
                  </span>
                </AppLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 items-center gap-1 lg:border-t lg:border-line lg:p-3">
        <div className="min-w-0 lg:flex-1">
          <Menu
            label="Account"
            placement="up"
            triggerClassName={`flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg p-1 text-left hover:bg-hover ${focusRing} max-lg:hidden lg:px-2 lg:py-1.5`}
            trigger={
              <>
                <Avatar name={account.name} className="size-7 text-[0.6875rem]" />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-[0.8125rem] font-medium" title={account.name}>
                    {account.name}
                  </span>
                  <span className="truncate text-xs text-muted">{account.email ?? (account.provider ? "" : "API key")}</span>
                </span>
              </>
            }
            header={
              <p className="truncate text-xs text-muted" title={account.email ?? undefined}>
                Signed in {account.provider ? `with ${account.provider === "google" ? "Google" : "GitHub"}` : "with the API key"}
              </p>
            }
            items={[
              { label: "Settings", icon: <Settings />, onSelect: onOpenSettings },
              { label: "Sign out", icon: <LogOut />, onSelect: onSignOut, destructive: true },
            ]}
          />
        </div>
        {/* On phones the account sits in the top bar as an avatar that opens Settings, where Sign out is. */}
        <button type="button" className={`${iconButton} lg:hidden`} onClick={onOpenSettings} aria-label="Settings" data-tip="Settings">
          <Avatar name={account.name} className="size-7 text-[0.6875rem]" />
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Cycles the theme System → Light → Dark; the icon shows the current choice. Saved on this device. */
export function ThemeToggle() {
  const [choice, setChoice] = useTheme();
  const { label, icon: Icon, next } = THEMES[choice];
  return (
    <button
      type="button"
      className={iconButton}
      onClick={() => setChoice(next)}
      aria-label={`Theme: ${label}`}
      title={`Theme: ${label}. Switch to ${THEMES[next].label}`}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

/** The Ovi mark: a small rounded tile with a link glyph, and the name. */
export function Brand({ href }: { href?: string }) {
  const className = `inline-flex shrink-0 items-center gap-2 rounded-md text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink ${focusRing}`;
  const content = (
    <>
      <BrandMark />
      <span>Ovi</span>
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

/** Two interlocking rounded links on the accent: Ovi's own mark. */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-[8px] bg-accent text-on-accent shadow-primary ${className}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <rect x="3" y="8.5" width="11" height="7" rx="3.5" />
        <rect x="10" y="8.5" width="11" height="7" rx="3.5" opacity="0.7" />
      </svg>
    </span>
  );
}
