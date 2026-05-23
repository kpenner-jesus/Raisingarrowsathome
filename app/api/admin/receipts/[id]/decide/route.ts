// POST /api/admin/receipts/[id]/decide   — admin approves/rejects a receipt
//
// Idempotency guard: only acts when the receipt is currently 'pending'.
// Already-decided receipts cannot be flipped silently (no double email,
// no audit-trail loss). Admin must explicitly use modify_receipt path
// (not yet implemented) for after-the-fact corrections.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { notifyReceiptApproved, notifyReceiptRejected } from "@/app/lib/notify";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new NextResponse("forbidden", { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const { decision, notes } = body;
  if (!["approved", "rejected"].includes(decision)) {
    return new NextResponse("bad decision", { status: 400 });
  }

  const service = supabaseService();

  const { data: receipt, error: loadErr } = await service
    .from("receipts")
    .select("id, amount, description, status, recipients!inner(applications!inner(parent_names, contact_email))")
    .eq("id", params.id)
    .single();
  if (loadErr || !receipt) return new NextResponse(loadErr?.message || "receipt not found", { status: 404 });

  if (receipt.status !== "pending") {
    return new NextResponse(`receipt already ${receipt.status}`, { status: 409 });
  }

  // Compare-and-swap: only update when still pending.
  const { error: updErr, data: updRow } = await service
    .from("receipts")
    .update({
      status:      decision,
      admin_notes: notes || null,
      decided_at:  new Date().toISOString(),
      decided_by:  user.id,
    })
    .eq("id", params.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updErr) return new NextResponse(updErr.message, { status: 500 });
  if (!updRow) return new NextResponse("receipt was concurrently decided", { status: 409 });

  const origin       = new URL(req.url).origin;
  const application  = (receipt as any).recipients.applications;
  const notifyArgs   = {
    to:           application.contact_email,
    parent_names: application.parent_names,
    amount:       Number(receipt.amount),
    description:  receipt.description || "",
    portal_url:   `${origin}/portal`,
  };

  if (decision === "approved") {
    await notifyReceiptApproved(notifyArgs);
  } else {
    await notifyReceiptRejected({ ...notifyArgs, admin_notes: notes || "" });
  }

  return NextResponse.json({ ok: true });
}
