import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context, permissions); leave the text selectable instead.
    }
  }

  return (
    <button type="button" className="btn btn-small" onClick={copy} aria-label={`${label} ${text}`}>
      {copied ? "Copied!" : label}
    </button>
  );
}
