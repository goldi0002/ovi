import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { focusRing } from "../../ui";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}

interface Props {
  /** The trigger's content and accessible name. */
  trigger: ReactNode;
  label: string;
  triggerClassName: string;
  items: MenuItem[];
  /** Something shown above the items, such as who is signed in. */
  header?: ReactNode;
  /** Which way the menu opens from the trigger. */
  placement?: "up" | "down";
  align?: "start" | "end";
}

/** A menu button: opens a small popover of actions, moved through with the arrow keys. */
export function Menu({ trigger, label, triggerClassName, items, header, placement = "down", align = "start" }: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function onMenuKey(e: KeyboardEvent) {
    const list = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={`absolute z-30 w-60 animate-pop-in rounded-xl bg-raised p-1.5 shadow-sheet ${
            placement === "up" ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "end" ? "right-0" : "left-0"}`}
        >
          {header && <div className="border-b border-line px-2.5 pt-1.5 pb-2.5 mb-1.5">{header}</div>}
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] font-medium hover:bg-hover focus:bg-hover [&_svg]:size-4 [&_svg]:text-muted ${focusRing} ${
                item.destructive ? "text-danger [&_svg]:text-danger" : "text-ink"
              }`}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
