import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { button, iconButton } from "../ui";

interface Props {
  text: string;
  label?: string;
  primary?: boolean;
  /** Show just the icon (the label stays as the accessible name and tooltip). */
  iconOnly?: boolean;
  /** The accessible name, when "label text" would be too long (e.g. many URLs). */
  ariaLabel?: string;
}

export function CopyButton({ text, label = "Copy", primary = false, iconOnly = false, ariaLabel }: Props) {
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
      className={iconOnly ? iconButton : button(primary ? "primary" : "default", "sm")}
      onClick={copy}
      aria-label={ariaLabel ?? `${label} ${text}`}
      title={iconOnly ? (copied ? "Copied!" : label) : undefined}
    >
      {copied ? <Check /> : <Copy />}
      {!iconOnly && (copied ? "Copied!" : label)}
    </button>
  );
}
