import { Check, Download, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Link } from "../api";
import { downloadCsv } from "../bulk";
import { displayUrl, formatDateTime } from "../format";
import { button, card, iconButton } from "../ui";
import { CopyButton } from "./CopyButton";

interface Props {
  /** The new links, in the order they were entered. */
  links: Link[];
  onDismiss: () => void;
}

/** The links a bulk request made: copy them all, download a CSV, or copy one. */
export function BulkResult({ links, onDismiss }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Links can have different expiries (a CSV sets one per row), so only say "all" when they really are the same.
  const expiries = new Set(links.map((l) => l.expiresAt));
  const expiresAt = expiries.size === 1 ? (links[0]?.expiresAt ?? null) : null;
  const mixed = expiries.size > 1;
  const n = links.length;

  // Moving focus here is the announcement; the section has no aria-live, which would read every row.
  useEffect(() => headingRef.current?.focus(), [links]);

  return (
    <section className={`${card} relative grid gap-3 p-4 sm:p-5`} aria-labelledby="bulk-result-title">
      <div className="pr-10">
        <h2
          id="bulk-result-title"
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-1.5 text-[0.9375rem] font-semibold focus:outline-none"
        >
          <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
          {n} {n === 1 ? "link" : "links"} shortened
        </h2>
        {expiresAt && <p className="mt-0.5 text-xs text-muted">All expire {formatDateTime(expiresAt)}.</p>}
        {mixed && <p className="mt-0.5 text-xs text-muted">Expiry differs by link. The CSV has each one.</p>}
      </div>

      <div className="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-2">
        <CopyButton
          text={links.map((l) => l.shortUrl).join("\n")}
          label="Copy all"
          ariaLabel={`Copy all ${n} short ${n === 1 ? "link" : "links"}`}
          primary
        />
        <button type="button" className={button("default", "sm")} onClick={() => downloadCsv(links)}>
          <Download />
          Download CSV
        </button>
      </div>

      {/* After the actions in the DOM (so Tab reaches Copy all first); it sits in the corner either way. */}
      <button
        type="button"
        className={`${iconButton} absolute top-3 right-3 sm:top-4 sm:right-4`}
        onClick={onDismiss}
        aria-label="Dismiss results"
      >
        <X />
      </button>

      <ol className="divide-y divide-line border-t border-line">
        {links.map((link, i) => (
          <li key={`${i}-${link.code}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2.5">
            <a
              className="truncate font-mono text-[0.8125rem] font-semibold underline-offset-4 hover:underline"
              href={link.shortUrl}
              target="_blank"
              rel="noreferrer"
              title={link.shortUrl}
            >
              {displayUrl(link.shortUrl)}
            </a>
            <div className="col-start-2 row-span-2 row-start-1">
              <CopyButton text={link.shortUrl} iconOnly />
            </div>
            <p className="truncate text-xs text-muted" title={link.url}>
              {link.url}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
