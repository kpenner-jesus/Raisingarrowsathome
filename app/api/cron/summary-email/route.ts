// ============================================================
//  GET /api/cron/summary-email?bucket=mid|end
//
//  Fires on the 1st (for 15th-payout window) and 17th (for end-of-month
//  payout window). Emails Tierza a summary of pending receipts in the
//  window so she knows what's coming up for review/approval.
// ============================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseService } from "@/app/lib/supabase/server";
import { notifySubmissionWindowSummary } from "@/app/lib/notify";

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const SUMMARY_RECIPIENT = process.env.SUMMARY_EMAIL_TO || "register@raisingarrowsathome.com";

export async function GET(req: Request) {
  const auth   = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return new NextResponse("server misconfigured: CRON_SECRET unset", { status: 500 });
  if (!constantTimeEq(auth, `Bearer ${secret}`)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const url    = new URL(req.url);
  const bucket = url.searchParams.get("bucket") === "end" ? "end" : "mid";
  const payDateDescription = bucket === "mid"
    ? "the 15th of this month"
    : "the end of this month";

  const supabase = supabaseService();
  // Pull all pending receipts + every approved receipt that hasn't been
  // committed to a payout yet (i.e. the next batch's likely lines).
  const { data: pending } = await supabase
    .from("receipts")
    .select("id, amount, currency, reimbursable_amount, description, status, created_at, recipients!inner(applications!inner(parent_names))")
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(100);

  const pendingForReview = (pending || []).filter((r: any) => r.status === "pending");
  const approvedAwaiting = (pending || []).filter((r: any) => r.status === "approved");

  await notifySubmissionWindowSummary({
    to: SUMMARY_RECIPIENT,
    bucket_label: bucket === "mid" ? "mid-month (15th)" : "end-of-month",
    pay_date_description: payDateDescription,
    pending_for_review: pendingForReview.map((r: any) => ({
      name:    r.recipients.applications.parent_names,
      amount:  `${r.currency || "CAD"} $${Number(r.amount).toFixed(2)}`,
      desc:    r.description || "Receipt",
    })),
    approved_awaiting_payout: approvedAwaiting.map((r: any) => ({
      name:               r.recipients.applications.parent_names,
      reimbursable_cad:   r.reimbursable_amount != null ? `$${Number(r.reimbursable_amount).toFixed(2)}` : "(needs admin amount)",
      desc:               r.description || "Receipt",
    })),
    admin_url: `${url.origin}/admin/recipients`,
  });

  return NextResponse.json({
    ok: true,
    bucket,
    pending_count:           pendingForReview.length,
    approved_awaiting_count: approvedAwaiting.length,
  });
}
