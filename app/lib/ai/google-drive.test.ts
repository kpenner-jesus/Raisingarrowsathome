import { describe, it, expect } from "vitest";
import { exportSpec, driveFileName, downloadUrl, MAX_DRIVE_BYTES, DRIVE_SCOPE } from "./google-drive";
import { sniffKind } from "./file-text";

describe("DRIVE_SCOPE", () => {
  it("is per-file, never whole-Drive", () => {
    // drive.readonly would put the app into Google's restricted-scope review.
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });
});

describe("exportSpec", () => {
  it("exports a Google Sheet as xlsx so every tab survives", () => {
    const s = exportSpec("application/vnd.google-apps.spreadsheet");
    expect(s).toEqual({ mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" });
  });
  it("exports a Google Doc as plain text", () => {
    expect(exportSpec("application/vnd.google-apps.document")).toEqual({ mime: "text/plain", ext: "txt" });
  });
  it("exports slides and drawings as PDF", () => {
    expect(exportSpec("application/vnd.google-apps.presentation")?.ext).toBe("pdf");
    expect(exportSpec("application/vnd.google-apps.drawing")?.ext).toBe("pdf");
  });
  it("returns null for ordinary uploaded files (they download as-is)", () => {
    expect(exportSpec("application/pdf")).toBe(null);
    expect(exportSpec("image/jpeg")).toBe(null);
    expect(exportSpec("text/csv")).toBe(null);
  });
});

describe("driveFileName", () => {
  it("adds the export extension to a Google-native name", () => {
    expect(driveFileName("Grantees 2026", "xlsx")).toBe("Grantees 2026.xlsx");
  });
  it("doesn't double up an extension already present", () => {
    expect(driveFileName("list.xlsx", "xlsx")).toBe("list.xlsx");
    expect(driveFileName("LIST.XLSX", "xlsx")).toBe("LIST.XLSX");
  });
  it("leaves ordinary downloads untouched", () => {
    expect(driveFileName("receipt.pdf", null)).toBe("receipt.pdf");
  });
  it("never produces an empty name", () => {
    expect(driveFileName("", null)).toBe("file");
    expect(driveFileName("   ", "csv")).toBe("file.csv");
  });

  // The whole point of naming: the existing pipeline routes on the result.
  it("produces names the attachment pipeline routes correctly", () => {
    expect(sniffKind(driveFileName("Grantees 2026", "xlsx"), "")).toBe("xlsx");
    expect(sniffKind(driveFileName("Notes", "txt"), "")).toBe("text");
    expect(sniffKind(driveFileName("Deck", "pdf"), "")).toBe("pdf");
  });
});

describe("downloadUrl", () => {
  it("uses /export for native docs", () => {
    const u = downloadUrl("abc123", { mime: "text/plain", ext: "txt" });
    expect(u).toBe("https://www.googleapis.com/drive/v3/files/abc123/export?mimeType=text%2Fplain");
  });
  it("uses alt=media for ordinary files", () => {
    expect(downloadUrl("abc123", null)).toBe("https://www.googleapis.com/drive/v3/files/abc123?alt=media");
  });
  it("escapes a hostile file id instead of interpolating it raw", () => {
    expect(downloadUrl("a/../b?x=1", null)).toBe("https://www.googleapis.com/drive/v3/files/a%2F..%2Fb%3Fx%3D1?alt=media");
  });
});

describe("MAX_DRIVE_BYTES", () => {
  it("is a sane pre-download ceiling", () => {
    expect(MAX_DRIVE_BYTES).toBeGreaterThan(5 * 1024 * 1024);
    expect(MAX_DRIVE_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);
  });
});
