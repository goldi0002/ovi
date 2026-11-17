// Shared Tailwind class lists, so buttons, cards and inputs look the same everywhere.

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  default: "border-line bg-surface text-ink hover:not-disabled:border-line-strong hover:not-disabled:bg-accent-soft/40",
  primary: "border-accent bg-accent text-white hover:not-disabled:border-accent-hover hover:not-disabled:bg-accent-hover",
  ghost: "border-transparent bg-transparent text-ink hover:not-disabled:bg-accent-soft",
  danger: "border-line bg-surface text-danger hover:not-disabled:border-danger/60 hover:not-disabled:bg-error-bg",
};

const sizes: Record<Size, string> = {
  sm: "gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.82rem] [&_svg]:size-4",
  md: "gap-2 rounded-xl px-4 py-2.5 text-[0.95rem] sm:px-5 [&_svg]:size-[1.15rem]",
  lg: "gap-2.5 min-h-14 rounded-xl px-6 text-base sm:text-lg [&_svg]:size-5",
};

export function button(variant: Variant = "default", size: Size = "md", extra = ""): string {
  return [
    "inline-flex cursor-pointer items-center justify-center border font-semibold whitespace-nowrap no-underline",
    "transition-[background-color,border-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-60",
    focusRing,
    variants[variant],
    sizes[size],
    variant === "primary" && size !== "sm" ? "shadow-btn" : "",
    extra,
  ].join(" ");
}

export const iconButton = `inline-grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-ink shadow-card transition-colors hover:border-line-strong hover:bg-accent-soft/50 ${focusRing}`;

export const card = "rounded-2xl border border-line bg-surface shadow-card";

export const input =
  "w-full rounded-xl border-[1.5px] border-line-strong bg-surface px-3.5 py-2.5 font-normal text-ink placeholder:text-muted transition-colors focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none";

export const field = "grid min-w-0 gap-1.5 text-left text-sm font-semibold";

export const errorBox = "rounded-xl bg-error-bg px-3.5 py-2.5 text-[0.9rem] text-danger";

export const iconBubble = "inline-grid shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent";

export const backdrop =
  "fixed inset-0 z-50 grid place-items-center bg-[rgb(15_10_35/45%)] p-3 backdrop-blur-sm sm:p-4";
