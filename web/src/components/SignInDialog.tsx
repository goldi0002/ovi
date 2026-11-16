import { useState, type FormEvent } from "react";
import { ApiError, OviApi } from "../api";
import { LinkIcon } from "./Icons";
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
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="card dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-title"
        onSubmit={submit}
      >
        <span className="icon-bubble">
          <LinkIcon />
        </span>
        <h2 id="sign-in-title">Sign in to Ovi</h2>
        <p className="muted">Enter your API key to create and manage short links.</p>
        <label className="field">
          <span>API key</span>
          <input
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this device
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={checking || !key.trim()}>
            {checking ? "Checking…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
