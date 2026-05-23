// POST /api/admin/receipts/[id]/decide   — admin approves/rejects a receipt
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { notifyReceiptApproved, notifyReceiptRejected } from "@/app/lib/notify";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new NextResponse("forbidden", { status: 403 });

  const { decision, notes } = await req.json();
  if (!["approved", "rejected"].includes(decision)) {
    return new NextResponse("bad decision", { status: 400 });
  }

  const service = supabaseService();

  // Load receipt + applicant email BEFORE updating (in case the receipt is cascaded later)
  const { data: receipt, error: loadErr } = await service
    .from("receipts")
    .select("id, amount, description, recipients!inner(applications!inner(parent_names, contact_email))")
    .eq("id", params.id)
    .single();
  if (loadErr || !receipt) return new NextResponse(loadErr?.message || "receipt not found", { status: 404 });

  const { error } = await service
    .from("receipts")
    .update({
      status:      decision,
      admin_notes: notes || null,
      decided_at:  new Date().toISOString(),
      decided_by:  user.id,
    })
    .eq("id", params.id);
  if (error) return new NextResponse(error.message, { status: 500 });

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
