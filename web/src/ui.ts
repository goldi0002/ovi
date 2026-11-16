// Shared Tailwind class lists, so buttons, cards and inputs look the same everywhere.

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  default: "border-line bg-surface text-ink hover:not-disabled:border-line-strong",
  primary: "border-accent bg-accent text-white hover:not-disabled:border-accent-hover hover:not-disabled:bg-accent-hover",
  ghost: "border-transparent bg-transparent text-ink hover:not-disabled:bg-accent-soft",
  danger: "border-line bg-surface text-danger hover:not-disabled:border-line-strong",
};

const sizes: Record<Size, string> = {
  sm: "gap-1.5 rounded-lg px-3 py-1.5 text-sm [&_svg]:size-4",
  md: "gap-2 rounded-xl px-6 py-3 text-base [&_svg]:size-5",
  lg: "gap-2 min-h-16 rounded-xl px-9 text-xl max-sm:min-h-14 max-sm:text-lg [&_svg]:size-6",
};

export function button(variant: Variant = "default", size: Size = "md", extra = ""): string {
  return [
    "inline-flex cursor-pointer items-center justify-center border font-semibold whitespace-nowrap no-underline",
    "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    focusRing,
    variants[variant],
    sizes[size],
    variant === "primary" && size !== "sm" ? "shadow-btn" : "",
    extra,
  ].join(" ");
}

export const iconButton = `inline-grid size-14 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-ink shadow-card hover:border-line-strong max-sm:size-11 ${focusRing}`;

export const card = "rounded-2xl border border-line bg-surface shadow-card";

export const input =
  "w-full rounded-[10px] border-[1.5px] border-line-strong bg-surface px-3.5 py-3 font-normal text-ink placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none";

export const field = "grid min-w-0 gap-1.5 text-left text-sm font-semibold";

export const errorBox = "rounded-[10px] bg-error-bg px-3.5 py-2.5 text-[0.95rem] text-danger";

export const iconBubble = "inline-grid shrink-0 place-items-center rounded-full bg-accent-soft text-accent";

export const backdrop = "fixed inset-0 z-10 grid place-items-center bg-[rgb(15_10_35/45%)] p-4 backdrop-blur-sm";
