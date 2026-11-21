import { TriangleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { button } from "../../ui";
import { Dialog } from "./Dialog";

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** The button that goes ahead, e.g. "Delete link". */
  confirmLabel: string;
  /** Destructive actions get a red button and a warning icon. */
  destructive?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/** Asks before something can't be undone, in a sheet that matches the app (instead of the browser's confirm box). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((options) => {
    resolver.current?.(false);
    setPending(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
  }, []);
  const cancel = useCallback(() => settle(false), [settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Dialog
          size="sm"
          title={pending.title}
          onClose={cancel}
          icon={
            pending.destructive ? (
              <span className="mb-3 grid size-10 place-items-center rounded-full bg-error-bg text-danger" aria-hidden="true">
                <TriangleAlert className="size-5" />
              </span>
            ) : undefined
          }
        >
          <div className="-mt-2 text-sm leading-relaxed text-muted">{pending.message}</div>
          <div className="flex justify-end gap-2 max-sm:grid max-sm:grid-cols-2">
            <button type="button" className={button("default", "md")} onClick={cancel} autoFocus>
              Cancel
            </button>
            <button type="button" className={button(pending.destructive ? "danger-solid" : "primary", "md")} onClick={() => settle(true)}>
              {pending.confirmLabel}
            </button>
          </div>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

/** Asks the user to confirm; resolves true to go ahead. Outside a ConfirmProvider it falls back to the browser's box. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  return (
    confirm ??
    (async ({ title, message }) => window.confirm(typeof message === "string" ? `${title}\n\n${message}` : title))
  );
}
