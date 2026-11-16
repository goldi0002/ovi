import type { Link } from "../api";
import { CopyButton } from "./CopyButton";

export function LinkResult({ link, onDismiss }: { link: Link; onDismiss: () => void }) {
  return (
    <section className="card result" aria-live="polite" aria-label="New short link">
      <img className="qr" src={link.qrCodeUrl} alt={`QR code for ${link.shortUrl}`} width={128} height={128} />
      <div className="result-body">
        <p className="muted">Your short link is ready</p>
        <a className="short-url" href={link.shortUrl} target="_blank" rel="noreferrer">
          {link.shortUrl}
        </a>
        <p className="dest" title={link.url}>
          → {link.url}
        </p>
        <div className="actions">
          <CopyButton text={link.shortUrl} />
          <a className="btn btn-small" href={link.qrCodeUrl} download={`${link.code}-qr.png`}>
            Download QR
          </a>
          <button type="button" className="btn btn-small btn-ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}
