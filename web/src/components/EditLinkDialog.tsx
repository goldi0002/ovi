import { useState, type FormEvent } from "react";
import { ApiError, type Link, type OviApi, type UpdateLinkInput } from "../api";
import { isoToLocalInput, localInputToIso } from "../format";
import { button, errorBox, field, fieldError, hint, input } from "../ui";
import { useToast } from "./ui/Toast";
import { Dialog } from "./ui/Dialog";
import { Spinner } from "./ui/primitives";

interface Props {
  api: OviApi;
  link: Link;
  onClose: () => void;
  onSaved: (link: Link) => void;
  onUnauthorized: () => void;
}

/** Changes where a link goes and when it expires. The short code, clicks and stats stay the same. */
export function EditLinkDialog({ api, link, onClose, onSaved, onUnauthorized }: Props) {
  const originalExpiry = isoToLocalInput(link.expiresAt);
  const [url, setUrl] = useState(link.url);
  const [expiresAt, setExpiresAt] = useState(originalExpiry);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notify = useToast();

  /** Only what changed, so an untouched expiry isn't re-sent (and re-checked) at minute precision. */
  function changes(): UpdateLinkInput {
    const input: UpdateLinkInput = {};
    if (url.trim() !== link.url) input.url = url.trim();
    if (expiresAt !== originalExpiry) {
      if (expiresAt) input.expiresAt = localInputToIso(expiresAt);
      else input.clearExpiry = true;
    }
    return input;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = changes();
    if (Object.keys(input).length === 0) return onClose();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      onSaved(await api.update(link.code, input));
      notify(`Saved /${link.code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onUnauthorized();
      if (err instanceof ApiError && (err.fieldErrors.url || err.fieldErrors.expiresAt)) setFieldErrors(err.fieldErrors);
      else setError(err instanceof ApiError ? err.message : "Couldn't save the link. Try again.");
      setSaving(false);
    }
  }

  const urlError = fieldErrors.url?.[0];
  const expiryError = fieldErrors.expiresAt?.[0];

  return (
    <Dialog title={`Edit /${link.code}`} description="The short link and its clicks stay the same." onClose={onClose}>
        <form className="grid gap-4" onSubmit={submit} aria-label={`Edit /${link.code}`} noValidate>
          <label className={field}>
            <span>Destination URL</span>
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2048}
              aria-invalid={urlError ? true : undefined}
              aria-describedby={urlError ? "edit-url-error" : undefined}
              autoFocus
              className={`${input} font-normal`}
            />
            {urlError && (
              <span id="edit-url-error" className={fieldError}>
                {urlError}
              </span>
            )}
          </label>

          <div className={field}>
            <label htmlFor="edit-expires">
              Expires <span className="font-normal text-muted">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                id="edit-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                aria-invalid={expiryError ? true : undefined}
                aria-describedby={expiryError ? "edit-expires-error" : "edit-expires-note"}
                className={`${input} font-normal`}
              />
              {expiresAt && (
                <button type="button" className={button("default", "md")} onClick={() => setExpiresAt("")}>
                  Never expire
                </button>
              )}
            </div>
            {expiryError ? (
              <span id="edit-expires-error" className={fieldError}>
                {expiryError}
              </span>
            ) : (
              <span id="edit-expires-note" className={hint}>
                Leave empty for a link that never expires.
              </span>
            )}
          </div>

          {error && (
            <p className={errorBox} role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1 max-sm:grid max-sm:grid-cols-2">
            <button type="button" className={button("default", "md")} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={button("primary", "md", "min-w-20")} disabled={saving}>
              {saving && <Spinner />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
    </Dialog>
  );
}
