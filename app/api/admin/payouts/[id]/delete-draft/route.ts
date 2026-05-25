// DELETE /api/admin/payouts/[id]/delete-draft
// Removes a payout_batches row + its child payouts rows.
// Hard-gated: status MUST be 'draft' (never delete exported/paid).
// Idempotent via status guard in the WHERE clause.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
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

  // Snapshot the batch first (so audit captures totals + bucket). Tenant-scoped
  // so a draft id from another org can never be reached from here.
  const { data: batch } = await svc.from("payout_batches")
    .select("id, status, total, bucket, scheduled_date")
    .eq("id", id).eq("org_id", orgCtx.id).single();
  if (!batch) return NextResponse.json({ error: "batch not found" }, { status: 404 });
  if (batch.status !== "draft") {
    return NextResponse.json({ error: `only draft batches can be deleted (this one is '${batch.status}')` }, { status: 409 });
  }

  // Count payouts being removed (for audit + response). Also tenant-scoped
  // — payouts.org_id should always match payout_batches.org_id, but the
  // extra eq("org_id") is defense-in-depth.
  const { count: payoutCount } = await svc.from("payouts")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", id).eq("org_id", orgCtx.id);

  // Cascade-ish: delete child payouts first, then the batch row.
  // Both gated to draft-only state and tenant to avoid races + cross-tenant slips.
  const { error: payErr } = await svc.from("payouts").delete()
    .eq("batch_id", id).eq("org_id", orgCtx.id);
  if (payErr) return NextResponse.json({ error: `payouts delete: ${payErr.message}` }, { status: 500 });

  const { error: batchErr, count } = await svc.from("payout_batches")
    .delete({ count: "exact" }).eq("id", id).eq("org_id", orgCtx.id).eq("status", "draft");
  if (batchErr) return NextResponse.json({ error: `batch delete: ${batchErr.message}` }, { status: 500 });
  if (!count)   return NextResponse.json({ error: "batch concurrently modified" }, { status: 409 });

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id,
    action: "delete_draft_batch",
    targetTable: "payout_batches",
    targetId: id,
    details: {
      total: batch.total, bucket: batch.bucket, scheduled_date: batch.scheduled_date,
      payouts_removed: payoutCount ?? 0,
    },
  });

  return NextResponse.json({ ok: true, payouts_removed: payoutCount ?? 0 });
}
