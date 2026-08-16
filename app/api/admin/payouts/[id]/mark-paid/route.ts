// POST /api/admin/payouts/[id]/mark-paid
// Called once CEO Ministries has actually sent the e-transfers.
//
// Idempotent: if the batch is already paid we return early without
// re-emailing or overwriting paid_at. Likewise individual payouts that
// are already paid or cancelled are not touched.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { notifyBatchPaid } from "@/app/lib/notify";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;

  const { ceo_reference } = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  const service = supabaseService();

  // Idempotency: refuse to mark already-paid batches. Tenant-scoped — id
  // collisions across orgs can never reach another tenant's batch.
  const { data: batch, error: loadErr } = await service
    .from("payout_batches").select("id, status, paid_at")
    .eq("id", params.id).eq("org_id", orgCtx.id).single();
  if (loadErr || !batch) return new NextResponse("batch not found", { status: 404 });
  if (batch.status === "paid") {
    return NextResponse.json({
      ok: true,
      already_paid: true,
      batch_id: batch.id,
      paid_at: batch.paid_at,
      recipients_notified: 0,
    });
  }

  // Pre-load payouts that we'll notify on (status must currently be scheduled or approved).
  const { data: payouts } = await service
    .from("payouts")
    .select("amount, recipients!inner(applications!inner(parent_names, contact_email))")
    .eq("batch_id", params.id)
    .eq("org_id", orgCtx.id)
    .in("status", ["scheduled", "approved"]);

  // Update only payouts that are in-flight (skip already-paid / cancelled).
  const updPayouts = await service.from("payouts")
    .update({ status: "paid", paid_at: now })
    .eq("batch_id", params.id)
    .eq("org_id", orgCtx.id)
    .in("status", ["scheduled", "approved"]);
  if (updPayouts.error) return new NextResponse(updPayouts.error.message, { status: 500 });

  const updBatch = await service.from("payout_batches").update({
    status:        "paid",
    paid_at:       now,
    ceo_reference: ceo_reference || null,
  }).eq("id", params.id).eq("org_id", orgCtx.id).neq("status", "paid");
  if (updBatch.error) return new NextResponse(updBatch.error.message, { status: 500 });

  const platformOrigin = process.env.NEXT_PUBLIC_PLATFORM_URL || new URL(req.url).origin;
  const portalUrl = orgCtx.prefixed
    ? `${platformOrigin}/o/${orgCtx.slug}/portal`
    : `${platformOrigin}/portal`;
  // Sequential, and count only real sends. This was Promise.all with
  // recipients_notified = payouts.length — a ROW COUNT, not a send count —
  // so a rate-limited or bounced batch still recorded in audit_log that
  // every family had been told their money was on the way.
  let recipientsNotified = 0;
  for (const p of ((payouts as any[]) || [])) {
    const ok = await notifyBatchPaid({
      to:           p.recipients.applications.contact_email,
      parent_names: p.recipients.applications.parent_names,
      amount:       Number(p.amount),
      portal_url:   portalUrl,
      orgId:        orgCtx.id,
    }).catch(() => false);
    if (ok) recipientsNotified++;
  }

  await writeAudit({
    orgId:       orgCtx.id,
    actorId:     user.id,
    action:      "mark_paid",
    targetTable: "payout_batches",
    targetId:    params.id,
    details:     { ceo_reference: ceo_reference || null, paid_at: now, recipients_notified: recipientsNotified },
  });

  return NextResponse.json({ ok: true, batch_id: params.id, recipients_notified: recipientsNotified });
}
