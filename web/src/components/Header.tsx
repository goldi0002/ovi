import { Link as LinkIcon, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppLink } from "../router";
import type { Theme } from "../theme";
import { button, focusRing, iconButton } from "../ui";

const NAV = [
  { href: "/#home", label: "Home" },
  { href: "/#features", label: "Features" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#about", label: "About" },
  { href: "/links", label: "Links" },
];

const DESKTOP_QUERY = "(min-width: 64rem)";

interface Props {
  /** The current page path, to highlight the Links item. */
  path: string;
  theme: Theme;
  onToggleTheme: () => void;
  signedIn: boolean;
  onGetStarted: () => void;
  onSignOut: () => void;
}

export function Header({ path, theme, onToggleTheme, signedIn, onGetStarted, onSignOut }: Props) {
  // Which home-page section was picked last; on another page, that page's item is active.
  const [section, setSection] = useState("/#home");
  const [menuOpen, setMenuOpen] = useState(false);
  const active = path === "/" ? section : path;
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // A page change (including one from the mobile menu) closes the menu.
  useEffect(() => setMenuOpen(false), [path]);

  // The mobile menu closes on Escape, on a click outside the header, and as soon as the layout is desktop-wide.
  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const onPointerDown = (e: Event) => {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onLayoutChange = () => {
      if (desktop.matches) setMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    desktop.addEventListener("change", onLayoutChange);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      desktop.removeEventListener("change", onLayoutChange);
    };
  }, [menuOpen]);

  return (
    <header ref={headerRef} className="sticky top-0 z-20 border-b border-line/80 bg-page/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Brand href="/#home" onClick={() => setSection("/#home")} />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((item) => {
            const isActive = active === item.href;
            return (
              <AppLink
                key={item.href}
                href={item.href}
                className={`rounded-full px-4 py-2 text-[0.95rem] transition-colors ${focusRing} ${
                  isActive
                    ? "bg-accent-soft font-semibold text-accent-ink"
                    : "font-medium text-ink hover:bg-accent-soft/70"
                }`}
                aria-current={isActive ? (item.href === "/links" ? "page" : "location") : undefined}
                onClick={() => setSection(item.href)}
              >
                {item.label}
              </AppLink>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={iconButton}
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
          {signedIn ? (
            <button type="button" className={button("default", "md")} onClick={onSignOut}>
              Sign out
            </button>
          ) : (
            <button type="button" className={button("primary", "md")} onClick={onGetStarted}>
              Get Started
            </button>
          )}
          <button
            ref={menuButtonRef}
            type="button"
            className={`${iconButton} lg:hidden`}
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="border-t border-line bg-page px-4 pt-2 pb-4 sm:px-6 lg:hidden"
        >
          <ul className="grid gap-1">
            {NAV.map((item) => {
              const isActive = active === item.href;
              return (
                <li key={item.href}>
                  <AppLink
                    href={item.href}
                    className={`block rounded-xl px-4 py-3 text-base ${focusRing} ${
                      isActive
                        ? "bg-accent-soft font-semibold text-accent-ink"
                        : "font-medium text-ink hover:bg-accent-soft/70"
                    }`}
                    aria-current={isActive ? (item.href === "/links" ? "page" : "location") : undefined}
                    onClick={() => {
                      setSection(item.href);
                      setMenuOpen(false);
                    }}
                  >
                    {item.label}
                  </AppLink>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}

/** The Ovi wordmark: a chain-link icon and the name. */
export function Brand({ href, onClick, small = false }: { href?: string; onClick?: () => void; small?: boolean }) {
  const className = `inline-flex items-center gap-2 font-extrabold tracking-[-0.03em] text-ink ${
    small ? "text-[1.05rem]" : `text-[1.5rem] sm:text-[1.7rem] ${focusRing} rounded-lg`
  }`;
  const content = (
    <>
      <LinkIcon className="size-[1.15em] text-accent" strokeWidth={2.4} />
      <span>Ovi</span>
    </>
  );
  return href ? (
    <AppLink className={className} href={href} onClick={onClick}>
      {content}
    </AppLink>
  ) : (
    <span className={className}>{content}</span>
  );
}
