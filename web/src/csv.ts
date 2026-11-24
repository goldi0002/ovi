// Shared CSV writing for the bulk links export and the stats export.

// Spreadsheets run a cell that starts with one of these as a formula (OWASP "CSV injection").
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formulas are defused with a leading ', and cells with commas, quotes or line breaks are quoted. */
export function csvCell(value: string | number): string {
  const text = String(value);
  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  return guarded !== text || /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** RFC 4180 CSV text, CRLF after every row. */
export function csvRows(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",") + "\r\n").join("");
}

/** Saves CSV text as a file through a temporary object URL; a BOM lets Excel read non-ASCII text as UTF-8. */
export function saveCsv(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled, so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
