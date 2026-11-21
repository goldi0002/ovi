import { CircleCheck } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { ApiError, type OviApi, type ReportReason } from "../api";
import { Spinner } from "../components/ui/primitives";
import { AppLink, PAGES, useSearch } from "../router";
import { button, card, container, errorBox, field, fieldError, focusRing, hint, input } from "../ui";
import { usePageTitle } from "./common";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "phishing", label: "Phishing or scam" },
  { value: "malware", label: "Malware or virus" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
];

const DETAILS_MAX = 500;

type Errors = Partial<Record<"link" | "reason" | "details" | "form", string>>;

/** The page anyone can use, signed in or not, to tell the admin about a harmful short link. */
export function ReportPage({ api }: { api: OviApi }) {
  usePageTitle("Report a link");
  const search = useSearch();
  const [link, setLink] = useState(() => new URLSearchParams(search).get("link")?.trim() ?? "");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Errors = {};
    if (!link.trim()) next.link = "Enter an Ovi short link or its code.";
    if (!reason) next.reason = "Choose a reason.";
    if (details.length > DETAILS_MAX) next.details = "Keep the details under 500 characters.";
    if (Object.keys(next).length > 0) return fail(next);

    setBusy(true);
    setErrors({});
    try {
      await api.reportLink({ link: link.trim(), reason: reason!, ...(details.trim() ? { details: details.trim() } : {}) });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k.toLowerCase(), v[0]]));
        if (err.status === 400 && (fields.link || fields.reason || fields.details)) {
          fail({ link: fields.link, reason: fields.reason, details: fields.details });
        } else if (err.status === 404) {
          fail({ link: err.message });
        } else {
          fail({ form: err.status === 429 ? "Too many reports from here. Try again later." : err.message });
        }
      } else {
        fail({ form: "Couldn't send the report. Check your connection and try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  function fail(next: Errors) {
    setErrors(next);
    (next.link ? linkRef : next.reason ? reasonRef : next.details ? detailsRef : null)?.current?.focus();
  }

  if (done) {
    return (
      <main className={`${container} flex-1 py-8 sm:py-10`}>
        <div className={`${card} mx-auto grid max-w-xl justify-items-center gap-3 px-6 py-10 text-center`} role="status">
          <CircleCheck className="size-8 text-success" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-[-0.02em]">Thanks. We'll take a look.</h1>
          <p className="text-sm text-muted">We don't store anything about who sent a report.</p>
          <AppLink href={PAGES.home} className={button("default", "md", "mt-2")}>
            Back to Ovi
          </AppLink>
        </div>
      </main>
    );
  }

  return (
    <main className={`${container} flex-1 py-8 sm:py-10`}>
      <form className={`${card} mx-auto grid max-w-xl gap-5 px-5 py-6 sm:px-6`} onSubmit={(e) => void submit(e)} noValidate>
        <div>
          <h1 className="text-[1.625rem] leading-tight font-semibold tracking-[-0.02em]">Report a link</h1>
          <p className="mt-1 text-sm text-muted">
            Seen an Ovi link that tries to scam, infect or spam people? Tell us and the admin will review it. You don't need an account, and we don't store who you are.
          </p>
        </div>

        {errors.form && (
          <p className={errorBox} role="alert">
            {errors.form}
          </p>
        )}

        <div className={field}>
          <label htmlFor={`${id}-link`}>Short link or code</label>
          <input
            id={`${id}-link`}
            ref={linkRef}
            className={input}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://getovi.link/abc123"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={2048}
            aria-invalid={errors.link ? true : undefined}
            aria-describedby={errors.link ? `${id}-link-error` : undefined}
          />
          {errors.link && (
            <span id={`${id}-link-error`} className={fieldError}>
              {errors.link}
            </span>
          )}
        </div>

        <fieldset className="grid min-w-0 gap-2" aria-describedby={errors.reason ? `${id}-reason-error` : undefined}>
          <legend className="mb-1.5 text-[0.8125rem] font-medium">What's wrong with it?</legend>
          {REPORT_REASONS.map((r, i) => (
            <label key={r.value} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                ref={i === 0 ? reasonRef : undefined}
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className={`size-4 cursor-pointer accent-accent ${focusRing}`}
                aria-invalid={errors.reason ? true : undefined}
              />
              {r.label}
            </label>
          ))}
          {errors.reason && (
            <span id={`${id}-reason-error`} className={fieldError}>
              {errors.reason}
            </span>
          )}
        </fieldset>

        <div className={field}>
          <label htmlFor={`${id}-details`}>
            Details <span className={hint}>(optional)</span>
          </label>
          <textarea
            id={`${id}-details`}
            ref={detailsRef}
            className={`${input} h-28 resize-y py-2`}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            aria-invalid={errors.details ? true : undefined}
            aria-describedby={`${id}-details-hint${errors.details ? ` ${id}-details-error` : ""}`}
          />
          <span id={`${id}-details-hint`} className={`${hint} tabular-nums`}>
            {details.length}/{DETAILS_MAX}
          </span>
          {errors.details && (
            <span id={`${id}-details-error`} className={fieldError}>
              {errors.details}
            </span>
          )}
        </div>

        <button type="submit" className={button("primary", "md", "justify-self-start")} disabled={busy}>
          {busy && <Spinner />}
          Send report
        </button>
      </form>
    </main>
  );
}
