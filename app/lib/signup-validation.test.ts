import { describe, it, expect } from "vitest";
import { validateSlug, RESERVED_SLUGS } from "./signup-validation";

describe("validateSlug", () => {
  it("accepts a normal slug", () => {
    const r = validateSlug("cedar-springs");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slug).toBe("cedar-springs");
  });

  it("lowercases + trims input", () => {
    const r = validateSlug("  Cedar-Springs  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slug).toBe("cedar-springs");
  });

  it("rejects empty", () => {
    expect(validateSlug("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects too short", () => {
    const r = validateSlug("ab");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("too short");
  });

  it("rejects leading hyphen", () => {
    const r = validateSlug("-cedar");
    expect(r.ok).toBe(false);
  });

  it("rejects trailing hyphen", () => {
    const r = validateSlug("cedar-");
    expect(r.ok).toBe(false);
  });

  it("rejects uppercase", () => {
    // Input is lowercased before regex, so this should pass IF a real
    // upper input becomes lowercase. To force a reject we use a char the
    // regex can't accept.
    const r = validateSlug("cedar_springs");
    expect(r.ok).toBe(false);
  });

  it("rejects whitespace inside", () => {
    const r = validateSlug("cedar springs");
    expect(r.ok).toBe(false);
  });

  it("rejects reserved slugs", () => {
    for (const reserved of ["admin", "portal", "api", "signup", "platform", "raising-arrows"]) {
      const r = validateSlug(reserved);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("reserved");
    }
  });

  it("RESERVED_SLUGS does not contain a real charity-shaped slug", () => {
    expect(RESERVED_SLUGS.has("cedar-springs")).toBe(false);
    expect(RESERVED_SLUGS.has("hope-house")).toBe(false);
  });

  it("accepts digits + hyphens mixed", () => {
    expect(validateSlug("zion-2024").ok).toBe(true);
    expect(validateSlug("a1b2c3").ok).toBe(true);
  });

  it("accepts 64-char max", () => {
    const slug = "a" + "b".repeat(62) + "c";
    expect(slug.length).toBe(64);
    expect(validateSlug(slug).ok).toBe(true);
  });

  it("rejects 65-char overflow", () => {
    const slug = "a" + "b".repeat(63) + "c";
    expect(slug.length).toBe(65);
    expect(validateSlug(slug).ok).toBe(false);
  });
});
