import { ChevronLeft, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, OviApi, loginUrl, type Provider } from "../api";
import { button, errorBox, field, focusRing, input } from "../ui";
import { BrandMark } from "./Header";
import { LegalLinks } from "../pages/LegalPage";
import { GitHubIcon, GoogleIcon } from "./ProviderIcons";
import { Dialog } from "./ui/Dialog";
import { Spinner } from "./ui/primitives";

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

/** Sign in or sign up with Google or GitHub (the first sign-in creates the account), or, for the admin, an API key. */
export function LoginDialog({ providers, returnTo, onApiKey, onCancel }: Props) {
  const [mode, setMode] = useState<"providers" | "apiKey">("providers");

  return (
    <Dialog
      size="sm"
      onClose={onCancel}
      icon={<BrandMark className="mb-4 size-10 rounded-[11px]" />}
      title={mode === "providers" ? "Sign in or sign up" : "Admin sign-in"}
      description={
        mode === "providers"
          ? "Keep your links, choose custom codes and see click stats. New to Ovi? Your account is created the first time you sign in."
          : "Enter the server's API key to manage every link."
      }
    >
      {mode === "providers" ? (
        <>
          {providers.length > 0 ? (
            <div className="grid gap-2">
              {providers.map((p, i) => {
                const { label, icon: Icon } = PROVIDERS[p];
                return (
                  // A real navigation: the provider's page takes over, then sends the browser back here.
                  <a key={p} href={loginUrl(p, returnTo)} className={button("default", "lg", "w-full")} autoFocus={i === 0}>
                    <Icon />
                    {label}
                  </a>
                );
              })}
            </div>
          ) : (
            <p className={errorBox}>Sign-in isn't set up on this server yet.</p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center justify-center gap-1.5 justify-self-center rounded-md px-2 py-1 text-[0.8125rem] font-medium text-muted hover:text-ink ${focusRing}`}
            onClick={() => setMode("apiKey")}
            autoFocus={providers.length === 0}
          >
            <KeyRound className="size-3.5" aria-hidden="true" />
            Admin? Use an API key
          </button>
          <div className="grid justify-items-center gap-1 text-center text-xs text-muted">
            <p>By continuing you agree to our terms and privacy policy.</p>
            <LegalLinks newTab />
          </div>
        </>
      ) : (
        <ApiKeyForm onApiKey={onApiKey} onBack={() => setMode("providers")} />
      )}
    </Dialog>
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
          className={`${input} font-normal`}
        />
      </label>
      <label className="flex items-center gap-2 text-[0.8125rem]">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4" />
        Remember on this device
      </label>
      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-between gap-2">
        <button type="button" className={button("ghost", "md", "-ml-2")} onClick={onBack}>
          <ChevronLeft />
          Back
        </button>
        <button className={button("primary", "md")} type="submit" disabled={checking || !key.trim()}>
          {checking && <Spinner />}
          {checking ? "Checking…" : "Continue"}
        </button>
      </div>
    </form>
  );
}
