// POST /api/admin/payouts/[id]/mark-paid
// Called once CEO Ministries has actually sent the e-transfers.
//
// Idempotent: if the batch is already paid we return early without
// re-emailing or overwriting paid_at. Likewise individual payouts that
// are already paid or cancelled are not touched.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { notifyBatchPaid } from "@/app/lib/notify";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new NextResponse("forbidden", { status: 403 });

  const { ceo_reference } = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  const service = supabaseService();

  // Idempotency: refuse to mark already-paid batches.
  const { data: batch, error: loadErr } = await service
    .from("payout_batches").select("id, status, paid_at").eq("id", params.id).single();
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
    .in("status", ["scheduled", "approved"]);

  // Update only payouts that are in-flight (skip already-paid / cancelled).
  const updPayouts = await service.from("payouts")
    .update({ status: "paid", paid_at: now })
    .eq("batch_id", params.id)
    .in("status", ["scheduled", "approved"]);
  if (updPayouts.error) return new NextResponse(updPayouts.error.message, { status: 500 });

  const updBatch = await service.from("payout_batches").update({
    status:        "paid",
    paid_at:       now,
    ceo_reference: ceo_reference || null,
  }).eq("id", params.id).neq("status", "paid");
  if (updBatch.error) return new NextResponse(updBatch.error.message, { status: 500 });

  const origin = new URL(req.url).origin;
  const recipientsNotified = ((payouts as any[]) || []).length;
  await Promise.all(((payouts as any[]) || []).map((p) =>
    notifyBatchPaid({
      to:           p.recipients.applications.contact_email,
      parent_names: p.recipients.applications.parent_names,
      amount:       Number(p.amount),
      portal_url:   `${origin}/portal`,
    })
  ));

  return NextResponse.json({ ok: true, batch_id: params.id, recipients_notified: recipientsNotified });
}
