import { describe, it, expect } from "vitest";
import {
  resetGuard, resetAvailable, supabaseRef, RESET_PHRASE,
  FORBIDDEN_SUPABASE_REFS, WIPE_ORDER, isProductionHost,
} from "./staging-reset";

const STAGING = "hobwdalfmnukyxhebtkz";
const PROD    = "otwrxfjytbhzdkwiebeu";

const ok = {
  VERCEL_ENV: "preview",
  NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING}.supabase.co`,
  RESET_ALLOWED_SUPABASE_REF: STAGING,
};

describe("supabaseRef", () => {
  it("extracts the project ref", () => {
    expect(supabaseRef(`https://${STAGING}.supabase.co`)).toBe(STAGING);
  });
  it("returns null for junk, so the caller cannot proceed on a guess", () => {
    for (const v of ["", "   ", "not a url", "https://", null, undefined, "https://x.supabase.co"]) {
      expect(supabaseRef(v as any), String(v)).toBeNull();
    }
  });
});

describe("resetGuard — the happy path", () => {
  it("allows a correctly configured staging deployment", () => {
    const r = resetGuard(ok, RESET_PHRASE);
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.ref).toBe(STAGING);
  });
});

describe("resetGuard — refuses production, every way in", () => {
  it("refuses when VERCEL_ENV is production", () => {
    const r = resetGuard({ ...ok, VERCEL_ENV: "production" }, RESET_PHRASE);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/production deployment/);
  });

  it("refuses the production DATABASE even from a preview deployment", () => {
    // The scenario that actually frightens me: environment looks harmless,
    // data is production's.
    const r = resetGuard({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
      RESET_ALLOWED_SUPABASE_REF: STAGING,
    }, RESET_PHRASE);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/not the one cleared/);
  });

  it("refuses production EVEN IF the allow-list itself points at it", () => {
    // Belt and braces: someone mis-fills RESET_ALLOWED_SUPABASE_REF with the
    // production ref. The hardcoded deny-list still stops it.
    const r = resetGuard({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
      RESET_ALLOWED_SUPABASE_REF: PROD,
    }, RESET_PHRASE);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/production database/);
  });

  it("keeps the production ref on the hardcoded deny-list", () => {
    expect(FORBIDDEN_SUPABASE_REFS).toContain(PROD);
  });
});

describe("resetGuard — the gates the adversarial review found open", () => {
  it("refuses when VERCEL_ENV is ABSENT, e.g. a developer machine", () => {
    // .env.local on this project points NEXT_PUBLIC_SUPABASE_URL at the
    // PRODUCTION project and carries a real service-role key, and never sets
    // VERCEL_ENV. Under a deny-list ("not production") that read as "" and
    // passed, leaving the hardcoded ref list as the ONLY remaining defence.
    const { VERCEL_ENV, ...noEnv } = ok;
    const r = resetGuard(noEnv, RESET_PHRASE);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/preview deployment/);
  });

  it("refuses any environment name other than preview", () => {
    for (const e of ["production", "development", "staging", "", "PREVIEW", "prod"]) {
      expect(resetGuard({ ...ok, VERCEL_ENV: e }, RESET_PHRASE).allowed, e).toBe(false);
    }
  });

  it("refuses a request that arrived on the LIVE domain", () => {
    // A preview build promoted or rolled back onto the production hostname
    // satisfies every other gate: preview env, staging database, staging ref.
    for (const host of ["raisingarrowsathome.com", "www.raisingarrowsathome.com",
                        "RaisingArrowsAtHome.com", "raisingarrowsathome.com:443"]) {
      const r = resetGuard({ ...ok, requestHost: host }, RESET_PHRASE);
      expect(r.allowed, host).toBe(false);
      if (!r.allowed) expect(r.reason).toMatch(/live site/);
    }
  });

  it("still allows the practice hostname", () => {
    expect(resetGuard({ ...ok, requestHost: "staging.raisingarrowsathome.com" }, RESET_PHRASE).allowed).toBe(true);
  });

  it("does not mistake the production DOMAIN for a database ref", () => {
    // "raisingarrowsathome" is 19 alphanumeric characters, so a bare length
    // check accepted it as a project ref that appears on no deny-list.
    expect(supabaseRef("https://raisingarrowsathome.com")).toBeNull();
    expect(supabaseRef("https://db.example.com")).toBeNull();
    expect(supabaseRef("https://hobwdalfmnukyxhebtkz.supabase.co.evil.com")).toBeNull();
  });

  it("accepts only genuine supabase.co hosts", () => {
    expect(supabaseRef("https://hobwdalfmnukyxhebtkz.supabase.co")).toBe("hobwdalfmnukyxhebtkz");
  });
});

