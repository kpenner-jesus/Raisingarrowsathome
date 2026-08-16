import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  sniffKind, extOf, colToIndex, decodeXml, sheetXmlToCsv, xlsxToText, fileTextBlock, MAX_FILE_TEXT,
} from "./file-text";

describe("sniffKind", () => {
  it("detects images by mime", () => {
    expect(sniffKind("receipt.jpg", "image/jpeg")).toBe("image");
    expect(sniffKind("shot.png", "image/png")).toBe("image");
  });
  it("detects spreadsheets + legacy xls by extension", () => {
    expect(sniffKind("grantees.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
    expect(sniffKind("old.xls", "application/vnd.ms-excel")).toBe("xls");
  });
  it("detects text formats by extension even with a blank mime", () => {
    for (const n of ["a.csv", "a.tsv", "a.txt", "a.md", "a.json", "a.log"]) {
      expect(sniffKind(n, "")).toBe("text");
    }
  });
  it("falls back to mime for text", () => {
    expect(sniffKind("noext", "text/plain")).toBe("text");
    expect(sniffKind("noext", "application/json")).toBe("text");
  });
  it("rejects unknown binaries", () => {
    expect(sniffKind("a.pdf", "application/pdf")).toBe("unsupported");
    expect(sniffKind("a.zip", "application/zip")).toBe("unsupported");
  });
  it("is case-insensitive on extension", () => {
    expect(sniffKind("GRANTEES.XLSX", "")).toBe("xlsx");
    expect(sniffKind("List.CSV", "")).toBe("text");
  });
});

describe("extOf", () => {
  it("handles dotted names and no extension", () => {
    expect(extOf("my.grantee.list.csv")).toBe("csv");
    expect(extOf("noextension")).toBe("");
  });
});

describe("colToIndex", () => {
  it("maps spreadsheet columns to 0-based indexes", () => {
    expect(colToIndex("A1")).toBe(0);
    expect(colToIndex("B2")).toBe(1);
    expect(colToIndex("Z9")).toBe(25);
    expect(colToIndex("AA1")).toBe(26);
    expect(colToIndex("AB1")).toBe(27);
    expect(colToIndex("BA1")).toBe(52);
  });
});

describe("decodeXml", () => {
  it("decodes entities with &amp; resolved last (no double-decode)", () => {
    expect(decodeXml("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeXml("&lt;tag&gt;")).toBe("<tag>");
    expect(decodeXml("&quot;q&quot; &apos;a&apos;")).toBe('"q" \'a\'');
    // &amp;lt; must decode to the literal "&lt;", not to "<"
    expect(decodeXml("&amp;lt;")).toBe("&lt;");
  });
});

describe("sheetXmlToCsv", () => {
  it("resolves shared strings, inline strings and numbers", () => {
    const xml = `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
                `<row r="2"><c r="A2" t="inlineStr"><is><t>Penner</t></is></c><c r="B2"><v>1200</v></c></row>`;
    const csv = sheetXmlToCsv(xml, ["Name", "Amount"]);
    expect(csv).toBe("Name,Amount\nPenner,1200");
  });

  it("pads gaps so columns stay aligned", () => {
    const xml = `<row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>`;
    expect(sheetXmlToCsv(xml, [])).toBe("1,,3");
  });

  it("quotes cells containing commas or quotes", () => {
    const xml = `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`;
    const csv = sheetXmlToCsv(xml, ['Smith, John', 'He said "hi"']);
    expect(csv).toBe('"Smith, John","He said ""hi"""');
  });

  it("handles self-closing empty cells", () => {
    const xml = `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"/><c r="C1"><v>7</v></c></row>`;
    expect(sheetXmlToCsv(xml, ["X"])).toBe("X,,7");
  });
});

/** Build a minimal but real .xlsx so the parser is tested against actual zip+XML. */
async function makeXlsx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("xl/workbook.xml",
    `<?xml version="1.0"?><workbook><sheets><sheet name="Grantees" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst><si><t>Parent</t></si><si><t>Email</t></si>` +
    `<si><t>Penner &amp; Co</t></si><si><t>a@b.com</t></si></sst>`);
  zip.file("xl/worksheets/sheet1.xml",
    `<?xml version="1.0"?><worksheet><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
    `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>` +
    `</sheetData></worksheet>`);
  return zip.generateAsync({ type: "uint8array" });
}

describe("xlsxToText (real zip round-trip)", () => {
  it("parses a genuine xlsx into labelled CSV", async () => {
    const text = await xlsxToText(await makeXlsx());
    expect(text).toContain("--- Sheet: Grantees ---");
    expect(text).toContain("Parent,Email");
    // entity-decoded, and the comma-free value stays unquoted
    expect(text).toContain("Penner & Co,a@b.com");
  });

  it("returns empty string when there are no rows", async () => {
    const zip = new JSZip();
    zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData></sheetData></worksheet>`);
    expect((await xlsxToText(await zip.generateAsync({ type: "uint8array" }))).trim()).toBe("");
  });
});

describe("fileTextBlock", () => {
  it("labels the attachment so the model treats it as a file", () => {
    const out = fileTextBlock({ name: "list.csv", text: "a,b", truncated: false });
    expect(out.startsWith("[Attached file: list.csv]")).toBe(true);
    expect(out).toContain("a,b");
  });
  it("warns about raw numeric dates for spreadsheets", () => {
    const out = fileTextBlock({ name: "list.xlsx", text: "x", truncated: false });
    expect(out).toContain("converted from a spreadsheet");
  });
});

describe("MAX_FILE_TEXT", () => {
  it("is a sane prompt-sized cap", () => {
    expect(MAX_FILE_TEXT).toBeGreaterThan(10_000);
    expect(MAX_FILE_TEXT).toBeLessThanOrEqual(200_000);
  });
});
