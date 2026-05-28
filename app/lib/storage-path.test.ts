import { describe, it, expect } from "vitest";
import {
  buildTenantUploadPath,
  validatePortalUploadPath,
  assertPathBelongsToOrg,
} from "./storage-path";

const USER = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ORG  = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const OTHR = "cccccccc-cccc-4ccc-cccc-cccccccccccc";

describe("buildTenantUploadPath", () => {
  it("joins user, org, file into 3-segment path", () => {
    expect(buildTenantUploadPath(USER, ORG, "abc.jpg")).toBe(`${USER}/${ORG}/abc.jpg`);
  });
});

describe("validatePortalUploadPath", () => {
  it("accepts <user>/<org>/<file> layout", () => {
    const r = validatePortalUploadPath(`${USER}/${ORG}/abc.jpg`, USER, ORG);
    expect(r.ok).toBe(true);
  });

  it("rejects legacy 2-segment <user>/<file> layout", () => {
    const r = validatePortalUploadPath(`${USER}/abc.jpg`, USER, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/<user_id>\/<org_id>\/<file>/);
  });

  it("rejects wrong user folder", () => {
    const r = validatePortalUploadPath(`${OTHR}/${ORG}/abc.jpg`, USER, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/own folder/);
  });

  it("rejects mismatched tenant segment", () => {
    const r = validatePortalUploadPath(`${USER}/${OTHR}/abc.jpg`, USER, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tenant segment does not match/);
  });

  it("rejects non-UUID tenant segment", () => {
    const r = validatePortalUploadPath(`${USER}/notuuid/abc.jpg`, USER, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid image_path tenant segment/);
  });

  it("rejects path traversal", () => {
    const r = validatePortalUploadPath(`${USER}/${ORG}/../etc/passwd`, USER, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid image_path/);
  });

  it("rejects backslashes and NULs", () => {
    expect(validatePortalUploadPath(`${USER}\\${ORG}\\abc.jpg`, USER, ORG).ok).toBe(false);
    expect(validatePortalUploadPath(`${USER}/${ORG}/abc\0.jpg`, USER, ORG).ok).toBe(false);
  });

  it("rejects empty / non-string", () => {
    expect(validatePortalUploadPath("", USER, ORG).ok).toBe(false);
    expect(validatePortalUploadPath(undefined, USER, ORG).ok).toBe(false);
    expect(validatePortalUploadPath(null, USER, ORG).ok).toBe(false);
    expect(validatePortalUploadPath(42, USER, ORG).ok).toBe(false);
  });

  it("rejects too-deep paths (4+ segments)", () => {
    const r = validatePortalUploadPath(`${USER}/${ORG}/sub/abc.jpg`, USER, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/<user_id>\/<org_id>\/<file>/);
  });

  it("case-insensitive org comparison", () => {
    const r = validatePortalUploadPath(`${USER}/${ORG.toUpperCase()}/abc.jpg`, USER, ORG);
    expect(r.ok).toBe(true);
  });
});

describe("assertPathBelongsToOrg", () => {
  it("passes for matching tenant segment", () => {
    expect(() => assertPathBelongsToOrg(`${USER}/${ORG}/abc.jpg`, ORG)).not.toThrow();
  });

  it("throws on mismatched tenant segment", () => {
    expect(() => assertPathBelongsToOrg(`${USER}/${OTHR}/abc.jpg`, ORG))
      .toThrow(/does not belong to this tenant/);
  });

  it("throws on legacy 2-segment path (no tenant info)", () => {
    expect(() => assertPathBelongsToOrg(`${USER}/abc.jpg`, ORG))
      .toThrow(/storage path layout is invalid/);
  });

  it("throws on non-UUID tenant segment", () => {
    expect(() => assertPathBelongsToOrg(`${USER}/notuuid/abc.jpg`, ORG))
      .toThrow(/does not belong to this tenant/);
  });

  it("case-insensitive tenant match", () => {
    expect(() => assertPathBelongsToOrg(`${USER}/${ORG.toUpperCase()}/abc.jpg`, ORG)).not.toThrow();
  });
});
