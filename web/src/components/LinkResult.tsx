import { Download, List, X } from "lucide-react";
import type { Link } from "../api";
import { AppLink } from "../router";
import { button, card } from "../ui";
import { CopyButton } from "./CopyButton";

export function LinkResult({ link, onDismiss }: { link: Link; onDismiss: () => void }) {
  return (
    <section
      className={`${card} flex w-full justify-self-center gap-5 rounded-2xl border-accent p-4 sm:items-center sm:gap-6 sm:p-6 max-sm:flex-col max-sm:text-center`}
      aria-live="polite"
      aria-label="New short link"
    >
      <img
        className="shrink-0 self-center rounded-xl border border-line bg-white p-1.5 sm:self-auto"
        src={link.qrCodeUrl}
        alt={`QR code for ${link.shortUrl}`}
        width={112}
        height={112}
      />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="text-sm font-semibold text-ok-ink">Your short link is ready</p>
        <a
          className="text-xl font-bold break-all text-accent-ink hover:underline sm:text-2xl"
          href={link.shortUrl}
          target="_blank"
          rel="noreferrer"
        >
          {link.shortUrl}
        </a>
        <p className="truncate text-[0.85rem] text-muted" title={link.url}>
          → {link.url}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 max-sm:justify-center">
          <CopyButton text={link.shortUrl} primary />
          <a className={button("default", "sm")} href={link.qrCodeUrl} download={`${link.code}-qr.png`}>
            <Download />
            Download QR
          </a>
          <AppLink className={button("default", "sm")} href="/links">
            <List />
            All links
          </AppLink>
          <button type="button" className={button("ghost", "sm")} onClick={onDismiss}>
            <X />
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}
