// Shared Tailwind class lists, so controls look the same everywhere. One scale for all of them:
// controls are 32px (sm) or 36px (md) tall with an 8px radius, cards 12px, sheets 16px.

export const focusRing = "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/35";

type Variant = "default" | "primary" | "ghost" | "danger" | "danger-solid";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  default: "bg-control text-ink shadow-control hover:not-disabled:bg-control-hover active:not-disabled:bg-control-pressed",
  primary:
    "bg-accent text-on-accent shadow-primary hover:not-disabled:bg-accent-hover active:not-disabled:bg-accent-pressed",
  ghost: "bg-transparent text-ink hover:not-disabled:bg-hover active:not-disabled:bg-pressed",
  danger: "bg-control text-danger shadow-control hover:not-disabled:bg-error-bg active:not-disabled:bg-control-pressed",
  "danger-solid": "bg-danger text-on-danger hover:not-disabled:opacity-90 active:not-disabled:opacity-80",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[0.8125rem] [&_svg]:size-3.5",
  md: "h-9 gap-2 rounded-lg px-3.5 text-sm [&_svg]:size-4",
  lg: "h-11 gap-2 rounded-[10px] px-5 text-[0.9375rem] [&_svg]:size-4",
};

export function button(variant: Variant = "default", size: Size = "md", extra = ""): string {
  return [
    "inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap no-underline select-none",
    "transition-[background-color,box-shadow,opacity,transform] duration-150 active:not-disabled:scale-[0.98]",
    "disabled:cursor-not-allowed disabled:opacity-45",
    focusRing,
    variants[variant],
    sizes[size],
    extra,
  ].join(" ");
}

/** A borderless toolbar-style button holding only an icon; give it an aria-label (and a data-tip for the tooltip). */
export const iconButton = `tip inline-grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:not-disabled:bg-hover hover:not-disabled:text-ink active:not-disabled:bg-pressed disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4 ${focusRing}`;

/** A content panel. */
export const card = "rounded-xl bg-surface shadow-card";

/** A text field. */
export const input =
  "h-9 w-full min-w-0 rounded-lg bg-field px-3 text-sm text-ink shadow-field outline-none placeholder:text-placeholder transition-shadow focus:shadow-[inset_0_0_0_1px_var(--color-accent)] focus:ring-[3px] focus:ring-accent/25 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-invalid:shadow-[inset_0_0_0_1px_var(--color-danger)]";

export const field = "grid min-w-0 content-start gap-1.5 text-left text-[0.8125rem] font-medium";

/** The small grey line under a field. */
export const hint = "text-xs font-normal text-muted";
export const fieldError = "text-xs font-normal text-danger";

export const errorBox = "rounded-lg bg-error-bg px-3 py-2 text-[0.8125rem] text-danger shadow-[inset_0_0_0_0.5px_var(--color-error-line)]";

/** Behind a sheet: a light dim with a blur, and the sheet sits a little above centre. */
export const backdrop =
  "fixed inset-0 z-40 grid items-start justify-items-center overflow-y-auto bg-backdrop p-4 pt-[10vh] backdrop-blur-[2px] animate-fade-in max-sm:items-end max-sm:p-0 max-sm:pt-10";

/** A dialog panel; on phones it rises from the bottom edge. */
export const sheet = "rounded-2xl bg-raised shadow-sheet animate-sheet-in max-sm:rounded-b-none max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]";

/** Segmented control track and segments. */
export const segmentTrack = "inline-flex rounded-lg bg-segment p-0.5";
export function segment(on: boolean, extra = ""): string {
  return [
    "cursor-pointer rounded-md px-3 py-1 text-[0.8125rem] font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-45",
    focusRing,
    on ? "bg-segment-on text-ink shadow-control" : "text-muted hover:not-disabled:text-ink",
    extra,
  ].join(" ");
}

/** A small uppercase label above a group (sidebar sections, table headers). */
export const eyebrow = "text-[0.6875rem] font-semibold tracking-[0.04em] text-muted uppercase";

/** Page width and side padding for the signed-in pages. */
export const container = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";
