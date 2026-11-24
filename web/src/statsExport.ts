import type { LinkStats } from "./api";
import { csvRows, saveCsv } from "./csv";

/** The longest range the API accepts (LinkEndpoints.MaxStatsDays). */
export const MAX_STATS_DAYS = 365;
export const RANGES = [7, 30, 90] as const;
export const DEFAULT_RANGE = 30;

/** Reads a `days` value from the URL. Anything that isn't one of the offered ranges falls back to 30. */
export function parseRange(value: string | null | undefined): number {
  if (value == null || !/^\d+$/.test(value)) return DEFAULT_RANGE;
  const n = Number(value);
  return (RANGES as readonly number[]).includes(n) && n <= MAX_STATS_DAYS ? n : DEFAULT_RANGE;
}

/** The stats as CSV text: one row per day, referrer, device and browser. */
export function statsToCsv(stats: LinkStats): string {
  const rows: (string | number)[][] = [["section", "name", "clicks"]];
  for (const d of stats.daily) rows.push(["daily", d.date, d.clicks]);
  for (const r of stats.referrers) rows.push(["referrer", r.name, r.clicks]);
  for (const r of stats.devices) rows.push(["device", r.name, r.clicks]);
  for (const r of stats.browsers) rows.push(["browser", r.name, r.clicks]);
  return csvRows(rows);
}

/** e.g. ovi-docs-stats-30d-2026-11-16.csv */
export function statsFileName(stats: LinkStats): string {
  const code = stats.code.replace(/[^A-Za-z0-9_-]/g, "_");
  const last = stats.daily[stats.daily.length - 1]?.date;
  return `ovi-${code}-stats-${stats.days}d${last ? `-${last}` : ""}.csv`;
}

/** Saves the stats as a CSV file from the browser; nothing is sent anywhere. */
export function downloadStatsCsv(stats: LinkStats): void {
  saveCsv(statsToCsv(stats), statsFileName(stats));
}
