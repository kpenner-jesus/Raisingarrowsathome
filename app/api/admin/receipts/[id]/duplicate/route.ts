// POST /api/admin/receipts/[id]/duplicate
//   body: { of: <original_receipt_id> | null }
// Marks the receipt as a duplicate-of the supplied original (or clears
// the flag when of=null). Also auto-rejects with reason 'duplicate'.
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
  const of: string | null = typeof body?.of === "string" && body.of ? body.of : null;

  // Scope by org so cross-tenant id-guessing can't reach another org's receipt.
  const { data: receipt } = await svc.from("receipts")
    .select("id, recipient_id, status").eq("id", id).eq("org_id", orgCtx.id).single();
  if (!receipt) return NextResponse.json({ error: "receipt not found" }, { status: 404 });

  if (of) {
    // Validate the 'of' receipt belongs to the same recipient (and same org)
    const { data: orig } = await svc.from("receipts")
      .select("id, recipient_id").eq("id", of).eq("org_id", orgCtx.id).single();
    if (!orig || orig.recipient_id !== receipt.recipient_id) {
      return NextResponse.json({ error: "original receipt must belong to same recipient" }, { status: 400 });
    }
    if (orig.id === receipt.id) {
      return NextResponse.json({ error: "cannot mark as duplicate of itself" }, { status: 400 });
    }
  }

  const update: Record<string, any> = { duplicate_of_id: of };
  if (of && receipt.status !== "rejected") {
    update.status = "rejected";
    update.admin_notes = "Duplicate of an earlier receipt — auto-rejected.";
    update.decided_at = new Date().toISOString();
    update.decided_by = user.id;
  }

  const { error } = await svc.from("receipts").update(update)
    .eq("id", id).eq("org_id", orgCtx.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id,
    action: of ? "mark_receipt_duplicate" : "unmark_receipt_duplicate",
    targetTable: "receipts",
    targetId: id,
    details: { duplicate_of_id: of, recipient_id: receipt.recipient_id },
  });

  return NextResponse.json({ ok: true });
}
