import { ChevronDown, CircleAlert, FileUp, Layers } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, type Link, type OviApi } from "../api";
import { MAX_BULK_URLS, bulkErrors, lineRange, parseBulkInput } from "../bulk";
import { localInputToIso } from "../format";
import { button, errorBox, field, fieldError, focusRing, hint, input } from "../ui";
import { EmptyState, Spinner } from "./ui/primitives";

/** The id of the textarea, so the results' Dismiss can return focus here. */
export const BULK_TEXTAREA_ID = "bulk-urls";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

interface Props {
  api: OviApi;
  signedIn: boolean;
  onLogIn: () => void;
  /** A batch was created; the links are in input order. */
  onCreated: (links: Link[]) => void;
  onUnauthorized: () => void;
  /** True while a batch is being sent, so the mode toggle can be disabled. */
  onBusyChange: (busy: boolean) => void;
}

interface LineError {
  line: number;
  url: string;
  message: string;
}

/** Shows at most about 60 characters of a URL, with an ellipsis. */
function shorten(url: string): string {
  return url.length > 60 ? `${url.slice(0, 59)}…` : url;
}

/** Many URLs, one per line, shortened in one all-or-nothing request (signed-in users only). */
export function BulkShortenForm({ api, signedIn, onLogIn, onCreated, onUnauthorized, onBusyChange }: Props) {
  const [text, setText] = useState("");
  const [showExpiry, setShowExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [lineErrors, setLineErrors] = useState<LineError[]>([]);
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // After a 401 the text stays on screen (so it can be copied) even though the user is now signed out.
  const [signedOutWithDraft, setSignedOutWithDraft] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const logInRef = useRef<HTMLButtonElement>(null);
  // Set synchronously, so a second press before React re-renders can't send the batch twice.
  const inFlight = useRef(false);
  const expiryRef = useRef<HTMLInputElement>(null);
  // Set when a 400 had an expiry error, so focus moves to that field once it has rendered.
  const [focusExpiry, setFocusExpiry] = useState(0);

  const parsed = parseBulkInput(text);
  const lines = parsed.rows;
  const count = lines.length;
  const over = count - MAX_BULK_URLS;

  useEffect(() => onBusyChange(saving), [saving, onBusyChange]);

  // A fresh set of line errors (every 400) moves focus to the summary, which reads its heading.
  useEffect(() => {
    if (lineErrors.length > 0) summaryRef.current?.focus();
  }, [lineErrors]);

  useEffect(() => {
    if (signedIn) setSignedOutWithDraft(false);
  }, [signedIn]);

  // After a 401 the submit button is replaced by Sign in; move focus there so it isn't lost to <body>.
  useEffect(() => {
    if (signedOutWithDraft && !signedIn) logInRef.current?.focus();
  }, [signedOutWithDraft, signedIn]);

  // Focusing the expiry field reads its inline error (aria-describedby); a line error summary takes precedence.
  useEffect(() => {
    if (focusExpiry > 0) expiryRef.current?.focus();
  }, [focusExpiry]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (inFlight.current || !signedIn || count === 0 || over > 0) return;
    inFlight.current = true;
    const sent = lines;
    setSaving(true);
    setError(null);
    setExpiryError(null);
    setLineErrors([]);
    if (parsed.problems.length > 0) {
      setLineErrors(parsed.problems);
      inFlight.current = false;
      setSaving(false);
      return;
    }
    try {
      const batchExpiry = showExpiry ? localInputToIso(expiresAt) : undefined;
      const links = await api.createMany(
        parsed.csv
          ? {
              items: sent.map((l) => ({ url: l.url, customCode: l.code, expiresAt: l.expiresAt })),
              expiresAt: batchExpiry,
            }
          : { urls: sent.map((l) => l.url), expiresAt: batchExpiry },
      );
      setText("");
      setExpiresAt("");
      onCreated(links);
    } catch (err) {
      // Nothing was created in any of these, so the text stays and a retry is safe.
      if (err instanceof ApiError && err.status === 503 && err.fromServer) {
        // No free short codes could be found (AC 41): the server's own message says to try again.
        setError(err.message);
      } else if (!(err instanceof ApiError) || err.status >= 500 || err.status === 413) {
        setError("Couldn't shorten the links. Try again.");
      } else if (err.status === 401) {
        setSignedOutWithDraft(true);
        setError("You were signed out. Copy your list first, then sign in again to shorten many links.");
        onUnauthorized();
      } else if (err.status === 429) {
        setError("You've made a lot of links in the last minute. Try again in a minute.");
      } else {
        const items = bulkErrors(err.fieldErrors);
        const expiry = err.fieldErrors.expiresAt?.[0];
        const batch = err.fieldErrors.urls?.[0] ?? err.fieldErrors.items?.[0];
        if (expiry) {
          setShowExpiry(true);
          setExpiryError(expiry);
          if (items.length === 0) setFocusExpiry((n) => n + 1);
        }
        if (items.length > 0) {
          setLineErrors(
            items.map(({ index, message }) => ({
              line: sent[index]?.line ?? index + 1,
              url: sent[index]?.url ?? "",
              message,
            })),
          );
        }
        if (batch) setError(batch);
        else if (items.length === 0 && !expiry) setError(err.message);
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  /** Focuses the textarea with line `line` selected and scrolled into view. */
  function goToLine(line: number) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { start, end } = lineRange(ta.value, line);
    ta.focus();
    ta.setSelectionRange(start, end);
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (line - 1) * lineHeight - ta.clientHeight / 2);
    ta.scrollLeft = 0;
  }

  /** Puts a chosen CSV (or text) file into the box; the box is the one place the list is read from. */
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 60 * 1024) {
      setError("That file is too big. Keep it under 60 KB (25 links at most).");
      return;
    }
    setError(null);
    setLineErrors([]);
    setText(await file.text());
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  }

  if (!signedIn && !signedOutWithDraft) {
    return (
      <div className="rounded-xl bg-subtle/70">
        <EmptyState
          plain
          icon={<Layers />}
          title="Shorten up to 25 links at once"
          description="Shortening many links at once needs an account. It's free with Google or GitHub."
          action={
            <button type="button" className={button("primary", "md")} onClick={onLogIn}>
              Sign in
            </button>
          }
        />
      </div>
    );
  }

  const describedBy = ["bulk-count", lineErrors.length > 0 ? "bulk-errors" : ""].filter(Boolean).join(" ");
  const submitLabel = saving
    ? `Shortening ${count} ${plural(count, "URL", "URLs")}…`
    : count === 0 || over > 0
      ? "Shorten URLs"
      : `Shorten ${count} ${plural(count, "URL", "URLs")}`;
  const overMessage = `${count} of ${MAX_BULK_URLS}. Remove ${over} to continue.`;
  const summaryTitle = `${lineErrors.length} ${plural(lineErrors.length, "line needs", "lines need")} fixing. Nothing was shortened.`;

  return (
    <form onSubmit={submit} aria-label="Shorten many links" className="grid gap-3" noValidate>
      <div className={field}>
        <label htmlFor={BULK_TEXTAREA_ID}>
          Long URLs <span className="font-normal text-muted">(one per line)</span>
        </label>
        <textarea
          id={BULK_TEXTAREA_ID}
          ref={textareaRef}
          rows={6}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          inputMode="url"
          placeholder={"https://example.com/first-page\nhttps://example.com/second-page"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          readOnly={saving}
          aria-describedby={describedBy}
          aria-invalid={lineErrors.length > 0 ? true : undefined}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          className={`${input} h-auto min-h-40 resize-y rounded-[10px] py-2.5 font-mono text-[0.8125rem] leading-relaxed`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[0.8125rem] font-medium text-muted hover:text-ink ${focusRing}`}
          aria-expanded={showExpiry}
          aria-controls="bulk-expiry"
          onClick={() => setShowExpiry((v) => !v)}
        >
          Expiry
          <ChevronDown className={`size-3.5 transition-transform duration-200 ${showExpiry ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[0.8125rem] font-medium text-muted hover:text-ink has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-accent/35`}>
          <FileUp className="size-3.5" aria-hidden="true" />
          Upload CSV
          <input aria-describedby="bulk-csv-note" type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={onFile} disabled={saving} />
        </label>
        <span id="bulk-count" className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${over > 0 ? "bg-error-bg text-danger" : "bg-subtle text-muted"}`}>
          {over > 0 ? overMessage : `${count} of ${MAX_BULK_URLS}`}
        </span>
        {over > 0 && (
          <span role="status" className="sr-only">
            {overMessage}
          </span>
        )}
      </div>

      <p id="bulk-csv-note" className={hint}>
        For a custom code or expiry per link, use a CSV: a first line of <code className="rounded bg-subtle px-1 py-px font-mono text-[0.6875rem]">url,code,expires_at</code>, then one link per line.
      </p>

      {showExpiry && (
        <div id="bulk-expiry" className={`${field} animate-pop-in rounded-xl bg-subtle/70 p-3.5`}>
          <label htmlFor="bulk-expires">
            Expires <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="bulk-expires"
            type="datetime-local"
            ref={expiryRef}
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            readOnly={saving}
            aria-invalid={expiryError ? true : undefined}
            aria-describedby={expiryError ? "bulk-expires-error" : "bulk-expires-note"}
            className={`${input} font-normal sm:max-w-xs`}
          />
          {expiryError ? (
            <span id="bulk-expires-error" className={fieldError}>
              {expiryError}
            </span>
          ) : (
            <span id="bulk-expires-note" className={hint}>
              Applies to every link without its own expires_at. Leave empty to keep them for good.
            </span>
          )}
        </div>
      )}

      {lineErrors.length > 0 && (
        <div
          id="bulk-errors"
          ref={summaryRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="bulk-errors-title"
          className={`${errorBox} grid gap-1 focus:outline-none`}
        >
          <p id="bulk-errors-title" className="font-medium">
            {summaryTitle}
          </p>
          <ul className="grid gap-1">
            {lineErrors.map((e) => (
              <li key={`${e.line}-${e.message}`}>
                <button
                  type="button"
                  className={`cursor-pointer rounded text-left text-danger underline underline-offset-2 ${focusRing}`}
                  title={e.url}
                  onClick={() => goToLine(e.line)}
                >
                  Line {e.line}: <span className="break-all">{shorten(e.url)}</span>
                </button>{" "}
                — {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className={`${errorBox} flex items-start gap-2`} role="alert">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {signedIn ? (
        <button
          type="submit"
          className={button(
            "primary",
            "lg",
            "justify-self-end max-sm:w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
          )}
          // Not `disabled` while saving: that would drop focus from the button the user pressed. submit() ignores repeats.
          disabled={!saving && (count === 0 || over > 0)}
          aria-disabled={saving || undefined}
        >
          {saving && <Spinner />}
          {submitLabel}
        </button>
      ) : (
        // The alert above already says to copy the list first, so this is just the button.
        <button type="button" ref={logInRef} className={button("primary", "md", "justify-self-end")} onClick={onLogIn}>
          Sign in
        </button>
      )}
    </form>
  );
}
