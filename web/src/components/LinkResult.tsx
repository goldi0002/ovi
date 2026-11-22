import { ChartColumn, CircleCheck, Download, ExternalLink, X } from "lucide-react";
import type { Link } from "../api";
import { displayUrl, formatDateTime } from "../format";
import { AppLink, PAGES } from "../router";
import { button, card, iconButton } from "../ui";
import { CopyButton } from "./CopyButton";

/**
 * The link just made: the short URL large, its QR code, and what to do next. Desktop: details | QR.
 * Phone: details, then the actions, then the QR, so a long link gets the full width.
 */
export function LinkResult({ link, signedIn, onDismiss }: { link: Link; signedIn: boolean; onDismiss: () => void }) {
  return (
    <section
      className={`${card} relative grid animate-sheet-in gap-5 overflow-hidden p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6`}
      aria-live="polite"
      aria-label="New short link"
    >
      <div className="grid min-w-0 content-start gap-3">
        <p className="flex items-center gap-1.5 pr-8 text-[0.8125rem] font-medium text-success">
          <CircleCheck className="size-4" aria-hidden="true" />
          Your short link is ready
        </p>
        <div className="grid min-w-0 gap-1">
          <a
            className="font-mono text-xl font-semibold tracking-[-0.02em] break-all text-accent-text underline-offset-4 hover:underline sm:text-2xl"
            href={link.shortUrl}
            target="_blank"
            rel="noreferrer"
            title={link.shortUrl}
          >
            {displayUrl(link.shortUrl)}
          </a>
          {/* Long destinations wrap anywhere but stop after two lines; the full URL is in the tooltip. */}
          <p className="line-clamp-2 text-[0.8125rem] break-all text-muted" title={link.url}>
            {link.url}
          </p>
          {link.expiresAt && <p className="text-xs text-muted">Expires {formatDateTime(link.expiresAt)}</p>}
        </div>
        <div className="mt-1 flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-2 max-sm:[&>:first-child]:col-span-2">
          <CopyButton text={link.shortUrl} primary size="md" />
          <a className={button("default", "md")} href={link.shortUrl} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open
          </a>
          <a className={button("default", "md")} href={link.qrCodeUrl} download={`${link.code}-qr.png`}>
            <Download />
            QR code
          </a>
          {signedIn && (
            <>
              <AppLink className={button("ghost", "md")} href={`${PAGES.analytics}?code=${encodeURIComponent(link.code)}`}>
                <ChartColumn />
                Stats
              </AppLink>
              <AppLink className={button("ghost", "md")} href={PAGES.links}>
                All links
              </AppLink>
            </>
          )}
        </div>
      </div>

      {/* Always on white, in both themes: scanners need dark modules on a light ground. */}
      <div className="justify-self-start rounded-xl bg-white p-2 shadow-control sm:self-center">
        <img className="size-28 sm:size-32" src={link.qrCodeUrl} alt={`QR code for ${link.shortUrl}`} width={128} height={128} />
      </div>

      <button type="button" className={`${iconButton} absolute top-3 right-3`} onClick={onDismiss} aria-label="Dismiss" data-tip="Dismiss">
        <X />
      </button>
    </section>
  );
}
