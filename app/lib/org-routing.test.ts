import { describe, it, expect } from "vitest";
import { parseOrgPath, resolveOrgSlug, orgPath, isPrimaryTenant, PRIMARY_TENANT_SLUG } from "./org-routing";

describe("parseOrgPath", () => {
  it("parses /o/<slug>/admin", () => {
    const r = parseOrgPath("/o/cedar-springs/admin");
    expect(r).toEqual({ slug: "cedar-springs", rest: "/admin" });
  });

  it("parses bare /o/<slug>", () => {
    const r = parseOrgPath("/o/cedar-springs");
    expect(r).toEqual({ slug: "cedar-springs", rest: "/" });
  });

  it("parses deep paths", () => {
    const r = parseOrgPath("/o/hope-house/admin/applications/abc-123");
    expect(r).toEqual({ slug: "hope-house", rest: "/admin/applications/abc-123" });
  });

  it("returns null for non-/o/ paths", () => {
    expect(parseOrgPath("/admin")).toBe(null);
    expect(parseOrgPath("/portal/receipts")).toBe(null);
    expect(parseOrgPath("/signup")).toBe(null);
    expect(parseOrgPath("/")).toBe(null);
  });

  it("rejects slug with uppercase", () => {
    expect(parseOrgPath("/o/Cedar-Springs/admin")).toBe(null);
  });

  it("rejects slug starting with hyphen", () => {
    expect(parseOrgPath("/o/-cedar/admin")).toBe(null);
  });

  it("rejects /o/ alone (no slug)", () => {
    expect(parseOrgPath("/o/")).toBe(null);
  });
});

describe("resolveOrgSlug", () => {
  it("path-routed wins over host", () => {
    const r = resolveOrgSlug("raisingarrowsathome.com", "/o/cedar-springs/admin");
    expect(r).toBe("cedar-springs");
  });

  it("legacy host → raising-arrows", () => {
    expect(resolveOrgSlug("raisingarrowsathome.com", "/admin")).toBe("raising-arrows");
    expect(resolveOrgSlug("www.raisingarrowsathome.com", "/admin")).toBe("raising-arrows");
    expect(resolveOrgSlug("staging.raisingarrowsathome.com", "/admin")).toBe("raising-arrows");
    expect(resolveOrgSlug("raising.wildernessedge.biz", "/admin")).toBe("raising-arrows");
    expect(resolveOrgSlug("raising-staging.wildernessedge.biz", "/admin")).toBe("raising-arrows");
  });

  it("localhost → raising-arrows for dev convenience", () => {
    expect(resolveOrgSlug("localhost", "/admin")).toBe("raising-arrows");
    expect(resolveOrgSlug("localhost:3000", "/admin")).toBe("raising-arrows");
    expect(resolveOrgSlug("foo.localhost", "/admin")).toBe("raising-arrows");
  });

  it("unknown host → null", () => {
    expect(resolveOrgSlug("attacker.example.com", "/admin")).toBe(null);
    expect(resolveOrgSlug("evil.io", "/admin")).toBe(null);
  });

  it("host casing is normalized", () => {
    expect(resolveOrgSlug("RAISINGARROWSATHOME.COM", "/admin")).toBe("raising-arrows");
  });

  it("port stripping", () => {
    expect(resolveOrgSlug("raisingarrowsathome.com:8080", "/admin")).toBe("raising-arrows");
  });
});

describe("isPrimaryTenant", () => {
  it("true only for the platform's own charity slug", () => {
    expect(isPrimaryTenant(PRIMARY_TENANT_SLUG)).toBe(true);
    expect(isPrimaryTenant("raising-arrows")).toBe(true);
  });
  it("false for SaaS subscriber tenants and empty values", () => {
    expect(isPrimaryTenant("cedar-springs")).toBe(false);
    expect(isPrimaryTenant("hope-house")).toBe(false);
    expect(isPrimaryTenant(null)).toBe(false);
    expect(isPrimaryTenant(undefined)).toBe(false);
  });
});

describe("orgPath", () => {
  const legacyCtx = { slug: "raising-arrows", prefixed: false };
  const pathCtx   = { slug: "cedar-springs", prefixed: true };

  it("passes through path when ctx is null", () => {
    expect(orgPath(null, "/admin")).toBe("/admin");
  });

  it("passes through path when not prefixed", () => {
    expect(orgPath(legacyCtx, "/admin/applications")).toBe("/admin/applications");
  });

  it("prefixes with /o/<slug>/ when prefixed", () => {
    expect(orgPath(pathCtx, "/admin/applications")).toBe("/o/cedar-springs/admin/applications");
  });

  it("handles paths without leading slash", () => {
    expect(orgPath(pathCtx, "admin")).toBe("/o/cedar-springs/admin");
  });

  it("preserves deep paths + query strings", () => {
    expect(orgPath(pathCtx, "/admin/applications/abc?status=pending")).toBe("/o/cedar-springs/admin/applications/abc?status=pending");
  });
});
