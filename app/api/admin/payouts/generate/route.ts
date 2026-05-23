// ============================================================
//  POST /api/admin/payouts/generate
//
//  Creates a new payout batch by iterating every active recipient
//  and adding a payout for whatever they're currently eligible for.
//
//  Authorized either by: admin session (UI button) or
//                       x-cron-secret header (Vercel Cron).
// ============================================================

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { calcBalance } from "@/app/lib/grant-calc";

export async function POST(req: Request) {
  let isAuthorized = false;

  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader && cronHeader === process.env.CRON_SECRET) {
    isAuthorized = true;
  } else {
    const auth = supabaseServer();
    const { data: { user } } = await auth.auth.getUser();
    if (user) {
      const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
      if (profile?.role === "admin") isAuthorized = true;
    }
  }
  if (!isAuthorized) return new NextResponse("unauthorized", { status: 401 });

  const service = supabaseService();
  const { data: recipients, error: recErr } = await service.from("recipients").select("*").eq("status", "active");
  if (recErr) return new NextResponse(recErr.message, { status: 500 });

  const today = new Date().toISOString().split("T")[0];
  const { data: batch, error: batchErr } = await service
    .from("payout_batches")
    .insert({ scheduled_date: today, status: "draft", total: 0 })
    .select("*")
    .single();
  if (batchErr) return new NextResponse(batchErr.message, { status: 500 });

  let batchTotal = 0;
  let lines = 0;

  for (const r of recipients || []) {
    const { data: receipts } = await service.from("receipts").select("id, amount, status").eq("recipient_id", r.id);
    const { data: paid }     = await service.from("payouts").select("amount").eq("recipient_id", r.id).eq("status", "paid");

    const paidToDate = (paid || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
    const balance = calcBalance({
      receipts:  receipts || [],
      rate:      Number(r.reimbursement_rate),
      cap:       Number(r.approved_amount),
      paidToDate,
    });

    if (balance.eligibleForNextPayout > 0.01) {
      const includedReceiptIds = (receipts || [])
        .filter((x: any) => x.status === "approved")
        .map((x: any) => x.id);

      await service.from("payouts").insert({
        batch_id:          batch.id,
        recipient_id:      r.id,
        amount:            Number(balance.eligibleForNextPayout.toFixed(2)),
        receipts_included: includedReceiptIds,
        status:            "scheduled",
      });
      batchTotal += balance.eligibleForNextPayout;
      lines += 1;
    }
  }

  await service
    .from("payout_batches")
    .update({ total: Number(batchTotal.toFixed(2)) })
    .eq("id", batch.id);

  return NextResponse.json({ batch_id: batch.id, total: batchTotal, lines });
}
