// ============================================================
//  MCP tools — wraps existing admin operations.
//
//  Auth is enforced at /api/mcp route (Bearer → admin profile).
//  Each handler uses supabaseService() (RLS bypass) since the
//  HTTP layer has already verified admin role.
// ============================================================

import { supabaseService } from "@/app/lib/supabase/server";
import { calcBalance } from "@/app/lib/grant-calc";
import { decideApplication as decideApp } from "@/app/lib/admin/decide-application";
import {
  notifyReceiptApproved,
  notifyReceiptRejected,
  notifyBatchPaid,
} from "@/app/lib/notify";

export interface ToolContext {
  profile_id: string;
  origin:     string;
}

interface Tool {
  name:        string;
  description: string;
  inputSchema: Record<string, any>;
  handler:     (args: any, ctx: ToolContext) => Promise<any>;
}

// ──────────────────────────────────────────────────────────────
//  READS
// ──────────────────────────────────────────────────────────────

const listApplications: Tool = {
  name:        "list_applications",
  description: "List grant applications. Optional filter by status (pending/approved/denied).",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "approved", "denied"] },
      limit:  { type: "number", default: 50 },
    },
  },
  handler: async ({ status, limit = 50 }) => {
    const supabase = supabaseService();
    let q = supabase.from("applications")
      .select("id, app_ref, parent_names, city, contact_email, status, created_at, children")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
};

const getApplication: Tool = {
  name:        "get_application",
  description: "Full details of a single application by id.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  handler: async ({ id }) => {
    const supabase = supabaseService();
    const { data, error } = await supabase.from("applications").select("*").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const listRecipients: Tool = {
  name:        "list_recipients",
  description: "List recipients. Optional filter by status (active/completed/suspended).",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "completed", "suspended"] },
      limit:  { type: "number", default: 100 },
    },
  },
  handler: async ({ status, limit = 100 }) => {
    const supabase = supabaseService();
    let q = supabase.from("recipients")
      .select("id, approved_amount, reimbursement_rate, status, created_at, applications!inner(app_ref, parent_names, city, contact_email)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
};

const getRecipient: Tool = {
  name:        "get_recipient",
  description: "Full recipient details including balance breakdown (approved receipts, paid, remaining, eligible for next payout).",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  handler: async ({ id }) => {
    const supabase = supabaseService();
    const { data: recipient, error } = await supabase
      .from("recipients")
      .select("*, applications(*)")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);

    const { data: receipts } = await supabase.from("receipts").select("id, amount, status, description").eq("recipient_id", id);
    const { data: paid }     = await supabase.from("payouts").select("amount").eq("recipient_id", id).eq("status", "paid");
    const paidToDate = (paid || []).reduce((s: number, p: any) => s + Number(p.amount), 0);

    const balance = calcBalance({
      receipts:  receipts || [],
      rate:      Number(recipient.reimbursement_rate),
      cap:       Number(recipient.approved_amount),
      paidToDate,
    });

    return { ...recipient, balance, receipts_count: (receipts || []).length };
  },
};

const listReceipts: Tool = {
  name:        "list_receipts",
  description: "List receipts. Filter by recipient_id and/or status.",
  inputSchema: {
    type: "object",
    properties: {
      recipient_id: { type: "string" },
      status:       { type: "string", enum: ["pending", "approved", "rejected"] },
      limit:        { type: "number", default: 100 },
    },
  },
  handler: async ({ recipient_id, status, limit = 100 }) => {
    const supabase = supabaseService();
    let q = supabase.from("receipts").select("*").order("created_at", { ascending: false }).limit(limit);
    if (recipient_id) q = q.eq("recipient_id", recipient_id);
    if (status)       q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
};

const listTestimonials: Tool = {
  name:        "list_testimonials",
  description: "List testimonials. Optional filter by recipient_id.",
  inputSchema: {
    type: "object",
    properties: {
      recipient_id: { type: "string" },
      limit:        { type: "number", default: 50 },
    },
  },
  handler: async ({ recipient_id, limit = 50 }) => {
    const supabase = supabaseService();
    let q = supabase.from("testimonials").select("*").order("created_at", { ascending: false }).limit(limit);
    if (recipient_id) q = q.eq("recipient_id", recipient_id);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
};

const listPhotos: Tool = {
  name:        "list_photos",
  description: "List photos for a recipient.",
  inputSchema: {
    type: "object",
    properties: { recipient_id: { type: "string" } },
    required: ["recipient_id"],
  },
  handler: async ({ recipient_id }) => {
    const supabase = supabaseService();
    const { data, error } = await supabase.from("photos").select("*").eq("recipient_id", recipient_id).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  },
};

const listPayoutBatches: Tool = {
  name:        "list_payout_batches",
  description: "List payout batches. Optional filter by status (draft/approved/exported/paid).",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["draft", "approved", "exported", "paid"] },
      limit:  { type: "number", default: 24 },
    },
  },
  handler: async ({ status, limit = 24 }) => {
    const supabase = supabaseService();
    let q = supabase.from("payout_batches").select("*").order("scheduled_date", { ascending: false }).limit(limit);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
};

