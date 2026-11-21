import { X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { backdrop, iconButton, sheet } from "../../ui";
import { trapFocus, useModal } from "../useModal";

const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-3xl" } as const;

interface Props {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: keyof typeof widths;
  /** The close button's accessible name. */
  closeLabel?: string;
  /** Focus the close button when the dialog opens (when nothing inside asks for focus itself). */
  autoFocusClose?: boolean;
  /** Something above the title, such as an icon. */
  icon?: ReactNode;
}

/**
 * A modal sheet: dims the page, traps focus, closes on Escape or a click outside, and hands focus back
 * to whatever opened it. On phones it rises from the bottom edge.
 */
export function Dialog({ title, description, onClose, children, size = "md", closeLabel = "Close", autoFocusClose = false, icon }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useModal(onClose);

  return (
    <div className={backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={ref}
        className={`${sheet} grid w-full ${widths[size]} grid-cols-[minmax(0,1fr)] gap-5 p-6 max-sm:max-w-none max-sm:p-5 ${
          size === "lg" ? "max-h-[calc(100dvh-14vh)] overflow-y-auto max-sm:max-h-[calc(100dvh-40px)]" : "max-sm:max-h-[calc(100dvh-40px)] max-sm:overflow-y-auto"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => trapFocus(e, ref)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {icon}
            <h2 id={titleId} className="text-[1.0625rem] leading-snug font-semibold tracking-[-0.01em]">
              {title}
            </h2>
            {description && <div className="mt-1 text-[0.8125rem] text-muted">{description}</div>}
          </div>
          <button
            type="button"
            className={`${iconButton} -mt-1 -mr-2`}
            onClick={onClose}
            aria-label={closeLabel}
            autoFocus={autoFocusClose}
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
