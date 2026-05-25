import { describe, it, expect } from "vitest";
import { validateBrandColor, validateLogoUrl } from "./branding-validation";

describe("validateBrandColor", () => {
  it("accepts lowercase hex", () => {
    const r = validateBrandColor("#e8793a");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("#e8793a");
  });

  it("accepts uppercase hex", () => {
    const r = validateBrandColor("#E8793A");
    expect(r.ok).toBe(true);
  });

  it("trims whitespace", () => {
    const r = validateBrandColor("  #e8793a  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("#e8793a");
  });

  it("rejects empty string", () => {
    expect(validateBrandColor("").ok).toBe(false);
  });

  it("rejects missing #", () => {
    expect(validateBrandColor("e8793a").ok).toBe(false);
  });

  it("rejects 3-digit shorthand", () => {
    expect(validateBrandColor("#abc").ok).toBe(false);
  });

  it("rejects 8-digit alpha hex", () => {
    expect(validateBrandColor("#e8793aff").ok).toBe(false);
  });

  it("rejects non-hex chars", () => {
    expect(validateBrandColor("#zzzzzz").ok).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(validateBrandColor(null).ok).toBe(false);
    expect(validateBrandColor(123).ok).toBe(false);
    expect(validateBrandColor(undefined).ok).toBe(false);
  });
});

describe("validateLogoUrl", () => {
  it("accepts https URL", () => {
    const r = validateLogoUrl("https://example.com/logo.png");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("https://example.com/logo.png");
  });

  it("rejects http URL (mixed-content risk)", () => {
    const r = validateLogoUrl("http://example.com/logo.png");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("https://");
  });

  it("rejects javascript: URL", () => {
    expect(validateLogoUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects data: URL", () => {
    expect(validateLogoUrl("data:image/png;base64,abc").ok).toBe(false);
  });

  it("treats null as 'clear'", () => {
    const r = validateLogoUrl(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(null);
  });

  it("treats empty string as 'clear'", () => {
    const r = validateLogoUrl("");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(null);
  });

  it("treats whitespace-only as 'clear'", () => {
    const r = validateLogoUrl("   ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(null);
  });

  it("trims whitespace around valid URL", () => {
    const r = validateLogoUrl("  https://example.com/logo.png  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("https://example.com/logo.png");
  });

  it("rejects non-string non-null input", () => {
    expect(validateLogoUrl(123).ok).toBe(false);
    expect(validateLogoUrl({}).ok).toBe(false);
  });
});