const getPayoutBatch: Tool = {
  name:        "get_payout_batch",
  description: "Single batch with its line items (individual payouts).",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  handler: async ({ id }) => {
    const supabase = supabaseService();
    const { data: batch, error: bErr } = await supabase.from("payout_batches").select("*").eq("id", id).single();
    if (bErr) throw new Error(bErr.message);
    const { data: lines } = await supabase
      .from("payouts")
      .select("*, recipients!inner(approved_amount, applications!inner(parent_names, contact_email, city, app_ref))")
      .eq("batch_id", id);
    return { ...batch, lines: lines || [] };
  },
};

const getSignedUrl: Tool = {
  name:        "get_signed_url",
  description: "Generates a short-lived signed URL for a private storage object. bucket must be 'receipts' or 'photos'.",
  inputSchema: {
    type: "object",
    properties: {
      bucket:   { type: "string", enum: ["receipts", "photos"] },
      path:     { type: "string" },
      ttl_secs: { type: "number", default: 300 },
    },
    required: ["bucket", "path"],
  },
  handler: async ({ bucket, path, ttl_secs = 300 }) => {
    const supabase = supabaseService();
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl_secs);
    if (error) throw new Error(error.message);
    return { signed_url: data.signedUrl, expires_in_secs: ttl_secs };
  },
};

// ──────────────────────────────────────────────────────────────
//  WRITES
// ──────────────────────────────────────────────────────────────

const decideApplication: Tool = {
  name:        "decide_application",
  description: "Approve or deny an application. On approve, creates a recipient row (idempotent), invites the applicant, and emails them. Atomic: if any step fails the application stays in 'pending' so admin can retry.",
  inputSchema: {
    type: "object",
    properties: {
      id:              { type: "string" },
      decision:        { type: "string", enum: ["approved", "denied"] },
      approved_amount: { type: "number", description: "Required if decision=approved." },
      rate:            { type: "number", description: "0.0–1.0. Default 0.75. Used if decision=approved." },
      notes:           { type: "string" },
    },
    required: ["id", "decision"],
  },
  handler: async ({ id, decision, approved_amount, rate, notes }, ctx) => {
    return decideApp({
      applicationId:    id,
      decision,
      approved_amount,
      rate,
      notes,
      deciderProfileId: ctx.profile_id,
      origin:           ctx.origin,
    });
  },
};

