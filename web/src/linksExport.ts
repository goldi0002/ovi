import type { Link } from "./api";
import { csvRows, saveCsv } from "./csv";

/** The links as CSV text: code, short URL, destination, clicks, created and expires (ISO 8601, empty when it never expires). */
export function linksToCsv(links: Link[]): string {
  const rows: (string | number)[][] = [["code", "short_url", "destination", "clicks", "created", "expires"]];
  for (const l of links) rows.push([l.code, l.shortUrl, l.url, l.clicks, l.createdAt, l.expiresAt ?? ""]);
  return csvRows(rows);
}

/** The short URLs, one per line, for pasting. */
export function shortLinksText(links: Link[]): string {
  return links.map((l) => l.shortUrl).join("\n");
}

/** e.g. ovi-links-2026-11-27.csv */
export function linksFileName(now = new Date()): string {
  return `ovi-links-${now.toISOString().slice(0, 10)}.csv`;
}

/** Saves the links as a CSV file from the browser; nothing is sent anywhere. */
export function downloadLinksCsv(links: Link[]): void {
  saveCsv(linksToCsv(links), linksFileName());
}
