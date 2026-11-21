import { CircleAlert, CircleCheck, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { iconButton } from "../../ui";

type Tone = "success" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

type Notify = (message: string, tone?: Tone) => void;

const ToastContext = createContext<Notify | null>(null);

const SHOW_MS = 3200;

/** Short-lived confirmations ("Link deleted") in the bottom corner. Screen readers hear each one. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const notify = useCallback<Notify>(
    (message, tone = "success") => {
      const id = ++nextId.current;
      // At most three at once; the oldest goes first.
      setToasts((all) => [...all.slice(-2), { id, message, tone }]);
      setTimeout(() => dismiss(id), SHOW_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={notify}>
      {children}
      {/* Polite: a toast never interrupts what is being read. */}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-lg:bottom-16 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm min-w-60 animate-toast-in items-center gap-2.5 rounded-xl bg-raised py-2 pr-2 pl-3.5 text-[0.8125rem] font-medium shadow-sheet"
          >
            {t.tone === "success" ? (
              <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">{t.message}</span>
            <button type="button" className={`${iconButton} size-7`} onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <X />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Shows a toast. Outside a ToastProvider (a component rendered on its own) it does nothing. */
export function useToast(): Notify {
  const notify = useContext(ToastContext);
  return useMemo(() => notify ?? (() => {}), [notify]);
}
