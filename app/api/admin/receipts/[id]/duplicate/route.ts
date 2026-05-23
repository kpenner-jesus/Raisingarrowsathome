// POST /api/admin/receipts/[id]/duplicate
//   body: { of: <original_receipt_id> | null }
// Marks the receipt as a duplicate-of the supplied original (or clears
// the flag when of=null). Also auto-rejects with reason 'duplicate'.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const of: string | null = typeof body?.of === "string" && body.of ? body.of : null;

  const { data: receipt } = await svc.from("receipts").select("id, recipient_id, status").eq("id", id).single();
  if (!receipt) return NextResponse.json({ error: "receipt not found" }, { status: 404 });

  if (of) {
    // Validate the 'of' receipt belongs to the same recipient
    const { data: orig } = await svc.from("receipts").select("id, recipient_id").eq("id", of).single();
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

  const { error } = await svc.from("receipts").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: user.id,
    action: of ? "mark_receipt_duplicate" : "unmark_receipt_duplicate",
    targetTable: "receipts",
    targetId: id,
    details: { duplicate_of_id: of, recipient_id: receipt.recipient_id },
  });

  return NextResponse.json({ ok: true });
}
