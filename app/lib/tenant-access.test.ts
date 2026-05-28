import { describe, it, expect } from "vitest";
import { isTenantAccessBlocked, TENANT_ACTIVE_STATUSES } from "./tenant-access";

describe("isTenantAccessBlocked", () => {
  it("allows the active statuses", () => {
    for (const s of TENANT_ACTIVE_STATUSES) {
      expect(isTenantAccessBlocked(s)).toBe(false);
    }
  });

  it("blocks explicit stop statuses", () => {
    expect(isTenantAccessBlocked("paused")).toBe(true);
    expect(isTenantAccessBlocked("canceled")).toBe(true);
  });

  it("blocks raw Stripe lapsed statuses the webhook can write", () => {
    // The whole point of the allow-list: these are NOT in the deny-list of
    // {paused,canceled} but must still block.
    expect(isTenantAccessBlocked("unpaid")).toBe(true);
    expect(isTenantAccessBlocked("incomplete")).toBe(true);
    expect(isTenantAccessBlocked("incomplete_expired")).toBe(true);
  });

  it("blocks unknown / empty / null statuses (fail-closed)", () => {
    expect(isTenantAccessBlocked("")).toBe(true);
    expect(isTenantAccessBlocked(null)).toBe(true);
    expect(isTenantAccessBlocked(undefined)).toBe(true);
    expect(isTenantAccessBlocked("some-future-status")).toBe(true);
  });

  it("active allow-list is exactly the 4 expected statuses", () => {
    expect([...TENANT_ACTIVE_STATUSES].sort()).toEqual(["active", "free", "past_due", "trialing"]);
  });
});
