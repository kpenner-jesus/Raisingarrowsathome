// ============================================================
//  POST /api/admin/payouts/generate?bucket=mid|end|manual&org_id=<uuid>
//
//  Creates a new payout batch for ONE tenant. Heavy lifting lives in
//  app/lib/payouts.ts so the cron loop can call it directly without
//  going back through HTTP.
//
//  Authorized either by:
//    - admin session (UI button)  → org_id resolved via org_members
//    - x-cron-secret header       → org_id read from query param
// ============================================================

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { generatePayoutsForOrg, type PayoutBucket } from "@/app/lib/payouts";
import { isTenantAccessBlocked } from "@/app/lib/tenant-access";
import { timingSafeEqual } from "crypto";

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: Request) {
  const url    = new URL(req.url);
  const queryOrg = url.searchParams.get("org_id") || null;
  const reqBucket = url.searchParams.get("bucket");
  const bucket: PayoutBucket = (reqBucket === "mid" || reqBucket === "end" ? reqBucket : "manual");

  let orgId: string | null = null;
  let isCron = false;

  // ── 1. Cron-secret auth — caller must supply org_id explicitly. ──
  const cronHeader = req.headers.get("x-cron-secret") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && cronHeader && constantTimeEq(cronHeader, cronSecret)) {
    if (!queryOrg) return new NextResponse("org_id query param required for cron caller", { status: 400 });
    orgId = queryOrg;
    isCron = true;
  }

  // ── 2. Admin-session auth — resolve org_id from user's org_members row. ──
  if (!orgId) {
    const auth = supabaseServer();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return new NextResponse("unauthorized", { status: 401 });

    const svc = supabaseService();
    // If query param was passed, verify the caller is admin in THAT org.
    if (queryOrg) {
      const { data: m } = await svc
        .from("org_members").select("role")
        .eq("org_id", queryOrg).eq("user_id", user.id).maybeSingle();
      if (!m || (m.role !== "owner" && m.role !== "admin")) {
        return new NextResponse("not an admin of that org", { status: 403 });
      }
      orgId = queryOrg;
    } else {
      // No query param — find an org the user is an admin of.
      const { data: rows } = await svc
        .from("org_members").select("org_id, role")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin"])
        .limit(1);
      if (!rows || rows.length === 0) return new NextResponse("no admin org", { status: 403 });
      orgId = rows[0].org_id as string;
    }
  }

  // Tenant-access gate for the admin-session path. Cron already restricts to
  // active statuses via listActiveTenants, so skip the extra round-trip there.
  if (!isCron) {
    const svc = supabaseService();
    const { data: t } = await svc.from("tenants").select("status").eq("id", orgId!).maybeSingle();
    if (isTenantAccessBlocked(t?.status)) {
      return new NextResponse(`tenant is ${t?.status ?? "unknown"} — payouts paused`, { status: 423 });
    }
  }

  try {
    const result = await generatePayoutsForOrg(orgId!, bucket);
    if (result.skipped) {
      return NextResponse.json({ skipped: true, reason: result.skipped.reason, org_id: result.org_id });
    }
    return NextResponse.json(result);
  } catch (e: any) {
    return new NextResponse(e?.message || "generate failed", { status: 500 });
  }
}
