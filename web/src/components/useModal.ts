import { useEffect, useState } from "react";

/** Shared modal behaviour: Escape closes, the page behind can't scroll, and focus returns to the opener. */
export function useModal(onClose: () => void) {
  // Read during the first render, before an autoFocus element inside the modal takes focus.
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("overflow-hidden");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("overflow-hidden");
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose, opener]);
}
