import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import type { ThemeChoice } from "../storage";
import { useTheme } from "../theme";
import { button, eyebrow } from "../ui";
import type { Account } from "./Header";
import { GitHubIcon, GoogleIcon } from "./ProviderIcons";
import { Dialog } from "./ui/Dialog";
import { Avatar, SegmentedControl } from "./ui/primitives";

const THEME_OPTIONS: { value: ThemeChoice; label: ReactNode; ariaLabel: string }[] = [
  { value: "system", label: <><Monitor className="size-3.5" aria-hidden="true" /> System</>, ariaLabel: "System" },
  { value: "light", label: <><Sun className="size-3.5" aria-hidden="true" /> Light</>, ariaLabel: "Light" },
  { value: "dark", label: <><Moon className="size-3.5" aria-hidden="true" /> Dark</>, ariaLabel: "Dark" },
];

/** The account and this device's preferences. Everything here takes effect at once; there is nothing to save. */
export function SettingsDialog({ account, onClose, onSignOut }: { account: Account; onClose: () => void; onSignOut: () => void }) {
  const [theme, setTheme] = useTheme();

  return (
    <Dialog title="Settings" onClose={onClose} autoFocusClose>
      <Section title="Account">
        <div className="flex items-center gap-3 rounded-xl bg-subtle/70 p-3.5">
          <Avatar name={account.name} className="size-10 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{account.name}</p>
            <p className="truncate text-[0.8125rem] text-muted">{account.email ?? (account.provider ? "No email shared" : "Server API key")}</p>
          </div>
          {account.provider && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
              {account.provider === "google" ? <GoogleIcon /> : <GitHubIcon />}
              <span className="max-sm:sr-only">{account.provider === "google" ? "Google" : "GitHub"}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted">
          {account.provider
            ? `Your name and email come from ${account.provider === "google" ? "Google" : "GitHub"}. Change them there and they update the next time you sign in.`
            : "You're signed in as the administrator with the server's API key."}
        </p>
      </Section>

      <Section title="Appearance">
        <SegmentedControl label="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} full className="[&>button]:inline-flex [&>button]:items-center [&>button]:justify-center [&>button]:gap-1.5" />
        <p className="text-xs text-muted">System follows your device's light or dark setting. Saved on this device.</p>
      </Section>

      <div className="flex justify-end border-t border-line pt-4">
        <button
          type="button"
          className={button("danger", "md", "max-sm:w-full")}
          onClick={() => {
            onClose();
            onSignOut();
          }}
        >
          <LogOut />
          Sign out
        </button>
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5" aria-label={title}>
      <h3 className={eyebrow}>{title}</h3>
      {children}
    </section>
  );
}
