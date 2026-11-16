import { useState, type FormEvent } from "react";
import { ApiError, OviApi } from "../api";
import { KeyRound } from "lucide-react";
import { backdrop, button, card, errorBox, field, iconBubble, input } from "../ui";
import { useModal } from "./useModal";

interface Props {
  onSignedIn: (apiKey: string, remember: boolean) => void;
  onCancel: () => void;
}

/** Asks for the API key and checks it against the API before continuing. */
export function SignInDialog({ onSignedIn, onCancel }: Props) {
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useModal(onCancel);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setChecking(true);
    setError(null);
    try {
      await new OviApi(trimmed).list(1, 1);
      onSignedIn(trimmed, remember);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That API key was rejected."
          : "Couldn't reach the API. If the server was asleep, wait a moment and try again.",
      );
      setChecking(false);
    }
  }

  return (
    <div className={backdrop} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className={`${card} grid w-full max-w-[420px] gap-4 rounded-3xl p-8 text-center`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-title"
        onSubmit={submit}
      >
        <span className={`${iconBubble} size-16 justify-self-center`}>
          <KeyRound className="size-8" />
        </span>
        <h2 id="sign-in-title" className="text-xl font-bold tracking-tight">
          Sign in to Ovi
        </h2>
        <p className="text-muted">Enter your API key to create and manage short links.</p>
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
        <label className="flex items-center gap-2 text-left text-[0.95rem]">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="size-4 accent-accent"
          />
          Remember on this device
        </label>
        {error && (
          <p className={`${errorBox} text-left`} role="alert">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className={button()} onClick={onCancel}>
            Cancel
          </button>
          <button className={button("primary")} type="submit" disabled={checking || !key.trim()}>
            {checking ? "Checking…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
