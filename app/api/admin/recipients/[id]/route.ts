// PATCH /api/admin/recipients/[id]
// Admin updates approved_amount, reimbursement_rate, and/or status.
//
// Strict numeric validation + upper bound on approved_amount to prevent
// fat-finger or compromised-token disasters.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit, diff } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

const ALLOWED_STATUS = ["active", "completed", "suspended"] as const;
const MAX_CAP = 50_000;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;

  const body = await req.json().catch(() => ({} as any));
  const update: Record<string, any> = {};

  if (body.approved_amount !== undefined) {
    const n = Number(body.approved_amount);
    if (!Number.isFinite(n) || n < 0) return new NextResponse("approved_amount must be a non-negative finite number", { status: 400 });
    if (n > MAX_CAP)                   return new NextResponse(`approved_amount exceeds maximum (${MAX_CAP})`, { status: 400 });
    update.approved_amount = n;
  }
  if (body.reimbursement_rate !== undefined) {
    const n = Number(body.reimbursement_rate);
    if (!Number.isFinite(n) || n < 0 || n > 1) return new NextResponse("reimbursement_rate must be 0–1", { status: 400 });
    update.reimbursement_rate = n;
  }
  if (body.status !== undefined) {
    if (!ALLOWED_STATUS.includes(body.status)) return new NextResponse("invalid status", { status: 400 });
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return new NextResponse("nothing to update", { status: 400 });
  }

  const service = supabaseService();
  // Snapshot before for audit diff — scoped per-tenant so a recipient id from
  // another org returns null (treated as 'no record').
  const { data: before } = await service.from("recipients")
    .select("approved_amount, reimbursement_rate, status")
    .eq("id", params.id).eq("org_id", orgCtx.id).single();
  if (!before) return new NextResponse("recipient not found", { status: 404 });

  const { error } = await service.from("recipients").update(update)
    .eq("id", params.id).eq("org_id", orgCtx.id);
  if (error) return new NextResponse(error.message, { status: 500 });

  await writeAudit({
    orgId:       orgCtx.id,
    actorId:     user.id,
    action:      "modify_recipient",
    targetTable: "recipients",
    targetId:    params.id,
    details:     before ? diff(before, { ...before, ...update }) : { update },
  });

  return NextResponse.json({ ok: true });
}
