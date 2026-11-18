import { ChevronDown } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, type Link, type OviApi } from "../api";
import { isoToLocalInput, localInputToIso } from "../format";
import { button, errorBox, field, focusRing, input } from "../ui";

interface Props {
  api: OviApi;
  signedIn: boolean;
  /** How long links made without signing in last. */
  anonymousLinkDays: number;
  onLogIn: () => void;
  onCreated: (link: Link) => void;
  onUnauthorized: () => void;
}

/** The latest expiry the server accepts without an account, as a datetime-local value. */
function anonymousMaxExpiry(days: number): string {
  return isoToLocalInput(new Date(Date.now() + days * 86_400_000).toISOString());
}

export function ShortenCard({ api, signedIn, anonymousLinkDays, onLogIn, onCreated, onUnauthorized }: Props) {
  const [url, setUrl] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const link = await api.create({
        url: url.trim(),
        customCode: (showOptions && signedIn && customCode.trim()) || undefined,
        expiresAt: showOptions ? localInputToIso(expiresAt) : undefined,
      });
      setUrl("");
      setCustomCode("");
      setExpiresAt("");
      onCreated(link);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        setError("You were signed out. Log in again, or shorten without an account.");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't create the link. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="shorten" onSubmit={submit} aria-label="Create a short link" className="grid gap-3">
      <div className="flex gap-2 max-sm:flex-col">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Long URL</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com/a/very/long/link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            maxLength={2048}
            className={`${input} text-ellipsis`}
          />
        </label>
        <button className={button("primary", "md", "px-5")} type="submit" disabled={saving}>
          {saving ? "Shortening…" : "Shorten URL"}
        </button>
      </div>

      <button
        type="button"
        className={`inline-flex cursor-pointer items-center gap-1 justify-self-start rounded py-0.5 text-[0.8125rem] text-muted hover:text-ink ${focusRing}`}
        aria-expanded={showOptions}
        aria-controls="shorten-options"
        onClick={() => setShowOptions((v) => !v)}
      >
        Custom code and expiry
        <ChevronDown className={`size-4 transition-transform ${showOptions ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {showOptions && (
        <div id="shorten-options" className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <label className={field}>
            <span>
              Custom code <span className="font-normal text-muted">(optional)</span>
            </span>
            <input
              type="text"
              placeholder="my-link"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              pattern="[A-Za-z0-9_\-]{3,32}"
              disabled={!signedIn}
              aria-describedby={signedIn ? undefined : "custom-code-note"}
              title="3–32 letters, digits, - or _"
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              className={`${input} disabled:cursor-not-allowed disabled:bg-subtle`}
            />
            {!signedIn && (
              <span id="custom-code-note" className="text-xs font-normal text-muted">
                Log in to choose your own code.
              </span>
            )}
          </label>
          <label className={field}>
            <span>
              Expires <span className="font-normal text-muted">(optional)</span>
            </span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              max={signedIn ? undefined : anonymousMaxExpiry(anonymousLinkDays)}
              className={input}
            />
          </label>
        </div>
      )}

      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}

      {!signedIn && (
        <p className="border-t border-line pt-3 text-[0.8125rem] text-muted">
          Without an account, links expire after {anonymousLinkDays} days.{" "}
          <button type="button" className={`rounded font-medium text-ink underline underline-offset-2 ${focusRing}`} onClick={onLogIn}>
            Log in
          </button>{" "}
          to keep links, pick custom codes and see click stats.
        </p>
      )}
    </form>
  );
}
