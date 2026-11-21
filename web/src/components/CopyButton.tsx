import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { button, iconButton } from "../ui";
import { useToast } from "./ui/Toast";

interface Props {
  text: string;
  label?: string;
  primary?: boolean;
  /** Show just the icon (the label stays as the accessible name and tooltip). */
  iconOnly?: boolean;
  /** The accessible name, when "label text" would be too long (e.g. many URLs). */
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
}

export function CopyButton({ text, label = "Copy", primary = false, iconOnly = false, ariaLabel, size = "sm", className = "" }: Props) {
  const [copied, setCopied] = useState(false);
  const notify = useToast();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
      // An icon has no room to say "Copied!", so a toast does.
      if (iconOnly) notify("Copied to the clipboard");
    } catch {
      // Clipboard can be unavailable (insecure context, permissions); leave the text selectable instead.
      notify("Couldn't copy. Select the link and copy it instead.", "error");
    }
  }

  return (
    <button
      type="button"
      className={`${iconOnly ? iconButton : button(primary ? "primary" : "default", size)} ${className}`}
      onClick={copy}
      aria-label={ariaLabel ?? `${label} ${text}`}
      data-tip={iconOnly ? (copied ? "Copied" : label) : undefined}
    >
      {copied ? <Check className={iconOnly ? "text-success" : undefined} /> : <Copy />}
      {!iconOnly && (copied ? "Copied!" : label)}
    </button>
  );
}
