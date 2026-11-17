import { Download, X } from "lucide-react";
import type { Link } from "../api";
import { displayUrl } from "../format";
import { AppLink } from "../router";
import { button, card, iconButton } from "../ui";
import { CopyButton } from "./CopyButton";

// Desktop: QR | link details, with the actions underneath. Phone: link details, then the QR, then
// the actions, so a long link gets the full width. Close sits in the corner either way.
export function LinkResult({ link, onDismiss }: { link: Link; onDismiss: () => void }) {
  return (
    <section
      className={`${card} relative grid gap-4 p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-5`}
      aria-live="polite"
      aria-label="New short link"
    >
      <img
        className="row-start-2 size-24 rounded-lg shadow-control sm:row-start-1"
        src={link.qrCodeUrl}
        alt={`QR code for ${link.shortUrl}`}
        width={96}
        height={96}
      />
      <div className="row-start-1 grid content-start gap-1 sm:col-start-2 sm:pr-8">
        <p className="pr-8 text-[0.8125rem] text-muted sm:pr-0">Your short link</p>
        <a
          className="text-[1.0625rem] font-semibold break-all underline-offset-4 hover:underline sm:text-xl"
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
      </div>
      <button
        type="button"
        className={`${iconButton} absolute top-3 right-3 sm:top-4 sm:right-4`}
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X />
      </button>
      <div className="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-2 sm:col-span-2">
        <CopyButton text={link.shortUrl} primary />
        <a className={button("default", "sm")} href={link.qrCodeUrl} download={`${link.code}-qr.png`}>
          <Download />
          QR code
        </a>
        <AppLink className={button("default", "sm", "max-sm:col-span-2")} href="/links">
          All links
        </AppLink>
      </div>
    </section>
  );
}
