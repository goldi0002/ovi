import { ArrowRight, ChevronDown, CircleAlert, ClipboardPaste, Link as LinkIcon, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, type Link, type OviApi } from "../api";
import { isoToLocalInput, localInputToIso } from "../format";
import { button, errorBox, field, focusRing, hint, input } from "../ui";
import { BulkShortenForm } from "./BulkShortenForm";
import { SegmentedControl, Spinner } from "./ui/primitives";

type Mode = "one" | "many";
const MODES: { value: Mode; label: string }[] = [
  { value: "one", label: "One link" },
  { value: "many", label: "Many links" },
];

interface Props {
  api: OviApi;
  signedIn: boolean;
  /** False while the session is still loading; the mode toggle waits for it. */
  ready: boolean;
  /** How long links made without signing in last. */
  anonymousLinkDays: number;
  onLogIn: () => void;
  onCreated: (link: Link) => void;
  /** A bulk batch was created, in input order. */
  onBulkCreated: (links: Link[]) => void;
  onUnauthorized: () => void;
}

/** The link another app shared to Ovi (the manifest's share target sends ?url= and ?text=), if there is one. */
export function sharedUrl(search: string): string {
  const params = new URLSearchParams(search);
  const found = /https?:\/\/[^\s]+/.exec(`${params.get("url") ?? ""} ${params.get("text") ?? ""}`);
  return found ? found[0] : "";
}

/** The latest expiry the server accepts without an account, as a datetime-local value. */
function anonymousMaxExpiry(days: number): string {
  return isoToLocalInput(new Date(Date.now() + days * 86_400_000).toISOString());
}

export function ShortenCard({ api, signedIn, ready, anonymousLinkDays, onLogIn, onCreated, onBulkCreated, onUnauthorized }: Props) {
  const [mode, setMode] = useState<Mode>("one");
  const [bulkBusy, setBulkBusy] = useState(false);
  const onBusyChange = useCallback((busy: boolean) => setBulkBusy(busy), []);
  const [url, setUrl] = useState(() => sharedUrl(window.location.search));
  const [canPaste] = useState(() => typeof navigator.clipboard?.readText === "function");
  const [showOptions, setShowOptions] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  // Arriving at /#shorten (the "New link" buttons) puts the cursor in the box.
  useEffect(() => {
    if (window.location.hash === "#shorten") urlRef.current?.focus();
  }, []);

  async function pasteFromClipboard() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setUrl(text);
      urlRef.current?.focus();
    } catch {
      // The person declined the browser's paste prompt: they can still paste by hand.
    }
  }

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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="How many links"
          options={MODES}
          value={mode}
          onChange={setMode}
          disabled={!ready || bulkBusy}
          className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1"
        />
        {mode === "one" && (
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[0.8125rem] font-medium text-muted transition-colors hover:text-ink ${focusRing}`}
            aria-expanded={showOptions}
            aria-controls="shorten-options"
            onClick={() => setShowOptions((v) => !v)}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            Custom code and expiry
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${showOptions ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        )}
      </div>

      <div hidden={mode !== "many"}>
        <BulkShortenForm
          api={api}
          signedIn={signedIn}
          onLogIn={onLogIn}
          onCreated={onBulkCreated}
          onUnauthorized={onUnauthorized}
          onBusyChange={onBusyChange}
        />
      </div>

      <div hidden={mode !== "one"}>
        <form id="shorten" onSubmit={submit} aria-label="Create a short link" className="grid gap-3">
          <div className="flex gap-2 max-sm:flex-col">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Long URL</span>
              <LinkIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-placeholder" aria-hidden="true" />
              <input
                ref={urlRef}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste a long link"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                maxLength={2048}
                className={`${input} h-11 rounded-[10px] pl-10 text-[0.9375rem] text-ellipsis ${canPaste && !url ? "pr-[5.5rem]" : ""}`}
              />
              {canPaste && !url && (
                <button
                  type="button"
                  className={`absolute top-1/2 right-1.5 inline-flex h-8 -translate-y-1/2 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] font-medium text-accent-text hover:bg-accent-soft ${focusRing}`}
                  onClick={() => void pasteFromClipboard()}
                >
                  <ClipboardPaste className="size-3.5" aria-hidden="true" />
                  Paste
                </button>
              )}
            </label>
            <button className={button("primary", "lg", "min-w-36")} type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Spinner />
                  Shortening…
                </>
              ) : (
                <>
                  Shorten URL
                  <ArrowRight />
                </>
              )}
            </button>
          </div>

          {showOptions && (
            <div id="shorten-options" className="grid animate-pop-in grid-cols-2 gap-3 rounded-xl bg-subtle/70 p-3.5 max-sm:grid-cols-1">
              <label className={field}>
                <span>
                  Custom code <span className="font-normal text-muted">(optional)</span>
                </span>
                <span className={`flex min-w-0 items-center rounded-lg shadow-field ${signedIn ? "bg-field" : "bg-subtle"} focus-within:shadow-[inset_0_0_0_1px_var(--color-accent)] focus-within:ring-[3px] focus-within:ring-accent/25`}>
                  <span className="pl-3 text-sm font-normal text-muted select-none" aria-hidden="true">
                    /
                  </span>
                  <input
                    type="text"
                    placeholder="my-link"
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value)}
                    pattern="[A-Za-z0-9_\-]{3,32}"
                    disabled={!signedIn}
                    aria-describedby={signedIn ? "custom-code-hint" : "custom-code-note"}
                    title="3–32 letters, digits, - or _"
                    maxLength={32}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-9 w-full min-w-0 bg-transparent pr-3 pl-0.5 text-sm font-normal text-ink outline-none placeholder:text-placeholder disabled:cursor-not-allowed disabled:text-muted"
                  />
                </span>
                {signedIn ? (
                  <span id="custom-code-hint" className={hint}>
                    3–32 letters, digits, hyphens or underscores.
                  </span>
                ) : (
                  <span id="custom-code-note" className={hint}>
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
                  aria-describedby="expires-hint"
                  className={`${input} font-normal`}
                />
                <span id="expires-hint" className={hint}>
                  {signedIn ? "Leave empty to keep the link for good." : `At most ${anonymousLinkDays} days without an account.`}
                </span>
              </label>
            </div>
          )}

          {error && (
            <p className={`${errorBox} flex items-start gap-2`} role="alert">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          {!signedIn && (
            <p className="text-[0.8125rem] text-muted">
              Without an account, links expire after {anonymousLinkDays} days.{" "}
              <button type="button" className={`cursor-pointer rounded font-medium text-accent-text hover:underline underline-offset-2 ${focusRing}`} onClick={onLogIn}>
                Log in
              </button>{" "}
              to keep links, pick custom codes and see click stats.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
