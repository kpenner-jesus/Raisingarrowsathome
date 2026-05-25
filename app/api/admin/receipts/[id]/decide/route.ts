// POST /api/admin/receipts/[id]/decide
//
// Admin approves or rejects a receipt. On approve, admin can optionally set
// `reimbursable_amount` — the CAD value that will actually be reimbursed
// (handles USD receipts + partial reimbursements e.g. shipping splits).
// If omitted on CAD receipts, defaults to amount × rate at calc time.
//
// Idempotent: only acts on receipts currently in 'pending' status.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { notifyReceiptApproved, notifyReceiptRejected } from "@/app/lib/notify";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

const MAX_REIMBURSABLE = 50_000;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;

  const body = await req.json().catch(() => ({} as any));
  const { decision, notes, reimbursable_amount } = body;
  if (!["approved", "rejected"].includes(decision)) {
    return new NextResponse("bad decision", { status: 400 });
  }

  let cleanReimbursable: number | null = null;
  if (decision === "approved" && reimbursable_amount != null && reimbursable_amount !== "") {
    const n = Number(reimbursable_amount);
    if (!Number.isFinite(n) || n < 0) return new NextResponse("reimbursable_amount must be non-negative", { status: 400 });
    if (n > MAX_REIMBURSABLE)         return new NextResponse(`reimbursable_amount exceeds maximum (${MAX_REIMBURSABLE})`, { status: 400 });
    cleanReimbursable = n;
  }

  const service = supabaseService();

  const { data: receipt, error: loadErr } = await service
    .from("receipts")
    .select("id, amount, currency, description, status, recipients!inner(applications!inner(parent_names, contact_email))")
    .eq("id", params.id)
    .eq("org_id", orgCtx.id)
    .single();
  if (loadErr || !receipt) return new NextResponse(loadErr?.message || "receipt not found", { status: 404 });

  if (receipt.status !== "pending") {
    return new NextResponse(`receipt already ${receipt.status}`, { status: 409 });
  }

  // USD receipts MUST have an explicit reimbursable_amount when approving
  // (we don't auto-convert; admin sets CAD manually).
  if (decision === "approved" && receipt.currency === "USD" && cleanReimbursable === null) {
    return new NextResponse(
      "USD receipts require an explicit reimbursable_amount in CAD when approving",
      { status: 400 }
    );
  }

  const update: Record<string, any> = {
    status:      decision,
    admin_notes: notes || null,
    decided_at:  new Date().toISOString(),
    decided_by:  user.id,
  };
  if (decision === "approved" && cleanReimbursable !== null) {
    update.reimbursable_amount = cleanReimbursable;
  }

  const { error: updErr, data: updRow } = await service
    .from("receipts")
    .update(update)
    .eq("id", params.id)
    .eq("org_id", orgCtx.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updErr) return new NextResponse(updErr.message, { status: 500 });
  if (!updRow) return new NextResponse("receipt was concurrently decided", { status: 409 });

  // Audit log
  await writeAudit({
    orgId:       orgCtx.id,
    actorId:     user.id,
    action:      "decide_receipt",
    targetTable: "receipts",
    targetId:    params.id,
    details:     { decision, reimbursable_amount: cleanReimbursable, currency: receipt.currency, notes: notes || null },
  });

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
