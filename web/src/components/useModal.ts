import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";

/** Shared modal behaviour: Escape closes, the page behind can't scroll, and focus returns to the opener. */
export function useModal(onClose: () => void) {
  // Read during the first render, before an autoFocus element inside the modal takes focus.
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside `ref` (a dialog), wrapping at either end. */
export function trapFocus(e: KeyboardEvent, ref: RefObject<HTMLElement | null>) {
  if (e.key !== "Tab" || !ref.current) return;
  const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
