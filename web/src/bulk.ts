import type { Link } from "./api";
import { csvRows, saveCsv } from "./csv";

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

export interface BulkRow extends UrlLine {
  /** From the CSV's code column; the server checks it. */
  code?: string;
  /** From the CSV's expires_at column, as an ISO time. */
  expiresAt?: string;
}

export interface BulkProblem {
  line: number;
  url: string;
  message: string;
}

export interface ParsedBulk {
  rows: BulkRow[];
  /** True when the first line is a CSV header (url, code, expires_at), so each line has up to three columns. */
  csv: boolean;
  /** Problems found here, before anything is sent (an expires_at that isn't a date). */
  problems: BulkProblem[];
}

const CSV_COLUMNS = new Set(["url", "code", "custom_code", "customcode", "expires_at", "expires", "short_url"]);

/** Splits one CSV line, honouring "quoted, cells" and "" for a quote. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);
  return cells.map((x) => x.trim());
}

/**
 * Reads the box: plain lines (one URL each) or, when the first line is a header such as `url,code,expires_at`, a CSV with
 * an optional code and expiry per link. Lines are numbered as the user sees them, blank ones included.
 */
export function parseBulkInput(text: string): ParsedBulk {
  const clean = text.replace(/^\uFEFF/, "");
  const first = parseUrlLines(clean)[0];
  const header = first ? splitCsvLine(first.url).map((c) => c.toLowerCase()) : [];
  if (!header.includes("url") || !header.every((c) => CSV_COLUMNS.has(c))) {
    return { rows: parseUrlLines(clean), csv: false, problems: [] };
  }

  const column = (...names: string[]) => header.findIndex((c) => names.includes(c));
  const urlAt = column("url");
  const codeAt = column("code", "custom_code", "customcode");
  const expiresAt = column("expires_at", "expires");
  const rows: BulkRow[] = [];
  const problems: BulkProblem[] = [];
  for (const { url: raw, line } of parseUrlLines(clean).slice(1)) {
    const cells = splitCsvLine(raw);
    const row: BulkRow = { url: cells[urlAt] ?? "", line };
    if (codeAt >= 0 && cells[codeAt]) row.code = cells[codeAt];
    const when = expiresAt >= 0 ? cells[expiresAt] : "";
    if (when) {
      const date = new Date(when);
      if (Number.isNaN(date.getTime())) problems.push({ line, url: row.url, message: `"${when}" isn't a date. Use a form like 2030-01-31 or 2030-01-31T09:00:00Z.` });
      else row.expiresAt = date.toISOString();
    }
    rows.push(row);
  }
  return { rows, csv: true, problems };
}

export interface BulkItemError {
  /** Zero-based position in the list sent (the n-th non-blank line). */
  index: number;
  message: string;
}

/** The per-link errors from a 400 (keys like "urls[3]" or "items[3].customCode"), in list order. */
export function bulkErrors(fieldErrors: Record<string, string[]>): BulkItemError[] {
  const errors: BulkItemError[] = [];
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const match = /^(?:urls\[(\d+)\]|items\[(\d+)\]\.\w+)$/i.exec(key);
    if (match && messages.length > 0) errors.push({ index: Number(match[1] ?? match[2]), message: messages[0] });
  }
  return errors.sort((a, b) => a.index - b.index);
}

/** RFC 4180 CSV (CRLF line endings) of the links, one row each, in order. */
export function toCsv(links: Link[]): string {
  const rows = [["url", "short_url", "code", "expires_at"]];
  for (const link of links) rows.push([link.url, link.shortUrl, link.code, link.expiresAt ?? ""]);
  return csvRows(rows);
}

/** "ovi-links-2026-11-18.csv", using the user's local date. */
export function csvFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `ovi-links-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
}

/** Saves the links as a CSV file. */
export function downloadCsv(links: Link[], now = new Date()): void {
  saveCsv(toCsv(links), csvFileName(now));
}
