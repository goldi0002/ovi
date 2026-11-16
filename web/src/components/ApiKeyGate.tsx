import { useState, type FormEvent } from "react";
import { ApiError, OviApi } from "../api";

interface Props {
  onSignedIn: (apiKey: string, remember: boolean) => void;
}

/** Asks for the API key and checks it against the API before continuing. */
export function ApiKeyGate({ onSignedIn }: Props) {
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
      onSignedIn(trimmed, remember);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That API key was rejected."
          : "Couldn't reach the API. If the server was asleep, wait a moment and try again.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="gate">
      <form className="card gate-card" onSubmit={submit}>
        <div className="brand brand-large">
          <img src="/favicon.svg" alt="" width={40} height={40} />
          <span>Ovi</span>
        </div>
        <p className="muted">Enter your API key to manage short links.</p>
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
        <button className="btn btn-primary" type="submit" disabled={checking || !key.trim()}>
          {checking ? "Checking…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
