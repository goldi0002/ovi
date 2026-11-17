// Shared Tailwind class lists, so controls look the same everywhere. They follow macOS:
// push buttons with a hairline bezel, a soft focus glow, rounded "window" panels and sheets.

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ink/30";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  default: "bg-surface text-ink shadow-control hover:not-disabled:bg-subtle active:not-disabled:bg-[#ebebed]",
  primary:
    "bg-ink text-white shadow-[0_0.5px_1.5px_rgb(0_0_0/30%)] bg-linear-to-b from-[#48484a] to-ink hover:not-disabled:from-[#5a5a5c] active:not-disabled:from-ink",
  ghost: "bg-transparent text-ink hover:not-disabled:bg-black/5 active:not-disabled:bg-black/10",
  danger: "bg-surface text-danger shadow-control hover:not-disabled:bg-error-bg",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-[0.8125rem] [&_svg]:size-3.5",
  md: "h-10 gap-2 rounded-lg px-4 text-[0.9375rem] [&_svg]:size-4",
};

export function button(variant: Variant = "default", size: Size = "md", extra = ""): string {
  return [
    "inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap no-underline select-none",
    "transition-colors disabled:cursor-not-allowed disabled:opacity-45",
    focusRing,
    variants[variant],
    sizes[size],
    extra,
  ].join(" ");
}

/** A borderless toolbar-style button holding only an icon; give it an aria-label. */
export const iconButton = `inline-grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-ink hover:bg-black/5 active:bg-black/10 [&_svg]:size-4 ${focusRing}`;

/** A content panel that reads like a macOS window. */
export const card = "rounded-xl bg-surface shadow-window";

export const input =
  "h-10 w-full min-w-0 rounded-lg bg-surface px-3 text-[0.9375rem] text-ink shadow-[inset_0_0_0_0.5px_rgb(0_0_0/22%),inset_0_0.5px_1px_rgb(0_0_0/8%)] placeholder:text-[#a1a1a6] transition-shadow focus:shadow-[inset_0_0_0_1px_var(--color-ink)] focus:ring-[3px] focus:ring-ink/20 focus:outline-none";

export const field = "grid min-w-0 gap-1.5 text-left text-[0.8125rem] font-medium";

export const errorBox = "rounded-lg bg-error-bg px-3 py-2 text-[0.8125rem] text-danger shadow-[inset_0_0_0_0.5px_rgb(196_30_30/25%)]";

/** Behind a sheet: a light dim, and the sheet sits near the top like a macOS sheet. */
export const backdrop =
  "fixed inset-0 z-20 grid items-start justify-items-center overflow-y-auto bg-black/25 p-4 pt-[8vh] max-sm:pt-4";

/** A dialog panel. */
export const sheet = "rounded-xl bg-surface shadow-sheet";

/** Page width and side padding, shared by the header, pages and footer. */
export const container = "mx-auto w-full max-w-5xl px-4 sm:px-6";
