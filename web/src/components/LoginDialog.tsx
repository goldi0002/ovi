import { ChevronLeft, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, OviApi, loginUrl, type Provider } from "../api";
import { backdrop, button, errorBox, field, focusRing, iconButton, input, sheet } from "../ui";
import { GitHubIcon, GoogleIcon } from "./ProviderIcons";
import { useModal } from "./useModal";

const PROVIDERS: Record<Provider, { label: string; icon: () => React.JSX.Element }> = {
  google: { label: "Continue with Google", icon: GoogleIcon },
  github: { label: "Continue with GitHub", icon: GitHubIcon },
};

interface Props {
  providers: Provider[];
  /** The page to come back to after signing in. */
  returnTo: string;
  /** The admin entered a working API key. */
  onApiKey: (apiKey: string, remember: boolean) => void;
  onCancel: () => void;
}

/** Log in or sign up with Google or GitHub (the first sign-in creates the account), or, for the admin, an API key. */
export function LoginDialog({ providers, returnTo, onApiKey, onCancel }: Props) {
  const [mode, setMode] = useState<"providers" | "apiKey">("providers");
  useModal(onCancel);

  return (
    <div className={backdrop} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <section className={`${sheet} grid w-full max-w-sm gap-4 p-5`} role="dialog" aria-modal="true" aria-labelledby="login-title">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="login-title" className="text-[0.9375rem] font-semibold">
              {mode === "providers" ? "Log in or sign up" : "Admin sign-in"}
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-muted">
              {mode === "providers"
                ? "New to Ovi? Your account is created the first time you sign in."
                : "Enter the server's API key to manage every link."}
            </p>
          </div>
          <button type="button" className={`${iconButton} -mt-1 -mr-1`} onClick={onCancel} aria-label="Close">
            <X />
          </button>
        </header>

        {mode === "providers" ? (
          <>
            {providers.length > 0 ? (
              <div className="grid gap-2">
                {providers.map((p, i) => {
                  const { label, icon: Icon } = PROVIDERS[p];
                  return (
                    // A real navigation: the provider's page takes over, then sends the browser back here.
                    <a key={p} href={loginUrl(p, returnTo)} className={button("default", "md", "w-full")} autoFocus={i === 0}>
                      <Icon />
                      {label}
                    </a>
                  );
                })}
              </div>
            ) : (
              <p className={errorBox}>Sign-in isn't set up on this server yet.</p>
            )}
            <button
              type="button"
              className={`justify-self-center rounded text-[0.8125rem] text-muted hover:text-ink ${focusRing}`}
              onClick={() => setMode("apiKey")}
              autoFocus={providers.length === 0}
            >
              Admin? Use an API key
            </button>
          </>
        ) : (
          <ApiKeyForm onApiKey={onApiKey} onBack={() => setMode("providers")} />
        )}
      </section>
    </div>
  );
}

/** Checks the key against the API before accepting it. */
function ApiKeyForm({ onApiKey, onBack }: { onApiKey: Props["onApiKey"]; onBack: () => void }) {
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setChecking(true);
    setError(null);
    try {
      await new OviApi(trimmed).list(1, 1);
      onApiKey(trimmed, remember);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That API key was rejected."
          : "Couldn't reach the server. If it was asleep, wait a moment and try again.",
      );
      setChecking(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit} aria-label="Admin sign-in">
      <label className={field}>
        <span>API key</span>
        <input
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
          autoFocus
          className={input}
        />
      </label>
      <label className="flex items-center gap-2 text-[0.8125rem]">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-ink" />
        Remember on this device
      </label>
      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-between gap-2">
        <button type="button" className={button("ghost", "sm")} onClick={onBack}>
          <ChevronLeft />
          Back
        </button>
        <button className={button("primary", "sm")} type="submit" disabled={checking || !key.trim()}>
          {checking ? "Checking…" : "Continue"}
        </button>
      </div>
    </form>
  );
}
