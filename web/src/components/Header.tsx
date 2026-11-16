import { Link as LinkIcon, Moon, Sun } from "lucide-react";
import { useState } from "react";
import type { Theme } from "../theme";
import { button, focusRing, iconButton } from "../ui";

const NAV = [
  { href: "#home", label: "Home" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#about", label: "About" },
];

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  signedIn: boolean;
  onGetStarted: () => void;
  onSignOut: () => void;
}

export function Header({ theme, onToggleTheme, signedIn, onGetStarted, onSignOut }: Props) {
  const [active, setActive] = useState("#home");
  const headerButton = "max-sm:px-4 max-sm:py-2.5 max-sm:text-[0.95rem]";

  return (
    <header className="mx-auto grid max-w-[1200px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-[1.1rem] max-lg:grid-cols-[auto_1fr] max-sm:py-3">
      <Brand href="#home" onClick={() => setActive("#home")} />
      <nav className="flex gap-2 max-lg:hidden" aria-label="Main">
        {NAV.map((item) => {
          const isActive = active === item.href;
          return (
            <a
              key={item.href}
              href={item.href}
              className={`rounded-full px-6 py-2.5 text-[1.05rem] ${focusRing} ${
                isActive ? "bg-accent-soft font-semibold text-accent-ink" : "font-medium text-ink hover:bg-accent-soft"
              }`}
              aria-current={isActive ? "location" : undefined}
              onClick={() => setActive(item.href)}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="flex items-center justify-end gap-5 max-sm:gap-2.5">
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
    <a className={className} href={href} onClick={onClick}>
      {content}
    </a>
  ) : (
    <span className={className}>{content}</span>
  );
}
