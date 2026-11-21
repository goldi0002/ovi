import type { Link } from "./api";

// Pure helpers for bulk shortening: reading the pasted list, mapping server errors to lines, and the CSV download.

/** The most URLs one bulk request may hold; the server enforces the same limit. */
export const MAX_BULK_URLS = 25;

const LINE_BREAK = /\r\n|\n|\r/;

export interface UrlLine {
  url: string;
  /** 1-based line number in the text, counting blank lines, as the user sees it. */
  line: number;
}

/** The non-blank lines, trimmed, with their line numbers. Item i is what the server calls urls[i]. */
export function parseUrlLines(text: string): UrlLine[] {
  const lines: UrlLine[] = [];
  text.split(LINE_BREAK).forEach((raw, i) => {
    const url = raw.trim();
    if (url) lines.push({ url, line: i + 1 });
  });
  return lines;
}

/** One URL per line: trims each line, drops blank ones, keeps order and duplicates. */
export function parseUrls(text: string): string[] {
  return parseUrlLines(text).map((l) => l.url);
}

/** Where line `line` (1-based) starts and ends in `text`, for selecting it in a textarea. */
export function lineRange(text: string, line: number): { start: number; end: number } {
  // Same line breaks as parseUrlLines (\r\n, \n or \r), so the numbers agree.
  const breaks = [...text.matchAll(/\r\n|\n|\r/g)];
  const index = Math.min(Math.max(line, 1), breaks.length + 1) - 1;
  const start = index === 0 ? 0 : breaks[index - 1].index + breaks[index - 1][0].length;
  const end = index < breaks.length ? breaks[index].index : text.length;
  return { start, end };
}

export interface BulkItemError {
  /** Zero-based position in the list sent (the n-th non-blank line). */
  index: number;
  message: string;
}

/** The per-URL errors from a 400 (keys like "urls[3]"), in list order. */
export function bulkErrors(fieldErrors: Record<string, string[]>): BulkItemError[] {
  const errors: BulkItemError[] = [];
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const match = /^urls\[(\d+)\]$/i.exec(key);
    if (match && messages.length > 0) errors.push({ index: Number(match[1]), message: messages[0] });
  }
  return errors.sort((a, b) => a.index - b.index);
}

// Spreadsheets run a cell that starts with one of these as a formula (OWASP "CSV injection").
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return guarded !== value || /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** RFC 4180 CSV (CRLF line endings) of the links, one row each, in order. */
export function toCsv(links: Link[]): string {
  const rows = [["url", "short_url", "code", "expires_at"]];
  for (const link of links) rows.push([link.url, link.shortUrl, link.code, link.expiresAt ?? ""]);
  return rows.map((row) => row.map(csvCell).join(",") + "\r\n").join("");
}

/** "ovi-links-2026-11-18.csv", using the user's local date. */
export function csvFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `ovi-links-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
}

/** Saves the CSV through a temporary object URL; a BOM lets Excel read non-ASCII URLs as UTF-8. */
export function downloadCsv(links: Link[], now = new Date()): void {
  const url = URL.createObjectURL(new Blob(["﻿", toCsv(links)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFileName(now);
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled, so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
