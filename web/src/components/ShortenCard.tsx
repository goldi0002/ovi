import { useState, type FormEvent } from "react";
import { ApiError, type Link, type OviApi } from "../api";
import { localInputToIso } from "../format";
import { LinkIcon, ScissorsIcon } from "./Icons";

interface Props {
  /** Returns a signed-in client, asking for the API key first if needed; null if the user cancels. */
  getApi: () => Promise<OviApi | null>;
  onCreated: (link: Link) => void;
  onUnauthorized: () => void;
}

export function ShortenCard({ getApi, onCreated, onUnauthorized }: Props) {
  const [url, setUrl] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const api = await getApi();
    if (!api) return;
    setSaving(true);
    try {
      const link = await api.create({
        url: url.trim(),
        customCode: (showOptions && customCode.trim()) || undefined,
        expiresAt: showOptions ? localInputToIso(expiresAt) : undefined,
      });
      setUrl("");
      setCustomCode("");
      setExpiresAt("");
      onCreated(link);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        setError("Your API key was rejected. Sign in again.");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't create the link. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="shorten" className="card shorten" aria-labelledby="shorten-title">
      <h2 id="shorten-title" className="shorten-title">
        <LinkIcon className="shorten-title-icon" />
        Shorten a URL
      </h2>
      <form onSubmit={submit} aria-label="Create a short link">
        <div className="shorten-row">
          <label className="url-input">
            <span className="sr-only">Long URL</span>
            <LinkIcon className="url-input-icon" />
            <input
              type="url"
              inputMode="url"
              placeholder="Paste your long URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              maxLength={2048}
            />
          </label>
          <button className="btn btn-primary btn-lg" type="submit" disabled={saving}>
            <ScissorsIcon />
            {saving ? "Shortening…" : "Shorten URL"}
          </button>
        </div>

        <button
          type="button"
          className="text-btn"
          aria-expanded={showOptions}
          aria-controls="shorten-options"
          onClick={() => setShowOptions((v) => !v)}
        >
          {showOptions ? "− Hide options" : "+ Custom code and expiry"}
        </button>

        {showOptions && (
          <div id="shorten-options" className="row">
            <label className="field">
              <span>
                Custom code <em className="muted">(optional)</em>
              </span>
              <input
                type="text"
                placeholder="my-link"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                pattern="[A-Za-z0-9_\-]{3,32}"
                title="3–32 letters, digits, - or _"
                maxLength={32}
              />
            </label>
            <label className="field">
              <span>
                Expires <em className="muted">(optional)</em>
              </span>
              <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </label>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
