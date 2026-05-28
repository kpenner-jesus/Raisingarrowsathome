// ============================================================
//  GET /api/cron/generate-payouts?bucket=mid|end
//
//  Iterates every active tenant and generates a payout batch for each.
//  Tenant statuses processed: active, trialing, past_due, free (see
//  listActiveTenants / TENANT_ACTIVE_STATUSES). past_due is included so a
//  card hiccup doesn't freeze a grant program mid-cycle.
//
//  Auth: Authorization header must equal exactly `Bearer ${CRON_SECRET}`.
//        timingSafeEqual comparison.
// ============================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { generatePayoutsForOrg, listActiveTenants, type PayoutBucket } from "@/app/lib/payouts";

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req: Request) {
  const auth   = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return new NextResponse("server misconfigured: CRON_SECRET unset", { status: 500 });
  if (!constantTimeEq(auth, `Bearer ${secret}`)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const reqBucket = url.searchParams.get("bucket");
  const bucket: PayoutBucket = (reqBucket === "mid" || reqBucket === "end" ? reqBucket : "manual");

  const tenants = await listActiveTenants();
  const results = [];

  for (const t of tenants) {
    try {
      const r = await generatePayoutsForOrg(t.id, bucket);
      results.push({ slug: t.slug, ...r });
    } catch (e: any) {
      console.error(`[cron/generate-payouts] ${t.slug} failed:`, e?.message || e);
      results.push({ slug: t.slug, org_id: t.id, error: e?.message || "failed" });
    }
  }

  return NextResponse.json({ ok: true, bucket, tenants_processed: tenants.length, results });
}
