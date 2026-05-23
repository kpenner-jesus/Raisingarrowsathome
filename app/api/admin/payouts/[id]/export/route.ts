// ============================================================
//  GET /api/admin/payouts/[id]/export
//
//  Returns a CSV of every payout line in the batch.
//  This is the handoff document for CEO Ministries accounting.
//
//  Side effect: marks batch as "exported" on first download.
// ============================================================

import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new Response("forbidden", { status: 403 });

  const service = supabaseService();
  const { data: batch } = await service.from("payout_batches").select("*").eq("id", params.id).single();
  if (!batch) return new Response("not found", { status: 404 });

  const { data: payouts } = await service
    .from("payouts")
    .select("amount, status, receipts_included, recipients!inner(approved_amount, reimbursement_rate, applications!inner(parent_names, contact_email, contact_phone, city, app_ref))")
    .eq("batch_id", params.id);

  const rows: (string | number)[][] = [
    ["Raising Arrows — payout batch handoff"],
    ["Batch date", batch.scheduled_date],
    ["Batch ID",   batch.id],
    ["Status",     batch.status],
    [],
    ["AppRef", "Recipient", "City", "Email", "Phone", "Cap", "Rate", "PayoutCAD", "Status", "ReceiptsIncluded"],
    ...((payouts as any[]) || []).map((p: any) => [
      p.recipients.applications.app_ref,
      p.recipients.applications.parent_names,
      p.recipients.applications.city,
      p.recipients.applications.contact_email,
      p.recipients.applications.contact_phone,
      Number(p.recipients.approved_amount).toFixed(2),
      (Number(p.recipients.reimbursement_rate) * 100).toFixed(0) + "%",
      Number(p.amount).toFixed(2),
      p.status,
      (p.receipts_included || []).length,
    ]),
    [],
    ["", "", "", "", "TOTAL", "", "", Number(batch.total).toFixed(2)],
  ];

  const csv = rows.map((r) => r.map((c) => {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");

  if (batch.status === "draft") {
    await service
      .from("payout_batches")
      .update({ status: "exported", exported_at: new Date().toISOString() })
      .eq("id", batch.id);
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="raising-arrows-payout-${batch.scheduled_date}.csv"`,
    },
  });
}
