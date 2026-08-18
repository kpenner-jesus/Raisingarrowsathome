// ============================================================
//  What production is guaranteed NOT to do.
//
//  These two features exist only for the practice site. This file
//  pins the promises made about the live one:
//
//    1. the erase button cannot run, cannot be offered, and stays
//       refused even if its settings are switched on by mistake
//    2. real email goes to the real recipient, unaltered — never
//       diverted to whichever admin happens to be signed in
//
//  If a future change breaks either, this fails rather than a
//  charity finding out.
// ============================================================

import { describe, it, expect } from "vitest";
import { resetGuard, resetAvailable, RESET_PHRASE } from "./staging-reset";
import { routeRecipients, routedSubject, routedNotice } from "./email-env";

// Production's real shape: VERCEL_ENV is set by the platform, and the database
// is the production Supabase project.
const PRODUCTION = {
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://otwrxfjytbhzdkwiebeu.supabase.co",
};

describe("production can never erase data", () => {
  it("does not offer the button", () => {
    expect(resetAvailable(PRODUCTION)).toBe(false);
  });

  it("refuses the request even with the correct phrase typed", () => {
    const r = resetGuard(PRODUCTION, RESET_PHRASE);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/production deployment/);
  });

  it("STILL refuses if the enabling setting is switched on by mistake", () => {
    // The scenario worth pinning: someone copies the practice settings onto
    // production, or ticks the wrong environment box in the dashboard.
    const misconfigured = {
      ...PRODUCTION,
      RESET_ALLOWED_SUPABASE_REF: "otwrxfjytbhzdkwiebeu",   // pointed at production itself
    };
    expect(resetGuard(misconfigured, RESET_PHRASE).allowed).toBe(false);
    expect(resetAvailable(misconfigured)).toBe(false);
  });

  it("STILL refuses if the setting names the practice database", () => {
    const misconfigured = {
      ...PRODUCTION,
      RESET_ALLOWED_SUPABASE_REF: "hobwdalfmnukyxhebtkz",
    };
    expect(resetGuard(misconfigured, RESET_PHRASE).allowed).toBe(false);
  });

  it("refuses on the live hostname regardless of anything else", () => {
    const promoted = {
      VERCEL_ENV: "preview",                                     // a promoted preview build
      NEXT_PUBLIC_SUPABASE_URL: "https://hobwdalfmnukyxhebtkz.supabase.co",
      RESET_ALLOWED_SUPABASE_REF: "hobwdalfmnukyxhebtkz",
      requestHost: "raisingarrowsathome.com",
    };
    expect(resetGuard(promoted, RESET_PHRASE).allowed).toBe(false);
  });
});

describe("production email is never diverted", () => {
  const FAMILY = "a-real-family@gmail.com";
  const ADMIN  = "an-admin@charity.org";

  it("delivers to the real recipient", () => {
    const r = routeRecipients(FAMILY, { env: "production", redirectTo: ADMIN });
    expect(r).toEqual({ send: true, to: [FAMILY], redirectedFrom: null });
  });

  it("ignores the redirect setting even when it IS set on production", () => {
    // Proves the guarantee does not depend on that variable being absent.
    for (const target of [ADMIN, "someone@else.com", ""]) {
      const r = routeRecipients(FAMILY, { env: "production", redirectTo: target });
      if (!r.send) throw new Error("production must always send");
      expect(r.to).toEqual([FAMILY]);
      expect(r.redirectedFrom).toBeNull();
    }
  });

  it("leaves the subject and body exactly as written", () => {
    const r = routeRecipients(FAMILY, { env: "production", redirectTo: ADMIN });
    expect(routedSubject("Your grant is approved", r)).toBe("Your grant is approved");
    expect(routedNotice(r)).toBe("");
  });

  it("never collapses several real recipients onto one inbox", () => {
    const many = ["one@a.com", "two@b.com", "three@c.com"];
    const r = routeRecipients(many, { env: "production", redirectTo: ADMIN });
    if (!r.send) throw new Error("production must always send");
    expect(r.to).toEqual(many);
  });

  it("and production is the ONLY environment that behaves this way", () => {
    // Guards against someone "simplifying" the check into something that
    // accidentally matches every environment.
    for (const env of ["preview", "development", ""]) {
      const r = routeRecipients(FAMILY, { env, redirectTo: ADMIN });
      if (!r.send) throw new Error("expected a redirect, not suppression");
      expect(r.to, env).toEqual([ADMIN]);
    }
  });
});
