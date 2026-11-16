import { useState, type FormEvent } from "react";
import { ApiError, type Link, type OviApi } from "../api";
import { localInputToIso } from "../format";

interface Props {
  api: OviApi;
  onCreated: (link: Link) => void;
}

export function CreateLinkForm({ api, onCreated }: Props) {
  const [url, setUrl] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const link = await api.create({
        url: url.trim(),
        customCode: customCode.trim() || undefined,
        expiresAt: localInputToIso(expiresAt),
      });
      setUrl("");
      setCustomCode("");
      setExpiresAt("");
      onCreated(link);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the link. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card create" onSubmit={submit} aria-label="Create a short link">
      <h2>Shorten a link</h2>
      <label className="field">
        <span>Long URL</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://example.com/a/very/long/path"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          maxLength={2048}
        />
      </label>
      <div className="row">
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? "Shortening…" : "Shorten"}
      </button>
    </form>
  );
}
