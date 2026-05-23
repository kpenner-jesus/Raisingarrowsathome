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

export interface AppSettings {
  fundingCaps: FundingTier[];
  reimbursementRate: number;       // 0..1
  submissionDeadlineMonths: number;
  applicationsOpen: boolean;
}

const DEFAULTS: AppSettings = {
  fundingCaps: SITE_CONFIG.fundingCaps as FundingTier[],
  reimbursementRate: 0.75,
  submissionDeadlineMonths: 6,
  applicationsOpen: true,
};

export async function getSettings(): Promise<AppSettings> {
  try {
    const svc = supabaseService();
    const { data, error } = await svc.from("app_settings").select("key, value");
    if (error || !data) return DEFAULTS;
    const map = new Map(data.map((r: any) => [r.key, r.value]));
    return {
      fundingCaps:              (map.get("funding_caps") as FundingTier[]) ?? DEFAULTS.fundingCaps,
      reimbursementRate:        Number(map.get("reimbursement_rate") ?? DEFAULTS.reimbursementRate),
      submissionDeadlineMonths: Number(map.get("submission_deadline_months") ?? DEFAULTS.submissionDeadlineMonths),
      applicationsOpen:         Boolean(map.get("applications_open") ?? DEFAULTS.applicationsOpen),
    };
  } catch (e) {
    console.error("[settings] read failed:", e);
    return DEFAULTS;
  }
}
