// POST /api/admin/payouts/[id]/mark-paid
// Called once CEO Ministries has actually sent the e-transfers.
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

  // Pre-load payouts + recipient emails so we can notify after the update.
  const { data: payouts } = await service
    .from("payouts")
    .select("amount, recipients!inner(applications!inner(parent_names, contact_email))")
    .eq("batch_id", params.id);

  const updPayouts = await service.from("payouts").update({ status: "paid", paid_at: now }).eq("batch_id", params.id);
  if (updPayouts.error) return new NextResponse(updPayouts.error.message, { status: 500 });

  const updBatch = await service.from("payout_batches").update({
    status:        "paid",
    paid_at:       now,
    ceo_reference: ceo_reference || null,
  }).eq("id", params.id);
  if (updBatch.error) return new NextResponse(updBatch.error.message, { status: 500 });

  // Notify each recipient (fire-and-forget — failures already logged inside notify).
  const origin = new URL(req.url).origin;
  await Promise.all(((payouts as any[]) || []).map((p) =>
    notifyBatchPaid({
      to:           p.recipients.applications.contact_email,
      parent_names: p.recipients.applications.parent_names,
      amount:       Number(p.amount),
      portal_url:   `${origin}/portal`,
    })
  ));

  return NextResponse.json({ ok: true });
}
