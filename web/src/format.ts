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
