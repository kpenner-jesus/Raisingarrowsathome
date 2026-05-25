// ============================================================
//  GET /api/cron/summary-email?bucket=mid|end
//
//  Iterates every active tenant. For each, emails the owner (or the
//  app_settings.summary_email_to override) a summary of pending +
//  approved receipts for the next payout window.
//
//  Fires on the 1st (mid bucket) and 17th (end bucket).
// ============================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { listActiveTenants } from "@/app/lib/payouts";
import { sendSubmissionWindowSummaryForOrg, type SummaryBucket } from "@/app/lib/summary-emails";

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

  const url    = new URL(req.url);
  const bucket: SummaryBucket = url.searchParams.get("bucket") === "end" ? "end" : "mid";
  const baseUrl = process.env.NEXT_PUBLIC_PLATFORM_URL || url.origin;

  const tenants = await listActiveTenants();
  const results = [];

  for (const t of tenants) {
    try {
      const r = await sendSubmissionWindowSummaryForOrg(t.id, t.slug, bucket, baseUrl);
      results.push(r);
    } catch (e: any) {
      console.error(`[cron/summary-email] ${t.slug} failed:`, e?.message || e);
      results.push({ org_id: t.id, slug: t.slug, sent: false, reason: e?.message || "failed" });
    }
  }

  return NextResponse.json({ ok: true, bucket, tenants_processed: tenants.length, results });
}
