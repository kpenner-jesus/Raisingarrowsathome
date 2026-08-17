import { describe, it, expect } from "vitest";
import {
  parseOrgPath, resolveOrgSlug, orgPath, isPrimaryTenant, PRIMARY_TENANT_SLUG,
  normalizeHost, platformHostsFrom, isCandidateCustomDomain, normalizeCustomDomainInput,
  LEGACY_RAISING_ARROWS_HOSTS,
} from "./org-routing";

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

// ============================================================
//  Platform-host widening + custom-domain guards.
//
//  The existing 18 tests above are the contract and must NOT change: under
//  vitest none of the VERCEL_* / PLATFORM_HOSTS vars are set, so the default
//  host set is exactly the 7 original literals and "unknown host → null"
//  still holds. If a change here forces one of those to be edited, the change
//  is wrong.
// ============================================================
describe("normalizeHost", () => {
  it("lowercases and strips the port", () => {
    expect(normalizeHost("RaisingArrowsAtHome.COM:8080")).toBe("raisingarrowsathome.com");
  });
  it("strips a trailing FQDN dot (curl and some proxies send it)", () => {
    expect(normalizeHost("raisingarrowsathome.com.")).toBe("raisingarrowsathome.com");
  });
  it("keeps an IPv6 literal intact instead of mangling it to '['", () => {
    expect(normalizeHost("[::1]:3000")).toBe("[::1]");
  });
  it("tolerates a scheme or path being pasted in", () => {
    expect(normalizeHost("https://Grants.CedarChurch.org/")).toBe("grants.cedarchurch.org");
  });
  it("handles blanks", () => {
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost(null)).toBe("");
    expect(normalizeHost(undefined)).toBe("");
  });
});

describe("platformHostsFrom", () => {
  // The anti-regression test for this whole feature.
  it("with no env, is EXACTLY the original seven hosts", () => {
    const hosts = platformHostsFrom({});
    expect(hosts.size).toBe(LEGACY_RAISING_ARROWS_HOSTS.size);
    for (const h of Array.from(LEGACY_RAISING_ARROWS_HOSTS)) expect(hosts.has(h)).toBe(true);
  });

  it("adds the Vercel per-deployment hosts", () => {
    const hosts = platformHostsFrom({
      VERCEL_URL: "ra-abc123-team.vercel.app",
      VERCEL_BRANCH_URL: "ra-git-staging-team.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "raisingarrowsathome.com",
    });
    expect(hosts.has("ra-abc123-team.vercel.app")).toBe(true);
    expect(hosts.has("ra-git-staging-team.vercel.app")).toBe(true);
  });

  it("parses PLATFORM_HOSTS tolerantly", () => {
    const hosts = platformHostsFrom({ PLATFORM_HOSTS: "a.com, B.COM ,, c.com:8080 " });
    expect(hosts.has("a.com")).toBe(true);
    expect(hosts.has("b.com")).toBe(true);
    expect(hosts.has("c.com")).toBe(true);
  });

  it("normalizes a scheme-prefixed value", () => {
    expect(platformHostsFrom({ VERCEL_URL: "https://x.vercel.app" }).has("x.vercel.app")).toBe(true);
  });
});

describe("resolveOrgSlug with an explicit host set", () => {
  const hosts = platformHostsFrom({ VERCEL_BRANCH_URL: "ra-git-staging-team.vercel.app" });

  it("resolves a preview deployment to the platform tenant", () => {
    expect(resolveOrgSlug("ra-git-staging-team.vercel.app", "/admin", hosts)).toBe("raising-arrows");
  });

  // The security property. A populated set must not become a blanket allow.
  it("STILL returns null for an unknown host", () => {
    expect(resolveOrgSlug("evil.io", "/admin", hosts)).toBe(null);
    expect(resolveOrgSlug("attacker.example.com", "/admin", hosts)).toBe(null);
    expect(resolveOrgSlug("ra-git-other-team.vercel.app", "/admin", hosts)).toBe(null);
  });
});

describe("isCandidateCustomDomain", () => {
  it("accepts a plausible charity domain", () => {
    expect(isCandidateCustomDomain("grants.cedarchurch.org")).toBe(true);
    expect(isCandidateCustomDomain("cedarchurch.org")).toBe(true);
  });
  it("rejects anything not worth a database query", () => {
    for (const h of ["", "localhost", "app.localhost", "nodot", "[::1]", "192.168.1.1", "a.b" /* too short */]) {
      expect(isCandidateCustomDomain(h), h).toBe(false);
    }
  });
  it("rejects the platform's own hosts", () => {
    expect(isCandidateCustomDomain("raisingarrowsathome.com")).toBe(false);
    expect(isCandidateCustomDomain("staging.raisingarrowsathome.com")).toBe(false);
  });
  it("rejects an over-long host", () => {
    expect(isCandidateCustomDomain("a".repeat(250) + ".org")).toBe(false);
  });
});

describe("normalizeCustomDomainInput", () => {
  it("canonicalizes what an operator is likely to paste", () => {
    expect(normalizeCustomDomainInput("  HTTPS://Grants.CedarChurch.org/  ")).toBe("grants.cedarchurch.org");
  });
  it("treats empty as 'clear the domain'", () => {
    expect(normalizeCustomDomainInput("")).toBe(null);
    expect(normalizeCustomDomainInput("   ")).toBe(null);
    expect(normalizeCustomDomainInput(null)).toBe(null);
  });
  it("refuses values that would break routing", () => {
    for (const bad of ["not a domain", "localhost", "nodot", "1.2.3.4"]) {
      expect(normalizeCustomDomainInput(bad), bad).toBe(null);
    }
  });
  it("refuses a platform-owned vercel.app host", () => {
    expect(normalizeCustomDomainInput("someone-else.vercel.app")).toBe(null);
  });
});

describe("orgPath on a custom domain", () => {
  it("returns bare paths, like a legacy host", () => {
    expect(orgPath({ slug: "cedar-springs", prefixed: false }, "/admin")).toBe("/admin");
  });
});
