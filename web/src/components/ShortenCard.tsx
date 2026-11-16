import { Link as LinkIcon, Minus, Plus, Scissors } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, type Link, type OviApi } from "../api";
import { localInputToIso } from "../format";
import { button, card, errorBox, field, focusRing, input } from "../ui";

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
    <section
      id="shorten"
      className={`${card} w-full max-w-[1100px] justify-self-center rounded-3xl px-10 py-9 max-sm:px-5 max-sm:py-6`}
      aria-labelledby="shorten-title"
    >
      <h2
        id="shorten-title"
        className="mb-6 flex items-center gap-4 text-[clamp(1.5rem,3vw,2rem)] font-bold tracking-tight"
      >
        <LinkIcon className="size-12 shrink-0 text-accent max-sm:size-9" strokeWidth={2.3} />
        Shorten a URL
      </h2>
      <form onSubmit={submit} aria-label="Create a short link" className="grid gap-3.5">
        <div className="flex gap-5 max-sm:flex-col max-sm:gap-3">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Long URL</span>
            <LinkIcon className="pointer-events-none absolute top-1/2 left-5 size-6 -translate-y-1/2 text-muted" />
            <input
              type="url"
              inputMode="url"
              placeholder="Paste your long URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              maxLength={2048}
              className={`${input} min-h-16 rounded-xl pl-[3.6rem] text-xl max-sm:min-h-14 max-sm:text-[1.05rem]`}
            />
          </label>
          <button className={button("primary", "lg")} type="submit" disabled={saving}>
            <Scissors />
            {saving ? "Shortening…" : "Shorten URL"}
          </button>
        </div>

        <button
          type="button"
          className={`inline-flex cursor-pointer items-center gap-1 justify-self-start rounded py-1 text-[0.95rem] font-medium text-accent-ink hover:underline ${focusRing}`}
          aria-expanded={showOptions}
          aria-controls="shorten-options"
          onClick={() => setShowOptions((v) => !v)}
        >
          {showOptions ? <Minus className="size-4" /> : <Plus className="size-4" />}
          {showOptions ? "Hide options" : "Custom code and expiry"}
        </button>

        {showOptions && (
          <div id="shorten-options" className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <label className={field}>
              <span>
                Custom code <em className="font-normal text-muted not-italic">(optional)</em>
              </span>
              <input
                type="text"
                placeholder="my-link"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                pattern="[A-Za-z0-9_\-]{3,32}"
                title="3–32 letters, digits, - or _"
                maxLength={32}
                className={input}
              />
            </label>
            <label className={field}>
              <span>
                Expires <em className="font-normal text-muted not-italic">(optional)</em>
              </span>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
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
      </form>
    </section>
  );
}
