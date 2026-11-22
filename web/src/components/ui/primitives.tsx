import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { card, focusRing, input, segment, segmentTrack } from "../../ui";

/** The title row of a page: heading, a line of context and the page's main actions. */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-8">
      <div className="min-w-0">
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-[-0.02em] sm:text-[1.875rem]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

interface SegmentedProps<T extends string | number> {
  label: string;
  options: readonly { value: T; label: ReactNode; ariaLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Stretch to the full width (each segment shares it equally). */
  full?: boolean;
  className?: string;
}

/** A row of mutually exclusive choices; each segment is a toggle button with aria-pressed. */
export function SegmentedControl<T extends string | number>({ label, options, value, onChange, disabled, full, className = "" }: SegmentedProps<T>) {
  return (
    <div className={`${segmentTrack} ${full ? "flex w-full" : ""} ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={segment(value === o.value, full ? "flex-1" : "")}
          aria-pressed={value === o.value}
          aria-label={o.ariaLabel}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A search box with a magnifier and a clear button. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <label>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-placeholder" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        className={`${input} pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden`}
      />
      </label>
      {value && (
        <button
          type="button"
          className={`absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted hover:bg-hover hover:text-ink ${focusRing}`}
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** A friendly "nothing here" panel with an optional next step. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  plain = false,
  heading = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Without the card, when it sits inside one already. */
  plain?: boolean;
  /** Make the title a heading (h2), when the panel is the page's content. */
  heading?: boolean;
}) {
  const Title = heading ? "h2" : "p";
  return (
    <div className={`${plain ? "" : card} grid justify-items-center gap-1.5 px-6 py-14 text-center`}>
      {icon && (
        <span className="mb-2 grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-text [&_svg]:size-5" aria-hidden="true">
          {icon}
        </span>
      )}
      <Title className="text-[0.9375rem] font-semibold">{title}</Title>
      {description && <p className="max-w-sm text-[0.8125rem] text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** A grey placeholder block while content loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-skeleton motion-reduce:animate-none ${className}`} aria-hidden="true" />;
}

/** A quiet spinning ring. */
export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent opacity-70 motion-reduce:animate-none ${className}`}
      aria-hidden="true"
    />
  );
}

const tones = {
  neutral: "bg-subtle text-muted",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-error-bg text-danger",
} as const;

/** A small status pill. */
export function Badge({ children, tone = "neutral", dot = false, title }: { children: ReactNode; tone?: keyof typeof tones; dot?: boolean; title?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]} ${
        dot ? "before:size-1.5 before:rounded-full before:bg-current" : ""
      }`}
      title={title}
    >
      {children}
    </span>
  );
}

/** Initials in a tinted circle, for a person with no picture. */
export function Avatar({ name, className = "size-8 text-xs" }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent-text ${className}`} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

/** One headline number: a label above it, and an optional note below. */
export function StatTile({ label, value, note, icon, loading = false }: { label: string; value: ReactNode; note?: ReactNode; icon?: ReactNode; loading?: boolean }) {
  return (
    <div className={`${card} min-w-0 px-4 py-4 sm:px-5`}>
      <dt className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted [&_svg]:size-4">
        {icon}
        {label}
      </dt>
      <dd className="mt-2 text-[1.75rem] leading-none font-semibold tracking-[-0.02em] tabular-nums">
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </dd>
      {note && <dd className="mt-2 line-clamp-2 text-xs text-muted">{note}</dd>}
    </div>
  );
}
