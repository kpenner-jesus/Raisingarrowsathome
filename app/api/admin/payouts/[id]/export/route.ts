// ============================================================
//  GET /api/admin/payouts/[id]/export
//
//  Returns a CSV of every payout line in the batch.
//  This is the handoff document for CEO Ministries accounting.
//
//  Side effect: marks batch as "exported" on first download.
// ============================================================

import { supabaseService } from "@/app/lib/supabase/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return new Response(e.message, { status: e.status });
    throw e;
  }
  const { ctx: orgCtx } = auth;

  const service = supabaseService();
  // Scope the batch lookup to this tenant so an admin can't download
  // another org's CSV by guessing the batch UUID.
  const { data: batch } = await service.from("payout_batches")
    .select("*").eq("id", params.id).eq("org_id", orgCtx.id).single();
  if (!batch) return new Response("not found", { status: 404 });

  const { data: payouts } = await service
    .from("payouts")
    .select("amount, status, receipts_included, recipients!inner(approved_amount, reimbursement_rate, applications!inner(parent_names, contact_email, contact_phone, city, app_ref))")
    .eq("batch_id", params.id).eq("org_id", orgCtx.id);

  const rows: (string | number)[][] = [
    [`${orgCtx.name} — payout batch handoff`],
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
      .eq("id", batch.id).eq("org_id", orgCtx.id);
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${orgCtx.slug}-payout-${batch.scheduled_date}.csv"`,
    },
  });
}
