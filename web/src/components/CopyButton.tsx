import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { button } from "../ui";

export function CopyButton({ text, label = "Copy", primary = false }: { text: string; label?: string; primary?: boolean }) {
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
    <button
      type="button"
      className={button(primary ? "primary" : "default", "sm")}
      onClick={copy}
      aria-label={`${label} ${text}`}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied!" : label}
    </button>
  );
}
