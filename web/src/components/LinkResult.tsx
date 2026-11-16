import { Download, List, X } from "lucide-react";
import type { Link } from "../api";
import { AppLink } from "../router";
import { button, card } from "../ui";
import { CopyButton } from "./CopyButton";

export function LinkResult({ link, onDismiss }: { link: Link; onDismiss: () => void }) {
  return (
    <section
      className={`${card} flex w-full max-w-[1100px] items-center gap-6 justify-self-center border-accent p-6 max-sm:flex-col max-sm:items-stretch max-sm:text-center`}
      aria-live="polite"
      aria-label="New short link"
    >
      <img
        className="shrink-0 rounded-[10px] border border-line bg-white p-1.5 max-sm:self-center"
        src={link.qrCodeUrl}
        alt={`QR code for ${link.shortUrl}`}
        width={120}
        height={120}
      />
      <div className="grid min-w-0 gap-1.5">
        <p className="text-muted">Your short link is ready</p>
        <a
          className="text-2xl font-bold break-all text-accent-ink hover:underline"
          href={link.shortUrl}
          target="_blank"
          rel="noreferrer"
        >
          {link.shortUrl}
        </a>
        <p className="truncate text-sm text-muted" title={link.url}>
          → {link.url}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 max-sm:justify-center">
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