describe("isProductionHost", () => {
  it("matches the live hostnames, port and case insensitive", () => {
    expect(isProductionHost("raisingarrowsathome.com")).toBe(true);
    expect(isProductionHost("WWW.RaisingArrowsAtHome.com")).toBe(true);
    expect(isProductionHost("raisingarrowsathome.com:443")).toBe(true);
  });
  it("does not match staging or an unknown host", () => {
    expect(isProductionHost("staging.raisingarrowsathome.com")).toBe(false);
    expect(isProductionHost("localhost:3000")).toBe(false);
    expect(isProductionHost(null)).toBe(false);
  });
});

describe("resetGuard — fails closed on missing or unclear config", () => {
  it("is OFF when the allow-list env var is absent", () => {
    const { RESET_ALLOWED_SUPABASE_REF, ...rest } = ok;
    const r = resetGuard(rest, RESET_PHRASE);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/not configured/);
  });

  it("is OFF when the allow-list env var is empty or whitespace", () => {
    expect(resetGuard({ ...ok, RESET_ALLOWED_SUPABASE_REF: "" }, RESET_PHRASE).allowed).toBe(false);
    expect(resetGuard({ ...ok, RESET_ALLOWED_SUPABASE_REF: "   " }, RESET_PHRASE).allowed).toBe(false);
  });

  it("refuses when the database URL is missing or unparseable", () => {
    expect(resetGuard({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "" }, RESET_PHRASE).allowed).toBe(false);
    expect(resetGuard({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "garbage" }, RESET_PHRASE).allowed).toBe(false);
  });

  it("refuses on a completely empty environment", () => {
    expect(resetGuard({}, RESET_PHRASE).allowed).toBe(false);
  });

  it("refuses an unrecognised VERCEL_ENV outright", () => {
    expect(resetGuard({ ...ok, VERCEL_ENV: "something-new" }, RESET_PHRASE).allowed).toBe(false);
  });
});

describe("resetGuard — the typed phrase", () => {
  it("refuses a wrong, empty, missing or nearly-right phrase", () => {
    for (const p of ["", "erase staging data", "ERASE STAGING", "ERASE STAGING DATA ", undefined, null, 42, {}]) {
      expect(resetGuard(ok, p as any).allowed, JSON.stringify(p)).toBe(false);
    }
  });
  it("accepts only the exact phrase", () => {
    expect(resetGuard(ok, RESET_PHRASE).allowed).toBe(true);
  });
});

describe("resetAvailable", () => {
  it("is true only where the reset could actually run", () => {
    expect(resetAvailable(ok)).toBe(true);
    expect(resetAvailable({ ...ok, VERCEL_ENV: "production" })).toBe(false);
    expect(resetAvailable({})).toBe(false);
    expect(resetAvailable({ ...ok, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` })).toBe(false);
  });
});

describe("WIPE_ORDER", () => {
  it("never deletes the org, its accounts, or its configuration", () => {
    // Wiping any of these would lock the operator out or destroy settings
    // they wrote, which is not what "start clean" means.
    for (const keep of ["tenants", "profiles", "org_members", "admin_invites",
                        "app_settings", "email_templates", "receipt_categories",
                        "api_tokens", "tenant_ai_secrets"]) {
      expect(WIPE_ORDER, keep).not.toContain(keep);
    }
  });

  it("DOES clear the rate limiter, or the playground stays locked", () => {
    // Without this a tester cannot immediately re-submit the application form:
    // yesterday's counts would still be holding them off.
    expect(WIPE_ORDER).toContain("submit_throttle");
  });

  it("clears the whole family-and-receipt lifecycle", () => {
    for (const t of ["applications", "recipients", "receipts", "photos",
                     "payouts", "payout_batches", "testimonials"]) {
      expect(WIPE_ORDER, t).toContain(t);
    }
  });

  it("deletes children before their parents", () => {
    const at = (t: string) => WIPE_ORDER.indexOf(t);
    expect(at("receipts")).toBeLessThan(at("recipients"));
    expect(at("photos")).toBeLessThan(at("recipients"));
    expect(at("recipient_notes")).toBeLessThan(at("recipients"));
    expect(at("payouts")).toBeLessThan(at("payout_batches"));
    expect(at("payouts")).toBeLessThan(at("recipients"));
    expect(at("recipients")).toBeLessThan(at("applications"));
    expect(at("application_notes")).toBeLessThan(at("applications"));
    expect(at("broadcast_sends")).toBeLessThan(at("broadcasts"));
  });

  it("has no duplicates", () => {
    expect(new Set(WIPE_ORDER).size).toBe(WIPE_ORDER.length);
  });
});
