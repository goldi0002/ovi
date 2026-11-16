import { Link as LinkIcon, List, Moon, Sun } from "lucide-react";
import { useState } from "react";
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
  const active = path === "/" ? section : path;
  const headerButton = "max-sm:px-4 max-sm:py-2.5 max-sm:text-[0.95rem]";

  return (
    <header className="mx-auto grid max-w-[1200px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-[1.1rem] max-lg:grid-cols-[auto_1fr] max-sm:py-3">
      <Brand href="/#home" onClick={() => setSection("/#home")} />
      <nav className="flex gap-1 max-lg:hidden" aria-label="Main">
        {NAV.map((item) => {
          const isActive = active === item.href;
          return (
            <AppLink
              key={item.href}
              href={item.href}
              className={`rounded-full px-5 py-2.5 text-[1.05rem] ${focusRing} ${
                isActive ? "bg-accent-soft font-semibold text-accent-ink" : "font-medium text-ink hover:bg-accent-soft"
              }`}
              aria-current={isActive ? (item.href === "/links" ? "page" : "location") : undefined}
              onClick={() => setSection(item.href)}
            >
              {item.label}
            </AppLink>
          );
        })}
      </nav>
      <div className="flex items-center justify-end gap-5 max-sm:gap-2.5">
        {/* The nav is hidden on small screens, so the Links page gets its own button there. */}
        <AppLink
          href="/links"
          className={`${iconButton} lg:hidden ${path === "/links" ? "border-accent text-accent-ink" : ""}`}
          aria-label="Your links"
          aria-current={path === "/links" ? "page" : undefined}
        >
          <List className="size-6 max-sm:size-5" />
        </AppLink>
        <button
          type="button"
          className={iconButton}
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="size-6 max-sm:size-5" /> : <Moon className="size-6 max-sm:size-5" />}
        </button>
        {signedIn ? (
          <button type="button" className={button("default", "md", headerButton)} onClick={onSignOut}>
            Sign out
          </button>
        ) : (
          <button type="button" className={button("primary", "md", headerButton)} onClick={onGetStarted}>
            Get Started
          </button>
        )}
      </div>
    </header>
  );
}

/** The Ovi wordmark: a chain-link icon and the name. */
export function Brand({ href, onClick, small = false }: { href?: string; onClick?: () => void; small?: boolean }) {
  const className = `inline-flex items-center gap-2.5 font-extrabold tracking-[-0.03em] text-ink ${
    small ? "text-[1.15rem]" : `text-[1.85rem] max-sm:text-2xl ${focusRing} rounded-lg`
  }`;
  const content = (
    <>
      <LinkIcon className="size-[1.2em] text-accent" strokeWidth={2.4} />
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
