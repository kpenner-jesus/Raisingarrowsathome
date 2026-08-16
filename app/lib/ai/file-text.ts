// ============================================================
//  file-text.ts — turn an attached data file into plain text the
//  assistant can read (grantee lists, receipts exports, etc).
//
//  Why client-side: the chat is stateless on the server — the client
//  holds the Anthropic message array and replays it every turn. If we
//  converted server-side we'd re-convert the same file on every turn.
//  Converting once, into a text block that lives in the history, keeps
//  the replay model intact.
//
//  Why no `xlsx`/SheetJS dependency: .xlsx is a zip of XML and JSZip is
//  already a dependency here, so we parse it directly. The npm `xlsx`
//  package (0.18.5) carries a known prototype-pollution advisory
//  (CVE-2023-30533); not worth pulling into an admin surface for a
//  format we can read with what we already ship.
//
//  Legacy .xls (binary BIFF) is NOT parseable this way — we detect it
//  and tell the user to re-save as .xlsx or .csv rather than failing
//  with something cryptic.
// ============================================================

/** Cap on extracted text. Grantee lists are small; this stops a giant
 *  workbook from blowing up the prompt (and the bill). ~20k tokens. */
export const MAX_FILE_TEXT = 80_000;

export type FileKind = "image" | "text" | "xlsx" | "xls" | "unsupported";

export interface ExtractedFile {
  name:      string;
  text:      string;
  truncated: boolean;
}

const TEXT_EXTS  = ["csv", "tsv", "txt", "md", "json", "log"];
const TEXT_MIMES = ["text/", "application/json"];

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Decide how to handle a file from its name + reported MIME type. */
export function sniffKind(name: string, mime: string): FileKind {
  const ext = extOf(name);
  if (mime.startsWith("image/")) return "image";
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls")  return "xls";
  if (TEXT_EXTS.includes(ext)) return "text";
  if (TEXT_MIMES.some((m) => mime.startsWith(m))) return "text";
  return "unsupported";
}

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_FILE_TEXT) return { text, truncated: false };
  return {
    text: text.slice(0, MAX_FILE_TEXT) + "\n\n…[truncated — file was too long to include in full]",
    truncated: true,
  };
}

// ── XLSX ─────────────────────────────────────────────────────

/** "BC12" → 54 (0-based column index). */
export function colToIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref.toUpperCase());
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Decode the XML entities Excel emits. &amp; must be last. */
export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Concatenate every <t> inside a shared-string <si> (handles rich-text runs). */
function siText(si: string): string {
  const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
  return decodeXml(parts.map((p) => p.replace(/<t[^>]*>([\s\S]*?)<\/t>/, "$1")).join(""));
}

/** Parse one worksheet's XML into CSV rows. */
export function sheetXmlToCsv(xml: string, shared: string[]): string {
  const out: string[] = [];
  const rows = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
  for (const row of rows) {
    const cells: string[] = [];
    const cellRe = /<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(row))) {
      const attrs = m[1] || "";
      const body  = m[2] || "";
      const refM  = /r="([A-Z]+)\d+"/.exec(attrs);
      const idx   = refM ? colToIndex(refM[1]) : cells.length;
      const typeM = /t="([^"]+)"/.exec(attrs);
      const type  = typeM ? typeM[1] : "";

      let value = "";
      if (type === "inlineStr") {
        const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
        value = t ? decodeXml(t[1]) : "";
      } else {
        const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body);
        const raw = v ? v[1] : "";
        if (type === "s") {
          value = shared[Number(raw)] ?? "";
        } else {
          value = decodeXml(raw);
        }
      }
      while (cells.length < idx) cells.push("");
      cells[idx] = value;
    }
    out.push(cells.map(csvCell).join(","));
  }
  return out.join("\n");
}

/**
 * Convert .xlsx bytes to text (one CSV block per sheet).
 * NOTE: dates/currency come through as Excel's raw serial numbers — we
 * deliberately don't interpret number formats. The assistant is told this
 * so it asks rather than guessing at an ambiguous value.
 */
export async function xlsxToText(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes as any);

  let shared: string[] = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    const xml = await sharedFile.async("string");
    shared = (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(siText);
  }

  // Sheet display names, in workbook order. Pairing them with sheetN.xml by
  // order is a heuristic (the authoritative map lives in workbook.xml.rels);
  // if it ever mismatches we still emit the data, just under a generic label.
  const names: string[] = [];
  const wb = zip.file("xl/workbook.xml");
  if (wb) {
    const xml = await wb.async("string");
    for (const s of xml.match(/<sheet[^>]*name="([^"]*)"[^>]*\/?>/g) || []) {
      const n = /name="([^"]*)"/.exec(s);
      if (n) names.push(decodeXml(n[1]));
    }
  }

  const sheetFiles = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(/sheet(\d+)\.xml/.exec(a)![1]);
      const nb = Number(/sheet(\d+)\.xml/.exec(b)![1]);
      return na - nb;
    });

  const blocks: string[] = [];
  for (let i = 0; i < sheetFiles.length; i++) {
    const xml = await zip.file(sheetFiles[i])!.async("string");
    const csv = sheetXmlToCsv(xml, shared);
    if (!csv.trim()) continue;
    blocks.push(`--- Sheet: ${names[i] ?? `Sheet ${i + 1}`} ---\n${csv}`);
  }
  return blocks.join("\n\n");
}

// ── Entry point ──────────────────────────────────────────────

/** Read a non-image File into plain text. Throws a user-facing message. */
export async function extractFileText(file: File): Promise<ExtractedFile> {
  const kind = sniffKind(file.name, file.type);

  if (kind === "xls") {
    throw new Error("Old .xls files can't be read directly — open it and save as .xlsx or .csv, then attach that.");
  }
  if (kind === "image" || kind === "unsupported") {
    throw new Error("Unsupported file type. Attach a spreadsheet (.xlsx), .csv, or a text file.");
  }

  let raw: string;
  if (kind === "xlsx") {
    raw = await xlsxToText(await file.arrayBuffer());
    if (!raw.trim()) throw new Error("That spreadsheet looks empty — no rows found.");
  } else {
    raw = await file.text();
    if (!raw.trim()) throw new Error("That file is empty.");
  }

  const { text, truncated } = clamp(raw);
  return { name: file.name, text, truncated };
}

/** Wrap extracted text so the model knows it's an attached file, not user prose. */
export function fileTextBlock(f: ExtractedFile): string {
  const note = f.name.toLowerCase().endsWith(".xlsx")
    ? " (converted from a spreadsheet; numeric dates/currency appear as raw values)"
    : "";
  return `[Attached file: ${f.name}${note}]\n\n${f.text}`;
}
