const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** "3 minutes ago", "in 2 days" and so on. */
export function formatRelative(iso: string, now = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(seconds, "second");
}

/** Converts a <input type="datetime-local"> value (local time) to an ISO string with offset. */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Converts an API time (ISO, UTC) to a <input type="datetime-local"> value in local time, to the minute; "" for none. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

const shortDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Formats an API date ("2026-11-16", a UTC day) as "Nov 16", or "Mon, Nov 16" when long. */
export function formatDay(date: string, long = false): string {
  return (long ? longDay : shortDay).format(new Date(`${date}T00:00:00Z`));
}

/** Rounds up to a clean axis maximum (1, 2, 5, 10, 20, 50, …), never below 4 so small counts get whole-number ticks. */
export function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** A URL without its scheme, for display: "https://ovi.app/abc" → "ovi.app/abc". */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
