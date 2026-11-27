import { Printer, X } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { isExpired, type Link } from "../api";
import { displayUrl } from "../format";
import { button, iconButton } from "../ui";
import { trapFocus, useModal } from "./useModal";

/** The most codes one sheet holds, so a print stays a handful of pages. */
export const MAX_SHEET_CODES = 48;

/** A page of QR codes to print: each cell has the code, the short URL and the destination. Black on white in both themes. */
export function QrSheet({ links, onClose }: { links: Link[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(onClose);
  const printable = links.filter((l) => !isExpired(l)).slice(0, MAX_SHEET_CODES);

  return createPortal(
    <div
      ref={ref}
      // Pure white and black on purpose, in both themes: this is paper, and scanners need dark modules on a light ground.
      className="qr-sheet fixed inset-0 z-50 overflow-auto bg-white text-black"
      role="dialog"
      aria-modal="true"
      aria-label="Print QR codes"
      onKeyDown={(e) => trapFocus(e, ref)}
    >
      <div className="sticky top-0 flex items-center gap-2 border-b border-black/15 bg-white px-5 py-3 print:hidden">
        <p className="mr-auto text-sm font-medium">
          {printable.length} QR {printable.length === 1 ? "code" : "codes"} on this sheet
        </p>
        <button type="button" className={button("primary", "sm")} onClick={() => window.print()} autoFocus>
          <Printer />
          Print
        </button>
        <button type="button" className={iconButton} onClick={onClose} aria-label="Close print preview">
          <X />
        </button>
      </div>
      <ul className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3" aria-label="Sheet">
        {printable.map((link) => (
          <li key={link.code} className="qr-cell grid justify-items-center gap-1.5 rounded-lg border border-black/20 p-3 text-center">
            <img src={link.qrCodeUrl} alt={`QR code for /${link.code}`} width={200} height={200} className="aspect-square w-full max-w-[12rem]" />
            <p className="font-mono text-[0.8125rem] font-semibold break-all">{displayUrl(link.shortUrl)}</p>
            <p className="line-clamp-2 text-xs break-all text-black/70">{link.url}</p>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