const decideReceipt: Tool = {
  name:        "decide_receipt",
  description: "Approve or reject a receipt. Emails the recipient.",
  inputSchema: {
    type: "object",
    properties: {
      id:       { type: "string" },
      decision: { type: "string", enum: ["approved", "rejected"] },
      notes:    { type: "string" },
    },
    required: ["id", "decision"],
  },
  handler: async ({ id, decision, notes }, ctx) => {
    const supabase = supabaseService();
    const { data: receipt, error: loadErr } = await supabase
      .from("receipts")
      .select("id, amount, description, recipients!inner(applications!inner(parent_names, contact_email))")
      .eq("id", id)
      .single();
    if (loadErr || !receipt) throw new Error(loadErr?.message || "receipt not found");

    const { error } = await supabase
      .from("receipts")
      .update({
        status:      decision,
        admin_notes: notes || null,
        decided_at:  new Date().toISOString(),
        decided_by:  ctx.profile_id,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);

    const application = (receipt as any).recipients.applications;
    const notifyArgs  = {
      to:           application.contact_email,
      parent_names: application.parent_names,
      amount:       Number(receipt.amount),
      description:  receipt.description || "",
      portal_url:   `${ctx.origin}/portal`,
    };
    if (decision === "approved") await notifyReceiptApproved(notifyArgs);
    else                          await notifyReceiptRejected({ ...notifyArgs, admin_notes: notes || "" });

    return { ok: true, receipt_id: id, decision };
  },
};

const modifyRecipient: Tool = {
  name:        "modify_recipient",
  description: "Update a recipient's approved_amount, reimbursement_rate, and/or status.",
  inputSchema: {
    type: "object",
    properties: {
      id:                 { type: "string" },
      approved_amount:    { type: "number" },
      reimbursement_rate: { type: "number" },
      status:             { type: "string", enum: ["active", "completed", "suspended"] },
    },
    required: ["id"],
  },
  handler: async ({ id, approved_amount, reimbursement_rate, status }) => {
    const update: Record<string, any> = {};
    if (approved_amount !== undefined) {
      if (approved_amount < 0) throw new Error("approved_amount must be >= 0");
      update.approved_amount = approved_amount;
    }
    if (reimbursement_rate !== undefined) {
      if (reimbursement_rate < 0 || reimbursement_rate > 1) throw new Error("reimbursement_rate must be 0–1");
      update.reimbursement_rate = reimbursement_rate;
    }
    if (status !== undefined) update.status = status;
    if (Object.keys(update).length === 0) throw new Error("no fields to update");

    const supabase = supabaseService();
    const { data, error } = await supabase.from("recipients").update(update).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const generatePayoutBatch: Tool = {
  name:        "generate_payout_batch",
  description: "Generate a payout batch from currently eligible recipients (same logic as the monthly cron). Returns batch id and total.",
  inputSchema: { type: "object", properties: {} },
  handler: async (_args, _ctx) => {
    const supabase = supabaseService();
    const { data: recipients } = await supabase.from("recipients").select("*").eq("status", "active");
    const today = new Date().toISOString().split("T")[0];
    const { data: batch, error: batchErr } = await supabase
      .from("payout_batches")
      .insert({ scheduled_date: today, status: "draft", total: 0 })
      .select("*")
      .single();
    if (batchErr) throw new Error(batchErr.message);

    let batchTotal = 0;
    let lines = 0;
    for (const r of recipients || []) {
      const { data: receipts } = await supabase.from("receipts").select("id, amount, status").eq("recipient_id", r.id);
      const { data: paid }     = await supabase.from("payouts").select("amount").eq("recipient_id", r.id).eq("status", "paid");
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
        await supabase.from("payouts").insert({
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
    await supabase.from("payout_batches").update({ total: Number(batchTotal.toFixed(2)) }).eq("id", batch.id);
    return { batch_id: batch.id, total: batchTotal, lines };
  },
};

const markBatchPaid: Tool = {
  name:        "mark_batch_paid",
  description: "Mark a payout batch as paid (after CEO Ministries has actually sent e-transfers). Emails each recipient.",
  inputSchema: {
    type: "object",
    properties: {
      batch_id:      { type: "string" },
      ceo_reference: { type: "string" },
    },
    required: ["batch_id"],
  },
  handler: async ({ batch_id, ceo_reference }, ctx) => {
    const supabase = supabaseService();
    const { data: payouts } = await supabase
      .from("payouts")
      .select("amount, recipients!inner(applications!inner(parent_names, contact_email))")
      .eq("batch_id", batch_id);

    const now = new Date().toISOString();
    const updPayouts = await supabase.from("payouts").update({ status: "paid", paid_at: now }).eq("batch_id", batch_id);
    if (updPayouts.error) throw new Error(updPayouts.error.message);

    const updBatch = await supabase.from("payout_batches").update({
      status:        "paid",
      paid_at:       now,
      ceo_reference: ceo_reference || null,
    }).eq("id", batch_id);
    if (updBatch.error) throw new Error(updBatch.error.message);

    await Promise.all(((payouts as any[]) || []).map((p) =>
      notifyBatchPaid({
        to:           p.recipients.applications.contact_email,
        parent_names: p.recipients.applications.parent_names,
        amount:       Number(p.amount),
        portal_url:   `${ctx.origin}/portal`,
      })
    ));

    return { ok: true, batch_id, recipients_notified: (payouts || []).length };
  },
};

const exportBatchCsv: Tool = {
  name:        "export_batch_csv",
  description: "Returns the CSV for a payout batch as text (the document to send to CEO Ministries).",
  inputSchema: {
    type: "object",
    properties: { batch_id: { type: "string" } },
    required: ["batch_id"],
  },
  handler: async ({ batch_id }) => {
    const supabase = supabaseService();
    const { data: batch } = await supabase.from("payout_batches").select("*").eq("id", batch_id).single();
    if (!batch) throw new Error("batch not found");
    const { data: payouts } = await supabase
      .from("payouts")
      .select("amount, status, receipts_included, recipients!inner(approved_amount, reimbursement_rate, applications!inner(parent_names, contact_email, contact_phone, city, app_ref))")
      .eq("batch_id", batch_id);

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
      await supabase.from("payout_batches").update({ status: "exported", exported_at: new Date().toISOString() }).eq("id", batch.id);
    }
    return csv;
  },
};

// ──────────────────────────────────────────────────────────────
//  Registry
// ──────────────────────────────────────────────────────────────

export const TOOLS: Tool[] = [
  listApplications,
  getApplication,
  listRecipients,
  getRecipient,
  listReceipts,
  listTestimonials,
  listPhotos,
  listPayoutBatches,
  getPayoutBatch,
  getSignedUrl,
  decideApplication,
  decideReceipt,
  modifyRecipient,
  generatePayoutBatch,
  markBatchPaid,
  exportBatchCsv,
];
