import { Link as LinkIcon, Minus, Plus, Scissors } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, type Link, type OviApi } from "../api";
import { localInputToIso } from "../format";
import { button, card, errorBox, field, focusRing, iconBubble, input } from "../ui";

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
      className={`${card} w-full scroll-mt-24 justify-self-center rounded-3xl p-5 sm:p-7 lg:p-9`}
      aria-labelledby="shorten-title"
    >
      <h2
        id="shorten-title"
        className="mb-5 flex items-center gap-3 text-[clamp(1.3rem,3.4vw,1.75rem)] font-bold tracking-[-0.02em]"
      >
        <span className={`${iconBubble} size-10 sm:size-11`}>
          <LinkIcon className="size-5" strokeWidth={2.4} />
        </span>
        Shorten a URL
      </h2>
      <form onSubmit={submit} aria-label="Create a short link" className="grid gap-3.5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Long URL</span>
            <LinkIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" />
            <input
              type="url"
              inputMode="url"
              placeholder="Paste your long URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              maxLength={2048}
              className={`${input} min-h-14 pl-12 text-base sm:text-[1.05rem]`}
            />
          </label>
          <button className={button("primary", "lg", "w-full sm:w-auto")} type="submit" disabled={saving}>
            <Scissors />
            {saving ? "Shortening…" : "Shorten URL"}
          </button>
        </div>

        <button
          type="button"
          className={`inline-flex cursor-pointer items-center gap-1 justify-self-start rounded py-1 text-[0.9rem] font-medium text-accent-ink hover:underline ${focusRing}`}
          aria-expanded={showOptions}
          aria-controls="shorten-options"
          onClick={() => setShowOptions((v) => !v)}
        >
          {showOptions ? <Minus className="size-4" /> : <Plus className="size-4" />}
          {showOptions ? "Hide options" : "Custom code and expiry"}
        </button>

        {showOptions && (
          <div id="shorten-options" className="grid gap-4 sm:grid-cols-2">
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
