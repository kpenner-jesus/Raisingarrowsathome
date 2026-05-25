// ============================================================
//  Runtime app settings (DB-backed, overrides siteConfig defaults).
//
//  Stored in public.app_settings as one row per key, value JSONB.
//  Use these helpers ONLY in server components or route handlers.
//  Reads are public; writes are admin-only (RLS).
// ============================================================

import { supabaseService } from "./supabase/server";
import { SITE_CONFIG } from "@/app/siteConfig";

export interface FundingTier {
  label: string;
  cap: number;
  spend: number;
}

export type IntakeStatus = "open" | "waitlist" | "closed";

export interface AppSettings {
  fundingCaps: FundingTier[];
  reimbursementRate: number;
  submissionDeadlineMonths: number;
  intakeStatus: IntakeStatus;
  /** @deprecated kept for legacy callers; mirrors intakeStatus !== 'closed' */
  applicationsOpen: boolean;
}

const DEFAULTS: AppSettings = {
  fundingCaps: SITE_CONFIG.fundingCaps as FundingTier[],
  reimbursementRate: 0.75,
  submissionDeadlineMonths: 6,
  intakeStatus: "open",
  applicationsOpen: true,
};

function coerceIntake(v: any, legacyBool?: any): IntakeStatus {
  if (v === "open" || v === "waitlist" || v === "closed") return v;
  // Fall back to legacy boolean if intake_status not yet set
  if (typeof legacyBool === "boolean") return legacyBool ? "open" : "closed";
  return "open";
}

/**
 * Read the app_settings for a tenant. Returns DEFAULTS if no rows exist
 * for that tenant (or read fails). Pass `orgId` to scope the query — the
 * multi-tenant `app_settings` table has UNIQUE(org_id, key), so without
 * the org filter we would silently mash together settings from every
 * charity on the platform.
 *
 * Tests and other callers that genuinely need a global fallback can omit
 * orgId; that path returns DEFAULTS rather than reading the DB. Callers
 * inside route handlers must always pass orgCtx.id.
 */
export async function getSettings(orgId?: string): Promise<AppSettings> {
  if (!orgId) return DEFAULTS;
  try {
    const svc = supabaseService();
    const { data, error } = await svc.from("app_settings")
      .select("key, value").eq("org_id", orgId);
    if (error || !data) return DEFAULTS;
    const map = new Map(data.map((r: any) => [r.key, r.value]));
    const intakeStatus = coerceIntake(map.get("intake_status"), map.get("applications_open"));
    return {
      fundingCaps:              (map.get("funding_caps") as FundingTier[]) ?? DEFAULTS.fundingCaps,
      reimbursementRate:        Number(map.get("reimbursement_rate") ?? DEFAULTS.reimbursementRate),
      submissionDeadlineMonths: Number(map.get("submission_deadline_months") ?? DEFAULTS.submissionDeadlineMonths),
      intakeStatus,
      applicationsOpen:         intakeStatus !== "closed",
    };
  } catch (e) {
    console.error("[settings] read failed:", e);
    return DEFAULTS;
  }
}
