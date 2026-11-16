import { useState } from "react";
import type { Theme } from "../theme";
import { LinkIcon, MoonIcon, SunIcon } from "./Icons";

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

  return (
    <header className="topbar">
      <a className="brand" href="#home" onClick={() => setActive("#home")}>
        <LinkIcon className="brand-icon" />
        <span>Ovi</span>
      </a>
      <nav className="nav" aria-label="Main">
        {NAV.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={active === item.href ? "nav-link is-active" : "nav-link"}
            aria-current={active === item.href ? "location" : undefined}
            onClick={() => setActive(item.href)}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        {signedIn ? (
          <button type="button" className="btn" onClick={onSignOut}>
            Sign out
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onGetStarted}>
            Get Started
          </button>
        )}
      </div>
    </header>
  );
}
