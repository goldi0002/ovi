import { Download, Share, X } from "lucide-react";
import { useState } from "react";
import { useInstall } from "../pwa";
import { loadInstallDismissed, saveInstallDismissed } from "../storage";
import { button, card, iconButton } from "../ui";
import { BrandMark } from "./Header";

/**
 * Offers to install Ovi where the device can: a button where the browser will ask, or the Share steps on
 * iPhone and iPad. It stays out of the way: nothing shows once installed, and closing it is remembered.
 */
export function InstallBanner() {
  const { mode, prompt } = useInstall();
  const [dismissed, setDismissed] = useState(loadInstallDismissed);
  if (!mode || dismissed) return null;

  return (
    <section className={`${card} relative flex items-center gap-3 p-3.5 pr-11`} aria-label="Install Ovi">
      <BrandMark className="size-10" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Keep Ovi on your home screen</p>
        <p className="text-xs text-muted">
          {mode === "prompt" ? (
            "Opens in its own window, and you can share links to it from other apps."
          ) : (
            <>
              Tap <Share className="inline size-3.5 -translate-y-px" aria-label="Share" /> in Safari, then Add to Home Screen.
            </>
          )}
        </p>
      </div>
      {mode === "prompt" && (
        <button type="button" className={button("primary", "sm", "max-sm:px-2.5")} onClick={() => void prompt()}>
          <Download />
          Install
        </button>
      )}
      <button
        type="button"
        className={`${iconButton} absolute top-2 right-2`}
        aria-label="Not now"
        data-tip="Not now"
        onClick={() => {
          saveInstallDismissed();
          setDismissed(true);
        }}
      >
        <X />
      </button>
    </section>
  );
}
