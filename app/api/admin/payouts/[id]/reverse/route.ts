// POST /api/admin/payouts/[id]/reverse
//   body: { reason }
// Marks a payout as reversed (e-transfer bounced, sent to wrong person, etc).
// Reason is required and audited.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;
  const svc = supabaseService();

  const body = await req.json().catch(() => ({} as any));
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "reason required" }, { status: 400 });
  if (reason.length > 500) return NextResponse.json({ error: "reason too long" }, { status: 400 });

  // Tenant-scope the payout lookup so cross-tenant id guessing is impossible.
  const { data: payout } = await svc.from("payouts")
    .select("id, status, reversed_at, amount, recipient_id")
    .eq("id", id).eq("org_id", orgCtx.id).single();
  if (!payout) return NextResponse.json({ error: "payout not found" }, { status: 404 });
  if (payout.reversed_at) return NextResponse.json({ error: "payout already reversed" }, { status: 409 });
  if (payout.status !== "paid") return NextResponse.json({ error: "only paid payouts can be reversed" }, { status: 409 });

  const now = new Date().toISOString();
  const { error } = await svc.from("payouts").update({
    reversed_at: now,
    reversed_by: user.id,
    reversal_reason: reason,
  }).eq("id", id).eq("org_id", orgCtx.id).is("reversed_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id,
    action: "reverse_payout",
    targetTable: "payouts",
    targetId: id,
    details: { reason, amount: payout.amount, recipient_id: payout.recipient_id },
  });

  return NextResponse.json({ ok: true });
}
